# Ask Flow

This doc describes the Ask page flow in three parts:

- route flow
- state flow
- data flow

The Ask page is one full page (not a sheet) where a person adds an entry by
hand, from a typed or spoken sentence or from a receipt photo, finds entries
by asking ("grab rides in september"), asks about their money ("why was
August so expensive?", "what do I owe Serene?", "how did September go?"),
changes a month's plan ("move $50 from Shopping to Groceries in October",
saved only with Save plan), and sees what changed since they last looked. Its visual design is in `design.md` ("Ask page").

## Route Flow

Route entry:

- `/ask`: chat mode, from the Ask tab.
- `/ask?mode=add&from=entries`: add mode, from the Entries + button on a
  phone (on a wide screen the + opens the same card in the Ask panel, see
  "Desktop").
- `/ask?mode=expense&from=splits&split_group=<id>`: add mode with the Splits
  switch on for that group, from the Splits receipt button on a phone (on a
  wide screen, in the Ask panel).
- `/ask?mode=add&from=ask` and `/ask?mode=expense&from=ask`: add mode from the
  chat mode's Add entry and Add expense chips.
- `/ask?view&month&scope` with `state.askInsight`: a Money insights
  line's "Ask about this" on a phone (see "Insight questions"). The
  insight rides in history state, never in the URL, and is dropped from
  the entry once asked.
- `/ask?saved_entry=<id>&month=<YYYY-MM>&view=<view>&from=shortcut`: the
  Apple Pay Shortcut's `openUrl` (`buildShortcutEntryOpenUrl` in
  `src/server/shortcut-gateway.ts`). Shortcuts installed earlier keep working:
  they open whatever URL the create route returns, and the Entries link they
  used before (`/entries?editing_entry=<id>`) still opens the entry in
  Entries.

`view`, `month` and `scope` always ride along (`buildAskLocation` in
`app-routing.js`). Ask has no period: the period controls are passive on a
wide screen, and the shell never moves Ask's `month` to a tracked month (the
Shortcut's entry month stays the entry's). `mode`, `from` and `saved_entry`
never leak to another tab (`sanitizeTabParams`). A new way in (`mode`, `from`,
`saved_entry` or `split_group` changing) has its own conversation, kept in
the Ask conversation store (see "Continuity"); the Ask tab reopens the
newest one in progress (an add-mode card carries its `mode`, `from` and
`split_group` in the tab's link).

A lead's "Ask about this" (the savings bar and money jobs on Summary and
Month, `money-jobs-detail.js`, design.md "Money jobs") opens the chat and
asks its question at once, as if the person had typed and sent it: the
message shows, then the answer, check or note the same reader gives
(`readSentence`: plan request, money answer, filter, entry draft). The menu
sends a `monies:money-action` window event and the shell (App.jsx) opens
Ask. On a phone it navigates to `/ask?view&month&scope` with history state
`{ askQuestion: { text } }`: the chat sends it once and drops it from the
entry with a replace, so a reload or Back does not ask it again. On a wide
screen it is `openAskDock({ intent: chat, question })`: the dock store's
one-shot `question` handoff, which the chat takes when it mounts, or at
once when it is already the one open (a second question joins the same
conversation). The question never holds an amount. Every question the
menu asks reads as its own money answer (see "Money questions"): the spent
part as the plan or spending answer, invested, saved (kept), spending
against income ("Why did I spend more than I earned…" and, with money
hidden, "How did my spending compare with my income…"), and the plan
answer for "How did my spending compare with the plan…". The Summary's
period ("from Oct 2025 to Sep 2026") reads as its months.

On a phone the tab bar reads Summary, Entries, Splits, Ask, ··· (one grid
column per primary tab; Month is not a tab, it is the Summary tab's month
choice). On a wide screen (761 px and up) the Ask tab is hidden: the Ask
field at the bottom right of every page opens the same conversation beside
the page (see "Desktop" below), and the Entries + and Splits receipt
buttons open their new entry card there too. `/ask` itself still renders in
the main area there (the Shortcut's link, the From Ask chip's way back, an
old link), and shows no field or panel.

Chips leave Ask for: Entries (`Back to Entries`, `‹ Entries`, and an
answer's `Open in Entries`, see "Search and filter" and "Money
questions"), Month and Splits (a money answer's `Open Month` and `Open
Splits`; the header's
`‹ Entries` / `‹ Splits` link and the chip row's `‹ Entries` go back to
the page exactly as it was, see "Back to where you were"), the entry's
editor (`Open this entry`: `/entries?editing_entry=<id>` in the entry's month),
Splits (`Back to Splits`, `‹ Splits`, `Open on Splits`:
`/splits?editing_split_expense=<id>`), and the old forms (`Edit in form`: the
Entries composer through `?action=add-expense&source=ask` with the card's
values, or the Splits expense dialog through `?split_action=add-expense`).
`source=ask` keeps the Apple Pay Shortcut's "Shortcut did not pass …"
warnings off a card opened by hand: a blank card is not a Shortcut that
lost its Amount variable (`tests/e2e/entry-form-shortcut-warning.spec.js`).
Once the form has the values the link parameters are cleared from the URL
(and the reload copy in session storage is dropped), so a reload or back
step does not reopen the form; the month correction in `App.jsx` builds from
the live address bar so it cannot put them back. A blank card's Amount is
empty (placeholder `0.00`), and saving it empty is still refused by the
server's "Amount must be greater than zero".

## Back to where you were

On a phone the Entries + and the Splits receipt button open Ask as a new
history entry, so going back returns to the page as it was, never out of
the app (`ask-origin.js`, `use-ask-origin.js`; design.md "Ask origin"):

- Before Ask opens, the page's place is kept on its own history entry
  (`state.askReturn`) and handed to Ask (`state.askOrigin`): its URL (the
  month, view, scope, the Entries filters, the split group), the window's
  scroll, and an open Entries edit or add sheet with its draft. (On a
  phone the + sits under a sheet's backdrop, so a sheet is part of the
  place only if something else opens Ask while it is open.)
- The ways back: the header's back link ("‹ Entries" / "‹ Splits", top
  left above the title, far from Save; its screen reader name is "Back to
  Entries"), the chip row's "‹ Entries" (only while the card is untouched:
  nothing typed, picked, read or said), and the phone's back gesture. With
  the page right behind Ask in the history the link is history.back, so
  all three are one way.
- The page puts the place back once its data is there: the sheet with its
  draft (Close still discards it to the saved entry), then the scroll,
  set again each frame until it holds (rows render over a few frames) and
  never after the person scrolls. Forward and back again does not move the
  person a second time.
- Nothing is lost and nothing asks: an untouched card just returns; a
  started card stays in the conversation store, the Ask tab shows its dot,
  and the card is there when the Ask tab (or the + again) reopens it.
- When Ask's history entry has lost the place (the Ask tab reopened the
  card, or Ask changed its own URL), the back link opens the place kept
  for the tab's session (sessionStorage `monies.askOrigin.v1`, one per way
  in, versioned, checked so it can only lead to /entries or /splits): the
  place the + kept until the page has put it back, then the page's own URL and
  scroll from when it was last left. With nothing kept (an /ask link opened
  directly) it opens the page for the same view and month.
- After a save, "Back to Entries" still opens the saved entry's month so
  the new row shows; the header's link goes back to the place.
- On a wide screen the + and the receipt button open the card in the Ask
  panel and the page never leaves, so there is no back link there.

## Desktop

On a wide screen Ask has no tab. A one-line field, "Ask, or drop a
receipt…", is fixed at the bottom right of every page but `/ask`, beside
the Entries + or the Splits receipt button where there is one
(`ask-dock.jsx`, the only part in the first screen: the field, `/` and the
panel's loading frame; the dock's store, layout rules and panel load in the Ask
page's chunk on the first way in, or once the page is usable when a panel was
left open in this tab; `ask-dock-entry.js` keeps what was done meanwhile). Focusing, clicking or typing in it,
Enter, `/` (when the person is not typing in a field and no dialog is
open; `isAskShortcutKey`), its paperclip (the photo picker), or a photo
dropped or pasted on it opens Ask. Words typed before the conversation has
loaded follow into its message box; a photo goes through the same receipt
reader as the composer's.

Where it opens (`ask-dock-layout.js`, pure, unit tested):

- 760 px and narrower: nothing (the phone's Ask tab).
- 761 to 1,279 px: a popup over the page, anchored bottom right, 410 × 560
  px (smaller on a short window). The page keeps its width.
- 1,280 px and wider: docked, a full-height panel at the right (`clamp(360px,
  27vw, 400px)`) that pushes the page narrower (`body[data-ask-dock]`
  pads the body; the + and receipt buttons move beside it). The page keeps
  at least 880 px, where the header still fits one row (design.md "Layout
  Breakpoint Boundary").
- The mode is chosen when Ask opens. A docked panel on a window narrowed
  below 1,280 px shows as the popup (there is no room to push the page)
  and docks again when it widens. A popup kept open while the window
  widens stays a popup and shows the expand control ("Dock Ask beside the
  page"), which docks it.

The Entries + and the Splits receipt button open their new entry card in
the dock (`openAskDock` with the way in `add`/`entries`, or
`expense`/`splits` with the open split group), docked or as a popup by the
same rule; the page stays where it was. Each press is a new visit (the
dock's `visit` remounts the conversation), so a saved card gives way to a
new one, as on the phone. On Entries and Splits the popup sits above the
round button (94 px from the bottom) so it stays in reach. A save in the
panel refreshes the page beside it the way a save from another browser tab
does (`handleRemoteEntryMutation` / `handleRemoteSplitMutation`), so the new
row shows in the Entries list beside it.

The panel is the Ask page itself (`AskPanel` with `placement` "docked" or
"popup", the same lazy chunk `/ask` loads) on the shared conversation
store, so the phone's Ask tab and the panel are one conversation. Its way
in is the dock's, not the URL's (`ask-dock-state.js`): opening from the
field resumes a new entry still being filled (the presence's
`resumeIntent`, as the phone's Ask tab does), else the chat. A chip that
would open `/ask` (Add entry, Add expense, `‹ Ask`) changes the dock's
conversation instead, and Switch to … changes the view of the page beside
it. Every link out of an answer or a card (Open in Entries, Open this
entry, Back to Entries, the "since you last looked" actions) navigates the
page beside the panel; the panel stays.

Dock state (`ask-dock-state.js`, sessionStorage `monies.askDock.v1`,
versioned): open or closed, the mode and the way in, so the panel stays
open across route changes and a reload until closed. The field's words,
a dropped photo and the panel's readiness are memory only.

Loading: the field and the panel's frame are in the first screen (a few
kB, inside `npm run check:bundle`). The conversation's code loads when the
person opens Ask, or, for a panel left open before a reload, once the page
beside it is usable (the frame shows "Loading..." and keeps its space
meanwhile, so the page does not shift). Hovering or keyboard-focusing the
field offers the Ask chunk to the warmup scheduler as link intent. The
panel reports busy work (a card being filled or saved, the mic) under no
route key, so optional work waits for it, but it never makes a route
ready.

Focus and keys: the panel is a complementary landmark named by its heading
("Ask", "New entry", …). A person's open puts focus in the message box; a
panel restored after a reload does not take focus. `/` while it is open
returns focus to the message box. Close ("Close Ask") and Escape close it,
and focus goes back to the field without reopening it. Escape closes the
popup unless a menu or picker inside handled it or the person is typing in
a field on the page; the docked panel, a fixture beside the page, closes
only when focus is inside it.

## AI first

Owner decision, 2026-10-13: AI understands, the app validates, rules are
the offline backup. Every message (typed, spoken, a chip's answer, the
money jobs menu's question, a message on the Apple Pay card, the Entries +
card or the Splits receipt card) goes first to `POST /api/ask/turn`
(`src/server/ask-turn-route.ts`) with:

- `text`, and `history`: the last 8 lines of the conversation
  (`buildTurnHistory` in `ask-turn-api.js`: the person's messages as
  written, and a short line for each thing Ask showed back);
- `viewId`, `scope`, `month`, and `page` (`ask`, or the page beside the
  desktop panel);
- `focus` (`buildTurnFocus`): the saved entry by id (the Apple Pay card, a
  card saved in this conversation), else the card being filled (its
  fields), else the split group Ask was opened for. The server loads the
  saved entry itself from the household's rows; an id that is not one is
  no focus.

The route (`src/domain/ask-turn.ts`) sends Claude Haiku (through AI
Gateway, logging and caching off; Workers AI as its fallback; one
allowance unit) the conversation, a compact context (people, wallet,
category, split group and plan line names; the focus described without
any amount or account number) and one JSON schema. The model answers with
exactly one action, and the server checks it before anything shows:

| Action | Checked | Page shows | Save |
| --- | --- | --- | --- |
| `draft_entry` | wallet active, category and person exist, amount written by the person, date not in the future, description words the person wrote | the entry card, filled (fields marked AI) | the card's Save, `/api/entries/create` |
| `edit_draft` | the same, field by field; a saved card is not edited | the card being filled, changed | the card's Save |
| `draft_split_expense` | as `draft_entry`, plus payer, shares (one stated share is enough; two add up to 100%), group | the card with Shared and the Splits switch on | the card's Save, with `addToSplits` |
| `add_entry_to_splits` | the saved entry in focus is the household's, an expense, not on Splits yet; the payer is the entry's own; one stated share is enough, the other person has the rest (percent, a written amount, or "all"; two stated shares add up to 100%; none stated is 50/50); the group exists and has the entry's currency | the Add to Splits draft card (each share computed from the entry's amount) | Add to Splits, `/api/splits/expenses/from-entry` with `splitBasisPoints` (or `splitAmountMinor`) |
| `draft_settlement` | two different people, an amount the person wrote, a date not in the future | the settle-up payment draft card | Record payment, `/api/splits/settlements/create` |
| `plan_change` | line names and amounts the person wrote (`parsePlanAiReading`), drafted against the real plan rows | the plan draft card, its question or note | Save plan, `/api/month-plan/apply-changes` |
| `answer_question` | the topic, months and person, written as one sentence the answer route's own reader reads as the same topic | the money answer (or the check before one) | none |
| `search_entries` | categories and wallets exist, amounts written, words the person wrote | the Entries answer card | none |
| `open_page` | a known page; the view and month carried | a note, and the page opens | none |
| `ask_clarification` | the question and up to 4 chips, without a figure the person or context never said | the question above its chips; a chip is sent as the next message | none |
| `cannot_help` | the same | a note | none |

Anything that does not check out becomes a question back (with the
household's own people, wallets or groups as chips), never a guess: an
unknown person, shares that do not add up, an amount the person never
wrote, a foreign or missing entry, a group in another currency.

 or "dollars" is money, `%` or "percent" a percentage,
and a bare number is a guess: above the entry's total it is a percentage,
otherwise dollars (1.6 on $7.90 is $1.60). The draft card lists both people
with an amount and a percent; when a bare number was read as dollars it also
offers "Is that a percentage instead?" (`proposal.percentGuess`), which
re-sends the message as "Add to splits, Joyce's share is 1.6%" and replaces
the draft. A share above the total, above 100%, negative or $0 is asked back
in plain words ("Joyce's share can't be more than $7.90."), no chips.

AI off or failing, with a saved entry in focus: the route still reads a share
in the message with `readSharesByRules` ("Joyce's share 1.6", "Joyce pays
2", "Joyce owes me 1.60", "Joyce 30%", "Tim 70%", "all Joyce", "split
50/50"), checks it the same way and answers `{ mode: "rules", action, reply
}`; the page shows the draft after its one-line rules note. Any other message
is answered at once as before. Tests: `tests/ask-turn-shares.test.mjs`,
`tests/ask-turn-route.test.mjs`, `tests/e2e/ask-ai-turn.spec.js`.

The owner's example: on the Apple Pay card, "Add to splits, all Joyce" (or
"I meant all splits share is Joyce, I'm the owner") reads as
`add_entry_to_splits` with Joyce's share 100%; the draft card shows Tim
paid, Tim 0%, Joyce 100% of the entry's amount; Add to Splits saves it and
the saved card shows it is on Splits.

AI off, over its allowance, failing or unusable: the route answers `{ mode:
"rules", reason }` at once (with AI off, before any data work or
allowance use), and the page reads the message with its rule readers
exactly as before (`readSentenceByRules`: plan request, money question,
filter, then the entry draft), with the one-line note "AI isn't available
right now, so Ask read this with its built-in rules." once per
conversation (`rulesNoted`). On the public demo, whose caps are its own
(`AI_ASSIST_DAILY_LIMIT` 50 a Singapore day and
`AI_ASSIST_VISITOR_DAILY_LIMIT` 10 per hashed visitor, in the demo D1), a
used-up cap answers `{ mode: "rules", reason, notice: "demo_allowance" }`
and the note reads "The demo's Claude allowance is used up for today, so
Ask is using its built-in rules." instead.

### Three principles

Owner request, 2026-10-14: fix the class of failure, not the phrase. Every
Ask action follows these three rules, and every new Ask action must too.

1. **The model states intent, the server completes.** The model reports only
   what the person said, as they said it: a name as written ("joyce's", "J",
   "citi"), a month or day as a word ("september", "last month",
   "yesterday"), an amount without units ("1.6", "fifty"), a share as stated
   ({person, value} with value "all", "70%", "$1.60", "1.6", "half"). It is
   never asked for a computed number: no remainder share, no converted
   amount, no worked-out date. The server derives all of it:
   - names: `matchName` (`ask-turn-names.ts`) matches people, wallets,
     categories and groups by exact name, initial, a word of the name, a
     containing word or a typo (a swapped pair counts as one); two that fit
     equally are ambiguous and asked, never guessed;
   - days and months: a day or month the message itself names wins over the
     model's (`findDayIn`, `findMonthIn`) and fills one the model left out;
     words are read from today (`readDayWord`, `readMonthWord`); nothing said
     is the month in view;
   - amounts: symbols, words, `k`, a decimal comma (`readAmountMinor`); a
     figure the person never wrote is replaced by the one amount the message
     does state, and with none or several it is no amount;
   - shares: one stated share is enough, the other person has the rest; a
     bare number is told apart by what is written beside it and the entry's
     total (`ask-turn-shares.ts`); a second figure the person never wrote is
     the model's and is dropped;
   - defaults: the entry in focus (its payer, wallet, amount), the viewer for
     "I", this month, the only split group.
2. **Draft with visible assumptions; ask only when outcomes differ.** What
   the app assumed is said in plain words on the reply (`assumptions`: a line
   and up to 3 chips; the page shows it under the draft, and a chip is sent as
   the next message, like any question's chip). A name that fits nothing in an
   optional field of a new draft (wallet, owner, category) leaves that field
   off, says so and offers the nearest names; an even split nobody asked for,
   a payer other than the entry's owner, a group in another currency, a bare
   number read as dollars (the existing "Is that a percentage instead?" row),
   an unknown person in a question or search ("I used the whole household")
   are all assumptions, not questions. Ask only when two readings lead to
   materially different saves or answers: the rule is `decideReadings`
   (`ask-ambiguity.ts`). Each reading has an effect (what would be written or
   answered) and a basis (stated, focus, default, guess); one effect is
   settled; one strongest reading is drafted (shown as an assumption when it
   was a default or a guess); several different effects at the strongest
   basis are asked, with the readings as chips (two split groups for "settle
   up with Joyce", two categories for "subscriptions", two people for "J").
3. **Repair before asking.** When the checks refuse the model's action for a
   reason the model can fix (`ASK_REPAIRABLE_CODES`: a name, day, month, share
   or plan line they could not use), the route sends ONE repair turn
   (`ask-turn-repair.ts`): the turn's own prompt, the refused answer without
   its nulls, and the errors as a machine-readable list (`code`, `field`,
   `got`, and the valid options: people, wallets, categories, groups, plan
   lines). The corrected action is used only if it checks out; otherwise the
   person gets the original question, with its chips. Never repaired: the
   model's own question, and a question only the person can answer (an amount
   they never gave, which of two things they meant, a share that is simply
   too big). At most one repair per message; it counts as a second allowance
   unit (about US$0.001), uses the same scrubbed context, and sends no
   account number or amount from the household's records. The route logs one
   line per repair: `{"event":"ask_turn_repair","action","validatorError",
   "field","repaired"}`, never the message, a name or an amount, so the
   repair rate can be measured in the Worker logs. The response carries
   `repaired: true|false` when one was tried (the page ignores it).

### Category and reply source

Owner request, 2026-10-14 ("coffee 4.50" came back as Other). The category of
a drafted entry is chosen by the server, in this order: (a) the household's own
category rules on the description, (b) a small built-in word list for everyday
words ("coffee", "kopi", "lunch", "grab", "groceries", "mrt"...) mapped onto
categories that exist (`category-keywords.ts`, also used by the offline rules
reading in `entry-draft.ts`), (c) the model's category when it is a real one
other than Other, or when the person named it in the message, then (d) Other
(Other - Income for income), said as the assumption "I couldn't tell the
category, so I used Other." Root cause: the household rules are bank
merchant patterns, so a plain word matched nothing and the draft fell to Other;
the model's "Other" then won over everything.

Each reply carries a quiet caption saying where it came from: "Reply from
Claude", "Reply from the basic model" (Workers AI fallback) or "Reply from the
built-in rules". The `/api/ask/turn` response has `provider: "claude" |
"workers-ai"` on an `mode: "ai"` answer (the provider that produced the final
action; the name only, nothing else is stored); `mode: "rules"` is the
built-in rules. Copy: `askCopy.turn.source`. The caption is a thread item
(`source`, not stored with the conversation) and is skipped when Ask opens a
page.

The same category rule runs when a message changes the card being filled
(`edit_draft` on a draft, `validateDraftPatch`): a follow-up like "coffee"
after "coffee 4.50" re-reads the category from the household's rules, then
the word list, so the card is never left on Other when a word fits; a category
the person named stays, and a message that is not about what it was ("make it
6") leaves the category alone. Nothing fitting keeps Other and says so. The
word list matches the household's own names ("Food and Drinks", "Transport").
Root cause of the owner's "coffee" still showing Other: the follow-up took the
patch path, which never read the word list, and the model's Other was kept.

### Discard

A draft card that is not saved (status `draft`, not empty) has a quiet
**Discard** button under its rows (`BottomActions`, the same quiet button as
Not now on the other draft cards, at least 44 px on a phone). It removes the
card from the chat (in Add mode, resets it to a blank card), clears any open
question and adds the calm note "Discarded the draft." Nothing is sent to the
server (a draft was never saved), and Save works as before on the next draft.
A saved card has no Discard (it has Undo). Copy: `askCopy.card.discard` and
`askCopy.card.discarded`. Screenshots: `docs/audits/ask-discard/`. Specs:
`tests/e2e/ask-ai-turn.spec.js`.

### Eval bank

`tests/fixtures/ask-eval-utterances.json` holds 151 realistic messages across
every Ask action (typos, shorthand, partial information, unit ambiguities, the
owner's own phrasings), each with the action and reply it should end with and
the answer a good model records for it. Two runs share it
(`tests/support/ask-eval-bank.mjs`):

- `tests/ask-eval-bank.test.mjs` (in `npm run test:unit`) replays every
  recorded answer through the real Worker route on a seeded household with no
  model, so the server's completion, validation and repair logic is proved on
  every run; it also fails if the bank shrinks below 100, misses an action, or
  a recorded answer stops fitting the schema the model is given.
- `npm run eval:ask` sends the same messages to the real model: manual, not
  in CI, cap-aware (a spread sample of 30 by default; `--all --yes` for the
  whole bank; `--ids`, `--group`, `--limit`, `--dry`), printing PASS or FAIL
  per message, the pass rate and the repair rate.

A new Ask action adds its messages to the bank (its happy path, a typo or
shorthand, a partial message, and a message that must be asked back) before it
ships.

### Phase 2: changes to saved data

The same turn can change what is already saved
(`src/domain/ask-turn-actions.ts`, inventory in
`docs/proposals/ask-ai-first/inventory.md`). Each change is checked in two
pure stages: the action against the context (the entry, list or group in
focus, people, wallets, categories, groups, plan lines, the person's own
words), then, when it needs the household's rows, the route reads them
(`src/domain/ask-turn-resolve.ts`) and the builder decides the card. The
page shows a change card (`AskChangeCard`, `data-change-draft` draft,
saving, saved, undoing, undone) listing each row that changes before and
after and the entries it touches; its button posts the card's steps, each
an existing command in `ASK_CHANGE_PATHS` (the page checks its own copy
and drops a card naming anything else). Saved, it offers Undo where the
command can take it back, and Open on the page that shows it.

| Action | Checked | Card | Save (Undo) |
| --- | --- | --- | --- |
| `edit_saved_entry` (also `edit_draft` on a saved card) | the saved entry in focus; amount the person wrote, date not in the future, wallet active, person and category the household's, note in the person's words; a statement-certified entry keeps amount, date, description and wallet (a note says why) | each field before → after | `/api/entries/update` with every other fact kept (the old values) |
| `recategorise` | the category exists and is not Transfer; one entry in focus, or the person's words (or the Entries answer in focus) | one: the category; many: the count, the first 8 entries, "Yes, change all N" over 10, refused over 200 | `/api/entries/update-category` with `changes` (each back); after a bulk save, the optional rule through `/api/category-match-rules/save` |
| `edit_note` | entry in focus or a month; the person's words, at most 200 characters | note before → after | `/api/entries/update-note` or `/api/month-note/update` (the old note) |
| `link_transfer` (also `edit_saved_entry` with type Transfer, a category of Transfer, or `recategorise` to Transfer, on one saved entry) | the saved entry in focus, not already linked or on Splits; the Entries transfer dialog's own candidates, narrowed by the wallet and day said; see "Transfers: the other side" | from, to, the two entries, the choices | `/api/transfers/link` (none), or the entry update for "No other side yet" (the old type and category) |
| `split_group` create / move | a new name in the person's words; the split of the saved entry in focus, a group with its currency | name and currency; group before → after | `/api/splits/groups/create` (none); `/api/splits/expenses/update` (the old group) |
| `split_group` settle | the group named or in focus; its balance as Splits shows it | the settle-up payment draft card | Record payment, `/api/splits/settlements/create` |
| `split_group` simplify | the plan the command itself reads (`planSplitSettlementCheckpoint`) | who pays whom, the amount, how many open splits | `/api/splits/checkpoints/create` (`/api/splits/checkpoints/reopen` with the created id) |
| `review_matches` | the month's matches as Splits lists them, at most 6 | `AskMatchesCard`: each split and bank row; Match, Not this one | `/api/splits/matches/link-expense` or `link-settlement` per match |
| `set_payment_way` | an active bank wallet for PayNow, an active cash wallet for cash | PayNow and Cash before → after | `/api/settings/payment-ways/save` (the old choices) |
| `edit_category` | create: a new name; rename: not a built-in category; colour: a palette colour (any other word opens Settings) | name or colour before → after | `/api/categories/create` (none), `/api/categories/update` (the old name or colour) |
| `link_plan` | a planned item of the month; its expenses with the words, not yet linked | the line, the count and first 8 | `/api/month-plan/links` with the old links kept (the old links) |
| `cannot_help` with `blocked` | one of: delete an entry, month or import, import a statement, undo an import, reconcile, accounts, people | a note with the app's reason, then the page opens | none |

#### Transfers: the other side

Every Ask path that makes an entry a transfer asks the question the Entries
transfer dialog asks: which entry on the other side? There is one rule set,
`selectTransferCandidates` in `src/domain/transfer-candidates.ts` (the same
amount in another wallet within a month; opposite direction first, then the
closest date, then the wallet). The dialog's loaded rows
(`getTransferMatchCandidates`), its Recheck matches
(`loadTransferMatchCandidates`, `GET /api/transfers/candidates`), Ask's
`link_transfer` and the draft search below all call it, so they cannot
disagree. `chooseTransferOptions` then applies what the person said.

- A saved entry becoming a transfer (`transferRequest` in
  `ask-turn-actions.ts`, `buildTransferLink`): the change card pre-selects the
  best match (its date, wallet and amount are in the card), shows up to 3
  other candidates as chips, and, while the entry is not a transfer yet, a
  last chip "No other side yet (keep as an unmatched transfer)". Entries
  already paired, or on Splits, are never offered. Saving a match is
  `/api/transfers/link` (one batch, both sides); "No other side yet" is the
  entry update with type Transfer and the Transfer category, and keeps its
  Undo. The page saves the chosen option's steps (`effectiveChange`).
- A wallet the person names ("to my UOB One", `to_wallet` or
  `transfer.wallet`) keeps only that wallet's candidates. With none there the
  card says so ("Nothing in UOB One has this amount. These other accounts do.")
  and offers the others; with no candidates at all it says "Nothing in UOB One
  has this amount." and offers only "No other side yet". The entry's own
  wallet is never the other side.
- A new transfer drafted in Ask: the card asks
  `GET /api/transfers/draft-candidates` (`date`, `accountId`, `amountMinor`,
  `transferDirection`) once the amount, date and wallet are set and have
  settled (`use-ask-transfer-match.js`), and shows the best match selected
  under the rows (`AskTransferMatchRows`) with the same chips. A To wallet on
  the card narrows them as above. Save creates the entry through the
  composer's create path, then pairs it with the chosen entry through
  `/api/transfers/link` ("Saved to Entries and linked to the other side."); a
  failed link keeps the entry and says so. A linked save has no Undo
  (removing the new entry would leave the other side changed).
- No AI: with the model off, a drafted transfer card gets the same candidates
  (they come from the card's fields, not from the model).

After a save the card's `refresh` list drives the owners: entries, month and
summary through `onEntryMutation`, splits through `onSplitMutation`,
settings data through `onSettingsMutation` (App.jsx
`refreshCurrentSettingsPage` with reference data), and the saved card in
focus shows the change. A message right after an Entries answer sends that
list as the focus (`entry_list`: its month, words and categories, never
its rows).

Tests stand in for the model with the `X-Ask-Turn-Test-Reply` header, read
only when `APP_ENVIRONMENT` is `test` (`tests/e2e/ask-ai-turn.spec.js`,
`tests/e2e/ask-ai-turn-phase2.spec.js`).
`scripts/ask-turn-eval.mjs` runs about 30 messages through the real model
when provider credentials are in the environment (not in CI).

## State Flow

Ask state is split between:

- route state: the way in (`readAskIntent`) and the view, month and scope;
- the conversation, owned by the Ask conversation store
  (`ask-conversation-store.js`, see "Continuity"): the person's messages,
  receipt thumbnails (memory only), the page's notes, answers, the one
  entry card and where it sits in the thread, the words typed but not sent,
  and an open follow-up (a filter question or a view change);
- the turn drafts in the thread: `split-proposal` and `settlement-draft`
  items (`draft` → `saving` → `saved`, or `discarded`; an add to Splits
  can be undone back to `draft`), kept in the conversation store; a
  settle-up payment caught mid-save comes back `unsure` (check Splits)
  rather than a second Save; and a `turn-question` follow-up (a question
  with its chips) as the open follow-up;
- workflow state in `AskConversation` (`ask-panel.jsx`): what is being read
  or saved, which picker or detail fold is open;
- the card itself, a pure state machine (`ask-card-model.js`): `draft` →
  `saving` → `saved`, back to `draft` on a failed save or Undo; its variant
  (expense, income, transfer); `filled` (which fields a sentence, a rule, AI
  or a receipt supplied); `questions`; the `share` switch; `saved` (entry,
  split expense and group ids).

The chip row and the composer's primary button belong to the newest thing
in the conversation (`ask-chips.js` `findActiveItem`): an open follow-up
question or view change; else an answer that is the newest item and sits
below the card; else the card, while the person has said nothing since it
(a message that changes the card moves it below that message; notes such
as "Saved to Entries." do not count); else nothing. `buildChipRow` builds
the row for it: the card's chips (`buildAskChips`) only while the card is
active, `buildFilterChips` for an answer, a follow-up or a view change.
Save shows, and Enter on an empty message box saves, only while the card
is active. An unsaved card further up is kept: the row then offers "Back
to the unsaved entry", which moves the card below what was said since
(its `cardSlot`), so its chips and Save come back. Nothing else in Ask
holds chip state. A card being edited, read or saved, or the mic
listening, reports the route busy, so no optional warmup runs under it.

Voice input has its own small state machine (`ask-voice.js`,
`createVoiceController`): `idle` → `starting` → `listening` →
(`transcribing` →) `idle`, or `hidden` when neither voice path is available.
Its words only ever change the message box (`composerText`); see "Voice
input" below.

### Continuity

The conversation lives above the routes in the Ask conversation store
(`ask-conversation-store.js`, design.md "Ask conversation store"), one per
way in, at most three. The page reads and writes it only through the store
(`useAskConversation`), so a reader result or a save that lands after the
person left still lands in it.

- Leaving Ask (another tab, a chip, the From Ask chip's way back) and coming
  back restores the thread, the card with its filled fields, the composer
  text and the scroll position (near the bottom, as it was). What was there
  shows at once, without arrival motion.
- A reload in the same browser tab restores it from sessionStorage
  (`monies.askConversation.v1`): versioned, at most 60,000 characters
  (oldest messages dropped first), and anything unreadable is dropped and
  cleared. Never localStorage, never the server.
- Never stored: photos (and any blob: or data: value), audio, and status
  lines. A receipt's read fields stay in the card; its thumbnail leaves the
  conversation with the page. A card that was saving comes back as a draft
  with its client id (see "Data Flow"), so saving it again resolves to the
  entry already made, if that save had reached the server, and shows Saved.
- `New chat` (chat mode, once there is something to start over from)
  clears that conversation. A saved card in add mode ends that visit: the
  next + starts a new card. Undo and Save work as before.
- While a conversation is in progress (something said, a card being
  filled, words typed) and the person is on another tab, the Ask tab shows
  a small accent dot, and its link reads "Ask, conversation in progress".
  The shell reads only that flag, from `ask-conversation-presence.js` (also
  in sessionStorage, so a reload shows it without loading Ask).

### Search and filter

A typed request is read on the device by the filter reader
(`ask-filter-reader.js`): no request and no AI. It uses the people, wallets
(active ones) and categories already loaded, and the view, scope and month
Ask is looking at:

- month words: this month, last month, a month name ("sep", "september",
  "Sep 2026", "2026-09"; a month later than this one means last year's),
  "today" and "yesterday" (that day's date as search words);
- people ("serene's") and the household; scope words (shared, direct or
  personal, direct and shared); entry type words (income, transfers,
  spending, spent);
- wallets by full name, brand or bank ("citi", "posb"); categories by name,
  singular or plural ("groceries", "public transport");
- amount limits: over, above, more than, at least, under, below, less than,
  between X and Y (compared with the amount the row shows for the view);
- anything left (not a filler word) as search words ("grab").

It returns one of:

- a filter: an answer card (below);
- a follow-up question when something could mean two things: a word that
  fits several wallets or categories (one chip each, then "All of them"),
  two months ("Entries shows one month at a time"), two people, a scope on
  the household view, or an unknown category with near names. Questions
  are asked one at a time; the chips are the only options;
- a view change ("switch to Serene", "household view", "shared only"): a
  "Switch to …" chip that sets the route's `view` and `scope`, the same
  change the View and scope bar makes. Nothing changes until it is tapped;
- unknown (a category named as a category that does not exist): a note;
- none: an entry sentence (an amount without over or under, or today and
  yesterday outside a question) goes to the entry reader as before, and a
  question it cannot read gets the "not answered yet" note.

A money question is read before the filter reader (see "Money
questions"), so "why was August so expensive?" is answered rather than read
as a search for "expensive". While a card
  is being filled, a plain sentence ("groceries", "split with Serene") is a
  change to the card; only a question, or a request with a month,
  someone's name with 's, or an amount limit, is read as a search.

The answer card (`ask-answer-card.jsx`) leads with the total (Spent, Income
or Transfers out, as the Entries totals strip names it, and the view's
share when it differs), the count ("6 entries") and the filters as chips
(month, person and scope, category, wallet, type, amount, search). Its
numbers come from the Entries page DTO for that view and month: borrowed
from the query cache, else read through the shell's lease
(`fetchQueryWithLease`). The filter goes through the Entries URL it opens
(`buildEntriesFilterSearch`) and back through the Entries page's own reader
(`readEntriesFilterParams`) and filtering (`getEntryDerivedData` in
`entry-filtering.js`), so the card and the page agree by construction. Only
the filter is kept in the conversation; the numbers are read again each
time it shows. A month with no entries at all says so and offers no Open
in Entries (Entries would show the nearest month).

`Open in Entries` (the answer's first chip, filled) opens
`/entries?view&month&scope&entries_scope&entry_search&entry_wallet…&entry_category…&entry_type&entry_min&entry_max&from_ask=1`.
`from_ask=1` shows the From Ask chip on Entries (`entries-flow.md`); its
back button returns to `/ask` with the view, month and scope, where the
conversation is as it was.

### Money questions

A question the filter reader would not answer well is read first by the
answer intent reader (`src/domain/ask-answer-intent.ts`, rules only, shared
with the route): it must read as a question (ends with "?" or starts with a
question word, "compare", "show", "top"...), name no amount, and match one
of nine intents:

- `spending`: "why was August so expensive?" (why) or "where did September
  go?", "what did I spend the most on?" (where);
- `plan` (intent against outcome): "how am I doing against the plan?",
  "am I on track?", "over budget?", "how did September go?", "how was
  August?", "did we stick to the plan in Q3?", "how did my spending
  compare with the plan?" (against the plan is never a second month);
- `compare`: "compare August with July", "August vs September", "did I
  spend more than last month?" (one month named after to, with or than is
  compared with the month in view; "compare July" with the month before);
- `biggest`: "what's my biggest expense this month?", "top expenses in
  sept" (one naming a category or wallet stays a filter request);
- `income`: "how much income came in?", "what did we earn in August?";
- `owed`: "what do I owe Serene?", "who owes who?", "are we settled up?";
- the money jobs (DOMAIN.md "Money job"), read before a comparison so
  "compare my spending with my income" is not two months:
  - `invested`: "how much did I invest in September?", "how much went
    into investments?", "did I hit my investment goal?" ("invest in a
    new phone case" names a purchase and is not one);
  - `saved`: "how much did I save?", "did I hit my savings target?",
    "how much did we keep in August?", "what did I put aside?" ("keep to
    the plan" is the plan);
  - `spentVsEarned`: "why did I spend more than I earned?", "did we spend
    more than we made?", "how did my spending compare with my income?",
    "spending vs income in August?".
  A search command ("show", "find", "search", "list", "filter") is never
  one, and one naming a wallet, or a category other than the jobs' own
  Investments, Savings and Salary, stays a filter request, as does one
  measured against another month ("did I save more than in July?").

A period reads as its months, oldest first, up to this month: a quarter
("Q3", "q2 2026", "the third quarter", "this quarter", "last quarter";
without a year the latest one that has started) or a range ("from Oct 2025
to Sep 2026", "between July and September"; a start said without a year
that falls after the end is the year before), at most 12 months (the
Summary's default range). The plan, spending, income and money-job answers
add the months up (`combineMonthFacts`); a period in a biggest or compare
question, one longer than 12 months, or one that has not started is not
answered rather than answered for one month.

Month words read as the filter reader reads them; with none, the month in
view. The page then sends `{ text, viewId, scope, month, keepCandidateIds }`
to `POST /api/ai-assist/answer` (status line "Working that out…"), which
reads the question again and answers with one of:

- `{ supported: false }`: the "not answered yet" note, as before;
- `{ needsConfirmation, candidates }`: the check before an answer (below);
- `{ answer, wording }`: the money answer card.

The money answer card (`ask-money-answer-card.jsx`, the shared LeadCard,
design.md "Money answer"): Lead, the figure asked about with its label
("Spent · 51 expenses", "Came in · 2 entries", "Balance") and the
actual-vs-plan bar when there is a plan; Support chips (the plan, the other
month, the largest shares, Splits groups); then the wording (one to three
sentences) and Detail lines (categories, the biggest expenses, plan rows
with their plan, the categories that moved most, income sources, Splits
groups and settle-ups to pay). Money tones as everywhere: the spending
lead is rose only over plan, income mint, an expense line rose text, a plan
sky. With money hidden the amounts are masked and the wording and lines
give way to "Reveal money totals to read these insights." Its chips are its
links, the first filled: `Open in Entries` (the answer's Entries filter
through `buildEntriesFilterSearch`, with the From Ask chip), `Open Month`
(`/month` with the answer's view, month and scope), `Open Splits`
(`/splits` with the group of the largest balance), then the usual chips.

The plan answer is Intent vs Outcome (mockups `chat-intent-*`): its lead
is the Month and Summary lead's own "Spent" and "of $X plan", the spend
job's figures (`spendJobFacts`, through the shared `splitMoneyUse` in
`src/domain/money-jobs.ts`: Actual spend less money filed under Investments
or Savings, against Planned spend less the Savings target and the
Investments plan rows), with the plan bar; its Plan chip, wording and
prompt facts use the same two figures. Under it the Month and Summary
lead's savings bar (`SavingsBar`, from the answer's `outcome`: income
received, Actual spend, Planned spend, the Savings target, money moved to
Investments and Savings, and the Investments plan rows, the Month page's
own, split the same way), then Plan and Income chips, the wording and
the plan rows that went furthest over. Its links are Open Month and Open in
Entries. A quarter's answer adds the months up (`combineMonthFacts`), lists
each month against its plan first, and links Open Month for its last month
only (Entries shows one month at a time).

The money jobs' answers are read through the same split as the Month and
Summary lead (`moneyUseOf` in `ask-answer-facts.ts`, the shared
`splitMoneyUse`), each with the lead's savings bar under it (`outcome`):

- invested: title "<period> investing"; Lead "Invested", the Investments
  share of the Spending Mix, against the invest job's plan (the plan's
  Investments rows; more is fine); chips Plan and Income; lines the largest
  Investments entries in plain ink (moved, not spent); links Open in Entries
  filtered to the Investments category (when anything was invested; with
  `investmentMovesIn` / `entry_invest_moves=1` when money was moved into an
  investment account, so the transfers into those accounts list too), then
  Open Month. Wording: "You put $1,200.00 into Investments in May. That's
  $300.00 short of the $1,500.00 you planned to invest. The largest was
  iFAST GIRO at $1,200.00 on 3 May." When the amount includes money moved
  into an investment account it reads "You invested $3,200.00 in May."
- saved: title "<period> savings"; Lead "Saved", the lead's kept (income
  less spending less invested; below zero when more went out), against the
  savings target; chips Income, Spent, Invested; lines the largest moves
  into Savings, then the spending categories; links Open Month, then Open
  in Entries filtered to Savings when money was moved there. Wording: "In
  May you earned …, spent … and invested …, so you kept ….", then the
  target ("… short of your … savings target") and "… of it went into
  Savings."
- spentVsEarned: title "<period> spending and income"; Lead "Spent" (the
  spend job's spending), chips Income and Invested; lines "Came out of
  savings" (rose) or "Kept" (mint), then the three largest spending
  categories (the Spending Mix without Investments and Savings) with their
  share of that spending; links Open in Entries (expenses), Open Month.
  Wording: "In May you earned …, spent … and invested …, so … came out of
  savings. Most of the spending went to home (…), … and …. Spending was …
  more than the … you planned."

The skew check covers them too: invested checks spending skew; saved and
spentVsEarned either spending or income skew. A period's answer (and a
quarter's spending or income answer) links Open Month for its last month
only. With money hidden their titles, lead labels and chips say nothing
about which side of a plan or of income the money fell, the wording and
lines give way to the hidden note, and the savings bar is the lead's own
hidden bar (shares of income, no amounts). The client adapter
(`readMoneyAnswerResponse`) keeps the bar's invested, moved-to-Savings and
Investments-plan figures (it used to drop them, so the plan answer's bar
showed nothing invested).

Every figure comes from the server's facts: the Month page DTO of the view
and month (the Actual spend and Planned spend cards, the summary month's
income, the Spending Mix donut and its shares, the view's entries and plan
rows) and, for who owes whom, the Splits page DTO seen by one person (the
view's person; on the household view the other person when someone is
named, else both names): open group balances and open settle-ups. A month
with no entries says "There are no entries for … yet."

The check before an answer (owner decision "stop and ask first"): before
explaining any figure, the route runs the skew candidates (DOMAIN.md "Skew
Candidate") for the month(s) the answer covers. A high-confidence one that
would change the facts (spending skew for spending, plan, compare and
biggest; income skew for income; any settlement for who owes whom) comes
back instead of an answer. The page shows it as a card with the butter
"Check this first" tag, who paid whom (or which accounts) and the amount,
and two chips:

- `Mark as settlement` (a settlement) or `Link as transfer` (an own-account
  move): the candidate's `suggestedActions` posted in order through the
  existing routes (`resolveSkewCandidate`, which refuses any other path; a
  group settle-up is then linked with `/api/splits/matches/link-settlement`).
  On success the note "Marked as a settlement." (or "Linked as a
  transfer."), the entry and split mutations are published, and the same
  question is asked again; a failure is a note and the check stays open;
- `It's real spending` (or `It's real income`): nothing is written; the
  note "Kept as spending." and the question is asked again with that
  candidate in `keepCandidateIds` (kept with the check in the conversation).

The wording is computed (`source: "template"`) unless AI is on and its
phrasing passes validation (see "Data Flow"). AI words (`source: "ai"`)
carry the entry card's butter tag, "Worded by AI", above the card's head
line; the computed wording has no tag, and with money hidden the tag goes
with the words.

### Insight questions

Each Money insights line with a signal behind it (the headline, each Also
line, and the folded teaser's top line) has "Ask about this"
(`financial-insight.jsx`; design.md "Money insights fold", DOMAIN.md
"Insight Question"). The tap sends the `monies:ask-insight` window event
(`insight-ask-event.js`) with the line as shown, its think line, the
signal's primary figure and its `basis` (the figures the signal already
worked out, with plain labels, and the entries behind it). The shell
(`use-insight-ask-launcher.js`, App.jsx) adds the view, scope and month
the page was showing and opens:

- on a phone, `/ask` (chat) as a new history entry with the insight in
  `state.askInsight`. The page asks it once and replaces the entry without
  it (a module WeakSet guards StrictMode's second run), so Back, Forward
  and a reload never ask it again;
- on a wider screen, the Ask panel beside the page (`openAskDock` with the
  chat way in and `insight`; the dock store hands it over once, in memory,
  and the new visit remounts the chat, which takes it). The page stays.

Ask then (`askAboutInsight` in `ask-panel.jsx`), at once and with no
request: the person's message "Explain: <the line>" (no closing full stop)
and the insight answer card (`ask-insight-answer.js` builds it,
`ask-insight-answer-card.jsx` shows it; design.md "Insight answer"): the
line, the figure it is about (the basis line holding the primary amount),
the think line, "What it's based on" (the basis lines) and, when entries
are behind it, "The entries", read from the Entries page DTO of that view
and month (borrowed from the cache or read through the shell's lease) and
the Entries page's own filter, so Open in Entries shows the same rows.

The chip row (`findActiveItem` treats it as a money answer): Open in
Entries first when entries are behind it (`buildEntriesFilterSearch` with
the entry ids, or a category, wallet or type, and `from_ask=1`; entry ids
count for the From Ask chip, "2 entries", and its ✕ clears them), then the
kind's follow-ups:

- statement mismatch: Compare with the statement (`/imports`);
- plan doesn't add up: Change my plan (planning by chat: " in <Month
  Year>" goes in the message box with the caret before it, for the person
  to type the change, "cut shopping by $100", and send; the draft card
  saves nothing until Save plan), then Open Month;
- bills not matched or coming up, savings on plan: Open Month;
- over plan, plan left, pace: Open Month and "How am I doing against the
  plan?";
- income above plan or arrived: "How much income came in?";
- Splits balance, settlement payment: Open Splits (the group) and "Who
  owes who?"; bank matches: Open Splits;
- spending above income: Open Month and "Why was <month> so expensive?";
  a category rising: that question; months under plan: the plan question;
  the five largest: "What were the biggest expenses?".

A question chip is asked as if typed, through the answer route with its
check before any figure (see "Money questions"), for the insight's view,
scope and month.

Then, with the status line "Working that out…", one `POST
/api/ai-assist/insight-explain` (see "Data Flow"). Only an explanation that
passed the check is added under the think line, with the "Worded by AI"
tag; AI off, out of allowance, failing or a phrasing that fails the check
changes nothing, and the card is complete without it. No forecast and no
safe-to-spend: the card holds only the insight's own figures.

Hidden money: no "Ask about this" shows. An insight already in the
conversation reads "Explain this money insight", its title "A money
insight", its amount masked and its Detail "Reveal money totals to read
these insights."

### Planning by chat

A typed change to a month's plan (DOMAIN.md "Plan Draft"; mockups
`chat-plan*`) is read before the money-question and filter readers by the
plan request reader (`src/domain/plan-draft-reader.ts`, rules, shared with
the route):

- copy a month: "plan November like September", "copy September to
  November", with changes after but, and, with or a comma ("… but
  Groceries $700");
- set a line: "set groceries plan to $700 for November", "plan $700 for
  groceries in November", "groceries budget 700";
- change a line: "raise groceries by $50", "cut shopping by 100", "add $50
  to the groceries plan";
- move between lines: "move $50 from Shopping to Groceries in October" (a
  move between two wallets stays a transfer entry);
- add a line: "add a Travel line of $300 to November".

A month without a year is the nearest one (planning looks both ways). A
sentence that reads like planning (a plan verb or the word plan or budget)
but fits no shape is "unread". While an entry card is open, only a reading
that names the plan or a month goes to planning ("set the amount to 12"
still changes the card).

The page sends `{ text, viewId, month, answers }` to
`POST /api/ai-assist/plan-draft` (status line "Drafting that change…"),
which reads it again and answers with one of:

- `{ supported: false }`: not a plan request after all (or unread with AI
  off or no usable AI reading); the page reads the text as before;
- `{ question }`: chips in the chip row, one per option, the question above
  them: "Which month's plan?" (no month named, or one more than a year
  ahead or two back: this month, the next and the month in view), "Which
  line do you mean by “sports”?" (a name that fits more than one line; two
  lines with the same name say whose), "Whose Travel line is it?" (a new
  line on the household view: each person, or Shared, split evenly). A
  chip sends the same text again with the answer;
- `{ note }`: no plan to copy, the same month, no such line (a name that
  is neither a line nor a category), nothing would change, a line that
  would go below zero, or a move between income and spending;
- `{ draft, source }`: the plan draft card.

Which lines a view can change are the rows Month shows for it (a person's
own and shared lines; every line on the household view). A name resolves by
label, then category, then its words; a name that is not a line but names
a category starts a new line (a budget bucket) for the view's person.
Copying a month copies the view's lines: a line the month already has takes
the copied amount, any other is added; lines only the month has stay.

The plan draft card (`ask-plan-draft-card.jsx`, design.md "Plan draft"):
the butter Draft tag ("Read by AI" beside it when the optional AI read the
request), the head line (the line's "Groceries plan" with the month and
"was $650.00" or "New line"; "Move $50.00" with "Shopping to Groceries";
"November 2026 plan" with "Like September 2026" and the planned spend),
the person and month chips ("Planned spend stays the same" for a move),
then read-only Detail rows: each changed line before → after (six shown,
the rest behind "N more lines"), and Planned income, Planned spend and
Remaining budget before → after, as the Month cards add them. The plan
amounts are sky; Remaining budget rose when below zero. When the plan after
the change spends more than it expects to earn, the Money insights
plan-balance line shows under the rows (rose). Discard and Save plan close
the card. The intro note says "Here is the change. Nothing is saved until
you tap Save."

- Save plan posts the draft's `apply` list to
  `POST /api/month-plan/apply-changes` (one batch on the server). Saved:
  the Saved tag, "planned" under the amount, and See it on Month (`/month`
  with the draft's view and month) and Undo this change; the note "Saved to
  the November 2026 plan." The month's Month and Summary data are
  refreshed (the entry mutation with Month and Summary only). A plan
  changed since the draft is refused whole with "The plan changed since
  this draft was made. Ask again to see it as it is now."; the card stays a
  draft.
- Undo this change posts the save's `undo` list the same way; the card is a
  draft again ("Undone. The plan is back as it was.").
- Discard writes nothing: the card goes and the note "Discarded. The plan
  is unchanged." stays.
- With money hidden every amount is dots, the "was" figure and the warning
  go, and a "not enough planned" note drops its figure.

## Data Flow

Ask reads nothing of its own:

- the shell's people, wallets and categories (`appShell`, reference data);
- the Entries page DTO of a view and month (`GET /api/entries-page`), for
  the split groups the Splits switch offers, for the Shortcut's saved
  entry, and for an answer card's numbers. Read from the query cache when Entries or Splits loaded it, else
  fetched only when the card needs it, through the shell's required read
  (`fetchRoutePageResponse`, `fetchQueryWithLease` with the Entries route's
  query key), so going back to Entries joins that data;
- the Summary page and wallet pills already cached for the view, for the
  "since you last looked" card (`ask-brief-card.jsx`, composed by
  `composeCheckInHeadline` in `check-in-headline.js`). Never fetched and no
  AI on open; with nothing cached the card does not show.

The Claude credit status (`GET /api/ai-assist/provider-status`, DOMAIN.md
"AI Provider Status") is the one thing Ask reads that no other page DTO
holds, for the notice described under "Claude credits" below. It is read
lazily: only once the Ask route is first usable (App passes
`routeWork.usable` to Ask and Settings alone), never on the first screen and
never blocking. It goes through `fetchQueryWithLease` (the shell's
`fetchRequiredQuery` prop) under `queryKeys.claudeCreditStatus()`
(`claude-credit-status.js`), so Settings
reuses the same answer, and is read again only when the kept one is over
five minutes old. A failed read shows nothing.

Readers (`ask-api.js`, the one module to adjust when their branches land):

- `POST /api/ai-assist/entry-draft` `{ text, viewId }` → an entry draft
  (`{ ok, draft: { fields: { <name>: { value, source } }, transferAccount,
  questions, missing }, ai }`). Built on branch `ai-entry-draft`.
- `POST /api/ai-assist/receipt-read`, multipart with one `image` part: the
  photo downscaled to 1600 px and re-encoded as JPEG in the browser
  (`ask-receipt-image.js`), so no EXIF or location data is sent →
  `{ ok, receipt: ReceiptReadDto, ai }`. Built on branch
  `ai-provider-receipts`. When it is unavailable the app's own Tesseract
  worker (`ocr-worker.js`) reads the photo on the device and the shared
  no-AI reader (`readReceiptOcrText`, `src/domain/receipt-ocr-text.ts`)
  turns the text into the same `ReceiptReadDto`, reading a receipt with no
  printed currency as SGD.

- `POST /api/ai-assist/insight-explain` `{ kind, fact, think, lines }` →
  `InsightExplainResponseDto` (`{ ok, explanation: { text, source: "ai" } |
  null, ai }`), see "Insight questions". The body is read through
  `readJsonBody` (64 KiB, `limited-body.ts`, the same file as PR #54) and
  bounded (`readInsightExplainRequest`: a headline kind, the line and think
  line up to 400 characters, at most 12 basis lines with safe integer
  amounts and short labels; anything else is a 400 before any AI). With AI
  off it answers at once with `explanation: null` and spends nothing. With
  AI on, one allowance unit (`ask_answer`) asks the provider with the
  answer prompt (`buildAnswerPrompt`) over the insight's fact lines
  (`buildInsightPromptFacts`: the line, its think line and each basis line
  with its amount as the card writes it; every run of six or more digits
  and every NRIC / FIN shape removed first), checked by `validateAiWording`
  against those lines and the household's category, wallet and people
  names. Privacy: only those lines and the household's names (for the
  check) are read; no entry, account id or note. Cost: one unit per tap,
  never automatic. Writes: the allowance counter only.
- `POST /api/ai-assist/answer` `{ text, viewId, scope, month,
  keepCandidateIds }` → `AskAnswerResponseDto` (`{ ok, supported, intent,
  viewId, scope, months, needsConfirmation?, candidates?, answer?, wording?:
  { text, source }, ai }`), see "Money questions". Rules, the skew check and
  the facts first; then, only with AI on and a month with entries, one
  allowance unit asks the provider (`runTextJson`) to phrase the wording
  from at most 16 fact lines and the redacted question.
  `validateAiWording` keeps a phrasing only when every number is in the
  facts, it names nothing the facts do not, and it is one to three plain
  sentences (360 characters) with no advice or forecast; anything else
  shows the computed wording. The route writes nothing but the allowance
  counter.

- `POST /api/ai-assist/plan-draft` `{ text, viewId, month, answers }` →
  `PlanDraftResponseDto` (`{ ok, supported, source, draft | question |
  note, ai }`), see "Planning by chat". Rules first; only a request that
  reads like planning but fits no shape, and only with AI on, spends one
  allowance unit asking the provider (`runTextJson`, ask tier) to read the
  redacted request into the same structure. `parsePlanAiReading` keeps it
  only when every line name is words of the request, every amount a number
  written in it and every month one it names. The draft itself is built
  from the month's plan rows on the server (`loadMonthPlanRowsForDraft`,
  `buildPlanDraft`). The route writes nothing but the allowance counter.

The first two fail soft: any error leaves the card manual with a calm
note. A failed answer request is the calm note "That couldn't be answered
just now. Try again in a moment." A failed plan-draft request is the calm
note "That couldn't be drafted just now. Try again in a moment."

### Split suggestion

On a new expense card (typed, sentence or receipt) with one owner and
something in "What it was", and on the Apple Pay saved card until it is on
Splits, Ask makes one debounced (500 ms) read-only `POST /api/splits/suggestion`
(`use-ask-split-suggestion.js`) and, when the household's own history says so
(`src/domain/split-suggestion.ts`: same shop, at least 2 entries and 60%
split in one group; same category only for a shop with no history, at least
4 and 75%), shows one follow-up question in the chip row: "You usually
split this with {name}. Add it to {group}?" with "Split 50/50 in {group}"
and "Not this time". Choosing it turns the Splits switch on with that group
(nothing is written until Save; on the Apple Pay card it is the existing
Add to Splits). "Not this time" hides it for that card. Only an even share is
offered; a failed, aborted or late answer is no question. It never replaces a
field question already on the card. No AI, no new write route.

### Card suggestion

Beside the split suggestion, on the same two cards (a new expense with a shop
and a card chosen; the Apple Pay saved card until it is on Splits or shared),
Ask makes one debounced (500 ms) read-only `POST /api/entries/card-suggestion`
(`use-ask-card-suggestion.js`). When the household's own last 12 months say
so (`src/domain/card-history-suggestion.ts`: at least 3 entries at the same
shop and at least 70% of them on one other card; transfers, settle-ups,
estimates in another currency and the entry itself ignored; the other card
active and in the chosen card's currency) it shows ONE question in the chip
row: "Past {shop} entries were on {card}. Was this on that card too?" with
"Yes, {card}" and "No, keep {current card}". It comes before the split
question and before "It landed in Other" on the Apple Pay card, and after a
reader's own field question. Yes on a draft picks the card (nothing is written
until Save); Yes on the Apple Pay card moves the saved entry through
`POST /api/entries/update-account` (only the card changes; a statement-confirmed
entry, an entry on Splits, a transfer and another currency are refused). No
hides it for that card; nothing is learned from it. The request reads three
tables once each at most (the saved entry, the accounts, one history read
on the household-and-date index limited to 500 rows) and writes nothing
(`tests/card-suggestion-route.test.mjs`). It works with AI off, because AI
is not involved. A failed, aborted or late answer is no question.

### Hands-off

Owner decision (2026-10-14, "Fully hands-off for safe things"): Ask needs as
little typing and as few steps as possible, without writing anything that
matters on its own.

**Lookups.** In a turn the model may answer `look_up` with one of five
read-only tools (find_entries, get_entry, get_split_balances,
list_recent_entries, get_category_history; `ask-lookup-tools.ts`). The route
runs it and asks again with the result in a `<lookups>` block (untrusted
data), up to 3 lookups and 4 model calls a turn (a repair counts) and a token
cap, each call one allowance unit. Results are household-scoped and compact
(names through `promptEntryName`, no amounts, a balance is only who owes
whom). The final action may carry `target_entry`; it becomes the entry in
focus only if a lookup in that turn returned that exact id. "Split last
night's dinner with Joyce" is find, then the usual split proposal. Over the
budget the turn answers `mode: "rules"` ("Ask could not find that."). Test
replies may be an array (`X-Ask-Turn-Test-Reply`): the first answers the
message, the rest the later calls; the bank's `then` field records them.

**Habits.** `ask_habits` counts what the household confirms (shop to
category, shop to usual split, nickname to person). Learning is deterministic
and best effort, from the existing commands (`/api/entries/update-category`,
`/api/entries/create`, `/api/splits/expenses/from-entry`) and a confirmed
"who did you mean" chip; never from message text. Confidence and the override
rule are in DOMAIN.md "Ask Habit". An unknown person word the model used comes
back on the clarify reply as `nickname` (one short word); tapping the person
keeps it and the next turn tells the model.

**Suggestion row.** When a saved entry's card opens (Apple Pay, an Ask add,
an entry opened from Entries), the page asks `POST /api/ask/entry-habits`
once. Under the card, a single quiet row shows what the habits say that the
entry does not already have, with a tick (the existing category and Add to
Splits commands) and a cross (an override). It replaces the history-based
split question when it has a split. No notification, never an interruption.

**Done for you.** With the switch on, a high-confidence habit is applied to a
new entry without asking, only inside the safe set and every gate (new within
the hour, not imported or certified, one entry; a hand-made entry's own
category is never replaced). `/api/shortcuts/entries/create` and
`/api/entries/create` run it after the save (best effort) and opening the
card runs it again; an entry is never handled twice, so an Undo is final. A
note the person asked for in a turn (`edit_note` on a new entry) is added the
same way and the reply says so. Every line is logged and listed under "Done
for you" at the end of the Ask page with Undo and Stop doing this; an Undo
refuses an entry changed since. The change is reversed if its log row cannot
be written.

**Settings.** "What Ask remembers": the switch, the habits (change, forget
with an in-app confirm), Forget everything. Reseeding the demo clears habits
and resets the switch.

### Voice input

The composer's mic fills the message box with spoken words; the person
checks them and taps Send, which then goes through the entry-draft reader
like any typed sentence. Voice never sends anything by itself, and Send
ends any listening first.

- Place: the mic glyph sits at the right inside the message field (the +
  at its left opens Take a photo, Choose a photo and Paste; design.md
  "Composer").
- Gesture: hold the mic to talk and let go to stop, or tap to start and tap
  again to stop; Enter or Space on the focused mic toggles it
  (`createPressGesture`). A press still waiting for microphone permission
  becomes a tap, so the permission sheet never stops it.
- Primary path: the browser's own speech recognition (`SpeechRecognition` /
  `webkitSpeechRecognition`, which iPhone Safari has), `en-SG`, retried once
  in `en-US` when the language is not supported, with interim words shown
  in the box as they arrive. The words join anything already typed
  (`joinSpokenText`). Nothing goes to the Worker.
- Fallback, only when the browser has no speech recognition (or refuses its
  speech service, `service-not-allowed`, and can record): on the first
  press `GET /api/ai-assist/transcribe` says whether the fallback is on
  (no AI, no allowance). When it is, the microphone is asked for and a clip
  of at most 30 s is recorded (`MediaRecorder`, 32 kbit/s; MP4 on iPhone,
  WebM or Ogg Opus elsewhere) and sent as multipart (`audio`, `durationMs`)
  to `POST /api/ai-assist/transcribe`: Workers AI Whisper
  (`@cf/openai/whisper-large-v3-turbo`), 1 unit of the shared daily
  allowance, answer `{ ok, available, text }`. Type (declared and sniffed),
  size (1 MiB) and duration (declared, and an MP4's own header) are checked
  before any AI call or allowance use (400 / 413 / 415). When it is off,
  the mic hides after one calm note and the microphone is never asked for.
- Notes (calm, in the conversation, never a system alert): microphone not
  allowed, nothing heard, too long, allowance used, failed, not available.
- Screen readers: the button reads "Start voice input" / "Stop voice input";
  a polite live region says "Listening…", "Writing down what you said…" and
  then "Check the message, then send."

### Claude credits

While Claude credits are low, used up or capped, one calm inline notice
sits at the top of the conversation, above the "since you last looked"
card, in every way in (`AskClaudeCreditNotice` in
`claude-credit-notice.jsx`, words and rules in `claude-credit-model.js`):

- `low` (butter): "Claude credits are running low: about $X of $Y used. Ask
  still works." With money hidden: "Claude credits are running low. Ask
  still works." (no figures).
- `exhausted` (rose): "Claude credits are used up, so Ask is using the basic
  model for now."
- `capped` (rose): "This month's Claude spending limit is reached, so Ask is
  using the basic model until it resets."
- `ok`, `unknown`, or a viewer the server does not show the status to
  (`{ visible: false }`): no notice.

Actions: "Top up in the Claude Console" (a link to `consoleBillingUrl` in a
new tab; only an https address becomes a link), "I've topped up" and a ✕
("Hide this notice"). I've topped up opens the app's own form (a bottom
sheet on a phone, `EntryMobileSheet` with Save and Cancel in its bottom bar
above the keyboard; a small dialog on a wide screen): the credit bought in
US dollars with the number keypad, checked before it is sent (more than 0,
at most 10,000, as the route checks), then
`POST /api/ai-assist/provider-status/topped-up { creditUsd }`. Its answer
is the fresh status, which replaces the kept one (a read still in flight is
cancelled first); the form closes only on success and keeps the amount
with an inline error otherwise. While the form is open the route is busy.

The ✕ hides the notice for this browser tab's session: the dismissed state
is kept in sessionStorage (`monies.claudeCreditNotice.v1`). The notice
comes back when the state gets worse (low, then capped, then used up) and
the dismissal is dropped once the credits are fine again, so a later drop
shows.

Writes, all existing routes:

- Save: `POST /api/entries/create`, then `POST /api/splits/expenses/from-entry`
  when the Splits switch is on (`createEntryFromDraft` in
  `entry-create-request.js`, the Entries composer's path). The body carries
  the card's stable client id as `externalReference: "ask:<id>"` (made with
  the card, kept with it in the conversation store, new for every card and
  after Undo). A repeat create with the same reference returns the entry
  already made (`created: false`, with `linkedSplitExpenseId` and
  `linkedSplitExpenseMonth`) and writes nothing; the split step then uses
  that split instead of adding one, or adds it once if the first save
  stopped before it. A repeat with other details (the card was changed
  after the reload) is refused: "This entry was already saved with
  different details. Check Entries before saving it again." The route
  refuses any other reference shape (the Shortcut's `shortcut:` references
  stay with its own route).
- Undo: `POST /api/splits/expenses/delete` for a split the save created, then
  `POST /api/entries/delete`.
- The Shortcut card's follow-ups: `POST /api/entries/update-category`,
  `POST /api/splits/expenses/from-entry`.

One write route is Ask's own, for a plan draft:
`POST /api/month-plan/apply-changes` `{ month, changes }` →
`{ ok, month, applied, undo }` (`applyMonthPlanChanges`). Every update and
new line is the same row and split statements as the Month editor's
`/api/month-plan/save`, every delete the same as `/api/month-plan/delete`,
all in one batch with the month's refresh marker (a move or a copy is never
half saved). A line that no longer holds what the draft saw, or a new
line's id that is taken, is a 409 and nothing is written. Undo posts
`undo` the same way. After either, Ask publishes the entry mutation with
Month and Summary only (`invalidateMonth`, `invalidateSummary`), so a Month
page beside the dock refreshes.

After a write Ask publishes the entry (and split) mutation through the
shell's `broadcastEntryMutation` / `broadcastSplitMutation`, and refreshes
that month's Entries page DTO through `runBackgroundRefresh`: a failure keeps
the saved card and shows the retryable refresh notice.

## Ownership Notes

Ask owns:

- the conversation and the entry card (through the Ask conversation store);
- the filter reader and the answer card;
- the money answer card, the check before it and the chips that resolve it
  (the answer, its facts and the skew candidates are the server's);
- the insight answer card and its chips (the insight's facts are its
  signal's, computed by the page that showed it);
- the plan draft card and its questions (the draft, its figures and its
  Save list are the server's);
- the chip row and the question wording (the readers send structured
  questions; the client words them);
- the receipt photo while it is on screen (memory only, revoked on leave);
- the Claude credit notice and its session dismissal (the status itself is
  the query cache's, shared with Settings).

Ask does not own:

- any page DTO (Entries and Summary data are borrowed from the cache);
- the Entries filtering or the filter URL (`entry-filtering.js`,
  `entry-filter-params.js`, shared with Entries);
- the create, delete or split rules (the existing routes and the Entries
  composer's create path);
- the plan-row save rules (`applyMonthPlanChanges` writes the Month
  editor's own statements).

## Visible User Contract

- The + and receipt buttons open the card; the old forms stay reachable
  (`+ Add entry`, `+ Add expense`, Edit in form).
- Save stays disabled until the card has an amount, what it was (not for a
  transfer), a valid date, a wallet, a category and an owner, and a split
  group when Splits is on and more than one group can take it.
- An expense's amount is rose with a minus, income mint with a plus, a
  transfer plain ink; with money hidden the amount is masked and has no
  tone.
- Filled fields carry the butter tag on the card and a dot on their row; a
  hand edit removes the dot.
- After a save the card shows Saved and the chips offer the way back first;
  its bank state chip reads "Ask · provisional" ("Apple Pay · provisional"
  for the Shortcut's saved entry, `card.saved.addedBy`), and its Support
  chips are no longer editors.
- On a draft the date, wallet and owner chips open their rows' pickers (the
  owner's unfolds More details; on a wide screen the chip focuses the row's
  select), each a 44 × 44 px target named "Change <field>, <value>".
- Spoken words land in the message box and are sent only when the person
  taps Send; the mic is hidden when neither voice path is available.
- The + inside the field opens an in-app menu (Take a photo, Choose a
  photo, Paste); each glyph keeps a 44 × 44 px hit area and every
  placeholder fits one line at 375 px.
- An answer's total and count equal the Entries page `Open in Entries`
  opens; a request that could mean two things asks with chips; a view or
  scope change waits for its chip.
- A money answer's figures equal the Month (or Splits) page for the same
  view and month; a likely settle-up or own-account move is asked about
  before any answer, and nothing changes until Mark as settlement or Link
  as transfer is tapped.
- "Ask about this" opens Ask with "Explain: <the line>" and the card of
  the insight's own facts at once, asked once (not again on Back, Forward
  or a reload); its entries equal the Entries page Open in Entries opens;
  with AI off the card is complete; hidden money shows no figure.
- A plan request shows a draft with each line and the view's Planned
  income, Planned spend and Remaining budget before → after, equal to the
  Month page; nothing changes until Save plan; Discard writes nothing; a
  name that fits two lines or a request with no month asks with chips;
  after Save, See it on Month shows the new plan and Undo this change puts
  it back.
- Leaving Ask and coming back, or reloading the tab, keeps the
  conversation; the Ask tab shows a dot meanwhile.
- On a phone, after the + or the receipt button, the header's "‹ Entries"
  / "‹ Splits" link and the back gesture return to the page exactly as it
  was (URL, scroll, an open sheet with its draft), with no confirm.
- Low, used up or capped Claude credits show one calm notice at the top of
  the conversation with the Claude Console link and I've topped up; the ✕
  hides it for the session until the state gets worse; hidden money shows
  no dollar figure in it.
- On a wide screen the Ask field is at the bottom right of every page but
  `/ask`; it opens docked from 1,280 px (the page narrows, nothing sits
  under the panel, the header stays one row) and as a popup below that;
  the panel stays open across pages and a reload until Close or Escape,
  and an answer's links open the page beside it.
- No system alert, confirm or prompt anywhere.

## Persisted / Query Contract

- No new table. One new write route, `/api/month-plan/apply-changes`, for
  a saved plan draft (the plan-row save statements in one batch; see
  "Data Flow"). The plan-draft route only reads (and, with AI on, writes
  the allowance counter). The answer route only reads (and,
  with AI on, writes the allowance counter); resolving a check uses the
  existing transfer, classification and Splits routes. A saved entry is an ordinary manual
  entry, with `external_reference` = `ask:<client id>` (the existing unique
  index per household makes a repeat create return the same entry). The new
  routes, `/api/ai-assist/transcribe` and `/api/ai-assist/insight-explain`, only write the shared AI allowance
  counter. The Claude credit notice uses the existing provider-status routes;
  I've topped up writes only that aggregate row.
- A transfer card posts one row: the From wallet's side (or the To wallet's
  when turned round); the other wallet is shown but not posted, for the
  later transfer match, as the entry draft defines.
- The conversation is kept only in this browser tab's sessionStorage (text,
  the card's fields, filters, money and insight answers, open checks and plan drafts
  (one caught saving comes back a draft; never photos,
  audio or status lines) and is
  gone when the tab closes. Nothing about it, the sentences, photos, voice
  clips or spoken words is sent to be stored or logged.

## Audit Status

Current status: aligned with tests (`tests/ask-origin.test.mjs`,
`tests/e2e/ask-back-nav.spec.js` (also in WebKit on an iPhone 13 profile),
`tests/ask-dock-layout.test.mjs`,
`tests/ask-dock-state.test.mjs`, `tests/ask-dock-entry.test.mjs`,
`tests/e2e/ask-dock.spec.js` (desktop:
1,024, 1,280 and 1,440 px), the docked header case in
`tests/e2e/header-tab-fit.spec.js`, `tests/ask-card-model.test.mjs`,
`tests/ask-api.test.mjs`, `tests/ask-chips.test.mjs`,
`tests/ask-entry-dedupe.test.mjs`,
`tests/ask-voice.test.mjs`, `tests/transcribe-route.test.mjs`,
`tests/shortcut-gateway.test.mjs`, `tests/ask-filter-reader.test.mjs`,
`tests/ask-filter-answer.test.mjs`, `tests/ask-conversation-store.test.mjs`,
`tests/claude-credit-notice.test.mjs`, `tests/ask-answer-intent.test.mjs`,
`tests/ask-answer-route.test.mjs`, `tests/ask-answer-skew.test.mjs`,
`tests/ask-answer-ai.test.mjs`, `tests/ask-money-answer.test.mjs`,
`tests/ask-money-answer-card.test.mjs`, `tests/ask-insight.test.mjs`,
`tests/ask-insight-route.test.mjs`, `tests/insight-ask-lines.test.mjs`,
`tests/e2e/ask-insight.spec.js`,
`tests/e2e/ask-money-answers.spec.js`,
`tests/plan-draft-reader.test.mjs`, `tests/plan-draft.test.mjs`,
`tests/plan-draft-route.test.mjs`, `tests/atomic-writes-plan-draft.test.mjs`,
`tests/ask-plan-draft.test.mjs`, `tests/e2e/ask-planning.spec.js`,
`tests/e2e/ask-page.spec.js`, `tests/e2e/ask-voice.spec.js`,
`tests/e2e/ask-composer.spec.js`, `tests/e2e/ask-search.spec.js`,
`tests/e2e/claude-credit-notice.spec.js`, the last two also in WebKit on an
iPhone 13 profile) and runtime behaviour on a phone.

## Known Exceptions / Watch Areas

- Only the header and Month follow the page's width when the panel narrows
  it; other pages keep their window-width rules (Splits' toolbar is tight
  at 1,280 px with the panel docked, as it is in a 960 px window).

- The Claude credit figures are the server's estimate from token counts
  since the last "I've topped up"; the Claude Console balance is the real
  one. Topping up does not lift a monthly spending limit (`capped`), which
  stays until a Claude call succeeds.

- Money questions outside the nine intents (and biggest or income questions
  naming a category or wallet) are not answered; the page says so instead
  of reading them as entries. No AI reads a question to decide what it
  means.
- Planning by chat changes amounts and adds budget lines; it does not
  rename, re-date, move between sections or delete lines (Month does).
  Splits chat (settle up, split an expense) from the same mockups is not
  built yet.
- A plan draft is kept in the conversation as it was drafted; a change
  made elsewhere since then makes its Save a 409 ("Ask again").
- The filter reader has no AI gap-filler: a request it cannot read gets the
  "not answered yet" note. A later optional AI reader would be an explicit
  action with a strict schema (AGENTS.md "Optional AI Assistance").
- A money answer is kept in the conversation as it was answered; after an
  edit elsewhere it is not recomputed until the question is asked again.
  An insight answer likewise keeps the insight as the page showed it; its
  entries are read again each time it shows.
- An insight's basis comes from the page in the browser, so the explanation
  route checks AI words against facts the page sent: it can never add a
  figure the page did not compute, and the card's figures never come from
  it.
- "Change my plan" does not draft a change itself: which line to raise or
  trim is the person's choice, so it only puts the month in the message
  box.
- The AI wording path is proved with a stubbed Workers AI binding; a real
  Claude or Gemma phrasing on the deployed Worker is still to be checked
  (the validation will reject many phrasings, which then show the computed
  wording).
- A reload while a save is in flight brings the card back as a draft;
  saving it unchanged resolves to the entry already made. If the person
  changes the card before saving again and the first save had landed, the
  route refuses it (no second entry) and the card says to check Entries,
  where that entry is changed.
- The two reader endpoints are stubbed in the browser tests; the unit test
  `tests/ask-api-server-contract.test.mjs` runs `ask-api.js` against the
  real routes so their shapes cannot drift. `ask-api.js` still also accepts
  the brief's flat shape.
- Voice input is proved in the browser with a stand-in `SpeechRecognition`;
  on a real iPhone, check that holding the mic starts listening (WebKit may
  want the tap: a refused start is retried on the click that follows) and
  that Safari's continuous results do not repeat words. The Whisper call is
  proved with a stubbed AI binding; a real WebM/MP4 clip through Workers AI
  is still to be checked on the deployed Worker.
