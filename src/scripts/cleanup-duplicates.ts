import { Client } from '@notionhq/client';
import { loadConfig } from '../config';

/**
 * Cleanup script to remove duplicate game entries from Notion
 * Keeps the oldest entry for each game (by Canonical ID or Name)
 */

const sleep = (ms: number): Promise<void> => {
  return new Promise(resolve => setTimeout(resolve, ms));
};

const cleanupDuplicates = async () => {
  console.log('🧹 Starting duplicate cleanup...\n');

  const config = loadConfig();
  const client = new Client({ auth: config.notion.apiKey });
  const databaseId = config.notion.databaseId;
  const titleProperty = config.notion.titleProperty;

  // Fetch all pages
  console.log('📥 Fetching all pages from Notion...');
  const pages: Array<{ id: string; properties: any; created_time: string }> =
    [];
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

  console.log(`Found ${pages.length} total pages\n`);

  // Group pages by identifier (Canonical ID or Name)
  const pagesByIdentifier = new Map<
    string,
    Array<{ id: string; created_time: string }>
  >();

  for (const page of pages) {
    let identifier: string | null = null;

    // Try Canonical ID first
    const canonicalIdProp = page.properties['Canonical ID'];
    if (canonicalIdProp?.rich_text?.[0]?.text?.content) {
      identifier = canonicalIdProp.rich_text[0].text.content;
    } else {
      // Fallback to title
      const titleProp = page.properties[titleProperty];
      if (titleProp?.title?.[0]?.text?.content) {
        identifier = titleProp.title[0].text.content;
      }
    }

    if (identifier) {
      if (!pagesByIdentifier.has(identifier)) {
        pagesByIdentifier.set(identifier, []);
      }
      pagesByIdentifier
        .get(identifier)!
        .push({ id: page.id, created_time: page.created_time });
    }
  }

  // Find duplicates
  const duplicates: string[] = [];
  let keptCount = 0;

  for (const [identifier, entries] of pagesByIdentifier.entries()) {
    if (entries.length > 1) {
      // Sort by creation time (oldest first)
      entries.sort(
        (a, b) =>
          new Date(a.created_time).getTime() -
          new Date(b.created_time).getTime()
      );

      // Keep the first (oldest), mark the rest for deletion
      console.log(
        `Found ${
          entries.length
        } duplicates for "${identifier}" - keeping oldest, deleting ${
          entries.length - 1
        }`
      );
      keptCount++;

      for (let i = 1; i < entries.length; i++) {
        duplicates.push(entries[i].id);
      }
    }
  }

  if (duplicates.length === 0) {
    console.log('\n✅ No duplicates found!');
    return;
  }

  console.log(`\n📊 Summary:`);
  console.log(`   • Total unique games: ${pagesByIdentifier.size}`);
  console.log(`   • Games with duplicates: ${keptCount}`);
  console.log(`   • Pages to delete: ${duplicates.length}`);

  console.log('\n🗑️  Deleting duplicate pages...');

  let deleted = 0;
  for (const pageId of duplicates) {
    try {
      await client.pages.update({
        page_id: pageId,
        archived: true,
      });
      deleted++;

      if (deleted % 10 === 0) {
        console.log(`  Progress: ${deleted}/${duplicates.length} deleted...`);
      }

      // Rate limiting: 3 requests per second
      if (deleted % 3 === 0) {
        await sleep(1000);
      }
    } catch (error) {
      console.error(`Failed to delete page ${pageId}:`, error);
    }
  }

  console.log(`\n✅ Cleanup complete!`);
  console.log(`   • Deleted: ${deleted} duplicate pages`);
  console.log(`   • Remaining: ${pages.length - deleted} unique games`);
};

cleanupDuplicates().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
