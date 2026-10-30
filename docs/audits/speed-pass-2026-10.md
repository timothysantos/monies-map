# Speed pass (2026-10-30)

Owner request (approved): pages felt slow or failed repeatedly on the phone
and the desktop. Production logs showed Summary 0.9 to 1.4 s and the Summary
account pills ~1.0 s of server time (the slow-log line is 750 ms), Entries
~0.9 s, Settings ~3.8 s before the October cold-start fix, Imports 2 to 52 s
(fixed in 22c3a449) and Splits ~2.4 s (fixed in 61706156).

This pass measured every page read on the 10k-entry test household and on a
local copy of a fresh production export, fixed what made pages slow in
production, proved every response unchanged, and pinned the result in tests.

## What made pages slow

**The chain of sequential D1 round trips.** A local D1 answers in about a
millisecond, so the handler times in `docs/audits/macro-loading-baseline.md`
(Summary ≈77 ms on 10k) looked fine. In production the Worker waits a
network trip for every D1 read it makes after another one, and D1's own time
is small: on production D1 the heaviest Summary read (a year of entries)
takes ~7 ms, the month list 13 ms, a plan-row read 0.3 ms. The logs fit
100 to 180 ms per sequential step (Entries ~0.9 s over 5 steps, the pills
~1.0 s over 8, Summary 0.9 to 1.4 s over 9). A browser cohort run on a local
Worker that waits 100 ms before each D1 round trip reproduces the production
numbers: Summary's handler 1,041 ms, the pills 861 ms, Entries 549 ms.

Before the pass (production copy, 7,552 entries; "steps" is the longest
chain of round trips waited on one after another):

| Page read | Round trips | Sequential steps | Rows read | What the steps were |
| --- | ---: | ---: | ---: | --- |
| Summary | 69 | 9 | 91,746 | 5 plan reads per month of the range, each month's 4 in turn; the month list scanned every entry |
| Summary account pills | 11 | 8 | 85,459 | page context (categories, month list unused), then accounts' 5 reads in 4 steps, entries, investment values |
| Month | 36 | 15 | 56,525 | plan rows read twice, then each history month's plan reads in turn |
| Entries | 7 | 5 | 29,479 | household then people, entries then split shares, then split groups |
| Settings | 21 | 9 | 90,515 | `CREATE TABLE IF NOT EXISTS app_settings` twice per load, rule backfills, Shortcut settings and payment ways one after another |
| Imports | 15 | 7 | 70,169 | three history lookups, each chunk after the last |
| Ask turn (before the model call) | 16 | 12 | 2,704 | the entry draft context's 6 reads in turn, nicknames, the entry in focus |
| Splits | 21 | 4 | 92,905 | (fixed in 61706156; left as is) |
| Reminders | 13 | 4 | 24,283 | people, then accounts, then the rest |
| Cold isolate (any first request) | +24 | +24 | | one `PRAGMA table_info` per table, two `DROP ... IF EXISTS` of a table gone since 2025 |

**Every page read the whole ledger to list its months.** `loadTrackedMonths`
(the page context of every page) took `DISTINCT substr(transaction_date)`
over all entries: 24,191 rows read and 13 ms of D1 time on production,
30,688 rows on 10k.

**A phone never warmed the next page's code.** Since the colour presets
(2026-10-13) the built warmup metadata was empty (`{"routes": {}}`): the
asset report read a `<link>` written by the palette loader script as a
stylesheet named `palettes/`, could not read it, and marked every route's
cost unknown. The phone warmup policy needs that cost and refused every
automatic route warmup ("unknown-cost").

## How it was measured

- `scripts/measure-page-reads.mjs` (new): every page read through the real
  Worker on a real local D1, household and person views: round trips,
  sequential steps, rows read, row bytes, response bytes raw and gzip, node
  CPU and wall p50/p95 over 21 warm runs, wall time with 25 ms added before
  every round trip, and 3 cold samples (each a fresh Node process: schema
  check, empty caches). Node CPU includes the local D1 proxy's per-statement
  cost, so it tracks round trips more than the Worker's own JavaScript.
- `tests/support/d1-counting.mjs`: optional wait before each D1 call and the
  sequential-step count (`waves`).
- `scripts/page-dto-dump.mjs` (new): 151 to 181 page responses per database
  (every view, scope, six months, three Summary ranges, Entries ranges,
  settled rows); `--compare` prints only which responses differ and where.
- `scripts/wrap-d1-counter.mjs`: `D1_COUNTER_LATENCY_MS=100` makes a wrapped
  copy wait 100 ms before each D1 round trip of a GET; the wrapped binding is
  now one per binding (a new one per request had re-run the schema check on
  every request, inflating api-cost counts).
- Production copy: `wrangler d1 export monies-map --remote` (read-only),
  loaded into a scratch local D1, used only locally and deleted after.
  Only aggregate numbers are reported. Single statements were also timed on
  production D1 itself, wrapped in `SELECT COUNT(*)` so only counts printed.
- Browser: `tests/performance/page-loads.spec.js` (scale-10k fixture) and
  `built-client.spec.js` (demo fixture) on wrapped copies of origin/master
  (7776aa74) and the candidate, both waiting 100 ms per D1 round trip,
  interleaved, quiet machine. The phone profile is the harness's own: 150 ms
  RTT, 1.6 Mbps down, CPU 4x (a slow 4G and mid-range phone).

## Fixes (in commit order)

| Commit | Fix |
| --- | --- |
| c835e71a | Measurement tools (above) |
| 423439d8 | Summary: month list by index seeks (1,972 rows, 1.5 ms on production D1, identical list); plan and income rows of the whole range in one read each (`loadMonthPlanRowsForMonths`, `loadMonthIncomeRowsForMonths`); pending-snapshot check beside the month totals; an entries read and its split shares together; a year of entries read without display columns (`figuresOnly`) |
| 875f3924 | Month: every read at once; the planned month built from the rows already read; history months from the same range reads |
| 2c59a232 | Pills, Imports, Settings: `loadAccounts`' five reads and `loadHousehold`'s two sent together; the pills read only the people, not the whole page context |
| 7bd1b9c8 | Entries: entries and split groups together |
| 87d93874 | Settings: one step; `app_settings` created once per isolate |
| 5cee62ba | Imports: history lookups and their chunks together |
| a9e77303 | Reminders: reads start together |
| b9dee179 | Ask: the turn's context (draft context, habits, entry in focus) in one step before the model call |
| d29fb561 | Cold isolate: schema checks from one up-front read (`json_each` joined to `pragma_table_info`, which production D1 accepts; it refuses the function joined to `sqlite_master` and a long `UNION`); seeding in three steps |
| df2c2150 | Demo databases: the seed backfill reads its entries and plan links up front (about 100 sequential reads on every cold demo isolate) |
| 85f5acb6 | Entries shell: drops `views` (the month's entries once per view), which no client code reads |
| 11421697 | Phone route code warmup: the asset report ignores `<link>` markup in scripts; a build whose warmup metadata the page cannot read now fails |

Harness commits: edeec555 (wrapper latency), e29b119e (one wrapped binding
per binding), 474fa026 (built-client readiness: the Summary labels it
waited for were removed by the redesign, so the spec timed out on master),
cbb1127d (budgets, and layout shift and long tasks in page-loads).

### Equivalence

Every response of `scripts/page-dto-dump.mjs` compares identical before and
after on the demo household (151 requests), the 10k household with settled
split history (181) and the production copy (180), after every fix commit,
apart from two documented differences:

- `generatedAt` / `lastSeededAt` (run time) and seed-generated batch ids
  (`-<time>-<uuid>`) differ between any two runs; the compare ignores them.
- `entries-shell` no longer has `views`; every other field of every
  entries-shell response is identical (checked with `views` removed).

The plan rows' tie order (22 groups of plan rows share a `created_at` in
production) is unchanged: the Month and Summary responses are identical.

`scripts/persisted-state-snapshot.mjs` was not needed: no write path or
stored projection changed (the cold-path seeding writes the same rows, and
`tests/cold-start-statement-budget.test.mjs` still pins it to its two upkeep
writes).

## After

Production copy (7,552 entries, 2 people, current month 2026-10, Summary
range Nov 2025 to Oct 2026), household view unless named. Steps: sequential
round trips. Wall: local handler p50/p95 over 21 runs (local D1, no
network). @25: the same with 25 ms waited before every D1 round trip
(production waits ~100 ms or more). Cold: the first request of a fresh
isolate at 25 ms per round trip (3 samples, median). Before → after:

| Page read | Round trips | Steps | Rows read | Response gzip | Wall p50/p95 ms | @25 ms | Cold @25 ms |
| --- | --- | --- | --- | --- | --- | --- | --- |
| app-shell | 3 → 3 | 2 → 1 | 24,191 → 1,976 | 270 | 27/34 → 22/32 | 77 → 41 | 1,229 → 378 |
| reference-data | 2 → 2 | 1 → 1 | 126 → 126 | 1,782 | 12/16 → 14/16 | 35 → 36 | 959 → 277 |
| summary-page | 69 → 14 | 9 → 2 | 91,746 → 37,458 | 3,591 | 548/631 → 248/400 | 633 → 205 | 1,700 → 521 |
| summary-page (person) | 69 → 14 | 9 → 2 | 91,711 → 37,423 | 3,174 | 545/706 → 190/304 | 653 → 192 | 1,726 → 485 |
| summary-account-pills | 11 → 9 | 8 → 1 | 85,459 → 61,210 | 997 | 130/151 → 127/285 | 338 → 134 | 1,277 → 380 |
| month-page | 36 → 16 | 15 → 2 | 56,525 → 24,797 | 25,839 | 276/316 → 156/196 | 604 → 203 | 1,580 → 443 |
| entries-page | 7 → 7 | 5 → 2 | 29,479 → 7,264 | 18,379 | 60/73 → 50/59 | 189 → 86 | 1,124 → 315 |
| entries-shell | 10 → 5 | 6 → 1 | 29,543 → 130 | 57,747 → 2,303 | 73/93 → 22/34 | 212 → 42 | 1,398 → 397 |
| splits-page | 21 → 21 | 4 → 3 | 92,905 → 70,690 | 17,154 | 166/208 → 161/207 | 212 → 172 | 1,178 → 453 |
| reminders | 13 → 13 | 4 → 3 | 24,283 | 424 | 106/117 → 108/132 | 183 → 138 | 1,121 → 392 |
| imports-page | 15 → 15 | 7 → 2 | 70,169 | 7,105 | 120/144 → 123/147 | 255 → 127 | 1,451 → 470 |
| settings-page | 21 → 19 | 9 → 1 | 90,515 | 34,020 | 212/228 → 217/238 | 407 → 239 | 1,625 → 656 |
| ledger-checkup | 5 → 5 | 2 → 2 | 207,067 | 7,430 | 194/212 → 189/223 | 244 → 230 | 1,212 → 489 |
| skew-candidates | 16 → 16 | 4 → 3 | 39,909 → 17,694 | 151 | 135/189 → 122/148 | 212 → 163 | 1,145 → 514 |
| ask habits / done | 5 / 1 | 2 / 1 | 146 / 1,701 | | 24/38, 5/7 | 71, 34 | 989 → 288, 943 → 240 |
| ask turn, before the model call (stub model) | 16 → 13 | 12 → 2 | 2,704 | | 85/115 → 77/109 | 410 → 93 | 1,330 → 375 |

10k test household (10,241 entries, 60 imports with large stored previews,
200 diagnostics, 352 settled split records), same columns, after the pass
(before in brackets where it changed):

| Page read | Round trips | Steps | Rows read | Response gzip | Wall p50/p95 ms | @25 ms | Cold @25 ms |
| --- | --- | --- | --- | --- | --- | --- | --- |
| app-shell | 3 | 1 (2) | 284 (30,692) | 250 | 16/20 | 38 (73) | 535 (4,519) |
| summary-page | 14 (69) | 2 (9) | 33,246 (72,275) | 1,524 | 188/201 (501/569) | 206 (619) | 461 (1,757) |
| summary-account-pills | 9 (11) | 1 (8) | 77,780 (108,530) | 302 | 93/116 (120/140) | 97 (319) | 329 (1,213) |
| month-page | 16 (36) | 2 (15) | 16,743 (48,587) | 5,259 | 131/148 (234/243) | 152 (573) | 407 (1,511) |
| entries-page | 7 | 2 (5) | 5,038 (35,442) | 4,830 | 44/56 (58/78) | 86 (181) | 319 (1,111) |
| entries-shell | 5 (10) | 1 | 85 (35,461) | 1,810 (17,100) | 20/32 (69/83) | 40 (218) | 569 (4,751) |
| splits-page | 22 | 4 (5) | 50,780 (81,184) | 3,091 | 160/173 (168/188) | 190 (223) | 465 (1,195) |
| reminders | 13 | 3 (4) | 27,369 | 356 | 90/107 (92/121) | 122 (170) | 364 (1,109) |
| imports-page | 13 | 3 (4) | 127,995 | 2,708 | 121/133 (129/154) | 166 (205) | 675 (4,740) |
| settings-page | 19 (21) | 1 (9) | 113,113 | 6,808 | 132/148 (147/161) | 138 (337) | 693 (4,913) |
| splits settled rows (287) | 8 | 3 | 7,290 (37,694) | 13,580 | 50/70 (70/91) | 116 (160) | 330 (1,100) |
| ask turn (stub model) | 13 (15) | 2 (12) | 793 | | 57/71 (77/115) | 91 (375) | 342 (1,323) |

The 10k cold numbers for app-shell, Imports, Settings and entries-shell
were ~4.5 s because the demo seed backfill read each demo entry on its own
(df2c2150); production does not run that path (it is an empty-state
household), and its cold requests fell from 1.1 to 1.6 s to 0.3 to 0.7 s at
25 ms per round trip.

Not flagged by `EXPLAIN QUERY PLAN` on any page read: a full scan of a large
table without an index, apart from `audit_events` (proposal 6). The whole
transaction table is still read, grouped in SQL, by the two account folds
(proposal 6). No N+1 loop remains on a page read (the plan reads per month
were the last); no page parses a JSON column per row except the checkpoint
notices in `loadAccounts` (a few hundred rows).

## Browser: before and after

Cold load of each route until usable (fresh browser context, warm Worker),
`page-loads.spec.js` on the 10k fixture, 100 ms per D1 round trip, 3
interleaved runs per tree, 15 samples per route, median (p95):

| Route | Desktop before | Desktop after | Phone before | Phone after | Phone long tasks before usable (ms, after) | Phone layout shift (after) |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Summary | 1,486 (1,675) | 740 (891) | 3,155 (3,235) | 2,398 (2,454) | 350 | 0.024 |
| Month | 2,420 (2,592) | 1,059 (1,081) | 5,060 (5,094) | 3,741 (3,787) | 528 | 0.020 |
| Entries | 2,097 (2,259) | 1,540 (1,593) | 7,276 (7,363) | 5,978 (6,259) | 2,765 | 0.023 |
| Splits | 1,435 (1,545) | 1,235 (1,420) | 3,795 (3,961) | 3,632 (3,700) | 271 | 0.024 |
| Settings | 1,593 (1,661) | 807 (948) | 3,734 (3,806) | 3,029 (3,050) | 179 | 0.020 |
| Ask | 819 (940) | 729 (748) | 2,974 (3,002) | 2,912 (2,974) | 198 | 0.020 |
| Ask opens from Summary | 892 | 898 | 1,506 | 1,509 | | |
| Add card opens from Entries | 1,123 | 1,126 | 1,305 | 1,290 | | |

Requests before usable and JavaScript bytes are unchanged (Summary 22
requests and 185 KB of JS gzip on both trees; the phone needs ~2.3 s just
to fetch and run the first screen's code at 1.6 Mbps and 4x CPU, so Summary
is now close to that floor). The handlers the screens wait on, median
Server-Timing `app` on desktop in the same runs (bytes on the wire):

| Request | Before | After |
| --- | ---: | ---: |
| summary-page | 1,036 ms | 282 ms |
| summary-account-pills | 859 ms | 147 ms |
| month-page | 1,664 ms | 305 ms |
| entries-page | 537 ms | 236 ms |
| entries-shell (Entries without a cached shell) | 641 ms, 117,240 B | 113 ms, 2,060 B |
| settings-page | 966 ms | 173 ms |
| splits-page | 524 ms | 427 ms |
| app-shell | 208 ms | 108 ms |
| reference-data | 111 ms | 107 ms |

`built-client.spec.js` cohorts (demo fixture, 5 interleaved runs per tree,
`scripts/compare-performance.mjs`):

| Metric | Desktop before | Desktop after | Phone before | Phone after |
| --- | ---: | ---: | ---: | ---: |
| Summary cold usable median | 1,414 ms | 695 ms (−51%) | 3,070 ms | 2,360 ms (−23%) |
| Summary cold usable p95 | 1,520 ms | 747 ms | 3,098 ms | 2,394 ms |
| Bytes before usable | 225,591 | 227,763 (+1.0%) | 233,676 | 235,850 (+0.9%) |
| JS bytes / API requests before usable | 185,086 / 4 | same | 191,330 / 4 | same |
| First Summary → Entries | 189 ms | 160 ms | 1,823 ms | 1,584 ms |
| Warm Summary → Entries median (p95) | 47 (51) ms | 46 (67) ms | 160 (196) ms | 161 (185) ms |
| Warm Entries → Summary median (p95) | 57 (77) ms | 57 (79) ms | 143 (170) ms | 139 (157) ms |
| Idle requests by 30 s | 39 | 39 | 2 | 2 |

The +2 KB before usable is the warmup metadata block that is now filled in
(`index.html`). The desktop warm Summary → Entries p95 (+16 ms, over the
10% line) is one run's tail among 100 cached navigations of ~50 ms each;
the medians are equal. The phone's idle warmup stays at 2 requests in this
harness on both trees: the emulated phone reports a connection the policy
does not admit, so the restored phone route warmup shows only on a real
phone.

## Budgets added (failing on origin/master, passing now)

- `tests/page-load-scale-guard.test.mjs`, "every page read on the 10k
  household waits on a short chain of D1 round trips" (30 ms per round trip):
  round trips, sequential steps and rows read for app-shell, Summary
  (household and person), pills, Month, Entries, Splits, Reminders, Imports,
  Settings and an Ask turn. On origin/master: Summary 69 trips in 9 steps
  and 69,414 rows, Month 15 steps, pills 8, Entries 5, Settings 9, an Ask
  turn 12, app-shell 30,334 rows.
- Same file, the bounded-pages test now also covers Summary (16 trips,
  45,000 rows, 3.5 MB row bytes; it moved 5.3 MB), Month and Entries
  (statements, rows, row bytes, response bytes, median CPU).
- `tests/cold-start-statement-budget.test.mjs`: the schema check plus
  seeding in at most 8 sequential steps (29 on origin/master), and no
  `PRAGMA table_info` round trip (16 on origin/master), including a column
  the check adds back.
- `tests/performance/route-asset-report.test.mjs`: a `<link>` inside a script
  is not a stylesheet; `scripts/write-warmup-costs.mjs` fails a build whose
  metadata is incomplete.
- Payload budgets (`tests/e2e/api-payload-budget.json`): unchanged. No page
  response the budget tracks shrank (Summary, Month and Entries responses
  are byte-identical); `entries-shell` is not in that budget.
- First-screen bundle: unchanged (no client code changed).

## What did not reach the target, and why

The targets were warm handler p95 ≤ 300 ms and cold ≤ 800 ms on the 10k
household, Summary and the pills ≤ 250 ms warm.

- Locally (no network to D1) every page read meets them: the slowest warm
  p95 on 10k is Summary at 201 ms; every cold first request is under 700 ms
  even at 25 ms per round trip.
- In production each sequential step costs about 100 ms, so a page read's
  floor is its steps × ~100 ms plus D1 time. With 100 ms per round trip the
  browser cohort measured Summary 282 ms (2 steps; just above 250), the pills
  147 ms, Month 305 ms, Entries 236 ms, Settings 173 ms: at or within a few
  per cent of the targets. Splits (427 ms, 3 to 4 steps; proposal 5) and a
  cold first request after an idle spell (~4 to 7 extra steps: the schema
  check and seeding, ~400 to 700 ms) are above them; going further needs
  the Worker next to D1 (proposal 1) rather than fewer steps.
- Entries on a phone stays slow (6.0 s on the 2,000-entry month): the
  remaining time is creating the rows on a slow phone (proposal 3).

## Proposals (not built)

1. **Run the Worker next to D1.** Every remaining step still costs a
   network trip (~100 ms) because the Worker runs near the person and D1 in
   one APAC location. `placement: { mode: "smart" }` (or a targeted
   `region`/`host` once D1's location is known) would make each step a few
   milliseconds and add one trip between the phone and the Worker. Smart
   Placement needs steady traffic from several places to switch on, which
   one household may not give; it changes where every request runs, so it
   is the owner's call. Measure with the production tail (`durationMs`) before
   and after.
2. **Show the last page at once on a revisit.** Nothing but the app shell is
   kept on the device (`app-shell-query.js`, localStorage); a reload waits for
   Summary and the pills every time. Keeping the last Summary, pills and
   Entries page per view in IndexedDB and showing them while the fresh read
   runs would make a revisit instant. It is within the privacy rules (the
   data is already the person's, on their device, behind Cloudflare Access,
   and hidden money hides cached figures the same way), but it changes what
   the screen shows (yesterday's numbers for a moment, then today's), so it
   needs the owner's approval and a "refreshing" cue design first.
3. **Entries on a phone is render-bound.** 2.8 s of long tasks before a
   2,000-entry month is usable at 4x CPU (Entries' rows; the server part is
   now ~240 ms). Every row is still created as React and DOM (far rows only
   skip layout and paint through `content-visibility`, a deliberate choice
   so find-in-page and screen readers reach them); creating the first
   screenful first and the rest after is a client change for its own pass.
4. **Summary's year in SQL.** Summary still reads ~4,000 entries (~2.9 MB of
   rows, ~7 ms of D1 time) to add them up by month and category in the
   Worker. Grouping in SQL would need the person-view share, payback and
   investment-move rules in SQL with an equivalence proof per rule.
5. **Splits in two steps.** Its month reads wait for the page context only
   to learn the month; starting them with the requested month (and again
   only if the month is not tracked) saves a step (~100 ms).
6. **Indexes for two whole-table reads.** The account folds behind the pills,
   Imports and Settings read every entry (30,435 + 22,315 rows, ~35 ms of D1
   time per load on production); a covering index on transactions(household,
   account, dates, type, amount, import) would cut that. "Done for you" and
   Settings' audit list scan `audit_events` (1,701 and 3,400 rows); an index
   on (household_id, entity_type, created_at) would bound them. Both are
   additive schema (production and demo first).
7. **Earlier api-cost D1 counts were inflated.** Before e29b119e the wrapped
   Worker re-ran the schema check on every request, so api-cost's `x-d1`
   statement counts in earlier audits include ~24 init statements each.
