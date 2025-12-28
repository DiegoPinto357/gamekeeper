# Xbox Game Pass Integration

## Overview

GameKeeper now intelligently handles Xbox games, distinguishing between:

- **Owned Xbox games** - Games you purchased (always synced)
- **Game Pass games** - Games available through subscription (filtered by interest and availability)

## How It Works

### 1. Automatic Catalog Fetching

- ✅ **Uses Microsoft's official catalog API** (same as [Game-Pass-API project](https://github.com/NikkelM/Game-Pass-API))
- **Endpoints**: `catalog.gamepass.com` + `displaycatalog.mp.microsoft.com`
- **Platform**: PC Game Pass catalog (~460+ games)
- **No authentication required** - Public API
- Cached for 7 days (configurable in `src/index.ts`)
- Falls back to stale cache if fetch fails

### 2. Source Detection in Playnite

Your Playnite export has two Xbox sources:

- `Source.Name = "Xbox"` → Owned games (always included)
- `Source.Name = "Xbox Game Pass"` → Subscription games (filtered)

### 3. Game Pass Filtering Logic

For each Game Pass game in Playnite, GameKeeper will:

1. ✅ Check if you marked it as "want to play" in `gamepass-interests.json`
2. ✅ Check if it's currently available on Game Pass (using cached catalog)
3. ✅ Only sync to Notion if BOTH conditions are true

### 4. Automatic Removal

- Games removed from Game Pass catalog automatically stop syncing
- No manual cleanup needed in Notion

## Usage

### Initial Setup

1. **Run the sync once** to fetch the Game Pass catalog:

   ```bash
   npm run dev
   ```

2. **Edit your interests** in `data/gamepass-interests.json`:

   ```json
   {
     "wantToPlay": ["Starfield", "Hades", "Hollow Knight"]
   }
   ```

   **Important**: Game titles must match exactly as they appear in Playnite!

3. **Run sync again** to apply your filter

### Ongoing Workflow

1. **Discover new games** on Game Pass (Xbox app, website, etc.)
2. **Add to interests** in `gamepass-interests.json`
3. **Run sync** - New games appear in Notion
4. **Games leaving Game Pass** automatically disappear from Notion after next sync

### Refreshing the Catalog

The catalog auto-refreshes after 7 days, but you can force a refresh:

```bash
# Delete the cache
rm -rf .cache/gamepass

# View current catalog (will fetch fresh if missing)
npm run view-gamepass

# Or run full sync (will fetch fresh if missing)
npm run dev
```

You can also view the current catalog without syncing:

```bash
npm run view-gamepass
```

## Files

- **`.cache/gamepass/gamepass-catalog.json`** - Cached Game Pass catalog (auto-generated)
- **`data/gamepass-interests.json`** - Your curated list (manual editing)

## FAQ

**Q: Why isn't my Game Pass game syncing?**

- Check that the title in `gamepass-interests.json` matches exactly as shown in the catalog (run `npm run view-gamepass` to see exact titles)
- Verify the game is still available on PC Game Pass (not just Console Game Pass)
- Check that your Playnite has it marked with source "Xbox Game Pass" (not "Xbox")

**Q: How do I see all available Game Pass games?**

```bash
npm run view-gamepass
```

This will show all 460+ PC Game Pass titles with exact formatting.

**Q: What if the Microsoft API fails?**
The adapter will attempt to use stale cache as fallback. If both fail, check your network connection and try again later. The API is public and doesn't require authentication.

**Q: Can I change the cache duration?**
Edit `src/index.ts` line where it creates the gamePassAdapter (currently set to 7 days).

## Examples

### Scenario 1: New Game Pass Game

1. "Starfield" is added to Game Pass
2. You add `"Starfield"` to `gamepass-interests.json`
3. Next sync → Appears in Notion

### Scenario 2: Game Leaves Game Pass

1. "Hades" is removed from Game Pass
2. Next sync (after cache expires) → Automatically removed from Notion
3. No action needed from you

### Scenario 3: Owned Xbox Games

- Always synced regardless of `gamepass-interests.json`
- No filtering applied
- These are your permanent library
