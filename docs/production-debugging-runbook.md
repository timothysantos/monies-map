# Production Debugging Runbook

Date: 2026-07-05

This runbook is for the production Cloudflare Worker:

- Worker: `monies-map`
- URL: `https://monies-map.timsantos-accts.workers.dev`
- D1 database: `monies-map`
- Worker config: [`wrangler.jsonc`](../wrangler.jsonc)

Cloudflare Workers do not have a server process to restart. Most production
fixes are one of:

- fix Cloudflare Access policy or the browser Access session,
- redeploy the current code,
- roll back to a prior Worker version,
- run the missing D1 migration,
- clear browser/site data when the app shell is stale.

## Fast Triage

Run these from the repo:

```bash
PATH="/Users/tim/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:$PATH" ./node_modules/.bin/wrangler whoami
curl -i --max-time 20 https://monies-map.timsantos-accts.workers.dev/
curl -i --max-time 20 https://monies-map.timsantos-accts.workers.dev/api/health
PATH="/Users/tim/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:$PATH" ./node_modules/.bin/wrangler deployments list --name monies-map
PATH="/Users/tim/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:$PATH" ./node_modules/.bin/wrangler tail monies-map
```

Interpret the first HTTP result:

- `302` to `monies-map.cloudflareaccess.com`: Cloudflare Access is handling the
  request before the Worker. Check Access first.
- `200` with app HTML from `/`: static assets are being served.
- `200` JSON from `/api/health`: Worker code is executing.
- `500`, `503`, or HTML error from `/api/*`: check Worker logs and D1.
- `404` for nested routes such as `/entries`: asset SPA routing or deployed
  assets are wrong.

## Current Check On 2026-07-05

Unauthenticated checks returned `302` redirects from both `/` and
`/api/health` to Cloudflare Access. `wrangler tail monies-map` did not receive
an event for the unauthenticated health request. That means the failing request
was stopped before Worker execution; redeploying or "restarting" the Worker
will not fix that specific symptom.

Remote D1 was reachable and the core production tables existed:

```bash
./node_modules/.bin/wrangler d1 execute monies-map --remote \
  --command="SELECT name FROM sqlite_master WHERE type='table' ORDER BY name LIMIT 20;"
./node_modules/.bin/wrangler d1 execute monies-map --remote \
  --command="PRAGMA table_info(app_settings);"
./node_modules/.bin/wrangler d1 execute monies-map --remote \
  --command="PRAGMA table_info(category_match_rules);"
./node_modules/.bin/wrangler d1 execute monies-map --remote \
  --command="PRAGMA table_info(category_match_rule_suggestions);"
```

## Cloudflare Dashboard Flow

### 1. Check Worker Deployment

1. Open Cloudflare Dashboard.
2. Go to **Workers & Pages**.
3. Open **monies-map**.
4. Go to **Deployments**.
5. Confirm the latest deployment is active.
6. Current expected version after the category matching deploy:
   `73325cfe-e4e0-4424-aeea-83a590446ee1`.

If the latest deployment is bad:

1. In **Workers & Pages -> monies-map -> Deployments**, find the last known
   good version.
2. Select the three-dot menu for that version.
3. Select **Rollback**.
4. Retest `/` and `/api/health`.

CLI equivalent:

```bash
./node_modules/.bin/wrangler deployments list --name monies-map
./node_modules/.bin/wrangler rollback --name monies-map
```

Use rollback when the Worker was working before a deploy and now reaches the
Worker but errors. Rollback does not roll back D1 data or schema.

### 2. Check Worker Logs

1. Open Cloudflare Dashboard.
2. Go to **Workers & Pages**.
3. Open **monies-map**.
4. Open **Logs** or **Observability / Logs**.
5. Trigger the failing browser action in another tab.
6. Filter by recent timestamp, status `>= 500`, or request path such as
   `/api/app-shell`, `/api/settings-page`, `/api/reference-data`, or
   `/api/health`.

CLI equivalent:

```bash
./node_modules/.bin/wrangler tail monies-map
```

Interpretation:

- No log event appears for the request: the request did not reach the Worker.
  Check Cloudflare Access, DNS/routes, or WAF.
- Log event appears with an exception: fix code or roll back.
- Log event shows D1 SQL error: check migrations and schema.
- Log event shows CPU/resource limit: split the endpoint, reduce startup work,
  or roll back to the last version that kept requests under the limit.

### 3. Check Cloudflare Access

Production is intentionally protected by Cloudflare Access. Access runs before
the Worker.

1. Open Cloudflare Dashboard.
2. Go to **Zero Trust**.
3. Go to **Access -> Applications**.
4. Open the application protecting
   `monies-map.timsantos-accts.workers.dev`.
5. Check **Policies**:
   - allowed household emails are present,
   - the policy action is **Allow**,
   - identity provider is enabled,
   - no higher-priority Block policy catches your email.
6. Check **Login methods / Identity providers**:
   - one-time PIN email or Google is enabled,
   - your email domain/address is accepted.

Browser-side checks:

1. Open a private/incognito window.
2. Visit `https://monies-map.timsantos-accts.workers.dev`.
3. If you see Cloudflare Access login, sign in with the allowed email.
4. If login succeeds but redirects back to Access again, clear Access cookies:
   - browser site data for `workers.dev` and `cloudflareaccess.com`, or
   - visit the Access logout URL if shown by the production reset script.
5. Retest after signing in.

Scenario fixes:

- Access login page appears and the Worker tail is empty:
  fix Access policy or session. Do not redeploy.
- Login page has no usable identity provider:
  enable one-time PIN or Google in Zero Trust identity providers, then attach it
  to the Access application.
- Your email is denied:
  add the email to the Allow policy, or remove/adjust a higher-priority Block
  policy.
- Apple Shortcuts or external API calls get `302` to Access:
  either add a Cloudflare Access service token and send its headers from the
  shortcut, or create a narrow Access bypass policy only for
  `/api/shortcuts/*`. The app's shortcut API key must still be required by the
  Worker. Do not bypass all `/api/*`.

### 4. Check Routes And Assets

1. Go to **Workers & Pages -> monies-map**.
2. Open **Settings -> Domains & Routes**.
3. Confirm the `workers.dev` route is enabled for the Worker.
4. Open **Settings** and confirm assets are served from `dist`.

CLI checks:

```bash
curl -I https://monies-map.timsantos-accts.workers.dev/
curl -I https://monies-map.timsantos-accts.workers.dev/assets/index-CYS36xfR.js
curl -I https://monies-map.timsantos-accts.workers.dev/entries
```

Scenario fixes:

- `/` works but `/entries` returns 404:
  confirm `wrangler.jsonc` has
  `"not_found_handling": "single-page-application"`, rebuild, and redeploy.
- Asset file returns 404:
  run `./node_modules/.bin/vite build`, then
  `./node_modules/.bin/wrangler deploy`.
- Browser shows a blank old app after deploy:
  hard refresh, clear site data, and check the console for failed asset URLs.

### 5. Check D1 And Migrations

1. Open Cloudflare Dashboard.
2. Go to **Storage & Databases -> D1**.
3. Open **monies-map**.
4. Use **Console** to run read-only checks.

CLI checks:

```bash
./node_modules/.bin/wrangler d1 execute monies-map --remote \
  --command="SELECT name FROM sqlite_master WHERE type='table' ORDER BY name;"
./node_modules/.bin/wrangler d1 execute monies-map --remote \
  --command="PRAGMA table_info(app_settings);"
```

If a table or column is missing:

```bash
./node_modules/.bin/wrangler d1 execute monies-map --remote --file=schema.sql
```

Then reload production and watch Worker logs.

Do not run destructive D1 commands in production unless you are intentionally
resetting data and have confirmed the target database is `monies-map`.

### 6. Check Browser Console And Network

1. Open production in Chrome.
2. Open DevTools.
3. Go to **Console** and reload.
4. Go to **Network**, enable **Preserve log**, then reload.
5. Check:
   - document request `/`,
   - JS and CSS assets under `/assets/` and `/styles.css`,
   - API requests such as `/api/app-shell`, `/api/reference-data`, and
     `/api/settings-page`.

Interpretation:

- API response is Cloudflare Access HTML: Access session or policy issue.
- API response is Cloudflare 503 HTML: Worker resource/runtime issue.
- API response is JSON error: app/server error; check Worker logs and
  `app_error_diagnostics` in settings.
- Assets are 404: bad asset deployment; rebuild and redeploy.

## Recovery Choices

### Redeploy Current Code

Use when build assets may be stale or deploy upload was interrupted:

```bash
./node_modules/.bin/vite build
./node_modules/.bin/wrangler deploy
```

### Roll Back Worker Code

Use when a new deploy reaches the Worker but app/API behavior regressed:

```bash
./node_modules/.bin/wrangler deployments list --name monies-map
./node_modules/.bin/wrangler rollback --name monies-map
```

Dashboard path: **Workers & Pages -> monies-map -> Deployments -> three-dot
menu -> Rollback**.

### Fix Access Instead Of Redeploying

Use when `curl` shows `302` to `cloudflareaccess.com` and `wrangler tail` shows
no request. Update **Zero Trust -> Access -> Applications -> monies-map** policy
or identity provider settings. Retest in a private browser window.

### Apply Missing D1 Schema

Use when Worker logs show `no such table` or `no such column`:

```bash
./node_modules/.bin/wrangler d1 execute monies-map --remote --file=schema.sql
```

### Clear Browser State

Use when other browsers work or logs show healthy API responses:

1. Hard refresh.
2. Clear site data for `monies-map.timsantos-accts.workers.dev`.
3. Clear Access cookies for `monies-map.cloudflareaccess.com`.
4. Sign in again.

## Useful References

- Cloudflare Workers real-time logs:
  <https://developers.cloudflare.com/workers/observability/logs/real-time-logs/>
- Cloudflare Workers deployments and rollbacks:
  <https://developers.cloudflare.com/workers/versions-and-deployments/rollbacks/>
- Cloudflare Access policies:
  <https://developers.cloudflare.com/cloudflare-one/access-controls/policies/>
