export { loadConfig } from './config';
export {
  log,
  getLogger,
  setLogger,
  silentLogger,
  consoleLogger,
  type Logger,
} from './logger';
export { runSync } from './sync/orchestrator';
export { defaultSyncIO } from './sync/default-io';
export {
  enrichSteamMetadata,
  getSteamEnrichmentCandidates,
  type SteamEnrichOptions,
  type SteamEnrichResult,
  type SteamAppMetadata,
} from './sync/steam-enrich';
export {
  enrichIgdbMetadata,
  getIgdbEnrichmentCandidates,
  type IgdbEnrichOptions,
  type IgdbEnrichResult,
  type IgdbApi,
  type IgdbGameDetails,
} from './sync/igdb-enrich';
export type {
  SyncEvent,
  SyncSummary,
  SyncOptions,
  SyncDeps,
  SyncIO,
  SyncAdapters,
  SyncStepKey,
} from './sync/types';
export { steamAdapter } from './adapters/steam.adapter';
export { playniteAdapter } from './adapters/playnite.adapter';
export { heroicAdapter } from './adapters/heroic.adapter';
export { createProtonDBAdapter } from './adapters/protondb.adapter';
export { createGamePassAdapter } from './adapters/gamepass.adapter';
export { igdbAdapter } from './adapters/igdb.adapter';
export { createNotionClient } from './notion/notion.client';
export { processRawGames } from './core/deduplicate';
export { loadOverrides } from './core/overrides';
export { normalizeGameName, calculateNameSimilarity, wordSortedKey } from './core/normalize';
export {
  generateMergeSuggestions,
  saveMergeSuggestions,
} from './core/suggestions';
export {
  suggestPick,
  suggestShelves,
  SUGGEST_STATUSES,
  SHELF_SIZE,
  type SuggestPick,
  type SuggestOptions,
  type SuggestShelf,
  type ShelfOptions,
} from './core/suggest';
export {
  getSimilarGames,
  SIMILAR_LIMIT,
  type SimilarGame,
  type SimilarOrigin,
} from './core/similarity';
export {
  loadOwnedXboxGames,
  processGamePassAvailability,
  saveUnavailableGames,
  getInterestGamesToSync,
  shouldSyncToNotion,
  resolveXboxSource,
} from './core/xbox-gamepass';
export type { RawGameData, UnifiedGame, Source, Config } from './types/game';
export {
  SCREENSHOT_SOURCES,
  SCREENSHOTS_PER_SOURCE,
  ScreenshotMapSchema,
  capScreenshotMap,
  capScreenshotUrls,
  mergeScreenshotMaps,
  parseScreenshotMap,
  resolveScreenshots,
  screenshotKeyForSource,
  type ScreenshotMap,
  type ScreenshotSource,
} from './types/game';
export {
  openDb,
  defaultDbPath,
  type Db,
  migrate,
  MIGRATIONS,
  seedStatuses,
  DEFAULT_STATUSES,
  type StatusSeed,
  upsertGames,
  getGame,
  listGames,
  rebuildGamesFts,
  reconcileUnavailableReasons,
  type UnavailableFlag,
  listStatuses,
  replaceStatuses,
  getLibraryGames,
  setGameStatus,
  unpinGame,
  UnknownStatusError,
  UnknownGameError,
  InvalidStatusListError,
  type StatusEntry,
  type StatusInput,
  type LibraryGame,
  type SetStatusResult,
  type UnpinResult,
  type GameCompatibility,
  parseDiscoverFilters,
  queryGames,
  getFacets,
  type DiscoverFilters,
  type DiscoverGame,
  type DiscoverFacets,
  type FacetCount,
  type YearFacetCount,
  installSqliteWarningSuppression,
  applyForceMerge,
  type ForceMergeOptions,
  type ForceMergeRuleReport,
  type ForceMergeReport,
  type StatusAction,
  manualId,
  importLegacyUserData,
  type LegacyImportCounts,
  listInterestEntries,
  listInterestTitles,
  addInterest,
  removeInterestByTitle,
  type InterestEntry,
  listOwnedGames,
  listOwnedGameNames,
  addOwnedGame,
  removeOwnedGame,
  type OwnedGame,
  loadGameOverrides,
  listForceMergeRules,
  addForceMergeRule,
  updateForceMergeRule,
  deleteForceMergeRule,
  UnknownForceMergeRuleError,
  type ForceMergeRuleEntry,
  type ForceMergeRuleInput,
} from './db/index';
