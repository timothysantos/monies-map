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
| Link a plan line to entries | `link_plan` (line, month, the shop words): the month's matching expenses, its links kept | W (draft) | `/api/month-plan/links`, Undo restores the old links | medium | 2 (done) |
| Month note | `edit_note` (target month) | W (draft) | `/api/month-note/update`, Undo restores the old note | low | 2 (done) |
| Duplicate, reset or delete a month | `cannot_help` with `blocked: delete_month`: Ask says why and opens Month | W | `/api/months/*` | high | stays on Month |
| Pick the Summary period, view, scope | `open_page` with view/scope | R | router | low | 1 |
| Hide or show money | `cannot_help` (the eye button) | local | — | low | 2 |

## Entries

| Capability | Ask action | R/W | Reuses | Risk | Phase |
| --- | --- | --- | --- | --- | --- |
| Add an expense, income or transfer | `draft_entry` | W (draft) | entry-draft (`parseEntrySentence`), Save via `/api/entries/create` | medium | 1 |
| Change the card being filled ("make it $15", "on my Citi card", "yesterday") | `edit_draft` | W (draft) | ask-card-model `setCardField` | medium | 1 |
| Shared expense with a split share, on Splits | `draft_split_expense` | W (draft) | the card's Shared owner + Splits switch, Save via `/api/entries/create` with `addToSplits` | medium | 1 |
| Add a saved entry to Splits (payer, shares by %, $ or "all") | `add_entry_to_splits` | W (draft) | `/api/splits/expenses/from-entry` (now takes `splitBasisPoints`) | medium | 1 |
| Change a saved entry's category | `recategorise` on the saved entry in focus; `recategorise` with words for many ("make all Grab rides Transport": the server re-reads the matching entries, the card lists the count and first eight, over 10 needs "Yes, change all N", over 200 refused), then the optional category rule | W (draft) | `/api/entries/update-category` with `changes` (one guarded batch), Undo; rule `/api/category-match-rules/save` | medium | 2 (done) |
| Edit a saved entry (amount, date, description, category, wallet, owner, note) | `edit_saved_entry` (and `edit_draft` on a saved card); a statement-certified entry keeps its amount, date, description and wallet and Ask says why | W (draft) | `/api/entries/update` with every other fact kept, Undo | medium | 2 (done) |
| Delete an entry | `cannot_help` with `blocked: delete_entry`: Ask says why and opens Entries | W | `/api/entries/delete` | high | stays in editor |
| Notes on an entry | `edit_note` (target entry) | W (draft) | `/api/entries/update-note`, Undo | low | 2 (done) |
| Mark as transfer / link a transfer | `link_transfer`: the other side with the same amount in another wallet within a month (`loadTransferMatchCandidates`), narrowed by the wallet and day said; several are asked as chips | W (draft) | `/api/transfers/link` (no Undo: the editor unlinks) | medium | 2 (done) |
| (same row, 2026-10-14) any Ask path that makes an entry a transfer | edit type Transfer, category Transfer, a new transfer draft: the same candidates (`transfer-candidates.ts`), best pre-selected, 3 more as chips, "No other side yet" | W (draft) | `/api/transfers/link`, or the entry update for no other side | medium | done |
| Owner, wallet | `edit_saved_entry`; post date stays in the editor | W (draft) | `/api/entries/update` | medium | 2 (done) |
| Find entries ("grab rides in september", "food over $50") | `search_entries` | R | Entries filter (`EntriesFilter`, `summarizeFilterAnswer`) | low | 1 |
| Open Entries with filters | `open_page` with filter | R | `buildEntriesFilterSearch` | low | 1 |

## Splits

| Capability | Ask action | R/W | Reuses | Risk | Phase |
| --- | --- | --- | --- | --- | --- |
| Add a split expense (receipt, cash, no bank row) | `draft_split_expense` | W (draft) | Ask expense card, `/api/entries/create` with `addToSplits` | medium | 1 |
| Add an existing entry to Splits | `add_entry_to_splits` | W (draft) | `/api/splits/expenses/from-entry` | medium | 1 |
| Record a settle-up payment with an amount | `draft_settlement` | W (draft) | `/api/splits/settlements/create` | medium | 1 |
| Settle a whole group ("settle up everything") | `split_group` op settle: the group's balance as Splits shows it, as the settle-up payment draft | W (draft) | `/api/splits/settlements/create` | medium | 2 (done) |
| Who owes whom | `answer_question` (`owed`) | R | answer route (Splits page DTO facts) | low | 1 |
| Groups: create; move a split to a group | `split_group` op create, op move (the split of the saved entry in focus) | W (draft) | `/api/splits/groups/create`; `/api/splits/expenses/update` with every other fact kept, Undo | medium | 2 (done) |
| Simplify across groups | `split_group` op simplify: the card shows the one payment the command records (`planSplitSettlementCheckpoint`) and how many open splits it covers | W (draft) | `/api/splits/checkpoints/create` (now one batch), Undo `/api/splits/checkpoints/reopen` | high | 2 (done, owner request) |
| Review matches (link a bank row to a split) | `review_matches`: the month's matches as Splits lists them (at most 6); Match links one, Not this one hides it here; a match needing a rate check stays on Splits | W (per match) | `/api/splits/matches/link-*` | medium | 2 (done) |
| Edit or delete a split expense | `open_page` (`editing_split_expense`) | W | `/api/splits/expenses/update`, `delete` | medium | 2 |
| Restore a deleted split | `open_page` (Splits history) | W | `/api/splits/activity-history/restore` | medium | 2 |
| Usual split suggestion | unchanged (rules over split history) | R | `/api/splits/suggestion` | low | 1 (kept) |

## Imports

| Capability | Ask action | R/W | Reuses | Risk | Phase |
| --- | --- | --- | --- | --- | --- |
| Import a statement, preview, commit | `cannot_help` with `blocked: import_statement` (opens Imports) | W | `/api/imports/preview`, `commit` | high | stays on Imports |
| Undo an import | `cannot_help` with `blocked: undo_import` or `delete_import` (opens Imports) | W | `/api/imports/rollback` | high | stays on Imports |
| Reconcile, statement fixes, corrections | `cannot_help` with `blocked: reconcile` (opens Settings) | W | `/api/accounts/reconcile`, statement-corrections | high | stays on its screen |
| "Which file do I download from my bank?" | `answer_question` is not for this; `cannot_help` with the Help link | R | user guide | low | 2 |

## Settings

| Capability | Ask action | R/W | Reuses | Risk | Phase |
| --- | --- | --- | --- | --- | --- |
| Payment ways (PayNow, cash per person) | `set_payment_way`: an active bank wallet for PayNow, an active cash wallet for cash | W (draft) | `/api/settings/payment-ways/save`, Undo | medium | 2 (done) |
| Categories, colours, category rules | `edit_category` op create, rename (not the built-in ones), colour (a palette colour; any other word opens Settings); rules after a bulk recategorise | W (draft) | `/api/categories/create` (now one batch), `/api/categories/update` with Undo, `/api/category-match-rules/save` | medium | 2 (done) |
| Accounts, opening balances, people | `cannot_help` with `blocked: accounts` or `people` (opens Settings) | W | `/api/accounts/*`, `/api/people/update` | high | stays on Settings |
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

## Phase 2 actions (done, branch `ask-ai-first-p2`; owner authorised shipping)

`edit_saved_entry`, `recategorise` (one entry, or many by the person's
words with the optional category rule), `edit_note` (an entry or a month),
`link_transfer`, `split_group` (create, move, settle, simplify),
`review_matches`, `set_payment_way`, `edit_category` (create, rename,
colour), `link_plan`, and `cannot_help.blocked` for the list below.

Each is a change card (`AskChange`, `src/domain/ask-turn-actions.ts`) that
names every row it changes before and after, the existing command it saves
through (only `ASK_CHANGE_PATHS`) and its Undo where that command can take
it back. Rows a change needs are read by the server after the model
answers (`ask-turn-resolve.ts`), never from the model and never sent to it.
Still in its own editor: an entry's post date, archiving a split group,
editing or deleting a split expense, restoring a deleted split, and
unresolved transfers review (`open_page`).

## Never from Ask

Deleting entries, months or imports, committing or rolling back an import,
certifying or reconciling a statement, accounts and people. These stay on
their screens with their own confirmation. The model can only name them
(`cannot_help` with `blocked`); Ask then says why in the app's own words
and opens the page that does it. No action in the schema deletes anything.
