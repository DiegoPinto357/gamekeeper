# GameKeeper UI Expansion — Plan (v2)

> Living document — **update this file in place** as decisions change; no further versioning.
> Supersedes `docs/UI-PLAN.md` (kept as the monorepo-migration record; its one remaining item — the core logger refactor — is absorbed into P1 below).
> **Execution model:** this doc is the plan of record; **phases are handed off to coding agents**. Each phase below is a self-contained work unit (steps + verification). Update this doc here when decisions change; implementation happens per phase.

## 1. Goals

Replace Notion as the primary visualization layer with a self-contained local web UI:

1. **Categories view** — all games organized in user-managed categories with drag & drop (incl. priority ordering within a category)
2. **Discovery** — search/browse a large library by style, tags, genre
3. **Similar games** — from a game, find related ones
4. **Directed random** — constrained "surprise me" suggestions
5. **Self-sufficient UI** — run sync from a button in the UI, with visible progress; Notion sync optional (skipped by default from the UI because it's slow)
6. **AI** — explicitly deferred; extension seams reserved (see §7)

## 2. Decisions

| Topic | Decision |
|---|---|
| User-data storage | **SQLite** — statuses, Game Pass interests, owned games (expanded), overrides move out of JSON |
| Derived data | SQLite too (games, genres, tags, FTS, similar) |
| `data/gamekeeper.db` in git | **Ignored — local-only, permanent decision.** Never commit/push the DB: it carries user data (statuses, interests, owned, overrides — everything after P0B) and must not leave this machine. Consequence: after P6 untracks the legacy JSONs, user data has no git backup — accepted |
| Manual-edit data identity | **Canonical/stable ids as index, never game names** (details §6) |
| Views | **Categories board is the only library view for now**; grid "all games" view and detail page demoted to deferred milestones |
| Sync | Runnable **from the UI** (button), skips Notion by default there; progress shown as checklist + counters (style TBD, §4); **no cancel button** for now |
| Enrichment | `pnpm enrich`: Heroic harvest + Steam appdetails + IGDB + MS Store, cached in DB |
| AI | None yet — rules-based similarity/suggestions, seams reserved |
| Game Pass view | Stays separate route; interests UI rekeyed to stable ids (P0B) |
| Library source | **Heroic integration** — Playnite is retired (no harvest from `playnite.json`, no Playnite path work) |
| Notion | CLI sync **ON** by default (`--skip-notion` to opt out); UI sync **OFF** by default (toggle in panel); status never pushed |
| Categories/columns | Fixed keys stored in `statuses` table: **`backlog, want_to_play, queued_to_play, trying, recurrent, playing, paused, completed, dropped`** (label/order/color editable as data). Suggested display labels: Backlog · Want to Play · **Up Next** · **Trying Out** · **Recurrent** · Playing · Paused · Completed · Dropped |
| Board ordering (P2.2) | **Per-card pin**: default order is auto by last played (live); dragging a card **within its column** pins it at the drop slot — manual priority wins over auto; cross-column moves land in the target column's auto flow (unpinned); pinned cards can be unpinned back into the auto flow; new/played games re-flow around pins |
| Unsorted column | **None** — Backlog is the default category: games without a status render there; sync never writes status rows |
| Similar games | Local genre/tag overlap + IGDB `similar_games` |
| Testing | **Vitest everywhere + RTL for web**; **TDD (RED → GREEN)** expected of every phase; root `pnpm test` runs all workspaces |

## 3. Categories view (layout spec)

```
┌──────────────────────────────────────────────────────────────────────┐
│ 🎮 GameKeeper   Library · Discover · Game Pass    [Sync ▶]  🌙      │ ← top nav + Sync button
├──────────────────────────────────────────────────────────────────────┤
│ 🔍 Search  [Source ▾] [Genre ▾]                    697 games         │ ← toolbar (persisted)
├──────────────┬────────────────┬─────────────┬─────────────┬──────────┤
│ Backlog      │ ★Want to Play  │ Up Next     │ +5 more     │          │ ← columns in data order
│   697        │      12        │      8      │             │          │   (positions editable),
│ ┌────────┐   │ ┌────────┐     │ ┌────────┐  │             │          │   horizontal scroll,
│ │img Name│   │ │img Name│     │ │img Name│  │      ...    │   ...    │   per-column scroll,
│ │xbox·12h│   │ ┌────────┐     │ └────────┘  │             │          │   count in header,
│ └────────┘   │ │img Name│     │             │             │          │   lazy-rendered
│   ...        │ └────────┘     │             │             │          │
├──────────────┴────────────────┴─────────────┴─────────────┴──────────┤
│  drag across → status change · drag within → reorder (dnd-kit)       │
│  click card ─► right slide-over drawer: cover, sources, playtime,    │
│  release, genres, [Move to ▾], notes, ✕                              │
└──────────────────────────────────────────────────────────────────────┘
```

Column order shown = seed order from §2 (`backlog → want_to_play → queued_to_play → trying → recurrent → playing → paused → completed → dropped`); stored as `statuses.position`, reorderable without code changes. **Manual reorder (no UI):** `UPDATE statuses SET position = N WHERE key = '...'` — integers 0..8 (column is INTEGER; renumber the tail to insert between). Seed/migrations never touch positions of existing rows after first insert, so manual tweaks stick.

**No Unsorted column:** a game with no `game_status` row renders in **Backlog** — the default category for new entries. Sync never writes status rows; Backlog gets a lazy first-render order (`COALESCE(last_played_at, created_at) DESC, name ASC` — Q10.1 settled). Since P2.2 no column is ever bulk-materialized: every card starts unpinned (auto flow) and a row — with `pinned=1` + a slot position — is written only when the user drags a card.

**Settled details:**

| Aspect | Decision |
|---|---|
| Backlog (default) | All games land here when unassigned; **lazy-rendered** (~50 cards + show more); default order **by date**: `COALESCE(last_played_at, created_at) DESC, name ASC` (Q10.1, settled) |
| Card click | Slide-over drawer (board stays mounted, scroll position kept) |
| Card style | Compact row: cover thumb + title + micro-badges (platform, playtime) |
| Board toolbar | Search + source filter + genre filter, persisted to localStorage |
| Ordering numbers | **None** — no numeric UI; manual priority = drag-to-pin (P2.2) |
| Bulk move (multi-select → move) | P2 stretch (draining ~697-game Backlog by hand is a slog) |
| Mobile | Not targeted; baseline = columns scroll horizontally |
| Genre filter availability | Degrades gracefully until enrichment (P3) — only ~9% of games have genres today |

**Behavior:** dnd-kit columns + sortable cards; optimistic mutation with rollback on failure; memoized cards; column headers show label + count + color dot; empty-column states; filter state in URL for discover, localStorage for board.

## 4. Sync from the UI

The UI must work standalone: **run the sync with one button and watch it progress.**

### 4.1 Orchestration refactor (prerequisite)

Today the entire sync pipeline lives in `apps/cli/src/index.ts` (`main()`), bound to `console.log` / direct fs reads / `process.exit` — unusable from the server. This is also where the old `docs/UI-PLAN.md` Phase 5 (logger refactor) gets absorbed.

- Move orchestration → `packages/core/src/sync/orchestrator.ts`:
  ```ts
  runSync(options: { dryRun?: boolean; skipNotion?: boolean; logLevel?: LogLevel },
          deps:  { logger: Logger; emit: (event: SyncEvent) => void }): Promise<SyncSummary>
  ```
- **Structured events** instead of console output:
  | Event | Payload |
  |---|---|
  | `step:start` / `step:done` / `step:skip` / `step:error` | `{ key, label, detail? }` |
  | `progress` | `{ key, current, total }` (enumerative steps: IGDB lookup, ProtonDB, etc.) |
  | `summary` | `{ added, updated, removed, skipped, errors, duration }` |
- `apps/cli` becomes a thin wrapper: renders events as a live checklist in the console (TTY-aware counters); `pnpm sync` behavior unchanged, **Notion stays ON by default in the CLI**, new `--skip-notion` flag.
- Core gets a real `Logger` interface (defaults silent) — no `console.*` in `packages/core`.

### 4.2 Server API

| Endpoint | Behavior |
|---|---|
| `POST /api/sync` | body `{ skipNotion?: boolean }` → `{ runId }`; **409 if a run is in progress** (in-memory guard) |
| `GET /api/sync/events` | **SSE**: on connect sends full snapshot of current/last run, then live events (checklist + counters + summary). Late-joining panel reconstructs state |

No cancellation endpoint (decided: no cancel button for now).

- Sync runs **in-process** in the server (calls core orchestrator); async I/O keeps the API responsive; SQLite writes are brief sync calls with `busy_timeout=5000`.
- DB concurrency: CLI run + UI run simultaneously is guarded only within the server (409); cross-process = SQLite locking (acceptable; lock-file guard is a later nicety).

### 4.3 Progress UI

Header **`[Sync ▶]`** button → slide-over panel:

```
┌ Sync ──────────────────────────────── ✕ ┐
│ ▶ Also sync Notion  [off]   [Start]     │ ← pre-run options
│ ─────────────────────────────────────   │
│ ✓ Configuration loaded                  │
│ ✓ Overrides loaded (25 rules)           │
│ ✓ Steam — 266 games                     │
│ ✓ Game Pass catalog — 498 games         │
│ ✓ Library sources — 431 games           │
│ ✓ Deduplicated — 697 unique             │
│ ⟳ IGDB Steam-ID lookup ……… 126/213      │
│ ☐ ProtonDB enrichment                   │
│ ☐ Write to database                     │
│ ☐ Availability report                   │
│ ✓ Notion sync (skipped)                 │
│ ─────────────────────────────────────   │
│ Step 6/10 ·  overall 58%                │ ← numbers style = both (Q10.2, resolved)
│                                 [Close]   │
└─────────────────────────────────────────┘
```

- Checklist item: pending spinner → ✓ (or ✗ with error detail + retry)
- Driven by `useSyncEvents` hook (EventSource), TanStack Query invalidation for `library`/`board`/`discover` on `summary`
- Done state: summary line (added/updated/skipped/errors/duration)

## 5. Target architecture

```
pnpm sync (CLI) ─┐
                 ├──► packages/core (orchestrator) ──► SQLite data/gamekeeper.db ──► apps/server ──► apps/web
UI [Sync] ── server ─┘            │                        (user data + derived)       REST/SSE      router + dnd-kit
                                  └──► Notion (optional: CLI default ON, UI default OFF)
```

### 5.1 SQLite schema (v1, `PRAGMA user_version` migrations)

**User data** (sync never deletes; server/repos write):

| Table | Columns | Was |
|---|---|---|
| `statuses` | key, label, position, color | new — seeded (keys §2) |
| `game_status` | canonical_id PK, status, position (fractional REAL), notes, updated_at — *no row ⇒ Backlog (default)* | new |
| `interests` | **catalog_product_id PK**, title (display), canonical_id NULL (sync backfills), created_at | `gamepass-interests.json` |
| `owned_games` | **canonical_id PK**, name, platform, notes, created_at | `owned-xbox-games.json` (→ expanded, platform attr) |
| `force_merge_rules` | id, match_ids (JSON), match_names (JSON), canonical_name, position | `overrides.json` forceMerge |
| `property_overrides` | id, match_id, match_name, properties (JSON) | `overrides.json` propertyOverrides |

**Derived** (sync/enrich write): `games` (columns + `raw_json`, `igdb_id`, `meta_source`, `enriched_at`), `genres`/`game_genres`, `tags`/`game_tags`, `similar_games`, `games_fts` (FTS5, rebuilt post-write).

**Ownership ingest mapping:** `platform='xbox'` → source `xbox` (current behavior preserved); other platforms → source `manual` (dedupes by name into the library, always Notion-synced).

### 5.2 REST / SSE API

| Endpoint | Serves |
|---|---|
| `GET /api/games?q&genre&tag&source&status&sort&page` | library queries + discover |
| `GET /api/games/:id` · `GET /api/games/:id/similar` | drawer/de detail |
| `GET /api/library` · `PATCH /api/games/:id/status` · `POST /api/games/status` | categorized library (statuses + status assignments) + bulk triage |
| `GET /api/facets` · `GET /api/suggest?...filters` | discover + directed random |
| `GET/POST/DELETE /api/interests` | rewire file → DB; **keyed by catalog product id** |
| `GET/POST/DELETE /api/owned-games` | new (canonical_id + platform) |
| `POST /api/sync` · `GET /api/sync/events` (SSE) | §4 |
| `GET /api/catalog` | Game Pass view (unchanged) |

### 5.3 Web routes & structure

| Route | Feature |
|---|---|
| `/library` (default) | Categories board (+ drawer, toolbar, sync panel) |
| `/discover` | Facet filters, FTS search, Surprise me |
| `/gamepass` | Existing catalog browser (relocated) |
| *deferred* | `/game/:id` detail page, grid "all games" view |

- Stack additions: **react-router v7**, **@dnd-kit/core + @dnd-kit/sortable**, expanded shadcn (`dialog, select, tabs, dropdown-menu, checkbox, slider, popover, tooltip, skeleton, progress`)
- Structure: `features/{library,discover,gamepass,sync}/`, `components/ui/`, `packages/shared` (types-only workspace pkg for API contracts; fallback if Vite chokes on TS-source packages = keep types in web only)
- Nav: Library · Discover · Game Pass · **Sync ▶** · theme toggle

## 6. User-data migration (canonical-id identity)

Principle: **anything hand-edited/indexed by game name gets a stable id instead.**

| Structure | Was | Becomes | Notes |
|---|---|---|---|
| Interests | `wantToPlay: string[]` (name index) | `interests(catalog_product_id PK, title, canonical_id NULL)` | Stable at add-time from catalog browser; matching vs catalog becomes **id-equality** (kills the swapped-title bug class, commit `1770214`); sync backfills `canonical_id` once the game enters the library; title = display only; `_instructions` dropped |
| Owned games | `ownedGames: string[]` | `owned_games(canonical_id PK, name, platform, notes)` | Library canonical id when added from library context, else generated `manual:<slug>`; legacy seed = `platform='xbox'`; sync still joins by normalized name (behavior unchanged), backfills link when matched |
| Overrides | name arrays | ids primary, names kept as fallback | `shouldForceMerge` runs **pre-dedupe on raw names by design** — name matching retained; ids used where resolvable (from merge suggestions / library) |
| Statuses | — | `game_status` keyed canonical_id | already correct |

**Legacy import:** one-time, automatic on first DB open (tables empty && JSON files exist); logs imported counts (72 / 93 / 25); JSON files left untouched on disk as backup, no longer written; untracked from git in P6.

## 7. Phases

**Execution:** each phase is a self-contained unit for a coding agent — follow the steps in order, **TDD (RED → GREEN: write the failing test first, then implement until it passes)**, and finish with the phase's **Verify** checklist. If implementation forces a decision change, update this doc in the same PR.

**Testing strategy:**

| Layer | Stack | Scope |
|---|---|---|
| `packages/core` | vitest (existing) | pure logic: dedupe, normalize, similarity, overrides, DB schema/repos, orchestrator events, enrichment mappers |
| `apps/server` | vitest + `fastify.inject` | route handlers via an **exported app factory** (no `listen()` in tests) |
| `apps/web` | vitest + jsdom + `@testing-library/react` + `@testing-library/user-event` | components/hooks; fetch stubbed (`vi.fn` / `vi.stubGlobal`) with fixtures typed from `@gamekeeper/shared` (no MSW for now) |

- Commands: `pnpm test` (all projects, from root), `pnpm test:watch`, per-project `pnpm --filter <pkg> test`
- Every step that adds a module / endpoint / component ships its tests in the same step
- DnD caveat: assert **position logic + endpoints + the Move-to menu** in tests; do not assert pointer-drag gestures in jsdom

### P0 — Foundations (refactor, no visible features)
1. **Test infrastructure (vitest + RTL)** —
   - **web:** add `vitest`, `jsdom`, `@testing-library/react`, `@testing-library/jest-dom`, `@testing-library/user-event`; `vite.config.ts` → `vitest/config` with `test.environment: 'jsdom'` + `setupFiles: 'src/test/setup.ts'` (imports `@testing-library/jest-dom/vitest`); `test` / `test:watch` scripts; **smoke test**: render `App` (with `QueryClientProvider` + stubbed fetch) proving the harness + fetch-stub pattern
   - **server:** add `vitest` + `test` script (node env; first `fastify.inject` test arrives with step 4's app factory)
   - **root:** add `vitest` + `@vitest/coverage-v8` devDeps; convert root `vitest.config.ts` → `test.projects` covering core / server / web; root `pnpm test` → `vitest run`, `test:watch` → `vitest`
2. `packages/core/src/db/` — open/migrate, full schema (§5.1), repos, seed statuses, suppress `node:sqlite` ExperimentalWarning in bootstraps (tests: migrations run idempotently, repos round-trip)
3. Sync writes games to DB post-`processRawGames` (upsert **preserves enriched columns**); `library.json` snapshot kept (tests: upsert doesn't clobber enrichment)
4. Server: split `routes/*` into an **exported app factory** + shared helpers, fix `bootstrap.ts` path bug when run from `dist`; first `fastify.inject` route test
5. Web: router + nav shell, move CatalogGrid → `/gamepass` (update smoke test to assert route rendering), add `packages/shared`
6. **Verify:** `pnpm test` → all projects green (core + web smoke + server inject); `pnpm sync` populates DB; `pnpm ui` Game Pass works; `pnpm --filter web lint && build`

### P0B — Migrate user data to SQLite
1. Auto-import (§6); rewire `xbox-gamepass.ts`, `overrides.ts`, CLI direct reads (`apps/cli/src/index.ts:45,132,191,217`)
2. Server: `/api/interests` → DB transaction (replaces tmp+rename); add `/api/owned-games` CRUD
3. **Verify:** row counts 72/93/25; `pnpm sync` behavior identical (interest filtering, owned-xbox source, forceMerge); GP UI add/remove works; legacy JSONs untouched. **Tests (first):** legacy import runs once / is idempotent on second open; interests + owned-games + overrides repos round-trip; interests endpoint via `inject`

### P1 — Sync from the UI ✅
1. Orchestrator extraction (§4.1): `runSync(options, deps)` + `SyncEvent` types + `Logger` interface in core (absorbs old logger-refactor todo)
2. CLI wrapper: console checklist rendering; `--skip-notion` flag; default = Notion ON
3. Server: `POST /api/sync` (409 guard), `GET /api/sync/events` SSE (snapshot-on-connect), in-process run
4. Web: Sync ▶ header button, slide-over panel, checklist components, `useSyncEvents`, query invalidation on summary
5. **Verify:** UI sync runs end-to-end with Notion skipped; progress animates (checklist ✓ + counters); CLI `pnpm sync` output unchanged in substance; concurrent second POST → 409; API responsive during a run. **Tests (first):** orchestrator event sequence with fake deps; SSE snapshot + live event stream + 409 guard via `inject`; checklist/progress panel rendered from a canned event stream (RTL)

   _Deltas from `P1-PLAN.md`: SSE event ring = 1000 events (plan suggested ~500); slide-over is a hand-rolled fixed panel (no radix sheet — plan allowed either, zero new deps); checklist states rendered with lucide icons rather than literal glyphs; Q10.2 settled = **both** (`Step x/y · NN%`); query invalidation covers `catalog`/`interests` now, with `library`/`board`/`discover` reserved via comment for P2/P4; UI E2E verified via live API runs + RTL (browser click-through left to user)._

### P2 — Categories board
1. Statuses seeded in P0 (keys per §2); confirm display labels + column order at build time (stored as data — trivial to change)
2. `GET /api/library`, `PATCH /api/games/:id/status` (fractional position; reindex only on precision decay) — `updated_at` is DB-managed by the `game_status_touch_updated_at` trigger (migration #2, P0); repos must NOT set it explicitly
3. Board UI per §3: dnd-kit columns/cards, drawer, toolbar (search/source/genre), optimistic + rollback, lazy-render Backlog, counts, empty states; no-status games render in Backlog; positions materialized on first reorder there
4. Stretch: `POST /api/games/status` bulk multi-select
5. **Verify:** drag survives reload **and** a subsequent `pnpm sync` (status rows untouched, new games appear in Backlog); 697-card Backlog stays responsive. **Tests (first):** fractional-position math (midpoint, precision-decay reindex); library route + `PATCH status` via `inject`; Backlog-default rendering for no-status games; Move-to menu flow (RTL — see DnD caveat)

### P2.1 — Board polish
1. **Independent column scrolling:** scroll lives *inside each column*, not the page — column headers stay pinned while card lists scroll. Structure: board root constrained to viewport height (`min-h-0 flex-1` / `h-[calc(100dvh-…)] overflow-hidden`); only the columns row scrolls horizontally; each column keeps its header outside an `overflow-y-auto` card list. *Fix note:* today the root has no height cap (`BoardPage.tsx:116`), so tall columns stretch and the page scrolls instead. Drag must still land on the visible column under the pointer (scroll position ≠ drop target changes — re-verify `pointerWithin` collision during mid-scroll drags)
2. **One badge per source, colored like the Notion board:** render badges for **all** `owned_sources` (not just `primarySource`), each in its brand color (match the current Notion board tags; starting map — steam: blue-gray, xbox: green, gamepass: green accent, epic: near-black/white, gog: purple, amazon: teal/orange). Library currently spans: steam 269 · epic 264 · xbox 81 · gog 65 · gamepass 58 · amazon 19
3. **Bigger cards:** larger cover art, title wraps (no `truncate`/ellipsis — `BoardCard.tsx:42` today), taller card; column width may grow past `w-72` if needed. Re-check lazy-render batch size (bigger cards = fewer above the fold)
4. **Search clear button:** ✕ inside the search input (toolbar) to reset query + results in one click
5. **"Removed"/"Not available" badge:** red/gray badge like Notion's when a game left its source's catalog (e.g. delisted from Game Pass). *Data gap:* availability currently lives only in `data/gamepass-unavailable.json` (10 rows: `name`, `reason: interest-unavailable`, `lastSeen`, `wasPlayed` — **no canonical_id**). Persist it in the DB (e.g. `games.unavailable_reason` or `game_availability(canonical_id, reason, last_seen)` written by the orchestrator's `processGamePassAvailability` step, which already computes this) so `GET /api/library` can expose it; badge shows in card + drawer
6. **Verify:** column headers visible while scrolling a 600+-card Backlog; drag still correct with per-column scroll; every source renders its color; unavailable badge survives reload + sync. **Tests (first):** availability persistence (orchestrator step → DB row); library route returns `unavailableReason`; RTL for multi-source badges, clear button, wrap-not-truncate

### P2.2 — Board fidelity (pin ordering + compatibility badges)
Matches the reference board (Figma): live last-played ordering with manual-priority override, ProtonDB/Deck badges, and the correct Game Pass availability flags. Three independent items — implement in order, each green on its own.

#### P2.2a — Per-card pin ordering (manual priority > auto by last played)
*Semantics:* every column defaults to the live auto order (`COALESCE(last_played_at, created_at) DESC, name ASC`). Dragging a card **within its column pins** it at the exact display slot where it was dropped; pinned slots are anchored while unpinned (auto) cards flow around them by last played. **Cross-column moves never pin** — the game joins the target column's auto flow (landed by last played, drop neighbors ignored). Unpinning returns the card to the auto flow. `materializeBacklog`'s freeze-on-first-drag is removed.

1. **Migration #5** (`packages/core/src/db/schema.ts`): `ALTER TABLE game_status ADD COLUMN pinned INTEGER NOT NULL DEFAULT 1` — existing rows were all manual drags, so default 1 is correct. **Migration #6 (data fix):** pre-pin-model rows were bulk-materialized by freeze-on-first-drag, not hand-pinned — delete pure backlog rows (keep rows with notes) and unpin everything else, so existing libraries open on the auto flow.
2. **Shared merge function** (`packages/core/src/db/repos/game-status.ts`): per column, merge pinned cards (ordered by `position`) with auto cards (ordered by `COALESCE(last_played_at, created_at) DESC, name ASC`); the *i*-th pinned card anchors at its stored slot index (rounded display rank), auto cards fill the remaining slots in order. One function, used by both the read path and write-reindex.
3. `getLibraryGames`: return rows in merged order (JS-side merge; 707 rows — trivial). `LibraryGame` gains `pinned: boolean`.
4. `setGameStatus`: on any move set `pinned=1`; position = fractional insert among pinned slots (reuse `needsReindex`/`reindexColumn`); **drop the `materializeBacklog` call and export** — no bulk snapshot anymore.
5. New `unpinGame(db, canonicalId)`: Backlog → delete the row; any other status → `pinned=0, position=NULL`.
6. **Server:** keep the existing `PATCH .../status` contract; add `POST /api/library/games/:id/unpin`.
7. **Web:** `board-store.ts` — optimistic unpin + `unpinGame` mutation (move path unchanged); `BoardCard.tsx` — subtle pin indicator on pinned cards + "Unpin" action in the card's hover/context menu.
8. **Tests (first):** merge order (pinned anchored, auto reflow after `last_played` change, new game arrives between pins); pin-on-drag; unpin per status; route tests for the new endpoint; web store + RTL for indicator/unpin.

   _Deltas from plan: the web state layer is `hooks/useLibrary.ts` (there is no `board-store.ts`); Unpin lives in the game drawer (next to Move-to) rather than a card context menu, with a pin icon indicator on the card; positions are reindexed to integer display ranks on every move (fractional-midpoint machinery removed — slots are display ranks under the pin model); only same-column drags pin — cross-column moves join the target's auto flow, unpinned (user refinement)._

#### P2.2b — ProtonDB + Steam Deck badges (dedicated second row)
Data already exists: `games.proton_json` has `tier` (platinum/gold/silver/bronze/borked) and `steamDeck` (verified/playable/unsupported/unknown) for ~551/707 games.

1. `getLibraryGames`: parse `proton_json` → `proton: { tier, steamDeck } | null` on the DTO; server route passes it through.
2. `BoardCard.tsx` (`BoardCardFace`): after the existing source/playtime badge row, a **second badge row** rendered only when `proton` exists — Deck pill (✓ Verified green / ⚠ Playable amber / ✕ Unsupported red) + ProtonDB tier pill (color-coded per tier). Games without data (mostly Game Pass-only) show no second row.
3. `GameDrawer.tsx`: same badges in the details panel.
4. **Tests (first):** repo maps `proton_json` → DTO (incl. null/missing); route returns `proton`; RTL for the second row (with data, without data, both pills).

   _Done. Implementation: `GameCompatibility` type in shared (`ProtonTier`/`SteamDeckStatus` string unions) + `proton?: GameCompatibility` on `LibraryGame` (omitted, not null, over the wire); core parses `proton_json` by validating `tier`/`steamDeck` against their enums directly — `ProtonInfoSchema` rejects real rows because its `lastUpdated` is `z.date()` while stored JSON has ISO strings; missing/malformed → null. New `CompatibilityBadges` component shared by `BoardCardFace` and `GameDrawer`. Deck `unknown` renders no Deck pill (tier pill only)._

#### P2.2c — False "not available" fix (swapped-title matcher bug)
`catalogMatchesInterest` (`packages/core/src/core/xbox-gamepass.ts`) is order-sensitive substring matching. The interests file holds three entries for Hellblade II ("Senua's Saga: Hellblade II" ×2 + "Hellblade II: Senua's Saga"); the two swapped-order entries fail the match, get flagged `interest-unavailable`, and the word-sorted lookup in `persistAvailability` maps that flag onto the same DB game — flagged unavailable while sitting **in** the catalog ("Hellblade II: Senua's Saga", confirmed in `.cache/gamepass/gamepass-catalog.json`).

1. `catalogMatchesInterest`: add order-insensitive equality via `wordSortedKey` (`normalize.ts`) before the edition-substring logic.
2. Tests (`xbox-gamepass.test.ts`): swapped-order titles match; edition suffixes still match; sequel guard holds ("Modern Warfare" ≠ "Modern Warfare II").
3. Run `pnpm sync` — the fixed matcher drops Hellblade from the unavailable list; `reconcileUnavailableReasons` clears the DB flag automatically. (Full sync incl. Notion write; no Notion cleanup — Notion stays the historical archive, counts intentionally differ.)

   _Done. Word-sorted equality added before the length guard in `catalogMatchesInterest`; edition-suffix and sequel guards unchanged (tests cover both). Sync: Hellblade returned to Game Pass, both DB rows' flags cleared, report 10 → 9 with no other regressions._

#### P2.2 Verify
- Board: dragging a card pins it (survives reload + `pnpm sync`); unpinned cards reflow by last played as sync updates data; unpin returns a card to the auto flow; pin indicator visible.
- Cards show the Deck + ProtonDB second row where data exists; clean single row otherwise; drawer consistent.
- `pnpm sync`: Hellblade II leaves the unavailable report and its DB flag clears; no other flags regress (10 → 9 unavailable).
- `pnpm test` (core + server + web), `tsc -b`, lint all green.

### P3 — Metadata enrichment
1. Local harvest: expand Heroic `store_cache` field usage — GOG/Amazon genres already flow; verify what `legendary_library`/`nile_library` expose beyond current mapping (Epic likely thin → IGDB covers the gap). Playnite retired — no `playnite.json` harvest

   _Done. Heroic adapter now harvests: **GOG** — description (`extra.about.description`) + genres/developer/publisher/releaseDate merged from `gog_api_info.json` (localized `name['*']`, keyed `gog_<app_name>`, timestamp keys skipped, file optional); **Epic** — `developer` + `extra.about.description` (all 288 games; genres remain IGDB's job); **Amazon** — `description` + `developer`. `RawGameData`/`UnifiedGame` gain `description`/`developer`/`publisher`; dedupe merge carries them (primary ?? first populated sibling, like covers; genre/tag union still item 5). Real-data yield: 352 Heroic games — description 352, developer 351, publisher 61, genres 83, release 81._
2. Steam `fetchAppDetails` (typed, never called): genres/categories/release/dev/pub/`header_image` → fixes zero Steam covers; ~1.2s/req, resumable via `enriched_at`, `--force`

   _Done (engine; CLI wiring in item 5). `enrichSteamMetadata(db, {force, limit, delayMs, onProgress})` in `sync/steam-enrich.ts`: candidates = Steam games with `enriched_at IS NULL` (`force` re-does all); fill-only-missing for description/developer/publisher/release_date/cover (existing sibling-merged values preserved); genres unioned into the `genres`/`game_genres` junction; `enriched_at` stamped on success only (failures retry next run); 1.2s spacing between requests; `SteamAppDetails` type extended with developers/publishers/short_description. **Migration #7 landed here** (delta from plan order): `games.description/developer/publisher` columns + upsert COALESCE so sync resends don't clobber enrichment; FTS extension (description + genres + tags) deferred to item 5 — becomes migration #8 once genre/tag rows exist._
3. IGDB: persist `igdb_id` (currently discarded); fetch genres/themes/keywords/summary/similar_games/companies (4 req/s)

   _Done (engine; CLI wiring in item 5). `igdbAdapter.fetchGameBySteamAppId` (external_games uid/category-1 → game id) + `fetchGameDetails` (summary, genres, themes, keywords, similar_games ids, involved_companies); `enrichIgdbMetadata` in `sync/igdb-enrich.ts`: candidates = Steam games with `igdb_enriched_at IS NULL`, existing `igdb_id` skips the lookup, fill-only-missing description/developer/publisher, genres + themes/keywords → `tags` junction union, similar ids fetched but persisted in P5. **Migration #8** (delta from plan): `igdb_enriched_at` — separate stamp because the shared `enriched_at` tracks the independent Steam pass. Non-Steam/manual games join by name in item 5._
4. MS Store: keep genres/description from displaycatalog response already fetched (Xbox coverage)

   _Done. `mapProduct` now keeps `ProductDescription` (fallback `ShortDescription`) → description, `Properties.Categories` → genres (displaycatalog has no true genres field — Categories is the genre-ish list), plus `DeveloperName`/`PublisherName` (free, same response). `selectInterestGames` carries all four into the interest RawGameData. Existing catalog caches gain the fields on their next refresh — no migration needed._
5. Fix lossy merge (`deduplicate.ts:139-141`) → genre/tag **union**; `pnpm enrich` script; FTS rebuild; manual/physical games included (IGDB by name). Migration #7 (migration #2 = P0 `game_status` trigger, #3 = `recurrent` status, #4 = P2.1 `games.unavailable_reason`, #5 = P2.2 `game_status.pinned`, #6 = P2.2a un-pin data fix): extend `games` (description, developer, publisher) and `games_fts` (currently name-only) to cover description + genres + tags
6. **Verify:** >95% genre coverage; mapper tests; enrichment is progress-emitted (participates in UI checklist)

### P4 — Discover + directed random
1. `GET /api/games` filter params + `GET /api/facets` (counted genre/tag chips, source, status, playtime, Deck/Proton, year)
2. `/discover`: filter panel, FTS search, sort, URL-persisted filters, result grid
3. `GET /api/suggest`: respects active filters; excludes completed/dropped; weights unplayed → queued_to_play → want_to_play → backlog; returns reason chips → **Surprise me** modal (spin again / open / move to want-to-play)
4. **Verify:** "RPG, Deck verified, unplayed" → plausible picks. **Tests (first):** facet counting SQL, filter-param → query mapping, suggest weighting/exclusions, Surprise-me modal states (RTL)

### P5 — Similar games
1. `packages/core/src/core/similarity.ts`: `0.4·jaccard(genres) + 0.6·jaccard(tags)` + IGDB curated ranked first; unit tests
2. `GET /api/games/:id/similar` + drawer section + card quick-action
3. **Verify:** known similar pairs rank correctly; fallback works for games with thin metadata

### P6 — Polish
Settings UI (owned-games CRUD form, overrides editor, status labels/colors); untrack legacy JSONs + update README/docs/`suggestions.ts` message (user commits); broaden server route coverage beyond the per-phase tests; root `build` covers server+web; optional two-DB split.

**AI seams (no cost now):** similarity scorer interface; `q` param on `/api/games` (FTS → embeddings swap); suggester reason generation (heuristic → LLM); sync events → future LLM run narration.

## 8. Deferred milestones (explicitly out of current phases)

- Grid "all games" view (largely superseded by Discover)
- Full detail page `/game/:id` (drawer covers P2; page when Discover lands or later)
- Settings/management UI (P6 — unless pulled earlier)
- AI layer, Notion status push, two-way anything
- Mobile polish

## 9. Risks

- **`node:sqlite` experimental** on Node 22 (works + FTS5 verified); fallback `better-sqlite3` (needs `.npmrc` `onlyBuiltDependencies` entry)
- **Dual-process locking** (server + CLI sync): `busy_timeout=5000`, DELETE journal; server-level 409 only guards UI-triggered runs
- **DB binary churn in git**; fallback = two-file split (§2)
- **DnD perf** at 697 cards: memoize + lazy-render; virtualize only if measured jank
- **Vite + TS-source workspace pkg** (`packages/shared`): verify in P0; fallback = duplicate types in web
- **Steam/IGDB rate limits**: existing batching patterns; enrich explicit + resumable
- **SSE long-connection**: local-only tool, no proxy concerns; snapshot-on-connect covers reconnects

## 10. Open questions

1. ~~**Backlog default sort key ("by date")**~~ — settled before P2: `COALESCE(last_played_at, created_at) DESC, name ASC` (recently played first, newly-added next, stable tiebreak; `updatedAt` rejected as sync noise)
2. ~~**Progress numbers style**~~ — settled during P1: **both** (`Step x/y · NN%`, weighted)
3. **forceMerge id mechanics** — how far to push ids into a mechanism that matches raw names pre-canonicalization.
4. **Physical platforms** — `manual` source vs extending `Source` enum (switch/ps5).
5. **Legacy JSON untrack timing** — recommend P6 after verification.

_Resolved since first draft: status key list (§2), Notion defaults (§2), sync cancellation (none for now), Playnite retirement (§2), Unsorted column (dropped — Backlog is the default), progress numbers style = both (Q10.2), backlog default sort = `COALESCE(last_played_at, created_at) DESC, name ASC` (Q10.1), board ordering = per-card pin over live last-played auto order (P2.2, decided vs Figma reference)._
