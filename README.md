# Monie's Map

Monie's Map is a Cloudflare-hosted household finance app for building a year-over-year spending map across multiple bank accounts, credit cards, and people in one system.

## Why this app exists

Your current spreadsheet already has the right business logic:

- monthly plan vs actual
- notes for unusual months
- personal vs household spending
- multiple banks and cards
- savings target visibility

The app turns that into a durable ledger so imports are repeatable and the summary is generated instead of manually maintained.

## First version scope

- Import CSV exports from banks and credit cards
- Support PDF statement uploads later, after CSV is stable
- Track accounts owned by you, your wife, or both
- Assign transactions as personal, joint, or split
- Produce monthly and yearly summaries
- Keep category, institution, and account-level views in one place

## Recommended stack

- Cloudflare Workers for API and edge hosting
- Cloudflare D1 for relational storage
- Cloudflare R2 later for raw statement file storage
- React + Vite frontend
- Worker asset pipeline serving the built frontend from `dist`

This is a good fit because the app is mostly forms, uploads, categorization, and reporting. It does not need a heavy server footprint.

## Current scaffold

This repo is currently a scaffold, meaning the foundational structure is in place
but the production features are not finished yet.

Right now it includes:

- a Worker entrypoint and React + Vite frontend shell
- a first-pass schema for imports, transactions, splits, notes, and transfers
- typed DTOs and bootstrap data shaped like the real app
- a D1-backed demo settings layer for reseeding believable prototype data
- a UI shell for `Summary`, `Month`, `Entries`, `Imports`, and `Settings`

It does not yet include:

- full D1-backed repositories for app edits
- a finished CSV import review flow
- persistent editing
- Google login
- production AI analysis

The intended workflow is local-first: finish the product shape locally, iterate
on demo data and imports, then connect the same repo to Cloudflare.

The user-facing FAQ lives in [`docs/faq.md`](/Users/tim/22m/ai-projects/monies_map/docs/faq.md)
and should be kept updated as the app changes.

## Data model

Core entities in [`schema.sql`](/Users/tim/22m/ai-projects/monies_map/schema.sql):

- `households`: one top-level household
- `people`: you and your wife
- `institutions`: UOB, Citi, DBS, and so on
- `accounts`: each bank account, credit card, loan, or investment account
- `imports`: each import batch
- `import_rows`: raw row-level import traceability
- `transactions`: normalized ledger entries
- `transaction_splits`: split a charge between two people
- `transfer_groups`: linked transfer pairs between accounts
- `monthly_notes`: summary and monthly notes for analysis context
- `monthly_budgets`: target budget by month/category/person
- `monthly_snapshots`: generated monthly rollups for the dashboard

## Environment

Recommended local environment:

- Node.js `22`
- npm
- Git

This repo includes an [`.nvmrc`](/Users/tim/22m/ai-projects/monies_map/.nvmrc) file:

```bash
nvm install
nvm use
node -v
```

If you do not use `nvm`, install Node 22 manually.

## Local development

Cloudflare account setup is not required to start local development.

From the repo root:

```bash
npm install
npm run db:migrate
npm run dev
```

If you start the repo on the wrong Node major, the local scripts now fail
immediately with a clear message instead of leaving Vite up while the Worker
API exits in the background.

Then open:

- [http://localhost:5173](http://localhost:5173)

Do not open `http://localhost:8787` for normal frontend work. That is the Worker
API/dev server, not the Vite UI server, so React hot reload will not work there.

If `127.0.0.1:5173` is refused on your machine, use `localhost:5173`. Vite may be
bound to `localhost` only in local development.

What these commands do:

- `npm install`
  - installs React, Vite, Recharts, Wrangler, TypeScript, and related tooling
- `npm run db:migrate`
  - applies [`schema.sql`](/Users/tim/22m/ai-projects/monies_map/schema.sql) to the local D1 database
- `npm run dev`
  - runs Vite on `5173` and the Worker API on `8787`
  - Vite on `5173` is the URL that auto-refreshes when you edit frontend files

## Suggested workflow

The recommended flow is:

1. Run the app locally.
2. Review the scaffolded UI and data model.
3. Give product and UX feedback before wiring Cloudflare production resources.
4. Build the real import flow locally first.
5. Replace demo bootstrap data with D1-backed data.
6. Deploy to Cloudflare only after the local product shape is stable.

Yes, you can and should give feedback now before setting up Cloudflare.

Yes, the app can be developed locally first with demo data and then with real
CSV import flows before deployment.

## Deploy later

When you are ready to use real Cloudflare resources:

1. Log in:

```bash
npx wrangler login
```

2. Create the D1 database:

```bash
npx wrangler d1 create monies-map
```

3. Copy the returned `database_id` into [`wrangler.jsonc`](/Users/tim/22m/ai-projects/monies_map/wrangler.jsonc).

4. Apply the schema remotely:

```bash
npm run db:migrate:remote
```

5. Deploy:

```bash
npm run deploy
```

## What to build next

1. Expand the new D1-backed demo settings into real repositories for categories, month plan rows, and entry edits.
2. Add CSV import mapping profiles per institution.
3. Persist imports into D1 instead of previewing only.
4. Add category rules and merchant normalization.
5. Add manual review for unknown transactions, split logic, and transfer linking.
6. Generate the summary and month views directly from persisted ledger data.

## Product direction

This should not try to connect directly to banks first. Bank API connectivity is messy, country-specific, and fragile. CSV import plus statement upload gets you to a usable system much faster and matches how people actually extract data today.
