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

## Current product scope

- Import CSV exports from banks and credit cards with row-level preview and
  duplicate highlighting
- Import supported PDF statements for UOB, Citibank, and OCBC, with statement
  checkpoints where the parser can prove the statement balance
- Import supported UOB current-transaction `.xls` exports as mid-cycle working
  ledger rows
- Track accounts owned by Tim, Joyce, or shared at the household level
- Assign transactions as direct, shared, income, expense, or transfer
- Use the Splits workspace for shared expenses, named groups, settle-up records,
  and matching ledger entries into shared batches
- Produce monthly and summary views from the committed ledger and plan rows
- Keep category, institution, account, icon, and color metadata in one place

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
The product workflow guide lives in
[`docs/git.md`](/Users/tim/22m/ai-projects/monies_map/docs/git.md) and captures
the current import, reconciliation, and splits workflows.

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

## Cloudflare deploy

The app is deployed to Cloudflare Workers with Cloudflare D1:

- production Worker: [https://monies-map.timsantos-accts.workers.dev](https://monies-map.timsantos-accts.workers.dev)
- D1 database name: `monies-map`
- D1 database id: `d1aa440c-d239-48ac-b0a6-d39f34e26e0e`

### Routine deploy

Deploy the current working tree only when the local changes are ready to go to
production. The repo requires Node 22 for local scripts:

```bash
source ~/.nvm/nvm.sh
nvm use 22
npm run deploy
```

`npm run deploy` builds the app and then runs `wrangler deploy`. Wrangler uses
[`wrangler.jsonc`](/Users/tim/22m/ai-projects/monies_map/wrangler.jsonc) to
publish the Worker, serve the built static assets from `dist`, and bind the
production D1 database as `DB`.

If the change depends on a schema update, apply the remote D1 migration before
deploying the code:

```bash
source ~/.nvm/nvm.sh
nvm use 22
npm run db:migrate:remote
npm run deploy
```

Before deploying real household data, make sure Cloudflare Access is enabled for
the Worker and restricted to the household email allowlist below.

The current production auth plan is Cloudflare Access in front of the Worker.
Use one-time PIN email auth first because it does not require setting up a
Google identity provider. Restrict access to:

- `mr.timothysantos@gmail.com`
- `hellojoyceli@gmail.com`

Once Google is configured as a Cloudflare Zero Trust identity provider, the
same Access application can be switched to Google login with the same email
allowlist.

### First-time setup

If this app is recreated in a new Cloudflare account:

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

5. Deploy using the routine deploy command above:

```bash
npm run deploy
```

6. In Cloudflare Dashboard, enable Access for the Worker:

```text
Workers & Pages -> monies-map -> Settings -> Domains & Routes -> workers.dev -> Access
```

Create an Access policy that allows only the two household emails above.

## What to build next

1. Expand the new D1-backed demo settings into real repositories for categories, month plan rows, and entry edits.
2. Add CSV import mapping profiles per institution.
3. Persist imports into D1 instead of previewing only.
4. Add category rules and merchant normalization.
5. Add manual review for unknown transactions, split logic, and transfer linking.
6. Generate the summary and month views directly from persisted ledger data.

## Product direction

This should not try to connect directly to banks first. Bank API connectivity is messy, country-specific, and fragile. CSV import plus statement upload gets you to a usable system much faster and matches how people actually extract data today.
