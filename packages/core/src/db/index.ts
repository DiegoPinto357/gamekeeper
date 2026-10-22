export { openDb, defaultDbPath, type Db } from './connection';
export { migrate, MIGRATIONS } from './migrate';
export { seedStatuses, DEFAULT_STATUSES, type StatusSeed } from './seed';
export {
  upsertGames,
  getGame,
  listGames,
  rebuildGamesFts,
} from './repos/games';
export {
  listStatuses,
  getLibraryGames,
  setGameStatus,
  materializeBacklog,
  UnknownStatusError,
  UnknownGameError,
  type StatusEntry,
  type LibraryGame,
  type SetStatusResult,
} from './repos/game-status';
export { installSqliteWarningSuppression } from './suppress-warning';
