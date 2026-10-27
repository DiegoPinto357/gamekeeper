import '../bootstrap';
import {
  consoleLogger,
  setLogger,
  openDb,
  enrichSteamMetadata,
  enrichIgdbMetadata,
  rebuildGamesFts,
} from '@gamekeeper/core';

setLogger(consoleLogger);

/**
 * Metadata enrichment pass: Steam appdetails + IGDB (games, genres, tags,
 * descriptions, companies). Resumable — skips already-enriched games unless
 * --force; --limit=N caps a run for smoke-testing.
 *
 * Usage: pnpm enrich [--force] [--limit=N]
 */

const args = process.argv.slice(2);
const force = args.includes('--force');
const limitArg = args.find((a) => a.startsWith('--limit='));
const limit = limitArg ? Number(limitArg.split('=')[1]) : undefined;

const isTTY = process.stdout.isTTY === true;

const makeProgress =
  (label: string) => (done: number, total: number, name: string) => {
    const line = `  ${label}: ${done}/${total} ${name}`;
    if (isTTY) {
      process.stdout.write(`\r\x1b[K${line.slice(0, 120)}`);
    } else if (done === total || done % 25 === 0) {
      console.log(line);
    }
  };

const main = async () => {
  console.log(`🔎 Metadata enrichment${force ? ' (force)' : ''}`);

  const db = openDb(); // migrates on open

  const steam = await enrichSteamMetadata(db.raw, {
    force,
    limit,
    onProgress: makeProgress('Steam'),
  });
  if (isTTY) process.stdout.write('\r\x1b[K');
  console.log(
    `  ✓ Steam: ${steam.enriched} enriched, ${steam.failed} failed (${steam.total} candidates)`,
  );

  const igdb = await enrichIgdbMetadata(db.raw, {
    force,
    limit,
    onProgress: makeProgress('IGDB'),
  });
  if (isTTY) process.stdout.write('\r\x1b[K');
  console.log(
    `  ✓ IGDB: ${igdb.enriched} enriched, ${igdb.failed} failed (${igdb.total} candidates)`,
  );

  const fts = rebuildGamesFts(db.raw);
  console.log(`  ✓ FTS rebuilt (${fts} games)`);

  db.close();
};

main().catch((err) => {
  console.error('Enrichment failed:', err);
  process.exit(1);
});
