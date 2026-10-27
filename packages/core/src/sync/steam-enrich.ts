import type { DatabaseSync } from 'node:sqlite';
import { steamAdapter } from '../adapters/steam.adapter';
import { log } from '../logger';

/**
 * Subset of the Steam appdetails response used for enrichment.
 */
export type SteamAppMetadata = {
  name: string;
  steam_appid: number;
  header_image?: string;
  short_description?: string;
  developers?: string[];
  publishers?: string[];
  release_date?: { coming_soon: boolean; date: string };
  genres?: Array<{ description: string }>;
};

export type SteamEnrichOptions = {
  /** Re-fetch games that already have enriched_at set. */
  force?: boolean;
  /** Cap the number of fetches this run (smoke-test / resume helper). */
  limit?: number;
  /** Delay between store requests; Steam tolerates ~1 req/1.2s. */
  delayMs?: number;
  onProgress?: (done: number, total: number, name: string) => void;
};

export type SteamEnrichResult = {
  enriched: number;
  failed: number;
  total: number;
};

export type SteamEnrichCandidate = {
  canonicalId: string;
  /** Authoritative store appid — canonical ids are name slugs, not steam:<id>. */
  steamAppId: number;
  name: string;
  description: string | null;
  developer: string | null;
  publisher: string | null;
  coverImageUrl: string | null;
  releaseDate: string | null;
};

const DEFAULT_DELAY_MS = 1200;

export const getSteamEnrichmentCandidates = (
  db: DatabaseSync,
  opts: { force?: boolean } = {},
): SteamEnrichCandidate[] => {
  const where = opts.force
    ? 'steam_app_id IS NOT NULL'
    : 'steam_app_id IS NOT NULL AND enriched_at IS NULL';
  const rows = db
    .prepare(
      `SELECT canonical_id, steam_app_id, name, description, developer, publisher,
              cover_image_url, release_date
       FROM games
       WHERE ${where}
       ORDER BY canonical_id`,
    )
    .all() as Array<{
    canonical_id: string;
    steam_app_id: number;
    name: string;
    description: string | null;
    developer: string | null;
    publisher: string | null;
    cover_image_url: string | null;
    release_date: string | null;
  }>;

  return rows.map((row) => ({
    canonicalId: row.canonical_id,
    steamAppId: row.steam_app_id,
    name: row.name,
    description: row.description,
    developer: row.developer,
    publisher: row.publisher,
    coverImageUrl: row.cover_image_url,
    releaseDate: row.release_date,
  }));
};

const applyDetails = (
  db: DatabaseSync,
  candidate: SteamEnrichCandidate,
  details: SteamAppMetadata,
): void => {
  const releaseIso =
    !details.release_date?.coming_soon && details.release_date?.date
      ? new Date(details.release_date.date)
      : undefined;
  const validRelease =
    releaseIso && !Number.isNaN(releaseIso.getTime()) ? releaseIso : undefined;

  db.prepare(
    `UPDATE games SET
       description = COALESCE(description, ?),
       developer = COALESCE(developer, ?),
       publisher = COALESCE(publisher, ?),
       cover_image_url = COALESCE(cover_image_url, ?),
       release_date = COALESCE(release_date, ?),
       enriched_at = ?
     WHERE canonical_id = ?`,
  ).run(
    details.short_description ?? null,
    details.developers?.[0] ?? null,
    details.publishers?.[0] ?? null,
    details.header_image ?? null,
    validRelease ? validRelease.toISOString() : null,
    new Date().toISOString(),
    candidate.canonicalId,
  );

  const insertGenre = db.prepare(
    'INSERT INTO genres (name) VALUES (?) ON CONFLICT(name) DO NOTHING',
  );
  const linkGenre = db.prepare(
    `INSERT INTO game_genres (canonical_id, genre_id)
     SELECT ?, id FROM genres WHERE name = ?
     ON CONFLICT(canonical_id, genre_id) DO NOTHING`,
  );
  for (const genre of details.genres ?? []) {
    const name = genre.description?.trim();
    if (!name) continue;
    insertGenre.run(name);
    linkGenre.run(candidate.canonicalId, name);
  }
};

/**
 * Enrich Steam games in the DB from the store appdetails endpoint.
 * Resumable: games are stamped `enriched_at` on success and skipped on later
 * runs unless `force`. Failed fetches stay unstamped and retry next run.
 */
export const enrichSteamMetadata = async (
  db: DatabaseSync,
  opts: SteamEnrichOptions = {},
  fetchDetails: (appId: number) => Promise<SteamAppMetadata | null> =
    steamAdapter.fetchAppDetails,
): Promise<SteamEnrichResult> => {
  const candidates = getSteamEnrichmentCandidates(db, { force: opts.force });
  const selected = opts.limit ? candidates.slice(0, opts.limit) : candidates;
  const delayMs = opts.delayMs ?? DEFAULT_DELAY_MS;

  let enriched = 0;
  let failed = 0;
  const total = selected.length;
  if (total === 0) {
    log.info('Steam enrichment: nothing to do');
    return { enriched, failed, total };
  }

  log.info(`Steam enrichment: ${total} games`);
  let done = 0;
  for (const candidate of selected) {
    const appId = candidate.steamAppId;
    const details = Number.isInteger(appId)
      ? await fetchDetails(appId)
      : null;

    if (details) {
      applyDetails(db, candidate, details);
      enriched++;
    } else {
      failed++;
    }

    done++;
    opts.onProgress?.(done, total, candidate.name);
    if (done < total && delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }

  log.info(`Steam enrichment done: ${enriched} enriched, ${failed} failed`);
  return { enriched, failed, total };
};
