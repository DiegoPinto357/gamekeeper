# GameKeeper UI — Implementation Plan

## Problem & Goal
Add a local web UI to GameKeeper, starting with a Game Pass catalog browser:
scroll through all available games with cover art and add/remove them from
`data/gamepass-interests.json` without manually editing the file.
The architecture must be extensible (e.g., drop Notion later, add more views).

---

## Target Repo Structure

```
gamekeeper/
  pnpm-workspace.yaml
  package.json          ← workspace root (scripts, no real deps)
  packages/
    core/               ← shared business logic (importable lib)
      src/              ← current src/ moves here
      package.json      ← name: @gamekeeper/core
      tsconfig.json
  apps/
    cli/                ← thin entry-point; imports @gamekeeper/core
      src/
        index.ts        ← was root src/index.ts
      package.json
      tsconfig.json
    server/             ← Express / Hono REST API
      src/
      package.json
      tsconfig.json
    web/                ← React + Vite + shadcn/ui
      src/
      package.json
      tsconfig.json
      vite.config.ts
  data/                 ← stays at root (shared data files)
  .cache/               ← stays at root
  .env                  ← stays at root
```

---

## Key Decisions

| Decision | Choice | Reason |
|---|---|---|
| Workspace manager | **pnpm** | faster, better disk usage, user has experience |
| Shared lib | **packages/core** | importable by both CLI and server |
| Server framework | **Fastify** | TypeScript-first, fast, well-established |
| UI stack | **React + Vite + shadcn/ui** | specified by user |
| Data fetching in UI | **TanStack Query** | simple server state management |
| Interests storage | **JSON file** (same as today) | keep it simple; server reads/writes the file |
| Cover images | Extend catalog cache with `coverImageUrl` from `displaycatalog.mp.microsoft.com` | API already provides BoxArt / Poster URLs |

---

## Phase 1 — Monorepo Migration (no new features)

Move existing code into the workspace structure without breaking anything.

### Steps

1. **Root workspace setup**
   - Add `pnpm-workspace.yaml` listing `packages/*` and `apps/*`
   - Replace root `package.json` with a workspace root (no `main`, shared scripts)
   - Add root `tsconfig.json` for path references

2. **Create `packages/core`**
   - Move `src/` → `packages/core/src/`
   - Move `vitest.config.ts`, `tsconfig.json` to `packages/core/`
   - Add `packages/core/package.json`:
     - `name: @gamekeeper/core`
     - `exports` mapping for entry points
   - Update all internal imports (they stay relative, so mostly no-op)
   - Keep `data/`, `.cache/`, `.env` at root (core reads them via config path)

3. **Create `apps/cli`**
   - `apps/cli/src/index.ts` — re-exports / calls the main orchestration from `@gamekeeper/core`
   - `apps/cli/package.json` with `dep: @gamekeeper/core`
   - Mirror existing `npm run dev`, `dev:dry-run`, `build`, `start` scripts

4. **Verify**
   - `pnpm install` at root
   - `pnpm --filter @gamekeeper/cli run dev:dry-run` works
   - All 120 tests still pass in `packages/core`

---

## Phase 2 — Cover Images in Core

Enhance the catalog cache to include cover art.

- Update `GamePassGame` type: add `coverImageUrl?: string`
- In `gamepass.adapter.ts` `fetchCatalog()`: extract `BoxArt` image from
  `product.LocalizedProperties[0].Images` and store as `coverImageUrl`
- Existing cache files without `coverImageUrl` degrade gracefully (field just absent)
- Re-fetch cache to populate covers (or add a `--refresh-catalog` flag)

---

## Phase 3 — `apps/server`

A local REST API that the UI calls. The server is only needed locally (no auth).

### Endpoints (v1)

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/catalog` | Full Game Pass catalog (id, title, available, coverImageUrl) |
| `GET` | `/api/interests` | Current `wantToPlay` list |
| `POST` | `/api/interests` | Body: `{ "name": "Game Title" }` → appends to file |
| `DELETE` | `/api/interests/:name` | Removes by exact name match |

### Tech
- **Fastify** on Node
- Reads `data/gamepass-interests.json` and `.cache/gamepass/gamepass-catalog.json`
- Writes interests file atomically (write temp + rename)
- CORS enabled for local UI dev (port 5173 → 3001)- `apps/server/package.json` script: `dev: tsx src/index.ts`

---

## Phase 4 — `apps/ui` (First Feature: Catalog Browser)

### Stack
- React 18 + TypeScript + Vite
- **shadcn/ui** component library (Tailwind-based)
- **TanStack Query** for server state
- No routing library needed for v1 (single page)

### Feature: Game Pass Catalog Grid

**Components:**
- `CatalogGrid` — responsive masonry/grid of `GameCard`s
- `GameCard` — cover image, title, Add/Remove toggle button
- `SearchBar` — client-side filter (no server roundtrip needed)
- `InterestsBadge` — shows count of selected interests

**Behaviour:**
- On load: fetch `/api/catalog` + `/api/interests`, combine into enriched list
- "Add" click → `POST /api/interests` → optimistic update via TanStack Query
- "Remove" click → `DELETE /api/interests/:name`
- Search filters by title (client-side)
- Already-interested games show different card state (checked / highlighted)

### Start command
Add root script: `pnpm run ui` → starts both `apps/server` and `apps/ui` concurrently

---

## Phase 5 — Logger Refactor in `packages/core`

Move output concerns out of `packages/core` and into the consumers (CLI, server).

### Problem
`packages/core` has ~60+ `console.log/warn/error` calls scattered across adapters and
orchestration modules. A shared library should not own output — it violates the
single-responsibility principle and makes it impossible for callers (server, UI) to
control log formatting or silence output.

### Approach

1. **Define a `Logger` interface in core** (no deps, just a type):
   ```ts
   export interface Logger {
     log(message: string, ...args: unknown[]): void;
     warn(message: string, ...args: unknown[]): void;
     error(message: string, ...args: unknown[]): void;
   }
   export const noopLogger: Logger = { log: () => {}, warn: () => {}, error: () => {} };
   ```

2. **Pass `logger` to top-level functions** that currently call `console.*` directly:
   - `syncGames(options, logger?)`
   - `fetchCatalog(options, logger?)`
   - `loadSteamLibrary(options, logger?)` etc.
   - Default to `noopLogger` so all existing call sites without a logger stay silent

3. **Update consumers:**
   - `apps/cli` passes `console` (or a pretty-printer) as the logger
   - `apps/server` passes `noopLogger` (or a structured Fastify logger)

4. **Categories to handle:**
   - 🔴 Progress/status logs → move to consumers via logger callback
   - 🟡 Operational warnings/errors → convert to thrown errors or logger.warn
   - 🟢 `[DEBUG]`-gated logs → keep as-is (already opt-in, low risk)

### Scope
- Touch only `packages/core` internals and the two `apps/` entry points
- No behavior changes — same output in CLI, silence in server

---

## What's Out of Scope (for now)

- Authentication / remote hosting
- Editing Steam library, Heroic library, or Notion from the UI
- Dark/light theme toggle (default to system preference via Tailwind)
- Pagination (catalog is ~500 games, grid handles it fine)

---

## Todo List

1. `monorepo-setup` — Set up pnpm workspace + root config files
2. `migrate-core` — Move src/ to packages/core, update package.json
3. `migrate-cli` — Create apps/cli entry point
4. `verify-migration` — Run tests + dry-run to confirm nothing broke
5. `cover-images` — Extend GamePassGame type + catalog fetcher with cover URLs
6. `server-scaffold` — Scaffold apps/server with Hono + 4 endpoints
7. `ui-scaffold` — Scaffold apps/web with Vite + React + shadcn
8. `catalog-feature` — Implement catalog grid UI (CatalogGrid, GameCard, SearchBar)
9. `root-dev-script` — Concurrent dev script to start server + UI together
10. `logger-refactor` — Define Logger interface in core, inject into adapters, consumers pass their own logger
