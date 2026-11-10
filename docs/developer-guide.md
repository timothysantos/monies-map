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
months of history ending today. They earn modest take-home pay (about
$5,700 and $4,400 a month, a 13th-month AWS in December and a small
mid-year bonus for Ethan in July; CPF is not income) and spend about $3,400
to $4,800 in a usual month. Eleven accounts: three banks (one joint), four
credit cards with statement imports and checkpoints (one card deliberately
off by $42.80), three investment accounts (Endowus, StashAway, IBKR)
that monthly transfers feed, with one withdrawal for the over-plan month,
and an iFAST account that nothing moves into. StashAway and iFAST each have
six monthly statement imports that save what the account was worth
(`investment_statement_values`), so the Summary shows their worth.
Card bills, contributions and settle-ups are matched transfers; one SRS
top-up is unresolved. Month plans with savings and investment lines cover
every month but one (so that month opens in the Simple view), with a few
months a little over and one clearly over. There are notes, category rules,
two Apple Pay entries this month, a yen trip split, settled split batches
and a simplification. It is built by
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
npm run test:contracts       # fast loading, CSS, colour and guide contracts
npm run test:unit            # unit and parser contracts
npm run test:e2e:smoke       # smoke bundle on isolated stacks (part of verify)
npm run test:e2e:sharded     # full browser suite on parallel isolated stacks
npm run check:bundle         # first-screen bundle budget
npm run docs:screenshots     # regenerate the guide screenshots
```

The full command reference, including database and deploy commands, is in
`README.md` under "Command reference".

# Testing

## How can local testing avoid repeated setup?

Start with `npm run test:contracts`, then the affected unit files and browser specs.
The fast contracts run before database-heavy tests in `verify`. For example,
`npm run test:unit -- tests/atomic-writes-plan-studio.test.mjs` or
`npm run test:e2e:sharded -- --shards 1 tests/e2e/island-context.spec.js`.
Use `--skip-build` only while the existing production build is unchanged.
Run broad suites sequentially on one machine; overlapping full unit and browser
runs competes for CPU and memory and can turn a short request into a timeout.
The final merge gates still run all required checks. A missing or covered
control fails after 15 seconds; full workflows still have two minutes and
explicit long API/import waits keep their existing timeouts.

The unit runner migrates and seeds one real local D1 template per run. Each
persistence test copies it into its own private database; custom fixture
variables still create a separate seed. The runner deletes the shared template
when its children finish, so the next run always sees current application code.
Repeated measurements are recorded in `docs/audits/contextual-actions.md`.

## How are the browser tests organised?

`npm run test:e2e` runs the whole Playwright suite serially with one worker
against Vite on `5173` and Wrangler on `8787` (it reuses servers already on
those ports outside CI).

`npm run test:e2e:sharded` runs the same suite faster as parallel shards. It
builds `dist/` once. Then each shard starts its own stack on its own ports
(Vite `5501+`, Wrangler `8901+`, inspector `9501+`) with its own local D1 in
`.wrangler/state-shard-<Wrangler port>` (so runs with different
`E2E_PORT_OFFSET` values never share one), and runs its spec files with one worker. At the end
it merges every shard into `playwright-report/` and
`test-results/e2e-sharded/report.json`, prints one pass/fail summary, and
removes the shard servers and state. Shard logs are in
`test-results/e2e-sharded/logs/`. Test and performance servers start Wrangler
with `X_LOCAL_OBSERVABILITY=false`, which turns off the request traces
`wrangler dev` records for its Local Explorer; they slow local requests and
no test reads them. `npm run dev` keeps them.

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

## How does CI run?

GitHub Actions (`.github/workflows/verify.yml`) runs the same checks as
`npm run verify` plus the full browser suite, split into parallel jobs:

- **audit, types, lint, build, bundle**: `npm audit`, both typechecks, lint,
  the production build and the bundle budget.
- **unit 1/3 to 3/3**: the unit and contract tests split by file (the
  `npm run test:unit` runner script with `--test-shard`), two files at a
  time per runner.
- **full-e2e shard 1/4 to 4/4**, then **full-e2e**: the browser suite on four
  isolated stacks, merged into one report (the HTML report is an artifact of
  the run). The smoke bundle does not run separately; all of its spec files
  are in the full suite.
- **verify**: passes only when every job above passed. It is the one check to
  look at.

It runs on pull requests, on pushes to a branch named `ci/...`, and by hand
(Actions tab, Verify, Run workflow, on any branch, master included). It does
not run on every push to master: on 28 October 2026 the free minutes ran
out and every job failed to start with "recent account payments have failed
or your spending limit needs to be increased", so the owner turned that
trigger off. `npm run verify` on your computer stays the merge gate. To test
a branch without opening a pull request:

```bash
git push origin HEAD:ci/my-change
```

A newer push to the same pull request or branch cancels the older run (a run started by hand on master is never cancelled). Runners have two
vCPUs. The first green run (12 October 2026) took 13 minutes and billed
about 67 runner minutes (GitHub rounds each job up to a whole minute): 1 for
the static job, 20 for the three unit jobs (5.5 to 7.5 minutes each), 44 for
the four browser shards (8 to 12.5 minutes each) and 2 for the merge and
verify jobs. The private-repository free tier is 2,000 minutes a month, so
plan on about 25 to 30 full runs, fewer as the suites grow.

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
app reads the signed-in email from Cloudflare Access and can link it to a
household member, but it does not implement standalone OAuth itself.

Production also checks the Access token itself (`src/server/access-jwt.ts`):
`ACCESS_TEAM_DOMAIN` and `ACCESS_AUD` (the Access application's AUD tag) in
`wrangler.jsonc`, and `ACCESS_JWT_MODE`. Production runs `enforce`: a request without a valid token is refused (401
JSON for `/api/`). `report` verifies every API request and logs one
`access-jwt` line per request without refusing anything (watch it with
`npx wrangler tail monies-map --format pretty`). To roll back if the check
ever locks the household out, set `ACCESS_JWT_MODE` to `"report"` in
`wrangler.jsonc` and redeploy. With verification on,
the viewer's email comes only from the verified token. Demo, test, the
shortcuts Worker and local `npm run dev:api` (which passes
`--var ACCESS_JWT_MODE:off`) leave it off. If Access is ever reconfigured
(a new application or team), update both values before deploying, or
`enforce` would lock everyone out.

The fastest Access setup is one-time PIN email auth, restricted to:

- primary household email
- partner household email

Google sign-in can be used by configuring Google as a Cloudflare Zero Trust
identity provider and keeping the same email allowlist.

The public demo deployment is:

[https://monies-map-demo.timsantos-accts.workers.dev](https://monies-map-demo.timsantos-accts.workers.dev)

It uses the separate Cloudflare D1 database `monies-map-demo` (never
production's, so nothing it counts or stores mixes with production) and sits
behind its own Cloudflare Access application (invite-only, owner decision
2026-10-14), with its own app tag in `wrangler.demo.jsonc`. The Worker checks
the Access token in `enforce` mode (since 2026-10-14; a request without a
valid token is refused, and a signed-in visit verified on every request in
`wrangler tail` first). To roll back, set `ACCESS_JWT_MODE` to `"report"` in
`wrangler.demo.jsonc` and redeploy.
Nothing in the demo depends on who is signed in: there is no
login-to-person linking, visitors switch between household and person views
by hand, and everyone shares the same fake data and can change it. The demo
app shows a thin sticky blue `demo` banner at the top of the page.

Ask on the demo uses Claude through the same AI Gateway as production, with
the demo's own small caps counted in the demo D1: `AI_ASSIST_DAILY_LIMIT`
50 units a Singapore day for the whole demo, and
`AI_ASSIST_VISITOR_DAILY_LIMIT` 10 a day per visitor, keyed by a SHA-256 of
the visitor's address and browser (`aiVisitorKey`; no address is stored).
When either cap is used up, Ask reads with its built-in rules and says "The
demo's Claude allowance is used up for today, so Ask is using its built-in
rules." The demo has no Workers AI binding, so Claude is used only once the
gateway token secret is set on the demo Worker:

```bash
npx wrangler secret put AI_GATEWAY_TOKEN --config wrangler.demo.jsonc
```

Until then the demo answers every Ask message with its rules and calls
nothing. The gateway's monthly spend limit is shared with production; the
demo's 50 units a day keep its share small.

The demo runs the showcase dataset (`DEMO_DATASET` is `showcase` in
`wrangler.demo.jsonc`; walkthrough in `docs/demo-tour.md`). A table change
needs `npm run db:migrate:demo` first.

```bash
npm run deploy:demo
```

### How is the demo kept current?

The showcase rebuilds itself. The demo settings record the showcase's last
day (`seedDate`, or for an older seed the day of `lastSeededAt`, in
Singapore time like `getCurrentMonthKey`). When a cold isolate starts and
that day is in an earlier month, or 7 or more days ago, it rebuilds the
showcase for today before answering (`isShowcaseStale` and
`refreshStaleShowcase` in `src/domain/demo-settings.ts`, called from
`initializeAppData` in `src/domain/app-shell.ts`). The week rule keeps the
month in progress from stopping at the day it was seeded.

- **Cost.** The check reads only the demo settings the cold path already
  loads, so a current demo adds no round trip. A rebuild is the usual
  showcase reseed: one batch, then the month totals.
- **Two isolates at once.** The rebuild is one all-or-nothing batch with the
  data and the new settings. Its first statement is a guard that fails, and
  rolls the batch back, when the stored `seedDate` is no longer the one the
  isolate read, so only the first isolate rebuilds and the other carries on
  with its result.
- **Scope.** Only when `APP_ENVIRONMENT` is `demo`, `DEMO_DATASET` is
  `showcase` and no `DEMO_SEED_MONTH` pins the month
  (`showcaseRefreshesItself`, set per request in `src/index.ts`), and only
  over a showcase that is not in the empty state. Production, local, test and
  the default demo never rebuild this way
  (`tests/demo-showcase-refresh.test.mjs`).
- **Edits are lost.** Whatever a visitor changed on the demo is replaced at
  the rebuild, as with Reseed demo data. The user guide says so.
- A warm isolate only rebuilds when it is replaced by a cold one, which
  Cloudflare does often; a Cron Trigger was not needed.

Reseed from Settings, Demo state still rebuilds it at once (the route
enforces the Access token, so a bare `curl` to `/api/demo/reseed` gets a 401
or the Access login redirect). A deploy alone keeps the data that is already
stored until the next rebuild.

## How do I deploy to production?

Use the Cloudflare deploy steps in `README.md` ("Cloudflare Deploy"). The
routine production path is to use Node 22.23.0 or newer, then run
`npm run deploy:prod`, which publishes the app and the Shortcut API Worker. Use
`npm run deploy:demo` for only the public demo, or `npm run deploy:all` to build
once and publish all three Workers (production, Shortcut API and demo). If the app change
depends on a schema update, run the matching D1 migration before deploy.

Every deploy script first runs `scripts/check-deploy-source.mjs`, which
fetches and refuses unless HEAD is exactly `origin/master` with no
uncommitted changes. Merge and push your branch first, then deploy from a
clean checkout of `origin/master`; a deploy from a branch or a stale master
rolls back whatever the previous deploy shipped. In an emergency,
`ALLOW_DEPLOY_FROM_BRANCH=1` skips the check.

The deploy scripts set `WRANGLER_NO_SKILLS_UPDATE_PROMPTS=true`, so Wrangler's
interactive "Cloudflare skills might be out of date" question cannot pause a
deploy halfway (Wrangler 4.141 asks it before a deploy on an interactive
terminal).

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

## How do I set up the optional AI provider?

Nothing is needed today. With no gateway settings, the optional AI layer
(`src/domain/ai-provider.ts`) uses Workers AI directly through the existing
`AI` binding: Gemma 4 (`@cf/google/gemma-4-26b-a4b-it`) for receipt images
and other JSON answers (Ask's answer wording, the Monthly Note draft, the
statement-mismatch explanation, category-rule suggestions and the statement
text fallback). There is no failed gateway call, no extra wait and no log
line. The entry draft uses the provider layer too, and
duplicate and transfer ranking use Workers AI embeddings; neither goes
through the gateway.

Claude Haiku (`claude-haiku-5-5`) through Cloudflare AI Gateway can be added
later with an Anthropic API key from any Anthropic account, including a
personal one. When it is configured, Claude is tried first and Workers AI is
the fallback when Claude is rate-limited, over the gateway's spend limit,
failing, slower than 15 seconds or returns unusable JSON. If both fail, the
route says AI is unavailable and the browser falls back to in-browser OCR.

To add Claude later:

1. In the Cloudflare dashboard, open **AI > AI Gateway** and create a gateway
   (for example `monies-map`). Note the account ID and the gateway ID.
2. In the gateway's **Settings**, turn **Logs** off and leave **Caching** off
   (it is off by default). The Worker also sends `cf-aig-collect-log: false`
   and `cf-aig-skip-cache: true` on every request, so nothing is logged or
   cached even if a setting is changed later.
3. Turn on **Authenticated Gateway** and create a gateway token (a Cloudflare
   API token with AI Gateway Run permission).
4. Under **Settings > Spend limits**, add a rule: provider Anthropic, about
   US$10, a fixed monthly window. Over the limit the gateway answers 429 and
   the app falls back to Workers AI. Spend limits are in beta and settle
   after each request, so a burst can slightly overshoot; also set a monthly
   spend limit in the Anthropic Console as a second backstop. Cloudflare's
   docs do not say outright that limits cover the provider-native
   `/anthropic/v1/messages` endpoint the app uses, so check the gateway's
   spend figure after the first real receipt.
5. Create an Anthropic API key in the Anthropic Console, then store it in
   one of two places:
   - **Preferred: in the gateway.** Open the gateway's **Provider Keys**, add
     the key for Anthropic under the `default` alias (or any alias, named in
     `AI_GATEWAY_BYOK_ALIAS`; production uses `monies-map-claude-api-key`),
     then give the Worker only the gateway token:
     `npx wrangler secret put AI_GATEWAY_TOKEN`. The Worker never holds the
     Anthropic key.
   - **Or as a Worker secret:** `npx wrangler secret put ANTHROPIC_API_KEY`
     (also put `AI_GATEWAY_TOKEN` if the gateway is authenticated).
6. Add the gateway's location to `vars` in `wrangler.jsonc`: either
   `AI_GATEWAY_ACCOUNT_ID` and `AI_GATEWAY_ID`, or one `AI_GATEWAY_URL`
   (`https://gateway.ai.cloudflare.com/v1/<account_id>/<gateway_id>`).
   Optional: `AI_CLAUDE_MODEL` (default `claude-haiku-5-5`),
   `AI_FALLBACK_MODEL` (default Gemma 4; use
   `@cf/meta/llama-4-scout-17b-16e-instruct` if Gemma 4 is withdrawn),
   `AI_ASSIST_VISION_UNITS` (allowance units per receipt image, default 2,
   1 to 10) and `AI_ASSIST_DAILY_LIMIT` (shared daily units, 4 to 100;
   `wrangler.jsonc` sets 100, and a Worker without it uses 12).
7. Deploy as usual. If Claude rejects the key, model or gateway (400, 401,
   403 or 404), `npx wrangler tail` shows `AI provider config rejected` with
   the status, a `source` (`gateway`, `anthropic` or `unknown`) and a short
   sanitised `message`; receipts keep working through Workers AI.

### Claude diagnostic (which layer refuses)

When every Claude call fails, ask the Worker directly. It makes one minimal
Claude call through the gateway (`max_tokens` 1, one allowance unit) and
answers `{ ok, status, source, message, alias, gatewayIdPresent,
tokenPresent }`. `source` is `gateway` (Cloudflare refused: authenticated
gateway, token), `anthropic` (the provider key, credit or model) or
`unknown`; the presence fields are booleans only. It is not linked from the
app and stores nothing. Open it in a signed-in browser tab (it is a GET):

```
https://<worker-host>/api/ai-assist/provider-diagnostic
```

or with curl behind Cloudflare Access, using a service token or a copied
session cookie: `curl -s -H "CF-Access-Client-Id: ..." -H
"CF-Access-Client-Secret: ..." https://<worker-host>/api/ai-assist/provider-diagnostic`.

### Claude credit warnings

The app cannot buy Claude credits, so it keeps one aggregate row
(`ai_provider_status`) and can tell the owner when credits are running low
or used up, with a link to the Claude Console billing page
(`https://platform.claude.com/settings/billing`). After every Claude call it
records the success time and an estimated cost (the response's token counts
times the prices below), or the failure's kind: credit used up (Anthropic's
"credit balance is too low" 400, or a 402), the gateway's spend limit (its
429), a rejected key (401/403) or anything else. No prompt, image, answer
or error text is stored. Ask shows a notice for `low`, `exhausted` and
`capped`, and Settings has an Ask and AI section (see "In the app" below).
The routes:

- `GET /api/ai-assist/provider-status` returns `{ ok, visible: true,
  claudeConfigured, state, estimatedSpendUsd, creditUsd, warnAtUsd,
  monthSpendUsd, monthTargetUsd, mode, lastFailureAt?, lastFailureReason?, lastSuccessAt?, consoleBillingUrl }`,
  where `state` is `exhausted`, `capped`, `low` (estimated spend at or over
  the warn amount), `unknown` (no Claude config, no success yet, or a
  rejected key) or `ok`. A later Claude success turns `exhausted` or
  `capped` back to `ok`.
- `POST /api/ai-assist/provider-status/topped-up` with `{ "creditUsd": 25 }`
  after buying credit in the Console: restarts the estimate at zero against
  that amount (a number above 0 and at most 10,000).

Who they answer is set by `AI_ALERT_EMAILS`:

- `"*"` (what `wrangler.jsonc` ships, the owner's choice): everyone sees
  the status and may mark a top-up, signed in or not (Cloudflare Access
  already guards the whole app in production).
- A comma-separated list of Cloudflare Access login emails (case does not
  matter): only those people. Everyone else gets
  `{ "ok": true, "visible": false }` from the GET and a 403 from the POST.
- Empty: nobody sees it.

Optional vars (defaults in brackets):

- `AI_CLAUDE_PRICE_IN_PER_MTOK` [0.10] and `AI_CLAUDE_PRICE_OUT_PER_MTOK`
  [0.50]: US$ per million input and output tokens. The defaults are Claude
  Haiku 5.5's list price for prompts up to 100K tokens; check them against
  Anthropic's pricing page and update them whenever `AI_CLAUDE_MODEL` or the
  price changes.
- `AI_CLAUDE_CREDIT_USD` [20]: the credit to measure against until the
  first top-up mark; after a mark, the marked amount is used.
- `AI_CLAUDE_WARN_AT_USD` [15]: the estimated spend that turns the state
  to `low` (never more than the credit).
- `AI_CLAUDE_MONTHLY_TARGET_USD` [8]: the monthly Claude budget for
  auto-balance. `mode` is `claude_all` while the month's estimated spend is
  at or under target x day / days in the month (Asia/Singapore),
  `ask_only` when it is over that pace (background help asks the basic model
  first; receipts, entry drafts and Ask wording still ask Claude first) and
  `basic_first` from 90% of the target (everything asks the basic model
  first). Claude or the basic model is always the other's fallback, and the
  month's figure restarts at zero each month. Settings shows it as one line
  under the credit line.

The estimate is only an estimate: it does not see credit spent by other
apps on the same Anthropic account, or a balance the owner topped up without
marking it. The Console balance is authoritative.

Local dev has no Cloudflare Access in front, so there is no viewer email,
the same as the rest of the app (the app shell shows no login identity).
With `AI_ALERT_EMAILS` at `"*"` the routes answer locally as they are. To
try the email list, set `AI_ALERT_EMAILS` in `.dev.vars` and send the header
yourself, as the browser tests do:

```sh
curl -H "Cf-Access-Authenticated-User-Email: owner@example.com" \
  http://127.0.0.1:8787/api/ai-assist/provider-status
```

In the app (`claude-credit-model.js`, `claude-credit-status.js`,
`claude-credit-notice.jsx`; design.md "Claude credit notice"): Ask and
Settings read the GET once their route is usable (never on the first
screen), through `fetchQueryWithLease` under
`queryKeys.claudeCreditStatus()`, kept for five minutes and shared by both.
Ask shows one inline notice at the top of the conversation for `low`,
`exhausted` or `capped`, with the Console link, "I've topped up" (an
in-app form that posts the top-up route and keeps its answer as the new
status) and a dismiss kept in sessionStorage
(`monies.claudeCreditNotice.v1`) until the state gets worse. Settings →
Ask and AI shows the same line, the two actions and when it was last
checked, or "Claude isn't set up, so Ask uses the basic model." (or
"Claude hasn't been used yet." when Claude is set up, the state is unknown
and no failure is recorded). A viewer
the GET answers `{ visible: false }` sees neither. `wrangler.test.jsonc`
sets no `AI_ALERT_EMAILS`, so the browser tests stub the route for each
state (`tests/e2e/claude-credit-notice.spec.js`; the phone tests also run
in WebKit with `npm run test:e2e:webkit`), and
`tests/claude-credit-notice.test.mjs` covers the words, tones, hidden
money, dismissal and amount check.

To remove Claude again, delete the secrets and vars; the app goes back to
Workers AI directly.

To test locally, use the unit tests: `tests/ai-provider.test.mjs` mocks the
gateway with a stubbed `fetch` (success, 429, timeout, malformed JSON, both
providers down, no Anthropic config, and what each records in the status
row), `tests/ai-provider-status.test.mjs` covers the credit status on a real
local D1, `tests/receipt-read-route.test.mjs` drives the route with a
stub `AI` binding, and `tests/ai-text-provider-routes.test.mjs` drives the
four text routes (Monthly Note, mismatch explanation, category rules,
statement fallback) through Claude, the Gemma fallback, both down, refused
answers and AI off. `wrangler.test.jsonc` has no AI
binding, so the browser tests prove the no-AI path. For a manual check
against the real gateway, put the secrets in `.dev.vars` (ignored by git)
and the vars in a local, uncommitted copy of the config; note that the
Workers AI binding always runs remotely and is billed even under
`wrangler dev`.

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

`openUrl` opens the Ask page on the saved entry's card:
`/ask?saved_entry=<id>&month=<YYYY-MM>&view=<view>&from=shortcut` (built by
`buildShortcutEntryOpenUrl` in `src/server/shortcut-gateway.ts`). The card
offers Open this entry, a category question when it landed in `Other`, and
Splits. Shortcuts installed earlier keep working: they open whatever
`openUrl` the response carries, and the Entries link earlier responses
carried (`/entries?editing_entry=<id>&month=...`) still opens the row in the
Entries editor.

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
shortcut if it is exposed. Each person has their own connection (DOMAIN.md
"Shortcut Connection"), so a leaked or lost key is regenerated or stopped
(Settings, **Stop this phone**, `POST /api/settings/shortcuts/revoke`) for that
person alone, and the old key stops at once.

The key says whose phone it is. `authenticateShortcutRequest` compares the
provided token with every connection's key in constant time (no early exit,
`findShortcutConnectionByKey`) and hands the matched connection to the create
route, which uses that person's default params, Default account order and card
for other currencies, and always saves the entry with that person as owner,
overriding `ownerName` in the request or the default params. Two connections
cannot hold the same key (the save refuses it). Connections live in
`app_settings` (`shortcut_api` for the first person, the household owner;
`shortcut_api_person_<personId>` for anyone else), so nothing was migrated:
the key installed before connections is the first person's and keeps working.
The Settings page sends the first person's settings once, as the flat
`shortcutSettings` fields; their entry in `connections` names the person only
(`settings-panel.jsx` merges them back), which keeps `settings-page` inside its
payload budget. See `docs/audits/shortcut-per-person-audit.md`.

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
Cloudflare environment token. The Worker secret answers for the first person
only, and stops answering once that connection is stopped in Settings. Existing
deployments can still use a Cloudflare Worker secret named:

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

A new column on an existing table (for example `transactions.transaction_time`,
the entry's time of day) is additive and nullable. `schema.sql` only creates
it on a fresh database (`CREATE TABLE IF NOT EXISTS` leaves an existing table
alone); `ensureDemoSchema` (`app-repository-schema.ts`) adds it with `ALTER
TABLE` on the first request of an isolate. Before deploying code that selects
the column, export the production D1 (not committed), run `db:migrate:remote`
and `db:migrate:demo`, then add the column to both databases yourself when
`PRAGMA table_info(transactions)` does not list it:
`npx wrangler d1 execute monies-map --remote --command "ALTER TABLE transactions ADD COLUMN transaction_time TEXT"`
(and `monies-map-demo`). No existing row changes; every reader treats a null
as no time. `tests/entry-time-api.test.mjs` proves a database without the
column is repaired on the first request.

The transfer purpose columns (DOMAIN.md "Transfer Purpose") went the same
way: `transactions.transfer_purpose_category_id`,
`transfer_purpose_person_id` and `transfer_purpose_source`, all nullable
`TEXT` with no foreign key (a deleted category or person leaves a purpose
that simply no longer counts). The statements are
`TRANSFER_PURPOSE_COLUMN_STATEMENTS` in `app-repository-schema.ts`;
`tests/transfer-purpose-projections.test.mjs` proves the repair.

### What body should the shortcut send?

Send JSON.

Required fields:

- `date`
- `description` or `merchant`
- either `amountMinor` or `amount`

`accountId` or `accountName` is optional. An explicit account must identify an
active account. Without one, an exact, unique Wallet `name` match selects that
active account; otherwise, when the amount names another currency than the
first priority account's and Settings -> Apple Pay shortcut -> Other currencies go to names an active card (`foreignCurrencyAccountId` in the stored
shortcut settings), that card is used; otherwise the API uses the first active
account in Default account. `accountResolution` in the response reports
`explicit`, `wallet_name`, `foreign_currency`, or `priority`, so the Shortcut
can show what happened instead of silently guessing.

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

The entry's time of day is the time the server received the request in
Singapore time (`transaction_time`, "HH:MM"), only when `date` is today there;
the response adds `time` for a new entry. No new request field is needed, so
installed copies of the Shortcut keep working (`src/lib/entry-time.ts`,
DOMAIN.md "Transaction Time").

`amount` can be a positive decimal number or Wallet-style text such as `SGD
12.34` or `S$1,234.56`. The API preserves cents and rejects ambiguous decimal
or thousands separators and ambiguous bare currency symbols. If the amount
names another currency than the selected account's (an Amaze card abroad:
`IDR 159,000` on an SGD card), it is saved in the account's currency at the
day's exchange rate (`src/domain/foreign-currency.ts`): the original amount and
currency are kept on the entry (`original_amount_minor`, `original_currency`),
the note says what was paid and at what rate, and the response adds
`originalAmount`. Rates come from Frankfurter (European Central Bank) and, as a
fallback, ExchangeRate-API's open endpoint; only the two currency codes are
sent. The last rate per pair is saved in `fx_rates` and reused for 12 hours,
and for up to 14 days when both sources are down. With no usable rate the
request is refused with 503 and saves nothing. `FX_RATES_OFFLINE=true` (the
test Worker) uses saved rates only. When the card's statement or activity
export arrives, the import preview matches its SGD row to the estimate when
it is at most 5% over and 2% under it (`isEstimateAmountFit` in
`app-repository-import-preview.ts`; a row printing a different foreign
amount never fits). `pairForeignCurrencyEstimates` pairs the whole file at
once, surest first: the foreign amount the row prints
(`readCardForeignAmountMinor` in `statement-row-matching.ts`), then the
card's cut-off shop name behind the payment app's prefix
(`isCardMerchantPrefixMatch`; several at one shop on one day pair by size),
then a payment-app row naming no shop when it and the estimate are each
other's only fit among what is left. Wording matches work as for any entry.
The commit then writes the card's amount, and the preview says so ("Updates
your estimate for IDR 1,233,430 from SGD 87.95 to the card's SGD 90.30"). An estimate stays open to later activity exports (the
mid-cycle isolation in `isReconciliationCandidateEligibleForSource` does not
apply to it): a newer interim amount updates it, the same amount is skipped,
the promotion snapshot keeps the earlier export's link, and rollback restores
that link and refuses an earlier export while a later one holds the entry.
`tests/foreign-estimate-matching-api.test.mjs` covers the matches and the
refusals; `tests/foreign-estimate-real-citi.test.mjs` runs the 45 Amaze rows
of a real Citi Rewards statement (wording and dates real, amounts scaled)
against simulated Wallet estimates and requires zero wrong pairings;
`tests/foreign-estimate-real-citi-activity.test.mjs` runs a real Citi
activity export from a trip to Bali against the 19 estimates saved for it
and requires each to pair with its own row. `amountMinor` also works
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
- `offsetsCategory` (accepted so older shortcuts keep working, but ignored:
  the category decides whether money in lowers spending, see "Category
  offset" in `DOMAIN.md`)
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
2. Put the card used most often first under Default account.
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
and opens the saved entry's card on the Ask page for optional follow-ups. The request ID makes an HTTP retry
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

Since release v7 (`apple-pay-api-2026-11-10-v7`) the shortcut also handles a
blank amount. An overseas terminal that asks which currency to pay in can
reach the Wallet automation with no amount, and the second tap does not run
the shortcut again. When `amount` is blank or has no figure in it, and the
date, merchant and card are all valid, the endpoint answers 400 with
`{ ok: false, needsAmount: true, merchant, accountName, error }` and saves
nothing (`isShortcutAmountMissing`, `src/domain/shortcut-entry-contract.ts`).
A refused figure (a refund, an ambiguous number) or any other bad field keeps
the plain error without `needsAmount`. On `needsAmount` the shortcut shows
Ask for Input (Text) with the merchant and card, saves the answer as the
amount and posts the same body and the same `requestId` again; Cancel stops
and saves nothing. The amount reader also takes a dot as the thousands mark
(`Rp150.000`, `IDR 150.000`, `1.234.567`): groups of exactly three figures and
no comma; a lone group such as `150.000` needs a Rupiah sign, and `19.82`,
`150.00` and `SGD 12.345` read as before. The request id is built once per tap
into the `TapRequestId` variable so both posts share it. Older installed
copies keep working unchanged but cannot ask; there is no outdated-copy
warning, so the owner reinstalls (Replace) once on each phone.

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
  "openUrl": "https://monies-map.timsantos-accts.workers.dev/ask?saved_entry=txn-...&month=2026-04&view=household&from=shortcut"
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

Before the balance breakdown, the preview runs a deterministic statement
mismatch diagnosis (`src/domain/statement-mismatch-diagnosis.ts`, returned as
`preview.statementDiagnosis`). It accounts for each card's whole difference
(opening gap, unmatched ledger entries in the period, statement rows left
out) and proposes statement fixes: a provisional entry on another card of
the same statement (or the same owner's account at the same bank) that is
the same purchase as a new statement row is moved to that card, and an
undated entry from the last week of the period is deferred to the next
statement. The client sends approved fixes as `statementFixes` with every
preview, so the check shows their result, and with the commit, which
re-checks them on fresh rows, writes them in its own batch before the
certifications (`src/domain/import-statement-fixes.ts`), records them in
`import_statement_fixes` and the audit log, and refuses a move the statement
would not certify. Rollback undoes them. No AI is involved; DOMAIN.md
("Statement Mismatch Diagnosis", "Statement Fix") has the rules. The commit
also works each certificate out from the ledger it leaves instead of taking
the preview's numbers.

The page itself is three steps (design.md, "Import Page Stages"): a
statement is reviewed card by card in `StatementReview`
(`src/client/import-preview-review.jsx`), the one commit control is
`ImportCommitBar`, and the Done card comes from `buildImportDoneSummary`.
`tests/e2e/import-stages.spec.js` keeps the review of the two-card UOB
statement under a page-height budget on desktop and phone.

The comparison pairs rows in `matchStatementCompareRows`
(`src/domain/app-repository-checkpoints.ts`), always on the same signed
amount: the same day with similar text, then within three days with closer
text, then within seven days with a shared merchant word or as the only
candidate on both sides. The velocity rule and the closing-days rule above
apply in every pass. Days are compared on both the posted day and the
purchase day (a statement row's `txn date` note, a ledger entry's
`transactionDate`), so a hand-recorded fare meets the row the bank posted
later. `tests/statement-compare-matching.test.mjs` holds the rules and their
refusals.

Saved data is corrected from Settings → **Compare statement**. The client
sends the card's rows and the PDF's other card sections (`otherSections`);
`/api/accounts/checkpoints/compare-statement` adds
`comparison.statementDiagnosis`, the same diagnosis in `committed` mode
(`src/domain/statement-compare-projection.ts`). Its fixes are statement
corrections (DOMAIN.md, "Statement Correction"): `POST
/api/accounts/checkpoints/statement-corrections/apply` moves an entry to the
card the statement lists it under or removes a provisional second copy, in
one batch with a `statement_corrections` row, an audit event and month
refresh markers; `.../undo` reverses them from that row. Both re-check
everything on fresh rows, refuse (409) a correction that no longer holds or
that would unbalance a saved statement that matches, and are covered by
`tests/statement-corrections-api.test.mjs`,
`tests/atomic-writes-statement-corrections.test.mjs` and
`tests/e2e/statement-corrections.spec.js`.

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
ownership, and splits, but changing date, description, account, amount, or the
direction the money moved requires a replacement statement or explicit
adjustment. The lock (`assertUnlockedBankFactsForEntryUpdate` in
`src/domain/app-repository-entry-commands.ts`) compares the signed amount from
`getSignedLedgerAmountMinor`, so refiling within one direction (income and
transfer in, or expense and transfer out) is allowed: it changes no certified
balance. Expense to income, or transfer in to transfer out, is refused. The
entry editor offers the same choice: on a certified row, Type lists only the
types in its direction (`src/client/entry-type-options.js`) and the transfer
direction stays locked.
Rolling the statement back keeps a transfer entry type that a transfer link
made since needs.

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

The `Velocity Rule` (`src/domain/import-preview-match-policy.js`) picks the
lane's day limit by repetition, not amount: when the file row or the ledger
entry repeats on its own side (another charge of the same signed amount with
lookalike wording within 7 days, reference numbers ignored;
`createRepetitionIndex` in `statement-row-matching.ts`), the limit is 2 days,
otherwise 7. On an official statement, a repeating entry with no posted date
from the period's last two days only matches a row bought the same day or
later (`isRowBeforeLateUnpostedEntry`), so a closing-day ride that posts next
month is offered as "next statement" rather than taken for the previous
day's ride. `docs/audits/velocity-rule.md` has the measurement behind it and
`scripts/audit-velocity-rule.mjs` reruns it.

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

An activity row dated inside a confirmed statement that has no certified
same-amount cover was billed on the next statement: the certified rows are
the statement's complete record, so the app already knows the row is not
part of it. Preview includes it ("Not on the confirmed … statement, so it
counts toward the next statement.") and the commit posts it on the day after
that statement closed, keeping `transaction_date` as the purchase day. The
closed statement's balance never moves, and a row that never reaches the
next statement shows up in that statement's own check
(`src/domain/closed-statement-periods.ts`,
`tests/activity-after-saved-statement.test.mjs`). Exact and probable
statement-covered rows remain skipped.

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

A later activity export catches a dropped row before the statement does, and
without the totals. `findNoLongerListedEntries`
(`src/domain/import-no-longer-listed-entries.ts`) lists, per account, the
provisional entries earlier exports created that are dated within the file's
first and last row and that no row of the file matched (DOMAIN.md, "No Longer
Listed Entry"); estimates, promoted manual entries and transfers never
qualify. The preview returns them as `noLongerListedEntries`, the client
sends the ones the user did not keep back with the commit, and the commit
checks each again before removing it in its own batch, saving the entry in
`import_no_longer_listed_entries` for the rollback. Rolling back an export
whose entry a later export removed is refused until the later one is rolled
back. `tests/no-longer-listed-entries-api.test.mjs` replays a real released
Grab hold; `tests/atomic-writes-no-longer-listed.test.mjs` covers the batch
failures.

A second removal rides in the same commit: Apple Pay entries on the wrong
card (DOMAIN.md, "Wrong-Card Apple Pay Duplicate"). The preview returns
`wrongCardDuplicates` (high: offered, medium: a note); the client sends the
confirmed ones as `wrongCardDuplicates` plus every previewed row as
`reviewedRows`; `buildWrongCardDuplicateRemoval` judges them again and saves
each whole row in `import_wrong_card_duplicates` for the rollback. Tests:
`tests/wrong-card-apple-pay-duplicate.test.mjs` (the rules),
`tests/wrong-card-apple-pay-duplicate-api.test.mjs` (preview, commit, rollback,
both import orders), `tests/atomic-writes-wrong-card-duplicates.test.mjs`,
`tests/wrong-card-duplicates-query-budget.test.mjs`,
`tests/e2e/wrong-card-apple-pay-duplicate.spec.js`.

An estimate is never removed that way. When the row that last updated a
foreign currency estimate is gone, `loadUnlistedEstimates` returns it as
`unlistedEstimates` with up to three rows that may be its final charge. The
client links one by setting that row's `reconciliationTargetTransactionId`
(the usual estimate update and its rollback); the others go back with the
commit as `reopenedEstimates`, and `buildEstimateReopen` restores the bank
facts from the earlier export row's promotion snapshot
(`tests/foreign-estimate-released-hold-api.test.mjs`).

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
  date in the row note. Every card on the statement gets its "Payment Due
  Date"; "Total Minimum Payment Due" is the cards' total, so it is kept only
  when the statement has one card.
- UOB One savings PDFs use the statement period and running balances to validate
  withdrawal/deposit direction.
- UOB current-transaction `.xls` files are old Excel binary workbooks. The
  parser recognizes both bank-account exports and credit-card exports when the
  UOB header row is present.
- Citibank card PDFs use layout-aware parsing for compact card-section rows.
  Citi card PDFs currently expose one row date, so statement certification uses
  that date for both the ledger event date and posted date. Each card gets the
  printed "Payment Due Date".
- Every parser names categories through `inferCategory`, which files bank
  charges and their reversals (`src/domain/bank-charges.ts`) under Fees. A
  Fees reversal lowers Fees through the category offset rule
  (`src/domain/category-offset.ts`); the import commit also still writes
  the legacy `offsets_category = 1`. A
  statement checkpoint's `paymentDueDate` and `minimumPaymentMinor` are saved
  on `account_balance_checkpoints` (`payment_due_date`,
  `minimum_payment_minor`); `/api/summary-account-pills` turns the latest
  one into `cardBill`, its saved notices (`statement_notices_json`) into
  `cardNotices`, and lists `unreversedCharges` for the check-in
  (`src/domain/card-bill-projection.ts`). For bank accounts the same route
  adds the account routine (`src/domain/account-routines.ts`):
  `incomeMoved`, `missedPayments`, `accountCharges`,
  `ownTransfersAsIncome` and `upcomingShortfall` (the scheduled check),
  from one read of the bank entries in the last 200 days.
- Citibank current-activity CSV files are headerless. In the single-file flow,
  the app applies the Citi activity parser when the selected default account is
  a Citibank credit card and known Citi export clues are present, so a pasted
  Citi activity export can jump straight to preview without manual column
  mapping. Recognized filename suffixes can still provide an extra card hint,
  but they are no longer required. In the Import Inbox multi-file flow, the
  user does not need to rename files before dropping them. The trailing card
  number is reduced to the last four digits in the note. The review keeps the
  detected Citi account selectable even when it is already known; changing it
  remaps every preview row and reruns the complete preview checks. Preserve the
  original filename through the normalized-row auto-preview path so a filename
  such as `citi_rewards_...csv` cannot fall back to the previous Citi Miles
  default.
- HSBC mid-cycle Transaction History CSV files are headerless too. The parser
  uses the posting date and final SGD amount, retains the purchase date and
  original-currency amount in the note, and recognises the export from its
  HSBC filename or an HSBC credit-card context. Its rows go to the selected
  HSBC card; else to the household's HSBC card whose name carries the file's
  last four digits (or its only HSBC card, when that name has no other card
  number); otherwise to "HSBC card ending 1234", which the preview lists as
  an unknown account to choose before saving. It never names an account the
  household does not have.
- OCBC card and 360 current-activity CSV files use transaction-history headers
  with withdrawal and deposit columns, so the app can recognize them from
  either the filename or the OCBC account-details and transaction-history
  headers. OCBC 360 browser exports may include account preamble rows and
  compact headers such as `Withdrawals(SGD)` and `Deposits(SGD)`; those are
  parsed directly into reviewable rows without creating a statement checkpoint.
- OCBC 365 and OCBC Infinity Cashback card PDFs use the printed statement date,
  last-month balance, subtotal, and total amount due. Every credit that starts
  with `PAYMENT` (`PAYMENT BY INTERNET`, `PAYMENT - VISA DIRECT` when another
  bank pays the card) is a transfer; other credits such as cash rebates and
  refunds are income. The header's values line gives the payment due date
  ("IMMEDIATE" means the statement date) and the minimum, and the notice
  beside the card's name gives `past_due` or `penalty_interest` (with the
  rate). The cycle opens the day after the previous statement
  date (OCBC prints no cycle start), and the card number on the cardholder
  line above `LAST MONTH'S BALANCE` gives the checkpoint its `accountLast4`. If you create the card account from the import
  page, the opening balance is pre-filled from the printed last-month balance.
- OCBC 360 account PDFs use the monthly period, running balances, and balance
  carried forward.
- OCBC Child Development Acc (CDA) PDFs use the printed statement period,
  opening balance, and balance carried forward. If the statement has no activity,
  the import creates a statement checkpoint with zero rows so the account can
  still be certified.

- iFAST Wrap monthly statement PDFs (`src/lib/statement-import/ifast.ts`,
  `parserKey` `ifast_wrap_pdf`) are an investment account's statement. The
  parser reads the raw pdf.js item view (the visual-line views split the
  account summary row), merges a split "SGD" and amount, and gives:
  the period from `STATEMENT FOR <MONTH> <YEAR> (P<number>)`, the account
  number (its last four digits become `accountLast4`), the currency (only SGD
  imports), Total Assets (kept as `statementBalanceMinor` and
  `investmentValue.totalAssetsMinor`, with market value, cash solutions and
  the income summary beside it), and the plan-level table of INVESTMENT
  TRANSACTION as transfer rows (a contribution is income + `transfer`, a
  Redemption/Withdrawal is expense + `transfer`). The tables of underlying
  unit rows (switches, per-fund RSP buys, reinvested dividends) and the
  fund-level P/L are ignored. A file with no INVESTMENT TRANSACTION heading
  is refused as cut short. The checkpoint is saved as an
  `investment_statement_values` row, never as an
  `account_balance_checkpoints` row, so the certify and reconcile logic never
  sees it; rows land certified on the investment account and pair with the
  bank's GIRO row through `pickReferencedTransferCandidate` (the account
  number in the bank text is the strong signal). Fixtures are four real
  statements, masked item by item (`tests/fixtures/pdf-statement-text/README.md`);
  `tests/ifast-statement-parser.test.mjs`, `ifast-statement-import.test.mjs`,
  `atomic-writes-ifast-import.test.mjs` and
  `tests/e2e/ifast-statement-import.spec.js` cover it. Migration: the two
  tables (`investment_statement_values`, `import_transfer_links`) are
  `CREATE TABLE IF NOT EXISTS` in `schema.sql` (apply with `db:migrate:remote`
  and `db:migrate:demo` before the code is deployed; running it again is safe)
  and are also created by the runtime schema check; every reader tolerates a
  database without them.

- StashAway "Statement of Account" PDFs (`src/lib/statement-import/stashaway.ts`,
  `parserKey` `stashaway_pdf`) take the same path. Detection needs the
  "Asia Wealth Platform" company name plus the statement's own labels
  ("Account Reference Code:", a PORTFOLIO heading), because a bank row can
  name StashAway as a payee. The parser reads the raw item view: the period
  (one calendar month), the owner (the account name is "<owner> StashAway"),
  the reference code (`accountReference`, e.g. "00 XYZ00X"; its last four
  characters become `accountLast4`, which the commit remembers on the account
  when they are four letters or digits, so the next statement finds a renamed
  account), the reporting currency (only SGD imports), and the account
  summary's "Total" row: opening, cashflow (deposits less withdrawals), total
  returns, fees and closing balance. The closing balance is the value
  (`totalAssetsMinor`, `marketValueMinor`; `cashMinor` and `incomeMinor` are 0
  because the portfolio's cash and dividends are in USD inside it). Opening,
  cashflow, returns and fees ride on the value as `openingMinor`,
  `cashflowMinor`, `returnsMinor` and `feesMinor`: the preview uses them and
  nothing saves them (no schema change). Rows: dated "Deposit" and
  "Withdrawal" lines of the TRANSACTIONS page when they add up to the printed
  cashflow, otherwise one entry for the net cashflow dated the last day of the
  period, with a warning that says so. Buys, dividends, currency
  conversions and the management fee are inside the portfolio and never rows.
  The layout of a deposit or withdrawal row is inferred (the nine real
  statements all have a cashflow of $0.00): date, transaction word, "-" for
  units, the SGD amount as the last amount cell. A statement with no
  ACCOUNT SUMMARY or no "Total" row is refused as cut short; portfolios whose
  closing balances do not add up to the total, or a summary that does not add
  up, warn and use the printed total. The preview adds `startsAfter` to the
  investment value when the opening balance is more than a cent from the saved
  value of the month before. Tests: `tests/stashaway-statement-parser.test.mjs`
  (nine real sanitized months), `stashaway-statement-import.test.mjs`,
  `atomic-writes-stashaway-import.test.mjs`, `statement-account-hints.test.mjs`,
  `investment-statement-copy.test.mjs` and
  `tests/e2e/stashaway-statement-import.spec.js`.

For supported PDFs, the browser extracts statement text locally and turns it
into reviewable rows. If the PDF creates statement checkpoints, those fields are
editable before commit.

## How are image-only statements read?

A PDF with no text layer (HSBC Visa Revolution today) is OCR'd in the browser
with the vendored Tesseract in `public/vendor/tesseract/`; nothing is
uploaded. `parseImageStatement` in `src/client/import-helpers.js` parses the
first pass and, when the reading is doubtful, OCRs again in a second page layout
mode and parses both passes together. The statement's printed totals choose
between the two readings.

The bank-independent pieces are in `src/lib/statement-import/ocr.ts`: reading
Tesseract TSV into positioned words with confidence, grouping lines, dropping
dotted-rule noise, reading damaged amounts and dates, and
`resolveOcrAmountsAgainstTotals`. To support another bank's image statement,
write a parser like `hsbc-ocr.ts` that only knows that layout's columns and
summary labels, and route it from `parseStatementText`. The rules every parser
inherits: a read amount is never guessed over, a missing amount is filled only
when it is a total's single unknown, and dates must land inside the statement
period.

When the first pass is doubtful, the parser also returns `ocrReview.cellRegions`:
each row's date and amount cells, and each line with an amount but unreadable
dates, in its reference frame. `extractPdfOcrCells` OCRs each cell on its own
as one line restricted to a date's or an amount's characters
(`OCR_CELL_CHARACTERS`) and returns a `kind=cells` pass. Parsers trust cell
reads first for dates and amounts, still subject to the totals. Whole-column
crops were tried and rejected: dotted rules between rows break Tesseract's
layout analysis inside a tall strip, while single cells read reliably.

When a parser cannot make its rows add up to the printed totals, it returns
the rows it could read with a `reconciliation` (the printed purchases and
credits totals, plus candidates from evidence on the page) instead of
throwing. A candidate is either an amount read on a line no row could claim,
or a dated row whose amount could not be read. While a kind of amount has an
unclaimed amount on the page, the resolver infers nothing of that kind, since
a whole row may be missing. In the app, `import-statement-recovery-model.js`
re-checks the current preview rows against those totals on every change; the
import blocker disables the commit until they add up, and a leftover amount is
offered only while it exactly equals the live difference.

Fixtures for OCR parsers come from real statements, sanitized:

```bash
OCR_SANITIZE_CHECK_TERMS="real name,card digits,street" node scripts/sanitize-ocr-tsv.mjs raw.tsv tests/fixtures/hsbc-ocr/browser-2026/name.browser.tsv
```

```bash
OCR_SANITIZE_CHECK_TERMS="real name,card digits,street" node scripts/create-sanitized-statement-pdf.mjs statement.pdf tests/fixtures/hsbc-ocr/image-pdf/name.sanitized.pdf
```

Both replace the private areas listed for the layout in
`scripts/statement-private-areas.mjs` and refuse to write when a check term is
still there (the PDF script OCRs its own output to check). Pass the real values
only on the command line.

## How are locked (password-protected) PDFs opened?

`openPdfDocument` in `src/client/import-helpers.js` is the one place a PDF is
opened (text extraction and the OCR session both use it). It catches pdf.js's
`PasswordException`, loads `src/client/pdf-unlock.js` lazily and calls
`openLockedPdf`, which tries a password already held for the file or the
batch and otherwise asks through an `askPassword` callback until the file
opens, the person skips (`LockedStatementSkipped`) or the tries run out (5).
The Imports panel wires the callback to `LockedStatementDialog`; a page with no
callback (the Settings statement check) gets a plain `LockedStatementError`.

The password rules are enforced and tested, not conventions: it lives in a
closure per file (`createPdfUnlocker`) and an optional batch keeper
(`createBatchPasswordKeeper`), never in React state, a query key, a URL, a
request, storage, a log line or an error message, and `memory-secrets.js`
(`holdSecret`, `redactSecrets`) hides it from the crash report and the
import diagnostic as a last defence. `tests/locked-statement-unlock.test.mjs`
spies on `console`, `fetch`, `localStorage`, `sessionStorage` and
`indexedDB.open`; `tests/e2e/locked-statement-import.spec.js` records every
request. Do not add logging around the unlock path, and do not pass the
password to any new helper: attach behaviour to the unlocker instead. The AI
statement fallback is never reached for a locked file. Full threat model:
`docs/audits/locked-statements.md`.

The locked test PDFs (fake password `TESTCARD12345678`) are generated by
`node scripts/make-locked-pdf-fixture.mjs` into `tests/fixtures/locked-pdf/`.
It needs Ghostscript (`gs`) for the image statements and nothing else; the
generated files are committed, so the tests do not need it.

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

## How do I measure what a page costs the server?

In production the Worker waits a network trip (about 100 to 180 ms) for
every D1 read it makes after another one, so a page is as slow as its
longest chain of sequential reads. Send independent reads together
(`Promise.all`) and keep each page to two or three steps; the page-load
scale guard (`tests/page-load-scale-guard.test.mjs`) fails when a page's
chain grows.

```bash
# Every page read through the real Worker on the 10k-entry test household:
# round trips, sequential steps, rows read, bytes, CPU, the wall time with
# 25 ms added per round trip, and a cold isolate (fresh Node process).
node --import tsx scripts/measure-page-reads.mjs --runs 21 --cold 3 --explain

# The same on a local copy of a database (for example an export loaded with
# `wrangler d1 execute monies-map-test --config wrangler.test.jsonc --local
# --persist-to <dir> --file <export.sql>`; it prints counts, never values).
node --import tsx scripts/measure-page-reads.mjs --db <dir>

# Prove a read-path change returns the same data: dump every page response
# before and after on the same database and compare (prints only the
# requests that differ and where).
node --import tsx scripts/page-dto-dump.mjs before.json --fixture scale
node scripts/page-dto-dump.mjs --compare before.json after.json
```

A browser cohort can wait on D1 the same way: wrap an extracted copy with
`D1_COUNTER_LATENCY_MS=100 node scripts/wrap-d1-counter.mjs <copy>` before
running `npm run test:performance` there. The numbers and the method of the
last pass are in `docs/audits/speed-pass-2026-10.md`.

## How do the colour presets load?

The 70s Warm light default is the only scheme in the first-screen
`styles.css`. Every other preset and mode (Settings → Colours: nine presets,
each Light or Dark, or Auto to follow the phone) is a small stylesheet in
`public/palettes/<id>-<light|dark>.css` (seventeen sheets, including
`70s-dark.css`) that overrides the colour tokens under
`:root[data-palette="<id>"]` and `data-mode`; the build minifies them like
`styles.css`. A short inline script in `index.html` reads the stored
choice (`localStorage["monies-map:palette"]` and
`["monies-map:colour-mode"]`, nothing stored meaning 70s Warm and Auto),
resolves Auto with `prefers-color-scheme`, and writes that sheet's
`<link>` into the head before the page paints, so a reload never flashes
the default. In Auto it also listens for the phone switching and loads the
other sheet before flipping `data-mode`. To change a preset, edit its sheet and run
`tests/colour-contrast.test.mjs` and `tests/colour-presets.test.mjs`: they
fail on any unreadable pair or missing token. design.md, "Colour presets",
has the token list.

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

On a phone, Summary, Month and Entries have one floating Support bar above
the bottom navigation: the person's chip in their colour, the short scope
(`Direct + Shared`) as quiet text and a caret, then the month control as a
chip (Summary and Month) or previous and next period buttons (Entries). It
sits on the shared chrome tokens (`--chrome-*` in `public/styles.css`) and
every target is at least 44 px. Tapping it opens a bottom sheet in Lead ·
Support · Detail: who you are viewing and what the scope counts, then the view
and scope as segmented chips (the scope group only when that view has more
than one), then, on Entries, the filters as quiet rows that open the existing
pickers; `Reset filters` and `Done` sit in the bottom bar and a swipe down
closes it. The sheet's inside is a lazy chunk
(`src/client/mobile-context-sheet.jsx`) so the first screen does not carry the
swipe code; see "Phone Chrome" in `design.md`. Browser proof:
`tests/e2e/mobile-chrome.spec.js`.

## How do Summary and Month share one tab?

`/summary` is the Summary tab's "All months" and `/month?month=YYYY-MM` one
month of the header's range; both routes and their page APIs are unchanged,
and the route registry in `App.jsx` gives the Summary tab both route ids.
Month choice rules live in `src/client/summary-month-choice.js`: a month
choice pins the range into the URL (`summary_start`, `summary_end`), a header
range change clamps a picked month into the new range, and the sheet's
figures come from the Summary page months. `buildSummaryPageParams` sends the
range end as `month` when both bounds are set, so every month of a range
shares one Summary cache entry, and `seedPinnedSummaryPage` reuses the page
already loaded when the range is first pinned. On `/month` the range's
Summary page loads beside the Month page through the Summary owner; from All
months it is a cache hit. The phone island control and desktop month row
(`summary-month-picker.jsx`) ship with the shell; the "Pick a month" sheet
(`summary-month-sheet.jsx`) is a lazy chunk. Browser proof:
`tests/e2e/summary-month-choice.spec.js`. Adding a primary tab to the phone
bar is one `primary: true` line in the registry; the bar's grid takes its
column count from `--primary-tab-count`.

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

## How are sheets and screen tops laid out?

They follow one design language, Lead · Support · Detail (design.md): one
lead card with the figure you look at first, a few Support chips inside it,
Detail rows for the fields you change, and the main action in a bar at the
bottom of a sheet. The blocks are `LeadCard`, `MetaChip`, `DetailRows`,
`DetailRow`, `MoreDetails` and `BottomActions` in
`src/client/ui/lead-support-detail.jsx` (with its own tokens-only CSS); a
caller passes the copy, the controls and the handlers. The Summary top
(`summary-lead.jsx`) and the Month plan-row sheet (`month-plan-sheet.jsx`)
use them. `tests/lead-support-detail.test.mjs` renders each block's states;
`tests/e2e/lead-support-detail.spec.js` checks the plan sheet on an iPhone
13 profile (tagged `@webkit`), its 44px tap targets and the Summary lead's
figures. The colour guard reads `src/client/ui` too.

Dialogs and small sheets use one more shared piece, `SheetDialog`
(`src/client/sheet-dialog.jsx`, CSS in `sheet-dialog.css`): on a phone it is
the shared `EntryMobileSheet` with the actions in its bottom bar, on a wide
screen a centred Radix dialog with the same head, lead, rows and bar. A caller
passes the copy, a `lead` (`LeadCard`, or `ConfirmLead` for a confirmation),
the rows or fields as children, and the actions (`primaryLabel`, `onSubmit`,
`quietLabel`, `destructive`, `tone="danger"`). `dismissible={false}` is for a
dialog that must be answered. Mount it only while it is open. Keep it, and
anything that imports it, out of first-screen files: `App.jsx`,
`summary-panel.jsx`, `responsive-select.jsx` and `ui-components.jsx` load
`login-registration-dialog.jsx`, `month-note-dialog.jsx` and `picker-sheet.jsx`
with `React.lazy`, and `check:bundle` fails if a new first-screen file appears.
`DeleteRowButton` lives in `delete-row-button.jsx`, not in `ui-components.jsx`.
`tests/e2e/dialogs-lead-support-detail.spec.js` proves each dialog's primary
action, Cancel, destructive confirm, tap targets and hidden money.

## How do figures open their entries?

Every figure on a card is an openable figure (design.md "Openable
figures"): it carries `data-fig` (and its period, `data-fig-period`, on it
or a parent), and one captured listener in `App.jsx` loads
`src/client/figure-menu.js` with a dynamic import on the first tap, click,
Enter or Space and opens its menu (View entries, Open plan, Open Splits,
Ask about this). What the menu offers is `figureMenu` in
`figure-menu-model.js`. View entries opens Entries with `entry_figure` (the
figure's rule, `src/domain/money-figures.ts`) and, for a Summary range,
`entry_from` and `entry_to`, which make the page ask
`GET /api/entries-page?view=…&month=…&from=YYYY-MM` for every month of the
range (at most 24). Entries then filters to the rows behind the figure
(`entry-filtering.js`) and leads with its total, worked out through the
same `splitMoneyUse` the card used. `tests/openable-figures.test.mjs` runs
every figure kind, view and scope on the real Worker and checks the total
equals the card's figure to the cent; `tests/e2e/openable-figures.spec.js`
proves the menu, the keyboard, hidden money and the phone. A new figure on
a card adds its rule to `money-figures.ts` and its equality test there.

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
language, suggest category-rule drafts from existing categorized history,
fill a missing amount or description in an entry draft, or
rank descriptions among candidates that the app has already constrained by
account, amount, and date. Summary, Month, Entries, and Splits also show
Money insights for the figures already on screen (see [How do Money
insights work?](#how-do-money-insights-work)). They come only from the
app's own calculations and use computed wording only: the headline is the
bold fact and its think line exactly as written, and no AI is asked to
reword them (an earlier optional rewording produced broken grammar and was
removed). In a person view, the Summary and Month insights count only that
person's entries in the selected scope, the same entries as the `Actual
spend` card beside them.

Those insights are guidance, not a recalculation. They never predict
spending, promise what is safe to spend, give a month-end balance or set a
savings target, and they never replace the plan or the ledger. The one look
ahead is the scheduled check (`upcomingShortfallSignal`): a bank account's
latest statement (no older than 40 days) against payments that already
repeat from it, due within 31 days, shown only as a To do when one won't
fit (AGENTS.md, DOMAIN.md "Account Routine").

The **Money consequence map** that used to sit under `See all insights`
(money left so far, plan position, same-season comparison, snapshot
confidence and a one-repeat scenario) was removed from every page: it
repeated the signals, and the one-repeat card bordered on a forecast. The
same facts now live only in signals: a plan Worth knowing or Something to think about,
the same-season Big picture (only when last year's month is already in the
range) and the statement-gap To do. `tests/money-consequence-map-retired.test.mjs`
fails if any of it comes back.

When the app has concrete evidence worth reviewing, a signal carries one
action that opens an existing workflow: the filtered Entries list for the
entries it names or its category, Imports for a statement gap, the Splits
settle-up or bank-match view. The links that sat under the map with no
signal behind them (`See income entries`, `Review largest expense`,
`Review bank-record gaps`, Summary's `Review <category>`) are gone; only
Splits keeps its `Review N bank matches` link under `See all insights`,
because its bank-match To do owns it. Actions are generated by the app
from record IDs and current filters; AI never chooses or invents a record
link.

The Monthly Note and statement-mismatch wording services receive placeholder
names rather than the actual figures, merchant names, account names, or
ledger rows. The app inserts the already-computed values only after
validating the model's template. AI cannot
import transactions, change a category, skip a row, certify a statement, or
link a transfer on its own. Use the normal review controls to accept any
suggestion.

These four (Monthly Note, mismatch wording, category-rule drafts and the
statement fallback) go through the same provider as receipts: Claude
through AI Gateway when it is set up, with logging and caching off, and
Workers AI Gemma otherwise or when Claude fails. Each sends a JSON schema
for its answer, and the app's own check still decides whether the answer is
usable; the allowance cost of each is unchanged.

For a PDF that no supported parser can read, Imports offers an explicit
checkbox to allow an AI fallback. The browser still tries the dedicated parser
and private in-browser OCR first, including HSBC image statements. Only the
locally extracted text is sent after you opt in; the original PDF is neither
uploaded as a file nor stored. Fallback rows always start as **Needs review**
and do not create a statement balance checkpoint automatically.

**Entry drafts** (server groundwork; no screen calls it yet).
`POST /api/ai-assist/entry-draft` with `{ "text": "Koufu lunch $12.50
yesterday, Citi", "viewId": "person-…" }` returns `{ ok, draft, ai }`. The
draft (`EntryDraftDto`) gives each create field with its source
(`sentence`, `rule`, `default` or `ai`), a `missing` list, structured
`questions` and `flags`, and, when nothing is missing, a `createBody` that
`/api/entries/create` accepts unchanged. The reading is deterministic
(`src/domain/entry-draft.ts`) and works with AI off: amounts and currencies
(`$12.50`, `S$38.60`, `SGD 12.5`, `12 dollars`, `IDR 159,000`), date words
(today, yesterday, a weekday meaning the most recent past one, `28 Sep`,
`28/9`, `29/09/26`), account names, people, split words and transfer or
income phrases. It never guesses: two amounts, an account name that matches
several accounts, an inactive account, an uneven split, an unclear payer,
a bad date and an amount in another currency are asked. A payment word
("paynow", "FAST", "GIRO", "NETS", "bank transfer", "cash") with no account
named uses that person's payment way from Settings -> Payment ways (stored
in `app_settings` under `payment_ways`, saved through
`POST /api/settings/payment-ways/save`, `src/domain/payment-ways.ts`). With
none chosen, cash is asked (`accountId` question, reason `missing`) and a
bank word keeps Default account unless that is a card, which is
asked too. AI is asked only when the sentence
named no amount or left no description: one allowance unit, the redacted
sentence alone, 80 tokens. Its answer fills only those gaps after
validation (the amount must be stated in the sentence, the description must
use its words), and when AI is off, failing, over its allowance or
unusable, the deterministic draft comes back with `ai.available: false`
and the reason. The route saves nothing; the user saves a confirmed draft
through the normal create route.

Receipt reading (`POST /api/ai-assist/receipt-read`, server only for now)
is the one path that sends an image. It runs only for a receipt image or a
rendered PDF page that you explicitly paste, drop, scan or share. The
browser must shrink it (at most 1.5 MiB) and strip EXIF and location data
first; the Worker accepts only JPEG, PNG or WebP whose bytes match the
declared type. The image goes to the provider once (Claude through AI
Gateway with logs and caching off, or Workers AI) and is then discarded:
it is not stored, logged or cached by the app. The answer is a draft
(merchant, date, total, currency, the card's last four digits, line items
and questions for unclear fields), validated by the app; nothing is saved
until you tap save in the normal entry editor. When AI is off, missing,
over its allowance or failing, the route answers at once and the browser
reads the same image with in-browser OCR (`readReceiptOcrText`). See
[How do I set up the optional AI provider?](#how-do-i-set-up-the-optional-ai-provider)
for the provider settings.

The Ask page's mic uses the browser's own speech recognition first, which
sends nothing to the app. Only a browser without one records a clip of at
most 30 seconds, when you hold or tap the mic, for
`POST /api/ai-assist/transcribe` (Workers AI Whisper, 1 unit of the daily
allowance). The clip and the words are neither stored nor logged, and the
words only fill the message box: nothing is sent until you tap Send. With AI
turned off, the mic is hidden in such a browser.

The app keeps only daily AI usage counters so it can stay within its configured
allowance. It does not save prompts, model answers, receipt images, original
PDFs, credentials, Shortcut tokens, or full card/account numbers as an AI
history.

## How does the Ask page work?

`/ask` is a lazy route (`src/client/ask-panel.jsx`); the full contract is in
`docs/flows/ask-flow.md` and the look in `design.md` ("Ask page"). It has
three ways in: the Ask tab (chat mode, with a "since you last looked" card
built from the Summary data already cached, never a fetch or AI call), the
Entries + and Splits receipt buttons (`?mode=add` / `?mode=expense`, the new
entry card), and the Apple Pay Shortcut's `openUrl` (`?saved_entry=<id>`).

On a wide screen there is no Ask tab: `ask-dock.jsx` (the only dock
code in the first screen, with `ask-dock-field.jsx` and `ask-dock-entry.js`;
the panel, store and layout rules load in the Ask page's chunk on the first
way in, so `npm run check:bundle` stays within budget) puts a one-line Ask field at the bottom right of every page but
`/ask`, and opens the same `AskPanel` beside the page with a `placement`
prop: docked from 1,280 px (the body gets the panel's width as right
padding, so the page narrows), a popup from 761 px. `ask-dock-layout.js`
holds the pure rules (`tests/ask-dock-layout.test.mjs`) and
`ask-dock-state.js` the per-tab session state (`monies.askDock.v1`:
open, mode, way in; `tests/ask-dock-state.test.mjs`; the first-screen hand-off
is `tests/ask-dock-entry.test.mjs`). The conversation is
the shared store's, so the panel and `/ask` are one conversation. The
header and the Month mid-width rules are container queries on `.shell`,
so the narrowed page lays out like a window of its width.
`tests/e2e/ask-dock.spec.js` runs it at 1,024, 1,280 and 1,440 px, and
`tests/e2e/header-tab-fit.spec.js` checks every page's header with the
panel docked.

The card is a pure state machine (`ask-card-model.js`) with unit tests for
every state. Saving goes through the Entries composer's create path
(`entry-create-request.js`: `/api/entries/create`, then
`/api/splits/expenses/from-entry` when Splits is on); Undo uses the existing
delete routes. There is no new write route. Each card sends its stable
client id as `externalReference: "ask:<id>"` (the route accepts only that
shape); a repeat create with the same reference returns the entry already
made (`created: false`, with `linkedSplitExpenseId`), so a save repeated
after a reload never adds a second entry or split.

A sentence or a receipt photo fills the card through the two reader routes
in `ask-api.js`, the one module to adjust when they land:
`/api/ai-assist/entry-draft` (branch `ai-entry-draft`) and
`/api/ai-assist/receipt-read` (branch `ai-provider-receipts`). Both are
explicit actions and both fail soft: the card stays manual with a calm note.
A receipt photo is downscaled to 1600 px and re-encoded as JPEG in the
browser before it is sent (no EXIF or location), kept in memory only for
its thumbnail, and read on the device by the app's own Tesseract worker
when the reader is unavailable. The browser tests stub both readers
(`tests/e2e/ask-page.spec.js`).

The composer is one field holding a + glyph (a Radix popover with Take a
photo, Choose a photo and Paste over the existing file inputs and paste
reader) and the mic glyph, with Send or Save outside it;
`tests/e2e/ask-composer.spec.js` measures the 44 px hit areas, the
three-line growth and that every placeholder fits at 375 px.

The composer's mic (`src/client/ask-voice.js`) is a small state machine
(`createVoiceController`: idle, starting, listening, transcribing, hidden)
with a hold-or-tap gesture (`createPressGesture`), unit tested in
`tests/ask-voice.test.mjs`. It uses `SpeechRecognition` /
`webkitSpeechRecognition` (en-SG, then en-US) with interim results, and only
fills the message box. A browser without speech recognition records a clip
with `MediaRecorder` for `/api/ai-assist/transcribe`
(`src/server/transcribe-route.ts`, `tests/transcribe-route.test.mjs`): a
`GET` on the first press says whether it is on, the `POST` checks type,
size (1 MiB) and duration (30 s) before reserving 1 allowance unit and
calling `@cf/openai/whisper-large-v3-turbo`. The test Worker has AI off, so
`tests/e2e/ask-voice.spec.js` stubs `SpeechRecognition` in the page with
`addInitScript` for the main path and uses the real route for the hidden
fallback. To try voice by hand in desktop Chrome, use `localhost` (the
microphone needs a secure origin) and allow the microphone.

The conversation (thread, card, typed words, an open follow-up) lives in
`src/client/ask-conversation-store.js`, a module-level owner the page binds
with `useSyncExternalStore`, so leaving Ask or reloading the tab restores
it. It is mirrored to sessionStorage (`monies.askConversation.v1`, at most
60,000 characters, never photos, audio or status lines) and publishes
whether a conversation is in progress to the tiny
`ask-conversation-presence.js`, the only part in the first screen, for the
Ask tab's dot (`tests/ask-conversation-store.test.mjs`).

Search and filter questions are read on the device by
`src/client/ask-filter-reader.js` (no request, no AI) from the people,
wallets and categories already loaded; `tests/ask-filter-reader.test.mjs`
holds the scenario table. An answer's numbers go through the Entries URL it
opens and back through the Entries page's own reader and filtering
(`entry-filter-params.js`, `entry-filtering.js`, `ask-filter-answer.js`), so
they always match the Entries page (`tests/ask-filter-answer.test.mjs`,
`tests/e2e/ask-search.spec.js`). An answer adds `entry_min` / `entry_max`
and `from_ask=1` to the Entries URL; the last shows the From Ask chip.

Money questions ("why was August so expensive?", "what do I owe Serene?")
are read first by `src/domain/ask-answer-intent.ts` (rules, shared by the
page and the route) and sent to `POST /api/ai-assist/answer`
(`src/server/ask-answer-route.ts`). The route checks the skew candidates of
the answer's month(s) first and returns `needsConfirmation` with the
candidates when one would change the figures; otherwise it reads the facts
from the Month and Splits page DTOs (`ask-answer-facts.ts`,
`pages/ask-answer.ts`), builds the card and a computed wording
(`ask-answer-wording.ts`), and, only with AI on, asks the provider to
phrase the wording, kept only if `validateAiWording` passes. The page shows
`ask-money-answer-card.jsx`; Mark as settlement / Link as transfer post the
candidate's suggested actions through `resolveSkewCandidate` (an allowlist
of the existing routes) and ask again. Tests: `tests/ask-answer-*.test.mjs`
(intent table, showcase figures against the page DTOs, skew first, AI
validation and fallbacks), `tests/ask-money-jobs-answers.test.mjs` (the
"where your money goes" questions against the Month and Summary lead's own split),
`tests/ask-money-answer.test.mjs` and
`tests/e2e/ask-money-answers.spec.js`; audit
`docs/audits/ask-answers-audit.md`.

## How do Money insights work?

Money insights (the "check-in" in code: `money-signals/checkin.ts`,
`FinancialInsight`) are built in the browser from data the page already loaded; it
adds no endpoint or payload. The code is in `src/domain/money-signals/`:

- **Signals.** `summary-signals.ts`, `month-signals.ts`,
  `entries-signals.ts` and `splits-signals.ts` hold one small pure function
  per signal (`statementGapSignal`, `planLeftSignal`, ...). Each returns
  `{ key, kind, weight, numbers, phrasings, action? }` or `null` when its
  condition is not met. `weight` is the money involved; `numbers.primaryMinor`
  is what "moved" is measured on. The page's copy catalogue
  (`SUMMARY_COPY`, `MONTH_COPY`, ...) beside the functions holds the approved
  phrasings (3 to 5, all with the same numbers), the think lines, the
  one-time "Sorted" line of a quick fix and the action label. Signals take
  `today` and the money formatter as inputs and never read the clock. A
  Fun fact builder returns a `triviaSignal(type, detail, copy, values)`;
  its `type` is what the page's rotation schedules. Place names go through
  `tidyName`, which drops reference numbers, card and unit codes and "SINGAPORE
  SG", and returns nothing for a PayNow, GIRO or transfer, so the builder
  skips that entry rather than print a code.
- **Kind names.** The chips read To do (`quick_fix`), Something to think
  about (`bigger_question`), Worth knowing (`worth_a_look`), Going well,
  Fun fact (`just_for_fun`) and Big picture (`long_view`); the code keeps
  the older names (`SIGNAL_KIND_LABELS` in `types.ts`). Copy follows the
  plain-words rule in `docs/money-insights-copy.md` ("Tone"), and
  `findAppJargon` in `tone.ts` fails a line that talks about the app ("the
  app", "chart", "unlinked", "ledger", ...).
- **Ranking.** `rankSignals` in `checkin.ts` orders headline candidates by
  kind (To do, Something to think about, a moment such as payday or bills coming
  up, Worth knowing, Going well), then by money, then by not seen recently.
  A signal marked `yieldsToBiggerQuestion` goes right after a bigger
  question instead: Month marks its statement gap this way, so the month's
  own bigger question leads and the gap is listed under "Also this month"
  (Summary still leads with it);
  a signal shown in the last three days goes after the rest unless its
  number moved by 10% or $50. Only one bigger question is kept. Big picture
  and Fun fact are picked separately.
- **Notability.** A signal that is true almost every month says whether
  this period's numbers are unusual. When they are not it returns
  `steady: true`: `rankSignals` leaves it out, and `composeCheckIn` lists it
  under "Also" after everything notable (a calm month lists nothing). A
  steady signal with a `turn` (0, 1 or 2) may still lead in one month of each
  quarter, by the period's month number mod 3 (`isQuarterTurn` in
  `rotation.ts`; turn 0 is Jan, Apr, Jul, Oct, 1 is Feb, May, Aug, Nov, 2 is
  Mar, Jun, Sep, Dec). A month with nothing notable leads with a Going well
  that fires, otherwise the calm line. The thresholds:
  - Entries, five largest (`TOP_FIVE_ONE_OFF_SHARE`): notable when one-off
    purchases among the five (named places, not a bill, utility, loan, rent,
    insurance, subscription, tax, savings, investment, fee or transfer, nor
    a PayNow or GIRO payment) come to 25% or more of the month's spending.
    A fixed "five largest are 65% of spending" does not work: on the
    showcase, Ethan's parents' allowance, insurance and bills are always
    his largest entries, so the five are 63 to 82% of every month. The
    one-off test picks out the Japan trip in April and July's aircon and
    sofa, and leaves the other ten months calm. No turn.
  - Summary, subscriptions (`SUBSCRIPTIONS_CHANGE_RATIO`,
    `SUBSCRIPTIONS_CHANGE_MINOR`): notable when the month's total moved 10%
    or $20 from the month before, when that month is in the range with
    spending of its own. Otherwise turn 2, so at most once a quarter.
  - Summary, months under plan: notable in the month that came back under
    plan after one over it. Otherwise turn 0.
  - Month, category over plan (`CATEGORY_OVER_RATIO`,
    `CATEGORY_OVER_MINOR`): notable when 10% and $20 over its plan; a few
    dollars over is steady with no turn. A budget that runs well over every
    month still leads every month: that is plan variance worth a decision,
    in a new wording each month.
  - Month, plan left (turn 1) and savings on plan (turn 2): steady.
  Big picture lines (keep rate, cushion, fixed costs, same season, share of
  costs) and Fun fact lines (the average entry, a category's share)
  never lead, so they need no test. To do lines, Something to think about lines and
  moments are notable whenever they fire.
  `tests/money-insights-notability.test.mjs` pins each rule both ways, and
  the 24-month walk fails when anything that is not a To do or Bigger
  question leads more than 4 of any 12 months without being notable each
  time.
- **The year rule.** Everything that rotates follows the `period` the page
  passes: Month and Entries their month, Summary the range's last month,
  Splits the current month for the selected group. For one page and view,
  nothing shown for a period is shown again in the eleven periods before or
  after it, with or without browser storage (`rotation.ts`):
  - Fun fact: each page's `*_TRIVIA_ROTATION` has twelve columns, one
    per month number. A period reads only its own column: the type whose
    turn it is this year, then its reserves, and no trivia rather than a
    type from another column. Two periods less than twelve apart read
    different columns and every type sits in one column, so no type can
    repeat. Moments (Summary's year recap and anniversary) go first; each
    fires in at most one period of any twelve. Month and Entries share no
    type.
  - Wording: every phrasing with every think line it may pair with, taken
    in turn by month (`wordingsOf`, `selectWording`). A signal that can
    recur needs 12 or more of them.
  - Big picture: a seasonal moment leads, otherwise the long views that fire
    take turns by month.
  - Quotes: a quote's place in `quotes.ts` (mod 12) is its column; each page
    reads a different column in the same month (Summary, Month, Entries and
    Splits three apart) and moves on one a month. In the column it takes the
    quote fitting the headline's topic, else the calm one.
  - Calm lines: twelve per page, one per month.
- **Rotation and visits.** `composeCheckIn` takes the signals, the period,
  the page's trivia rotation and calm lines, the visit memory, `nowMs`,
  `today` and a stable seed, and returns the headline, up to three more
  lines, the long view, the fun line and the quote topic. The memory only
  adds: a headline shown in the last three days rests, a number that moved
  leads with "Down from ... since your last visit.", a cleared quick fix is
  sorted once, and a visit in the last three days with nothing new is one
  quiet line (never twice in a row). A revisit of the same period keeps its
  wording, trivia and quote. The same inputs always give the same check-in,
  so tests pin every rule (`tests/money-checkin-engine.test.mjs`,
  `tests/money-insights-year-rotation.test.mjs`, which walks 24 months of
  every page).
- **Visit memory.** `src/client/checkin-visit-memory.js` keeps it in
  localStorage under `monies-map:checkin:v1:<page>:<view>[:<group>]`, with
  every access in try/catch; missing or broken storage reads as a first
  visit. `recordVisit` writes what was present and shown; nothing about
  visits goes to the Worker or AI. The component composes from the memory as
  the page found it, so recording a visit never changes what is on screen.
- **Quotes.** `quotes.ts` holds public-domain quotes, each copied exactly
  from the source it names (author, work, year and the text checked against
  the original). It is loaded with a dynamic import when "See all insights"
  opens, so it never weighs on the first screen.
- **Loading.** Summary is the first screen, so its signals and every copy
  pool (`summary-signals.ts` with `SUMMARY_COPY`, the statement gap's copy
  and the calm lines in `calm-lines.ts`) are a chunk of their own.
  `src/client/money-insights-loader.js` imports it; the Summary route loader
  (`route-modules.js`) starts that import beside the route's own, and App
  loads the active route's code while its data loads, so the insights have
  normally arrived when the panel first renders. The panel never waits:
  until the module arrives the insights show their frame (the label and
  one empty line). `npm run check:bundle` fails if a
  line of any pool lands in a first-screen file. The engine (`checkin.ts`)
  must not import `format.ts`, or the shared module becomes an extra
  first-screen file; it keeps its own copies of `fill`, `stableHash`,
  `weekdayName` and `daysBetween` (`engineText`), which a test keeps equal
  to `format.ts`'s. Month, Entries and Splits keep their signals in their
  own route chunks. Add a quote at the end of
  the list; keep a calm quote in every column (the test checks).

To add a signal: write the test first in the page's
`tests/money-signals-*.test.mjs` (it fires with concrete numbers and the
exact wording, and stays silent when its condition is not met), add its copy
to the page's catalogue and describe it in `scripts/money-insights-copy.mjs`, add
the function and list it in the page's `build...Signals` (if it can be true
month after month, give it a notability test and `steady`), then run
`npx tsx scripts/money-insights-copy.mjs` to regenerate `docs/money-insights-copy.md`. An
action may only reuse a navigation the page already has. A signal that can
show month after month needs at least 12 wordings (for example 3 phrasings
with 4 think lines); the copy test counts them.

To add a Fun fact line: pick a new trivia type name, write its exact
line and a test that it stays silent when its data is missing
(`tests/money-insights-trivia.test.mjs`), add the builder with
`triviaSignal(type, ...)` using only data the page already loads, and put the
type in exactly one column of the page's `*_TRIVIA_ROTATION`, as a reserve
beside a type that often cannot fire. Describe it, with its type, in
`scripts/money-insights-copy.mjs`. Keep it kind: it may count places,
days and amounts, never a habit to shame it. The year-rotation walk then
proves it still never repeats within twelve months.

The tone lint (`tone.ts`, run by `tests/money-insights-copy.test.mjs`) checks
every phrasing, think line, sorted, trivia, quiet and calm line and the
quotes: no word from the avoid list (overspent,
blew, bad month, cut back, should, non-essential, guilty, sacrifice,
warning, alert, problem and a few forms of them), no exclamation marks, no
emoji, and no percentage without its money amount. The same lint refuses AI
wording that breaks it. The test also fails when `docs/money-insights-copy.md` is
out of date.

# Product and data model notes

## How is the planning model stored?

The app separates a month into two layers:

- bills and dated payments (stored as `planned_items`)
- monthly budgets (stored as `budget_buckets`)

Bills and dated payments are intentional commitments or recurring obligations. These are
the rows near the top of the month, such as savings, tax, subscriptions, house
loan, insurance, and other known items.

Monthly budgets are flexible categories, such as food, groceries, transport, and
shopping. These are not supposed to predict every single merchant in advance.

Bills and dated payments and monthly budgets match actuals differently. A bill or dated payment is
matched explicitly to one or more ledger entries, because several of them
can share a category such as `Bills`. Monthly budgets remain category-driven and
roll up the remaining actual expense entries for that category.

When a bill or dated payment has many possible ledger matches, the matching dialog does
not run a full ledger search first. It starts with lightweight narrowing:
`Linked`, `Same category`, `Same account`, `This month only`, and a description
contains filter over the ranked candidate list. This keeps the flow faster than
global search while still making long categories such as `Food & Drinks` easier
to narrow down.

On mobile, this bill and dated payment matching flow uses the same bottom-sheet pattern as
the other month add and edit forms instead of a centered modal.

After a bill or dated payment is matched, the app remembers lightweight matching hints
from the linked ledger entries so future months can suggest likely matches. It
does not auto-link them yet; the user still confirms the matches.

Monthly budgets are reduced by money in under the same spending category, such
as a refund or a friend paying back their share (`src/domain/category-offset.ts`,
"Category offset" in `DOMAIN.md`). The same rule lowers spending on Summary,
the Month totals, the Entries totals and breakdown, and the check-ins, and keeps
that money out of income, so net is unchanged. Transfers still do not count
toward budget-bucket actuals.

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
Summary's and Month's Money insights count the same entries, so in Tim's
Direct + Shared view the Month insights' facts use his $120.00, the same as
his `Actual spend` card, and switching to `Shared` makes both use $20.00.

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

## How are likely unlinked settlements and own-account moves found?

Money that moves inside the household can arrive as spending and income. A
simplified settlement says Ethan pays Serene $182.45; the PayNow is imported
as an expense in Other on Ethan's account and as income in Other - Income on
Serene's, so the month's spending and income are both $182.45 too high until
the pair is linked as a transfer and matched to the settlement. A move from
Ethan's OCBC 360 Account to his UOB One Account filed as Salary inflates
income the same way.

`GET /api/skew-candidates?view=&month=&scope=` flags these as skew
candidates (DOMAIN.md, "Skew Candidate"). It is read-only, uses no AI, and
nothing on screen calls it yet. The rules live in the pure
`src/domain/skew-candidates.ts`: exact amount, a settlement within 5 days of
an open settlement's date (or within 14 days after a split group's last
open activity, for a group balance), an own-account move within 3 days,
accounts owned by one person, and never an entry that is already linked.
Each candidate carries its reasons, how much it skews the view's spending
and income for the month, and the existing routes that fix it (link as a
transfer, then match the settlement). A settlement where only one side was
found and its description names nobody is `medium` confidence and hidden
by default; add `&include=medium` to see those too. `tests/skew-candidates.test.mjs` and
`tests/skew-candidates-api.test.mjs` hold the rules and their refusals.

## How are trips and events stored?

A trip or event (DOMAIN.md "Trip or Event") lives in two additive tables in
`schema.sql`: `trip_events` (name, icon, optional dates, currency, split
group link, put away) and `trip_event_entries` (one row per entry, so an
entry is on at most one; deleting the entry or rolling back its import
takes the row with it). Every reader tolerates the tables missing and the
commands then refuse with "Trips and events need a database update first."

Routes (`src/server/trip-events-route.ts`, bodies read through
`readJsonObject`): `GET /api/trip-events`, and `POST` to `/save`,
`/entries/set` (`{ entryIds, tripEventId }` or `{ changes: [{ entryId,
tripEventId }] }`, at most 200, `tripEventId: null` takes entries off,
`"new"` with `newTripEvent` makes one in the same batch), `/put-away`,
`/delete` (the entries stay) and `/undo` (`{ undoId }` from a set or a
delete). Tests: `tests/trip-events.test.mjs` (scenarios and negatives),
`tests/atomic-writes-trip-events.test.mjs`, and
`tests/trip-events-carry.test.mjs` (the trip follows the entry that survives
a wrong-card or statement duplicate removal).

Suggestions are reads (`src/domain/trip-event-suggestions.ts` holds the
rules): `GET /api/trip-events/suggestions?tripEventId=` (or the New sheet's
draft: `?start=&end=&currency=&splitGroupId=`) returns the review list's
groups (`currency`, `splits`, `dollars`) with `ticked` per entry,
`homeBillCount` and `truncated`; `GET /api/trip-events/search?tripEventId=&q=`
is "Booked before you went?"; `POST /api/trip-events/new-defaults`
(`{ entryIds }`) gives picked rows' first and last day and foreign currency;
`GET /api/trip-events?with=split-groups` adds the split groups for the New
sheet. The Entries page puts `suggestedTripEventId` on Apple Pay rows that
fit the dashed-chip rule. `POST /api/splits/expenses/from-entry` answers
`tripEventFollow` (`{ undoId, tripEvent, changes }`) when a linked trip
followed. Tests: `tests/trip-events-suggestions.test.mjs` (a near-real Seoul
week: `tests/fixtures/citibank-activity/ACCT_349_07_10_2026-seoul-sanitized.csv`
and `tests/fixtures/trip-events/seoul-trip.json`),
`tests/trip-events-chip-and-follow.test.mjs`, the scale guard, and
`tests/e2e/trip-events-suggestions.spec.js`.

The trip view is a page read: `GET /api/entries-page?view=…&month=…&trip=<id>`
lists every entry on that trip (`trip=all`: every trip's entries and the whole
list, for the Trips & events sheet's totals), bounded by the link table
(`loadEntriesForDateRange`'s `tripEventId` option; the scale guard pins it
at two steps on the 10k household). The DTO echoes the month and adds
`tripView`. The figures are `tripEventFigures` (money-figures.ts) through
`trip-event-lead-model.js`. The showcase demo seeds a Bali trip and a Japan
trip from its own travel entries (`demo-showcase-data.ts`), only when the
tables exist.

Migration: the tables are `CREATE TABLE IF NOT EXISTS`, so export the
production D1 first, then run `npm run db:migrate:remote` and
`npm run db:migrate:demo` before deploying code that uses them; running it
again is safe.

## How does Ask answer "is that more than usual?"

The `usual` answer intent (`readAnswerIntent`, rules) and turn topic
(`question.topic: "usual"` with `question.subject` as written, checked
against the person's words) become the canonical question "Is Grab more
than usual in October 2026?". `pages/ask-usual.ts` resolves the subject and
reads the view's entries of that month and the 6 before in one range read;
`ask-usual.ts` (pure) works out the usual level, the verdict and the
drivers, the answer card and the computed wording, and the facts an AI
phrasing may use (`validateAiWording` checks every sum). Tests:
`tests/ask-usual.test.mjs` (rules and the real route),
`tests/ask-answer-intent.test.mjs` and the `usual-*` entries of the eval
bank.

## How do "what changed?" and "more than usual so far" work?

`src/domain/usual-so-far.ts` is the one engine for the month in progress:
`sameDayUsual` compares spending up to today's day with the same day of
the last 6 months that have data. Summary computes
`categoriesAboveUsualSoFar` from the entries it already read (no new read)
into the DTO's `aboveUsual`, which `aboveUsualSoFarSignals` words; Ask's
usual answer for the month in progress uses `sameDayUsual` too. "What
changed?" is `src/domain/ask-changed.ts` (the `changed` intent and
`what_changed` topic), read from the same 7-month range read as the usual
answer. Answer lines may carry `figure` (entry ids and period), which the
answer card turns into an openable figure. Tests:
`tests/usual-so-far.test.mjs`, `tests/ask-changed.test.mjs`, the
`changed-*` eval entries and `tests/openable-figures.test.mjs`.

## Where do Ask's word explanations come from?

`src/domain/ask-terms.ts` holds the fixed explanations and the words that
find them (`readTermQuestion`, `findAskTerm`); the rules reader returns the
`term` intent, the turn topic is `explain_term` with `question.subject`.
`pages/ask-answer.ts` (`readTermFacts`) adds this year's figure (the bank
fees this year read for a fee kind, a description match for S&CC) and
`ask-term-answer.ts` builds the card and words; nothing is sent to AI.
Tests: `tests/ask-terms.test.mjs` and the `term-fx-fee` eval entry.

## How is Summary's card order kept?

`src/client/summary-card-order.js` reads and writes the order string
("insights,mix,subs,plan,-accounts") and is a `createPreferenceStore` like
Plan or Simple: the app shell's `summaryCards` for a login (only when
changed), POST `/api/viewer-preferences/summary-cards` (null resets), and
this device's storage without a login. `summary-panel.jsx` draws the cards
in that order; the editor is the lazy `summary-card-editor.jsx`. Tests:
`tests/summary-card-order.test.mjs`, `tests/viewer-preferences.test.mjs`
and `tests/e2e/summary-arrange.spec.js`.

### How to register a Summary card

Every card Summary draws under the top summary must be registered, or a
person cannot hide or move it. Three one-line additions, and a test that
fails if any is missing (`tests/summary-card-registry.test.mjs`):

1. Add its id (lowercase letters only, at most 20) to `SUMMARY_CARD_IDS` in
   `src/client/summary-card-order.js`, at the place it should usually sit.
   Anyone who saved an order before it existed sees it in that place,
   shown, with no migration.
2. Add its body to `cardBody` in `summary-panel.jsx` (lazy-load a heavy one
   as the others do, and keep any request inside it so a hidden card reads
   nothing). Do not draw a card anywhere else in the panel.
3. Add its `{ name, about }` to `NAMES` in `summary-card-editor.jsx`, in
   plain words a grandparent follows.

Only Money insights is never hidden (`NEVER_HIDDEN`); add another id there
only on an owner decision. Registered today: `insights`, `subs` (which holds
Coming up and Bank fees), `mix`, `plan`, `accounts`. The server only checks
the stored string's shape, so no server change is needed for a new card.

## How are bank fees this year worked out?

The Summary page reads one more thing beside its other reads (same step):
`loadBankFeesYear` (`src/domain/pages/summary-bank-fees.ts`) takes the
view's entries from 1 January to the range's last month whose description
could be a fee (`%FEE%`, `%CHARGE%`, `%INTEREST%` and the bank account
words) or that are filed under Fees, and the pure `buildBankFeesYear`
(`src/domain/bank-fees-year.ts`) keeps what `classifyBankCharge` or
`classifyAccountCharge` names, pairs refunds as `findUnreversedBankCharges`
does, and adds up the rest by kind. The DTO carries `bankFeesYear` only when
the year has a fee. The Money insights line is `feesThisYearSignal`
(`summary-signals.ts`, catalogue `feesThisYear`); tests:
`tests/bank-fees-year.test.mjs`, `tests/money-insights-fees.test.mjs` and the
`bank_fees` case in `tests/openable-figures.test.mjs`.

## How are subscriptions and bills found?

`GET /api/repeating-charges[?view=&scope=]` (DOMAIN.md "Repeating Charge")
answers Summary's "Subscriptions and bills" card: the charges that come back
every month or year in the view, each with its usual day and amount, the
last month's and last 12 months' totals and the entry ids behind every
figure. The rules are the pure `findRepeatingCharges` in
`src/domain/repeating-charges.ts` (every number in `REPEATING_RULES`); the
subscription price change reminder uses its `detectPriceChange`. The loader
`src/domain/pages/repeating-charges.ts` reads in one step: 26 months of
expenses grouped in SQL by description and month (each group carries its
charges as `id~owner~amount`), the accounts with their latest entry date,
the people and, for a person view, the split shares of the window. It uses
no AI and writes nothing. The card is the lazy `subscriptions-section.jsx`
(`subscriptions-model.js` is the pure view-model, `use-repeating-charges.js`
the read). The household's choices (keep, take off, show again, rename) are
`POST /api/repeating-charges/choice` (`src/server/repeating-charges-route.ts`)
into the additive `repeating_charge_choices` table through
`src/domain/app-repository-repeating-charges.ts`, one batch with its audit
event; the reminders read them too (a payee taken off gets no price change
reminder). Migration: export production D1 first, then
`npm run db:migrate:remote` and `npm run db:migrate:demo` before deploying.
Tests: `tests/repeating-charges-rules.test.mjs` (the rules and
their negatives), `tests/repeating-charges-api.test.mjs` (the real Worker),
`tests/openable-figures.test.mjs` (every figure equals its entries) and
`tests/e2e/subscriptions-card.spec.js`.

## How do the Investments and Tax reliefs cards work?

Two Summary cards (DOMAIN.md "Investments Over Time" and "Tax Relief"), both
read-only, no AI, no new table. `GET /api/investments-over-time[?view=]`
(`src/domain/pages/investments-over-time.ts`, pure rules in
`src/domain/investments-over-time.ts`): worth is each investment account's
latest `investment_statement_values` row, put in is this year's moves into the
accounts less moves out as the Invested figure counts them, grew by is worth
less the starting worth less what was put in after it, and paid out is
`income_minor`. `GET /api/tax-reliefs[?view=]` (`src/domain/pages/tax-reliefs.ts`,
`src/domain/tax-reliefs.ts`) counts entries whose category (or a transfer's
purpose, `transfer_purpose_category_id`) is `SRS top-up`, `CPF top-up` or
`Charity gift`; `transfer_purpose_person_id` decides self or family for CPF.
The limits are one dated list, `src/domain/sg-tax-relief-limits.ts`: **check
it against IRAS every year before 1 December** and add the new year's entry
(a missing year falls back to the latest, and the card's footnote says so).
The three categories are seeded additively in `seedEmptyStateReferenceData`
(a household's same-named category is kept); the demo household gets SRS and
CPF top-ups and a charity gift. In December, the facts also feed the
`tax_relief` Reminder (`src/domain/reminders/tax-relief-reminder.ts`). The
cards are lazy code in the Spending Mix chunk (`investments-card.jsx`,
`tax-reliefs-card.jsx`). Tests: `tests/investments-over-time.test.mjs`,
`tests/investments-card-model.test.mjs`, `tests/tax-reliefs.test.mjs`,
`tests/reminders-rules.test.mjs`, `tests/openable-figures.test.mjs` (every
amount equals its entries) and `tests/e2e/summary-investments-tax.spec.js`.

## What are reminders in Ask?

`GET /api/reminders[?view=]` (DOMAIN.md "Reminder") answers what the fixed rules
say is coming up for a view: a card bill due, a statement that should be out, a
Splits settle-up that has waited, a subscription price change and a month ready
to close. Each reminder has a stable key (kind, subject, occurrence) and carries
dates, minor amounts and names only; the words are fixed templates in
`src/client/copy/reminders-copy.js` (linted by
`tests/reminders-copy-lint.test.mjs`). The rules are pure functions in
`src/domain/reminders/` with every number in `thresholds.ts`; the loader is
`src/domain/pages/reminders.ts`. The route is read-only, runs only when Ask
opens (or a save invalidates a page while Ask is open), uses no AI and writes
nothing. The cards are the lazy `reminders-block.jsx` at the top of Ask's chat
mode (`reminders-model.js` is the pure view-model); Later and Got it live in
this browser's `localStorage` (`monies.reminders.v1`, `reminders-device-state.js`,
`reminders-actions.js`, every access in `try/catch`), never on the server.
The only first-screen code is that device state and `reminders-cue.js`, which
reads the answer Ask kept in the query cache for the Ask tab's dot. Tests:
`tests/reminders-rules.test.mjs`, `tests/reminders-api.test.mjs`,
`tests/reminders-budget.test.mjs`, `tests/reminders-client-model.test.mjs` and
the browser spec `tests/e2e/reminders-in-ask.spec.js`. Rules, false positives,
budgets and the dot's limit: `docs/audits/reminders.md`.

## What is the Ledger check-up?

`GET /api/ledger-checkup` (DOMAIN.md "Ledger Check-up") is one explicit,
read-only report of problems in the household's own data: a wrong-card Apple Pay
purchase counted twice, a shared cost entered twice (and a settle-up that
counted it twice), unlinked transfers, a missing statement, a statement that no
longer matches, an estimate nobody confirmed, a plan that spends more than comes
in, and a few tidy-ups. Each finding has evidence, a tier (`high`, `check`,
`note`), the people it touches and a link to the fix the app already has. It
runs only when asked (no schedule, no AI, no cache) and the only write is
`POST /api/ledger-checkup/dismiss` ("This is fine", with an undo) which stores
one setting and an audit event. The detectors are pure functions in
`src/domain/ledger-checkup/`; `tests/ledger-checkup-detectors.test.mjs` holds
their rules and negatives, `tests/ledger-checkup-budget.test.mjs` the read
budget. The screen is the lazy route `/check` ("Check my books",
`src/client/check-panel.jsx`; contract in `docs/flows/check-flow.md`, look in
design.md "Check My Books Page"): `check-model.js` is the pure view-model
(`tests/check-model.test.mjs`), `check-data-owner.js` the one owner of the report
(`tests/check-data-owner.test.mjs`; it must not import TanStack Query,
`query-leases.js` or `refresh-notice.js`, which would split the entry chunk), and
`tests/e2e/check-my-books.spec.js` the browser proof at desktop and 390px. The rules
and measured reads are in `docs/audits/ledger-checkup.md`.

The one bulk fix is "Link these N clear pairs" (`POST /api/ledger-checkup/clear-pairs`,
preview `GET` on the same path). `src/domain/ledger-checkup/clear-transfer-pairs.ts`
is the pure rule (mutual and unique within 7 days against every same-amount
entry; `tests/clear-transfer-pairs.test.mjs`);
`app-repository-transfer-bulk-link.ts` links at most 100 shown pairs that are
still clear in one `db.batch()` using `transfer-link-statements.ts`, the writes
it shares with `linkTransferPair`; the route then learns transfer purposes in
date order (`applyRememberedTransferPurposes(..., { chronological: true })`).
Proof: `tests/transfer-bulk-link.test.mjs` (commands, refusals, `failingStatement`
at every write), `tests/transfer-bulk-link-equivalence.test.mjs` (bulk equals
one by one, table by table), `tests/transfer-bulk-link-scale.test.mjs` (the 10k
household's budget), `tests/check-clear-pairs-client.test.mjs` and
`tests/e2e/check-link-clear-pairs.spec.js`.

A settled-period finding's fix is a Split Correction (DOMAIN.md "Split
Correction", `docs/proposals/settled-correction.md`): a `split_settlements` row
with `correction_source_id` and `correction_reason`, added by
`POST /api/splits/corrections` (the amount is worked out on the server from the
same facts the detector reads) and removed by `POST /api/splits/corrections/undo`.
Migration: two `ALTER TABLE split_settlements ADD COLUMN` statements
(`SPLIT_CORRECTION_COLUMN_STATEMENTS`), applied to production and demo before
the code is deployed; `ensureDemoSchema` also repairs an older database.
Tests: `tests/settled-correction.test.mjs`, `tests/e2e/splits-settled-correction.spec.js`.

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
flexible. The top portion behaves like bills and dated payments, and the highlighted lower
section behaves like monthly budgets. That is a reasonable structure to carry
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

## Ask turn (AI first)

Every Ask message goes to `POST /api/ask/turn` (`src/server/ask-turn-route.ts`,
`src/domain/ask-turn.ts`): the model picks one action, the server checks it
against the household, and the page shows the existing draft or answer
card. With AI off (local and the e2e stack) the route answers
`mode: "rules"` and Ask reads the message with its rule readers.

- Browser tests stand in for the model with the `X-Ask-Turn-Test-Reply`
  header (read only when `APP_ENVIRONMENT` is `test`); see
  `tests/e2e/ask-ai-turn.spec.js`.
- `X-Ask-Turn-Test-Repair-Reply` stands in for the repair turn's answer
  (test environment only); without it a test-reply turn is not repaired.
- `npm run eval:ask` runs the eval bank
  (`tests/fixtures/ask-eval-utterances.json`, 121 messages across every Ask
  action) through the real model on a seeded local D1 when `AI_GATEWAY_TOKEN`
  or `ANTHROPIC_API_KEY` (and the gateway ids) are in the environment, printing
  PASS or FAIL per message, the pass rate and the repair rate; without them it
  prints only the prompt size. A spread sample of 30 by default (about
  US$0.05); `--all --yes` runs the whole bank; `--ids`, `--group`, `--limit`
  and `--dry` narrow it. Manual, not in CI. The same bank runs in CI without a
  model as `tests/ask-eval-bank.test.mjs`, replaying each recorded model answer
  through the Worker. A new Ask action adds its messages to the bank.
- A refused model answer gets one repair turn (a second allowance unit) with
  the checks' errors and valid options before the person is asked; each repair
  is logged as `{"event":"ask_turn_repair","action","validatorError","field",
  "repaired"}` (no message text). Count them in the Worker logs to measure the
  repair rate.
- Trips and events (`src/domain/ask-trip-events.ts`): `set_trip_event` is a
  change card saved through `/api/trip-events/entries/set` with
  `addedBy: "ask"` (over ten entries the route needs the confirmed count)
  and undone with the save's `undoId`; a trip question's reply is
  `trip_answer`, which the page answers from the Entries trip view's own
  page read (`src/client/ask-trip-answer.js`). With AI off the turn route's
  trips rule reader (`readTripEventRules`) drafts the same reply. Tests:
  `tests/ask-trip-events.test.mjs`; the eval bank has its messages.


### Phone island context

Entries publishes `buildEntriesIslandContext` with its existing filter props;
the URL and filtered rows remain authoritative. App renders the context through
the lazy mobile context sheet chunk. The same-row summary replaces only default
scope text; a non-default scope uses a stacked row and the `islandStacked` page
flag lifts nearby floating buttons. Clear calls the Entries reset with its explicit period-reset flag, removing
`entry_from` and `entry_to` while preserving view, month and scope. Existing
desktop Reset callers retain the period as before. Month's
return action uses the existing month-choice navigation within the loaded range.
Splits passes its search and clear callback to its existing group strip.
`tests/e2e/island-context.spec.js` proves 390px height, scroll continuity, scope
visibility, complete reset, touch targets, reduced motion and desktop exclusion.
