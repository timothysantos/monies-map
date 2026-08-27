# Travel and Multi-Currency Splits Audit

Date: 2026-08-27

## Objective

Make travel splits usable when expenses are paid in foreign cash, foreign
currency card transactions, or a home-currency card statement whose final
amount is only known later. The design must also support family travel without
turning a baby or dependent into an accidental settlement counterparty.

## Current Risk

The existing split workspace assumes one implicit currency and two household
people. Ledger accounts already have currencies, but split records and
settlement checkpoints do not preserve the currency or the evidence used to
convert it. Directly comparing a JPY split with an SGD card row can therefore
create a false match or silently change a user's original expense.

## Product Contract

- A split group has one designated currency. Existing groups default to the
  household currency (`SGD`).
- The original expense currency and amount are authoritative for the trip.
- A home-currency estimate is optional and never replaces the original amount.
- Cash expenses may remain unlinked because no future ledger row is expected.
- Card expenses can be marked pending until a statement-certified ledger row is
  imported and linked.
- The final ledger amount records the observed FX outcome; it does not mutate
  the original trip amount.
- Settlement checkpoints must use one currency at a time. Cross-currency
  settlement requires an explicit FX rate and visible conversion evidence.
- A family member or baby can participate in an expense without becoming a
  person who owes money. Dependents must be modeled as non-settling
  participants, not as household people used by netting.

## Scenario Matrix

| Scenario | Expected behavior | Risk |
| --- | --- | --- |
| JPY cash meal | Save JPY amount, cash evidence, no ledger match required | Cash cannot be treated as SGD |
| JPY card meal, SGD statement later | Save pending card expense; suggest later certified SGD row | Final FX amount may change |
| Statement row has no foreign amount | Match by merchant/date and require user confirmation of FX | False positive match |
| Card fee appears separately | Keep fee as separate ledger evidence or explicit FX fee | Inflated expense |
| Two SGD transfers settle one JPY balance | Accumulate transfers after explicit conversion rate | Partial payment and rounding |
| Cash plus bank transfer settlement | Combine typed cash evidence and ledger evidence | Duplicate settlement |
| Refund after trip | Preserve original expense and create linked negative adjustment | Retroactive share corruption |
| Multiple currencies in one group | Reject or require explicit conversion before netting | Invalid arithmetic |
| Family meal with baby | Include baby in share allocation if desired, exclude from settlement debt | Baby becomes debtor |
| Child paid by parent | Attribute payer to parent; optionally tag child as participant | Ownership ambiguity |
| Family member outside household | Store as participant label only, never infer a ledger owner | Privacy and matching scope |
| Adult joins trip late | Effective participant dates apply only to later expenses | Historical recalculation |
| Person leaves trip | Freeze prior shares; do not rewrite settled history | Balance drift |
| Mixed cash wallets | Match only to the selected currency cash wallet | Wrong wallet currency |
| Card authorization versus final statement | Show pending and certified states separately | User thinks estimate is final |
| Offline travel entry | Queue locally and preserve client idempotency | Duplicate sync |
| Time-zone date boundary | Use trip local date plus ledger posted date | Wrong match window |
| Zero-value or unsupported currency | Reject before persistence | Broken totals |
| Two people pay same meal in different currencies | Keep two payment records and explicit conversion | Double counting |
| Imported row is later corrected | Reopen FX review without changing original split | Audit trail loss |

## Delivery Plan

1. [x] Add group currency and per-record currency/evidence metadata with
   SGD-safe defaults.
2. [x] Add currency-aware amount formatting and clear cash/card-pending/
   certified states to split forms and activity rows.
3. [x] Add explicit FX conversion evidence to split-to-ledger matching and
   settlement checkpoint matching.
4. Add participant roles (`adult`, `child`, `dependent`, `guest`) and a
   non-settling flag before enabling more than two settlement people.
5. Add correction history, refunds, offline idempotency, and multi-currency
   settlement review.

Implementation status: items 1-3 are implemented and covered by unit/API/E2E
tests. Items 4-5 remain intentionally blocked by the current two-person share
model; the UI does not expose a way to make a child, baby, or guest a
debt-bearing person.

## Stop Conditions

- Never sum amounts with different currencies without a stored rate.
- Never infer a baby/dependent as a debt-bearing household person.
- Never overwrite the original foreign amount with a later SGD statement.
- Never mark an FX match as certified without user confirmation when the
  statement does not contain the original foreign amount.
