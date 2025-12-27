import { Client } from '@notionhq/client';
import { UnifiedGame } from '../types/game';

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
 * Extract canonical ID from a Notion page
 */
const extractCanonicalId = (page: any): string | null => {
  try {
    const canonicalIdProp = page.properties['Canonical ID'];
    if (canonicalIdProp?.rich_text?.[0]?.text?.content) {
      return canonicalIdProp.rich_text[0].text.content;
    }
    return null;
  } catch {
    return null;
  }
};

/**
 * Convert UnifiedGame to Notion properties
 */
const gameToNotionProperties = (
  game: UnifiedGame
): Partial<NotionGameProperties> => {
  return {
    Name: {
      title: [{ text: { content: game.name } }],
    },
    'Canonical ID': {
      rich_text: [{ text: { content: game.canonicalId } }],
    },
    'Primary Source': {
      select: { name: capitalizeSource(game.primarySource) },
    },
    'Owned On': {
      multi_select: game.ownedSources.map(source => ({
        name: capitalizeSource(source),
      })),
    },
    'Steam App ID': {
      number: game.steamAppId || null,
    },
    'Playtime (hours)': {
      number: game.playtimeHours
        ? Math.round(game.playtimeHours * 10) / 10
        : null,
    },
    'Last Played': game.lastPlayedAt
      ? {
          date: { start: game.lastPlayedAt.toISOString().split('T')[0] },
        }
      : { date: null },
    'Proton Tier': game.proton
      ? { select: { name: capitalizeFirst(game.proton.tier) } }
      : { select: null },
    'Steam Deck': game.proton
      ? { select: { name: capitalizeFirst(game.proton.steamDeck) } }
      : { select: null },
    'Cover Image': {
      url: game.coverImageUrl || null,
    },
  };
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
  game: UnifiedGame
): Promise<void> => {
  await client.pages.create({
    parent: { database_id: databaseId },
    properties: gameToNotionProperties(game) as any,
    cover: game.coverImageUrl
      ? { type: 'external', external: { url: game.coverImageUrl } }
      : undefined,
  });
};

/**
 * Update an existing Notion page
 */
const updatePage = async (
  client: Client,
  pageId: string,
  game: UnifiedGame
): Promise<void> => {
  await client.pages.update({
    page_id: pageId,
    properties: gameToNotionProperties(game) as any,
    cover: game.coverImageUrl
      ? { type: 'external', external: { url: game.coverImageUrl } }
      : undefined,
  });
};

/**
 * Sync unified games to Notion database
 * Creates new pages and updates existing ones
 */
const syncGames = async (
  client: Client,
  databaseId: string,
  games: UnifiedGame[]
): Promise<void> => {
  console.log(`Syncing ${games.length} games to Notion...`);

  // Fetch existing pages to avoid duplicates
  const existingPages = await fetchAllPages(client, databaseId);
  const existingByCanonicalId = new Map(
    existingPages.map(page => [extractCanonicalId(page), page])
  );

  console.log(`Found ${existingPages.length} existing pages in Notion`);

  let created = 0;
  let updated = 0;
  let errors = 0;

  for (const game of games) {
    try {
      const existingPage = existingByCanonicalId.get(game.canonicalId);

      if (existingPage) {
        // Update existing page
        await updatePage(client, existingPage.id, game);
        updated++;
      } else {
        // Create new page
        await createPage(client, databaseId, game);
        created++;
      }

      // Rate limiting: Notion has a rate limit of 3 requests per second
      if ((created + updated) % 3 === 0) {
        await sleep(1000);
      }
    } catch (error) {
      console.error(`Failed to sync game "${game.name}":`, error);
      errors++;
    }
  }

  console.log(
    `Sync complete: ${created} created, ${updated} updated, ${errors} errors`
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
export const createNotionClient = (apiKey: string, databaseId: string) => {
  const client = new Client({ auth: apiKey });

  return {
    syncGames: (games: UnifiedGame[]) => syncGames(client, databaseId, games),
    verifyDatabase: () => verifyDatabase(client, databaseId),
  };
};
