# For developers

This tab is for people who run, test, deploy or change Monie's Map. Everyday
use of the app is in the User guide tab. Commands assume the repository root
and Node 22.23.0 or newer (`nvm use`).

# Set up and run locally

## How do I run the app on my computer?

Local development comes first; no Cloudflare account is needed to start.

```bash
nvm use
npm install
npm run db:migrate
npm run dev
```

`npm run dev` runs two processes: Vite (the UI) on `5173` and Wrangler (the
Worker API) on `8787`. Open `http://localhost:5173`; `8787` is the API only
and has no hot reload. If `127.0.0.1:5173` is refused, use `localhost:5173`.

Local development shows a thin sticky green `local` banner at the top of the
page so it is visually distinct from deployed environments. Local and demo
environments show the Demo state controls in Settings (reseed the demo or
enter empty state); production hides them and returns `403` for
`/api/demo/reseed` and `/api/demo/empty`.

If the app sits on `Loading...` and the browser console shows `/api/app-shell`
or a page route returning `500` plus a JSON parse error, the usual local cause
is that Vite is still running while the Worker API failed to start. Run
`nvm use` and restart `npm run dev`. The scripts refuse to start below the
supported Node version.

## What does the demo data contain?

Fresh databases start in empty-state mode. That blank slate keeps only reference
data: the household record, the two default people, and the category catalog.
There are no demo accounts, entries, imports, statement checkpoints, month plan
rows, snapshots, split records, or balances in the ledger until you add or
import them.

When you use `Enter empty state` from Settings, the app waits for the reset
request to finish, reloads the bootstrap data, and checks that accounts are gone
before closing the confirmation. If accounts still appear, refresh the page and
confirm the reset ran against the same database as the app you are viewing.

The current demo uses a believable household scenario, but it only appears after
you explicitly reseed the demo from the in-app settings view. The default
category catalog persists through reseed, local wipes, and the empty-state path,
so imports still start from the same baseline set of categories, icons, and
colors. Some internal modules still use `demo` naming for the original seed
fixtures, but app totals are derived from D1 rows rather than hardcoded fixture
amounts.

The local and test Workers seed the demo around the month set in
`DEMO_SEED_MONTH` (see `wrangler.test.jsonc`).

The public demo Worker uses a second, deeper dataset: the showcase. When a
Worker sets `DEMO_DATASET` to `showcase` (`wrangler.demo.jsonc` does), reseed
replaces the household with a fictional couple, Ethan and Serene, and 17
months of history ending today: six accounts with statement imports and
checkpoints (one card deliberately off by $42.80, one unresolved transfer),
month plans with under-, on- and over-plan months, notes, category rules, a
yen trip split, settled split batches and a simplification. It is built by
`src/domain/demo-showcase-data.ts` and written in one batch by
`src/domain/app-repository-showcase-seed.ts`; `tests/demo-showcase.test.mjs`
checks it. The guide screenshots use the showcase too (see [How do I
regenerate the screenshots?](#how-do-i-regenerate-the-screenshots)). With
`DEMO_DATASET` unset (local, test) reseed produces the default demo exactly as
before. The presenter's walkthrough is
`docs/demo-tour.md`.

## Which commands matter day to day?

```bash
npm run dev                  # local UI + Worker API
npm run build                # production frontend bundle
npm run verify               # audit, types, lint, unit, build, bundle budget, smoke
npm run test:unit            # unit and parser contracts
npm run test:e2e:smoke       # smoke bundle on isolated stacks (part of verify)
npm run test:e2e:sharded     # full browser suite on parallel isolated stacks
npm run check:bundle         # first-screen bundle budget
npm run docs:screenshots     # regenerate the guide screenshots
```

The full command reference, including database and deploy commands, is in
`README.md` under "Command reference".

# Testing

## How are the browser tests organised?

`npm run test:e2e` runs the whole Playwright suite serially with one worker
against Vite on `5173` and Wrangler on `8787` (it reuses servers already on
those ports outside CI).

`npm run test:e2e:sharded` runs the same suite faster as parallel shards. It
builds `dist/` once. Then each shard starts its own stack on its own ports
(Vite `5501+`, Wrangler `8901+`, inspector `9501+`) with its own local D1 in
`.wrangler/state-shard-N`, and runs its spec files with one worker. At the end
it merges every shard into `playwright-report/` and
`test-results/e2e-sharded/report.json`, prints one pass/fail summary, and
removes the shard servers and state. Shard logs are in
`test-results/e2e-sharded/logs/`.

To run a second sharded suite at the same time (another worktree or session),
move its ports with `E2E_PORT_OFFSET`, for example
`E2E_PORT_OFFSET=20 npm run test:e2e:sharded` uses Vite `5520+`, Wrangler
`8920+` and inspector `9520+`.

```bash
npm run test:e2e:sharded -- --shards 3            # choose the shard count
npm run test:e2e:sharded -- tests/e2e/month-page.spec.js
npm run test:e2e:sharded -- -- --grep "Month"     # Playwright options for every shard
npm run test:e2e:sharded -- --update-weights      # refresh tests/e2e/shard-weights.json
```

The run fails if any test fails, or if the merged test count differs from
`playwright test --list`. Whole spec files are shared out using the measured
times in `tests/e2e/shard-weights.json`; refresh them with a full passing
`--update-weights` run after adding a spec. `npm run test:e2e:smoke` runs the
smoke bundle through the same runner on two stacks.

`npm run test:e2e:webkit` runs the tests tagged `@webkit` in WebKit with an
iPhone profile. It needs `npx playwright install webkit` once and is not part
of `verify`.

GitHub's checks run the same tests in headless Chromium on Linux, which
differs from a Mac in two ways a test must allow for. Linux's default sans
fonts set text a little wider and taller, so do not rely on a layout that fits
only with the Mac's fonts or on where the middle of a cell lands (tap the
control you mean; extra `letter-spacing` imitates wider text on any machine).
And a synthesized touch
drag (`Input.synthesizeScrollGesture`) does not scroll the page there, so a
touch test first checks that a drag scrolls at all, as
`tests/e2e/mobile-sheet-focus.spec.js` does.

## How do I check the app on an iPhone?

iPhone checks use WebKit (Safari's engine) through Playwright with an iPhone
device profile: `npm run test:e2e:webkit` for the tagged tests, and the phone
screenshots in `npm run docs:screenshots`. Neither needs the iOS Simulator.
To check a real iPhone, open the app in Safari on the phone, connect it to a
Mac, enable Web Inspector on the phone (Settings → Apps → Safari → Advanced),
and use Safari's Develop menu on the Mac to inspect the page.

## Which gates must pass before a merge?

`npm run verify` is the local merge gate: `npm audit`, strict TypeScript for
the Worker and the client, lint, unit and parser contracts, the production
build, the first-screen bundle budget (`npm run check:bundle`) and the smoke
bundle. Run the full browser suite (`npm run test:e2e:sharded`) before merging
a change to shared route, settings, import, entry, month or split behaviour.
The house rules are in `AGENTS.md`.

# Guides and screenshots

## How are these guides built?

The FAQ page has two tabs. The User guide renders `docs/user-guide.md`; this
tab renders `docs/developer-guide.md`. Each file is its own lazy chunk: the
user guide loads when the FAQ page opens, the developer guide only when this
tab opens (`?faq=developers` in the address). Neither touches the first-screen
bundle.

The guides use a small Markdown subset parsed by `src/client/guide-markdown.js`:
a first `#` title, later `#` lines as parts, `##` sections (listed in the
contents), `###` subsections, paragraphs, lists, `>` tips, fenced code,
`**bold**`, inline code, links and images on their own line. Every heading
gets an id from its text. Link inside a guide with `#section-id`, across tabs
with `?faq=developers#section-id` or `?faq=user#section-id`, and to app
screens with a path such as `/entries`. `tests/guide-content.test.mjs` fails
when a link, anchor or image does not resolve, or when developer-only terms
leak into the user guide.

When a screen changes, update the matching User guide section in the same
change and regenerate the affected screenshots.

## How do I regenerate the screenshots?

```bash
npm run build
npm run docs:screenshots
```

`scripts/capture-guide-screenshots.mjs` starts its own isolated stack (Vite
`5442`, Wrangler `8842`, inspector `9442`, D1 in `.wrangler/state-guide`), so
it never touches `5173`/`8787` or your local data. Its Worker runs the
showcase demo data (Ethan and Serene, as on the demo site) with
`DEMO_DATASET=showcase` and a fixed `DEMO_SEED_MONTH` (`SEED_MONTH` in the
script), so every run captures the same data. Most shots show the month
before the seed month, the last complete one. It reseeds the demo data,
reveals money totals, walks each workflow at desktop 1280×800 and on an
iPhone 13 profile, and writes WebP files plus thumbnails under
`public/faq/guide/desktop/`, `public/faq/guide/phone/` and
`public/faq/guide/iphone/`. Pass shot names to capture only some
(`npm run docs:screenshots -- summary-household`), or `--list` to print them.
It needs `dist/` for the Worker assets, so build first. The Import inbox
counts missing files against today's month, so it shows the showcase's
single missing statement only in the seed month; when regenerating in a
later month, pass that month with `--seed-month 2026-10` (or move
`SEED_MONTH`) and check the guide's worked examples against the new shots.

The "On your iPhone" gallery in `public/faq/guide/iphone/` (`01-summary` to
`08-household-summary`) is shot by the script on the iPhone 13 profile in
WebKit and saved at the smaller iphone size, so it follows the current UI.
Real iPhone Safari captures (for example from the iOS Simulator) can still
replace them with `npm run docs:screenshots -- --import-iphone <dir>`.
The import walkthrough pictures in `public/faq/guide/examples/` come from a
synthetic two-card statement and are kept as they are.

# Deploy and hosting

## Where is the production app deployed?

[https://monies-map.timsantos-accts.workers.dev](https://monies-map.timsantos-accts.workers.dev)

It uses the Cloudflare D1 database `monies-map`.
The Worker is configured as a single-page app, so refreshing nested routes such
as `/entries` should reload the React app instead of returning a Cloudflare 404.

Before using real household data, protect the Worker with Cloudflare Access. The
app reads Cloudflare Access identity headers and can link a signed-in email to a
household member, but it does not implement standalone OAuth itself.

The fastest Access setup is one-time PIN email auth, restricted to:

- primary household email
- partner household email

Google sign-in can be used by configuring Google as a Cloudflare Zero Trust
identity provider and keeping the same email allowlist.

The public demo deployment is:

[https://monies-map-demo.timsantos-accts.workers.dev](https://monies-map-demo.timsantos-accts.workers.dev)

It uses the separate Cloudflare D1 database `monies-map-demo` and intentionally
does not require Cloudflare Access. Without Access, the app has no authenticated
viewer email, so login-to-person linking is unavailable and users switch between
household/person views manually. Keep the demo database limited to fake data
because anyone with the URL can make changes. The demo app shows a thin sticky
blue `demo` banner at the top of the page.

The demo runs the showcase dataset (`DEMO_DATASET` is `showcase` in
`wrangler.demo.jsonc`; walkthrough in `docs/demo-tour.md`). To refresh it,
deploy, then reseed once so the history ends in the current month:

```bash
npm run deploy:demo
curl -X POST https://monies-map-demo.timsantos-accts.workers.dev/api/demo/reseed
```

Reseed from Settings, Demo state works too. A deploy alone keeps the data
that is already stored; only a reseed switches to the showcase or moves its
months forward.

## How do I deploy to production?

Use the Cloudflare deploy steps in `README.md` ("Cloudflare Deploy"). The
routine production path is to use Node 22.23.0 or newer, then run
`npm run deploy:prod`. Use `npm run deploy:demo` for only the public demo, or
`npm run deploy:all` to build once and publish both Workers. If the app change
depends on a schema update, run the matching D1 migration before deploy.

If production is deployed but does not load, follow
`docs/production-debugging-runbook.md`. Start with Cloudflare Access and
Worker logs before redeploying, because Access can block a request before the
Worker runs.

## Can I stay signed in for a week?

Yes, when the production app is protected with Cloudflare Access. This is an
Access setting, not an app setting: set the Monie's Map application's session
duration to `7 days`, then ensure every Access policy that can match the app
uses the same duration or inherits the application duration. A shorter matching
policy wins, so check that no one-time-PIN, device, or identity policy overrides
it with a shorter session.

Use a week only on a personal, locked device. Shorten the Access session again
for shared devices or if the sign-in context should expire sooner.

# Apple Pay Shortcut internals

The user-facing install steps are in the User guide
([Record Apple Pay purchases automatically](?faq=user#record-apple-pay-purchases-automatically)).
This part documents the endpoint, payload and release process.

## How does direct entry creation work?

Yes, but it should use the dedicated shortcut endpoint, not the normal browser
entry API and not the quick-entry URL flow.

Use this method when the shortcut should create the row immediately and then
open the saved entry. Use the quick-entry URL method when you want a prefilled
draft that the user still reviews before saving.

The production endpoint is:

- `POST https://monies-map-shortcuts.timsantos-accts.workers.dev/api/shortcuts/entries/create`

Use the connection copied by Settings rather than typing this URL. Local and
test environments can still use the relative `/api/shortcuts/entries/create`
route.

It is separate from the existing quick-entry URL, which still only opens the
Entries composer. The shortcut endpoint actually creates the ledger row and
returns:

- `entryId`
- `created` (`false` when a retry returns the already-created row)
- normalized `date`, `description`, `amountMinor`, and `currency`
- `accountId`, `accountName`, and `accountResolution`
- `openUrl`

`openUrl` deep-links back into Entries with the created row already opened in
the editor. It now opens `/entries` directly with the created row plus the
month, view, and wallet context already in the URL, so the shortcut avoids a
separate lookup redirect before the normal Entries page can render.

### Security model for the shortcut endpoint

The verified shared shortcut is public, but it contains no API key and no
household-specific connection URL. During installation, Apple asks for the
private connection URL that Monies Map copied. That URL contains a token and
must be treated like a password.

The main app remains behind Cloudflare Access. A separate public Worker accepts
only the direct-create path, has no app assets, and returns `404` for every
other route. The app-owned token is therefore the authentication boundary for
shortcut requests, while Settings, imports, entries, and the rest of the app
still require Cloudflare Access.

The endpoint accepts the token in one of three places:

- the verified install flow uses the `shortcut_token` query parameter in the
  private connection URL
- advanced clients can use the `X-Monies-Shortcut-Token` header
- advanced clients can use a Bearer `Authorization` header

It accepts only `POST`; other methods return `405 Method Not Allowed` and do
not reach the shortcut creation workflow.

Advanced clients may also send `X-Monies-Shortcut-Nonce` and
`X-Monies-Shortcut-Timestamp`. They must send both or neither. When both are
present, the server rejects expired requests and replayed nonces. The verified
Apple shortcut uses token-only authentication because Apple setup questions can
configure one URL reliably without exposing blank header rows to the user.

HTTPS protects the connection in transit, but a token embedded in a URL may be
visible in the installed shortcut and infrastructure request logs. Do not share
screenshots or exports that show it. Generate a new key and reinstall the
shortcut if it is exposed. Because one household key can be used by multiple
devices, rotate and update every installed household shortcut together.

### How do I configure the server secret?

Open Settings -> Apple Pay shortcut. The normal install flow generates a key
when needed, saves it, and copies the private connection URL automatically.
There are no header or JSON key names to type.

Choose the default account priority used when Wallet does not identify the
account. Moving an account saves the new order immediately and shows a status
message. API key and default-param edits under More shortcut settings still use
Save shortcut settings.

The Settings screen explains the priority in plain words ("If the shortcut
doesn't name an account, entries go to the first account in this list."). The
exact rule: when the direct-create API request omits both `accountId` and
`accountName`, or the quick-entry URL omits both `account` and `account_id`,
the server (or the quick-entry draft) uses the first active account in this
priority order.

The app-managed key is stored in app settings and takes priority over the
Cloudflare environment token. Existing deployments can still use a Cloudflare
Worker secret named:

- `SHORTCUT_INGEST_TOKEN`

Example fallback setup:

```bash
npx wrangler secret put SHORTCUT_INGEST_TOKEN --config wrangler.shortcuts.jsonc
```

Use a long random value. Saving a key in Settings lets you rotate the Shortcut
key without logging in to Cloudflare.

Before using this in production, also apply the database migration so replay
protection and app-managed shortcut settings storage exist:

```bash
npm run db:migrate:remote
```

### What body should the shortcut send?

Send JSON.

Required fields:

- `date`
- `description` or `merchant`
- either `amountMinor` or `amount`

`accountId` or `accountName` is optional. An explicit account must identify an
active account. Without one, an exact, unique Wallet `name` match selects that
active account; otherwise the API uses the first active account in Settings ->
Apple Pay shortcut -> Default account priority. `accountResolution` in the
response reports `explicit`, `wallet_name`, or `priority`, so the Shortcut can
show what happened instead of silently guessing.

The endpoint also applies Settings -> Apple Pay shortcut -> More shortcut
settings -> Default shortcut params before the JSON body, so values sent by the
shortcut always win.

If `ownerName` is omitted, a direct entry uses the selected account's owner.
Shared-expense allocation is managed by linking the saved ledger row to a split
expense.

Common payload:

```json
{
  "date": "2026-04-25",
  "description": "Bus fare",
  "amount": "SGD 4.20",
  "accountName": "UOB One",
  "requestId": "apple-pay-20260822190730123",
  "clientVersion": "apple-pay-api-2026-08-22-v3",
  "categoryName": "Transport",
  "ownershipType": "direct",
  "ownerName": "Tim",
  "entryType": "expense",
  "note": "Created from Shortcut"
}
```

`amount` can be a positive decimal number or Wallet-style text such as `SGD
12.34` or `S$1,234.56`. The API preserves cents and rejects ambiguous decimal
or thousands separators and ambiguous bare currency symbols. If the amount
names a currency, it must match the selected account. `amountMinor` also works
if the caller already uses integer cents; when both forms are sent, they must
agree.

Dates should use `YYYY-MM-DD`. Strict ISO timestamps and legacy day-first dates
such as `27/04/2026` remain accepted, but malformed ISO-looking text is rejected.
Descriptions are normalized and limited to 500 characters; notes are limited to
2,000. Rejected requests save nothing.

### Which shortcut payload fields are optional, and what are their defaults?

The shortcut endpoint accepts these optional fields:

- `accountId`
- `accountName`
- `merchant`
- `name`
- `currency`
- `categoryName`
- `entryType`
- `transferDirection`
- `ownershipType`
- `ownerName`
- `offsetsCategory`
- `note`
- `requestId`
- `clientVersion`
- `view`

Defaults and behavior:

- `categoryName`
  - optional
  - defaults to `Other`
  - ignored for transfer entries, because transfer rows are forced to category
    `Transfer`
- `entryType`
  - optional
  - defaults to `expense`
- `transferDirection`
  - optional
  - only used when `entryType` is `transfer`
  - defaults to `out` for transfer entries
- `ownershipType`
  - optional
  - defaults to `direct`
- `ownerName`
  - optional
  - defaults to the selected account's owner for direct entries
- `note`
  - optional
  - defaults to empty / no note
- `requestId`
  - optional for custom clients
  - sent by the verified Shortcut so a network retry returns the same entry
    instead of inserting a duplicate
  - supported only for direct ownership entries; shared-expense state has a
    separate split lifecycle
- `name`
  - optional Wallet card context
  - an exact active-account match selects that account; otherwise it can serve
    as the description fallback when `description` and `merchant` are empty

Fields with no server default:

- `date`
- `description` or `merchant`
- `amountMinor` or `amount`

If any of those are missing after Settings defaults are applied, the shortcut
request is rejected.

### How do I install the Apple Shortcut?

1. Open Settings -> Apple Pay shortcut.
2. Put the card used most often first under Default account priority.
3. Select Install Apple Shortcut. Monies Map saves the connection, copies it,
   and opens the repository-owned Apple-signed shortcut file.
4. Select Add Shortcut. If this device already has `Monies Map Apple Pay API`,
   choose Replace.
5. When Apple shows the plain-text setup field for the Monies Map connection
   URL, paste the copied value. The full URL should remain visible after the
   paste.
6. On the iPhone, open the existing When I tap Wallet Transaction automation.
   Choose Run Immediately when that option is available. If no such automation
   exists yet, create one first.
7. In that automation, create a Dictionary with `value`, `merchant`, and `name`
   populated from the Wallet transaction. If the existing automation already
   creates this dictionary, leave it unchanged.
8. In the automation's final Run Shortcut action, replace
   `Register Apple Pay Transaction` with `Monies Map Apple Pay API`, and pass
   that Dictionary as the shortcut input.

The installed shortcut's first action must read from the named `Shortcut Input`
variable. If Apple displays the source as the generic `Input`, open that action,
tap its input, and select `Shortcut Input` explicitly. This is separate from the
Wallet Dictionary's `value` field.

This is one automation calling one shared shortcut. The older
`Register Apple Pay transaction` shortcut is not an additional required step;
once the new flow saves a test transaction successfully, remove or disable the
old shortcut target so one Wallet tap cannot create two ledger entries.

The shortcut sends Wallet amount, merchant, card `name`, ISO date, a client
version, and a per-run request ID directly to Monies Map. On success it shows
`Saved <merchant> • <amount> • <account>`, reads `openUrl` from the response,
and opens the saved entry for optional edits. The request ID makes an HTTP retry
idempotent. The private connection URL is the POST destination stored during
setup; it is not included in the JSON body.

When the shortcut does not send an explicit category, the server applies the
same active category-match rules used by imports. A matching rule can therefore
classify a merchant such as `SUBWAY` before the entry is saved; if no rule
matches, the entry uses `Other` and can be corrected in the editor.

Apple personal automations are device-local and cannot be packaged inside the
downloaded shortcut, so the Transaction automation remains the one required
manual step on each iPhone.

### Is the downloaded shortcut tied to the owner's Mac, iPhone, or iCloud?

No. There are three separate artifacts with different jobs:

- The repository contains the reviewable secret-free plist source.
- The app serves a checksum-verified Apple-signed file that anyone can import.
- Installation creates a local copy in that device's Shortcuts library.

The project owner may keep `Monies Map Apple Pay API Source` in a personal
Shortcuts library as an editing convenience, but the app does not read it and
it is not needed for installation. Losing or changing that personal copy does
not lose the source or release.

The older iCloud link is a superseded v1 snapshot and is not used by Settings.
The current signed file is replaced only by a reviewed repository release and
deployment. Existing installed copies do not update automatically; local edits,
renames, replacement, or deletion affect only that device.

### What should I choose when Apple says the shortcut already exists?

Choose `Replace` when upgrading the installed `Monies Map Apple Pay API`.
Replacement changes only the local copy on that device. It does not overwrite
the repository release, the owner's source, or another person's shortcut.

Choose `Keep Both` only when intentionally preserving the old local copy as a
backup. A normal installation should keep one active shortcut with the exact
name `Monies Map Apple Pay API`, because that is the shortcut selected by the
Wallet automation.

A first-time user, including another household member, sees `Add Shortcut`
instead. Every iPhone installs its own copy, pastes the private connection, and
configures its own device-local Wallet automation. If the household key is
rotated, every device using that key must install or configure the new private
connection.

### How is a new shortcut version released?

Start from the committed plist source, keep its setup Text action blank, and
confirm no private connection or token is present. After testing, sign the
unsigned `.shortcut` with Apple's `shortcuts sign --mode anyone` command. Apple
receives it for validation during signing.

Commit the readable source, exact signed release, byte-identical public download,
size, action contract, and checksums under `shortcuts/apple-pay-api/`. Update the
Settings install contract, browser test, both guides, and manifest in the same release.
Deploying changes the file offered to future installations; existing devices
keep their local copy until the user installs the new version and chooses
Replace.

### What does the installed direct-create shortcut contain?

The verified shortcut has no empty key rows and no embedded account secret. Its
setup question targets a plain Text action, whose output supplies the URL for
one POST `Get Contents of URL` action. This avoids Apple's multi-item URL editor,
which can clear a complete connection URL pasted during shortcut installation.
The POST has a JSON body with exactly these keys:

- `amount`
- `description`
- `date`
- `name`
- `requestId`
- `clientVersion`

After the POST succeeds, the shortcut extracts `openUrl` and `accountName`,
opens the URL, and shows a notification containing the Wallet merchant, amount,
and resolved account. If no `openUrl` is returned, it reads `error` and shows a
not-saved notification instead of calling Open URLs with a blank value.

Account, category, ownership, and owner are resolved from the Settings defaults.
Advanced custom shortcuts can add any optional API fields documented above.

Expected response shape:

```json
{
  "ok": true,
  "entryId": "txn-...",
  "created": true,
  "date": "2026-04-25",
  "description": "Bus fare",
  "amountMinor": 420,
  "currency": "SGD",
  "accountId": "acct-uob-one",
  "accountName": "UOB One",
  "accountResolution": "wallet_name",
  "openUrl": "https://monies-map.timsantos-accts.workers.dev/entries?editing_entry=txn-...&month=2026-04&view=household"
}
```

## How does the quick-entry URL work?

Yes. iOS Shortcuts can use a Wallet transaction automation to open the Entries
page with a prefilled expense draft. The app does not save the row
automatically; it opens the draft so the user can review the merchant, amount,
account, category, and owner before tapping Save.

Use a URL like this:

```text
https://monies-map.timsantos-accts.workers.dev/entries?action=add-expense&amount=12.34&merchant=Starbucks&date=2026-04-22&account=UOB%20One&category=Food%20%26%20Drinks
```

Supported query parameters are:

- `action=add-expense`
- `amount`
- `merchant` or `description`
- `date`, preferably `YYYY-MM-DD`
- `account` or `account_id`
- `category`
- `owner`
- `note`

`account` or `account_id` is optional. If neither is sent, the app uses the
first active account in Settings -> Apple Pay shortcut -> Default account
priority. The quick-entry URL also applies the Default shortcut params under
More shortcut settings first, then lets explicit URL parameters override them.

After the app reads the parameters, it removes them from the URL so refreshing
the page does not reopen the draft.

### Step-by-step shortcut setup for the quick-entry URL method

1. Create a Wallet transaction automation in Shortcuts.
2. Add `Receive transaction as input`.
3. Add `Text`.
4. Build a URL like:

```text
https://monies-map.timsantos-accts.workers.dev/entries?action=add-expense&amount=<Amount>&merchant=<Merchant>&date=<ISO date>&account=<Account name>&category=<Category>
```

5. Use the Wallet transaction variables inside that text:
   - `Amount`
   - `Merchant`
   - transaction date, formatted as `YYYY-MM-DD`
   - card or account name
6. Add `Open URLs`.
7. Save the automation with `Run Immediately` if you want it to trigger without
   an extra approval step.

What happens next:

1. The app opens Entries with a prefilled draft.
2. The draft is not saved yet.
3. The user reviews the fields and taps `Save`.
4. The query parameters are stripped from the URL after the draft is loaded so a
   normal refresh does not reopen it.

Quick-entry Apple Pay rows are provisional ledger entries. If a later bank
activity export or PDF statement contains the same transaction, import preview
compares against those manual rows by account, amount, nearby date, and merchant
similarity. CSV and XLS rows that duplicate a manual entry should be skipped.
Supported PDF statement rows can certify the matching manual entry in place,
preserving the category, owner, splits, and notes while replacing bank-facing
facts such as posted date and statement description.

# How imports and matching work

## How do PDF statements and mid-cycle exports differ internally?

Supported PDF statements are the strongest import source in the app. Treat them
like a bank-sync checkpoint for the account and statement period: the statement
certifies posted date, description, amount, direction, and ending balance after
the parser has reconciled the statement structure.

In product terms, this whole matching workflow is `entry reconciliation`. In
accounting terms, it is the transaction-matching part of bank reconciliation.

Mid-cycle CSV or XLS exports and manual quick entries are still useful for
keeping the working ledger current, but they are provisional until the official
statement arrives. When a PDF statement row matches a provisional mid-cycle or
manual ledger row, the app promotes the existing row instead of creating a
duplicate. That preserves user-added category choices, notes, ownership, splits,
and links while updating the bank-facing facts from the statement.

If a mid-cycle row and the final PDF use different dates for the same bank
event, the final PDF owns the bank date lanes. When the PDF carries both a
transaction or event date and a posted date, certification sets
`transaction_date` from the PDF event date and `post_date` from the PDF posted
date. Entries stays event-first; statement checks and checkpoints use the
posted statement date.

For bank and deposit accounts, mid-cycle CSV exports can also have two dates.
OCBC 360, for example, uses `Transaction date` and `Value date`. The value date
is the date that belongs to statement balance reconciliation, so the app imports
that as the bank-facing date and keeps the transaction date as event context. A
May 31 transfer with a June 2 value date should therefore not make the May
statement go out of balance.

Older OCBC 360 activity rows may show the value date only in the note, for
example `value date: 2026-06-02`. On startup the app repairs those rows by
putting that value into the posted-date lane when the row did not already have a
separate posted date, so statement checks use the bank-cleared date.

If the official PDF row only has one printed date, the app treats that date as
the bank's full evidence for the event. Certification updates both
`transaction_date` and `post_date` to that statement date.

Sometimes a mid-cycle export contains a provisional row that the final PDF does
not include. The PDF can supersede that provisional row only when the statement
check proves it exactly: the row must be import-provisional, inside the
statement period, for the same account, not matched by any statement row, and
its signed amount must uniquely explain the statement difference. Manual rows
and already statement-certified rows are not removed by this path.

If the same official statement row has already been imported or previously
certified, the app treats it as already certified rather than asking for another
duplicate decision. PDF statement imports that certify pre-existing ledger rows
are not rolled back like ordinary working imports; use a replacement statement
or an explicit adjustment if a correction is needed.

The statement certification check is necessary but not always sufficient. For a
mapped account with no prior ledger activity, statement checkpoint history, or
non-zero opening balance, the app also requires account identity confidence from
the detected statement account name. This prevents a first PDF import into a
zero-balance wrong account from passing just because the statement's own rows
and ending balance are internally consistent.

When the statement certification check does not match, the import preview shows
a plain-language balance breakdown for each affected account. It separates the
prior ledger balance, existing ledger rows inside the statement period, included
PDF rows, matched rows that will certify existing ledger entries, skipped or
needs-review PDF rows, and any provisional rows the official statement can
supersede. If the PDF is mapped to the correct card account, treat the PDF as
the stronger bank record. Start by opening the listed ledger-only rows in
Entries from the provided row links; those links use the row's actual month,
entry id, and wallet filter so cross-month statement periods do not hide April
rows from a May statement.

When a PDF statement closes successfully, the app stores a reconciliation
certificate for each account section. The certificate records row counts,
debit/credit totals, net movement, statement balance, projected ledger balance,
how many rows were imported, how many existing rows were certified, how many
were already covered, and whether any exception remained.

After a row is statement-certified inside a saved statement period, its bank
facts are locked. You can still edit user annotations such as category, note,
ownership, and splits, but changing date, description, account, amount, type, or
transfer direction requires a replacement statement or explicit adjustment.

## How are duplicates and overlaps detected?

Import previews warn about duplicate-looking rows before commit. They also warn
when the current preview overlaps a previous completed import for the same
account and date range.

- Duplicate warnings help prevent the same row from entering the ledger twice.
- Duplicate matching normalizes punctuation and missing spaces in merchant text,
  so rows like `M1LTDRECURRING` and `M1 LTD RECURRING` can still match.
- Overlap warnings list the existing entries inside the overlapping account/date
  range so you can see which committed rows triggered the warning.
- The info icon on the overlap warning explains that the check is scoped to
  completed imports for the mapped preview accounts, not unrelated accounts.
- Statement PDF overlaps can be normal when mid-cycle exports or manual quick
  entries already placed rows in the ledger. The PDF statement can promote
  matching provisional rows to statement-certified, preserving user notes,
  categories, ownership, splits, and links instead of asking for duplicate
  decisions.
- Citibank activity CSV imports can use known filename suffixes such as
  `-rewards.csv` or `-miles.csv` as an extra card hint in the single-file flow,
  but the Import Inbox workflow does not require renaming downloaded files, and
  the single-file paste flow can auto-preview recognized Citi activity rows
  directly once the Citibank credit-card account is selected.
- If two accounts share a name, choose the owner-qualified account in the import
  mapping. Overlap checks use that selected account, not just the display name.
- Overlap warnings are date-range warnings; they do not remove rows by
  themselves.
- Marking an overlap as reviewed only hides the warning.
- Exact and near matches use amount, account, lane-specific date proximity, and
  description similarity.

Description similarity is token-based. The app lowercases descriptions, replaces
punctuation and symbols with spaces, then compares normalized words. It also
checks compact text with spaces removed, so bank text like `M1LTDRECURRING` can
still match a manual description like `M1 LTD RECURRING`.

Import duplicate matching now runs in two lanes. First, exact duplicate
suppression checks for the same mapped account, the same amount, and either the
same normalized import hash or a perfect normalized description match with
`dayDistance === 0`. Those rows are auto-skipped before any reconciliation
status guard runs. When the existing ledger row is already statement-certified
from a PDF and the incoming row is a later mid-cycle activity file, the
description/hash lane may use the same velocity date window. That lets a final
statement row posted on one date suppress a later activity export row for the
same bank event when the activity export shows the transaction date instead.

If a row is not an exact duplicate, the app then isolates one date lane for the
promotion and reconciliation step. If both rows have event date hints, it
compares event date to event date. Otherwise it compares posted date to posted
date. For card activity files, posted date remains the balance-control date
because card statements close by posted date; event date stays on the ledger row
for spending history and matching. A unique exact promotion should show as
`Matched to ledger`, not as a manual exclusion task. The match tiers are:

- exact: same account, same absolute amount, `dayDistance === 0`, and
  description similarity `>= 0.8`
- probable: same absolute amount, `dayDistance <= 2`, and description
  similarity `>= 0.6`
- near: same absolute amount, `dayDistance <= 7`, and token similarity `>= 0.5`

Low-value rows below `500` minor units use the `Velocity Rule`: if the lane
distance is more than 2 days, the row is not treated as a duplicate candidate.

A normalized import hash is the strict fingerprint for one reviewed import row.
It is built from the normalized date, description, amount, mapped account, and
entry type. If all of those fields match an existing imported ledger row, the
app can suppress the incoming row as an exact duplicate immediately. If the
date is different, such as an April Netflix row compared with a January
Netflix row, it should not be the same normalized hash; at most it should be
evaluated by the looser reconciliation checks below.

Statement comparison is slightly more flexible because the statement is used as
evidence. A same-date statement row can match with description similarity of
`0.45`, while nearby-date matches within 3 days require `0.65`. The possible
matches list may also show candidates within 7 days or with similarity around
`0.5`, so the user can resolve posting-date or wording differences without
creating duplicate ledger rows.

Already-covered rows stay visible in the preview. You can include one if the
match decision was wrong, and statement checks refresh against the current
commit set. For supported PDF statements, already-covered rows should mostly
mean "already statement-certified" rather than "please inspect this duplicate."
Those already-certified rows still keep the same import-versus-ledger comparison
popover in the preview so a mismatch can be inspected without restoring the row
first.

If a statement mismatch is exactly resolved by including unresolved near-match
rows, probable duplicates, or other app-skipped duplicate rows for that account,
the preview treats those rows as statement-confirmed instead of duplicate
warnings. With the statement-certification model, matching provisional mid-cycle
rows are promoted in place: the statement owns the bank facts, while user
annotations stay attached to the existing transaction. Rows you explicitly
skipped stay skipped until you restore them.

If the mismatch is exactly explained by provisional mid-cycle ledger rows that
are absent from the official PDF, the preview lists those rows as superseded by
the statement. Commit removes only those listed provisional rows while saving
the statement certification. If multiple possible row combinations could explain
the same difference, the app leaves the mismatch open for review instead of
guessing.

Status guards only apply in that second lane. `statement_certified` ledger rows
cannot be chosen as reconciliation targets, and non-PDF mid-cycle imports
cannot reconcile against existing imported provisional rows. Exact duplicate
suppression still sees those rows so overlapping bank files can auto-skip
already-covered activity.

When a PDF statement has no new rows because every row was already imported from
mid-cycle activity files, the import action changes to "Save statement
checkpoints" once the statement checks are matched. That lets you save the
statement balance evidence without adding duplicate ledger rows.

## What can be rolled back, in detail?

Ordinary CSV, XLS, and mid-cycle imports can be rolled back as working imports.
They are provisional working data until a statement confirms them.

If a current-activity import matched an entry you had added by hand, the
import updated that entry in place instead of adding a second one. Rolling the
import back puts your entry back as a `Manual provisional` entry with its
original description, amount and dates. Changes you made after the import,
such as its category, note, owner, split or transfer link, stay. If the entry
is shared through a split and you had changed its amount since the import,
the split goes back to the original amount with the entry, keeping each
person's percentage. If you had
already deleted the entry, the rollback has nothing to restore. If a later
statement has since certified the entry, it stays `Statement certified` with
the statement's details; rolling that statement back afterwards gives you your
original manual entry. The same happens if a statement replaced the entry
because the bank never listed it: rolling that statement back brings your
manual entry back. Imports saved before 2026-09-25 did not keep the
entry's original details, so rolling one of those back keeps the entry as a
manual entry with the imported description and posted date.

A first PDF statement can also be rolled back when the ledger rows were created
by that same PDF import and no later statement exists for the same account. This
includes the case where the user creates a new account from the import page and
the form pre-fills an opening balance from the statement. When a supported PDF
prints a previous or last-month balance, the app uses that value directly.
Otherwise, it calculates the opening balance from the statement ending balance
minus the statement's net activity, so the newly created account can reconcile
immediately. If that account mapping was wrong, rollbacking the PDF batch and
re-importing to the right account is the clean correction before newer
statements are added.

A checkpoint-only PDF can be rolled back too, as long as it is still the newest
statement certificate for that account. That removes the statement checkpoint
and reconciliation certificate metadata, without touching older ledger activity.

If the rolled-back PDF was the first statement for an otherwise blank account,
rollback returns the account to its blank state and a later statement may become
the new starting point. If earlier statement checkpoints already exist, rollback
creates a statement-chain gap. Later statements stay blocked until the missing
statement month is imported again.

A PDF statement may still be rolled back even when it certifies pre-existing
ledger rows, as long as it is still the newest statement certificate for that
account. In that case rollback restores the prior working rows and removes the
statement certificate metadata.

If the statement replaced rows the bank never listed, rolling it back brings
those rows back with their splits. While the rows were gone their splits were
unlinked, so you may have changed one: a split whose amount you changed goes
back to the row's amount, keeping each person's percentage (if that split is
in a simplified settlement or settled group batch, the rollback is refused
until you undo it). A split you matched to another bank row in the meantime
stays with that row, and the returning row comes back without a split. Older PDF statements stay locked once a later
statement certificate exists for the same account.

Older PDF statements should also not be rolled back after a later statement for
the same account has been saved. Rollbacks should move backward from the newest
statement, or use a replacement statement or explicit adjustment when the period
has already become part of a later certified sequence.

In Recent imports, this means a run of monthly PDF statements should not all
show the rollback action. For one account, only the newest rollbackable
statement should show rollback. Older statements should show `Statement locked`
because later statement certificates now depend on the account's certified
sequence. If every completed PDF statement for the same account shows rollback,
the UI and server protection logic are wrong.

Renaming an account is only the right fix when the account object represents the
correct real-world bank account and the label was wrong. It is not the right fix
for a statement that was mapped to a different account.

## Why does a wrong-account statement need a special correction path?

The full replacement workflow is not automatically required on day one. It
becomes relevant because of the accounting controls the app applies:

- PDF statements are treated as high-authority evidence.
- PDF imports can certify existing mid-cycle rows.
- Certified bank facts are locked after a statement period closes.
- PDF imports are blocked from normal rollback after they certify pre-existing
  ledger rows, or after a later statement exists for the same account.
- Reconciliation certificates make the period auditable.

The accounting concept is that closed periods need traceable corrections, not
silent history rewrites. The replacement workflow is the app-specific way to
apply that concept when the evidence source was wrong.

The intended replacement workflow is:

1. Upload the correct PDF statement for the same account and statement period.
2. Compare its account identity, statement dates, row count, debit and credit
   totals, ending balance, and existing reconciliation certificate against the
   committed statement.
3. Preserve user annotations on rows that still match, such as categories,
   notes, ownership, splits, and links.
4. Re-certify matching rows from the replacement statement.
5. Mark wrong rows from the mistaken statement as explicit corrections,
   reversals, or adjustment exceptions rather than silently deleting them.

That full replacement UI is not implemented yet. Until it exists, the safer
manual path is to add a correcting statement or adjustment with a clear note, or
restore from backup if the mistaken PDF was committed to the wrong production
account and the correction would be too noisy.

## What does the statement diagnostics card check?

The exception register is the preview's short list of things that still require
attention. Normal matched statement rows should not appear as work for the user.
The register focuses on blockers such as account mapping, account identity,
statement mismatch, unknown categories, unresolved row decisions, and prior
import context.

For statement mismatches, the detailed certification card is the first place to
look. It shows whether the difference is explained by an existing manual or
mid-cycle ledger row, a skipped statement row, a row direction problem, account
mapping, or a provisional import row that can be superseded by the official PDF.
If the card lists "ledger rows not automatically matched to this PDF", use the
row links to go to Entries in a new tab, or use the inline delete action only
after confirming the row is absent, duplicated, or on another account. This list
means the preview did not certify those ledger rows against unique PDF rows; it
does not prove the rows are absent from the PDF. Repeated same-merchant charges
can land here when the app cannot safely pair every copy. The diagnostic list
shows every row in the unresolved set, not a sample. The date shown on ledger
rows is the transaction date; PDF diagnostic rows show posted date and include
the event/transaction date when the parser found one. When the unresolved ledger
rows total the same amount as the unexplained difference, correcting those rows
should reconcile the statement as long as the PDF is mapped to the right
account. Check each opened row against the PDF for the same card and statement
period: if the PDF contains it, it should be matched or certified; if the PDF
does not contain it, remove it from that account; if it belongs to a different
card, remap it; if it came from a prior provisional import, roll back that
import.

For unresolved lists with multiple ledger rows, the card can show a confirmed
"Delete all" action. Treat it as a bulk version of the per-row delete, not as the
default fix. Use it only when the whole listed set is absent from this PDF,
duplicated elsewhere, or mapped to the wrong account. If the PDF contains those
charges, the right correction is to match/certify the rows or fix their date
lanes. UOB card matching ignores foreign-currency amount fragments in
descriptions, so rows such as `OPENAI OPENAI.COM US` can match PDF descriptions
such as
`OPENAI OPENAI.COM USD 5.58` when the amount, account, posted date, and event
date evidence line up.

When a statement already closes, matched PDF rows are audit context rather than
work for the user. The import preview collapses that list by default and shows
only the count and net statement movement; open it only if you want to inspect
which PDF rows will certify existing ledger rows while preserving user edits.

When a real ledger row is inside the transaction-date period but the PDF omits
it because the bank posted it after the statement cutoff, use `Set posted date`
if the bank app shows the exact posted date. Use `Defer` when you know the row is
legitimate but do not know the posted date yet. Defer assigns a provisional
posted date to the first day after the statement end so the current statement can
close without deleting the row. A later official PDF remains the stronger bank
record: if it uniquely matches the deferred row, certification replaces both the
transaction date and posted date with the official statement dates while keeping
the user's category, owner, split setup, and notes.

The five balance boxes in the statement certification card have hover/focus
help. Use them to see the exact statement start and end dates, what rows feed
each number, and why the number is part of the projected ledger balance.

Settings also has a persistent reconciliation exception list under Balance trust
rules. Use it when a known issue survives beyond one import preview: a missing
bank row, an extra manual ledger row, a likely duplicate, a direction mismatch,
a wrong account, a timing difference, or an adjustment that still needs proof.
Open exceptions mean the account balance is not fully certified yet, even if
the ledger is useful for daily planning. Resolve the exception only after the
bank statement, corrected import, or manual adjustment explains the gap.

## How do date lanes work on certified rows?

A provisional row is useful working data that has not yet been proven by a final
statement. Manual quick-entry rows show as `Manual provisional`; mid-cycle CSV
and XLS exports show as `Import provisional`. They help with planning during the
month, but the final PDF statement gets the last word on bank-facing facts.
When a later non-statement bank source promotes a manual provisional row,
Entries keeps the row's main date on the original event date when the bank
source also carries a separate posted date. The bank-cleared date is stored in
`post_date`.

When a final PDF statement certifies a provisional row, the final statement
gets the last word on both bank date lanes. If the PDF has both a transaction
or event date and a posted date, `transaction_date` becomes the PDF event date
and `post_date` becomes the PDF posted date. If the PDF only has one row date,
certification updates both lanes to that statement date. Sorting, monthly
plans, and split views stay event-first; balance checkpoints and statement
comparison use `post_date`.

## What do the supported statement parsers do?

- CSV can use one signed `amount` column or separate `expense` and `income`
  columns.
- UOB credit-card PDFs use post date as the ledger date and keep transaction
  date in the row note.
- UOB One savings PDFs use the statement period and running balances to validate
  withdrawal/deposit direction.
- UOB current-transaction `.xls` files are old Excel binary workbooks. The
  parser recognizes both bank-account exports and credit-card exports when the
  UOB header row is present.
- Citibank card PDFs use layout-aware parsing for compact card-section rows.
  Citi card PDFs currently expose one row date, so statement certification uses
  that date for both the ledger event date and posted date.
- Citibank current-activity CSV files are headerless. In the single-file flow,
  the app applies the Citi activity parser when the selected default account is
  a Citibank credit card and known Citi export clues are present, so a pasted
  Citi activity export can jump straight to preview without manual column
  mapping. Recognized filename suffixes can still provide an extra card hint,
  but they are no longer required. In the Import Inbox multi-file flow, the
  user does not need to rename files before dropping them. The trailing card
  number is reduced to the last four digits in the note.
- OCBC card and 360 current-activity CSV files use transaction-history headers
  with withdrawal and deposit columns, so the app can recognize them from
  either the filename or the OCBC account-details and transaction-history
  headers. OCBC 360 browser exports may include account preamble rows and
  compact headers such as `Withdrawals(SGD)` and `Deposits(SGD)`; those are
  parsed directly into reviewable rows without creating a statement checkpoint.
- OCBC 365 and OCBC Infinity Cashback card PDFs use the printed statement date,
  last-month balance, subtotal, and total amount due. Credits such as card
  payments and cash rebates are imported as income/transfer rows so the
  statement balance reconciles. If you create the card account from the import
  page, the opening balance is pre-filled from the printed last-month balance.
- OCBC 360 account PDFs use the monthly period, running balances, and balance
  carried forward.
- OCBC Child Development Acc (CDA) PDFs use the printed statement period,
  opening balance, and balance carried forward. If the statement has no activity,
  the import creates a statement checkpoint with zero rows so the account can
  still be certified.

For supported PDFs, the browser extracts statement text locally and turns it
into reviewable rows. If the PDF creates statement checkpoints, those fields are
editable before commit.

## Is there a command-line fallback for HSBC scanned PDFs?

The browser runs OCR automatically. For unsupported browsers or very slow
devices, the fallback helper still exists:

```bash
./node_modules/.bin/tsx scripts/hsbc-pdf-to-import.mjs /path/to/HSBC.pdf
```

It writes a `.hsbc-ocr.tsv` package that can be uploaded in Imports. The PDF
and rendered page images stay local, and the helper deletes temporary OCR
images.

## How are import commits stored?

No. Supported PDF statements are read by the browser so the app can extract text
and parse statement rows locally. The original PDF file is not uploaded as a
file to the backend and is not saved in app storage.

For import preview and statement comparison, the backend receives only the
parsed transaction rows, account mapping, and statement checkpoint fields needed
to run duplicate, overlap, comparison, and reconciliation checks. If the import
is committed, the app saves the resulting ledger transactions, import batch
metadata, and statement checkpoints. If the statement is only used in the
Settings comparison tool, it is treated as evidence for that comparison and is
not committed as a new import.

Refreshing the page or choosing Start over clears the in-browser draft state,
including the parsed rows produced from the PDF. The browser's selected local
file reference is not retained by the app after that draft is cleared.

An import commit saves every row or none of them. The rows, any statement
checkpoint and certificate, and the change to the import's status are written
as one database transaction, so a failure partway (for example Cloudflare
rejecting the request) leaves no partial import, and the same file can be
committed again. Very large imports (over about 245 rows) write their new rows
first while the import is still hidden as a draft, then make every visible
change in one final step; if any step fails the hidden rows are removed. There
is not a deliberate 125-row product limit, but the UI warns when a preview is
large so a rejected commit can be retried as smaller batches.

Rolling back an import is also all-or-nothing, and an import that has already
been rolled back cannot be rolled back a second time. Month totals on Summary
are refreshed right after a commit or rollback; if that refresh is interrupted,
the next Summary or Month page load finishes it.

# Architecture notes

## How does the app load?

The app loads in three small stages: first the shared dashboard shell, then
lightweight account/category reference data, then the active page payload such
as Imports, Entries, or Summary. If any request stalls, the loading panel stops
waiting after the request timeout and shows which request failed, with a retry
button.

Cloudflare Access can also show browser-console warnings for `/site.webmanifest`
when the manifest request is redirected to the Access login page. That warning
affects the installable web-app manifest only. It is not the same as the
dashboard shell or page API failing to load.

If the retry keeps failing, check Settings → Error diagnostics for saved server
responses from import previews, then check the browser Network panel for the
specific `/api/app-shell`, `/api/reference-data`, `/api/*-page`, or
`/api/summary-*` request that timed out or returned an HTML error page.

If the visible failure says `/api/app-shell` returned a Cloudflare 503 because
the Worker exceeded CPU or resource limits, the request was stopped before the
app could return JSON. `/api/app-shell` is now route-neutral and should not load
accounts, categories, page payloads, balances, checkpoint history, or import
history. If it still fails, check Cloudflare Workers observability for the
failing timestamp and confirm whether shell identity data or schema/seed startup
work is the remaining cost. There is no separate app restart button for this
class of failure; redeploying creates a new Worker version but does not fix an
endpoint that is consistently too expensive. The durable fix is to keep broad
reads split into route-specific payloads or move the Worker to a plan with more
CPU/resource headroom if the production data size now requires it.

## How should saves and refreshes behave?

The app is moving toward a more precise save model for row-heavy screens such as
Month and Entries.

The intended behavior is:

1. when you save a new or edited row, that row should appear updated
   immediately
2. if the save affects server-derived values such as `actual`, top-level
   totals, charts, or summary cards, only those derived values should show a
   lightweight pending state
3. add/edit forms should stay open, or reset into an `add another` draft when
   repeated entry is the expected workflow
4. related screens such as Summary or Month can refresh in the background
   without forcing a full page reset

In practice, that means the app should distinguish between:

- `saving` the row itself
- `updating` the server-derived values tied to that row
- `refreshing` other affected views in the background

The goal is to avoid shell-wide reloads for small edits while still making it
clear that totals, actuals, or charts are catching up to the newest saved data.

If a background refresh fails after a save, the save still stands. The page
keeps what it shows and a notice says "This page could not refresh. Saved
changes are kept." Choose **Refresh now** to try again, or **Dismiss** to
carry on; moving to another page or month also clears it, because that page
loads fresh data.

If a month you moved to could not load at all, the page says "This page could
not finish loading." with **Try loading again** instead of showing the previous
month's entries. A draft you had open is kept. A save in a dialog or sheet (for
example **Save matches**) shows "Saving..." and keeps the dialog open with the
reason if it fails, so you can try again without redoing your selection.

## Why does switching views usually feel fast?

On Summary and Month, the Household, primary, and partner pills reuse the
matching views already loaded in the app shell when the month or summary range
has not changed. On Entries, the same pills reuse the loaded household month
rows and apply the person as a local filter. Switching between people should
feel like changing a filter, not like reloading the whole page.

On a phone, Summary, Month and Entries have one floating View and scope bar
above the bottom navigation. It names the view and the whole scope on one
line, such as `Tim · Direct + Shared`, with `View and scope` under it, and
never cuts either short (a long name wraps instead). Month and Entries add
previous and next month buttons beside it; Summary moves its range from the
header. Tapping the bar opens a bottom sheet where you can switch the
household/person view first and then the scope, when that view has more than
one; on Summary a line under the scope says what it counts.

Within one browser session, returning to a tab should reuse cached page data
when no import, edit, rollback, or manual refresh has invalidated it. This keeps
tab switching fast while still letting mutation flows clear the cache before
fresh data is needed. Cached route pages do not automatically force a second
fresh request on return; use the screen refresh action when you need to pull the
latest data without an edit or import.

On browser refresh or a later return to the same month/range, the app can render
the last successful bootstrap payload from local browser storage immediately and
then refresh it in the background. Any write that changes app data clears that
stored bootstrap copy so stale ledger state does not survive edits or imports.

## What does background prefetching do?

After the first usable screen renders, the app also uses browser idle time to
warm the most likely next route code chunks.

On non-touch devices, it can also prefetch adjacent Month or Summary periods in
a narrow, delayed sequence. Only after the visible page has finished loading and
the session stays quiet does it warm lower-priority page data such as Imports,
Splits, Settings, and Entries.

The prefetcher sends one request at a time with spacing between requests. Touch
devices skip background API prefetching so mobile refreshes do not compete with
the visible page request. Any route change, browser-tab hide, import, edit,
rollback, manual refresh, data-saver mode, or cache invalidation stops the staged
prefetch.

## How does month navigation cache pages?

After a month or summary range loads, the app keeps that page payload in memory
and may gently prefetch the adjacent period on non-touch devices. Going back to
an already loaded or prefetched period can therefore render immediately while
imports, edits, rollbacks, and other writes clear the relevant page cache before
reloading. Entries seeds its first page cache from bootstrap on refresh, then
uses explicit month changes, manual refreshes, and write invalidations for fresh
API loads.

## Why is the app shell split into smaller page loads?

The initial bootstrap now acts as the app shell. Summary, Month, Entries,
Splits, Imports, and Settings each have smaller page-specific reloads so month
changes and review work do not wait for the whole dashboard bootstrap to reload.
Those route screens are also loaded as separate JavaScript chunks, so import,
settings, PDF parsing, and statement parsing code are only downloaded when the
user opens a screen that needs them.

Bootstrap intentionally keeps Imports and Settings details light. Import
history, full category match rules, unresolved transfers, and audit history load
from their own page endpoints instead of being carried in every app-shell
request.

Bootstrap also leaves detailed split workspace rows to the Splits page endpoint.
That keeps refreshes focused on the visible app shell while the split page
loads its own groups, expenses, settlements, and match candidates when opened.

The Imports page initially loads a recent-history summary instead of scanning
the full audit trail. Recent imports open by default, can be filtered by any
owner-qualified account in the household, and label each batch as a PDF
statement, mid-cycle activity import, CSV import, or manual import. Import
preview, commit, rollback, duplicate detection, and same-account overlap checks
still use their focused flows. Because overlap checks inspect the account and
date range being imported, they can warn about an older matching batch even when
that batch is beyond the compact recent-history page currently visible.

## What does the optional AI assistance send and store?

AI assistance is an optional review layer, not a finance engine. The app keeps
working normally when it is disabled, unavailable, or out of its daily
allowance. Ledger math, bank-parser output, category rules, duplicate checks,
transfer matching, statement reconciliation, and the Import Inbox remain the
source of truth.

You can ask it to draft a Monthly Note, phrase a statement mismatch in simpler
language, suggest category-rule drafts from existing categorized history, or
rank descriptions among candidates that the app has already constrained by
account, amount, and date. Summary, Month, Entries, and Splits also show a
Money check-in for the figures already on screen (see [How does the Money
check-in work?](#how-does-the-money-check-in-work)). It appears immediately
from the app's own calculations, then may improve its wording in the
background after a short pause: the AI may only choose a few words around
the check-in's fact and think line, which it must keep word for word. In a
person view, the Summary and Month check-ins count only that person's
entries in the selected scope, the same entries as the `Actual spend` card
beside them. Changing a month, scope, split group or the headline creates a
different insight; the app keeps same-view wording in a short-lived
in-memory cache so it does not keep calling AI while you work. When a person
view is selected, the app addresses that person in the final browser
wording, but sends only a placeholder rather than their name to Workers AI.
A quiet visit or a calm line has nothing to reword, so it asks for nothing.

Those insights are guidance, not a recalculation. The check-in never
forecasts, promises what is safe to spend, or sets a savings target, and it
never replaces the plan or the ledger.

Summary and Month also show a **Money consequence map**. It makes the
calculation easier to inspect: money left so far, plan position, a same-season
comparison, bank-record confidence, and sometimes a one-repeat scenario. A
same-season comparison appears only when the matching calendar month is already
loaded in the selected summary range. The one-repeat card is not a prediction:
it simply shows the recorded cash-flow result if another expense equal to the
largest expense shown happens before other future commitments. Summary never
shows it, because its check-in works from category totals and a category total
is not one expense. When statement
or transfer evidence needs review, the map labels the snapshot as provisional
and links to Imports. Entries and Splits say when they cannot assess that
wallet-level confidence.

When the app has concrete evidence worth reviewing, the insight can include a
`Review` link. That link opens the already-existing filtered Entries or split
match workflow, such as the largest expense shown, an overspent category, or
unresolved bank matches. It is generated by the app from record IDs and current
filters; AI wording cannot choose or invent a record link.

The wording service receives placeholder names rather than the actual figures,
merchant names, account names, or ledger rows. The app inserts the
already-computed values (the check-in's fact and think line, word for word)
only after validating the model's template. It cannot
import transactions, change a category, skip a row, certify a statement, or
link a transfer on its own. Use the normal review controls to accept any
suggestion.

For a PDF that no supported parser can read, Imports offers an explicit
checkbox to allow an AI fallback. The browser still tries the dedicated parser
and private in-browser OCR first, including HSBC image statements. Only the
locally extracted text is sent after you opt in; the original PDF is neither
uploaded as a file nor stored. Fallback rows always start as **Needs review**
and do not create a statement balance checkpoint automatically.

The app keeps only daily AI usage counters so it can stay within its configured
allowance. It does not save prompts, model answers, original PDFs, credentials,
Shortcut tokens, or full card/account numbers as an AI history.

## How does the Money check-in work?

The check-in is built in the browser from data the page already loaded; it
adds no endpoint or payload. The code is in `src/domain/money-signals/`:

- **Signals.** `summary-signals.ts`, `month-signals.ts`,
  `entries-signals.ts` and `splits-signals.ts` hold one small pure function
  per signal (`statementGapSignal`, `planLeftSignal`, ...). Each returns
  `{ key, kind, weight, numbers, phrasings, action? }` or `null` when its
  condition is not met. `weight` is the money involved; `numbers.primaryMinor`
  is what "moved" is measured on. The page's copy catalogue
  (`SUMMARY_COPY`, `MONTH_COPY`, ...) beside the functions holds the approved
  phrasings (3 to 5, all with the same numbers), the think line, the
  one-time "Sorted" line of a quick fix and the action label. Signals take
  `today` and the money formatter as inputs and never read the clock.
- **Ranking.** `rankSignals` in `checkin.ts` orders headline candidates by
  kind (Quick fix, Bigger question, a moment such as payday or bills coming
  up, Worth a look, Going well), then by money, then by not seen recently;
  a signal shown in the last three days goes after the rest unless its
  number moved by 10% or $50. Only one bigger question is kept. Long view
  and Just for fun are picked separately.
- **Rotation.** `composeCheckIn` takes the signals, the visit memory,
  `nowMs`, `today` and a stable seed (page, view and context) and returns
  the headline, up to three more lines, the long view, the fun line and the
  quote topic. It never repeats the last phrasing, leads with "Down from
  ... since your last visit." when a number moved, says a cleared quick fix
  is sorted once, and shows one quiet line when nothing changed since a
  visit in the last three days (never twice in a row). Trivia does not
  repeat within 14 days and quotes within 28. The same inputs always give
  the same check-in, so tests pin every rule
  (`tests/money-checkin-engine.test.mjs`).
- **Visit memory.** `src/client/checkin-visit-memory.js` keeps it in
  localStorage under `monies-map:checkin:v1:<page>:<view>[:<group>]`, with
  every access in try/catch; missing or broken storage reads as a first
  visit. `recordVisit` writes what was shown; nothing about visits goes to
  the Worker or AI. The component composes from the memory as the page
  found it, so recording a visit never changes what is on screen.
- **Quotes.** `quotes.ts` holds public-domain quotes, each copied exactly
  from the source it names (author, work, year and the text checked). It is
  loaded with a dynamic import when "Read full insight" opens, so it never
  weighs on the first screen; `pickQuote` matches the headline's topic.

To add a signal: write the test first in the page's
`tests/money-signals-*.test.mjs` (it fires with concrete numbers and the
exact wording, and stays silent when its condition is not met), add its copy
to the page's catalogue and describe it in `scripts/checkin-copy.mjs`, add
the function and list it in the page's `build...Signals`, then run
`npx tsx scripts/checkin-copy.mjs` to regenerate `docs/checkin-copy.md`. An
action may only reuse a navigation the page already has.

The tone lint (`tone.ts`, run by `tests/money-checkin-copy.test.mjs`) checks
every phrasing, think line, sorted, trivia, quiet and calm line, the quotes
and the consequence map's lanes: no word from the avoid list (overspent,
blew, bad month, cut back, should, non-essential, guilty, sacrifice,
warning, alert, problem and a few forms of them), no exclamation marks, no
emoji, and no percentage without its money amount. The same lint refuses AI
wording that breaks it. The test also fails when `docs/checkin-copy.md` is
out of date.

# Product and data model notes

## How is the planning model stored?

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

When a planned item has many possible ledger matches, the matching dialog does
not run a full ledger search first. It starts with lightweight narrowing:
`Linked`, `Same category`, `Same account`, `This month only`, and a description
contains filter over the ranked candidate list. This keeps the flow faster than
global search while still making long categories such as `Food & Drinks` easier
to narrow down.

On mobile, this planned-item matching flow uses the same bottom-sheet pattern as
the other month add and edit forms instead of a centered modal.

After a planned item is matched, the app remembers lightweight matching hints
from the linked ledger entries so future months can suggest likely matches. It
does not auto-link them yet; the user still confirms the matches.

Budget buckets can also be reduced by category-offsetting income, such as a
reimbursement, when that income row is explicitly marked as offsetting the same
category. Transfers still do not count toward budget-bucket actuals.

Monthly planning is person-based first. The primary person and partner can have
different month plans, and the household month view should be derived by
combining those plans, not by maintaining a separate duplicate household plan.

The point is not only to log transactions. The point is to compare plan versus
actual and understand why the month moved.

The Summary page defaults to the latest 12 available months. If a month has
ledger entries, its actual income and expense values are derived from completed
entries rather than waiting on a stale monthly snapshot row.

## How do person views count shared rows?

At the household level, `Direct ownership` is not very meaningful as a primary
planning lens. The household monthly view should focus on:

- `Combined`: both people's direct plans plus shared plans, merged into one
  household view
- `Shared`: shared-only planning rows

In person views, shared rows are supposed to be weighted to that person's split.
If a shared dining row is split 55/45, the primary person should see the 55%
subtotal and the partner should see the 45% subtotal. The full shared
transaction can still be shown alongside it for context.

A person view's actual spend is that person's own spend. Summary months, the
Summary cards and charts, and the Month `Actual spend` card count the
person's own entries at their full amount plus their share of each entry that
is on splits; the other person's own entries are left out. The scope pills
narrow it: `Direct ownership` counts only the person's entries that are not
on splits, `Shared` only their split shares, and `Direct + Shared` both. For
example, if Tim pays $100.00 for groceries and $80.00 for a dinner split 25%
Tim / 75% Joyce, and Joyce pays $30.00 for shopping, Tim's Direct + Shared
actual spend is $120.00 and Joyce's is $90.00, on Summary and Month alike;
the household view shows $210.00. The stored month totals hold the same
Direct + Shared figure per person, and a person whose only spending in a
month is a split share (Joyce's $60.00 of a dinner Tim paid) still gets one.
The Summary and Month Money check-ins count the same entries, so in Tim's
Direct + Shared view the Month check-in's facts (and its consequence map's
plan position) use his $120.00, the same as his `Actual spend` card, and
switching to `Shared` makes both use $20.00.

In a person view on a computer or tablet, Summary shows a small switch under
its `Summary` title: `Direct`, `Shared` and `Both` (Direct + Shared), with the
active one highlighted. Hovering an option says what it counts (for example
"Joyce's share of split expenses."), and one click reloads Summary for that
scope, as the pills do on Month. On a phone, Summary has no switch of its
own: the floating View and scope bar above the bottom navigation, the same
one Month and Entries use, shows the person and the scope (for example
`Joyce · Shared`), and tapping it opens a sheet with the view and scope
choices and a line saying what the scope counts. The household view always
counts every entry, so it shows no scope choice.

Important current limitation:

- shared month-plan allocation still exists in storage and calculations
- but it is not currently an actively supported first-class user-controlled
  Month UI feature
- the combined Household month view is read-only
- users do not currently get a dedicated control to manage shared month-plan
  split ratios directly

## How do linked entries and splits stay in step?

When a linked entry and split already exist, changing the entry's amount
changes the split too. The split total becomes the new amount and each
person's share keeps the same percentage: a 50/50 split stays 50/50, a 25%
share stays 25%, and a share you entered as an exact amount becomes the same
percentage of the new total. For example, editing a $60.00 50/50 entry to
$80.50 in a person view shows that person's share as $40.25 in Entries,
Splits, Month and Summary. A travel split in another currency keeps its own amount and shares;
only its converted home amount changes. If the new share is not what you
agreed, adjust it in the split editor.

Changing the entry's date, description or owner (who paid) changes the split
the same way, in the same save. A split field you changed in Splits, such as
a description like "Dinner with Joyce" on a bank row that says "RESTAURANT
XYZ SINGAPORE", keeps your wording. The split's note, category, group, share
percentages and travel-currency amounts belong to the split and are never
changed by an entry edit; note and category have their own "update both"
prompt.

When a linked entry and split already exist, changing the note on either side
opens a confirmation dialog before save. The dialog shows the note you are
saving and the connected record's current note, then lets you save only the
record you edited or update both notes together.

If you manually create a split before the bank row exists, it is still useful as
a reminder, but it is not yet matched to the ledger. When the bank row arrives,
use the split match prompts to link the split to the imported entry instead of
creating another split. A split can be matched to one bank row: if it is
matched to a second row at the same time (for example from another tab), the
second match is refused with "This split expense is unavailable or already
linked." and changes nothing.

A travel split recorded in its own currency (for example JPY 10,000 in a Japan
trip group) and matched to the SGD card row keeps its JPY amount and shares
whenever that entry is saved, also by a save that sends the entry as Shared
with its split percentage: only the converted SGD amount and the rate follow
the card row. Such a save is allowed while the split is in a simplified
settlement, as long as it does not change the split's date, payer or shares.

Outside Splits, that card row counts in SGD. In a person view, Entries,
Month, Summary and the month totals show each person's share of the SGD
amount, split the same way as the JPY split: a JPY 10,000 dinner split 50/50
and matched to an SGD 93.01 card row shows Tim's share as $46.50 and Joyce's
as $46.51. The yen amounts stay in Splits.

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

- more bank and card parser coverage
- more automated reconciliation help around unusual statement formats
- deeper split matching and settle-up workflows
- in-app AI analysis
- optional direct bank connections, if the product ever decides to support them

## Are children or guests settlement people?

The app does not currently treat children, babies, or guests as separate
settlement people. Keep those labels in notes and shares until dependent
participant roles are introduced, so they cannot accidentally become debtors.
