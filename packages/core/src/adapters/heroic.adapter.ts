import fs from 'fs/promises';
import path from 'path';
import { RawGameData, Source } from '../types/game';

/**
 * Minimal shape of a game entry from Heroic store cache files
 */
type HeroicGame = {
  app_name: string;
  title: string;
  runner: string;
  art_cover?: string;
  install?: { is_dlc?: boolean };
  extra?: {
    genres?: string[];
    releaseDate?: string;
  };
};

const mapHeroicGame = (game: HeroicGame, source: Source): RawGameData => ({
  source,
  externalId: game.app_name,
  name: game.title,
  coverImageUrl: game.art_cover,
  genres: game.extra?.genres?.length ? game.extra.genres : undefined,
  releaseDate: game.extra?.releaseDate
    ? new Date(game.extra.releaseDate)
    : undefined,
});

const loadLibraryFile = async (
  filePath: string,
  rootKey: string,
  source: Source,
  filterDlc: boolean,
): Promise<RawGameData[]> => {
  try {
    const content = await fs.readFile(filePath, 'utf-8');
    const data = JSON.parse(content);
    const games: HeroicGame[] = data[rootKey];

    if (!Array.isArray(games)) {
      console.warn(`⚠️  Unexpected format in ${filePath}`);
      return [];
    }

    const filtered = filterDlc ? games.filter(g => !g.install?.is_dlc) : games;

    const mapped = filtered.map(g => mapHeroicGame(g, source));
    console.log(`  ✅ ${source.toUpperCase()}: ${mapped.length} games`);
    return mapped;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      console.warn(`  ⚠️  Heroic ${source} library not found: ${filePath}`);
      return [];
    }
    throw new Error(`Failed to load Heroic ${source} library: ${error}`);
  }
};

const loadAllLibraries = async (
  storeCachePath: string,
): Promise<RawGameData[]> => {
  console.log('📦 Loading Heroic libraries...');

  const [gog, epic, amazon] = await Promise.all([
    loadLibraryFile(
      path.join(storeCachePath, 'gog_library.json'),
      'games',
      'gog',
      true,
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
  console.log(
    `✅ Heroic: ${all.length} games (GOG: ${gog.length}, Epic: ${epic.length}, Amazon: ${amazon.length})\n`,
  );
  return all;
};

export const heroicAdapter = {
  loadAllLibraries,
};
