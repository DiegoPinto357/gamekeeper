# GameKeeper Architecture

## Overview

GameKeeper is a personal game library aggregator that syncs data from multiple sources (Steam, Playnite, ProtonDB, Xbox Game Pass) into a centralized Notion database for visibility and decision-making.

## Design Philosophy

- **Functional over OOP**: Factory functions instead of classes
- **ES Modules**: Modern JavaScript module system
- **TypeScript**: Type safety with minimal runtime overhead
- **Caching First**: Disk caching to minimize API calls and respect rate limits
- **Fail Gracefully**: Stale cache fallbacks, skip games with errors

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                         GameKeeper                               │
│                      (src/index.ts)                              │
└─────────────────────────────────────────────────────────────────┘
                              │
                              │ orchestrates
                              ▼
    ┌────────────────────────────────────────────────────────────┐
    │                      Adapters                               │
    │  (Functional modules with factory functions)                │
    └────────────────────────────────────────────────────────────┘
              │            │            │            │
              ▼            ▼            ▼            ▼
       ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐
       │  Steam   │ │ Playnite │ │ ProtonDB │ │ Game Pass│
       │ Adapter  │ │ Adapter  │ │ Adapter  │ │ Adapter  │
       └──────────┘ └──────────┘ └──────────┘ └──────────┘
              │            │            │            │
              ▼            ▼            ▼            ▼
       ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐
       │Steam API │ │Playnite  │ │ProtonDB  │ │Microsoft │
       │          │ │JSON File │ │   API    │ │Catalog   │
       │          │ │          │ │  (30d    │ │  API     │
       │          │ │          │ │  cache)  │ │ (7d cache│
       └──────────┘ └──────────┘ └──────────┘ └──────────┘
              │
              │ all flow to
              ▼
       ┌──────────────────────────────────────┐
       │         Notion Client                 │
       │    (src/clients/notion.client.ts)     │
       │                                       │
       │  - Dual matching (ID + title)         │
       │  - Configurable properties            │
       │  - Create/update/skip logic           │
       └──────────────────────────────────────┘
              │
              ▼
       ┌──────────────────────────────────────┐
       │         Notion Database              │
       │                                       │
       │  Games library with:                  │
       │  - Title, Platform, Status            │
       │  - ProtonDB ratings                   │
       │  - Game Pass filtering                │
       └──────────────────────────────────────┘
```

## Data Flow

### 1. Steam Games

```
Steam Web API → Steam Adapter → Enriched Game Data → Notion Client
                      ↓
              Vanity URL Resolution
              Live Game Details
```

### 2. Playnite Games (Epic, GOG, Xbox)

```
Playnite JSON Export → Playnite Adapter → Game Data → Notion Client
                             ↓
                    Xbox Game Pass Filter
                    (interests × availability)
```

### 3. ProtonDB Ratings

```
ProtonDB API → ProtonDB Adapter → Cached Ratings → Merged with Steam data
                     ↓
              30-day disk cache
```

### 4. Xbox Game Pass Catalog

```
Microsoft Catalog API → Game Pass Adapter → Catalog Cache → Filter Function
                              ↓
                       7-day cache
                       PC Game Pass only
```

## Key Components

### Adapters

All adapters follow a factory function pattern:

```typescript
export function createAdapter(config) {
  // Private helper functions
  async function helperFunction() { ... }

  // Public API
  return {
    publicMethod1,
    publicMethod2
  };
}
```

**Steam Adapter** (`src/adapters/steam.adapter.ts`)

- Resolves vanity URLs to Steam64 IDs
- Fetches owned games list
- Uses Steam Web API key

**Playnite Adapter** (`src/adapters/playnite.adapter.ts`)

- Parses JSON export from custom PowerShell extension
- Maps source names to platforms
- Applies optional Game Pass filter

**ProtonDB Adapter** (`src/adapters/protondb.adapter.ts`)

- Fetches compatibility ratings
- 30-day disk cache to avoid hammering API
- Returns tier + confidence

**Game Pass Adapter** (`src/adapters/gamepass.adapter.ts`)

- Fetches PC Game Pass catalog from Microsoft API
- 7-day disk cache (configurable)
- Interest-based filtering via `data/gamepass-interests.json`

### Notion Client

**Configurable Sync Properties** (`src/clients/notion.client.ts`)

- Define which properties to sync in `src/index.ts`
- Dual matching: Canonical ID (primary) + Title fallback
- Prevents duplicate entries

### Caching Strategy

| Source    | Cache Location     | Duration | Invalidation  |
| --------- | ------------------ | -------- | ------------- |
| ProtonDB  | `.cache/protondb/` | 30 days  | Age-based     |
| Game Pass | `.cache/gamepass/` | 7 days   | Age-based     |
| Playnite  | No cache           | N/A      | Manual export |
| Steam     | No cache           | N/A      | Live API      |

## Xbox Game Pass Philosophy

**Problem**: Game Pass is a subscription service, not a purchase. We don't "own" these games.

**Solution**:

- Playnite marks owned games as "Xbox" and subscription games as "Xbox Game Pass"
- GameKeeper fetches the current PC Game Pass catalog automatically
- User maintains a manual curation list (`data/gamepass-interests.json`)
- Only games that are BOTH (interested AND available) sync to Notion
- Games leaving the catalog automatically stop syncing

This creates a "wishlist within a subscription" workflow.

## File Structure

```
gamekeeper/
├── src/
│   ├── index.ts                    # Main orchestrator
│   ├── adapters/
│   │   ├── steam.adapter.ts        # Steam Web API integration
│   │   ├── playnite.adapter.ts     # Playnite JSON parser
│   │   ├── protondb.adapter.ts     # ProtonDB ratings with cache
│   │   └── gamepass.adapter.ts     # Xbox Game Pass catalog fetcher
│   ├── clients/
│   │   └── notion.client.ts        # Notion database sync logic
│   └── scripts/
│       └── view-gamepass-catalog.ts # Helper to view GP catalog
├── data/
│   └── gamepass-interests.json     # Manual GP curation list
├── .cache/
│   ├── protondb/                   # ProtonDB ratings cache
│   └── gamepass/                   # Game Pass catalog cache
├── playnite-extension/
│   └── GameKeeperExport/           # Custom Playnite .psm1 extension
└── docs/
    ├── ARCHITECTURE.md             # This file
    ├── GAMEPASS.md                 # Game Pass integration guide
    └── README.md                   # Main documentation
```

## Configuration

All configuration is in environment variables (`.env`):

```bash
STEAM_API_KEY=xxx                   # Steam Web API key
STEAM_VANITY_URL=username           # Steam profile URL name
NOTION_API_KEY=secret_xxx           # Notion integration token
NOTION_DATABASE_ID=xxx              # Notion database ID
PLAYNITE_EXPORT_PATH=/path/to/export.json
```

Additional config in `src/index.ts`:

- Game Pass cache duration (7 days)
- Notion sync properties mapping

## API Credits

- **Steam Web API**: `api.steampowered.com` - Official Valve API
- **ProtonDB API**: `www.protondb.com/api/v1/reports/summaries` - Community compatibility ratings
- **Microsoft Catalog API**: `catalog.gamepass.com` + `displaycatalog.mp.microsoft.com` - Public Game Pass catalog
  - Thanks to [NikkelM/Game-Pass-API](https://github.com/NikkelM/Game-Pass-API) for API discovery

## Development Commands

```bash
npm run dev              # Full sync (Steam + Playnite → Notion)
npm run view-gamepass    # View current Game Pass catalog
npm run build            # Compile TypeScript
npm run typecheck        # Type checking only
```

## Future Enhancements

- [ ] Epic Games Store API integration (if/when available)
- [ ] GOG Galaxy API (currently via Playnite)
- [ ] Historical tracking of Game Pass additions/removals
- [ ] PlayStation/Nintendo libraries (if APIs available)
- [ ] Automated Playnite export triggers
