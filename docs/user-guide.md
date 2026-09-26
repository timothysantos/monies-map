# User guide

Everything you need to use Monie's Map, from your first visit to closing a
bank statement. New here? Read **Start here** first, then jump to any recipe
under **How do I…**. Tap a picture to open it full size. Technical setup lives
in the For developers tab.

# Start here

## What is Monie's Map?

Monie's Map is a household money planner and tracker for two people. It keeps
your plan, your real spending, your bank statements and your shared expenses
in one place, so you can answer five questions every month:

- What did we intend to spend and save?
- What actually happened?
- Was the difference justified?
- Did it hurt our savings?
- Which assumption was wrong?

It does not connect to your bank. You add spending by hand, from Apple Pay, or
by importing the files your bank lets you download. A bank statement then
proves the numbers are right.

## Take the 3-minute tour

The navigation at the top (on a phone, at the bottom) has seven screens. They
appear in this order:

1. **Summary**: the big picture for a range of months: planned versus actual
   income, spending and savings, where the money went, and your wallet
   balances.
   ![Summary shows planned and actual totals, a money check-in, spending mix and intent versus outcome](/faq/guide/desktop/thumbs/summary-household.webp)
2. **Month**: the plan for one month (income, budget buckets and planned
   items) next to what was actually spent.
   ![Month shows each plan row with planned, actual and variance](/faq/guide/desktop/thumbs/month-person.webp)
3. **Entries**: every transaction for the month, grouped by day, with search
   and filters. This is where you add, fix and categorise spending.
   ![Entries lists transactions by day with totals and filters](/faq/guide/desktop/thumbs/entries-person.webp)
4. **Splits**: shared expenses between the two of you: who paid, who owes
   whom, and settling up. It has a dark orange look so you always know you are
   in Splits.
   ![Splits uses a dark orange theme and shows groups, balances and shared expenses](/faq/guide/desktop/thumbs/splits-person.webp)
5. **Imports**: bring in bank files. The Import inbox tells you which files
   to download from which bank.
   ![Imports starts with the Import inbox, which plans your bank downloads](/faq/guide/desktop/thumbs/imports-inbox.webp)
6. **Settings**: people, accounts, categories, category rules, Apple Pay and
   the tools that keep balances trustworthy.
   ![Settings groups everything into sections you open one at a time](/faq/guide/desktop/thumbs/settings-overview.webp)
7. **FAQ**: this guide.

At the top left you choose whose money you are looking at (Household, or one
person). At the top right you move between months or ranges and hide or show
money totals.

## The core idea: plan, record, import, reconcile, split

Monie's Map works best as a monthly loop:

1. **Plan**: on Month, set what you expect to earn, your fixed commitments
   (planned items) and flexible budgets (budget buckets).
2. **Record**: as you spend, add entries on Entries, or let Apple Pay create
   them for you.
3. **Import**: during the month, import your bank's activity export to catch
   everything you missed.
4. **Reconcile**: when the statement arrives, import the PDF. It confirms each
   row and checks that the balance matches the bank to the cent.
5. **Split**: anything you share goes on Splits, so you always know who owes
   whom, and you settle up when you are ready.

Summary then shows whether the month went as planned. You do not have to do
every step: many households only plan, record and split.

## Views: Household, Tim and Joyce

The switch at the top left changes whose money you see. The names come from
Settings → People (the demo uses Tim and Joyce).

- **Household** shows everything, for both people together. The Month plan is
  read-only here, because each person keeps their own plan and the household
  plan is the two combined.
- **A person** (for example Tim) shows that person's own money: their own
  entries, plus their share of anything on Splits. This is where you edit that
  person's plan.
- **Splits always uses a person.** It opens on the person linked to your
  sign-in (or the first person), and the Household button is greyed out there,
  because "you owe" only makes sense for one person.

![A person view shows that person's figures and the scope choice under the heading](/faq/guide/desktop/thumbs/summary-person.webp)

![In the Household view, Month says the combined plan is read-only](/faq/guide/desktop/thumbs/month-household.webp)

The view is kept in the address, so a bookmarked page reopens the same way.

## Scopes: Direct, Shared, Direct + Shared

In a person view, the scope buttons narrow what counts:

- **Direct ownership**: the person's own entries that are not on Splits.
- **Shared**: only their share of expenses that are on Splits.
- **Direct + Shared** (the default): both together. This is their real
  spending.

A worked example: Tim pays $100.00 for groceries and $80.00 for a dinner split
25% Tim / 75% Joyce. Joyce pays $30.00 for shopping.

- Tim, Direct + Shared: $100.00 + $20.00 = **$120.00**
- Joyce, Direct + Shared: $30.00 + $60.00 = **$90.00**
- Household: **$210.00** (every entry once)
- Tim, Shared only: **$20.00**

Summary, Month and Entries all count the same way, so the numbers agree
everywhere. The Household view has no scope buttons because it always counts
every entry once. On a phone, Summary, Month and Entries keep the view and
scope in the floating **View and scope** bar ([On your phone](#on-your-phone)).

## Hide or show money totals

Totals start hidden on every new browser, so you can open the app around other
people. Every amount shows as `••••`: totals, transactions, splits, charts and
plan amounts. Amount fields you type into are masked too.

![With totals hidden, every amount shows as dots](/faq/guide/desktop/thumbs/money-hidden.webp)

1. Select the **eye button** at the top right (on a phone, the round floating
   eye button above the bottom navigation).
2. Amounts appear everywhere at once. Select it again to hide them.

The choice is remembered only in that browser. A different browser or a
cleared browser starts hidden again. The Money check-in stays hidden while
totals are hidden, because its sentences would reveal the same figures. Edit
forms also have a small eye button next to an amount, so you can check a
single figure without revealing the whole page.

> Tip: you can still import a bank file while totals are hidden. The file's
> raw text is screened until you reveal totals.

## Try it safely with the demo data

The demo household (Tim and Joyce, with sample accounts, a year of plans and
some shared expenses) is the best way to learn. Everything in this guide was
captured from it.

On the demo site, open **Settings** and use **Demo state**:

- **Reseed default demo** puts the sample data back exactly as it was.
- **Enter empty state** clears all money data (accounts, entries, imports,
  plans, splits) and keeps only the people and categories, so you can start
  fresh. You type `empty state` to confirm.
- **Reload app data** only reloads what is on screen.

These buttons are not shown on the real (private) app.

## On your phone

The app is designed for phones as well as desktops. The differences:

- **Bottom navigation.** Summary, Month, Entries and Splits sit at the bottom.
  The **•••** button opens Imports, Settings and FAQ.
  ![On a phone, the ••• button opens Imports, Settings and FAQ](/faq/guide/phone/thumbs/phone-more.webp)
- **View and scope bar.** On Summary, Month and Entries, a floating bar above
  the navigation shows who and what you are viewing (for example
  `Tim · Direct + Shared`). Month and Entries add previous and next month
  buttons beside it. Tap it to change the view first, then the scope.
  ![The floating View and scope bar opens a sheet to change person and scope](/faq/guide/phone/thumbs/phone-view-scope.webp)
- **Edit sheets.** Adding or editing a row opens a sheet from the bottom of
  the screen instead of editing inside the table. **Done** or **Save** saves;
  **Cancel**, the ✕ or tapping outside closes it without saving.
  ![Editing a plan row on a phone opens a sheet](/faq/guide/phone/thumbs/phone-month-sheet.webp)
- **Swipe months.** On Month and Entries, swipe left or right to move to the
  next or previous month.
- **Floating buttons.** The round **+** button adds an entry on Entries; on
  Splits, the receipt button adds a shared expense. The eye button hides or
  shows totals.

![Summary on a phone](/faq/guide/phone/thumbs/phone-summary.webp)

## On your iPhone

These are real iPhone Safari screenshots of the demo data, so you know what
to expect on your own phone. Add the site to your Home Screen from Safari's
Share menu to open it like an app.

![iPhone: Summary for Tim](/faq/guide/iphone/thumbs/01-summary.webp)

![iPhone: Month](/faq/guide/iphone/thumbs/02-month.webp)

![iPhone: Entries](/faq/guide/iphone/thumbs/03-entries.webp)

![iPhone: Splits in its dark orange theme](/faq/guide/iphone/thumbs/04-splits.webp)

![iPhone: Imports](/faq/guide/iphone/thumbs/05-imports.webp)

![iPhone: Settings](/faq/guide/iphone/thumbs/06-settings.webp)

![iPhone: FAQ](/faq/guide/iphone/thumbs/07-faq.webp)

![iPhone: Summary for the Household](/faq/guide/iphone/thumbs/08-household-summary.webp)

# The screens

Each screen in the order it appears in the navigation: what you see, what
each control does, the common tasks, and what changes on a phone.

## Summary

### What you see

- **Six cards**: Planned income, Actual income, Planned spend, Actual spend,
  Savings target and Realized savings, added up over the selected range.
- **Money check-in**: a short, plain-language reading of the figures on
  screen ([Use the Money check-in](#use-the-money-check-in)).
- **Spending Mix**: a donut of spending by category, with a list of
  categories below it.
- **Intent vs Outcome**: one card per month comparing planned and actual
  income, spending and savings.
- **Wallets in view**: the current balance of each account and whether a
  statement has confirmed it.

![Spending Mix and Intent vs Outcome side by side](/faq/guide/desktop/thumbs/summary-charts.webp)

### What each control does

- **Range** (top right): the months included, 12 by default. Use **‹** and
  **›** to move the whole range, or select the start or end month to pick one.
  ![Selecting the start of the range opens a month picker](/faq/guide/desktop/thumbs/summary-range-picker.webp)
- **Scope** (person views only): the small **Direct / Shared / Both** switch
  under the Summary title. Hover an option to see what it counts; one click
  switches ([Scopes](#scopes-direct-shared-direct-shared)).
- **Month chips** above the donut: **Range overall**, or one month.
- **A category in the list**: select it to hide or show it in the donut (it
  says Shown or Hidden). The **›** beside it opens that category's entries.
  The coloured icon changes the category's icon and colour.
- **A month card** in Intent vs Outcome: expand it for the planned, actual and
  variance table. The pencil edits that month's note.

![Wallets in view shows current balances and statement status](/faq/guide/desktop/thumbs/summary-wallets.webp)

### Common tasks

1. To see one person: select their name at the top left.
2. To check last year: select **‹** next to the range until the months you
   want are shown.
3. To find what drove spending: pick a month chip, then select **›** next to
   the biggest category to open those entries.

### On a phone

The cards scroll sideways. The range sits at the top. The person and scope
live in the floating **View and scope** bar above the navigation; tap it to
change either.

## Month

### What you see

- **Header**: the month, the person, the scope buttons and **Actions**.
- **Six cards**: Planned income, Planned spend, Remaining budget (planned
  income minus planned spend; it says Overplanned when negative), Actual
  spend, Savings target and Spend gap (planned minus actual).
- **Money check-in** for the month.
- **Income**: planned income sources.
- **Budget Buckets**: flexible budgets by category, such as Food or Taxi.
  Their actual comes from all entries in that category.
- **Planned Items**: fixed commitments such as savings, tithes, loans and
  subscriptions. Their actual comes from the entries you link to them.
- **Monthly Note**: why the month looked the way it did.
- **Accounts**: the tracked accounts.

### What each control does

- **Select a row** (anywhere outside its buttons) to edit it in place:
  category, item name, planned amount and note. **Save** keeps it, **Cancel**
  discards, **Delete** removes the row.
  ![Selecting a budget bucket opens it for editing in the table](/faq/guide/desktop/thumbs/month-edit-row.webp)
- **+ Add income source**, **+ Add budget bucket**, **+ Add planned item**:
  add a row to that section.
- **Link entries** (under a planned item's actual): choose which entries pay
  for that planned item ([Link planned items to entries](#link-planned-items-to-entries)).
- **Actions**: Duplicate month, Reset month, Delete month
  ([Duplicate, reset or delete a month](#duplicate-reset-or-delete-a-month)).
- **Draft a summary** (Monthly Note): drafts a note for you to edit when the
  optional writing assistant is switched on; otherwise it says it is off.

Actual amounts are read-only on Month. They always come from Entries, so
fixing an actual means fixing the entry.

### Common tasks

- Plan a month: [Plan a month](#plan-a-month).
- Start next month from this one: **Actions → Duplicate month**.

### On a phone

Rows open in an edit sheet. The view and scope live in the floating **View
and scope** bar, next to the previous and next month buttons. Swipe sideways
to change month.

![Month on a phone, with the View and scope bar above the navigation](/faq/guide/phone/thumbs/phone-month.webp)

## Entries

### What you see

- **Totals strip**: Spend, Income, Difference, Transfers and Outflow (Spend
  plus Transfers). In a person view, a shared row counts at the full amount
  first, with that person's share in brackets.
- **+ Add entry** and the **Money check-in**.
- **Filters**: refresh, Search, By wallet, By category, By type and **Reset
  filters**. Whose entries you see follows the view at the top left.
- **Days**: entries grouped by date, newest first, with each day's net.

Each row shows the category, description, note, wallet and owner, the amount,
and small labels such as **On splits**, **Matched transfer out** or the
owner's name.

### What each control does

- **Select a row** to edit it: Category, Date, Posted date, Wallet, Owner,
  Amount, Type (expense, income or transfer), Description and Note. The
  **Status** line says how well the bank has confirmed it
  ([Glossary](#words-used-in-the-app)).
  ![Selecting an entry opens its editor with Add to splits, Delete entry, Save and Cancel](/faq/guide/desktop/thumbs/entries-edit.webp)
- **Add to splits**: share this entry ([Split an expense](#split-an-expense)).
- **Delete entry**: asks you to confirm first.
- **Refresh** (circular arrows at the start of the filters): reload this
  month, for example after importing in another tab.
- **By wallet** lists every active account, even ones with no entries this
  month.

![Filtering Entries to one category](/faq/guide/desktop/thumbs/entries-filtered.webp)

If you pick the other person's wallet while viewing one person, and nothing
is shared, the page offers buttons to switch to the Household or that
person's view.

### Common tasks

- [Add an expense](#add-an-expense)
- [Edit or delete an entry](#edit-or-delete-an-entry)
- [Find an entry](#find-an-entry-filters-search-and-months)

### On a phone

The round **+** button adds an entry in a sheet. Rows open their editor in a
sheet too. The **View and scope** bar and month buttons float above the
navigation, and you can swipe between months.

![Entries on a phone](/faq/guide/phone/thumbs/phone-entries.webp)

## Splits

Splits has an intentional **dark orange theme**, on desktop and phone, so you
always know you are working on shared money rather than your bank ledger.

### What you see

- **Group buttons**: **Non-group expenses** plus your named groups (for
  example a trip or a baby fund). Each shows its currency, number of entries
  and your balance, such as "You owe Joyce $260.25" or "Settled up". The **+**
  creates a group.
- **Money check-in** for the selected group.
- **Search**, your balance, the group's spend, **Activity history** and
  **+ Add expense**.
- **Possible split links**: a reminder when imported bank rows may match
  splits you entered by hand ([Link a bank row to a split](#link-a-bank-row-to-a-split-you-entered-earlier)).
- **Archived batches**: groups you have already settled.
- **Activity**: the group's open expenses and settle-ups, by date.

### What each control does

- **Review matches**: compare imported bank rows with your manual splits.
- **Settle group**: record a payment that clears the selected group.
- **Simplify settlement**: combine all open groups in the same currency into
  one amount to pay.
- **Select an expense** to edit it in place: its form replaces the row, with
  **Save**, **Cancel** and **Delete**.
- **Activity history**: deleted and restored split records, with **Restore**.

Splits is not filtered by the month picker: it always shows what is still
open.

### Common tasks

- [Split an expense](#split-an-expense)
- [Track a trip in another currency](#track-a-trip-in-another-currency)
- [Settle up a group](#settle-up-a-group)
- [Restore a deleted split](#restore-a-deleted-split)

### On a phone

The view switch stays at the top, groups scroll sideways, and the round
receipt button adds a shared expense.

![Splits on a phone](/faq/guide/phone/thumbs/phone-splits.webp)

## Imports

### What you see

- **Import inbox**: your bank run, planned for you. It counts bank sessions to
  open, needed files, accounts that are current and split cleanup. For each
  bank it lists the steps, an **Open portal** link, and each file you still
  need (for example "Citi Rewards Aug 2026 statement").
- **Review order**: statements are reviewed oldest month first; optional
  activity files come after.
- **Import and certify**: where you add a file, in three steps: Select file,
  Data mapping, Review.
- **Recent imports**: every import batch, with its kind (PDF statement,
  Mid-cycle, CSV import or Manual), dates, account, status and a rollback
  button.

![Import and certify: choose the account, then paste or drop a file](/faq/guide/desktop/thumbs/imports-upload.webp)

### What each control does

- **Source label** and **Batch note**: optional names so you recognise the
  import later.
- **Default account** and **Default owner**: used for rows that do not say
  which account or person they belong to. Choose the account before dropping
  a card activity file.
- **CSV content**: paste CSV rows directly.
- **Drop a CSV, PDF, or XLS here**: drop or select one file. Drop several at
  once and they wait in the **File intake queue**; use **Load into review**
  on each.
- **Preview import**, **Commit import to ledger**, **Start over**: see
  [Import a bank statement](#import-a-bank-statement).
- **×** on a batch (Rollback import): undo it ([Undo an import](#undo-an-import)).

### On a phone

Imports is under the **•••** button. Everything works the same, one column
wide; dropping several files at once is easiest on a computer.

## Settings

Settings is a list of sections. Select a section's heading to open or close
it.

- **People**: rename the two household members.
- **Accounts**: add, edit, archive and reconcile accounts.
- **Apple Pay shortcut**: record Apple Pay purchases automatically.
- **Categories**: the categories used everywhere, with their icon and colour.
- **Category matching**: rules that categorise imported rows, plus
  suggestions and overlapping rules to review.
- **Balance trust rules**: what makes a balance trustworthy, and a list of
  known gaps (reconciliation exceptions).
- **Unresolved transfers**: transfers that are not paired yet.
- **Error diagnostics**: saved details of failed requests, for
  troubleshooting.
- **Recent balance activity**: changes that affected balances.
- **Demo state**: only on the demo site ([Try it safely](#try-it-safely-with-the-demo-data)).

![Accounts section with balances, statement status and Reconcile](/faq/guide/desktop/thumbs/settings-accounts.webp)

A number on the Settings tab means category suggestions are waiting for you;
selecting the tab opens Category matching.

### On a phone

Settings is under the **•••** button. Dialogs open as sheets.

## Help (FAQ)

The FAQ screen holds this guide. It has two tabs:

- **User guide**: how to use the app (this tab).
- **For developers**: setup, testing and technical notes. You never need it
  to use the app.

![The FAQ screen with its two tabs and table of contents](/faq/guide/desktop/thumbs/faq-tabs.webp)

Use **Contents** at the top to jump to a section. Links inside the guide jump
to other sections or open the screen they mention. On a keyboard, the left and
right arrow keys move between the two tabs. The address remembers the tab, so
you can bookmark or share a link to it.

### On a phone

FAQ is under the **•••** button. The tabs and contents sit at the top; tap a
picture to open it full size.

![The FAQ screen on a phone](/faq/guide/phone/thumbs/phone-faq.webp)

# How do I…

Step-by-step recipes. Each assumes you start from the screen named in step 1.

## Add an expense

1. Open **Entries** and choose the month at the top right.
2. Select **+ Add entry** (on a phone, the round **+** button).
3. Choose the **Category**, **Date**, **Wallet** (the account or card you
   paid with), **Owner** (who paid) and **Type** (Expense).
4. Type the **Amount** and a **Description**. Use the merchant name, such as
   `FairPrice` or `Grab`, so a later bank import can recognise it.
5. Add a **Note** if the reason matters later.
6. To share it straight away, open **Add this expense to Splits** at the
   bottom of the form.
7. Select **Save**. The entry appears under its day and the totals update.

![Adding an entry on Entries](/faq/guide/desktop/thumbs/entries-add.webp)

![Adding an entry on a phone opens a sheet](/faq/guide/phone/thumbs/phone-entries-add.webp)

Manual entries are marked **Manual provisional** until a bank file confirms
them ([Record entries before the bank file arrives](#record-entries-before-the-bank-file-arrives)).

## Edit or delete an entry

1. Open **Entries** and find the entry ([Find an entry](#find-an-entry-filters-search-and-months)).
2. Select the row. Its editor opens in place (a sheet on a phone).
3. Change any field and select **Save**, or **Cancel** to leave it as it was.
4. To remove it, select **Delete entry**, then confirm.

Good to know:

- If the entry is shared, changing its amount, date, description or owner
  updates the split too, keeping each person's percentage. Changing the note
  or category asks whether to update the split as well.
- On an entry a bank statement has confirmed, the bank details (date,
  description, wallet, amount, type) are locked. You can still change the
  category, note, owner and splits
  ([I can't change a statement-confirmed entry](#i-cant-change-a-statement-confirmed-entry)).
- If the entry is part of a settled split, some changes are refused until you
  undo the settle-up ([I can't change a split](#i-cant-change-a-split)).

## Plan a month

1. Open **Month**, select your name at the top left (Household is read-only)
   and choose the month.
2. Under **Income**, select **+ Add income source** and enter each expected
   income.
3. Under **Planned Items**, select **+ Add planned item** for each fixed
   commitment: savings, loan, insurance, tithes, subscriptions. Give each a
   category, date, name, planned amount and optionally an account.
   ![A new planned item opens as an editable row](/faq/guide/desktop/thumbs/month-add-planned.webp)
4. Under **Budget Buckets**, select **+ Add budget bucket** for flexible
   spending such as Food, Groceries, Transport and Shopping.
5. Select **Save** on each row.
6. Check the cards: **Remaining budget** should not say Overplanned, and
   **Savings target** should be what you want to put aside.

> Tip: keep budget buckets broad. One Food bucket works better than a row for
> every restaurant. Plan only what is stable as planned items.

Next month, use **Actions → Duplicate month** to copy the plan and adjust it.

## Link planned items to entries

A budget bucket's actual comes from every entry in its category. A planned
item's actual comes only from the entries you link, because several planned
items can share a category (for example Bills).

1. Open **Month** in your person view.
2. In **Planned Items**, select **Link entries** under the item's actual.
3. The list starts narrowed to likely matches. Use the chips **Linked**,
   **Same category**, **Same account** and **This month only**, or type in
   **Description filter**, to narrow it further.
4. Tick the entries that pay for this item.
5. Select **Save matches**. The actual and variance update.

![Match planned item: tick the entries that pay for this planned item](/faq/guide/desktop/thumbs/month-link-entries.webp)

The app remembers what you linked so it can suggest the same kind of entries
next month. It never links them without you.

## Duplicate, reset or delete a month

Open **Month**, choose the month, then select **Actions**.

![The Actions menu on Month](/faq/guide/desktop/thumbs/month-actions.webp)

- **Duplicate month** copies every plan row of this month into the next month
  and opens it. If the next month already has a plan, it just opens it and
  changes nothing.
- **Reset month** clears this month's plan rows, entries and totals. Type
  `reset month` and select **Confirm reset month**.
- **Delete month** removes the month entirely. Type `delete month` and select
  **Confirm delete month**.

Reset and delete cannot be undone, which is why they ask you to type the
words.

## Import a bank statement

1. Open **Imports**. The **Import inbox** lists the files you need, grouped
   by bank. Select **Open portal** to sign in to your bank, and download the
   listed files ([Which file do I download?](#which-file-do-i-download-from-my-bank)).
   No renaming needed.
2. Under **Import and certify**, choose the **Default account** the file
   belongs to (for a card activity export this matters most).
3. Drop the file on **Drop a CSV, PDF, or XLS here**, or select it. PDFs and
   bank exports turn straight into rows; a plain CSV first asks you to match
   its columns (**Data mapping**), then **Preview import**.
4. If the file names a card or account the app does not know yet (for example
   "Detected: UOB One Card"), choose which of your accounts it is under
   **Unknown accounts need mapping before commit**, or select **Create
   account**. **Commit import to ledger** stays disabled until every account
   is chosen.
   ![The file names a card the app does not know yet: choose the account](/faq/guide/desktop/thumbs/imports-mapping.webp)
5. Review the preview ([Read the import preview](#read-the-import-preview)).
   Fix anything under **Exceptions to resolve**.
6. Select **Commit import to ledger**. The rows appear on Entries, and the
   batch appears under **Recent imports**.

![A bank export turned into preview rows, ready to commit](/faq/guide/desktop/thumbs/imports-preview.webp)

![After committing, the batch appears under Recent imports](/faq/guide/desktop/thumbs/imports-committed.webp)

If the import may match splits you entered by hand, the app offers **Review
split matches** (or **Later**).

Select **Start over** at any time to clear the draft. Your original file is
never stored; only the rows you commit are saved.

## Which file do I download from my bank?

The Import inbox names each file. In general, download statement PDFs first
(oldest month first), then an activity export for the current month.

### UOB

- **Statements**: the monthly PDF for each card or account (credit cards,
  including one PDF with two cards such as UOB One Card plus UOB Privi Miles,
  and UOB One savings).
- **During the month**: the "current transactions" history as `.xls`, for a
  card or an account.

### OCBC

- **Statements**: OCBC 365 and OCBC Infinity Cashback card PDFs, OCBC 360
  account PDFs, and Child Development Account (CDA) PDFs.
- **During the month**: the transaction history `.csv` for a card or the 360
  account. Choose the OCBC account as the Default account first.

OCBC 360 activity has a transaction date and a value date. The app uses the
value date for the balance check, so a transfer on 31 May that clears on 2
June belongs to June's statement.

### Citibank

- **Statements**: the credit-card PDF (Citi Rewards and Citibank Miles
  layouts).
- **During the month**: the card activity `.csv`. Choose the Citibank card as
  the Default account before dropping it; the file has no headings, so the
  account tells the app how to read it.

### HSBC

- **Statements**: the HSBC Visa Revolution PDF. These are scanned images, so
  the app reads them with text recognition inside your browser (nothing is
  uploaded). It takes a little longer; check the rows against the PDF before
  committing, because scanned text can be misread.

### Any other bank

- Download a `.csv` export, paste or drop it, and match its columns under
  **Data mapping**. It can use one signed amount column or separate expense
  and income columns.
- A PDF no reader recognises can be offered to the optional writing assistant
  only if you tick the box to allow it. Its rows always start as **Needs
  review** and never save a statement balance.

## Read the import preview

The preview shows what will happen before anything is saved.

- **Counts**: how many rows will import, how many existing entries will be
  confirmed, how many are **already covered** (duplicates) and how many
  **need review**.
- **Exceptions to resolve**: the only things you must act on, such as an
  unknown account, an unknown category, a row decision or a statement that
  does not balance.
- **Statement account mapping** (PDFs): match each account found in the
  statement to one of yours, or select **Create account**. The new account's
  opening balance is filled in from the statement.
- **Statement checkpoint** (PDFs): the statement's dates and ending balance,
  saved when you commit. For a credit card, enter the amount owed as a
  positive number, as printed by the bank.
- **Rows**: each row can be **Exclude row** or **Include row**. A row marked
  **Matched to ledger** will confirm an entry you already have instead of
  adding a duplicate. **View match** compares the two side by side.
- **Already covered rows**: duplicates the app skipped. They stay visible; use
  **Include row** only if the match was wrong.

A statement preview shows **Matched** for each account when its balance
agrees with the bank. When every row is already in your ledger, the button
becomes **Refresh statement checkpoints**, which saves the proof without
adding duplicates.

## Fix a statement that does not balance

When a statement says **Mismatch**, the preview shows five boxes: **Before
statement period**, **Already in ledger during this period**, **PDF activity
in this preview**, **Rows the PDF can remove** and **Projected ledger after
preview**. Hover or focus a box to see exactly which dates and rows it uses.

1. Open **Already in ledger during this period** first. It lists entries
   already saved in that statement's dates that the PDF did not confirm.
2. For each row, select **Open** to see the entry in a new tab and compare it
   with the PDF:
   - In the PDF but not matched: check its date and amount on the entry.
   - Not in the PDF and not real: select **Delete** (or **Delete all** if the
     whole list is wrong).
   - Real, but the bank posted it after the statement closed: select **Set
     posted date** if your bank app shows the posted date, or **Defer** to
     move it to the next statement.
   - On the wrong card: change its wallet.
3. Check **PDF rows not included yet**: include any real statement row you
   excluded.
4. The check refreshes as you go. Commit once it says **Matched**.

If the listed rows add up to exactly the difference, fixing them will balance
the statement. Delete is only for rows that are missing from the bank, are
duplicates, or belong to another account.

## Undo an import

1. Open **Imports** and find the batch under **Recent imports** (use **By
   account** to narrow the list).
2. Select the **×** (Rollback import) at the end of the batch's row.
3. Check the name in the message and select **Confirm rollback** (or
   **Cancel**).

![Rolling back an import asks you to confirm](/faq/guide/desktop/thumbs/imports-rollback.webp)

What happens:

- Rows the import added are removed. Entries you had typed by hand that the
  import had matched go back to how you typed them, keeping later changes
  such as category, note or splits.
- Activity exports can always be rolled back.
- A PDF statement can be rolled back while it is the newest statement for
  that account. Older statements show **Statement locked**, because later
  statements depend on them. Roll back the newest first.
- A shared entry whose split is already settled can block a rollback until
  you undo that settle-up.

Rolling back is all or nothing, and a batch cannot be rolled back twice.

## Walk through a month of imports

This example uses a sample two-card statement (two credit cards on one PDF)
and activity exports that grow during the month.

1. **Import the first statement.** Map each card in the PDF to its account and
   check that both cards say Matched before committing.
   ![First statement: two cards mapped and both balance checks matched](/faq/guide/examples/thumbs/01-jan-two-card-pdf-mapped-and-matched.webp)
2. **Save proof without duplicates.** If you review the same statement again,
   every row is already covered and the button saves the statement balances
   only.
   ![All rows already covered: save the statement checkpoints only](/faq/guide/examples/thumbs/02-jan-two-card-pdf-all-duplicates-save-checkpoints.webp)
3. **Import activity during the month.** Each new export repeats earlier rows;
   the preview skips those and keeps only the new ones.
   ![A growing activity export: old rows skipped, new rows kept](/faq/guide/examples/thumbs/04-midcycle-snapshot-2.webp)
4. **Import the next statement.** Rows you already have are confirmed in
   place, keeping your categories, notes and splits. Only rows missing from
   your ledger are added.
   ![Next statement confirms earlier rows and adds one late row](/faq/guide/examples/thumbs/07-feb-two-card-pdf-duplicates-plus-late-row-matched.webp)
5. **If you exclude a real row by mistake**, only that card's check fails.
   Include the row again and both checks return to Matched.
   ![Excluding a real row makes only that card's check fail](/faq/guide/examples/thumbs/08-user-skipped-late-row-alpha-check-fails.webp)
6. **Commit.** Recent imports keeps every batch, so a mistake can be rolled
   back.
   ![Recent imports after the month's imports](/faq/guide/examples/thumbs/10-recent-imports-after-combined-flow.webp)

## Reconcile and close a statement period

Reconciling means proving your ledger matches the bank's closing balance.

The easy way is to import the statement PDF: when it says **Matched** and you
commit, the statement balance is saved and every row it confirmed becomes
**Statement certified**.

To save a balance by hand (for example, a bank the app cannot read):

1. Open **Settings → Accounts**.
2. Select **Reconcile** on the account.
3. Choose the **Statement month** and check the **Statement ending balance**
   (it starts with the app's current balance; type the bank's figure).
   Fill in **Statement start date** and **Statement end date** only for card
   cycles that do not follow the calendar month.
4. Select **Save checkpoint** (it becomes available once a month is chosen).

![Reconcile: save a statement closing balance for an account](/faq/guide/desktop/thumbs/settings-reconcile.webp)

The account then says "Reconciled to <month> statement", or how far off it
is. If it is off, use **Compare statement** to upload the PDF and see which
rows match, which are missing and which are extra, without importing
anything. Missing rows can be added and wrong directions fixed from there.

After a period closes:

1. Pair any transfers under **Settings → Unresolved transfers**.
2. Link any manual splits to their bank rows ([Link a bank row to a split](#link-a-bank-row-to-a-split-you-entered-earlier)).
3. Tidy categories and owners.
4. Leave the import in Recent imports, so it can be rolled back if needed.

## Record entries before the bank file arrives

You can keep the month current by hand (or with Apple Pay) and let the bank
confirm it later.

1. Add each purchase with the real merchant name, account, amount and date.
2. When the activity export arrives, import it. Rows that match your entries
   show as matches and confirm your entries instead of adding copies.
3. Keep truly new rows included. Leave exact and probable duplicates skipped.
   Check near matches yourself.
4. When the statement arrives, import it. Matching entries become
   **Statement certified**, keeping your category, owner, note and splits.

If the bank describes a purchase very differently, it may show as a near
match or not match at all. Compare account, amount and date before deciding.

## Split an expense

There are two ways, depending on where the expense is.

### From Entries (the bank row is already there)

1. Open **Entries** and select the entry.
2. Select **Add to splits**.
3. Pick the group from **Split group**. The split is created as soon as you
   choose; **Cancel** closes the box without sharing anything.
4. The split starts 50/50 with the entry's owner as the payer. Select
   **View split** to change the people, shares, group, category or note.

![Add to splits asks which group the entry belongs to](/faq/guide/desktop/thumbs/entries-add-to-splits.webp)

### From Splits (no bank row yet, or cash)

1. Open **Splits** and select the group.
2. Select **+ Add expense**.
3. Fill in **Date**, **Description**, **Category**, **Paid by** and
   **Expense total**.
4. Set the shares with the share percentage or an exact share amount. The
   preview shows each person's share. When a total does not divide evenly,
   choose who gets the odd cent.
5. Select **Save expense**.

![Create split expense: date, payer, category, total and shares](/faq/guide/desktop/thumbs/splits-add-expense.webp)

A split made here is not linked to a bank row yet. When the bank row arrives,
link it instead of adding it again ([Link a bank row to a split](#link-a-bank-row-to-a-split-you-entered-earlier)).

To change a split, select it in the activity list. The row turns into its
form: change the fields and select **Save**. To remove it, select **Delete**,
then **Delete split row**. A deleted split can be restored
([Restore a deleted split](#restore-a-deleted-split)).

![Selecting a split opens its form in place of the row](/faq/guide/desktop/thumbs/splits-edit.webp)

![Deleting a split asks you to confirm](/faq/guide/desktop/thumbs/splits-delete.webp)

## Link a bank row to a split you entered earlier

1. Open **Splits**. When bank rows may match splits you entered by hand, a
   banner says "possible split links".
2. Select **Review matches**.
3. Each card shows the **Existing split** next to the **Imported ledger row**,
   with how far apart the dates and amounts are.
4. Select **Match** to link them, or **Keep separate** if they are different
   purchases.
5. Select **Back** when you are done.

![Review matches compares a manual split with an imported bank row](/faq/guide/desktop/thumbs/splits-matches.webp)

A split can be linked to only one bank row.

## Track a trip in another currency

1. Open **Splits** and select **+** next to the groups.
2. Type a **Group name** (for example "Japan trip") and choose the **Group
   currency** (for example JPY).
3. Choose the **Purchase source**: **Cash only** for cash spending, or
   **Bank/card** for card purchases you will later match to your statement.
   Two groups (one of each) keep things simplest.
4. Select **Save group**.
5. Add expenses in the trip currency with **+ Add expense**.

![Create group with a name and a trip currency](/faq/guide/desktop/thumbs/splits-create-group.webp)

Inside a trip group every amount is shown in that currency (for example
"You owe Joyce JP¥6,000"), and the category donut counts only that currency.
Different currencies are never added together. A card expense can wait as
"Card statement pending" until the statement row arrives. Outside Splits,
the linked card row counts in dollars, split the same way.

## Settle up a group

1. Open **Splits** in your person view and select the group.
2. Select **Settle group**.
3. Check **Paid by**, **Received by** and the **Amount** (filled in with the
   balance), choose how it was paid, and add a note.
4. Select **Save settlement**.

![Record settlement for one group](/faq/guide/desktop/thumbs/splits-settle-group.webp)

The group's current batch closes and moves to **Archived batches**. New
expenses start a fresh batch. Other groups are not touched.

## Simplify settlement across groups

When you have several open groups in the same currency, **Simplify
settlement** works out one amount to pay for all of them.

1. Open **Splits** in your person view and select **Simplify settlement**.
2. The **Simplified settlement** panel shows who pays whom and how much. If
   the groups cancel each other out, nothing needs paying. **View included
   activity** marks the expenses it covers.
3. When the bank transfer appears, choose it in **Match a transfer…** and
   select **Match transfer**.
4. Already paid, but the transfer is not in the app yet? Select **Mark paid**.
   It moves to **Settled, awaiting bank match**; open that later and select
   **Match bank transfer**.

![A simplified settlement waiting for its bank transfer](/faq/guide/desktop/thumbs/splits-simplify.webp)

Undo options: **Undo paid** if you marked it paid too early; **Undo
simplification** to put all its expenses back into the open balance.
Different currencies are always settled separately.

## Undo a settle-up or simplification

Expenses that are part of a settle-up or a simplified settlement are locked:
their amount, currency, shares, payer, date and group cannot change, and they
cannot be deleted. Otherwise the settled amount would silently stop matching.

If you try, the save is refused and nothing changes. The message names the
settlement and offers a button:

1. Select **Undo settle-up** (for a settled group) or **Undo simplification**
   (for a simplified settlement). You can also open the batch in **Archived
   batches** and undo it there.
2. Your change is still in the form: select save again.
3. Settle again for the new balance.

Description, category, note and bank links stay editable without undoing.

## Restore a deleted split

1. Open **Splits** and select **Activity history**.
2. Find the deleted expense or settle-up.
3. Select **Restore**. It comes back with the same shares, group, currency and
   bank link.

![Activity history lists deleted splits with a Restore button](/faq/guide/desktop/thumbs/splits-history-restore.webp)

While a split is deleted, its entry counts in full for the person who paid.
If the split was already restored in another tab, the history says so and
nothing is restored twice.

## Record Apple Pay purchases automatically

On an iPhone, a Shortcut can save each Apple Pay purchase as an entry and
open it for you to check.

1. Open **Settings → Apple Pay shortcut** on your iPhone.
2. Under **Default account priority**, put the card you use most first. This
   account is used when Wallet does not say which card paid. Changes save
   straight away.
3. Select **Install Apple Shortcut**. The app copies your private connection
   and opens the Shortcut.
4. Select **Add Shortcut** (or **Replace** if you installed it before).
5. When Apple asks for the connection, paste it. The full address should stay
   visible.
6. In the Shortcuts app, open (or create) the **When I tap Wallet
   transaction** automation and choose **Run Immediately**.
7. Make the automation build a Dictionary with `value`, `merchant` and
   `name` from the transaction.
8. In its final **Run Shortcut** action, choose **Monies Map Apple Pay API**
   and pass it the Dictionary.

![The Apple Pay shortcut section in Settings](/faq/guide/desktop/thumbs/settings-shortcut.webp)

After a purchase, a notification shows the merchant, amount and account, and
the new entry opens so you can adjust it. The category comes from your
category rules (otherwise Other). Each iPhone installs its own copy.

Keep the private connection secret like a password: do not share screenshots
of it. If it leaks, generate a new key in the same section and reinstall on
every phone. If you used an older "Register Apple Pay transaction" Shortcut,
remove it so one purchase cannot create two entries.

## Use the Money check-in

Summary, Month, Entries and Splits each show a **Money check-in**: a short
reading of the figures on screen, in plain words. In a person view it talks
to that person.

1. Read the two-line preview and the highlighted pattern (for example your
   largest purchase or a category that dominated).
2. Select **Read full insight** for the full text, the **Money consequence
   map** and links to the records worth checking.
3. Select a **Review** link to open exactly those entries or matches.

![The full insight with its Money consequence map](/faq/guide/desktop/thumbs/summary-insight-expanded.webp)

The Money consequence map shows money left so far, where you stand against
the plan, a same-season comparison (when that month is in your range), and
how far bank statements confirm the figures. It never predicts the future or
tells you what is safe to spend. The check-in uses the app's own figures and
never changes them; money left after spending still has to cover bills,
transfers and savings.

On Month or Entries, **See income entries ($X)** opens exactly the income
entries it counted.

## Manage people

1. Open **Settings → People**.
2. Select the pencil next to the person and change the **Display name**.
3. Select **Save person**.

![People in Settings](/faq/guide/desktop/thumbs/settings-people.webp)

The new name appears in views, owners, filters and splits. On the private app,
your first visit can link your sign-in to one person; Splits then opens on
you. The account menu can unlink it or sign you out.

## Manage accounts and opening balances

1. Open **Settings → Accounts** and select **+ Add account**.
2. Fill in **Display name**, **Institution**, **Owner**, **Account type** and
   **Currency**.
3. Set the **Opening balance**: the balance just before your first imported
   transaction. For example, to start in June 2025, enter the closing balance
   of 31 May 2025.
4. Select **Create account**.

![Add account](/faq/guide/desktop/thumbs/settings-add-account.webp)

To change an account later, use **Edit account**. **Archive account** hides an
account you no longer use without touching its history. Each account shows
its balance, whether a statement confirms it, the last import and any
unresolved transfers.

Credit cards show what you owe as a negative balance. When you type a card
statement balance, enter the positive amount owed as printed by the bank.

## Manage categories and category matching

**Categories** holds every category with its icon and colour
([Default categories](#default-categories)). You can also change a category's
icon and colour by selecting its icon on Summary.

**Category matching** rules categorise imported rows before you commit:

1. Open **Settings → Category matching**.
2. Add a rule with the merchant text, the category and a priority.
3. Rules ignore capital letters, spaces and punctuation, and match any part
   of the bank text. Separate words with commas when all must appear: for
   example `paynow-fast, lunch` matches only rows containing both. Very short
   words must appear on their own. Lower priority numbers are checked first.

![Category matching shows overlapping rules to review](/faq/guide/desktop/thumbs/settings-category-rules.webp)

When you keep re-categorising similar rows, the app suggests a rule (a
number appears on the Settings tab). For each suggestion choose **Add rule**,
edit it first, or **Ignore**. Overlapping rules are listed first so you can
tidy them. Rules affect future imports only, never entries you already
committed.

## Review unresolved transfers

A transfer between your own accounts (for example paying a card from savings)
should appear twice: out of one account and into the other. Until both sides
are paired, balances can look wrong.

1. Open **Settings → Unresolved transfers**.
2. Choose a month; the list is paged, so a backlog can be worked through one
   statement period at a time.
3. Select **Manage transfer** to pair it, or **Open in entries** to fix the
   row.

**Balance trust rules** explains the three habits that keep balances
trustworthy: a correct opening balance, a checkpoint for each statement
month, and paired transfers. It also keeps **Reconciliation exceptions**: a
list of known gaps (a missing bank row, a timing difference) that should not
be forgotten. Adding one does not change any balance.

![Balance trust rules](/faq/guide/desktop/thumbs/settings-trust.webp)

## Find an entry: filters, search and months

1. Open **Entries** and choose the month with **‹** and **›** at the top
   right (on a phone, swipe or use the buttons by the View and scope bar).
2. Type in **Search**: merchant, note, wallet or amount.
3. Narrow with **By wallet**, **By category** and **By type**.
4. Select **Reset filters** to see everything again.

From Summary, the **›** beside a category opens Entries already filtered to
it. Filters stay in the address, so you can bookmark a filtered view.

# Troubleshooting

## The app stays on Loading

The app loads in small steps and shows a percentage. If a step takes too
long, it stops waiting and shows which part failed, with a button to try
again.

1. Select the retry button.
2. If it keeps failing, check your internet connection and reload the page.
3. On the private app, you may need to sign in again; reload and follow the
   sign-in page.
4. Still stuck? **Settings → Error diagnostics** keeps the details of failed
   requests for whoever looks after the app.

## "This page could not finish loading"

The page you opened could not get its data. Your saved data is not affected.
The page shows this message instead of old figures, so you never mistake last
month's numbers for this month's.

![A page that could not load, with Try loading again](/faq/guide/desktop/thumbs/page-load-error.webp)

Select **Try loading again**. A draft you had open is kept.

## "This page could not refresh. Saved changes are kept."

Your save worked, but the page could not reload the updated totals. Some
figures may be out of date until it refreshes.

- Select **Refresh now** to try again, or **Dismiss** to carry on.
- Moving to another page or month also clears it, because that page loads
  fresh data.

## "This page hit a problem and could not be shown"

Something went wrong while drawing the page. Your saved data is not affected.
Select **Try again**, open another page, or **Reload app**. If it says the
page needs a fresh copy of the app, reload: a new version was published.

## I can't change a split

The split is part of a settle-up or a simplified settlement, so its amount,
shares, payer, date and group are locked. See [Undo a settle-up or
simplification](#undo-a-settle-up-or-simplification). The same applies when
you edit a shared entry on Entries: a change that would move the settled
split is refused, with the same undo button.

## I can't change a statement-confirmed entry

An entry marked **Statement certified** was confirmed by a bank statement, so
its date, description, wallet, amount, type and transfer direction are locked.
You can still change the category, note, owner and splits.

If the bank details really are wrong, the statement import was probably
mapped to the wrong account or needs correcting: roll back the newest
statement for that account and import it again ([Undo an import](#undo-an-import)).
Renaming an account is only right when the account itself was named wrongly.

## An import was rejected or my file is not supported

- **Nothing happens or "Import needs attention"**: check the file is one of
  the supported types ([Which file do I download?](#which-file-do-i-download-from-my-bank))
  and that you chose the right **Default account** first.
- **A row description is blocked as too long or containing page text**: the
  reader merged part of the statement's small print into a row. Nothing was
  saved. Try a clean download of the file.
- **Unknown accounts need mapping before commit**: choose an account for each
  statement account, or **Create account**.
- **Unknown categories**: choose **Categorize as Other**, or map them.
- **Commit failed**: "No partial transactions were kept." Nothing was saved,
  so you can try again. For a very large file, import it in smaller parts.
- **Statement blocked, needs an earlier statement**: import the missing month
  first. Statements build on each other.

## Dates look one day off

The app's calendar is Singapore time. "Today" and the default date on new
entries follow the date in Singapore, wherever you are. Entry, month and
statement dates are plain calendar dates and never shift.

Card entries can have two dates: the day you paid (**Date**) and the day the
bank posted it (**Posted date**). Entries sorts by the day you paid;
statement checks use the posted date. A purchase on the last day of a
statement can therefore land on the next statement.

## A wallet balance looks wrong

1. Check the account's **Opening balance** in **Settings → Accounts**.
2. Check that the latest statement has a checkpoint (Reconcile).
3. Pair **Unresolved transfers**.
4. Look at **Recent imports** for overlapping imports.
5. Use **Compare statement** against the bank PDF.

A balance is opening balance plus income and transfers in, minus spending and
transfers out, so a missing, doubled or misdirected row explains most gaps.

## Are my bank files stored?

No. PDF statements and bank exports are read inside your browser. Only the
rows you commit, the import details and the statement balance are saved.
Refreshing the page or selecting **Start over** clears the draft. An import
saves every row or none of them.

# Glossary

## Words used in the app

- **Actual**: what really happened, taken from your entries.
- **Planned**: what you intended, from the Month plan.
- **Variance** or **Spend gap**: planned minus actual. Positive means you
  spent less than planned.
- **Planned item**: a fixed commitment (savings, loan, subscription) whose
  actual comes from the entries you link to it.
- **Budget bucket**: a flexible category budget whose actual comes from all
  entries in that category.
- **Entry**: one transaction in your ledger (the list on Entries).
- **Wallet** or **account**: a bank account or card you track.
- **Owner**: the person an entry or account belongs to.
- **Direct**: a person's own entries that are not shared.
- **Shared**: an entry that is on Splits. The person's shared amount is their
  share of it.
- **View**: whose money you see: Household or one person.
- **Scope**: what counts in a person view: Direct, Shared or Direct + Shared.
- **Split**: a shared expense, with each person's exact share.
- **Group**: a set of splits settled together, such as a trip. Each group has
  one currency.
- **Settle-up**: a payment between the two of you that clears a group's
  balance.
- **Batch**: a group's open splits since its last settle-up. Settled batches
  move to Archived batches.
- **Simplification** or **simplified settlement**: one combined amount for
  several open groups in the same currency.
- **Mark paid**: say a settlement was paid before its bank transfer appears.
- **Import**: bringing in a bank file. Each import is kept as a batch you can
  roll back.
- **Statement**: the bank's official monthly PDF.
- **Activity export** or **mid-cycle export**: a file of recent transactions
  you download between statements. Useful, but not final proof.
- **Statement checkpoint**: the bank's closing balance for one account and
  one statement period.
- **Reconcile**: prove your ledger matches the statement's closing balance.
- **Manual provisional**: an entry you typed (or Apple Pay created) that no
  bank file has confirmed yet.
- **Import provisional**: an entry from an activity export, not yet confirmed
  by a statement.
- **Statement certified**: an entry a bank statement has confirmed. Its bank
  details are locked.
- **Transaction date**: the day the purchase happened (shown as Date).
- **Posted date**: the day the bank recorded it. Statements close by posted
  date.
- **Value date**: the date a bank account movement counts for the balance
  (used by OCBC 360 activity files).
- **Exact, probable and near match**: how sure the app is that an imported
  row is already in your ledger, from certain to worth checking.
- **Already covered**: an imported row the app skipped as a duplicate.
- **Transfer**: money moving between your own accounts. It is neither
  spending nor income.
- **Unresolved transfer**: a transfer whose other side is not paired yet.
- **Reconciliation exception**: a known gap you are tracking until it is
  explained.
- **Money check-in**: the short reading of the figures on each screen.
- **Money consequence map**: the check-in's breakdown of money left, plan
  position and how well statements confirm the figures.

## Default categories

A new household starts with these categories. You can change their icons and
colours, and add your own.

:::categories
