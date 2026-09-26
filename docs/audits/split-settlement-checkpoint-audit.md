# Split Settlement Checkpoint Audit

Date: 2026-08-30

## Scope

- Splitwise-style netting across split groups.
- External ledger matching for the resulting net payment.
- Undo/reopen behavior and checkpoint immutability.
- Paid confirmation separate from later bank-transfer evidence.
- Backdated entries added after a settlement.
- Chronological activity presentation and settled/open distinction.

## Verdict

The app now implements a person-level simplification checkpoint alongside the
existing ordinary per-group split settlements and archival `split_batches`.
The checkpoint stores a net amount, included-record manifest, lifecycle state,
paid-confirmation timestamp, multiple transfer matches, and explicit reopen
operation.

## Implemented Findings

1. A checkpoint calculates one person-level net obligation across all currently
   open groups.
2. Matching accepts multiple transfer rows, rejects reuse of a transfer,
   accumulates exact and partial matches, and surfaces cumulative overpayment
   for review.
3. Reopen changes checkpoint lifecycle state while retaining the checkpoint
   record and releasing its rows back into the open balance.
4. Checkpoint membership is record-based. A corrected or late-imported row with
   an older activity date stays outside the checkpoint.
5. `Mark paid` stores a separate confirmation timestamp and moves the
   checkpoint into a collapsed `Settled, awaiting bank match` queue. It does
   not create a transfer, change reconciliation status, or certify evidence.
6. A paid checkpoint does not block the next checkpoint for later split
   activity. `Undo paid` restores its active workspace position without
   releasing the included records.

## Settlement Contract

### Checkpoint creation

Create a draft net settlement from all selected group balances for the same two
people. The draft must show contributing groups, the signed group balances,
the resulting direction and amount, and whether an external ledger match is
required. Zero net is an internal offset and must not require a fake bank row.

On confirmation, persist an immutable inclusion manifest containing at least:

- checkpoint id and household scope
- the two people and signed net amount
- included group ids and split record ids
- creation timestamp and effective settlement date
- status: `draft`, `open`, `matched`, `partially_matched`, `internally_offset`,
  `reopened`, or `voided`
- optional paid-confirmation timestamp, distinct from all status values
- matched ledger transfer rows and match metadata

### Matching

Only a real transfer should be matched. Matching must be one-to-one and
idempotent. A partial transfer leaves a visible remainder; an overpayment is an
exception requiring review. An unrelated transfer must not close a checkpoint
just because its amount is close.

### Undo and corrections

Undo/reopen must reopen the checkpoint as a new lifecycle state rather than
deleting history. It must release its included records from the settled view,
unlink or retain the ledger evidence according to an explicit confirmation,
and make the resulting balance visible again.

### Paid confirmation

The people can confirm that the repayment occurred before the bank has posted
or imported the transfer. That confirmation must collapse the checkpoint out of
the active workspace while preserving its inclusion manifest and matching
controls in a dedicated follow-up queue. The queue must say that it awaits bank
evidence. It must not display the checkpoint as bank-matched, create a ledger
entry, or alter an existing transfer.

### Backdated activity

Membership is based on the checkpoint inclusion manifest or batch identity, not
the activity date. A backdated row created/imported after the checkpoint belongs
to the next open batch and should be labeled `Open after settlement`.

## UX Recommendation

Keep the main list chronological, but add a settlement status layer:

- default: open activity and the current net balance are prominent
- settled activity: muted and grouped under a collapsible checkpoint section
- late/backdated activity: chronological position preserved with an `Open after
  settlement` badge
- checkpoint detail: a timeline showing included rows, net calculation, ledger
  match, partial remainder, reopen, and correction events

The primary action should be `Simplify settlement`. The confirmation surface
should explain that it nets group balances; it should not create a fake split
expense or fake ledger entry. If the result is non-zero, the next action is
`Match transfer` when a bank row exists, otherwise the checkpoint remains
`Open`.

The shipped splits layout keeps the settlement status layer immediately before
the chronological activity list. It provides `View included activity`, keeps
archive access beside the list, and marks included rows in the timeline. The
status layer and all of its controls use the splits palette rather than global
button styles, with a responsive stacked layout on mobile.

## Scenario Matrix

| Scenario | Expected result | Current status |
| --- | --- | --- |
| Opposing balances across two groups | One person-level net amount | Pure policy test; persistence missing |
| Exact cross-group offset | Internally offset; no ledger match | Pure policy test; persistence missing |
| Payment direction reverses | Sender/receiver follow signed net | Pure policy test; persistence missing |
| Exact transfer | Checkpoint becomes matched and leaves active workspace | Implemented; endpoint/UI |
| Partial transfer | Remainder stays open | Implemented; endpoint/UI |
| Multiple limited transfers | Cumulative total closes checkpoint | Implemented; endpoint/UI |
| Overpayment across transfers | Exception, never silent close | Implemented; endpoint/UI |
| Duplicate reuse of same ledger row | Reject second match | Implemented |
| Unrelated same-amount transfer | Remains unmatched | Not implemented |
| Backdated row in newer batch | Open after settlement | Implemented; record marker and batch membership |
| Same-date row added later | New batch membership wins | Implemented by record membership |
| Edit included row (any active state) | Refused until Undo simplification | Implemented (2026-09-26, settlement lock) |
| Delete included row (any active state) | Refused until Undo simplification | Implemented (2026-09-26, settlement lock) |
| Entry edit that moves a settled linked split | Whole save refused until Undo simplification | Implemented (2026-09-26, settlement lock) |
| Import rollback removes a settled split's entry | Split facts and checkpoint unchanged; link cleared | Verified (2026-09-26) |
| Edit or delete a row in a settled group batch | Refused until Undo settle-up | Implemented (2026-09-26, group settle-up lock) |
| Unchanged shared entry save with an odd-cent share | Saved; shares kept to the cent | Implemented (2026-09-26) |
| Undo/reopen | History retained; balance reopens | Implemented |
| Mark paid before transfer posts | Collapsed follow-up; no ledger state changed | Implemented; endpoint/UI |
| Undo paid | Same checkpoint returns active; included rows remain frozen | Implemented; endpoint/UI |
| New activity after paid confirmation | Can create a new checkpoint without reusing old rows | Implemented; endpoint/API |
| Later bank transfer | Paid follow-up can match it from the selected ledger month | Implemented; endpoint/UI |
| Remove one of several matches | Remaining total and status recalculate | Implemented |
| Transfer deleted after matching | Match disappears and checkpoint reopens/partials | FK cascade; should be monitored |
| Two transfers with same amount | Each requires distinct ledger identity | Implemented |
| Transfer series crosses months | Match remains attached to checkpoint | Implemented by ledger identity |
| Transfer series has wrong direction | User sees selected row and can remove it | UI review; no direction inference |
| Matching while another device matches | Unique constraints prevent duplicate row reuse | Database constraint |
| Concurrent checkpoint creation | Prevent overlapping inclusion | Not implemented |
| Multi-person scope | Reject or use explicit multi-party algorithm | Not implemented |
| Currency mismatch | Reject before netting | Not implemented |

## Test Proof

`tests/split-settlement-checkpoint-audit.test.mjs` covers the pure netting and
classification invariants, including negative, cumulative, and overpayment
paths.
`tests/e2e/splits-settlement-checkpoint.spec.js` proves the real D1/API flow for
checkpoint creation, paid confirmation, undo paid, later ledger matching,
backdated additions, and reopen. Existing split settlement and match suites
continue to pass.

## Settlement Lock (2026-09-26)

Branch `checkpoint-reopen`. Before this, an expense already in a checkpoint
could be edited (amount, shares, payer, date, group) or deleted in Splits, and
a linked entry's amount edit moved its split's total and shares, without the
checkpoint knowing: the settled amount stopped matching its rows.

Rule (DOMAIN.md, Settlement Checkpoint): while a checkpoint is active (any
status except `reopened`/`voided`, paid or not), its rows keep amount,
currency, shares, payer, date and group, and cannot be deleted. The command is
refused before its first write with 409 `split_settlement_locked` and the
checkpoint id; the editor, dialog or phone sheet shows the reason and an
`Undo simplification` action (reopen), and keeps the person's change for a
second save. Chosen over automatic reopen (an edit would silently release
every included row and undo a paid or bank-matched settlement) and over
"needs review" (it leaves a settled amount that does not match its rows).
Existing checkpoint steps are explicit in the same way: reopen before
creating another, remove the bank match before undoing paid.

Paths: `updateSplitExpenseRecord`, `deleteSplitExpenseRecord`,
`updateSplitSettlementRecord`, `deleteSplitSettlementRecord`
(`app-repository-splits.ts`), and `updateEntryRecord`
(`app-repository-entry-commands.ts`) through
`assertLinkedSplitSettlementUnchanged`, which predicts both the amount
follow-up and the shared-save upsert. The check lives in
`src/domain/split-settlement-lock.ts`. Import rollback was checked and needs
no guard: it only clears a removed entry's split link. The four split commands
now also commit in one `db.batch()`.

Proof: `tests/atomic-writes-split-checkpoint-lock.test.mjs` (14, real
Miniflare D1; 9 failed on the old code: refused edits, delete, entry edit,
undo-then-save, paid/matched/offset, settle-up, and the three atomicity
tests), `tests/e2e/splits-settlement-lock.spec.js` (4: inline edit refused
then saved after undo, delete dialog, Entries edit refused then saved, phone
dialog).

Open: a group settlement (closed batch) does not lock its rows the same way;
editing a row in a settled batch still changes the batch without notice.
Closed 2026-09-26, next section.

## Group Settle-up Lock and the One-cent Shared Save (2026-09-26)

Branch `split-locks`. Verified first on `macro-performance` (`f682ad6`):

- a settle-up closes its group batch, and closed batches leave the group
  balance. Editing an expense's amount, shares, payer, date or group in a
  closed batch, or deleting it or the settle-up, returned 200 and changed the
  settled batch without notice; deleting the settle-up left the batch closed
  with nothing that paid it. A household shared save of a linked entry moved
  its split out of the closed batch into the group's open batch
  (`upsertLinkedSplitExpenseForEntryRecord` always took the active batch).
- a shared entry save rebuilt the split's shares from the basis the editor
  sends, which is the stored, rounded first-share ratio: 10.01 split
  5.00/5.01 is stored as 4995 and floors back to 4.99/5.02. An unchanged
  shared save of a settled split was refused as a share change, and one of
  an open split silently moved a cent.

Rules (DOMAIN.md, Split Batch and Split Expense Share):

- a closed group batch locks its records (the settle-up included) exactly as
  an active checkpoint does, with the same 409 `split_settlement_locked`,
  naming `batchId` instead of `checkpointId`. Chosen over leaving group
  batches editable (the settle-up amount would stop matching its activity,
  invisibly, because closed batches are not in any balance) and over
  reopening automatically on edit (same reason as for checkpoints).
- `Undo settle-up` (`POST /api/splits/batches/reopen`) is the release, next
  to the refusal and in the archived batch view. It keeps the settle-up as
  open activity (it is a real payment and may be bank linked) rather than
  deleting it, mirroring Undo simplification, which keeps the checkpoint in
  history. With a newer open batch the reopened records join it, because the
  next settle-up closes only one batch.
- a shared save that keeps amount, currency and the stored basis keeps the
  stored shares; the lock predicts the same plan (`planSharedSaveShares`).

Paths: `assertSplitSettlementUnchanged` now finds either lock
(`findSplitSettlementLock`: checkpoint first, then closed batch), so every
path that already used it is covered: `updateSplitExpenseRecord`,
`deleteSplitExpenseRecord`, `updateSplitSettlementRecord`,
`deleteSplitSettlementRecord` and `updateEntryRecord` through
`assertLinkedSplitSettlementUnchanged` (amount follow-up, shared upsert,
date and payer mirror). Import rollback re-checked for a closed batch: it
only clears the link. The upsert keeps the split's batch when its group is
unchanged.

Review follow-ups (same branch): editing a settle-up that stays in its group
no longer re-closes its batch (after an undo it silently settled the group
again); the shared-save prediction checks the live linked split, as the
upsert does, not an archived one first by rowid; restoring a record archived
before its batch was settled brings it back into the group's open batch;
Undo settle-up refuses a batch an earlier undo already emptied.

Proof: `tests/atomic-writes-split-group-settlement-lock.test.mjs` (15, real
Miniflare D1; 12 failed on the code before each fix: refused edit, delete
and settle-up facts, refused entry edit, the batch move on a shared save,
undo then save, undo into a newer open batch, the undo refusals, the undo
atomicity, the re-closing settle-up edit, the archived-split check, restore
into a closed batch and the repeated undo),
two new tests in `tests/atomic-writes-split-checkpoint-lock.test.mjs` (both
failed on the old code: 409 on an unchanged odd-cent save, and a moved cent
on an open split), and `tests/e2e/splits-group-settle-up-lock.spec.js` (4:
archive edit refused then saved after undo, settle-up delete refused, undo
from the archived batch, linked entry edit refused then saved).

Open (pre-existing, outside this branch): a linked split in a different
currency from its entry (allowed by bank matching) is always predicted as a
currency change by a shared save, so every shared save of such an entry is
refused while settled, and after an undo the upsert overwrites the split's
currency and total with the entry's. The upsert should skip a
different-currency split, as the amount follow-up does. The upsert itself
still writes with sequential `.run()` calls.
