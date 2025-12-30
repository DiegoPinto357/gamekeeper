# GameKeeper 🎮

A personal game library aggregator focused on **visibility and decision-making** across multiple platforms.

## Overview

GameKeeper helps you avoid forgetting games you own or want to play by aggregating your game library from multiple sources into a single, deduplicated list synchronized to Notion.

### Key Features

- ✅ Aggregates games from Steam, Epic, GOG, Amazon, and Xbox
- ✅ **Smart Xbox Game Pass filtering** - Owned games always synced, Game Pass games filtered by interest + availability
- ✅ Intelligent deduplication with platform priority (Steam > Xbox > Epic > GOG > Amazon)
- ✅ ProtonDB integration for PC games (Steam Deck compatibility)
- ✅ Disk-based caching for API responses (ProtonDB: 30 days, Game Pass: 7 days)
- ✅ Idempotent Notion sync (safe to run multiple times)
- ✅ Clean TypeScript architecture with Zod validation

## Architecture Principles

### Data Sources

1. **Steam** - Live API (primary metadata source for PC games)
2. **Epic/GOG/Amazon/Xbox** - Snapshot from Playnite export (no direct API calls)
3. **Xbox Game Pass** - Live catalog API (cached for 7 days) + manual interest curation
4. **ProtonDB** - Enrichment data for PC games only (cached locally)
5. **Notion** - UI/visualization layer (never a source of truth)

### Platform Priority

When a game exists on multiple platforms, metadata comes from the highest priority source:

1. Steam
2. Xbox
3. Epic Games
4. GOG
5. Amazon
6. Game Pass
7. Manual

The highest priority platform becomes the **primary source**, but all ownership is preserved.

## Setup

### Prerequisites

- Node.js 20+
- npm or yarn
- Steam Web API key ([get one here](https://steamcommunity.com/dev/apikey))
- Notion integration ([create one here](https://www.notion.so/my-integrations))
- Playnite installed (for Epic/GOG/Xbox snapshots)

### Installation

```bash
# Install dependencies
npm install

# Copy environment template
cp .env.example .env

# Edit .env with your credentials
nano .env
```

### Environment Variables

Edit `.env` with your credentials:

```bash
# Steam Web API
STEAM_API_KEY=your_steam_api_key_here
STEAM_USER_ID=your_steam_id_here  # 64-bit Steam ID

# Notion Integration
NOTION_API_KEY=your_notion_api_key_here
NOTION_DATABASE_ID=your_database_id_here

# Optional: IGDB API Credentials (for matching non-Steam games to Steam App IDs)
# This enables ProtonDB enrichment for Epic/GOG/Amazon games
# Register app at: https://dev.twitch.tv/console/apps (Category: Other)
IGDB_CLIENT_ID=your_twitch_client_id_here
IGDB_CLIENT_SECRET=your_twitch_client_secret_here

# Optional: ProtonDB cache duration (days)
PROTONDB_CACHE_DAYS=30
```

### Getting IGDB API Credentials (Optional)

IGDB integration allows GameKeeper to find Steam App IDs for non-Steam games (Epic, GOG, Amazon), enabling ProtonDB enrichment for these platforms.

1. Go to [Twitch Developers Console](https://dev.twitch.tv/console/apps)
2. Click **Register Your Application**
3. Fill in:
   - **Name**: GameKeeper (or any name)
   - **OAuth Redirect URLs**: `http://localhost` (required but not used)
   - **Category**: Other
4. Click **Create**
5. Copy the **Client ID** → `IGDB_CLIENT_ID`
6. Click **New Secret** → Copy the secret → `IGDB_CLIENT_SECRET`

**Rate Limits**: Free tier provides 4 requests/second (sufficient for most personal libraries)

**What happens without IGDB?**

- Steam games: ✅ Full ProtonDB enrichment (unchanged)
- Epic/GOG/Amazon: ❌ No ProtonDB enrichment (unless game has known Steam App ID)

### Finding Your Steam ID

1. Go to [steamid.io](https://steamid.io/)
2. Enter your Steam profile URL
3. Copy the **steamID64** value

### Setting Up Notion Database

Create a new database in Notion with these properties:

| Property Name    | Type         | Description                    |
| ---------------- | ------------ | ------------------------------ |
| Name             | Title        | Game name                      |
| Canonical ID     | Text         | Unique identifier              |
| Primary Source   | Select       | Main platform (Steam, Xbox...) |
| Owned On         | Multi-select | All platforms where owned      |
| Steam App ID     | Number       | Steam AppID (if applicable)    |
| Playtime (hours) | Number       | Total playtime                 |
| Last Played      | Date         | Last played date               |
| Proton Tier      | Select       | ProtonDB compatibility         |
| Steam Deck       | Select       | Steam Deck verification status |
| Cover Image      | URL          | Game cover art                 |

Then share the database with your Notion integration.

### Exporting from Playnite

1. Open Playnite
2. Go to **Menu → Extensions → Scripts → Export Library**
3. Save as `data/playnite-export.json`

Or use the built-in export feature if available in your Playnite version.

## Usage

### Run Sync

```bash
# Development mode
npm run dev

# Production mode
npm run build
npm start
```

### View Game Pass Catalog

```bash
# List all games currently on Xbox Game Pass
npm run view-gamepass
```

This helps you find exact game titles to add to `data/gamepass-interests.json`.

### First Run

The first sync will:

1. Fetch all games from Steam
2. Load games from Playnite snapshot
3. Filter Xbox Game Pass games (owned games + curated interests)
4. Deduplicate based on Steam AppID or name matching
5. Enrich PC games with ProtonDB data (this may take time)
6. Create all games in Notion

### Subsequent Runs

Updates are idempotent - existing games are updated, new games are created.

## Project Structure

```
gamekeeper/
├── src/
│   ├── adapters/
│   │   ├── steam.adapter.ts       # Steam Web API integration
│   │   ├── playnite.adapter.ts    # Playnite JSON parser
│   │   └── protondb.adapter.ts    # ProtonDB API + caching
│   ├── core/
│   │   ├── normalize.ts           # Name normalization & matching
│   │   └── deduplicate.ts         # Deduplication & merging logic
│   ├── notion/
│   │   └── notion.client.ts       # Notion sync client
│   ├── types/
│   │   └── game.ts                # TypeScript types & Zod schemas
│   ├── config.ts                  # Configuration loader
│   └── index.ts                   # Main orchestration
├── data/
│   └── playnite-export.json       # Place Playnite export here
├── .cache/
│   └── protondb/                  # ProtonDB cache (auto-created)
└── package.json
```

## Data Model

### UnifiedGame

```typescript
interface UnifiedGame {
  canonicalId: string; // "steam:123456" or normalized slug
  name: string;
  primarySource: Source; // Highest priority platform
  ownedSources: Source[]; // All platforms where owned
  steamAppId?: number;
  playtimeHours?: number; // Sum of playtime across platforms
  lastPlayedAt?: Date;
  proton?: ProtonInfo; // PC games only
  coverImageUrl?: string;
  releaseDate?: Date;
  genres?: string[];
}
```

## ProtonDB Integration

- Only enriches games with Steam AppIDs
- Fetches both ProtonDB tier and Steam Deck verification
- Caches responses for 30 days (configurable)
- Gracefully handles missing data

## Deduplication Logic

1. **By Steam AppID** (most reliable)
   - If multiple sources have the same AppID, they're merged
2. **By normalized name** (fallback)
   - Fuzzy matching with 85% similarity threshold
   - Removes special characters, articles, edition suffixes

## Troubleshooting

### "Steam API error"

- Verify your Steam API key is correct
- Check your Steam ID is the 64-bit format (17 digits)
- Ensure your Steam profile is public

### "Cannot access Notion database"

- Verify your Notion integration has access to the database
- Check the database ID is correct (found in the database URL)

### "Playnite export not found"

- Ensure `data/playnite-export.json` exists
- Re-export from Playnite if the file is corrupted

### ProtonDB enrichment is slow

- This is normal on first run (one API call per Steam game)
- Subsequent runs use the cache
- You can adjust `PROTONDB_CACHE_DAYS` if needed

### Debugging sync issues

To enable detailed debug logging:

```bash
# Add to .env
LOG_LEVEL=debug

# Then run sync
npm start
```

Debug mode shows:

- Game lookup attempts by canonical ID and title
- Canonical name application during deduplication
- Title indexing in Notion pages

## Development

```bash
# Run in development mode with hot reload
npm run dev

# Build TypeScript
npm run build

# Run production build
npm start
```

## Additional Documentation

- **[Xbox Game Pass Integration](docs/GAMEPASS.md)** - Learn how owned Xbox games and Game Pass subscriptions are handled

## Roadmap

- [x] Game Pass catalog integration
- [x] Xbox Game Pass filtering with manual curation
- [ ] Manual game entry support
- [ ] Interest tracking for non-Game Pass games
- [ ] Backup/restore functionality
- [ ] Web dashboard (optional)

## Philosophy

This tool is designed to be:

- **Simple** - No complex real-time sync or social features
- **Robust** - Prefer stable APIs over reverse-engineered ones
- **Maintainable** - Clear separation of concerns
- **Idempotent** - Safe to run multiple times
- **Transparent** - Detailed logging of all operations

Notion is treated as a **UI layer only**. The source of truth is always Steam/Playnite, never Notion.

## License

ISC

## Author

Diego Pinto dos Santos
