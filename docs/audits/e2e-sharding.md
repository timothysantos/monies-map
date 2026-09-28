# Browser Suite Sharding

Status: done 2026-09-26 on branch `e2e-sharding`. `npm run test:e2e:sharded`
runs the full Playwright suite as three isolated shards by default.
`npm run test:e2e:smoke` runs the smoke bundle on two shards. CI runs the
full suite as a four-job matrix plus a merge job.

## Why

The full suite ran serially (`workers: 1`) against one shared local D1 on the
fixed ports 5173/8787. A quiet run took about 12 minutes on the 10-core M1 Pro,
and parallel sessions kept colliding on those ports.

## How it works

- `scripts/e2e-stack.mjs`: one isolated stack per shard. Vite runs on
  `5500+N`, Wrangler on `8900+N`, the inspector on `9500+N`, with D1 in
  `.wrangler/state-shard-N` (emptied, then migrated from `schema.sql`) and the
  Vite cache in `node_modules/.vite-shard-N`. Vite starts through
  `scripts/e2e-vite-server.mjs` because the Vite CLI has no cache-dir flag,
  and two servers that share `node_modules/.vite` race each other's
  dependency optimisation. Busy ports fail the run at once instead of reusing
  another tree's server. Servers run in their own process groups and are
  stopped, with their state removed, when the shard ends or on Ctrl+C.
- `scripts/e2e-shard-plan.mjs`: the work comes from `playwright test --list`,
  so a new spec is always included. Whole files are placed longest first on
  the least-loaded shard, using `tests/e2e/shard-weights.json` (measured
  seconds per file). An unmeasured file counts as its test count times the
  median seconds per test. Files never split, so tests inside a file keep
  their order and their database, exactly as in a serial run.
- `scripts/run-e2e-sharded.mjs`: builds `dist/` once. Per shard it starts a
  stack and runs one Playwright process with one worker, `E2E_BASE_URL`, its
  own `--output` and a blob report. It then merges everything into
  `playwright-report/` and `test-results/e2e-sharded/report.json` and prints
  one summary. It exits non-zero on any failed test, any failed shard, or a
  merged test count that differs from the listing (a shard that never
  reported).
  - `--smoke` runs the smoke batches from `scripts/e2e-smoke-workflows.mjs`,
    one process per batch, as before.
  - `--shard K` runs one shard, for a CI matrix job; `--merge <dir>` merges
    downloaded blobs.
  - `--update-weights` rewrites the weights after a full passing run.
- `playwright.config.js` reads `E2E_BASE_URL`. Without it nothing changes, and
  `npm run test:e2e` is the same serial run on 5173/8787.
- Why not Playwright's own `--shard`: it cuts the file list into contiguous
  chunks by test count. With the measured weights, its longest shard would be
  269 s for three shards and 271 s for four, against 238 s and 179 s for the
  weighted plan. The weighted plan balanced within 1%.

## Independence check

- I read all 50 spec files (252 tests). No `describe.serial`,
  `describe.configure({ mode })` for order, `beforeAll`/`afterAll`,
  hardcoded ports or hosts, or cross-file reads of created rows.
- Every test reseeds through `/api/demo/reseed`: in its own body, in a local
  helper it calls (`openEntries`, `openMonth`, `newPage`, ...), or in a
  `beforeEach` of its describe. I checked this with a script that follows
  helpers and describe scopes. The one exception is `faq-content.spec.js`,
  which reads static FAQ content and passes on a fresh, empty schema.
- `localStorage`, `BroadcastChannel` and cross-tab tests stay inside one
  browser context per test. Nothing is shared between Playwright processes.
- Found by running under load, not by order:
  - `splits-viewer-amounts.spec.js:22` clicked Save and read
    `/api/splits-page` straight away. In one loaded run the read answered
    while the update was still in flight (server log: both requests
    together) and saw the old shares. Fixed in the test by waiting for the
    `/api/splits/expenses/update` response. No assertion changed.
    `--repeat-each=3` passed. A scan found no other click-then-read without
    a response wait.
  - `mobile-sheet-focus.spec.js:305` (900x1200) failed once. The sheet
    reopened straight after a save showed 1800 instead of 1825, although
    the save had returned 200. This is an app race, queued separately: a
    just-saved Month row keeps its old `sourcePlannedMinor` until the
    refresh lands. The test is unchanged and not pinned; it passed in every
    later run.
- Nothing needed pinning to one shard.

## Measurements

Machine: M1 Pro, 10 cores, 16 GB, Node 22.23.3, Playwright 1.59.1. Before
each timed run I waited until the 1-minute load was below about 9 with no
other session running Playwright. Background load from Bitdefender, Time
Machine and other sessions' builds still came and went (load 7–13 at idle).
Wall time is the whole command: listing, four-way D1 setup, stack start, the
tests, merge and cleanup. `dist/` was already built (`--skip-build`). Load is
the macOS 1-minute average sampled every 20–30 s; it counts runnable threads,
so it runs well above the core count.

Full suite (252 tests):

| Run | Wall | Result | Load median / max | Notes |
| --- | ---: | --- | --- | --- |
| Serial baseline (repo config, ports 5420/8820/9420, own D1) | 723 s | 252 passed | 13.6 / 21.3 | another session ran one spec for about 1 min |
| N=3 | 354 s | 251 passed, 1 failed | 35.0 / 42.7 | other sessions testing; mobile-sheet-focus:305 app race |
| N=3 | 387 s | 251 passed, 1 failed | 33.7 / 42.9 | two other sessions testing; splits-viewer-amounts race (fixed) |
| N=3 | 326 s | **252 passed** | 30.9 / 50.3 | after the test fix; no other Playwright seen at start or end |
| N=3 | 326 s | **252 passed** | 24.5 / 27.8 | no other Playwright seen at start or end |
| N=4 | 316 s | **252 passed** | 37.5 / 46.1 | no other Playwright seen at start or end |
| N=4 | 364 s | 249 passed, 3 failed | 36.6 / 64.6 | load spike to 64 mid-run; three timing checks failed (below) |

- In the loaded N=4 run, the failures were all timing-sensitive checks:
  `financial-insight.spec.js:175` (quiet period measured at 640 ms against
  ≥650 ms), `app-dates.spec.js:17` (a click timed out after 120 s) and
  `import-ledger-flow.spec.js:1075` (a card still showing after 10 s). None
  reproduced in the passing runs.
- The per-shard times (about 300–320 s) are far above the planned 238 s
  (N=3) and 179 s (N=4). Each stack runs Chromium, workerd and Vite, so the
  shards compete for CPU and every test runs slower. Four stacks do not beat
  three by enough to matter.

Smoke bundle (88 tests):

| Run | Wall | Result | Load median / max |
| --- | ---: | --- | --- |
| Serial (a temporary copy of `run-e2e-smoke.mjs` on the isolated ports, servers per workflow) | 313 s | 88 passed | 14.9 / 17.8 |
| Sharded, 4 shards | 169 s | 88 passed | 35.4 / 42.5 |
| Sharded, 2 shards | 167 s | 88 passed | 18.3 / 21.3 |
| `npm run test:e2e:smoke` (2 shards) | 173 s | 88 passed | not sampled |

The smoke bundle is bounded by `import-ledger-flow.spec.js` alone (19 tests,
about 130–145 s), so two shards match four.

## Decisions

- **Full suite default: 3 shards.** Two passing runs took 326 s each, against
  316 s for the passing N=4 run. That is 2.2x faster than the 723 s serial run,
  at about two-thirds of the four-shard peak load. The one loaded N=4 run
  lost three timing-sensitive tests. A run without `--shards` never starts
  more stacks than half the CPUs.
- **Smoke: `npm run test:e2e:smoke` now uses the sharded runner on 2 shards**
  (1.8x faster, 88/88 in three runs). It also reuses one stack per shard
  instead of restarting servers for every workflow. On a two-vCPU CI runner
  the CPU cap drops it to one stack. The old runner remains as
  `npm run test:e2e:smoke:serial`.
- **CI: four shards on separate runners** (`full-e2e-shard`, a matrix with
  `fail-fast: false`). Each runner has one stack, so there is no contention
  and the weighted plan applies as measured (about 180 s of tests per shard
  plus setup). The merge job keeps the `full-e2e` check name. It fails when a
  shard job failed, a test failed, or the merged count differs from the
  listing, and it uploads the HTML report. `verify` is unchanged apart from
  the faster smoke step. I checked the merge path locally, including a
  missing shard (count mismatch, exit 1). I have not run the workflow on
  GitHub.

## wrangler dev proxy (removed workaround)

`wrangler dev` 4.113's ProxyWorker parked a GET whose proxied fetch lost its
connection until the next request reached the proxy: it compared the full
request URL with the Worker's bare origin, so every such error looked like a
Worker reload. In a quiet test the page's Summary request then never
answered. The stacks pinged `/api/health` once a second to drain that queue
(c959bcc). Wrangler 4.114 (#14593) compares origins
(`isSameUserWorkerOrigin` in `wrangler-dist/ProxyWorker.js`), and 4.129.1
(#15252) retries such a GET up to twice and logs `recovered on attempt`, so
the ping was removed with the upgrade to 4.141.0. #15252 also closed
workers-sdk issue 14926 (the dev server exiting when workerd restarted),
which had kept the project on 4.113.

Proof (3 isolated stacks side by side, 5 busy-loop processes on 10 CPUs,
`financial-insight.spec.js --grep "error-with-wording|drops-the-fact"
--repeat-each=30`, no ping): 4.113 failed 2 of 180 runs with the Summary
heading never appearing; 4.141 passed 540 of 540 in three rounds (slowest
run 7.5 s) and logged 15 dropped connections that its retry recovered.

## Keeping it honest

- A new browser test must reseed or read only static data. It must not
  depend on another spec file or on run order (`docs/code-spec.md`).
- After adding a spec or making one much slower, refresh the plan with
  `npm run test:e2e:sharded -- --update-weights`. It only writes after a
  full, unfiltered, passing run.
- The plan logic is covered by `tests/e2e-shard-plan.test.mjs`.
