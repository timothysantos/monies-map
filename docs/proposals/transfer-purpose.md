# Transfer purpose ("What is this for?")

Owner-approved ("option 2", 2026-10-20). Design note written before the code;
DOMAIN.md "Transfer Purpose" is the canonical definition once shipped.

## The case

Tim moves $450 every month from his account to Joyce's account. From Joyce's
account the bank then takes the house loan. Tim's month plan has a dated line
"House loan $450" in Home. Today the $450 is a transfer: it is not Tim's
spending, it cannot pay his plan line, and Joyce's view counts the whole
loan as hers.

## Model

A `transfer purpose` is the spending category a transfer between two
people of the household pays for. It sits on the **sending transfer entry**
(the `out` side), as two nullable columns on `transactions`:

- `transfer_purpose_category_id`: the category (its purpose);
- `transfer_purpose_person_id`: the person the money went to (the receiver);
- `transfer_purpose_source`: `person` (set by hand) or `remembered` (set
  like last month, see Learning).

Why the sending entry and not the transfer group:

- The effect is dated by one entry. Both people's figures move in the
  sending entry's month, so a pair split across a month end (sent on the
  31st, received on the 1st) still adds up in every month.
- It does not need the other side imported or linked. Joyce's account may
  be imported later or never; the receiver is stored, not inferred.
- The `transactions` columns are already read on every cold start
  (`PRAGMA table_info(transactions)`), so the migration costs no new D1
  round trip; a `transfer_groups` column would.

When the pair is linked, the receiver is the other side's owner (the link
wins): linking to a side owned by someone else updates the receiver in the
same write, and linking to a side owned by the sender clears the purpose.

## Rules (the person reading)

`readEntryForPerson(entry, personId)` (`src/domain/transfer-purpose.ts`) is
the one rule, used by every person-view figure on the Worker and in the
browser:

- **Household view: unchanged.** The entry stays a transfer. It adds
  nothing to spending or income, exactly as with no purpose.
- **Sender's view:** the entry reads as an expense of the sender in the
  purpose category, at its full amount. It counts in Spent, the category
  totals, Spending Mix, the spend money job, budget lines and (when linked)
  a dated plan line, which it pays.
- **Receiver's view:** the same entry reads as a payback in the purpose
  category (the existing `category offset`): it lowers the receiver's
  spending in that category by the amount and is not income.
- **Anyone else:** unchanged (not theirs).
- Scope: it is direct money for both people (no split), so it is in
  `Direct ownership` and `Direct + Shared`, never in `Shared`.

### Why not Splits / shared ownership

The existing shared mechanism (a split expense with shares, settled by a
settle-up transfer) gives the same person totals only if Joyce's loan debit
is put on Splits every month, half each, and Tim's $450 is linked as the
settle-up. That is three monthly actions, a Splits balance that is always
open in between, and Tim's share is dated by Joyce's debit, not by his
payment, so his plan line cannot be paid by his own transfer. The purpose
reuses the `category offset` rule for the receiver and the ordinary expense
rule for the sender instead of a new accounting path: one reading of one
entry.

## Edge cases

| Case | Rule |
| --- | --- |
| Owner case: Tim -> Joyce $450 Home, Joyce's loan $900 Home, same month | Tim Home 450, Joyce Home 450, household Home 900. |
| The loan debit lands next month | Month M: Tim +450, Joyce -450 (her Home shows $0, never below zero, as refunds already do; her totals keep the -450). Month M+1: Joyce +900. Household: 0 then 900. Every month adds up. |
| Contribution larger than the expense | Same as above: the category shows $0, the totals stay exact. No carry-forward, no "paid ahead" balance: that would be a forecast and a second ledger. |
| Two purpose transfers | Each one reads on its own and they add. |
| Purpose transfer plus a shared (Splits) expense | Both apply and still add up. If the expense is already shared on Splits, the transfer is really the settle-up: link it as one and leave "What is this for?" empty. |
| A purpose transfer later linked as a settle-up | Refused: "This transfer pays for Home. Clear What is this for? first to use it as a settle-up." The reverse is refused too. |
| Foreign currency | The amount is the sending entry's own (its account's money, as every figure counts it). A pair whose two sides are in different currencies is refused. |
| Deleted entry, rolled-back import | The purpose lives on the entry, so it goes with it. A receiving side that is deleted or rolled back changes nothing. |
| Transfer between one person's own accounts, a joint receiving side with no owner, an investment account | Refused: "A move between your own accounts stays a transfer." / "Choose whose money came in first." / "Money moved into or out of investments keeps its own rule." |
| The entry stops being a transfer out (refiled as an expense, direction changed) | The purpose no longer counts (the reader checks it) and the write that changes it clears it. |
| Purpose category | A spending category or Loans. Never Transfer, Savings, Investments, Other or an income category. |

## Invariants (tests)

1. Household figures (Summary, Month, Entries totals, stored month totals,
   money insights, plan variance, money jobs) are identical for data with no
   purpose, and for data with purposes equal the same data with every
   purpose removed (`tests/transfer-purpose-*.test.mjs`).
2. For each category and month, sender view + receiver view (+ anyone else)
   = household view, to the cent (Direct + Shared scope).
3. Invested and the transfers into investment accounts are unchanged.
4. Settle-ups and Splits balances are unchanged; the settle-up interplay is
   refused with a plain message.

## UI

- Entries editor, transfer out between two people of the household: a
  "What is this for?" row that opens the shared category list (no native
  select). Choosing saves at once (like the row's category list), "Nothing,
  just a transfer" clears it.
- Entries row: in a person view the row shows the purpose category and a
  "Transfer to Joyce" / "Tim's transfer to you" chip, so it is still visibly
  a transfer. The household row reads "Matched transfer out · for Home".
- Month: in Tim's view the entry can be linked to "House loan" like any
  expense, and the line shows paid.
- Hidden money hides every amount as before; the new chips carry no
  amount.

## Learning

When a transfer out is saved (import commit or a manual add), and the newest
earlier transfer out of the same account with the same amount and the same
description (digits ignored) within 100 days had a purpose, the new one gets
the same purpose and receiver, marked `remembered`. The row shows "Set like
last month" and the editor row an Undo, which clears it; a cleared month
stops the next one (the newest earlier transfer now has none). No new table:
the rule reads the ledger, like the card and split suggestions.

Ask: changing a transfer's category is not an Ask change today
(`transferKeepsCategory`), and a purpose is not added to Ask's change set in
this change (it would need its own action, validators and eval bank).

## Storage and migration

Additive only: three nullable `transactions` columns, added by `schema.sql`
and by `ensureDemoSchema` (from the column list it already reads). Process:
export the production D1 to the scratchpad (never committed), apply the
`ALTER TABLE` statements to production and demo before deploying the code,
then deploy. Existing rows keep NULL, so every figure is unchanged
(persisted-state snapshot identical before and after).

Writes: `POST /api/transfers/purpose` (`app-repository-transfer-purpose.ts`),
all-or-nothing: the entry update, an audit event and the month refresh
markers of the sending entry's month and its pair's month in one
`db.batch()`.
