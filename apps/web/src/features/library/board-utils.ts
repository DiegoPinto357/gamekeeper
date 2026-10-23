import type { LibraryGame, LibraryResponse } from '@gamekeeper/shared';

export const BACKLOG_KEY = 'backlog';

export type BoardFilters = {
  q: string;
  source: string;
};

export type NeighborIds = {
  beforeId: string | null;
  afterId: string | null;
};

export type DropTarget =
  | { kind: 'column'; status: string }
  | { kind: 'card'; id: string };

export type MoveRequest = NeighborIds & {
  id: string;
  status: string;
};

export type GroupedGames = Record<string, LibraryGame[]>;

export const groupGames = (games: LibraryGame[]): GroupedGames => {
  const groups: GroupedGames = {};
  for (const game of games) {
    const key = game.status ?? BACKLOG_KEY;
    (groups[key] ??= []).push(game);
  }
  return groups;
};

export const applyFilters = (
  games: LibraryGame[],
  filters: BoardFilters,
): LibraryGame[] => {
  const q = filters.q.trim().toLowerCase();
  return games.filter(game => {
    if (q && !game.name.toLowerCase().includes(q)) return false;
    if (
      filters.source &&
      game.primarySource !== filters.source &&
      !game.ownedSources.includes(filters.source)
    ) {
      return false;
    }
    return true;
  });
};

export const sourceOptions = (games: LibraryGame[]): string[] => {
  const sources = new Set<string>();
  for (const game of games) {
    sources.add(game.primarySource);
    for (const source of game.ownedSources) sources.add(source);
  }
  return [...sources].sort();
};

const withoutId = (games: LibraryGame[], id: string): LibraryGame[] =>
  games.filter(game => game.canonicalId !== id);

const findGroup = (
  groups: GroupedGames,
  id: string,
): { status: string; list: LibraryGame[]; index: number } | null => {
  for (const [status, list] of Object.entries(groups)) {
    const index = list.findIndex(game => game.canonicalId === id);
    if (index !== -1) return { status, list, index };
  }
  return null;
};

export const resolveDrop = (
  groups: GroupedGames,
  activeId: string,
  over: DropTarget,
): (NeighborIds & { status: string }) | null => {
  const active = findGroup(groups, activeId);
  if (!active) return null;

  if (over.kind === 'column') {
    const columnList = groups[over.status] ?? [];
    const target = withoutId(columnList, activeId);
    const wasLast =
      over.status === active.status && active.index === active.list.length - 1;
    if (wasLast) return null;
    return {
      status: over.status,
      beforeId: target.at(-1)?.canonicalId ?? null,
      afterId: null,
    };
  }

  if (over.id === activeId) return null;
  const overIn = findGroup(groups, over.id);
  if (!overIn) return null;

  const sameColumn = overIn.status === active.status;
  const target = withoutId(overIn.list, activeId);
  const overIndex = target.findIndex(game => game.canonicalId === over.id);
  if (overIndex === -1) return null;

  if (sameColumn && active.index < overIn.index) {
    // moving down: land after the over card
    return {
      status: overIn.status,
      beforeId: over.id,
      afterId: target[overIndex + 1]?.canonicalId ?? null,
    };
  }
  // cross-column or moving up: land before the over card
  return {
    status: overIn.status,
    beforeId: target[overIndex - 1]?.canonicalId ?? null,
    afterId: over.id,
  };
};

export const moveToEndNeighbors = (
  groups: GroupedGames,
  activeStatus: string,
  targetStatus: string,
): NeighborIds | null => {
  if (activeStatus === targetStatus) return null;
  const target = groups[targetStatus] ?? [];
  return { beforeId: target.at(-1)?.canonicalId ?? null, afterId: null };
};

const estimatePosition = (
  games: LibraryGame[],
  { beforeId, afterId }: NeighborIds,
): number | null => {
  const beforePos =
    beforeId != null
      ? (games.find(game => game.canonicalId === beforeId)?.position ?? null)
      : null;
  const afterPos =
    afterId != null
      ? (games.find(game => game.canonicalId === afterId)?.position ?? null)
      : null;

  if (beforeId != null && afterId != null) {
    if (beforePos == null || afterPos == null) return null;
    return (beforePos + afterPos) / 2;
  }
  if (beforeId != null) return beforePos != null ? beforePos + 1 : null;
  if (afterId != null) return afterPos != null ? afterPos - 1 : null;
  return 1;
};

export const applyMove = (
  data: LibraryResponse,
  { id, status, beforeId, afterId }: MoveRequest,
): LibraryResponse => {
  const index = data.games.findIndex(game => game.canonicalId === id);
  if (index === -1) return data;

  const moved: LibraryGame = {
    ...data.games[index],
    status,
    position: estimatePosition(data.games, { beforeId, afterId }),
    pinned: true,
  };
  const rest = data.games.filter((_, i) => i !== index);

  let insertAt = rest.length;
  if (beforeId != null) {
    const anchor = rest.findIndex(game => game.canonicalId === beforeId);
    insertAt = anchor !== -1 ? anchor + 1 : rest.length;
  } else if (afterId != null) {
    const anchor = rest.findIndex(game => game.canonicalId === afterId);
    insertAt = anchor !== -1 ? anchor : rest.length;
  }

  const games = [...rest];
  games.splice(insertAt, 0, moved);
  return { ...data, games };
};
