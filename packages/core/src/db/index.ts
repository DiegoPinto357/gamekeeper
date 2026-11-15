export { openDb, defaultDbPath, type Db } from './connection';
export { migrate, MIGRATIONS } from './migrate';
export { seedStatuses, DEFAULT_STATUSES, type StatusSeed } from './seed';
export {
  upsertGames,
  getGame,
  listGames,
  rebuildGamesFts,
  reconcileUnavailableReasons,
  type UnavailableFlag,
} from './repos/games';
export {
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
} from './repos/game-status';
export {
  parseDiscoverFilters,
  queryGames,
  getFacets,
  type DiscoverFilters,
  type DiscoverGame,
  type DiscoverFacets,
  type FacetCount,
  type YearFacetCount,
} from './repos/discover';
export { installSqliteWarningSuppression } from './suppress-warning';
export { manualId } from './manual-id';
export {
  importLegacyUserData,
  type LegacyImportCounts,
} from './legacy-import';
export {
  listInterestEntries,
  listInterestTitles,
  addInterest,
  removeInterestByTitle,
  type InterestEntry,
} from './repos/interests';
export {
  listOwnedGames,
  listOwnedGameNames,
  addOwnedGame,
  removeOwnedGame,
  type OwnedGame,
} from './repos/owned-games';
export {
  loadGameOverrides,
  listForceMergeRules,
  addForceMergeRule,
  updateForceMergeRule,
  deleteForceMergeRule,
  UnknownForceMergeRuleError,
  type ForceMergeRuleEntry,
  type ForceMergeRuleInput,
} from './repos/overrides';
export {
  applyForceMerge,
  type ForceMergeOptions,
  type ForceMergeRuleReport,
  type ForceMergeReport,
  type StatusAction,
} from './repos/force-merge';
