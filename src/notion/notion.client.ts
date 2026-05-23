import { Client } from '@notionhq/client';
import { UnifiedGame, NotionSyncProperties } from '../types/game';
import { getCanonicalNameFromVariant } from '../core/overrides';
import { normalizeGameName } from '../core/normalize';
import { getConfig } from '../config';
import syncLogger, { SyncOperations } from './sync-logger';

const debug = (message: string, ...args: any[]) => {
  if (getConfig().logLevel === 'debug') {
    console.log(`[DEBUG] ${message}`, ...args);
  }
};

/**
 * Notion database properties schema
 * Customize this based on your Notion database structure
 */
type NotionGameProperties = {
  Name: { title: Array<{ text: { content: string } }> };
  'Primary Source': { select: { name: string } };
  'Owned On': { multi_select: Array<{ name: string }> };
  'Steam App ID': { number: number | null };
  'Playtime (hours)': { number: number | null };
  'Last Played': { date: { start: string } | null };
  'Proton Tier': { select: { name: string } | null };
  'Steam Deck': { select: { name: string } | null };
  'Cover Image': { url: string | null };
  'Canonical ID': { rich_text: Array<{ text: { content: string } }> };
  'Library Status': { select: { name: string } | null };
};

/**
 * Capitalize source name for display
 */
const capitalizeSource = (source: string): string => {
  const map: Record<string, string> = {
    steam: 'Steam',
    xbox: 'Xbox',
    epic: 'Epic Games',
    gog: 'GOG',
    amazon: 'Amazon',
    gamepass: 'Game Pass',
    manual: 'Manual',
  };
  return map[source] || source;
};

/**
 * Capitalize first letter
 */
const capitalizeFirst = (str: string): string => {
  return str.charAt(0).toUpperCase() + str.slice(1);
};

/**
 * Clean game name for display in Notion
 * Removes platform-specific suffixes like " - Windows" and "(Windows)"
 */
const cleanDisplayName = (name: string): string => {
  return name
    .replace(/\s*\(Windows\)\s*$/i, '') // Remove (Windows) suffix
    .replace(/\s*-\s+Windows\s*$/i, '') // Remove " - Windows" suffix
    .trim();
};

/**
 * Sleep helper for rate limiting
 */
const sleep = (ms: number): Promise<void> => {
  return new Promise(resolve => setTimeout(resolve, ms));
};

/**
 * Get list of property names that have changed between existing and new values.
 * Returns an empty array when nothing changed.
 */
const getChangedProperties = (
  existingPage: any,
  newProperties: any,
  syncProperties: NotionSyncProperties,
): string[] => {
  try {
    const existing = existingPage.properties;
    const changed: string[] = [];

    if (syncProperties.primarySource) {
      const existingSource = existing['Primary Source']?.select?.name;
      const newSource = newProperties['Primary Source']?.select?.name;
      if (existingSource !== newSource) changed.push('Primary Source');
    }

    if (syncProperties.ownedOn) {
      const existingOwned = existing['Owned On']?.multi_select
        ?.map((s: any) => s.name)
        .sort()
        .join(',');
      const newOwned = newProperties['Owned On']?.multi_select
        ?.map((s: any) => s.name)
        .sort()
        .join(',');
      if (existingOwned !== newOwned) changed.push('Owned On');
    }

    if (syncProperties.steamAppId) {
      const existingSteam = existing['Steam App ID']?.number;
      const newSteam = newProperties['Steam App ID']?.number;
      if (existingSteam !== newSteam) changed.push('Steam App ID');
    }

    if (syncProperties.playtime) {
      const existingPlaytime = existing['Playtime (hours)']?.number;
      const newPlaytime = newProperties['Playtime (hours)']?.number;
      if (existingPlaytime !== newPlaytime) changed.push('Playtime (hours)');
    }

    if (syncProperties.lastPlayed) {
      const existingDate = existing['Last Played']?.date?.start;
      const newDate = newProperties['Last Played']?.date?.start;
      if (existingDate !== newDate) changed.push('Last Played');
    }

    if (syncProperties.protonTier) {
      const existingTier = existing['Proton Tier']?.select?.name;
      const newTier = newProperties['Proton Tier']?.select?.name;
      if (existingTier !== newTier) changed.push('Proton Tier');
    }

    if (syncProperties.steamDeck) {
      const existingDeck = existing['Steam Deck']?.select?.name;
      const newDeck = newProperties['Steam Deck']?.select?.name;
      if (existingDeck !== newDeck) changed.push('Steam Deck');
    }

    if (syncProperties.coverImage) {
      const existingCover = existing['Cover Image']?.url;
      const newCover = newProperties['Cover Image']?.url;
      if (existingCover !== newCover) changed.push('Cover Image');
    }

    if (syncProperties.canonicalId) {
      const existingId =
        existing['Canonical ID']?.rich_text?.[0]?.text?.content;
      const newId =
        newProperties['Canonical ID']?.rich_text?.[0]?.text?.content;
      if (existingId !== newId) changed.push('Canonical ID');
    }

    if (syncProperties.libraryStatus) {
      const existingStatus = existing['Library Status']?.select?.name;
      const newStatus = newProperties['Library Status']?.select?.name;
      if (existingStatus !== newStatus) changed.push('Library Status');
    }

    return changed;
  } catch (error) {
    // If we can't determine, assume everything changed
    return ['(unknown)'];
  }
};

/**
 * Check if page properties have changed
 * Returns true if update is needed
 */
const hasPropertiesChanged = (
  existingPage: any,
  newProperties: any,
  syncProperties: NotionSyncProperties,
): boolean =>
  getChangedProperties(existingPage, newProperties, syncProperties).length > 0;

/**
 * Extract canonical ID from a Notion page
 * Falls back to the title property if Canonical ID is not available
 */
const extractCanonicalId = (
  page: any,
  titleProperty: string,
): string | null => {
  try {
    // First, try to get the Canonical ID property
    const canonicalIdProp = page.properties['Canonical ID'];
    if (canonicalIdProp?.rich_text?.[0]?.text?.content) {
      return canonicalIdProp.rich_text[0].text.content;
    }

    // Fallback: generate from title (matching generateCanonicalId logic)
    const titleProp = page.properties[titleProperty];
    if (titleProp?.title?.[0]?.text?.content) {
      const name = titleProp.title[0].text.content;
      // Remove GOTY/Game of the Year Edition (same normalization as generateCanonicalId)
      const normalized = name
        .toLowerCase()
        .replace(/\s+(goty|game of the year edition)\s*$/i, '')
        .trim();

      // Generate slug (same as generateCanonicalId)
      return normalized
        .replace(/[^a-z0-9]/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '');
    }

    return null;
  } catch {
    return null;
  }
};

/**
 * Convert UnifiedGame to Notion properties
 * Only includes properties that are enabled in syncProperties config
 */
const gameToNotionProperties = (
  game: UnifiedGame,
  titleProperty: string,
  syncProperties: NotionSyncProperties,
): Partial<NotionGameProperties> => {
  const properties: Partial<NotionGameProperties> = {
    [titleProperty]: {
      title: [{ text: { content: cleanDisplayName(game.name) } }],
    },
  };

  if (syncProperties.canonicalId) {
    properties['Canonical ID'] = {
      rich_text: [{ text: { content: game.canonicalId } }],
    };
  }

  if (syncProperties.primarySource) {
    properties['Primary Source'] = {
      select: { name: capitalizeSource(game.primarySource) },
    };
  }

  if (syncProperties.ownedOn) {
    properties['Owned On'] = {
      multi_select: game.ownedSources.map(source => ({
        name: capitalizeSource(source),
      })),
    };
  }

  if (syncProperties.steamAppId) {
    properties['Steam App ID'] = {
      number: game.steamAppId || null,
    };
  }

  if (syncProperties.playtime) {
    properties['Playtime (hours)'] = {
      number: game.playtimeHours
        ? Math.round(game.playtimeHours * 10) / 10
        : null,
    };
  }

  if (syncProperties.lastPlayed) {
    properties['Last Played'] = game.lastPlayedAt
      ? {
          date: { start: game.lastPlayedAt.toISOString().split('T')[0] },
        }
      : { date: null };
  }

  if (syncProperties.protonTier) {
    properties['Proton Tier'] = game.proton
      ? { select: { name: capitalizeFirst(game.proton.tier) } }
      : { select: null };
  }

  if (syncProperties.steamDeck) {
    properties['Steam Deck'] = game.proton
      ? { select: { name: capitalizeFirst(game.proton.steamDeck) } }
      : { select: null };
  }

  if (syncProperties.coverImage) {
    properties['Cover Image'] = {
      url: game.coverImageUrl || null,
    };
  }

  if (syncProperties.libraryStatus) {
    // Active games have no status (empty = clean card in Notion)
    properties['Library Status'] = {
      select: null,
    };
  }

  return properties;
};

/**
 * Fetch all pages from the database
 */
const fetchAllPages = async (
  client: Client,
  databaseId: string,
): Promise<Array<{ id: string; properties: any }>> => {
  const pages: Array<{ id: string; properties: any }> = [];
  let cursor: string | undefined;

  do {
    const response: any = await client.databases.query({
      database_id: databaseId,
      start_cursor: cursor,
      page_size: 100,
    });

    pages.push(...response.results);
    cursor = response.next_cursor;
  } while (cursor);

  return pages;
};

/**
 * Create a new page in the Notion database
 */
const createPage = async (
  client: Client,
  databaseId: string,
  game: UnifiedGame,
  titleProperty: string,
  syncProperties: NotionSyncProperties,
): Promise<void> => {
  await client.pages.create({
    parent: { database_id: databaseId },
    properties: gameToNotionProperties(
      game,
      titleProperty,
      syncProperties,
    ) as any,
  });
};

/**
 * Update an existing Notion page
 */
const updatePage = async (
  client: Client,
  pageId: string,
  game: UnifiedGame,
  titleProperty: string,
  syncProperties: NotionSyncProperties,
): Promise<void> => {
  await client.pages.update({
    page_id: pageId,
    properties: gameToNotionProperties(
      game,
      titleProperty,
      syncProperties,
    ) as any,
  });
};

/**
 * Build lookup maps from existing pages
 */
const buildLookupMaps = (
  existingPages: Array<{ id: string; properties: any }>,
  titleProperty: string,
) => {
  const existingById = new Map<string, any>();
  const existingByCanonicalId = new Map<string, any>();
  const existingByTitle = new Map<string, any>();
  const variantPages = new Map<string, any[]>(); // Map canonical name -> array of variant pages

  for (const page of existingPages) {
    existingById.set(page.id, page);

    const canonicalIdProp = page.properties['Canonical ID'];
    if (canonicalIdProp?.rich_text?.[0]?.text?.content) {
      const canonicalId = canonicalIdProp.rich_text[0].text.content;
      existingByCanonicalId.set(canonicalId, page);
    }

    const titleProp = page.properties[titleProperty];
    if (titleProp?.title?.[0]?.text?.content) {
      const title = titleProp.title[0].text.content;
      const titleKey = title.toLowerCase();
      existingByTitle.set(titleKey, page);
      debug(`Indexed page by title: "${title}"`);

      // Also check if this title matches a merge rule variant
      const canonicalName = getCanonicalNameFromVariant(title);
      if (canonicalName) {
        const canonicalKey = canonicalName.toLowerCase();

        // Track variant pages for later marking as removed
        if (title !== canonicalName) {
          if (!variantPages.has(canonicalKey)) {
            variantPages.set(canonicalKey, []);
          }
          variantPages.get(canonicalKey)!.push(page);
          debug(`  Tracked as variant of "${canonicalName}"`);
        }

        // Only index by canonical name if we don't already have an exact match
        // This ensures "Sniper Elite 4" is preferred over "Sniper Elite 4 Digital Deluxe Edition"
        if (!existingByTitle.has(canonicalKey) || titleKey === canonicalKey) {
          existingByTitle.set(canonicalKey, page);
          debug(`  Also indexed by canonical name: "${canonicalName}"`);
        } else {
          debug(
            `  Not indexing by canonical name (exact match already exists)`,
          );
        }
      }
    }
  }
  return { existingById, existingByCanonicalId, existingByTitle, variantPages };
};

/**
 * Sync a single game to Notion
 * Returns sync result: 'created', 'updated', 'skipped', or 'error'
 * Also marks the page as processed in the tracker
 */
const syncSingleGame = async (
  client: Client,
  databaseId: string,
  game: UnifiedGame,
  titleProperty: string,
  syncProperties: NotionSyncProperties,
  existingByCanonicalId: Map<string, any>,
  existingByTitle: Map<string, any>,
  variantPages: Map<string, any[]>,
  processedPages: Set<string>,
  dryRun: boolean,
  tracker?: SyncOperations,
): Promise<'created' | 'updated' | 'skipped' | 'error'> => {
  try {
    let existingPage = null;

    debug(`Looking up game: "${game.name}" (ID: ${game.canonicalId})`);

    if (syncProperties.canonicalId) {
      existingPage = existingByCanonicalId.get(game.canonicalId);
      if (existingPage) {
        debug(`  ✓ Found by canonical ID: ${game.canonicalId}`);
      }
    }

    if (!existingPage) {
      const lookupKey = game.name.toLowerCase();
      existingPage = existingByTitle.get(lookupKey);
      if (existingPage) {
        debug(`  ✓ Found by title: "${lookupKey}"`);
      } else {
        debug(`  ✗ Not found by title: "${lookupKey}"`);
      }
    }

    // Mark any variant pages as removed
    const variants = variantPages.get(game.name.toLowerCase());
    if (variants && variants.length > 0) {
      for (const variantPage of variants) {
        // Skip if this is the page we're about to update
        if (existingPage && variantPage.id === existingPage.id) {
          continue;
        }

        // Mark variant as removed and track it as processed
        processedPages.add(variantPage.id);
        const variantTitle =
          variantPage.properties[titleProperty]?.title?.[0]?.text?.content ||
          'Unknown';
        debug(`  Marking variant "${variantTitle}" as removed`);

        try {
          if (dryRun) {
            console.log(
              `  [DRY RUN] Would mark variant "${variantTitle}" as removed`,
            );
          } else {
            await client.pages.update({
              page_id: variantPage.id,
              properties: {
                'Library Status': { select: { name: '⚠️ Removed' } },
              },
            });
          }
        } catch (error) {
          console.error(
            `Failed to mark variant page ${variantTitle} as removed:`,
            error,
          );
        }
      }
    }

    if (existingPage) {
      // Mark this page as processed (still in library)
      processedPages.add(existingPage.id);

      const newProperties = gameToNotionProperties(
        game,
        titleProperty,
        syncProperties,
      );

      const changedFields = getChangedProperties(
        existingPage,
        newProperties,
        syncProperties,
      );

      // Also check if we need to clear the "removed" status
      const currentStatus =
        existingPage.properties['Library Status']?.select?.name;
      const needsStatusClear =
        syncProperties.libraryStatus && currentStatus === '⚠️ Removed';

      if (changedFields.length > 0 || needsStatusClear) {
        if (dryRun) {
          const fieldList = needsStatusClear
            ? [...changedFields, 'Library Status (restore)']
            : changedFields;
          console.log(`  [UPDATE] ${game.name} → ${fieldList.join(', ')}`);
        } else {
          await updatePage(
            client,
            existingPage.id,
            game,
            titleProperty,
            syncProperties,
          );
        }
        if (tracker) syncLogger.trackUpdated(tracker, game);
        return 'updated';
      } else {
        if (tracker) syncLogger.trackSkipped(tracker);
        return 'skipped';
      }
    } else {
      if (dryRun) {
        console.log(`  [CREATE] ${game.name}`);
      } else {
        await createPage(
          client,
          databaseId,
          game,
          titleProperty,
          syncProperties,
        );
      }
      if (tracker) syncLogger.trackAdded(tracker, game);
      return 'created';
    }
  } catch (error) {
    console.error(`Failed to sync game "${game.name}":`, error);
    if (tracker) syncLogger.trackError(tracker);
    return 'error';
  }
};

/**
 * Mark games not in current library as removed.
 * Only processes pages that weren't synced (not in processedPages).
 *
 * When gamePassCatalogTitles is provided:
 * - Pages whose normalized title is still in the Game Pass catalog are NOT
 *   marked removed (the game is still available; the user just removed interest).
 * - Pages that were previously marked removed but whose title is now back in
 *   the catalog have their removed status cleared.
 */
const markRemovedGames = async (
  client: Client,
  existingById: Map<string, any>,
  processedPages: Set<string>,
  titleProperty: string,
  dryRun: boolean,
  gamePassCatalogTitles?: Set<string>,
  tracker?: SyncOperations,
): Promise<{ marked: number }> => {
  console.log('\n🔍 Checking for removed games...');

  const unprocessedPages = Array.from(existingById.entries()).filter(
    ([pageId]) => !processedPages.has(pageId),
  );

  console.log(`  Games not in current library: ${unprocessedPages.length}`);

  if (unprocessedPages.length === 0) {
    console.log(`  ✅ No removed games detected`);
    return { marked: 0 };
  }

  let marked = 0;
  const BATCH_SIZE = 3;

  for (let i = 0; i < unprocessedPages.length; i += BATCH_SIZE) {
    const batch = unprocessedPages.slice(i, i + BATCH_SIZE);

    await Promise.all(
      batch.map(async ([pageId, existingPage]) => {
        try {
          const titleProp = existingPage.properties[titleProperty];
          const gameTitle = titleProp?.title?.[0]?.text?.content || 'Unknown';
          const currentStatus =
            existingPage.properties['Library Status']?.select?.name;

          const stillInGamePass =
            gamePassCatalogTitles !== undefined &&
            gamePassCatalogTitles.has(normalizeGameName(gameTitle));

          if (stillInGamePass) {
            // Game is still available on Game Pass — user just removed it from
            // interests. Don't mark it removed.
            if (currentStatus === '⚠️ Removed') {
              // Game returned to the catalog after a previous removal. Restore
              // its status to active.
              debug(
                `  ✅ Restoring status for "${gameTitle}" (back in Game Pass catalog)`,
              );
              if (!dryRun) {
                await client.pages.update({
                  page_id: pageId,
                  properties: { 'Library Status': { select: null } },
                });
              }
            }
            return;
          }

          if (currentStatus !== '⚠️ Removed') {
            const canonicalId = extractCanonicalId(existingPage, titleProperty);
            if (dryRun) {
              console.log(
                `  [REMOVE] "${gameTitle}"${canonicalId ? ` (ID: ${canonicalId})` : ''}`,
              );
            } else {
              console.log(
                `  ⚠️  Marking as removed: "${gameTitle}"${
                  canonicalId ? ` (ID: ${canonicalId})` : ''
                }`,
              );
              await client.pages.update({
                page_id: pageId,
                properties: {
                  'Library Status': { select: { name: '⚠️ Removed' } },
                },
              });
            }
            if (tracker) syncLogger.trackRemoved(tracker, gameTitle);
            marked++;
          }
        } catch (error) {
          console.error(`Failed to mark page ${pageId} as removed:`, error);
        }
      }),
    );

    // Rate limiting between batches
    if (i + BATCH_SIZE < unprocessedPages.length) {
      await sleep(1000);
    }
  }

  console.log(`  ✅ Marked ${marked} games as removed`);
  return { marked };
};

/**
 * Sync unified games to Notion database
 * Creates new pages and updates existing ones
 */
const syncGames = async (
  client: Client,
  databaseId: string,
  games: UnifiedGame[],
  titleProperty: string,
  syncProperties: NotionSyncProperties,
  dryRun: boolean,
  gamePassCatalogTitles?: Set<string>,
): Promise<void> => {
  if (dryRun) {
    console.log('🏃 DRY RUN — no changes will be written to Notion\n');
  }
  console.log(`Syncing ${games.length} games to Notion...`);

  // Initialize sync tracker
  const { operations, startTime } = syncLogger.createSyncTracker();

  const existingPages = await fetchAllPages(client, databaseId);
  const { existingById, existingByCanonicalId, existingByTitle, variantPages } =
    buildLookupMaps(existingPages, titleProperty);

  console.log(`Found ${existingPages.length} existing pages in Notion`);

  let created = 0;
  let updated = 0;
  let skipped = 0;
  let errors = 0;
  const total = games.length;
  const BATCH_SIZE = 3;

  // Track which pages we've processed (still in library)
  const processedPages = new Set<string>();

  for (let i = 0; i < games.length; i += BATCH_SIZE) {
    const batch = games.slice(i, i + BATCH_SIZE);

    const results = await Promise.all(
      batch.map(game =>
        syncSingleGame(
          client,
          databaseId,
          game,
          titleProperty,
          syncProperties,
          existingByCanonicalId,
          existingByTitle,
          variantPages,
          processedPages,
          dryRun,
          operations,
        ),
      ),
    );

    for (const result of results) {
      if (result === 'created') created++;
      else if (result === 'updated') updated++;
      else if (result === 'skipped') skipped++;
      else if (result === 'error') errors++;
    }

    const processed = Math.min(i + BATCH_SIZE, total);
    if (processed % 25 === 0 || processed === total) {
      console.log(
        `  Progress: ${processed}/${total} games (${created} created, ${updated} updated, ${skipped} skipped, ${errors} errors)`,
      );
    }

    if (!dryRun && i + BATCH_SIZE < games.length) {
      await sleep(1000);
    }
  }

  if (syncProperties.libraryStatus) {
    await markRemovedGames(
      client,
      existingById,
      processedPages,
      titleProperty,
      dryRun,
      gamePassCatalogTitles,
      operations,
    );
  }

  const verb = dryRun ? 'Would' : '';
  console.log(
    dryRun
      ? `\n📊 Dry run summary: ${created} would be created, ${updated} would be updated, ${skipped} unchanged, ${errors} errors`
      : `✅ Sync complete: ${created} created, ${updated} updated, ${skipped} skipped, ${errors} errors`,
  );

  if (!dryRun) {
    // Save and print log summary
    syncLogger.printSyncSummary(operations, startTime);
    const logPath = await syncLogger.saveSyncLog(operations, startTime);
    console.log(`📝 Log saved to: ${logPath}`);
  }
};

/**
 * Verify database exists and is accessible
 */
const verifyDatabase = async (
  client: Client,
  databaseId: string,
): Promise<boolean> => {
  try {
    await client.databases.retrieve({ database_id: databaseId });
    return true;
  } catch (error) {
    console.error('Failed to access Notion database:', error);
    return false;
  }
};

/**
 * Create a Notion client instance
 * Uses factory pattern to maintain the Notion SDK client across calls
 */
export const createNotionClient = (
  apiKey: string,
  databaseId: string,
  titleProperty: string,
  syncProperties: NotionSyncProperties,
  dryRun: boolean = false,
) => {
  const client = new Client({ auth: apiKey });

  return {
    syncGames: (games: UnifiedGame[], gamePassCatalogTitles?: Set<string>) =>
      syncGames(
        client,
        databaseId,
        games,
        titleProperty,
        syncProperties,
        dryRun,
        gamePassCatalogTitles,
      ),
    verifyDatabase: () => verifyDatabase(client, databaseId),
  };
};
