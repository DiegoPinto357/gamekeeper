import type { DatabaseSync } from 'node:sqlite';
import type { Source, SteamDeckStatus, ProtonTier } from '../../types/game';

export type DiscoverFilters = {
  q?: string;
  genres?: string[];
  tags?: string[];
  sources?: string[];
  statuses?: string[];
  decks?: SteamDeckStatus[];
  protonTiers?: ProtonTier[];
  years?: number[];
  playtimeMin?: number;
  playtimeMax?: number;
  yearMin?: number;
  yearMax?: number;
};

export type DiscoverGame = {
  canonicalId: string;
  name: string;
  coverImageUrl?: string;
  playtimeHours?: number;
  primarySource: Source;
  ownedSources: Source[];
  /** Board status; games without a row count as 'backlog'. */
  status: string;
  releaseDate?: string;
  year?: number;
  lastPlayedAt?: string;
  genres: string[];
  tags: string[];
  deck?: SteamDeckStatus;
  protonTier?: ProtonTier;
  unavailableReason?: string;
  /** Steam app id when known; drives store + ProtonDB links. */
  steamAppId?: number;
};

export type FacetCount = { value: string; count: number };
export type YearFacetCount = { value: number; count: number };

export type DiscoverFacets = {
  genres: FacetCount[];
  tags: FacetCount[];
  sources: FacetCount[];
  statuses: FacetCount[];
  decks: FacetCount[];
  protonTiers: FacetCount[];
  years: YearFacetCount[];
};

const DECK_VALUES: SteamDeckStatus[] = ['verified', 'playable', 'unsupported', 'unknown'];
const TIER_VALUES: ProtonTier[] = ['platinum', 'gold', 'silver', 'bronze', 'borked'];

type QueryValue = string | string[] | undefined;

const asList = (value: QueryValue): string[] => {
  if (value === undefined) return [];
  return (Array.isArray(value) ? value : [value])
    .flatMap((entry) => entry.split(','))
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
};

const asNumber = (value: string | undefined): number | undefined => {
  if (value === undefined || value.trim() === '') return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
};

const scalar = (value: QueryValue): string | undefined =>
  Array.isArray(value) ? value[0] : value;

const oneOf = <T extends string>(values: string[], allowed: T[]): T[] =>
  values.filter((value): value is T => (allowed as string[]).includes(value));

/**
 * Map URL query params to typed filters. Comma lists and repeated keys
 * both work ('genre=RPG,Strategy' / 'genre=RPG&genre=Strategy').
 * Invalid numbers and unknown enum values are ignored, not rejected.
 */
export const parseDiscoverFilters = (
  query: Record<string, QueryValue> | undefined,
): DiscoverFilters => {
  const filters: DiscoverFilters = {};
  if (!query) return filters;

  const q = typeof query.q === 'string' ? query.q.trim() : '';
  if (q) filters.q = q;

  const genres = asList(query.genre);
  if (genres.length > 0) filters.genres = genres;

  const tags = asList(query.tag);
  if (tags.length > 0) filters.tags = tags;

  const sources = asList(query.source);
  if (sources.length > 0) filters.sources = sources;

  const statuses = asList(query.status);
  if (statuses.length > 0) filters.statuses = statuses;

  const decks = oneOf(asList(query.deck), DECK_VALUES);
  if (decks.length > 0) filters.decks = decks;

  const protonTiers = oneOf(asList(query.proton), TIER_VALUES);
  if (protonTiers.length > 0) filters.protonTiers = protonTiers;

  const years = asList(query.year)
    .map((value) => Number(value))
    .filter((value) => Number.isInteger(value));
  if (years.length > 0) filters.years = years;

  const playtimeMin = asNumber(scalar(query.playtimeMin));
  if (playtimeMin !== undefined) filters.playtimeMin = playtimeMin;

  const playtimeMax = asNumber(scalar(query.playtimeMax));
  if (playtimeMax !== undefined) filters.playtimeMax = playtimeMax;

  const yearMin = asNumber(scalar(query.yearMin));
  if (yearMin !== undefined) filters.yearMin = yearMin;

  const yearMax = asNumber(scalar(query.yearMax));
  if (yearMax !== undefined) filters.yearMax = yearMax;

  return filters;
};

/**
 * Build a safe FTS5 MATCH expression: each token quoted + prefix-matched.
 * "celes the" → `"celes"* "the"*`. Returns null when nothing searchable.
 */
export const toFtsQuery = (q: string): string | null => {
  const tokens = q.toLowerCase().match(/[\p{L}\p{N}]+/gu)?.slice(0, 8) ?? [];
  if (tokens.length === 0) return null;
  return tokens.map((token) => `"${token}"*`).join(' ');
};

type WhereBuilder = {
  clauses: string[];
  params: (string | number)[];
};

const placeholders = (count: number): string =>
  new Array(count).fill('?').join(', ');

/**
 * Shared WHERE construction. `exclude` drops dimensions — facets count
 * each dimension against the OTHER active filters (standard drill-down).
 */
const addFilterClauses = (
  where: WhereBuilder,
  filters: DiscoverFilters,
  exclude: ReadonlyArray<keyof DiscoverFilters> = [],
): void => {
  const off = (key: keyof DiscoverFilters): boolean => exclude.includes(key);

  if (filters.q && !off('q')) {
    const match = toFtsQuery(filters.q);
    if (match) {
      where.clauses.push(
        'g.canonical_id IN (SELECT canonical_id FROM games_fts WHERE games_fts MATCH ?)',
      );
      where.params.push(match);
    }
  }
  if (filters.genres?.length && !off('genres')) {
    where.clauses.push(
      `g.canonical_id IN (
         SELECT gg.canonical_id FROM game_genres gg
         JOIN genres gr ON gr.id = gg.genre_id
         WHERE gr.name IN (${placeholders(filters.genres.length)}))`,
    );
    where.params.push(...filters.genres);
  }
  if (filters.tags?.length && !off('tags')) {
    where.clauses.push(
      `g.canonical_id IN (
         SELECT gt.canonical_id FROM game_tags gt
         JOIN tags t ON t.id = gt.tag_id
         WHERE t.name IN (${placeholders(filters.tags.length)}))`,
    );
    where.params.push(...filters.tags);
  }
  if (filters.sources?.length && !off('sources')) {
    where.clauses.push(
      `EXISTS (SELECT 1 FROM json_each(g.owned_sources) oe
               WHERE oe.value IN (${placeholders(filters.sources.length)}))`,
    );
    where.params.push(...filters.sources);
  }
  if (filters.statuses?.length && !off('statuses')) {
    where.clauses.push(
      `COALESCE(gs.status, 'backlog') IN (${placeholders(filters.statuses.length)})`,
    );
    where.params.push(...filters.statuses);
  }
  if (filters.decks?.length && !off('decks')) {
    where.clauses.push(
      `json_extract(g.proton_json, '$.steamDeck') IN (${placeholders(filters.decks.length)})`,
    );
    where.params.push(...filters.decks);
  }
  if (filters.protonTiers?.length && !off('protonTiers')) {
    where.clauses.push(
      `json_extract(g.proton_json, '$.tier') IN (${placeholders(filters.protonTiers.length)})`,
    );
    where.params.push(...filters.protonTiers);
  }
  if (filters.years?.length && !off('years')) {
    where.clauses.push(
      `CAST(substr(g.release_date, 1, 4) AS INTEGER) IN (${placeholders(filters.years.length)})`,
    );
    where.params.push(...filters.years);
  }
  if (filters.playtimeMin !== undefined && !off('playtimeMin')) {
    where.clauses.push('g.playtime_hours >= ?');
    where.params.push(filters.playtimeMin);
  }
  if (filters.playtimeMax !== undefined && !off('playtimeMax')) {
    where.clauses.push('g.playtime_hours <= ?');
    where.params.push(filters.playtimeMax);
  }
  if (filters.yearMin !== undefined && !off('yearMin')) {
    where.clauses.push("CAST(substr(g.release_date, 1, 4) AS INTEGER) >= ?");
    where.params.push(filters.yearMin);
  }
  if (filters.yearMax !== undefined && !off('yearMax')) {
    where.clauses.push("CAST(substr(g.release_date, 1, 4) AS INTEGER) <= ?");
    where.params.push(filters.yearMax);
  }
};

const BASE_FROM = `FROM games g
  LEFT JOIN game_status gs ON gs.canonical_id = g.canonical_id`;

type GameRow = {
  canonical_id: string;
  name: string;
  cover_image_url: string | null;
  playtime_hours: number | null;
  primary_source: Source;
  owned_sources: string;
  steam_app_id: number | null;
  status: string;
  release_date: string | null;
  last_played_at: string | null;
  unavailable_reason: string | null;
  proton_json: string | null;
};

const namesFor = (
  db: DatabaseSync,
  canonicalId: string,
  table: 'genres' | 'tags',
  junction: 'game_genres' | 'game_tags',
  key: 'genre_id' | 'tag_id',
): string[] => {
  const rows = db
    .prepare(
      `SELECT n.name FROM ${junction} j
       JOIN ${table} n ON n.id = j.${key}
       WHERE j.canonical_id = ?
       ORDER BY n.name COLLATE NOCASE`,
    )
    .all(canonicalId) as { name: string }[];
  return rows.map((row) => row.name);
};

const toDiscoverGame = (db: DatabaseSync, row: GameRow): DiscoverGame => {
  let proton: { tier?: ProtonTier; steamDeck?: SteamDeckStatus } | undefined;
  if (row.proton_json) {
    try {
      proton = JSON.parse(row.proton_json);
    } catch {
      proton = undefined;
    }
  }
  return {
    canonicalId: row.canonical_id,
    name: row.name,
    coverImageUrl: row.cover_image_url ?? undefined,
    playtimeHours: row.playtime_hours ?? undefined,
    primarySource: row.primary_source,
    ownedSources: JSON.parse(row.owned_sources) as Source[],
    steamAppId: row.steam_app_id ?? undefined,
    status: row.status,
    releaseDate: row.release_date ?? undefined,
    year: row.release_date
      ? Number(row.release_date.slice(0, 4)) || undefined
      : undefined,
    lastPlayedAt: row.last_played_at ?? undefined,
    genres: namesFor(db, row.canonical_id, 'genres', 'game_genres', 'genre_id'),
    tags: namesFor(db, row.canonical_id, 'tags', 'game_tags', 'tag_id'),
    deck: proton?.steamDeck,
    protonTier: proton?.tier,
    unavailableReason: row.unavailable_reason ?? undefined,
  };
};

export const queryGames = (
  db: DatabaseSync,
  filters: DiscoverFilters = {},
): { games: DiscoverGame[]; total: number } => {
  const where: WhereBuilder = { clauses: [], params: [] };
  addFilterClauses(where, filters);
  const whereSql = where.clauses.length
    ? `WHERE ${where.clauses.join(' AND ')}`
    : '';

  const totalRow = db
    .prepare(`SELECT COUNT(*) AS c ${BASE_FROM} ${whereSql}`)
    .get(...where.params) as { c: number };

  const rows = db
    .prepare(
      `SELECT g.canonical_id, g.name, g.cover_image_url, g.playtime_hours,
              g.primary_source, g.owned_sources, g.steam_app_id, g.release_date,
              g.last_played_at, g.unavailable_reason, g.proton_json,
              COALESCE(gs.status, 'backlog') AS status
       ${BASE_FROM} ${whereSql}
       ORDER BY g.name COLLATE NOCASE ASC`,
    )
    .all(...where.params) as GameRow[];

  return {
    games: rows.map((row) => toDiscoverGame(db, row)),
    total: totalRow.c,
  };
};

export const getFacets = (
  db: DatabaseSync,
  filters: DiscoverFilters = {},
): DiscoverFacets => {
  const countBy = (
    exclude: ReadonlyArray<keyof DiscoverFilters>,
    select: string,
    extraFrom = '',
  ): FacetCount[] => {
    const where: WhereBuilder = { clauses: [], params: [] };
    addFilterClauses(where, filters, exclude);
    const whereSql = where.clauses.length
      ? `WHERE ${where.clauses.join(' AND ')}`
      : '';
    const rows = db
      .prepare(
        `SELECT ${select} AS value, COUNT(DISTINCT g.canonical_id) AS count
         ${BASE_FROM} ${extraFrom} ${whereSql}
         GROUP BY value
         ORDER BY count DESC, value ASC`,
      )
      .all(...where.params) as FacetCount[];
    return rows.filter((row) => row.value !== null && row.value !== undefined);
  };

  const years = (() => {
    const where: WhereBuilder = {
      clauses: ['g.release_date IS NOT NULL'],
      params: [],
    };
    addFilterClauses(where, filters, ['years', 'yearMin', 'yearMax']);
    const rows = db
      .prepare(
        `SELECT CAST(substr(g.release_date, 1, 4) AS INTEGER) AS value,
                COUNT(DISTINCT g.canonical_id) AS count
         ${BASE_FROM} WHERE ${where.clauses.join(' AND ')}
         GROUP BY value ORDER BY count DESC, value ASC`,
      )
      .all(...where.params) as YearFacetCount[];
    return rows;
  })();

  return {
    genres: countBy(
      ['genres'],
      'gr.name',
      `JOIN game_genres gg ON gg.canonical_id = g.canonical_id
       JOIN genres gr ON gr.id = gg.genre_id`,
    ),
    tags: countBy(
      ['tags'],
      't.name',
      `JOIN game_tags gt ON gt.canonical_id = g.canonical_id
       JOIN tags t ON t.id = gt.tag_id`,
    ),
    sources: countBy(
      ['sources'],
      'je.value',
      'JOIN json_each(g.owned_sources) je',
    ),
    statuses: countBy(['statuses'], "COALESCE(gs.status, 'backlog')"),
    decks: countBy(['decks'], "json_extract(g.proton_json, '$.steamDeck')"),
    protonTiers: countBy(['protonTiers'], "json_extract(g.proton_json, '$.tier')"),
    years,
  };
};
