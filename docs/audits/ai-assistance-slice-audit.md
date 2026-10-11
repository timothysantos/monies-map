# Optional AI Assistance Slice Audit

Date: 2026-08-30

## Objective

Add a bounded, opt-in Workers AI assistance layer to the existing finance
workflow. It may explain and suggest. It must never become a source of
accounting truth, persistence authority, or a required dependency for normal
use.

## Non-Negotiable Contract

1. D1 ledger rows, statement checkpoints, deterministic parser output,
   category rules, reconciliation math, transfer matching, and Import Inbox
   planning remain authoritative.
2. Most AI actions are explicit and user initiated. Financial insight wording
   is the narrow exception: after a stable view/filter change, it may make one
   debounced request for a cache-missed set of already-computed facts. It renders
   deterministic wording first, uses an in-memory-only cache, and never blocks
   the page. There is no scheduled analysis, automatic categorization,
   automatic import, automatic duplicate suppression, or automatic ledger
   correction.
3. An AI failure, disabled binding, quota limit, capacity error, malformed
   response, or validation rejection returns an ordinary unavailable result.
   The same existing import, review, category, month, and freshness workflows
   remain usable.
4. AI output is always a draft, a suggestion, or a link to existing evidence.
   A user must use the normal review controls to commit any data change.
5. Original files are never stored. Fallback parsing sends extracted text only
   after the user explicitly opts in for that file. Browser-local PDF text
   extraction and HSBC OCR remain the first attempt.
6. AI receives no credentials, Shortcut tokens, full account or card numbers,
   or raw PDF binary. Prompt input is bounded and redacted before inference.
7. Model output is schema checked and reference checked. Unknown category IDs,
   unknown ledger IDs, invalid dates, invalid amounts, and unsupported field
   changes are rejected before they can reach a preview.

## Capability Boundaries

| Capability | Authoritative input | AI may return | Existing fallback | Write boundary |
| --- | --- | --- | --- | --- |
| Monthly narrative | committed monthly snapshot and selected, computed facts | short wording and fact references | existing Monthly Note editor | user saves the returned wording as a normal note |
| Financial insight and Money consequence map | current Summary, Month, Entries, or Splits figures and filters | short wording around app-supplied placeholders; the app itself renders a deterministic cash-flow, plan, season, and proof map plus a next-spend consideration | immediate deterministic insight and map | no write path |
| Statement fallback | browser-extracted text or local OCR text | provisional import rows with source evidence | dedicated parser, generic CSV mapping, local OCR | all rows start as `Needs review`; normal preview/commit remains required |
| Category rule proposals | existing categories plus bounded, already-categorized merchant history | suggested pattern/category pairs | current deterministic suggestions and manual rule editor | user accepts through the existing rule editor |
| Duplicate and transfer review | existing deterministic account/amount/date candidate set | ranked candidate references and explanation | current exact/probable/near matching and transfer review | never changes skip, merge, certification, or transfer links |
| Import explanation | existing reconciliation breakdown and diagnostic row IDs | plain-language explanation and focus IDs | existing statement mismatch panels and diagnostic actions | no write path |
| Import plan and freshness | existing Import Inbox DTO | no AI dependency in this slice | current grouped bank-login Import Inbox, exact owner/account/period labels, and oldest-first review order | no write path |

## Privacy And Retention

- The AI worker gets only the request payload required for the chosen action;
  the app does not persist prompts, model responses, or per-request AI logs.
- Fallback parsing is the only action that can include statement content. It
  sends extracted text, not the original file, and only for the file currently
  being reviewed after explicit consent.
- Merchant text may still be personal financial information. Inputs are capped,
  strip account/card-like numbers, and are not sent with notes unless a
  capability explicitly needs a bounded diagnostic note.
- The default model is a small text model. The slice does not add Vectorize,
  stored embeddings, AI Gateway logs, or a remote vision upload path.
- If the free Workers AI allowance is exhausted, the app says assistance is
  temporarily unavailable and presents the deterministic review surface.

## Free-Tier Guardrails

- The binding is guarded by `AI_ASSIST_ENABLED`; disabled is a normal state.
- Requests share a conservative D1 cap of 12 daily allowance units before
  inference. The cap is a product safeguard, not a promise about a provider's
  changing free-tier terms.
- Text prompts use a small instruction model with a maximum of 360 tokens;
  statement fallback is capped to 12,000 redacted characters, 700 tokens, and
  40 provisional rows. Matching uses the small embedding model only for an
  already bounded deterministic candidate set.
- Expensive vision inference is intentionally out of this slice. HSBC and other
  image-only PDFs stay on private in-browser OCR, then optionally use the
  bounded text fallback parser.
- The AI route does not run as part of initial page loads, previews, commits,
  freshness calculations, or reconciliation refreshes. Financial insight waits
  for a stable rendered view, debounces for 700ms, and uses a bounded,
  48-entry in-memory cache for 15 minutes (five minutes for unavailable
  results).

## Required Scenario Coverage

### Core availability

1. AI disabled: each endpoint returns `available: false`; existing workflows
   keep working and no database state changes.
2. Missing Worker binding, quota/capacity error, timeout, malformed JSON, and
   schema-invalid output each return an unavailable result without surfacing a
   server error to a normal workflow.
3. A daily capability cap is reached: the user receives a clear retry-later
   message and can continue using deterministic controls.

### Monthly narrative

4. The prompt contains committed figures and selected transaction facts only.
5. Returned fact references must belong to the current month and selected
   scope; unknown references are discarded.
6. The assistant cannot overwrite the Monthly Note. The user chooses whether
   to put the draft into the normal editor and save it.
7. Summary, Month, Entries, and Splits show deterministic financial guidance
   immediately when AI is off. A context/filter change updates that guidance
   without waiting for a request; the background wording request is deduplicated
   by computed-facts cache key.
8. Full-cash-flow insights distinguish a recorded surplus from money that is
   free to spend after future bills, transfers, and savings contributions.
   Filtered views and split obligations are explicitly not presented as a
   household savings calculation.
9. When computed evidence needs review, the app generates a bounded Review
   action to the existing filtered Entries or split-match workflow. The model
   cannot choose a target record or route.
10. A full-cash-flow map distinguishes a recorded surplus from free cash, shows
    the actual plan variance, includes a same-season lane only when the matching
    month is already loaded, and labels any repeat-expense result as a scenario
    rather than a forecast.
11. Summary and Month use explicit reconciliation, missing-checkpoint, and
    unresolved-transfer signals for confidence. Entries and Splits must say
    when their narrower payload cannot assess that confidence.

### Statement fallback

7. A known UOB, Citi, OCBC, or HSBC parser succeeds without contacting AI.
8. An unsupported text PDF offers the fallback only after explicit consent.
9. An image-only unknown PDF runs private OCR first; only OCR text is eligible
   for opt-in fallback.
10. Fallback rows have bounded evidence, valid dates and money, and all begin
    `Needs review`; no checkpoint is created automatically.
11. Invalid model rows cause a safe unavailable/review result, never a partial
    import. The original file remains only in browser memory.

### Rules and matching

12. Category suggestions use only active local categories; proposed categories
    outside that list are rejected.
13. Existing manual and rule-based suggestions remain visible if AI is off.
14. Duplicate/transfer suggestions are a subset of deterministic account,
    signed-amount, and date-window candidates; an embedding or LLM cannot
    nominate arbitrary cross-account rows.
15. AI suggestions never set commit status, reconciliation target,
    certification status, or transfer-link state.

### Diagnostics and freshness

16. The import explanation can reference only existing diagnostic rows and
    computed mismatch figures.
17. The Import Inbox remains the exact source of required files, ownership,
    account, institution, and period. AI may only phrase that plan.
18. A stale two-month household still shows the existing bank-login-session
    grouping when AI is unavailable.

## Out-of-Scope For This Slice

- Direct bank connections or credential handling.
- Raw PDF/image upload to an AI provider.
- Scheduled, hidden, or automatic inference other than the bounded,
  user-visible Financial insight wording refresh after a stable view/filter
  change.
- Persisted embeddings or semantic search indexes.
- Autonomous changes to the ledger, statement checkpoints, category rules,
  duplicate suppression, or transfer pairing.

## Closure Evidence

### Task Checklist

- [x] Keep deterministic imports, reconciliation, categorization, matching,
  and Import Inbox planning independent of AI.
- [x] Add bounded monthly wording, mismatch explanations, category-rule
  proposals, statement-text fallback, and advisory candidate ranking.
- [x] Keep supported bank parsers and private HSBC image OCR ahead of any AI
  fallback; never store original files.
- [x] Add a shared daily allowance guard, schema validation, prompt redaction,
  and explicit consent for statement-text fallback.
- [x] Add no-AI browser coverage and unit contracts for redaction, generated
  prose boundaries, semantic ranking bounds, and unconfigured Workers AI.
- [x] Add deterministic Financial insight surfaces to Summary, Month, Entries,
  and Splits. They update from loaded figures immediately; an abortable,
  debounced cache-miss request can improve wording without blocking the page.
  Full cash-flow, filtered investigation, and split-obligation views each use
  appropriate deterministic next-spend guidance.
- [x] Add evidence-backed Review actions for the largest visible expense,
  overspent category, and unresolved split bank matches. Targets are computed
  by the app and open existing review workflows; AI cannot create a target.
- [x] Add the deterministic Money consequence map: recorded surplus versus
  free cash, plan variance, loaded same-season evidence, explicit bank-proof
  confidence, and a non-predictive one-repeat scenario. Proof gaps open the
  existing Imports workflow; no AI result can alter the map or its route.
- [x] Fix the multi-account statement mapping refresh race found by the full
  browser suite: stale preview responses cannot replace the latest mappings.
- [x] Update agent guidance, architecture, design, domain vocabulary, FAQ, and
  this audit.

### Executed Verification

- `git diff --check`: passed.
- `npm run typecheck`: passed.
- `npm run test:unit`: passed, 223 tests, including the AI boundary contracts
  and HSBC local-OCR parser coverage.
- `npm run build`: passed.
- Focused browser coverage: Financial insight, Entries mobile sticky headers,
  and Splits mobile sticky headers passed. These checks prove that Review opens
  a record-specific filter and that the added insight surface does not weaken
  sticky date-group behavior.
- Focused browser regression: `multi-card statements reconcile while
  certifying growing midcycle rows`: passed after the stale-preview fix.
- `npm run test:e2e`: passed, 176 browser scenarios against
  `wrangler.test.jsonc`, which deliberately has no AI binding or enable flag.
- `npm run verify`: passed after the final Money consequence map additions: the
  dependency audit found 0 vulnerabilities, TypeScript passed, all 223 unit
  contracts passed, the production build passed, and the no-AI smoke workflows
  passed.

The remaining live-model behavior is intentionally not a release gate: the
same response-validation and unavailable paths are covered locally, while the
ordinary product workflow is proven in the no-AI configuration. Deployment
must preserve this fully working no-AI path.

### Update, 28 September 2026: Money consequence map retired

The owner found the Money consequence map confusing and a repeat of the
check-in signals, so it is gone from Summary, Month, Entries and Splits
(branch `insights-simplify`). The one-repeat scenario went with it, because
it bordered on a forecast. For the AI boundary:

- Privacy: the wording request's facts no longer carry the map's lanes, so
  less computed text leaves the browser. The Worker reads only the named
  fact fields; a tab still open on an older version that sends its map has
  the map dropped before the prompt is built
  (`tests/ai-assistance-routes.test.mjs`).
- Cost: unchanged. The prompt, the one debounced request per headline and
  the allowance are the same.
- Writes: unchanged. The map never wrote anything; its "Review bank-record
  gaps" link is replaced by the statement-gap Quick fix's own "Review
  statement", which opens the same Imports page.
- No-AI path: unchanged. The check-in renders its computed wording at once,
  and `tests/money-consequence-map-retired.test.mjs` fails if any part of
  the map comes back.

### Update, 11 October 2026: Money insights AI rewording removed

The optional rewording of the Money insights headline produced broken
grammar in production (a lead-in such as "after a recent Selected entries
in Aug 2026. A quick fix might be to …" around the fact). The owner chose
computed wording only, so the headline is always the bold fact and its
think line as written. Removed end to end: the client request, debounce and
in-memory cache in `financial-insight.jsx` (and the `canRequestWording`
plumbing from App and the four panels), the `/api/ai-assist/financial-insight`
route, its facts parser, template parser and prompt, and the
`financial_insight` allowance capability name (a type only; nothing stored
it, and the daily usage counter row is unchanged). For the AI boundary:

- Privacy: no Money insights text leaves the browser any more.
- Cost: the one debounced request per headline is gone, so the shared daily
  allowance serves only explicit user actions.
- Writes: unchanged; the rewording never wrote anything.
- No-AI path: now the only path. `tests/e2e/financial-insight.spec.js`
  fails if any page requests the removed route or the headline changes after
  the page is usable, and `tests/ai-assistance-routes.test.mjs` proves the
  Worker answers the old route with 404 without calling AI.

### Update, 11 October 2026: Ask voice input (transcribe route)

The Ask composer gained a mic (owner-approved): hold to talk or tap, the
words fill the message box, and the person checks and sends. The browser's
own speech recognition (`SpeechRecognition` / `webkitSpeechRecognition`,
which iPhone Safari has) is the primary path and sends nothing to the
Worker. Only a browser without one (or one that refuses its speech service
and can record) uses the new fallback route `/api/ai-assist/transcribe`
(`src/server/transcribe-route.ts`, capability `speech_transcribe`). For the
AI boundary:

- Trigger: explicit only. A clip is recorded and sent only on a hold or tap
  of the mic; the route's `GET` availability check runs on the first press,
  never on page open, and calls no AI.
- Privacy: one clip of at most 30 s (MediaRecorder, 32 kbit/s), sent once as
  multipart and discarded after the Whisper call. Neither the audio nor the
  words are stored, logged or cached (the route test fails on any console
  output). The words come back only to the browser that sent the clip; they
  enter the ledger only if the person sends them through the entry-draft
  reader and then saves the card.
- Validation before any AI call or allowance use: multipart only, an
  `audio` part of a known audio type whose bytes match it (WebM, Ogg, MP4,
  WAV sniffed), at most 1 MiB, a declared duration of at most 31 s, and an
  MP4's own `mvhd` duration under the same cap (400 / 413 / 415).
- Cost: 1 unit of the shared daily allowance per clip, reserved before
  inference (`reserveDailyAiBudget`, now exported for this route). Whisper
  large v3 turbo is priced per audio minute (about USD 0.0005), so a 30 s
  clip is far below a text prompt's cost; the unit cap keeps the deployment
  inside the same conservative allowance.
- Writes: only the existing allowance counter row (`ai_assist_daily_usage`).
  No table, no ledger write, no auto-send.
- Output: the `text` field only, whitespace collapsed and capped at 500
  characters; anything else (empty, malformed, a thrown error) is an
  ordinary `{ available: false, code: "failed" }`.
- No-AI path: with AI disabled or unconfigured the `GET` answers
  `{ available: false }` and the client hides the mic after one calm note
  without asking for the microphone; a `POST` answers `code: "off"`. Over
  the allowance it answers `code: "allowance"` and the mic stays with a calm
  note. Typing, the card and every other workflow are unchanged.
  `tests/transcribe-route.test.mjs`, `tests/ask-voice.test.mjs` and
  `tests/e2e/ask-voice.spec.js` prove each of these.
