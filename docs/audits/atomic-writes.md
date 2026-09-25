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
  checkpoint (the checkpoint audit lists "edit included row after match" as
  not implemented; Splits editor edits behave the same). Owned by the
  `checkpoint-reopen` branch; the date, description and payer copy below has
  the same gap.
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
give one entry two active splits; restoring from history clears the Entries,
Month and Summary caches only for the month the Splits page shows (as delete
already did); `linkSplitExpenseMatch` can link an archived split the UI never
offers; the Shared upsert still runs after the entry's batch without a month
marker; copying the payer or date to a split in a closed batch or checkpoint
changes its balance the same way the amount follow-up does (checkpoint
reopening is the `checkpoint-reopen` branch's work).

## Open items

- Closed 2026-09-25 (section above): rolling back a CSV import deleted a
  manual entry that the import had promoted.
- Not yet converted (still sequential writes): the rest of the split
  workspace (`app-repository-splits.ts`: split create and edit, note and
  category edits, settlements, checkpoints), including the linked split
  expense a shared-ownership entry save upserts after its own batch (add to
  splits, match, delete, restore and the entry-edit follow-ups are converted,
  sections above). A Splits-editor share edit of a linked split still leaves
  the stored person month totals stale until the month is next refreshed;
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
