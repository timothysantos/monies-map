# Project Working Rules

This document captures the default engineering expectations for this repository.
It is a living document and should be updated as the product, architecture, and
team conventions evolve.

## Living guidance

- Keep this file updated as the app progresses.
- Treat this file as the primary always-read repository instruction file for
  Codex. Any rule that must be followed on every prompt belongs here or must be
  linked clearly from here.
- Treat `CLAUDE.md` as the equivalent always-read file for Claude if that file
  is added later. Do not assume `docs/architecture.md` is loaded automatically
  by coding agents.
- Keep [`DOMAIN.md`](/Users/tim/22m/ai-projects/monies_map/DOMAIN.md)
  updated alongside domain-model and naming changes.
- Keep [`design.md`](/Users/tim/22m/ai-projects/monies_map/design.md)
  updated alongside meaningful client-side boundary and helper-service changes.
- Keep [`docs/architecture.md`](/Users/tim/22m/ai-projects/monies_map/docs/architecture.md)
  updated alongside meaningful product and technical changes.
- Keep [`docs/code-spec.md`](/Users/tim/22m/ai-projects/monies_map/docs/code-spec.md)
  updated alongside meaningful implementation-shape, query-budget, and
  code-readability rule changes.
- Keep [`docs/implementation-order.md`](/Users/tim/22m/ai-projects/monies_map/docs/implementation-order.md)
  updated alongside meaningful refactor sequencing and slice migration order
  changes.
- Keep [`docs/preimplementation-checklist.md`](/Users/tim/22m/ai-projects/monies_map/docs/preimplementation-checklist.md)
  updated alongside the reusable pre-change audit checklist and its stop
  conditions.
- Keep [`docs/known-coupling-targets.md`](/Users/tim/22m/ai-projects/monies_map/docs/known-coupling-targets.md)
  updated alongside audit findings that should turn into explicit tests or
  contract checks.
- Keep [`docs/implementation-prompt-template.md`](/Users/tim/22m/ai-projects/monies_map/docs/implementation-prompt-template.md)
  updated alongside prompt-shape guidance for slice work and bug fixes.
- Keep [`docs/refactor-decisions.md`](/Users/tim/22m/ai-projects/monies_map/docs/refactor-decisions.md)
  updated alongside decisions about shell shape, shared helpers, mobile
  workflow boundaries, money editing, bootstrap migration, and invalidation.
- Keep [`docs/README.md`](/Users/tim/22m/ai-projects/monies_map/docs/README.md)
  updated as the docs index when a doc is added, moved, or archived.
- Archived prompts in [`docs/archive/`](/Users/tim/22m/ai-projects/monies_map/docs/archive/)
  are historical records of finished slices and no longer need updating.
  Start new prompts from `docs/implementation-prompt-template.md`. Archived
  slice prompts:
  [first](/Users/tim/22m/ai-projects/monies_map/docs/archive/first-slice-prompt.md),
  [second](/Users/tim/22m/ai-projects/monies_map/docs/archive/second-slice-prompt.md),
  [third](/Users/tim/22m/ai-projects/monies_map/docs/archive/third-slice-prompt.md),
  [fourth](/Users/tim/22m/ai-projects/monies_map/docs/archive/fourth-slice-prompt.md),
  [fifth](/Users/tim/22m/ai-projects/monies_map/docs/archive/fifth-slice-prompt.md),
  [sixth](/Users/tim/22m/ai-projects/monies_map/docs/archive/sixth-slice-prompt.md),
  [seventh](/Users/tim/22m/ai-projects/monies_map/docs/archive/seventh-slice-prompt.md),
  [eighth](/Users/tim/22m/ai-projects/monies_map/docs/archive/eighth-slice-prompt.md),
  [ninth](/Users/tim/22m/ai-projects/monies_map/docs/archive/ninth-slice-prompt.md),
  [tenth](/Users/tim/22m/ai-projects/monies_map/docs/archive/tenth-slice-prompt.md),
  [eleventh](/Users/tim/22m/ai-projects/monies_map/docs/archive/eleventh-slice-prompt.md),
  [twelfth](/Users/tim/22m/ai-projects/monies_map/docs/archive/twelfth-slice-prompt.md),
  [thirteenth](/Users/tim/22m/ai-projects/monies_map/docs/archive/thirteenth-slice-prompt.md),
  [fourteenth](/Users/tim/22m/ai-projects/monies_map/docs/archive/fourteenth-slice-prompt.md),
  [fifteenth](/Users/tim/22m/ai-projects/monies_map/docs/archive/fifteenth-slice-prompt.md),
  [sixteenth](/Users/tim/22m/ai-projects/monies_map/docs/archive/sixteenth-slice-prompt.md),
  and the
  [Stage 4 closure audit](/Users/tim/22m/ai-projects/monies_map/docs/archive/stage4-closure-audit-documentation-alignment-prompt.md).
- Keep [`docs/stage4-flow-index.md`](/Users/tim/22m/ai-projects/monies_map/docs/stage4-flow-index.md)
  and the page flow docs under `docs/flows/` aligned with the current route,
  state, and data contracts.
- Keep [`docs/stage4-close-checklist.md`](/Users/tim/22m/ai-projects/monies_map/docs/stage4-close-checklist.md)
  updated alongside the Stage 4 closure criteria.
- Refactor work should be committed in small readable batches as it proceeds.
  Use that practice for the first slice and keep it for later slices unless a
  slice is explicitly being held back for one atomic change.
- Finish each slice with a closure audit so the implementation, tests, and docs
  agree before the slice is considered complete.
- Never mark a slice complete unless the slice contract is proven by tests and
  runtime behavior.
- Keep the in-app guides updated alongside user-facing and setup changes:
  [`docs/user-guide.md`](/Users/tim/22m/ai-projects/monies_map/docs/user-guide.md)
  for how to use the app (plain language, no developer terms) and
  [`docs/developer-guide.md`](/Users/tim/22m/ai-projects/monies_map/docs/developer-guide.md)
  for setup, testing, deploy and internals. They render as the FAQ page's two
  tabs. Regenerate the screenshots a change affects with
  `npm run docs:screenshots` (demo data only, isolated ports);
  `tests/guide-content.test.mjs` checks every link, anchor and image.
- When implementation and documentation diverge, update the documentation in the
  same change whenever practical.

## Engineering posture

- Use systems thinking. Model the household finance domain carefully before
  adding UI or persistence shortcuts.
- Prefer ubiquitous language over local jargon. If a term is important enough
  to appear in routes, DTOs, tables, UI labels, or tests, it should have one
  canonical name in `DOMAIN.md`.
- Prefer vertical slices over horizontal utility sprawl. Build and refactor by
  end-to-end workflows such as imports, entries, months, splits, and settings.
- Build domain-first. Model business behavior in types and domain services
  before UI, and keep distinct semantics distinct when they represent different
  realities.
- Treat projections as first-class. When one underlying reality needs multiple
  views, keep operational, summary, review, compact, and audit-compatible
  projections synchronized and tested together.
- Practice TDD by scenario. Start each meaningful behavior change with a test or
  test update that describes the user-visible workflow before implementation
  details.
- Use runtime proof for user-facing behavior. Prefer real browser or real local
  worker verification over source inspection when the behavior is visible to a
  user.
- Never use browser system alerts, confirms, or prompts for app UX. Replace
  them with in-app dialogs, inline banners, or other app-native feedback that
  matches the surrounding desktop and mobile experience.
- Use `npm run test:e2e:smoke` as the standard smoke-bundle command when you
  need to verify the core desktop and mobile workflows together.
- Several sessions and agents work in parallel worktrees. Before pushing,
  `git fetch origin` and make sure your branch contains the current
  `origin/master` (rebase or merge first, then rerun the gates); never
  force-push `master`. Deploy only the exact pushed `origin/master` commit
  from a clean tree: a deploy from a branch or a stale master silently rolls
  back what the last deploy shipped. `npm run deploy:*` enforces this
  (`scripts/check-deploy-source.mjs`); override with
  `ALLOW_DEPLOY_FROM_BRANCH=1` only in an emergency, and say why.
- Run broad local suites sequentially: do not overlap `verify`, the full unit
  suite, full browser suite, or performance measurements on the same machine.
  Start with focused tests, reuse an unchanged build with `--skip-build`, then
  run the final gates once the coherent change is ready.
- Use `npm run verify` as the local merge gate. It must pass strict TypeScript,
  unit and parser contracts, the production build, and the smoke bundle.
- CI (`.github/workflows/verify.yml`) runs on pull requests, on pushes to
  `ci/**` branches and by hand, not on every push to master (owner decision,
  2026-10-28: the free 2,000 minutes ran out and jobs stopped starting).
  `npm run verify` locally stays the merge gate. Its `verify` job passes only
  when the static, unit and full browser jobs all pass. `git push origin
  HEAD:ci/<name>` runs it on a branch.
- Keep `npm run lint` (correctness-only ESLint) and `npm run typecheck:client`
  (checkJs over `src/client`) at zero errors; both run in `verify`.
- Run `npm run test:e2e` before merging a large refactor branch or a change that
  affects shared route, settings, import, entry, month, or split orchestration.
  `npm run test:e2e:sharded` is the faster equivalent (isolated parallel stacks
  on their own ports and D1); browser tests must not depend on another spec
  file or on run order (`docs/audits/e2e-sharding.md`).
- Prove persistence or projection refactors with
  `node --experimental-sqlite --no-warnings scripts/persisted-state-snapshot.mjs <out.json>`:
  the normalized table and page-DTO dump must be identical before and after.
- Measure loading changes with `npm run test:performance` (built client) and
  compare cohorts with `scripts/compare-performance.mjs`; never claim a speed
  change from a single noisy run.
- Do not write shallow tests for implemented behavior. For any non-trivial
  slice, assert the concrete output shape and values, and include at least one
  negative test that proves the guarded or rejected path.
- Import parser changes must include near-real fixture coverage for every bank
  format they touch. Preserve real-world structure such as statement preambles,
  multiline descriptions, quoted comma amounts, dual date columns, and footer
  rows, with private account/person details sanitized. Synthetic one-line CSV
  or PDF snippets are only acceptable as narrow supplemental tests, not as the
  only regression proof for a supported import format.
- Prefer deep modules with small public surfaces and hidden internals over wide,
  shallow helper graphs.
- Prefer explicit domain boundaries between storage, transformation logic, DTOs,
  and UI presentation.
- Keep route orchestration thin. Page components should coordinate, not contain
  the whole system; extract helpers and view-models when a page starts carrying
  too many responsibilities.
- Build for change. Banks, import formats, categories, splits, and dashboard
  views will evolve over time.
- Optimize for maintainability over short-term convenience.

## Loading and data guardrails

These keep the measured loading, payload and reliability gains from drifting.
Details and the reasons are in `docs/code-spec.md` and
`docs/audits/macro-loading-baseline.md`.

- Load the active screen first. Optional work (route code warmup and
  speculative data) starts only when `routeWork.usable` is true and goes
  through the warmup scheduler (`src/client/use-route-warmup.js`). Never add
  idle prefetch effects or eager imports of other routes to `App.jsx`.
- Route-only code stays out of the first screen: copy lives in
  `copy/en-SG-<route>.js` (`en-SG.js` holds only what every page shows) and
  the route warmup engine is the lazy `route-warmup-engine.js`, which
  imports no React and no first-screen module (its inputs are handed in by
  `use-route-warmup.js`). `tests/first-screen-structure.test.mjs` fails with
  the importing file when one slips back in.
- The page must never stay empty. `index.html`'s boot guard (one reload for a
  script that fails to load, otherwise a card with Reload app) covers a start
  that fails; code that runs at import or outside the error boundary reads
  device storage only through `deviceStorage()`
  (`src/client/device-storage.js`), never as a bare `localStorage` default
  parameter (`tests/boot-guard.test.mjs`).
- Keep the first screen within budget. `npm run check:bundle` (part of
  `npm run verify`) fails when the entry chunk plus the Summary route, or
  the built (minified) `styles.css`, grows more than 5% past
  `scripts/initial-bundle-budget.json`, or when a Money
  insights copy pool is in a first-screen file. New code for other screens
  belongs behind a lazy route or a dynamic import.
- A page API sends only what its screen reads: no second copy of a list and
  no other route's DTO. `tests/e2e/api-performance.spec.js` fails when a page
  response grows more than 10% past `tests/e2e/api-payload-budget.json`.
- Raise either budget only for a deliberate, measured reason
  (`node scripts/check-initial-bundle.mjs --update`,
  `UPDATE_API_PAYLOAD_BUDGET=1`), and say why in the commit.
- Server data has one owner per kind (`reference-data-owner.js`,
  `summary-owner.js`, `route-data-owner.js`, `app-shell-owner.js`,
  `entries-data-owner.js`). Write through the owner so a superseded
  response can never overwrite newer data or raise an error screen; do not
  add a parallel `useState` copy of server data in `App.jsx`.
- Run a refresh after a save through `runBackgroundRefresh`
  (`use-refresh-notice.js`), never `.catch(() => null)`: a failure keeps the
  saved data and shows the retryable refresh notice, and a superseded or
  aborted one stays silent.
- Required reads go through `fetchQueryWithLease`, and speculative reads
  through `startSpeculativeQuery` (`src/client/query-leases.js`), so a
  navigation joins warm data instead of repeating or breaking it.
- Mobile speculative data needs a measured row in
  `src/client/route-warmup-admissions.js` (gzip bytes and handler p95 on the
  10k fixture, `tests/performance/api-admission.spec.js`). Unmeasured means
  not preloaded. It also needs a reported 4g connection, or an unknown one
  (iPhone) with a measured recent required request of at most 500 ms.
- Persistence writes live in the focused `app-repository-*` command modules
  and page projections in `*-projection.ts`. New code imports the specific
  module, never the `app-repository.ts` hub, and command modules never import
  each other.
- Persistence commands are all-or-nothing: read and check first, then
  commit all their writes, audit event and month refresh markers in one
  `db.batch()`, and refresh month totals after it with
  `refreshMonthlySnapshotsAfterWrite`. New or changed commands must not write
  with sequential `.run()` calls, and must be proved by a `failingStatement`
  test in `tests/atomic-writes-*.test.mjs`. Details and the modules not yet
  converted: "Persistence Atomicity Contract" in `docs/code-spec.md`.
- Keep `Server-Timing` as `app, init, total` with `app` first; budget checks
  read the first `dur`.
- A cold isolate must stay at a few dozen D1 round trips: cold-path code
  (`ensureDemoSchema`, seeders) reads once and batches only what is missing,
  never one statement per default row. A page read never pulls a whole table
  into the Worker to aggregate it (group in SQL, bound by date window or
  `LIMIT`). `tests/cold-start-statement-budget.test.mjs` and
  `tests/page-load-scale-guard.test.mjs` enforce it (`docs/code-spec.md`,
  "Cold Start And Page Read Budgets").
- Production waits a network trip (~100 ms or more) for every D1 read made
  after another, so send independent reads together (`Promise.all`; a
  read that needs another's result only to finish takes a promise) and
  keep a page read to three sequential steps; read several months in one
  range read, never one per month. The scale guard pins each page's chain
  and the cold isolate's; measure with `scripts/measure-page-reads.mjs` and
  prove a read change with `scripts/page-dto-dump.mjs`
  (`docs/audits/speed-pass-2026-10.md`).
- Work in three passes: tests first, then runtime and failure behaviour in a
  real browser or Worker, then review and gates. A bug-fix test must fail on
  the old code before the fix counts.

## AI in Ask: AI understands, the app validates, rules are the offline backup

- Ask (owner decision, 2026-10-13) reads every message through one turn
  route, `POST /api/ask/turn` (`src/server/ask-turn-route.ts`): the model
  gets the bounded recent conversation, a compact context and the action
  schema (`src/domain/ask-turn.ts`) and answers with exactly one action
  (draft an entry, change the card, add an entry to Splits, a shared
  expense, a settle-up payment, a plan change, a money question, a search,
  open a page, ask back, or cannot help). The server checks that action
  against the household's real data (people, wallets, categories, groups,
  plan lines, the entry in focus, amounts the person wrote, shares: one
  stated share is enough and the other person has the rest, two add up to
  100%); anything that does not check out becomes a question back
  with at most 4 chips, never a guess.
- Changes to saved data (Phase 2, `src/domain/ask-turn-actions.ts`) are
  change cards: every row that changes before and after, saved only
  through `ASK_CHANGE_PATHS` (existing commands; the page refuses any
  other path), with Undo where the command supports it. A bulk change
  re-reads its rows on the server, lists the count and first rows, needs
  the person's "Yes, change all N" over 10 and is refused over 200. A
  statement-certified entry keeps its bank facts. Never from Ask: deleting
  entries, months or imports, importing or undoing an import, reconciling,
  accounts and people; the model can only name them (`blocked`), and Ask
  opens their page with the reason. A new Ask change needs its validator
  negatives, a route test that saves it through its command, and a
  `failingStatement` test for any command it changes.
- The model reports intent; the server derives (owner decision, 2026-10-14;
  `docs/flows/ask-flow.md`, "Three principles"). The model-facing schema
  carries only what the person said, as they said it (a name as written, a
  month or day as a word, an amount without units, a share as stated); it is
  never asked for a computed number. Matching names, reading days, months and
  amounts, remainder shares, % versus $, defaults from the entry in focus and
  this month are the server's (`ask-turn-names.ts`, `ask-turn-shares.ts`).
  Never add a model-supplied figure the server could work out.
- Draft with the assumption showing; ask only when two readings would save or
  answer differently (`decideReadings`, `ask-ambiguity.ts`). A reply carries
  `assumptions` (plain words and up to 3 chips). A needless question is a bug.
- Repair before asking: a refusal the model can fix gets exactly one repair
  turn with the validator's machine-readable errors and valid options
  (`ask-turn-repair.ts`), counted against the allowance, with only
  `{action, validatorError, field, repaired}` logged, never message text. Only
  then does the person get the question with chips.
- Every new Ask action adds messages to the eval bank
  (`tests/fixtures/ask-eval-utterances.json`: its happy path, a typo or
  shorthand, a partial message, one that must be asked back), proved by
  `tests/ask-eval-bank.test.mjs`. `npm run eval:ask` runs the bank against the
  real model (manual, cap-aware, not in CI).
- Hands-off for safe things (owner decision, 2026-10-14, "Fully hands-off
  for safe things"; `docs/flows/ask-flow.md` "Hands-off"). The model still
  never writes. Ask itself may apply only the safe set without a Save tap:
  set a new entry's category to the habitual one, add a note the person
  explicitly asked for, add a new entry to Splits with the habitual split.
  Only when ALL hold: Settings' "Let Ask handle safe things" is on (default
  on), the entry is new (created in the last hour, by Apple Pay or a manual
  add; a hand-made entry's own category is never replaced), not imported and
  not statement-certified, one entry, and (for category and split) a
  high-confidence habit (3 or more consistent confirmations since its last
  override; `src/domain/ask-habits.ts`, `autoApplyRefusal`). Each runs
  through the existing command, is written to the "Done for you" log (an
  `ask_auto` audit event; last 30 days in Ask) and has an Undo that uses the
  existing commands and counts as an override. If the log row cannot be
  written the change is reversed. Everything else never applies by itself:
  settle-ups, bulk edits, deletes, transfer links, plan changes, anything on
  a certified or imported or old entry, amounts, dates, wallets, owners.
  Those still need the person's Save.
- Usually shared (owner decision, 2026-11-10; DOMAIN.md "Usually Shared"):
  Splits' "Usually shared, not on Splits yet" list and Ask's "add the usual
  shared ones to Splits" are a sweep over the SAME single-entry rule
  (`suggestSplitForEntry`); never give the sweep a policy of its own. Never
  automatic: the person ticks and taps Add (more than 10 asks "Yes, add all
  N", at most 200), through `POST /api/splits/expenses/add-usual`, one
  all-or-nothing batch with an audit event, with Undo; no AI chooses what is
  on the list.
- Habits are structured facts, never chat text (`ask_habits`, DOMAIN.md "Ask
  Habit"): a shop's category, a shop's usual split, a confirmed nickname,
  each with a count of confirmations and overrides, learned only from
  commands the person ran (a category change, an Add to Splits, a new
  entry's category) and confirmed clarifications. No prompt, message, answer
  or file is stored. The table is additive and every reader tolerates it
  missing (the feature is then off). Settings "What Ask remembers" lists,
  edits and deletes them, and has Forget everything. Suggestions and
  auto-apply are deterministic: no AI call, no allowance.
- Lookups: within a turn the model may call read-only tools (`look_up`:
  find_entries, get_entry, get_split_balances, list_recent_entries,
  get_category_history; `src/domain/ask-lookup-tools.ts`). At most 4 model
  calls a turn (a repair counts) and a token cap (8,000 estimated), each call one allowance
  unit; household rows only; results compact, names through
  `promptEntryName`, no amount, balance figure or account number, shown to
  the model as untrusted data; the model may name as its target only an
  entry id a lookup in that turn returned. A new tool needs its household
  scope test, its caps test and bank messages.
- Apart from the safe set above, the model never writes. It only chooses the
  action; the page shows the
  existing draft or answer card, and nothing is saved without the
  person's Save tap, through the existing all-or-nothing command. Figures
  come from the app (the entry's amount, a share computed from it, the
  answer route's facts) or from what the person wrote; an amount the model
  names that the person never wrote is refused, and model prose with a
  number not in the conversation or context is replaced.
- The rules are the offline backup and stay tested: with AI off, over the
  allowance, failing or unusable, the turn route answers `mode: "rules"`
  and Ask reads the message with its rule readers as before, with a
  one-line note once per conversation. Every new Ask capability needs its
  action, its validator negatives and its no-AI behaviour.
- The turn's context carries names, never numbers: no account, card,
  phone or ID number (`scrubName`, `promptEntryName`), and no balance or
  amount from the household's records. One allowance unit per model call
  (a plain turn is one; lookups and a repair add one each, at most 4); keep
  a typical first prompt under 2k input tokens.

## Optional AI Assistance

- Treat AI as a separate, optional assistance layer, never as part of the
  finance engine or a required dependency for any core workflow. New AI
  calls go through the provider layer (`src/domain/ai-provider.ts`): Claude
  Haiku through Cloudflare AI Gateway when the owner has configured it,
  Workers AI (Gemma 4) directly otherwise and as its fallback. Claude is
  optional: with no gateway or key, Workers AI is used with no failed call
  and no log line.
- Core page loads, import parsing and preview, import commit, ledger writes,
  reconciliation, transfer matching, category application, freshness planning,
  and account prioritization must work identically when the AI binding or
  the gateway config is missing, disabled, rate-limited, over its spend
  limit, malformed, or unavailable.
- Default to explicit user actions for AI. Do not add scheduled, hidden or
  automatic inference. Within a conversation the user started, the chat may
  ask the user follow-up questions; it never starts a conversation itself.
- Claude traffic goes only through AI Gateway with logging and caching off
  (`cf-aig-collect-log: false`, `cf-aig-skip-cache: true` on every request)
  and a hard monthly gateway spend limit (about US$10); the app's own daily
  allowance applies on top.
- Money insights headlines use computed wording only: the bold fact and its
  think line exactly as written, with no AI rewording and no wording request
  from any page. The old `/api/ai-assist/financial-insight` route is removed
  (it produced broken grammar in production); do not bring it back.
- Keep deterministic data and existing review controls authoritative. AI may
  phrase, rank, or propose a draft, but must not certify, import, categorize,
  skip, merge, delete, or link finance records by itself. AI only drafts and
  never writes: nothing is saved without the user's tap (the one exception
  is Ask's listed safe set, applied by the app's deterministic rules, gated
  and logged with Undo; see "AI in Ask"), and the numbers
  shown come from the app's own validation, not from model prose.
- Reminders in Ask (`GET /api/reminders`, DOMAIN.md "Reminder") are fixed rules
  over the household's own data with fixed wording: no AI, no write, no
  scheduled or pushed message. Later and Got it live on the device
  (`monies.reminders.v1`), never the server. Their code is lazy with Ask; the
  Ask tab's dot is the only first-screen part and makes no request of its own
  (`docs/audits/reminders.md`, "The dot"). Rule changes need their adversarial
  negatives in `tests/reminders-rules.test.mjs`.
- Money insights and the charts are a deterministic, read-only projection
  and never come from AI. They may show recorded cash flow, plan variance,
  a same-season comparison that is already loaded, explicit bank-proof
  gaps, and the pace (owner decision, 2026-11-10; DOMAIN.md "Pace"): where
  this month's spending, and what is left of what comes in, end up if the
  month keeps going as it has, and (Summary only) what is kept by year end.
  A pace is always a range, low to high, rounded outward, labelled "If this
  keeps up", and drawn dotted or hatched in the plan (sky) tone, never a
  new hue. It is built only from recorded entries: everyday spending at its
  pace this month and its usual pace, repeating charges and regular income
  still due on their usual days at their recorded amounts, and one-offs
  counted once, never scaled. It is quiet in the first 5 days of a month,
  with fewer than 3 complete months of history, and while imports are
  behind. A pace is never a safe-to-spend figure, an account balance, a
  savings target or a View entries figure, and its words never reassure
  ("safe", "can afford", "you'll be fine"). Subscriptions and bills'
  Coming up may total its next 30 days under the same rule.
- Besides the pace, the one look ahead Money insights may make is the
  `scheduled check` (DOMAIN.md): a bank account's latest recorded balance (a statement no
  older than 40 days, plus what is recorded since) against payments that
  have left that same account at the same amount for 2 or more months in a
  row and are due within 31 days. It names the statement date and the
  payments, stays silent when the balance is older or the pattern breaks,
  and is only ever a To do that warns, never a line that reassures.
- Never send credentials, Shortcut tokens, original bank files, raw statement
  PDF binaries, full account/card numbers, or unbounded notes to AI. For a
  statement fallback, require explicit consent and send only bounded,
  redacted browser-extracted text after local parsers and in-browser OCR fail.
- A locked statement's password (DOMAIN.md "Locked Statement",
  `docs/audits/locked-statements.md`) is typed on the device and lives in
  memory only, for one file's read (`pdf-unlock.js`): never sent in any
  request, stored (storage, URL, IndexedDB), put in React state, a query key,
  a log line, an error message or an error report (`memory-secrets.js`
  redacts it), and never given to AI. A locked file stops at the first read,
  so it cannot reach OCR or the statement fallback undecrypted. Do not add
  logging around the unlock path.
- The one image exception: a receipt image, or one rendered page of a PDF
  receipt, that the user explicitly pastes, drops, scans or shares may be
  sent to the AI provider. The browser downscales it (at most 1.5 MiB) and
  strips EXIF and location first; the Worker accepts only JPEG, PNG or
  WebP. The image is discarded after reading: never stored, logged or
  cached. When AI is unavailable, read it with in-browser OCR instead.
- Constrain and validate every AI input and output. Persist only the minimum
  aggregate allowance state needed for cost control, never prompts, responses,
  images, files, or embeddings unless a separately reviewed design explicitly
  changes that rule.
- Read every `src/server` request body through `src/server/limited-body.ts`
  (`readJsonObject`, `readFormBody`): it counts bytes as they arrive, so a
  chunked upload with no Content-Length is cut off at the limit (413).
  `tests/ai-security-review-routes.test.mjs` fails on a bare
  `request.json()` or `request.formData()` there.
- Facts for an AI prompt carry no phone, account, card or ID number from a
  ledger description (`promptEntryName`), and an AI phrasing shows only if
  every sum in it is one of the facts' own (`validateAiWording`). The Worker
  refuses a cross-site browser write (`src/server/cross-site-guard.ts`); do
  not weaken it. Review: `docs/audits/ai-security-review.md`.
- Keep the configured AI allowance conservative enough for the intended free
  tier. Each AI slice must include no-AI/failure coverage proving the normal
  workflow remains usable, plus an audit note of its privacy, cost, and write
  boundaries.

## Code structure

- Prefer typed DTOs between layers instead of passing raw database rows straight
  into UI components.
- Organize new work by feature slice first, then by layer inside the slice when
  needed.
- Keep domain calculations in pure functions where possible.
- Separate import parsing, normalization, categorization, transfer matching, and
  dashboard aggregation concerns.
- Favor composable modules over large files with mixed responsibilities.
- Keep module APIs small. A caller should not need to understand a feature's
  internal helper graph to use it safely.
- Keep continuity as an invariant. Preserve state across rerender, route
  change, correction, and review flows where the workflow requires it.
- Treat corrections and review as serious system behavior. Support update,
  delete, merge, restore, undo, and reason capture where relevant, and make sure
  correction history propagates consistently across projections.

## Frontend guidance

- Do not add new visible controls, screens or user-facing copy without the
  owner's approval. When a fix changes how something looks or reads (layout,
  wording, a new state or button), list it with a before/after screenshot for
  the owner to decide instead of shipping it silently. Check the existing
  pattern first (for example the mobile floating "View and scope" bar) before
  proposing a new control.
- A screen that lists problems or answers offers the fix where it is when the
  app already has a dialog for it, and gives a way back wherever a fix is
  another page: "‹ Check my books" on the destination (design.md "Check
  origin", `return-to-check.js`), "‹ Entries" from Ask (design.md "Ask
  origin"). The link lives for that one hop only and never shows for people
  who did not come from the source screen.
- Every figure or money statement on a card is quietly openable (owner
  principle; design.md "Openable figures"). Give it `data-fig` and its
  period, never a button look: the text stays as it is, with a soft
  underline and chevron on hover or focus. Its menu offers only what
  applies: View entries, whose Entries total equals the figure to the cent
  (the figure's rule lives in `src/domain/money-figures.ts`; a new figure
  adds its rule there and its equality test to
  `tests/openable-figures.test.mjs`), Open plan for plan figures, Open
  Splits for split balances, and Ask about this. The menu stays in the lazy
  `figure-menu.js`; the first screen carries only the attributes.
- Every place a category is chosen opens the one category list (design.md
  "Category list": a search, the best guess first, then A to Z; `ResponsiveSelect`
  or `PickerRow` with `categoryPick`, `FilterMultiSelect` for a filter). Never
  add a native select of categories (`tests/category-list-guard.test.mjs`),
  and keep its code in the lazy chunks: the first screen carries none of it
  (Summary imports its blocks from `ui/lead-support-detail.jsx` and
  `ui/spend-lead-group.jsx`, never the `ui-components.jsx` barrel).
- Write user-facing copy in plain words. Say what happened to the
  person's money, then the number; never describe the app's own state
  ("in the app", "unlinked", "every chart"). An app term a line needs
  (Other, linking, settle up) is explained once in the same sentence.
  Money insights copy is linted for this (`findAppJargon`,
  `docs/money-insights-copy.md`, "Tone").
- Every visible name must be understandable to a non-technical person (think
  of a grandparent): no product-internal or designer words (studio, tables,
  bucket, mode, DTO), name controls by what they do or show, and check new
  labels against this before shipping. Plan Studio's copy is linted for it
  (`tests/plan-studio-copy-lint.test.mjs`). Names the owner retired
  (Overplanned, To allocate, Money jobs, Wallets in view, budget bucket,
  Planned items, "from its statement") live in `src/domain/retired-names.ts` and
  are rejected in every visible string, the Money insights copy and both
  guides (`tests/retired-names.test.mjs`, `tests/guide-content.test.mjs`);
  add a retired name there when a name is renamed.
- Colour is a calm 1970s print (an oat page, near-neutral cards, soft
  chocolate ink; the token
  names stay `--pastel-*`: mint is avocado, rose brick red, sky dusty teal,
  lavender faded plum, butter harvest gold): state and category surfaces
  use the pastel tokens in `:root` of `public/styles.css`; text on a pastel
  surface uses that hue's `-ink` token and meets WCAG AA
  (`tests/colour-contrast.test.mjs`). Category colours come from
  `src/domain/category-palette.ts`. Don't introduce saturated fills or new
  hex colours outside the tokens: write white surfaces as `--paper`, text
  on a strong fill as `--on-strong` and accent tints as
  `rgb(var(--accent-strong-rgb) / a)`, so every colour preset in both
  modes (`public/palettes/<id>-<light|dark>.css`, design.md "Colour
  presets") re-colours them. The page a route sits on is `--page`; a card
  on it is `--card` with `--card-border` and `--card-shadow`; a
  section eyebrow is `--eyebrow` and a plain chip `--chip`. A
  raw colour may only be a neutral shadow or scrim. Hand category, person
  or group colours to the page through `paletteColour`
  (`src/client/palette-colour.js`).
- A per-person or per-owner cue (an edge, chip, band or row wash) uses that
  person's colour from `src/client/person-colour.js` (`getPersonColour`,
  `getPersonColourVars`), the same colour as the Entries row edge. Never
  give people a new hue scheme; text on a person tint uses `--person-ink`.
- Money direction and outcome colours come only from the money tones
  (`src/domain/money-tone.ts`, rendered with `moneyToneClass`): money in is
  mint; money out in a list (an expense row, a negative day) is rose text;
  deficits, over plan and debts are rose; plans are sky; transfers keep the
  plain ink, and summary figures are rose only when over plan. Money colour
  is text-only in lists and tables, a soft tint on summary pills (never on
  the Splits orange), and full pastel only for attention banners; one
  strength per element, and hidden money shows no
  tone and no words that reveal its sign. `tests/money-colour-guard.test.mjs`
  enforces the colours.
- Keep rendering predictable and avoid state graphs that are easy to break.
- Prefer TanStack Query as the server-state boundary and keep query ownership
  close to the feature slice that consumes it.
- Avoid effect-driven derived state when selectors or pure calculations are
  enough.
- Be deliberate about rerenders. Expensive tables, charts, and filters should
  derive from stable inputs and memoized selectors.
- Prevent infinite loops by avoiding effect chains that update state derived
  from that same state.
- Avoid bootstrap payload growth. Fetch the smallest slice needed for the active
  screen and let summary, month, entries, imports, splits, and settings load
  independently.

## Domain guidance

- Treat [`DOMAIN.md`](/Users/tim/22m/ai-projects/monies_map/DOMAIN.md) as the
  canonical vocabulary for product and data-model terms.
- Cross-reference `DOMAIN.md` before introducing new entity names, and prefer
  extending existing terms over adding synonyms.
- Treat transactions, splits, imports, notes, and transfer links as first-class
  concepts.
- Keep import batches traceable so a bad import can be reviewed or removed
  without damaging other data.
- Model transfers explicitly instead of forcing them into income or expense
  semantics.
- Preserve enough structure so future AI analysis can reason over both ledger
  data and user-provided notes.

## Readability

- Write readable code first.
- Add concise comments where intent, business rules, or non-obvious tradeoffs
  would otherwise be hard to infer.
- Avoid comments that only restate the line below them.
- Prefer clear names over dense abstractions.
- Prefer user-friendly language in visible UI. Avoid internal jargon on the
  main surface and keep deeper interpretation in dedicated review surfaces.

## Documentation expectations

- Update this file when team conventions change.
- Keep agent-facing instructions short, prescriptive, and enforceable here in
  `AGENTS.md`.
- Update [`docs/architecture.md`](/Users/tim/22m/ai-projects/monies_map/docs/architecture.md)
  when product behavior, data flow, technical direction, or staged refactor
  plan changes.
- Update [`docs/code-spec.md`](/Users/tim/22m/ai-projects/monies_map/docs/code-spec.md)
  when code-shape rules, query budgets, invalidation contracts, or
  implementation-reading guidance changes.
- Update [`docs/implementation-order.md`](/Users/tim/22m/ai-projects/monies_map/docs/implementation-order.md)
  when the refactor execution order, per-slice migration strategy, or testing
  order changes.
- Update [`docs/preimplementation-checklist.md`](/Users/tim/22m/ai-projects/monies_map/docs/preimplementation-checklist.md)
  when the reusable audit checklist, hidden-coupling checks, or stop
  conditions change.
- Update [`docs/known-coupling-targets.md`](/Users/tim/22m/ai-projects/monies_map/docs/known-coupling-targets.md)
  when a refactor audit finds a user-visible coupling or contract risk that
  needs to stay on the test plan.
- Update [`docs/implementation-prompt-template.md`](/Users/tim/22m/ai-projects/monies_map/docs/implementation-prompt-template.md)
  when the recommended prompt shape or required doc list changes.
- Update [`docs/refactor-decisions.md`](/Users/tim/22m/ai-projects/monies_map/docs/refactor-decisions.md)
  when a decision about App shell shape, shared helpers, mobile workflow
  shape, money editing, bootstrap dependence, or invalidation changes.
- Do not update archived prompts or reports in `docs/archive/`; they are
  historical. Move a finished prompt there with `git mv` and fix its links.
- Update [`design.md`](/Users/tim/22m/ai-projects/monies_map/design.md) when
  implementation boundaries such as the client deep module service evolve.
- Update [`docs/user-guide.md`](/Users/tim/22m/ai-projects/monies_map/docs/user-guide.md)
  when user-facing behavior or feature scope changes, and
  [`docs/developer-guide.md`](/Users/tim/22m/ai-projects/monies_map/docs/developer-guide.md)
  when setup steps, testing, deploy or internals change.
- Add narrower docs under `docs/` when a subsystem grows beyond what belongs in
  the main architecture file.
