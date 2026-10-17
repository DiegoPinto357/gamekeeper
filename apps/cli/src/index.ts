import './bootstrap';
import {
  runSync,
  setLogger,
  consoleLogger,
  type SyncEvent,
} from '@gamekeeper/core';

setLogger(consoleLogger);

const isTTY = process.stdout.isTTY === true;

let progressVisible = false;

const clearProgressLine = (): void => {
  if (isTTY && progressVisible) {
    process.stdout.write('\r\x1b[K');
    progressVisible = false;
  }
};

const progressEventLabel = (key: string): string => {
  switch (key) {
    case 'igdb-lookup':
      return 'non-Steam games checked';
    case 'protondb':
      return 'games enriched';
    default:
      return key;
  }
};

const render = (event: SyncEvent): void => {
  switch (event.type) {
    case 'step:start':
      clearProgressLine();
      console.log(`  ⟳ ${event.label}...`);
      break;
    case 'step:done':
      clearProgressLine();
      console.log(`  ✓ ${event.label}${event.detail ? ` — ${event.detail}` : ''}`);
      break;
    case 'step:skip':
      clearProgressLine();
      console.log(`  ⊘ ${event.label}${event.detail ? ` — ${event.detail}` : ''}`);
      break;
    case 'step:error':
      clearProgressLine();
      console.log(`  ✗ ${event.label}${event.detail ? ` — ${event.detail}` : ''}`);
      break;
    case 'progress': {
      if (isTTY) {
        if (progressVisible) process.stdout.write('\r\x1b[K');
        process.stdout.write(
          `    ${event.key}: ${event.current}/${event.total} ${progressEventLabel(event.key)}...`,
        );
        progressVisible = true;
      } else if (event.current % 20 === 0 || event.current === event.total) {
        console.log(
          `  Progress: ${event.current}/${event.total} ${progressEventLabel(event.key)}...`,
        );
      }
      break;
    }
    case 'summary':
      clearProgressLine();
      console.log('\n📈 Summary:');
      console.log(
        `   • Added: ${event.summary.added} · Updated: ${event.summary.updated} · Removed: ${event.summary.removed} · Skipped: ${event.summary.skipped}`,
      );
      if (event.summary.errors > 0) {
        console.log(`   • Errors: ${event.summary.errors}`);
      }
      console.log(`   • Duration: ${(event.summary.duration / 1000).toFixed(2)}s`);
      break;
  }
};

const main = async (): Promise<void> => {
  const dryRun = process.argv.includes('--dry-run');
  const skipNotion = process.argv.includes('--skip-notion');

  console.log('🎮 GameKeeper - Starting sync...\n');

  await runSync({ dryRun, skipNotion }, { logger: consoleLogger, emit: render });

  console.log('\n✅ GameKeeper sync completed successfully!');
};

main().catch(error => {
  clearProgressLine();
  console.error('\n❌ Error during sync:', error);
  process.exit(1);
});
