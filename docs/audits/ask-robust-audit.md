# Ask Robustness Audit

Date: 2026-10-14. Branch: `ask-robust`.

## Scope

Owner request: fix the class of failure behind "Joyce's share 1.6", not the
phrase. Three principles (docs/flows/ask-flow.md, "Three principles"): the
model states intent and the server completes; draft with visible
assumptions and ask only when outcomes differ; repair once before asking.
Plus an eval bank for every Ask action.

- `src/domain/ask-turn-names.ts`: name matching, day, month, amount and
  share readers.
- `src/domain/ask-ambiguity.ts`: the ask-or-draft rule, assumptions, error
  codes.
- `src/domain/ask-turn-repair.ts`, `src/server/ask-turn-route.ts`: the repair
  turn.
- `src/domain/ask-turn.ts`, `ask-turn-actions.ts`, `ask-turn-shares.ts`: the
  validators, now completing instead of asking.
- Client: `ask-turn-api.js` (`readAssumptions`), `ask-panel.jsx`
  (`showAssumptions`). No new component: an assumption reuses the existing
  question line and chips.
- Bank: `tests/fixtures/ask-eval-utterances.json`,
  `tests/ask-eval-bank.test.mjs`, `npm run eval:ask`.

## Cost

A turn is one allowance unit. A repair is a second, only when the checks
refuse a model answer for a reason a model can fix, at most once per message.
The repair prompt is the turn's own prompt (about 1.2k tokens) plus the
refused answer and the errors (about 100 to 250 tokens). On Claude Haiku that
is about US$0.001 a turn, so a repaired turn is about US$0.002. The measure
is the repair log line; if the repair rate is high, the schema or prompt is
the thing to fix, not the cap. The daily allowance and the gateway's monthly
spend limit still bound everything; with the allowance used up the repair is
skipped and the person gets the original question.

## Privacy

- The repair sends nothing the turn did not: the same scrubbed context
  (`scrubName`, no phone, account, card or ID number, no amount from the
  household's records), the refused answer redacted (`redactText`, runs of 8
  or more digits become `[number]`), and valid options that are names only.
- Nothing is stored. The one log line is `{event, action, validatorError,
  field, repaired}`: an action name, an error code, a schema path and a
  boolean. Never the message, a name, a figure or the model's answer.
- The reason a question is asked (`error`) is removed before the reply leaves
  the server (`forPage`, tested).
- Assumption lines name the person's own words (scrubbed) and the app's
  records the person already sees; no figure other than ones the person wrote
  or the entry's own.

## Write boundaries

Unchanged: Ask drafts and never writes. Every save is the person's tap,
through the existing command. The completion layer only fills what a draft
shows; a model-supplied figure the person never wrote is still never used (it
is replaced by the one amount the person did write, or dropped). No new
command, route or persistence.

## No-AI behaviour

Unchanged and tested: with AI off, over its allowance, failing or unusable the
route answers `rules` and the page reads the message with its rules. The one
exception stays the saved-entry share reader. The repair is skipped when the
allowance is used up (`tests/ask-turn-repair.test.mjs`).

## Evidence

- `tests/ask-eval-bank.test.mjs`: 121 recorded messages replayed through the
  Worker on the seeded household.
- `tests/ask-turn-repair.test.mjs`: the repair, its cap, its allowance use,
  its log and every refusal path.
- `tests/ask-turn-names.test.mjs`, `tests/ask-turn.test.mjs`,
  `tests/ask-turn-shares.test.mjs`: the readers and their negatives.
- `tests/e2e/ask-ai-turn.spec.js`: a repaired split and an assumption with its
  chip in a real browser.
