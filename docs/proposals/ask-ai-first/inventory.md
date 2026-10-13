# Ask, AI first: feature inventory

Owner decision, 2026-10-13: Ask switches from "rules first, AI optional
fallback" to **AI understands, the app validates, rules are the offline
backup**. One turn route (`POST /api/ask/turn`) sends Claude Haiku the
bounded recent conversation, a compact context and a tool schema; the model
answers with exactly one action; the server checks that action against the
household's real data; the page shows the existing draft or answer card; and
nothing is written until the person taps Save, through the existing command.

This inventory lists every user-facing capability, the Ask action that
covers it, whether it reads or writes, the existing command or route the
action reuses, the risk, and whether it ships in phase 1 (this branch) or
phase 2.

Risk: **low** = read only or navigation; **medium** = a write the person
confirms on a draft card, through an existing all-or-nothing command;
**high** = a write that is hard to undo, touches many rows, or certifies
bank data. High-risk writes stay on their own screens (Ask opens them).

Every write below is a draft first. The Ask action never writes; the Save
tap posts to the command listed.

## Summary, Month and plans

| Capability | Ask action | R/W | Reuses | Risk | Phase |
| --- | --- | --- | --- | --- | --- |
| How a month went, against the plan | `answer_question` (topic `plan`) | R | `/api/ai-assist/answer` (ask-answer-intent, ask-answer-facts) | low | 1 |
| Why a month cost more, where money went | `answer_question` (`spending_why`, `spending_where`) | R | same | low | 1 |
| Compare two months | `answer_question` (`compare`) | R | same | low | 1 |
| Biggest expenses of a month | `answer_question` (`biggest`) | R | same | low | 1 |
| Income, invested, saved, spent vs earned (money jobs) | `answer_question` (`income`, `invested`, `saved`, `spent_vs_earned`) | R | same | low | 1 |
| Money jobs menu "Ask about this" | `answer_question` (the question is sent as a turn) | R | same | low | 1 |
| Money insights "Ask about this" | insight card built from the insight's own facts; follow-ups are turns with the insight in focus | R | `/api/ai-assist/insight-explain` | low | 1 |
| Change a plan line (set, raise, lower, move, add, copy a month) | `plan_change` | W (draft) | plan-draft (`buildPlanDraft`), Save via `/api/month-plan/apply-changes` | medium | 1 |
| Open Summary or Month for a month/view | `open_page` | R | router | low | 1 |
| Link a plan line to entries | `open_page` (Month) | W on Month | `/api/month-plan/links` | medium | 2 |
| Month note | `open_page` (Month) | W on Month | `/api/month-note/update` | low | 2 |
| Duplicate, reset or delete a month | `cannot_help` + `open_page` (Month) | W | `/api/months/*` | high | stays on Month |
| Pick the Summary period, view, scope | `open_page` with view/scope | R | router | low | 1 |
| Hide or show money | `cannot_help` (the eye button) | local | — | low | 2 |

## Entries

| Capability | Ask action | R/W | Reuses | Risk | Phase |
| --- | --- | --- | --- | --- | --- |
| Add an expense, income or transfer | `draft_entry` | W (draft) | entry-draft (`parseEntrySentence`), Save via `/api/entries/create` | medium | 1 |
| Change the card being filled ("make it $15", "on my Citi card", "yesterday") | `edit_draft` | W (draft) | ask-card-model `setCardField` | medium | 1 |
| Shared expense with a split share, on Splits | `draft_split_expense` | W (draft) | the card's Shared owner + Splits switch, Save via `/api/entries/create` with `addToSplits` | medium | 1 |
| Add a saved entry to Splits (payer, shares by %, $ or "all") | `add_entry_to_splits` | W (draft) | `/api/splits/expenses/from-entry` (now takes `splitBasisPoints`) | medium | 1 |
| Change a saved entry's category | `edit_draft` on a saved card is refused; category chips on the saved card | W | `/api/entries/update-category` | medium | 2 |
| Edit a saved entry (amount, date, wallet, owner) | `open_page` (`/entries?editing_entry=`) | W in editor | `/api/entries/update` | medium | 2 |
| Delete an entry | `cannot_help` + `open_page` (editor) | W | `/api/entries/delete` | high | stays in editor |
| Notes on an entry | `open_page` (editor) | W | `/api/entries/update-note` | low | 2 |
| Mark as transfer / link a transfer | `open_page`; skew check chips already link | W | `/api/transfers/link`, `/api/entries/update-classification` | medium | 2 |
| Owner, wallet, post date | `open_page` (editor) | W | `/api/entries/update`, `update-post-date` | medium | 2 |
| Find entries ("grab rides in september", "food over $50") | `search_entries` | R | Entries filter (`EntriesFilter`, `summarizeFilterAnswer`) | low | 1 |
| Open Entries with filters | `open_page` with filter | R | `buildEntriesFilterSearch` | low | 1 |

## Splits

| Capability | Ask action | R/W | Reuses | Risk | Phase |
| --- | --- | --- | --- | --- | --- |
| Add a split expense (receipt, cash, no bank row) | `draft_split_expense` | W (draft) | Ask expense card, `/api/entries/create` with `addToSplits` | medium | 1 |
| Add an existing entry to Splits | `add_entry_to_splits` | W (draft) | `/api/splits/expenses/from-entry` | medium | 1 |
| Record a settle-up payment with an amount | `draft_settlement` | W (draft) | `/api/splits/settlements/create` | medium | 1 |
| Settle a whole group ("settle up everything") | `open_page` (Splits group; its Settle up button) | W | `/api/splits/settlements/create` (Settle up flow) | medium | 2 |
| Who owes whom | `answer_question` (`owed`) | R | answer route (Splits page DTO facts) | low | 1 |
| Groups: create, archive | `open_page` (Splits) | W | `/api/splits/groups/create` | medium | 2 |
| Simplify across groups | `open_page` (Splits) | W | settlement checkpoints | high | stays on Splits |
| Review matches (link a bank row to a split) | `open_page` (Splits matches) | W | `/api/splits/matches/link-*` | medium | 2 |
| Edit or delete a split expense | `open_page` (`editing_split_expense`) | W | `/api/splits/expenses/update`, `delete` | medium | 2 |
| Restore a deleted split | `open_page` (Splits history) | W | `/api/splits/activity-history/restore` | medium | 2 |
| Usual split suggestion | unchanged (rules over split history) | R | `/api/splits/suggestion` | low | 1 (kept) |

## Imports

| Capability | Ask action | R/W | Reuses | Risk | Phase |
| --- | --- | --- | --- | --- | --- |
| Import a statement, preview, commit | `open_page` (Imports) | W | `/api/imports/preview`, `commit` | high | stays on Imports |
| Undo an import | `open_page` (Imports history) | W | `/api/imports/rollback` | high | stays on Imports |
| Reconcile, statement fixes, corrections | `open_page` (Settings / Imports) | W | `/api/accounts/reconcile`, statement-corrections | high | stays on its screen |
| "Which file do I download from my bank?" | `answer_question` is not for this; `cannot_help` with the Help link | R | user guide | low | 2 |

## Settings

| Capability | Ask action | R/W | Reuses | Risk | Phase |
| --- | --- | --- | --- | --- | --- |
| Payment ways (PayNow, cash per person) | `open_page` (Settings) | W | `/api/settings/payment-ways/save` | medium | 2 |
| Categories, colours, category rules | `open_page` (Settings) | W | `/api/categories/*`, `/api/category-match-rules/*` | medium | 2 |
| Accounts, opening balances, people | `open_page` (Settings) | W | `/api/accounts/*`, `/api/people/update` | high | stays on Settings |
| Apple Pay Shortcut settings | `open_page` (Settings) | W | `/api/settings/shortcuts/save` | medium | stays on Settings |
| Unresolved transfers review | `open_page` (Settings) | W | `/api/transfers/*` | medium | 2 |

## Ask itself

| Capability | Ask action | R/W | Reuses | Risk | Phase |
| --- | --- | --- | --- | --- | --- |
| Typed or spoken message | every action above | — | voice: `/api/ai-assist/transcribe` | low | 1 |
| Receipt photo | unchanged: receipt reader fills the card; follow-ups are turns with the card in focus | W (draft) | `/api/ai-assist/receipt-read` (image consent and caps unchanged) | medium | 1 |
| Apple Pay "Saved from Apple Pay" card | the saved entry is the focus of every turn ("Add to splits, all Joyce") | W (draft) | `add_entry_to_splits` | medium | 1 |
| Entries + / Splits receipt button | the draft card is the focus | W (draft) | `edit_draft`, `draft_split_expense` | medium | 1 |
| Not sure what was meant | `ask_clarification` (a question and up to 4 chips) | — | chip row | low | 1 |
| Outside what Ask can do | `cannot_help` (one line, optionally a page to open) | — | — | low | 1 |
| Switch view or scope | `open_page` with view | R | View and scope route params | low | 1 |
| Help / FAQ | `open_page` (`/faq`) | R | router | low | 1 |

## Phase 1 actions (this branch)

`draft_entry`, `edit_draft`, `add_entry_to_splits`, `draft_split_expense`,
`draft_settlement`, `plan_change`, `answer_question`, `search_entries`,
`open_page`, `ask_clarification`, `cannot_help`.

## Phase 2 (later, each needs the owner's OK on its card)

Editing or recategorising a saved entry from a sentence, notes, transfer
linking, split groups, matches review, settle a whole group by its balance,
payment ways and categories from Ask, plan links and month notes. Until
then `open_page` takes the person to the screen that already does it.

## Never from Ask

Deleting entries, months or imports, committing or rolling back an import,
certifying or reconciling a statement, accounts and people. These stay on
their screens with their own confirmation; Ask can only open them.
