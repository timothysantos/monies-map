# Detailed Implementation Handoff

Parent: [macro plan](./macro-performance-plan.md) (goals, budgets, contracts).
Evidence: [baseline audit](./audits/macro-loading-baseline.md) (H00, H01).
Source baseline `718e708`. Revised 2026-09-23 after H01 against current code.

This document is written so that a smaller model can implement one task per
turn without re-deriving design decisions. Where the parent plan leaves a
choice open, this document makes it. If code has moved, relocate symbols with
`rg -n`; never edit by stale line number. Line numbers below are anchors
verified on 2026-09-23 only.

## Status Board

| Step | Parent | Delivery | Status | Evidence |
| --- | --- | --- | --- | --- |
| H00 | P0 | Ownership matrix and baseline | Done | audit §H00 |
| H01 | P0 | Built-client harness and asset-cost report | Done (`506f3fd`; verify gate blocked by baseline advisories) | audit §H01 |
| H01b | P0 | Seeded 1k/10k scale fixtures + measurement | Open (prerequisite for mobile data admission only) | — |
| H02 | Prereq | Query identity characterization and repair | Done (`403bb63`, `a8176fc`) | audit §H02 |
| H03 | Prereq | Ready/busy reporting from workflow owners | **Next** | — |
| H04 | P1/P2m | Pure warmup policy | Open | — |
| H05 | P1/P2m | Shared module loader, code-only scheduler | Open | — |
| H06 | P2/P2m | Cancellation, leases, promotion | Open | — |
| H07 | P2/P2m | One bounded optional data queue | Open | — |
| H08 | P3 | Optional AI readiness | Open | — |
| H09 | P4 | Full request/initialization timing | Open | — |
| H10 | Closure | Measured comparison, first delivery | Open | — |
| H11–H17 | P5–P11 | Gated architecture work | Not funded until H10 | — |

Order is strict: H02 → H03 → H04 → H05 → H06 → H07 → H10. H08 needs only H03.
H09 needs only H01 and may run any time after H01. H01b must precede enabling
any MOBILE data candidate in H07; H07 ships with mobile data disabled if
H01b is not done. Update this board in the same change as each task.

## How To Execute A Task

1. Read `AGENTS.md`, `DOMAIN.md`, `docs/code-spec.md`, this document's Global
   Rules, Verified Code Facts, and ONLY the selected task section.
2. `git status`; note pre-existing dirty files and never revert them.
3. Confirm the task's "Depends on" evidence exists in the audit. If it does
   not, stop and report which prerequisite is missing.
4. Re-verify every "Starting facts" bullet for the task with `rg`. If a fact
   is false, stop and report the difference before editing (code moved is
   fine; semantics changed is a stop).
5. Pass 1 (contract): write the listed tests first, confirm the new ones fail
   for the stated reason, implement the smallest change, run focused tests.
6. Pass 2 (integration): walk the "Integration checklist" in the task;
   run the listed E2E/performance commands; fix and rerun.
7. Pass 3 (review): read the whole diff as a reviewer; remove debug code,
   unused exports, stray files; check comment density matches neighbours.
8. Run the task's gate commands. Record results in the audit using the
   Evidence Template at the end of this file, including failures.
9. Update the Status Board and any doc the task lists. Stop. Do not begin the
   next task.

Stop and escalate (do not improvise) when: a test can only pass by weakening an
existing assertion; a change needs a file outside "Allowed files"; a financial
value, draft, or URL contract would change; a prerequisite is missing; or two
consecutive fixes fail on the same assertion.

## Environment And Commands (verified 2026-09-23)

```sh
source ~/.nvm/nvm.sh && nvm use 22   # Node 22.12.0; shell default v20 fails prebuild
npm run typecheck                    # src/**/*.ts only; client JS/JSX is NOT type-checked
npm run test:unit                    # node:test via tsx: tests/*.test.mjs + tests/performance/*.test.mjs
npm run build                        # vite build + postbuild warmup metadata
npm run report:route-assets          # build + docs/audits/route-assets-baseline.json
npm run test:performance             # build + isolated test Worker on 5191 + built-client harness
npm run test:e2e:smoke               # serial functional smoke on Vite dev (5173) + test Worker (8787)
npm run test:e2e                     # full functional suite (same servers)
npm run verify                       # audit, typecheck, unit, build, smoke
git diff --check
```

- Focused unit file: `node --import tsx --test tests/<file>.test.mjs`.
- Focused E2E file: `node node_modules/@playwright/test/cli.js test --workers=1 tests/e2e/<file>.spec.js`.
  Functional Playwright REUSES a server already on 5173 outside CI; make sure
  nothing else is listening (`lsof -iTCP:5173 -sTCP:LISTEN`) before reseeding runs.
- Performance runs print one JSON report path per project. Set
  `PERFORMANCE_ARTIFACTS_DIR` to keep a cohort together. Do not commit raw
  reports; summarize them in the audit.
- Functional E2E serve Vite dev, never `dist`. Only `test:performance` proves
  built-client behavior (hashed chunks, embedded metadata, real code splitting).

Known baseline failures (record, do not "fix" inside unrelated tasks):

| Failure | Status |
| --- | --- |
| `npm run verify` stops at `npm audit`: 5 advisories (browserslist, sharp via miniflare/wrangler) | Pre-existing; dependency upgrades are out of scope. Run the remaining verify steps individually and record both facts |
| Full E2E: `splits-viewer-amounts` › odd-cent recipient fails deterministically | Pre-existing at `506f3fd` (money masked; created card absent); separate task |
| `money-field-editability` › settings opening balance intermittently loses typed characters | Pre-existing flake; separate task. Rerun the file alone once; record both results |
| Fresh `schema.sql` database: first data request returns 500, retry succeeds | Fixed: `audit_events` is created before legacy repairs and the OCBC repair skips its audit without a default household. `scripts/performance-preflight.sql` is deleted; regression in `tests/fresh-schema-initialization.test.mjs` |

## Global Rules

- One task per change; mechanical moves and behavior changes in separate
  commits. Commit only when the user asks or the repository convention applies;
  never commit someone else's unrelated dirty files.
- Small explicit interfaces. No App-shaped argument objects, no passing setter
  bags into hooks, no new state library, event bus, job framework, repository
  framework or universal form engine.
- Pure policy has no DOM, React, timers, fetch or network. Browser effects live
  in hooks/schedulers with injected clocks and full cleanup.
- Panels keep drafts. TanStack Query keeps server data. The scheduler keeps only
  optional-work bookkeeping. Nothing else stores DTOs.
- Never render another person's data as a placeholder. Never infer household
  from a person view. Keep `scope` in route intent even though Entries' API
  omits it.
- Every behavior change gets an exact-value positive test and at least one
  negative (denied, cancelled, stale) test. Do not raise budgets, loosen
  assertions or add sleeps to pass.
- New modules target 200–500 lines; do not grow `App.jsx` net unless the task
  says so (every task after H02 should shrink or keep it flat).
- Never use `window.alert/confirm/prompt`. No new user-visible copy unless the
  task says so; copy goes through `messages`.
- Test-only overrides use a window global read at call time (precedent:
  `__MONIES_MAP_REQUEST_TIMEOUT_MS__` in `request-timeout.js`), never a URL
  parameter or production setting.

## Glossary (use these names in code, tests and docs)

| Term | Meaning |
| --- | --- |
| Route identity | Normalized `{ tabId, viewId, month, scope, summaryStart, summaryEnd }` of the ACTIVE URL, built by `buildRouteIdentity` (H03). Cosmetic params (`summary_focus`, privacy, sheet toggles) excluded |
| Route key | `buildRouteWorkKey(identity)` string. Two URLs showing the same data have the same key |
| Ready | Every owner reporting for the ACTIVE route key is ready (App's route data for that key, plus Entries' own page DTO) and the shell has no loading/error. Never inferred from a heading, an old page kept on screen, or network idle |
| Busy | Any owner reports a protected workflow (open editor/dialog/sheet, draft, in-flight save) or a shell blocker is open |
| Usable | `ready && !busy && requiredCount === 0` |
| Required work | A request the visible route needs now (active route data, user refresh, post-mutation refetch) |
| Speculative work | Optional module import or data request for a route not yet visited. Always cancellable in scheduling, never blocks required work |
| Visit | One route identity plus workflow context. Rerender, resize, hide/show and privacy toggles do NOT start a new visit |
| Generation | Integer the scheduler increments on every visit change, epoch change, hide or busy. Work from an older generation may finish but must not enqueue more |
| Lease | A per-query-key counter of required consumers (H06). A speculative attempt is cancellable only when its key has zero leases |
| Candidate | `{ kind: "module"|"data", routeId, identity, trigger }` proposed by the pure selector |
| Admission | The policy decision `{ allowed, reason }` for one candidate at one instant |

## Verified Code Facts And Traps (2026-09-23)

Route code and warmup (`src/client/App.jsx`):

- `routeModuleLoaders` (≈81) maps 7 route IDs to literal `import()`s;
  `routeModulePreloads` Map (≈92); `preloadRouteModule` (≈202) deletes failed
  entries. Panel `lazy()` adapters (≈126–133) call `routeModuleLoaders.*`.
  `EntriesFilterStack` (≈127) is a separate direct lazy import; leave it.
- `routeTabs` (≈140): summary, month, entries, splits, imports, settings, faq.
  `primaryRouteTabs` = first 4, `secondaryRouteTabs` = last 3.
- Three NavLink sites (≈3283 primary, ≈3293 secondary, ≈3312 overflow inside a
  Radix `Popover.Portal`, opened by the "More pages" button). All use
  `to={buildTabTarget(tab)}` (≈2939).
- All-route module warmup effect (≈2605): runs `scheduleIdleTask(…, 900)` as
  soon as `appShell` exists. **H01 measured it firing before Summary is
  usable**: desktop loads month, entries, splits, imports, settings, faq,
  statement-import and Recharts chunks before the first usable frame.
- `scheduleIdleTask`/`cancelIdleTask` (≈216) wrap `requestIdleCallback` with a
  `setTimeout` fallback; no visibility check.

Optional data work:

- Banner effect (≈2405): Summary/Month only, after `currentPageView` and not
  `isAppShellLoading`; reads `queryKeys.importsPage()` cache, then idle
  `fetchQuery` with a raw `fetch("/api/imports-page")` (no signal, no timeout
  helper). Does NOT skip coarse pointer or save-data. H01: fires ≈2 s after
  usable on both desktop and mobile; response ≈1.9 KB on the demo fixture.
- Staged page prefetch effect (≈2457): skips save-data and coarse pointer.
  After `PAGE_PREFETCH_DELAY_MS` (1200) runs up to 2 high-priority tasks
  (Month ±1 month; Summary range shifted ±1, each a `prefetchSummaryPage`
  that fetches summary AND pills), waits `PAGE_PREFETCH_STAGE_DELAY_MS` (5000),
  then low-priority Splits page and Entries page with
  `PAGE_PREFETCH_SPACING_MS` (1500) spacing. **Trap: the Entries task uses
  `viewId: "household"` regardless of the selected view** — a person-safety
  violation the replacement must not copy. Its dependency list includes
  `pageView`, so any page-view change restarts the timers.
- **Third scheduler not in the old source map:** `entries-panel.jsx`
  `useEntriesPageData` (≈1550) prefetches adjacent months (delay 1200,
  spacing 650) on non-coarse pointers, gated only by save-data and its own
  epoch; no workflow/busy gate.
- `prefetchRoutePage` (≈1666), `prefetchSummaryPage` (≈1682, builds the
  Summary key by hand), `prefetchEntriesPage` (≈1706): skip when data exists
  or a fetch is in flight, swallow errors.
- `buildEntriesPageParams({ viewId, month })` is a private function
  duplicated in `App.jsx` (≈3882) and `entries-panel.jsx` (≈1833); both return
  `URLSearchParams({ view, month })`.

Fetch helpers (all follow the same pattern; traps apply to each):

- `fetchEntriesPageData` (App ≈614), `fetchReferenceData` (≈662),
  `fetchAppShellData` (≈700), `fetchRoutePageData` (≈911),
  `fetchSummaryJson` (`summary-query.js`), `fetchEntriesPage`
  (`entries-panel.jsx` ≈1453).
- Pattern: check caller `signal` → return `getQueryData(key)` if ANY data
  exists (even invalidated/stale) → otherwise `ensureQueryData` (or
  `fetchQuery` when `bypassCache`) with `retry:false` → check caller `signal`
  again. The caller signal is never passed to `fetch`.
- `fetchRoutePageData` and `fetchAppShellData` call `updateLoadingStatus`
  (shell loading label) — speculative use would change visible status.
- `fetchTextWithTransientWorkerRetry` (App ≈107): up to 3 attempts with
  250/500 ms waits when the body contains a transient Worker message; reads
  the body itself.
- `fetchWithTimeout` (`request-timeout.js`): 45 s timeout (window override
  `__MONIES_MAP_REQUEST_TIMEOUT_MS__`). **Trap:** it clears the timer and
  REMOVES the upstream abort listener in `finally` after headers arrive, so an
  upstream abort during body reading is not propagated.

TanStack Query 5.100.5 behavior (verified with a probe script):

- `cancelQueries({ queryKey, exact:true })` rejects EVERY caller awaiting that
  in-flight fetch with `CancelledError`, including a required caller that
  joined through `ensureQueryData`, even when the query function ignores its
  signal. Joining a speculative fetch is therefore unsafe without leases.
- The query-function `signal` is aborted by `cancelQueries`.
- `getQueryData` returns invalidated data (`isInvalidated:true`). Presence is
  not freshness.
- `hashKey`, `isCancelledError`, `matchQuery` are exported by
  `@tanstack/react-query`.

Query identity (`query-keys.js`) — as found before H02; Month/Summary
mapping and the import-mutation Entries params are FIXED (audit §H02). Still
true after H02: invalidation is inert (helpers ignore `isInvalidated`),
`route-page` family clears miss specialized keys, the route-load
`hasCachedPage` check uses the wrong key, Summary implicit-range invalidation
does not match, `invalidateSplitsPageQueries` is dead:

- `routeRequestKey` maps `/api/month-page` to `monthPage(params)` with URL
  names (`view`), but `monthPage` destructures `{ viewId, month, scope }`, so
  the person is dropped: household and Tim share `["month-page",{month,scope}]`.
  Proven user-visible: household → Tim on Month shows household figures.
- `invalidateMonthQueries` (`query-mutations.js` ≈37) builds
  `["month-page",{month,scope,viewId}]`, which cannot partial-match the fetched
  key, so Month invalidation after mutations is a no-op.
- `routeRequestKey` for `/api/summary-page` has the same translation bug, but
  Summary normally uses `summary-query.js` (`getSummaryPageKeyFromParams`,
  correct) and `prefetchSummaryPage` (hand-built, correct).
- Entries and Splits keys use URL names on both fetch and invalidation sides
  (consistent). The existing test "routeRequestKey routes month to the
  dedicated month key" passes only because it sends a `viewId` URL param the
  app never sends.

Other:

- Persisted client state: only the app shell (`writePersistedAppShell`) is
  persisted; TanStack caches are in-memory, so query-key changes need no
  storage migration.
- React 19 StrictMode is used in development: effects mount, clean up and
  mount again. Every hook must be idempotent under that sequence.
- The Worker serves `dist` as assets with SPA fallback for navigations;
  `public/.assetsignore` keeps `dist/.vite/manifest.json` private. Removing
  `build.manifest` or `.assetsignore` must happen together.

## H00: Establish The Starting Point — Done

Evidence in audit §H00 (plus the H01 correction note on Month/Splits keys).

## H01: Performance Harness And Build Metadata — Done

Evidence, measurements and file contracts in audit §H01. Contracts later tasks
rely on:

- `dist/index.html` contains exactly one
  `<script id="monies-warmup-costs" type="application/json">` with
  `{ schemaVersion: 1, buildId, revision, routes: { <routeId>: { entry,
  estimatedGzipBytes, chunks: [{ file, estimatedGzipBytes }] } } }` for all
  seven routes. Chunk lists are INCREMENTAL over the entry closure (entry JS
  and `styles.css` are never listed). `file` has no leading slash
  (`assets/entries-panel-XXXX.js`).
- `parseWarmupCosts(value)` returns the object or `null`. `null` = unknown
  cost for every route (never zero). Any missing/invalid route invalidates
  the whole block.
- Harness readiness is in-page fixture values plus an enabled control; timing
  is in-page `performance.now()`; it asserts validity, never timing budgets.
- Lessons that apply to any later harness change: health answers before the
  fixture is seeded (wait for `PERFORMANCE_FIXTURE_READY`); Playwright's
  default webServer teardown SIGKILLs (keep `gracefulShutdown`); keep
  `testMatch` so `node:test` files are not collected.

## H01b: Seeded Scale Fixtures (open, independent)

Goal: measure page APIs at 1k/10k rows to fill H07's admission table.
Depends on: H01. Allowed files: `tests/performance/fixtures/`,
`tests/performance/*.spec.js`, `scripts/run-performance-worker.mjs`, a new
`scripts/load-performance-fixture.mjs`, audit. No application code.

1. Replace the abstract generator roles with real IDs read from the seeded
   demo (`/api/reference-data`: people, accounts, categories). Generate rows
   for 24 months (2024-06 … 2026-05) with one 2,000-row month (2026-05) at the
   10k size; keep transfers paired, amounts integer minor units, provisional
   (never certified).
2. Load through the Worker's own write API or a generated SQL file executed
   with `wrangler d1 execute --local --persist-to <the harness temp dir>`,
   after reseed and before the ready marker. Choose the SQL route only if it
   inserts the same columns the app writes (read `schema.sql` and the entry
   create path first). Validate via `/api/entries-page` counts and totals for
   three months, including 2026-05.
3. Environment switch `PERFORMANCE_FIXTURE=demo|scale-1k|scale-10k` (default
   demo) read by the runner; report it in every JSON report.
4. Measure per query family: response bytes and `app;dur` median/p95 over 20
   direct API requests each for entries-page, month-page, summary-page (6 and
   12-month ranges), summary-account-pills, splits-page, imports-page.
Exit: audit table "Admission measurements" with fixture, revision, family,
parameters, bytes, handler median/p95. No browser budgets.

## H02: Query Identity Before Additional Cache Reuse

Goal: every route request and its mutation invalidation use one canonical key
that includes the person, month, scope and (Summary) range.
Depends on: H01 audit finding 5.
Allowed files: `src/client/query-keys.js`, `src/client/summary-query.js`,
`src/client/App.jsx` (only `prefetchSummaryPage` key construction),
`tests/query-foundation.test.mjs`, `tests/summary-query.test.mjs`,
`tests/e2e/month-page.spec.js`, audit.
Must not change: DTO shapes, endpoints, URL params, TTL/stale policy, which
caches are cleared by which mutation.

Starting facts to re-verify: the four "Query identity" facts above; that no
code reads `["month-page", …]` keys except via `routeRequestKey` and
`query-mutations.js` (`rg -n "month-page|monthPage\(|summaryPage\(" src/client`).

Design:

- Add to `query-keys.js`, as the ONLY translation from URL names to canonical
  key fields:

  ```js
  // URL uses view/summary_start/summary_end; keys use domain names.
  export function monthPageKeyFromParams(params) // -> queryKeys.monthPage({ viewId: view ?? "household", month: month ?? "", scope: scope ?? "direct_plus_shared" })
  export function summaryPageKeyFromParams(params) // -> queryKeys.summaryPage({ viewId: view ?? "household", month: month ?? "", scope: scope ?? "direct_plus_shared", startMonth: summary_start ?? "", endMonth: summary_end ?? "" })
  ```

  Defaults must equal `summary-query.js`'s current `getSummaryPageKeyFromParams`
  byte for byte (it becomes a re-export/call of the new function).
- `routeRequestKey`: month → `monthPageKeyFromParams`; summary →
  `summaryPageKeyFromParams`. Entries/Splits/Imports/Settings unchanged.
- `prefetchSummaryPage` uses `summaryPageKeyFromParams(pageParams)`.
- Result: the fetched Month key becomes `["month-page",{month,scope,viewId}]`,
  exactly what `invalidateMonthQueries` already targets. No change in
  `query-mutations.js` is needed; if one seems needed, stop and report.

Tests (write first; the first three must fail before the fix):

1. query-foundation: `routeRequestKey(buildRoutePageRequest({ tabId:"month",
   viewId:"person-tim", month:"2026-05", scope:"direct_plus_shared" }))`
   deep-equals `["month-page",{ month:"2026-05", scope:"direct_plus_shared",
   viewId:"person-tim" }]` and is NOT equal to the household key.
2. query-foundation, real `QueryClient` from `@tanstack/react-query`: set
   data under the fetched household key (`{v:100}`) and the fetched Tim key
   (`{v:200}`); call `invalidateMonthQueries(qc, { viewId:"person-tim",
   month:"2026-05", scope:"direct_plus_shared" })`; assert Tim's state
   `isInvalidated === true`, household's `false`, both values unchanged.
3. Summary via `routeRequestKey` with `view=person-tim&summary_start=2025-06&
   summary_end=2026-05` equals `summaryPageKeyFromParams` of the same params
   and differs from the household and from a 2025-07 start.
4. Summary implicit range: params without `summary_start/end` for months
   2026-04 and 2026-05 give different keys (keeps existing tests' meaning).
5. Replace the misleading `viewId` URL-param test with the real `view`
   param; keep its intent (month maps to the dedicated key).
6. Equality matrix test: for every route in `buildRoutePageRequest`, the
   fetch key and the key built by that route's invalidation helper from the
   same domain inputs are equal (`hashKey` equality), for household and Tim.
7. E2E in `month-page.spec.js` (reseed; money revealed through the existing
   privacy init script `localStorage["monies-map:money-totals-visible"]="true"`,
   as `financial-insight.spec.js` does):
   open `/month?view=household&month=2026-05`, wait ready; read the expected
   Tim planned spend from `loadMonthPage(page,{view:"person-tim",
   month:"2026-05", scope:"direct_plus_shared"})` — the field feeding the
   PLANNED SPEND card (`selectedMonthSummary.estimatedExpensesMinor` in
   `month-panel.jsx`; locate its DTO path, do not hard-code $5,189.88, and
   format with the same helper the test file already uses for money);
   click "Tim"; assert a
   request to `/api/month-page` with `view=person-tim` occurs, the view label
   is Tim, and the planned-spend text equals the formatted expected value.
   Negative: switch back to Household and assert household values (cache hit
   allowed, but never Tim's).

Integration checklist: Summary still issues one summary-page and one pills
request per identity; Month mutations now actually invalidate (run
`month-page.spec.js` fully; any newly visible refetch is correct behavior,
record it); cross-tab (`splits-cross-tab-refresh.spec.js`).
Gates: unit, typecheck, `month-page.spec.js`, `summary-workflow.spec.js`,
full `npm run test:e2e` (shared key change), `test:performance` (record that
warm Summary↔Entries is unchanged).
Commit: "Include person in Month route query identity".
Exit: equality/separation matrix in audit; wrong-person E2E passes.

## H03: Readiness And Busy Reporting

Goal: the shell knows, from the actual owners, whether the active route is
usable and whether any protected workflow is busy. No scheduling changes yet.
Depends on: H02.
Allowed files: `src/client/App.jsx`, the six route panels and the child
editors named in the inventory below, new `src/client/route-work-status.js`
(pure) and `src/client/use-route-work-status.js` (hooks), new
`tests/route-work-status.test.mjs`, new `tests/e2e/route-work-status.spec.js`,
audit.
Must not change: any existing freshness lock, deferred-refresh rule, draft
state, or network request.

Design (exact public surface):

```js
// route-work-status.js (pure, unit-tested)
export function buildRouteIdentity({ tabId, viewId, month, scope, summaryStart, summaryEnd })
//   -> frozen object; month/scope/summary* set to "" when the route ignores them
//      (entries/splits ignore scope for DATA but keep it in identity; imports,
//      settings, faq ignore month/view/scope)
export function buildRouteWorkKey(identity) // -> "summary|household|2026-05|direct_plus_shared|2025-06|2026-05"
export function createRouteWorkRegistry()
//   report({ ownerId, routeKey, ready, busy }) -> boolean changed
//   release(ownerId)                        -> boolean changed
//   subscribe(listener) -> unsubscribe;  version() -> number (for useSyncExternalStore)
//   snapshot(routeKey) -> { hasReport, ready, busy, busyOwnerIds }
//     hasReport = at least one report for routeKey
//     ready = hasReport && every report for routeKey is ready
//     busy  = ANY owner (any routeKey) reports busy  (a closing dialog on the
//             old route still blocks until it releases)
export function createRequiredWorkCounter()
//   begin(label) -> end() (idempotent); count() -> number
export function deriveRouteWork({ currentPageView, routeKey, snapshot, isAppShellLoading,
  appShellError, routePageError, referenceDataReady, requiredCount,
  mobileContextOpen, loginRegistrationBlocking })
//   -> { routeKey, ready, busy, requiredCount, usable, reason }
//   ready false reasons: no-page-view, shell-loading, shell-error, route-error,
//                        no-reference-data, no-report, not-ready
//   busy true reasons:   mobile-context-open, login-registration, busy
//   then: required-work; else usable
```

```js
// use-route-work-status.js
export function RouteWorkProvider({ registry, routeKey, children })
//   context only; App wraps the rendered route element with
//   routeKey = currentPageView ? activeRouteKey : null
export function useRouteWorkReport({ ready = true, busy })  // for owners and children
//   routeKey from context; when null, report nothing (and release).
//   ownerId from useId(); report in useEffect on [routeKey, ready, busy]
//   (primitives only, coerce with Boolean()); cleanup releases ONLY this ownerId.
export function useRouteWorkSnapshot(registry, routeKey) // for App; useSyncExternalStore
```

Rules:

- Readiness has two sources. (a) App owns route data for every route except
  Entries' page DTO: it is ready when the data it holds was fetched for the
  ACTIVE request key. Generic routes already have `routePageDataRequestKey`
  vs `routePageRequestKey` (`currentRoutePageData`). Summary does not: add
  `summaryPageDataRequestKey` (the `hashKey` of the summary + pills keys used
  for the fetch) set together with `summaryPageData`, and treat Summary data
  as ready only when it equals the active key. App reports this as owner
  `"shell-route-data"`. (b) Entries owns its page DTO: the panel reports
  `ready = !isEntriesPageLoading && entriesPage.monthPage.month ===
  selectedMonth && <view matches entriesSourceView.id>` (fix the initial
  `isEntriesPageLoading=false` render by treating "no page for these params
  yet" as not ready). Every other panel reports `ready: true` whenever it is
  mounted for the active key; its `busy` is what matters.
- App passes each panel `routeWorkKey = currentPageView ? activeRouteKey :
  null`. A panel given `null` (the previous page kept on screen) does not
  report, so an old page can never make the new route ready.
- `busy` for an owner = OR of the expressions in the inventory. Open but
  unmodified mobile filter/picker sheets count as busy (they cover the page).
- Where a save has no in-flight flag today (Month note dialog save, plan-link
  save, row removal), add one local boolean set in `try/finally`; it only
  feeds `busy`. Do not change the save logic.
- Required fetch counter: wrap each REQUIRED fetch the shell awaits in
  `const end = counter.begin(label); try { … } finally { end(); }` — the
  app-shell load, route/summary/pills loads, reference data, and the
  `refreshCurrent*Page` / `refreshActiveRoutePageInBackground` callbacks
  (they fetch today without touching `appShellLoadCount`). Do NOT count
  prefetch, banner or AI calls (they would deadlock later scheduling).
- Shell-level blockers: `mobileContextOpen`; `loginRegistrationDraft` (modal
  open); `isRegisteringLogin`; `isUnregisteringLogin`.
- `deriveRouteWork` evaluates in the order listed in its comment and returns
  the FIRST failing reason (strings are for tests/dev only).
  `loginRegistrationBlocking = Boolean(loginRegistrationDraft) ||
  isRegisteringLogin || isUnregisteringLogin`.
- Expose to later tasks one App-level value:
  `const routeWork = deriveRouteWork(...)` memoized on its primitive fields.
  H05/H07/H08 read it; nothing else is added.

Inventory: see "H03 owner inventory" below; implement owners one commit each
in this order: Summary, Month, Entries, Splits, Imports, Settings, then FAQ
(always ready, never busy). Delegated child editors report through their own
`useRouteWorkReport` when the panel cannot see their state.

Tests:

- Unit (`route-work-status.test.mjs`): two owners same key (one not ready →
  not ready); owner A busy, owner B idle → busy; release A → not busy;
  release of unknown ID no-op; stale report for old key does not make new key
  ready; `buildRouteWorkKey` excludes `summary_focus`; identical identities →
  identical keys; household vs Tim differ; counter begin/end idempotent and
  nested; every `deriveRouteWork` reason reachable, one test each, and `usable` true
  only when all gates pass.
- E2E (`route-work-status.spec.js`), with a test-only read hook
  `window.__MONIES_MAP_ROUTE_WORK__` that App assigns ONLY when
  `import.meta.env.MODE !== "production"` (it is absent from `dist`; assert
  this in the performance harness):
  navigate Summary → Entries with the Entries API delayed via `page.route`
  1.5 s: while delayed, usable=false even though Summary content is visible;
  after response, usable=true. Open an Entries edit dialog: busy=true; type a
  draft; close without saving: busy=false and draft behavior unchanged. Save
  failure (route returns 500) keeps busy until the user dismisses; retry
  succeeds. Month mobile add sheet open (390×844): busy=true. Imports: open
  file mapping dialog: busy=true. Settings account dialog: busy=true.
- StrictMode: unit-test the registry with report/release/report sequence;
  E2E runs on Vite dev (StrictMode on) so double effects are exercised.

Integration checklist: no new requests (compare request lists of
`app-shell.spec.js` before/after); drafts survive route change and back;
`mobile-continuity.spec.js`, `money-field-editability.spec.js`,
`import-preview-auto-refresh.spec.js` pass.
Gates: unit, typecheck, smoke, full E2E.
Exit: audit lists each owner, its busy/ready expressions, and test names.

### H03 owner inventory

(Filled from the 2026-09-23 code survey; re-verify names before use.)

Legend: B = contributes to `busy`; R = readiness; "add" = state that must be
added (a boolean only). Children listed under an owner report through their
own `useRouteWorkReport` because the panel cannot see their state. Dead code:
`SplitLinkedEntryDialog` is never rendered; ignore it.

**Shell (App.jsx)** — R: `shell-route-data` as above. Blockers:
`appShellError`, `routePageError`, `referenceDataError`, `isAppShellLoading`
(`appShellLoadCount > 0`, also used by route/summary loads), missing
`referenceData`, `mobileContextOpen`, `loginRegistrationDraft`,
`isRegisteringLogin`, `isUnregisteringLogin`. Known trap: `summaryPageData`
and `summaryAccountPillsData` are not keyed by request (add the key).

**Summary (`summary-panel.jsx`)** — B: `monthNoteDialog`, `isSavingMonthNote`.
Child `CategoryAppearancePopover` (category-visuals.jsx): B `dialog`,
`isSubmitting`. Note: its `onRefresh` prop is actually the note SAVE
(`saveSummaryMonthNote`).

**Month (`month-panel.jsx`)** — B: `editingRowId`, `noteDialog`,
`planLinkDialog`, `monthNoteDialog`, `isSavingMonthNote`,
`isDraftingMonthNote`, `isSavingMonthRow`, `mobileAddDialog`, `actionsOpen`,
`isMonthDataRefreshing`, `hasPendingDerivedMonthData`, `isDuplicating`,
`isResettingMonth`, `isDeletingMonth`, `resetMonthText !== ""`,
`deleteMonthText !== ""`; add `isSavingNoteDialog`, `isSavingPlanLink`,
`isRemovingRow`. Children: `MonthPanelHeader` (month-overview.jsx) B
`resetDialogOpen`, `deleteDialogOpen`; `CategoryAppearancePopover` B
`dialog`, `isSubmitting`.

**Entries (`entries-panel.jsx`)** — R: as above. B: `showMobileFilters`,
`isQuickExpenseSaving`, `quickExpensePendingKey`, `pendingLinkedEntryId`,
`deletingCreatedSplitId`, `deleteConfirmation`, `entryNoteSyncPrompt`,
`isSyncingEntryNote`, `entryCategorySyncPrompt`, `isSyncingEntryCategory`,
`isMobileSplitPickerOpen`, `isMobileSplitSelectorOpen`, and from
`useEntryActions` (entry-actions.js): `editingEntryId`, `showEntryComposer`,
`isSavingEntryDraft`, `savingEntryId`, `deletingEntryId`,
`linkingTransferEntryId`, `settlingTransferEntryId`, `transferDialogEntryId`,
`refreshingTransferCandidatesEntryId`, `addingToSplitsEntryId`. Children:
`EntriesDateGroups` (entries-list.jsx) B `splitPickerEntry`,
`refreshingDate`; `EntryEditorFields` (entry-editor.jsx) B
`categoryQuickSaveOpen`; `CategoryAppearancePopover` B `dialog`,
`isSubmitting`. Also note: the shell may request `/api/entries-page` for
the Entries route AND the panel may request it; H01 observed one request per
visit — confirm in H03's E2E that both use `queryKeys.entriesPage` with the
same params, do not merge them in H03.

**Splits (`splits-panel.jsx`)** — B: `archiveDialog`, `showHistory`,
`groupDialog`, `isSubmitting`, `splitNoteSyncPrompt`, `isSyncingSplitNote`,
`splitCategorySyncPrompt`, `isSyncingSplitCategory`, `isRefreshingDerived`,
`isCheckpointing`, `optimisticSplitsPage !== null`, and from
`useSplitEditState` (split-editing.js): `expenseDialog`, `settlementDialog`,
`inlineSplitDraft`, `deleteTarget`. Child `SplitActivityGroups`
(splits-activity.jsx) B `refreshingDate`.

**Imports (`imports-panel.jsx`)** — B: `importDraftExists`,
`importWorkflowModel.isWorkflowLocked`, `isParsingStatement`,
`isSubmitting`, `isRecentImportsRefreshing`, `isExplainingMismatch`,
`isRankingDuplicates`, `accountDialog`, `intakeQueue.length > 0`. Children:
`ImportPreviewReview` (import-preview-review.jsx) B
`CertifiedConflictRows.restoreTarget`, `ConfirmLedgerActionButton` `open`
or `isWorking`, `PostedDateDialog` `open` or `isWorking`;
`PreviewRowsTable.restoreTarget` (import-preview-rows-table.jsx). Leave its
existing auto-refresh/auto-preview gates unchanged.

**Settings (`settings-panel.jsx`)** — B: `isSubmitting`,
`emptyStateDialogOpen`, `reloadDialogOpen`, `dismissTransfersConfirmOpen`,
`personDialog`, `accountDialog`, `categoryDialog`, `categoryRuleDialog`,
`reconciliationDialog`, `statementCompareStatus?.tone === "active"`,
`transferDialogEntryId`, `refreshingTransferCandidatesEntryId`,
`rankingTransferCandidatesEntryId`, `linkingTransferEntryId`,
`settlingTransferEntryId`, `isRefreshingTransfers`. Children:
`SettingsShortcutApiSection` B `isInstalling`; `SettingsTrustSection` B
`draftOpen`; `StatementCompareDirectionMismatch` and
`StatementCompareMissingRow` (statement-compare.jsx) B `open` or `isSaving`.
Shell-owned `isUnregisteringLogin` is already a shell blocker.

**FAQ** — always ready, never busy (no state, no data).

Shared children used by several owners (`CategoryAppearancePopover`,
`ResponsiveSelect` `isOpenInternal`) report once per mounted instance via
`useRouteWorkReport` with the route key from context
(`RouteWorkProvider` supplies it), so they need no new props.

## H04: Pure Warmup Policy

Goal: deterministic admission decisions and candidate selection, no effects.
Depends on: H03 (for input names only; can be written in parallel).
Allowed files: new `src/client/route-warmup-policy.js`,
`tests/route-warmup-policy.test.mjs`. The module may import nothing.

Public surface:

```js
export const WARMUP_LIMITS = Object.freeze({
  desktop: { quietMs: 1200, autoModulesPerVisit: 1, dataPerVisit: 2, dataSpacingMs: 1500 },
  mobile:  { quietMs: 2000, autoModulesPerVisit: 1, dataPerVisit: 1, maxModuleBytes: 50_000,
             autoModulesPerWindow: 2, windowMs: 60_000, maxDataBytes: 50_000,
             maxDataHandlerMs: 250, maxRecentRequiredMs: 500 },
  speculativeDeadlineMs: 1500
});
export function selectWarmupMode({ narrowViewport, coarsePointer }) // booleans or null
//   -> "mobile" if either true; "mobile" if either is null (unknown = conservative); else "desktop"
export function evaluateWarmup(input) // -> { allowed, reason }
export function selectWarmupCandidates(input) // -> Candidate[] in priority order
export function buildVisitKey(identity, workflowContext) // string; excludes cosmetic params
```

`evaluateWarmup` input (all fields required; tests build it with a helper):

```js
{
  mode: "desktop"|"mobile", now,
  page: { visible, online, saveData, effectiveType /* string|null */ },
  work: { ready, busy, requiredCount },   // from H03 routeWork
  quietSince,                      // ms timestamp of last interaction or usable
  visit: { moduleStarts, dataStarts, lastDataStartAt /* null */ },
  recentModuleStarts,              // timestamps of automatic module starts, all visits
  moduleInFlight, dataInFlight,    // booleans
  recentRequiredDurationMs,        // null when unknown
  candidate: { kind, routeId, trigger /* "auto"|"hover"|"focus"|"pointerdown" */,
               alreadyLoaded, missingBytes /* null = unknown */,
               admission /* null or { responseBytes, handlerMs } */ }
}
```

Decision order (first match wins; exact reason strings):

1. `!page.visible` → `hidden`; `!page.online` → `offline`; `page.saveData` →
   `save-data`.
2. `mode==="mobile"` and `effectiveType` in `slow-2g|2g|3g` → `slow-connection`.
3. `!work.ready` → `not-ready`; `work.busy` → `busy`; `work.requiredCount>0`
   → `required-work`.
4. `candidate.alreadyLoaded` → `already-loaded` (never charged). For modules
   this is `getRouteModuleState === "loaded"`; for data it means FRESH per
   H07 rule 3 (presence alone is not fresh).
5. Module, trigger `auto`:
   `routeId` in imports/settings/faq → `forbidden-route`;
   `now - quietSince < quietMs` → `quiet-period` (equality passes);
   `moduleInFlight` → `module-in-flight`;
   `visit.moduleStarts >= autoModulesPerVisit` → `visit-module-budget`;
   then MOBILE ONLY (desktop has no byte cap or rate window, and allows
   unknown cost):
   `missingBytes === null` → `unknown-cost`;
   `missingBytes > maxModuleBytes` → `over-byte-cap` (50,000 passes);
   count of `recentModuleStarts` with `now - t < windowMs` ≥
   `autoModulesPerWindow` → `rate-limit` (a start exactly 60,000 ms old has
   expired).
6. Module, intent trigger: `hover` in mobile mode → `hover-on-mobile`;
   otherwise `hover`, `focus` or `pointerdown` is allowed (bypasses quiet,
   bytes, visit and rate limits; safety gates 1–4 still apply). Intent loads
   are not counted in `moduleStarts` or `recentModuleStarts`.
7. Data (any trigger; intent never starts data):
   trigger ≠ `auto` → `data-needs-auto`; `quiet-period` as above;
   `dataInFlight` → `data-in-flight`; mobile `moduleInFlight` →
   `module-before-data`; `visit.dataStarts >= dataPerVisit` →
   `visit-data-budget`; desktop `lastDataStartAt!==null && now -
   lastDataStartAt < dataSpacingMs` → `data-spacing`;
   mobile: `effectiveType !== "4g"` → `connection-not-4g` (null included);
   `recentRequiredDurationMs===null || > 500` → `recent-required-slow`;
   `admission===null` → `not-admitted`; `responseBytes > 50,000` or
   `handlerMs > 250` → `over-data-cap` (equality passes).
8. Otherwise `{ allowed:true, reason:"ok" }`.

`selectWarmupCandidates({ mode, identity, availableMonths, recentDestination,
intent })` returns abstract candidates only (`{ kind, routeId, identity,
trigger, purpose }`); adapters in H05/H07 turn them into loaders/keys with the
real builders. Order:

1. `intent` (exact destination from a NavLink) → one module candidate.
2. `recentDestination` if it is in the same workflow (same viewId) → module,
   then data. It is supplied by the H05 hook: an in-memory (never persisted)
   map `from route key → last identity the user navigated to from it`,
   recorded on each actual route change in this tab.
3. Summary → Entries for `{ viewId, month }` of the Summary URL; Month →
   Entries for the same `{ viewId, month, scope }`. Module first, then data
   (`purpose:"entries-page"`). Never Summary range months, never another view.
4. Desktop data only, after the above, retaining useful current behavior:
   Month ±1 adjacent month (`month-page`), Summary range shifted ±1 as TWO
   separate candidates each (`summary-page`, `summary-account-pills`), then
   Entries adjacent months when on Entries (`entries-page`), then the
   imports banner (`imports-page`) on Summary/Month. The queue stops at the
   per-visit data budget, so later items are opportunistic.
5. Mobile: no candidate for Entries/Splits routes without matching
   `recentDestination`; never imports/settings/faq/PDF/OCR automatic.

Tests: every numbered denial alone (table-driven, one row per reason);
unknown connection mobile (code allowed, data `connection-not-4g`); hybrid
(`narrowViewport:false, coarsePointer:true` → mobile; null → mobile); bytes
49,999/50,000/50,001; handler 249/250/251; recent required 500/501; rate
window 59,999/60,000; quiet 1,999/2,000 (mobile) and 1,199/1,200 (desktop);
data spacing 1,499/1,500; person-safe candidates (Tim identity → Tim
entries only); Entries route produces no mobile automatic candidate;
forbidden routes absent from automatic lists but allowed via intent;
`already-loaded` not charged (caller-visible via reason); `buildVisitKey`
identical across `summary_focus` and privacy changes and different across
view/month; hover on mobile denied, pointerdown allowed.
Exit: `npx tsx --test tests/route-warmup-policy.test.mjs` passes; no imports
in the module (`rg -n "^import" src/client/route-warmup-policy.js` empty).

## H05: Shared Loader And Code-Only Scheduler

Goal: replace the all-route idle import with policy-gated, usable-only code
warmup plus link intent. No data changes.
Depends on: H03, H04.
Allowed files: `src/client/App.jsx`, new `src/client/route-modules.js`,
new `src/client/route-warmup-costs.js`, new
`src/client/route-warmup-scheduler.js`, new `src/client/use-route-warmup.js`,
`scripts/route-asset-report.mjs` (import the parser from the client module),
new `tests/route-warmup-scheduler.test.mjs`, new
`tests/route-warmup-costs.test.mjs`, new `tests/e2e/route-warmup.spec.js`,
`tests/performance/built-client.spec.js` (add assertions only),
`tests/client-route-chunks.test.mjs` (follow moves only), audit.

Step A (mechanical commit): `route-modules.js`

```js
const loaders = { entries: () => import("./entries-panel.jsx"), … };  // literal imports stay literal
export const ROUTE_IDS = Object.freeze(Object.keys(loaders));
export function loadRouteModule(routeId)   // same promise for concurrent callers; on rejection
                                           // delete the entry, then rethrow to the caller
export function getRouteModuleState(routeId) // "idle"|"pending"|"loaded"
export function warmRouteModule(routeId)   // loadRouteModule(...).catch(() => {}) — never unhandled
```

App's `lazy()` adapters call `loadRouteModule`. Delete `routeModuleLoaders`,
`routeModulePreloads`, `preloadRouteModule` from App. React.lazy keeps its own
rejected promise: do not claim this enables UI retry; the existing error
boundary behavior is unchanged. Run chunk tests and `test:performance`
(chunk hashes/names should be unchanged; record).

Step B: `route-warmup-costs.js` (pure, browser-safe, no node imports)

- Move `parseWarmupCosts` here unchanged; `scripts/route-asset-report.mjs`
  imports it from `../src/client/route-warmup-costs.js` (single source).
- `readWarmupCosts(doc = document)`: memoized; returns parsed object or null;
  swallows errors; no network.
- `missingRouteBytes(costs, routeId, loadedRouteIds)`: null if costs null or
  route absent; else sum of `routes[routeId].chunks` whose `file` is not in
  the union of chunk files of `loadedRouteIds`. Loaded = `getRouteModuleState
  === "loaded"`; never assume a route's dynamic children (Recharts, PDF) loaded.
- Tests: shared chunk counted once; loaded route subtracts shared chunk;
  unknown route null; null costs null; zero-byte result only when every chunk
  is already loaded.

Step C: `route-warmup-scheduler.js` (no React)

```js
export function createRouteWarmupScheduler({
  clock,            // { now(), setTimeout, clearTimeout }
  idle,             // { request(cb) -> handle, cancel(handle) } (requestIdleCallback or timeout)
  loadModule,       // routeId -> Promise
  readInput,        // () -> latest policy input minus candidate (fresh every call)
  evaluate,         // evaluateWarmup
  selectCandidates, // () -> Candidate[] (H04 selector bound to latest context)
  costFor,          // routeId -> { alreadyLoaded, missingBytes }
})
// -> { updateContext({ visitKey, generationReason }), offerIntent({ routeId, trigger }), dispose() }
```

- State: `generation`, `visitKey`, per-visit counters, `recentModuleStarts`,
  `moduleInFlight`, one timer handle, one idle handle, `disposed`.
- `updateContext`: if `visitKey` changed → new generation, reset per-visit
  counters, clear timers. Any call re-arms ONE timer for `quietMs` measured
  from the input's `quietSince`; the timer re-reads `readInput()` and
  re-evaluates (never trusts captured state), then waits for one idle
  callback before starting.
- Reserve the slot (increment counters, set `moduleInFlight`) BEFORE calling
  `loadModule`. On settle, clear `moduleInFlight`; if generation changed or
  disposed, do nothing further.
- `offerIntent`: evaluate with trigger; if allowed call `loadModule` now
  (dedupes through `loadRouteModule`); cancels a pending automatic timer for
  a different route in the same generation.
- `dispose`: cancel timer/idle, set `disposed`; late settles do nothing.

Step D: `use-route-warmup.js` + App wiring

- Inputs from App: `routeWork` (H03), route identity, `queryEpoch`. Add
  `const [queryEpoch, setQueryEpoch] = useState(0)` and make
  `bumpQueryEpoch` also call `setQueryEpoch((value) => value + 1)`; keep
  `queryEpochRef` for existing readers. A changed `queryEpoch` makes the hook
  call `updateContext` with a new generation.
- Hook owns: `matchMedia("(max-width: 760px)")` and `("(pointer: coarse)")`
  listeners, `visibilitychange`, `online/offline`,
  `navigator.connection` `change`, passive `pointerdown`, `keydown`,
  `wheel`, `touchstart`, `scroll` (capture) listeners that set
  `quietSince = now` and call `updateContext`. A focused editable element
  (`input, textarea, select, [contenteditable]`) blocks via a `busy`-like
  flag until `focusout`; blur restarts quiet time.
- Latest context lives in a ref; `readInput` reads the ref. Unrelated
  rerenders must not reset `quietSince`.
- Returns `getNavIntentProps(routeId)` → `{ onPointerEnter, onFocus,
  onPointerDown }`: pointerenter only when `event.pointerType === "mouse"`
  (trigger hover); focus only when `:focus-visible` matches (keyboard);
  pointerdown for `touch|pen`. Never `preventDefault`, never delay the
  click. Spread onto all three NavLink sites without changing `to`,
  `className`, `title`, children. External links are not wired.
- Remove the all-route idle effect and `scheduleIdleTask` usage for modules
  only. Keep data effects (banner, staged prefetch, Entries adjacent) until H07.
- Test override: `window.__MONIES_MAP_WARMUP_MODE__` = `"off"` |
  `"intent-only"` | undefined (normal), read at evaluation time; used by H10.

Tests (scheduler, fake clock + deferred promises, no real timers): W01, W02,
W03, W05, W06, W07, W08, W09, W16, W17, W20 from the table below; plus
StrictMode-like `create → dispose → create` leaves one timer; `offerIntent`
during automatic pending replaces it; failed load keeps slot spent.
E2E `route-warmup.spec.js` (Vite dev, network assertions by request URL
containing the route module name, e.g. `entries-panel`): mobile 390×844 with
`hasTouch`: no route module request before usable; exactly one (Entries)
after 2 s quiet on Summary; none while an editor is open; pointerdown on
Entries link starts the Entries module before click; keyboard Tab to "Month"
link starts Month module; save-data emulation (`Object.defineProperty(
navigator, "connection", …)` in an init script) → no speculative module but
click still loads.
Performance: extend `built-client.spec.js` to report route-module requests
before/after usable; H10 compares. Expected (not a budget): desktop JS before
usable drops from 21 files toward the Summary closure plus Recharts.
Gates: unit, typecheck, `client-route-chunks`, `app-shell.spec.js`,
`mobile-continuity.spec.js`, `faq-content.spec.js`, smoke, full E2E,
`test:performance`.
Exit: code-only warmup gated by usable/busy; no new API requests; record
cold/warm/idle deltas.

## H06: Cancellation, Leases And Promotion

Goal: speculative data requests become cancellable without ever breaking a
required consumer of the same key. No new warmup yet.
Depends on: H05 (scheduler exists) and H02 (keys are correct).
Allowed files: `src/client/request-timeout.js`, `src/client/App.jsx` fetch
helpers, `src/client/summary-query.js`, `src/client/entries-panel.jsx`
(`fetchEntriesPage` only), new `src/client/query-leases.js`,
`route-warmup-scheduler.js`, tests. Migrate one resource family per commit in
this order: Entries (App + panel), generic route page, Summary/pills, Imports.

Design:

1. `fetchWithTimeout`: when an upstream signal is given, pass
   `AbortSignal.any([controller.signal, upstreamSignal])` to `fetch` if
   `AbortSignal.any` exists; otherwise keep today's listener. Do not remove
   the timeout's existing header-phase semantics. Test that an upstream abort
   after headers but during `response.text()` rejects with AbortError.
2. Every fetcher: `queryFn: ({ signal }) => fetcher({ signal })`, passing
   TanStack's signal into `fetchWithTimeout`. Never pass the CALLER's
   `signal` to fetch; caller signals still only guard result application.
3. `query-leases.js`:

   ```js
   export function createRequiredLeases() {
     // acquire(queryKey) -> release()  (idempotent), isRequired(queryKey) -> bool
   }
   ```

   keyed by `hashKey(queryKey)`. One module-level instance exported as
   `requiredLeases`. Required helpers acquire BEFORE their first
   `getQueryData` and release in `finally`.
4. Purpose: helpers take `{ purpose = "required" }`. `"speculative"`:
   skips `updateLoadingStatus`, never sets App state, uses
   `fetchTextWithTransientWorkerRetry(url, { maxAttempts: 1 })` (new option,
   default 3 unchanged), and returns only the DTO to the scheduler.
5. Required recovery (W12): if `ensureQueryData` rejects with
   `isCancelledError(error)` and the caller's own signal is not aborted, call
   `fetchQuery` once for the same key (still `retry:false`); a second
   cancellation propagates as today.
6. Scheduler data attempt: record `{ hash, generation, startedAt }`; start a
   `speculativeDeadlineMs` timer; on deadline, hide, busy or generation
   change: if `!requiredLeases.isRequired(key)` and the attempt is still the
   in-flight one, `queryClient.cancelQueries({ queryKey, exact: true })`;
   otherwise leave it running (promoted). `promote(key)` (new scheduler
   method, called by lease acquisition through an injected callback) clears
   the deadline. Never prefix-cancel.

Tests (real `QueryClient`, deferred mocked `fetch`): W10, W11, W12, W13, W14,
W18, W20; lease released on failure; `maxAttempts:1` makes exactly one
fetch on a transient body while required keeps three; speculative purpose
leaves `updateLoadingStatus` uncalled (inject a spy); caller abort
suppresses result but does not abort the network when another consumer
holds a lease.
Integration: existing `clear*Cache` helpers call `cancelQueries` before
`removeQueries`; with signals forwarded those now abort the network too —
confirm the rejected callers are the same set as before (they already got
`CancelledError`), by running `import-preview-auto-refresh.spec.js`,
`summary-workflow.spec.js`, `splits-cross-tab-refresh.spec.js`,
`entries-*` specs.
Gates: unit, typecheck, full E2E, `test:performance` (no regression).
Exit: races proven; no new speculative requests yet.

## H07: One Optional Data Queue

Goal: all optional data (banner, staged prefetch, Entries adjacent months) go
through one scheduler with the H04 budgets; old effects removed.
Depends on: H06; H01b for mobile data admission (otherwise mobile data stays
disabled by an empty admission table).
Allowed files: scheduler/hook, `App.jsx` (remove old effects),
`entries-panel.jsx` (remove adjacent prefetch effect; expose nothing new),
`app-routing.js` (`buildEntriesPageParams` export),
new `src/client/route-warmup-admissions.js`, tests.

Prerequisite check: audit §H02 "Related mismatches" 2–4. Freshness below
must be computed from `getQueryState` directly, never from assuming a
mutation invalidated the key. If a candidate family's invalidation is known
to miss (Summary implicit range), treat its cached data as fresh only
within `staleTime` from `dataUpdatedAt`, and record the choice.

1. `route-warmup-admissions.js`: checked-in table
   `{ family, fixture, revision, maxParams, responseBytes, handlerMs }` from
   H01b. `admissionFor(family, identity)` returns `{ responseBytes,
   handlerMs }` or null (unknown/out of bounds, e.g. Summary range longer
   than measured). Desktop ignores admission; mobile requires it.
2. First (mechanical commit): move `buildEntriesPageParams` into
   `app-routing.js` as an export and import it in both `App.jsx` and
   `entries-panel.jsx` (identical output; add a unit test).
   Data candidate adapters use the real builders: `buildRoutePageRequest`,
   `buildEntriesPageParams`, `buildSummaryPageParams`,
   `buildSummaryAccountPillsParams`, keys from `queryKeys`/H02 helpers.
   Entries data uses the SELECTED view (fixes the hard-coded household).
3. Freshness: a candidate is skipped (not charged) only when
   `getQueryState(key)` has data, `!isInvalidated`, and
   `dataUpdatedAt + staleTime > now` for that family's existing stale policy
   (banner 5 min; route pages currently infinite-until-invalidated, i.e.
   data present and not invalidated). Otherwise a speculative fetch is
   charged even if it later dedupes.
4. Mobile Summary/Month banner: read cache only (`getQueryData(importsPage)`),
   never fetch for the banner; Imports route loads it normally. Desktop
   banner is a normal data candidate. Post-mutation banner refresh keeps its
   existing path (import mutations invalidate `imports-page`).
5. Remove: banner effect, staged prefetch effect, `prefetchSummaryPage`
   Promise.all, `PAGE_PREFETCH_*` constants, `routePagePrefetchTimerRef`,
   `IMPORT_INBOX_BANNER_WARMUP_TIMEOUT_MS`, the Entries adjacent prefetch
   effect and its constants — after `rg` confirms no other reader.
6. Charged starts include failed/aborted attempts; no refunds; resume never
   refills.

Tests: W14, W15, W19 plus: mobile eligible → exactly one data request per
visit; mobile without connection info → zero data; desktop → at most two
sequential data requests with ≥1,500 ms between starts; editor opened before
and after launch → no new work, draft kept; join warming Entries request →
one network request, correct DTO; import commit then return to Summary →
badge updates via existing invalidation; Tim Summary never warms household
Entries; background/resume three times → counters unchanged.
Gates: full E2E, `test:performance` (idle 2/10/30 s API counts must be within
the new budgets: desktop ≤2 per visit, mobile ≤1 and 0 without admission).
Exit: old schedulers deleted; budgets apply to actual requests.

## H08: Optional Insight Readiness

Goal: AI wording requests only when the route is usable and the owner is not
editing; deterministic content unchanged.
Depends on: H03.
Allowed files: `src/client/financial-insight.jsx`, its four call sites
(`summary-panel.jsx` ≈167, `month-panel.jsx` ≈1348, `splits-panel.jsx`
≈1095, `entries-panel.jsx` ≈1052), `tests/e2e/financial-insight.spec.js`,
`tests/e2e/money-privacy.spec.js`, audit. No prompt or finance math change.

Starting facts (verified): `FinancialInsight({ facts, actions = [],
className = "" })`; `INSIGHT_DEBOUNCE_MS = 700`; module `insightCache` Map
(48 entries, 15 min / 5 min TTL); effect deps include object identities of
`facts`/`aiFacts`, so a new facts object restarts the debounce; the cache is
written even after cleanup cancelled the request; `fetchResponse.ok` is not
checked; Summary builds `focusState` without memo, so facts are rebuilt every
render.

1. Add `canRequestWording = false` prop. App passes `routeWork.usable` (H03)
   to each of the four panels as a boolean prop `canRequestWording`; each
   panel forwards it to `FinancialInsight`. Panels that own local busy state
   already fold it into `routeWork.busy` through H03, so no extra local OR.
2. Effect depends on `cacheKey` (string), `areTotalsVisible`,
   `canRequestWording` — not object identities. Read `aiFacts` through a ref
   updated each render.
3. Before caching or applying: require `!cancelled`, `response.ok`, and the
   request's `cacheKey === current cacheKey` (captured). Unavailable or
   malformed → deterministic narrative, cached 5 min only when not cancelled.
4. Summary: memoize `focusState` on `[safeSummaryPage, summaryFocusParam]`.

Tests: opening an edit dialog during the 700 ms debounce → zero AI requests;
closing → one request after a new full 700 ms; save during in-flight request
→ aborted, not cached (next ready state requests again); facts change →
old response ignored; hide money → abort, no request; 503/malformed →
deterministic text; rerender without facts change → one request total
(count requests via `page.route`). Run AI unit, financial-insight, privacy,
money-editability E2E.

## H09: Full API Timing

Goal: Server-Timing exposes initialization and full request time without
changing responses.
Depends on: H01. Read the `cloudflare`/`workers-best-practices` skills first.
Allowed files: `src/index.ts`, `src/domain/app-repository.ts`
(`ensureDemoSchemaTimed` only), new `src/server/server-timing.ts`,
`src/server/json.ts` only if needed, new `tests/api-timing.test.mjs`,
`tests/e2e/api-performance.spec.js`, audit.

Workers trap: inside a Worker, `Date.now()`/`performance.now()` advance only
across I/O (a Spectre mitigation), so pure CPU work can measure 0 ms. That is
expected; do not "fix" it, and do not assert non-zero durations for CPU-only
paths in tests against the real Worker.

Starting facts (verified): order is gateway 404 → create-endpoint 405 →
`/api/health` → `await ensureDemoSchema(env.DB)` (no try/catch) → flat route
chain → 404. `apiPageResponse(label, request, url, handler)` times only the
handler (`Date.now()`), sets `server-timing: app;dur=N` on success, returns
500 JSON on handler failure without Server-Timing. Used by app-shell,
reference-data, entries-shell, entries-page, summary-page,
summary-account-pills, month-page, splits-page, imports-page, settings-page.
`ensureDemoSchema` memoizes per D1 binding in a WeakMap and deletes the entry
on failure (retry path).

1. Measure `requestStartedAt` at the top of `fetch` (after URL parse, before
   gateway checks). Wrap only the `ensureDemoSchema` call:
   `initStartedAt`/`initMs`, `initCold = true` when this call created the
   promise (expose a boolean from `ensureDemoSchema` via a small wrapper
   `ensureDemoSchemaTimed(db) -> { cold }` in app-repository; keep
   `ensureDemoSchema` unchanged for other callers).
2. Pass `{ requestStartedAt, initMs, initCold }` to `apiPageResponse` through
   a new optional last parameter. Header becomes
   `app;dur=<handler>, init;dur=<initMs>;desc="cold|warm", total;dur=<now-requestStartedAt>`
   computed after `JSON.stringify` of the payload (build the body string once
   and reuse it; do not stringify twice).
3. Initialization failure: catch, log `API init failed` with requestId, return
   `json({ ok:false, error:"Initialization failed", requestId }, 500,
   { "server-timing": … })`; the WeakMap retry path stays.
   Put the pure pieces in `src/server/server-timing.ts`:
   `buildServerTimingHeader({ appMs, initMs, initCold, totalMs })` and
   `timeInitialization(ensure, now) -> Promise<{ initMs, cold }>` so they can
   be unit-tested with fakes (no D1 needed).
4. Tests with an injected clock/delay: total ≥ init + app; app unchanged
   meaning; second request `desc="warm"`; failure returns 500 JSON and a
   subsequent request succeeds; health has no init metric; gateway 404/405
   order unchanged (`tests/shortcut-gateway.test.mjs`).
5. Extend `api-performance.spec.js` to all 10 page APIs, asserting only the
   existing `app` budget; record `init`/`total` in the audit.
Exit: initialization visible in a new metric; responses byte-identical.

## H10: First Delivery Closure

Depends on: H02–H09.

1. Baseline = the commit that contains H01 (harness, manifest,
   `.assetsignore`, preflight) and none of H02+. `718e708` itself cannot run
   the harness. If H01 was never committed on its own, stop and ask.
   `git worktree add ../monies-map-baseline <H01 commit>`, `npm ci` there,
   run `npm run test:performance` there, then here, sequentially (both use
   port 5191; or set `PERFORMANCE_PORT` differently), with the same
   `PERFORMANCE_*` settings and separate `PERFORMANCE_ARTIFACTS_DIR`s.
   Remove the worktree afterwards (`git worktree remove`). If the harness
   itself changed after H01, copy the current `tests/performance/` into the
   baseline worktree so both sides measure identically, and say so.
2. Three cohorts on the current build using `__MONIES_MAP_WARMUP_MODE__`:
   `off`, `intent-only`, normal. The harness sets it from
   `PERFORMANCE_WARMUP_MODE` with `page.addInitScript` (add this to
   `built-client.spec.js`; absent = normal) and records it in each report.
   Add `scripts/compare-performance.mjs` (reads two artifact dirs, prints a
   Markdown table of medians/p95, bytes, request counts, deltas) with a unit
   test on fixture reports.
3. Report cold/warm/unwarmed navigation, JS before usable, idle bytes at
   2/10/30 s, speculative hit rate, completed-but-unused bytes. Unknown or
   failed candidates fall back to intent-only. Apply the plan's regression
   limits (≤5% initial bytes, ≤10% median/p95) against baseline.
4. `npm run verify` (record audit step), full E2E, 390×844 and 1440×900
   screenshots of Summary/Month/Entries, keyboard-only navigation, Chromium
   touch emulation; WebKit functional smoke if installed. Record real-device
   testing as not done unless done.
5. Dated audit section with task revisions, values, gates, limitations,
   rollback (per task). Stop all servers; confirm no leftover processes.

## Scheduler Contract For H05–H07

Use these transition rules as the executable test specification, not as a
mandate for a state-machine library.

| Current condition/event | Required result |
| --- | --- |
| New visit, route not usable | Clear obsolete queued candidates; wait; no work starts |
| Usable and unblocked | Start quiet-period timer for this generation |
| Input/scroll during quiet period | Cancel timer/idle handle and restart only after interaction settles |
| Timer fires | Re-read all gates and budget; do not trust captured state |
| Allowed candidate is already loaded/fresh | Skip without spending a slot; consider next candidate within the same bounded queue |
| Allowed module begins | Reserve slot before calling loader; one in-flight module candidate |
| Navigation requests that pending module | Return existing promise immediately; no second import or navigation delay |
| Module resolves after route change | Retain loaded module; do not launch old-generation data |
| Eligible data begins | Reserve request slot and exact attempt identity; start speculative deadline |
| Required consumer joins same data key | Lease acquired before awaiting; deadline cancelled (promotion) |
| Hide/busy/epoch change while data pending | Clear queue; cancel only the exclusively speculative attempt |
| Data resolves while exclusively speculative | Cache through QueryClient; do not set route UI/loading state |
| Optional request fails | No global error banner; no same-visit retry; release in-flight slot |
| Return to visible tab | Required freshness first; new quiet interval; old visit counters retained |
| Dispose | Remove listeners/timers/leases owned by instance; no later completion may enqueue work |

Module concurrency and speculative-data concurrency are each bounded at one.
On mobile, automatic data starts only after its candidate module settles.
Actual navigation and required queries are never blocked by these limits.

### Deterministic Test Cases

Unit files: `tests/route-warmup-policy.test.mjs`,
`tests/route-warmup-scheduler.test.mjs`; query tests extend
`tests/query-foundation.test.mjs`. Deferred promises and injected clocks; no
real sleeps. Browser behavior in `tests/e2e/route-warmup.spec.js`; built
measurements in `tests/performance/`.

| ID | Setup/action | Exact assertion |
| --- | --- | --- |
| W01 | Mobile usable at t=0, candidate 40,000 bytes, connection absent | Zero loads at 1,999 ms; one code load at 2,000 ms; zero data requests |
| W02 | Same as W01, editor opens at 1,999 ms | Zero loads at 2,000 ms; draft remains; closing editor starts a new full quiet interval |
| W03 | Code costs 50,001 bytes | Automatic load denied; pointer-down invokes loader once; click still navigates |
| W04 | saveData=true, exact touch intent | No speculative code/data; real click still loads required route/data |
| W05 | First automatic load fails | Slot remains spent; no automatic retry; explicit navigation retries through `loadRouteModule` |
| W06 | Automatic module starts at t=0 and t=10,000 in separate visits | Third denied at t=59,999; allowed at t=60,000 in a new visit; never a second start within one visit |
| W07 | Same module receives pointer/focus twice while pending | Loader called once; all consumers receive the same module |
| W08 | Route A schedules candidate, switches to B before timer | A candidate not started; only B's policy may schedule |
| W09 | A's import starts, B becomes active, A resolves | Module stays reusable; zero API requests from A's completion |
| W10 | Warm Entries K; active route acquires K before 1,500 ms deadline | One network request; signal not aborted; consumer receives the exact fixture DTO |
| W11 | Warm K, no lease at deadline | Signal aborted; no banner/route error; automatic request count stays one |
| W12 | Deadline abort completes just before K becomes required | Required path refetches once and renders; route never stuck on the aborted promise |
| W13 | Required key L while warm K runs | L starts immediately; cancelling K cannot abort L |
| W14 | Cache has stale or invalidated K | Presence alone is not fresh; a speculative refetch consumes a slot |
| W15 | Summary range and pills both eligible | Never concurrent; second starts only after first settles and 1,500 ms desktop spacing |
| W16 | Mobile hides/resumes three times on same route | Visit quotas unchanged; no catch-up burst; required freshness still works |
| W17 | Rerender or privacy/layout toggle without identity change | No quota reset; no duplicate listener/timer |
| W18 | Tim and another person's Entries destinations | Distinct keys; warmed result never displayed for the wrong person |
| W19 | Mobile Summary with cached banner, then without it | Cached banner shown; no Imports request solely for the banner in either case |
| W20 | Scheduler disposed with pending import/data promises | No new work on resolution; only an exclusively speculative attempt can be cancelled |

### Existing Regression Suites To Reuse

| Change area | Existing test files |
| --- | --- |
| Keys/routing | `tests/query-foundation.test.mjs`, `tests/app-routing.test.mjs`, `tests/summary-query.test.mjs` |
| Shell and chunks | `tests/client-route-chunks.test.mjs`, `tests/e2e/app-shell.spec.js` |
| Draft continuity | `tests/e2e/mobile-continuity.spec.js`, `tests/quick-entry-url-defaults.test.mjs`, `tests/e2e/money-field-editability.spec.js` |
| Imports and banner | `tests/e2e/import-inbox-navigation.spec.js`, `tests/e2e/import-preview-auto-refresh.spec.js`, `tests/e2e/import-ledger-flow.spec.js` |
| Cross-page projections | `tests/e2e/summary-workflow.spec.js`, `tests/e2e/month-page.spec.js`, `tests/e2e/splits-cross-tab-refresh.spec.js` |
| AI/privacy | `tests/ai-assistance-contract.test.mjs`, `tests/e2e/financial-insight.spec.js`, `tests/e2e/money-privacy.spec.js` |
| Worker timing | `tests/e2e/api-performance.spec.js`, `tests/shortcut-gateway.test.mjs` |
| Built client | `npm run test:performance` |

`tests/client-route-chunks.test.mjs` checks App.jsx source for the absence of
`./entries-overview` and `./monies-client-service` imports and the presence
of the lazy `entries-filter-stack` import; it does not reference route
loaders, so H05 Step A needs no change there unless `EntriesFilterStack`
moves (it must not).

## H11 / P5: Shell Presentation

Subtasks (separate commits): H11a loading/error chrome; H11b navigation/overflow;
H11c month/range pickers; H11d login registration presentation.
For each: inventory JSX/functions and props; move unchanged markup into one
focused component; update imports; prove focus, screenshots and chunk boundaries.
Keep query ownership and URL normalization in place. Login handlers remain
with the identity owner. No entire-App state prop. Run shell/routing/mobile/
shortcut tests. Exit: behavior-preserving extraction, not claimed speedup.

## H12 / P6: Server-State Owners

Subtasks: H12a reference data; H12b Summary; H12c generic route data;
H12d shell hydration/cross-tab subscription. Each requires the previous gates.
Before moving, table every state/ref with writer, reader, role and replacement
guard: authoritative cache, protected snapshot, optimistic overlay or derived.
Move one owner's effects/callbacks into a feature hook with small explicit API.
Preserve keys, TTLs, refresh plans and workflow snapshots. Replace old readers
and remove obsolete state in that same completed subtask; no second DTO store.
Test out-of-order responses, two rapid saves, cross-tab during draft, deferred
refresh release and person/context correctness. Full E2E each subtask.
Removing Entries-shell launch needs its own measured comparison, not an incidental
extraction. Exit: one declared owner per resource and all draft guards retained.

## H13 / P7: Worker Handler Extraction

Start with AI only. Inventory matchers, methods, parsing, quota/environment,
identity and response contracts in `src/index.ts`. Move to
`src/server/ai-assistance-routes.ts` with explicit request/env/context and
Response-or-no-match result. Keep gateway rejection ahead of dispatch and pure
validators near handlers. Test method/body rejection, absent binding, quota,
valid response and shortcut-only gateway exclusion. No new router framework.
Further endpoint families each need a separate inventory/task. Exit: identical
caller permissions, response semantics and initialization order.

## H14 / P8: Endpoint Optimization

Choose ONE measured bottleneck from H01b/H09 data. Record before query counts,
rows read/returned, DTO bytes, handler/full/browser time at both scales.
Capture exact fixture DTOs. Remove proven duplicate reads/unused projection
work first and rerun parity. Indexes need query-plan evidence and separate
fresh/existing DB migration tests. Aggregate SQL needs differential weighted
person/household, transfers, negative rows, event/post dates, linked plans and
currency fixtures BEFORE replacing JS. Pagination/virtualization needs
separately specified full-set search, totals, selection, deep-link, keyboard
and editor contracts. Skip optimization when no repeatable budget miss exists.
Exit: numerical parity plus measured improvement.

## H15 / P9: Persistence And Projections

Subtasks: H15a initialization/seed; H15b entry commands; H15c month commands;
H15d import commit/rollback with certification/snapshot helpers; H15e projections
from `app-shell.ts`. One subtask at a time. Trace callers/private helpers and
side effects; choose an existing specialized module or one focused new module.
Define exports, move mechanically, update callers, remove obsolete re-exports.
Avoid cycles through the central facade. Preserve SQL/batch order, idempotency,
repair markers and transaction semantics. Initialization optimization is separate.
Run exact DTO/state tests and full E2E. Imports need real-structure fixtures,
both statement/activity orders, rollback and linked split/transfer restoration.
Exit: smaller ownership surfaces without persisted-state differences.

## H16 / P10: Asset Work

H16a CSS: measure coverage across routes, dialogs, privacy/loading states and
breakpoints; trace generated classes; remove only proven unused families;
preserve cascade and compare screenshots.
H16b FAQ: prove bundle retention and delivery cost; preserve anchors, content,
images and category glossary. Do not change it merely because its file is large.
H16c charts: separate download from render cost; fixed geometry and immediate
totals if delaying a chart. Keep Recharts absent a separate measured decision.
No PDF/OCR parser changes. Each subtask requires artifact/trace improvement;
skip unsupported optimizations.

## H17 / P11: Documentation Closure

Update owning docs for completed contracts, final measured/unmeasured results,
remaining risks and historical-vs-current guidance. Keep old slice prompts as
history. Re-run broad tests only when later implementation changes warrant it;
documentation-only work requires document checks. Remaining large modules need
reasons and ownership, not a false claim that complexity has disappeared.

## Evidence Template

Append one section per task to `docs/audits/macro-loading-baseline.md`:

```text
## H<ID>: <title>
Date; baseline/resulting revision; build ID if built:
Changed files and public contracts:
Starting-fact differences found (or "none"):
Positive / negative / race tests added (names):
Commands and exit codes (each gate; failures verbatim, with rerun result):
Performance cohort and before/after (or "not applicable" with reason):
Required unrun checks and reasons:
Protected workflow evidence (drafts, person separation, privacy):
Remaining risk and task-specific rollback:
Status: complete / partial / blocked
Next eligible step:
```

## Copyable Prompt For The Next Task

```text
Implement ONLY task <H-ID> from docs/macro-performance-implementation.md.
Follow its "How To Execute A Task" loop and Global Rules; use
docs/macro-performance-plan.md only for goals and budgets.
Verify the task's Depends-on evidence in docs/audits/macro-loading-baseline.md
and re-verify its Starting facts against current code before editing; report
differences. Change only the task's Allowed files. Write the listed tests
first. Record results with the Evidence Template, update the Status Board,
and stop. Do not start the next task.
```
