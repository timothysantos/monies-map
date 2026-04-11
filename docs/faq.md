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
- splits view with group pills, manual split expenses, settle-up records, and a
  matches review mode
- manual single-entry creation from the entries view
- imports view
- FAQ view
- demo data shaped like the intended product and planning model
- a settings view for reseeding and refreshing the current demo bootstrap, plus
  editing household member display names
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

Planned items and budget buckets match actuals differently. Planned items are
matched explicitly to one or more ledger entries, because several planned items
can share a category such as `Bills`. Budget buckets remain category-driven and
roll up the remaining actual expense entries for that category.

After a planned item is matched, the app remembers lightweight matching hints
from the linked ledger entries so future months can suggest likely matches. It
does not auto-link them yet; the user still confirms the matches.

Monthly planning is person-based first. Tim and Joyce can have different month
plans, and the household month view should be derived by combining those plans,
not by maintaining a separate duplicate household plan.

The point is not only to log transactions. The point is to compare plan versus
actual and understand why the month moved.

## Can I rename the household members?

Yes. The Settings page now lets you edit the two household member display names.
Those names flow through person views, entry ownership filters, and split
labels. In empty-state mode the app seeds neutral defaults instead of generic
placeholder labels.

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

## Where is the production app deployed?

The current Cloudflare Worker deployment is:

[https://monies-map.timsantos-accts.workers.dev](https://monies-map.timsantos-accts.workers.dev)

It uses the Cloudflare D1 database `monies-map`.

Before using real household data, protect the Worker with Cloudflare Access.
The fastest setup is one-time PIN email auth, restricted to:

- `mr.timothysantos@gmail.com`
- `hellojoyceli@gmail.com`

Google login can be added later by configuring Google as a Cloudflare Zero Trust
identity provider and keeping the same email allowlist.

## What does the demo assume right now?

The current demo uses a believable household scenario that can be reseeded from
the in-app settings view. The default category catalog also persists through
reseed, local wipes, and the current empty-state path, so imports still start
from the same baseline set of categories, icons, and colors.

## What is the Splits view for?

`Splits` is the shared-expense workspace.

It is intentionally separate from `Entries`:

- `Entries` is the bank and card ledger
- `Splits` is where manual shared expenses, named groups, settle-up records,
  and shared-expense matching live

That separation keeps the CSV import flow focused on ledger review instead of
mixing bank cleanup with Splitwise-style matching decisions.

The current `Splits` surface includes:

- `Non-group expenses` plus named group pills
- context-aware owed or owing copy on each pill
- entry counts on the pills
- a `Matches` pill that replaces the activity list with review candidates
- manual `Add expense` flow
- manual `Settle up` recording flow
- `Add to splits` from the entries editor for promoting a ledger expense into
  the shared-expense layer

Imported shared rows or transfer rows can then be matched later from `Matches`
instead of from the import screen itself.

`Splits` is driven by open unsettled batches, not by the month picker:

- each group has one current open batch
- recording `Settle up` closes that batch
- closed batches remain visible below as muted history
- a later expense can start a new current batch for the same group, even if the
  date is backdated

When you use `Add to splits` from the entries editor, the app treats the entry
owner or owning account as the payer. If the ledger row is still direct, it is
converted to shared first with a default `50/50` transaction split, then the
linked split expense is created under `Non-group expenses`.

## What are the default app categories?

The current default category catalog is:

- `Income` — icon `receipt` — color `#1F7A63`
- `Transfer` — icon `arrow-right-left` — color `#C97B47`
- `Savings` — icon `receipt` — color `#7C8791`
- `Investments` — icon `banknote` — color `#8FAE4B`
- `Salary` — icon `badge-dollar-sign` — color `#22B573`
- `Extra Income` — icon `banknote-arrow-up` — color `#D5A24B`
- `Other - Income` — icon `wallet-cards` — color `#B8875D`
- `Subscriptions MO` — icon `washing-machine` — color `#E96A7A`
- `Subscriptions YR` — icon `washing-machine` — color `#F08FA0`
- `Food & Drinks` — icon `utensils` — color `#F7A21B`
- `Shopping` — icon `shopping-bag` — color `#D4B35D`
- `Family & Personal` — icon `users` — color `#4F8FD6`
- `Home` — icon `house` — color `#F85A53`
- `Church` — icon `church` — color `#F062A6`
- `Tax` — icon `banknote` — color `#CC63D8`
- `Groceries` — icon `shopping-cart` — color `#F08B43`
- `Travel` — icon `plane` — color `#567CC9`
- `Loans` — icon `wallet-cards` — color `#A06C5B`
- `Sports & Hobbies` — icon `dumbbell` — color `#66D2CF`
- `Bills` — icon `lightbulb` — color `#62C7B2`
- `Education` — icon `graduation-cap` — color `#7D86F2`
- `Insurance` — icon `shield` — color `#5EA89B`
- `Fees` — icon `receipt` — color `#8B78E6`
- `Beauty` — icon `receipt` — color `#D56BDD`
- `Entertainment` — icon `clapperboard` — color `#FFA51A`
- `Healthcare` — icon `heart-pulse` — color `#D86B73`
- `Gifts` — icon `gift` — color `#C98A5A`
- `Other` — icon `wallet-cards` — color `#717379`
- `Public Transport` — icon `bus` — color `#56A4C9`
- `Taxi` — icon `car-front` — color `#BDD93C`

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

Yes, locally. The app supports CSV review, row-level cleanup, and commit into
the local ledger.

The current import review supports either:

- one signed `amount` column
- separate `expense` and `income` columns

You can also override the inferred entry type, amount, account, category,
owner, split, and note in the preview table before commit.
