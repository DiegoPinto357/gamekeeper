# P0 — Foundations: Execution Plan

> Derived from `docs/UI-PLAN-V2.md` §7 P0. This doc is the step-by-step work order for the P0 coding agent; the plan of record remains `UI-PLAN-V2.md` (update it there if a decision changes).
>
> Repo context (as of planning @ `2ef6748`): root `vitest.config.ts` exists but is never invoked (`pnpm test` runs core only); only `packages/core` has tests (7 files, vitest 4.1.7); no `src/db/` — storage is JSON in `data/`; server routes inline in `apps/server/src/index.ts` with `listen()`; web has no router/test infra and `useTheme` calls `window.matchMedia` (breaks jsdom); Node v22.22.3 → `node:sqlite` (DatabaseSync) available; no `data/gamekeeper.db` yet.
>
> Decisions settled with user: DB git-added **after P0 verify**; router shell uses **placeholders for /library, /discover** + real `/gamepass`; DB API = **`openDb(path?)` + `GAMEKEEPER_DB` env override**, default `<cwd>/data/gamekeeper.db`.

## Step 1 — Test infrastructure (TDD: harness first)

**Root** (`package.json`, `vitest.config.ts`):
- devDeps: `vitest@^4.1.7`, `@vitest/coverage-v8@^4.1.7`
- Rewrite `vitest.config.ts` → `defineConfig({ test: { projects: [...] } })` referencing:
  - `packages/core/vitest.config.ts` (exists, keep)
  - server project: `environment: 'node'`, include `apps/server/src/**/*.test.ts`
  - web project: points at a new `apps/web/vitest.config.ts` (jsdom + setup + alias `@ → ./src`)
- Scripts: `test` → `vitest run`, `test:watch` → `vitest`
- (Stray root `node_modules/vitest@4.0.16` gets reconciled by the lockfile on install.)

**Web** (`apps/web`):
- devDeps: `vitest`, `jsdom`, `@testing-library/react`, `@testing-library/jest-dom`, `@testing-library/user-event`
- `vite.config.ts`: switch import to `vitest/config` (no `test` block — projects live at root)
- `apps/web/vitest.config.ts`: `environment: 'jsdom'`, `setupFiles: ['./src/test/setup.ts']`, alias `@ → ./src`, include `src/**/*.test.{ts,tsx}`
- `src/test/setup.ts`: `import '@testing-library/jest-dom/vitest'` + `window.matchMedia` polyfill (required — `useTheme.ts:7` breaks jsdom otherwise)
- Scripts: `test` = `vitest run`, `test:watch` = `vitest` (own config)
- **Smoke test** `src/App.test.tsx`: `render(<QueryClientProvider><App/></QueryClientProvider>)` with `vi.stubGlobal('fetch', …)` returning empty catalog/interests fixtures → asserts header renders

**Server** (`apps/server`): devDep `vitest`, `test`/`test:watch` scripts, `vitest.config.ts` (node env, include `src/**/*.test.ts`). First inject test arrives in step 4.

## Step 2 — `packages/core/src/db/`

New modules (all with tests, RED → GREEN):

- `db/connection.ts` — `openDb(path?)`: path resolution `param → process.env.GAMEKEEPER_DB → <cwd>/data/gamekeeper.db`; pragmas on open: `journal_mode=DELETE`, `busy_timeout=5000`, `foreign_keys=ON`; mkdir parent dir. Returns thin wrapper `{ raw, close }` (keeps `node:sqlite` surface swappable).
- `db/migrate.ts` — `PRAGMA user_version` runner, ordered migrations array, **idempotent** (test: open twice → no-op, `user_version` correct).
- `db/schema.ts` — full §5.1 schema:
  - user: `statuses(key PK, label, position, color)`, `game_status(canonical_id PK, status, position REAL, notes, updated_at)` + FK → statuses, `interests(catalog_product_id PK, title, canonical_id, created_at)`, `owned_games(canonical_id PK, name, platform, notes, created_at)`, `force_merge_rules`, `property_overrides`
  - derived: `games(canonical_id PK, name, primary_source, owned_sources JSON, steam_app_id, playtime_hours, last_played_at, cover_image_url, release_date, created_at, updated_at, raw_json, igdb_id, meta_source, enriched_at)`, `genres`/`game_genres`, `tags`/`game_tags`, `similar_games`, `games_fts` (FTS5, rebuilt post-write — verify FTS5 build flag at impl time)
- `db/seed.ts` — seed 8 statuses (keys from plan §2; labels Backlog · Want to Play · Up Next · Trying Out · Playing · Paused · Completed · Dropped; positions 0–7; placeholder colors), insert-if-empty
- `db/repos/games.ts` (+ later `statuses.ts`, `game-status.ts`, …): `upsertGames(games, { preserveEnriched: true })`, `listGames`, `getGame`
- `index.ts` re-exports; bootstraps (`apps/cli/src/bootstrap.ts`, `apps/server/src/bootstrap.ts`) + core db test setup: suppress `ExperimentalWarning` for `node:sqlite` (custom `process.emit` filter)

Tests: migrations idempotent; seed idempotent; repo round-trip (insert → read → equality incl. Dates/JSON columns); FTS5 creatable.

## Step 3 — Sync writes to DB

- In `apps/cli/src/index.ts` after `processRawGames` (~L266): `openDb()` → `upsertGames(unifiedGames)` (log via existing console output: "Wrote N games to database"), keep `library.json` snapshot write unchanged
- `upsertGames` must **not clobber enriched columns** (`igdb_id`, `enriched_at`, `meta_source`, genres/tags rows): test manually inserts enrichment → re-upsert sync columns → enrichment survives
- Update the "Processing … raw games" logging minimally; full Logger refactor is P1

## Step 4 — Server app factory + dist fix

- New `apps/server/src/app.ts`: `export function buildApp()` — Fastify instance + cors + routes (moved from `index.ts`); no `listen`, no chdir side-effect
- `apps/server/src/index.ts` becomes: `import './bootstrap'` → `buildApp()` → `listen()` (≈10 lines)
- Fix dist bug: add `rootDir: 'src'`, `outDir: 'dist'` to `apps/server/tsconfig.json` **and** stop pulling core TS sources into its program — cleanest fix: point server tsconfig at core's **built types** (`@gamekeeper/core` types field) or add `paths` mapping to `packages/core/dist`. (Cli has the same latent bug; fix server now, note cli for later — apply same fix if verified broken.)
- Fix `bootstrap.ts`: compute `REPO_ROOT` robustly (walk up for `pnpm-workspace.yaml`) so it works from both `src` (tsx) and any location
- **Decision (user, P0):** no file extensions in relative imports → vanilla `node dist/index.js` cannot execute ESM with extensionless specifiers; server `start` = `tsx src/index.ts` (dist emit stays clean for future use; `pnpm ui`/`dev` unchanged). `node:sqlite` loads via `createRequire` in core's connection module so the ExperimentalWarning suppression holds under tsx/CJS interop too
- First `fastify.inject` test: `GET /api/interests` against `buildApp()` with a temp data dir (no chdir side-effect; app takes paths as params/env) → 200 + `{ interests: [] }` shape

## Step 5 — Web router shell + `packages/shared`

- `packages/shared`: new workspace pkg `@gamekeeper/shared`, types-only (`src/index.ts` with API contract types: `CatalogGame`, `InterestsResponse`, future `BoardGame` etc. — moved from `apps/web/src/types/api.ts`); `"exports": { ".": { "types": "./src/index.ts", "default": "./src/index.ts" } }`; web consumes TS source → **verify Vite resolves it**; fallback if not: keep types in web (plan §9)
- web deps: `react-router` v7 (keep it simple: `<BrowserRouter>` + `Routes`)
- Structure:
  - `App.tsx` → `BrowserRouter` + `AppShell` (header nav: Library · Discover · Game Pass, theme toggle; no Sync button — P1) + `<Outlet/>`
  - `features/gamepass/CatalogGrid` (moved from `components/`), `features/library/LibraryPage.tsx` + `features/discover/DiscoverPage.tsx` placeholders ("Coming soon" text)
  - Routes: `/` → redirect `/library`; `/library`, `/discover` placeholders; `/gamepass` real
- Update smoke test: assert nav links + render `/gamepass` route shows catalog grid; placeholder pages render
- `pnpm --filter web lint && build` green

## Step 6 — Verify (per plan §7 P0.6)

- `pnpm test` → all green (core suite + server inject + web smoke)
- `pnpm sync` → DB populated (sanity: `sqlite3 data/gamekeeper.db 'select count(*) from games'` ≈ 697); `library.json` still written
- `pnpm ui` → Game Pass works at `/gamepass`
- `pnpm --filter web lint && pnpm --filter web build`
- ~~**Then** `git add data/gamekeeper.db`~~ — decision changed: `data/gamekeeper.db` is **gitignored** (user decision, P0 step 3); skip the add

## Notes / risks carried

- `node:sqlite` warning suppression must also cover vitest workers (setup file) or db tests print noise
- Server/core cross-package TS resolution is the riskiest part of step 4; if `rootDir` fights core-source imports, fallback = declare core dep via its `dist` types after core build
- No cancel/logLevel/orchestrator work — that's P1; step 3 is deliberately a ~10-line CLI hook, not an orchestrator extraction
- DnD/boards/sync-panel/router content beyond the shell are out of scope (P1/P2)
