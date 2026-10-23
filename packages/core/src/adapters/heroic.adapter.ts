import fs from 'fs/promises';
import path from 'path';
import { type RawGameData, type Source } from '../types/game';
import { log } from '../logger';

/**
 * Minimal shape of a game entry from Heroic store cache files
 */
type HeroicGame = {
  app_name: string;
  title: string;
  runner: string;
  art_cover?: string;
  developer?: string;
  description?: string;
  install?: { is_dlc?: boolean };
  extra?: {
    genres?: string[];
    releaseDate?: string;
    about?: { description?: string };
  };
};

/**
 * Richer per-game metadata from Heroic's gog_api_info.json cache
 * (keyed `gog_<app_name>`; timestamp keys interleaved).
 */
type GogApiEntry = {
  first_release_date?: string;
  game?: {
    genres?: Array<{ name?: unknown }>;
    developers?: Array<{ name?: string }>;
    publishers?: Array<{ name?: string }>;
  };
};

const localizedName = (name: unknown): string | undefined => {
  if (typeof name === 'string') return name || undefined;
  if (name && typeof name === 'object') {
    const names = name as Record<string, string>;
    return names['*'] ?? names['en-US'] ?? Object.values(names)[0];
  }
  return undefined;
};

const mapHeroicGame = (
  game: HeroicGame,
  source: Source,
  gogApi?: GogApiEntry,
): RawGameData => {
  const apiGame = gogApi?.game;
  const apiGenres = apiGame?.genres
    ?.map(g => localizedName(g.name))
    .filter((n): n is string => n != null);
  const genres =
    apiGenres?.length
      ? apiGenres
      : game.extra?.genres?.length
        ? game.extra.genres
        : undefined;
  const releaseIso = gogApi?.first_release_date ?? game.extra?.releaseDate;

  return {
    source,
    externalId: game.app_name,
    name: game.title,
    coverImageUrl: game.art_cover,
    genres: genres?.length ? genres : undefined,
    releaseDate: releaseIso ? new Date(releaseIso) : undefined,
    description: game.extra?.about?.description ?? game.description,
    developer: apiGame?.developers?.[0]?.name ?? game.developer,
    publisher: apiGame?.publishers?.[0]?.name,
  };
};

const loadLibraryFile = async (
  filePath: string,
  rootKey: string,
  source: Source,
  filterDlc: boolean,
  gogApiById?: Map<string, GogApiEntry>,
): Promise<RawGameData[]> => {
  try {
    const content = await fs.readFile(filePath, 'utf-8');
    const data = JSON.parse(content);
    const games: HeroicGame[] = data[rootKey];

    if (!Array.isArray(games)) {
      log.warn(`⚠️  Unexpected format in ${filePath}`);
      return [];
    }

    const filtered = filterDlc ? games.filter(g => !g.install?.is_dlc) : games;

    const mapped = filtered.map(g =>
      mapHeroicGame(g, source, gogApiById?.get(g.app_name)),
    );
    log.info(`  ✅ ${source.toUpperCase()}: ${mapped.length} games`);
    return mapped;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      log.warn(`  ⚠️  Heroic ${source} library not found: ${filePath}`);
      return [];
    }
    throw new Error(`Failed to load Heroic ${source} library: ${error}`);
  }
};

/**
 * Load gog_api_info.json (rich GOG metadata cache) keyed by app_name.
 * Timestamp keys and malformed entries are skipped; file absence is fine.
 */
const loadGogApiInfo = async (
  storeCachePath: string,
): Promise<Map<string, GogApiEntry>> => {
  const map = new Map<string, GogApiEntry>();
  try {
    const content = await fs.readFile(
      path.join(storeCachePath, 'gog_api_info.json'),
      'utf-8',
    );
    const data = JSON.parse(content) as Record<string, unknown>;
    for (const [key, value] of Object.entries(data)) {
      if (!key.startsWith('gog_') || typeof value !== 'object' || value === null)
        continue;
      map.set(key.slice('gog_'.length), value as GogApiEntry);
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      log.warn(`⚠️  Could not load gog_api_info.json: ${error}`);
    }
  }
  return map;
};

const loadAllLibraries = async (
  storeCachePath: string,
): Promise<RawGameData[]> => {
  log.info('📦 Loading Heroic libraries...');

  const gogApiById = await loadGogApiInfo(storeCachePath);

  const [gog, epic, amazon] = await Promise.all([
    loadLibraryFile(
      path.join(storeCachePath, 'gog_library.json'),
      'games',
      'gog',
      true,
      gogApiById,
    ),
    loadLibraryFile(
      path.join(storeCachePath, 'legendary_library.json'),
      'library',
      'epic',
      true,
    ),
    loadLibraryFile(
      path.join(storeCachePath, 'nile_library.json'),
      'library',
      'amazon',
      false,
    ),
  ]);

  const all = [...gog, ...epic, ...amazon];
  log.info(
    `✅ Heroic: ${all.length} games (GOG: ${gog.length}, Epic: ${epic.length}, Amazon: ${amazon.length})\n`,
  );
  return all;
};

export const heroicAdapter = {
  loadAllLibraries,
};
