# IGDB Integration

## Overview

GameKeeper uses IGDB (Internet Game Database) to find Steam App IDs for non-Steam games, enabling ProtonDB enrichment for games purchased on Epic Games Store, GOG, and Amazon Games.

## How It Works

1. **During Enrichment Phase**:

   - All PC games without a Steam App ID are checked against IGDB
   - IGDB searches for the game by name
   - If a match is found with a Steam ID, it's cached locally
   - The Steam App ID is added to the game object
   - ProtonDB can then fetch Linux compatibility data

2. **Caching Strategy**:

   - **Steam App ID Cache** (`.cache/steam-appid-cache.json`):
     - Permanent cache of game name → Steam App ID mappings
     - Successful matches (App ID found) are cached permanently
     - Failed lookups (no match) are cached with a timestamp
     - Failed lookups are retried after 30 days automatically
     - Prevents repeated API calls for the same games
   - **Auth Token Cache** (`.cache/igdb-token.json`):
     - Stores Twitch OAuth token
     - Auto-refreshes when expired
     - Valid for ~60 days

3. **Rate Limiting**:
   - Free tier: 4 requests/second
   - Implementation uses batches of 4 games with 1-second delays
   - Typical library (~100 non-Steam games) = ~25 seconds

## API Credentials

IGDB uses Twitch authentication (same parent company).

### Registration Steps

1. Visit https://dev.twitch.tv/console/apps
2. Click "Register Your Application"
3. Fill in:
   - **Name**: GameKeeper (or your preference)
   - **OAuth Redirect URLs**: `http://localhost`
   - **Category**: Other
4. Copy Client ID and Client Secret to `.env`

### Environment Variables

```bash
IGDB_CLIENT_ID=your_twitch_client_id_here
IGDB_CLIENT_SECRET=your_twitch_client_secret_here
```

## Matching Logic

IGDB searches for games and returns matches with external platform IDs:

1. **Exact Match** - `"Hades"` → `"Hades"`
2. **Normalized Match** - `"The Witcher 3: Wild Hunt"` → `"Witcher 3: Wild Hunt"`
3. **Best Match** - If multiple results, picks first with Steam ID

### What Gets Cached

**New Format (v2):**

```json
{
  "hades": {
    "appId": 1145360,
    "lastChecked": 1735574400000
  },
  "disco elysium": {
    "appId": 632470,
    "lastChecked": 1735574400000
  },
  "some obscure game": {
    "appId": null,
    "lastChecked": 1735574400000
  }
}
```

**Legacy Format (v1 - auto-migrated):**

```json
{
  "hades": 1145360,
  "disco elysium": 632470,
  "some obscure game": null
}
```

- **Key**: Lowercase, trimmed game name
- **Value Object**:
  - `appId`: Steam App ID (number) or `null` (not found)
  - `lastChecked`: Unix timestamp of last lookup
- **Retry Logic**: Games with `null` are automatically retried after 30 days
- **Migration**: Old cache format is automatically converted on load

## Benefits

### Before IGDB Integration

```
Epic/GOG/Amazon Games:
  ❌ No Steam App ID
  ❌ No ProtonDB enrichment
  ❌ No Linux compatibility info
  ❌ No Steam Deck verification status
```

### After IGDB Integration

```
Epic/GOG/Amazon Games:
  ✅ Steam App ID found via IGDB
  ✅ ProtonDB enrichment enabled
  ✅ Linux compatibility info available
  ✅ Steam Deck verification status
```

## Example Workflow

```
1. User owns "Hades" on Epic Games Store
   ├─ Playnite export includes game
   ├─ Initial state: no steamAppId
   └─ Source: "epic"

2. GameKeeper runs enrichment
   ├─ Detects PC game without Steam App ID
   ├─ Queries IGDB: "Hades"
   ├─ IGDB returns: Steam App ID 1145360
   ├─ Caches: {"hades": 1145360}
   └─ Updates game.steamAppId = 1145360

3. ProtonDB enrichment runs
   ├─ Game now has steamAppId
   ├─ Fetches ProtonDB data for 1145360
   ├─ Adds protonTier: "platinum"
   └─ Adds steamDeck: "verified"

4. Notion sync
   ├─ Game synced with full data
   ├─ Shows Epic as primary source
   └─ Includes ProtonDB compatibility
```

## Cache Management

### View Cache Stats

During sync, GameKeeper shows:

```
📊 IGDB Cache: 142 entries (128 matches, 14 not found)
   ⏰ 5 old failures were retried this run
```

**What this means:**

- **142 entries**: Total unique games checked against IGDB
- **128 matches**: Games successfully matched to Steam App IDs (permanent)
- **14 not found**: Games with no Steam version or not in IGDB database
- **5 old failures retried**: Null entries older than 30 days that were rechecked

### Clear Cache

To force re-lookup (e.g., if IGDB data improved):

```bash
rm .cache/steam-appid-cache.json
```

Next run will rebuild the cache.

### Manual Mappings

For games IGDB doesn't match correctly, add manual overrides to `data/overrides.json`:

```json
{
  "forceMerge": [],
  "canonicalNames": {},
  "manualSteamAppIds": {
    "Some Obscure Game": 123456
  }
}
```

## Troubleshooting

### IGDB Authentication Failed

```
⚠️  IGDB authentication failed
Steam App ID lookup for non-Steam games will be disabled.
```

**Causes**:

- Missing `IGDB_CLIENT_ID` or `IGDB_CLIENT_SECRET`
- Invalid credentials
- Network connectivity issues

**Solution**:

- Verify credentials in `.env`
- Check https://dev.twitch.tv/console/apps for valid app
- Sync will continue without IGDB (Steam games still enriched)

### Rate Limit Exceeded

```
IGDB API error for "Game Name": 429
```

**Causes**:

- More than 4 requests/second

**Solution**:

- Implementation already handles this - shouldn't occur
- If it does, increase `IGDB_DELAY` in `src/index.ts`

### No Matches Found

Some games may not be in IGDB or lack Steam IDs:

- **Reason**: Game exclusive to one platform
- **Result**: Cached as `null` to avoid repeated lookups
- **Impact**: Game won't get ProtonDB data (expected behavior)

## Performance

### Initial Sync

For a library with 100 non-Steam PC games:

```
Time: ~25-30 seconds
  - 4 requests/second
  - 1 second delay between batches
  - All results cached

API Calls: 100 (one per game)
```

### Subsequent Syncs

```
Time: ~0 seconds (cache hits)
API Calls: 0 (unless new games added)
```

### Adding New Games

Only new non-Steam games trigger IGDB lookups:

```
Added 5 new Epic games
  - 5 IGDB lookups
  - ~2 seconds
  - Results cached
```

## Privacy & Data

### What's Sent to IGDB

- Game names only (text search)
- No personal information
- No library details

### What's Stored Locally

- `.cache/igdb-token.json` - OAuth token (auto-managed)
- `.cache/steam-appid-cache.json` - Name → Steam ID mappings

### What's Stored in Notion

- Game data includes `steamAppId` field
- Shows actual Steam App ID number
- ProtonDB data derived from Steam App ID

## Optional Feature

IGDB integration is **completely optional**:

- ✅ GameKeeper works without it
- ✅ Steam games always get ProtonDB data
- ✅ Non-Steam games sync to Notion
- ❌ Non-Steam games won't get ProtonDB enrichment

To disable: Simply don't set `IGDB_CLIENT_ID` or `IGDB_CLIENT_SECRET`
