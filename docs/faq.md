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

- real D1-backed persistence
- CSV import review and commit flow
- editing and saving changes
- Google login
- in-app AI analysis

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

## Does it already support real CSV import?

Not yet. The import preview path exists, but the real review-and-commit import
flow still needs to be built.
