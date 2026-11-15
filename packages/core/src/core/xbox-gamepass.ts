import fs from 'fs/promises';
import path from 'path';
import type { DatabaseSync } from 'node:sqlite';
import { type RawGameData } from '../types/game';
import { normalizeGameName, wordSortedKey } from './normalize';
import { type GamePassGame } from '../adapters/gamepass.adapter';
import { log } from '../logger';
import { listOwnedGameNames } from '../db/repos/owned-games';
import { listInterestEntries, listInterestTitles, type InterestEntry } from '../db/repos/interests';

/**
 * Check if a normalized interest name matches a normalized catalog title.
 * Uses exact match first, then falls back to prefix containment for cases
 * where Microsoft appends edition info like "- Digital Standard Edition (Windows)".
 *
 * Substring match is only allowed when, after the interest text, the catalog
 * title continues with edition/packaging words — not sequel numbers (II, III, 2, 3…).
 * This prevents "Modern Warfare" from matching "Modern Warfare II" or "Modern Warfare III".
 * Minimum length guard prevents short strings from causing false positives.
 */
const MIN_MATCH_LENGTH = 10;
const EDITION_WORDS = new Set([
  'digital',
  'standard',
  'deluxe',
  'ultimate',
  'complete',
  'edition',
  'pack',
  'remastered',
  'definitive',
  'enhanced',
  'gold',
  'platinum',
  'extended',
  'anniversary',
  'bundle',
  'collection',
  'classic',
  'premium',
  'director',
  'cut',
  'goty',
  'content',
  'windows',
]);
const catalogMatchesInterest = (
  catalogName: string,
  interestName: string,
): boolean => {
  if (catalogName === interestName) return true;
  // Order-insensitive equality: the interests file holds swapped
  // subtitle/main-title orders ("Senua's Saga: Hellblade II" vs the
  // catalog's "Hellblade II: Senua's Saga"). Word-sorted keys compare
  // word multisets, so sequels still differ ("ii modern warfare" ≠
  // "modern warfare").
  if (wordSortedKey(catalogName) === wordSortedKey(interestName)) return true;
  if (interestName.length < MIN_MATCH_LENGTH) return false;

  const idx = catalogName.indexOf(interestName);
  if (idx === -1) return false;

  // Check that whatever follows the interest name in the catalog title
  // only contains known edition/packaging words (not sequel numbers).
  const remainder = catalogName.slice(idx + interestName.length).trim();
  if (remainder === '') return true;
  const remainderWords = remainder.split(/\s+/);
  return remainderWords.every(w => EDITION_WORDS.has(w));
};

export type UnavailableGame = {
  name: string;
  reason: 'left-catalog' | 'interest-unavailable';
  lastSeen?: string;
  wasPlayed?: boolean;
};

export type GamePassUnavailable = {
  unavailableGames: UnavailableGame[];
  lastUpdated: string | null;
};

const DATA_DIR = path.join(process.cwd(), 'data');
const UNAVAILABLE_FILE = path.join(DATA_DIR, 'gamepass-unavailable.json');

/**
 * Load owned Xbox games list (normalized) from SQLite (P0B).
 */
export const loadOwnedXboxGames = async (
  db: DatabaseSync,
): Promise<Set<string>> => {
  return new Set(listOwnedGameNames(db).map(normalizeGameName));
};

/**
 * Load Game Pass interests (normalized) from SQLite (P0B).
 */
export const loadGamePassInterests = async (
  db: DatabaseSync,
): Promise<Set<string>> => {
  return new Set(listInterestTitles(db).map(normalizeGameName));
};

/**
 * Check if a game is owned on Xbox (not Game Pass)
 */
export const isOwnedOnXbox = async (
  db: DatabaseSync,
  gameName: string,
): Promise<boolean> => {
  const ownedGames = await loadOwnedXboxGames(db);
  return ownedGames.has(normalizeGameName(gameName));
};

/**
 * Check if a game is in interests list
 */
export const isInInterests = async (
  db: DatabaseSync,
  gameName: string,
): Promise<boolean> => {
  const interests = await loadGamePassInterests(db);
  return interests.has(normalizeGameName(gameName));
};

/**
 * Check if a game is available on Game Pass catalog
 */
export const isAvailableOnGamePass = async (
  gameName: string,
  gamePassCatalog: GamePassGame[],
): Promise<boolean> => {
  const normalizedName = normalizeGameName(gameName);
  return gamePassCatalog.some(
    game =>
      game.available &&
      catalogMatchesInterest(normalizeGameName(game.title), normalizedName),
  );
};

/**
 * Load unavailable games report
 */
export const loadUnavailableGames = async (): Promise<GamePassUnavailable> => {
  try {
    const content = await fs.readFile(UNAVAILABLE_FILE, 'utf-8');
    return JSON.parse(content);
  } catch (error) {
    return {
      unavailableGames: [],
      lastUpdated: null,
    };
  }
};

/**
 * Save unavailable games report
 */
export const saveUnavailableGames = async (
  unavailable: UnavailableGame[],
): Promise<void> => {
  const data: GamePassUnavailable = {
    unavailableGames: unavailable,
    lastUpdated: new Date().toISOString(),
  };

  await fs.writeFile(UNAVAILABLE_FILE, JSON.stringify(data, null, 2));
  log.info(
    `📝 Updated unavailable games report: ${unavailable.length} games`,
  );
};

/**
 * Process Game Pass availability and update unavailable games report
 */
export const processGamePassAvailability = async (
  db: DatabaseSync,
  playedGames: RawGameData[],
  gamePassCatalog: GamePassGame[],
): Promise<{
  unavailable: UnavailableGame[];
  returned: string[];
}> => {
  const ownedXbox = await loadOwnedXboxGames(db);
  const interests = await loadGamePassInterests(db);
  const currentUnavailable = await loadUnavailableGames();

  const unavailableGames: UnavailableGame[] = [];
  const returnedGames: string[] = [];
  const catalogNames = new Set(
    gamePassCatalog
      .filter(g => g.available)
      .map(g => normalizeGameName(g.title)),
  );

  // Check played Xbox games not owned
  for (const game of playedGames) {
    if (game.source !== 'xbox') continue;

    const normalizedName = normalizeGameName(game.name);
    const isOwned = ownedXbox.has(normalizedName);
    const inCatalog = catalogNames.has(normalizedName);

    if (!isOwned && !inCatalog) {
      unavailableGames.push({
        name: game.name,
        reason: 'left-catalog',
        lastSeen: new Date().toISOString(),
        wasPlayed: true,
      });
    }
  }

  // Check interests
  for (const gameName of interests) {
    const inCatalog = Array.from(catalogNames).some(catalogName =>
      catalogMatchesInterest(catalogName, gameName),
    );

    if (!inCatalog) {
      unavailableGames.push({
        name: gameName,
        reason: 'interest-unavailable',
        lastSeen: new Date().toISOString(),
        wasPlayed: false,
      });
    } else {
      // Check if this game was previously unavailable and has now returned
      const wasUnavailable = currentUnavailable.unavailableGames.find(
        u => normalizeGameName(u.name) === gameName,
      );
      if (wasUnavailable) {
        returnedGames.push(gameName);
      }
    }
  }

  return {
    unavailable: unavailableGames,
    returned: returnedGames,
  };
};

/**
 * Determine correct source tag for Xbox/Game Pass games
 */
export const resolveXboxSource = async (
  db: DatabaseSync,
  gameName: string,
  gamePassCatalog: GamePassGame[],
): Promise<'xbox' | 'gamepass'> => {
  const isOwned = await isOwnedOnXbox(db, gameName);

  if (isOwned) {
    return 'xbox';
  }

  const isAvailable = await isAvailableOnGamePass(gameName, gamePassCatalog);
  return isAvailable ? 'gamepass' : 'xbox';
};

/**
 * Check if a game should be synced to Notion
 */
export const shouldSyncToNotion = async (
  db: DatabaseSync,
  game: RawGameData,
  gamePassCatalog: GamePassGame[],
): Promise<boolean> => {
  // Non-Xbox/GamePass games always sync
  if (game.source !== 'xbox' && game.source !== 'gamepass') {
    return true;
  }

  const isOwned = await isOwnedOnXbox(db, game.name);

  // Owned Xbox games always sync
  if (isOwned) {
    return true;
  }

  // Not owned - must be available on Game Pass to sync
  const isAvailable = await isAvailableOnGamePass(game.name, gamePassCatalog);
  return isAvailable;
};

/**
 * Pick interest games that should be synced. Matching is id-equality first
 * (P0B §6 — a non-manual catalog product id must match the catalog's id,
 * which kills the swapped-title bug class), with the word-sorted name
 * fallback for legacy `manual:` rows that have no catalog id. Pure — no
 * file access.
 */
export const selectInterestGames = async (
  entries: InterestEntry[],
  gamePassCatalog: GamePassGame[],
  playedGames: RawGameData[],
): Promise<RawGameData[]> => {
  const playedNames = new Set(playedGames.map(g => normalizeGameName(g.name)));
  const gamesToSync: RawGameData[] = [];
  const seenNormalized = new Set<string>(); // deduplicate interests that normalize identically

  for (const entry of entries) {
    const interestName = normalizeGameName(entry.title);
    if (seenNormalized.has(interestName)) continue;
    seenNormalized.add(interestName);

    // Id-equality first for catalog-backed rows; manual: ids never match
    let catalogGame: GamePassGame | undefined;
    if (!entry.id.startsWith('manual:')) {
      catalogGame = gamePassCatalog.find(
        g => g.available && g.id === entry.id,
      );
    }
    if (!catalogGame) {
      catalogGame = gamePassCatalog.find(
        g =>
          g.available &&
          catalogMatchesInterest(normalizeGameName(g.title), interestName),
      );
    }
    if (!catalogGame) continue;

    // Check if already played
    const wasPlayed = playedNames.has(interestName);

    // Use the user's clean interest name (not the verbose catalog title)
    gamesToSync.push({
      name: entry.title,
      source: 'gamepass',
      externalId: `gamepass-interest-${catalogGame.id}`,
      playtimeHours: wasPlayed ? undefined : 0,
      coverImageUrl: catalogGame.coverImageUrl,
      description: catalogGame.description,
      genres: catalogGame.genres,
      developer: catalogGame.developer,
      publisher: catalogGame.publisher,
      screenshots: catalogGame.screenshotUrls?.length
        ? { ms: catalogGame.screenshotUrls }
        : undefined,
    });
  }

  return gamesToSync;
};

/**
 * Get games from interests that should be synced
 */
export const getInterestGamesToSync = async (
  db: DatabaseSync,
  gamePassCatalog: GamePassGame[],
  playedGames: RawGameData[],
): Promise<RawGameData[]> => {
  const entries = listInterestEntries(db);
  return selectInterestGames(entries, gamePassCatalog, playedGames);
};
