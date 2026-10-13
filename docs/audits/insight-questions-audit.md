# Insight questions audit (October 2026)

"Ask about this" on a Money insights line opens Ask with "Explain: <the
line>" and a card built from the insight's own facts
(`docs/flows/ask-flow.md` "Insight questions"; DOMAIN.md "Insight
Question"). Branch `insight-ask-explain`, merged with `origin/master`
(release r11).

## What it is

- Every signal that can lead the check-in or sit under Also now carries a
  `basis` (`src/domain/money-signals/types.ts`): the figures it already
  worked out with plain labels, the entries behind it and the month or
  Splits group it is about. No signal computes a new figure for it.
- The insights only send a window event (`insight-ask-event.js`); the shell
  (`use-insight-ask-launcher.js`) opens the Ask page on a phone (the insight
  in history state, asked once) or the Ask panel on a wider screen.
- Ask builds the card at once with no request (`ask-insight-answer.js`,
  `ask-insight-answer-card.jsx`). Its entries come from the Entries page DTO
  through the Entries page's own filter, so Open in Entries shows the same
  rows. Follow-ups are pages (Compare with the statement, Open Month, Open
  Splits), money questions Ask already answers (each with its check before
  any figure), or, for a plan that doesn't add up, Change my plan: planning
  by chat with the month in the message box for the person to finish and
  send (no draft is proposed; nothing is saved until Save plan).

## Optional AI

`POST /api/ai-assist/insight-explain` (`src/server/ask-insight-route.ts`).

- Trigger: the person's tap only. Nothing scheduled, nothing on page load.
- Privacy: the body is the line, its think line and at most 12 basis lines
  (labels up to 90 characters, values up to 120, safe integer amounts),
  read through `readJsonBody` (64 KiB, `limited-body.ts`). Every run of six
  or more digits and every NRIC / FIN shape is removed before the prompt
  (`stripPersonalNumbers`). The route reads only the household's category,
  wallet and people names, for the check. No entry, account id, note or
  file reaches the model.
- Check: the answer prompt and `validateAiWording` (every amount one of the
  facts', no name the facts do not hold, no advice, forecast or
  safe-to-spend wording, one to three sentences). Anything else is
  `explanation: null`.
- Cost: one allowance unit (`ask_answer`) per tap with AI on; none with AI
  off (the route answers at once).
- Writes: the shared allowance counter only (proved in
  `tests/ask-insight-route.test.mjs` by a whole-database dump).
- Trust: the facts come from the page in the browser, so the check can only
  hold the words to what the page sent; the card's figures never come from
  the model, and nothing it says is saved.

## No-AI and failure behaviour

With AI off, out of allowance, failing or phrasing badly, the card is the
insight's facts, its entries and its links, unchanged
(`tests/e2e/ask-insight.spec.js` runs with AI off; the AI path is stubbed
at the route once to see its "Worded by AI" tag).

## Hidden money

No "Ask about this" shows while money is hidden. An insight already in the
conversation reads "Explain this money insight", its title "A money
insight", its amount masked and its Detail "Reveal money totals to read
these insights."

## First screen

The insights' component gains the buttons and an event; the shell gains a
small launcher that uses the dock it already had. No Ask code is in the
first screen (`tests/insight-ask-lines.test.mjs` pins the imports).
`check:bundle` stays within `initial-bundle-budget.json` (unchanged): 8
files, about 0.5 kB gzip more than `origin/master` at r11.

## Also in this branch (coordinator's decision)

The plan answer (Intent vs Outcome) now reads the Month lead's own "Spent"
and "of $X plan": the spend job through the shared `splitMoneyUse` (moved to
`src/domain/money-jobs.ts`, wrapped by `money-jobs-model.js`), so the card
and the Month and Summary lead show one figure.
