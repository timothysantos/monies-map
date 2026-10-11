# Entry Draft AI Gap-Filler Audit

Date: 2026-10-11. Branch: `ai-entry-draft`.

## Scope

Server groundwork for the approved "Add or ask" card: one typed sentence
read into an entry draft (DOMAIN.md, "Entry Draft") that the card will show
for confirmation. No client UI, no visible copy, no ledger write.

- `src/domain/entry-draft.ts`: `parseEntrySentence(text, context, ai?)`,
  deterministic and pure; `entryDraftWantsAi`; `parseEntryDraftAiSuggestion`.
- `src/domain/entry-draft-context.ts`: read-only reference data.
- `POST /api/ai-assist/entry-draft` in `src/server/ai-assistance-routes.ts`.
- `EntryDraftDto` and friends in `src/types/dto.ts`.

## No-AI behaviour

The deterministic parser answers every request first and its draft is what
comes back whenever AI is turned off, the binding is missing, the allowance
is used up, the model throws, or its answer is malformed or fails
validation. The response then says `ai: { requested: true, available: false,
reason }`. A sentence that already gives an amount and a description never
asks AI (`requested: false`), so the normal path costs nothing and behaves
the same with or without the binding.

AI is never asked to settle what the sentence itself made uncertain: two
amounts, an unknown currency symbol and a foreign amount stay questions for
the user. Wallet, date, type, owner, split and category never come from AI.

## Privacy

- Sent to AI: the sentence only, after `normalizeEntryDraftText` (280
  characters, control characters removed) and `redactAiText` (account- and
  card-like numbers of 8 to 19 digits removed, 300-character cap), inside
  `<sentence>` markers with the shared untrusted-data system prompt.
- Never sent: accounts, people, categories, rules, Shortcut settings or the
  Shortcut key (the context loader reads the settings row, but only the
  priority list and other-currency card reach the parser), notes, ledger
  rows.
- Stored: nothing. Prompts, answers and drafts are not persisted or logged
  by the app.

## Cost

One allowance unit per AI request, 80 output tokens, on the shared daily
allowance (`AI_ASSIST_DAILY_LIMIT`, default 12). Only an explicit request
from the user can reach it (the request itself is the action), and only when
the amount or description is missing. No retry, no background or scheduled
call.

## Write boundary

The route writes nothing but the shared `ai_assist_daily_usage` counter, and
only when AI is asked. Reference reads touch no ledger table; the only other
statement is the `app_settings` table's `CREATE TABLE IF NOT EXISTS`, which
every Shortcut request also runs. A draft becomes a ledger entry only when
the user confirms and the client posts `createBody` to
`/api/entries/create`. A shared hint is a suggestion of shared ownership,
not a split write.

## Validation of AI output

- Shape: a JSON object; anything else is refused.
- Amount: a positive decimal with at most two places, stated in the sentence
  (the same number in digits, or number words such as "twelve fifty").
  Assumed to be in the account's currency.
- Description: at most 120 characters, every word a word of the sentence.
- Merge: the parser re-runs with the suggestion, so a value from the
  sentence, a rule or a default always wins; AI values carry source `ai`.
- An answer with nothing valid is `null`, reported as "AI returned an
  unusable suggestion."

## Evidence

- `tests/entry-draft.test.mjs`: 30 scenarios with exact outputs, including
  "Koufu lunch $12.50 yesterday, Citi", "Dinner $120 at Burnt Ends with
  Serene, she paid", "Moved $1,500 from OCBC 360 to POSB joint", "Freelance
  payment $650 came into OCBC 360 today", "Warung babi guling IDR 159,000",
  "grab 14.20 mon", and the negative cases (no amount, two amounts,
  ambiguous wallet, inactive account, unknown currency, empty text, very
  long text, impossible and conflicting dates, uneven split, unclear payer,
  "Sun Plaza" not read as Sunday), plus AI validation and merge rules.
- `tests/ai-entry-draft-route.test.mjs`: 10 tests. AI off, binding missing,
  throwing, malformed, wrong shape, inventing values and over the allowance
  each return the same deterministic draft with no data write and no batch;
  a valid answer fills only the missing amount from a redacted prompt that
  carries no account, person or key; conflicting amounts never reach AI;
  empty or unreadable bodies are refused before any statement; the Worker
  serves the route and the shortcut-only gateway hides it.
- Runtime: an isolated local Worker (`wrangler.test.jsonc`, port 8797, own
  D1, showcase data, `AI_ASSIST_ENABLED=true` with no binding) returned the
  expected draft for all six scenario sentences and the never-guess cases;
  ledger, split, audit and allowance row counts were unchanged afterwards;
  two `createBody` values posted unchanged to `/api/entries/create` created
  a shared expense with its split and an outgoing transfer.

## Open decisions for the owner

1. Foreign amounts: the draft keeps "IDR 159,000" and asks for the account
   amount; it does not convert at the day's rate like the Shortcut, because
   `/api/entries/create` takes no original amount and a rate fetch writes the
   rate cache. Converting would need the create route to accept
   `originalAmountMinor`/`originalCurrency`.
2. Income with no rule match is categorised `Other - Income` (the household's
   uncategorised income), not `Other`.
3. A transfer with no description defaults to "Transfer to <account>"; this
   text would be shown and saved, so it needs copy approval with the card.
4. Number words ("twelve fifty") stay in the description when AI fills the
   amount, because a sentence value always wins.
