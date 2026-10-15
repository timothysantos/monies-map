# Wrong-card Apple Pay duplicate audit

Status: complete for activity files (CSV/XLS). Statement PDFs and the Settings
statement comparison are deliberately not covered (see "Not covered").

## The case

Three Apple Pay entries dated 11 Oct 2026 sat on UOB Lady's Card (Cold Storage
1.80, CS Fresh 9.70, FairPrice finest 7.84) for purchases paid with UOB One
Card. One Card's activity export (14 Oct) holds the same three bank rows
(`COLD STORAGE-STAR VISTA SINGAPORE SG` twice, `FAIRPRICE FINEST-STAR VISTA
SINGAPORE SG`); the Lady's Card mid-cycle export (13 Jul to 13 Oct) covers
11 Oct and does not list them. Lady's Card was overstated by 19.34.

Why nothing caught it: the "no longer listed" check removes only entries an
earlier export created; a Shortcut entry counts as the user's own. The
wrong-card diagnosis reads statements only. Production data was not touched;
the data fix for this case is the owner's call.

The sanitized reproduction is `tests/fixtures/uob-card-activity/wrong-card-oct-2026-sanitized.json`
(parser-shaped rows, invented references, nothing from a real card beyond the
shop names and the three amounts above).

## What the feature does

On an activity file, the preview may carry `wrongCardDuplicates`. The Imports
review shows, per pair of cards, a card in the statement-fix family: the
entries with the other card's bank row as proof, "Remove from <card>" (primary,
opens an in-app dialog) and "Keep as is". Confirm only marks the entries (the
commit bar says "3 entries will be removed"; Undo on the card takes it back).
The commit judges every confirmed entry again, removes it in the import's one
batch, and the import's rollback restores it exactly. A near miss is an "Also
check" note with no button. Nothing is automatic; there is no "do this for me
next time" checkbox for this feature (see "Decisions").

Screenshots: `docs/audits/wrong-card-apple-pay/` (`desktop-review-before.png`
shows the same review when the entries carry no Apple Pay marker, which is
what master shows for the real case; `desktop-review-after.png`,
`phone-review-after.png`, `*-card.png`, `desktop-dialog.png`,
`desktop-confirmed.png`).

## Confidence rules as implemented

`src/domain/wrong-card-apple-pay-duplicate.ts` (pure, no AI, no database).

Candidate: an expense saved by the Shortcut (`external_reference` starts
`shortcut:`), provisional, `import_id` null (never matched to a bank row), no
transfer group.

Twin: a row on another card, with the same amount and currency, an expense, not
a transfer, not an estimate, and standing alone as a bank row (an export or
statement row that is not a promoted manual entry, not an Apple Pay or Ask
entry, not certified over a manual entry); its purchase day or posted day within
3 days of the entry; at least one shared shop word after normalising (a word
counts when equal or one is the other cut short, 4 letters minimum; noise words
and long digit runs dropped; `CS` reads as Cold Storage as everywhere else in
matching). The twin is a ledger row or a new row of the file being imported, so
the flag appears when the second of the two files lands, in either order.

| Tier | When |
| --- | --- |
| HIGH (removal offered) | every gate: file covers the day; day at least the posting lag old; no same-amount row within 3 days on the entry's own card (ledger or file); exactly one twin; no other open Apple Pay entry that could claim the twin; dates at most 2 days apart; strong shop match (2 shop words with strength 0.6 or more, or the only word of 5+ letters); no split, settlement, checkpoint, transfer or plan link; not an estimate; owners compatible (same person, or either card shared) |
| MEDIUM (note, no button) | the premise holds and exactly one twin exists, but a soft rule fails: dates 3 days apart, partial shop name, links, estimate, different person's card |
| LOW (never shown) | the file lists the entry, does not cover its day, the entry is within the posting lag, a same-amount row sits on its own card, several twins (a daily repeat), a contested twin, or no twin |

Score 0 to 100 (date 30/26/22/8 for 0/1/2/3 days, shop strength up to 40, 15
for a one-to-one twin, 15 for the card-side evidence); HIGH never scores under
75; the tier decides. Reasons and blockers are code lists, asserted in tests
and written into the audit event.

Posting lag: 3 days; a card's own history (its Apple Pay entries a bank row
later updated, newest 20) can lengthen it, never past 7. Coverage: for the file
being imported its first to last row per card, referenced to today; for an
earlier import, the first to last day of the rows it saved, referenced to the
day it was imported (read only near the entries, so a window can only come out
narrower than the real one).

## False-positive analysis

Every way a wrong removal could be offered, and the guard:

| Risk | Guard (test) |
| --- | --- |
| The entry is a legitimate pending purchase the file lists | `listed_in_file`; the file's paired row removes it from candidates (API test "legitimately pending", e2e) |
| Both cards genuinely bought the same thing | same-amount row on the entry's own card blocks it; the file lists its own entry (unit, "genuine same-amount purchases") |
| Daily repeat (same coffee every day on the other card) | several twins means no offer, even when one is the same day (unit) |
| Two Apple Pay entries, one twin | the twin is contested, neither is offered (unit) |
| The twin already belongs to its own Apple Pay entry (promoted, or open on its card) | not a loose bank row / contested (unit) |
| Same amount, unrelated shop | no shared shop word, no twin (unit) |
| Date 4 days apart | no twin; 3 days a note only (unit) |
| Foreign currency estimates | never HIGH; different amounts mean no twin; estimate-updated rows are not twins (unit) |
| Entry newer than the bank's usual lag, or file ends before it | within lag / not covered (unit, API) |
| Entry linked to a split or plan | note only, and the commit refuses it (API, e2e) |
| Statement-certified entry | not a candidate (API) |
| Entry not saved by the Shortcut, or saved without its request id | not a candidate (API, e2e) |
| Someone else's card | different owner is a note (unit) |
| The ledger changed between preview and commit | the commit re-runs the same evidence; short of HIGH, a different twin, an entry the same commit pairs with a row, or a repeated entry stops the whole commit with a plain message and writes nothing (API) |
| A concurrent change inside the commit's own window | every one of the three per-entry statements is guarded by the entry still being the checked provisional Apple Pay entry (atomic test "every removal statement is guarded") |

A tampered or buggy client cannot remove anything the server would not offer:
the commit never trusts the card, only the same evidence recomputed from the
ledger and `reviewedRows`.

Residual risk: a Shortcut entry whose purchase really was on its own card but
whose bank row was withheld from the export, while another card shows an
unrelated purchase with the same amount, a shared shop word, within 2 days, no
other claimant and no same-amount row on the entry's own card. That needs a
coincidence on every gate and still takes a person's confirmation; rollback
restores the entry exactly.

## Writes and rollback

Removal runs inside the import commit's single `db.batch()`: per entry a guarded
INSERT of the whole `transactions` row into `import_wrong_card_duplicates`, a
guarded audit event (`entry_removed_as_wrong_card_duplicate`), a guarded
`DELETE`; plus month refresh markers (the existing mechanism) and the import's
own audit event. The rollback re-inserts each saved row (same id, dates, note,
category, owner, reference, timestamps), writes `entry_restored_by_import_rollback`,
and clears the saved copies, all in the rollback's batch. Rolling back the import
whose bank row was the twin is refused while the removal stands ("Roll back the
later import first"). The import id includes the confirmed entry ids, so the same
rows with and without a removal are different imports.

Tests: `tests/atomic-writes-wrong-card-duplicates.test.mjs` (a `failingStatement`
at the saved copy, the audit event, the delete, the completed mark, and at the
rollback's status flip and restore each leaves the database identical).

## Reads and measured budgets

No existing read changed. The wrong-card check adds, measured on the real-case
scenario through `countingDatabase`:

| Situation | Statements | Rows returned | Notes |
| --- | --- | --- | --- |
| No Apple Pay entry in the file's dates | 1 | 0 | `idx_transactions_household_date` range |
| The real case (3 entries) | 4 | 3 + 6 + 0 + 0 | entries 806 bytes, same-amount entries 3,174 bytes; 38 statements in the whole preview |
| Commit with confirmed removals | the same 4 + the accounts + 1 read of the entries' whole rows | | none without a confirmation |

The reads are the Apple Pay entries (limit 61, processed 60), same-amount
entries around them (filtered by the entries' own amounts, at most 60 amounts),
each card's earlier export dates (rows within 120 days before and 60 after) and
its Apple Pay posting history (365 days, 100 rows). The test adds 3,600 noise
rows and still reads 3 and 6 rows. `EXPLAIN QUERY PLAN` shows
`idx_transactions_household_date` and `idx_transactions_account_date` searches,
no scans (`tests/wrong-card-duplicates-query-budget.test.mjs`). The matching works on those rows,
not on the ledger the preview already loads. Preview payload: the cards add
1,584 bytes for the three entries and nothing when there are none, so
`tests/e2e/api-payload-budget.json` is untouched. No budget was raised.

## Decisions

- Activity files only. A statement is reviewed against its balance
  (`wrong_account`, `not_on_statement`, superseded rows); the Settings statement
  comparison already removes a provisional second copy that a statement matched to
  another entry (`remove_duplicate_entry`). Sharing the rules there needs the
  statement's own proof and is left alone.
- No standing "do this for me next time" choice. It would remove entries with no
  one looking, which the rules above are designed never to do; false positives cost
  more than misses. If wanted later it needs its own review.
- The coverage window of an earlier import is read from its saved rows, and an
  export that only lists a later part of the card leaves the earlier days unflagged.
- An entry saved by an older Shortcut without a request id has no Apple Pay marker
  and is never offered.
- Shortcut retries: if the Shortcut resends a removed entry's request id, a new entry
  is created (the reference is free again); the next import would flag it again.

## Not covered

Statement PDF imports, the Settings statement comparison, entries older than a file's
window, more than 60 Apple Pay entries in one file's dates, and entries on shared
household accounts that the Shortcut saved without an owner (treated as compatible
with any card).

## Evidence

- `tests/wrong-card-apple-pay-duplicate.test.mjs` (25 rules and adversarial cases)
- `tests/wrong-card-apple-pay-duplicate-api.test.mjs` (13 preview, commit, rollback cases)
- `tests/atomic-writes-wrong-card-duplicates.test.mjs` (8)
- `tests/wrong-card-duplicates-query-budget.test.mjs` (5)
- `tests/e2e/wrong-card-apple-pay-duplicate.spec.js` (9, desktop and 390 px)
- The API, atomic and rules tests were run against `origin/master`'s source: 21 of 23
  fail there (the two that pass are the negatives that nothing is offered), and the
  rules and budget files fail to load.
