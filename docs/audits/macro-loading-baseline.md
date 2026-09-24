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
| `scripts/performance-preflight.sql` | Test-only workaround for the fresh-database initialization defect below. Removed once that defect was fixed (finding 4) |
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
`mkdtemp` directory used for `--persist-to` by schema setup and
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
   **Fixed:** the failing statement was `recordAuditEvent`'s
   `INSERT INTO audit_events` from `repairLegacyOcbcValueDatePostDates`, which
   ran before `CREATE TABLE IF NOT EXISTS audit_events` and, once reordered,
   also hit the `households` foreign key because a fresh database has no
   default household. Initialization now creates `audit_events` before any
   repair, the repair audits only when the default household exists, and it
   audits before marking itself complete so a failed audit retries. The retry
   used to succeed only because the repair was already marked complete, which
   silently dropped the audit. `tests/fresh-schema-initialization.test.mjs`
   covers a fresh `schema.sql` database; the preflight is deleted.
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

## H04: Pure warmup policy

Date: 2026-09-23. Baseline `0283259` (H03); resulting commit: see the Status
Board (`Add pure route warmup policy`). Status: **complete**. No runtime
behavior changed: nothing imports the module yet (H05 is the first consumer).

### Changed files and public contract

`src/client/route-warmup-policy.js` (new, imports nothing):
`WARMUP_LIMITS`, `selectWarmupMode`, `evaluateWarmup` → `{ allowed, reason }`,
`selectWarmupCandidates` → abstract `{ kind, routeId, identity, trigger,
purpose }` in priority order, and `buildVisitKey(identity, workflowContext)`.
Decision order and reasons are exactly those in the implementation doc's H04
section. Its "As built" notes record the interpretations: fail-closed
`invalid-input`, conservative mode selection, the `summaryRange` input, no
pills candidate, Splits prefetch not retained, and route-level module dedupe.

### Tests

`tests/route-warmup-policy.test.mjs`, 48 tests: allowed baseline for both
modes and kinds; one row for each of the 26 denial reasons, changing a
single field from an allowed input; malformed input; safety gates still
applying to intent; unknown connection (code allowed, data denied);
hybrid/unknown devices; boundaries 49,999/50,000/50,001 bytes,
249/250/251 ms handler, 500/501 ms recent required, 59,999/60,000 ms rolling
window, 1,999/2,000 and 1,199/1,200 ms quiet, 1,499/1,500 ms data spacing;
intent bypass limits; `already-loaded` ahead of every budget; forbidden
routes automatic-only; candidates person-safe (Tim stays Tim, other person's
recent destination ignored), URL month only, no guessed range, mobile
Entries/Splits empty without a recent destination, desktop adjacent months
and banner; visit keys ignore cosmetic fields; the module has no imports or
browser globals.

Mutation check: flipping each boundary operator (quiet, rolling window, byte
cap, handler cap, recent required, data spacing) and removing each guard
(hover-on-mobile, already-loaded, 4g requirement, same-view recent
destination, desktop mode selection) fails at least one test: 11/11 caught.

### Commands and results (Node 22.12.0)

| Command | Result |
| --- | --- |
| `npx tsx --test tests/route-warmup-policy.test.mjs` | Pass 48/48 |
| `rg -n "^import" src/client/route-warmup-policy.js` | Empty |
| `npm run test:unit` | Pass 318/318 |
| `npm run typecheck`, `npm run build`, `git diff --check` | Pass |
| E2E / performance | Not applicable: no consumer, no runtime change |
| `npm run audit` | Not rerun; same pre-existing advisories (no dependency change) |

### Remaining risk

- Limits are the plan's tuning hypotheses, not measured optima. H10 compares
  them, and H01b supplies the mobile data admission numbers.
- The candidate list is abstract. H05/H07 adapters must build loaders and
  keys with the real route builders and `queryKeys`/H02 helpers.
- Rollback: revert the H04 commit (no callers).

Next eligible step: H05.

## H05: Shared loader and code-only scheduler

Date: 2026-09-23/24. Baseline `5d94362` (H04). Commits: `176509c` (route
loaders moved to `route-modules.js`, same 23 chunk names), `f464bac` (shared
cost parser + `missingRouteBytes`), `d21fbe4` (scheduler), `23a5109` (hook,
App wiring, all-route idle warmup removed). Status: **complete**.

### Changed files and public contracts

| File | Contract |
| --- | --- |
| `src/client/route-modules.js` | `ROUTE_IDS`, `loadRouteModule(routeId)` (one promise per route; failed load forgotten so the next caller retries), `getRouteModuleState` (`idle`/`pending`/`loaded`). App's `lazy()` adapters use it; `routeModuleLoaders`/`routeModulePreloads`/`preloadRouteModule` deleted |
| `src/client/route-warmup-costs.js` | `parseWarmupCosts` (moved; `scripts/route-asset-report.mjs` re-exports it), `readWarmupCosts(doc)` (memoized per document, null when absent/invalid), `missingRouteBytes(costs, routeId, loadedRouteIds)` (null = unknown) |
| `src/client/route-warmup-scheduler.js` | `createRouteWarmupScheduler({ clock, idle, loadModule, readInput, evaluate, selectCandidates, costFor })` → `updateContext`, `offerIntent`, `dispose`, `inspect` |
| `src/client/use-route-warmup.js` | `useRouteWarmup({ routeIdentity, routeWork, queryEpoch })` → `getNavIntentProps(routeId)` (`onPointerEnter`, `onPointerLeave`, `onFocus`, `onPointerDown`) |
| `src/client/App.jsx` | `activeRouteIdentity`; `queryEpoch` state bumped with the ref; hook call; intent props on all three NavLink sites (`to`, class, title unchanged); all-route idle effect removed (banner/staged-prefetch data effects untouched until H07) |

Differences from the handoff are listed in the implementation doc's "H05 as
built". No API request or data effect changed.

### Tests

- `tests/route-warmup-scheduler.test.mjs` (22, fake clock + deferred
  imports): W01, W02, W03, W04 (unit), W05, W06, W07, W08, W09, W16, W17,
  W20, StrictMode create/dispose/create, intent replaces automatic, epoch
  generation without budget refill, already-loaded not charged, unknown cost
  mobile vs desktop, off/intent-only overrides (including override read at
  fire time), synchronous loader throw, quiet-retry floor.
- `tests/route-warmup-costs.test.mjs` (7): route IDs match `ROUTE_IDS`, one
  shared parser, shared chunk counted once and subtracted when loaded, zero
  only when all loaded, unknown → null, document read once, malformed →
  null.
- `tests/e2e/route-warmup.spec.js` (9, Vite dev): mobile — only Entries after
  usable + quiet; unknown cost → none; open editor blocks, closing restarts
  quiet; touch pointer-down loads before tap; save-data blocks speculation
  but click loads. Desktop — one route after 1.2 s, never the route set;
  hover and keyboard focus warm exact routes; a fast mouse sweep warms
  nothing; `off` leaves navigation working. Against `5d94362` (old all-route
  warmup) 7/9 fail; save-data passes on both (preserved behavior).
- Mutation testing of the scheduler: every non-equivalent mutation fails or
  hangs a test (the hang found the busy-loop hazard fixed with the 250 ms
  retry floor); survivors are the timer's redundant generation check and the
  equivalent "continue after global denial" mutant. Removing the hover dwell
  fails the sweep E2E (4 routes warmed).

### Commands and results (Node 22.12.0)

| Command | Result |
| --- | --- |
| `npm run test:unit` | Pass 346/346 |
| `npm run typecheck`, `npm run build`, `git diff --check` | Pass |
| `tests/client-route-chunks.test.mjs` | Pass (no change needed) |
| Build chunk set before/after Step A | Same 23 chunk names (hashes cascade from the entry change) |
| Full functional E2E (isolated ports 5311/8911, own D1) | Run 1: 194 passed, 2 failed (`splits-edit-expense` 2 tests); both pass alone (2×) and in the same file order (41/41). Run 2 after the hover change: **197/197** |
| `npm run test:performance` | Pass in every quiet run |
| `npm run audit` | Not rerun; same pre-existing advisories (no dependency change) |
| `npm run test:e2e:smoke` | Not run (fixed port 5173 used by other sessions); the full run contains every smoke file |

### Performance (interleaved A/B vs `5d94362`, quiet machine, load ≈8–10)

Cohorts: base ×2, H05 ×3, alternating (an earlier overnight A/B was discarded:
the machine slept mid-run and mobile cohorts timed out on both sides).

| Measure | Base (H04) | H05 |
| --- | ---: | ---: |
| Desktop cold median / p95 (n=10 / 15) | 553 / 790 ms | **474** / 933 ms |
| Desktop cold raw | 711, 553, 455, 457, 567, 790, 579, 630, 467, 491 | 933, 475, 474, 462, 463, 695, 630, 450, 464, 462, 557, 467, 536, 474, 467 |
| Mobile cold median / p95 | 2,671 / 2,890 ms | **2,192** / 2,693 ms |
| JS before usable, desktop | 20 files / 355 KB (median) | 8 files / 179 KB |
| JS before usable, mobile | 18 files / 275 KB | 8 files / 179 KB |
| Other route panels before usable (per sample) | 2–6 | 0 in all 30 H05 samples |
| Warm Summary→Entries median / p95, desktop | 62 / 97 ms | 55 / 81 ms |
| Warm Entries→Summary, desktop | 65 / 85 ms | 67 / 88 ms |
| Warm Summary→Entries, mobile | 108 / 185 ms | 109 / 188 ms |
| Warm Entries→Summary, mobile | 109 / 133 ms | 111 / 167 ms |
| Idle 30 s JS | 0 (all loaded before usable) | 6 files / 31 KB (Entries, after usable) |
| Idle 30 s API (desktop / mobile) | 3 / 1 | 3, 3, 1 / 1 (data effects unchanged; the H07 target) |

The H03 bimodal cold distribution came from the all-route warmup racing
Summary readiness; with warmup gated on `routeWork.usable`, desktop cold
samples cluster at ≈465 ms and mobile cold falls ≈480 ms (−18%). The
remaining desktop outliers (557–933 ms) are not explained by route chunks
(zero other panels load before usable) and stay open for H10.

### Remaining risk

- Real devices and WebKit are not measured (Chromium emulation only).
- Automatic mobile warmup depends on the build cost block; if it is missing
  or invalid, mobile falls back to intent-only by design.
- Scroll events re-arm the timer on every event (cheap clear/set); throttling
  was not needed in tests but is unmeasured on low-end devices.
- Rollback: revert `23a5109` (restores the old behaviour only if the old
  effect is also restored; simplest is reverting `23a5109`, `d21fbe4`,
  `f464bac`, `176509c` in that order).

Next eligible step: H06.

## H06: Cancellation, leases and promotion

Date: 2026-09-24. Baseline `84f05c7` (H05 evidence). Commits: `dc3c229`
(abort through body reading; bounded transient retries), `20011cb` (leases,
recoverable required reads, cancellable speculative reads), `de6d3eb`
(Entries), `4e40640` (generic route pages), `e2db6f9` (Summary + pills),
`8770a06` (Imports banner signal), `a72ca22` (route-warmup E2E made
independent of setup-page timing and load). Status: **complete for the H06
contract**, with one open draft-loss flake tracked separately (below).

### Changed files and contracts

| File | Contract |
| --- | --- |
| `src/client/request-timeout.js` | `fetchWithTimeout` passes `AbortSignal.any([timeout, upstream])` to `fetch`, so an upstream abort during body reading rejects; header-phase timeout unchanged. `fetchTextWithTransientWorkerRetry(url, { maxAttempts = 3 })` (moved from App) |
| `src/client/query-leases.js` (new) | `createRequiredLeases`, `requiredLeases`, `fetchQueryWithLease`, `startSpeculativeQuery` (see the implementation doc's "H06 as built") |
| `src/client/App.jsx` | `fetchEntriesPageData`, `fetchRoutePageData` read through `fetchQueryWithLease` with the TanStack signal forwarded (loading labels and the cached early return preserved); Imports banner query forwards its signal |
| `src/client/entries-panel.jsx` | `fetchEntriesPage` through `fetchQueryWithLease`, keeping the client default retry policy |
| `src/client/summary-query.js` | `fetchSummaryJson` through `fetchQueryWithLease` |

No speculative data request is issued yet (H07). Behavior change: a cache
clear that cancels an in-flight required read now refetches once instead of
rejecting the loader with `CancelledError` (which the route effect used to
surface as a page error).

### Tests

- `tests/query-leases.test.mjs` (18, real QueryClient, deferred transport):
  W10 promotion (one request, not aborted, exact DTO), W11 deadline abort
  without error state, W12 abort just before required → route loads, W13
  another key unaffected, W14 invalidated data still fetches, W18 person
  separation, recovery after a cancel under a live caller, second
  cancellation propagates with the lease released, no start when required
  or already fetching, observed query not cancelled, last-observer TanStack
  cancel recovered, cancel after settle is a no-op, failed speculative read
  resolves "failed" without retry, lease released on failure, caller abort
  never reaches the shared network request, cached vs bypass, idempotent
  lease release, explicit cancel after promotion leaves the request running.
- `tests/request-timeout.test.mjs` (+3): upstream abort during body read
  rejects (hangs without `AbortSignal.any`), timeout-only signal, transient
  body retries 3× required / 1× speculative.
- Mutation checks: 8/8 targeted `query-leases.js` mutations fail a test
  (one survivor fixed by adding the explicit-cancel-after-promotion test).

### Commands and results (Node 22.12.0)

| Command | Result |
| --- | --- |
| `npm run test:unit` | Pass 367/367 |
| `npm run typecheck`, `npm run build` | Pass |
| Entries specs; Month/Splits/Settings/Imports/app-shell specs; Summary/insight/privacy; import inbox + ledger (isolated ports) | Pass 28, 49, 8, 51 |
| Full functional E2E run 1 | 196 passed, 1 failed: `splits-edit-expense` › linked note (draft reverted; see below) |
| Full functional E2E run 2 (traces on failure) | 196 passed, 1 failed: `route-warmup` › save-data — a test-harness race (the setup page's late `summary-panel` import counted); fixed in `a72ca22` together with a load-dependent sweep test (now in-page timers; verified to fail with the dwell removed). `splits-edit-expense` passed in this run |
| `route-warmup.spec.js` after the fix | Pass 9/9 (and the sweep test fails with dwell 0, passes 3/3 with it) |
| `npm run audit` | Fail — same 5 pre-existing advisories (browserslist, baseline-browser-mapping, sharp via miniflare/wrangler); none in Vite 6.4.3 |
| `npm run test:e2e:smoke` | Not run (fixed port 5173 shared with other sessions); covered by the full runs |
| `npm run test:performance` | Not rerun for H06 (no warmup or bundle change; request paths identical) |

### Resolved: split note draft reverts in some full runs

`splits-edit-expense` failed in 2 of 4 full runs since `23a5109` (H05 run 1
also failed the inline-editor test the same way): the typed note reverted to
the saved note before Save.

Root cause (reproduced 1/9 with a repeated throttled copy of the linked-note
flow, trace retained): not a remount, reopen, or re-added
`editing_split_expense`. `SplitExpenseFields` (and `SplitSettlementFields`)
focus and select the amount 80 ms after an editor opens. When the dialog
became visible inside that window, Playwright's `fill` focused Note, the
timer moved focus to Expense total, and the note text was typed into the
amount (the failing snapshot shows Expense total `[active]` holding the note
and Tim's share at 0.00). H05/H06 only shifted load timing into the window. A
person who clicks Note right after opening hits the same bug.

Fix: `src/client/deferred-focus.js` `focusFieldUnlessEditing` skips the
delayed focus when another editable control already has focus; both split
editors use it, and `use-route-warmup.js` now shares its `isEditableElement`
check. Regressions in `splits-edit-expense.spec.js` hold the short timer,
type into Note, release it mid-typing and keep typing through the keyboard
(dialog and inline editor; both failed before the fix), plus a guarded-path
test that the amount is still focused when nothing else was.

| Command | Result |
| --- | --- |
| New regressions before the fix | 2 failed (Note lost focus), guarded path passed |
| `splits-edit-expense` + `route-warmup` after the fix | Pass 17/17 |
| Throttled repro (CPU ×1/×4/×8) after the fix | Pass 15/15 |
| `npm run typecheck`, `npm run test:unit` | Pass, 367/367 |

### Remaining risk

- Rollback: revert `8770a06`, `e2db6f9`, `4e40640`, `de6d3eb`, `20011cb`,
  `dc3c229` in that order.

Next eligible step: H07 (after the split draft investigation, or with Splits
excluded from speculative data until it is resolved).

## H07: One optional data queue

Date: 2026-09-24. Baseline `6192fc4` (H06 evidence). Commits: `6d998d2`
(`buildEntriesPageParams` shared via `app-routing.js`), `1a867ca` (admission
table, empty), `a5c00bd` (scheduler data path), `9fb2bc9` (data adapters,
hook wiring, banner from cache, old effects removed). Status: **complete**;
mobile data warmup deliberately stays off until H01b fills the admission
table.

### Removed

App: the Imports banner idle-fetch effect, the staged route-page prefetch
effect, `prefetchRoutePage` / `prefetchSummaryPage` / `prefetchEntriesPage`,
`PAGE_PREFETCH_*`, `IMPORT_INBOX_BANNER_*`, `routePagePrefetchTimerRef`,
`scheduleIdleTask` / `cancelIdleTask` / `waitFor`. Entries panel: the
adjacent-month prefetch effect, its constants, timer ref, `waitFor`, and the
now-unused `availableMonths` prop. App.jsx: ≈290 lines fewer. The old
staged prefetch warmed household Entries even for a person view; the queue
uses the selected view.

### Tests

- `tests/route-warmup-scheduler.test.mjs` (+10 data-path tests): code then
  ≤2 data per desktop visit; W15 settle AND 1,500 ms spacing (starts at
  1,200 and 2,700 ms); W14 fresh skipped without charge; failed attempts
  charged and never retried; hide / busy / generation / visit / dispose
  cancel the in-flight attempt; resume ×3 without refill; mobile without
  admission or 4g → none; mobile with admission → one, after code; Tim
  Summary never warms household; editor before/after launch.
- `tests/route-warmup-data.test.mjs` (4): speculative keys equal the
  required readers' keys for Entries, Month (with person), Summary range,
  Imports; freshness from query state (absent, aged, Infinity,
  invalidated); adapter key/fresh/admission/start; single attempt and
  non-OK failure.
- `tests/route-warmup-admissions.test.mjs` (3) and `app-routing` (+1).
- `tests/e2e/route-warmup-data.spec.js` (7): desktop Summary → exactly
  Entries (household, 2026-05) then Imports ≥1.4 s later and nothing more;
  Tim Summary → Tim Entries only; navigating during a held warming Entries
  request → one request, not aborted past the 1.5 s deadline, correct rows;
  opening an editor aborts the speculative request and starts nothing new;
  warmup off → none; mobile → no data and no Imports request for the
  banner; mobile banner appears from cache after an Imports visit without
  another request. Against `6192fc4`, 6/7 fail (the join test passes there
  too).

### Commands and results (Node 22.12.0)

| Command | Result |
| --- | --- |
| `npm run test:unit` | Pass 385/385 |
| `npm run build` | Pass |
| Full functional E2E (isolated ports, traces on failure) | **Pass 204/204** |
| `npm run test:performance` | Pass 2/2 (machine load ≈55–66, so timings not compared) |
| Idle API at 2/10/30 s after usable | Desktop 1/2/2 (`entries-page`, `imports-page`; was 3 incl. `splits-page` and household Entries); mobile 0/0/0 (was 1, the banner) |
| Warm Summary↔Entries API per step | 0 (unchanged) |
| `npm run audit` | Same 5 pre-existing advisories (none in Vite) |
| `npm run test:e2e:smoke` | Not run (shared fixed port); every smoke file is in the full run |

### Remaining risk

- Mobile data warmup is inactive until H01b measurements are checked in.
- The split-note draft flake (H06) is resolved (delayed amount focus stole
  a field already in use; see "Resolved" under H06), merged after H07.
- Rollback: revert `9fb2bc9`, `a5c00bd`, `1a867ca`, `6d998d2`.

Next eligible step: H08 (H09 and H01b are also eligible).

The fix was merged into `macro-performance` after H07.

## H08: Optional insight readiness

Date: 2026-09-24. Baseline `bb8d8d8` (H07 plus the merged split-draft fix).
Commits: `22f2840` (readiness gate, response validation, panel wiring,
Summary `focusState` memo), `f87ae55` (E2E). Status: **complete**.

### Starting facts

All confirmed as stated. One addition: `money-privacy.jsx` reads the
visibility preference once at start and has no storage listener, so the
"editor open before the debounce ends" test reveals money behind the open
dialog by dispatching a click on `.totals-visibility-toggle` (the dialog
hides the page from role queries).

### Contract

- `FinancialInsight` takes `canRequestWording = false`. App passes
  `routeWork.usable` to Summary, Month, Entries and Splits, and each
  panel forwards it. A missing prop means no AI request, never a request
  during work.
- The request effect depends only on `cacheKey`, `areTotalsVisible` and
  `canRequestWording`. Facts, AI facts and the fallback narrative are read
  through a ref, so a new facts object with the same content keeps the
  debounce and the request running.
- A cached narrative is still shown while the route is not usable. No
  request is scheduled while it is not usable.
- A response is applied and cached only when the request was not cancelled
  and its `cacheKey` is still current. A non-OK status (even one carrying a
  narrative) or a malformed body falls back to the computed narrative,
  cached for 5 minutes. A network failure caches that fallback only when it
  was not an abort.
- Summary memoizes `focusState` on `[safeSummaryPage, summaryFocusParam]`.
- No change to prompts, the AI endpoint, facts, deterministic wording or
  finance math.

### Tests (`tests/e2e/financial-insight.spec.js`, "financial insight wording readiness")

| Test | Against `bb8d8d8` |
| --- | --- |
| Editor open (money revealed behind it) → 0 requests in 2 s; close → exactly 1 request ≥650 ms after close; AI wording shown; still 1 after 2 s | Fails |
| Editor opened during a held request → request aborted; released response not shown; close → second request (nothing cached) and AI wording | Fails |
| Facts change (Summary focus → Range overall) during a held request → aborted, new request for the new facts; back to May → asks again | Passes (guard) |
| Hide money during a held request → aborted, no new request | Passes (guard) |
| 503, malformed 200, and 500 carrying a narrative → computed wording kept; editor open/close afterwards → no retry (5-minute fallback cache) | 500-with-narrative fails; the other two pass (guards) |
| Month, Entries and Splits each get AI wording once usable | Passes; with the Splits forward removed, fails |
| Rerenders without a facts change (hover, expand/collapse) → 1 request in total | Passes (guard) |

The old code's "cache written after cancel" needs an abort to land in the
microtask between the body resolving and the cache write, so it cannot be
driven reliably from a browser test; it is closed by construction
(`isCurrent()` before any cache write). Changing the effect's dependencies
back to object identities is not caught by an E2E test either (the
debounce restart only delays the one request). No React unit test harness
exists in this repository, so this is recorded rather than tested.

### Commands and results (Node 22.12.0)

| Command | Result |
| --- | --- |
| `npm run typecheck` | Pass |
| `npm run test:unit` (includes the AI assistance unit tests) | Pass 385/385 |
| `npm run build` | Pass |
| `financial-insight`, `money-privacy`, `money-field-editability` E2E | Pass |
| Full functional E2E (isolated ports 5311/8911/9311, own D1 dir) | **Pass 216/216** (8.1 min) |
| `npm run test:e2e:smoke` | Not run separately (fixed shared port); every smoke file is in the full run |
| `npm run test:performance` | Not run: H08 changes no loading path. The gate only delays an optional POST that already came after the page was usable |

### Protected workflow evidence

No draft, person-separation or finance change. Privacy: hiding money still
aborts the request and shows the private copy. The person name is still
replaced before sending, since `aiFacts` is unchanged and only read through
a ref.

### Remaining risk

- One extra route-element rerender when an editor opens or closes.
- The debounce-restart fix and the race-only "cache after cancel" fix have
  no browser test (see Tests).
- Rollback: revert `f87ae55`, `22f2840`.

Next eligible step: H09 (H01b also eligible).

## H09: Full API timing

Date: 2026-09-24. Baseline `096e0e6` (H08 evidence). Commits: `94a02f6`
(timing module, timed initialization, Worker wiring, unit tests),
`c1dd539` (all ten page APIs in `api-performance.spec.js`).

### Contract

- Page API header: `app;dur=<handler>, init;dur=<ms>;desc="cold|warm", total;dur=<ms>`.
  `app` keeps its meaning and stays first, because existing budget checks
  read the first `dur`. `total` runs from the top of `fetch` until the body
  string is serialized, and the body is serialized once
  (`serializeJson` + `jsonFromText` in `src/server/json.ts`; `json()` is
  unchanged in output).
- `ensureDemoSchemaTimed(db) -> { cold }`: cold only for the call that
  starts initialization. A joined or finished initialization is warm.
  `ensureDemoSchema` is unchanged for its other callers, including the
  retry-after-failure path.
- An initialization failure is caught. It logs `API init failed` (request
  ID, method, path, `initMs`, error) and returns
  `500 {"ok":false,"error":"Initialization failed","requestId"}` with
  `init` and `total`. No internal error text is returned. Before, the throw
  was uncaught.
- Health, the shortcut-gateway 404 and the create-endpoint 405 still answer
  before initialization, with no timing header.
- A handler failure keeps today's 500 body without Server-Timing.

### Tests

`tests/api-timing.test.mjs` (7) calls the real Worker `fetch` under tsx with
a fake D1 (no Wrangler):
- header format, including when the app metric is missing;
- `timeInitialization` with an injected clock (ok, warm, failure);
- `ensureDemoSchemaTimed` is cold once, joined while pending as warm, runs
  no statements when warm, and after a failure is cold again, then warm;
- Imports page cold → warm: metric order, `init` > 0 with a 2 ms D1 delay,
  `total ≥ init + app`, first `dur` is `app`, body is pretty-printed JSON
  and identical between calls apart from `generatedAt`, headers unchanged;
- all ten page APIs return 200 with the three metrics;
- an initialization failure returns a 500 with `init`/`total` and no
  message, and the next request initializes again (cold);
- health and gateway 404/405 run no statement and carry no timing.

Mutations checked:
- dropping `timing` from one call site fails 3 tests;
- disabling the failure branch fails 1.

Against the old code the file cannot import the new exports.

### Real local Worker (`wrangler.test.jsonc`, isolated port 8911)

Three restarts, first request a page API:

| Request | app | init | total |
| --- | --- | --- | --- |
| 1st `imports-page` (cold) | 234 / 131 / 134 | 36 / 27 / 33 cold | 271 / 158 / 167 |
| 2nd `imports-page` | 6 / 6 / 7 | 0 warm | 6 / 6 / 7 |
| `summary-page` (May) | 21 / 21 / 22 | 0 warm | 21 / 21 / 22 |

Finding: after a restart the first handler costs ≈130–230 ms more than a
warm one, on top of ≈30 ms initialization. The whole cold cost is now
visible, where `app` alone used to hide `init`.

Seeded warm run over all ten APIs (`api-performance.spec.js`), app/total ms:
- app-shell 2/2, reference-data 1/1;
- entries-shell 12/12, entries-page 5/5;
- summary-page 18/18, account pills 5/5;
- month-page 9/9, splits-page 20/20;
- imports-page 6/7, settings-page 11/12.

`init` is 0 (warm) for all ten.

### Pre-existing issue surfaced (not fixed here)

On a fresh `schema.sql` database the first request (the reseed) now logs
`API init failed … no such table: audit_events` and returns the new 500.
The next request succeeds. The fix (`647ca50`, `fd841b1`, branch
`claude/sharp-kepler-4efdb7`) was never merged into `macro-performance`;
an earlier note implied otherwise. Out of H09 scope.

### Commands and results (Node 22.12.0)

| Command | Result |
| --- | --- |
| `npm run typecheck` | Pass |
| `npm run test:unit` | Pass 392/392 (385 + 7 new) |
| `npm run build` | Pass |
| `node --import tsx --test tests/shortcut-gateway.test.mjs` | Pass |
| Full functional E2E (isolated ports 5311/8911/9311, own D1 dir) | **Pass 216/216** (8.1 min) |
| `npm run test:e2e:smoke` | Not run separately (fixed shared port); every smoke file is in the full run |
| `npm run test:performance` | Not run: the browser harness reads only `app` budgets; the real-Worker numbers above were taken directly |

Remaining risk: `total` excludes time spent streaming the Response after
the handler returns. Rollback: revert `c1dd539`, `94a02f6`.

Status: complete. Next eligible step: H01b, then H10.

## H01b: Seeded scale fixtures and admission measurements

Date: 2026-09-24. Baseline `4e571c1` (H09 evidence). Commits: `41838ad`
(fixture on real references, SQL builder, loader, runner switch),
`e3cd00b` (`api-admission.spec.js`, fixture name in reports). No
application code changed. Status: **complete**.

### Fixture and loading

- `createScaleFixture(1000|10000, reference)` places rows on the demo's real
  people, accounts and categories, which the loader reads from
  `/api/reference-data` and `/api/app-shell`:
  - Groceries and Public Transport expenses;
  - Transfer pairs from person A's account into the joint account;
  - joint-account rows have no owner (shared); others are owned by the
    account's owner.
- 24 months, 2024-06 … 2026-05. The 10k fixture puts 2,000 rows in 2026-05.
  Amounts are integer minor units and every row is provisional.
- Missing references throw, so a changed seed cannot skew a cohort.
- Loading happens after the demo reseed and validation, before the ready
  marker:
  - All rows but one per month go in as one SQL file with **the same
    transaction columns as the demo reseed insert**, plus one
    `transfer_groups` row per pair.
  - The last row per month (a direct expense) goes through
    `/api/entries/create`, so the app itself recalculates that month's
    snapshots. The fixture months then become tracked: 24 months,
    2024-06 … 2026-05, and a 12-month Summary returns 12 months.
- The load is proven through `/api/entries-page` for 2024-06, 2025-10 and
  2026-05: fixture row count and expense total must equal the generator's.
  It refuses to load twice.
- Load times: 1k in 1.2 s, 10k in 2.3 s.
- Not reproduced: the create path's split-expense linking for *shared*
  entries (the demo reseed doesn't do it either), so Splits rows come from
  the demo's split data only.
- Switch: `PERFORMANCE_FIXTURE=demo|scale-1k|scale-10k` (default demo;
  anything else fails before starting). Every report records `fixture`.
- `built-client.spec.js` skips on scale fixtures, because its readiness
  predicates read demo values; scale fixtures are measured by API only
  (no browser budgets).

### Admission measurements

`api-admission.spec.js`: one unmeasured request per family, then 20.
- Bytes are the uncompressed JSON body; gzip is gzip of that body (the
  local Worker does not compress).
- Handler time is Server-Timing `app` median/p95.
- Local wrangler dev, machine load ≈20, revision `e3cd00b`. Absolute
  numbers are local; the ratios between fixtures are the useful part.

| Family (params) | Fixture | Bytes | Gzip | app median / p95 ms |
| --- | --- | ---: | ---: | --- |
| entries-page (household, 2026-05) | demo | 14,777 | 1,423 | 3 / 4 |
| | scale-1k | 43,471 | 2,586 | 4 / 5 |
| | scale-10k | 1,429,624 | 44,765 | 20 / 23 |
| entries-page (Tim, 2026-05) | demo / 1k / 10k | 14,926 / 43,620 / 1,429,773 | 1,436 / 2,602 / 44,784 | 3/4 · 4/5 · 21/25 |
| month-page (household, 2026-05) | demo | 68,146 | 4,889 | 9 / 11 |
| | scale-1k | 125,853 | 7,557 | 10 / 12 |
| | scale-10k | 2,902,361 | 96,823 | 28 / 31 |
| summary-page (6 months) | demo | 16,361 | 1,914 | 16 / 20 |
| | scale-1k | 10,951 | 1,505 | 17 / 20 |
| | scale-10k | 10,992 | 1,513 | 42 / 47 |
| summary-page (12 months) | demo* | 16,361 | 1,914 | 16 / 18 |
| | scale-1k | 23,498 | 2,377 | 27 / 30 |
| | scale-10k | 23,566 | 2,409 | 66 / 71 |
| summary-account-pills | demo / 1k / 10k | 1,174 / 1,232 / 1,235 | 328 / 324 / 327 | 4/5 · 6/8 · 30/33 |
| splits-page (household, 2026-05) | demo | 64,825 | 5,457 | 14 / 18 |
| | scale-1k | 95,584 | 6,897 | 15 / 20 |
| | scale-10k | 1,570,064 | 56,852 | 34 / 37 |
| imports-page | demo / 1k / 10k | 16,060 (all) | ≈1,762 | 5/6 · 7/9 · 28/31 |

\* The demo has six tracked months, so both ranges return the same body.
The demo's 6-month Summary is larger than scale-1k's: it covers demo months
with plan rows and notes, while scale-1k's 6-month window adds only
fixture months.

### Findings

- The month-scoped payloads (Entries, Month, Splits) grow with the rows in
  the month: 2,000 rows give 1.4–2.9 MB uncompressed (45–97 KB gzip).
  Summary stays small (≈11–24 KB) but its handler time grows with
  history: 66 ms for 12 months at 10k.
- Account pills and Imports keep constant bytes, but their handler time
  grows with the total row count (≈6×): they scan the ledger.
- Against today's mobile limits (`maxDataBytes` 50,000,
  `maxDataHandlerMs` 250):
  - within both limits at every size, if bytes mean the uncompressed body:
    summary-page (≤12 months), summary-account-pills, imports-page;
  - within the limits at demo and 1k only: entries-page;
  - over the byte limit at 1k: month-page and splits-page.
  - At 10k, Entries, Month and Splits are far over by uncompressed body.
    Measured by gzip size, all would pass at 10k except Month (97 KB).
- Choosing which byte measure `maxDataBytes` means, and filling
  `WARMUP_ADMISSIONS`, changes application code. It is not done here and
  is left as an explicit decision (H10 or a follow-up). Mobile data warmup
  stays off until then.

### Commands and results (Node 22.12.0)

| Command | Result |
| --- | --- |
| `npm run test:unit` | Pass 396/396 (the scale-fixture file grew from 1 to 5 tests) |
| `npm run build` | Pass |
| `PERFORMANCE_FIXTURE=demo\|scale-1k\|scale-10k … api-admission.spec.js` | Pass ×3 (mobile project skipped by design) |
| `npm run test:performance` (demo, all specs) | Pass 3, 1 skipped. Desktop cold median 483 ms, mobile 2,142 ms (load ≈20, not compared) |
| Manual loader run on a separate Worker | 1k and 10k loaded and validated; a second load was refused |

The scale-fixture unit test was rewritten, not weakened:
- The old shape checks (counts, totals, 2,000-row month, transfer pairing,
  provisional, a negative total) are kept.
- The unused import-row IDs and supplemental split groups were removed,
  because nothing loaded them.
- New checks: real references, ownership follows the account, anchors,
  missing-reference errors, SQL row counts, columns and escaping, and the
  fixture switch.

Remaining risk: local SQLite timings are not production D1. Rollback:
revert `e3cd00b`, `41838ad`.

Next eligible step: H10.

## H10: First delivery closure

Date: 2026-09-24. Candidate `d2ec630`, with application code as of H09
`94a02f6`. Baseline `506f3fd` (the H01 commit, before H02). Harness commit
`d2ec630`:
- `PERFORMANCE_WARMUP_MODE` sets `__MONIES_MAP_WARMUP_MODE__` and is
  recorded as `warmupMode`;
- per-request detail for idle traffic and the first round trip;
- `scripts/compare-performance.mjs` with 4 unit tests.

### Method

- Baseline worktree at `506f3fd` with `npm ci`, and the **current** harness
  copied in so both sides measure identically: `built-client.spec.js`,
  `performance-stats.mjs`, `run-performance-worker.mjs`,
  `load-performance-fixture.mjs`, `fixtures/scale-fixture.mjs`. The
  baseline kept its own `route-asset-report.mjs`, which already had
  `parseWarmupCosts`. The worktree was removed afterwards.
- Both sides built with `npm run build`.
- Two interleaved rounds of four cohorts each (baseline, normal, off,
  intent-only), all on port 5191, sequential, with separate artifact dirs.
  Settings: 5 cold samples, 20 warm per direction.
- Profiles:
  - desktop: CDP 40 ms RTT, 10 Mbps, CPU 1×;
  - mobile: Pixel 7 emulation, 150 ms RTT, 1.6 Mbps, CPU 4×.
- Machine load climbed from ≈25 to ≈73 during the runs (other work on the
  machine), so single timing deltas under ≈15% are noise. Byte and request
  counts are deterministic.

### Baseline → candidate (normal warmup), rounds 1 / 2

| Metric | Desktop baseline | Desktop candidate | Mobile baseline | Mobile candidate |
| --- | --- | --- | --- | --- |
| Cold usable median (ms) | 675 / 480 | 541 / 470 | 2,709 / 2,581 | 2,140 / 2,126 |
| Cold usable p95 (ms) | 959 / 565 | 775 / 472 | 2,772 / 2,610 | 2,187 / 2,138 |
| Bytes before usable | 278,382 | 219,904 (−21.0%) | 292,286 | 219,901 (−24.8%) |
| JS files before usable | 16 | 8 | 17 | 8 |
| JS bytes before usable | 238,756 | 180,119 (−24.6%) | 252,665 | 180,125 (−28.7%) |
| API requests before usable | 4 | 4 | 4 | 4 |
| First Summary → Entries (ms) | 138 / 115 | 118 / 125 | 556 / 453 | 491 / 446 |
| Warm Summary → Entries median (ms) | 55 / 56 | 54 / 55 | 94 / 90 | 97 / 90 |
| Warm Entries → Summary median (ms) | 52 / 54 | 52 / 49 | 107 / 96 | 113 / 103 |
| Idle requests / bytes by 2 s | 1 / 1,955 | 7 / 32,347 | 1 / 1,953 | 0 / 0 |
| Idle requests / bytes by 30 s | 3 / 9,221 | 8 / 34,339 | 1 / 1,953 | 6 / 30,695 |

No row exceeds the plan's regression limits: initial bytes +5%,
median/p95 +10%. Initial bytes went down by 21–25%. The baseline's first
navigation made 0 requests on desktop because it idle-imported every route
and prefetched pages; the candidate reaches the same with 5 fewer idle
requests than the old all-route import plus prefetch.

### Warmup modes on the candidate (versus off), rounds 1 / 2

| Mode | Desktop first Summary → Entries | Requests | Mobile first Summary → Entries | Requests | Idle bytes by 30 s (desktop / mobile) |
| --- | --- | --- | --- | --- | --- |
| off | 206 / 198 ms | 7 | 780 / 796 ms | 7 | 0 / 0 |
| intent-only | 197 / 186 ms | — | 809 / 790 ms | — | 0 / 0 |
| normal | 118 / 125 ms (−37 to −43%) | 0 | 491 / 446 ms (−37 to −44%) | 1 | 34,339 / 30,695 |

Cold load, initial bytes and warm navigation are identical across modes
within noise. One outlier: round 1 desktop normal versus off showed a +17%
cold median, while round 2 showed −1% with the same bytes. Intent-only
matches off here because the harness clicks without resting on links, so
the 100 ms hover dwell never fires. That is expected: intent warms on
hover, focus or touch-down.

### Speculative use

Hit = an idle-fetched path that the unwarmed (off) first round trip
requested.

| | Desktop | Mobile |
| --- | --- | --- |
| Idle requests needed by the first round trip | 7/8 (88%), both rounds | 6/6 (100%), both rounds |
| Completed but unused | 1,992 bytes: `/api/imports-page` | 0 |

The desktop `imports-page` request is not needed by the round trip, but it
feeds the Summary import banner. It counts as unused only under this narrow
definition. Unknown or failed candidates fall back to intent-only by
construction (H07: no retry in the same visit, and mobile data stays off
without admission).

### Gates

| Check | Result |
| --- | --- |
| `npm run verify` | Stops at step 1, `npm audit`: 5 pre-existing advisories (sharp via miniflare/wrangler, browserslist); unchanged baseline failure |
| `npm run typecheck` | Pass |
| `npm run test:unit` | Pass 400/400 |
| `npm run build` | Pass |
| `npm run test:e2e:smoke` (5173/8787, confirmed free) | Pass (6 + 7 + 1 + 13 + 49) |
| Full functional E2E (isolated ports 5311/8911/9311, own D1 dir) | **Pass 216/216** (8.4 min) |
| Screenshots 1440×900 and 390×844: Summary, Month, Entries | Taken after usable; no horizontal scroll at either size. Not committed; they are local artifacts |
| Keyboard-only navigation (Tab/Enter to Entries, Shift+Tab/Enter back to Summary) | Pass |
| Chromium touch emulation (tap Entries → Month → Summary at 390×844) | Pass |
| WebKit functional smoke | Not run: WebKit is not installed |
| Real-device testing | Not done |

Observation: the Summary donut still shows its spinner at the moment the
page is usable, because the Recharts chunk is lazy-loaded. That was already
true at the baseline (`506f3fd`), and readiness deliberately does not wait
for the decorative chart.

### Limitations

- Local wrangler dev and CDP-emulated networks, not production or devices.
- The cold Worker isolate is outside the browser harness; H09 measured it
  separately (≈30 ms init plus a 130–230 ms first handler).
- Timings were taken under heavy machine load; the byte and request
  results are the robust ones.
- Mobile data warmup is still off: `WARMUP_ADMISSIONS` is empty until
  someone decides which byte measure the limit uses (H01b findings).
- The fresh-database first-request failure (`audit_events`) is still
  unmerged here (H09 audit).

### Rollback per task

| Task | Revert |
| --- | --- |
| H01b | `e3cd00b`, `41838ad` (harness only) |
| H09 | `c1dd539`, `94a02f6` |
| H08 | `f87ae55`, `22f2840` |
| H07 | `9fb2bc9`, `a5c00bd`, `1a867ca`, `6d998d2` |
| H06 | `dc3c229`..`8770a06` |
| H05 | `23a5109`, `d21fbe4`, `f464bac`, `176509c` |
| H04 | `0adf7a4` |
| H03 | `d30d4f0`, `1d9524b` |
| H02 | `a8176fc`, `403bb63` |
| H10 harness | `d2ec630` |

Later tasks build on earlier ones, so revert newest first.

### Decision input for H11–H17

The first delivery met its goals without regressions. The measured
bottlenecks left:
1. Month-scoped payloads at scale: Entries 1.4 MB, Month 2.9 MB and Splits
   1.6 MB uncompressed for a 2,000-row month, plus account pills and
   Imports scanning the whole ledger (≈30 ms at 10k). This is the H14
   candidate.
2. Cold-isolate first handler (H09).
3. The mobile admission decision, which is a small app-code change once
   the byte measure is chosen.

H11–H13 and H15 are maintainability work and claim no speed.

Status: complete. All servers stopped and no harness processes left (checked with `pgrep` and `lsof` on 5173/8787/5191/5311/8911/9311).

### Post-closure: fresh-database fix merged

The fresh-database initialization fix (`claude/sharp-kepler-4efdb7`:
`647ca50`, `fd841b1`, `7c9ef02`, `0d04eba`, `4a64103`) was merged as
`545f21f` on 2026-09-24. The merge was clean. After it:
- typecheck passes and unit tests pass 403/403;
- on a new `schema.sql` database the first request (the reseed) returns
  200 and nothing logs `API init failed`;
- `npm run test:performance` passes (3 passed, 1 skipped), now without
  the removed preflight;
- the full functional E2E passes 216/216 on isolated ports.

This closes the pre-existing issue noted under H09 and H10.

## Mobile data admission (after H10)

Date: 2026-09-24. Commits: `a009cd1` (required fetch timing), `fd5fbfb`
(admission row and tests).

### What was missing

Filling `WARMUP_ADMISSIONS` alone would not have enabled anything:
`use-route-warmup.js` always passed `recentRequiredDurationMs: null`, and
the policy denies mobile data when that value is unknown.

`fetchQueryWithLease` now times its own network fetches through
`createRequiredTiming`:
- cache hits, failures and speculative reads are not recorded;
- a reading expires after 5 minutes.

The hook reads the latest value.

### The byte measure

`maxDataBytes` (50,000) is now defined as **gzip bytes of the JSON body**:
- that's what a phone downloads from Cloudflare, which compresses JSON;
- it's the same measure the module cap already uses.

The plan's wording said "response body"; this is the interpretation chosen.
Mobile's only data candidate is the Entries page, so the table holds one
row: the 10k fixture, the largest of the household and Tim views,
44,784 gzip bytes and 25 ms p95 (1.43 MB uncompressed).

Caveat: synthetic rows compress better than real ledgers, so a real
2,000-row month could exceed the cap. Typical household months are far
smaller.

Mobile preloads data only when all of these hold:
- 4g, and not data saver;
- a recent required fetch of 500 ms or less;
- after its code has loaded;
- one request per visit.

Without `navigator.connection` (iPhone Safari) mobile stays code-only by
the existing rule "missing connection information is not permission".

### Tests

- Unit:
  - required timing records only successful network fetches, not a cache
    hit, a failure or a speculative read, and readings expire;
  - the admission table holds exactly the measured row, within the caps,
    and other families are unknown;
  - the adapter reports the Entries admission.
- E2E (`route-warmup-data.spec.js`, mobile):
  - 4g: exactly one `entries-page` (household, 2026-05) after the Entries
    code, the tap to Entries makes no new request and shows the rows, and
    no Imports request;
  - 3g and data saver: no code and no data;
  - no connection information: code only.
  - With the timing mutated back to `null`, the 4g test fails.
- `npm run test:unit`: 404/404.
- Full functional E2E (isolated ports): 219/219.

### Measurement (built harness, mobile profile, same build)

| Mobile | Warmup off | Normal |
| --- | --- | --- |
| First Summary → Entries | 851 ms, 7 requests | 395 ms (−54%), 0 requests |
| Idle bytes by 30 s | 0 | 32,347 (Entries code + 1,652 B Entries data) |
| Idle requests used by the first round trip | — | 7/7 (100%) |
| Cold usable median | 2,158 ms | 2,157 ms |

Against the H10 round-2 normal cohort (before admission), the first mobile
navigation went from 1 request to 0 (446 → 395 ms). Desktop is unchanged,
because desktop does not consult admission.

Rollback: revert `fd5fbfb` (or empty the table) to return to code-only
mobile warmup.

## H11: Shell presentation

Date: 2026-09-24. Baseline `8d21800`. Commits:
- `e80fe6f`: contract tests first;
- `b895d99`: H11a, loading and error screens → `app-shell-status.jsx`;
- `6d60cbf`: H11b, route tabs and "More pages" → `app-shell-navigation.jsx`;
- `d31995f`: H11c, month and range pickers → `app-shell-period-pickers.jsx`;
- `9905b8a`: H11d, login registration → `login-registration-dialog.jsx`.

A behaviour-preserving extraction with no speed claimed. `App.jsx` went
from 3,675 to 3,386 lines.

### Boundaries kept

- Query ownership, URL normalization (`buildTabTarget`, the tab lists,
  `sanitizeTabParams`), retry handlers and warmup intent props stay in App
  and are passed down.
- Login submit, draft state and the placeholder-name rule stay with App (the
  identity owner); the dialog gets `onPersonChange` and `onNameChange`.
- No component receives App state wholesale.
- The three period pickers became one `PeriodMonthPicker`: `closeOnSelect`
  for the single month, disabled months for the range ends.

### Contract tests (written first, pass on the old and new code)

`tests/e2e/app-shell-chrome.spec.js`, 10 tests (none of these surfaces
had browser coverage before):
- shell error and reference-data error screens, each with a working retry;
- the slow-shell loading panel;
- desktop tabs keep the view and month and mark the active tab;
- "More pages" opens by keyboard, lists Imports/Settings/FAQ, Escape
  returns focus, and it navigates and marks itself active;
- the month picker: year strip, keyboard pick, closes, returns focus;
- the range pickers: disabled months, stay open, Escape returns focus;
- Splits period controls are passive;
- login registration: profile, name suggestion, save, linked view on
  Splits, and no dialog after reload;
- a failed login save keeps the dialog, the draft and the error.

### Proof

- Screenshots: 13 states captured before (two runs; 12 byte-identical run
  to run) and after each subtask:
  - error screens;
  - Summary, Month, Splits and Settings chrome;
  - each picker open;
  - mobile Summary and the open "More pages" menu;
  - the login dialog, with and without its error.
- After H11a, b, c and d, every deterministic shot was byte-identical. The
  exceptions:
  - the reference-data error screen (varies between runs of the old code
    too);
  - one start-picker shot where the lazy donut chart had not rendered yet
    (the picker pixels match).
- Chunks: the four modules are bundled into the entry chunk, the chunk
  count is unchanged, and `client-route-chunks` passes. The raw entry
  bundle is 1,029 bytes smaller. Gzip is +1.4 KB, from different minifier
  names and module order, not added code. JS before usable is 181.5 KB
  versus 180.3 KB (+0.7%, within the 5% limit).
- Gates:
  - unit tests 404/404, typecheck and build pass;
  - the contract spec passes after every subtask;
  - full functional E2E on isolated ports passes 229/229 (219 + 10 new).

### Found, not fixed (out of scope)

A first-load page failure (Summary or Month returning 500) never shows the
page error screen: the app stays on the loading panel with an issue line
and no retry button. Only one request is made. It is filed as a separate
task, and the contract suite does not pin that screen.

Rollback: revert `9905b8a`, `d31995f`, `6d60cbf`, `b895d99` (newest
first); the contract tests can stay.
