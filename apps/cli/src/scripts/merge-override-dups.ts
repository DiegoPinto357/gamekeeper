import '../bootstrap';
import {
  consoleLogger,
  setLogger,
  openDb,
  loadOverrides,
  applyForceMerge,
} from '@gamekeeper/core';

setLogger(consoleLogger);

/**
 * Force-merge duplicate rows for the rules in data/overrides.json: fold
 * each loser row's data into the rule's canonical winner and delete the
 * loser. Only the rows still present in the database are affected — rules
 * already applied (or whose names never produced a duplicate) are skipped
 * and reported. Idempotent: re-running finds nothing left to merge.
 *
 * Usage: pnpm merge-override-dups [--rule="<canonicalName>"]
 *        [--status-conflict=winner|loser] [--dry-run]
 */

const args = process.argv.slice(2);
const ruleArg = args.find((a) => a.startsWith('--rule='));
const conflictArg = args.find((a) => a.startsWith('--status-conflict='));
const dryRun = args.includes('--dry-run');

const ruleFilter = ruleArg ? ruleArg.slice('--rule='.length) : undefined;
const statusConflict = conflictArg
  ? conflictArg.slice('--status-conflict='.length)
  : undefined;

if (
  statusConflict !== undefined &&
  statusConflict !== 'winner' &&
  statusConflict !== 'loser'
) {
  console.error(
    `Unknown --status-conflict=${statusConflict} (expected winner|loser)`,
  );
  process.exit(1);
}

const main = async () => {
  const overrides = await loadOverrides();
  const rules = overrides.forceMerge ?? [];
  if (rules.length === 0) {
    console.log('No forceMerge rules in data/overrides.json — nothing to do.');
    return;
  }

  const db = openDb(); // migrates on open
  try {
    const report = applyForceMerge(db.raw, rules, {
      dryRun,
      rule: ruleFilter,
      statusConflict: statusConflict as 'winner' | 'loser' | undefined,
    });

    if (ruleFilter && report.rules.length === 0) {
      console.error(`No forceMerge rule with canonicalName "${ruleFilter}".`);
      process.exitCode = 1;
      return;
    }

    for (const r of report.rules) {
      if (r.skipped) {
        console.log(
          `↷ ${r.canonicalName || '(unnamed rule)'} — skipped: ${r.skipReason}`,
        );
        continue;
      }
      const statusNote =
        r.statusAction === 'none' ? '' : ` [status: ${r.statusAction}]`;
      console.log(
        `✓ ${r.canonicalName} — merged ${r.mergedIds.length} → ${r.winnerId}${statusNote}`,
      );
      for (const id of r.mergedIds) console.log(`    − ${id}`);
    }

    console.log(
      report.dryRun
        ? `Dry run: ${report.merged} row(s) would merge.`
        : `Merged ${report.merged} row(s).`,
    );
  } finally {
    db.close();
  }
};

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
