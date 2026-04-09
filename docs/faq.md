# FAQ

This is a living FAQ for Monie's Map.
It should be updated whenever setup, workflow, scope, or user-facing behavior
changes.

## What is Monie's Map?

Monie's Map is a household finance app for planning and tracking money across
multiple bank accounts, credit cards, personal expenses, shared expenses,
transfers, and monthly notes in one system.

The core questions behind the app are:

- what did I intend?
- what happened?
- was the difference justified?
- did that hurt savings?
- what assumption was wrong?

## What does the app include right now?

- summary dashboard
- monthly planning dashboard
- entries view
- imports view
- FAQ view
- demo data shaped like the intended product and planning model
- a settings view for reseeding and refreshing the current demo bootstrap
- React + Vite frontend talking to the existing Worker API
- category colors and icons as first-class metadata for charts and category cards

## What is the planning model?

The app separates a month into two layers:

- planned items
- budget buckets

Planned items are intentional commitments or recurring obligations. These are
the rows near the top of the month, such as savings, tax, subscriptions, house
loan, insurance, and other known items.

Budget buckets are flexible categories, such as food, groceries, transport, and
shopping. These are not supposed to predict every single merchant in advance.

Monthly planning is person-based first. Tim and Joyce can have different month
plans, and the household month view should be derived by combining those plans,
not by maintaining a separate duplicate household plan.

The point is not only to log transactions. The point is to compare plan versus
actual and understand why the month moved.

## What does over-granular mean here?

Over-granular means planning too many unstable or one-off spending lines as if
they were fixed commitments.

Examples of over-granular planning:

- separate planned rows for lots of ad hoc shopping items
- budgeting individual restaurant visits instead of a food bucket
- creating many rows that change name or meaning every month

Based on the June to October sheets, the current approach already looks fairly
flexible. The top portion behaves like planned items, and the highlighted lower
section behaves like budget buckets. That is a reasonable structure to carry
into the app.

## What is still in progress?

- full D1-backed persistence for edits
- CSV import review and commit flow
- editing and saving changes
- Google login
- in-app AI analysis

## What does the demo assume right now?

The current demo uses a believable household scenario with:

- Tim salary: SGD 3,000
- Joyce salary: SGD 3,000
- household salary: SGD 6,000

Those assumptions can be reseeded from the in-app settings view.

## Why does household monthly view behave differently from person view?

At the household level, `Direct ownership` is not very meaningful as a primary
planning lens. The household monthly view should focus on:

- `Combined`: both people's direct plans plus shared plans, merged into one
  household view
- `Shared`: shared-only planning rows

In person views, shared rows are supposed to be weighted to that person's split.
If a shared dining row is split 55/45, Tim should see the 55% subtotal and
Joyce should see the 45% subtotal. The full shared transaction can still be
shown alongside it for context.

## Why do notes matter so much?

The app should not treat notes as decoration. Notes explain why a month is
unusual, whether that was intentional, and whether the explanation matches the
data.

That matters even more for life changes and irregular periods, such as pregnancy,
birth, travel, medical expenses, family events, or seasonal commitments.

## Are category colors and icons just frontend decoration?

No. They should live in the data model so the donut chart, category cards, and
future reports all use the same category presentation. The UI can expose this
through an inline edit surface on the category icon instead of hiding it behind
an old-style settings page.

## Can I run it locally before Cloudflare?

Yes. Local development comes first. Review and iterate on the app locally
before wiring Cloudflare resources.

The current setup runs as two local processes during development:

- Vite for the frontend
- Wrangler for the Worker API

If the app sits on `Loading...` and the browser console shows `/api/bootstrap`
returning `500` plus a JSON parse error, the usual local cause is that Vite is
still running while the Worker API failed to start. This repo expects Node 22
for local scripts, so run `nvm use` from the repo root and restart
`npm run dev`.

## Can it know the real balance of each wallet?

It can compute a running wallet balance from the ledger, but only from what has
been imported locally.

Each account now has an opening balance. The displayed wallet total is:

- opening balance
- plus imported income
- plus transfer-ins
- minus expenses and transfer-outs

That makes balances internally consistent from a known starting point, but it
is still not the same as live bank sync. If imports are incomplete, the app can
still differ from the bank.

The app now supports statement checkpoints too. You can save a month-end bank
balance for an account, and the latest checkpoint is compared against the
computed ledger. Account health then shows whether the ledger matches, is off,
or still needs a checkpoint. It also surfaces the latest import time and any
unresolved transfers that could make a balance look wrong.

The import workflow now also flags possible duplicate rows already in the
ledger and warns when the preview overlaps the date range of previous completed
imports for the same accounts. This is not full reconciliation, but it is meant
to catch the most common CSV trust mistakes before commit.

Those duplicate warnings are now a bit smarter than a raw exact hash check. The
app shows both exact matches and near matches based on amount, account, date
proximity, and description similarity so you can spot likely overlaps before
committing a CSV.

Settings also shows a lightweight recent activity log for balance-affecting
actions like imports, opening-balance edits, checkpoints, entry edits, and
transfer link changes.

Each account’s reconciliation dialog also keeps checkpoint history, so you can
review more than the latest month-end proof, and unresolved transfers now have
a larger review surface in Settings that links back into Entries for cleanup.

## Does it already support real CSV import?

Not yet. The import preview path exists, but the real review-and-commit import
flow still needs to be built.
