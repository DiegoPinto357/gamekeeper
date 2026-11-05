import type { DatabaseSync } from 'node:sqlite';

/**
 * P5 — similar games: IGDB curated pairs (ranked, from enrichment) first,
 * then computed overlap over the local genre/tag sets.
 */
export type SimilarOrigin = 'igdb' | 'overlap';

export type SimilarGame = {
  canonicalId: string;
  name: string;
  coverImageUrl: string | null;
  /** Board status; games without a tracked row count as 'backlog'. */
  status: string;
  origin: SimilarOrigin;
  /** 0.4·jaccard(genres) + 0.6·jaccard(tags); null for IGDB-curated rows. */
  score: number | null;
  /** IGDB curated rank (1-based); null for computed overlap. */
  rank: number | null;
};

/** Gallery size shown in the drawer/modal section. */
export const SIMILAR_LIMIT = 8;

export const GENRE_WEIGHT = 0.4;
export const TAG_WEIGHT = 0.6;

/** Set similarity; two empty sets score 0 — no evidence, not perfect match. */
export const jaccard = (
  a: ReadonlySet<string>,
  b: ReadonlySet<string>,
): number => {
  if (a.size === 0 && b.size === 0) return 0;
  let intersection = 0;
  for (const item of a) {
    if (b.has(item)) intersection++;
  }
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
};

type GameMeta = {
  canonicalId: string;
  name: string;
  coverImageUrl: string | null;
  status: string;
};

const META_SELECT = `
  SELECT g.canonical_id AS canonicalId, g.name AS name,
         g.cover_image_url AS coverImageUrl,
         COALESCE(gs.status, 'backlog') AS status
  FROM games g
  LEFT JOIN game_status gs ON gs.canonical_id = g.canonical_id`;

const loadMeta = (db: DatabaseSync): Map<string, GameMeta> => {
  const rows = db.prepare(`${META_SELECT}`).all() as GameMeta[];
  return new Map(rows.map((row) => [row.canonicalId, row]));
};

const loadNamedSets = (
  db: DatabaseSync,
  kind: 'genres' | 'tags',
): Map<string, Set<string>> => {
  const sql =
    kind === 'genres'
      ? `SELECT gg.canonical_id AS cid, n.name AS name
         FROM game_genres gg JOIN genres n ON n.id = gg.genre_id`
      : `SELECT gt.canonical_id AS cid, n.name AS name
         FROM game_tags gt JOIN tags n ON n.id = gt.tag_id`;
  const rows = db.prepare(sql).all() as { cid: string; name: string }[];
  const sets = new Map<string, Set<string>>();
  for (const row of rows) {
    let set = sets.get(row.cid);
    if (!set) {
      set = new Set();
      sets.set(row.cid, set);
    }
    set.add(row.name);
  }
  return sets;
};

/** Candidates sharing at least one genre or tag with the target. */
const CANDIDATE_SQL = `
  SELECT DISTINCT g.canonical_id AS canonicalId
  FROM games g
  WHERE g.canonical_id != ?
    AND (
      EXISTS (
        SELECT 1 FROM game_genres gg
        WHERE gg.canonical_id = g.canonical_id
          AND gg.genre_id IN (
            SELECT genre_id FROM game_genres WHERE canonical_id = ?)
      )
      OR EXISTS (
        SELECT 1 FROM game_tags gt
        WHERE gt.canonical_id = g.canonical_id
          AND gt.tag_id IN (
            SELECT tag_id FROM game_tags WHERE canonical_id = ?)
      )
    )`;

/**
 * Curated rows store canonical ids; pairs whose target had no IGDB id yet at
 * write time are staged as `igdb:<id>` and resolved through `games.igdb_id`
 * here — so pairs self-heal as soon as the target gets enriched.
 */
const resolveCurated = (
  db: DatabaseSync,
  raw: string,
): GameMeta | null => {
  if (raw.startsWith('igdb:')) {
    const igdbId = Number(raw.slice(5));
    if (!Number.isInteger(igdbId)) return null;
    const row = db
      .prepare(`${META_SELECT} WHERE g.igdb_id = ?`)
      .get(igdbId) as GameMeta | undefined;
    return row ?? null;
  }
  const row = db
    .prepare(`${META_SELECT} WHERE g.canonical_id = ?`)
    .get(raw) as GameMeta | undefined;
  return row ?? null;
};

export const getSimilarGames = (
  db: DatabaseSync,
  canonicalId: string,
  limit: number = SIMILAR_LIMIT,
): SimilarGame[] => {
  if (limit <= 0) return [];
  const meta = loadMeta(db);
  const target = meta.get(canonicalId);
  if (!target) return [];

  const result: SimilarGame[] = [];
  const seen = new Set<string>([canonicalId]);

  // 1) IGDB curated, ranked first.
  const curated = db
    .prepare(
      `SELECT similar_canonical_id AS similar, rank AS rank
       FROM similar_games
       WHERE canonical_id = ?
       ORDER BY rank IS NULL, rank ASC, similar_canonical_id ASC`,
    )
    .all(canonicalId) as { similar: string; rank: number | null }[];
  for (const row of curated) {
    const resolved = resolveCurated(db, row.similar);
    if (!resolved || seen.has(resolved.canonicalId)) continue;
    seen.add(resolved.canonicalId);
    result.push({ ...resolved, origin: 'igdb', score: null, rank: row.rank });
    if (result.length >= limit) return result;
  }

  // 2) Computed overlap — needs at least one dimension on the target.
  const genreSets = loadNamedSets(db, 'genres');
  const tagSets = loadNamedSets(db, 'tags');
  const targetGenres = genreSets.get(canonicalId) ?? new Set<string>();
  const targetTags = tagSets.get(canonicalId) ?? new Set<string>();
  if (targetGenres.size === 0 && targetTags.size === 0) return result;

  const empty = new Set<string>();
  const candidates = db
    .prepare(CANDIDATE_SQL)
    .all(canonicalId, canonicalId, canonicalId) as { canonicalId: string }[];

  const scored: SimilarGame[] = [];
  for (const candidate of candidates) {
    if (seen.has(candidate.canonicalId)) continue;
    const entry = meta.get(candidate.canonicalId);
    if (!entry) continue;
    const score =
      GENRE_WEIGHT *
        jaccard(targetGenres, genreSets.get(candidate.canonicalId) ?? empty) +
      TAG_WEIGHT * jaccard(targetTags, tagSets.get(candidate.canonicalId) ?? empty);
    if (score <= 0) continue;
    scored.push({ ...entry, origin: 'overlap', score, rank: null });
  }
  scored.sort(
    (a, b) =>
      (b.score ?? 0) - (a.score ?? 0) || a.name.localeCompare(b.name),
  );

  for (const game of scored) {
    if (result.length >= limit) break;
    result.push(game);
  }
  return result;
};
