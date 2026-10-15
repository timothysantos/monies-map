# Splits figures agree, and exact-amount bank matches

Two owner-approved changes, one slice.

## A. Every Splits figure reads one set

After "Group spend counts the open period only" the lead chip said "Spent since
last settle-up" ($125.00) while three other figures on the same screen still
counted everything: the share-of-costs insight ("$3,676.85 of $3,676.85"), the
Just for fun lines, and the donut (a page-wide copy built from every open
expense in the currency, from the person's "side" of each expense). They could
not agree. Now there is one definition, the open period (expenses no settle-up
covers; `src/domain/split-open-period.ts`), and a figure that is deliberately
about the whole group says so.

Screenshots (demo data, Okaeri settled once, two newer expenses open, donut
open): `before-desktop.png`, `before-phone.png` (the state before, copied from
`docs/audits/group-spend-open-period/`), `after-desktop.png`, `after-phone.png`,
`after-desktop-donut.png`, `after-phone-donut.png`.

### Figure inventory

| Figure | Set before | Set now | Label |
| --- | --- | --- | --- |
| Lead chip (person view) | open | open (unchanged) | "Spent since last settle-up" / "Group spend" while never settled |
| Entry count under the name | open | open (unchanged) | "2 entries" |
| Group balance, tiles, Settle group, balance insight | open | open (unchanged) | |
| Household lead figure (big number) | open | open | caption was "Total spend", now the chip's words |
| Category donut (centre and list) | every open expense in the currency across all groups, person's side (what the other owes you, or your own share) | the open group's own open expenses, search-filtered like the chip | everyone: "Since last settle-up" / "Group spend" (= chip); a person: "Your share since last settle-up" / "Your share", own share of each expense whoever paid |
| Insight "You paid for N% of shared costs" | the last 3 months of everything non-archived, or all of it | open expenses only; the last 3 months of them, else all of them | "over the last 3 months", else "since the last settle-up" ("in this group" while never settled) |
| Just for fun lines (trip in numbers, shared costs add up, average, busiest day/month, priciest day, first/latest/smallest cost, category, payment mix, currencies, repayments) | non-archived items | everything incl. settled batches: deliberately the whole group | once anything was settled: "(settled or not, since 2 Apr)", with the year when it is not this year; a group never settled says nothing extra |
| Ask answers about groups (`get_split_balances`, who owes whom) | open balances | open balances (unchanged) | |
| Settle-up sheet / History / archived batches | the settlement's own amount, record by record | unchanged: they show one recorded settle-up, not a group total | |

The page no longer sends `donutChart` / `donutChartsByCurrency`: the donut is
built on the page from the activity it already has (`deriveGroupFigures`), so
there is no second copy that could disagree and the payload shrinks.

### Strings

- Household lead caption: "Total spend" -> "Spent since last settle-up" (or "Group spend").
- Person donut centre: "Since last settle-up" -> "Your share since last settle-up";
  "Group spend" -> "Your share" while never settled. Everyone's centre keeps
  "Since last settle-up" / "Group spend".
- Share-of-costs period: "in this group" (everything) -> "over the last 3 months" /
  "since the last settle-up" / "in this group" (never settled).
- Fun facts of a settled group gain " (settled or not, since 2 Apr)"; the trip
  and group "in numbers" lines read "The trip in numbers (settled or not, since 2 Apr): ...".

### To decide

- A person's donut used to chart "what the other owes you, or your own share"
  depending on who paid, which no label can say plainly. It now charts your own
  share of each open expense, always, so "Your share since last settle-up" is
  true. For an even split paid by you the figure is the same as before; for an
  uneven one it differs.
- The donut centre label is three short lines on a phone and a desktop (see
  `after-*-donut.png`).

## B. Exact amount and date is suggested

`SINGAPOREAIR Korea KOR KRW` ($1,051.84, 24 Jun) got no suggestion for the bank
row `SINGAPORE6182478320308` of the same amount and day: the old rule needed a
shared whole word. Rules now (best first): exact amount within a day with a
shared word; exact amount within a day with no shared word, only when it is the
one such row, on the payer's own or a shared account (a foreign-currency card
or bank split awaiting its statement compares its home amount); a word match
a few cents or days off, as before. Rows already held by another split expense,
settle-up or checkpoint are never offered (query level). Nothing links by
itself.

The card's existing headline is the one reason line: "Same amount and date as
this split expense" for the exact-only tier (the word tiers keep "Imported
transaction could match this split expense"). Screenshots:
`after-match-card-desktop.png`, `after-match-card-phone.png`.

Notes on the linker (`linkSplitExpenseMatch`): it checks the row is an imported
expense, free, and that unlike currencies need a card or bank expense awaiting
its statement. It does not check the account owner or certification, so the
owner rule above is the suggestion's own, applied only to the new tier.
