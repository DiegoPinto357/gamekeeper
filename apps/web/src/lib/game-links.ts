import { PLATFORM_PRIORITY, type Source } from '@gamekeeper/shared';

export type GameLink = {
  key: Source | 'protondb';
  label: string;
  href: string;
};

const STORE_LABEL: Record<Exclude<Source, 'manual'>, string> = {
  steam: 'Steam',
  xbox: 'Xbox',
  gamepass: 'Game Pass',
  epic: 'Epic Games',
  gog: 'GOG',
  amazon: 'Amazon',
};

/** Search URLs land on the store's own results — never a 404 (no product ids in the DB). */
const searchUrl: Record<Exclude<Source, 'manual'>, (name: string) => string> = {
  steam: name => `https://store.steampowered.com/search/?term=${encodeURIComponent(name)}`,
  xbox: name => `https://www.xbox.com/en-US/search?q=${encodeURIComponent(name)}`,
  gamepass: name => `https://www.xbox.com/en-US/search?q=${encodeURIComponent(name)}`,
  epic: name => `https://store.epicgames.com/en-US/browse?q=${encodeURIComponent(name)}`,
  gog: name => `https://www.gog.com/en/games?query=${encodeURIComponent(name)}`,
  amazon: name => `https://www.amazon.com/s?k=${encodeURIComponent(name)}&i=videogames`,
};

export const gameLinks = (
  game: { name: string; ownedSources: string[]; steamAppId?: number },
): GameLink[] => {
  const links: GameLink[] = [];

  const sources = [...new Set(game.ownedSources)] as Source[];
  // a known app id means Steam is playable regardless of recorded ownership
  if (game.steamAppId != null && !sources.includes('steam')) sources.push('steam');

  const store = sources
    .filter((source): source is Exclude<Source, 'manual'> => source !== 'manual')
    .sort((a, b) => PLATFORM_PRIORITY[a] - PLATFORM_PRIORITY[b])[0];

  if (store) {
    links.push({
      key: store,
      label: STORE_LABEL[store],
      href:
        store === 'steam' && game.steamAppId != null
          ? `https://store.steampowered.com/app/${game.steamAppId}`
          : searchUrl[store](game.name),
    });
  }
  if (game.steamAppId != null) {
    links.push({
      key: 'protondb',
      label: 'ProtonDB',
      href: `https://www.protondb.com/app/${game.steamAppId}`,
    });
  }

  return links;
};
