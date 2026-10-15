# Design Notes

This file captures design-level implementation boundaries that are more
specific than the domain glossary and more tactical than the architecture
overview.

## Client Deep Module Strategy

The current canonical client deep module service is
[`src/client/monies-client-service.js`](/Users/tim/22m/ai-projects/monies_map/src/client/monies-client-service.js),
but the long-term target is not one giant helper barrel. The target is a small
set of feature-level deep modules with narrow public APIs.

Purpose:

- expose stable utility and workflow surfaces for client components
- hide leaf helper layout behind a small number of intentional import boundaries
- keep feature code from reaching into many low-level helper files directly
- let each vertical slice own its own query keys, selectors, formatters, and
  workflow helpers without leaking them app-wide

Rules:

- client components should prefer slice-level deep modules over direct imports
  from many leaf helpers
- new shared helpers should not be promoted globally by default; first ask
  whether they belong inside one slice deep module
- the target slices are `summary`, `months`, `entries`, `imports`, `splits`,
  and `settings`
- each slice deep module may expose a small surface such as:
  - query option builders
  - selectors and derived-view helpers
  - display formatting tied to that slice
  - mutation orchestration helpers
- do not put raw transport details or route wiring directly into display
  components
- do not create cross-slice helper tangles. If two slices need the same logic,
  either move it into a truly shared domain/helper module or duplicate the
  simplest form until the right abstraction is clear
- a deep module should be easy to use and hard to misuse. Its public API should
  be shorter than the internal work it hides
- the global app shell must not import a broad deep-module facade when it only
  needs a small shared formatter or normalizer. Import that leaf directly, and
  keep route-only components in their owning lazy route chunk.

How this relates to other docs:

- [`DOMAIN.md`](/Users/tim/22m/ai-projects/monies_map/DOMAIN.md) defines the
  business vocabulary
- [`docs/architecture.md`](/Users/tim/22m/ai-projects/monies_map/docs/architecture.md)
  defines system-wide structure, staged refactor order, and data flow
- this file defines practical implementation boundaries for client-side code

## Splits Visual Contract

The splits page owns a complete color contract for every new or updated
surface. Keep section backgrounds, headings, body text, muted text, primary
buttons, secondary buttons, link buttons, controls, focus states, status
states, and disabled states scoped under `.panel-splits` (or a splits-owned
component token). Every action must retain readable contrast against its
actual background on desktop and mobile. New splits UI must be placed in the
page hierarchy where the next user action is discoverable; long chronological
lists must not hide status, archive access, or navigation actions below the
fold.

Travel split records use the same splits-owned visual tokens for currency,
payment method, pending statement evidence, and FX review. Foreign amounts are
shown as entered, with any home-currency estimate or converted ledger amount
secondary and explicitly labeled.

### Splits group strip

The strip under the person switcher (`splits-group-strip.jsx`, rules in
`splits-group-strip-model.js`, styles in `splits-group-strip.css`) is in the
page flow, never floating over rows. On a phone it is two siblings in one
row: the New/All control (a solid cream chrome-surface tile, about 56 px wide,
a hairline between two 44 px+ buttons "New" with aria-label "Create group" and
"All" with "All groups") and, to its right, the tile scroller. The control is
not inside the scroller and is not sticky, so no tile ever slides under it;
the scroller fades its left edge (only once scrolled) and its right edge (only
while more tiles follow) with a CSS mask, and scroll-snaps tiles to its start.
The open group is the first tile: white, about 60% wide, terracotta outline
and tick, its balance in words and its entry count; the others are
translucent group tiles with one balance line. Order: owed to you, you owe,
Non-group expenses (its own balance, "No balance" at zero, never "Settled"),
then settled real groups, muted. Hidden money: "Balance hidden" on every tile
and a stable by-name order with no settled styling. The open group is kept per
viewer in localStorage (`monies-map:splits-last-group:<view>`, try/catch) and
used when the address has no `split_group`. All opens the All groups sheet
(same order, a folded "N settled groups" row, Create group, Done, swipe down to
close). Once the strip has scrolled out above the viewport (IntersectionObserver)
a floating bar shows the open group and opens the same sheet; it hides under
any dialog. Desktop is one row with the control first; tiles that do not fit
are dropped (never wrapped or scrolled) and the All half reads "All · N more".
Group tiles carry no money tone (the Splits orange).

### Splits page: lead card, search, activity list

The open group is a Lead · Support · Detail lead card
(`splits-lead-card.jsx`, words in `copy/splits-lead-copy.js`, what it says
decided by `splits-lead-model.js`, styles in `splits-lead.css`): the group
bubble (its icon, the Splits terracotta), the name, "JPY · 10 entries" and the
balance as the one figure with the plain words under it ("Serene owes you",
"You owe Serene", "Settled up"; hidden: "Balance with Serene" and dots). Support
chips: the other person in their colour and "Group spend <amount>", which is
the old summary strip's category breakdown toggle (it keeps the name "Toggle
split donut" and `aria-expanded`). History (the `lsd-quiet` action, named
"Activity history") and Settle group (the one `lsd-primary`; off at zero) share
the bottom row; a wide screen adds "+ Add expense" between them, in a column
at the card's right. Simplify settlement stays in the page head on a wide
screen (with "Review matches (n)") and is a Detail row on the card on a phone,
where the head is hidden and the receipt button adds expenses. A household
view has no balance, so the spend is the figure and only History shows. In the
bank-match review the card steps aside for the review's own lead. The search
box is its own field under the card, its label kept for assistive tech and its
placeholder naming the group.

The activity list stays flat (design.md, Lead · Support · Detail: lists are not
cards): each date is a quiet divider (small mono caps, a hairline, the count
and refresh at the right; it stays sticky, painting the page's own flat
colour), and that day's rows share one rounded white group with hairlines. A
day reads as one unit, the same shape as an Entries day (an unboxed label over
its rounded group): the Splits panel, the page behind it on a phone and the
sticky date label all paint `--splits-surface` (`:root`, halfway between the
two Splits colours), so no band shows behind the label. Stuck at the top, the
label becomes the same rounded bar an Entries day label does (the group's
width and 16 px radius, `--splits-surface` at 84% with a blur inside it;
`tests/e2e/date-row-flat.spec.js`).
`tests/e2e/splits-day-unit.spec.js` measures the label's geometry and type
against Entries' and that no band shows. The viewer's words and
figure sit at the row's right in their money tone as text only. An open inline
split card fills its group as the row opened up. Archived batches is a dashed
outline row.

The Splits dialogs and panels use the same blocks (no behaviour change):
Record settlement (`split-settlement-card.jsx`, in the phone sheet, the wide
dialog and inline in the list, sharing the split expense card's layout:
lead with the amount typed in place, the date and payment chips, then Group,
Paid by, Received by, Date, Note, Paid using, Currency, Evidence and a Linked
entry row), Create group (`split-group-card.jsx`: the name typed in the lead,
Group currency and Purchase source rows), Split activity history and Archived
batches (`splits-list-sheets.css`: a head, one rounded group of rows, Close in
the bottom bar), the simplified settlement (`splits-checkpoint-panel.jsx`: lead
with who pays whom, Detail rows for View included activity, the matched
transfers and the transfer to match, Mark paid as the one primary) and the
bank-match review (`splits-matches.jsx`: a lead, then a white card per candidate
with the two records as rows and the confidence as a chip). The old Edit linked
entry dialog (`splits-linked-entry-dialog.jsx`) is never rendered and was left
as it is.

Split activity history is an action-oriented recovery surface opened from the
group card. It uses the splits color contract, stays compact and
newest-first, labels archived actions clearly, and places Restore beside a
recoverable record without exposing destructive controls in the history list.

Simplified settlement uses two distinct user facts: `Mark paid` records the
people's confirmation and collapses the checkpoint into a follow-up queue;
`Match bank transfer` records the independent ledger evidence. The queue is
collapsed by default, retains the included-record manifest, supports `Undo
paid`, and shows paid follow-ups across currencies so changing split groups
cannot hide one. The user can expand one item to match a transfer from the
currently selected ledger month. It must never style a paid confirmation as a
bank match.

Financial insight (user-facing: Money insights; the check-in in code) is deliberately compact by default.
It shows one ranked signal: its kind chip, the bold fact, one think line and
at most one action that reuses a navigation the page already has, then a
Just for fun line (never beside a bigger question) and the Long view line.
`See all insights` reveals up to three more signals and at most one quote
(never beside a bigger question); on Splits also the bank-match review link,
which its Quick fix owns. Expanding is local presentation state; it loads the
quote library chunk on demand. The headline is always the computed fact
(bold) and its think line as written: Money insights use no AI rewording and
send no wording request.
Summary's signals and copy pools are a chunk of their own
(`money-insights-loader.js`, started by the Summary route loader): until
it arrives `checkIn` is null and the component renders its frame (the
label and one empty line, `data-checkin-mode="loading"`, `aria-busy`), with
no words of its own. The
component (`financial-insight.jsx`) composes the check-in with
`composeCheckIn` from the page's signals, the page and period (what rotates
follows the period: `money-signals/rotation.ts`), the page's trivia schedule
and calm lines, and the visit memory as it was when
the page mounted (`checkin-visit-memory.js`, localStorage only), so
recording the visit never changes what is on screen; the visit's clock is
fixed at mount (`useCheckInClock`). Its styles live in `money-checkin.css`,
which ships with the routes, not the first-screen stylesheet. On a phone
the insights reserve the right-hand column the floating money-privacy
button covers (`tests/e2e/money-insights-phone.spec.js`).

Money insights fold (`tests/e2e/money-insights-fold.spec.js`). Folded, a
block is its eyebrow over a teaser card that is one button, the full width
of the block (`aria-expanded`, `aria-controls`, at most about 96px). Row 1: the
top insight's own kind chip, then "+N more" (when more wait behind it) and the
chevron. Row 2: its bold headline, one line. Row 3: the start of its think line
in muted ink, one line. Both lines end in an ellipsis when cut. On a phone the
card spans under the floating eye button's column, which can cover the pill and
chevron while scrolling. The card takes the pastel surface of the headline's
kind (butter To do, lavender Something to think about, sky Worth knowing, mint
Going well, neutral otherwise; ink text), and two thin offset edges under it
(`data-more`) read as a deck when more than one insight exists. On Splits the
card is a light wash on the orange with no pastel fill. With money hidden the
card says only "N insights · tap to see": no headline, chip, pill or amounts
(hidden mode never shows a headline today). Open, the same button is a plain
row at the top (eyebrow and chevron) that folds the block again. Phone (760px
and below) starts folded, desktop starts open; the choice is kept per layout
in localStorage (`monies-map:money-insights-phone`, `...-desktop`), every read
and write guarded so the block renders without storage. The fold costs
first-screen bytes (Summary ships it), so `initial-bundle-budget.json` stays
as is and the code is kept small (`composeCheckInHeadline` moved to
`check-in-headline.js` for that); its CSS is in `money-checkin.css` and
`splits-panel.css`.

Insight questions: "Ask about this" (docs/flows/ask-flow.md "Insight
questions"). There is no visible link. Each line is itself one real button
(`InsightLine`, `data-fig="insight"`): its text stays as written, with a
faint dotted underline in the accent that firms on hover, focus and while
its menu is open, at least 44px tall on a phone by padding (an equal
negative margin keeps the layout), and its text stays selectable. A click
(never a press) opens the shared figure menu (`figure-menu.js`, no new
popover) with one item, "Ask about this"; Escape or a tap outside closes it
and the line takes the focus back. Only a line with a signal behind it is a
button (not the calm, quiet or Sorted line; the Fun fact and the Big
picture have no figures of their own, the Big picture with its three basis
lines), and none is while money is hidden. The folded teaser is only the
fold's tap. Choosing the item sends a window
event (`insight-ask-event.js`, `monies:ask-insight`) with the line, its
think line and the signal's `basis`; the shell (`use-insight-ask-launcher.js`)
opens the Ask page on a phone (the insight rides in history state) or the
Ask panel on a wider screen, so no Ask code is in the first screen.

The Splits workspace uses a dark surface but paid-settlement follow-ups use a
light proof card. Controls on that card must use an explicit light-card theme:
readable dark secondary actions, a distinct caution treatment for `Undo paid`,
and a high-contrast primary treatment for the later bank-transfer match.

## Ask Page

The Ask page (`/ask`, `src/client/ask-panel.jsx`, lazy) is one full page,
never a sheet: the tab bar stays visible and there is no close button. Flow
and data contract: [`docs/flows/ask-flow.md`](docs/flows/ask-flow.md).

Hands-off parts (owner decision 2026-10-14; `docs/flows/ask-flow.md`
"Hands-off"): under a saved entry's card, at most one quiet line in the
neutral card tone (`.ask-habit-row`): the habits' suggestion with a tick and
a cross (44 px targets), or what Ask did by itself with an Undo; at the end
of the thread, a folded "Done for you" list (`.ask-done`) of the last 30
days. Settings has "What Ask remembers" as a normal list-row section (the
switch, one row per habit with change and forget, Forget everything); its
code stays in the lazy Settings route and the habits' client code in the Ask
chunk (`use-ask-habits.js`, `ask-habits-ui.jsx`, `ask-habits-api.js`; copy in
`copy/ask-habits-copy.js`). Nothing here is a notification.

Layout, top to bottom:

- Header: "Ask" (chat mode) or "New entry" / "New income" / "New transfer" /
  "Saved" (add mode) with a context line: person · scope · month in chat,
  person · month beside the title in add mode. In chat mode, once there is
  something to start over from, a quiet "New chat" text button (accent
  text with a pen glyph, 44 px tall) sits at the header's right. On a
  phone, after the Entries + or the Splits receipt button opened the card,
  a "‹ Entries" / "‹ Splits" back link (accent text, bold, a 44 px target
  in a short row) sits at the top left above the title, the standard Back
  place, far from Save. Its way back is "Ask origin" below.
- Conversation (`role="log"`, polite live region), which scrolls: first,
  only while Claude credits are low, used up or capped, the Claude credit
  notice (see "Claude credit notice"), in every mode; then in chat
  mode a "since you last looked" card (`ask-brief-card.jsx`: the
  Summary check-in's headline and kind chip, its action when it is
  Imports or a category, and the month's spend against its plan with a sky
  plan and a bar that turns rose only over plan), then the person's messages
  (right, accent tint), receipt thumbnails, the page's notes (muted, left),
  answer cards, and the entry card. The card sits under the message that
  filled it and above what happened to it since. Coming back to a kept
  conversation opens it near the bottom, as it was, with no arrival motion
  for what was already there.
- Bottom stack above the tab bar: one horizontally scrolling row of chips
  (buttons; the main way on first and filled; a back chip in accent text),
  then the composer (below). When a card is open and nothing is typed the
  send arrow becomes Save, disabled until the card is valid.

### Composer

One rounded white field (`.ask-field`, 22 px radius, a 1 px inset outline)
holds `[ + ] message [ mic ]`; Send (the accent arrow) or Save sits outside
it and is the composer's only filled button. The + and the mic are plain
20 px glyphs in muted ink with no border or fill, each in a 44 × 44 px hit
area. The field is 44 px tall, grows with the message to three lines, then
scrolls (`field-sizing: content`, `max-height: 3lh` plus padding); the
glyphs stay on its bottom line. The field shows the accent focus ring when
the message box has keyboard focus.

Placeholders, each fitting one line at 375 px (`tests/e2e/ask-composer.spec.js`):
"Ask, or paste a receipt" (chat), "Type or say it…" (a new card),
"Anything to change?" (a filled card), "Ask, or add another" (saved),
"Listening…" while the mic listens.

- The + opens a small in-app popover above it (Radix Popover, as the "More
  pages" menu uses): Take a photo (the camera picker), Choose a photo (the
  photo picker) and Paste (the paste reader), each a 44 px row with an
  accent icon. It opens focused on itself, not on an option, so a tap marks
  nothing as chosen; Tab reaches the options and Escape returns to the +.
  The Scan receipt and Paste chips stay in the chip row as the one-tap
  suggestions.
- The mic (`ask-voice.js`, flow in `docs/flows/ask-flow.md` "Voice input")
  is always in the same place (not swapped in on focus, so it can be held
  without first opening the phone's keyboard). Hold to talk, or tap to
  start and tap to stop; the words fill the message box, which is read-only
  while listening, and the person sends. Listening turns the glyph accent
  with a subtle accent ring around it (a 10% accent disc with a 2 px ring),
  which pulses only under `prefers-reduced-motion: no-preference`. The
  label switches between "Start voice input" and "Stop voice input", and a
  polite live region announces the change. The mic captures the pointer, so
  a hold ends on release even when Save turns into the narrower Send arrow
  and the field widens. It is hidden when the browser has neither speech
  recognition nor the recorded fallback; failures are calm notes in the
  conversation.

On a phone the page is `position: fixed` above the tab bar (`ask-route.css`)
with its own scrolling conversation; the shell's header bar is underneath
it. On a wide screen `/ask` renders in the main area like any panel, with
the bottom stack sticky; its tab is hidden there (`phoneOnly`), because the
Ask field and the panel it opens are the wide-screen way in ("Desktop Ask"
below).

### Entry card

`ask-entry-card.jsx` renders the card on the shared blocks ("Lead ·
Support · Detail" below); `ask-card-model.js` is its pure state machine
(`draft` → `saving` → `saved`, back to `draft` on failure or Undo).

- Hero card: a 56 px category bubble (the category's palette colour at 20%
  over white, glyph at 70% with the ink, the app's category icon; a neutral
  bubble with the transfer arrows for a transfer), what it was (an inline
  field that wraps; for a transfer the From → To wallets), the category name
  in the category ink, and the amount, the largest text: rose with a minus
  for an expense, mint with a plus for income, plain ink for a transfer
  (`entryAmountTone` through `moneyToneClass`; `money-out` is rose text).
  An empty amount is muted with an accent underline. Meta chips: date,
  wallet (not for a transfer) and the person in their colour
  (`getPersonColourVars`).
- Tag above the hero: butter "Filled in from your message" or "Read from
  your receipt"; mint "Saved" once saved.
- Coax line under a dashed rule while the card is empty.
- Quiet detail rows: Date, Category, Wallet, Type (transfer: From, To, Date,
  Type), then "More details" folding Posted date, Owner (a split share when
  Shared) and Note. Each row opens the app's own picker: the mobile picker
  sheet (`ResponsiveSelect`) on a phone, a native select or date field over
  the row on a wide screen. A field a sentence or receipt filled carries a
  butter dot until it is edited by hand.
- Splits switch (expense, two people): "Share with <partner> on Splits"
  (`role="switch"`) with the group name; a Split group row appears when more
  than one group can take it.
- A saved card keeps the hero only, plus "Also on Splits: <group>".

Hidden money masks the typed amount (`-webkit-text-security`), shows the
saved amount as `••••` and drops every tone. Arrival motion and the switch
slide run only under `prefers-reduced-motion: no-preference`.

### Answer card

`ask-answer-card.jsx`, built on the shared `LeadCard` and `MetaChip`
("Lead · Support · Detail"), laid out like the entry card beside it:

- Head: the 56 px bubble (the category's palette colour at 20% with its
  icon for one category; a neutral bubble with a card or search glyph for a
  wallet, searched words or a type) and the subject in bold ("Public
  Transport", "Citi Rewards", “grab”, "Income", "All entries").
- Under the subject, in muted text: "Spent · 6 entries", plus "Serene's
  share $30.00" when the view's share differs from the whole amount.
- Lead: the total on the right, the lead amount size. Spending stays plain
  ink (spending is not bad for being spending; there is no plan here),
  income is mint, transfers ink; hidden money masks it and drops the tone.
- Support: the filters as `MetaChip`s (month, person and scope, category,
  wallet, type, amount, search).

While it adds up it says "Adding it up…"; a month with no entries says so.
"Open in Entries" is the first chip of the row (filled) while the answer is
the newest thing in the conversation.

### Money answer

`ask-money-answer-card.jsx`, the same `LeadCard` for an answer to a money
question (docs/flows/ask-flow.md "Money questions"):

- Head: a neutral bubble with the intent's glyph (a pie for spending, a
  target for the plan, scales for a comparison, a receipt for the biggest
  expenses, people for Splits, a banknote for income), the title ("August
  spending", "August against plan", "July and June", "Biggest in August",
  "Splits with Serene", "August income") and, muted under it, what the
  figure counts ("Spent · 51 expenses", "Came in · 2 entries", "Balance").
- Lead: the figure on the right. Spending is rose only over plan, income
  mint, a Splits balance mint when owed to you and rose when you owe;
  the actual-vs-plan bar with "of $7,263.09 plan" in sky when there is a
  plan.
- Support: the plan, the other month, the largest shares ("Home 54%") or
  the Splits groups, as `MetaChip`s with masked amounts when money is
  hidden (labels never say over, under or who owes).
- Tag: words the optional AI phrased carry the entry card's butter tag
  ("Worded by AI", with the sparkle) above the head line; the computed
  wording has none, and hidden money hides it with the words.
- Detail: the answer in one to three sentences, then quiet rows (label and
  a short detail on the left; the amount on the right in its tone, with the
  plan or the other month small under it). Hidden money replaces the words
  and rows with "Reveal money totals to read these insights."

The plan answer is Intent vs Outcome (round-2 mockups `chat-intent-*`):
its lead reads the Month lead's "Spent" and "of $X plan" (the spend job:
the shared `splitMoneyUse`, `src/domain/money-jobs.ts`), and under its lead
bar it draws the Month and Summary lead's `SavingsBar` (ui/savings-bar.jsx)
from the answer's `outcome` (income received, Actual spend, Planned spend,
Savings target, money moved to Investments and Savings, the Investments
plan rows) through the same split, so the card and Month show one
picture. A quarter's answer ("did we stick to the plan in Q3?") is titled
"July to September against plan" and lists each month against its plan
before the plan rows.

The money jobs' answers (the lead's "Ask about this" on invested, kept and
"came out of savings", or the same questions typed) use the same card and
the same `SavingsBar` under the lead: "May investing" (a trending-up
glyph; lead "Invested" against the invest plan, more being fine; the
Investments entries as plain-ink rows), "May savings" (a piggy bank; lead
"Saved", the lead's kept, against the savings target, its plan bar empty
when below zero; chips Income, Spent, Invested) and "May spending and
income" (a wallet; lead "Spent", chips Income and Invested, rows "Came
out of savings" or "Kept" and the spending categories). A Summary range
is titled "October 2025 to September …". Their titles, labels and chips
never say which side of a plan or of income the money fell.

The check before an answer is the same card with the butter "Check this
first" tag over the head ("Serene → Ethan" or the two accounts, the bank
description muted, the amount in plain ink) and one plain paragraph; its
chips are Mark as settlement or Link as transfer (filled) and It's real
spending. Once answered it stays in the thread, faded.

### Insight answer

`ask-insight-answer-card.jsx`, the same `LeadCard` for an insight question
("Explain: <the line>", from a Money insights line's "Ask about this"):

- Tag row: the line's own kind chip (`CheckInChip`: To do, Something to
  think about, Worth knowing, Going well) and, when the optional AI added
  words, the butter "Worded by AI" tag.
- Head: a neutral bubble with a lightbulb, the label of the figure the line
  is about and that figure on the right in plain ink (the basis line
  holding the signal's primary amount). A line about a count has no figure:
  the line itself is the head.
- Detail: the line as the page showed it, bold and wrapping (so a long line
  never squeezes the head), the line's think line in muted ink, the AI's words (only when
  they passed the check), "What it's based on" with the signal's basis
  lines as quiet rows (label left, amount or value right, plain ink), and,
  when entries are behind it, "The entries": at most five rows, largest
  first, from the Entries page DTO through the Entries page's own filter
  (expense rows rose text, income mint, transfers plain), then "N more in
  Entries".
- Chips: Open in Entries first and filled when entries are behind it,
  then the kind's follow-ups (Compare with the statement, Open Month, Open
  Splits, or a money question Ask already answers), then the usual chips.
- Hidden money: the title reads "A money insight", the question "Explain
  this money insight", amounts are masked and the Detail gives way to
  "Reveal money totals to read these insights."

### Plan draft

`ask-plan-draft-card.jsx` (round-2 mockups `chat-plan*`; docs/flows/
ask-flow.md "Planning by chat"): a draft of a change to a month's plan, on
the shared blocks, with its own actions under it rather than in the chip
row (the composer stays free for the next request):

- Tag: butter "Draft" (mint "Saved" once saved); "Read by AI" with the
  sparkle beside it when the optional AI read the request.
- Lead: the category's bubble and "Groceries plan" with the month in the
  category colour, the new amount in sky and "was $650.00" (or "New
  line") under it; a move is a neutral arrows bubble, "Move $50.00" and
  "Shopping to Groceries"; a copy a neutral copy bubble, "November 2026
  plan", "Like September 2026" and the planned spend.
- Support: the view's person chip (or Household) and the month; a move
  that keeps planned spend says so in a sky chip.
- Detail: read-only rows, each changed line "$650.00 → $700.00" (the old
  figure muted, the new one sky; six rows, then "N more lines" folding the
  rest), then Planned income, Planned spend and Remaining budget the same
  way, Remaining rose below zero. The plan-balance warning, when there is
  one, is a rose attention line under the rows.
- Actions: `BottomActions` with Discard (quiet) and Save plan (primary).
  Saved, the rows become See it on Month and Undo this change.
- Hidden money: dots for every amount, no "was" figure, no warning, no
  tones.

Its logic lives in plain modules: `plan-draft-reader.ts` (rules, shared
with the route), `plan-draft.ts` (resolution, server), `ask-api.js`
(`requestPlanDraft`, `applyPlanChanges`, `readPlanDraftResponse`),
`ask-chips.js` (`buildPlanQuestionChips` for its questions) and
`copy/ask-plan-copy.js` (its words, kept out of `ask-copy.js`, which
Entries and Splits also load). The draft lives in the Ask conversation
store as a `plan-draft` thread item.

### Bottom chips

The row and the composer's primary button belong to the newest thing in
the conversation (`findActiveItem`): an open follow-up or view change, an
answer below the card, or the card while nothing has been said since it.
`buildChipRow` then picks the row; the card's chips (`buildAskChips`) show
only while the card is active. An unsaved card further up is never lost:
the row offers "Back to the unsaved entry", which moves the card below
what was said since, so its chips and Save come back. Save shows only
while the card is active.

`buildAskChips` derives the card's row from the mode and the card:

- chat, no card: Scan receipt, Paste, Add entry, Add expense;
- add mode: `‹ Entries` / `‹ Splits` / `‹ Ask` first (with the header's
  back link, the phone's Ask page after the + or the receipt button, only
  while the card is untouched: `headerBack`); then a pending
  question's answers (the readers send structured questions; the client
  words them and shows the question as a line above the row), or Scan
  receipt, Paste, Transfer, Income on an empty expense; Split with
  <partner> (or Not shared), Add a note, Different card once it has content;
  Swap direction and Add a note for a transfer; Add a note and Different
  wallet for income; Edit in form last;
- saved: Back to Entries (or Splits, filled), Open this entry, Open on
  Splits when shared, Undo; the Apple Pay Shortcut's saved card offers Open
  this entry (filled), category chips and Choose category when it landed in
  Other, and Splits;
- after an answer (`buildFilterChips`): Open in Entries (filled), then
  "Back to the unsaved entry" when an unsaved card is further up, else the
  chat chips; a follow-up question: only its options (one per wallet,
  category, month or person, then "All of them"), with the question as the
  line above the row; a view change: "Switch to Serene · Shared" (filled),
  then the same as after an answer, under "Change the view?";
- after a money answer (`buildMoneyChips`): its links (Open in Entries,
  Open Month or Open Splits, the first filled), then the same as after an
  answer; an open check before an answer: only Mark as settlement (or Link
  as transfer, filled) and It's real spending;
- while a plan draft asks something (`buildPlanQuestionChips`): only its
  options (months as "November 2026", lines by name, with whose when two
  share a name, or the people and Shared), with the question above the
  row. A plan draft itself leaves the usual chips.

### Ask origin

Where Ask's back link goes on a phone (`ask-origin.js`, pure, unit tested;
`use-ask-origin.js`, the Entries and Splits hooks; both ship with those
routes, never the first screen). The shell's + and receipt handlers
(`openAskFromPage` in App.jsx, a few lines inline to stay out of the
module) build the origin (an id, the way in, the page's path with its
query, the window's scroll), fire `monies:ask-origin` so the page can add
an open sheet with its draft (`useAskOriginSheet`: Entries adds its edit
sheet's edited entry, or its add sheet's draft), replace the page's own
history entry with the origin as `state.askReturn`, then push `/ask` with
it as `state.askOrigin`. The Ask page keeps it in sessionStorage
(`monies.askOrigin.v1`, one per way in, versioned) and plans its way back
with `planAskBack`: history.back while its history entry has the origin
(so the link and the phone's back gesture are one way), else the kept
place (opened with `state.askReturn`), else the plain page for the view
and month. The page puts the place back once (`useAskReturn`): the sheet,
then the scroll, set each frame until it holds (rows render over a few
frames), never after the person scrolls; and it keeps its URL and scroll
as the kept place whenever it is left another way, for a card the Ask tab
reopens. Paths are checked against the way in's page, so a kept origin
never leads outside the app.

### Ask conversation store

`ask-conversation-store.js` owns the conversation, like the other `*-owner`
modules own their data: a module-level store (`subscribe`, `getSnapshot`,
`read`, `begin`, `update`, `leave`, `clear`) made once per browser tab
(`getAskConversationStore`), outliving the page. The page binds it with
`useSyncExternalStore` (`useAskConversation` in `ask-panel.jsx`) and writes
only through it, so an async reader result or save lands even after the
page has gone; App keeps no copy. One conversation per way in (the intent
key), at most three, the oldest finished one going first; `begin` restores
the kept one or makes a new one (a saved add-mode card is finished, so the
next + starts fresh); `leave` drops photo thumbnails and status lines and
keeps the scroll offset; `clear` is New chat.

It ships with the Ask route. The shell reads only
`ask-conversation-presence.js` (in the entry chunk, a few hundred bytes):
whether a conversation is in progress and which add-mode way in to reopen,
published by the store on every change and kept in sessionStorage so a
reload shows the Ask tab's dot without loading Ask. The dot is a 7 px
accent disc at the tab label's top right (`.tab-dot`); the link's label
reads "Ask, conversation in progress".

Mirror: sessionStorage `monies.askConversation.v1` (versioned, at most
60,000 characters with the oldest messages dropped first, unreadable data
dropped and cleared; text, the card's fields and filters only, never a
blob: or data: value, photo, audio or status line). Never localStorage or
the server. The card keeps its `clientId` there, so a card that was saving
when the tab reloaded (it comes back as a draft) sends the same
`externalReference` when saved again and resolves to the entry already
made (`createEntryRecord` returns it, `created: false`, with its linked
split).

## From Ask Chip

`entries-ask-chip.jsx`, on Entries while `from_ask=1` and a list filter are
in the URL: one white pill like the View and scope bar (14 px radius, the
bar's shadow) with two 44 px targets: "✦ From Ask · Groceries · over
$50.00" (accent "From Ask", the filters in ink, cut with an ellipsis when
long) goes back to Ask; "✕" (muted, behind a hairline) clears the filters
Ask set. On a phone it floats just above the View and scope bar (bottom
140 px) and left of the round + button: in the thumb zone and in view
while the list scrolls, so the person can always see the list is narrowed
and undo it with one tap; the list gets 56 px more bottom padding, and the
chip hides under a sheet or dialog as the bar does. On a wide screen it sits
at the top of the list, under the page title.

## Desktop Ask

Owner-approved desktop design. Flow: [`docs/flows/ask-flow.md`](docs/flows/ask-flow.md)
"Desktop". Code: `ask-dock.jsx` (field, `/` key and loading frame: the only part in
the first screen, with `ask-dock-field.jsx` and `ask-dock-entry.js`),
`ask-dock-panel.jsx` (the panel, loaded with the Ask page's chunk on the
first way in), `ask-dock-layout.js` (pure layout rules), `ask-dock-state.js`
(session state), and the Ask page itself inside (`AskPanel` with
`placement`).

- The field: one white pill, 340 × 48 px, 24 px radius, the inset hairline
  and a soft shadow, fixed 22 px from the right and 29 px from the bottom
  (on the vertical centre of the 58 px + button, 12 px to its left on
  Entries and Splits). An accent ✦ glyph (`--accent`), the placeholder "Ask,
  or drop a receipt…" in muted ink, and a muted paperclip in a 44 px hit area
  ("Add a receipt photo"). The pill's edge is accent-tinted
  (`--ask-dock-edge`, 38% `--accent-strong` over the hairline) and the accent
  focus ring shows on it while it has focus. This is the desktop twin of the
  phone's accent Ask tab (see "Phone Chrome"); the wide header has no Ask tab. It hides under a dialog or an inline editor (as the + does), while
  any menu or popover is open (one near the bottom right, such as Confirm
  rollback, would otherwise sit under it), and once the panel's
  conversation is showing. Page content gets 96 px of
  bottom room on a wide screen so nothing ends under it.
- Docked (1,280 px and wider): a full-height panel at the right,
  `clamp(360px, 27vw, 400px)` wide, on the pastel neutral with a hairline
  left edge. It pushes the page: the body gets the panel's width as right
  padding, so the shell (still at most 1,200 px) centres in what is left,
  and the + and receipt buttons, the loading badge and the environment
  banner move beside it. Nothing is ever under it.
- Popup (761 to 1,279 px): 410 × 560 px (less on a short window), 22 px
  radius, a hairline border and a deep soft shadow, 22 px from the right
  and 24 px from the bottom, over the page; on Entries and Splits it sits
  94 px from the bottom, above the round + or receipt button, which open
  their new entry card in it (and in the docked panel) on a wide screen.
- Inside both: the Ask page with 16 px gutters. The header is the page's
  ("Ask" at 1.7 rem with the person · scope · month line), with New chat,
  the expand control (popup on a window wide enough to dock: an accent
  ⤢ glyph, "Dock Ask beside the page") and "Close" (accent text, bold,
  44 px tall, "Close Ask") at its right. The conversation scrolls inside
  the panel; the chips and composer sit at its bottom, as on the phone.
- The header and Month read the page's width, so the page narrowed by
  the panel lays out like a window of that width ("Layout Breakpoint
  Boundary"): at 1,280 px the page is 920 px and the header keeps one row
  with Imports, Settings and FAQ behind More pages.

## Claude Credit Notice

`claude-credit-notice.jsx` (its own `claude-credit-notice.css`, so it ships
with Ask and Settings only), words and rules in `claude-credit-model.js`,
data in `claude-credit-status.js`. Flow:
[`docs/flows/ask-flow.md`](docs/flows/ask-flow.md) "Claude credits".

- Placement: on Ask, the first thing in the conversation (above the "since
  you last looked" card), inline and scrolling with it: never a modal, a
  banner over the page or a browser alert. It shows only for `low`,
  `exhausted` and `capped`; there is at most one.
- Look: a rounded card (16 px) in the state tone at full pastel strength,
  text in that hue's ink: butter for low (Ask still works), rose for used
  up and capped (Ask is on the basic model). The sentence first, a 44 px ✕
  ("Hide this notice") at its right, then the two actions as 44 px pills
  in the same ink on a light white wash: "Top up in the Claude Console"
  (a link with an external-link glyph, new tab) and "I've topped up".
- Hidden money: the sentence drops its dollar figures ("Claude credits are
  running low. Ask still works."); the actions stay.
- Dismiss: hidden for this browser tab's session; it comes back when the
  state gets worse and after the credits were fine again.
- "I've topped up": the app's own form, never `prompt()`. On a phone an
  `EntryMobileSheet` (it lifts above the keyboard) with one field, "Credit
  bought (US$)" (`inputMode="decimal"`), and Cancel and Save in its
  `BottomActions` bar under the thumb; on a wide screen a small Radix
  dialog with the same field and Cancel and Save at its bottom right. Save
  stays disabled while the field is empty; a refused amount or a failed
  save shows an inline error and keeps the form open.
- Settings: the Ask and AI section (collapsible like the others, after the
  Apple Pay shortcut) shows the same sentence as text in the tone's ink
  (plain ink when fine), the two actions as neutral pills, and "Last
  checked …" muted; with Claude not set up, only the calm line "Claude
  isn't set up, so Ask uses the basic model."; set up but not answered yet
  (state unknown, no failure recorded), only "Claude hasn't been used
  yet."

## Lead · Support · Detail

The owner-approved design language for sheets, dialogs and screen tops
(not lists: Entries rows, Splits activity and Imports tables stay flat).
Each has **one thing you look at first** (Lead), **a few facts that explain
it** (Support) and **quiet rows you tap to change things** (Detail), with
the main action at the bottom where the thumb is.

Blocks: one implementation, `src/client/ui/lead-support-detail.jsx`, and
one stylesheet, `lead-support-detail.css`, which the module imports itself
(class prefix `lsd-`). Small props; callers pass copy, controls and
handlers. `ui-components.jsx` re-exports the blocks so they share its
chunk: the Summary lead is on the first screen, and on their own the blocks
were two more first-screen files for `check:bundle` (which counts JS files
and measures `public/styles.css`; the blocks' CSS rides with that chunk, so
it never grows `styles.css`). Two branches first built these blocks
separately (the Month and Summary slice and the Entries and Splits slice);
the props below are their union, so both sets of call sites use the same
components.

- `LeadCard`: the one white card with the strong shadow (`0 14px 32px`,
  radius 22px). With a `title` it is a head line: the 56 px bubble (a
  `bubble` node such as the category editor button, else one built from
  `category` `{colorHex, iconKey, icon, bubble}`: the colour at 20% over
  white, the glyph at 70% with the ink; a neutral grey without either), the
  title (a string is the strong title; a node, such as an inline field, is
  used as given), a `subtitle` in the category colour (`accentColor`
  overrides it) mixed 62% with the ink, and the `amount` on the right,
  optionally with an `amountCaption` under it ("planned"). Without a title
  the `eyebrow` and the amount stack, with `amountAside` after it (the
  Summary lead). A string `amount` goes through `PrivateMoney`; `tone` is a
  money tone rendered with `moneyToneClass` (text only). `editable` marks an
  amount the person types: a thin terracotta underline (on the caller's
  `.lsd-amount-field`, or on the amount itself around a plain input), and
  with a caption the amount column is a `<label>`. `progress`
  (`{ valueMinor, planMinor, overIsShort }`) draws the actual-vs-plan bar:
  sky track, grey fill, rose past the plan (`leadProgress`, the `spendTone`
  rule, so spending with no plan is over); `progressStart` and
  `progressEnd` are the line under it, `hiddenProgressStart` its
  hidden-money form. `tag` sits above the head line (the Ask tag); then the
  bar, the `chips` row (an array or a fragment), then `children`.
- `MetaChip {icon, person, tone, className}`: a Support pill (neutral fill,
  optional 14 px icon). `person` gives that person's chip from
  `getPersonColourVars` (tint, border, `--person-ink`, a dot); `tone` a
  status in its pastel pair at the soft strength (`mint`, `rose`, `sky`,
  `butter`, `lavender`; an unknown tone is ignored), such as the mint
  "Statement certified" chip with a lock. At most four per card. A chip is
  read-only unless it names a field you can change (see "Tappable chips"
  below): `onClick` or a laid-over `control` (`ChipDateField`), with
  `actionLabel`, makes it open that field's picker; `locked` (with
  `lockedLabel`) shows a lock and opens nothing.
- `DetailRows {label}` and `DetailRow {label, value, emptyLabel, state,
  action, locked, disabled, hint, labelId, onClick, children}`: rows of
  48 px or more in one rounded group, label left (muted), value right (600)
  and a `›`. Without `children` a row is a button; with `children` (the
  field's own control: an inline input, a `ResponsiveSelect`, a date input,
  a one-line textarea, or a native select or date field laid over the row
  with `lsd-row-native`) it is a `<label>` around it, so the control keeps
  the row's name, edits in place and Tab order stays the field order. A
  control that is itself a button (the phone `ResponsiveSelect` trigger)
  takes the row's `labelId`, so it is named by the label and its value
  ("Category Savings"). States: `state` `empty` (muted, or an empty `value`
  with its `emptyLabel`, "Add a note"), `action` (terracotta, "Add to
  splits", "See the 10 entries"; also the `action` flag) and `locked`
  (muted with a lock instead of the `›`, never clickable; also the `locked`
  flag). `disabled` mutes a button row and drops its `›`. `readOnly` is a
  plain line with no icon, for a fact nobody changes on that screen (Added
  by).
- `MoreDetails {summary, open, onOpenChange, defaultOpen, forceOpen, label,
  openLabel}`: the folding row inside the group; it lists what it holds
  while closed, and its rows follow it in the same group when open.
  Controlled (`open`, `onOpenChange`) or on its own (`defaultOpen`).
  `forceOpen` keeps it open: required fields and anything with an error
  never fold. A field folds when most people never change it on that
  screen; on a wide screen nothing folds.
- `BottomActions`: the action bar. A destructive or quiet action sits on
  its own at the start; the secondary action and the primary action are at
  the end, primary last, under the right thumb. Pass ready buttons
  (`destructive`, `secondary`, `primary`, with the `lsd-quiet`,
  `lsd-quiet is-danger` and `lsd-primary` classes; a destructive action
  asks in the app before it acts) or let the bar build them from
  `primaryLabel` (submits the form unless `onPrimary`), `primaryDisabled`,
  and `quietLabel` with `onQuiet` (`quietTone="danger"` for Delete).
  `className="is-sheet-bar"` makes it a sheet's own sticky footer, 50 px
  buttons inside the safe-area insets; a sheet with side padding sets
  `--bottom-actions-bleed` (the mobile sheet does) so the bar spans it.

`src/client/detail-field-rows.jsx` adds the field rows the edit sheets
share: `PickerRow` (the phone picker sheet, `ResponsiveSelect`, in a sheet; a
native select laid over the row on a wide screen), `DateRow` (a date field
over the row in a sheet; a visible inline date field on a wide screen) and
`GrowingTextarea` (what it was, a note).

Tappable chips: a Support chip that names a field you can change opens
the same picker or editor as that field's Detail row, so the fact you look
at is also the way to change it. Edit entry card: date (the date picker),
wallet (the wallet picker, unfolding More details) and owner; on a wide
screen the inline editor's three chips are the fields themselves. Ask draft
card: date, wallet and owner. New split expense card: date, paid by,
shares (the share editor) and paid using. The Month plan card's chips are
not fields there, and a saved Ask card's chips are not editors.

- Calm, not loud: the pill keeps its size and colours and adds only a small
  muted chevron and the rows' press state; no new colour.
- 44 × 44 px: the pill sits inside a transparent button (or under a date
  field laid over it) at least 44 px each way; the chips row pulls in 4 px
  top and bottom so the taller targets add little height.
- Named for what it does: "Change date, Yesterday", "Change wallet, UOB
  One", "Change paid by, Tim", "Change shares, 50 / 50".
- Locked: a field the statement certified (date, wallet), or a payment way
  the linked entry set, shows a small lock and opens nothing; assistive
  tech hears ", locked by the statement" (or ", set by the linked entry").
- State chips (Manual provisional, Statement certified) are never editors.
- On a wide screen the Entries inline editor has no row for date, wallet or
  owner, so those chips are the fields (a date field, a native list); the
  Splits inline card does the same for date, paid by and paid using.

Source chip: the bank state chip names the tool that saved a provisional
entry, "Apple Pay · provisional" (the Apple Pay Shortcut) or "Ask ·
provisional", on the Edit entry card and Ask's saved card; a certified
entry says "Statement certified" and other entries keep "Manual
provisional" or "Import provisional". More details then has a read-only
"Added by" row (Apple Pay shortcut, Ask), and its folded hint names it
("Date, wallet, posted date, type, added by"; certified: "Posted date,
type, added by"; `moreDetailsSummary`), and an Entries row shows a small
muted glyph inside its amount's line (a contactless mark, "Added with Apple
Pay"; a sparkle, "Added in Ask") that keeps the row's height and is the
same with money hidden. The words come from `entry-source.js`, from the
entry's `addedBy`.

The phone picker sheet (`ResponsiveSelect`, and the Entries filter
multi-select) keeps its title in place and scrolls its options list, so the
last of many wallets or categories is a swipe away; a centred phone dialog
taller than the screen (Transfer details) scrolls inside itself. An open
picker or dialog locks the page's scroll and cancels any swipe that has
nothing inside it to scroll, so every list that can outgrow the screen must
be a scroll container of its own (`tests/e2e/picker-scroll.spec.js`).

Rules:

- Exactly one lead per sheet, card or screen top. Money in it uses the
  money tones only: a plan sky, an expense rose, income mint, over plan
  rose, transfers and totals plain; text only, never a fill. Summary's
  Support figures are soft-tint pills (mint when good), their plan a quiet
  line in the pill's ink.
- Hidden money: the lead amount is dots in plain ink with no sign (an
  editable amount masks its digits), the bar keeps only its empty track,
  side-of-zero words go ("left", "over", "to come", "under plan", "% of
  plan"), pills lose their tint, share rows show `••••` for the amount but
  keep the percent, and chips without money stay.
- Thumb zone (phone): the primary action (Done, Save) is in a bottom bar
  that stays at the bottom of the sheet, with Cancel or Close beside it or
  at the start and a destructive action apart on the left; the top ✕ (a
  44 px round target) is never the only way out. Every tappable is
  44 × 44 px or more with at least 8 px to its neighbours (Detail rows are
  one list, stacked 48 px rows; `tests/e2e/lead-support-detail.spec.js` and
  `tests/e2e/lead-support-detail-sheets.spec.js` measure the boxes, the
  latter in WebKit on an iPhone 13 and in Chromium). Money fields use
  `inputMode="decimal"`. Nothing depends on hover.
- Keyboard: every bottom sheet with a bottom bar lifts itself above the
  phone keyboard (`use-keyboard-inset.js` sets `--keyboard-inset`; see
  "Mobile Sheet"), so the bar and the focused field stay in sight, and the
  bar keeps the safe-area inset. Swipe down to close is supported only
  through `sheet-swipe.jsx`, which closes an unchanged sheet and asks
  before discarding a changed one (see "Swipe down to close" under "Mobile
  Sheet").
- No AI tag outside the Ask flow; a bank- or rule-filled value is not AI.

Where it is used:

- Summary top (`summary-lead.jsx`, `summary-lead-model.js`): "Spent ·
  range", the range's spending "of" its spend plan, then one text line
  (no bar) with the percent of plan and how far under (mint) or over (rose)
  plan, then the savings bar and the money jobs (below); Income and
  Saved pills with planned income and the savings target. The figures are
  the Summary DTO's own metric cards (one card was added, "Planned
  investments") and its category share, through one split
  (`splitMoneyUse`, "Money jobs" below): the spend leaves out money filed
  under Investments or Savings, the plan leaves out the savings target and
  the Investments plan rows, so the "under / over plan" line always agrees
  with the spend job, and Saved is the bar's kept (realized savings plus
  money moved to Savings). The tones follow (`spendTone`, `signTone`). Phone
  stacks the pills under the lead; desktop and tablet put them in a column
  on its right. The group is `SpendLeadGroup` (`ui/spend-lead-group.jsx`,
  re-exported by `ui-components.jsx` so the Month top shares its chunk and
  the first screen keeps its file count); its CSS is `summary-lead.css`
  (it sits in `.panel-head`, whose `span` rule mutes spans, so its money
  spans take their tone back at a higher specificity). Until the metric
  cards arrive the top shows nothing (the old tile row scrolled sideways on
  a phone).
- Month top (`MonthLead` in `month-overview.jsx`, `month-lead-model.js`): the
  same `SpendLeadGroup` for one month, eyebrow "Spent · May 2026". The lead
  is the spend job's spending against its plan (the same split as Summary)
  with one text line (no bar), "x% of
  plan" and "$y under plan" (mint) or "$y over plan" (rose, the old Spend
  gap), then the savings bar and the money jobs line (below); Income
  (received, with "plan $x"), Saved (kept, with "target $x") and
  Remaining budget are one row of three equal columns inside the lead
  card under the savings bar (`SpendLeadGroup` `inline`, `LeadColumn`; hairlines, text
  colour only, 52 px tall, at most 215 px for the whole card on an iPhone 13
  with the savings bar and its legend (about 214 px; the card's gaps and
  padding are tight in `month-route.css` for that), the same row on desktop; the Summary top keeps its pills). Income is the month's own
  Summary rollup (`summaryPage.months[0]`, already on the Month page);
  spend, plan and savings target start from the Month metric cards and go
  through the split with the month's plan rows and category share, Saved
  is the split's kept, and remaining budget (planned income minus the whole
  plan) is the card's own figure. Remaining budget is an openable figure
  (see "Openable figures"): the whole column opens its menu, whose first line
  is the explanation the old popover held, then Open plan and Ask about this;
  its label is "To
  allocate" or "Overplanned", and "Remaining budget" with the money hidden. The six sideways
  tiles are gone; nothing scrolls sideways at 390 px.
- Savings bar (`ui/savings-bar.jsx`, `savings-bar-model.js`, CSS in
  `summary-lead.css`; inside `SpendLeadGroup`, so on both the Summary top and
  the Month top, under the spend line and above the Income / Saved pills or
  columns). The old spend-against-plan bar was removed (three bars were too
  many; its text line stays), so this is the lead's only bar: it says what the
  period left you with. All money earned in the period
  (income) is one 10 px bar, income = 100%: rose is spent, faded plum is
  invested and mint is kept. The split is `splitMoneyUse`
  (`money-jobs-model.js`, see "Money jobs" below): money filed under the
  Investments category is invested and money filed under Savings is kept,
  both out of the lead's spend. Transfers into investment accounts are
  invested too, less transfers out of them (the page's `investmentMoves`,
  worked out on the server by `investment-moves.ts`; DOMAIN.md "Money
  job"). Invested never goes below zero: a period that took more out of
  investments than it put in adds one legend line with no swatch and no
  part on the bar, "Took out of investments $x" (`data-legend="taken-out"`),
  left out when money is hidden. If more went out than came in there is no
  mint: the bar is as long as what went out (spent, then invested), with a
  small dark tick where the income ends. The tick has no label on the bar
  (a label there covered the parts, the owner's screenshot of "All you earned
  $138,761" over the plum): the legend names it with a swatch drawn like the
  tick, "All you earned $247,007" from 761 px and "Earned" on a phone, where
  the legend must stay one line (the figure is the Income column's and the
  sentence's; `data-legend="earned"`, `tickLegend`, `tickLegendShort`);
  spending past the tick is rose stripes ("came out of savings"). No income but some spending is all
  stripes with no tick; no income and nothing out draws nothing. A 3 px sky
  plan bar sits directly under it on the same scale (the spend job's plan,
  then the investment goal, then the savings goal, each a lighter sky; a
  plan longer than the bar is cut at its end in that order; the planned
  spend no longer counts the savings target twice). Under the bars: one
  plain line ("You kept $38,000 of the $247,000 you earned (15%)", "You kept
  $12,000 and invested $8,000 of the $247,000 you earned", "You spent
  $54,871 more than you earned" or "You invested $500, $300 of it from
  savings"), then the money jobs line, which took the old muted "Plan: spend
  $x and save $y." line's place. Amounts here are whole dollars. Every figure
  is one the lead already has (income, spend, planned spend, savings target,
  the category share, the page's `investmentMoves`) plus the Summary's
  "Planned investments" card. It
  never forecasts and never says what to spend: only what happened and the
  household's own plan. Under the bars is an always-visible legend (`<ul data-savings-legend>`, no
  popover, hover or tap needed): a swatch in the part's own colour (the stripes
  for the part that came out of savings, the neutral greys when money is
  hidden), its short name and its figure, "Spent $209,000", "Invested
  $8,000", "Kept $38,000", "From savings $54,871", in bar order, then the
  thin plan bar's name with a sky swatch. On a phone it is one line
  (11.2 px; it wraps only if it must): amounts without the share, and the
  plan item is just "Plan". From 761 px each part adds its share of income in
  muted text ("Spent $209,000 · 85%") and the plan item reads "Plan: spend
  $247,673 · keep $41,300" (the plan's own figures, not cut to the bar, only
  the goals that exist). Each segment is a `button` (aria-label "Spent",
  "Invested", "Kept" or "Came out of savings") whose `aria-describedby`
  points at its legend item. Every part, legend line and the sentence is an
  openable figure (see "Openable figures"): spent is `spending`, invested
  `invested`, kept `kept`, the striped part `from_savings`, the tick's line
  `earned`, the plan line `plan` and "Took out of investments" `took_out`;
  the sentence opens the figure it is about (`sentenceFig`: kept, invested
  past income, or from savings). A click, a tap, Enter or Space opens the
  menu under the part; a second press on the same part, a press on another
  figure (which moves the menu), Escape or a press outside closes it. The
  legend lines and the sentence sit over the parts' 44 px reach (`z-index`),
  so a tap on "Earned" or "Plan" opens their own menu. Without a period (an
  Ask answer's bar) nothing opens and the parts are plain `role="img"`
  spans. The bar is 10 px tall and its hit area reaches 17 px above and
  below, so a segment is a 44 px target. No chart
  library: plain flex boxes with percentage widths. Hidden money: the shape
  stays, the colours go neutral grey (three greys when invested is there),
  the legend has the names and percentages only on a phone too ("Spent ·
  85%", "Kept · 15%"), with no plan item (the plan bar is not drawn), the
  tick's legend line reads "All you earned" ("Earned" on a phone) without an
  amount, the sentence is "Spent and
  kept, as a share of what you earned" (or "Spent, invested and kept, as
  shares of income"), and the plan bar is not drawn. The bar's colours are the money tones (rose spent, mint
  kept, sky plan) plus faded plum (`--pastel-lavender-ink`) for invested:
  money put to work, a good outcome like kept (its model tone is `in`), but
  a part of its own, and never sky, which is a plan.
- Money jobs (`ui/money-jobs.jsx`, `money-jobs-model.js`, CSS in
  `summary-lead.css`; inside `SpendLeadGroup` under the savings bar, DOMAIN.md
  "Money job"): a `<details>` Detail whose summary is one muted line, "3 of
  4 money jobs done" ("… so far" while the period's last month is the
  current month), folded on a phone (it takes the old plan line's place and
  height, 3 px under the sentence, so the Month card stays at most 215 px;
  a phone shows the sentences that name investing in a one-line form, "Kept
  $12,000 · invested $8,000 of $247,000" or "Spent $300 over income ·
  invested $200", so the card stays at most 215 px with investments too;
  wider screens keep the full sentence) and open from 761 px. The line's tap target is 40 px: its
  padding reaches into the gaps above and below and a negative margin gives
  the space back; the bar's segments sit above it where the two reach
  overlap (a pseudo-element target covered the bar in Chrome). Open, it
  lists one quiet row per job, in the owner's order: "Spend within $x",
  "Save $x", "Invest $x", "Income $x", each with "✓ done" in mint or "short
  by $n" / "over by $n" in rose, text only ("✓ so far" and "… so far" for a
  month in progress). A job is listed only when its plan line is more than
  zero; a gap under 50 cents (which would read "$0") is done. Each row is a
  button and an openable figure (`MONEY_JOB_FIGURES` in
  `money-jobs-detail.js`): the spend job is `spending`, save `kept`, invest
  `invested` and income `earned`, each with Open plan (income opens the
  plan's income part), and the spend job over its plan asks why. Hidden money: the
  labels drop their amounts ("Spend within plan", "Save"), a done job is
  "✓" and any other the share of its plan reached ("80%"), all in plain ink.
  Only the folded line is in the first screen (the jobs' numbers,
  `listMoneyJobs`, and its one string). The rows and their words
  (`copy/money-jobs-copy.js`) are `money-jobs-detail.js`, loaded by
  `money-jobs-loader.js` on the first open of the jobs (at once where they
  start open, from 761 px), the way Money insights load. It draws the rows
  with the caller's `createElement` and keeps no state: a lazy chunk that
  imports React from the shared chunk made the bundler split that chunk
  into one more first-screen file.
- The menu a bar part, a job and every other figure opens is the one
  described under "Openable figures" below (`figure-menu.js`).
- Month plan tables (`month-plan-tables.jsx`, `month-plan-rows.css`, in the
  Month route chunk): Income, Budget Buckets and Planned Items keep their
  `<table>` markup (inline editing, sorting, row opening and the tests'
  hooks are unchanged); only the hierarchy changes. Every layout: the item
  is the heavy lead, Planned, Actual and Variance are right-aligned and
  tabular, Category, Date, Account and Note are quiet, and a 4 px bar under
  each actual (`PlanRowBar`, the lead card's fill rule: rose only past the
  plan, mint for income received, track only when money is hidden). Phone
  and portrait tablet (the sheet layout) draw each row as a compact card:
  the category bubble, the item and its category on the left, the actual
  with "of $planned" on the right, the bar, then the note and "Variance
  $x"; the date and account are on the plan card sheet a tap opens, the
  column names are a strip of small chips (the active sort shows its arrow),
  the category line is dropped when it equals the item's name, an empty note
  shows nothing, the total is one line, and
  nothing scrolls sideways (`tests/e2e/summary-month-lsd.spec.js`).
- Summary Intent vs Outcome (`summary-intent-outcome.jsx`,
  `summary-intent-outcome-model.js`, `summary-intent-outcome.css` in the
  Summary route chunk): newest month first, each a compact `LeadCard`. The
  month name (a 44 px link) opens the month; Lead: that month's spent
  against planned spend with the bar and "x% of plan · $y under/over plan"
  (the old row's variance); Support: Planned income and Actual income chips;
  Detail: a `MoreDetails` row named "Details" holds the old table's three
  rows (Income, Expected spend, Savings goal: planned, actual, variance) and
  the month note row, which edits the note. Every figure is openable (see
  "Openable figures"; the card carries its month as the period): the spent
  lead and its line open `spent` (every expense less paybacks, as the card
  counts it) with Open plan, the plan aside and planned figures `plan`, the
  income chips `earned`, and the Details' actuals `earned`, `spent` and
  `difference` (realized savings, income less spending). The section is a
  `React.lazy` chunk beside the first screen (it sits under Spending Mix),
  which made room in the first-screen budget for the lead's figures. The latest month starts open,
  the others fold. From 1,024 px the cards are a grid, 2 across (3 from 1,440
  px), latest first; a card with its Details open spans the whole row so no gap sits beside it, and the section takes the full row under Spending Mix. Hidden money: dots in plain ink, the bar's track only, no
  percent and no under/over words, the variance dots too.
  `tests/e2e/summary-month-lsd.spec.js` compares every figure with the page
  DTO on a phone (WebKit-tagged) and a desktop, and checks 390 px for
  sideways scroll.
- Plan or Simple (`lead-view.js`, DOMAIN.md "Lead View"): one switch sets
  the whole Summary and Month page's mode. It sits on the right of the
  lead's eyebrow, "Plan" | "Simple" (`LeadViewSwitch` in
  `ui/spend-lead-group.jsx`): a `role="radiogroup"` named "Show this
  period" of two native radio inputs (`name="lead-view"`), so the browser
  gives the arrow keys and the tab order. It is drawn 30 px tall as a pill
  on `--chip` with the chosen option on `--card`; negative margins keep the
  eyebrow line's height (the Month card stays at most 215 px on a phone),
  and each invisible input covers its label and 9 px above and below, a
  44 px target. Plan is the pages as they were. Without a choice
  a page opens in Simple, with a plan or without, and while the figures
  load (a constant in `chooseLeadView`, so the first screen does not grow;
  `hasPlan` no longer picks the default).
  Settings > Summary view (`settings-lead-view-section.jsx`, a row in the
  Settings list like Colours: label, the status word "Simple" or "Plan", a
  chevron) unfolds to the same two choices as a segmented control
  (`settings-colour-mode` buttons, `aria-pressed`) with one line: "How
  Summary and Month open. You can still switch on the page." It reads and
  writes `leadViewStore` through `useLeadView`, so it is the same per-login
  preference as the page's switch, not a second setting; Settings is a lazy
  route, so the row adds nothing to the first screen.
  The choice belongs to the signed-in login: the app shell carries it
  (`leadView`, `app-repository-viewer-preferences.ts`, keyed by a SHA-256
  of the Access email) and a switch is shown at once, then saved with
  `POST /api/viewer-preferences/lead-view` (`viewer-preferences-route.ts`:
  1 KB body cap, 401 without a login, 400 for anything but plan or simple,
  the cross-site guard in front). One store (`leadViewStore`,
  `useSyncExternalStore`) serves both pages; App applies each shell to it.
  The device's `monies-map:lead-view` is a first-paint cache that a signed-in
  shell replaces (a login that never chose clears it); a switch also
  patches the app shell kept for a fast start (`app-shell-query.js`), so a
  reload does not bring the old choice back. A save on its way is not
  undone by a shell that lands meanwhile; a failed save keeps the choice
  for the visit and on the device. Without a login (demo, local dev) the
  device's storage is where it lives (read and written in try/catch:
  blocked storage means the default and a switch that works for the visit).
  The lead in Simple (`SpendLeadGroup view="simple"`): the eyebrow is the
  period alone ("Jun 2025 – May 2026", "May 2026"); the lead is "Earned $x ·
  Spent $y" at 1.5 rem, wrapping to two lines when the figures are long
  (earned is mint, spent plain ink, rose only when more went out than came
  in, `spendTone` against income); then the savings bar with
  `withPlan={false}` (no plan bar, no plan legend item; its plain line, "You
  kept $x of the $y you earned (15%)" or "You spent $x more than you
  earned", is Simple's one line of words); no "of $x plan", no percent of
  plan, no money jobs, and no Income / Saved pills or Income / Saved /
  Remaining budget columns (each a plan figure or a repeat of the lead).
  Under the bar, Simple's facts (`simple-metrics-model.js`, rendered by
  `simple-detail.js`): small pills that wrap, "Daily spend $56" (the spending over the period's
  days; "Daily spend so far" up to today while it is going), then "Top
  spending" with the three biggest spending categories and their share of
  spending as chips (44 px reach), each an openable figure (`category`: View
  entries is that category's spending over the period, Ask asks how much
  was spent on it). Daily spend opens the spending it is worked out from
  (`spending`; a daily average is not a filter, so Entries shows the
  period's spending, the figure it divides). Money
  filed under Investments or Savings is not spending here either. Chosen
  over the other candidates: what was kept and its share of income (the
  savings rate), or how much more went out than came in, is already the
  bar's plain line just above (a "Kept $x · 79%" pill repeated it word for
  word, so it was dropped); invested and taken out of investments are
  already the bar's legend lines; a change against the previous period and
  a splits balance need data neither page loads, so they are left out. All
  whole dollars, every figure from the lead's `splitMoneyUse` and the page's
  category share. Hidden money keeps only the categories' shares.
  The figures are the lead model's `simple` (`buildSummaryLeadModel`), from
  the same split as Plan's.
  Summary in Simple: the lead, Money insights without the insights about
  the plan (`withoutPlanSignals`, `money-signals/plan-signals.ts`: months
  under plan, plan short or left, over plan, planned bills, savings on
  plan, plan pace, fixed costs; the check-in's context key gains "|simple"
  so its memory is per mode), Spending Mix, "Earned vs spent by month" in
  Intent vs Outcome's place, and Wallets in view. "Earned vs spent by month"
  (`summary-earned-spent.js`, model `summary-earned-spent-model.js`): flat
  rows split by hairlines, newest first; the month name (44 px) opens the
  month, beside it "Kept $x" (mint) or "Overspent $x" (rose), under it
  "Earned $x  Spent $y" (and "Invested $z" when there is any) and a 6 px bar
  on the month's own scale in the savings bar's colours (spent, the part
  past the income striped, invested, kept). Each month goes through
  `splitMoneyUse` with its own category share and its own investment moves
  (the Summary page's `investmentMovesByMonth`, only the months where
  something moved), so its spent, invested and kept are the Month lead's.
  **The month chart.** Above the rows (and above Intent vs Outcome's cards in
  Plan), when the range has two or more months, a column + line chart
  (`earned-spent-chart.js`, hand-drawn SVG, its own lazy chunk behind an
  invisible `.earned-spent-chart-reserve`, so the cards under it do not move).
  Simple: Earned (mint) and Spent (rose) columns, in the savings bar's
  colours, and a Kept line (mint ink; a point below zero is rose ink), with
  the zero line marked. Plan: the same columns and a Planned spending line
  (sky ink) that breaks where a month has no plan. Months run oldest to
  newest with short labels and the year on the first and each January; 12
  months fit a phone by narrowing the columns, and only past 12 does the
  plot scroll sideways while the y axis stays put. A few gridlines carry
  compact labels ($8k). The legend chips (Earned, Spent, Kept or Planned
  spending) show and hide a series; the last one showing stays, and the
  scale is of every series so hiding one never rescales the rest. Each
  column and point is an openable figure whose menu is titled with the series
  and the month ("Spent · Oct 2026"), with quick facts first, then View
  entries (that month's money behind the figure), Open plan on the plan
  figures and Ask about this. Pointing, focus or the menu marks the month's
  row in the list. Columns grow from the baseline and the line draws on once
  when first seen (700-800 ms ease-out); reduced motion starts the chart at
  rest. Hidden money draws no chart at all. The chunk imports neither React
  nor money-privacy (the panel hands it React): either would split a shared
  module out of the first screen's chunks (`npm run check:bundle`).
  Each row carries its month as the period, and Earned, Spent, Invested and
  Kept / Overspent are openable figures (`earned`, `spending`, `invested`,
  `kept`; with money hidden the "Spent · 85% of earned" line opens
  `spending`).
  Month in Simple: the lead, the insights without the plan ones, Spending
  Mix (where the money went: each category with its amount, share and bar,
  opening its entries), then "Money in" (`MonthMoneyIn` in
  `month-overview.jsx`, `month-money-in-model.js`, words
  `copy/month-simple-copy.js`) where the plan tables are: one row per income
  source (the entry's description; repeated sources add up, "Salary · 2
  entries"), mint amounts, each opening its entries, then a quiet "Plan this
  month" that switches the page to Plan, where the plan is edited; then the
  notes and accounts. The lead's model and the view are the panel's
  (`useMonthLead`).
  Loading: the lead's Simple parts are in the first screen (the switch, the
  store, the Simple lead). The facts and the month list are
  `simple-detail.js` (with `simple-view.css` and `copy/simple-view-copy.js`),
  loaded by `SimpleDetail` (a `React.lazy` in `ui/spend-lead-group.jsx`)
  only when Simple shows. It imports no React (it is handed `createElement`
  and the chevron), like `money-jobs-detail.js`: a lazy chunk importing
  React made the bundler split a shared chunk into one more first-screen
  file. Month's parts are in the Month route's chunk. Hidden money: the
  Simple lead's figures are dots in plain ink; the bar is in greys with its
  hidden sentence; the facts keep only the categories' shares; the month
  list keeps each bar and says only "Spent · 85% of earned" (nothing for a
  month with no income), with no amount and no kept or overspent word;
  Money in shows dots. (`tests/e2e/lead-simple-view.spec.js`,
  `tests/lead-view.test.mjs`, `tests/simple-metrics-model.test.mjs`,
  `tests/simple-page.test.mjs`, `tests/viewer-preferences.test.mjs`.)
- Summary body, under the lead (`spending-mix-section.jsx`,
  `summary-panel.jsx`, `summary-body.css`, in the Spending Mix and Summary
  chunks; no `styles.css` growth; Spending Mix is a `React.lazy` chunk beside
  the first screen, list, slice menus and words included). The Spending Mix donut labels only the
  slices with room for a label (`SpendingMixChart sliceLabels`, laid out by
  `donut-label-layout.js` in the lazy Recharts chunk; the old percent labels
  and category badges collided when many categories had thin slices, and
  Entries and Splits keep those). Biggest slice first, a slice whose ring
  edge is at least 18 px long gets "Name 32.1%" just outside the ring, or
  the name over the share on two lines when one line does not fit, or
  nothing (owner, 2026-10-14: a bare "4.3%" cannot be told apart, so a share
  never shows without its name): each label must stay
  inside the chart, off the ring and 4 px clear of every label already
  placed (text measured on a canvas). Small slices have no label; the ranked
  list names every category. Labels are plain page ink (`--text`), so they
  read in every colour preset, are `aria-hidden` (the list is what assistive
  tech reads), show shares of all spending (as the list does) and never an
  amount, so hidden money keeps them. The chart is 260 px tall on a phone and
  380 px wider, with label room around the ring. Under it, or beside it when
  the card itself is at least 700 px wide (a container query; the donut
  then takes 58% of the card), a lean ranked list in one `DetailRows` group,
  biggest first, one 44 px line per category: a small dot in the category's
  colour (a 44 px target that edits the category, as the bubble did), the
  name (one line, an ellipsis), the amount and the share to one decimal; the
  `›` (44 × 44) opens the category's figure
  menu (`category`, over the page's period: the Summary's whole range, or
  the Month's month), whose View entries total is the row's amount.
  The main tap still hides or shows the slice in the donut (`aria-pressed`);
  a hidden category stays listed, dimmed, with the existing "Hidden" word,
  and the donut's total follows the shown ones while the shares stay of all
  spending. A desktop shows the top five and a phone the top three (the
  owner leaned to the donut and three rows on a phone, so it stays short
  without hiding the list); a last row, "Show all N" / "Show fewer"
  (`aria-expanded`), lists the rest. "Hide list" / "Show list" in the
  card's head (a quiet text button, `aria-expanded`) folds the list away:
  the donut then takes the whole card, bigger (340 px on a phone, 440 px
  wider), with every label that fits; the choice is kept on the device
  (`monies-map:spending-mix-list`, read and written in try/catch). Each
  slice is an openable figure (`category`): a clear sector over it in the
  labels' layer takes the tap, the focus (`tabIndex` 0, the arrow keys move
  between slices in ring order) and on a desktop a resting pointer (a
  quarter of a second, the menu at the pointer, the focus left where it
  is; a click then keeps it open). Its menu starts with the slice's facts:
  amount and share of spending ("$7,638.77 · 44.5% of spending"; the share
  alone with money hidden), entries, and on the Month page what it already
  holds (`month-slice-facts.js`): "$250 of $300 planned" when a plan line
  has the category (then Open plan) and the two biggest merchants. A change
  against the previous period is left out: neither page loads it. The
  coloured sectors take no pointer events, so Recharts never swaps a sector
  for its "active" copy under the pointer.
  Wallets in view is one group of `DetailRow`s (a `DetailRows` group, from
  1,024 px the heading on the left and the group on the right): the wallet
  name with its statement freshness under it ("Reconciled to Sep 2026
  statement", in the money tone's ink: mint when matched, rose when off,
  plain when no checkpoint) and the balance with a `›`, 60 px or more. It
  replaces the wrapping tone-filled pills, so a wallet that is off no longer
  fills a whole rose card; a tap opens Entries for that wallet. Month's
  Accounts section still uses the pills. The note rows of Intent vs
  Outcome are Detail rows (48 px). Hidden money: dots for every amount,
  the donut's centre and the bars and shares kept (a share is not an
  amount), and no wallet freshness line (it says which side of the
  statement the wallet is on). `tests/e2e/summary-body-lsd.spec.js` checks no
  two labels or badges overlap, the top 5 and Show all, the three taps,
  every wallet against `/api/summary-account-pills`, targets of at least
  44 px, no sideways scroll, and hidden money, on a phone and a desktop.
- Month plan-row sheet (`month-plan-sheet.jsx`, phone and portrait tablet,
  add and edit for income, planned items and budget buckets): the planned
  amount is the editable lead under the row's name, kind and category
  bubble (the existing `CategoryAppearancePopover`); actual against it is
  the bar, with "$x spent" and "$y left" or "$y over" (income: "received"
  and "to come"); a new row has no bar. Chips: month, owner (person colour;
  "Shared" for a shared row) and entry count. Rows: Actual (See the N
  entries, the existing drilldown), Item name, Category, Date and Account
  (planned items) and Note. The sheet's sub-line is "Person · Month", and
  Done and Cancel are its `is-sheet-bar`. MonthPanel keeps the draft and
  every handler; desktop inline editing is unchanged.
- The Ask entry card (`ask-entry-card.jsx`) and the Ask answer card
  (`ask-answer-card.jsx`: the subject's bubble and title, what the total
  counts under it, the total on the right, the filters as chips).
- The Entries edit sheet and inline editor (`entry-edit-card.jsx`). Lead:
  the category bubble (opens the category editor), what it was and the
  amount, typed in place unless a statement certified them (then read-only,
  with the short lock line under the card, "Bank details are locked to the
  statement. Category, owner, note and splits stay editable."; the full rule,
  with the type choice, is the Statement certified chip's `title` and
  accessible description). The amount field shows
  money with two decimals ("64.20") until it is focused and the raw text
  while it is typed in (`leadAmountFieldValue`). Support: date, wallet,
  owner, bank state. Detail: Category, Owner, Splits ("Add to splits" or
  "View split"), the transfer match for a transfer, Note, then Date, Wallet,
  Posted date, Type (and Transfer direction); on a phone those last ones fold
  into More details, and a certified entry lists only Posted date (locked)
  and Type. On a wide screen (the inline editor) the lead card spans the
  top and the rows sit under it in two balanced columns. No row repeats a
  lead chip there, as on the Splits inline card: Owner, Date and Wallet have
  no row, and their chips are the fields (a date field over the date chip, a
  native list over the wallet and owner chips; the wallet chip shows even
  with no wallet set). A certified entry's date and wallet chips stay
  locked, the owner chip still edits. The rows that remain (Category,
  Splits, Note, Posted date, Type) keep an inline field, so Tab walks
  description, amount, the eye, the three chips, then the rows in order, and
  the card is about 40 px shorter (the stated cap at 1,280 px is 380 px for
  the editor, `entries-lsd.spec.js`). The saved request is the one the rows
  sent. Delete entry (and Delete split once it is on Splits), Cancel and
  Save are in the bottom bar.
- The Entries top (`entries-overview.jsx` `EntriesTotals`,
  `entries-totals-model.js`, its CSS in `entries-route.css`, in the lazy
  Entries route). Lead: "Spent · Aug 2026", the filtered view's gross spend
  in plain ink (spending is not bad for being spending), the person's share
  as its aside ("Ethan's share $1,369.25", only where it differs). Support:
  four pills, Income, Difference, Transfers and Outflow, the same figures the
  old sideways strip showed (a tint only where money has a direction: mint
  income, a mint surplus, a rose deficit; transfers and outflow plain, with
  the person's share as a small line where it differs). Detail: "Spending by
  category" (opens the existing breakdown, `aria-expanded`) and, on a phone
  only, "Filters" with "All entries" or "2 filters on" (opens the View and
  scope sheet, which holds the filters; `onOpenMobileContext`). A wide
  screen puts the pills 2 x 2 beside the lead and its row (as Summary) and
  keeps the filter bar on the page; a phone stacks lead, pills, rows. The
  inline "+ Add entry" is gone (the round + opens Ask's new entry card,
  whose "Edit in form" opens the Entries form). Hidden money: dots in plain
  ink, no sign, pills lose their tint. Nothing scrolls sideways or is cut
  off at 390, 1,024 or 1,280 px (`tests/e2e/entries-lsd.spec.js`). The lead
  and every pill are openable figures (`spent`, `earned`, `difference`,
  `transfers`, `outflow`): View entries narrows this same list to the rows
  behind the figure (`entry_figure`, the other filters kept), and the figure
  does not change. A figure opened from another card leads instead of
  Spent: "Invested · Jun 2025 – May 2026" and its total (a money job's total
  through `splitMoneyUse` at the view's amounts; an Entries figure the
  pill's own, with its share aside), with a chip at the top of the list in
  the From Ask chip's style naming the figure and period, whose ✕ goes back
  to the month's whole list (`EntriesFigureChip`). A Summary range lists all
  its months (`entry_from`, `entry_to`; the page asks
  `/api/entries-page?from=`); the money check-in still reads the page's own
  month. The wide
  filter bar stacks the Search label over its field and, from 961 to 1,099
  px, puts the search on its own row.
- Entries list rows and day headers (`entries-list.jsx`, `entries-route.css`).
  The hierarchy is spacing, not weight: the category is a quiet line above
  the merchant (regular weight; a bolder merchant was declined), the wallet a
  quiet line, the amount right-aligned and tabular on the merchant's line, an
  empty note or wallet detail renders nothing, and a matched transfer is
  plain muted text (an unmatched one keeps its pill). The person's colour edge
  stays on every row. The day header is a hairline divider (small caps date,
  rule, "Daily net" and the refresh button at the right) and a day's rows sit
  in one rounded white group. The day header is not a box at rest: it is
  sticky and paints `--page` (the panel behind the list), flat, so no lighter
  band or square corner shows above the group in any colour preset or mode.
  Stuck at the top of the screen it becomes a rounded bar (the owner's
  choice over the earlier fade): the day group's width, so its left and
  right edges sit on the group's, the group's 16 px radius, `--page` at 84%
  with a 12 px backdrop blur inside the rounded shape only, and its text
  inset 14 px (12 px on a phone) from the curve. Its height does not change,
  so nothing under it moves. `stuck-date-row.js` sets `data-stuck` from one
  shared IntersectionObserver (root top pulled in by 1 px), with no scroll
  listener and no render. `tests/e2e/date-row-flat.spec.js` samples pixels
  at rest in every preset and mode and checks the stuck bar's radius, blur,
  alpha and edges, on Entries and Splits, desktop and phone. A phone row is 68 px or more (icon, category,
  merchant and amount, wallet, chips), a wide row keeps the three columns.
- New, edit and view split expense (`split-expense-card.jsx`, from the Splits
  dialog in the phone sheet and the wide dialog, and in the list). Selecting a
  split expense row opens this card, as does the `editing_split_expense`
  link: on a wide screen it opens inline in the list, in place of the row,
  exactly as the Entries inline editor does (`layout="inline"`, the
  `splitInlineEditor` page flag, the bottom bar at its end; no dialog). Its
  layout is compact: the lead card across the top, then the Detail rows in
  two columns (share rows, Category, Group, Currency, Evidence, Note). Date,
  Paid by and Paid using have no row there, since each is a Support chip that
  edits it (a date field over the chip, a native select over the other two;
  a linked split's Paid using chip is locked), and the percent and amount
  editor opens from a share row or the shares chip rather than sitting open
  under the shares; a
  phone opens the sheet, and the household view and the archived batch open
  the dialog (`returnFocusToSplitRow`: a modal Dialog with no trigger
  button would otherwise drop focus on the page). A settlement row still
  edits in its own form. Enter and Space on the focused row open the card,
  Escape and Cancel close it, and the row takes focus back.
  Lead: the group bubble (terracotta; a plane for a foreign currency
  group), what it was, the group, and the total in the group currency
  (`formatCurrencyMinor`, plain ink). Support: date, who paid, the shares
  (`50 / 50`) and how it was paid. Detail: one row per person's share
  (`split-share-rows.js` reads them from the draft), Category, Group, then
  Date, Paid by, Paid using, Currency, Evidence and Note (folded on a phone).
  A share row opens the share editor: the share person's percent and amount,
  linked through the existing `updateSplitExpenseDraft`, so what the card
  shows and saves is what the form saved. The odd cent choice shows under
  the share rows whenever it applies.
  Edit split is the same card on a saved split, titled "Edit split", with
  Delete (quiet, rose, set apart; it asks in the app first), Cancel and
  Save expense in the bottom bar; swiping the phone sheet down asks "Discard
  changes?" when something changed. What a linked entry set (the paid-using
  chip and row) is locked and reads ", set by the linked entry"; the linked
  entry is a "View entry" row. View split (the read-only household view) shows
  the same card with no controls and Close. The save request is the one the
  form sent. Deleting from the card closes it once the split is gone. A
  settled split (in a simplified settlement, `settlementCheckpointId`, or a
  closed group batch, `isArchived`) opens the same card read-only
  (the dialog is titled "View split"; `split-card-lock.js`): a short lock line
  on top ("Settled on 17 May 2026. Undo the settle-up to change it." or
  "Simplified on 20 May 2026. Undo the simplification to change it."), its
  Undo button directly under it, then the card with no fields, no Save
  and no Delete, and Close. After the undo succeeds the card turns editable
  in place (the card is keyed by mode so its share editor opens fresh), and a
  failed undo shows its message in the same place. The household view is
  always read-only without the lock line. The server still refuses a change
  or delete of a settled split (`split_settlement_locked`), so a stale page
  cannot change one. A settlement row is not a card: its dialog and inline
  editor keep the in-place refusal.
- Settings (`settings-panel.jsx`, `settings-section.jsx`,
  `settings-sections.jsx`, `settings-accounts-section.jsx`). The closed page
  is one list: each section is a 52 px row (`SettingsSection`) with its title
  (an `h3` inside the toggle, so specs and assistive tech name the section by
  it) and a status word from `buildSettingsSummaries`
  (`settings-summary-model.js`: people's names, counts, "Not set up" or "1 to
  check" in butter, "All clear", "Basic model"; read-only, from data the
  section already shows, and no money). A run of closed rows is one rounded
  group; an open section keeps its row (tinted, chevron down) and its body
  unfolds under it as a bordered block, which ends the run (sibling selectors
  in `settings-route.css`, so a row never remounts and focus stays on the
  toggle). The long descriptions are gone from the rows; a section keeps
  what it needs as one muted hint or a folded `MoreDetails` row.
  Apple Pay shortcut: a lead ("Apple Pay capture", set up or not), chips
  (Apple-signed, opens the entry to edit), rows Default account (opens the
  priority list, the same drag and up/down controls), Other currencies go to
  (a native select over the row), How to set it up (4 steps, folded) and More
  shortcut settings (folded), Install Apple Shortcut at the bottom. Ask and
  AI: a lead (who answers Ask, one chip for the credit state), Model and
  Last checked rows, then the existing credit line, month line and actions.
  Payment ways: a person chip and two rows per person. Categories: a row per
  category (bubble and name; no slug or colour code) that opens the editor,
  a 44 px delete, "+ Add category" last. Category matching: attention panels
  in pastel pairs, "How matching works" folded, rule groups folded until
  opened. Balance trust rules: three folded rows, the exceptions as rows.
  Unresolved transfers, Error diagnostics and Recent balance activity: flat
  rows in one group. An account's kind is read in words
  (`settings-account-line.js`), never as the stored value.
- Imports review (`import-file-card.jsx`, `import-preview-row-list.jsx`).
  Lead: the file card (the file's label, "N rows will import" from
  `countRowsToImport`, the same count the commit bar says). Support: the
  dates it covers, "Account mapped" or "Map N accounts", the owner. The
  account is shown once: as the card's subtitle when nothing maps it, and as
  the Account row (`StatementAccountMapping`, a native select laid over a
  Detail row, then "Create account") when the person can map it. A statement
  keeps its card-by-card review and has no file card. On a phone the preview
  rows are flat 56 px rows (description, date and category, the amount in its
  money tone) that open the Edit row sheet: a lead with the description and
  amount typed in place, chips (type, date, owner, what needs a look), Detail
  rows for Type, Category, Account, Owner and Note, and Exclude row (or
  Include row) and Done in the bottom bar. It edits through the same
  handlers as the table, which every wider screen keeps. The commit bar is one
  line on a phone. There is no split nudge: nothing in the app suggests splits
  before a commit, so none is drawn.

### Dialogs and small sheets (`sheet-dialog.jsx`)

Every other dialog, confirmation and small sheet shares one frame,
`SheetDialog` (`src/client/sheet-dialog.jsx`, route CSS `sheet-dialog.css`,
which ships with the code that opens a dialog and never with the first-screen
stylesheet). The caller gives it the copy, a lead, the rows or fields and the
actions; it gives them the layout:

- Phone (and a portrait tablet when a caller passes `asSheet`): the shared
  `EntryMobileSheet` (grab handle, swipe down, "Discard changes?" when
  `isDirty`, lifted above the keyboard) with the title and a round 44 px close
  on top, the lead and rows in the body and a `BottomActions` bar
  (`is-sheet-bar`) at the bottom: Cancel (or a destructive action) at the
  start, the primary action at the end under the thumb. A dialog opened from a
  clickable row keeps React's submit, click and key events inside itself
  (`isolateEvents`), and a sheet nested in a modal Radix dialog opts back in to
  pointer events.
- Wide screen: a centred Radix dialog (520 px, `wide` 720 px) with the same
  head, lead, rows and bar (`is-dialog-bar`, Cancel at the start, primary at
  the end). The first field takes focus, so the close button shows no ring.
- Lead: what the dialog is about (`LeadCard`): the item being deleted, the
  account being edited, the planned item being matched, the month a note
  belongs to. A confirmation uses `ConfirmLead`, a rose bubble with the
  consequence as one line under it (`neutral` for a calm ask such as Archive
  account). Support chips mirror values you can read at a glance (type,
  currency, owner, month, "N linked"). Detail rows (`DetailRow`, `PickerRow`,
  `DateRow`) hold the fields; a one-field dialog (a note, a typed
  confirmation) has the field under the lead.
- Destructive: `tone="danger"` makes the primary button pastel rose with the
  rose ink (`lsd-primary is-danger`, never a saturated red) and Cancel the
  quiet button beside it; a typed confirmation (Reset month, Delete month,
  Empty state) keeps the primary disabled until the words match. Reload app
  data is the same ask in neutral. `DeleteRowButton`
  (`delete-row-button.jsx`) is a popover on a wide screen and this sheet on a
  phone.
- A dialog that must be answered (`dismissible={false}`: Set up this login)
  has no close button and no Cancel, ignores Escape, a tap outside and a
  swipe, and is saved with its one button.
- Converted: Edit category (the lead bubble shows the live icon and colour;
  Slug, Icon and Colour are rows), Transfer details (Done in the bar, Convert
  entry or Break connection apart at the start), Delete entry and Delete
  split, Delete split row, Reset and Delete month, Clear unresolved transfers,
  the row, month and Summary notes (`note-sheet-dialog.jsx`, one
  `MonthNoteDialog` that Summary loads on demand), Match planned item
  (`month-plan-link-dialog.jsx`), the Settings account, person, category and
  match rule editors, Statement checkpoint (fits a phone), Set up this login,
  Reload app data and Empty state, Restore preview row, Set diagnostic post
  date, "Update connected note?" (Cancel, Save only this and Update both), the
  Month Actions list (a sheet of Detail rows on a phone; the popover stays on
  a wide screen), "I've topped up" and the import progress sheet (Close in
  its bar). The Month plan-row sheet already served Add income source, Add
  budget bucket and Add planned item on a phone; wide screens keep the inline
  add rows.
- The phone picker sheet (`picker-sheet.jsx`, lazy-loaded by
  `ResponsiveSelect` and the Entries multi-select because both are
  first-screen code) is a bottom sheet with the handle, a 44 px close, the
  options as a scrolling list under the title and Close in its bar (Clear and
  Done for several choices).
- Tests: `tests/e2e/dialogs-lead-support-detail.spec.js` (primary, Cancel,
  destructive confirm, tap targets, hidden money; WebKit and Chromium).

## Openable Figures

Owner principle (2026-10-14, AGENTS.md "Frontend guidance"): on a card,
every figure or statement that has money behind it is quietly openable, so
the person can dig in. It is not a button and does not shout "click me":
the text stays as it is; on hover or keyboard focus (and while its menu is
open) it gains a soft underline and a small chevron after it; on a phone a
tap opens it. The menu is small and in the page, under the figure, with
only the places that apply:

- View entries: Entries narrowed to exactly the money behind the figure,
  over the figure's whole period (a Summary range lists every month of it)
  and in the page's view and scope, so the total Entries leads with is the
  figure, to the cent (`tests/openable-figures.test.mjs` proves it for
  every figure kind, view and scope on the real Worker). The rule is the
  figure's own (`src/domain/money-figures.ts`, DOMAIN.md "Money figure",
  the URL's `entry_figure`): Invested is the Investments category plus the
  transfers into investment accounts less the transfers out, through the
  same `splitMoneyUse` the card used.
- Open plan: the Month page's plan for the period's last month ("Open May
  2026 plan" on a range), at its income part for income figures
  (`#month-plan-income`) or at the plan (`#month-plan`); `use-hash-target.js`
  scrolls there once the page has drawn it. Only figures with a plan line
  offer it (Plan mode, plan figures, money jobs, Month plan rows).
- Open Splits: the group, at its list (`#splits-activity`), for a split
  balance.
- Ask about this: Ask with the question asked and answered at once, as
  before (the Ask page on a phone, the Ask panel beside the page on a
  wider screen). The question never holds an amount; with money hidden the
  spending questions a figure picks by which side of its plan or of income
  it fell become the neutral one ("How did my spending compare with the
  plan in …?"). A category asks "How much did I spend on Groceries in …?",
  a balance "Who owes whom?".

How it is built. A figure carries `data-fig` (what it is: a money figure,
`category`, `plan` or `splits`), and where needed `data-fig-arg` (the
category or the group), `data-fig-ids` (a Month plan row's entries),
`data-fig-plan` (its part of the plan), `data-fig-ask` (its question when
not its own) and `data-fig-note` (a line that explains it, first in the
menu: To allocate's old popover). The period is `data-fig-period`
("YYYY-MM:YYYY-MM") on the figure or a parent (the lead group, a month's
card or row); without one it is the page's month. A text figure is
`role="button"` with `tabIndex=0`; parts and rows that are buttons already
stay buttons. One listener in the shell (App.jsx, captured on `document`,
so the row or card around a figure does not act too) takes a tap, a click,
Enter or Space on a `[data-fig]`, loads `figure-menu.js` with a dynamic
import on first use and toggles the menu. The menu is a few DOM nodes the
module draws itself (no React, so its chunk adds no first-screen file),
titled with what it is, first and in bold: a category's colour dot and name
(a Spending Mix slice or row, a plan row's category, a Top spending chip),
otherwise the figure's name and period ("Invested · Jun 2025 – May 2026";
`title` in `figureMenu`, `data-fig-name` for a split balance's group). A long
name wraps to two lines. Hidden money keeps the title (no amount is in it).
While a category's menu is open its list row (`data-fig-row`) is marked
(`is-figure-open`) and scrolled into view, never so far that the slice leaves
the screen. The menu is placed under the figure inside the 16 px gutters (above it when there is no
room), each choice a 44 px pill; its first choice takes the focus, Escape
closes it and gives the figure its focus back, a press outside, Back or a
resize closes it, and the figure has `aria-expanded` while it is open. A
choice sends `monies:money-action` (`{ entries: location }` or
`{ askText }`) and the shell navigates. What the menu offers is pure data
(`figure-menu-model.js`, `figureMenu`), tested without a page; the words
are `copy/figure-copy.js`. The first screen carries only the attributes and
the listener (`check:bundle`; Intent vs Outcome moved to a lazy chunk to
make room).

Where: the Summary and Month lead in Plan and Simple (Spent and its plan,
the plan line, Earned and Spent in Simple, every savings bar part, legend
line and the sentence, the money jobs, the Income and Saved pills or
columns, To allocate), Simple's Daily spend and Top spending, Intent vs
Outcome, Earned vs spent by month, Spending Mix (each slice and each row's `›`), the Month
plan rows' actuals, the Entries lead and pills, the Splits lead's balance
and the open group's strip tile (another tile still opens its group).
Hidden money: the same menu, no amount in any label. A text figure is the
text itself, like a link in a sentence: it is not held to the 44 px rule,
its row or card is.

One figure cannot be shown as it is: a Month budget line whose refunds are
more than its spending reads $0 actual (it never goes below zero), while
its entries add up to the refund below zero. Daily spend is an average, so
View entries shows the spending it divides.

## Apple Shortcut Install Boundary

The Settings slice owns the Apple Pay shortcut install workflow. The display
component renders progress and advanced controls, while the Settings panel
creates the private key, builds and copies the authenticated connection URL,
persists the settings, and refreshes the settings query.

The Settings DTO may supply an absolute endpoint for the dedicated production
shortcut gateway. The client resolves relative local/test endpoints and that
absolute production endpoint through the same URL constructor; it does not
hard-code a second routing rule.

The repository-owned Apple-signed file is a reviewed product artifact, not a
source of household configuration. It must contain neither the API key nor a
private connection URL. Apple's setup question injects that private URL only
after the user opens the file. The question targets a plain Text action whose output is
the POST destination; it must not target a URL action because Apple's URL-list
editor can discard a pasted connection URL during setup. The direct-create
route remains responsible for token validation, typed normalization, account
selection, currency enforcement, idempotency, and entry creation.

The artifact input is the device-local Transaction automation's Dictionary with
`value`, `merchant`, and `name` keys. The automation calls the shared shortcut
directly; a legacy helper shortcut is not part of the supported chain. After a
successful POST, the shortcut reads `openUrl` and `accountName` from the
response, opens the saved entry (the Ask page's saved card, with a category
question when it landed in Other and Splits; the Entries link older
Shortcuts were given still opens the entry in Entries), and confirms the
merchant, amount, and account in a notification. It sends a per-run request ID so the server can return the
existing row after an HTTP retry.
The production gateway exposes only that direct-create path, shares D1 with the
protected app, and builds response deep links against the protected app origin.

The reviewed source, exact signed release, and release manifest live under
`shortcuts/apple-pay-api/`; a byte-identical signed download lives under
`public/shortcuts/`. The manifest install path must match the Settings constant
and browser contract. Automated tests verify the checksums, action count, setup
question, POST and response behavior markers, and absence of authentication
material. A personal Shortcuts copy can be used for editing, but it is not the
only source and must never be treated as the release authority.

The install action opens its target window synchronously before asynchronous
save work so browser popup protection does not turn a successful setup into a
dead button. Failure closes the placeholder window and leaves an inline error.

## Import Preview Matcher Boundary

The canonical import-preview matcher lives in
[`src/domain/app-repository-import-preview.ts`](/Users/tim/22m/ai-projects/monies_map/src/domain/app-repository-import-preview.ts).

Rules:

- run exact duplicate suppression before any certification-status or
  source-isolation guard
- exact duplicate suppression should auto-skip rows that share the same amount,
  mapped account, and either the same normalized import hash or a perfect
  normalized description match on the same day
- apply certification-status eligibility checks only inside the promotion and
  reconciliation lane, before date-distance or description-similarity scoring
- treat `statement_certified` ledger entries as locked and never eligible for a
  new incoming bank-row reconciliation match
- allow mid-cycle sources such as CSV/XLS to reconcile only against manual
  provisional ledger rows
- allow official PDF statements to reconcile against both manual provisional and
  import provisional rows so month-end statement imports can promote existing
  working rows instead of duplicating them
- keep exact duplicate suppression separate from status-guarded reconciliation
  so overlapping files auto-skip cleanly while recurring-charge heuristics stay
  isolated to the promotion lane

Why:

- To prevent cross-bank false positives on high-velocity recurring charges,
  mid-cycle imports only match pending manual entries. However, official PDF
  statement imports can match against mid-cycle provisional entries to elevate
  them to certified status.
- Repeated overlapping bank exports should still auto-skip truly identical
  rows, even when those rows would be excluded from reconciliation by the
  promotion-lane source guards.

## Statement Mismatch Diagnosis Boundary

The statement check's explanation and fixes come from one pure module,
[`src/domain/statement-mismatch-diagnosis.ts`](/Users/tim/22m/ai-projects/monies_map/src/domain/statement-mismatch-diagnosis.ts),
called once at the end of `buildImportPreview`.

Rules:

- matching rules (date lanes, the velocity rule, merchant similarity) live in
  `src/domain/statement-row-matching.ts`, shared with the preview matcher, so
  a fix the diagnosis proposes is certified by the preview's own matching
  once applied
- approved fixes are applied to the ledger rows the preview reads (never
  written by the preview); `getStatementFixRejection` checks each fix in the
  preview and again in the commit on fresh rows
- the commit writes fixes through `src/domain/import-statement-fixes.ts`
  (statement builders inside the import commit's batch, not a command of
  their own), and rollback undoes them from `import_statement_fixes`
- the client renders the diagnosis in `src/client/statement-fix-suggestions.jsx`
  inside each card of the statement check, keeps approved fixes in
  `ImportsPanel` state, and sends them with every preview and the commit;
  the server's `appliedFixes` replace the client list after each preview
- no AI: the diagnosis and its fixes work identically with the AI binding
  missing
- after commit, `src/domain/statement-compare-projection.ts` runs the same
  diagnosis in `committed` mode for Settings → Compare statement (read
  only); its corrections are written by
  `src/domain/app-repository-statement-corrections.ts`. The client shows
  them in `src/client/statement-correction-suggestions.jsx`, which reuses
  the import review's `FixGroup`, writes on approval (never automatically)
  and keeps the last correction's ids in `SettingsPanel` for its Undo

## Import Page Stages

The Imports page is three steps (`src/client/import-stages.jsx`): Bring
files, Review, Done.

Rules:

- `ImportsPanel` owns the stage: Review while a preview exists, Done after a
  commit until the next file or Close, otherwise Bring files
- Bring files is ordered drop zone, intake queue, import inbox. Any file in
  review folds Bring files to one line; a plain CSV keeps its column mapping
  (`isMappingNeeded`: rows to map and the generic CSV parser) beside the
  preview
- the inbox folds to "Still missing: N of M" and each bank to one row
  (`import-inbox-model.js`: `buildInboxChecklistProgress` ticks off lines
  from the intake model's matches, `isInboxOpenByDefault`, `nextFoldState`
  behind `useFollowingFold`); inside a bank, `groupInboxFilesByOwner`
  puts each owner's accounts under their name and `groupInboxFilesByAccount`
  makes one box per account (or shared statement) listing its missing
  months
- pasted rows and the import defaults sit behind "Paste rows or set
  defaults" (the defaults are Detail rows), opened when a plain CSV needs
  mapping; upload status and the AI consent stay beside the drop zone, and
  the explanations (what each file kind does, the trust and rollback notes)
  are one folded "How importing works" row
- Recent imports is one row that opens; the batches are flat rows in one group
  under their day. "Rollback import" and "Roll back this import" ask in
  `ImportRollbackConfirm`: a bottom sheet on a phone, a dialog on a wide
  screen, Cancel and the confirming action in the bottom bar. A refused
  rollback keeps it open and says why (it keeps the `delete-popover` class
  for that reason)
- with a file queued, or Bring files opened again over a file in review
  (`isDropZoneSlim`), `ImportSelectFileStage` renders `isSlim`: the card
  head goes, the drop zone is one line ("Drop more files, or" and Select
  file, still a drop target), the upload status sits beside it on one line
  and the AI consent under it; the OCR/XLS note, trust hint and rollback
  note move into the "Paste rows or set defaults" disclosure
- a file dropped on its own (`processImportFile`) clears
  `activeIntakeItemId`, so the queued file that was in review waits again
  and Skip for now queues the dropped file; the source label of a plain CSV
  (opened from the queue or dropped on its own, `loadParsedImport`) is its
  file name unless `isSourceLabelChosenRef` says the user typed one (or
  took one from the inbox)
- the preview card (`data-import-target="preview-rows"`) renders only with
  a preview or its warnings
- a file dropped anywhere on the page goes to the drop zone's handler
  (`usePageFileDrop`, `import-page-drop.js`), except on the file in review
  (`data-page-drop="off"`), dialogs and popovers
- Recent imports starts closed; its status line shows either way. After a
  commit it reads "File imported: <file>" (the file as picked, else the
  source label) and lists, quieter, the five completed imports before it
  (`buildEarlierImportLines` in `import-history-model.js`: accounts, the
  dates their rows cover, label)
- the full Done card (`ImportDoneCard`) is a sky notice: title with Import
  another file (Close and Review next while a file waits) at the top right,
  then `buildImportDoneSummary`'s
  `confirmation` sentence (file, accounts, statement period or row dates;
  "No further action needed" only when every card balanced), the cards,
  and Roll back at the bottom left with the status pill at the bottom right
- the Bring files styles load with the route (`import-bring-files.css`)
- an official statement is reviewed by `StatementReview` in
  `import-preview-review.jsx`: one header, one section per card with its
  outcome (`getStatementCardStatus`), fixes, read-only rows and the
  breakdown behind a disclosure. The full row editor
  (`ImportPreviewRowsTable`), statement details, card mapping and the other
  checks open on request; a mapping that was needed stays open for that
  review
- `ImportCommitBar` (`import-commit-bar.jsx`) is the only commit control and
  carries the commit summary (`.import-preview-status-row`) and the commit
  question
- the commit rules live in one pure module, `buildImportBlockers`
  (`import-blockers-model.js`). It reads the preview model's facts
  (`import-preview-model.js` no longer decides) and returns
  `{ blockers, remainingCount, isCommitDisabled, commitQuestion, matched }`.
  A blocker is `{ id, kind, effect, label, target, order }`: `effect` is
  `disable` (commit off), `ask` (commit asks first) or `preview` (a CSV
  column still to map); `order` is the fixing order (columns, accounts,
  card accounts, categories, statement check, cards, rows to check, nothing
  to import). The chips, the commit bar's "things left", the disabled
  button and the popover all read it, so they cannot disagree; a matrix test
  pins it to the rules it replaced
- done looks the same everywhere: a finished step (`is-done`) and a done
  file chip use `--pastel-mint`, `--pastel-mint-ink` and a lucide `Check`;
  the current step keeps the terracotta outline. The file chips row leads
  with "Your files:" (styled like "Before you can commit:"); the reviewing
  chip has `FileText`, the outline and bold text and "· reviewing", a
  waiting chip `Clock`, a neutral outline, muted ink and "· waiting"; the
  full file name is the title. The phone sheet uses the same chips
- the Bring files status box comes from `describeUploadStatus`
  (`import-upload-status.js`): a multi-file drop sets the `waiting` tone
  (butter, "Waiting for review"), rendered as a button that jumps to the
  `intake-queue` target (`import-jump.js`: the queue, focus on the first
  enabled Review); it hides once nothing waits. `active`, `success` and
  `error` keep their tones
- `ImportBatchBar` (`import-batch-bar.jsx`) wraps `ImportStepper` in a
  `nav` with this batch's file chips (`buildImportBatchFiles`,
  `import-batch-model.js`: done this session, the file in review, then
  the queue in review order) and the blocker chips. It sticks to the top at
  768 px and wider while a batch is in progress (a file queued, in review
  or just committed), below the sticky environment banner; on a phone it
  scrolls with the page and the commit bar is the only sticky bar
- `useImportStickyBar` (`import-batch-bar.jsx`) says when the bar is stuck:
  an IntersectionObserver on `.import-batch-bar-sentinel`, the 1 px element
  just above the bar, with the root's top moved down by the banner (no
  scroll listener). Stuck (`is-stuck`), the `nav` keeps the height its
  surface had in the page (inline `height`, transparent and click-through
  below the surface), so folding the step descriptions moves nothing below
  and cannot unstick it. `.import-batch-bar-surface` carries the look: a
  solid background (`--panel` over `--bg`) on `::before` and a
  `var(--shadow)` on `::after`, both stretched to the window's edges by
  `--import-bar-bleed-left/right` (measured, so the page never scrolls
  sideways); clip-path keeps the background to the panel width until it
  sticks, then spreads it, while the shadow fades in and the step summaries
  collapse (`grid-template-rows` 1fr to 0fr, padding), 200 ms, none under
  `prefers-reduced-motion`. The step's Change moves to its first line while
  stuck (`is-stuck-only`; one Change is shown at a time), and a Bring files
  line carrying an error (`isBringAlert`, `is-alert`) does not fold. The hook keeps
  `--import-sticky-offset` on the panel at the stuck height (measured by
  laying the surface out stuck for a moment with transitions off), so jump
  targets carry `scroll-margin-top` below the stuck bar
- a blocker's `target` is resolved by `jumpToImportTarget`
  (`import-jump.js`) against `data-import-target` markers on the
  sections that fix it (account mapping, a statement card, the Refresh
  check button, statement details, unknown categories, the column mapping
  grid, the preview); a row to check is the first
  `tr[data-commit-status="needs_review"]`, and a statement opens its row
  editor first. The jump scrolls (smooth unless reduced motion is set) and
  focuses the control
- a waiting file chip opens its file like the queue's Review button; when
  the file in review has changes that would be dropped (row edits,
  mappings, statement fixes the user approved or undid; not fixes "Fix it
  for me" applied) it asks first in a popover, never a browser dialog
- the intake queue keeps the rest of a drop after a commit, orders it with
  `orderIntakeQueue` and counts covered rows with `describeIntakeCoverage`
  (`import-intake-model.js`); the Done card (`buildImportDoneSummary`,
  `import-done-model.js`) offers the next queued file
- moving through a batch lives in `import-batch-model.js`:
  `findNextIntakeItem` (the next file waiting, never the one in review or a
  copy), `skipIntakeItem` (gives the item a `skipOrder`, which
  `orderIntakeQueue` ranks after every file not skipped) and
  `describeCommitLabel` ("Commit and open next" while a file waits, or
  "Save statement balance and open next" for a statement whose rows are all
  covered and that no import saved yet (`saved_again`, every card naming
  an earlier import, keeps "Save it again anyway" and asks first), or
  "Certify and open next" for one whose rows all match
  uncertified ledger entries, by the preview model's `commitKind`; an
  empty statement checkpoint keeps its own words). `commitKind` is
  `empty_checkpoint` only for a statement with no rows; when every row
  is already in the ledger and the cards balance, the preview model's
  `ledgerMatchedStatement` ({ matchedCount, toCertifyCount }) gives the
  commit bar its one-sentence summary. The
  panel opens the next file from the render after the commit's reset
  (`pendingNextItemId`), so it starts from a clean form, and keeps
  `lastCommitSummary` while a file of the batch is open: `ImportDoneCard`
  then renders `compact` (title, status, rows in total, rollback) above the
  review, and in full only when nothing is open. Opening a queued file
  (`handleLoadIntakeItem`) keeps the summary; a single dropped file clears it
- the commit is saved before the refresh: a failed commit returns early with
  the review intact; the refresh after it goes through the shell's
  `runBackgroundRefresh` (prop from `App.jsx`)
- `import-blocker-keys.js` holds the J/K rules (`readBlockerKey`,
  `pickAdjacentBlocker`) and a document `keydown` listener
  (`useImportBlockerKeys`). The cursor is the `order` of the blocker last
  jumped to (chips and "Jump to next" set it too), so the walk carries on
  after that blocker is fixed. A field the jump itself focused (an account
  select) is not treated as typing, so the next press moves on; the key's
  default is prevented so the select keeps its value
- `ImportAskFirst` (`import-batch-bar.jsx`) is the one ask-first popover for
  the waiting chips, the intake queue's Review buttons and "Skip for now";
  `inline` renders it inside the phone sheet, which traps focus
- a card with no account yet (`unknown_account`, or a name still to map)
  gets no card chip while the "Map {n} accounts" chip names it; the commit
  question still lists it
- `ImportProgressSheet` (`import-batch-bar.jsx`) is the phone's import bar,
  built on `EntryMobileSheet`. The panel closes it before a chip's action
  and runs the action in a timeout after Radix FocusScope hands focus back
  to the trigger, so a jump keeps its focus
- "Fix it for me" is a per-viewer preference
  (`statement-fix-preference.js`, browser storage); proven fixes are applied
  once per review, so an Undo is not re-applied
- the review styles load with the route (`import-review.css`,
  `statement-fix-suggestions.css`), not the first-screen stylesheet

## Import Inbox And Intake Boundary

Import Inbox planning belongs to the Imports slice. It is route-level product
state, not app-shell chrome: Summary and Month may show a compact stale banner,
but the checklist, bank-session grouping, and review order live on Imports.

The compact stale banner is optional warmup work. It reuses the Imports cache
when fresh and only starts after Summary or Month is usable; it never delays or
re-fetches the active route merely to update banner wording.

Rules:

- group download work by bank session so a user logs into one institution and
  collects every needed file there
- keep accounting review order separate from download order, with statements
  reviewed oldest period first
- do not require filename conventions for the guided workflow; classify queued
  files from parsed account, period, source, row, and checkpoint evidence
- keep multi-file intake browser-only. Queue items may retain parsed rows,
  checkpoints, and generic CSV text in transient page state, but they must not
  retain `File` objects or persist original PDFs, CSVs, XLS files, OCR images,
  or raw bank files
- keep HSBC image PDFs on the same private browser OCR path as single-file
  import, then load the parsed statement into the normal preview/review flow.
  `imports.parseImageStatement` owns the OCR pass decision (a second pass only
  when the first is doubtful); the panel passes it `parseStatementText` and
  keeps only the AI-fallback and status wiring. The cell reader (`import-ocr-cells.js`)
  loads by dynamic import only when a statement asks for cell reads, so OCR
  code beyond the existing page reader stays off the first screen
- keep split cleanup separate from required bank-file collection

## Ask Turn Boundary

Ask is AI first (owner decision 2026-10-13; docs/flows/ask-flow.md "AI
first"): AI understands, the app validates, rules are the offline backup.

- Client: `ask-turn-api.js` (pure builders `buildTurnHistory`,
  `buildTurnFocus`, the reply reader `readAskTurnResponse`, and the two new
  saves, both existing commands: `saveSplitProposal` →
  `/api/splits/expenses/from-entry`, `saveSettlementDraft` →
  `/api/splits/settlements/create`). `ask-panel.jsx` `readSentence` sends
  every message first and shows the reply with the cards it already has
  (`applyTurnReply`); `readSentenceByRules` is the unchanged rule path.
  `ask-turn-cards.jsx` holds the two new draft cards (Add to Splits,
  settle-up payment), built from `LeadCard`, `DetailRows` and
  `BottomActions` like the plan draft card. All of it ships in the Ask
  chunk.
- Server: `ask-turn-route.ts` (body through `readJsonObject`, AI off
  answers before any data work), `ask-turn-context.ts` (read-only context,
  the focus entry loaded by id from the household's rows),
  `ask-turn.ts` (pure: schema, prompt, validator). A plan change is drafted
  by the plan-draft route's own `draftPlanRequest`; a money question is a
  sentence the answer route's reader reads.
- The model never writes and never supplies a figure the page shows: an
  amount must be one the person wrote, shares come from the entry's own
  amount, answers from the answer route's facts.

## Size Limits

The Worker caps what a person can type or send (`src/server/limited-body.ts`,
`docs/audits/ai-security-review.md` F4 and F5). The caps live in
`src/domain/request-limits.ts` and `src/domain/shortcut-entry-contract.ts`,
which the routes and the page both read (`src/client/input-limits.js`), so
a warning and a refusal always agree. From 80% of a cap the field shows a
quiet line (`limit-hint.jsx`: muted, small, tabular), and past the cap it
says so in plain words in the error ink and the request is not sent:

- Entry description (500) and note (2,000 characters), on the Ask card and
  the Entries composer: "1,640 / 2,000" under the field; past it, "This note
  is too long to save. Keep it to 2,000 characters or fewer.", and
  `createEntryFromDraft` refuses before posting `/api/entries/create`.
- The Ask message (300 characters after spaces collapse, the turn, answer
  and plan routes' cap): "Message is getting long · 259 / 300" above the
  message box; past it, "This message is too long to send…", Send is off
  and Enter keeps the text.
- A receipt photo (1.5 MB as sent): every photo is made smaller on the
  device; a chosen photo from 80% of the cap gets "This photo is large, so
  it's made smaller before it's read."; one still past the cap once made
  smaller is not sent, says so, and is read on the device instead.
- Import help: the mismatch explanation (4 MB of preview) says "This import
  is too big to explain (max 4 MB)…" instead of sending. The statement-text
  fallback (64 KB) is cut to fit before sending, with no message: its reader
  looks at the first 12,000 characters either way. The duplicate ranking
  (256 KB) sends at most 12 pairs, far under its cap.
- A voice clip stops itself at 30 seconds (`VOICE_MAX_RECORD_MS`), under
  the transcribe route's 1 MB cap. Import files and the other write routes
  have no cap yet (F7), so nothing is shown for them.

## Optional AI Assistance Boundary

The optional Workers AI surface is a small client-to-Worker boundary. It is
never loaded as part of route bootstrap, import preview, import commit,
reconciliation refresh, or freshness calculation. The client exposes explicit
actions for narrative drafting, category-rule proposals, candidate ranking,
and a per-file statement-text fallback. The Worker validates every response
against existing DTO data and returns an unavailable result when the binding,
quota, or model is unavailable. Summary, Month, Entries, and Splits render
their Money insights from computed wording only, with no AI request (the
optional rewording route was removed after it produced broken grammar). Each
page's insight speaks only of what that page counts (full cash flow on
Summary and Month, the month's whole list on Entries, settlement obligations
on Splits). When deterministic evidence warrants
it, a signal carries one action that opens an existing surface (the filtered
Entries list, Imports for a statement gap, the split-match or settle-up
view); model output never supplies the target. No AI result bypasses the
existing editor, preview, or review controls. The Money consequence map that
used to sit under "See all insights" is retired (DOMAIN.md): plan variance,
the same-season comparison and bank-proof gaps are check-in signals only.

Receipt reading runs on the Worker (`POST /api/ai-assist/receipt-read`,
DOMAIN.md "Receipt Read") and its one client surface is the Ask page. The
Ask page's two readers (`ask-api.js`) are explicit actions: a typed
sentence goes to the entry-draft route only when the person sends it, and a
receipt photo to the receipt-read route only when they pick, paste or drop
one. Any surface that sends a receipt must: send one image only after the
user supplies it; downscale it (at most 1.5 MiB, JPEG, PNG or WebP) and
strip EXIF and location in the browser first (re-encoding through a canvas
does both, `ask-receipt-image.js`); keep the image in transient page state
only, dropped when the page goes; on `available: false` (or any failure)
read the same image on the device with the app's Tesseract worker into the
same `ReceiptReadDto` (the domain's `readReceiptOcrText`, which Ask calls
through `readReceiptTextOnDevice` in `ask-receipt-image.js` with the
household currency, SGD, as the default so a receipt that prints no
currency raises no currency question); and fill the entry card
or editor from it (`applyReceiptRead` on Ask, `receiptReadToDraftFields`
for the `/api/entries/create` field names), saving nothing until the user
taps Save, through the normal create route. The
composer's mic uses the browser's own speech recognition; only a
browser without one records a clip (at most 30 s), and only on a hold or
tap, for the transcribe route (Workers AI Whisper, 1 allowance unit). The
words fill the message box and are never sent without the person's tap.
Either reader failing leaves
the card manual with a calm note. Opening Ask asks no AI: its "since you
last looked" card is the computed check-in.

A check-in's signals count what the figures beside it count. Summary builds
them from its page DTO, which the Worker already filtered to the view and
scope. The Month DTO's `entries` holds every household entry (plan linking
needs them all), so `selectMonthInsightEntries` (`month-insight-facts.js`)
first keeps the entries the `Actual spend` card counts with the Worker's own
`filterEntriesForView` and `effectiveScopeForView`
(`src/domain/person-view-scope.ts`, over `person-entry-amount.ts`): every
entry for the household, and a person's own entries in the scope at their
own amounts. A scope change therefore changes what the signals count.
Month's statement-gap Quick fix reads
the same wallet health as Summary's: the view's account pills
(`/api/summary-account-pills`), which the Month route load fetches beside
the month page (`fetchRoutePageData` in `App.jsx`) and hands to the panel
as `view.accountPills`. The reference account list has no checkpoint
status, so the check-in never reads it; until the pills load, nothing may
be called sorted (`ready`). The Month Accounts section shows the pills'
balances and health too
(`withMonthAccountHealth`). The Splits check-in follows the view too: its
signals read the active group's open activity from the person's side and in
the group currency (a JPY trip reads JP¥), and the check-in addresses the
person ("Tim's money insights", "Joyce owes you JP¥9,000"). Each page passes
the person's name to `FinancialInsight` as `audienceName` for that label
(empty for the household, which reads "Household money insights"). The
Splits route pins a person view whenever the household has people, so in
practice the Splits check-in is always a person's.

## Scope Controls

A person view's figures follow the route's `scope`. Each layout has one
scope control:

- Desktop and tablet (wider than the phone layout in `use-viewport.js`):
  Month shows the scope pills in its header, and Entries its scope switch; both
  are a grey track with a raised white selection ("Desktop Chrome"). Summary shows
  `SummaryScopeSwitch`: a compact one-click `Direct` / `Shared` / `Both`
  switch (`messages.summary.scopeSwitchLabel`) in the empty space under the
  `Summary` title, with `aria-pressed` on the active option and what each
  scope counts (`messages.views.scopeHint`) as that option's `title`
  tooltip; there is no visible explanation row. It must not change the
  header: `.summary-scope-switch` takes its own row in the title column with
  `contain: inline-size` (no content width) and a -12px margin that cancels
  the title row's 12px flex gap, so the title column is exactly as wide as
  without it, and the row fits beside the Summary lead, so the
  header is exactly as tall. Where the header stacks (960 px and below) the
  switch joins the title row instead, again adding no height.
  `tests/e2e/summary-workflow.spec.js` measures the header, the cards and the
  check-in with and without the switch at 1,440 and 1,920 px.
- Phone (`useIsMobileLayout()`): Summary, Month and Entries show the floating
  View and scope bar from `App.jsx` (`stickyScopeConfig`), and Summary does
  not render its switch at all. The bar's sheet holds the view and the scope
  as segmented chips and its lead carries the line saying what the scope
  counts, on every tab. Entries adds month arrows beside the bar; the
  Summary tab (Summary or Month) adds its month control instead ("Summary
  Tab Month Choice" below), because its range moves from the header.

The bar is the phone's Support bar ("Phone Chrome" below): the person's chip
in their colour (`ContextPersonChip`, `getPersonColourVars`), the short scope
name (`messages.views.scopeShortLabel`: `Direct`, `Shared`,
`Direct + Shared`) as quiet text and a caret, then the month control as a chip,
all on one row. The trigger's accessible name stays `Tim · Direct + Shared
View and scope` (`View` for the household, which has one Combined scope:
the chip reads `Household`, there is no scope text and the sheet has no scope
group). On Month and Summary the floating money toggle sits above the bar.

The active scope on Summary is the scope of the request the figures on
screen answer: `buildSummaryPageView` reads it from the Summary owner's
request key and sets `selectedScope` and `scopes` on the page view (the same
names as the Month DTO), so neither the switch nor the bar run ahead of the
figures while the next scope loads. An option sets the route's `scope`, and
the route reloads Summary; no extra request and no DTO field. The scope rules are
imported by `summary-query.js` in the entry chunk, so the Summary and Month
route chunks share them without a new first-screen file.

## Summary Tab Month Choice

Summary and Month are one tab, `Summary`. Its month choice is "All months"
(the Summary page for the header's range, `/summary`) or one month of that
range (the Month page, `/month?month=YYYY-MM`). The URL stays the source of
truth: `getSelectedTabId` still returns `summary` or `month`, the route
registry in `App.jsx` gives the Summary tab `routeIds: ["summary", "month"]`
so it is active on both (`isRouteTabActive` in `app-shell-navigation.jsx`
sets `is-active` and `aria-current`), and old `/month` links, the Shortcut
and guide links open the tab with that month picked. Tapping the Summary tab
opens All months, from a picked month too. The header period control keeps
picking the range on both routes; the months offered are the range's months
(`rangeMonths` of the Summary page DTO).

- Rules: `summary-month-choice.js` (pure). A month choice pins the range on
  screen into the URL (`summary_start`, `summary_end`), because a Summary
  request without both bounds anchors its range on `month`; with both,
  `buildSummaryPageParams` names the range end as the month, so every month
  of a range shares one Summary cache entry, and `seedPinnedSummaryPage`
  stores the page already loaded under the pinned key instead of fetching it
  again. A header range change keeps a picked month inside the new range
  (`clampMonthToRange`). With a month picked, App loads the range's Summary
  page beside the Month page through the Summary owner
  (`loadSummaryRangeContext`): from All months it is a cache hit; a `/month`
  deep link fetches it. It never blocks the Month page or shows its error
  screen; until it lands the header shows the URL's range and the month
  controls wait.
- Phone chip (`SummaryMonthIslandControl` in `summary-month-picker.jsx`,
  entry chunk): in the Support bar beside the View and scope trigger,
  `All months ▾` (`Month` is heard, not shown); with a month picked
  `‹ Sep 2026 ›`, where the arrows are 44 px buttons that step through the
  range's months (disabled at its ends) and the middle opens the sheet. The
  quiet chip (`.mobile-month-chip`) sits inside a 44 px button and never
  wraps.
- "Pick a month" sheet (`summary-month-sheet.jsx` and its CSS, a lazy chunk
  loaded on first open): a modal Radix dialog with the View and scope
  sheet's classes (bottom sheet, focus trapped, Escape and backdrop close,
  focus starts on the sheet itself). Its head shows the range and a `Change
  range` link that closes the sheet and opens the header's start picker. An
  All months card shows the range's actual spend against planned spend with
  a bar; then one tile per range month, grouped by year, newest first, with
  the month, actual spend in whole dollars and a bar against that month's
  plan. Figures are the Summary page months already loaded
  (`realExpensesMinor`, `estimatedExpensesMinor`); no request. The bar track
  is sky (the plan), the fill a neutral grey; over plan the amount and fill
  take the rose money tone (`spendTone`, so spending with no plan is over)
  and the amount adds `· over`. The current choice has the terracotta border
  and, on a tile, a tick. Hidden money shows dots, no tone, no bold and no
  `over`.
- Desktop and tablet (`SummaryMonthSelector`): one compact row under the
  header, `All months` then the range's months newest first, as grey track
  chips with a raised white selected one (`.summary-focus-button`, "Desktop
  Chrome"), with `aria-pressed`. The row wraps rather than clip at the page
  edge. Hidden on a phone.
- Spending Mix has no month chips of its own; the month choice drives it.
  All months shows the whole range (`categoryShareChart`). A picked month
  shows that month in the Month content, full width after the money
  insights and before the plan tables (the read-out before the editing
  work, as on All months it sits beside Intent vs Outcome), from the Month
  page DTO's `categoryShareChart` (no request). One component for both
  (`SpendingMixSection`, `spending-mix-section.jsx`): same card, donut and
  ranked category list ("Summary body" above); no spending shows the Entries
  empty state instead of an empty donut. Its only Month rule (spacing) is in `month-route.css`.
  `summary_focus` is ignored.
- Bundle: the island control, the row and the rules are in the entry chunk
  (about 0.8 kB gzip); the sheet is not. The sheet draws its tick itself and
  takes tone classes from the rules module, so it adds no first-screen file.

## Money Privacy Display Preference

Money privacy is a display layer, not a financial-state change. A new browser
starts with every displayed monetary value masked on Summary, Month, Entries,
and Splits, including individual ledger and split-activity rows. The shared
top-toolbar eye control reveals or hides those figures everywhere at once and
persists only the browser-local preference. Imports use the same display rule:
the raw CSV source field and editable preview amount cells are screened while
hidden, without blocking paste, drag-and-drop, parsing, mapping, or commit. On mobile, the same control floats
above the bottom navigation, and stacks above the Entries or Splits add button
when one is present. Financial Insight stays hidden while totals are masked
because its prose can expose the same figures. Hiding money also hides its
sign, in colour and in words: every money tone (below) turns neutral, and
wording that says which side of zero a hidden figure is on goes too. Month's
Remaining budget drops its "To allocate" / "Overplanned" line (the Month
lead's pill hides it with the amount), the Summary lead and the Month plan sheet drop
"under / over plan", "% of plan", "left", "over" and "to come" and keep only
their bar's empty track, wallet pills and Settings drop the statement health
line ("off by"), the Splits lead card says "Balance with <name>" in place of
"<name> owes you" / "You owe <name>" / "Settled up" (and its figure and the
Group spend chip are dots), and Splits activity drops "you lent" /
"you borrowed" / "you paid" / "you received". `tests/e2e/money-tones.spec.js`
reads the hidden pages for any such word.

## Pastel Palette

Colour in the app is a calm 1970s print: an oat page with a hint of
warmth, near-neutral cards, soft chocolate ink, warm grey hairlines and
soft tints of avocado, brick red, dusty teal, faded plum and harvest gold,
with the terracotta accent and the Splits orange panel kept as they were.
(The first print's cream-tan page read too warm and creamy; 2026-10-13 it
moved to oat and its hues were eased a little.) The palette lives once, in `:root` of
`public/styles.css`; a state or category surface uses a fill token, and text
on it uses the same hue's `-ink` token, which meets WCAG AA on that fill.
Do not add saturated fills or new hex colours outside these tokens: a colour
preset (see "Colour presets") re-colours the app only through them.

The token names stayed when the values moved from the pastel set to the 70s
set, so code and older notes that say mint, rose, sky, lavender or butter
mean these colours:

| Token | Fill | Ink | Ink on the panel | Ink on a soft tint | Ink on the full fill | Ink on the Splits wash |
| --- | --- | --- | --- | --- | --- | --- |
| mint (avocado) | `--pastel-mint` #e5e9d5 | `--pastel-mint-ink` #4a5c22 | 7.16 | 6.42 | 5.96 | 5.50 |
| rose (brick red) | `--pastel-rose` #f3e0d9 | `--pastel-rose-ink` #933629 | 7.28 | 6.42 | 5.88 | 5.44 |
| sky (dusty teal) | `--pastel-sky` #d8e6e3 | `--pastel-sky-ink` #2d5d5e | 7.18 | 6.30 | 5.76 | 5.32 |
| lavender (faded plum) | `--pastel-lavender` #ebdfe6 | `--pastel-lavender-ink` #674562 | 7.83 | 6.84 | 6.23 | 5.76 |
| butter (harvest gold) | `--pastel-butter` #f1e6c6 | `--pastel-butter-ink` #63490f | 8.19 | 7.32 | 6.78 | 6.26 |
| neutral (oat) | `--pastel-neutral` #f7f4ee | `--text` #352b24 | 13.39 | 12.89 | 12.57 | 11.56 |

The surfaces: `--bg` #e5dfd4 (the body behind the header), `--page`
#e9e4da (oat, the page every route sits on), `--card` #fefdfb (the lead
and metric cards, near-neutral and a soft step lighter, with
`--card-border` and `--card-shadow`), `--panel` rgba(254, 253, 250, 0.95)
(a paper card), `--text` #352b24 (soft chocolate), `--muted` #6a5f57 (warm
grey-brown) and `--line` rgba(105, 95, 86, 0.2) (a warm grey hairline).
`tests/colour-presets.test.mjs` keeps it calm: the page and body carry a
hint of warmth (Lab chroma 3 to 7), the card and neutral fill stay
near-neutral, the chip half the old cream, and 70s Warm Dark's surfaces
are an espresso charcoal (chroma 5 or less), not brown-orange. `--accent` #934923 and `--accent-strong` #b15e2f did not change.
Harvest gold's ink is a dark mustard: a mid gold such as #b48639 is only
3.2:1 as text on the cream, so gold is a surface, never text.

What each hue means: avocado is money in or going well; brick red is over
plan, money out in a list and debts; dusty teal is a plan and "worth
knowing"; harvest gold is a To do or a warning; faded plum is "think about".

Contrast is against the cream panel, the soft tint (the fill at 60% over the
panel), the full fill, and the Splits wash (the fill at 94% over the darker
end of the orange panel). `tests/colour-contrast.test.mjs` reads `:root` and
checks every one of these pairs, the text and muted inks on every neutral
surface, the person and split group chips, and that the fills stay soft.
`--positive` and `--negative` alias the mint and
rose inks, and each hue has a hairline (`--pastel-mint-line` and so on, the
ink at 22%) for borders. Status surfaces use them at the same three
strengths as money: text (delete actions, form errors, match confidence),
a soft fill (status pills, chips, Imports inbox and intake states), and the
full fill for banners that need attention (the environment banners: demo
sky, local mint; the tab badge; the danger button; statement results). `--muted` keeps 5.59 on the neutral fill; on any
other tint, text uses that tint's ink instead.

## Colour Presets

The 70s Warm palette above is the default. **Settings → Colours** offers
eight more whole schemes, each with its own accent, Splits panel, money
tones, surfaces, category and person colours, and every scheme comes in a
**Light** and a **Dark** mode. Above the preset chips a Light / Dark / Auto
switch (the View and scope sheet's segmented pattern) picks the mode; Auto,
the default, follows the phone's `prefers-color-scheme`, also when it
changes while the app is open. The meaning of every tone stays in both
modes (mint money in, rose out and over plan, sky a plan, butter a To do,
lavender "think about").

| Preset | Id | Light | Dark | Accent / Splits panel (light; dark) |
| --- | --- | --- | --- | --- |
| 70s Warm | `70s` | oat page, near-neutral cards, soft chocolate ink (the default) | espresso charcoal, warm off-white ink | terracotta #b15e2f / terracotta; lifted terracotta #e8996a / soft terracotta |
| 60s Mod | `60s` | cool off-white page, teal-grey ink; mustard eyebrows, tangerine chips | deep teal | teal #0f7d74 / teal; bright teal #5dd3c5 / soft teal |
| 80s Pop | `80s` | lilac-white page, deep indigo ink; electric violet eyebrows, aqua chips | near-black indigo, neon accents | hot magenta #c2108f / magenta into electric violet; neon magenta #ff7ad8 / neon pink into lilac |
| Modern | `modern` | cool grey-blue page, white cards, crisp fintech | slate blue | indigo #4f46e5 / indigo; soft indigo #a9a5ff / periwinkle |
| Black & White | `mono` | grey page, white cards, black ink | white on black | near-black #1a1a1a / black; near-white #f0f0f0 / light grey |
| Code | `code` | Solarized-style base2 page, base3 cards (Code Light) | the terminal look it always had (Code Dark) | blue #1f6aa5 / Solarized orange; cyan #56d4dd / amber #e3b341 |
| Midnight Calm | `midnight` | dusky moonlight-blue page, navy ink, sage eyebrows, low-contrast cards | deep navy ink, moonlight-blue text, sage eyebrows | slate blue #3a5f8f / slate navy; moonlight blue #a6c4ea / moonlight blue |
| Gen Z 2026 | `genz` | soft pink-grey page, digital lavender, bubblegum eyebrows, acid-lime chips | near-black page, lavender, bubblegum eyebrows | digital lavender #7652e0 / lavender; light lavender #c4adff / acid lime |
| Futuristic | `future` | chrome-grey page, graphite ink, steel-blue eyebrows, ice-blue chips | obsidian page, chrome-grey cards, ice-blue eyebrows | deep cyan #00788f / graphite into obsidian; cyan glow #6ae0f7 / chrome silver |

60s Mod (teal, mustard, tangerine) and 80s Pop (hot magenta, electric
violet, aqua) used to share a teal; since 2026-10-13 they differ at a
glance in page, accent, eyebrow, chip and Splits panel, which
`tests/colour-presets.test.mjs` checks by Lab distance and hue, along with
each newer preset's own hues (Midnight's navy and sage, Gen Z's lavender,
bubblegum and lime, Futuristic's cyan and grey Splits panel). The newer
sheets were tuned with the contrast rules below; their light pages sit at
different lightness so no two presets share a page.

Each preset's identity shows beyond the accent, the same way in every
preset and mode:

- **Surfaces.** `--bg` is the body behind the header, `--page` the page a
  route sits on (the route's `.panel`, edge to edge on a phone) and `--card`
  the lead and metric cards on it. The page is never plain or near-white
  (Lab lightness 84 to 94.5 with some hue in light modes; 16 or less in dark
  ones). A card is a soft step lighter than the page (3 to 14 in Lab
  lightness, in both modes) with a `--card-border` hairline and a gentle
  `--card-shadow`: the Summary, Month and Entries lead cards
  (`.lsd-card`), the Summary and Entries metric pills, and the Support rows
  (`.lsd-rows`). A toned pill keeps its soft tint, now 60% of the fill over
  `--card` (`.money-soft`).
- **Chrome.** `--chrome-surface` (the tab bar, the Support bar, the round
  floating buttons and the header's period controls) is a light tint of the
  preset in light modes and a lifted surface in dark ones.
- **Second colour.** `--eyebrow` is the preset's second colour (70s mustard,
  60s mustard, 80s electric violet, Modern cyan, Code magenta in light
  and violet in dark, Midnight sage, Gen Z bubblegum, Futuristic steel
  and ice blue; Black & White a grey). Section eyebrows
  (`.financial-insight-label`, "Ethan's money insights") and the lead
  card's eyebrow (`.lsd-eyebrow`) use it. Plain chips (`.lsd-chip`) take
  `--chip`, a soft tint of a preset hue.
- **Categories and people** come from the preset's own `--cat-*` palette.

How it works:

- **Tokens.** Every colour in the stylesheets is a token. Besides the
  `:root` tokens above, `--paper-rgb` is every white surface,
  `--on-strong-rgb` the text on a strong fill (accent buttons, the Splits
  panel), `--splits-rgb` / `--splits-deep-rgb` the Splits panel and
  `--accent-rgb` / `--accent-strong-rgb` the accent tints. A few hand-tuned
  70s shades are written as `var(--cream-rgb, 255 250 246)` (also
  `--blush-rgb`, `--on-strong-tint-rgb`, `--accent-deep-rgb`,
  `--accent-ink-rgb`, `--ink-rgb`, `--muted-rgb`): only a preset sets them,
  so the default keeps each shade exactly. Shadows and modal scrims stay
  neutral dark in every preset. New CSS uses these tokens, never a raw
  colour. On the tinted page the strong accent is a mark (a ring, an icon,
  large text, 3:1); small accent text on the page uses `--accent` (70s Warm
  Light's strong accent is 3.67:1 on the page): the text actions
  (`.subtle-action`, `.lsd-quiet`, the Show more rows), the phone's month
  carets and steppers and the Splits strip's New and All. The label on an open
  phone tab pill is `--tab-pill-ink`, `--accent` in a light mode and
  `--accent-strong` in a dark one (the dark sheets set it).
- **Sheets.** A preset in a mode is one small stylesheet,
  `public/palettes/<id>-<light|dark>.css` (about 2.5 kB, minified by the
  build like `styles.css`): seventeen sheets, every pair but the 70s Warm
  light default, which is `:root` of the first-screen CSS. A sheet
  overrides the tokens under `:root[data-palette="<id>"]` with
  `:not([data-mode="dark"])` (light) or `[data-mode="dark"]` (dark); 70s
  Warm's dark sheet uses `:root:not([data-palette])[data-mode="dark"]`. Dark
  sheets set `color-scheme: dark`. Black & White's type rules and Code's
  monospace headings are in both of their sheets.
  `src/client/colour-presets.js` lists the presets (name, four swatch dots
  per mode) and the modes; `applyColours({ presetId, mode })` stores both
  (the defaults, 70s Warm and Auto, as nothing), loads the sheet, then sets
  `data-palette` and `data-mode`; a later choice wins over a sheet that
  arrives late.
- **Before the first paint.** The inline script in `index.html` reads
  `localStorage["monies-map:palette"]` and `["monies-map:colour-mode"]`,
  resolves Auto with `matchMedia("(prefers-color-scheme: dark)")`, sets
  `data-mode` (always) and `data-palette` (for a known non-default id), and
  writes the sheet's `<link>` into the head, so the sheet blocks the first
  paint and the default never flashes. Blocked or empty storage means 70s
  Warm in Auto. In Auto it listens for the phone switching, loads the other
  sheet and flips `data-mode` once it is in.
- **Category, person and group colours.** They all come from the category
  palette, so `src/client/palette-colour.js` (`paletteColour`) hands each to
  the page as `var(--cat-<70s hex>, <70s hex>)` and a preset sets one
  `--cat-*` token per palette colour in each mode (dark modes lift them so
  they read on the dark page). Stored colours never change. The donut keeps
  the 70s colour in its `fill` attribute and draws the preset's through
  `style`.
- **Black & White** shows money direction in the type as well as the grey,
  in both modes: money in is bold, money out and over plan italic, a plan
  dotted and a To do wavy underlined; hidden amounts keep none of it.
  Categories are greys told apart by icon and name. Its dark mode is white
  on black.
- **Dark modes** use dark fills with bright inks, and a bright accent and a
  soft, light Splits panel with near-black text on them (dark text keeps
  4.5:1 on a light panel; light text on a dark accent could not also read
  as accent text on the dark page).

`tests/colour-contrast.test.mjs` runs every check against all eighteen
preset and mode pairs: money inks on the page, cards, panel, paper, chips,
soft tint (over the page, a card and the panel), full fill and Splits wash;
text, muted and eyebrow on every neutral surface; the accent; text on a
strong fill; the card step, hairline and shadow; a tinted (never
near-white) page; soft (light) or dark (dark) fills; the money tones told
apart (in, out, plan, To do and think by Lab distance, and from the text;
type in Black & White); person and group chips. `tests/colour-presets.test.mjs`
checks that each sheet sets every colour and surface token, every
preset-only token the stylesheets read and a `--cat-*` colour for every
palette colour the client draws, under only its own selector; that light
and dark differ, Black & White Dark is white on black and Code Dark is the
old Code; that pages differ between presets and the eyebrow is a second
colour; that the category colours read (3:1 on the panel, paper and card,
glyph 3:1 on its tint, label 4.5:1) and stay 8 apart in Lab; that the
Settings swatches match each mode's tokens; and it runs the `index.html`
script against a stand-in page (stored choice, Auto on a light or dark
phone, blocked storage, the phone switching).
`tests/e2e/colour-presets.spec.js` chooses a preset and each mode
(attributes, tokens, the page surface, storage), follows Auto with
`emulateMedia` at load and live, reloads with the dark sheet held back (the
first frame already shows the preset and mode), checks a donut segment and
the lead card, and blocks storage.

## Person Colour

Each person keeps one colour across the app, from the 70s category palette:
`src/client/person-colour.js` (`getPersonColour`) gives Tim dusty teal
(#46788E), Joyce mauve (#B97680), Splits-linked rows the terracotta
(#BF7D51, unchanged) and any other owner (Shared) a stable pick of warm
grey, grey teal, olive, terracotta, deep teal or plum. Entries draws it as the row's 5px edge; the Import inbox
owner groups use `getPersonColourVars`: a chip (16% tint, `--person-ink`),
the solid account edge, a 10% header band and a 6% wash on alternate
months. Each statement card on the import review starts its name with the
account owner's chip (`.statement-card-owner`, the same chip). `--person-ink`
is the colour 55% into the chocolate `--text`, 5.2:1 or more on the chip,
band and wash (`tests/colour-contrast.test.mjs`). Any later per-person cue
reuses these, never new hues.

## Money Colour

Money is coloured only by its direction or outcome, and only through the
money tones. `src/domain/money-tone.ts` decides a tone (projections carry it
as a DTO field where the server builds the figure: metric cards, split group
balances, split activity); `src/client/money-tone-class.js` renders it as
`.money-<tone>` at one strength per element.

| Tone | Means | Colour |
| --- | --- | --- |
| `in` | money in or a good outcome: income, a refund, received, owed to you, on or under plan, savings made, a matched statement | avocado (mint ink) |
| `short` | a deficit, over plan, income still to come, a debt you owe, a statement that is off | brick red (rose ink) |
| `plan` | an intention: planned income, planned spend, a savings target | dusty teal (sky ink) |
| `caution` | something needs a check (a statement not yet checked) | dark mustard on harvest gold (butter ink) |
| `out` | money out in a list: an expense row, a negative day, an Imports expense row, a settle-up you paid (with its minus sign) | brick red (rose ink), text only |
| `neutral` | transfers, zero, counts | plain chocolate ink |

Exactly on plan, and a fully allocated budget, count as `in`; zero
realized savings and no income yet are `neutral`.

Three strengths, never two on one element:

- **Text only** (lists and tables, the default): only the amount's text
  takes the ink; no fill, no border. Entries row amounts and daily net, Month
  Actual and Variance columns and totals, Intent vs Outcome's detail
  figures, Splits activity (`you lent`, `you borrowed`, `you received`,
  `you paid`),
  Settings statement health, Imports preview amounts and statement rows, and
  the planned cards on Month, and the planned spend in the Summary lead.
- **Soft tint** (compact summary objects): the fill at 60% with a hairline
  in the same hue, and every line in the ink. Summary's Income and Saved
  pills, Month outcome cards (actual income, actual spend over plan,
  realized savings, remaining budget, spend gap), the Entries top's pills with a direction (income,
  difference; the Spent lead, Transfers and Outflow stay plain ink), wallet pills by statement health, and a statement movement
  that is off. Plans stay text-only so a row of cards does not read as a
  traffic light. Balances on the Splits orange (the group tiles) stay plain
  text with no chip: the owner found tinted chips too much there. The
  group's lead card is white, so its balance figure takes the money tone as
  text (mint owed to you, rose when you owe, plain ink at zero and when
  hidden), never a fill.
- **Emphasis** (rare, one per area): the full fill for a banner that needs
  attention: the import statement result, the overlap mismatch hint, and a
  statement card's bank charges and notices (`.statement-bank-charges`, full
  rose with its ink).

The lead card's actual-vs-plan bar (Summary, the Month top, each Intent vs
Outcome month, the Month plan sheet) takes the tone's ink as its fill: the
track a light sky, the fill the muted grey, or rose when over plan.

`tests/money-tone.test.mjs` pins the rule; `tests/e2e/money-tones.spec.js`
reads the computed colours on Summary, Month, Entries and Splits, including
hidden money; `tests/money-colour-guard.test.mjs` fails when a stylesheet
colours with the old raw greens and reds, or a component picks a colour
class by hand.

### Category palette

`src/domain/category-palette.ts` holds the 31 category colours (plus the
fallback), one per former colour, each in a faded 1970s family: harvest
gold, mustard, avocado, olive, rust, burnt orange, tan, brown, dusty teal
(from sea green to denim) and mauve (from lilac through plum to dusty rose).
A category keeps its role's feel where it can (Income and Salary avocado,
Food and Groceries burnt orange, Home and Transfer rust, Travel and Family
denim teal). Each colour is at least 3:1 on the cream panel so a donut
segment or icon reads there, and no colour goes past chroma 52 (faded
print). The closest pair is 8.6 apart in Lab; the original palette had two
oranges 3.0 apart. A category's surface is a faded tint of its colour and
its ink mixes the colour with the chocolate text: an icon's glyph mixes it
70% on its tint (16-34% of the colour); a donut percentage mixes it 62% for
4.5:1. Stored colours are never rewritten: the category DTO
(`app-repository-categories.ts`) shows a former colour, or a calm pastel
colour the picker saved before the 70s palette, as its 70s one and darkens
any other colour toward the text ink only as far as 3:1 on the panel needs,
so the picker, the donut and every icon agree. Split group chips and entry
owner cues draw on the same colours.

| Category (demo) | Former | Colour | Family | On the panel | Glyph on its tint | Label on the panel |
| --- | --- | --- | --- | --- | --- | --- |
| Income | #1F7A63 | #566432 | avocado | 6.22 | 4.86 | 8.37 |
| Transfer | #C97B47 | #AA6647 | rust | 4.32 | 3.99 | 6.56 |
| Savings | #7C8791 | #6E858A | dusty teal | 3.77 | 3.79 | 6.01 |
| Investments | #8FAE4B | #918E54 | olive | 3.28 | 3.50 | 5.42 |
| Salary | #22B573 | #758C4D | avocado | 3.62 | 3.69 | 5.84 |
| Extra Income | #D5A24B | #B48639 | harvest gold | 3.17 | 3.41 | 5.29 |
| Other - Income | #B8875D | #A98466 | tan | 3.29 | 3.49 | 5.42 |
| Subscriptions MO | #E96A7A | #B97680 | mauve | 3.41 | 3.54 | 5.57 |
| Subscriptions YR | #F08FA0 | #9F667B | mauve | 4.36 | 4.03 | 6.60 |
| Food & Drinks | #F7A21B | #C67D3F | burnt orange | 3.17 | 3.39 | 5.29 |
| Healthcare | #D4B35D | #A58F45 | mustard | 3.07 | 3.37 | 5.17 |
| Family & Personal | #4F8FD6 | #46788E | dusty teal | 4.68 | 4.24 | 7.03 |
| Baby & Kids | #7EBDC2 | #699696 | dusty teal | 3.17 | 3.46 | 5.35 |
| Home | #F85A53 | #C36351 | rust | 3.89 | 3.76 | 6.13 |
| Church | #F062A6 | #A77899 | mauve | 3.51 | 3.62 | 5.69 |
| Tax | #CC63D8 | #7A587D | mauve | 5.77 | 4.67 | 7.95 |
| Groceries | #F08B43 | #B16739 | burnt orange | 4.17 | 3.91 | 6.41 |
| Travel | #567CC9 | #2C627C | dusty teal | 6.46 | 4.99 | 8.72 |
| Loans | #A06C5B | #7E584A | brown | 6.01 | 4.75 | 8.13 |
| Sports & Hobbies | #66D2CF | #619989 | dusty teal | 3.16 | 3.45 | 5.34 |
| Bills | #62C7B2 | #53806F | dusty teal | 4.34 | 4.07 | 6.65 |
| Education | #7D86F2 | #7C7998 | mauve | 4.03 | 3.91 | 6.27 |
| Insurance | #5EA89B | #376966 | dusty teal | 6.02 | 4.81 | 8.29 |
| Fees | #8B78E6 | #625A7A | mauve | 6.23 | 4.87 | 8.36 |
| Beauty | #D56BDD | #816C93 | mauve | 4.51 | 4.14 | 6.77 |
| Entertainment | #FFA51A | #986C29 | harvest gold | 4.50 | 4.09 | 6.74 |
| Shopping | #D86B73 | #92535F | mauve | 5.60 | 4.57 | 7.80 |
| Gifts | #C98A5A | #8E6849 | tan | 4.81 | 4.25 | 7.03 |
| Other | #717379 | #7D7369 | brown | 4.49 | 4.13 | 6.73 |
| Public Transport | #56A4C9 | #568C99 | dusty teal | 3.62 | 3.71 | 5.89 |
| Taxi | #BDD93C | #7E7541 | olive | 4.51 | 4.12 | 6.75 |
| fallback | #6A7A73 | #8B897A | olive | 3.41 | 3.58 | 5.58 |

Raw colours elsewhere are only neutrals or the terracotta accent the Splits
theme is built on; `tests/money-colour-guard.test.mjs` fails on any other
raw colour in a stylesheet, or a script colour outside this palette.

## Split Currency Display Contract

Every stored amount is in hundredths of its own currency whatever that
currency's minor unit: a ¥12,000 travel expense is `amountMinor` 1,200,000.
`formatCurrencyMinor(amountMinor, currency)` in `src/domain/split-currency.ts`
is the one formatting boundary for a split currency, shared by the Worker
(the group pill `summaryText`) and the client. It uses the currency's own
fraction digits through `Intl.NumberFormat` (JPY `JP¥12,000`, SGD `$12,000.00`,
KWD `KWD 1,234.500`), widens to two digits only when the stored hundredths are
not whole units, and normalizes a malformed code to SGD like
`normalizeSplitCurrency`. No currency is special-cased.

On the client, `moneyWithCurrency(valueMinor, currency)` wraps it with money
privacy, and `money` stays the SGD home-currency formatter. A Splits surface
that shows a group or record amount passes that currency: the group pill, the
totals strip, the expense dialog's share preview, activity cards, history
rows, archived settle-up summaries, same-currency match deltas, checkpoints,
the Splits financial insight facts and the category donut (`SpendingMixChart`
takes an optional `currency`; `selectSplitDonutChart` picks the active group
currency's chart from `donutChart` / `donutChartsByCurrency`). `moneyStep(currency)` names the
smallest stored step for the odd-cent choice and is not masked, because it is
a unit label rather than a balance. A home-currency (SGD) ledger amount shown
next to a foreign split amount keeps its own SGD formatting. An entry's
`linkedSplitShares` are already in the entry's home currency (each person's
home share of a travel split, computed in `app-repository-entries.ts` with
`homeCurrencyShareAmounts`), so Entries and Month format them with `money`.

## Route Work Status Boundary

The shell knows whether the active route is ready and whether any protected
workflow is open, from the owners themselves, never from DOM queries, network
idle or an old page left on screen. `route-work-status.js` is pure: the route
key (`buildRouteIdentity` → `buildRouteWorkKey`), an owner registry, a
required-fetch counter and `deriveRouteWork`, which returns
`{ routeKey, ready, busy, requiredCount, usable, reason }`.
`use-route-work-status.js` holds the React bindings. App wraps the rendered
route in `RouteWorkProvider` with the active key, or `null` while a previous
page is still shown. Route panels call `useRouteWorkReport({ ready, busy })`;
only Entries reports real readiness because it owns its page DTO, and App
checks its own route data against the active request. Delegated editors and
list rows call `useRouteWorkBusy(busy)`, which registers nothing until they
are busy. Required refreshes the shell awaits outside its loading counter run
inside `withRequiredWork`. Optional prefetch, banner and AI work is never
counted. Owners keep their drafts; the registry holds only booleans.

## Shell Presentation Boundary

App owns shell state, queries, URL normalization and every handler. Its
chrome is presentation in four modules, all in the entry chunk:
`app-shell-status.jsx` (environment badge, loading and error screens),
`app-shell-navigation.jsx` (route tabs and the "More pages" menu),
`app-shell-period-pickers.jsx` (`PeriodMonthPicker` for the single month
and both range ends) and `login-registration-dialog.jsx`. They take
explicit props, never App state wholesale.

Render crashes are contained by `screen-error-boundary.jsx`. One boundary
wraps only the active page, so navigation keeps working: it shows an in-app
fallback with "Try again" (reloads the page data through
`retryActivePageLoad`, then redraws) and "Reload app". It clears itself when
a navigation starts and again when the requested page settles, because the
previous page stays on screen while the next one loads. A second boundary in
`main.jsx` wraps the whole app and can only offer a reload. A page whose code
failed to download also gets only "Reload app", because `React.lazy` keeps a
failed load failed until the page reloads.

## Shared States

`ui-states.jsx` is the one presentation for "nothing here", "this failed",
"this screen failed", notices and loading; callers pass copy from
`copy/en-SG.js` and own every retry handler. Its stylesheet is
`ui/states.css` (imported by `ui-states.jsx`, so it rides with the entry chunk
and never grows `public/styles.css`; the old `.app-loading-*` and
`.import-stale-banner` rules were removed from `styles.css` for it).

Every state follows Lead · Support · Detail: **one clear lead** (the title, 1.08
rem 800, what is missing or what failed), **one quiet support line** (what to do
about it, 0.94 rem 500, muted, or the tone's ink on a pastel surface), a
**technical Detail** line only where there is one (0.76 rem), and **one primary
action** at the bottom (the `BottomActions` bar: primary last, any other action
quiet beside it). On a phone the primary is full width and at least 50 px tall;
a screen-level state is centred in the viewport (`is-screen`, `min-height:
min(60dvh, 26rem)`) so its action lands mid-screen, not under the status bar.
Colours are tokens only (`data-tone`: `rose`, `sky`, `butter`, `mint`).

- `EmptyState` renders an empty section as one muted line, or, with a `title`
  or an `action`, as a white Lead card (the strong lead shadow, an optional
  44 px icon bubble) saying what is missing, why or what next, and the one next
  step (`action`; `secondary` beside it). `compact` is the same lead and
  support with no card, for a section whose action is nearby (the spending-mix
  empty, the empty Ask chat). Where an action exists it reuses the page's own
  handler and label: Entries with no entries ("+ Add entry"), Entries with
  filters on ("Reset filters"), Splits with no activity ("+ Add expense"), no
  groups ("Create group") and a search with no results ("Clear search"), the
  empty Imports queue ("Select file", opens the file chooser).
- `InlineError` renders a failure inside a section as `role="alert"`, with
  an optional retry button; forms, dialogs and the mobile sheet use it.
- `ErrorPanel` is the screen-level failure: a rose card (pastel fill, rose ink,
  no shadow). `ShellErrorScreen` (shell, reference data and first page load),
  the page error inside the shell, the Entries load error, the FAQ guide
  failure and the screen error boundary all render it, so each is an alert
  with the same layout: the title, the plain-language detail
  (`common.loadFailedDetail`), and a primary `lsd-primary dialog-primary` retry
  (the boundary's "Reload app" is a quiet `lsd-quiet` button beside it). The
  technical reason ("Page request failed with status 503") is not shown: a
  server or network failure adds one plain Detail line, "We couldn't reach your
  data just now." (`describeLoadFailure`, passed as `technical`), and the card
  keeps the reason as `data-technical-detail`. A stored code (credit_card, a
  category slug, a hex colour) is never shown either; screens use the label
  maps in `src/client/enum-labels.js` (`tests/raw-enum-guard.test.mjs`).
- A phone sheet that App opens lazily (View and scope, Pick a month) sits in
  its own `ScreenErrorBoundary level="section"`, so a chunk that cannot load
  leaves the page, the tab bar and the sheet's close in place. A lazy chunk's
  stylesheet that fails to download is ridden out (`preload-recovery.js`,
  Vite's `vite:preloadError`): the sheet opens, perhaps unstyled. Every
  boundary crash and every ridden-out stylesheet is also posted once per page
  load to `/api/error-diagnostics/record` as source `client_crash`
  (`client-crash-report.js`): the message, a trimmed stack, the component
  stack and the page's path only, so the next report is read from Settings,
  Error diagnostics (`app_error_diagnostics`).
- `StateBanner` is a notice above a page: the refresh failure notice (butter,
  "Refresh now" primary, "Dismiss" quiet) and the import inbox banner (sky,
  "Open import inbox" primary). Pastel fill, the tone's ink, one primary action
  of at least 48 px, full width on a phone.
- Loading, first load: `ShellLoadingScreen` (app-shell-status.jsx) shows the
  header and the page's own blocks as quiet placeholders (`.state-skeleton`,
  `SKELETON_SHAPES`: Summary = chips, lead card, insight lines, a chart card;
  Entries = totals strip, insight lines, filter bar, a day of rows; Splits =
  group row, lead card, a day of rows; any other page = lead card and rows) with
  one support line ("Loading..." plus what the shell reports, and the seconds
  after five). No buttons and no figures, so hidden money has nothing to leak.
  Placeholders shimmer only when the person has not asked for reduced motion.
  They never take their own height from data: heights are fixed per block so
  the page replaces them without a jump.
- Loading, later: while a route fetches with the previous page still on screen,
  `AppLoadingOverlay` is one sky pill (`.state-pill`) centred under the header
  (clear of the period picker), with percent, detail and seconds in its
  tooltip; only a problem is spelled out. The Entries page's own refresh uses
  the same pill (`entries-page-loading`).

A page load that fails after the person navigated shows the page
`ErrorPanel` inside the shell, and hides the previous page. Otherwise the
previous page's figures would stay on screen under the new tab or period.

- Navigation and the period picker stay usable.
- "Try loading again" runs `retryActivePageLoad`, and the panel stays up
  (showing "Working...") until the retry settles.
- The previous page is hidden (`display: none` on `.route-page-body`), not
  unmounted, so a draft on it survives the failure and the retry.

Entries can learn that a month failed when the shell does not. Another
tab's save during a month switch clears the Entries cache twice, which
cancels the shell's own load of the page, so the shell stays silent. The
Entries owner then holds a `loadError`, and the panel shows the same page
`ErrorPanel` in place of its totals, insight, filters and rows. It never
shows the previous month's rows or "No entries match this view." Its "Try
loading again" runs the shell's `retryActivePageLoad` (the `onRetryPageLoad`
prop), so the shell and the list recover together. Open drafts and sheets
stay mounted. The split follows the rest of the app: no page for this
request yet means the error panel, while this request's own rows on screen
mean the refresh notice.

Dialogs and sheets that write keep their draft until the write succeeds.
The Month "Match planned item" dialog (desktop) and sheet (mobile) show
"Saving...", take one submit (a ref guards double clicks), and check the
response. Escape, Cancel and the close button are ignored while the save
is in flight. A failure keeps the dialog or sheet open with its draft and an
`InlineError`; only a success closes it and refreshes the month.
The other Month writes follow the same rule: plan and income row deletes
(the `DeleteRowButton` confirmation shows "Working..." and keeps the row
with the error), the row note and month note dialogs (the table and note
card change only after the save succeeds), and duplicate, reset and delete
month (a failure keeps the Actions popover or confirmation dialog open).
The reset and delete confirmation dialogs render beside the Actions popover,
not inside it, because closing the popover unmounts its content.

## Desktop Chrome

The desktop (761 px and wider) header, scope switches and totals follow
Lead · Support · Detail with one set of tokens in `:root` of
`public/styles.css`, next to the phone's `--chrome-*` tokens: `--radius-control`
(10 px: tabs, period buttons, period box, eye, pills inside a group),
`--radius-group` (14 px: a segmented group),
`--track` (the grey a group sits on, the text ink at 6%), `--shadow-raised`
(a selected segment), `--shadow-pop` (the period picker; both shadows are
colour tokens every colour preset sets, and the radii and type sizes are
layout tokens the same in every preset),
`--type-title` (1.7 rem), `--type-control` (0.875 rem) and `--type-small`
(0.78 rem). The block is "Desktop chrome" in `styles.css`, after
`.pill-disabled`, so the page-width header tightening below it still wins.

- Lead: the page title (`.panel-head h2`, and Month's month name, in ink) is
  the same 1.7 rem on every page. The controls around it are Support and stay
  quiet.
- One control height: the view pills' group, the tabs, the period buttons, the
  period box and the eye are all 36 px, so the header is 57 px tall and stays
  one row at 1,440 px, at 1,280 px with the Ask panel docked (a page 920 px
  wide) and at 1,024 px.
- Segmented groups (view pills, Entries and Month scope, Summary's scope
  switch) are a grey track; the selected segment is raised white at weight
  600, never terracotta. The active person's pill takes that person's colour
  (`getPersonColourVars`, set inline in `App.jsx`, read only while the pill is
  active), the same colour as the Entries row edge. Household is raised
  white. The Summary month row (`.summary-focus-button`) uses the same track
  chips with a raised white selected one, and wraps to a second line instead
  of clipping at the page edge.
- A period that does not apply to the page (Splits, Settings, Imports, FAQ;
  `.period-nav-cluster.is-passive`) reads as a plain label with dimmed,
  inert arrows, not as a disabled box. A page that uses the period keeps the
  bordered box and live arrows.
- Totals: the Entries top and its search bar are "Entries top"'s
  (`entries-overview.jsx`, `entries-route.css`); this block does not restyle
  them. Month's totals are the Month lead card's (see "Lead · Support ·
  Detail").
- Bundle: the Entries-only date and empty-state base rules live in
  `entries-route.css`, and rules for classes no component renders were
  removed from `styles.css`, so the block adds few first-screen bytes.
- Proof: `tests/e2e/visual-structure.spec.js` (computed heights, radii, person
  colour, title size, quiet selected states, narrow-page clipping and passive
  period at 1,440, 1,280 docked and 1,024 px) and
  `tests/e2e/header-tab-fit.spec.js`.

## Phone Chrome

The phone's floating chrome follows Lead · Support · Detail (below) and one
set of tokens in `:root` of `public/styles.css`: `--chrome-edge` (12 px, the
inset of the tab bar, the Support bar and the round buttons, so their right
edges line up), `--chrome-radius` (22 px), `--chrome-surface`,
`--chrome-shadow` and `--sheet-radius` (24 px, every bottom sheet). Every
target is at least 44 x 44 px and nothing wraps or scrolls sideways at 375 px.
A control smaller than that keeps its look and carries a centred invisible hit
area (the phone block before "Money tones" in `public/styles.css`); a field, or
a control a parent would clip, grows instead. `tests/e2e/phone-tap-targets.spec.js`
measures what a finger reaches on Summary, Month, Entries, Splits, Imports and
Settings. The Month plan rows' category icon and actual-amount links are left to
the plan-table redesign.

- Support bar (`.mobile-context-sticky-bar` in `App.jsx`): one white surface
  (chrome radius and shadow, no border-radius or shadow on anything inside it),
  48 px tall, 80 px above the bottom: the person chip, the scope as quiet text
  and a caret in the trigger, then the month control (Summary tab: the month
  chip; Entries: two 44 px arrows). The household gets a neutral chip.
- View and scope sheet (`mobile-context-sheet.jsx`, its CSS and
  `copy/mobile-context-copy.js`, a lazy chunk): Lead is who you are viewing,
  a large person chip with the scope name and what it counts
  (`messages.views.scopeHint`); Support is the view and the scope as two
  segmented groups (`role="group"` named `View` and `Scope`, `aria-pressed`
  chips, 44 px); Detail (Entries only) is the filters as quiet 48 px rows
  (label left, value and chevron right) opening the existing pickers
  (`EntriesFilterStack` with `hideActions`). `Reset filters` (Entries only)
  and `Done` are the bottom bar (`BottomActions` with `is-sheet-bar`), `Done`
  last under the thumb. A grab bar and a swipe down close the sheet
  (`SheetSwipeDismiss`, nothing to lose).
  The choices are unchanged: a person keeps the sheet open, a scope or the
  household closes it, Reset keeps it open; every one sets the same URL params
  (`view`, `scope` or `entries_scope`, `entry_*`).
- Chunking: `App.jsx` keeps the dialog's Portal, Overlay, Content and head so
  Radix stays in the entry chunk; only the inside is `lazy` (with the swipe
  code and the filter stack). The lazy module must not import modules App
  imports (it receives the person chip as an element): doing so makes Rollup
  split the entry chunk and `check:bundle` fails on file count.
- The Ask tab has an identity of its own: its icon and label are `--accent`
  in semibold (600) even while another page is open, and open it is the same
  pill as the others with a stronger accent tint (18% `--accent-strong`, a 40%
  edge, label 700 in `--tab-pill-ink`; the others' open pill is 12%). Only tokens, so every colour
  preset follows; `tests/colour-contrast.test.mjs` checks the label on the bar
  and on the open pill for every preset.
- The round buttons: the money toggle (44 px, above the Support bar, higher on
  Entries and Splits to clear the + button) and the + button (54 px, accent
  fill with the same lift in the accent's shade) share the tab bar's right
  edge. The More pages popover uses the chrome radius and lift and 44 px
  rows. Proof: `tests/e2e/mobile-chrome.spec.js`.

## Mobile Sheet

`entry-mobile-sheet.jsx` (`EntryMobileSheet`) is the bottom sheet for the
Month plan sheets, the Entries add and edit sheets, and every dialog on
`SheetDialog` (see "Dialogs and small sheets" under "Lead · Support · Detail":
the import progress sheet, the Claude "I've topped up" sheet, the delete and
note sheets and the Settings editors). It behaves like the modal
desktop dialogs, and swipes down to close (below):

- Focus moves into the sheet on open. The sheet itself takes focus, not a
  field, so opening it does not raise the phone keyboard.
- Focus stays inside the sheet while it is open, including when something
  moves it outside directly.
- It looks and sits the same wherever it opens: a fixed bottom sheet over a
  dimmed backdrop. Its styles in `public/styles.css` are therefore not in
  the 760px phone block but in their own unconditional section, scoped to
  the sheet and its backdrop (which render only in a sheet layout). Month
  also opens it on a portrait tablet, where the page itself keeps its
  desktop layout; before this the sheet rendered at the bottom of the
  scroll-locked page there, out of reach. Rules that restyle the page while
  a sheet is open (`body:has(> .entry-mobile-sheet) ...`) stay in the
  phone block (see "Page State Rules").
- The rest of the page is hidden from screen readers (`aria-hidden`), and
  the backdrop covers the viewport in every layout, so a tap outside the
  sheet lands on the backdrop instead of the page. A touch drag or wheel over
  the backdrop does not scroll the page, and neither do the scroll keys.
- Escape or a backdrop tap closes the sheet, and focus returns to the
  control that opened it.
- Escape is a cancel, as in the desktop dialogs, so the draft is discarded.
- While `isSubmitting` (a save or delete in flight), Escape and backdrop
  taps are ignored, so the pending result and the draft are kept.
- Nested Radix layers (a category editor, the mobile select) close first on
  Escape, leaving the sheet open.
- A portalled dialog still bubbles React events through the component tree
  into the form or row that opened it. `CategoryEditDialog` therefore
  stops `submit`, `click` and `keydown` at its overlay and content, so
  saving a category from a sheet, the desktop composer or a list row
  saves only the category. It leaves `pointerdown` alone, because Radix
  uses it for outside-press dismissal. Any new dialog that can open inside
  a form needs the same guard.
- It is a Radix Dialog with `modal={false}` plus the modal pieces added
  back: a trapped, looping `FocusScope`, `hideOthers` from `aria-hidden`,
  `RemoveScroll` without its scrollbar styles, `overflow: hidden` on
  `<html>`, and a plain backdrop. Radix's own modal mode sets
  `pointer-events: none` and a scroll-lock custom property on `<body>`.
  Both inherit, so on a 2,000-row month every row recomputed its style on
  open and again on close. None of the pieces used here changes an
  inherited style (see "Mobile sheet: a lighter modal" in
  `docs/audits/macro-loading-baseline.md`). Keep it that way: a new modal
  behaviour for the sheet must not restyle `<body>` or the app root.
- It lifts itself above the phone keyboard. iPhone Safari keeps the layout
  viewport when the keyboard opens and only shrinks the visual viewport, so
  `use-keyboard-inset.js` sets `--keyboard-inset` on the sheet (the height
  the keyboard covers; toolbar wobbles under 120 px and pinch zoom are
  ignored), the sheet's `bottom` and `max-height` use it, and the focused
  field scrolls back into view inside the sheet. The phone Splits dialog
  does the same. Every bottom sheet with a `BottomActions` bar is one of
  these two (the Entries edit sheet, the Month plan-row sheet, Create split
  expense, the Claude credit "I've topped up" sheet); `tests/keyboard-inset.test.mjs` fails if a new one is not, and
  tests `attachKeyboardInset` (the hook's body) with a stand-in visual
  viewport. Browser tests cannot open an iPhone keyboard, so this is checked
  by unit test and on a real phone only.
- `headerAction` adds a control before the close button (the Entries edit
  sheet's money eye) and `className` a variant (`is-lead-sheet`).
- Swipe down to close (`sheet-swipe.jsx`, rules in the pure
  `sheet-swipe-controller.js`). The phone Splits expense dialog uses the
  same hook. A grab bar sits in the sheet's top padding (drawn only:
  `aria-hidden`, not a tap target; the ✕ and Cancel stay the keyboard and
  screen-reader ways out). The sheet follows the finger; released past
  30% of its height (80 to 160 px) or flicked down (0.6 px/ms, 24 px or
  more) it is dismissed.
  - Discard rule: each sheet passes `isDirty`, whether its draft changed
    since it opened (the Entries edit sheet's `hasEditingEntryChanges`; the
    others `useDraftChanged(draft, pickFields)`, which keeps the draft it
    opened with). Unchanged, the swipe closes it straight away. Changed, it
    springs back and asks "Discard changes?" in a bar at the sheet's bottom,
    under the thumb: **Discard** (destructive, `lsd-quiet is-danger`) closes
    it through the sheet's own close (the same as Cancel), **Keep editing**
    (`lsd-primary`, focused) keeps the draft. Escape or a tap outside while
    it asks means Keep editing. Never a system confirm. The form behind is
    `inert` while it asks.
  - Where a drag may start: the grab bar and header, or the body
    (`data-sheet-body`) while it is scrolled to its top. Never from a text
    field, an active text selection, a long press (500 ms before moving),
    content scrolled away from its top, or a scrollable list or chip row
    inside the body (`.planned-link-list`, a sideways chip row): those keep
    every touch. Sideways or upward movement hands the gesture back to the
    browser.
  - Scrolling stays native: `touchstart` is passive, `touchmove` cancels
    only a move the controller claimed for the sheet (a clearly downward
    one), and the sheet never sets `touch-action`. A touchmove the browser
    already made uncancelable (it started scrolling) ends the drag. A click
    right after a drag is eaten, so a drag never taps a row.
  - While `isSubmitting` the swipe is ignored, as Escape is.
  - `prefers-reduced-motion`: the sheet still follows the finger (direct
    manipulation), but springing back and sliding away are instant.
  - The styles (`sheet-swipe.css`) and copy (`copy/sheet-swipe-copy.js`)
    ship with the routes, not the first screen.
    `tests/sheet-swipe-controller.test.mjs` proves the rules and pins every
    sheet's `isDirty`; `tests/e2e/sheet-swipe-dismiss.spec.js` proves them
    in WebKit (iPhone 13) and Chromium, including real CDP touch scrolling
    of the body and of a long list inside a sheet.
- The opener is found by `sheet-focus-return.js`, not from
  `document.activeElement` alone: iPhone and iPad Safari (WebKit) do not
  focus a tapped or clicked button, so after a tap `activeElement` is
  `<body>`. The module watches trusted clicks in the capture phase and
  remembers the focusable control each one landed on (a key press clears
  it, because keyboard focus is reliable). The sheet takes that control as
  its opener during its first render, else the focused element, which is
  what Chromium gave before. Script clicks do not count, so the Entries
  floating add button, which forwards its tap to a hidden trigger, is the
  opener rather than the trigger.
- When the opener is no longer on the page (or the sheet opened from a
  link, with no opener), and nothing else has taken focus, closing moves
  focus to the `<main>` landmark (given `tabindex="-1"`) instead of
  `<body>`, so a screen reader carries on from the page content.
- `className` adds a class to the sheet (the Month plan sheet scopes its
  44px close button with it), and `footerContent` replaces the default
  footer (the plan sheet passes `BottomActions`, see "Lead · Support ·
  Detail").
- `npm run test:e2e:webkit` runs the `@webkit`-tagged sheet focus tests in
  WebKit with an iPhone profile (`playwright.webkit.config.js`); it is not
  part of the default suite. The same tests run in Chromium there.

## Page State Rules

Some CSS restyles the rest of the page while something is open: the tab
strip, the sticky View and scope bar, the floating add and totals buttons
and the floating Splits group row give way to the mobile sheet, a dialog or
an inline editor, and the Splits page has its own phone background. These
rules must not use a `:has()` that searches all descendants
(`body:has(.x)`). Chromium then walks the whole page each time an element
such a rule styles is restyled; on the 2,000-row month that was about 25 ms
of style work per sheet open or close at CPU 4x (see "Mobile sheet: page
rules" in `docs/audits/macro-loading-baseline.md`).

- Portalled layers are direct children of `<body>`: Radix portals each
  direct child of `<Dialog.Portal>` there without a wrapper, including the
  sheet's backdrop and content. Their rules use `body:has(> .entry-mobile-sheet)`
  and `body:has(> .note-dialog-overlay)`, which check only `<body>`'s
  children. A dialog that portals into a container, or wraps its overlay,
  would not be seen.
- Elements inside the page hold a flag on `<body>` through
  `page-flags.js`: `ref={pageFlagRef(PAGE_FLAG.entryInlineEditor, inlineEditorRef)}`
  on the Entries inline editor, `splitInlineEditor` on the Splits inline
  card and `splitsPanel` on the Splits panel. The ref sets `data-<flag>`
  while the element is attached (React 19 ref cleanup), so the flag changes
  in the same commit as the element, and CSS reads
  `body[data-entry-inline-editor] ...`. The callback is cached per flag and
  element ref, so rows need no extra hook. `PAGE_FLAG` lists every flag.
- `tests/page-flags.test.mjs` fails on a descendant `:has()` in any
  stylesheet, on a body flag the CSS reads that the client does not set (or
  the other way round), and on a dialog overlay that is not a direct child
  of `<Dialog.Portal>`. `tests/e2e/page-chrome-while-editing.spec.js` pins
  the visible behaviour.

## Reference Data Owner

`reference-data-owner.js` owns accounts and categories: the query cache is
authoritative, and the owner keeps the last good DTO on screen while a
refresh runs. Every load and refresh takes a generation, so a superseded
request (for example one cancelled by a cross-tab refresh) never overwrites
newer data or shows the error screen. `use-reference-data.js` is its React
binding; App calls `refresh()` from mutation plans and
`refreshOrShowError(label)` from cross-tab refresh and the retry button.

## Page, Summary And Shell Owners

Summary (`summary-owner.js`), generic route pages (`route-data-owner.js`)
and the app shell (`app-shell-owner.js`) follow the reference-data pattern:
each owner keeps the last applied snapshot (with its request key) and a
generation, so a superseded load or refresh never overwrites newer data,
clears it or raises an error screen. A route-data refresh with
`apply: false` (Settings refreshed while another route is open) takes no
generation. Hooks (`use-summary-data.js`, `use-route-data.js`,
`use-app-shell-state.js`) bind them; App keeps loading status, required
work, the page error screen and the mutation refresh plans.

The Entries panel's page DTO has its own owner (`entries-data-owner.js`,
bound inside `useEntriesPageData`): loads and refreshes take a generation,
and a refresh whose month and view are no longer active returns before it
clears any cache or fetches, so an edit's late refresh can neither
overwrite nor stall the month the person moved to. The owner also tracks
which request the page on screen belongs to (`seed(page, params)` and
applied loads set it). The latest load or refresh can fail while that page
is still another month's or view's. The owner then sets `loadError`, keeps
the page for open drafts, and does not rethrow, so no refresh notice
appears. A load that fails over this request's own page is rethrown, and
the panel reports it through `runBackgroundRefresh`. Aborts and cancels are
never errors.

The panel reads the linked entry (`editing_entry`) straight from the URL and
keeps only whether it already acted on the param's current value
(`linked-entry-request.js`, synced while rendering, not in an effect). The
open effect handles each value once, so an editor closed by a save, a
transfer link or a close is never reopened while the param clear is still
pending.

Refreshes after a save go through `runBackgroundRefresh` from
`use-refresh-notice.js` (owner: `refresh-notice.js`). App uses it for every
background shell, reference-data, route-page and Summary refresh in its
refresh plans, and passes it to the Month, Splits and Entries panels. A
failure resolves to `null`, keeps the saved data on screen and shows the
inline refresh notice with "Refresh now" (it reruns the failed refresh) and
"Dismiss". Aborted and cancelled requests, a shell request overtaken by a
newer one, and failures that land after a route change are silent; a route
change clears the notice. When several refreshes fail together (a page and
its shell), "Refresh now" reruns each of them.

`use-app-sync-subscription.js` owns the cross-tab BroadcastChannel and
storage listeners; its parse and dispatch helpers are pure.

## Layout Breakpoint Boundary

`use-viewport.js` is the only client module that calls `matchMedia` for
layout; nothing else reads `innerWidth` or repeats a query string. It has
three queries (the third, `ASK_DOCK_WIDE_QUERY` `(min-width: 1280px)`,
only says where desktop Ask docks: "Desktop Ask"):

- `MOBILE_LAYOUT_QUERY`, `(max-width: 760px)`, is the phone layout and
  matches the `@media (max-width: 760px)` blocks in `public/styles.css` (a
  unit test checks the stylesheet). Entries, Splits, the responsive pickers,
  the spending chart, the last-period hint, inline editor scrolling, the
  Splits group strip and focus visibility use it.
- `MONTH_SHEET_LAYOUT_QUERY` adds `(max-width: 1024px) and (orientation:
  portrait)`. Month plan and income rows open the mobile sheet on a portrait
  tablet too, while the CSS and every other page keep the desktop layout.
  This difference is deliberate; do not merge the two queries. The CSS has
  no copy of this query: the sheet's own styles apply whenever it renders
  (see "Mobile Sheet").

Render code uses `useIsMobileLayout()` / `useIsMonthSheetLayout()`, built on
`useSyncExternalStore` with one shared `MediaQueryList` per query, so the
value is right on first render and a resize or rotation switches the layout
without a reload. With no window (server render, unit tests) they report
the desktop layout. Event handlers and effects call `isMobileLayout()` /
`isMonthSheetLayout()`, which ask `matchMedia` at that moment. The Month
open handlers must keep this fresh read: the row-open spy in
`tests/e2e/month-page.spec.js` counts it. Focus visibility also treats a
visual viewport of 760px or less (pinch zoom) as mobile.

Between the two layouts there is a CSS-only mid-width range, 761 to
1,099 px (portrait and landscape tablets, small laptops), where the desktop
layout must still fit the screen. It needs no JavaScript, so it has no
query in `use-viewport.js`. Its blocks are
`@media (min-width: 761px) and (max-width: 1099px)` (plus one to 960 px;
the header's and Month's are page-width container queries, below) and
never touch the phone or wide-desktop rules. A header block for 1,100
to 1,199 px follows it (see below).

The header and the Month mid-width rules are container queries on the
page itself: from 761 px `.shell` is `container: shell / inline-size`, and
those blocks read `@container shell (...)`. Without the docked Ask panel the
page is the window less 36 px (the shell's gutters), so a 1,100 to 1,199 px
window is a 1,064 to 1,163 px page and nothing changes; with the panel
docked, the narrower page lays out like a window of its width, so the
header stays one row and the Month tables fit or scroll inside their
section, never under the panel. Other pages keep their window-width rules
(none of them spills past the panel at 1,280 or 1,440 px;
`tests/e2e/header-tab-fit.spec.js` checks every page). The header rules are in
`public/styles.css`, because every page shows the header. The Month rules
are in `src/client/month-mid-width.css`, which `month-panel.jsx` imports,
so they ship with the lazy Month route and stay out of the first-screen
CSS budget (`npm run check:bundle`). That file loads after `styles.css`
and after `month-route.css` (the Month route's general rules), so its
rules win over base rules of the same specificity.

- The header's period controls wrap below the page tabs as one group.
  Before, they widened the page up to 960 px and slid under the tabs from
  961 px, covering Settings and FAQ.
  From 1,100 px the header is one row (pills, tabs, period controls), with
  no second row, hidden tab or sideways scroll. At desktop spacing the row
  needs about 1,160 px and fits from 1,200 px (the shell's content width
  stops growing there). From 1,100 to 1,199 px
  (`@container shell (min-width: 840px) and (max-width: 1163px)`, a 1,100
  to 1,199 px window without the Ask panel) the header
  gap, view pill and tab padding, tab and period gaps and the period box
  (padding, gap, `min-width` 236 px, still wider than the Summary range)
  tighten by about 125 px, leaving about 30 px spare at 1,100 px; the text
  size is unchanged. 1,200 px and wider, and phones, are pixel-identical to
  before. `tests/e2e/header-tab-fit.spec.js` checks every page at 1,100,
  1,120, 1,200 and 1,279 px: `elementFromPoint` at each tab's edges and
  centre and each period control, one shared vertical centre for the row,
  and the 1,440 px header height; it also pins the 1,440 and 390 px header
  spacing. A two-row header here (period controls below the tabs) was
  tried and rejected because it pushed the page down.
  A page 840 to 1,063 px wide (an 876 to 1,099 px window, or the docked Ask
  panel beside a 1,280 to 1,499 px one) keeps one row too: the same tighter
  spacing, the period box sized to its words (`min-width: 0`), and Imports,
  Settings and FAQ behind the existing "More pages" menu, as on a phone
  (`@container shell (min-width: 840px) and (max-width: 1063px)`;
  `header-tab-fit.spec.js` checks every page at 1,024 px and with the panel
  docked at 1,280 and 1,440 px). Below
  840 px (a 761 to 875 px window) the wrap above still applies: there one
  row does not fit (at 761 to 960 px the view pills already sit on their
  own row).
- The Month panel and plan sections may shrink below their tables'
  min-content width (a grid item's automatic minimum is its min-content,
  which is the whole table), so `.month-table-wrap` scrolls inside the page
  and the page never scrolls sideways. Tighter cell spacing and two-line
  notes let the tables fit whole from about 900 px; below that the Account
  and Note columns scroll inside the table, while Category, Item and the
  money columns stay on screen. Inline Save and Cancel stick to the visible
  edge of the table. On a portrait tablet the row sheet shows every field.
- From 1,100 to 1,199 px the full-size tables need a little more than the
  route grid: with the Mac's fonts the panel ran into the shell's 18 px
  right gutter, and with wider fonts (Linux CI) the page scrolled sideways.
  A last block in `month-mid-width.css` tightens cell padding to 6 px,
  header letter spacing, the category gap and the note cut-off (160 px,
  still one line), so the tables
  fit the grid whole with about 50 px spare under Verdana. The panel keeps
  its automatic minimum width here: making it shrinkable instead clipped
  the note edit icons. `header-tab-fit.spec.js` checks 1,100 to 1,279 px
  with 0.05em extra letter spacing and money shown: no sideways scroll and
  every note edit icon inside its table.

`tests/e2e/month-mid-width-layout.spec.js` checks this at 820×1180 (full
mobile emulation) and 1024×768. With mobile emulation, as on a real tablet,
a too-wide page grows the layout viewport, which moves controls and the
fixed sheet off screen, so keep new Month and header content shrinkable.

Route warmup reuses `MOBILE_LAYOUT_QUERY` for its narrow-viewport signal,
but its mode also needs `(pointer: coarse)` and stays in
`selectWarmupMode`, because warmup is about the device, not the layout.
`tests/e2e/viewport-breakpoints.spec.js` resizes one page across both
widths.

## Route Warmup Boundary

Optional work (route code and speculative page data) starts only
when the active route is usable, and it never delays a navigation or a
required read.

- `route-warmup-policy.js` (pure) decides whether one candidate may start and
  which exact destinations are worth considering. Desktop and mobile have
  separate limits; hybrid or unknown devices get the mobile policy.
- `route-warmup-scheduler.js` owns the quiet period, the per-visit budgets
  and the one-at-a-time queue, with an injected clock. `use-route-warmup.js`
  feeds it browser signals: visibility, connection, interaction, editable
  focus and route work.
- `route-modules.js` is the only route-code loader, shared by navigation and
  warmup, so a warmed chunk is the one the route uses.
- `query-leases.js` keeps the two fetch paths. Required reads take a lease
  before touching the cache, and fetch again each time a cache clear cancels
  their shared request, so a live caller never receives a cancellation its
  owner would take for "superseded" and leave the page loading. Speculative
  reads are cancelled at their
  deadline unless a required reader joins them (promotion). It also times
  required network fetches: mobile data warmup needs a recent reading of
  500 ms or less.
- `route-warmup-data.js` builds speculative requests with the same key
  builders as the required readers. `route-warmup-admissions.js` lists the
  data families measured cheap enough for mobile, currently only the Entries
  page (gzip bytes and handler p95 on the 10k fixture). Mobile preloads data
  only on a 4g connection without data saver; a browser that reports no
  connection (iPhone Safari) stays code-only.

## In-App Guide Boundary

The FAQ route renders two Markdown guides as tabs: `docs/user-guide.md`
(User guide) and `docs/developer-guide.md` (For developers).

- `guide-markdown.js` is a pure parser for the small Markdown subset the
  guides use (parts, sections, subsections, lists, tips, code, images, inline
  bold, code and links). It gives every heading a stable id and classifies
  links as in-guide anchors, cross-tab anchors (`?faq=developers#id`), app
  routes, public files or outside sites. Tests reuse it to check that every
  link, anchor and image resolves.
- `faq-panel.jsx` owns the tab state in the URL (`faq=developers`; the user
  guide is the default and has no parameter) and loads each guide through its
  own dynamic import, so the developer guide downloads only when its tab
  opens and neither guide reaches the first-screen bundle.
  `sanitizeTabParams` drops `faq` on every other route.
- FAQ styles live in `faq-panel.css`, loaded with the lazy route. Screenshot
  families (`/faq/guide/desktop/`, `/phone/`, `/iphone/`) get a fixed aspect
  ratio so lazy images never shift a deep-linked section.
- The route stays static: it reports ready immediately and never busy.
- Layout (Lead · Support · Detail): the guide is the lead. The contents are
  Support: open beside the guide on a wide screen, one 48 px row ("Contents",
  `aria-expanded`) on a phone, so the first section starts on screen; the guide
  tabs are two equal 48 px segments on a phone. While a guide downloads the
  page shows the shared placeholders and one "Loading guide..." line
  (`.faq-guide-status`); a failed download is the shared rose `ErrorPanel`
  with "Try again".

