# Ask Planning By Chat Audit

Date: 2026-10-13. Branch: `ask-planning`.

## Scope

The owner-approved round-2 chat versions (`docs/proposals/ui-language-round2`
on `ui-language-round2-mockups`, section 7): planning by chat and Intent vs
Outcome as an Ask answer. DOMAIN.md "Plan Draft" and "Money Question";
docs/flows/ask-flow.md "Planning by chat" and "Money questions".

- `src/domain/plan-draft-reader.ts`: the rule reader (copy a month, set,
  change, move, add a line), the AI schema and prompt, and
  `parsePlanAiReading`. Shared by the route and the Ask page.
- `src/domain/plan-draft.ts`: the draft builder (lines, totals, the
  plan-balance warning, questions, notes). Pure.
- `POST /api/ai-assist/plan-draft` in `src/server/plan-draft-route.ts`.
- `applyMonthPlanChanges` in `src/domain/app-repository-month-commands.ts`
  and `POST /api/month-plan/apply-changes`.
- Intent vs Outcome: `ask-answer-intent.ts` ("how did September go?", "did
  we stick to the plan in Q3?"), `combineMonthFacts` in
  `ask-answer-facts.ts`, the plan card's `outcome` in
  `ask-answer-wording.ts`.
- Client: `ask-api.js` (`requestPlanDraft`, `applyPlanChanges`),
  `ask-plan-draft-card.jsx`, `copy/ask-plan-copy.js`, `ask-chips.js`
  (`buildPlanQuestionChips`), `ask-panel.jsx`, `ask-conversation-store.js`,
  `ask-money-answer-card.jsx` (the savings bar).

## Write boundary

- AI never writes. The plan-draft route writes nothing but the shared AI
  allowance counter (and, after a Claude attempt, the aggregate Claude
  status row). Proved in `tests/plan-draft-route.test.mjs`: the database
  dump is identical after a rules draft, and only `ai_assist_daily_usage`
  changes after an AI reading.
- Nothing is saved until the person taps Save plan. Save posts the
  draft's own `apply` list to `POST /api/month-plan/apply-changes`.
- Why a new write route: a move changes two lines and a copy many; saving
  them one by one through `/api/month-plan/save` could leave half a move.
  `applyMonthPlanChanges` builds every update and create with the same row
  and split statements `saveMonthPlanRow` writes (now
  `buildMonthPlanRowSaveStatements`, shared) and every delete with
  `deleteMonthPlanRow`'s, and commits them with the month's refresh
  marker in one `db.batch()`, then refreshes the month's totals
  (Persistence Atomicity Contract). `failingStatement` and stale-draft
  tests: `tests/atomic-writes-plan-draft.test.mjs`.
- Stale drafts: each updated or deleted line carries what it held when the
  draft was made (`expectedMinor`); any difference, a new line whose id is
  taken, or a line from another month refuses the whole save (409, nothing
  written). Saving the same draft twice is therefore refused, and a draft
  restored mid-save after a reload is kept as a draft.
- Undo: the command returns the changes that put the plan back (updates
  to their old amounts, created lines deleted), posted the same way.
- No change to the existing plan-row save, delete or duplicate behaviour
  (`tests/atomic-writes-months.test.mjs` unchanged and passing).

## No-AI behaviour

Rules read every shape the mockups show and more (`tests/plan-draft-reader.test.mjs`);
with AI off, missing, out of allowance, failing or answering badly, a
request the rules cannot read is `{ supported: false }` and Ask reads it as
before (a question, a search or an entry), so nothing is lost. The browser
suite runs with AI off (`tests/e2e/ask-planning.spec.js`). The Intent vs
Outcome card is the existing money answer: computed figures and computed
wording, with AI only phrasing the words through the existing validated
path ("Worded by AI").

## Validation of an AI reading

`parsePlanAiReading` keeps the provider's reading only when:

- `kind` is `plan` and there are at most six operations;
- every line name (`line`, `from`, `to`) is words of the request itself;
- every amount is a number written in the request (never a worked-out
  one), and a negative is only a `change`;
- every month is one the request names ("November", "next month",
  "2026-11"), or null (the draft then asks which month).

The reading is then resolved by the same rules as a rules reading, so a
name that fits two lines still asks, and an unknown line is still a note.
A rejected reading tries the other provider, then falls back to
"not a plan request".

## Privacy

- Sent to AI: only the request text after `redactAiText` (account- and
  card-like numbers removed, at most 300 characters) and today's date. No
  plan rows, amounts from the database, names of people, ids, wallets or
  categories are sent: resolution happens after, on the server.
- Stored: nothing about the request, the reading or the draft on the
  server. The draft lives in the browser tab's Ask conversation store
  (sessionStorage), like money answers.
- Claude traffic goes through AI Gateway with logging and caching off, as
  for every provider call.

## Cost

- One allowance unit, ask tier (`plan_draft` added to the ask-tier
  capabilities: a person is waiting), 260 output tokens at most, 8 s
  timeout per provider.
- Only for a request that reads like planning (a plan verb or a plan word)
  that the rules could not read; rules readings, questions, entries,
  searches and wallet moves never reach AI.

## Money and copy rules

- Every figure on the draft is the plan rows' own; totals add up the way
  the Month cards do (`planTotals`, proved equal to Month's Planned spend
  in `tests/plan-draft-route.test.mjs`).
- The warning is the Money insights plan-balance check
  (`planShortfallSignal`) on the plan after the change, in its own words.
- Hidden money: amounts are dots, the "was" figure and the warning go,
  tones go neutral, and a "not enough planned" note drops its figure.
- No forecast, safe-to-spend or savings target is produced; a draft only
  restates the household's own plan.
