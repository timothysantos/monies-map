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
