import { describe, it, expect } from 'vitest';
import type { LibraryGame, LibraryResponse, StatusEntry } from '@gamekeeper/shared';
import {
  groupGames,
  applyFilters,
  sourceOptions,
  resolveDrop,
  moveToEndNeighbors,
  applyMove,
} from './board-utils';

const statuses: StatusEntry[] = [
  { key: 'backlog', label: 'Backlog', color: '#64748b', position: 0 },
  { key: 'want_to_play', label: 'Want to Play', color: '#eab308', position: 1 },
  { key: 'playing', label: 'Playing', color: '#22c55e', position: 5 },
];

const g = (
  canonicalId: string,
  name: string,
  status: string | null = null,
  position: number | null = null,
  extra: Partial<LibraryGame> = {},
): LibraryGame => ({
  canonicalId,
  name,
  primarySource: 'steam',
  ownedSources: ['steam'],
  status,
  position,
  ...extra,
});

const ids = (games: LibraryGame[] | undefined) =>
  (games ?? []).map(game => game.canonicalId);

describe('groupGames', () => {
  it('groups by status, null → backlog, preserving payload order', () => {
    const groups = groupGames([
      g('a', 'A'),
      g('b', 'B', 'playing', 1),
      g('c', 'C'),
      g('d', 'D', 'playing', 2),
    ]);
    expect(ids(groups.backlog)).toEqual(['a', 'c']);
    expect(ids(groups.playing)).toEqual(['b', 'd']);
    expect(groups.want_to_play).toBeUndefined();
  });
});

describe('applyFilters', () => {
  const games = [
    g('a', 'Hades II'),
    g('b', 'Celeste', 'playing', 1),
    g('c', 'Hollow Knight', 'completed', 1, {
      primarySource: 'gog',
      ownedSources: ['gog', 'steam'],
    }),
  ];

  it('filters by name case-insensitively', () => {
    expect(ids(applyFilters(games, { q: 'hade', source: '' }))).toEqual(['a']);
    expect(ids(applyFilters(games, { q: '  ', source: '' }))).toEqual(['a', 'b', 'c']);
  });

  it('filters by source against primary or owned sources', () => {
    expect(ids(applyFilters(games, { q: '', source: 'gog' }))).toEqual(['c']);
    expect(ids(applyFilters(games, { q: '', source: 'steam' }))).toEqual(['a', 'b', 'c']);
    expect(ids(applyFilters(games, { q: '', source: '' }))).toEqual(['a', 'b', 'c']);
  });
});

describe('sourceOptions', () => {
  it('returns sorted unique sources across primary and owned', () => {
    const options = sourceOptions([
      g('a', 'A', null, null, { primarySource: 'xbox', ownedSources: ['xbox', 'steam'] }),
      g('b', 'B', null, null, { primarySource: 'gog', ownedSources: ['gog'] }),
    ]);
    expect(options).toEqual(['gog', 'steam', 'xbox']);
  });
});

describe('resolveDrop', () => {
  const groups = groupGames([
    g('a', 'A', null, 1),
    g('b', 'B', null, 2),
    g('c', 'C', null, 3),
    g('d', 'D', 'playing', 1),
  ]);

  it('drops onto another column: appends to the end of that column', () => {
    expect(resolveDrop(groups, 'a', { kind: 'column', status: 'playing' })).toEqual({
      status: 'playing',
      beforeId: 'd',
      afterId: null,
    });
  });

  it('drops onto an empty column: no neighbors', () => {
    expect(resolveDrop(groups, 'a', { kind: 'column', status: 'want_to_play' })).toEqual({
      status: 'want_to_play',
      beforeId: null,
      afterId: null,
    });
  });

  it('drops onto a card in another column: inserts before that card', () => {
    expect(resolveDrop(groups, 'a', { kind: 'card', id: 'd' })).toEqual({
      status: 'playing',
      beforeId: null,
      afterId: 'd',
    });
  });

  it('reorders down within a column: inserts after the over card', () => {
    expect(resolveDrop(groups, 'a', { kind: 'card', id: 'c' })).toEqual({
      status: 'backlog',
      beforeId: 'c',
      afterId: null,
    });
  });

  it('reorders up within a column: inserts before the over card', () => {
    expect(resolveDrop(groups, 'c', { kind: 'card', id: 'a' })).toEqual({
      status: 'backlog',
      beforeId: null,
      afterId: 'a',
    });
  });

  it('is a no-op when dropped on itself', () => {
    expect(resolveDrop(groups, 'a', { kind: 'card', id: 'a' })).toBeNull();
  });

  it('is a no-op when dropped on its own column body while already last', () => {
    expect(resolveDrop(groups, 'c', { kind: 'column', status: 'backlog' })).toBeNull();
  });

  it('appends within its own column when not last', () => {
    expect(resolveDrop(groups, 'a', { kind: 'column', status: 'backlog' })).toEqual({
      status: 'backlog',
      beforeId: 'c',
      afterId: null,
    });
  });
});

describe('moveToEndNeighbors', () => {
  const groups = groupGames([
    g('a', 'A'),
    g('b', 'B'),
    g('d', 'D', 'playing', 1),
  ]);

  it('targets the end of another column', () => {
    expect(moveToEndNeighbors(groups, 'backlog', 'playing')).toEqual({
      beforeId: 'd',
      afterId: null,
    });
  });

  it('returns null when already in the target column', () => {
    expect(moveToEndNeighbors(groups, 'backlog', 'backlog')).toBeNull();
  });

  it('returns no neighbors for an empty target column', () => {
    expect(moveToEndNeighbors(groups, 'backlog', 'queued_to_play')).toEqual({
      beforeId: null,
      afterId: null,
    });
  });
});

describe('applyMove', () => {
  const base: LibraryResponse = {
    statuses,
    games: [
      g('a', 'A', null, 1),
      g('b', 'B', 'playing', 1),
      g('c', 'C', null, 2),
    ],
  };

  it('appends (beforeId only): moves after the anchor and updates status', () => {
    const next = applyMove(base, {
      id: 'a',
      status: 'playing',
      beforeId: 'b',
      afterId: null,
    });
    const groups = groupGames(next.games);
    expect(ids(groups.backlog)).toEqual(['c']);
    expect(ids(groups.playing)).toEqual(['b', 'a']);
    expect(next.games.find(game => game.canonicalId === 'a')).toMatchObject({
      status: 'playing',
      position: 2,
    });
  });

  it('prepends (afterId only): moves before the anchor', () => {
    const next = applyMove(base, {
      id: 'c',
      status: 'playing',
      beforeId: null,
      afterId: 'b',
    });
    expect(ids(groupGames(next.games).playing)).toEqual(['c', 'b']);
  });

  it('inserts between neighbors and estimates the midpoint position', () => {
    const withTwo: LibraryResponse = {
      statuses,
      games: [
        g('a', 'A', null, 1),
        g('b', 'B', 'playing', 1),
        g('e', 'E', 'playing', 3),
        g('c', 'C', null, 2),
      ],
    };
    const next = applyMove(withTwo, {
      id: 'c',
      status: 'playing',
      beforeId: 'b',
      afterId: 'e',
    });
    expect(ids(groupGames(next.games).playing)).toEqual(['b', 'c', 'e']);
    expect(next.games.find(game => game.canonicalId === 'c')).toMatchObject({
      status: 'playing',
      position: 2,
    });
  });

  it('inserts at the end of an empty column with no neighbors', () => {
    const next = applyMove(base, {
      id: 'a',
      status: 'queued_to_play',
      beforeId: null,
      afterId: null,
    });
    expect(ids(groupGames(next.games).queued_to_play)).toEqual(['a']);
    expect(next.games.find(game => game.canonicalId === 'a')).toMatchObject({
      position: 1,
    });
  });

  it('leaves position null when neighbor positions are unknown (unmaterialized backlog)', () => {
    const unmaterialized: LibraryResponse = {
      statuses,
      games: [
        g('a', 'A'),
        g('c', 'C'),
        g('b', 'B', 'playing', 4),
      ],
    };
    const next = applyMove(unmaterialized, {
      id: 'b',
      status: 'backlog',
      beforeId: 'a',
      afterId: 'c',
    });
    expect(next.games.find(game => game.canonicalId === 'b')).toMatchObject({
      status: 'backlog',
      position: null,
    });
    expect(ids(groupGames(next.games).backlog)).toEqual(['a', 'b', 'c']);
  });

  it('does not mutate the input', () => {
    const before = JSON.stringify(base);
    applyMove(base, { id: 'a', status: 'playing', beforeId: 'b', afterId: null });
    expect(JSON.stringify(base)).toBe(before);
  });
});
