# Travel and Multi-Currency Splits Audit

Date: 2026-08-28

## Decision

Travel groups keep one authoritative currency. A JPY trip stays JPY even when
the eventual card charge or repayment appears in the SGD ledger.

For a low-memory holiday workflow, users may create two groups in the trip
currency: `Cash only` for offline cash purchases and `Bank/card` for purchases
that should later be matched to imported ledger rows. Existing groups remain
`Mixed` so this is additive and does not change their meaning. The source mode
constrains purchase records only; repayments can still be cash or bank for any
group.

There are two distinct settlement workflows:

- **Settle group** records payment for the selected group and closes only that
  group's current batch. It does not create a simplified checkpoint and does
  not affect any other group.
- **Simplify settlement** is optional. It nets open groups that use the same
  currency into one currency-specific checkpoint. Different currencies are
  never silently added together.

A foreign-currency group settlement may be linked to a home-currency transfer
after explicit review. The foreign amount remains authoritative; the linked
ledger amount and derived FX rate are evidence of what was actually paid.

## Seven-Day Reference Journey

1. Days 1-3: a Tokyo JPY group receives cash expenses (recorded, no ledger row
   expected) and card expenses (awaiting statement).
2. Days 4-5: normal SGD expenses continue in another group. They do not change
   the Tokyo balance.
3. Day 6: a forgotten Tokyo expense is added with its actual trip date. It joins
   the currently open Tokyo batch, even though it was entered later.
4. Day 7: imported SGD card rows are reviewed against pending JPY expenses by
   merchant and date. Confirming a match stores the final SGD amount and FX
   evidence without rewriting the JPY amount or shares.
5. Settlement may then happen independently per group with **Settle group**, or
   open same-currency groups may be combined with **Simplify settlement**.

## Findings and Controls

| Finding | Required control | Status |
| --- | --- | --- |
| Group and expense currencies can diverge | Reject cross-currency records inside a group | Implemented in this change |
| SGD imports cannot currently match pending JPY card expenses | Permit reviewed merchant/date matches only for card/bank rows awaiting a statement | Implemented in this change |
| Linking currently stores only a transaction id | Preserve foreign amount/shares; store final ledger amount, derived FX, and certified evidence | Implemented in this change |
| One active checkpoint blocks every currency | Allow one active checkpoint per currency; still reject a second checkpoint in that currency | Implemented in this change |
| The UI can show the wrong checkpoint after switching groups | Scope settlement status and actions to the selected group's currency | Implemented in this change |
| "Settle up" is easy to confuse with simplification | Label it **Settle group** and explain that it affects only the selected group | Implemented in this change |
| One ledger row could be reused as evidence | Reject reuse across split expenses, settle-ups, and checkpoints | Implemented in this change |
| Cross-currency netting is ambiguous | Require separate currency checkpoints or group settlements | Enforced product rule |
| Dependents could become debtors | Keep the current two settling adults; represent child/baby context in notes and unequal shares | Enforced product rule |

## Scenario Test Matrix

| Scenario | Expected result |
| --- | --- |
| Foreign cash purchase | Remains recorded and unlinked; no missing-match warning |
| Foreign card purchase, home-currency statement | Reviewed match derives FX and certifies evidence; original amount and shares do not change |
| Same merchant/date but cash payment | No cross-currency suggestion |
| Same merchant/date but unrelated amount in same currency | Existing amount tolerance still rejects it |
| Statement merchant is renamed | Shared merchant tokens and date window can produce a medium-confidence review |
| Two similar purchases on one day | A confirmed ledger row cannot be reused; remaining candidate stays unresolved |
| Posted date crosses midnight/weekend | Match remains eligible within the five-day expense window |
| Forgotten expense added after returning | Backdated row belongs to the next open batch if an earlier batch was settled/checkpointed |
| Daily-life SGD group while JPY trip is open | Balances and settlement actions remain independent |
| Settle JPY group | Only the JPY group batch closes; no checkpoint is created and SGD remains open |
| Simplify JPY while SGD checkpoint exists | Allowed because active checkpoints are scoped by currency |
| Simplify JPY twice | Rejected until the existing JPY checkpoint is reopened |
| Two/three transfer bank limit | Partial matches accumulate; exact total becomes matched |
| Overpayment | Remains visibly open for review; no silent write-off |
| Foreign group paid by SGD transfer | Requires reviewed FX evidence and preserves group currency |
| Refund or chargeback | Kept as a separate correction; it never mutates a settled historical expense |
| Card fee posted separately | Stays a separate ledger row unless explicitly entered as its own split expense |
| Unequal family/baby allocation | Existing adult shares are preserved through linking; a child is not made a debtor |
| Odd-cent or FX rounding | Stored minor units remain authoritative and residual differences stay visible |
| Offline/retried confirmation | Idempotency/reuse guard prevents a second link to the same ledger row |
| Reissued card or closed account | Matching relies on imported transaction evidence, not a permanent card identifier |
| Cash-only group receives a card or bank purchase | Rejected with guidance to use the Bank/card group |
| Bank/card group receives a cash purchase | Rejected with guidance to use the Cash-only group |
| Existing group has no source mode | Treated as Mixed during migration; no data is rewritten |

## Stop Conditions

- Never sum or simplify records with different currencies.
- Never overwrite a foreign amount or its shares with an SGD ledger amount.
- Never suggest a cross-currency cash match.
- Never certify a cross-currency link without an explicit user confirmation.
- Never let one ledger row settle or certify multiple split records.
- Never make a baby, child, or guest a settlement counterparty by inference.

## Deferred Scope

- First-class non-settling participants and per-participant effective dates.
- A deliberate multi-currency conversion agreement that nets several
  currencies into one transfer. Until that model exists, settlement stays
  per-group or per-currency.
- Automated refund pairing and offline client-generated idempotency keys.
