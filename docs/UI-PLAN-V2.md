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

**No Unsorted column:** a game with no `game_status` row renders in **Backlog** — the default category for new entries. Sync never writes status rows; Backlog gets a lazy first-render order (`COALESCE(last_played_at, created_at) DESC, name ASC` — Q10.1 settled), and positions are materialized in a single transaction on the user's first reorder in that column.

**Settled details:**

| Aspect | Decision |
|---|---|
| Backlog (default) | All games land here when unassigned; **lazy-rendered** (~50 cards + show more); default order **by date**: `COALESCE(last_played_at, created_at) DESC, name ASC` (Q10.1, settled) |
| Card click | Slide-over drawer (board stays mounted, scroll position kept) |
| Card style | Compact row: cover thumb + title + micro-badges (platform, playtime) |
| Board toolbar | Search + source filter + genre filter, persisted to localStorage |
| Ordering numbers | **None** — priority in Want to Play is pure drag order |
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
| `GET /api/board` · `PATCH /api/games/:id/status` · `POST /api/board/move` | kanban + bulk triage |
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
2. `GET /api/board`, `PATCH /api/games/:id/status` (fractional position; reindex only on precision decay) — `updated_at` is DB-managed by the `game_status_touch_updated_at` trigger (migration #2, P0); repos must NOT set it explicitly
3. Board UI per §3: dnd-kit columns/cards, drawer, toolbar (search/source/genre), optimistic + rollback, lazy-render Backlog, counts, empty states; no-status games render in Backlog; positions materialized on first reorder there
4. Stretch: `POST /api/board/move` bulk multi-select
5. **Verify:** drag survives reload **and** a subsequent `pnpm sync` (status rows untouched, new games appear in Backlog); 697-card Backlog stays responsive. **Tests (first):** fractional-position math (midpoint, precision-decay reindex); board route + `PATCH status` via `inject`; Backlog-default rendering for no-status games; Move-to menu flow (RTL — see DnD caveat)

### P3 — Metadata enrichment
1. Local harvest: expand Heroic `store_cache` field usage — GOG/Amazon genres already flow; verify what `legendary_library`/`nile_library` expose beyond current mapping (Epic likely thin → IGDB covers the gap). Playnite retired — no `playnite.json` harvest
2. Steam `fetchAppDetails` (typed, never called): genres/categories/release/dev/pub/`header_image` → fixes zero Steam covers; ~1.2s/req, resumable via `enriched_at`, `--force`
3. IGDB: persist `igdb_id` (currently discarded); fetch genres/themes/keywords/summary/similar_games/companies (4 req/s)
4. MS Store: keep genres/description from displaycatalog response already fetched (Xbox coverage)
5. Fix lossy merge (`deduplicate.ts:139-141`) → genre/tag **union**; `pnpm enrich` script; FTS rebuild; manual/physical games included (IGDB by name). Migration #4 (migration #2 = P0 `game_status` trigger, #3 = `recurrent` status): extend `games` (description, developer, publisher) and `games_fts` (currently name-only) to cover description + genres + tags
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

_Resolved since first draft: status key list (§2), Notion defaults (§2), sync cancellation (none for now), Playnite retirement (§2), Unsorted column (dropped — Backlog is the default), progress numbers style = both (Q10.2), backlog default sort = `COALESCE(last_played_at, created_at) DESC, name ASC` (Q10.1)._
