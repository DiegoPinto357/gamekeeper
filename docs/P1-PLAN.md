# P1 — Sync from the UI: Execution Plan

> Derived from `docs/UI-PLAN-V2.md` §4 + §7 P1. This doc is the step-by-step work order for the P1 coding agent; the plan of record remains `UI-PLAN-V2.md` (update it there if a decision changes).
>
> Repo context (as of planning @ `7a6d601`): P0 complete (test infra, `packages/core/src/db/`, sync→SQLite, server `buildApp` + inject tests, web router + `/gamepass`); **P0B not done — user decision: P1 proceeds first** (orchestrator wraps the current JSON loaders; P0B rewires them to the DB later via the `SyncIO` seam); only sync entrypoint is the 511-line CLI monolith (`apps/cli/src/index.ts main()`); no Logger/events in core (79 `console.*` sites); server has catalog+interests routes only, no SSE; web has button/badge/input shadcn only, no sheet/progress.
>
> Decisions settled with user: **full logger purge** in core (not events-only); work on `main`; **Q10.2 = both** (`Step x/y` + weighted overall %); stale P2/P4 ✅ marks in `UI-PLAN-V2.md` fixed in step 5.

## Step 1 — Orchestrator + Logger ✅ (done @ `7a6d601`+)

- `packages/core/src/logger.ts` — `Logger` (debug/info/warn/error), silent default, `setLogger`/`getLogger`, `log` proxy, `consoleLogger`; full purge of all 78 core `console.*` → `log.*`
- `packages/core/src/sync/types.ts` — `SyncEvent` (`step:start|done|skip/error {key,label,detail?}`, `progress {key,current,total}`, `summary {summary}`), `SyncSummary {added,updated,removed,skipped,errors,duration}`, `SyncOptions {dryRun?,skipNotion?,logLevel?}`, `SyncIO`/`SyncAdapters` seams
- `packages/core/src/sync/orchestrator.ts` — `runSync(options, deps)`; 17-step pipeline extracted from CLI `main()`; **summary is always the terminal event** (even on fatal: step:error → summary → rethrow); `skipNotion` skips **both** `notion-verify` + `notion`; non-fatal steps (steam, gamepass-catalog, library) emit `step:error` and continue; sets `setLogger(deps.logger)` for the run, restores prior logger in `finally`
- `packages/core/src/sync/default-io.ts` — real IO: adapter init, heroic/playnite harvest, interests/owned-xbox reads, snapshot (moved from CLI), DB write with added/updated diff (`SELECT canonical_id` before upsert)
- `notion.client.ts` — `syncGames` gains optional `onProgress`, returns `SyncOperations`; `xbox-gamepass.ts` — pure `selectInterestGames` extracted (file wrapper kept)
- CLI: `setLogger(consoleLogger)` hook only (monolith untouched until step 2)
- Tests: `logger.test.ts` (7) + `sync/orchestrator.test.ts` (11) — exact event sequence, progress, skip-notion, dryRun passthrough, non-fatal continues, fatal abort+summary, early-exit, logger restore; e2e smoke vs real library passed (Notion skipped, DB 698→699, summary `errors=0`)

## Step 2 — CLI thin wrapper

- Replace `apps/cli/src/index.ts` monolith (~510 lines) with a thin runner:
  - `import './bootstrap'` (chdir), `setLogger(consoleLogger)`, `main().catch` → `console.error` + `process.exit(1)`
  - Flags: `--skip-notion` (new), `--dry-run` (existing; pass both explicitly as `runSync` options instead of relying on argv sniffing)
  - Notion **default ON** in CLI (only `--skip-notion` opts out)
  - `emit` renders a **TTY-aware checklist**: `✓/✗/⊘/⟳ label — detail`; TTY → `\r` live counter line for `progress`; non-TTY → plain progress lines every 20 + completion (old cadence)
  - Terminal summary block from `SyncSummary` + keep `✅ GameKeeper sync completed successfully!`
  - `process.exit` stays CLI-only; exit 1 only on fatal (non-fatal step errors still exit 0 — behavior unchanged)
- Delete dead CLI-local code now living in core (`saveLibrarySnapshot`, `getSourceBreakdown`, unused `sleep`)
- Verify: `pnpm test` green; `tsc --noEmit` (cli + root) green; `pnpm sync:dry-run --skip-notion` checklist matches old output in substance (counts per source, dedupe total, IGDB/ProtonDB counters, availability report); `pnpm sync` unchanged in substance with Notion ON

## Step 3 — Server: `POST /api/sync` + SSE

- `apps/server/src/routes/sync.ts` → `registerSyncRoutes(app, opts)`; wire in `app.ts` next to catalog/interests
- `POST /api/sync` body `{ skipNotion?: boolean }` (default **true** from UI perspective — server just receives what it's given; CLI default doesn't apply here) → `{ runId }`; **409** + `{ error, runId? }` if a run is in progress (in-memory guard, per app instance)
- `GET /api/sync/events` — SSE (`text/event-stream`, raw `reply.raw`; no new deps):
  - on connect: send full **snapshot** event (current run's event log or last run's) so a late-joining panel reconstructs state, then subscribe to the live bus
  - in-process `runSync` (async — API stays responsive); server installs a quiet logger (not console); events appended to an in-memory ring (bounded, e.g. last 500) + broadcast
  - run ends → mark idle; snapshot retains last summary for reconnects; no cancel endpoint
- Tests (`fastify.inject`, exported `buildApp`): POST → 200 `{runId}`; second concurrent POST → 409; SSE via `payloadAsStream` → snapshot event then close; orchestrator injected as fake (no network in tests)
- `buildApp` opts may need `{ runSync? }` (test injection) — keep default = real orchestrator

## Step 4 — Web: Sync ▶ + panel

- Header `Sync ▶` button in `components/AppShell.tsx` (next to theme toggle) → slide-over panel (hand-rolled on `radix-ui/sheet` or plain fixed panel — **no new deps**; add shadcn-style `spinner`/minimal progress inline)
- Pre-run options row: `Also sync Notion` toggle (**default off** → sends `skipNotion: true`) + Start
- Checklist driven by `hooks/useSyncEvents.ts` (native `EventSource` against `${API_BASE}/api/sync/events`; stubbable in RTL): step rows `✓/✗/⊘/⟳` + detail; progress rows show `current/total`; footer `Step x/y · overall %` (overall = (completed + currentStepFraction) / totalSteps — Q10.2 "both")
- `POST /api/sync` on Start; **409** → "Sync already running" state; on `summary` → `queryClient.invalidateQueries` for `['catalog']`, `['interests']` (+ reserve `['library']`, `['board']`, `['discover']` for P2/P4)
- Tests (RTL, fetch + EventSource stubbed from a canned stream): checklist renders from canned events, progress counters, 409 state, summary line, Notion toggle default off

## Step 5 — Verify + docs

- `pnpm test` all green; `pnpm --filter web lint && build`; root `tsc --noEmit`
- Manual: UI sync end-to-end with Notion skipped (progress animates); CLI `pnpm sync` substance unchanged; concurrent second POST → 409; API responsive mid-run
- `docs/UI-PLAN-V2.md`: remove stale ✅ from P2/P4; mark P1 status; note any decision deltas from this doc
- Remove this paragraph's leftovers: nothing — `P1-PLAN.md` stays as the execution record

## Sync step keys (17, in run order)

`config`, `overrides`, `adapters`, `notion-verify`, `steam`, `gamepass-catalog`, `interests`, `library`, `interest-games`, `dedupe`, `suggestions`, `igdb-lookup` (progress), `protondb` (progress), `notion` (progress), `snapshot`, `db-write`, `availability`

## Summary counter semantics

- `added`/`updated` — DB diff (ids existing before upsert) — meaningful even when Notion is skipped
- `removed`/`skipped` — Notion `SyncOperations` (0 when Notion skipped)
- `errors` — count of `step:error` events + Notion per-game errors
- `duration` — `runSync` wall-clock delta

## Notes / risks

- SSE long-connection: local-only tool, no proxy; snapshot-on-connect covers reconnects; bounded ring prevents unbounded memory
- Server and CLI can run sync concurrently → only SQLite locking guards cross-process (busy_timeout=5000); server 409 guards UI-triggered runs only (accepted, plan §4.2)
- `getConfig()` module singleton + overrides singleton are ambient state — orchestrator tests avoid them via fake `SyncIO`; P0B rewiring should push more state through `SyncIO`
- Playnite path is legacy (Heroic default) — moved verbatim into `default-io.ts`; no Playnite work beyond preservation
