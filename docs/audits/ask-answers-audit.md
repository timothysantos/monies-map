# Ask Money Answers Audit

Date: 2026-10-12. Branch: `ask-answers`.

## Scope

The owner-approved Ask answers for free-form money questions it cannot
treat as a filter ("why was August so expensive?", "where did September
go?", "how am I doing against the plan?", "compare August with July",
"what's my biggest expense this month?", "what do I owe Serene?", "how much
income came in?"). DOMAIN.md "Money Question"; docs/flows/ask-flow.md
"Money questions".

- `src/domain/ask-answer-intent.ts`: the rule-based intent reader, shared by
  the route and the Ask page.
- `src/domain/ask-answer-facts.ts`: pure facts from the Month page DTO and
  the Splits page DTO.
- `src/domain/ask-answer-wording.ts`: the answer card, the computed wording,
  the bounded fact list for AI and `validateAiWording`.
- `src/domain/pages/ask-answer.ts`: the read side (intent, skew check,
  facts).
- `POST /api/ai-assist/answer` in `src/server/ask-answer-route.ts`.
- Client: `ask-api.js` (`requestMoneyAnswer`, `resolveSkewCandidate`),
  `ask-money-answer-card.jsx`, `ask-skew-check.js`, `ask-chips.js`,
  `ask-panel.jsx`, `ask-conversation-store.js`.

## Order of work in the route

1. Rules read the question (`readAnswerIntent`). Anything else is
   `{ supported: false }` and the page keeps its "not answered" note. No AI
   reads the question to decide what it means.
2. Skew candidates first (owner decision "stop and ask first"): for the
   month(s) the answer is about, `buildSkewCandidatesDto` runs; a
   high-confidence candidate that would change these facts (spending skew
   for spending, plan, compare and biggest answers; income skew for income;
   any settlement for who owes whom) returns `{ needsConfirmation,
   candidates }` and no answer. Candidates the person called real are sent
   back as `keepCandidateIds` (held in the browser tab's conversation only).
3. Facts from the same DTOs the screens show (`buildMonthPageDto`,
   `buildSplitsPageDto`); an untracked month is answered as "no entries",
   never with another month's numbers.
4. The answer card and the computed wording are built from the facts.
5. Only then, and only with AI on, the provider may phrase the wording.

## No-AI behaviour

The computed wording is always built and is the answer whenever AI is off
(`AI_ASSIST_ENABLED` not `"true"`), not configured, out of its daily
allowance, slow, failing, malformed, or when its text fails validation; the
response then says `wording.source: "template"` and `ai.available: false`.
A month with no entries and Splits with nothing open never ask AI. Every
figure on the card (lead, chips, lines, links) is computed and never
depends on AI. The browser suite runs with AI off throughout
(`tests/e2e/ask-money-answers.spec.js`).

## Validation of AI wording

`validateAiWording` rejects the phrasing, and the computed wording is
shown, unless all of these hold:

- one to three sentences ending in a full stop, question or exclamation
  mark; at most 360 characters; no line breaks, markdown characters or
  links;
- every number in it is a number in the fact list (compared after dropping
  `$` and commas, so `$1,234.50` and `1234.5` are the same; a rounded or
  worked-out number is rejected);
- every capitalised word is a word of the facts, a month or weekday, or a
  plain sentence opener, and no household category, wallet, person or
  Splits group appears unless the facts name it;
- no advice, forecast or promise words ("you should", "will be",
  "forecast", "safe to spend", "recommend"...) and no app jargon ("the
  app", "ledger", "unlinked", "checkpoint", "chart");
- a currency word or symbol only if the facts use it.

The parser runs inside the provider call, so a Claude phrasing that fails
falls back to Workers AI before the computed wording.

## Privacy

- Sent to AI: the question after `redactAiText` (account- and card-like
  numbers removed, 200 characters) inside `<question>` markers, and at most
  16 short fact lines (`buildPromptFacts`): month totals, plan, the top
  categories and shares, at most five entries as a tidied shop name
  (`tidyName`, reference numbers and card codes removed, 40 characters), the
  day and the category, Splits group names and balances. With the shared
  untrusted-data system prompt.
- Never sent: entry, account or category ids, account names or numbers,
  notes, raw descriptions beyond the tidied name, other ledger rows,
  settings, credentials or Shortcut tokens.
- Stored: nothing on the server. The question, facts, prompt and answer are
  not persisted or logged. The Ask page keeps the answer card in the browser
  tab's conversation (sessionStorage, like the rest of the conversation)
  until the tab closes or New chat.

## Cost

One allowance unit per answered question with AI on, 220 output tokens, an
8 s wait per provider, on the shared daily allowance
(`AI_ASSIST_DAILY_LIMIT`). Only the person's sent question reaches it: no
retry, no background, scheduled or on-open call. A check before an answer,
an unsupported question and an empty month cost nothing.

## Write boundary

The answer route writes nothing but the shared `ai_assist_daily_usage`
counter (and, after a Claude attempt, the aggregate Claude status row):
`tests/ask-answer-ai.test.mjs` compares whole-database dumps, and
`tests/ask-answer-route.test.mjs` proves the database is unchanged with AI
off. Resolving a check is the person's tap and goes through the existing
routes named in the candidate's suggested actions
(`/api/transfers/link`, `/api/entries/update-classification`,
`/api/splits/checkpoints/match`, `/api/splits/settlements/create` then
`/api/splits/matches/link-settlement`), in order; the page refuses any
other path (`resolveSkewCandidate`). "It's real spending" writes nothing.

## Proof

- `tests/ask-answer-intent.test.mjs`: intent table and negatives.
- `tests/ask-answer-route.test.mjs`: showcase figures equal the Month,
  Entries and Splits page DTOs; empty month; refusals; read-only.
- `tests/ask-answer-skew.test.mjs`: skew first, resolving through the
  suggested actions, keeping, relevance per intent, both months compared.
- `tests/ask-answer-ai.test.mjs`: validation table; AI phrasing shown;
  invented numbers, unknown names, malformed replies, AI off, failing and
  over allowance fall back; only the allowance counter is written.
- `tests/ask-money-answer.test.mjs`: client adapter against the real route,
  action allowlist and order, chips, conversation store.
- `tests/e2e/ask-money-answers.spec.js`: phone and wide screen, AI off.
