# Code Spec

This document is the compact implementation spec for Monies Map.

Read it after [`docs/architecture.md`](./architecture.md) and before touching
query wiring, slice modules, or page workflows. It exists to keep the
implementation phase constrained enough for humans and smaller coding models.

## Reading Order

Use this order for implementation work:

1. `AGENTS.md`
2. [`docs/architecture.md`](./architecture.md)
3. [`DOMAIN.md`](../DOMAIN.md)
4. one or two task-specific docs only:
   - behavior: [`docs/scenario-catalog.md`](./scenario-catalog.md)
   - boundaries: [`docs/slice-inventory.md`](./slice-inventory.md)
   - queries: [`docs/query-map.md`](./query-map.md)
   - current guardrails:
     [`docs/existing-behavior-guardrails.md`](./existing-behavior-guardrails.md)
   - responsive behavior:
     [`docs/responsive-behavior.md`](./responsive-behavior.md)
   - CTA semantics:
     [`docs/interaction-guidelines.md`](./interaction-guidelines.md)
5. this file for implementation shape and performance limits

Prompting rule for implementation:

- name the target slice
- name the target scenarios
- name the target query contract
- name the target responsive/interaction docs only if the workflow touches them

## Why The Worker Sometimes Goes 503

The current app already shows the main risk:

- broad first-load requests can still be slow if they pull too much data
- `src/index.ts` logs API pages as slow at `750ms`
- `src/client/App.jsx` still owns the shell and route orchestration
- E2E tests already defend against "worker restarted mid-request"

The likely failure mode is:

1. a broad request ties up too much worker time or memory
2. the worker restarts, stalls, or gets temporarily throttled upstream
3. the client retries while the worker is still unhealthy
4. many routes fail together until the isolate recovers

This refactor should reduce that risk by:

- replacing broad bootstrap hydration with smaller slice-owned requests
- removing old paths in the same slice once a replacement passes tests
- avoiding eager prefetch storms
- keeping warmup cancellable and low priority
- invalidating narrowly instead of reloading the world after each write

## Performance Budgets

These are target budgets, not platform guarantees.

The current slow-log threshold is `750ms`. New visible page queries should aim
to stay well below that.

Client side, a required page read (`fetchTextWithTransientWorkerRetry`,
`src/client/request-timeout.js`) is tried again after a timeout (once), a
dropped connection, a gateway error (502/503/504/522/523/524/530) or a
restarting Worker body before the screen reports it could not load; an
application 500, a caller abort and speculative reads (`maxAttempts: 1`) are
never retried. `npm run check:bundle` also fails when the build refers to a
chunk or stylesheet that is not in `dist/` or a route panel is not a lazy
chunk.

| Query / workflow | Target server time | Stretch limit | Notes |
| --- | --- | --- | --- |
| `appShell` | `<= 100ms` | `200ms` | route-neutral shell only; no accounts, categories, page payloads, balances, checkpoints, or import history |
| `referenceData` | `<= 150ms` | `250ms` | account/category dropdown data only; no transaction or checkpoint scans |
| `summaryPage` | `<= 300ms` | `500ms` | aggregates only |
| `summaryAccountPills` | `<= 200ms` | `350ms` | keep separate if costly |
| `monthPage` | `<= 350ms` | `600ms` | month rows and metrics only |
| `entriesPage` | `<= 400ms` | `650ms` | paged or filtered, not full world |
| `importsPage` | `<= 250ms` | `400ms` | list and lightweight metadata |
| `importPreview` | `<= 700ms` | `1200ms` | heavy but draft-sensitive |
| `splitsPage` | `<= 300ms` | `500ms` | slice-owned |
| `settingsPage` | `<= 350ms` | `600ms` | settings forms plus full account diagnostics and checkpoint history |
| `skewCandidates` (`GET /api/skew-candidates`) | `<= 250ms` | `400ms` | read-only, 16 D1 reads, no writes; entries for the month ±14 days, not a page DTO, at most 50 candidates |
| warmup / prefetch | `<= 250ms` | `400ms` | must yield to visible work |

Measured at the 10k stress fixture after the macro performance work
(`docs/audits/macro-loading-baseline.md`), all well inside these budgets:
Entries ≈23 ms handler / 38 KB gzip, Month ≈31 ms / 47 KB, Summary (12
months) ≈77 ms / 2 KB, Splits ≈31 ms / 3 KB, account pills and Imports
≈30–35 ms. Payload size, not handler time, is what grows with ledger size.

Budget rules:

- visible page queries over `750ms` are a design smell
- warmup must stop before it competes with the active page
- one slow query is acceptable temporarily; broad slow dependency chains are not
- mutations may take longer, but their follow-up invalidation should stay narrow
- account/category mutations refresh `referenceData`; only viewer/person/demo
  changes should refresh `appShell`
- entry-row edits and split-link actions from `Entries` must not invalidate
  `appShell`; they refresh slice queries only and rely on split/entry mutation
  events for cross-tab freshness
- the app shell must not statically import route-only UI, page editing controls,
  or a broad client facade that retains those modules; use route-owned lazy
  modules and direct shared helper imports for the few shell-level operations
- optional work (route code warmup and speculative data) starts only
  when `routeWork.usable` is true and goes through the warmup scheduler; do
  not add new idle prefetch effects
- mobile speculative data needs a row in `route-warmup-admissions.js`
  measured with `tests/performance/api-admission.spec.js` on the 10k
  fixture; `maxDataBytes` is compared with gzip bytes
- mobile speculative data also needs a reported `4g` connection, or an
  unknown one (`navigator.connection` missing, as on iPhone) together with a
  measured recent required request of at most `maxRecentRequiredMs`
  (500 ms); a missing or slower measurement, `slow-2g`/`2g`/`3g`, data
  saver, the quiet period, one request per visit, open editors and in-flight
  work still deny it
- a refresh after a save runs through `runBackgroundRefresh`
  (`use-refresh-notice.js`); never swallow it with `.catch(() => null)`. A
  failure keeps the saved data on screen and shows the inline refresh
  notice with "Refresh now"; aborted, cancelled, superseded or left-route
  failures stay silent, and a background refresh never raises the page
  error screen
- the Entries page DTO is written only through `entries-data-owner.js`, so
  a refresh started before a month or view change cannot overwrite the new
  month or end its loading state
- a load or refresh that fails before the request's own page was shown is a
  load failure, not a refresh failure: show the page `ErrorPanel` with the
  shell's retry in place of the stale figures and rows (Entries:
  `loadError`), never the previous period's data or an empty state
- a dialog or sheet that writes checks `response.ok`, shows a saving state,
  takes one submit, ignores Escape and Cancel while in flight, and closes
  only on success; a failure keeps the draft with an `InlineError`
- a portalled dialog that can open inside a form or clickable row stops
  React `submit`, `click` and `keydown` bubbling at its overlay and content
  (`category-edit-dialog.jsx`)
- a page DTO carries only what its route reads; do not embed another route's
  page DTO (Splits carries the month key and transfers, not the Month page)
- skew candidates (DOMAIN.md "Skew Candidate") have their own read-only
  route, `GET /api/skew-candidates?view=&month=&scope=`
  (`pages/skew-candidates.ts`, pure finder `skew-candidates.ts`). Its
  query budget is fixed: the page context (household, people, categories,
  tracked months), the month's entries ±14 days with their split shares,
  the transfer-grouped entry ids in that range, account references, split
  groups, expenses, settle-ups and settlement checkpoints (with items and
  matches): 16 reads, no writes and no month refresh. It returns at most
  50 candidates (`omittedCandidateCount` counts the rest; totals cover all)
  with descriptions bounded to 240 characters. One-sided `medium`
  settlements (naming nobody) are hidden unless `?include=medium` asks;
  the reads are the same either way. Never add it to the app
  shell, a page DTO or warmup; a caller asks for it explicitly
- page APIs report `Server-Timing: app;dur, init;dur;desc, total;dur`; keep
  `app` first because budget checks read the first `dur`
- enforced budgets: `npm run check:bundle` (first-screen JS and CSS, gzip,
  +5% of `scripts/initial-bundle-budget.json`, and no Money insights copy
  pool in a first-screen file, run by `npm run verify`) and
  the page-response size test in `tests/e2e/api-performance.spec.js` (+10% of
  `tests/e2e/api-payload-budget.json`, run by the smoke bundle)
- a new lazy chunk can still cost the first screen a file: when it imports a
  module the first screen shares (React, `react/jsx-runtime`, `money-privacy`)
  the bundler splits that module into its own chunk, which `check:bundle`
  counts. Check the first-screen file list before and after. The Summary
  month chart (`earned-spent-chart.js`) avoids it by using `createElement`,
  importing neither React nor `money-privacy`, and being handed React by
  `summary-panel.jsx` (`createEarnedSpentChart`), as `simple-detail.js` is
  handed `h`
- App loads the active route's code as soon as the route is known, beside
  its data (the panel renders only once its data is here); it never loads
  another route's code this way (that is warmup, and waits for `usable`)
- CSS that only one lazy route uses goes in a stylesheet imported by that
  route's module, so it ships with the route; `public/styles.css` counts
  toward the first-screen budget, measured as the build ships it
  (`dist/styles.css`, minified by `vite.config.js` with the same
  lightningcss options and targets as route CSS, which adds the prefixes
  Safari 16.4 needs, such as `-webkit-backdrop-filter`, and drops unneeded
  ones). Each lazy route's general rules are in
  `<route>-route.css` (Entries, Imports, Month, Settings, Splits), imported
  first by `<route>-panel.jsx`; narrower files follow it
  (`month-mid-width.css`, `splits-panel.css`). A moved rule loads after
  every `styles.css` rule, so move one only when no later rule of the same
  specificity sets the same property on the same element, and compare
  computed styles before and after
- a lazy route that imports a module from the Summary route's static graph
  on its own (not through the shared chunk that already holds it, such as
  `ui-components.jsx` or `financial-insight.jsx`) splits that module into one
  more first-screen file (`App.jsx` imports `account-display.js` for this
  reason: as its own chunk it keeps React and the copy out of the entry and
  adds two files), and importing `query-leases.js` beside React hooks
  in a lazy route splits React and the runtime out of the entry chunk. The
  Ask page therefore reaches the check-in through `financial-insight.jsx`
  exports, gets the Entries page read from App (`fetchEntriesPage` prop over
  `fetchRoutePageResponse`), and loads the OCR worker (`ocr-worker.js`) with
  a dynamic import from both callers. Check the file count with
  `npm run check:bundle` after adding a route import
- no `:has()` that searches all descendants (`body:has(.x)`): on a large
  month each restyle of an element such a rule styles walks the whole page.
  A portalled layer uses `body:has(> .x)`; an element inside the page holds
  a `<body>` flag through `page-flags.js` (design.md "Page State Rules";
  `tests/page-flags.test.mjs` enforces it)

## List Rendering Contract

A month can hold thousands of entries (the 10k stress fixture puts 2,000 in
2026-05). Lists that grow with the ledger follow these rules, measured in
`docs/audits/macro-loading-baseline.md` ("Entries and Month list
rendering"):

- Rows are `memo` components whose props are the row's own data, a few
  primitives and stable handlers. Pass handlers through `useStableHandler`
  (`src/client/use-stable-handler.js`) or a `useCallback` with no changing
  inputs; never an inline closure or a function recreated on each render.
- Anything only an open editor needs travels in one bundle given to the
  open row alone (`editor` in `entries-list.jsx`). Closed rows never
  receive editor, saving, transfer or draft state.
- Derived row data keeps object identity. `entry-row-projection.js`
  caches each projection by entry object and view, and `mergeEntriesById`
  returns the current object when a merge changes no field. Do not spread
  entries into new objects in a selector that feeds rows.
- A memoized component that prints money through the shared formatter
  subscribes with `useMoneyPrivacy()`. Keep that subscription on the
  smallest piece that prints money (`EntryRowAmount`), so the toggle
  redraws amounts, not rows.
- Per-row dialogs, popovers and heavy widgets mount only while open
  (`CategoryAppearancePopover` mounts its dialog on open).
- Expensive scoring runs when its real inputs change, not on every
  checkbox or keystroke in the same dialog (Month plan-link candidates).
- Closed Entries rows use `content-visibility: auto` with a measured
  `contain-intrinsic-size` of the row's content height (67 px desktop,
  88 px mobile: the rendered row minus its 1 px top border, which the
  intrinsic size excludes). Rows stay in the DOM, so find-in-page, Tab focus
  and screen readers reach every row; the open row is never skipped. Update
  the intrinsic size if the row layout changes height.
- Scrolling to a row more than two screens away is instant
  (`longJumpOr` in `entries-list.jsx`): a long smooth scroll renders
  estimated rows on the way and ends off target.
  `tests/performance/entries-deep-link.spec.js` checks a deep link to row
  1,500 and 1,990 lands where row 5 does.
- Entries is not windowed. Windowing would remove off-screen rows from
  the DOM, breaking find-in-page and Tab order through the list; add it
  only with a measured reason and a plan for those.
- Proof: `tests/e2e/entries-row-rendering.spec.js` and
  `tests/e2e/month-plan-link-rendering.spec.js` count row renders through
  the React DevTools hook (`tests/support/react-commit-counter.js`).
  Timing: `PERFORMANCE_FIXTURE=scale-10k npm run test:performance`
  (`entries-interaction.spec.js`, `month-interaction.spec.js`), compared
  with `node scripts/compare-performance.mjs --interaction <before> <after>`
  over several runs per side.

## Optional AI Contract

AI belongs outside the normal query and mutation graph, and every AI action
is explicit (no page sends a background wording request). It must return an
ordinary unavailable result when disabled, unconfigured, quota-limited,
over the gateway spend limit, or invalid. No visible page query, import
preview or commit, accounting calculation, reconciliation, category
application, duplicate decision, transfer decision, or Import Inbox plan may
await it.

New AI calls use the provider layer, `src/domain/ai-provider.ts`:
`runVisionJson(db, env, { capability, images, prompt, schema, maxTokens,
parse, timeoutMs? })` and `runTextJson(db, env, { capability, units, prompt,
schema, maxTokens, parse, timeoutMs? })`, both returning `{ available, value?,
reason?, remaining?, provider? }` and never throwing. The order is fixed:
check `AI_ASSIST_ENABLED` and that some provider is configured
(`getAiProviderUnavailableReason`, cheap enough to run before reading a
request body), validate the input, reserve the shared daily allowance once
(`reserveDailyAiBudget`; an image costs `AI_ASSIST_VISION_UNITS`, default
2), then try Claude through AI Gateway (`resolveClaudeGateway`: only when a
gateway location and a credential, `AI_GATEWAY_TOKEN` or
`ANTHROPIC_API_KEY`, are both set) and fall back to Workers AI
(`AI_FALLBACK_MODEL`, default `@cf/google/gemma-4-26b-a4b-it`) on any
non-2xx (429 includes the spend cap), network error, timeout (15 s each by
default), refusal, cut-off or answer the caller's `parse` rejects. Gateway
requests always carry `cf-aig-collect-log: false` and `cf-aig-skip-cache:
true`; only a 400/401/403/404 is logged, as the status code alone. When a
provider did answer but `parse` refused every answer, the result's reason
is the caller's optional `unusableReason`; otherwise (and for any failure or
timeout) it is "AI is temporarily unavailable.".

The Monthly Note draft, statement-mismatch explanation, category-rule
suggestions and statement text fallback (`src/server/ai-assistance-routes.ts`)
use `runTextJson`, each with its own JSON schema (`TEMPLATE_SCHEMA` for the
two wording routes, `buildCategoryRuleSchema`, whose `categoryName` enum is
the evidence's category names, and `STATEMENT_ROWS_SCHEMA`) and
`unusableReason: AI_UNUSABLE_SUGGESTION_REASON`, so a refused answer still
reads "AI returned an unusable suggestion.". The schema only shapes the
answer: each route's validator (`parseNarrativeTemplate`,
`parseImportExplanationTemplate`, `parseAiCategoryRuleProposals`,
`parseAiStatementRows`) is unchanged and still decides what is usable, and
counts (5 proposals, 40 rows) are enforced there. Prompts, redaction
(`redactAiText`, `redactAiStatementText`), units (1, 1 per mismatched
statement, 2, 8) and answer caps (180, 140, 300, 700 tokens: Workers AI's
`max_completion_tokens`, Claude's `max_tokens` less the provider's fixed
1,024-token thinking headroom) are as before. The entry draft joined them
on 12 October 2026 (`runTextJson`, 80 tokens), and `runAiJson` has no
caller left in routes; match ranking stays on Workers AI embeddings (`runAiEmbeddings`, `@cf/baai/bge-small-en-v1.5`).
Proof: `tests/ai-text-provider-routes.test.mjs` (per route: Claude first,
Claude failing to Gemma, both down, refused answers, Workers AI alone, AI
off, unconfigured or over its allowance, one allowance reservation).

After every Claude attempt the provider records the aggregate AI provider
status (`src/domain/ai-provider-status.ts`, DOMAIN.md "AI Provider
Status"): a 2xx is a success, adding `usage` tokens (input plus cache
tokens at `AI_CLAUDE_PRICE_IN_PER_MTOK`, output at
`AI_CLAUDE_PRICE_OUT_PER_MTOK`, defaults 0.10 and 0.50 US$ per million,
Claude Haiku 5.5's short-prompt list price; check them against Anthropic's
pricing page whenever the model changes) to the estimated spend and
clearing an older failure; a non-2xx is categorized from its status and
error body (`credit_exhausted`: 400 "credit balance is too low" or 402
`billing_error`; `spend_capped`: a 429 that is not Anthropic's
`rate_limit_error`, i.e. the gateway's spend limit; `auth`: 401/403;
`other`: anything else, including network errors and timeouts, which never
replaces an uncleared specific failure). Each write is one upsert
statement, awaited for at most 500 ms with errors swallowed, so it can
never fail or hold an AI answer; nothing is recorded when Claude is not
configured, and the error body is read only to categorize it, never stored
or logged. `GET /api/ai-assist/provider-status` returns
`AiProviderStatusResponseDto` (`state`: `exhausted`, `capped`, then `low`
at `AI_CLAUDE_WARN_AT_USD`, default 15, capped at the credit, of the
credit `AI_CLAUDE_CREDIT_USD`, default 20, or the last top-up mark's
amount, then `unknown` without a success or after a key failure, else
`ok`) only to a Cloudflare Access email in `AI_ALERT_EMAILS`, or to
everyone when it is `"*"` (`isAiAlertViewer`; `wrangler.jsonc` ships `"*"`);
anyone else gets `{ ok: true, visible: false }` with no database read.
The visible answer also carries `monthSpendUsd`, `monthTargetUsd` and
`mode` (auto-balance, below). `POST .../topped-up { creditUsd }` (the same viewers, 403 otherwise; a
number above 0 and at most 10,000, 400 otherwise) restarts the estimate at
the new credit. On the client the status has one store, the query cache
entry `queryKeys.claudeCreditStatus()` (`claude-credit-status.js`): Ask and
Settings read it with `fetchQueryWithLease`, through the
`fetchRequiredQuery` App passes them (importing `query-leases.js` into a
route chunk makes the bundler split the entry into one more first-screen
file), only once their route is usable (App passes `routeWork.usable` to
those two routes alone), kept for five minutes; a top-up cancels any read in flight and then writes the
POST's answer into that entry. A failed read leaves no status and shows
nothing.

Auto-balance (owner-approved 12 October 2026, `computeClaudePacing` and
`claudeGoesFirst` in `src/domain/ai-provider-status.ts`): when both Claude
and Workers AI are available, `runJson` reads the status row (one SELECT,
errors mean Claude first) and orders the providers by the month's estimated
Claude spend (`spend_month`, `month_spend_micro_usd`; a success in a new
Asia/Singapore month replaces the figure, one in the same month adds to it,
in the same single upsert as the credit estimate) against a pace line of
`AI_CLAUDE_MONTHLY_TARGET_USD` (default 8) times day over days in the month:
`claude_all` (at or under pace) Claude first for every capability;
`ask_only` (over pace) the basic model first for the background tier
(`monthly_narrative`, `import_explanation`, `category_rules`,
`statement_text_fallback`) and Claude first for the ask tier (`receipt_read`,
`entry_draft`, `ask_answer`); `basic_first` (spend at 90% of the target or
more) the basic model first for both. The other provider is the fallback in
every order, a Claude attempt records its spend wherever it comes in the
order, and nothing is read when only one provider is configured. The entry
draft now uses the provider layer (`runTextJson`, schema in
`ai-assistance-routes.ts`) so it can ask Claude. `AI_ASSIST_DAILY_LIMIT` is
clamped to 4 to 100 (production sets 100). Covered by
`tests/ai-provider-status.test.mjs` (pacing at day 1, 15 and 30, under and
over pace, 90%, month rollover at Singapore midnight, the route's shape) and
`tests/ai-provider.test.mjs` (every capability in every mode, fallback
order, unreadable status).

Receipt reading (`POST /api/ai-assist/receipt-read`,
`src/server/receipt-read-route.ts`) checks availability before reading the
body, refuses anything but a JPEG, PNG or WebP whose bytes match its type
(415) or over 1.5 MiB (413), and returns a `ReceiptReadDto` built by
`finalizeReceiptRead` (`src/domain/receipt-read.ts`). The model returns raw
fields only; the app validates the date (ISO, at most a day ahead), the
total (positive, bounded, converted to minor units by the app), the
currency (allowlist) and the card ending (last four digits only), and turns
unclear fields into `questions` with a reason and validated candidates; no
model wording reaches the user. `readReceiptOcrText`
(`src/domain/receipt-ocr-text.ts`) produces the same DTO from in-browser OCR
text when AI is unavailable, and `receiptReadToDraftFields` maps either to
the `/api/entries/create` field names. Tests must prove the route writes
nothing but the allowance counter (and, when Claude is configured, the
aggregate AI provider status row) and logs nothing
(`tests/receipt-read-route.test.mjs`, `tests/ai-provider.test.mjs`).

The Ask page's readers (`ask-api.js`) are explicit actions: the entry-draft
route only for a sentence the person sends, the receipt-read route only for
a photo they pick, paste or drop (downscaled and re-encoded in the browser
first, never stored). Each fails soft to a manual card with a calm note;
`tests/ask-api.test.mjs`, `tests/ask-api-server-contract.test.mjs` (the
client adapter against the real routes) and the unavailable case in
`tests/e2e/ask-page.spec.js` are their no-AI and failure tests. Opening Ask
makes no AI request.

The composer's mic (`ask-voice.js`) is an explicit action too: hold or tap.
It uses the browser's own speech recognition first and sends nothing.
Only a browser without one records a clip (MediaRecorder, at most 30 s,
32 kbit/s) for `POST /api/ai-assist/transcribe`
(`src/server/transcribe-route.ts`): Workers AI Whisper, 1 unit of the
shared allowance reserved before inference, with type, size and duration
checked before that. Its `GET` (no AI, no allowance) runs only on the first
press, so opening Ask still asks nothing. Clips and words are never stored,
logged or cached. Spoken words only fill the message box; sending stays the
person's tap. `tests/transcribe-route.test.mjs` (disabled, allowance,
caps, success, nothing written but the counter, nothing logged) and
`tests/ask-voice.test.mjs` / `tests/e2e/ask-voice.spec.js` (fallback off
hides the mic, denied is a calm note) are its no-AI and failure tests.

An AI response is a bounded draft, explanation, or ranking over deterministic
evidence already selected by the app. The existing editor or review action is
the only way to persist a change. Keep request payloads redacted and bounded;
do not persist prompts, model responses, original bank files, receipt or
raw OCR images, or embeddings. Each AI change needs a no-AI test and a failure-path test in
addition to the normal behavior test. Money insights use computed wording
only: the headline is the signal's bold fact and its think line exactly as
written, and no page sends a wording request (the
`/api/ai-assist/financial-insight` route and its template parser are
removed). Their copy must distinguish full cash flow from a filtered
investigation view and from split-settlement obligations, and must not
invent forecasts, savings targets, or comparisons. The only look ahead is
the scheduled check (DOMAIN.md "Account Routine"), which compares a recent
statement balance with payments that already repeat from the same account.

The entry draft route (`POST /api/ai-assist/entry-draft`) is the pattern
for an AI gap-filler over a deterministic answer. The pure parser
(`parseEntrySentence` in `src/domain/entry-draft.ts`) runs first and its
draft is always returned; `entryDraftWantsAi` allows AI only when the
sentence named no amount at all or left no description (never for two
amounts, an unknown currency or a foreign amount, which are the user's
call). Then one allowance unit, 80 tokens through `runTextJson` (provider
layer: Claude first or the basic model first by auto-balance), the redacted sentence only (no
accounts, people, rules or settings), and the untrusted-data system prompt.
`parseEntryDraftAiSuggestion` validates the answer like any input: an
amount must be stated in the sentence (its digits, or number words), and
every word of a description must be a sentence word. The merge re-runs the
parser with the suggestion, so a deterministic value always wins and an AI
value is marked `ai`; number words that spell an AI amount leave the
sentence description, and nothing else does. Reference data loads through `entry-draft-context.ts`
(six reads, no ledger tables); the route writes nothing but the allowance
counter, and only when AI is asked. A confirmed draft is saved by the client
posting `createBody` to `/api/entries/create`. Proof:
`tests/entry-draft.test.mjs` (scenario table with exact outputs and the
never-guess cases) and `tests/ai-entry-draft-route.test.mjs` (AI off,
missing, throwing, malformed, inventing and over its allowance each return
the deterministic draft with no data write).

Ask's money answers (`POST /api/ai-assist/answer`,
`src/server/ask-answer-route.ts`; DOMAIN.md "Money Question") are the
pattern for AI that only phrases a computed answer. Rules read the question
(`readAnswerIntent`, shared with the Ask page so a money question reaches
the route before the filter reader); the skew candidates for the answer's
month(s) are checked first and a high-confidence one that would change the
facts returns `{ needsConfirmation, candidates }` with no answer; the facts
are pure reads of the Month and Splits page DTOs (`ask-answer-facts.ts`),
so every figure equals the screen it links to; the card and the computed
wording come from them (`ask-answer-wording.ts`). Only then, with AI on,
`runTextJson` (capability `ask_answer`, 1 unit, 220 tokens, 8 s, schema
`{ text }`) may phrase the wording from at most 16 bounded fact lines and
the redacted question, and `validateAiWording` is its parser: every number
must be a number in the facts, no name the facts do not hold, at most three
sentences and 360 characters, no advice, forecast or jargon. Any failure
shows the computed wording. The route writes nothing but the allowance
counter; resolving a check goes through the candidate's suggested routes
from the client, in order, against an allowlist (`resolveSkewCandidate`).
Proof: `tests/ask-answer-*.test.mjs`, `tests/ask-money-answer.test.mjs`,
`tests/e2e/ask-money-answers.spec.js`; audit
`docs/audits/ask-answers-audit.md`.

Money insights (check-in) signals live in `src/domain/money-signals/`, one small pure
function per signal returning `{ key, kind, weight, numbers, phrasings,
action? }` or `null`, with its copy in the page's catalogue beside it. They
read only data the page already has (no new endpoint; a fact a signal
needs from the server rides on the page's own payload, as the account
pills' routine facts and a settlement's `paymentCandidate` do), take
`today` and the money formatter as inputs, and never call `Date.now` or
`Math.random`; ranking in `checkin.ts` takes the clock, the visit memory and
a stable seed, and everything that rotates is chosen from the period being
viewed (`rotation.ts`), never from the clock or the memory, so nothing
repeats within twelve periods for a page and view. A signal that can recur
needs 12 or more wordings (phrasings times think lines); a Just for fun
line needs a trivia type placed in exactly one of the page's twelve
columns. Each signal needs a unit test that it fires
with concrete numbers and exact wording, and one that it stays silent.
Actions may only reuse navigations the page already has. A signal that can
be true month after month needs a notability test: `steady` when its
numbers are not unusual, with an optional quarter `turn`
(`money-signals/types.ts`), proved both ways in
`tests/money-insights-notability.test.mjs`. Summary's signals and every
copy pool (phrasings, think lines, Just for fun lines, calm lines) are not
on the first screen: `money-insights-loader.js` imports
`summary-signals.ts` dynamically, the Summary route loader starts that
import beside its own (`route-modules.js`), and the panel never waits for
it (the insights show their frame, one line high, until it arrives). The
quotes load when "See all insights" opens. `npm run check:bundle` fails
when a line from any pool is in a first-screen file. `checkin.ts` must not
import `format.ts`: a module Summary's signals share with the first-screen
check-in becomes one more first-screen file, so the engine keeps its own
four small helpers (`engineText`, tested against `format.ts`).
Money insights are deterministic UI evidence, not model output. A
same-season line requires an already-loaded matching calendar month, and a
statement-gap Quick fix requires the page's explicit reconciliation status,
never an inference from a filtered ledger view. The retired Money
consequence map must not come back as a second copy of the signals
(`tests/money-consequence-map-retired.test.mjs`).

## Query State Chart

```text
Route intent
  -> Resolve route params
  -> Start primary query only
  -> Render shell / keep previous safe data
  -> Primary query settles
  -> Render active page
  -> If page is stable, maybe start one warmup query

Mutation intent
  -> Check for active workflow lock
  -> Save mutation
  -> Apply optimistic or immediate local state if needed
  -> Invalidate exact affected queries
  -> Cross-tab notify if data changed
  -> Reconcile stale queries when safe to replace
```

## Query Ownership Contract

Each slice owns:

- route-to-query param mapping
- query key builder
- query option builder
- mutation invalidation map
- selectors that shape query data for UI
- tests for route contract and invalidation behavior

URL parameter names (`view`, `summary_start`, `summary_end`) differ from key
field names (`viewId`, `startMonth`, `endMonth`). Translate them only in
`query-keys.js` (`monthPageKeyFromParams`, `summaryPageKeyFromParams`), never
inline. A route's fetch key and its mutation invalidation key must be equal
for every person; `tests/query-foundation.test.mjs` holds that matrix. Keys
that still use URL names (Entries, Splits) must be built from the same URL
params on both sides.

Each slice must not own:

- another slice's hidden query dependencies
- broad bootstrap reads as a shortcut
- compatibility fallbacks that outlive the slice that introduced them
- global refresh side effects that ignore workflow locks

## Invalidation Contract

The Ask page saves, undoes and follows up through the existing routes and
then calls the shell's `broadcastEntryMutation` (and
`broadcastSplitMutation` when a split was made or removed) for the entry's
month, and refreshes that month's Entries page DTO with
`runBackgroundRefresh` so Back to Entries shows the row.

Use this shape for each mutation:

```text
Entry save
  -> invalidate entriesPage for current route
  -> invalidate monthPage for affected month/view/scope
  -> invalidate summaryPage for affected summary range(s)
  -> invalidate summaryAccountPills if account balances can change
  -> notify cross-tab listeners
```

```text
Month plan save
  -> invalidate monthPage for affected month/view/scope
  -> invalidate summaryPage for affected range
  -> keep open editor stable until save settles
```

```text
Import commit / rollback
  -> invalidate importsPage
  -> invalidate entriesPage for affected months/accounts
  -> invalidate monthPage for affected months
  -> invalidate summaryPage for affected ranges
  -> invalidate summaryAccountPills for affected accounts
  -> clear persisted shell cache
  -> broadcast cross-tab refresh
```

Invalidation rules:

- invalidate the smallest key set that can be defended clearly
- do not use "invalidate everything" as the default
- stale is allowed immediately; visible replacement is not allowed if it would
  clobber an active workflow
- if a slice needs shell refresh for a shared-metadata exception, isolate it
  behind a named helper and document why it is not the normal invalidation
  path

## Workflow Lock Contract

Protected workflows include:

- quick entry opened from URL
- mobile entry edit sheet
- mobile filter sheet with in-progress state
- month add/edit sheet
- import preview draft
- split-group selection flow

Protected workflow pseudocode:

```text
if workflowLock.isActive(slice, workflowId):
  markQueriesStale()
  deferVisibleReplacement()
else:
  refetchAndReconcile()
```

## Persistence Atomicity Contract

A persistence command is all-or-nothing:

- read and validate everything first (lookups, existence and lock checks,
  snapshots needed for undo, generated ids); throw before the first write
- then commit every write of the command, its audit event
  (`buildAuditEventStatement`) and its month refresh markers
  (`buildMonthlySnapshotRefreshMarkers`) in one `db.batch()`. D1 runs a batch
  as one transaction and rolls it back if any statement fails
- never interleave awaited reads between writes, never write with sequential
  `.run()` calls, and never split one command's writes over several batches.
  When a later statement needs an earlier result, compute it in JS before the
  batch (precomputed ids, the ledger with the command's own changes applied,
  source-month totals for a copied month)
- helpers used inside a command return statements (`build...Statements`)
  instead of executing them
- refresh derived month totals after the batch with
  `refreshMonthlySnapshotsAfterWrite`; one month's scopes and the marker clear
  commit together, and a refresh failure is logged, not returned as a write
  failure, because the markers let the next Summary or Month read repair it
- the optional AI cost-control aggregates (the daily allowance counter in
  `src/domain/ai-assistance.ts` and the AI provider status row in
  `src/domain/ai-provider-status.ts`) are not household data and have no
  audit event; each of their writes is a single upsert statement, so they
  need no batch or `failingStatement` test
- the import commit adds its approved statement fixes
  (`src/domain/import-statement-fixes.ts`) to its own batch before the rows'
  certifications, after re-checking them on rows read before the batch; a
  fix that no longer holds throws before anything is written
  (`tests/atomic-writes-statement-fixes.test.mjs`)
- an activity export's removal of the entries the bank no longer lists
  (`src/domain/import-no-longer-listed-entries.ts`) re-checks each entry,
  then saves it to `import_no_longer_listed_entries` and deletes it in the
  import's own final batch; the rollback re-creates it in the rollback's
  batch (`tests/atomic-writes-no-longer-listed.test.mjs`)
- an investment statement import (`src/domain/import-investment-values.ts`,
  `import-transfer-links.ts`) re-checks, before the batch, that each paired
  bank entry is still unlinked, on another account, for the same amount and on
  the opposite side, and that the value's account is an investment account in
  SGD (a refusal throws before anything is written). The value upsert (which
  keeps the replaced value in `previous_value_json`), the transfer group, the
  bank entry's reclassification, its `import_transfer_links` record and the
  rows are all in the import's own batch; the rollback puts the bank entry and
  the replaced value back in the rollback's batch
  (`tests/atomic-writes-ifast-import.test.mjs`,
  `tests/atomic-writes-stashaway-import.test.mjs`)
- statement corrections from Settings
  (`src/domain/app-repository-statement-corrections.ts`) apply or undo every
  move and removal with its `statement_corrections` row and audit event in
  one batch; a refusal is a `StatementCorrectionRefusedError` (409), thrown
  before anything is written (`tests/atomic-writes-statement-corrections.test.mjs`)
- the only multi-batch write is an import over
  `IMPORT_COMMIT_SINGLE_BATCH_STATEMENT_LIMIT` (500) statements: draft-only
  rows are staged, every visible change is one final batch, and a failure
  discards the staged rows. Do not add another staged write without a measured
  limit and the same invisibility argument
- a payment way save (`src/domain/app-repository-payment-ways.ts`) checks
  the person and accounts first, then commits the setting and its audit
  event in one batch; the person's entry is merged into the stored JSON
  inside the statement (`json_patch`), so two people saved at once cannot
  overwrite each other (`tests/atomic-writes-payment-ways.test.mjs`)
- a Shortcut connection save or revoke (`src/domain/app-repository-shortcuts.ts`)
  checks the person, the accounts and that no other person holds the key
  first, then commits the setting and its audit event in one batch (a revoke
  merges `apiKey: ""` and `revoked: true` with `json_patch`, so it cannot undo
  a save made at the same moment; `tests/atomic-writes-shortcut-connections.test.mjs`)
- moving an entry to another card (`src/domain/app-repository-entry-account.ts`,
  Ask's card suggestion) refuses a statement-confirmed entry, an entry on
  Splits, a transfer and another currency, then commits the account change,
  its audit event and the month refresh markers in one batch; only the
  account changes (`tests/atomic-writes-entry-account.test.mjs`)
- the card suggestion read (`POST /api/entries/card-suggestion`) has a fixed
  budget of three reads and no writes: the saved entry (by id; none for a
  draft), the accounts, and one history read on `idx_transactions_household_date`
  limited to 500 rows (`tests/card-suggestion-route.test.mjs`)
- a login's Plan | Simple choice (`src/domain/app-repository-viewer-preferences.ts`)
  is one upsert in one batch, merged with `json_patch`, under a hashed key.
  It is a display preference, not household data, so it writes no audit
  event (`tests/viewer-preferences.test.mjs`, with a `failingStatement`
  case)
- a repeated destructive command is rejected, not re-run (rolling back a
  rolled-back import returns 409)
- a check on the record's own state that a concurrent request can make stale
  between the read and the batch (still archived, still unlinked) is guarded
  inside the batch: a first statement from `buildBatchGuard`
  (`app-repository-splits.ts`) fails the whole batch when the state changed,
  and the command re-reads it to give the check's own message. A
  conditional `UPDATE ... WHERE` alone is not enough: its zero-row result
  would still commit the rest of the batch (history event, month markers).
  Races between two records for one ledger row stay with the partial unique
  indexes below
- prove each command with a failure test in `tests/atomic-writes-*.test.mjs`:
  make one statement fail partway with `failingStatement` and assert the whole
  database dump is unchanged; the test must fail on sequential writes

Converted (2026-09, `docs/audits/atomic-writes.md`): import commit and
rollback, entry create/edit/delete, transfer link and settle, month-plan
commands and the month snapshot recalculation; in the split workspace, add
an entry to splits, match a split expense to an imported entry, delete a
split expense, restore a split record (each with the entry month's refresh
markers), split expense and settle-up edit and delete (2026-09-26; a linked
split's edit carries its entry month's marker), the linked split's amount,
date, description and payer follow-up inside an entry edit's batch, the
linked split a Shared owner entry save or create writes
(`buildLinkedSplitUpsertStatements`, in the entry's batch) and an import
rollback's linked split amount follow-up; many entries' categories at once
(`updateEntryCategoriesRecord`, guarded per expected category), Simplify
(`createSplitSettlementCheckpoint`) and a new category
(`createCategoryRecord`), 2026-10-13 for Ask Phase 2
(`tests/atomic-writes-ask-phase2.test.mjs`). One active split record per ledger
row is held by partial unique indexes (`schema.sql`, runtime schema), so a
check before a linking batch is backed by the database when two writes race.
Not yet converted, so still
written statement by statement: the rest of the split workspace
(`app-repository-splits.ts`: split create, note and category edits,
checkpoints), category match rules (except rule delete, converted 2026-10-14, `tests/atomic-writes-category-rule-delete.test.mjs`),
settings, categories,
statement checkpoint edits, Shortcut requests (parked on purpose) and the
demo seed. Convert a module the next time its writes change.

## Data Flow Pseudocode

Keep slice code close to this shape:

```text
route params
  -> slice query options
  -> fetch DTO
  -> slice selector
  -> presentational component
  -> user action
  -> slice mutation action
  -> repository / API
  -> narrow invalidation
  -> selector recomputes
  -> UI settles
```

Do not skip from route or component directly into scattered helper calls.

## Stress Tests

Each implemented slice should have at least one stress-oriented test from this
list when relevant:

- same-tab return after drilldown edit shows fresh values
- cross-tab mutation refreshes stale page on focus
- mobile workflow does not get clobbered by background freshness
- manual refresh during an open workflow does not lose the draft
- rapid route changes cancel or ignore stale warmup work
- two quick saves do not let the older refresh overwrite the newer state
- slow query or restart does not break persisted app-shell cache
- import parser accepts structural variants from the same bank source

Testing depth rule:

- `npm run verify` is the local merge gate: dependency audit, strict
  TypeScript, the client type check, lint, unit tests, production build, the
  initial bundle budget, and the desktop/mobile smoke bundle
- `npm run lint` (`eslint.config.js`, ESLint flat config) checks correctness
  only: `eslint:recommended`, unused locals and imports (parameters and props
  are ignored, `_` names are exempt), `eqeqeq` smart, self-compare, template
  placeholders in plain strings, unmodified loop conditions, array callbacks
  that forget to return, and `react-hooks/rules-of-hooks` as errors;
  `react-hooks/exhaustive-deps` is a warning because many effects deliberately
  run on a key. There are no stylistic or formatting rules, and TypeScript
  files are left to `tsc`. Errors fail verify; do not add warnings casually
- `npm run typecheck:client` (`tsconfig.client.json`) runs `tsc` with
  `allowJs` and `checkJs` over `src/client` at the default, non-strict level
  (`strictNullChecks` alone reports hundreds of errors). Ambient browser and
  test-hook types live in `src/client/client-env.d.ts`. In plain JS an
  undefaulted destructured prop counts as required, so give optional props
  and options an explicit `= undefined` default rather than suppressing the
  error; use a JSDoc cast for untyped cache reads. A `// @ts-expect-error`
  needs a reason, and `// @ts-nocheck` is only for generated or vendor code
- run `npm run test:e2e` before merging broad shared-infrastructure,
  persistence, import, or cross-page invalidation changes;
  `npm run test:e2e:sharded` runs the same suite as parallel shards, each
  with its own Vite, Wrangler, ports (5501+/8901+/9501+) and local D1 persist
  directory, and is the faster equivalent (`docs/audits/e2e-sharding.md`)
- browser tests must not depend on another spec file or on run order: a
  test reseeds (`reseedDemo`, in the test, a local helper, or a
  `beforeEach` covering it) or reads only static content, because a shard
  starts from an empty schema and runs whole files in any grouping. Tests in
  one file stay together, in order, on one shard. After adding or
  noticeably slowing a spec, refresh the shard plan with
  `npm run test:e2e:sharded -- --update-weights` (full, passing run only)
- browser or unit: a test belongs in Playwright when the screen is part of
  what it proves: focus and keyboard, layout at a breakpoint, dialogs,
  sheets and Escape, navigation, back/forward and deep links, drafts
  surviving, money privacy, loading, error and retry states, timing and
  races, route warmup, or the Worker, D1 and client working together. A test
  that only sends API requests and checks the JSON, a computed total, a date
  or parser rule, a DTO shape or a stored row is a Worker-level test: put it
  in `tests/*-api.test.mjs` with `useSeededWorkerRequest()`
  (`tests/support/worker-request.mjs`, the real Worker over a real local D1)
  or, for a pure function, a plain unit test. Every user workflow keeps at
  least one browser test that drives it end to end. When in doubt, keep it
  in the browser. `docs/audits/e2e-unit-audit.md` records the moves made so
  far and the candidates kept on purpose
- do not waive a failing browser scenario as timing-sensitive until the
  user-visible invariant has been reproduced and the test has been proven to
  wait on the correct route or rendered state

- do not stop at truthy checks or existence checks for implemented behavior
- assert the concrete output shape and values that the slice owns
- include at least one negative test for each non-trivial slice so blocked or
  rejected behavior is covered explicitly
- bank import parser changes must use sanitized near-real fixtures for each
  affected supported format. Keep structural details that commonly break
  imports: preamble lines, multiline quoted descriptions, quoted comma amounts,
  dual date columns, section boundaries, and footer rows. Minimal synthetic
  snippets can cover narrow edge cases, but they are not enough as the only
  contract for a production importer.
- parser contracts for bank/deposit activity exports with dual date columns must
  assert which date becomes the statement/checkpoint date and where the other
  date is preserved. For bank balances, value/cleared/posted date is the
  reconciliation date; transaction date remains event-date context.
- PDF statement parser changes must assert that legal disclosures, transaction
  code legends, page headers, and footers cannot be swallowed into transaction
  descriptions. Near-real fixtures should include at least one page boundary or
  non-transaction section for statement formats that print them.
- PDF statement fixtures are extracted text, not PDFs: keep them in
  `tests/fixtures/pdf-statement-text/` in the `extractPdfText()` shape (raw items,
  `__PDF_LAYOUT_TEXT__`, `__PDF_SPACED_LAYOUT_TEXT__`) so routing in
  `parseStatementText()` sees all three views. Assert every parsed row, the
  checkpoints, and at least one rejected tampered variant. Prefer text
  extracted from a real statement with the shipped pdf.js version and masked
  item by item (`*-real-sanitized.pdf-text.txt`); hand-built layouts missed
  real Citi and OCBC card structure. pdf.js stays on 4.x because the parsers
  read its per-word text items (`tests/pdfjs-version-contract.test.mjs`).
- One-off data repairs and schema maintenance must not run from hot read helpers
  such as reference-data, account-list, summary, entries, or settings reads.
  Put repairs behind explicit initialization and persist a completion marker so
  new Worker isolates can skip expensive scans.
- import flow tests for statement-plus-mid-cycle scenarios must include the
  sequence both ways when supported by the source: current activity before the
  statement, and current activity after a statement has already certified the
  month. The latter must prove a later import cannot reopen or break a matched
  statement checkpoint.

## Code Shape Rules

These are defaults, not excuses for clever golfing.

- target `80-120` characters per line
- target `20-50` lines per function
- split earlier if one function mixes orchestration, shaping, and rendering
- keep one main responsibility per file when practical
- prefer one exported slice entry point over many wide helpers
- keep public APIs small and intention-revealing
- target `200-500` lines per handwritten module
- treat `800+` line handwritten modules as mandatory extraction work, not a
  normal steady-state shape
- if `App.jsx`, `app-shell.ts`, or a page module grows large during migration,
  move page logic into slice deep modules instead of letting the file keep
  accumulating responsibilities
- `src/domain/app-shell.ts` is for shell orchestration and shell-shared DTO
  builders; keep route-page fragments out of that layer. Page projections
  live in `month-projection.ts`, `summary-projection.ts`,
  `splits-projection.ts` and `donut-chart-projection.ts` (H15e)
- persistence writes live in focused modules below the
  `app-repository.ts` re-export hub (H15): `app-repository-schema.ts`
  (runtime schema), `app-repository-seed.ts` (demo and empty-state seed),
  `app-repository-showcase-seed.ts` (the public demo's showcase dataset from
  `demo-showcase-data.ts`, written in one batch with its settings and month
  refresh markers),
  `app-repository-entry-commands.ts`, `app-repository-month-commands.ts`,
  `app-repository-import-commit.ts` (commit and rollback) and
  `app-repository-snapshots.ts` (monthly snapshot recalculation, refresh
  markers and repair, used by all of them). New code imports the specific
  module, never the hub, and a command module never imports another command
  module. Command writes follow the Persistence Atomicity Contract
- move persistence code with `scripts/persisted-state-snapshot.mjs`: its
  normalized table and page-DTO dump must be identical before and after
- entry, month and statement dates are plain `YYYY-MM-DD` calendar dates,
  never instants; do not convert them through UTC. "Today" and the current
  month come from the household calendar in `src/lib/app-calendar.ts`
  (Singapore), shared by the client (`src/client/app-dates.js`) and the
  Worker (`getCurrentMonthKey` in `src/lib/month.ts`), read at call time.
  Never cut a date out of `toISOString()`/`toJSON()`: that is the UTC day,
  wrong before 8 am, and the Worker runs in UTC; `tests/app-dates.test.mjs`
  fails on that pattern in client code. Calendar arithmetic on
  `T00:00:00Z` dates (`addDaysToIsoDate`) stays in UTC
- a component that updates the URL's query with a functional setter
  (`setSearchParams((current) => next)`) uses `useLiveSearchParams`
  (`src/client/use-live-search-params.js`), as `App.jsx` and Entries do:
  `current` is the URL as it is now, not react-router's last-render params.
  The URL changes at once but the page re-renders a moment later, so a
  second quick tap (a scope right after Reset filters) built on the stale
  params and brought cleared filters back
  (`tests/e2e/mobile-chrome.spec.js`, "a scope tapped straight after Reset
  filters")
- if several route modules repeat the same route-context or month-selection
  logic, extract that logic into `src/domain/route-context.ts` or another
  shared route fragment before the duplication spreads
- `src/domain/route-context.ts` is only for shared route interpretation and
  context resolution; do not park formatting helpers, UI labels, parsing
  helpers, or React-only logic there
- `src/domain/page-labels.ts` is label-only
- if logic belongs primarily to one route, keep it in that route module
- cross-route financial business rules belong in dedicated domain modules, not
  in `route-context.ts`
- keep `route-context.ts` focused on route interpretation and context resolution,
  not authorization, reconciliation, split calculations, account visibility, or
  budgeting logic

Good function split:

- `buildEntriesPageQueryOptions`
- `selectEntriesTotalsStrip`
- `saveEntryAndInvalidate`

Bad function split:

- giant one-file page helper with fetch, normalize, totals, filters, and UI
  branching mixed together

Refactor rule:

- old compatibility code and new replacement code should not both remain once
  the replacement passes the slice tests
- large legacy files are migration targets, not permission to keep adding more
  responsibilities to the same file
- split the file by slice boundary first, then by helper depth inside the slice

## Remaining Large Modules

These handwritten modules are still over the 800-line guideline after the
macro performance work. Each has one owner and a reason; splitting them is
future work, not a claim that the complexity is gone.

| Module | Lines | Owner | Why it is still large |
| --- | ---: | --- | --- |
| `src/client/App.jsx` | ≈3,150 | App shell | Route orchestration, mutation refresh plans and cross-route invalidation still meet here; state owners (H12) and chrome (H11) have moved out |
| `src/index.ts` | ≈2,300 | Worker | One flat route chain with request validation per endpoint; only the AI routes are extracted (H13) |
| `src/client/imports-panel.jsx`, `import-preview-review.jsx` | ≈2,050 / ≈1,400 | Imports | Browser-only intake, preview review and commit flow share draft state |
| `src/domain/app-repository-import-preview.ts`, `-import-commit.ts` | ≈1,970 / ≈1,900 | Imports | Statement reconciliation, certification and rollback restoration are one tightly coupled algorithm |
| `src/client/month-panel.jsx`, `entries-panel.jsx`, `splits-panel.jsx`, `settings-panel.jsx`, `settings-sections.jsx` | ≈1,200–1,800 | Each route | Route panels with their editors; drafts and workflow locks are panel state |
| `src/domain/app-repository-splits.ts` | ≈1,580 | Splits | Split expenses, settlements, checkpoints and matches share validation |
| `src/domain/app-repository-entry-commands.ts` | ≈1,170 | Entries | Five edit paths share bank-fact locks and split sync |
| `src/domain/demo-data.ts`, `src/types/dto.ts`, `src/client/copy/en-SG.js` | ≈1,480 / 900 / 940 | Fixtures, DTO types, copy | Data and declarations, not logic |

## Comment Rules

Comments are required when the code hides one of these:

- business rule
- persistence contract
- cache invalidation reason
- workflow lock reason
- non-obvious fallback behavior

Comment rules:

- explain why, not the obvious what
- keep comments short and local
- add a short contract comment above dense selectors or mutation orchestration
- do not narrate every line

## Refactor Cutover Rule

When a slice migrates to a new query, route, or workflow boundary:

- the new path should replace the old path in the same change whenever
  possible
- if the old path must exist temporarily, it must be deleted before the slice
  is declared complete
- do not leave hidden compatibility branches behind for future slices to
  discover later

## Documentation Output Rule

When implementing a non-trivial change, update only the narrowest docs needed:

- vocabulary change: `DOMAIN.md`
- global repo rule: `AGENTS.md`
- architecture or migration change: `docs/architecture.md`
- behavior change: `docs/scenario-catalog.md`
- query or invalidation change: `docs/query-map.md`
- current-product lesson to preserve: `docs/existing-behavior-guardrails.md`
- code-shape or implementation rule change: this file

Keep docs compact. Prefer one sharp update to one right file over repeating the
same rule in five places.
