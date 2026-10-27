import fs from 'fs/promises';
import { loadConfig } from '../config';
import { loadOverrides } from '../core/overrides';
import {
  resolveXboxSource,
  shouldSyncToNotion,
  processGamePassAvailability as processAvailability,
  saveUnavailableGames as saveAvailabilityReport,
  type UnavailableGame,
} from '../core/xbox-gamepass';
import { saveMergeSuggestions as writeMergeSuggestions } from '../core/suggestions';
import { steamAdapter } from '../adapters/steam.adapter';
import { heroicAdapter } from '../adapters/heroic.adapter';
import { playniteAdapter } from '../adapters/playnite.adapter';
import { createProtonDBAdapter } from '../adapters/protondb.adapter';
import { createGamePassAdapter } from '../adapters/gamepass.adapter';
import { igdbAdapter } from '../adapters/igdb.adapter';
import { createNotionClient } from '../notion/notion.client';
import { openDb, upsertGames, reconcileUnavailableReasons, rebuildGamesFts } from '../db/index';
import { enrichSteamMetadata as runSteamEnrich } from './steam-enrich';
import { enrichIgdbMetadata as runIgdbEnrich } from './igdb-enrich';
import { normalizeGameName, wordSortedKey } from '../core/normalize';
import { log } from '../logger';
import type { Config, RawGameData, UnifiedGame } from '../types/game';
import type { GamePassGame } from '../adapters/gamepass.adapter';
import type { SyncAdapters, SyncIO } from './types';

const INTERESTS_FILE = './data/gamepass-interests.json';
const OWNED_XBOX_FILE = './data/owned-xbox-games.json';
const PLAYNITE_SNAPSHOT_FILE = './data/playnite.json';
const OVERRIDES_FILE = './data/overrides.json';

/**
 * Harvest non-Steam libraries: Heroic (default) or Playnite (legacy),
 * plus owned-Xbox entries. Extracted from the old CLI main().
 */
const loadLibrarySources = async (
  config: Config,
  adapters: SyncAdapters,
  ctx: { interests: string[]; gamePassCatalog: GamePassGame[] },
): Promise<RawGameData[]> => {
  let sourceGames: RawGameData[] = [];

  if (config.playniteEnabled) {
    const gamePassFilter = async (gameTitle: string): Promise<boolean> => {
      const isInterested = ctx.interests.some(
        interest =>
          interest.toLowerCase().trim() === gameTitle.toLowerCase().trim(),
      );
      if (!isInterested) return false;
      return adapters.gamePass.isGameAvailable(gameTitle);
    };

    const playniteGames = await playniteAdapter.loadSnapshot(
      PLAYNITE_SNAPSHOT_FILE,
      gamePassFilter,
    );

    const filteredPlayniteGames: RawGameData[] = [];
    for (const game of playniteGames) {
      if (game.source === 'xbox') {
        game.source = await resolveXboxSource(game.name, ctx.gamePassCatalog);
      }
      const shouldSync = await shouldSyncToNotion(game, ctx.gamePassCatalog);
      if (shouldSync) filteredPlayniteGames.push(game);
    }

    sourceGames = filteredPlayniteGames;
    log.info(
      `✅ Playnite: ${filteredPlayniteGames.length} games (${
        playniteGames.length - filteredPlayniteGames.length
      } filtered out)`,
    );

    // Add owned Xbox games not present in Playnite
    const playniteGameNames = new Set(
      playniteGames.map(g => g.name.toLowerCase().trim()),
    );
    const ownedXboxFile = await fs.readFile(OWNED_XBOX_FILE, 'utf-8');
    const ownedXboxData = JSON.parse(ownedXboxFile);
    const ownedGamesNames: string[] = ownedXboxData.ownedGames || [];
    for (const gameName of ownedGamesNames) {
      if (!playniteGameNames.has(gameName.toLowerCase().trim())) {
        sourceGames.push({
          name: gameName,
          source: 'xbox',
          externalId: `xbox-owned-${gameName.toLowerCase().replace(/\s+/g, '-')}`,
          playtimeHours: 0,
        });
      }
    }
  } else {
    sourceGames = await heroicAdapter.loadAllLibraries(
      config.heroic.storeCachePath,
    );

    // All owned Xbox games (Heroic doesn't cover Xbox)
    try {
      const ownedXboxFile = await fs.readFile(OWNED_XBOX_FILE, 'utf-8');
      const ownedXboxData = JSON.parse(ownedXboxFile);
      const ownedGamesNames: string[] = ownedXboxData.ownedGames || [];
      log.info(`🎯 Loaded ${ownedGamesNames.length} owned Xbox games`);
      for (const gameName of ownedGamesNames) {
        sourceGames.push({
          name: gameName,
          source: 'xbox',
          externalId: `xbox-owned-${gameName.toLowerCase().replace(/\s+/g, '-')}`,
          playtimeHours: 0,
        });
      }
    } catch {
      log.warn('⚠️  No owned Xbox games file found');
    }
  }

  return sourceGames;
};

export const defaultSyncIO: SyncIO = {
  loadConfig,

  loadOverrides: () => loadOverrides(OVERRIDES_FILE),

  initAdapters: async (config: Config): Promise<SyncAdapters> => {
    const protonDb = createProtonDBAdapter(
      '.cache/protondb',
      config.protondb.cacheDays,
    );
    const gamePass = createGamePassAdapter('.cache/gamepass', 7);
    const notionClient = createNotionClient(
      config.notion.apiKey,
      config.notion.databaseId,
      config.notion.titleProperty,
      config.notion.syncProperties,
      config.dryRun,
    );

    await protonDb.init();
    await igdbAdapter.initialize();

    const adapters: SyncAdapters = {
      protonDb,
      igdb: igdbAdapter,
      gamePass,
      notion: {
        verifyDatabase: () => notionClient.verifyDatabase(),
        syncGames: (games, gamePassCatalogTitles, onProgress) =>
          notionClient.syncGames(games, gamePassCatalogTitles, onProgress),
      },
      fetchSteamGames: cfg =>
        steamAdapter.fetchOwnedGames(cfg.steam.apiKey, cfg.steam.userId),
      loadLibrarySources: (cfg, ctx) => loadLibrarySources(cfg, adapters, ctx),
    };
    return adapters;
  },

  loadInterests: async (): Promise<string[] | null> => {
    try {
      const content = await fs.readFile(INTERESTS_FILE, 'utf-8');
      const data = JSON.parse(content);
      return data.wantToPlay || [];
    } catch {
      return null;
    }
  },

  saveMergeSuggestions: suggestions => writeMergeSuggestions(suggestions),

  saveLibrarySnapshot: async (games: UnifiedGame[]): Promise<void> => {
    const snapshot = {
      lastSynced: new Date().toISOString(),
      gameCount: games.length,
      games,
    };
    await fs.writeFile(
      './data/library.json',
      JSON.stringify(snapshot, null, 2),
      'utf-8',
    );
  },

  writeGamesToDb: games => {
    const db = openDb();
    try {
      const existingRows = db.raw
        .prepare('SELECT canonical_id FROM games')
        .all() as { canonical_id: string }[];
      const existing = new Set(existingRows.map(r => r.canonical_id));
      let added = 0;
      let updated = 0;
      for (const game of games) {
        if (existing.has(game.canonicalId)) updated++;
        else added++;
      }
      upsertGames(db.raw, games);
      return Promise.resolve({ path: db.path, added, updated });
    } finally {
      db.close();
    }
  },

  enrichSteamMetadata: async onProgress => {
    const db = openDb();
    try {
      const result = await runSteamEnrich(db.raw, {
        onProgress: (current, total) => onProgress?.(current, total),
      });
      if (result.enriched > 0) rebuildGamesFts(db.raw);
      return result;
    } finally {
      db.close();
    }
  },

  enrichIgdbMetadata: async onProgress => {
    const db = openDb();
    try {
      const result = await runIgdbEnrich(db.raw, {
        onProgress: (current, total) => onProgress?.(current, total),
      });
      if (result.enriched > 0) rebuildGamesFts(db.raw);
      return result;
    } finally {
      db.close();
    }
  },

  processGamePassAvailability: (sourceGames, gamePassCatalog) =>
    processAvailability(sourceGames, gamePassCatalog),

  saveUnavailableGames: (unavailable: UnavailableGame[]) =>
    saveAvailabilityReport(unavailable),

  persistAvailability: (unavailable: UnavailableGame[]) => {
    const db = openDb();
    try {
      const rows = db.raw
        .prepare('SELECT canonical_id, name FROM games')
        .all() as { canonical_id: string; name: string }[];
      // Two lookup keys per game: exact normalized name, plus a
      // word-sorted key so swapped subtitle orders still match
      // ("Senua's Saga: Hellblade II" ↔ "Hellblade II: Senua's Saga").
      const byName = new Map<string, string>();
      const addKey = (key: string, canonicalId: string) => {
        if (!byName.has(key)) byName.set(key, canonicalId);
      };
      for (const row of rows) {
        addKey(normalizeGameName(row.name), row.canonical_id);
        addKey(wordSortedKey(row.name), row.canonical_id);
      }
      const findCanonicalId = (name: string): string | undefined =>
        byName.get(normalizeGameName(name)) ?? byName.get(wordSortedKey(name));
      const flagged = unavailable.flatMap(entry => {
        const canonicalId = findCanonicalId(entry.name);
        return canonicalId
          ? [{ canonicalId, reason: entry.reason }]
          : [];
      });
      return Promise.resolve(reconcileUnavailableReasons(db.raw, flagged));
    } finally {
      db.close();
    }
  },
};
