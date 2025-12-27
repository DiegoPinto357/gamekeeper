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
}

/**
 * Notion client for syncing game library
 */
export class NotionClient {
  private client: Client;
  private databaseId: string;

  constructor(apiKey: string, databaseId: string) {
    this.client = new Client({ auth: apiKey });
    this.databaseId = databaseId;
  }

  /**
   * Sync unified games to Notion database
   * Creates new pages and updates existing ones
   */
  async syncGames(games: UnifiedGame[]): Promise<void> {
    console.log(`Syncing ${games.length} games to Notion...`);

    // Fetch existing pages to avoid duplicates
    const existingPages = await this.fetchAllPages();
    const existingByCanonicalId = new Map(
      existingPages.map(page => [this.extractCanonicalId(page), page])
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
          await this.updatePage(existingPage.id, game);
          updated++;
        } else {
          // Create new page
          await this.createPage(game);
          created++;
        }

        // Rate limiting: Notion has a rate limit of 3 requests per second
        if ((created + updated) % 3 === 0) {
          await this.sleep(1000);
        }
      } catch (error) {
        console.error(`Failed to sync game "${game.name}":`, error);
        errors++;
      }
    }

    console.log(
      `Sync complete: ${created} created, ${updated} updated, ${errors} errors`
    );
  }

  /**
   * Create a new page in the Notion database
   */
  private async createPage(game: UnifiedGame): Promise<void> {
    await this.client.pages.create({
      parent: { database_id: this.databaseId },
      properties: this.gameToNotionProperties(game) as any,
      cover: game.coverImageUrl
        ? { type: 'external', external: { url: game.coverImageUrl } }
        : undefined,
    });
  }

  /**
   * Update an existing Notion page
   */
  private async updatePage(pageId: string, game: UnifiedGame): Promise<void> {
    await this.client.pages.update({
      page_id: pageId,
      properties: this.gameToNotionProperties(game) as any,
      cover: game.coverImageUrl
        ? { type: 'external', external: { url: game.coverImageUrl } }
        : undefined,
    });
  }

  /**
   * Fetch all pages from the database
   */
  private async fetchAllPages(): Promise<
    Array<{ id: string; properties: any }>
  > {
    const pages: Array<{ id: string; properties: any }> = [];
    let cursor: string | undefined;

    do {
      const response: any = await this.client.databases.query({
        database_id: this.databaseId,
        start_cursor: cursor,
        page_size: 100,
      });

      pages.push(...response.results);
      cursor = response.next_cursor;
    } while (cursor);

    return pages;
  }

  /**
   * Extract canonical ID from a Notion page
   */
  private extractCanonicalId(page: any): string | null {
    try {
      const canonicalIdProp = page.properties['Canonical ID'];
      if (canonicalIdProp?.rich_text?.[0]?.text?.content) {
        return canonicalIdProp.rich_text[0].text.content;
      }
      return null;
    } catch {
      return null;
    }
  }

  /**
   * Convert UnifiedGame to Notion properties
   */
  private gameToNotionProperties(
    game: UnifiedGame
  ): Partial<NotionGameProperties> {
    return {
      Name: {
        title: [{ text: { content: game.name } }],
      },
      'Canonical ID': {
        rich_text: [{ text: { content: game.canonicalId } }],
      },
      'Primary Source': {
        select: { name: this.capitalizeSource(game.primarySource) },
      },
      'Owned On': {
        multi_select: game.ownedSources.map(source => ({
          name: this.capitalizeSource(source),
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
        ? { select: { name: this.capitalizeFirst(game.proton.tier) } }
        : { select: null },
      'Steam Deck': game.proton
        ? { select: { name: this.capitalizeFirst(game.proton.steamDeck) } }
        : { select: null },
      'Cover Image': {
        url: game.coverImageUrl || null,
      },
    };
  }

  /**
   * Capitalize source name for display
   */
  private capitalizeSource(source: string): string {
    const map: Record<string, string> = {
      steam: 'Steam',
      xbox: 'Xbox',
      epic: 'Epic Games',
      gog: 'GOG',
      gamepass: 'Game Pass',
      manual: 'Manual',
    };
    return map[source] || source;
  }

  /**
   * Capitalize first letter
   */
  private capitalizeFirst(str: string): string {
    return str.charAt(0).toUpperCase() + str.slice(1);
  }

  /**
   * Sleep helper for rate limiting
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Verify database exists and is accessible
   */
  async verifyDatabase(): Promise<boolean> {
    try {
      await this.client.databases.retrieve({ database_id: this.databaseId });
      return true;
    } catch (error) {
      console.error('Failed to access Notion database:', error);
      return false;
    }
  }
}
