import { normalizeGameName } from '../core/normalize';
import { processRawGames } from '../core/deduplicate';
import { generateMergeSuggestions } from '../core/suggestions';
import { selectInterestGames } from '../core/xbox-gamepass';
import { getLogger, setLogger } from '../logger';
import { defaultSyncIO } from './default-io';
import type { SyncEvent, SyncIO, SyncOptions, SyncDeps, SyncStepKey, SyncSummary } from './types';
import type { Config, RawGameData, Source, UnifiedGame } from '../types/game';
import type { GamePassGame } from '../adapters/gamepass.adapter';

type StepResult<T> = {
  value: T;
  detail?: string;
  /** when set, emits step:error instead of step:done */
  error?: unknown;
  /** when true, emits step:skip instead of step:done */
  skipped?: boolean;
};

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

/**
 * Run the full GameKeeper sync pipeline, emitting structured events.
 *
 * - Non-fatal steps return `{ value, error }` to record a step:error and continue.
 * - Fatal failures emit step:error, then a final summary, then rethrow.
 * - A summary event is always the last event of a run.
 */
export const runSync = async (
  options: SyncOptions = {},
  deps: SyncDeps,
): Promise<SyncSummary> => {
  const start = Date.now();
  const previousLogger = getLogger();
  setLogger(deps.logger);

  const io: SyncIO = { ...defaultSyncIO, ...deps.io };
  const emit = deps.emit;
  let stepErrors = 0;
  const notionCounts = { removed: 0, skipped: 0, errors: 0 };
  const dbCounts = { added: 0, updated: 0 };

  const skipStep = (key: SyncStepKey, label: string, detail?: string): void => {
    emit({ type: 'step:skip', key, label, detail });
  };

  const step = async <T>(
    key: SyncStepKey,
    label: string,
    fn: () => Promise<StepResult<T>>,
    opts: { fatal?: boolean } = {},
  ): Promise<T> => {
    emit({ type: 'step:start', key, label });
    let result: StepResult<T>;
    try {
      result = await fn();
    } catch (error) {
      // unexpected throw inside a step is always fatal
      stepErrors++;
      emit({ type: 'step:error', key, label, detail: errorMessage(error) });
      throw error;
    }
    if (result.error !== undefined) {
      stepErrors++;
      emit({ type: 'step:error', key, label, detail: errorMessage(result.error) });
      if (opts.fatal !== false) {
        throw result.error instanceof Error
          ? result.error
          : new Error(errorMessage(result.error));
      }
      return result.value;
    }
    if (result.skipped) {
      emit({ type: 'step:skip', key, label, detail: result.detail });
      return result.value;
    }
    emit({ type: 'step:done', key, label, detail: result.detail });
    return result.value;
  };

  const buildSummary = (): SyncSummary => ({
    added: dbCounts.added,
    updated: dbCounts.updated,
    removed: notionCounts.removed,
    skipped: notionCounts.skipped,
    errors: stepErrors + notionCounts.errors,
    duration: Date.now() - start,
  });

  const finish = (summary?: SyncSummary): SyncSummary => {
    const s = summary ?? buildSummary();
    emit({ type: 'summary', summary: s });
    return s;
  };

  try {
    // 1. Configuration
    const config = await step('config', 'Configuration loaded', async () => {
      const loaded = io.loadConfig();
      const effective: Config = {
        ...loaded,
        dryRun: options.dryRun ?? loaded.dryRun,
      };
      if (effective.dryRun) {
        deps.logger.info('🏃 DRY RUN MODE — Notion will not be modified');
      }
      if (effective.logLevel === 'debug') {
        deps.logger.info('[DEBUG] Debug logging enabled');
      }
      return {
        value: effective,
        detail: effective.dryRun ? 'dry-run' : undefined,
      };
    });

    // 2. Manual overrides
    await step('overrides', 'Overrides loaded', async () => {
      const overrides = await io.loadOverrides();
      const ruleCount =
        (overrides.forceMerge?.length ?? 0) +
        (overrides.propertyOverrides?.length ?? 0);
      return { value: overrides, detail: `${ruleCount} rules` };
    });

    // 3. Adapters
    const adapters = await step('adapters', 'Adapters initialized', async () => ({
      value: await io.initAdapters(config),
    }));

    // 4. Notion database verification
    const skipNotion = options.skipNotion ?? false;
    if (skipNotion) {
      skipStep('notion-verify', 'Notion database verified', 'Notion sync disabled');
    } else {
      await step('notion-verify', 'Notion database verified', async () => {
        const accessible = await adapters.notion.verifyDatabase();
        if (!accessible) {
          throw new Error(
            'Cannot access Notion database. Check your API key and database ID.',
          );
        }
        return { value: true };
      });
    }

    const rawGames: RawGameData[] = [];

    // 5. Steam (non-fatal — continue without Steam data)
    const steamGames = await step(
      'steam',
      'Steam',
      async () => {
        try {
          const games = await adapters.fetchSteamGames(config);
          return { value: games, detail: `${games.length} games` };
        } catch (error) {
          deps.logger.error('❌ Failed to fetch Steam games:', error);
          return { value: [] as RawGameData[], error };
        }
      },
      { fatal: false },
    );
    rawGames.push(...steamGames);

    // 6. Game Pass catalog (non-fatal — library harvest degrades without it)
    const gamePassCatalog = await step(
      'gamepass-catalog',
      'Game Pass catalog',
      async () => {
        try {
          const catalog = await adapters.gamePass.getCatalog();
          return { value: catalog, detail: `${catalog.length} games` };
        } catch (error) {
          deps.logger.error('❌ Failed to load Game Pass catalog:', error);
          return { value: undefined as GamePassGame[] | undefined, error };
        }
      },
      { fatal: false },
    );

    // Normalized + word-sorted catalog titles for removal detection
    // (so swapped main/subtitle variants still match).
    let catalogTitles: Set<string> | undefined;
    if (gamePassCatalog) {
      catalogTitles = new Set(
        gamePassCatalog
          .filter(g => g.available)
          .flatMap(g => {
            const norm = normalizeGameName(g.title);
            const sorted = norm.split(' ').filter(Boolean).sort().join(' ');
            return [norm, sorted];
          }),
      );
    }

    // 7. Game Pass interests
    const interests = await step<string[]>('interests', 'Game Pass interests', async () => {
      const list = await io.loadInterests();
      if (list === null) {
        return { value: [] as string[], skipped: true, detail: 'file not found' };
      }
      return { value: list, detail: `${list.length} games` };
    });

    // 8. Library sources (non-fatal — continue without library data)
    let libraryOk = false;
    const sourceGames = await step(
      'library',
      'Library sources',
      async () => {
        if (!gamePassCatalog) {
          return {
            value: [] as RawGameData[],
            skipped: true,
            detail: 'Game Pass catalog unavailable',
          };
        }
        try {
          const games = await adapters.loadLibrarySources(config, {
            interests,
            gamePassCatalog,
          });
          libraryOk = true;
          return { value: games, detail: `${games.length} games` };
        } catch (error) {
          deps.logger.error('❌ Failed to load game libraries:', error);
          return { value: [] as RawGameData[], error };
        }
      },
      { fatal: false },
    );
    rawGames.push(...sourceGames);

    // 9. Game Pass interest games
    if (!gamePassCatalog) {
      skipStep('interest-games', 'Game Pass interest games', 'Game Pass catalog unavailable');
    } else {
      const interestGames = await step(
        'interest-games',
        'Game Pass interest games',
        async () => {
          const games = await selectInterestGames(
            interests,
            gamePassCatalog,
            sourceGames,
          );
          if (games.length === 0) {
            return { value: games, skipped: true, detail: 'none' };
          }
          return { value: games, detail: `${games.length} games added` };
        },
      );
      rawGames.push(...interestGames);
    }

    if (rawGames.length === 0) {
      deps.logger.warn('⚠️  No games found from any source. Exiting.');
      return finish();
    }

    // 10. Deduplicate and merge
    const unifiedGames = await step('dedupe', 'Deduplicated', async () => {
      const unified = processRawGames(rawGames);
      return { value: unified, detail: `${unified.length} unique` };
    });

    // 11. Merge suggestions
    await step('suggestions', 'Merge suggestions', async () => {
      const suggestions = generateMergeSuggestions(rawGames);
      await io.saveMergeSuggestions(suggestions);
      return { value: suggestions, detail: `${suggestions.length} suggestions` };
    });

    // 12. Enrich PC games: IGDB Steam-ID lookup (best-effort, non-blocking errors)
    const pcGames = unifiedGames.filter(g => {
      if (g.steamAppId) return true;
      const pcPlatforms: Source[] = ['epic', 'gog', 'amazon'];
      return g.ownedSources.some(source => pcPlatforms.includes(source));
    });
    const nonSteamPcGames = pcGames.filter(g => !g.steamAppId);

    await step('igdb-lookup', 'IGDB Steam-ID lookup', async () => {
      if (nonSteamPcGames.length === 0) {
        return { value: 0, skipped: true, detail: 'no non-Steam PC games' };
      }
      const IGDB_BATCH_SIZE = 2; // 2 API calls per game → 2 games = 4 req/s
      const IGDB_DELAY = 1000;
      let matches = 0;

      for (let i = 0; i < nonSteamPcGames.length; i += IGDB_BATCH_SIZE) {
        const batch = nonSteamPcGames.slice(i, i + IGDB_BATCH_SIZE);
        await Promise.all(
          batch.map(async game => {
            try {
              const steamAppId = await adapters.igdb.findSteamAppId(game.name);
              if (steamAppId) {
                game.steamAppId = steamAppId;
                matches++;
                if (config.logLevel === 'debug') {
                  deps.logger.debug(
                    `[DEBUG] IGDB matched "${game.name}" → Steam App ID ${steamAppId}`,
                  );
                }
              }
            } catch {
              // best-effort lookup — continue
            }
          }),
        );

        const processed = Math.min(i + IGDB_BATCH_SIZE, nonSteamPcGames.length);
        emit({ type: 'progress', key: 'igdb-lookup', current: processed, total: nonSteamPcGames.length });

        if (i + IGDB_BATCH_SIZE < nonSteamPcGames.length) {
          await new Promise(resolve => setTimeout(resolve, IGDB_DELAY));
        }
      }

      const cacheStats = adapters.igdb.getCacheStats();
      deps.logger.info(
        `📊 IGDB Cache: ${cacheStats.totalEntries} entries (${cacheStats.foundEntries} matches, ${cacheStats.notFoundEntries} not found)`,
      );
      if (cacheStats.retriableEntries > 0) {
        deps.logger.info(
          `   ⏰ ${cacheStats.retriableEntries} old failures were retried this run`,
        );
      }

      return {
        value: matches,
        detail: `${matches}/${nonSteamPcGames.length} matched`,
      };
    });

    // 13. ProtonDB enrichment
    const gamesWithSteamId = pcGames.filter(g => g.steamAppId);
    await step('protondb', 'ProtonDB enrichment', async () => {
      if (gamesWithSteamId.length === 0) {
        return { value: 0, skipped: true, detail: 'no Steam IDs' };
      }
      const BATCH_SIZE = 20;
      let enriched = 0;

      for (let i = 0; i < gamesWithSteamId.length; i += BATCH_SIZE) {
        const batch = gamesWithSteamId.slice(i, i + BATCH_SIZE);
        await Promise.all(
          batch.map(async game => {
            try {
              if (!game.steamAppId) return;
              const protonInfo = await adapters.protonDb.fetchCompatibility(
                game.steamAppId,
              );
              if (protonInfo) {
                game.proton = protonInfo;
                enriched++;
              }
            } catch (error) {
              deps.logger.warn(
                `Failed to fetch ProtonDB data for "${game.name}":`,
                error,
              );
            }
          }),
        );

        const processed = Math.min(i + BATCH_SIZE, gamesWithSteamId.length);
        emit({ type: 'progress', key: 'protondb', current: processed, total: gamesWithSteamId.length });
      }

      return { value: enriched, detail: `${enriched} enriched` };
    });

    // 14. Notion sync
    if (skipNotion) {
      skipStep('notion', 'Notion sync', 'skipped');
    } else {
      await step('notion', 'Notion sync', async () => {
        const operations = await adapters.notion.syncGames(
          unifiedGames,
          catalogTitles,
          progress =>
            emit({
              type: 'progress',
              key: 'notion',
              current: progress.current,
              total: progress.total,
            }),
        );
        notionCounts.removed = operations.removed.length;
        notionCounts.skipped = operations.skippedCount;
        notionCounts.errors = operations.errorCount;
        return {
          value: operations,
          detail: `${operations.added.length} added, ${operations.updated.length} updated`,
        };
      });
    }

    // 15. Local library snapshot
    await step('snapshot', 'Library snapshot', async () => {
      await io.saveLibrarySnapshot(unifiedGames);
      return { value: true, detail: 'data/library.json' };
    });

    // 16. Write to SQLite
    await step('db-write', 'Write to database', async () => {
      const result = await io.writeGamesToDb(unifiedGames);
      dbCounts.added = result.added;
      dbCounts.updated = result.updated;
      return {
        value: result,
        detail: `${result.added} added, ${result.updated} updated`,
      };
    });

    // 17. Game Pass availability report
    await step('availability', 'Availability report', async () => {
      if (!gamePassCatalog || !libraryOk) {
        return {
          value: { unavailable: [], returned: [] },
          skipped: true,
          detail: 'no Game Pass library data',
        };
      }
      const { unavailable, returned } = await io.processGamePassAvailability(
        sourceGames,
        gamePassCatalog,
      );
      if (returned.length > 0) {
        deps.logger.info(
          `🎉 ${returned.length} games returned to Game Pass: ${returned.join(', ')}`,
        );
      }
      if (unavailable.length > 0) {
        await io.saveUnavailableGames(unavailable);
      } else {
        deps.logger.info('✅ All played/interest games are available');
      }
      // The JSON report is name-keyed only; persist a canonical-id-keyed
      // copy into the DB so the board can render "not available" badges.
      // Always runs (even when empty) so recovered games clear their flag.
      const persisted = await io.persistAvailability(unavailable);
      if (persisted.flagged > 0 || persisted.cleared > 0) {
        deps.logger.info(
          `🗄️  Availability persisted: ${persisted.flagged} flagged, ${persisted.cleared} cleared`,
        );
      }
      return {
        value: { unavailable, returned },
        detail: unavailable.length
          ? `${unavailable.length} unavailable`
          : 'all available',
      };
    });

    return finish();
  } catch (error) {
    // fatal failure: emit the terminal summary, then rethrow for the caller
    finish();
    throw error;
  } finally {
    setLogger(previousLogger);
  }
};
