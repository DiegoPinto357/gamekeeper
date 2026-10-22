# P2 — Categories Board: Execution Plan

> Derived from `docs/UI-PLAN-V2.md` §3 + §4.2 + §7 P2. This doc is the step-by-step work order for the P2 coding agent; the plan of record remains `UI-PLAN-V2.md` (update it there if a decision changes).
>
> Repo context (as of planning @ recurrent-status commit): P0 (db module, sync→SQLite, test infra) and P1 (orchestrator + `runSync`, SSE sync panel) complete; **P0B not done — orchestrator still reads JSON via `SyncIO`; board reads the DB directly, unaffected**. DB: `data/gamekeeper.db` local-only (gitignored, never commit), 698 games, 9 statuses (`backlog → want_to_play → queued_to_play → trying → recurrent → playing → paused → completed → dropped`, positions 0..8), `game_status` trigger owns `updated_at`. Web has router (`/library` placeholder), SyncPanel, GameCard, shadcn `badge/button/input` only; no dnd-kit yet.
>
> Decisions settled with user: **Q10.1 = `COALESCE(last_played_at, created_at) DESC, name ASC`** for no-position Backlog first render; board lives at **`/library`** (default route, replaces placeholder); **9 statuses incl. `recurrent`**; column order = `statuses.position` (manual reorder via SQL, no UI); bulk move = stretch; **API surface drops "board" (UI-view term)** — endpoint `GET /api/library`, shared types `LibraryResponse`/`LibraryGame`/`StatusEntry`, core `getLibraryGames`, server `routes/library.ts`; UI keeps board terminology (`BoardPage`, columns, `['library']` query key); future bulk endpoint = `POST /api/games/status`.

## Step 1 — Repos: game_status + fractional positions (core)

- `packages/core/src/db/repos/game-status.ts` (tests-first, `*.test.ts` co-located):
  - `listStatuses(db)` → ordered by `position` (columns come from data — never hardcode the 9 keys in web/server)
  - `getLibraryGames(db)` → all games joined with their status row (`LEFT JOIN game_status`; no row ⇒ status `null` ⇒ client renders in Backlog). Select only board-needed columns (canonical_id, name, cover_image_url, playtime_hours, primary_source, owned_sources, status, position)
  - `setGameStatus(db, canonicalId, status, { beforeId, afterId })`:
    - **Client sends neighbor ids, not floats.** Server computes midpoint `(prev.position + next.position) / 2`; missing neighbors ⇒ `first − 1` / `last + 1` / `[1]` for empty column
    - **Precision decay reindex:** if midpoint is not strictly between neighbors (float exhaustion) or spacing falls below `1e-9`, reindex that column in a transaction (order by position, renumber `1..n`) and recompute — never reindex other columns
    - Upsert `game_status` row; **never set `updated_at`** — the `game_status_touch_updated_at` trigger (migration #2) owns it
    - FK: status must exist in `statuses` (else throw a typed error the route maps to 400)
  - `materializeBacklog(db)` — called implicitly inside the first reorder that involves Backlog (or exported for PATCH to call): in **one transaction**, assign positions `1..n` to all no-status games in Q10.1 order (`COALESCE(last_played_at, created_at) DESC, name ASC`). Idempotent (no-op if Backlog already has positions)
- Round-trip tests: midpoint insert between neighbors, ends (`first−1`/`last+1`), decay triggers reindex (seed many rows, insert until exhaustion), materialization order + idempotence, no-status games excluded from status rows, unknown status key throws

## Step 2 — Server: board routes

- `apps/server/src/routes/library.ts` → `registerLibraryRoutes(app, { db })`; wire in `app.ts` next to catalog/interests/sync
- `GET /api/library` → `{ statuses: [...ordered], games: [...board columns incl. status/position] }` — **one payload, client groups by status** (697 rows is trivial; toolbar filters run client-side, no filter endpoints)
- `PATCH /api/games/:id/status` body `{ status: string, beforeId?: string | null, afterId?: string | null }` → 200 `{ canonicalId, status, position }`; 404 unknown game; 400 unknown status. Idempotent (re-PATCH same status recomputes position)
- db access via the existing `buildApp` opts pattern (injectable `dbPath` — mirror how sync routes got their seam; keep tests on temp-dir DBs)
- Tests (`fastify.inject`): library shape (statuses ordered, no-status game present with `status: null`); PATCH moves game, neighbors respected, appears in new column on refetch; 404/400 paths; trigger sets `updated_at` after PATCH (assert changed, don't assert exact value)

## Step 3 — Web: board page at `/library`

- Deps: `@dnd-kit/core` + `@dnd-kit/sortable` (the one planned new dependency)
- Replace `/library` placeholder route with `BoardPage`; keep nav label "Library"
- `hooks/useLibrary.ts` — TanStack Query `['library']` against `GET /api/library`
- Columns: label + count + color dot from `statuses` data (colors/labels/order come from DB — `recurrent` included automatically); horizontal scroll baseline; empty-column state
- Cards: compact row (cover thumb + title + micro-badges platform/playtime) — reuse/adapt `GameCard`; **memoized** (`React.memo`) — 697 cards must stay responsive
- **Lazy Backlog:** render ~50 + "show more" (incremental batches); default order = payload order (repo already sorts Q10.1) until the user reorders that column
- DnD: `DndContext` + `SortableContext` per column; on drop → **optimistic mutation** (`PATCH .../status` with neighbor ids) → rollback on failure (invalidate `['library']` on settle either way); Backlog drop → server materializes first, then positions the moved card (client just sends `beforeId`/`afterId` as usual — server handles materialization inside the same txn)
- Card click → **slide-over drawer** (hand-rolled, P1 SyncPanel precedent, zero new deps): cover, sources, playtime, release, genres (empty until P3 — degrade gracefully), **`[Move to ▾]` menu** (statuses from payload → PATCH, append to target column end), notes placeholder (P2.5 territory — render read-only/empty), ✕. Board stays mounted, scroll position kept
- Toolbar: search (name) + source filter + genre filter (mostly empty until P3 — fine), persisted to **localStorage** (board filters, unlike discover which will use URL)
- Uncomment `invalidateQueries({ queryKey: ['library'] })` in `useSyncEvents` summary handler (alongside existing catalog/interests; drop the dead `['board']` comment line)
- Tests (RTL): no-status game renders in Backlog; column order/counters from canned payload; Move-to menu flow (PATCH called, optimistic update); drawer opens on card click; lazy Backlog shows first 50 then more. **DnD caveat:** dnd-kit pointer sensors are awkward in jsdom — do NOT e2e-test drags in RTL; cover drag math via Step 1 unit tests + manual verify. A thin mock of `DndContext` for smoke render is acceptable

## Step 4 — Stretch (only if Steps 1-3 verified): `POST /api/games/status`

- Bulk multi-select (shift/ctrl click or checkbox) → single PATCH-style endpoint moving N games to a status in one transaction (draining the Backlog is a slog otherwise). Skip if time-boxed — plan marks it stretch.

## Step 5 — Verify + docs

- `pnpm test` all green; `pnpm --filter web lint && build`; core/cli/server `tsc --noEmit`
- Manual: drag a card → reload → still there; run `pnpm sync` → dragged statuses survive, new games appear in Backlog; Backlog of ~697 stays fluid (lazy + memoized); drawer + Move-to works; sync summary invalidates board
- `docs/UI-PLAN-V2.md`: mark P2 ✅, note deltas from this doc here

## API shapes (pin)

```ts
GET /api/library → {
  statuses: { key, label, color, position }[],
  games: { canonicalId, name, coverImageUrl?, playtimeHours?, primarySource,
           ownedSources, status: string | null, position: number | null }[]
}
PATCH /api/games/:id/status
  body: { status: string, beforeId?: string | null, afterId?: string | null }
  → 200 { canonicalId, status, position } | 400 | 404
```

## Notes / risks

- **Sync never writes `game_status`** (plan invariant) — verify step proves drag survives a sync run; only new games land in Backlog
- Cross-process concurrency: CLI sync + server PATCH both touch SQLite; `busy_timeout=5000` guards; keep PATCH transactions short
- dnd-kit in jsdom: no RTL drag tests (above); rely on unit-tested position math
- 697-card render: memoized cards + lazy Backlog + virtualization only if still slow (don't pre-optimize)
- Genre toolbar degraded until P3 — expected, not a bug
- Statuses are data: if the user reorders/renames via SQL (`statuses.position`), the board follows with no code change
