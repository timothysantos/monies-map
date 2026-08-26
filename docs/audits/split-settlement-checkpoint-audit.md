# Split Settlement Checkpoint Audit

Date: 2026-08-26

## Scope

- Splitwise-style netting across split groups.
- External ledger matching for the resulting net payment.
- Undo/reopen behavior and checkpoint immutability.
- Backdated entries added after a settlement.
- Chronological activity presentation and settled/open distinction.

## Verdict

The current app supports ordinary per-group split settlements and archival
`split_batches`. It does not yet implement a person-level simplification
checkpoint. The existing batch is therefore not sufficient as the future
settlement contract: it has no net amount, included-record manifest, lifecycle
state, undo event, or cross-group scope.

The pure policy seam in
`src/domain/split-settlement-policy.ts` and its tests document the invariants
the feature should implement before it receives persistence or UI work.

## Current Findings

1. A settlement currently closes the active batch for one group. It does not
   calculate a net obligation across groups such as Okaeri and B.River.
2. Settlement matching currently searches for a transfer row by amount and
   date. It has no concept of a checkpoint amount, partial payment, overpayment,
   or an already-consumed ledger row.
3. Deleting a settlement does not provide a semantic undo/reopen operation for
   a previously closed batch. Reopening must be explicit and must preserve the
   audit trail.
4. The current chronological list can show archived batches, but it has no
   required visual state for “settled in checkpoint”, “open after settlement”,
   or “new open activity”.
5. A date cannot identify checkpoint membership. A corrected or late-imported
   row may have an older activity date but must remain outside an already
   matched checkpoint when it belongs to a newer batch.

## Required Future Contract

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
- optional matched ledger transaction id and match metadata

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
| Exact transfer | Checkpoint becomes matched | Policy only; endpoint missing |
| Partial transfer | Remainder stays open | Policy only; endpoint missing |
| Overpayment | Exception, never silent close | Policy only; endpoint missing |
| Duplicate reuse of same ledger row | Reject second match | Not implemented |
| Unrelated same-amount transfer | Remains unmatched | Not implemented |
| Backdated row in newer batch | Open after settlement | Pure policy test; UI label missing |
| Same-date row added later | New batch membership wins | Not implemented end to end |
| Edit included row after match | Require reopen/recompute | Not implemented |
| Delete included row after match | Require reopen/recompute | Not implemented |
| Undo/reopen | History retained; balance reopens | Not implemented |
| Concurrent checkpoint creation | Prevent overlapping inclusion | Not implemented |
| Multi-person scope | Reject or use explicit multi-party algorithm | Not implemented |
| Currency mismatch | Reject before netting | Not implemented |

## Test Proof

`tests/split-settlement-checkpoint-audit.test.mjs` covers the pure netting and
classification invariants, including negative and overpayment paths. It does
not claim the feature is shipped. End-to-end tests must be added with the
database/API implementation before calling the checkpoint feature complete.
