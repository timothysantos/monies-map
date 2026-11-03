# Demo Tour

A 5 to 10 minute walkthrough for presenting Monie's Map on the public demo
site with the showcase data. It tells one story: a couple who plan their
month, bring in their bank files, check them against the statements and
share costs fairly.

## Before you start

- The demo must be running the showcase data. You will see **Ethan** and
  **Serene** in the view switcher at the top. If you see other names, ask a
  developer to refresh the demo (see "Refresh the demo" at the end).
- The demo rebuilds itself at the start of each month and whenever it is a
  week out of date, so the history ends close to today. Anything a visitor
  changed is replaced then. To start from fresh data just before a meeting,
  open Settings, then **Demo state**, and press **Reseed demo data**. On
  the showcase demo that button restores the showcase data. Anything a
  previous visitor changed is replaced.
- Money totals can be hidden. If you see dots instead of amounts, press the
  eye button to show them.
- The data is invented. Ethan works at a logistics company and takes home
  about $5,700 a month; Serene is a designer at a small studio and takes home
  about $4,400 (CPF is not shown as income). Both get a 13th-month AWS in
  December, and Ethan a small mid-year bonus in July. They live in an HDB
  flat in Tampines with a cat called Mochi, put money into Endowus,
  StashAway and IBKR every month, and usually spend about $3,400 to $4,800 a
  month. Their history covers the last 17 months, ending today. The current
  month is only filled in up to today.

Month names below are relative to the day you reseed, for example "two months
ago". Amounts are close to the ones shown but can differ by a few dollars
from one month to the next.

## 1. Summary: the year at a glance (1 minute)

Open **Summary** with **Household** selected.

- The top card compares spending with the plan over the last 12 months;
  income and savings sit beside it. "Realized savings" is what was actually left over.
- **Money insights** under the cards lead with a **To do**: Serene's OCBC 365
  Card statement differs from what's recorded by $42.80. Its **Big picture** line says the household
  kept about 58% of what came in over the last 12 months.
- Scroll to **Intent vs Outcome**: each month is a card with its spend
  against plan. Most months finish under plan. One month,
  two months ago, sticks out above the plan. Hold that thought.

Story: "You see what you intended and what actually happened, month by
month, without building a spreadsheet."

## 2. Same month last year (1 minute)

Summary's Money insights talk about the last month of the range, and the
same-season comparison needs that month to be finished and the month a year
earlier inside the range. The default range is only the last 12 months,
ending in the current month.

1. Tap the **Range** control and set the start to the **earliest month**
   (17 months back) and the end to **last month**.
2. Stay on **All months** and read the Money insights **Big picture** line.

With last year's month in the range, the Big picture can compare the two:
last month spent about $800 less than the same month last year (the year
before had a Bali long weekend). The Big picture takes turns by month with the
household's keep rate and cushion, so on some months it shows one of those
instead.

Story: "It compares like with like, and only with months that are really
there. It never forecasts."

The headline is still the **To do** for the card that is off against
its statement. We will look at that in step 6.

## 3. People and scopes (1 minute)

Switch the view to **Ethan**, stay on Summary.

- A person view counts that person's own spending plus their share of
  anything shared. Try the scope buttons: **Direct ownership** (his own card
  and bank spending), **Shared** (his half of shared bills, dinners and the
  Japan trip) and **Direct + Shared** (both). Each gives a different total,
  and the first two always add up to the third.
- Money insights no longer lead with the statement To do, because
  every account Ethan can see is reconciled. Switch to **Serene**: the
  To do is back, because the card with the problem is hers.

Story: "Each partner sees their own money honestly, and the household still
sees everything."

## 4. Month: the plan versus reality (2 minutes)

Go back to **Household** and set the **Range** end back to the current
month. Then pick **two months ago**: on a computer in the row of months
under the top bar, on a phone with the **All months** button beside the
View and scope bar. The Summary button stays highlighted; a picked month
shows that month's plan.

- The lead's **Spent** is about $4,000 over its spending plan. The month
  note explains it: both aircon units were replaced, the new sofa arrived,
  and $2,000 came out of StashAway to help pay for it (the savings bar shows
  it as taken out of investments).
- Money insights lead with a **Something to think about**: the aircon made
  up most of what went over plan. Press **See all insights**: **Also this
  month** lists the card's statement gap.
- Scroll to **Planned Items**: the HDB loan, S&CC, insurance and
  subscriptions are each linked to the real bank entry that paid them. The
  savings targets and the Endowus and StashAway lines sit beside them.
  **Budget Buckets** (groceries, food, transport) show how much of each
  budget is used.

Now choose **five months ago**, the Japan trip. Spending was much higher
than usual, but the trip was budgeted, so the month lands almost exactly on
plan.

Then choose the **current month**: the plan is complete, the spending is
only filled in up to today, and not every bill has been paid yet.

The month a year ago with no plan at all (11 months back) opens in the
**Simple** view: what came in against what went out, with no plan.

Story: "Big months are fine when they were planned. The app shows which
overspend was a decision and which was a surprise."

## 5. Entries: every transaction, traceable (1 minute)

Open **Entries** for **two months ago**.

- Find the **COURTS** aircon entry: it has a note, it is marked as shared in
  **Home & Bills**, and it is **Statement certified**, which means a bank
  statement confirmed it.
- Card bill payments show their matched other half in the bank account.
- In the current month, entries come from current activity files, and
  two were saved by the Apple Pay shortcut (yesterday's groceries and
  today's breakfast).

Story: "Every number on the Summary can be traced to a real row, and you can
see how trustworthy each row is."

## 6. Imports and statements (1 minute)

Open **Imports**.

- The **Import inbox** says exactly one file is needed: Serene's **OCBC 365
  Card** statement for last month.
- **Recent imports** lists every file brought in, per account: monthly PDF
  statements, current activity files and the older history files. Each
  batch can be rolled back without touching anything else. Older statements
  are locked once a newer one exists. One import was rolled back after the
  wrong file was loaded.

Open **Settings**, then **Accounts**.

- Ten of the eleven accounts are **reconciled to last month's statement**,
  including the four investment accounts (their checkpoints are the money
  put in; market gains aren't tracked there).
- On the Summary, **StashAway General Investing** and Ethan's **iFAST Wrap
  Account** also say what they were worth at the end of last month, as
  their monthly statements say. Ethan bought his iFAST unit trusts before
  the history starts and puts nothing more in, so only its worth changes.
- The **OCBC 365 Card** is off by **$42.80**: a Grab ride printed on the
  statement never made it into the ledger. It shows as an open
  reconciliation exception.
- **Transfer review** lists one unresolved transfer: Serene's SRS top-up,
  going to an account the app does not track.

Story: "The app doesn't just import. It proves the ledger against the bank,
and tells you precisely what doesn't match."

## 7. Splits: sharing costs fairly (2 minutes)

Open **Splits** (it opens on a person view, for example Ethan).

- **Japan trip** is selected first. It is kept in yen. Card payments (the
  Tokyo hotel, the Kyoto ryokan, the Shinkansen) are linked to their card
  rows in dollars; cash spending is recorded in yen only. Serene still owes
  Ethan ¥26,730 after handing over ¥20,000 of leftover yen.
- Select **Home & Bills**. It shows a **Simplified settlement**: last month
  the couple combined Home & Bills and Dinners out into one payment, so
  Serene pays Ethan one amount instead of settling each group. The included
  records are folded into one row at the end of the list ("Simplified on
  …"); open it to see them, locked, with **Undo simplification** available.
- Press **Archived batches**: two earlier settle-ups closed their batches,
  and the simplified settlement is listed too. Open a batch to see its
  records and the **Undo settle-up** option.
- **Review matches** shows one suggestion: a dinner Serene recorded in
  Splits before her card row arrived.
- **Activity history** shows a dinner that was entered twice and deleted.

Story: "Shared costs stay fair across trips, currencies and months, and the
link back to the bank rows is never lost."

## 8. FAQ (optional)

Open **FAQ** to show the built-in user guide. Its worked examples and
screenshots use this showcase household (Ethan and Serene), captured around a
fixed month, so its dates and amounts can differ from today's demo.

## Refresh the demo

For developers: the demo worker uses the showcase data when
`wrangler.demo.jsonc` sets `DEMO_DATASET` to `showcase`. To refresh it:

```bash
npm run deploy:demo
```

The demo moves its history forward by itself at the start of each month and
when it is a week out of date. To refresh it now, press **Reseed demo data**
in Settings, Demo state on the demo site (the demo is behind Cloudflare
Access, so sign in first).
Details are in the developer guide's demo section.
