import type { DatabaseSync } from 'node:sqlite';
import {
  queryGames,
  type DiscoverFilters,
  type DiscoverGame,
} from '../db/repos/discover';

/**
 * P4.3 directed random ("Surprise me" + store-style shelves).
 *
 * Picks come only from these statuses — backlog is the focus, queued/want
 * follow, paused is the "jump back in" tier. playing/trying/recurrent and
 * terminal completed/dropped are never suggested.
 */
export const SUGGEST_STATUSES = [
  'backlog',
  'queued_to_play',
  'want_to_play',
  'paused',
] as const;

const STATUS_WEIGHTS: Record<string, number> = {
  backlog: 5,
  queued_to_play: 4,
  want_to_play: 3,
  paused: 2,
};

/** Gallery size per shelf — hero + 7 more fits one scroll row. */
export const SHELF_SIZE = 8;

/**
 * Recency-weighted genre histogram over completed games: each completion
 * contributes decay = 1 / (1 + ageDays / 90) to its genres, so finishing a
 * roguelike this month outweighs one from three years ago.
 */
export const completedGenreAffinity = (
  db: DatabaseSync,
): Map<string, number> => {
  const rows = db
    .prepare(
      `SELECT gn.name AS genre, gs.updated_at AS updated_at
       FROM game_status gs
       JOIN game_genres gg ON gg.canonical_id = gs.canonical_id
       JOIN genres gn ON gn.id = gg.genre_id
       WHERE gs.status = 'completed'`,
    )
    .all() as { genre: string; updated_at: string }[];

  const now = Date.now();
  const scores = new Map<string, number>();
  for (const row of rows) {
    const parsed = Date.parse(row.updated_at);
    const ageDays = Number.isFinite(parsed)
      ? Math.max(0, (now - parsed) / 86_400_000)
      : 0;
    const decay = 1 / (1 + ageDays / 90);
    scores.set(row.genre, (scores.get(row.genre) ?? 0) + decay);
  }
  return scores;
};

/**
 * Status weight × genre-affinity boost: a candidate sharing genres with
 * recent completions gets up to ×2 (strongest affinity genre), scaling down
 * with age. Ineligible statuses weigh 0 and can never be picked.
 */
export const candidateWeight = (
  game: DiscoverGame,
  affinity: ReadonlyMap<string, number>,
): number => {
  const base = STATUS_WEIGHTS[game.status];
  if (!base) return 0;
  if (affinity.size === 0) return base;
  const max = Math.max(...affinity.values());
  if (max <= 0) return base;
  let best = 0;
  for (const genre of game.genres) {
    const score = affinity.get(genre) ?? 0;
    if (score > best) best = score;
  }
  return base * (1 + best / max);
};

/** Cumulative-weight pick; rng() ∈ [0,1) maps onto the weight distribution. */
export const pickWeighted = <T>(
  items: readonly T[],
  weights: readonly number[],
  rng: () => number,
): T => {
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  let target = rng() * total;
  for (let i = 0; i < items.length; i++) {
    target -= weights[i];
    if (target <= 0) return items[i];
  }
  return items[items.length - 1];
};

const SOURCE_LABELS: Record<string, string> = {
  gamepass: 'Game Pass',
  manual: 'Manual',
};

const sourceLabel = (source: string): string =>
  SOURCE_LABELS[source] ??
  source.charAt(0).toUpperCase() + source.slice(1);

/**
 * Reason chips: status label, "Never played", then every active filter value
 * the pick matches (genre/tag/source/deck/ProtonDB).
 */
export const suggestReasons = (
  game: DiscoverGame,
  filters: DiscoverFilters,
  statusLabels: ReadonlyMap<string, string>,
): string[] => {
  const reasons: string[] = [];
  const push = (reason: string) => {
    if (reason && !reasons.includes(reason)) reasons.push(reason);
  };

  push(statusLabels.get(game.status) ?? game.status.replace(/_/g, ' '));
  if (game.playtimeHours == null || game.playtimeHours <= 0) {
    push('Never played');
  }
  for (const genre of filters.genres ?? []) {
    if (game.genres.includes(genre)) push(genre);
  }
  for (const tag of filters.tags ?? []) {
    if (game.tags.includes(tag)) push(tag);
  }
  for (const source of filters.sources ?? []) {
    if (game.ownedSources.some((owned) => owned === source)) {
      push(sourceLabel(source));
    }
  }
  if (filters.decks?.length && game.deck && filters.decks.includes(game.deck)) {
    push(`Deck ${game.deck}`);
  }
  if (
    filters.protonTiers?.length &&
    game.protonTier &&
    filters.protonTiers.includes(game.protonTier)
  ) {
    push(`ProtonDB ${game.protonTier}`);
  }
  return reasons;
};

export type SuggestPick = {
  game: DiscoverGame;
  reasons: string[];
};

export type SuggestOptions = {
  /** Injected for deterministic tests; defaults to Math.random. */
  rng?: () => number;
  /** Canonical ids already shown ("spin again" excludes the previous pick). */
  exclude?: readonly string[];
};

const statusLabelsFor = (db: DatabaseSync): Map<string, string> => {
  const rows = db
    .prepare('SELECT key, label FROM statuses')
    .all() as { key: string; label: string }[];
  return new Map(rows.map((row) => [row.key, row.label]));
};

/**
 * Weighted-random pick among eligible candidates under the active filters.
 * Returns null when nothing qualifies (empty library, everything excluded,
 * or filters landing only on ineligible statuses).
 */
export const suggestPick = (
  db: DatabaseSync,
  filters: DiscoverFilters = {},
  opts: SuggestOptions = {},
): SuggestPick | null => {
  const rng = opts.rng ?? Math.random;
  const exclude = new Set(opts.exclude ?? []);
  const affinity = completedGenreAffinity(db);

  const candidates = queryGames(db, filters)
    .games.filter((game) => !exclude.has(game.canonicalId))
    .map((game) => ({ game, weight: candidateWeight(game, affinity) }))
    .filter((candidate) => candidate.weight > 0);

  if (candidates.length === 0) return null;

  const game = pickWeighted(
    candidates.map((candidate) => candidate.game),
    candidates.map((candidate) => candidate.weight),
    rng,
  );
  return {
    game,
    reasons: suggestReasons(game, filters, statusLabelsFor(db)),
  };
};

export type SuggestShelf = {
  key: string;
  title: string;
  games: DiscoverGame[];
};

export type ShelfOptions = {
  /** Same seed → same shelves (client reshuffles by passing a new seed). */
  seed?: number;
  /** Games per shelf; defaults to SHELF_SIZE. */
  size?: number;
};

/** mulberry32 — tiny deterministic PRNG seeded from the request. */
const mulberry32 = (seed: number): (() => number) => {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

const shuffle = <T>(items: readonly T[], rng: () => number): T[] => {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
};

/** Weighted sample without replacement — the hero row's composition. */
const weightedSample = (
  pool: readonly DiscoverGame[],
  affinity: ReadonlyMap<string, number>,
  count: number,
  rng: () => number,
): DiscoverGame[] => {
  const remaining = [...pool];
  const picked: DiscoverGame[] = [];
  while (picked.length < count && remaining.length > 0) {
    const weights = remaining.map((game) => candidateWeight(game, affinity));
    const game = pickWeighted(remaining, weights, rng);
    picked.push(game);
    remaining.splice(remaining.indexOf(game), 1);
  }
  return picked;
};

/**
 * Store-style shelves over the eligible pool:
 *
 * 1. "Picked for you" — weighted sample, affinity-boosted (always first)
 * 2. "More <Genre>" — the strongest completed-genre affinity with candidates
 * 3. up to 3 genre shelves — largest buckets, genres + order seeded
 * 4. "Jump back in" (paused) and "Want to play" — when non-empty
 *
 * Tail order is seeded too, so every shuffle reshuffles the whole page.
 */
export const suggestShelves = (
  db: DatabaseSync,
  filters: DiscoverFilters = {},
  opts: ShelfOptions = {},
): SuggestShelf[] => {
  const rng = mulberry32(
    opts.seed ?? Math.floor(Math.random() * 0x7fffffff),
  );
  const size = opts.size ?? SHELF_SIZE;
  const affinity = completedGenreAffinity(db);
  const pool = queryGames(db, filters).games.filter(
    (game) => candidateWeight(game, affinity) > 0,
  );
  if (pool.length === 0) return [];

  const sample = (items: readonly DiscoverGame[]): DiscoverGame[] =>
    shuffle(items, rng).slice(0, size);

  const shelves: SuggestShelf[] = [
    {
      key: 'picked',
      title: 'Picked for you',
      games: weightedSample(pool, affinity, size, rng),
    },
  ];

  let affinityGenre: string | undefined;
  if (affinity.size > 0) {
    const ranked = [...affinity.entries()].sort(
      (a, b) => b[1] - a[1] || a[0].localeCompare(b[0]),
    );
    for (const [genre] of ranked) {
      const bucket = pool.filter((game) => game.genres.includes(genre));
      if (bucket.length > 0) {
        affinityGenre = genre;
        shelves.push({
          key: `genre:${genre}`,
          title: `More ${genre}`,
          games: sample(bucket),
        });
        break;
      }
    }
  }

  const buckets = new Map<string, DiscoverGame[]>();
  for (const game of pool) {
    for (const genre of game.genres) {
      if (genre === affinityGenre) continue;
      const bucket = buckets.get(genre);
      if (bucket) bucket.push(game);
      else buckets.set(genre, [game]);
    }
  }
  const genreShelves = shuffle(
    [...buckets.entries()]
      .filter(([, games]) => games.length >= 3)
      .sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))
      .slice(0, 8),
    rng,
  )
    .slice(0, 3)
    .map(([genre, games]) => ({
      key: `genre:${genre}`,
      title: genre,
      games: sample(games),
    }));
  shelves.push(...genreShelves);

  const tail: SuggestShelf[] = [];
  const paused = pool.filter((game) => game.status === 'paused');
  if (paused.length > 0) {
    tail.push({ key: 'paused', title: 'Jump back in', games: sample(paused) });
  }
  const want = pool.filter((game) => game.status === 'want_to_play');
  if (want.length > 0) {
    tail.push({ key: 'want', title: 'Want to play', games: sample(want) });
  }
  shelves.push(...shuffle(tail, rng));

  return shelves;
};
