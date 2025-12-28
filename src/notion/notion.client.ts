import { Client } from '@notionhq/client';
import { UnifiedGame, NotionSyncProperties } from '../types/game';

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
 * Sleep helper for rate limiting
 */
const sleep = (ms: number): Promise<void> => {
  return new Promise(resolve => setTimeout(resolve, ms));
};

/**
 * Check if page properties have changed
 * Returns true if update is needed
 */
const hasPropertiesChanged = (
  existingPage: any,
  newProperties: any,
  syncProperties: NotionSyncProperties
): boolean => {
  try {
    const existing = existingPage.properties;

    // Check each synced property for changes
    if (syncProperties.primarySource) {
      const existingSource = existing['Primary Source']?.select?.name;
      const newSource = newProperties['Primary Source']?.select?.name;
      if (existingSource !== newSource) return true;
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
      if (existingOwned !== newOwned) return true;
    }

    if (syncProperties.steamAppId) {
      const existingSteam = existing['Steam App ID']?.number;
      const newSteam = newProperties['Steam App ID']?.number;
      if (existingSteam !== newSteam) return true;
    }

    if (syncProperties.playtime) {
      const existingPlaytime = existing['Playtime (hours)']?.number;
      const newPlaytime = newProperties['Playtime (hours)']?.number;
      if (existingPlaytime !== newPlaytime) return true;
    }

    if (syncProperties.lastPlayed) {
      const existingDate = existing['Last Played']?.date?.start;
      const newDate = newProperties['Last Played']?.date?.start;
      if (existingDate !== newDate) return true;
    }

    if (syncProperties.protonTier) {
      const existingTier = existing['Proton Tier']?.select?.name;
      const newTier = newProperties['Proton Tier']?.select?.name;
      if (existingTier !== newTier) return true;
    }

    if (syncProperties.steamDeck) {
      const existingDeck = existing['Steam Deck']?.select?.name;
      const newDeck = newProperties['Steam Deck']?.select?.name;
      if (existingDeck !== newDeck) return true;
    }

    if (syncProperties.coverImage) {
      const existingCover = existing['Cover Image']?.url;
      const newCover = newProperties['Cover Image']?.url;
      if (existingCover !== newCover) return true;
    }

    if (syncProperties.canonicalId) {
      const existingId =
        existing['Canonical ID']?.rich_text?.[0]?.text?.content;
      const newId =
        newProperties['Canonical ID']?.rich_text?.[0]?.text?.content;
      if (existingId !== newId) return true;
    }

    return false;
  } catch (error) {
    // If we can't determine, assume it changed
    return true;
  }
};

/**
 * Extract canonical ID from a Notion page
 * Falls back to the title property if Canonical ID is not available
 */
const extractCanonicalId = (
  page: any,
  titleProperty: string
): string | null => {
  try {
    // First, try to get the Canonical ID property
    const canonicalIdProp = page.properties['Canonical ID'];
    if (canonicalIdProp?.rich_text?.[0]?.text?.content) {
      return canonicalIdProp.rich_text[0].text.content;
    }

    // Fallback: use the title property as identifier
    const titleProp = page.properties[titleProperty];
    if (titleProp?.title?.[0]?.text?.content) {
      // Generate a canonical ID from the title (same logic as in deduplicate.ts)
      const name = titleProp.title[0].text.content;
      const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
      return `manual:${slug}`;
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
  syncProperties: NotionSyncProperties
): Partial<NotionGameProperties> => {
  const properties: Partial<NotionGameProperties> = {
    [titleProperty]: {
      title: [{ text: { content: game.name } }],
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

  return properties;
};

/**
 * Fetch all pages from the database
 */
const fetchAllPages = async (
  client: Client,
  databaseId: string
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
  syncProperties: NotionSyncProperties
): Promise<void> => {
  await client.pages.create({
    parent: { database_id: databaseId },
    properties: gameToNotionProperties(
      game,
      titleProperty,
      syncProperties
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
  syncProperties: NotionSyncProperties
): Promise<void> => {
  await client.pages.update({
    page_id: pageId,
    properties: gameToNotionProperties(
      game,
      titleProperty,
      syncProperties
    ) as any,
  });
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
  syncProperties: NotionSyncProperties
): Promise<void> => {
  console.log(`Syncing ${games.length} games to Notion...`);

  // Fetch existing pages to avoid duplicates
  const existingPages = await fetchAllPages(client, databaseId);

  // Build lookup maps based on what's available
  const existingByCanonicalId = new Map<string, any>();
  const existingByTitle = new Map<string, any>();

  for (const page of existingPages) {
    // Try to extract Canonical ID
    const canonicalIdProp = page.properties['Canonical ID'];
    if (canonicalIdProp?.rich_text?.[0]?.text?.content) {
      const canonicalId = canonicalIdProp.rich_text[0].text.content;
      existingByCanonicalId.set(canonicalId, page);
    }

    // Always extract title for fallback matching
    const titleProp = page.properties[titleProperty];
    if (titleProp?.title?.[0]?.text?.content) {
      const title = titleProp.title[0].text.content.toLowerCase();
      existingByTitle.set(title, page);
    }
  }

  console.log(`Found ${existingPages.length} existing pages in Notion`);

  let created = 0;
  let updated = 0;
  let skipped = 0;
  let errors = 0;
  const total = games.length;

  // Process games in batches of 3 (Notion rate limit: 3 req/sec)
  const BATCH_SIZE = 3;

  for (let i = 0; i < games.length; i += BATCH_SIZE) {
    const batch = games.slice(i, i + BATCH_SIZE);

    // Process batch in parallel
    await Promise.all(
      batch.map(async game => {
        try {
          // Try to find existing page:
          // 1. First by Canonical ID (if it's being synced)
          // 2. Fallback to title match
          let existingPage = null;

          if (syncProperties.canonicalId) {
            existingPage = existingByCanonicalId.get(game.canonicalId);
          }

          if (!existingPage) {
            existingPage = existingByTitle.get(game.name.toLowerCase());
          }

          if (existingPage) {
            // Check if update is needed
            const newProperties = gameToNotionProperties(
              game,
              titleProperty,
              syncProperties
            );

            const needsUpdate = hasPropertiesChanged(
              existingPage,
              newProperties,
              syncProperties
            );

            if (needsUpdate) {
              // Update existing page
              await updatePage(
                client,
                existingPage.id,
                game,
                titleProperty,
                syncProperties
              );
              updated++;
            } else {
              skipped++;
            }
          } else {
            // Create new page
            await createPage(
              client,
              databaseId,
              game,
              titleProperty,
              syncProperties
            );
            created++;
          }
        } catch (error) {
          console.error(`Failed to sync game "${game.name}":`, error);
          errors++;
        }
      })
    );

    // Progress indicator every batch or at completion
    const processed = Math.min(i + BATCH_SIZE, total);
    if (processed % 25 === 0 || processed === total) {
      console.log(
        `  Progress: ${processed}/${total} games (${created} created, ${updated} updated, ${skipped} skipped, ${errors} errors)`
      );
    }

    // Rate limiting: Sleep 1 second between batches (not after the last batch)
    if (i + BATCH_SIZE < games.length) {
      await sleep(1000);
    }
  }

  console.log(
    `✅ Sync complete: ${created} created, ${updated} updated, ${skipped} skipped, ${errors} errors`
  );
};

/**
 * Verify database exists and is accessible
 */
const verifyDatabase = async (
  client: Client,
  databaseId: string
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
  syncProperties: NotionSyncProperties
) => {
  const client = new Client({ auth: apiKey });

  return {
    syncGames: (games: UnifiedGame[]) =>
      syncGames(client, databaseId, games, titleProperty, syncProperties),
    verifyDatabase: () => verifyDatabase(client, databaseId),
  };
};
