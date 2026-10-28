import { describe, it, expect } from 'vitest';
import { gameLinks } from './game-links';

describe('gameLinks', () => {
  it('links the exact Steam page and ProtonDB when the app id is known', () => {
    const links = gameLinks({
      name: 'Hades II',
      ownedSources: ['steam'],
      steamAppId: 1145350,
    });
    expect(links).toEqual([
      { key: 'steam', label: 'Steam', href: 'https://store.steampowered.com/app/1145350' },
      { key: 'protondb', label: 'ProtonDB', href: 'https://www.protondb.com/app/1145350' },
    ]);
  });

  it('falls back to Steam search when steam is owned but has no app id', () => {
    const links = gameLinks({ name: 'Half-Life', ownedSources: ['steam'] });
    expect(links).toEqual([
      {
        key: 'steam',
        label: 'Steam',
        href: 'https://store.steampowered.com/search/?term=Half-Life',
      },
    ]);
  });

  it('picks the highest-precedence owned store (epic over gog)', () => {
    const links = gameLinks({ name: 'Celeste', ownedSources: ['gog', 'epic'] });
    expect(links).toEqual([
      {
        key: 'epic',
        label: 'Epic Games',
        href: 'https://store.epicgames.com/en-US/browse?q=Celeste',
      },
    ]);
  });

  it('prefers xbox/gamepass over lower-priority stores', () => {
    const links = gameLinks({ name: 'Hi-Fi Rush', ownedSources: ['epic', 'gog', 'gamepass'] });
    expect(links).toEqual([
      { key: 'gamepass', label: 'Game Pass', href: 'https://www.xbox.com/en-US/search?q=Hi-Fi%20Rush' },
    ]);
  });

  it('prefers steam (exact) over other owned stores when the app id is known', () => {
    const links = gameLinks({
      name: 'The Witcher 3',
      ownedSources: ['gog', 'steam'],
      steamAppId: 292030,
    });
    expect(links[0]).toEqual({
      key: 'steam',
      label: 'Steam',
      href: 'https://store.steampowered.com/app/292030',
    });
  });

  it('builds GOG and Amazon search links', () => {
    expect(gameLinks({ name: 'Disco Elysium', ownedSources: ['gog'] })).toEqual([
      {
        key: 'gog',
        label: 'GOG',
        href: 'https://www.gog.com/en/games?query=Disco%20Elysium',
      },
    ]);
    expect(gameLinks({ name: 'Fallout 76', ownedSources: ['amazon'] })).toEqual([
      {
        key: 'amazon',
        label: 'Amazon',
        href: 'https://www.amazon.com/s?k=Fallout%2076&i=videogames',
      },
    ]);
  });

  it('encodes names with reserved characters', () => {
    const links = gameLinks({ name: 'The Witcher 3: Wild Hunt', ownedSources: ['steam'] });
    expect(links[0].href).toContain(encodeURIComponent('The Witcher 3: Wild Hunt'));
  });

  it('returns no links for manual-only or empty sources', () => {
    expect(gameLinks({ name: 'Hades', ownedSources: ['manual'] })).toEqual([]);
    expect(gameLinks({ name: 'Hades', ownedSources: [] })).toEqual([]);
  });

  it('still links Steam + ProtonDB when no sources are recorded but the app id is', () => {
    const links = gameLinks({ name: 'Portal', ownedSources: [], steamAppId: 400 });
    expect(links.map(link => link.key)).toEqual(['steam', 'protondb']);
  });
});
