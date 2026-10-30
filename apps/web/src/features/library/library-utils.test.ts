import { describe, it, expect } from 'vitest';
import type { DiscoverGame } from '@gamekeeper/shared';
import {
  EMPTY_SELECTION,
  hasActiveFilters,
  parseSelection,
  selectionToQueryString,
  sortGames,
  toggleInList,
  type LibrarySelection,
} from './library-utils';

const selection = (overrides: Partial<LibrarySelection> = {}): LibrarySelection => ({
  ...EMPTY_SELECTION,
  ...overrides,
});

describe('toggleInList', () => {
  it('adds a missing value and removes a present one', () => {
    expect(toggleInList(['Action'], 'Roguelike')).toEqual(['Action', 'Roguelike']);
    expect(toggleInList(['Action', 'Roguelike'], 'Action')).toEqual(['Roguelike']);
  });
});

describe('parseSelection', () => {
  it('parses no params into the empty selection', () => {
    expect(parseSelection(new URLSearchParams())).toEqual(EMPTY_SELECTION);
  });

  it('parses comma lists and repeated keys for every dimension', () => {
    const params = new URLSearchParams(
      'q=hades&genre=Action,Roguelike&tag=indies&tag=space&source=steam&' +
        'status=playing&deck=verified&proton=gold&year=2024,2018',
    );
    expect(parseSelection(params)).toEqual({
      q: 'hades',
      genres: ['Action', 'Roguelike'],
      tags: ['indies', 'space'],
      sources: ['steam'],
      statuses: ['playing'],
      decks: ['verified'],
      protonTiers: ['gold'],
      years: [2024, 2018],
    });
  });

  it('drops empty segments and non-integer years', () => {
    const params = new URLSearchParams('genre=,,Action,&year=2018.5,,2020');
    expect(parseSelection(params)).toEqual(selection({ genres: ['Action'], years: [2020] }));
  });
});

describe('selectionToQueryString', () => {
  it('omits empty dimensions', () => {
    expect(selectionToQueryString(EMPTY_SELECTION)).toBe('');
    expect(selectionToQueryString(selection({ q: 'celes' }))).toBe('q=celes');
  });

  it('joins each dimension as a comma list', () => {
    const qs = selectionToQueryString(
      selection({
        q: 'indie rpg',
        genres: ['Role-playing', 'Strategy'],
        statuses: ['backlog'],
        years: [2020, 2024],
      }),
    );
    const params = new URLSearchParams(qs);
    expect(params.get('q')).toBe('indie rpg');
    expect(params.get('genre')).toBe('Role-playing,Strategy');
    expect(params.get('status')).toBe('backlog');
    expect(params.get('year')).toBe('2020,2024');
  });

  it('round-trips through parseSelection', () => {
    const original = selection({
      q: 'zelda',
      genres: ['Adventure'],
      tags: ['open world'],
      decks: ['verified', 'playable'],
      protonTiers: ['gold'],
      years: [2017, 2023],
    });
    expect(parseSelection(new URLSearchParams(selectionToQueryString(original)))).toEqual(original);
  });
});

describe('hasActiveFilters', () => {
  it('is false for empty and q-only is still active', () => {
    expect(hasActiveFilters(EMPTY_SELECTION)).toBe(false);
    expect(hasActiveFilters(selection({ q: 'x' }))).toBe(true);
    expect(hasActiveFilters(selection({ years: [2024] }))).toBe(true);
  });
});

describe('sortGames', () => {
  const game = (overrides: Partial<DiscoverGame> & { canonicalId: string; name: string }): DiscoverGame => ({
    primarySource: 'steam',
    ownedSources: ['steam'],
    status: 'backlog',
    genres: [],
    tags: [],
    ...overrides,
  });

  const games = [
    game({ canonicalId: 'b', name: 'celeste', year: 2018, playtimeHours: 3 }),
    game({ canonicalId: 'a', name: 'Hades II', year: 2024, playtimeHours: 12.5 }),
    game({ canonicalId: 'c', name: 'outer wilds' }),
  ];

  it('sorts by name case-insensitively (default)', () => {
    expect(sortGames(games, 'name').map(g => g.name)).toEqual([
      'celeste',
      'Hades II',
      'outer wilds',
    ]);
  });

  it('sorts by year descending with missing years last', () => {
    expect(sortGames(games, 'year').map(g => g.canonicalId)).toEqual(['a', 'b', 'c']);
  });

  it('sorts by playtime descending with unplayed last', () => {
    expect(sortGames(games, 'playtime').map(g => g.canonicalId)).toEqual(['a', 'b', 'c']);
  });
});
