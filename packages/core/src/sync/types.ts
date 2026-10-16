import type { Config, ProtonInfo, RawGameData, UnifiedGame } from '../types/game';
import type { GamePassGame } from '../adapters/gamepass.adapter';
import type { GameOverrides } from '../types/overrides';
import type { MergeSuggestion } from '../core/suggestions';
import type { UnavailableGame } from '../core/xbox-gamepass';
import type { SyncOperations } from '../notion/sync-logger';
import type { Logger } from '../logger';

export type SyncStepKey =
  | 'config'
  | 'overrides'
  | 'adapters'
  | 'notion-verify'
  | 'steam'
  | 'gamepass-catalog'
  | 'interests'
  | 'library'
  | 'interest-games'
  | 'dedupe'
  | 'suggestions'
  | 'igdb-lookup'
  | 'protondb'
  | 'notion'
  | 'snapshot'
  | 'db-write'
  | 'availability';

export type SyncStepInfo = {
  key: SyncStepKey;
  label: string;
  detail?: string;
};

export type SyncSummary = {
  added: number;
  updated: number;
  removed: number;
  skipped: number;
  errors: number;
  duration: number; // milliseconds
};

export type SyncEvent =
  | ({ type: 'step:start' } & SyncStepInfo)
  | ({ type: 'step:done' } & SyncStepInfo)
  | ({ type: 'step:skip' } & SyncStepInfo)
  | ({ type: 'step:error' } & SyncStepInfo)
  | { type: 'progress'; key: SyncStepKey; current: number; total: number }
  | { type: 'summary'; summary: SyncSummary };

export type SyncOptions = {
  dryRun?: boolean;
  skipNotion?: boolean;
  logLevel?: 'debug' | 'info';
};

export type NotionProgress = {
  current: number;
  total: number;
  created?: number;
  updated?: number;
  skipped?: number;
  errors?: number;
};

/**
 * Adapter handles used by the orchestrator. The default implementations wrap
 * the real core adapters; tests inject fakes via SyncIO.initAdapters.
 */
export interface SyncAdapters {
  protonDb: {
    init(): Promise<void>;
    fetchCompatibility(steamAppId: number): Promise<ProtonInfo | null>;
  };
  igdb: {
    initialize(): Promise<void>;
    findSteamAppId(name: string): Promise<number | null>;
    getCacheStats(): {
      totalEntries: number;
      foundEntries: number;
      notFoundEntries: number;
      retriableEntries: number;
    };
  };
  gamePass: {
    getCatalog(): Promise<GamePassGame[]>;
    isGameAvailable(title: string): Promise<boolean>;
  };
  notion: {
    verifyDatabase(): Promise<boolean>;
    syncGames(
      games: UnifiedGame[],
      gamePassCatalogTitles?: Set<string>,
      onProgress?: (progress: NotionProgress) => void,
    ): Promise<SyncOperations>;
  };
  fetchSteamGames(config: Config): Promise<RawGameData[]>;
  loadLibrarySources(
    config: Config,
    ctx: { interests: string[]; gamePassCatalog: GamePassGame[] },
  ): Promise<RawGameData[]>;
}

/**
 * Side-effect boundary of the sync pipeline. Defaults live in default-io.ts;
 * tests inject fakes through deps.io.
 */
export interface SyncIO {
  loadConfig(): Config;
  loadOverrides(): Promise<GameOverrides>;
  initAdapters(config: Config): Promise<SyncAdapters>;
  /** null ⇒ interests file missing */
  loadInterests(): Promise<string[] | null>;
  saveMergeSuggestions(suggestions: MergeSuggestion[]): Promise<void>;
  saveLibrarySnapshot(games: UnifiedGame[]): Promise<void>;
  writeGamesToDb(
    games: UnifiedGame[],
  ): Promise<{ path: string; added: number; updated: number }>;
  processGamePassAvailability(
    sourceGames: RawGameData[],
    gamePassCatalog: GamePassGame[],
  ): Promise<{ unavailable: UnavailableGame[]; returned: string[] }>;
  saveUnavailableGames(unavailable: UnavailableGame[]): Promise<void>;
}

export type SyncDeps = {
  logger: Logger;
  emit: (event: SyncEvent) => void;
  /** Partial overrides merged over the default IO (tests inject fakes here) */
  io?: Partial<SyncIO>;
};
