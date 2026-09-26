# Atomic Writes Audit

Status: complete for the listed commands; open items at the end.

Branch `atomic-writes`, based on `macro-performance` at `94c3ac2`. Node
v22.12.0. Scope: evaluation steps 2 and part of 5 — make multi-statement
persistence commands all-or-nothing, with focused unit tests first.

## What was non-atomic (verified in the base code)

| Command | Base behaviour | Partial state a mid-command failure left |
| --- | --- | --- |
| Import commit | draft `imports` row by itself, rows in `db.batch()` chunks of 90, certificates and chain-break clears in further batches, status flip, snapshot recalculation and audit as separate statements; a `catch` deleted the import's rows and marked it `rolled_back` | a `rolled_back` imports row always; promoted or certified existing entries could stay changed (cleanup only resets certification status, not the previous bank facts) |
| Import rollback | ~10 sequential writes plus per-row restores, no status check | half-restored certified rows, entries removed but import still `completed`; a second rollback ran again and added another audit event |
| Month totals (`recalculateMonthlySnapshots`) | one `.run()` per person scope | some scopes updated, others stale |
| Entry update / classification / delete | sequential `.run()` | e.g. transfer pair unlinked but its group kept; plan links deleted but entry kept |
| Transfer link / settle | sequential `.run()` (link ran two updates with `Promise.all`) | one half linked or settled, the other not |
| Month plan save / links / delete row / duplicate / reset / delete month | sequential `.run()`; split sync deleted splits before the owner lookup | plan row without splits; links without hints; copied rows without totals; month half cleared |

Two further defects surfaced by the new tests and fixed:

- Rolling back a CSV import never refreshed the months of the entries it
  removed, so the stored month totals kept counting them (commit `3061256`).
- The certificate's superseded-row snapshot was read after the commit had
  deleted those rows, so it always fell back to rebuilding the row from the
  raw import row, losing category, note, owner and split links. It is now read
  before the batch (commit `de03bd1`).

## Design

- Every command reads and validates first, then commits its writes, its audit
  event and its month refresh markers in one `db.batch()`. D1 documents a
  batch as a SQL transaction that rolls back if any statement fails; the unit
  tests confirm this against Miniflare's local D1.
- Month totals are derived from the committed ledger, so they cannot be
  computed inside the write's batch without re-implementing `loadEntries` in
  SQL. The write puts `monthly_snapshot_refreshes` rows in its batch; the
  refresh rewrites every scope of those months and deletes the markers in one
  batch. A refresh failure is logged and does not fail the committed write;
  the Summary and Month pages repair marked months before reading totals (one
  small query when nothing is pending).
- Month duplicate computes the new month's planned totals from the source
  month it copies (same rows, same splits), so the copy and its totals commit
  together.
- Import certificate: the fallback projected balance used to read the ledger
  after the chunks were written. It is now computed from the ledger read
  before the batch with this commit's own superseded deletes, certification
  updates and new rows applied.
- Rolling back a `rolled_back` import throws "cannot be rolled back", which the
  route already maps to 409.

### Import size and the one staged path

No batch limit was hit. D1's documented limits apply per statement (100 bound
parameters, 100 KB of SQL, 30 s) and there is no documented statement-count
limit per batch; Workers allow 50 (free) / 1,000 (paid) queries per
invocation. The April 2026 chunking (`46496fe`) fixed large CSV commits that
issued many sequential queries, which is consistent with the per-invocation
query cap rather than a batch-size cap, but the exact production error was not
recorded, so the batch size that Cloudflare accepts in production is not
proven here.

The chosen design: commits up to 500 statements (about 245 CSV rows) run as
one batch, which stays under the paid per-invocation cap even if every
statement in a batch counted separately. Larger commits are staged: the draft
import and its own new rows (import rows and new ledger entries, which ledger
reads ignore while the import is `draft`) are written in chunks of 90, then
every visible change (promotions, certifications, superseded deletes,
checkpoints, certificates, the `completed` flip, audit and markers) is one
final batch. Any failure deletes the staged rows and the draft; if even that
fails, the draft stays hidden and the next commit of the same file replaces it.

## Test evidence

New files (node:test, real local D1 via Miniflare, demo household seeded once
per file, a copied database per test): `tests/atomic-writes-imports.test.mjs`
(13), `tests/atomic-writes-entries.test.mjs` (8),
`tests/atomic-writes-months.test.mjs` (10). `tests/support/d1-workspace.mjs`
provides `failingStatement`, which makes the n-th matching statement fail when
it executes, alone or inside a batch, and `dumpDatabase`, a full dump of every
table in rowid order. Each failure test asserts the whole dump is unchanged.

The tests were written against the base code first. The first 26 tests, run
unchanged in a checkout of `94c3ac2`: 7 pass (the success cases of existing
behaviour) and 19 fail. 17 of those fail for the stated reason, for example a
failed commit left an `imports` row `rolled_back`; a failed rollback had
already deleted 2 entries; a failed recalculation had rewritten the household
scope; a failed entry delete had already removed its plan link; a failed month
reset had deleted 18 entries and 53 splits; a failed staged import left its
`imports` row; a second rollback returned 200 instead of 409; the CSV rollback
left the month total 6,912 too high. The other 2 (the single-batch and bulk
commit success tests) fail only because they also assert the new
`monthly_snapshot_refreshes` table is empty. Two test bugs found on the first
base run (import row indexes are 1-based; plan rows tie on `created_at`) were
fixed in the tests, not the code.

On this branch all 31 pass (26 plus the 5 added after review, below). Deliberate breaks are caught: running the
entry-delete statements one by one fails the entry-delete failure test;
skipping the staged final batch fails both bulk-import tests.

## Persisted-state harness

`node --experimental-sqlite --no-warnings scripts/persisted-state-snapshot.mjs`
(isolated ports 8961–8964):

- base `94c3ac2`, run twice: byte-identical (`cmp`), so the harness is
  deterministic.
- after the atomicity refactor (`de03bd1`, before the rollback fix): every
  table and all 14 page DTOs identical to the base. The only difference is the
  new `monthly_snapshot_refreshes` table, present and empty.
- after the rollback fix (`3061256`): one intended difference — the 2026-05
  `monthly_snapshots` rows for `household` and `person-tim` drop from 579,900
  to 574,222 and 452,900 to 447,222 (`total_expense_minor` and
  `total_net_minor`), exactly the 5,678 of the rolled-back "STATE IMPORT
  ROLLED BACK" row the old rollback left counted. Page DTOs are unchanged.

## Runtime (pass 2)

Real `wrangler dev` Worker on port 8801 with its own D1 (`--persist-to
.wrangler/state-atomic`): reseed, CSV preview and commit of two rows moved the
Summary 2026-05 real expenses from 559,666 to 566,578; rollback returned it to
559,666; a second rollback returned 409 with "This import has already been
rolled back, so it cannot be rolled back again."

Failure injection ran against Miniflare's workerd-backed D1 in the unit tests,
not inside `wrangler dev`.

## Independent review (pass 3)

A separate reviewer read the whole diff. Confirmed and fixed, each with a
test that fails on the pre-review commit `2c087d0` (checked in a scratch
checkout: exactly these 4 of 31 failed):

- High: the staged commit's cleanup deleted every row of the import id with
  no status check. A concurrent second commit of the same large file (same
  deterministic id) that failed on the `imports` key wiped the first commit's
  300 rows; a final batch that landed but reported an error was undone after
  committing. Now the draft batch runs before cleanup is armed and every
  cleanup delete requires the import to still be `draft` (`88c383a`).
- Medium: the marker delete used one `IN` list, so a refresh of more than 99
  months exceeded D1's 100 bound parameters and failed on every read. Now one
  delete per month (`e83fa0f`).
- Medium: a refresh computed before a newer write to the same month could
  commit after that write's own refresh, storing older totals (7,000 short in
  the test) and deleting the only marker. Each marker write now sets a
  `refresh_token`; a refresh's snapshot writes and marker delete apply only
  while the token it read is unchanged (`e83fa0f`).

Also added: a test that the certificate computes its balance from the
post-commit ledger when preview figures are missing (passes before and
after). Noted, not changed: reads that now run before a replaced earlier
attempt's cleanup only differ for a leftover legacy draft that still
certifies rows, which this code never produces; a row that is both
superseded and a reconciliation target would be counted by the certificate
simulation, which preview does not produce.

After the review fixes the persisted-state harness output is byte-identical
to the post-rollback-fix run above.

## Gates

All on the final code unless noted, Node v22.12.0.

- `npm run verify`: exit 0. `npm audit` 0 vulnerabilities; typecheck clean;
  unit 482/482 (68 s); build; `check:bundle` 180,385 B JS gzip against a
  180,337 B budget (+48 B, inside the 5% allowance, from the longer
  large-import notice; budget not raised), CSS 31,961 B unchanged; smoke 17
  workflows, 125 tests passed, including the page-payload budget spec.
- `npm run test:e2e` (full, 245 tests) on isolated ports (Vite 5401,
  Worker 8801, `--persist-to .wrangler/state-atomic`, temporary Playwright
  config with `webServer: undefined`): 245 passed (9.6 min).
- An earlier full run, before the review fixes, had 244 passed and 1 failed:
  `import-inbox-navigation` "stale import banner" timed out waiting 10 s for
  the Summary heading. It passed when re-run alone (5.9 s), in the smoke
  bundle, and in the final full run. Recorded as a timing flake; the cause was
  not investigated further.

## Rollback restores promoted manual entries (2026-09-25)

Branch `rollback-restores-manual`, based on `macro-performance` at `d702fed`,
Node v22.23.3. Closes the first open item below. Decision (the user's): a
rollback puts the promoted entry back as a Manual provisional entry, exactly as
it was before the promotion.

Storage: one column, `import_rows.promoted_entry_snapshot_json`, in
`schema.sql` and added by a guarded `ALTER TABLE` in
`app-repository-schema.ts`, so production needs no manual migration. The
promoting import row is written in the commit's batch (or its staged chunk for
large imports) with a JSON snapshot of the fields the promotion overwrites:
`import_id` (NULL), `import_row_id`, `post_date`, `description`,
`amount_minor`, `entry_type`, `transfer_direction`, plus `updated_at` as
evidence. Rows that create entries store NULL. The snapshot is read with the
reconciliation target before any write.

Rollback (`buildPromotedEntryRestore`, read before the batch, statements run
first in the rollback's one `db.batch()`, before the cleanup):

| State of the promoted entry at rollback | Result |
| --- | --- |
| still import provisional in this import | snapshot bank facts restored, `import_id`/`import_row_id` cleared; category, note, owner, splits and transfer links kept; `updated_at` is the rollback time. A bank fact the user edited after the promotion is also restored (the user's rule), except that an entry now in a transfer group keeps its transfer entry type and direction |
| deleted by the user | nothing to restore; the rollback succeeds |
| certified by a later PDF statement | CSV rollback stays allowed (the existing rule). The entry keeps the statement's facts and stays certified; its import links and `statement_certified_previous_*` are replaced by the manual snapshot, and the statement certificate's `certified_ledger_rows_json` entry is rewritten the same way, so rolling the statement back afterwards returns the original manual entry |
| superseded (deleted) by a later PDF statement | not in the ledger, so nothing is restored now; that statement's `superseded_ledger_rows_json` is rewritten to the manual entry, and the rows this import created are dropped from it, so rolling the statement back re-creates the manual entry only. Before, that statement rollback failed on a foreign key (it re-inserted rows pointing at the deleted import rows) |
| legacy import (no snapshot) | best effort: an entry whose `created_at` is before the import's `imported_at` can only have been promoted by it, so it is kept as a manual entry with its current (imported) bank facts; today's code deleted it. Import-created rows are always newer than the import and are still deleted |

The months of the entry's current and restored dates get refresh markers in the
same batch. Double rollback is still rejected with 409 before any read.

Tests: `tests/atomic-writes-import-promotion-rollback.test.mjs` (12, real
local D1). The first 8 were written first and run unchanged against the base
`d702fed` in a scratch checkout: 5 fail and 3 pass. The main scenario, the edited-entry, the
double-rollback and the statement-certified tests fail because the rollback
deleted the manual entry (`+ []` / `undefined`); the legacy test fails because
the column does not exist. The deleted-entry test and the two failure tests
(rollback failing at its last statement, commit failing at its `completed`
flip, each asserting the whole database dump unchanged) pass on the base,
as expected: they pin behaviour that must not regress. Added later: a staged
bulk import (261 rows) that promotes and rolls back, and the three review
tests below.

Independent review (pass 3), each finding reproduced by a scratch test and
fixed with a test that failed first (`0998e66`):

- Medium: an entry linked as a transfer after the promotion came back as an
  expense inside its transfer group with the Transfer category. It now keeps
  the transfer entry type and direction.
- Medium: a PDF statement that superseded the promoted entry (its balance
  left the CSV rows out) kept a snapshot pointing at the CSV's import rows.
  Rolling back the CSV, then the statement, failed with `FOREIGN KEY
  constraint failed` and the manual entry was lost. Both orders are now
  tested and return the manual entry.
- Test gaps: the legacy and bulk tests now assert the import's own rows are
  gone; replacing the legacy heuristic with `OR 1 = 1` fails 4 tests.

Gates (after merging `macro-performance` at `09311fa`, Node v22.23.3), the
steps of `npm run verify` run one by one: `npm audit` 0 vulnerabilities;
typecheck clean; unit 546/546; build; `check:bundle` 172,212 B JS gzip
(budget 180,337) and 32,022 B CSS (budget 31,961, inside the 5% allowance;
the branch changes no client code); smoke bundle on isolated ports (Vite
5410, Worker 8810, `--persist-to .wrangler/state-rollback`, temporary
Playwright config with `webServer: undefined` and a copy of the smoke runner
pointed at 5410) passed all 17 workflow runs, 130 tests.

Full `npm run test:e2e` on the same isolated ports: the final run passed
261/261 (11.1 min). Two earlier full runs on the same code each had 260
passed and 1 failed, both `financial-insight` "an editor open blocks the
request; closing it starts one request after a full quiet period": the
request came 613 ms and 640 ms after the test's close timestamp against its
650 ms floor. Those runs were slow (17.8 and 12.9 min, machine shared with
other sessions). Alone, that test passed 5/5; the whole spec file failed once
on a different wording-timing test and then passed 3/3; `macro-performance`
at `09311fa` in a scratch checkout (ports 5411/8811) passed the spec 2/2 and
the full suite 261/261 (11.3 min). The branch changes no client code, so this
is recorded as a timing-sensitive test under load, not investigated further.

Noted, not changed: a manual entry created in the same second as a legacy
import is not recognised as promoted (strict `<`) and is deleted as before;
a legacy promoted entry that a statement superseded and restored gets a new
`created_at` and is deleted as before. Neither loses more than the base.

Persisted-state harness (ports 8971-8977):

- unchanged scenario, base vs branch: one difference, the new
  `promoted_entry_snapshot_json: null` on the kept import's row.
- the harness now also creates a manual entry, promotes it with a CSV, edits
  its note and rolls the import back (`bf7af48`). Base vs branch with that
  scenario: the new column, the restored entry (original description and
  date, `post_date` NULL, `import_id` NULL, note kept, `Manual provisional` in
  the Entries DTOs), and every total that counts it 4,329 higher (the base
  deleted it). Two branch runs are byte-identical.

Runtime (real `wrangler dev` on 8810, Vite 5410, `--persist-to
.wrangler/state-rollback`): reseed; add manual entry "FAIRPRICE FINEST"
$43.21 on 2026-05-18 with a note; in the browser paste a CSV with
"FAIRPRICE FINEST SINGAPORE" -43.21 on 2026-05-19 and a new row; the preview
said one manual row would be promoted; commit; D1 showed the promoted row with
the snapshot on its import row; roll back from Recent imports (in-app confirm);
the Entries page shows "FAIRPRICE FINEST", 18 May 2026, -$43.21, the note, and
no new row; the API reports `Manual provisional`; D1 shows `import_id`,
`import_row_id` and `post_date` NULL. A second rollback returns 409.

## Linked split follows its entry's amount (2026-09-25)

Branch `split-share-follows-amount`, based on `macro-performance` at
`4c71e23`, Node v22.23.3.

Bug (reported by another session, reproduced here): in a person view, editing
the amount of a split-linked entry from 60.00 to 80.50 saved the ledger total
but left the split expense at 60.00 and Tim's share at 30.00. Two causes:

- Server: every loaded entry is `ownershipType: "direct"`, and
  `updateEntryRecord` only synced the linked split for `"shared"` saves (the
  upsert after its batch), so the split total and shares never moved. Month
  totals for person scopes also stayed on the old share.
- Client: the optimistic row kept the old `linkedSplitShares`, forced a 100%
  ratio, and the pending-row comparison set the viewer share (server) against
  the total (local), so the row stayed "Updating" with `-$80.50 (-$30.00)`
  until a reload. Splits kept its cached page.

Rule (documented in `DOMAIN.md`, split expense share): the split does not store
whether a share was entered as a percentage or an exact amount, so the shares
follow the new total by their stored `ratio_basis_points` with
`splitAmountMinorWithRoundedRemainder` (floor for the first person in
owner/partner order, remainder for the second). An exact-amount share becomes
the same proportion. An even split whose odd cent was assigned (a stored
4999/5001) stays 5000/5000. An edit that keeps the amount leaves the shares
alone, so an explicitly assigned odd cent survives a rename. A cross-currency
split keeps its own total and shares; only `home_amount_minor` and
`fx_rate_basis_points` move. An archived (deleted) split that still carries the
link is updated too, so a restore matches the ledger.

Write path: `buildLinkedSplitAmountStatements` (`app-repository-splits.ts`)
reads the linked split and its shares before the batch and returns `UPDATE`
statements that run in `updateEntryRecord`'s own `db.batch()`, before the
month refresh. The shared-ownership upsert after the batch is unchanged and
still sequential; the Entries UI no longer offers "Shared" as an owner.

Client: `normalizeEntryShape` rebalances a linked entry's `linkedSplitShares`
with the same domain function when the total changes, takes the viewer ratio
from those shares, and shows the ledger total in the amount field (it showed
the viewer's share after any other edit, and with the new total handling a
tab-through would have saved that share as the total).
`buildComparableEntryState` compares the ledger total for linked rows, and an
amount edit of a linked entry sets `invalidateSplits`, which clears the Splits
page cache through `onSplitMutation`.

Tests (each new one fails on the base code; checked by running them with
`src/` from `macro-performance`):

- `tests/atomic-writes-linked-split-amount.test.mjs` (7, real Miniflare D1):
  person-view edit at 25% (80.50 → 20.12 / 60.38, Entries row, Splits activity
  and balance, Tim's snapshot +5.12 and equal to a full recalculation), even
  split with default and assigned odd cent, exact-amount share, unchanged
  amount keeps an assigned odd cent (passes on base too), household edit,
  cross-currency, and a failure injected on `UPDATE split_expense_shares`
  leaving the whole database unchanged. 6 of 7 fail on base.
- `tests/split-allocation.test.mjs` (4) for the pure rule; disabling the even
  rule fails 2 tests here and in the D1 file.
- `tests/entry-workflow-contract.test.mjs` (+4, one existing test extended)
  and `tests/entry-refresh-plan.test.mjs` (+1): 6 fail on the base client
  (checked in a scratch worktree of `macro-performance` with the new tests
  copied in).
- `tests/e2e/entries-linked-split-amount.spec.js` (3): person-view edit with
  Splits cached first (row `$40.25`, 50%, APIs, balance +10.25, Summary +40.25
  against a pre-link baseline, in-app Splits shows `$80.50` / `$40.25`);
  household edit (row keeps `$70.01`, Joyce's view `$35.01`); a description
  edit keeps `60` in the amount field and a tab-through saves 6000. On base,
  the first fails with `-$80.50(-$30.00)Updating…100%`; with the amount-field
  guard removed, the third fails with `30`.

Persisted state (`scripts/persisted-state-snapshot.mjs`, one new scenario step:
the shared dinner edited from 90.01 to 80.51 with the direct payload the editor
sends): base vs this branch differ only in that split (`total_amount_minor`,
`home_amount_minor` 9001 → 8051; shares 4500/4501 at 4999/5001 → 4025/4026 at
5000/5000), Tim's share in the Entries, Month, Summary and Splits DTOs, and the
two 2026-05 `person-tim` `monthly_snapshots` rows (−475 each). Household totals
are unchanged. The unmodified script gives byte-identical output (`cmp`) on
base and branch.

Runtime: the e2e specs above ran in Chromium against a real `wrangler dev`
Worker (Vite 5411, Worker 8811, `--persist-to .wrangler/state-splitshare`). A
hand check in the browser pane did the same: 60.00 → 80.50 in Tim's view
showed `-$80.50 (-$40.25)`, 50%, daily net −$40.25, and in-app Splits showed
"You paid $80.50 · you lent $40.25".

Not changed, noted for follow-up:

- Closed 2026-09-26 (next section): adding an entry to splits did not refresh
  month snapshots.
- Closed 2026-09-26 (next section): entry date, description and payer edits
  were not copied to the linked split. Category keeps its own sync dialog.
- Settlement checkpoints: an amount edit of a linked expense that is already
  in a checkpoint changes that expense's shares without reopening the
  checkpoint. Closed 2026-09-26: see "Settlement lock" below. Since the two
  branches were merged, the date and payer copy below is predicted by the same
  lock (`assertLinkedSplitSettlementUnchanged` takes the mirror), so an entry
  edit that would move a settled split's date or payer is refused too.
- Closed 2026-09-26 (next section): Entries treated an archived (deleted)
  split as still linked.

## Linked split sync with its entry (2026-09-26)

Branch `linked-split-sync`, based on `macro-performance` at `c97dd63`, Node
v22.23.3. Closes three of the follow-ups above.

Verified first, on the base code:

- Add to splits wrote the split, then each share, then nothing else: no month
  refresh marker, and a failure between them left a split without shares (or a
  new Okaeri split batch with nothing in it). The stored `monthly_snapshots`
  for Tim kept the full amount. The Summary and Month pages were not wrong:
  they recompute actual spend from the entries on every read (and the stored
  person totals already differ from that page math for other reasons), so the
  stale value lived only in the stored totals. Matching a split to an imported
  entry had the same gap.
- An entry edit copied only the amount to its split (`buildLinkedSplitAmountStatements`).
- The link state comes from one place, `loadEntriesForDateRange`: its join and
  shares query read `split_expenses.linked_transaction_id` without
  `deleted_at`, so an archived split still linked the entry in Entries, Month,
  Summary and the month totals, and "Add to splits" then failed with "already
  linked". The reference is not dangling: `deleted_at` archives the split and
  `DOMAIN.md` says a restore brings the ledger link back, and the amount
  follow-up already updates archived links for that reason. So the link is
  kept and every reader ignores archived splits, instead of clearing it in the
  delete. The client had a second copy: `mergeEntriesById` spread the server
  row over the local one, so split fields the server stopped sending stayed on
  the row, and the open editor ignores refreshes until it closes.

Rules (in `DOMAIN.md`, split-linked ledger entry):

- the split mirrors the entry's event date, description and payer (owner,
  else account owner). An entry edit copies a change to each of them in the
  entry's own batch while the split still holds the entry's previous value;
  a value that already differs (edited in Splits, or recorded before a bank
  match, where the split description is the user's wording and the bank text
  is shown beside it) is kept. Archived links follow too, as for the amount.
- note, category, group, share basis and travel-currency conversion are
  split-owned and never touched by an entry edit.
- an archived split does not hold its entry: the entry can be added to or
  matched with a new split, and restoring the archived one is refused while
  another active split record or checkpoint match holds the row.

Write path: add to splits, match, delete and restore each read first and then
commit their rows, history event, any new split batch
(`resolveActiveSplitBatch` returns the insert instead of running it) and the
entry's event-month refresh marker in one `db.batch()`, then refresh.
`buildLinkedSplitMirrorStatements` runs inside `updateEntryRecord`'s batch
next to the amount statements. Client: `mergeEntriesById` drops the split
fields when the server row is unlinked; deleting a split from the editor
clears the link on the open entry and its snapshot (`clearEntrySplitLink`) and
clears the Month and Summary caches; a linked entry's date, description,
owner or account edit clears the Splits cache; restoring a split expense
clears the Entries, Month and Summary caches.

Tests (each run against the base code in a scratch copy of `macro-performance`
with the new test files):

- `tests/atomic-writes-linked-split-sync.test.mjs` (13, real Miniflare D1):
  12 fail on base, and the negative "income entry is rejected and changes
  nothing" passes on both. Base failures: Tim's total moved 0 instead of
  −3,000; a failed add left a `split_batches` and a `split_expenses` row; the
  split kept `2026-05-16` / the old description / `person-tim`; the copy
  failure test's statement never ran; Entries still returned the archived
  split id; re-adding returned 400; a failed delete left the split archived
  without history; a failed restore likewise; the match moved the owner's
  total 0 instead of −9,320; the match failure's marker statement never ran.
- `tests/entry-workflow-contract.test.mjs` (+2) and
  `tests/entry-refresh-plan.test.mjs` (+1): all 3 fail on base.
- `tests/e2e/entries-linked-split-sync.spec.js` (2, Chromium against a real
  `wrangler dev` Worker): both fail on base (after "Delete split" the editor
  still offered "View split"; Splits never showed the renamed split).

Persisted state (`scripts/persisted-state-snapshot.mjs`): new steps add three
entries to splits, edit the first one's date, description and owner, delete
the second's split and leave the third's add as the last write to May. The
normalizer now keys epoch ids with their prefix, drops the random tails of
split batch and history ids, and sorts lists tied on `importedAt` (the base
itself ordered three same-second imports differently from run to run of
different speed). With the old scenario, base and branch are byte-identical;
two branch runs of the new scenario are byte-identical. Base vs branch with
the new scenario differ only in: the first split's `expense_date`,
`description` and `payer_person_id`; the 2026-05 `person-tim` (+399) and
`person-joyce` (−399) `monthly_snapshots` (snack counted in full, +1,000 for
Tim; coffee at its 6.01 share, −6.01); the snack entry unlinked in the Entries
and Month DTOs (Tim's row 10.00 → 20.00, Summary and Month +1,000 for Tim);
the Splits balance and the first split's date, description, payer and
direction. Household totals are unchanged.

Independent review (pass 3), fixed in `3a98287`:

- Medium: a Shared owner save (`upsertLinkedSplitExpenseForEntryRecord`)
  looked up the linked split without `deleted_at`, so it rewrote an archived
  split's shares; after a re-add (newly possible here) the active split kept
  its old shares. It now updates the active split or links a new one. Test
  added; it fails on base, where the archived split was rewritten.
- Low: clearing the link in the open editor ran a full normalize, which
  gave an ownerless joint-account row the first person as owner. It now only
  drops the split fields.
- Low: the restore guard is now scoped to the household. Tests added for an
  archived split following entry edits (14 of the file's 15 tests fail on
  base).

Noted, not changed: the restore guard and the add-to-splits "already
linked" check are reads before the batch, so two concurrent writes can still
give one entry two active splits (closed 2026-09-26, "Split write
consistency" below); restoring from history clears the Entries,
Month and Summary caches only for the month the Splits page shows (as delete
already did); `linkSplitExpenseMatch` can link an archived split the UI never
offers; the Shared upsert still runs after the entry's batch without a month
marker (closed 2026-09-26, below); copying the payer or date to a split in a closed batch or checkpoint
changes its balance the same way the amount follow-up does (checkpoint
reopening is the `checkpoint-reopen` branch's work).

Runtime: besides the Chromium specs, a hand check in the browser pane
against `wrangler dev` (Vite 5413, Worker 8813, `--persist-to
.wrangler/state-splitsync`): in Tim's view, "Add to splits" on a new 60.00
entry, then renaming it and moving it to 24 May in Entries, showed the renamed
split on 24 May in Splits ("you lent $30.00") and moved the stored May totals
to Tim 440,167 / Joyce 125,499 with no pending markers; "Delete split" in the
open editor switched it to "Add to splits" at once, the row showed −$60.00
without the chip, D1 showed the split archived with its link kept, and the
stored totals moved to 443,167 / 122,499.

Gates (after merging `macro-performance` at `e9e014b`, Node v22.23.3), the
steps of `npm run verify` one by one: `npm audit --audit-level=high` 0
vulnerabilities; both typechecks clean; lint 0 errors (the same 30 warnings
as base); unit 600/600; build; `check:bundle` 173,339 B JS gzip (budget
180,337) and 32,878 B CSS (budget 31,961, inside the 5% allowance; no CSS
change); smoke on isolated ports (Vite 5413, Worker 8813, inspector 9413,
temporary Playwright config and smoke runner copy) passed all 17 workflow
runs, 133 tests. An earlier post-merge smoke run failed once in
`entries-transfer-dialog`: a `/api/demo/reseed` raced the first page's
`/api/app-shell` seeding and both returned 500 on a foreign key; the spec
passed 6/6 when repeated and in the next full smoke run. The same race was
logged, without failing, in the pre-merge smoke run.

Full `npm run test:e2e` (before the merge, on `d5f0a38`): 294 passed, 1
failed — `entries-linked-split-amount` "a household edit of a linked entry
keeps the total on the row": after Save the editor stayed open. Repeated 5
times it failed 3/5 on this branch and 2/5 on `macro-performance` at
`c97dd63` (same assertion), so it is a timing race in the base, not this
change: the `editing_entry` deep-link effect reopens the editor between
`setEditingEntryId(null)` and `clearEditingEntrySearchParam`. Left for a
separate fix.

## Settlement lock and split record commands (2026-09-26)

Branch `checkpoint-reopen`. A split record in an active settlement checkpoint
keeps its settled facts (rule in `DOMAIN.md`, details in
`docs/audits/split-settlement-checkpoint-audit.md`). The check runs before
the first write, so a refused command writes nothing: for an entry save it
runs before the entry batch and before the shared-save upsert that follows
it.

Converted to one `db.batch()` because their checks changed:
`updateSplitExpenseRecord` (new batch if the group changes, expense row,
shares), `deleteSplitExpenseRecord` and `deleteSplitSettlementRecord`
(archive and history event), `updateSplitSettlementRecord` (new batch,
settle-up row, batch close). `app-repository-split-batches.ts` gained
`planActiveSplitBatch` and `buildCloseSplitBatchStatement`, which return
statements; the create paths still use the running wrappers.

Proof: `tests/atomic-writes-split-checkpoint-lock.test.mjs` injects a failure
on `INSERT INTO split_expense_shares`, `INSERT INTO split_activity_history`
and `UPDATE split_batches` and asserts an unchanged dump; all three failed on
the sequential code.

## Group settle-up lock and Undo settle-up (2026-09-26)

Branch `split-locks`. The settlement lock now also holds the records of a
closed group batch (rule in `DOMAIN.md`, Split Batch; details in
`docs/audits/split-settlement-checkpoint-audit.md`). It is the same check,
run before the first write, so a refused command writes nothing.

New command `reopenSplitBatchRecord` (`app-repository-splits.ts`, Undo
settle-up) reads first, then commits in one `db.batch()`: either the batch
reopen (`buildReopenSplitBatchStatement`) or, when the group already has an
open batch, the moves of the closed batch's expenses and settle-ups into it,
plus a history event per settle-up. No month refresh: batches do not feed
month totals. Proof: `tests/atomic-writes-split-group-settlement-lock.test.mjs`
fails `INSERT INTO split_activity_history` and `UPDATE split_settlements SET
split_batch_id` and asserts an unchanged dump.

`upsertLinkedSplitExpenseForEntryRecord` now keeps the split's batch when
its group is unchanged and plans its shares before its first write
(`planSharedSaveShares`). Since the merge with `split-write-consistency` it
is `buildLinkedSplitUpsertStatements`, in the entry's batch (next section),
with both rules kept.

## Split write consistency (2026-09-26)

Branch `split-write-consistency`, based on `macro-performance` at `f682ad6`,
Node v22.23.3. Closes three items left open above.

Verified first, on the base code (each by a new test run unchanged against it):

- The add-to-splits "already linked" check, the match check and the restore
  guard are reads before the batch. With both requests held until each has
  passed its checks (`raceAtBatch` in the test holds matching `db.batch()`
  calls until two are waiting; D1 still runs them one at a time), two
  simultaneous Add to splits returned 200 and 200 and left two active splits
  on the entry; two matches to one imported expense and two restores of two
  archived splits of one entry likewise both succeeded.
- Rolling back a CSV import that promoted a manual entry restores the
  pre-promotion amount even when the user corrected the amount afterwards
  (the existing rule), but the linked split kept the corrected amount (50.00
  on an entry back at 43.21). Commit-time promotion and certification never
  change an amount (matching requires equal amounts), and a certified entry's
  amount is locked, so the promoted-entry restore is the only rollback path
  that moves a linked entry's amount; the statement restore and the
  superseded-row restore were checked and left alone.
- A Splits-editor share edit of a linked split wrote no month refresh marker:
  Tim's stored May total stayed 1,800 below a full recalculation after a
  50 → 80% edit. The Shared owner save (`upsertLinkedSplitExpenseForEntryRecord`,
  entry update and create) refreshed the month in the entry's batch and only
  then rewrote the split with sequential `.run()` calls, so the stored totals
  were stale by the share change, a failure left the entry saved without its
  split, and a joint-account save with no payer saved the entry and then
  returned 400. The pages were not wrong (they recompute actuals from the
  entries); the stale value lived in `monthly_snapshots`.

Changes:

- One active split record per ledger row is held by the database: partial
  unique indexes `idx_split_expenses_active_linked_transaction` and
  `idx_split_settlements_active_linked_transaction` on
  `(linked_transaction_id) WHERE linked_transaction_id IS NOT NULL AND
  deleted_at IS NULL`, in `schema.sql` and added by the runtime schema
  (`ensureActiveSplitLinkIndexes`). A database that already holds a duplicate
  cannot take the index; the runtime schema then skips it with a
  `console.warn` naming the ledger row instead of failing every request, and
  the pre-batch checks still refuse a new duplicate there. D1 checks the index
  per statement inside the batch, so the later of two racing batches fails as
  a whole. `runLinkingBatch` maps that failure (or any batch failure after
  which another split holds the row) to the command's usual message: "This
  entry is already linked to a split expense.", "This ledger row is already
  linked to another split record." or "Its entry is now linked to another
  split. Delete that split first to restore this one." (400, as before). The
  settle-up match now commits through the same helper. A conditional
  `INSERT ... WHERE NOT EXISTS` was rejected: a zero-row insert would still
  commit the rest of the batch (history event, markers, shares) and only
  other statements' side effects could reveal it.
- Import rollback: `buildPromotedEntryRestore` returns the expense entries
  whose restored amount differs, and the rollback appends
  `buildLinkedSplitAmountStatements` for each to its one batch (same rule as
  an entry amount edit: stored basis, floor for the first share person,
  cross-currency splits only move home amount and FX rate, archived links
  follow too). Settlement lock: before the batch the rollback runs
  `assertLinkedSplitSettlementUnchanged` (new subject "import rollback"), so
  a split in an active checkpoint refuses the whole rollback with
  `split_settlement_locked` (409, route mapped) and the message "Rolling back
  this import would change the amount and shares of a split expense in the
  simplified settlement of ... Undo the simplification first, ...". Blocking
  was chosen over silently unlinking because it is the existing lock rule and
  is recoverable (Undo simplification, then roll back); a rollback that keeps
  the linked entry's amount is never blocked, and removing an import-created
  linked entry still only clears the link.
- `updateSplitExpenseRecord` puts the linked entry's event-month marker in
  its batch and refreshes after it (no marker for an unlinked split).
- The Shared owner save is now `buildLinkedSplitUpsertStatements`: reads and
  checks (payer, group currency, active split, new batch plan) run before the
  entry's batch, and the split row, share delete and inserts go in the same
  batch as the entry, before its markers, for both update and create. A lost
  race there reports "This entry was just linked to a split expense by
  another change. Refresh and save again."
- Client: after a rollback the Imports refresh also removes every cached
  Splits page (`invalidateImportMutationQueries({ invalidateSplits })`). The
  browser check showed in-app Splits still at $35.00 after the rollback
  restored $32.10 (a pre-existing gap: a rollback that unlinks a split had the
  same staleness). Marking the family stale was not enough: route pages are
  served from any cached copy, so it is removed.

Tests (real Miniflare D1), `tests/atomic-writes-split-write-consistency.test.mjs`
(19). Run unchanged against the base: 16 fail and 3 pass. The failures are
the stated ones: the four race tests got `[200, 200]`; the index test got no
UNIQUE failure (it stopped on a wrong household id in the test, fixed before
the fix run); the runtime-schema and legacy-duplicate tests found no index;
the rollback test had shares 2500/2500 instead of 2160/2161; the lock test got
200 instead of 409; the rollback, Splits-edit and Shared-save failure tests
never reached their injected statement or left the entry saved; the Splits
share-edit and Shared save/create tests found stored totals 1,800 (or 3,000)
off a full recalculation; the joint-account test found the entry saved. The 3
that pass on both pin guarded paths: a rollback that keeps the amount leaves
an assigned odd cent alone, a settled split whose entry keeps its amount does
not block the rollback, and an unlinked split's share edit writes no marker.
Negative tests besides those: archived and unlinked duplicates are allowed by
the index, a database holding a legacy duplicate still loads and still refuses
a third link. Deliberate breaks (mapping disabled, rollback statements
dropped, share-edit marker dropped) fail 9 of the 19.
`tests/query-foundation.test.mjs` (+1, fails on base) for the Splits cache
removal. `tests/e2e/imports-rollback-linked-split.spec.js` (2, Chromium,
real Worker): Splits loaded before the rollback shows $32.10 / $16.05 after
it without a reload (fails with the client flag off: "You paid $35.00"), and
the locked rollback shows the refusal in the confirm popover with the import
still completed. Unit suite 717/717.

Persisted state (`scripts/persisted-state-snapshot.mjs`, isolated ports
8991-8997): the unmodified script gives identical output on base and branch
(0 differences, even for the scenario's Shared create, because later May
writes refresh May). Two new June steps (commit `8a6b4cb`): a manual entry
added to splits, promoted, corrected to 35.00 and rolled back; then a Splits
share edit (70%) of another linked entry as the last write to June. Two
branch runs are byte-identical. Base vs branch with the new scenario differ
only as intended (26 paths): the rolled-back split's total and home amount
3500 → 3210 and shares 1750 → 1605, the same split in the two Splits DTOs
that list it (amounts, donut value, Non-group balance 6.51 → 5.06), and the
June `person-tim` / `person-joyce` `monthly_snapshots` 4,250 → 5,105 and
4,250 → 3,105 (32.10 at half plus the 70/30 share, as a recalculation gives;
the base kept the corrected split and the pre-edit 50/50). Household totals
are unchanged.

Runtime (pass 2), real `wrangler dev` on 8860 with Vite on 5260 and
`--persist-to .wrangler/state-splitconsistency`, in the browser pane, Tim's
view: a promoted linked entry corrected to $35.00 showed "You paid $35.00 ·
you lent $17.50" in Splits; rolling the import back from Recent imports
(in-app confirm) and returning to Splits showed $24.80 / $12.40 for the third
such entry (the first two runs exposed the cache gap above), Entries showed
-$24.80 (-$12.40) and the earlier ones -$32.10 (-$16.05); with a simplified
settlement holding the split, the confirm popover showed the refusal and the
import stayed Completed. A Splits share edit 50 → 80% on a linked $60.00
entry saved "you lent $12.00", Entries showed -$60.00 (-$48.00) 80%, and D1
moved the stored May totals Tim 446,137 → 447,937 and Joyce 131,469 →
129,669 with no pending markers. Two simultaneous `curl` Add to splits of one
entry against that Worker returned 200 and 400 "already linked" and Splits
listed the entry once (without the test's barrier the loser may have been
turned away by the check rather than the index).

Noted, not changed (all four closed 2026-09-26, "Split integrity
follow-ups" below): two matches of the same split to two different ledger
rows can both pass; the second `UPDATE ... WHERE linked_transaction_id IS
NULL` changes no row but its batch still commits its month marker and the
route returns ok. Two restores of the same record both record a "restored"
history event. Add-to-splits and Shared save ids are `split-expense-<ms>`,
so two new splits created in the same millisecond collide on the primary key
(the losing request fails; for one entry it is reported as already linked).
A rollback of a statement whose superseded row is re-created re-links its
split without checking the split's amount.

Gates (after merging `macro-performance` at `f3ecd74`, which brought in
`split-locks`; Node v22.23.3), the steps of `npm run verify` one by one:
`npm audit` 0 vulnerabilities; both typechecks clean; lint 0 errors (the same
30 warnings); unit 734/734; build; `check:bundle` 173,418 B JS gzip (budget
180,337) and 33,435 B CSS (budget 31,961, inside the 5% allowance; the branch
changes no CSS); smoke `E2E_PORT_OFFSET=60 npm run test:e2e:smoke` 88/88.
The persisted-state comparison was repeated against `f3ecd74` with the same
result (old scenario identical, new scenario the same 26 intended paths).
Merging kept both branches' rules in the Shared save builder (a split that
stays in its group keeps its batch; `planSharedSaveShares` keeps stored
shares on an unchanged save) and in the restore (a record restored from a
settled batch moves to the open batch) and the rollback lock names a closed
group batch too ("Undo the settle-up").

Full browser suite, `E2E_PORT_OFFSET=60 npm run test:e2e:sharded` (3
shards), on a machine shared with other suites (load average 25-450): two
runs, 268/270 and 269/270. The failures were timing assertions in code this
branch does not touch: `financial-insight` "an editor open blocks the
request" (649 ms against its 650 ms floor), and `route-warmup-data` desktop
"at most two requests per visit" and mobile "on 4g ... warms once". Rerun
alone, both spec files passed 22/22, and `route-warmup-data` passed 22/22
again with `--repeat-each 2`. A pre-merge full run had 264/266 with
`financial-insight` and `app-dates` (the page came up on another seed; the
spec passed alone); the pre-merge smoke once failed
`import-ledger-flow` "post-import cleanup ... Later", which then passed 3/3
repeated and in the next two smoke runs.

## Split integrity follow-ups (2026-09-26)

Branch `split-integrity-followups`, based on `macro-performance` at
`89d03ff`, Node v22.23.3. Closes the four items noted above and the travel
split Shared save.

Verified first, each by a test in
`tests/atomic-writes-split-integrity-followups.test.mjs` (19, real Miniflare
D1) run unchanged against the base (commit `4f6b1c5`, tests only): 14 fail and
5 pass.

1. Travel split, Shared owner save. Real. A JPY 10,000 split matched to an
   SGD 90.00 card row: while settled, an unchanged Shared save got 409 (the
   lock predicted amount, currency and shares changing); after Undo
   simplification the save wrote `currency = 'SGD'`, `total_amount_minor =
   9300`; in its JPY group the save was refused with "This group uses JPY".
   Fix: `sharedSaveSplitAmount` (`app-repository-splits.ts`) keeps a travel
   split's currency and total and moves only `home_amount_minor` and
   `fx_rate_basis_points`; shares are planned in the split's currency; the
   group check uses the split's currency; the lock's shared-save prediction
   uses the same function, so an unchanged save of a settled travel split is
   allowed and a basis change is still refused (message names only
   "shares").
2. Shared save split write inside the entry's batch. Already done by
   `split-write-consistency`: `updateEntryRecord` and `createEntryRecord` push
   `buildLinkedSplitUpsertStatements(...).statements` into their one batch,
   and that builder runs no `.run()`. No change.
3. One split matched to two entries at once. Real: `[200, 200]`, the loser's
   batch committed its month marker. Settle-up matches had the same gap.
4. Two restores (and two deletes) of one record. Real: `[200, 200]` and two
   `restored` (or `deleted`) history rows.
   Fix for 3 and 4: `buildBatchGuard` puts a first statement in the batch that
   fails the whole batch when the record's checked state changed (already
   linked, already active, already archived). SQLite raises errors only in
   triggers, so the guard runs `json('{' || id)` over the rows that break the
   precondition; the command then re-reads the state and gives the check's
   own message ("This split expense is unavailable or already linked.",
   "This settle-up is unavailable or already linked.", "This split is
   already active.", "This split is already in activity history."). A
   conditional `UPDATE` alone was rejected: the rest of the batch would still
   commit. Races of two records for one row stay with the unique index.
5. Same-millisecond ids. Real: with the clock stopped, the second Add to
   splits, split create, settle-up create, group create, Shared create and
   simplification each failed with `UNIQUE constraint failed: <table>.id`.
   Fix: `newSplitRecordId` gives `<kind>-<ms>-<uuid>` for split groups,
   batches, expenses, settle-ups, checkpoints and history events; the time
   prefix keeps same-date Splits activity sorted newest first by id (as
   `splits-projection.ts` does), matching `txn-<uuid>` for the random part.
   Old `<kind>-<ms>` ids and seeded names still edit, delete and restore
   (test passes on both).
6. Statement rollback re-link. Real: a split edited to 50.00 while its entry
   was superseded came back linked to the re-created 43.21 entry at 50.00; a
   settled one was not refused; a split matched to another row meanwhile was
   taken from it. Decision (DOMAIN.md: a linked split follows its entry's
   amount, the settlement lock holds): `buildSplitRelinkStatements`, in the
   rollback's batch, re-links only splits that are unlinked (or linked to a
   row this rollback removes), moves an expense split whose amount differs
   by the entry-edit rule (2160/2161), and runs
   `assertLinkedSplitSettlementUnchanged` (subject "import rollback") first,
   so a settled split refuses the whole rollback with 409. A split already on
   the entry's amount keeps its shares (assigned odd cent kept).

Negative tests (pass on base and branch unless noted): a sequential second
match and a second restore are refused with the database dump unchanged; a
restore failing on its history insert is not reported as "already active"
and changes nothing; a basis change of a settled travel split is refused
with the dump unchanged (on base it was refused too, naming amount and
currency); a re-link that keeps the amount leaves the shares alone; a
rollback failing on `UPDATE split_expense_shares` leaves the dump unchanged
(on base it never reached that statement).

Persisted state (`scripts/persisted-state-snapshot.mjs`, ports 8831-8843):
the old scenario gives byte-identical output on base and branch (the
normalizer now drops the UUID tail of new split ids). New July steps (a
travel split's Shared save at 93.00; a card row added to splits, superseded,
its split corrected to 50.00, the statement rolled back); the normalizer also
keys hashed import ids, since the scenario's new account has a random id.
Two branch runs are byte-identical. Base vs branch: 82 paths, all intended:
the travel split JPY 10,000 with shares 5,000/5,000 (base SGD 9,300 and
4,650/4,650), the re-linked split 4,321 with home 4,321 and shares
2,160/2,161 (base 5,000, home NULL, 2,500/2,500), those two splits in the
Splits and Entries DTOs and balances, and the July `person-tim`
`monthly_snapshots` 8,149 → 8,159. (A first base run differed in label
numbering only, because a random category id suffix was all digits; a
rerun compared cleanly.)

That last figure exposed a pre-existing gap, not changed here: person views
(Entries, Month, stored month totals) count a travel split's share amounts,
which are in the split's currency, as home-currency amounts (Tim's share of
the SGD 93.00 row shows 50.00, from JPY 5,000). It already happens for any
matched travel split saved directly; `app-repository-entries.ts` and
`month-projection.ts` are untouched by this branch.

Runtime (pass 2), real `wrangler dev` on 8826 with Vite on 5426 and
`--persist-to .wrangler/state-integrity`, browser pane, Tim's view: a card
row's split corrected to $50.00 while superseded; rolling the statement back
from Recent imports (in-app confirm) showed "You paid $43.21 · you lent
$21.61 · Linked" in Splits and `-$43.21 (-$21.60)` On splits 50% in Entries;
with a simplified settlement holding the split, the confirm popover showed
"Rolling back this import would change the amount and shares of a split
expense in the simplified settlement of 2026-05-26 ..." and the import stayed
Completed. A settled JPY travel split: an unchanged Shared save from the
page returned 200 and Splits still showed JP¥100 / JP¥50, "Included in
simplified settlement"; a 70% save returned 409 naming shares. Two
simultaneous restores and two simultaneous matches sent from the page
returned 200 + 400 with the messages above; Activity history listed one
restore and Entries showed only one of the two rows On splits. Without the
test's barrier these runtime pairs may have been refused by the check
rather than the guard. New ids appeared as `split-expense-<ms>-<uuid>`.

Gates (see the final section of the branch report for the post-merge rerun):
`npm audit` 0 vulnerabilities; both typechecks clean; lint 0 errors (30
warnings, as base); unit 753/753; build; `check:bundle` 173,411 B JS gzip
(budget 180,337) and 33,435 B CSS (budget 31,961, inside the 5% allowance; no
client change); `E2E_PORT_OFFSET=120 npm run test:e2e:smoke` 88/88.
`E2E_PORT_OFFSET=120 npm run test:e2e:sharded` (3 shards, load average
30-50): 271/273. The two failures were 120 s click timeouts in one shard:
`app-shell` "summary month round trip" passed when rerun; `app-dates` "new
split expenses and settlements default to the Singapore day" failed again
alone (the Splits page came up in the Household view, which has no "+ Add
expense") and fails the same way with `src/` from `89d03ff` (the base), so
it is not this branch; left for a separate fix.

## Open items

- A travel split's shares are counted as home-currency amounts in person
  views and stored person month totals (section above).

- Closed 2026-09-25 (section above): rolling back a CSV import deleted a
  manual entry that the import had promoted.
- Not yet converted (still sequential writes): the rest of the split
  workspace (`app-repository-splits.ts`: split create, note and category
  edits, settlements other than edit and delete, checkpoints) (add to
  splits, match, delete, restore, split expense and settle-up edit and
  delete, the entry-edit follow-ups and the Shared owner save are converted,
  and a linked split's share edit refreshes its entry's month, sections
  above);
  category
  match rule suggestions recorded
  after an entry edit; settings, categories, statement checkpoint edits,
  reconciliation exceptions, Shortcut requests (parked on purpose) and the demo
  seed.
- Two concurrent rollbacks of the same import can both pass the status check;
  the second batch is idempotent apart from a second audit event. Not guarded.
- Staged imports (over about 245 rows) are visible as a hidden draft between
  their chunks and final batch to reads that do not filter by import status.
- The single-batch size Cloudflare accepts in production is inferred from
  documentation, not measured on a deployed Worker.
