# AI security review (October 2026)

Branch `ai-security-review`, reviewed against `origin/master` at `cce1c6dc`
(release r9) and, for work not yet on master, the branch heads of PR #53
(`ask-planning` at `061ba778`: plan draft and apply-changes) and PR #18
(`ask-ai-filter-and-signals` at `51e1aa46`: the AI filter reading). Splits by
chat had no branch yet and is not reviewed (checklist at the end).

Scope: `/api/ai-assist/*` (entry-draft, receipt-read, transcribe, answer,
provider-status and topped-up, and the older text routes that share the
provider layer), `/api/skew-candidates`, `/api/splits/suggestion`,
`/api/settings/payment-ways/save`, entry create with an `ask:` external
reference, the Ask client storage, the AI Gateway configuration, prompt
injection, request limits, authentication and authorisation, CSRF, rate and
cost limits, error messages, SQL and logging.

Method: read every route and the code behind it, ran negative probes through
the real Worker on a local D1 (malformed bodies, odd view and month
parameters, wrong methods, shortcut references), read the existing tests,
and made three unauthenticated GET requests to the live Workers (health and
provider-status; no write was sent to production).

## Findings

| # | Severity | Finding | Status |
|---|---|---|---|
| F1 | Medium | No cross-site (CSRF) protection on any write route | Fixed |
| F2 | Medium | Phone, account and ID numbers in ledger descriptions reached the Ask AI prompt | Fixed |
| F3 | Medium | AI wording check accepted a made-up dollar amount that shared digits with a day or a percentage, and amounts written in words | Fixed |
| F4 | Medium | Request bodies were only bounded when the client declared a length; chunked uploads were read whole | Fixed |
| F5 | Low | `/api/entries/create` stored any date, fractional or huge amount and unbounded text | Fixed |
| F6 | Medium | The Worker trusts the Access identity header and has no Access token check of its own; `AI_ALERT_EMAILS="*"` then means anyone who reaches the Worker | Fixed: token check enforced in production since 2026-10-13 (ran in report mode first; owner requests verified) |
| F7 | Low | The remaining write routes in `src/index.ts` (about 70 `request.json()` calls) read unbounded bodies | Open |
| F8 | Low | Error messages return internal text (`message` on 500s, `error.message` on 400s) | Open |
| F9 | Low | AI wording is checked for numbers, sums, names and banned phrases but not for other lower-case text | Open (accepted) |
| F10 | Low | `<question>` and `<sentence>` delimiters in prompts are not escaped | Open (accepted) |
| F11 | Info | The daily allowance's first insert of the day ignores the limit when one request costs more than the limit | Open |
| F12 | Info | A top-up mark has no actor or audit record; with `"*"` any household member can reset the credit estimate | Open (by design) |
| F13 | Info | Receipt EXIF stripping is done by the browser only | Open (by design) |
| F14 | Info | `AI_GATEWAY_URL` accepts any https host and the keys are sent to it | Open |
| F15 | Info | `/api/db-check` lists table names; demo controls fail closed only because `APP_ENVIRONMENT` is unset | Open |
| F16 | Info | The Shortcut ingest token is delivered to the browser in the Settings DTO | Open (by design) |
| F17 | Info | The shortcuts Worker has preview URLs enabled (they serve only the shortcut endpoint) | Open |
| F18 | Info | No per-person authorisation: the view and scope are a lens, not a permission | Open (by design) |
| F19 | Pending | PR #53 and PR #18 routes use bare `request.json()`; the new guard test will fail on merge until they use `readJsonObject` | For those PRs |

### F1 Cross-site writes (Medium, fixed)

Evidence: the Worker authorises with the Access cookie only. Every write
route reads its body with `request.json()` whatever the content type, so a
plain HTML form or a `text/plain` fetch from another site, sent with the
signed-in browser's cookie, reaches `entries/delete`, `topped-up`,
`months/delete` and the rest. No CORS headers are sent, so the response is
unreadable, but the write still happens. Whether it works depends on the
Access cookie's SameSite setting, which is not under the repository's
control. A signed-in person has to visit a hostile page, so the likelihood
is low and the impact is every write route.

Fix: `src/server/cross-site-guard.ts`, called first in `fetch`. A
non-GET request with `Sec-Fetch-Site` other than `same-origin` or `none` is
a 403 before any schema or data work. curl, the Apple Shortcut, tests and
request replayers send no such label and are unaffected. `Origin` is not
compared: an end-to-end run showed its host is not the Worker's behind the
dev proxy (Playwright's `route.fetch` replay was refused by a first
version that did), and every browser that sends `Origin` on a write also
sends `Sec-Fetch-Site`. Browsers older than 2023 send neither and are not
covered. Tests (written first, failing on the old
code): `tests/ai-security-review-routes.test.mjs` F1.

### F2 Digits from descriptions in the Ask AI prompt (Medium, fixed)

Evidence: `buildPromptFacts` used `entryName`, which, for a PayNow or a bare
"FAST PAYMENT" description (no tidy shop name), falls back to the raw
description cut to 40 characters. `PAYNOW TRANSFER 91234567 JOHN TAN`,
`FAST PAYMENT to 0123456789012 S1234567A` reached the prompt as typed.
AGENTS.md: no full account or card numbers to AI.

Fix: `promptEntryName` removes any digit run of six or more (also when
separated by spaces or dashes) and any NRIC or FIN shape before the name is
tidied; the on-screen card and computed wording are unchanged. Tests F2 in
`tests/ai-security-review-wording.test.mjs` fail on the old code.

### F3 Wording check (Medium, fixed)

Evidence: `validateAiWording` compared bare numbers against every number in
the facts, so "$11.00" passed when the facts held "11 Mar", and "$54" when
they held "54% of spending". An amount in words ("about ten thousand
dollars") has no digits and passed. The prompt tells the model to copy
amounts; the check is the guard when an injected description or a
misbehaving model does not.

Fix: any `$` or `Rp` amount, or a number followed by dollars, cents or
bucks, must equal an amount that appears with `$` or `Rp` in the facts; tens,
teens, hundred, thousand, million, grand, dozen and "five percent" style
words are refused (small counting words stay). Tests F3 fail on the old
code; the existing wording tests pass unchanged.

### F4 Unbounded bodies (Medium, fixed for every AI route)

Evidence: receipt-read and transcribe checked `Content-Length` only when the
header was present. A chunked upload has none, so `formData()` buffered the
whole body (the platform allows far more than the 1.5 MiB and 1 MiB caps).
The JSON AI routes had no cap at all. Reachable only by a signed-in person,
so the impact is a memory or CPU crash of one isolate and wasted work.

Fix: `src/server/limited-body.ts` counts bytes as they arrive and stops at
the limit (413, before any allowance use or AI call): receipt-read and
transcribe at their file limits, the small JSON routes (answer, entry-draft,
topped-up, monthly-narrative, transfer ranking) at 64 KiB, statement text
fallback 64 KiB, import ranking 256 KiB, import explanation 4 MiB.
`handleAiAssistRoute` turns any oversized read into a 413. A source test
fails on a bare `request.json()` or `request.formData()` in `src/server`.
Tests F4 fail on the old code.

### F5 Entry create validation (Low, fixed)

Evidence: `/api/entries/create` checked that fields existed and that the
amount was positive. `date: "garbage"`, `amountMinor: 12.5` or `1e15`, a
500 kB description or an object as a note were accepted. This is the route
every Ask draft (including one built from an AI reading) is saved through,
so it is the last gate. Fix: `src/domain/entry-create-validation.ts`
(real ISO dates, safe integer amount up to 10^12, description 500 and note
2,000 characters, the Shortcut's limits). Test F5 fails on the old code and
also proves a real entry with an `ask:` reference still saves.

### F6 Access is trusted, not verified (Medium, fixed)

Evidence: `getAuthenticatedEmail` reads `CF-Access-Authenticated-User-Email`
and nothing checks the `Cf-Access-Jwt-Assertion` token. Live check, three
unauthenticated GETs: `monies-map.timsantos-accts.workers.dev` answers 302
to `monies-map.cloudflareaccess.com` for `/api/health` and
`/api/ai-assist/provider-status`; the shortcuts Worker answers 404 for both;
the demo Worker (public by design, `AI_ASSIST_ENABLED` unset) answers
`{ ok: true, visible: false }`. `wrangler.jsonc` sets `preview_urls: false`
for the main Worker. So today the main Worker is behind Access. The risk is a
future change (a custom domain, a route, a preview URL, a policy edit)
that exposes the Worker without Access: every write route, the spoofable
identity header and `AI_ALERT_EMAILS="*"` (everyone, signed in or not) would
then be open together.

Recommendation (needs the owner's Access application AUD tag and team
domain): verify the Access JWT in the Worker (RS256 against the team's
JWKS), take the email from it, and answer 401 without it in production. Not
done here because it needs configuration only the owner has and a wrong
setting would lock the app out.

Fix (2026-10-13, `src/server/access-jwt.ts`, called first in `fetch` after
the shortcut gateway checks): the Worker verifies `Cf-Access-Jwt-Assertion`
(or the `CF_Authorization` cookie) with WebCrypto RS256 against
`https://<team>/cdn-cgi/access/certs` (keys cached per isolate for 10
minutes; a token with an unknown key id refetches once, at most once a
minute; a failed refresh keeps the last keys), and checks `aud` contains
`ACCESS_AUD`, `iss` is `https://<team>`, and `exp`/`nbf` within 60 seconds of
clock difference. A verified token's email is the viewer
(`getAuthenticatedEmail`); the plain identity header is ignored. Mode
`ACCESS_JWT_MODE`: unset/`off` (test, the shortcuts Worker, local
`npm run dev:api`), `report` (log one line per request, `access-jwt
mode=report result=ok|fail reason=...`, with running counts, and serve as
before; a failed token falls back to the header so nothing changes for the
household), `enforce` (401 JSON for `/api/`, a plain 403 page otherwise).
Production and the demo (its own Access application and AUD tag) ship `enforce` with the team domain and AUD tag in
`wrangler.jsonc` (it ran in `report` first and every real owner request
verified in `wrangler tail`). The demo moved from `report` to `enforce` on 2026-10-14 after the owner's
signed-in visit passed every request (result=ok, header=match, fails=0). To
roll back, set `ACCESS_JWT_MODE` to `report` and redeploy.

Exemptions: `POST /api/shortcuts/entries/create` keeps its own signed-token
check (`authenticateShortcutRequest`) and is not asked for an Access token.
The `monies-map-shortcuts` Worker runs the same code with no Access vars, so
its mode is off. Static files and page navigations are answered by the
assets layer without running the Worker (no `run_worker_first`, and
navigations prefer assets since the 2025-04-01 compatibility date), so they
stay protected by Access at the edge only, and hold no data. Tests:
`tests/access-jwt.test.mjs`, `tests/deploy-config.test.mjs`.

### F7 to F18 Notes

- F7: the other writes cannot import a body-limit helper wholesale (an
  import commit is legitimately large). A per-route limit table in one
  wrapper would close it; unauthenticated callers are already stopped by
  Access, and the platform has its own ceiling.
- F8: `apiPageResponse` returns `message: describeError(error)` on a 500, and
  several routes return `error.message` on a 400 (for example a D1 constraint
  text). Useful for the diagnostics UI and the owner is the only reader
  today; a production build could return the request id only.
- F9, F10: a model can still write lower-case words that are not in the facts
  (the check covers numbers, sums, capitalised words, known names, advice
  and forecast wording, links and markup); an injected ledger description can
  be echoed if its words are in the facts. The answer card is built by the
  app and stays authoritative; AI wording is a sentence under it. Delimiters
  are plain tags; output validation, not escaping, is the control.
- F11: `INSERT ... ON CONFLICT ... WHERE used + units <= limit` limits every
  call after the first of the day. A first call of 8 units (statement
  fallback) with `AI_ASSIST_DAILY_LIMIT` at its minimum of 4 would still pass.
  Production sets 100.
- F12: marking a top-up is one upsert with a time and an amount; it does not
  touch the monthly pace (so auto-balance is unaffected), and the gateway's
  own $10 cap is separate. Under `"*"` anyone in the household can hide the
  low-credit notice.
- F13: the browser redraws the photo on a canvas (no EXIF). The server checks
  type, size and magic bytes but forwards the bytes; a non-browser client
  could send metadata to the provider. Reachable only by a signed-in person.
- F14: `resolveClaudeGateway` requires https but not the Cloudflare gateway
  host. It is a `vars` entry only the owner edits.
- F15: `/api/db-check` returns `sqlite_master` table names to any Access
  user. `canUseDemoControls` falls back to "production" unless the hostname is
  localhost, so it fails closed; setting `APP_ENVIRONMENT=production` in
  `wrangler.jsonc` would make that explicit.
- F16, F18: by design for a two-person household with one Access policy.

## Ask turn audit note (2026-10-13, branch `ask-ai-first`)

Ask moved to "AI understands, the app validates, rules are the offline
backup": every message goes to `POST /api/ask/turn` first.

Privacy. The prompt (`buildAskTurnPrompt`) carries the message, at most 8
recent conversation lines (each at most 200 characters), and names: people,
active wallets (owner, kind, currency), categories, split groups (and
currency) and the month's plan line names, each through `scrubName` (any
run of 4 or more digits and NRIC/FIN shapes removed), the focus entry's
description through `promptEntryName`. No balance, no amount from the
household's records (the card in focus says only whether it has an amount),
no account, card, phone or ID number. The person's own text is sent as
written except digit runs of 8 or more, even in groups ("4417 1234 …"),
which become `[number]`. The focus entry is sent by id from the page and
loaded from the household's own rows; an unknown id is no focus and never
reaches the prompt. Nothing is stored or logged: no message, prompt,
context or answer; Claude goes through AI Gateway with logging and caching
off. Tests: `tests/ask-turn.test.mjs` ("the prompt names … but no account,
phone or ID number and no amount"), `tests/ask-turn-route.test.mjs`.

Write boundaries. The route writes only the allowance counter (and the
Claude status row). The model's one action is checked by
`validateAskTurnAction`: people, wallets (active), categories, groups and
the focus entry must be the household's; amounts must be written by the
person; dates not in the future nor older than 400 days; shares add up to
100% and stay within the entry's amount; the group's currency matches; a
plan change passes `parsePlanAiReading` and is drafted against the real
rows; model prose with a number nobody said is replaced. Saves are only the
person's taps through existing all-or-nothing commands
(`/api/entries/create`, `/api/splits/expenses/from-entry` now taking
`splitBasisPoints`/`splitAmountMinor`, proved by a `failingStatement` test,
`/api/splits/settlements/create`, `/api/month-plan/apply-changes`). The body
goes through `readJsonObject` (64 KiB, 413), the CSRF guard applies, the
text is capped at 300 characters. The `X-Ask-Turn-Test-Reply` header is read
only when `APP_ENVIRONMENT` is exactly `test` (set only in
`wrangler.test.jsonc`); even then it only stands in for the model's choice
and goes through the same checks.

Cost. One allowance unit per turn (production allows 100 a day). Measured
on the demo household the prompt is about 2,650 characters (about 660
tokens); a real household with more wallets and categories should stay
near 1,200 to 1,500 input tokens, under the 2k target. With Claude Haiku
5.5 at US$0.10 per million input and US$0.50 per million output tokens, and
about 150 output tokens plus low-effort thinking (up to about 300), a turn
costs about US$0.0004, so the 100-turn daily allowance caps Ask turns at
about US$0.04 a day (about US$1.20 a month), well inside the US$10 gateway
cap. A message the rules answer with AI off costs nothing.

## Ask turn Phase 2 audit note (2026-10-13, branch `ask-ai-first-p2`)

Phase 2 lets a turn change data the household already has
(`src/domain/ask-turn-actions.ts`): edit a saved entry, recategorise one
entry or many, an entry's or a month's note, link a transfer, split groups
(create, move a split, settle a whole group, Simplify), review matches,
payment ways, categories (create, rename, colour) and plan links.

Write boundaries. The model still only chooses; every change is a change
card the server builds from the household's own rows and the person's own
words, and nothing is written until the person taps its button. The card's
steps may only post to `ASK_CHANGE_PATHS`, the existing commands (the page
checks its own copy and never posts anything else; a mismatch drops the
card). Validator rules: the entry, list or group in focus is loaded from
the household by id (a foreign id is no focus, so nothing is drafted); a
statement-certified entry's amount, date, description and wallet are
refused before the card (the same checkpoint lookup the entry update
uses); names, notes and words are the person's own (`groundedWords`,
`groundedNote`); a new category colour is one of the palette's own. Bulk
recategorise re-reads the matching entries on the server with the
category rule matcher, lists the count and first eight, refuses more than
200, and over 10 needs the person's "Yes, change all N" tap: the command
(`updateEntryCategoriesRecord`) refuses the change unless `confirmedCount`
equals the row count, and the server never puts that count in the save
body. Commands touched: the bulk category change (one guarded batch),
Simplify (`createSplitSettlementCheckpoint`, now one batch with an audit
event) and new categories (`createCategoryRecord`, one batch), each proved
by `failingStatement` tests in `tests/atomic-writes-ask-phase2.test.mjs`.
Never from Ask: deleting entries, months or imports, importing or undoing
an import, reconciling, accounts and people. The model can only name these
as `cannot_help.blocked`, and the reply opens their page with the app's own
reason; no action in the schema deletes anything.

Privacy. Unchanged: the focus adds only whether a saved entry's bank facts
are locked, and a list in focus sends its month, search words and
category names, never its rows or amounts. Rows a change needs are read
after the model answers and never reach the prompt.

Cost. Still one allowance unit per turn. The Phase 2 action lines add about
1,700 characters: the demo household's prompt is now about 4,400
characters (about 1,100 tokens), so a real household should stay near
1,600 to 1,900 input tokens, under the 2k target, at about US$0.0005 a
turn.

## Ask hands-off audit note (2026-10-14, branch `ask-handsoff`)

Owner decision "Fully hands-off for safe things": multi-step lookups, habits,
a suggestion row, and automatic application of a listed safe set with Undo.

Privacy: what is stored. `ask_habits` holds, per household, a kind, a key
(a shop's normalised name with digit runs of 4 or more dropped, or a one-word
nickname), a value (a category name; a group id, payer id and share; a person
id), two counters, a date and a source word. No message, prompt, answer,
amount, account or card number, description or file. The "Done for you" log is
audit events (`ask_auto`): the entry's description and the change, as the
audit log already holds. Forget everything deletes the habits. What goes to
the model: lookup results (entry id, date, `promptEntryName` description,
type, category, owner, on splits or not; a note cut to 80 characters with
long digit runs removed; who owes whom without any figure; category counts),
and nicknames. Results are fenced as untrusted data, and the model may only
name as target an entry id that a lookup in the same turn returned (a made-up
or foreign id is no target; `tests/ask-lookup-route.test.mjs`).

Cost. A plain turn is still one allowance unit. A lookup adds a model call
(about 1 to 2k tokens each, prompts stay under the existing caps): at most 4
calls and 6,000 estimated tokens a turn, so at most 4 units; a repair counts.
Suggestions, habit learning and auto-apply make no AI call and use no
allowance.

Write boundaries. The model never writes. The app applies, on its own rules
(`autoApplyRefusal`), only: a new entry's category (Apple Pay entries only),
a note the person asked for, an Add to Splits with the habitual split; only
when the switch is on, the entry is under an hour old, not imported or
certified, and (category, split) the habit is high. Each uses the existing
command, is logged, and a log failure reverses it
(`tests/atomic-writes-ask-habits.test.mjs`). The excluded cases (setting off,
imported, certified, old, bulk, low confidence, hand-made category, other
payer, already on Splits) are each a test (`tests/ask-habits.test.mjs`,
`tests/ask-habits-route.test.mjs`). Undo uses the existing commands, refuses
an entry changed since, and counts as an override. Habit edits, deletes,
Forget everything and the switch are all-or-nothing with an audit event.

Failure. AI off: no lookup runs and the turn answers rules; habits,
suggestions and Done for you do not need AI at all. A missing `ask_habits`
table switches the feature off without an error (tested).

## Ask trips and events audit note (2026-11-10, branch `trip-events-ask`)

`set_trip_event` and the trip money question (`src/domain/ask-trip-events.ts`;
docs/flows/ask-flow.md "Trips and events").

What reaches the model. One new context line, "Trips and events: …": the
household's trip and event names (not put away, at most 20) through
`scrubName`, so no run of 4 or more digits. No dates, counts, totals or
entry ids. The schema gains `trip_event` (name, off, make, words, currency,
when, from, to: all words as said) and `question.trip` (a name as said).
Entries a change needs are read after the model answers and never reach a
prompt; the trip's Spent is computed in the page from the Entries trip
view's own read, never sent to or taken from the model.

Write boundaries. The model only chooses; the card is built from the
household's rows (the entry or list in focus loaded by id from the
household, a search bound to the household and to a date window, at most
1,000 rows read), with the person's own words only. It saves through
`ASK_CHANGE_PATHS`: `/api/trip-events/entries/set` (`addedBy: "ask"`,
Undo `/api/trip-events/undo` with the save's `undoId`), or for a new trip
with no entries `/api/trip-events/save` (Undo `/api/trip-events/delete`
with the made trip's id). `addedBy` is a provenance label only: a page could
already send "suggestion", "ask" is the same kind of label for the
person's own Save, and `ask_auto` is still never taken from a request. Over
ten entries an Ask save must carry `confirmedCount` equal to the row count
(the route refuses otherwise); more than 200 is refused before the card
and by the command. The safe set Ask applies by itself is unchanged:
nothing joins a trip by itself. The command (`setTripEventEntries`) is
unchanged and already all-or-nothing (`tests/atomic-writes-trip-events.test.mjs`).

Cost. No new model call: a plain turn is one unit. The action line and the
trips line add about 300 to 600 characters to the prompt (the lookup token
cap still holds; `tests/ask-lookup-route.test.mjs`). With AI off a message
that may be a trip one ("put", "add", "how much" …) reads the trip list
once, and only when one could match loads the turn's context; anything else
answers rules at once as before.

Failure. AI off, failing or over the allowance: the server's trips rule
reader drafts the same card and the same trip answer (`mode: "rules"`,
`tests/ask-trip-events.test.mjs`). Missing trip tables: no trips line, and
a trip message gets a plain note.

## Controls checked and found sound

| Area | Evidence |
|---|---|
| Gateway headers | `cf-aig-collect-log: "false"`, `cf-aig-skip-cache: "true"` and the BYOK alias are on every Claude request (`tests/ai-provider.test.mjs`). The error body is read only to categorise it and never kept; only the status code is logged. |
| Secrets | `AI_GATEWAY_TOKEN` and `ANTHROPIC_API_KEY` appear only in `src/index.ts` (types) and `src/domain/ai-provider.ts`; nothing in `src/client` or `public`. The entry-draft context loads the Shortcut key but does not pass it on. |
| Prompt injection | Every prompt marks input as untrusted data, and no model output reaches a write: entry draft (amount must be stated in the sentence, description words must all be in the sentence), receipt read (app validates date, total, currency allowlist, card last four, text length), Ask wording (facts-only check), monthly and import templates (placeholders only), category rules (indexes verified against evidence), plan draft (names, amounts and months must be in the request). Saving is always the person's own action through the normal routes. |
| Input types | Receipt: JPEG, PNG or WebP by declared type and magic bytes, 1.5 MiB. Voice: four containers (WebM, Ogg, MP4, WAV) by magic bytes, 1 MiB, 31 s, MP4 duration read from the file. |
| Allowance and cost | One daily counter for every AI call (limit clamped 4 to 100, atomic upsert, charged before inference, refused requests spend nothing). Production: 100 units; gateway monthly cap $10; auto-balance by monthly pace. Worst case per day is pennies. |
| SQL | Every query in the reviewed files binds its values; interpolated SQL is constants or placeholder lists. Odd `view`, `month`, `scope` and `entryId` values fall back or return 404 (probed). |
| Skew candidates, split suggestion | Skew is GET-only (405 otherwise) and read-only. The split suggestion is POST, read-only and 404s an unknown entry. |
| Payment ways | Person and accounts are checked against the household, account kinds are enforced, the settings JSON is merged with `json_patch` in one batch with an audit event. |
| `ask:` references | The route accepts only `^ask:[A-Za-z0-9-]{8,64}$`; `shortcut:` references stay with the Shortcut route; a replay with other details is a fixed 400 that returns nothing. |
| Ask storage | `sessionStorage` only, versioned, size capped; photos, audio, `blob:` and `data:` values and status lines are dropped (`tests/ask-conversation-store.test.mjs`). |
| Logging | AI routes log only the status of a rejected key. Page diagnostics log view, month and scope. No question, sentence, image, fact list or answer is logged or stored. |
| Dependencies | `npm audit --omit=dev`: 0 vulnerabilities. |
| Households | There is one household (`DEFAULT_HOUSEHOLD_ID`) in every query; no route takes a household id, so there is nothing to cross. |

## Not on master yet

PR #53 (`ask-planning`): `plan-draft` is read-only and its AI reading is
checked against the request text (names, amounts, months). `apply-changes`
is all or nothing in one batch, caps changes at 80, checks every amount,
section, ownership, date and id, reads rows only from the requested month
and refuses with 409 when a line changed since the draft. Findings for that
PR: read the body with `readJsonObject` (F4) and keep returning only
`MonthPlanChangeError` text for refusals (F8).

PR #18 (`ask-ai-filter-and-signals`): `/api/ai-assist/filter` refuses a
question the answer rules read, sends only the redacted request and the
names of categories, wallets and people, and validates the proposal against
that reference data. Finding: read the body with `readJsonObject` (F4).

Both PRs pass the CSRF guard automatically (it sits in `fetch`). The F4
source test fails on any bare `request.json()` in `src/server`, so each PR
needs that one-line change when it merges.

Splits by chat (not reviewed): check that the model's reading is validated
against the group's member and expense names and amounts in the request, that
no write happens before the person's Save, that the save is one batch with a
stale-data check as apply-changes has, that the body goes through
`readJsonObject`, and that group, person and amount ids are looked up in the
household (never trusted from the draft).

## Gates

On this branch (merged with `origin/master` `cce1c6dc`): `typecheck`,
`typecheck:client`, `lint`, `test:unit` (all tests) and `npm audit --omit=dev`
pass with zero errors; `build` passes; the targeted browser specs
`ask-page`, `settings-payment-ways` and `ask-split-suggestion` pass. The
`ask-page` run is what found the first version of the F1 guard refusing a
replayed request (see F1).

## Addendum: Claude rejection diagnosis (October 2026)

Privacy, cost and write boundaries of the rejection diagnosis:

- The `AI provider config rejected` log now carries `{provider, status,
  source, message}`. `source` is derived from the error body's shape
  (Cloudflare gateway, Anthropic or unknown). `message` is the provider's
  error text, capped at 300 characters, with the gateway token and API key
  values removed verbatim and any `sk-...`, `Bearer ...` or 32+ character
  token-like run replaced by `[redacted]`. Request headers, the token and the
  key are never logged. The body is read only on a 400, 401, 403 or 404 and
  is not stored.
- `GET /api/ai-assist/provider-diagnostic` (behind the same Access check as
  every API route) makes one Claude call with `max_tokens` 1 and the fixed
  prompt "ping": no user data leaves. It costs 1 allowance unit, writes only
  the shared daily allowance counter, is read-only otherwise, and returns the
  same sanitised message plus booleans for gateway-id and token presence and
  the BYOK alias name. Tested in `tests/ai-provider-diagnosis.test.mjs`
  (gateway 401, Anthropic 401, Anthropic 400 credit balance, success, no
  secret in log or response).
