# Xbox & Game Pass Implementation

## Overview

This implementation provides comprehensive management of Xbox-owned games and Xbox Game Pass games, with proper tagging, syncing rules, and tracking of unavailable games.

## Files Created

### 1. Data Files

- **`data/owned-xbox-games.json`** - Manual list of Xbox games you own (not Game Pass)
- **`data/gamepass-unavailable.json`** - Auto-generated report of games no longer on Game Pass
- **`data/gamepass-interests.json`** - Already existed, used for tracking wanted Game Pass games

### 2. Core Module

- **`src/core/xbox-gamepass.ts`** - Core logic for Xbox/Game Pass processing
- **`src/core/xbox-gamepass.test.ts`** - 24 comprehensive tests

### 3. Updated Files

- **`src/types/game.ts`** - Updated platform priority (Xbox and Game Pass now equal at level 2)
- **`src/core/deduplicate.ts`** - Added Xbox/Game Pass exclusion rule in merging
- **`src/core/deduplicate.test.ts`** - Added 2 tests for Xbox/Game Pass tagging

## Platform Priority

**Updated Priority:** `Steam (1) > Xbox/Game Pass (2) > Epic (3) > GOG (4) > Amazon (5) > Manual (6)`

- Xbox and Game Pass have equal priority
- When both exist for a game, Xbox takes precedence for tagging

## Tagging Rules

### Rule 1: Xbox Ownership Exclusion

- **If owned on Xbox:** Gets `Xbox` tag only (never `Game Pass`)
- **Even if available on Game Pass:** Still only `Xbox` tag
- **Example:** Own Halo Infinite → `["xbox"]` even if on Game Pass

### Rule 2: Game Pass Without Ownership

- **Not owned, available on Game Pass:** Gets `Game Pass` tag
- **Example:** Playing Starfield via Game Pass → `["gamepass"]`

### Rule 3: Multi-Platform with Game Pass

- **Owned on Steam + available on Game Pass:** Both tags
- **Example:** Own Portal 2 on Steam, available on Game Pass → `["steam", "gamepass"]`

### Rule 4: Xbox Exclusion in Multi-Platform

- **Owned on Xbox + available on Game Pass:** Xbox only
- **Example:** Own Forza on Xbox + on Game Pass → `["xbox"]` (not `["xbox", "gamepass"]`)

## Sync to Notion Rules

### Always Sync

1. All non-Xbox/Game Pass games (Steam, Epic, GOG, etc.)
2. Games in `owned-xbox-games.json` (even with 0 playtime)
3. Games from `gamepass-interests.json` that are available on Game Pass

### Conditional Sync

4. Xbox games from Playnite:
   - If in `owned-xbox-games.json` → Sync
   - If NOT owned but available on Game Pass → Sync with `gamepass` tag
   - If NOT owned and NOT on Game Pass → Don't sync, add to unavailable report

### Never Sync

5. Xbox games that are:
   - Not in owned list
   - Not available on Game Pass
   - (These get tracked in `gamepass-unavailable.json`)

## Unavailable Games Tracking

### Games Tracked in `gamepass-unavailable.json`

1. **Played games that left Game Pass**

   - From Playnite Xbox games
   - Not in owned list
   - No longer in Game Pass catalog
   - Marked as `wasPlayed: true`

2. **Interest games not available**
   - From `gamepass-interests.json`
   - Not currently in Game Pass catalog
   - Marked as `wasPlayed: false`

### Auto-Removal

- When Game Pass catalog is refreshed
- Games that return to catalog are:
  - Automatically synced to Notion
  - Removed from unavailable report
  - Tracked in `returned` array during processing

## Core Functions

### `loadOwnedXboxGames()`

Loads and normalizes the owned Xbox games list.

### `loadGamePassInterests()`

Loads and normalizes the Game Pass interests list.

### `isOwnedOnXbox(gameName)`

Checks if a game is in the owned Xbox games list.

### `isAvailableOnGamePass(gameName, catalog)`

Checks if a game exists in the current Game Pass catalog.

### `resolveXboxSource(gameName, catalog)`

Determines the correct source tag (`xbox` or `gamepass`) for a game.

**Logic:**

- If owned → `xbox`
- If not owned AND available on Game Pass → `gamepass`
- If not owned AND not available → `xbox` (for Playnite data)

### `shouldSyncToNotion(game, catalog)`

Determines if a game should be synced to Notion.

**Returns `true` for:**

- Non-Xbox/Game Pass games
- Owned Xbox games
- Game Pass games that are available

**Returns `false` for:**

- Non-owned Xbox games not on Game Pass

### `processGamePassAvailability(playedGames, catalog)`

Processes all games and generates the unavailable report.

**Returns:**

```typescript
{
  unavailable: UnavailableGame[];  // Games to track
  returned: string[];               // Games that came back
}
```

### `getInterestGamesToSync(catalog, playedGames)`

Gets games from interests list that should be synced to Notion.

**Filters:**

- Only includes games available on Game Pass
- Includes both played and unplayed interest games

## Usage Example

```typescript
import {
  loadOwnedXboxGames,
  resolveXboxSource,
  shouldSyncToNotion,
  processGamePassAvailability,
  getInterestGamesToSync,
} from './core/xbox-gamepass';

// Load Game Pass catalog
const gamePassCatalog = await fetchGamePassCatalog();

// Load played games from Playnite
const playedGames = await loadPlayniteGames();

// Determine source tags
for (const game of playedGames) {
  if (game.source === 'xbox') {
    game.source = await resolveXboxSource(game.name, gamePassCatalog);
  }
}

// Filter games to sync
const gamesToSync = playedGames.filter(
  game => await shouldSyncToNotion(game, gamePassCatalog)
);

// Add interest games
const interestGames = await getInterestGamesToSync(
  gamePassCatalog,
  playedGames
);
gamesToSync.push(...interestGames);

// Generate unavailable report
const { unavailable, returned } = await processGamePassAvailability(
  playedGames,
  gamePassCatalog
);

// Save unavailable report
await saveUnavailableGames(unavailable);

console.log(`Returned to Game Pass: ${returned.join(', ')}`);
```

## Test Coverage

**84 total tests** across all modules:

- 22 tests: `normalize.test.ts`
- 24 tests: `xbox-gamepass.test.ts` ⭐ NEW
- 19 tests: `suggestions.test.ts`
- 19 tests: `deduplicate.test.ts` (including 2 new Xbox/Game Pass tests)

### Key Test Scenarios

- ✅ Loading owned games and interests
- ✅ Resolving Xbox vs Game Pass source
- ✅ Sync filtering logic
- ✅ Unavailable game tracking
- ✅ Returned game detection
- ✅ Multi-platform tagging
- ✅ Xbox/Game Pass exclusion rule

## Manual Configuration Required

### 1. Add Owned Xbox Games

Edit `data/owned-xbox-games.json`:

```json
{
  "ownedGames": ["Halo Infinite", "Forza Horizon 5", "Starfield"]
}
```

### 2. Add Game Pass Interests

Edit `data/gamepass-interests.json`:

```json
{
  "wantToPlay": [
    "Hollow Knight: Silksong",
    "Hi-Fi RUSH",
    "Clair Obscur: Expedition 33"
  ]
}
```

### 3. Review Unavailable Games

Check `data/gamepass-unavailable.json` after each sync:

- Decide if you want to purchase unavailable games
- Remove games from interests if no longer wanted

## Integration Points

### Integration with Existing Code

1. **Deduplication** - Modified `mergeGameGroup()` to apply Xbox/Game Pass exclusion
2. **Type System** - Updated `PLATFORM_PRIORITY` to make Xbox and Game Pass equal
3. **Config** - Uses existing file system structure in `data/` directory

### Future Integration Needed

- Update main sync script to call `resolveXboxSource()` for Xbox games
- Update main sync script to call `shouldSyncToNotion()` for filtering
- Update main sync script to call `processGamePassAvailability()` for reporting
- Update main sync script to include results from `getInterestGamesToSync()`

## Notes

- Game name matching uses normalization (case-insensitive, removes symbols)
- All file operations handle errors gracefully with empty defaults
- Unavailable games report is auto-generated and auto-maintained
- Interest games keep their "played" status for manual review
- The system prioritizes ownership over Game Pass availability
