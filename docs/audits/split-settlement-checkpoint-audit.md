# Split Settlement Checkpoint Audit

Date: 2026-08-27

## Scope

- Splitwise-style netting across split groups.
- External ledger matching for the resulting net payment.
- Undo/reopen behavior and checkpoint immutability.
- Backdated entries added after a settlement.
- Chronological activity presentation and settled/open distinction.

## Verdict

The app now implements a person-level simplification checkpoint alongside the
existing ordinary per-group split settlements and archival `split_batches`.
The checkpoint stores a net amount, included-record manifest, lifecycle state,
multiple transfer matches, and explicit reopen operation.

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

## Scenario Matrix

| Scenario | Expected result | Current status |
| --- | --- | --- |
| Opposing balances across two groups | One person-level net amount | Pure policy test; persistence missing |
| Exact cross-group offset | Internally offset; no ledger match | Pure policy test; persistence missing |
| Payment direction reverses | Sender/receiver follow signed net | Pure policy test; persistence missing |
| Exact transfer | Checkpoint becomes matched | Implemented; endpoint/UI |
| Partial transfer | Remainder stays open | Implemented; endpoint/UI |
| Multiple limited transfers | Cumulative total closes checkpoint | Implemented; endpoint/UI |
| Overpayment across transfers | Exception, never silent close | Implemented; endpoint/UI |
| Duplicate reuse of same ledger row | Reject second match | Implemented |
| Unrelated same-amount transfer | Remains unmatched | Not implemented |
| Backdated row in newer batch | Open after settlement | Pure policy test; UI label missing |
| Same-date row added later | New batch membership wins | Not implemented end to end |
| Edit included row after match | Require reopen/recompute | Not implemented |
| Delete included row after match | Require reopen/recompute | Not implemented |
| Undo/reopen | History retained; balance reopens | Implemented |
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
checkpoint creation, backdated additions, and reopen. Existing split settlement
and match suites continue to pass.
