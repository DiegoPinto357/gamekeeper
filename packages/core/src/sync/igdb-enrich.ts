import type { DatabaseSync } from 'node:sqlite';
import { igdbAdapter, type IgdbGameDetails, type IgdbMatch } from '../adapters/igdb.adapter';
import { log } from '../logger';

export type { IgdbGameDetails };

export type IgdbApi = {
  findBySteamAppId: (steamAppId: number) => Promise<IgdbMatch | null>;
  findByName: (name: string) => Promise<IgdbMatch | null>;
  fetchDetails: (igdbId: number) => Promise<IgdbGameDetails | null>;
};

export type IgdbEnrichOptions = {
  /** Re-fetch games that already have igdb_enriched_at set. */
  force?: boolean;
  /** Cap the number of games this run. */
  limit?: number;
  /** Delay between games (~2-3 IGDB requests each; 4 req/s budget). */
  delayMs?: number;
  onProgress?: (done: number, total: number, name: string) => void;
};

export type IgdbEnrichResult = {
  enriched: number;
  failed: number;
  total: number;
};

export type IgdbEnrichCandidate = {
  canonicalId: string;
  name: string;
  steamAppId: number | null;
  igdbId: number | null;
  description: string | null;
  developer: string | null;
  publisher: string | null;
};

const DEFAULT_DELAY_MS = 500;

export const getIgdbEnrichmentCandidates = (
  db: DatabaseSync,
  opts: { force?: boolean } = {},
): IgdbEnrichCandidate[] => {
  const where = opts.force ? '1 = 1' : 'igdb_enriched_at IS NULL';
  const rows = db
    .prepare(
      `SELECT canonical_id, name, steam_app_id, igdb_id, description, developer, publisher
       FROM games
       WHERE ${where}
       ORDER BY canonical_id`,
    )
    .all() as Array<{
    canonical_id: string;
    name: string;
    steam_app_id: number | null;
    igdb_id: number | null;
    description: string | null;
    developer: string | null;
    publisher: string | null;
  }>;

  return rows.map((row) => ({
    canonicalId: row.canonical_id,
    name: row.name,
    steamAppId: row.steam_app_id,
    igdbId: row.igdb_id,
    description: row.description,
    developer: row.developer,
    publisher: row.publisher,
  }));
};

const upsertNamed = (
  db: DatabaseSync,
  table: 'genres' | 'tags',
  junctionIdColumn: 'genre_id' | 'tag_id',
  canonicalId: string,
  names: string[],
): void => {
  const insert = db.prepare(
    `INSERT INTO ${table} (name) VALUES (?) ON CONFLICT(name) DO NOTHING`,
  );
  const link = db.prepare(
    `INSERT INTO game_${table} (canonical_id, ${junctionIdColumn})
     SELECT ?, id FROM ${table} WHERE name = ?
     ON CONFLICT(canonical_id, ${junctionIdColumn}) DO NOTHING`,
  );
  for (const raw of names) {
    const name = raw.trim();
    if (!name) continue;
    insert.run(name);
    link.run(canonicalId, name);
  }
};

const applyDetails = (
  db: DatabaseSync,
  candidate: IgdbEnrichCandidate,
  igdbId: number,
  details: IgdbGameDetails | null,
): void => {
  db.prepare(
    `UPDATE games SET
       igdb_id = COALESCE(igdb_id, ?),
       description = COALESCE(description, ?),
       developer = COALESCE(developer, ?),
       publisher = COALESCE(publisher, ?),
       igdb_enriched_at = ?
     WHERE canonical_id = ?`,
  ).run(
    igdbId,
    details?.summary ?? null,
    details?.developers[0] ?? null,
    details?.publishers[0] ?? null,
    new Date().toISOString(),
    candidate.canonicalId,
  );

  if (details) {
    upsertNamed(db, 'genres', 'genre_id', candidate.canonicalId, details.genres);
    upsertNamed(
      db,
      'tags',
      'tag_id',
      candidate.canonicalId,
      [...details.themes, ...details.keywords],
    );
    // similar_game_ids are fetched for P5's similarity scorer — not persisted yet.
  }
};

/**
 * Enrich all games via IGDB: Steam games resolve by appid (external_games),
 * everything else by exact-ish name (manual/physical included). Then pull
 * summary/genres/themes/keywords/companies. Resumable via
 * `igdb_enriched_at`; failures stay unstamped and retry next run.
 */
export const enrichIgdbMetadata = async (
  db: DatabaseSync,
  opts: IgdbEnrichOptions = {},
  api: IgdbApi = {
    findBySteamAppId: igdbAdapter.fetchGameBySteamAppId,
    findByName: igdbAdapter.findByName,
    fetchDetails: igdbAdapter.fetchGameDetails,
  },
): Promise<IgdbEnrichResult> => {
  const candidates = getIgdbEnrichmentCandidates(db, { force: opts.force });
  const selected = opts.limit ? candidates.slice(0, opts.limit) : candidates;
  const delayMs = opts.delayMs ?? DEFAULT_DELAY_MS;

  let enriched = 0;
  let failed = 0;
  const total = selected.length;
  if (total === 0) {
    log.info('IGDB enrichment: nothing to do');
    return { enriched, failed, total };
  }

  log.info(`IGDB enrichment: ${total} games`);
  let done = 0;
  for (const candidate of selected) {
    let igdbId = candidate.igdbId;
    if (igdbId === null) {
      const match = candidate.steamAppId
        ? await api.findBySteamAppId(candidate.steamAppId)
        : await api.findByName(candidate.name);
      igdbId = match?.igdbId ?? null;
    }

    if (igdbId === null) {
      // No stamp: transient lookup failures retry next run (same as the
      // Steam pass); force re-does everything.
      failed++;
    } else {
      const details = await api.fetchDetails(igdbId).catch(() => null);
      applyDetails(db, candidate, igdbId, details);
      enriched++;
    }

    done++;
    opts.onProgress?.(done, total, candidate.name);
    if (done < total && delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }

  log.info(`IGDB enrichment done: ${enriched} enriched, ${failed} failed`);
  return { enriched, failed, total };
};
