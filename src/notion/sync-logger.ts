import fs from 'fs/promises';
import path from 'path';
import { UnifiedGame } from '../types/game';

/**
 * Sync operation tracker
 */
export type SyncOperations = {
  added: string[];
  updated: string[];
  removed: string[];
  skippedCount: number;
  errorCount: number;
};

/**
 * Complete sync log
 */
export type SyncLog = {
  timestamp: string;
  duration: number; // milliseconds
  added: string[];
  updated: string[];
  removed: string[];
  skipped: number;
  errors: number;
};

/**
 * Create a new sync operations tracker
 */
export const createSyncTracker = (
  startTime: number = Date.now(),
): {
  operations: SyncOperations;
  startTime: number;
} => ({
  operations: {
    added: [],
    updated: [],
    removed: [],
    skippedCount: 0,
    errorCount: 0,
  },
  startTime,
});

/**
 * Track a game being added
 */
export const trackAdded = (
  tracker: SyncOperations,
  game: UnifiedGame,
): void => {
  tracker.added.push(game.name);
};

/**
 * Track a game being updated
 */
export const trackUpdated = (
  tracker: SyncOperations,
  game: UnifiedGame,
): void => {
  tracker.updated.push(game.name);
};

/**
 * Track a game being removed
 */
export const trackRemoved = (
  tracker: SyncOperations,
  gameName: string,
): void => {
  tracker.removed.push(gameName);
};

/**
 * Track a game being skipped
 */
export const trackSkipped = (tracker: SyncOperations): void => {
  tracker.skippedCount++;
};

/**
 * Track an error
 */
export const trackError = (tracker: SyncOperations): void => {
  tracker.errorCount++;
};

/**
 * Save sync log to file
 */
export const saveSyncLog = async (
  operations: SyncOperations,
  startTime: number,
  logDir: string = './logs',
): Promise<string> => {
  await fs.mkdir(logDir, { recursive: true });

  const timestamp = new Date()
    .toISOString()
    .replace(/:/g, '-')
    .replace(/\..+/, '');
  const filepath = path.join(logDir, `sync-${timestamp}.json`);

  const log: SyncLog = {
    timestamp: new Date().toISOString(),
    duration: Date.now() - startTime,
    added: operations.added.sort(),
    updated: operations.updated.sort(),
    removed: operations.removed.sort(),
    skipped: operations.skippedCount,
    errors: operations.errorCount,
  };

  await fs.writeFile(filepath, JSON.stringify(log, null, 2), 'utf-8');
  return filepath;
};

/**
 * Print sync summary to console
 */
export const printSyncSummary = (
  operations: SyncOperations,
  startTime: number,
): void => {
  const duration = ((Date.now() - startTime) / 1000).toFixed(2);
  const total =
    operations.added.length +
    operations.updated.length +
    operations.removed.length +
    operations.skippedCount +
    operations.errorCount;

  console.log('\n📊 Sync Summary:');
  console.log(`   Duration: ${duration}s`);
  console.log(`   Total: ${total} games`);
  console.log(`   ✅ Added: ${operations.added.length}`);
  console.log(`   🔄 Updated: ${operations.updated.length}`);
  console.log(`   ⚠️  Removed: ${operations.removed.length}`);
  console.log(`   ⏭️  Skipped: ${operations.skippedCount}`);
  if (operations.errorCount > 0) {
    console.log(`   ❌ Errors: ${operations.errorCount}`);
  }
};
