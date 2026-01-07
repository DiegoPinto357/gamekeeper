import fs from 'fs/promises';
import path from 'path';
import { RawGameData } from '../types/game';
import { normalizeGameName } from './normalize';
import { GamePassGame } from '../adapters/gamepass.adapter';

export type OwnedXboxGames = {
  ownedGames: string[];
};

export type GamePassInterests = {
  wantToPlay: string[];
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
const OWNED_XBOX_FILE = path.join(DATA_DIR, 'owned-xbox-games.json');
const INTERESTS_FILE = path.join(DATA_DIR, 'gamepass-interests.json');
const UNAVAILABLE_FILE = path.join(DATA_DIR, 'gamepass-unavailable.json');

/**
 * Load owned Xbox games list
 */
export const loadOwnedXboxGames = async (): Promise<Set<string>> => {
  try {
    const content = await fs.readFile(OWNED_XBOX_FILE, 'utf-8');
    const data: OwnedXboxGames = JSON.parse(content);
    return new Set(data.ownedGames.map(normalizeGameName));
  } catch (error) {
    console.warn('Could not load owned Xbox games, using empty set');
    return new Set();
  }
};

/**
 * Load Game Pass interests
 */
export const loadGamePassInterests = async (): Promise<Set<string>> => {
  try {
    const content = await fs.readFile(INTERESTS_FILE, 'utf-8');
    const data: GamePassInterests = JSON.parse(content);
    return new Set(data.wantToPlay.map(normalizeGameName));
  } catch (error) {
    console.warn('Could not load Game Pass interests, using empty set');
    return new Set();
  }
};

/**
 * Check if a game is owned on Xbox (not Game Pass)
 */
export const isOwnedOnXbox = async (gameName: string): Promise<boolean> => {
  const ownedGames = await loadOwnedXboxGames();
  return ownedGames.has(normalizeGameName(gameName));
};

/**
 * Check if a game is in interests list
 */
export const isInInterests = async (gameName: string): Promise<boolean> => {
  const interests = await loadGamePassInterests();
  return interests.has(normalizeGameName(gameName));
};

/**
 * Check if a game is available on Game Pass catalog
 */
export const isAvailableOnGamePass = async (
  gameName: string,
  gamePassCatalog: GamePassGame[]
): Promise<boolean> => {
  const normalizedName = normalizeGameName(gameName);
  return gamePassCatalog.some(
    game => game.available && normalizeGameName(game.title) === normalizedName
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
  unavailable: UnavailableGame[]
): Promise<void> => {
  const data: GamePassUnavailable = {
    unavailableGames: unavailable,
    lastUpdated: new Date().toISOString(),
  };

  await fs.writeFile(UNAVAILABLE_FILE, JSON.stringify(data, null, 2));
  console.log(
    `📝 Updated unavailable games report: ${unavailable.length} games`
  );
};

/**
 * Process Game Pass availability and update unavailable games report
 */
export const processGamePassAvailability = async (
  playedGames: RawGameData[],
  gamePassCatalog: GamePassGame[]
): Promise<{
  unavailable: UnavailableGame[];
  returned: string[];
}> => {
  const ownedXbox = await loadOwnedXboxGames();
  const interests = await loadGamePassInterests();
  const currentUnavailable = await loadUnavailableGames();

  const unavailableGames: UnavailableGame[] = [];
  const returnedGames: string[] = [];
  const catalogNames = new Set(
    gamePassCatalog
      .filter(g => g.available)
      .map(g => normalizeGameName(g.title))
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
    const inCatalog = Array.from(catalogNames).some(
      catalogName => catalogName === gameName
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
        u => normalizeGameName(u.name) === gameName
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
  gameName: string,
  gamePassCatalog: GamePassGame[]
): Promise<'xbox' | 'gamepass'> => {
  const isOwned = await isOwnedOnXbox(gameName);

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
  game: RawGameData,
  gamePassCatalog: GamePassGame[]
): Promise<boolean> => {
  // Non-Xbox/GamePass games always sync
  if (game.source !== 'xbox' && game.source !== 'gamepass') {
    return true;
  }

  const isOwned = await isOwnedOnXbox(game.name);

  // Owned Xbox games always sync
  if (isOwned) {
    return true;
  }

  // Not owned - must be available on Game Pass to sync
  const isAvailable = await isAvailableOnGamePass(game.name, gamePassCatalog);
  return isAvailable;
};

/**
 * Get games from interests that should be synced
 */
export const getInterestGamesToSync = async (
  gamePassCatalog: GamePassGame[],
  playedGames: RawGameData[]
): Promise<RawGameData[]> => {
  const interests = await loadGamePassInterests();
  const playedNames = new Set(playedGames.map(g => normalizeGameName(g.name)));
  const gamesToSync: RawGameData[] = [];

  for (const interestName of interests) {
    // Check if available on Game Pass
    const catalogGame = gamePassCatalog.find(
      g => g.available && normalizeGameName(g.title) === interestName
    );

    if (!catalogGame) continue;

    // Check if already played
    const wasPlayed = playedNames.has(interestName);

    // Create game entry
    gamesToSync.push({
      name: catalogGame.title,
      source: 'gamepass',
      externalId: `gamepass-interest-${catalogGame.id}`,
      playtimeHours: wasPlayed ? undefined : 0,
    });
  }

  return gamesToSync;
};
