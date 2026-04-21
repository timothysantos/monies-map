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
- Create a new account directly from a detected PDF statement account when the
  import should not be matched to an existing account, using extracted details
  such as institution, account name, account type, and balance where available
- Import supported UOB current-transaction `.xls` exports as mid-cycle working
  ledger rows
- Track accounts owned by the primary person, partner, or shared at the household level
- Assign transactions as direct, shared, income, expense, or transfer
- Use the Splits workspace for shared expenses, named groups, settle-up records,
  and matching ledger entries into shared batches
- Produce monthly and summary views from the committed ledger and plan rows
- Keep category, institution, account, icon, and color metadata in one place
- Manage account, category, person, and category-rule settings from the app
- Keep local, demo, and production environments visibly separated with
  environment banners and production-only guardrails

## Recommended stack

- Cloudflare Workers for API and edge hosting
- Cloudflare D1 for relational storage
- Cloudflare R2 later for raw statement file storage
- React + Vite frontend
- Worker asset pipeline serving the built frontend from `dist`

This is a good fit because the app is mostly forms, uploads, categorization, and reporting. It does not need a heavy server footprint.

## Current app status

The app is now a working Cloudflare Workers + D1 finance ledger, not just a UI
scaffold. It has a persisted domain model, D1-backed repositories, import
preview and commit flows, statement reconciliation checkpoints, settings
management, and separate local, demo, and production deployment paths.

The main working surfaces are:

- `Summary`, with income as the first metric followed by planned spend, actual
  spend, savings target, and realized savings
- `Month`, with plan-vs-actual monthly views generated from committed data
- `Entries`, with ledger filtering, categorization, transfer handling, and
  transaction detail editing
- `Imports`, with CSV, PDF statement, and UOB `.xls` preview flows before commit
- `Splits`, with shared expense groups, settle-up records, and ledger matching
- `Settings`, with editable household metadata and local/demo-only demo-state
  controls

Authentication is intentionally handled outside the app by Cloudflare Access in
production. The app does not implement its own username/password or OAuth
session layer; use Cloudflare Access one-time PIN or Google as described in the
deployment section below.

The remaining product direction is about deeper automation and coverage rather
than basic persistence: broader bank parser support, richer reconciliation
workflows, export/backup tooling, and future AI analysis over the ledger and
notes.

The intended workflow remains local-first: develop against local D1, verify
imports and settings locally, deploy to the public demo when useful, then deploy
to production only when the change is ready for real household data.

Detailed user-facing and operational setup now belongs in this README. Narrow
implementation notes can still live under [`docs/`](docs/) when they are too
specific for the README.
The product workflow guide lives in
[`docs/git.md`](docs/git.md) and captures
the current import, reconciliation, and splits workflows.

## Data model

Core entities in [`schema.sql`](schema.sql):

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

This repo includes an [`.nvmrc`](.nvmrc) file:

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
  - applies [`schema.sql`](schema.sql) to the local D1 database
- `npm run dev`
  - runs Vite on `5173` and the Worker API on `8787`
  - Vite on `5173` is the URL that auto-refreshes when you edit frontend files

## Suggested workflow

The recommended flow is:

1. Run the app locally.
2. Apply local migrations with `npm run db:migrate`.
3. Use the import preview screens to test CSV, PDF statement, or UOB `.xls`
   files before committing rows to the ledger.
4. Manage accounts, categories, people, and category rules in Settings.
5. Deploy to demo when you want a public fake-data environment.
6. Deploy to production only after Cloudflare Access is configured for the real
   household allowlist.

Local and demo environments expose demo-state controls for reseeding or emptying
fake data. Production hides those controls and returns `403` for the demo-state
API routes.

## Cloudflare deploy

The app is deployed to Cloudflare Workers with Cloudflare D1:

- local development uses Vite on [http://localhost:5173](http://localhost:5173)
  and Wrangler on `8787`; it shows a thin green `local` banner and allows
  demo-state controls.
- production uses [`wrangler.jsonc`](wrangler.jsonc), Worker
  [https://<your-worker-host>](https://<your-worker-host>), D1 database
  `monies-map`, and D1 database id `d1aa440c-d239-48ac-b0a6-d39f34e26e0e`.
  It should be protected by Cloudflare Access, shows no environment banner, and
  hides demo-state controls.
- demo uses [`wrangler.demo.jsonc`](wrangler.demo.jsonc), Worker
  [https://monies-map-demo.timsantos-accts.workers.dev](https://monies-map-demo.timsantos-accts.workers.dev),
  D1 database `monies-map-demo`, and D1 database id
  `db26f82f-49d5-496e-93c0-d9035bb1f814`. It sets
  `APP_ENVIRONMENT=demo`, shows a thin blue `demo` banner, and allows
  demo-state controls.

### Command reference

The repo requires Node 22 for local scripts:

```bash
source ~/.nvm/nvm.sh
nvm use 22
```

Use these commands from the repo root:

```bash
npm run dev                  # local UI + Worker API
npm run build                # production frontend bundle
npm run db:migrate           # local D1 schema
npm run db:migrate:remote    # production D1 schema
npm run db:migrate:demo      # demo D1 schema
npm run deploy:prod          # build + deploy only production
npm run deploy:demo          # build + deploy only demo
npm run deploy:all           # build once, deploy production and demo
npm run deploy               # alias for deploy:prod
npm run db:empty-production  # terminal-only production empty-state reset
```

### Production deploy

Deploy the current working tree only when the local changes are ready to go to
production:

```bash
npm run deploy:prod
```

`npm run deploy:prod` builds the app and then runs `wrangler deploy`. Wrangler uses
[`wrangler.jsonc`](wrangler.jsonc) to
publish the Worker, serve the built static assets from `dist`, and bind the
production D1 database as `DB`.

If the change depends on a schema update, apply the remote D1 migration before
deploying the code:

```bash
npm run db:migrate:remote
npm run deploy:prod
```

Before deploying real household data, make sure Cloudflare Access is enabled for
the Worker and restricted to the household email allowlist below.

The current production auth plan is Cloudflare Access in front of the Worker.
Use one-time PIN email auth first because it does not require setting up a
Google identity provider. Restrict access to:

- primary household email
- partner household email

### Production auth with Cloudflare Access and Google

Start with Cloudflare Access one-time PIN email auth if you want the quickest
private production deployment. Cloudflare documents enabling Access for a
`workers.dev` route under
[Manage access to workers.dev](https://developers.cloudflare.com/workers/configuration/routing/workers-dev/#manage-access-to-workersdev).

To use Google login instead, configure Google as a Cloudflare Zero Trust
identity provider, then keep the same Access allowlist policy:

1. In Cloudflare Zero Trust, find the team domain under Settings -> Team name
   and domain.
2. In Google Cloud Console, create or select a Google Cloud project, configure
   the OAuth consent screen, then create an OAuth client with application type
   `Web application`.
3. In the Google OAuth client, set Authorized JavaScript origins to:

```text
https://<your-team-name>.cloudflareaccess.com
```

4. In the Google OAuth client, set Authorized redirect URIs to:

```text
https://<your-team-name>.cloudflareaccess.com/cdn-cgi/access/callback
```

5. Copy the Google OAuth Client ID and Client secret.
6. In Cloudflare Zero Trust, go to Integrations -> Identity providers, add
   Google, and paste the Client ID and Client secret.
7. Test the Google identity provider in Cloudflare.
8. In the production Access application for the Worker, allow only the primary
   and partner household emails.

Official references:

- [Cloudflare Google identity provider setup](https://developers.cloudflare.com/cloudflare-one/integrations/identity-providers/google/)
- [Google OAuth 2.0 for web server applications](https://developers.google.com/identity/protocols/oauth2/web-server)

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

3. Copy the returned `database_id` into [`wrangler.jsonc`](wrangler.jsonc).

4. Apply the schema remotely:

```bash
npm run db:migrate:remote
```

5. Deploy using the routine deploy command above:

```bash
npm run deploy:prod
```

6. In Cloudflare Dashboard, enable Access for the Worker:

```text
Workers & Pages -> monies-map -> Settings -> Domains & Routes -> workers.dev -> Access
```

Create an Access policy that allows only the two household emails above. Use
the one-time PIN identity provider at first, or use the Google OAuth setup above
after the Google identity provider has been tested.

### Demo deploy

The public demo runs as a separate Worker and D1 database so it can be shared
without exposing real household data:

```bash
npm run db:migrate:demo
npm run deploy:demo
```

The demo uses [`wrangler.demo.jsonc`](wrangler.demo.jsonc), deploys the Worker
as `monies-map-demo`, and binds the `monies-map-demo` D1 database. Do not enable
Cloudflare Access on the demo if it should stay login-free. A login-free demo is
public and mutable, so keep it limited to fake data.

To deploy both Workers from the same build:

```bash
npm run deploy:all
```

`npm run deploy` remains an alias for the production-only deploy path.

### Production empty-state reset

The in-app demo-state reset controls are only available in local and demo
environments. Production hides that section, and direct POST calls to
`/api/demo/reseed` or `/api/demo/empty` return `403`.

If production must be cleared, use the local terminal command below. It requires
repo access, Cloudflare Wrangler credentials for this account, and a typed
confirmation. It is not exposed through the app UI or public API:

```bash
source ~/.nvm/nvm.sh
nvm use 22
npm run db:empty-production
```

The command will prompt for the exact text `empty state`. If confirmed, it
empties the production D1 database `monies-map`, writes `demo_settings` in
empty-state mode, and relies on the next app bootstrap to recreate only the
blank reference household, people, categories, and category rules.

## What to build next

1. Broaden parser and mapping coverage for more banks, cards, and export
   formats.
2. Add richer reconciliation tools for statement balances, pending rows, and
   import-batch review.
3. Add backup, export, and restore workflows before relying on production for
   long-term household records.
4. Store raw statement files in R2 if retaining source documents becomes useful.
5. Add production AI analysis over ledger data, statement notes, and monthly
   explanations after the core workflows are stable.

## Product direction

This should not try to connect directly to banks first. Bank API connectivity is messy, country-specific, and fragile. CSV import plus statement upload gets you to a usable system much faster and matches how people actually extract data today.
