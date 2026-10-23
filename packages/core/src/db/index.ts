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
  getLibraryGames,
  setGameStatus,
  unpinGame,
  UnknownStatusError,
  UnknownGameError,
  type StatusEntry,
  type LibraryGame,
  type SetStatusResult,
  type UnpinResult,
  type GameCompatibility,
} from './repos/game-status';
export { installSqliteWarningSuppression } from './suppress-warning';
