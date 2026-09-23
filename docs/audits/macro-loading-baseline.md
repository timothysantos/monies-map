# Macro Loading Baseline (H00)

Status: H00 evidence recorded; H01 harness evidence appended below.

## Revision and environment

- HEAD: `718e708` (matches the implementation handoff's source baseline).
- Pre-existing working tree changes: `docs/architecture.md`,
  `docs/implementation-order.md`, `docs/known-coupling-targets.md`,
  `docs/responsive-behavior.md` modified; `docs/macro-performance-plan.md` and
  `docs/macro-performance-implementation.md` untracked. All were preserved.
- Node used for passing checks: v22.12.0 at
  `/Users/tim/.nvm/versions/node/v22.12.0/bin`; npm 10.8.2. Default shell Node
  was v20.18.0 and is below the package requirement (`>=22.12.0`).
- Vite 6.4.3; Playwright dependency `@playwright/test` ^1.59.1; Wrangler
  4.113.0; TanStack Query ^5.100.5.
- `playwright.config.js`: functional E2E at `tests/e2e`, one worker, Chromium,
  serial, normally starts `npm run dev:test:servers` on 5173 and reuses an
  existing server outside CI. Smoke isolation is managed separately by
  `scripts/run-e2e-smoke.mjs`.
- `wrangler.test.jsonc`: `src/index.ts`, static assets from `dist`, local test
  D1 `monies-map-test`, `APP_ENVIRONMENT=test`; smoke's migration uses this
  config. H01 still needs its own built-client/test-Worker arrangement and
  dedicated port; the ordinary Playwright server serves Vite development.
- `package.json` scripts: `build`, `typecheck`, `test:unit`, `test:e2e`,
  `test:e2e:smoke`, `verify` (audit, typecheck, unit, build, smoke), and local
  D1 migration scripts. No performance Playwright config or performance
  harness exists at this revision.

## Current route, query and workflow ownership

URL context is normalized by `src/client/app-routing.js` and `query-keys.js`.
`view` defaults to `household`; month/scope are route context, while the
Summary range uses `summary_start` / `summary_end`. Entries preserves its
one-shot action/editor/filter parameters in the URL. Non-Entries parameters
are sanitized. `App.jsx` owns shared shell hydration and most generic route
fetch/cache coordination; Entries additionally retains its panel-owned query
and protected local editor state. Ready and busy signals below are the actual
signals found in code, not a centralized workflow-readiness contract.

| Browser route / workflow | Required API request(s), identity and cache key | Fetch/cache owner | Ready / busy protection observed | Invalidation / freshness owner |
| --- | --- | --- | --- | --- |
| All routes (shared bootstrap) | `/api/app-shell` with serialized shell params; key `app-shell` + normalized params | `App.jsx` `fetchAppShellData`; TanStack cache plus persisted shell | `appShell` / `isAppShellLoading`, loading status; no single global mutation/workflow readiness signal | `App.jsx` shell clear/refresh helpers, `app-sync.js` cross-tab broadcast; mutation call sites choose refresh/broadcast |
| All routes needing lookup lists | `/api/reference-data`; key `reference-data` | `App.jsx` `fetchReferenceData` | reference data availability; App shell loading is separate | App reference-data refresh/clear helpers; selected settings/import mutations |
| Summary `/` | `/api/summary-page?view&month&scope&summary_start&summary_end`; key `summary-page` + normalized `{viewId,month,scope,startMonth,endMonth}`. Independent `/api/summary-account-pills?view`; key `summary-account-pills` + `viewId` | `summary-query.js` functions called by `App.jsx`; both run independently (often in parallel). Summary view combines their DTOs. | Current page view and App shell loading gate presentation; summary has its own query results. Note dialog uses `isSavingMonthNote`; no cross-workflow readiness signal for speculative work. | Dedicated Summary and pills clear/refresh helpers; range-aware invalidation and mutation refresh plans in `summary-workflow.js` / `App.jsx` |
| Month `/month` | `/api/month-page?view&month&scope`; key `route-page` + normalized endpoint and params | Generic App route-page loader `fetchRoutePageData`; `month-panel.jsx` owns local editors and mutation workflows | `isMonthDataRefreshing`, pending derived month data, row/note saving, dialogs and mobile sheet state are local; no aggregate ready/busy report | `month-workflow.js` plans affected month/entries/splits/summary caches; App clears target query families and refreshes |
| Entries `/entries` (including shortcut launch) | `/api/entries-shell?...` startup/launch request plus `/api/entries-page?view&month`; page key `entries-page` + normalized params. Shell hydration is separate from page DTO. | `App.jsx` handles app/entries shell and route transitions; `entries-panel.jsx` `useEntriesPageData` is the panel's network boundary and owns its page state/cache use. App also has a same-key page fetch helper used by route prefetch/refresh paths. | `isEntriesPageLoading`, saving entry draft/quick expense, `savingEntryId`, editor/mobile-sheet/filter state, URL deep-link state; these are separate signals. | Entries panel cache clear/epoch and refresh; entry workflow refresh plans in `entry-refresh-plan.js`; App cross-slice invalidation and `app-sync.js` |
| Splits `/splits` | `/api/splits-page?view&month`; key `route-page` + normalized endpoint and params (route-request key maps to `splits-page` where used) | Generic App route-page loader; `splits-panel.jsx` owns workflow state | `isSubmitting`, `isCheckpointing`, focused editors/dialogs, optimistic state; split generation guard in `splits-workflow.js`. No common ready signal. | App targeted splits/entries/month/summary invalidations; `splits-workflow.js` refresh plans; cross-tab broadcast |
| Imports `/imports` | `/api/imports-page`; key `route-page` + path/empty params for App route request; `imports-page` for banner/prefetch cache path. Preview is an additional request only after explicit file workflow. | App generic page request; `imports-panel.jsx` owns upload parsing, preview, local draft, commit/rollback and refresh orchestration | `importDraftExists`, `isParsingStatement`, `isSubmitting`, preview dirty/workflow lock from `import-workflow-model.js`; mapping/account dialogs and reconciliation work have additional local state | `refreshCurrentImportsPage`, import mutation query invalidation and `import-refresh-plan.js`; commit/rollback preserve import batch semantics; App sync broadcast |
| Summary/Month Imports inbox banner (optional) | Reuses `imports-page` cache when available, otherwise idle `/api/imports-page`; key `imports-page` | Separate `App.jsx` effect and `importInboxBanner` local projection, scheduled after current page view and shell settle | Requires Summary/Month selected, current page view, and no App-shell load; does not check open editor, mutation, workflow lock, visibility, save-data or network beyond cancellation on effect cleanup | Uses Imports page query cache freshness; successful result updates banner. Cancellation stops scheduled/result presentation, not fetch abort. Import mutations refresh imports/cache. |
| Settings `/settings` | `/api/settings-page`; generic route-page request key as `route-page` + endpoint/params; `settings-page` helper key also exists | App generic route owner; `settings-panel.jsx` settings workflow and form drafts | Panel-local `isSubmitting`, unregister/transfer workflow states and dialogs; no aggregate busy contract | App path-based settings route-cache clearing, `settings-refresh-plan.js`, reference-data and shell refresh as selected |
| FAQ `/faq` | No page API; static lazy FAQ module/Markdown, category glossary comes from shell/reference data | `App.jsx` lazy route module; `faq-panel.jsx` renders | Route chunk fallback and shared shell state; no page-data query | Static content; relevant shell/reference refresh only |

Correction (H01 review): Month, Splits, Imports and Settings route requests
are cached under their specialized keys via `queryKeys.routeRequestKey`
(`month-page`, `splits-page`, `imports-page`, `settings-page`), not
`route-page`; the Month key currently omits the person (H01 finding 5).

`queryKeys.routeRequestKey` has endpoint mappings to specialized keys for
Entries, Month, Splits, Imports, Settings and Summary, but the current Summary
flow deliberately uses its two dedicated query functions. Generic
`routePage(request)` remains the fallback. Query keys and actual owner calls
are therefore not interchangeable; verify exact fetch sites before changing
cache ownership. Most query fetchers check an abort signal before/after
fetching but do not pass it to `fetch`, so cancellation does not prove network
work stopped. `fetchWithTimeout` also has its documented response-header timing
boundary. These are characterization facts, not repairs in H00.

## Existing workflow protection and gaps relevant to warmup

- Entries drafts/editors, quick-entry URL context, filtering, and mobile sheets
  are protected in `entries-panel.jsx`; page loading is separate from saving.
- Month row/note/plan-link editors and mobile add/filter sheets have multiple
  local states; `isMonthDataRefreshing` alone is not complete workflow
  readiness.
- Imports has the strongest explicit derived protection:
  `importDraftExists`, preview dirtiness, `isWorkflowLocked`, parsing and
  submitting. These must block speculative work that could interfere with a
  preview or commit.
- Settings and Splits expose panel-local submit/checkpoint flags and draft or
  modal state. `queryClient.isMutating()` cannot represent their non-TanStack
  workflows. Financial insight has abort cleanup and deterministic fallback,
  but no explicit workflow-ready contract.
- Existing idle route data prefetch in `App.jsx` checks App shell stability,
  query epoch and document visibility; skips save-data and coarse-pointer
  devices; it can warm adjacent Month/Summary, Splits and Entries page data.
  It does not consult the above panel workflow locks. Separate module warming
  uses the route loader registry; failure clears its preload marker for retry.
- The banner effect's gates are weaker than “active route is usable”: it uses
  `currentPageView`, which intentionally can retain the prior settled page
  during a route transition, and does not check route-query completion or a
  primary control. `scheduleIdleTask` has no visibility-aware wrapper, and its
  result is not wired to an AbortController. Effect cleanup prevents applying
  a late result but cannot prove the API request was cancelled. This is a
  concrete H01 observation to measure and an H03/H06 guard requirement.
- Existing smoke selections omit some useful guard suites (including money
  privacy, financial insight and splits cross-tab refresh); full E2E remains
  available but did not run in this environment.

These gaps mean H01 can measure current behavior but must not claim current
warmup is workflow-safe. H03 must source readiness from workflow owners before
H05/H06 use it as an admission or cancellation gate. H00 authorizes no runtime
change.

## Verification actually run

Commands were run against HEAD `718e708`; no source files were edited.

| Check | Result |
| --- | --- |
| `npm run build` with default Node | Blocked before Vite: shell Node v20.18.0 is below required v22.12.0. |
| `npm run build` with Node v22.12.0 | Passed; Vite 6.4.3 produced production assets. Individual chunk values are build output only, not route closures or browser transfers. |
| `npm run typecheck` with Node v22.12.0 | Passed. Scope caveat: tsconfig checks `src/**/*.ts`, not all client JSX/JS integration. |
| `npm run test:unit` with Node v22.12.0 | Failed before tests: `tsx` could not create its IPC socket (`listen EPERM`). |
| Equivalent `node --import tsx --test tests/*.test.mjs` with Node v22.12.0 | Passed 228/228, 0 failed, 0 skipped (2.95 s). This establishes unit suite result despite wrapper IPC restriction. |
| `npm run audit` | Failed/unavailable: network DNS for `registry.npmjs.org` returned `ENOTFOUND`; no audit result. |
| `npm run test:e2e:smoke` with Node v22.12.0 | Blocked during isolated D1 migration/server setup: Wrangler could not write its log under `/Users/tim/Library/Preferences/.wrangler` and could not bind `127.0.0.1` (`EPERM`). Browser workflows did not run. |
| `npm run test:e2e` | Not run; same local server binding restriction, and it was not safe to reuse an existing server for reseeding tests. |
| `npm run verify` | Not run as a single command; its audit and smoke prerequisites are blocked as recorded above. Individual build/typecheck/unit-equivalent checks were run. |

No timing, LCP/CLS, long-task, route-transfer, API-count/byte, server timing,
idle-traffic, warm-hit-rate, mobile/desktop, cold-isolate, or stress-fixture
measurement was performed in H00. Plan values (2.5 s mobile, 300 ms warm,
CLS 0.1; 5% startup bytes / 10% timing regression gates; H01's suggested
admission sizes) remain targets or hypotheses, not baseline findings.

## H01 readiness review and remaining unknowns

H01 has enough scope to proceed with asset-graph instrumentation: enable a
manifest, traverse static imports, gzip chunks, separate CSS/dynamic assets,
embed build-local JSON costs, and treat missing cost as unknown. The code map
and workflow matrix above clarify the current owners and prevent H01 from
mistaking chunk inventory for route cost.

Before H01's browser harness can produce valid measurements, resolve/document
these environment/config specifics in that task: an available dedicated port;
how the test Worker serves the just-built hashed assets while preserving the
isolated test D1; stable browser binaries/version and CPU/network profile; and
whether local server binding can be enabled in the execution environment.
H01 can implement scripts/config without runtime measurements if the latter is
blocked, but P0 measurement acceptance cannot be claimed until the browser
actually loads the built client and records the required traces. Keep the
performance harness separate from functional Playwright behavior and the
serial smoke setup.

Unmeasured assumptions include deployment behavior versus local Worker,
cache state and Worker-isolate freshness, representative data distributions,
device/network representativeness of emulation, whether optional warming
reduces navigation time, and whether the full Imports DTO is materially costly
for the banner. Do not infer any of these from source inspection or Vite's
individual chunk table.

## H00 exit

H00 evidence is complete for the accessible checkout. H01 is the next task.

## H01: Built-client harness and asset-cost evidence

Date: 2026-09-23. Baseline/resulting revision: `718e708` plus the uncommitted
H00/H01 working tree (no commit was made). Build ID `b3f5ff77264c201f`
(SHA-256 of the Vite manifest, first 16 hex). Node 22.12.0, Wrangler 4.113.0,
Playwright 1.59.1, Chromium 147.0.7727.15. Status: H01 exit criteria met
(reproducible built-client report, no dangling servers, no application
behavior change). The `npm run verify` gate did **not** pass as one command:
it stops at pre-existing `npm audit` advisories, and one smoke test is
intermittent (see Commands). Step 7 scale fixtures remain open.

### Changed files and public contracts

| File | Contract |
| --- | --- |
| `vite.config.js` | `build.manifest: true`; chunk strategy unchanged (identical hashes before/after) |
| `public/.assetsignore` | Keeps `dist/.vite/` out of served/deployed static assets. Without it the manifest was publicly served (verified 200, now 404/SPA fallback) |
| `scripts/route-asset-report.mjs` | Pure: `createRouteAssetReport`, `buildWarmupCosts`, `parseWarmupCosts`, `getHtmlStylesheetAssets`, `WARMUP_COSTS_BLOCK_PATTERN`. Static `imports` closure with visited set; `dynamicImports` reported separately; dangling import or unreadable file = unknown (`null`), never zero |
| `scripts/write-warmup-costs.mjs` | `postbuild`: replaces (never appends) `<script id="monies-warmup-costs" type="application/json">` in `dist/index.html`; `<` escaped; source `index.html` untouched; git-less builds use revision `unknown` |
| `scripts/report-route-assets.mjs` | `npm run report:route-assets` (builds, then writes `docs/audits/route-assets-baseline.json`). No longer run on every build |
| `scripts/run-performance-worker.mjs` | Isolated Worker runner (details below) |
| `scripts/performance-preflight.sql` | Test-only workaround for the fresh-database initialization defect below |
| `playwright.performance.config.js` | Separate config: one worker, `reuseExistingServer:false`, `testMatch: **/*.spec.js`, `wait.stdout` ready marker, `gracefulShutdown` SIGTERM |
| `tests/performance/built-client.spec.js` | Browser harness (measures; asserts validity only, no timing budgets) |
| `tests/performance/performance-stats.mjs` + test | Nearest-rank median/p95, typed byte totals, Server-Timing parser |
| `tests/performance/route-asset-report.test.mjs` | Asset graph/metadata contracts |
| `tests/performance/scale-fixture.test.mjs`, `fixtures/scale-fixture.mjs` | Shape-only scale fixture contract (not yet loaded; see limitations) |
| `package.json` | `postbuild`, `report:route-assets`, `test:performance` (+`pretest:performance` build); `test:unit` includes `tests/performance/*.test.mjs` |

Normal functional Playwright config, smoke runner and production Worker
configs are unchanged. No application module changed.

### Root causes found in the previous (uncommitted) H01 attempt

The earlier H01 notes blamed application code for a Summary `RangeError` and a
wrong range. Both were harness defects:

1. The runner started Wrangler with `--log-level error` and waited for a
   `Ready on` line that is therefore never printed, while Playwright started
   tests as soon as `/api/health` answered. Tests ran against an unseeded
   database (household name from the preflight insert, `trackedMonths: []`).
   Fix: Playwright waits for `PERFORMANCE_FIXTURE_READY`, printed only after
   reseed and fixture validation. Playwright races `url` against
   `wait.stdout`, so `url` is intentionally absent.
2. Playwright's default webServer teardown SIGKILLs the command's process
   group, so the runner's cleanup never ran and the detached Wrangler/workerd
   group plus 11 temporary persistence directories were orphaned. Fix:
   `gracefulShutdown: SIGTERM`, idempotent `stop()` on every exit path, a
   process-group sweep, and a parent-PID watchdog.
3. Playwright also collected `route-asset-report.test.mjs` as a spec
   (`node:test` output inside the Playwright run). Fix: `testMatch`.

### Runner safety sequence (`run-performance-worker.mjs`)

Refuse unless `wrangler.test.jsonc` has `APP_ENVIRONMENT=test` and
`DEMO_SEED_MONTH=2026-05`, and `dist/` contains `index.html` and the manifest
→ refuse an occupied port (never connects to an existing server) → unique
`mkdtemp` directory used for `--persist-to` by schema setup, preflight and
`wrangler dev --local` (never `--remote`) → poll health → require the running
Worker's `/api/app-shell` to report `appEnvironment: "test"` → one reseed →
require tracked months `2025-06…2025-10, 2026-05` and a six-month Summary →
print marker. Verified failure paths: occupied port (refused, exit 1, nothing
left), SIGINT mid-run, SIGKILL of Playwright, normal completion — all left
no listener on 5191, no workerd/runner process, and no temp directory.

### Asset report (Node zlib gzip estimates, not browser transfer)

| Route | Static closure incl. entry + `styles.css` | Incremental over entry | Dynamic (outside closure) |
| --- | ---: | ---: | --- |
| Summary | 204,136 B | 22,383 B | Recharts, PDF, PDF worker |
| Month | 215,024 B | 33,271 B | Recharts, PDF, PDF worker |
| Entries | 228,868 B | 47,115 B | Recharts, PDF, PDF worker |
| Splits | 223,059 B | 41,306 B | Recharts, PDF, PDF worker |
| Imports | 239,371 B | 57,618 B | PDF, PDF worker |
| Settings | 231,724 B | 49,971 B | Recharts, PDF, PDF worker |
| FAQ | 236,720 B | 54,967 B | PDF, PDF worker |

Entry: 181,753 B (JS 148,420 + CSS 33,333). Embedded metadata: 4,285 raw HTML
bytes, 723 B gzip delta. Full per-file data: `route-assets-baseline.json`.
Against the H04 hypothesis of ≤50,000 missing bytes: Summary, Month, Entries,
Splits and Settings (49,971 B, within 29 B of the cap) are under it; Imports
and FAQ exceed it. Entries' 47,115 B assumes no other route has loaded.

### Browser cohort (built client, isolated test Worker, demo fixture)

Scenario: direct `/summary?view=household&month=2026-05`; 5 cold samples,
each a fresh browser context (cold HTTP cache, **warm** Worker isolate); after
sample 1, 30 s idle, one priming round trip, then 20 Summary→Entries and 20
Entries→Summary SPA clicks. "Usable" = in-page `requestAnimationFrame` poll
that sees route-specific fixture values visible with money hidden (Summary:
"Viewing • Household", Bills "4 transactions", enabled "View entries for
Bills"; Entries: "Viewing entries for Household", row "Vivify", enabled
"Edit Bills"). Profiles via Chromium CDP: desktop 1440×900, 40 ms RTT,
10 Mbps/5 Mbps, CPU 1×; mobile Pixel 7 emulation 390×844, 150 ms RTT,
1.6 Mbps/750 kbps, CPU 4×. Bytes = Playwright `request.sizes()`
(headers + encoded body), same-origin only.

| Measure (run 3) | Desktop | Mobile emulation |
| --- | ---: | ---: |
| Cold usable median / p95 (n=5) | 557 / 689 ms | 2,603 / 2,655 ms |
| Cold raw samples | 689, 557, 455, 550, 648 | 2,605, 2,571, 2,581, 2,655, 2,603 |
| LCP median | 296 ms | 2,636 ms |
| CLS max | 0.0024 | 0.0051 |
| Long tasks before usable (count : ms) | 1:67 then 0 | 2:209–257 each sample |
| JS before usable | 21 files, 446,746 B | 17 files, 252,671 B (18 in other runs) |
| CSS / API before usable | 33,655 B / 4 req, 4,661 B | 33,661 B / 4 req, 4,661 B |
| API wall (app;dur) | shell 42 (2), reference 45 (3), pills 44 (4), summary 49 (22) ms | 161 (2), 175 (2), 183 (4), 200 (20) ms |
| Idle 2 s / 10 s / 30 s after usable | API 1 (1,955 B) / 3 (9,229 B) / 3 | API 1 (1,955 B) / 1 / 1 |
| First Summary→Entries (priming) | 183 ms, 0 API | 498 ms, 1 API (`entries-page`) |
| Warm Summary→Entries median / p95 (n=20) | 58 / 73 ms, 0 API | 98 / 159 ms, 0 API |
| Warm Entries→Summary median / p95 (n=20) | 63 / 79 ms, 0 API | 98 / 115 ms, 0 API |

Run 2 (same build) agreed within noise: desktop cold 592/772, mobile
2,637/2,792; warm medians 47–69 ms desktop, 111–115 ms mobile.

### Proven findings for later tasks (measured, not inferred)

1. **Route-module warmup competes with the cold load.** The idle all-route
   effect fires once `appShell` exists, before Summary data renders. Desktop
   fetched `month`, `entries`, `splits`, `imports`, `settings`, `faq`,
   `statement-import` and Recharts chunks *before* Summary was usable
   (≈447 KB vs ≈253 KB on mobile); the post-usable idle window contains no
   JS at all. H05's "after usable" gate is therefore a real change, and H10
   must compare cold usable time as well as idle bytes.
2. **Idle data traffic:** desktop issues `imports-page` (banner, ~2 s) then
   `splits-page` and `entries-page` (staged prefetch). Mobile issues only the
   banner `imports-page`: the staged prefetch skips coarse pointers, but the
   banner effect does not. The Summary range prefetch did not fire because
   the fixture range already spans every available month.
3. **Mobile unwarmed Entries costs ≈400 ms more** than warm (498 vs 98 ms)
   because its data is not prefetched on coarse pointers.
4. **Fresh-database initialization defect (application, out of H01 scope):**
   on a freshly migrated `schema.sql` database the first data request returns
   500 and the next succeeds; initialization writes `audit_events` before the
   repair that creates it. `performance-preflight.sql` pre-creates the table
   and default household in the isolated database only. Tracked separately;
   delete the preflight when fixed.
5. **Query identity defect for H02 — proven user-visible wrong-person data:**
   in the built client, open `/month?view=household&month=2026-05`, then click
   "Tim". The URL becomes `view=person-tim` but no `month-page` request is
   sent and the page keeps the "Household" label and household totals
   (planned spend $5,796.88 vs Tim's $5,189.88 on direct load).
   Cause: `queryKeys.routeRequestKey(buildRoutePageRequest({tabId:"month",
   viewId:"person-tim", ...}))` yields `["month-page",{month,scope}]`, the
   same key as household, because URL param `view` is passed to
   `monthPage({viewId})`. Mutation invalidation (`query-mutations.js`) uses
   `["month-page",{month,scope,viewId}]`, which cannot partial-match that
   fetched key. `/api/summary-page` through `routeRequestKey` drops view and
   range the same way (Summary normally uses `summary-query.js` instead). The
   existing test passes only because it sends a `viewId` URL param the app
   never sends.

### Commands and results

| Command (Node 22.12.0) | Result |
| --- | --- |
| `npm run build` | Pass; one metadata block after repeated builds; `.assetsignore` present in `dist` |
| `npm run report:route-assets` | Pass; report identical to prior build ID |
| `npm run test:unit` | Pass, 240/240 (the earlier `tsx` IPC `EPERM` did not recur) |
| `npm run typecheck` | Pass |
| `npm run test:performance` | Pass, 2/2, three full runs; zero leftovers each time |
| Failure-path cleanup (occupied port, SIGINT, SIGKILL) | Pass: no process, port listener or temp directory left |
| `npm run verify` | **Fail at step 1**, `npm audit`: 5 existing advisories (browserslist, sharp via miniflare/wrangler; 1 moderate, 4 high). No dependency changed; upgrades are out of scope |
| `npm run test:e2e:smoke` (run directly) | 13 workflows passed; `money-field-editability` › settings opening balance failed once (typed "1234.56", field kept "34.56"), aborting the runner |
| `money-field-editability.spec.js` alone, twice | Pass 7/7 both times: intermittent, not caused by H01 (smoke uses Vite dev, which never reads `dist` or the manifest) |
| Remaining smoke files run individually (`reseed-contract`, `settings-reference-data`, `import-ledger-flow`) | Pass 1, 13, 49 |
| `git diff --check` | Pass |
| `npm run test:e2e` (full) | Not run: H01 changes no application route, state or invalidation code |

### Limitations and remaining risk

- Cold Worker isolate is not measured (the isolate is warm from seeding);
  H09 owns full request/initialization timing.
- Chromium only. CDP throttling is per-request latency, not a radio model;
  mobile is Pixel 7 emulation, not a device. WebKit is not in this harness.
- Idle traffic is from one sample per project; cold/warm n = 5/20.
- Only Summary↔Entries is measured. Month, Splits, Imports, Settings, FAQ,
  shortcut launch, open-editor and two-tab scenarios from the plan's P0 table
  are not yet in the harness; add them when their owning task needs them.
- Scale fixtures (step 7) exist only as a shape-validated generator using
  abstract roles, with no D1 loader, and are not used in the browser. The
  seeded 1k/10k runs remain open as a separate change.
- Byte figures exclude cross-origin requests (for example Google Fonts).
- Raw reports stay local (`$PERFORMANCE_ARTIFACTS_DIR`, default
  `$TMPDIR/monies-map-performance-results`); only this summary is committed.
- Rollback: revert the H01 files above. `public/.assetsignore` and
  `build.manifest` must be removed together (the manifest must never deploy).

Next eligible step: H02 (query identity), starting from finding 5. Because
finding 5 shows another person's figures under Tim's view, H02's repair
should not wait behind unrelated work.

## H02: Query identity before additional cache reuse

Date: 2026-09-23. Baseline `506f3fd` (H01); resulting commits `403bb63`
(Month/Summary key translation) and `a8176fc` (import-mutation Entries
params), branch `macro-performance`. Status: **complete**; one pre-existing
full-E2E failure and the audit advisories recorded below.

### Changed files and public contracts

| File | Contract |
| --- | --- |
| `src/client/query-keys.js` | New exports `monthPageKeyFromParams(params)` and `summaryPageKeyFromParams(params)` — the only URL→key translation (`view`→`viewId`, `summary_start`→`startMonth`, `summary_end`→`endMonth`; defaults `household`, `""`, `direct_plus_shared`, `""`, `""`). Accept `URLSearchParams` or a normalized record. `routeRequestKey` uses them for Month and Summary |
| `src/client/summary-query.js` | Private `getSummaryPageKeyFromParams` removed; uses the shared helper (byte-identical keys) |
| `src/client/App.jsx` | `prefetchSummaryPage` uses the shared helper (identical key); import-mutation invalidation passes `buildEntriesPageParams(...)` instead of `{ viewId, month }` |
| `tests/query-foundation.test.mjs` | +8 tests (see below); misleading `viewId` URL-param test now uses `view` |
| `tests/e2e/month-page.spec.js` | Wrong-person regression test |
| `docs/code-spec.md` | Query Ownership Contract: single translation point and fetch/invalidation equality rule |

Fetched Month key changed from `["month-page",{month,scope}]` to
`["month-page",{month,scope,viewId}]`. No DTO, endpoint, URL, TTL or
which-cache-is-cleared behavior changed. TanStack caches are in-memory, so
no persisted state is affected.

### Equality / separation matrix (as of `a8176fc`)

"Fetch" = key used by the route's actual fetch path; "invalidate" = key built
by the mutation owner that is supposed to refresh it.

| Route | Fetch key | Invalidation owner and key | Result |
| --- | --- | --- | --- |
| Month | `routeRequestKey` → `month-page {month,scope,viewId}` | `invalidateMonthQueries` / `invalidateEntriesMutationQueries` / `invalidateImportMutationQueries` → same | **Equal** (was: person dropped, never equal) — unit matrix for household and Tim |
| Month, per person | household ≠ Tim ≠ Joyce; month and scope separate | — | **Separate** (was: household = Tim) |
| Entries | `routeRequestKey` → `entries-page {month,view}` | entry/month mutations pass route params → same | Equal |
| Entries after import mutation | same | was `{month,viewId}` object (never matched); now `buildEntriesPageParams` → same | **Equal** (fixed in `a8176fc`) |
| Summary, explicit range | `summaryPageKeyFromParams` → `summary-page {viewId,month,scope,startMonth,endMonth}` | mutation helpers with the same range → same | Equal; separate per person and per range |
| Summary via `routeRequestKey` | now same as `summary-query.js` | — | Equal (was: view and range dropped; latent, Summary does not fetch through it) |
| Summary, implicit range (URL has no `summary_start/end`) | `startMonth:"" endMonth:""` | mutations pass a resolved range (e.g. `2026-05..2026-05` or the page's range) | **Not equal — recorded, not fixed** (range semantics, not a naming bug) |
| Splits | `splits-page {month,view}` | App predicate matches `view` or `viewId` | Equal in practice. `invalidateSplitsPageQueries({viewId,month})` would never match but has **no production caller** (dead helper) |
| Imports / Settings | `imports-page` / `settings-page` | exact | Equal |

Real-QueryClient proof: household `{v:100}` and Tim `{v:200}` cached under
their fetched keys; `invalidateMonthQueries` for Tim marks only Tim
invalidated; both values unchanged.

### Related mismatches found and deliberately left unchanged

These are not URL→key mapping defects and showed no user-visible staleness,
so H02's rule (repair only proven mapping defects; no key renames) leaves
them. They matter once H07 relies on invalidation/freshness.

1. **Invalidation is inert today.** Every fetch helper returns
   `getQueryData(key)` when data exists, ignoring `isInvalidated`, and there
   are no query observers, so `query-mutations.js` invalidation changes no
   visible behavior; freshness comes from `bypassCache` refetches and
   `removeQueries` clears. H02's Month repair changes behavior only through
   the fetch key (the wrong-person fix).
2. **`route-page` family clears miss specialized keys.** `clearRoutePageCache`,
   `clearRoutePageCacheByPath` (Settings plans) and the Splits mutation's
   `invalidateMonth` predicate match `["route-page", {path}]`, but Month,
   Splits, Imports and Settings data live under `month-page`, `splits-page`,
   `imports-page`, `settings-page`. Probe: Settings account rename → Month at
   the same identity still refetched and showed the new name (another path
   refreshes it), so no stale UI was observed on that path.
3. **Route-load `hasCachedPage` check** (`App.jsx` route-page effect) uses
   `queryKeys.routePage(...)`, while the fetch uses `routeRequestKey`, so it is
   always false for specialized routes: cached navigations still show the
   loading label and bump `appShellLoadCount`. Cosmetic/readiness only.
4. Summary implicit-range invalidation and the dead Splits helper (matrix).

### Tests

Unit (`tests/query-foundation.test.mjs`): "month route keys keep each
person's page separate"; "a Month mutation for Tim invalidates only Tim's
cached month page" (real QueryClient); "summary route keys translate view and
range params like the summary query"; "implicit summary ranges stay keyed by
the selected month"; "URL-to-key helpers accept URL params and normalized
records alike"; "fetch and mutation invalidation build the same keys for
household" / "… for person-tim" (month, entries, summary, import); "Entries
keys use URL param names, so domain-named params cannot invalidate them";
updated "routeRequestKey routes month to the dedicated month key". Against
the old mapping (helpers kept, `routeRequestKey` reverted) 6 of these fail.

E2E (`month-page.spec.js`) "switching the Month view to a person loads that
person's page instead of the cached household page": reads Tim's figures from
a direct load, guards that household differs, loads household, clicks Tim,
requires a `month-page?view=person-tim` request, Tim label and Tim's planned
and actual spend; negative: back to Household shows household figures.
Against the old mapping it fails (no Tim request).

### Commands and results (Node 22.12.0)

| Command | Result |
| --- | --- |
| `node --import tsx --test tests/query-foundation.test.mjs` | Pass 29/29 |
| `npm run test:unit` | Pass 248/248 |
| `npm run typecheck` | Pass |
| `npm run build` | Pass |
| `month-page.spec.js` | Pass 20/20 |
| `import-inbox-navigation`, `import-preview-auto-refresh`, `import-ledger-flow` | Pass 2, 6, 49 |
| `npm run test:e2e` (full) | 181 passed, **1 failed**: `splits-viewer-amounts` › "split editor can choose the odd-cent recipient explicitly". Fails deterministically alone (2/2) and **identically at `506f3fd`** (pre-H02 worktree), so pre-existing: money is masked by default and the created card is absent from the snapshot. Tracked as a separate task |
| `npm run test:e2e:smoke` | Pass, all 15 workflows |
| `npm run audit` | Fail (the same 5 pre-existing advisories); therefore `npm run verify` as one command fails at step 1; its remaining steps were run individually above |
| `npm run test:performance` | Pass 2/2 |
| `git diff --check` | Pass |

Performance (same harness/profiles as H01 run 3; not a budget): desktop cold
median/p95 540/659 ms (H01: 557/689), warm Summary→Entries 44/75 ms (58/73),
Entries→Summary 67/84 ms (63/79); mobile cold 2,590/2,655 ms (2,603/2,655),
warm 99/166 and 103/119 ms (98/159, 98/115). Idle API unchanged (desktop 3,
mobile 1). No measurable change, as expected for a key-shape fix.

### Protected workflow evidence and remaining risk

- Person separation: proven for Month (unit + E2E). Entries, Splits and
  Summary keys were already per person.
- Transition: while Tim's Month loads, the previous Household page stays on
  screen with its own "Household" label (existing continuity for every
  route; readiness is H03). It is never labelled Tim.
- Drafts, privacy and URL contracts: unchanged (no panel code touched; smoke
  money-field-editability and mobile continuity pass).
- Behavior change to watch: Month now issues a request on the first switch to
  each person instead of reusing household data — correct and expected.
- Rollback: revert `a8176fc` then `403bb63`; they are independent.

Next eligible step: H03. H07 must not treat `isInvalidated` or the
`route-page` clears as reliable until mismatches 2–4 above are addressed.

## H03: Readiness and busy reporting

Date: 2026-09-23. Baseline `19e0471` (H02); resulting commits `1d9524b`
(shell contract) and `d30d4f0` (owner reports), branch `macro-performance`.
`703cb87` (a background session's two-line test fix for the odd-cent splits
E2E) sits between them. Status: **complete**; the `npm audit` gate still
fails on the pre-existing advisories, and one cold-load interaction is
recorded below.

### Changed files and public contracts

| File | Contract |
| --- | --- |
| `src/client/route-work-status.js` (new, pure) | `buildRouteIdentity`, `buildRouteWorkKey` (`tab|view|month|scope|summaryStart|summaryEnd`; non-month routes blank their fields), `createRouteWorkRegistry` (`report`, `release`, `subscribe`, `version`, `snapshot(routeKey)`), `createRequiredWorkCounter`, `withRequiredWork`, `deriveRouteWork` → `{ routeKey, ready, busy, requiredCount, usable, reason }` |
| `src/client/use-route-work-status.js` (new) | `RouteWorkProvider({ registry, routeKey })` (memoized value), `useRouteWorkReport({ ready, busy })` for panels, `useRouteWorkBusy(busy)` for delegated children, `useRouteWorkSnapshot`, `useRequiredWorkCount` |
| `src/client/App.jsx` | `activeRouteKey`; registry and counter; `summaryPageDataRequestKey` (Summary data readiness); `withRequiredWork` around the Summary, Month, Imports, Settings, Splits and background route refreshes; memoized `routeWork`; provider around the rendered route (`null` key while a previous page is shown); development-only `window.__MONIES_MAP_ROUTE_WORK__` |
| Panels | Summary, Month, Entries (ready + busy), Splits, Imports, Settings, FAQ report once each. Month gains `isRemovingMonthRow` (only feeds busy) |
| Delegated children | `CategoryAppearancePopover`, `ResponsiveSelect`, `MonthPanelHeader`, `EntriesDateGroups`, `EntryEditorFields`, `SplitActivityGroups`, `SettingsShortcutApiSection`, `SettingsTrustSection`, both statement-compare row editors |
| `design.md` | New "Route Work Status Boundary" section |

No request, draft, freshness lock or deferred-refresh rule changed. No
scheduler consumes `routeWork` yet (H05/H07/H08 will).

### Owner expressions (as built)

Busy = OR of: **Summary** `monthNoteDialog`, `isSavingMonthNote`.
**Month** `editingRowId`, `noteDialog`, `planLinkDialog`, `monthNoteDialog`,
`mobileAddDialog`, `actionsOpen`, `isSavingMonthNote`, `isDraftingMonthNote`,
`isSavingMonthRow`, `isRemovingMonthRow`, `isMonthDataRefreshing`,
`hasPendingDerivedMonthData`, `isDuplicating`, `isResettingMonth`,
`isDeletingMonth`, non-empty reset/delete confirmation text. **Entries** mobile
filters, quick-expense saving/pending, pending linked editor, created-split
delete, delete confirmation, note/category sync prompts and syncs, mobile split
pickers, `editingEntryId`, composer, entry save/delete/link/settle/transfer
dialog/candidate refresh/add-to-splits. **Splits** archive, history and group
dialogs, `isSubmitting`, sync prompts and syncs, `isRefreshingDerived`,
`isCheckpointing`, expense/settlement dialogs, inline draft, delete target.
**Imports** `importDraftExists`, `isWorkflowLocked`, parsing, submitting,
recent-imports refresh, AI explain/rank, account dialog, intake queue.
**Settings** `isSubmitting`, demo confirmations, dismiss-transfers
confirmation, person/account/category/rule/reconciliation dialogs, active
statement compare, transfer dialog and candidate/ranking/link/settle, transfer
refresh. **Shell** `mobileContextOpen`, login registration draft, registering,
unregistering.

Ready: App route data for the active request (Summary compares
`summaryPageDataRequestKey`, other routes `currentRoutePageData`, FAQ always)
and, for Entries, `!isEntriesPageLoading` with the page month and view
matching the request. Deviations from the handoff inventory are listed in the
implementation doc's "H03 as built".

### Tests

Unit (`tests/route-work-status.test.mjs`, 22): key fields and separation
(person, month, scope), identity blanks unused fields and ignores
`summaryFocus`, no report means not ready, all owners must be ready, one idle
owner cannot clear another's busy state, a stale-route report cannot make the
new route ready but its busy state blocks, identical reports do not notify,
StrictMode report/release/report, counter nesting/idempotence/failure, and
every `deriveRouteWork` reason (12) plus ready-over-busy precedence.

E2E (`tests/e2e/route-work-status.spec.js`, 6, Vite dev with StrictMode):
Summary → Entries with `entries-page` held: Summary still visible, route key
is Entries and not usable, then usable after release; Entries editor busy →
cancel → usable; failed save (500) keeps editor, draft `12.34` and busy, then
retry saves and clears busy; Summary category dialog (shared child) busy; an
Imports batch note makes the route busy and clearing it releases; Settings
account dialog busy; FAQ ready with no data; mobile Month add sheet busy and
mobile context sheet `mobile-context-open`. Performance harness asserts the
hook is absent from `dist`.

### Commands and results (Node 22.12.0)

Parallel sessions were using 5173/8787 (and later 5183/8797, 5193/8807) from
other worktrees; functional Playwright would have reused THEIR servers. All
functional E2E below therefore ran with a temporary, untracked config
(Vite 5311, test Worker 8911, inspector 9311, `reuseExistingServer:false`,
separate `--persist-to` D1), deleted afterwards. The smoke runner hard-codes
5173, so `npm run test:e2e:smoke` was not run; the full suite contains every
smoke file.

| Command | Result |
| --- | --- |
| `node --import tsx --test tests/route-work-status.test.mjs` | Pass 22/22 |
| `npm run test:unit` | Pass 270/270 |
| `npm run typecheck`, `npm run build`, `git diff --check` | Pass |
| `route-work-status.spec.js` | Pass 6/6 (after fixing the test's pipe count and a backdrop-vs-button close target) |
| Full functional E2E (isolated config) | **Pass 188/188** (includes `703cb87`) |
| `npm run test:performance` | Pass 2/2 on every run |
| `npm run audit` | Fail — same 5 pre-existing advisories |
| `npm run test:e2e:smoke` | Not run (port collision; smoke files covered by the full run) |

### Performance (interleaved A/B, same machine and harness)

The machine was shared with two other sessions (load average 6–27), so the
first unpaired H03 cohort (mobile warm ≈128 ms) was not trusted. Review then
found two real costs, both fixed before the final numbers: the provider value
was a new object each render (every reporting panel re-rendered with App), and
every row-level child registered a report and every report re-rendered App.
Final cohort: `19e0471` vs this code, desktop 4 rounds / mobile 2 rounds,
alternating order.

| Pooled | Base (H02) | H03 |
| --- | ---: | ---: |
| Desktop warm Summary→Entries median/p95 (n=80) | 61 / 91 ms | 59 / 81 ms |
| Desktop warm Entries→Summary (n=80) | 65 / 88 ms | 66 / 86 ms |
| Mobile warm Summary→Entries (n=40) | 106 / 216 ms | 100 / 178 ms |
| Mobile warm Entries→Summary (n=40) | 111 / 135 ms | 103 / 124 ms |
| Desktop cold median (n=20) | 464 ms | 565 ms |
| Mobile cold median (n=10) | 2,590 ms | 2,652 ms |
| Idle API at 30 s (desktop / mobile) | 3 / 1 | 3 / 1 |

Desktop cold is **bimodal in both builds**: ≈455 ms when the pre-existing
all-route idle warmup has not fired before Summary is usable (15–17 JS files),
≈555–600 ms when it has (20 files). Base hit the fast mode 11/20 times, H03
4/20; within each mode H03 is ≈5–15 ms slower (one extra App render when the
panel's report arrives). So H03 shifts the race with the H01-documented
warmup rather than adding ≈100 ms itself. This exceeds the plan's provisional
10% cold-median limit for this cohort and is left open deliberately: H05
gates automatic warmup on `routeWork.usable`, which removes the race. H05 must
show the bimodal distribution gone; if H05 is delayed, revisit.

### Protected workflow evidence and remaining risk

- Drafts: the failed-save E2E keeps the typed amount; smoke files for money
  editability and mobile continuity pass in the full run.
- Person separation: route keys differ per person/month/scope (unit).
- A page kept on screen during a transition never makes the new route ready,
  but an editor still open on it keeps blocking.
- Not covered by E2E: Splits, Settings statement-compare and Month
  reset/delete confirmations (unit-level registry semantics plus code review
  only); `ResponsiveSelect` mobile picker busy.
- Summary readiness requires both summary and pills data for the active
  request; a pills failure makes Summary not ready (fail-safe for warmup).
- Rollback: revert `d30d4f0` then `1d9524b`.

Next eligible step: H04 (pure policy).
