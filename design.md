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

Split activity history is an action-oriented recovery surface opened from the
splits summary area. It uses the splits color contract, stays compact and
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

The Splits workspace uses a dark surface but paid-settlement follow-ups use a
light proof card. Controls on that card must use an explicit light-card theme:
readable dark secondary actions, a distinct caution treatment for `Undo paid`,
and a high-contrast primary treatment for the later bank-transfer match.

## Ask Page

The Ask page (`/ask`, `src/client/ask-panel.jsx`, lazy) is one full page,
never a sheet: the tab bar stays visible and there is no close button. Flow
and data contract: [`docs/flows/ask-flow.md`](docs/flows/ask-flow.md).

Layout, top to bottom:

- Header: "Ask" (chat mode) or "New entry" / "New income" / "New transfer" /
  "Saved" (add mode) with a context line: person · scope · month in chat,
  person · month beside the title in add mode. In chat mode, once there is
  something to start over from, a quiet "New chat" text button (accent
  text with a pen glyph, 44 px tall) sits at the header's right.
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

The check before an answer is the same card with the butter "Check this
first" tag over the head ("Serene → Ethan" or the two accounts, the bank
description muted, the amount in plain ink) and one plain paragraph; its
chips are Mark as settlement or Link as transfer (filled) and It's real
spending. Once answered it stays in the thread, faded.

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
- add mode: `‹ Entries` / `‹ Splits` / `‹ Ask` first; then a pending
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
  as transfer, filled) and It's real spending.

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
"Desktop". Code: `ask-dock.jsx` (field and frame, first screen),
`ask-dock-layout.js` (pure layout rules), `ask-dock-state.js` (session
state), and the Ask page itself inside (`AskPanel` with `placement`).

- The field: one white pill, 340 × 48 px, 24 px radius, the inset hairline
  and a soft shadow, fixed 22 px from the right and 29 px from the bottom
  (on the vertical centre of the 58 px + button, 12 px to its left on
  Entries and Splits). An accent ✦ glyph, the placeholder "Ask, or drop a
  receipt…" in muted ink, and a muted paperclip in a 44 px hit area ("Add
  a receipt photo"). The accent focus ring shows on the pill while it has
  focus. It hides under a dialog or an inline editor (as the + does), while
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
wallet (the wallet picker, unfolding More details) and owner. Ask draft
card: date, wallet and owner. Create split expense card: date, paid by,
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
- On a wide screen a chip moves focus to its row's select (and opens it
  where the browser allows).

Source chip: the bank state chip names the tool that saved a provisional
entry, "Apple Pay · provisional" (the Apple Pay Shortcut) or "Ask ·
provisional", on the Edit entry card and Ask's saved card; a certified
entry says "Statement certified" and other entries keep "Manual
provisional" or "Import provisional". More details then has a read-only
"Added by" row (Apple Pay shortcut, Ask), and an Entries row shows a small
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
  bar keeps the safe-area inset. Swipe down to dismiss is not supported:
  neither the mobile sheet nor the Radix dialog has it, and adding it would
  be a new gesture that discards a draft.
- No AI tag outside the Ask flow; a bank- or rule-filled value is not AI.

Where it is used:

- Summary top (`summary-lead.jsx`, `summary-lead-model.js`): "Spent ·
  range", the range's actual spend "of" its planned spend, the bar, the
  percent of plan and how far under (mint) or over (rose) plan; Income and
  Saved pills with planned income and the savings target. Every figure and
  tone is the Summary DTO's own metric card (the DTO is unchanged). Phone
  stacks the pills under the lead; desktop and tablet put them in a column
  on its right. The CSS is `summary-lead.css` in the Summary route chunk
  (it sits in `.panel-head`, whose `span` rule mutes spans, so its money
  spans take their tone back at a higher specificity).
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
  and Type. On a wide screen the card sits left of the rows and each row
  keeps an inline field, so Tab walks description, amount, the eye, then the
  rows in order. Delete entry (and Delete split once it is on Splits),
  Cancel and Save are in the bottom bar.
- New split expense (`split-expense-card.jsx`, from the Splits dialog in
  both layouts; editing and viewing a saved split keep the form for now).
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
  defaults", opened when a plain CSV needs mapping; upload status and the AI
  consent stay beside the drop zone
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
same `ReceiptReadDto` (the domain's `readReceiptOcrText`; Ask still uses its
own smaller `parseReceiptText` in `ask-receipt-image.js`, to be replaced by
the domain parser); and fill the entry card
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
  Month shows the scope pills in its header. Summary shows
  `SummaryScopeSwitch`: a compact one-click `Direct` / `Shared` / `Both`
  switch (`messages.summary.scopeSwitchLabel`) in the empty space under the
  `Summary` title, with `aria-pressed` on the active option and what each
  scope counts (`messages.views.scopeHint`) as that option's `title`
  tooltip; there is no visible explanation row. It must not change the
  header: `.summary-scope-switch` takes its own row in the title column with
  `contain: inline-size` (no content width) and a -12px margin that cancels
  the title row's 12px flex gap, so the title column is exactly as wide as
  without it, and the row fits beside the two rows of metric cards, so the
  header is exactly as tall. Where the header stacks (960 px and below) the
  switch joins the title row instead, again adding no height.
  `tests/e2e/summary-workflow.spec.js` measures the header, the cards and the
  check-in with and without the switch at 1,440 and 1,920 px.
- Phone (`useIsMobileLayout()`): Summary, Month and Entries show the floating
  View and scope bar from `App.jsx` (`stickyScopeConfig`), and Summary does
  not render its switch at all. The bar's dialog holds the view pills and
  the scope pills; on Summary the scope section also carries the line saying
  what the scope counts. Entries adds month arrows beside the bar; the
  Summary tab (Summary or Month) adds its month control instead ("Summary
  Tab Month Choice" below), because its range moves from the header.

The bar's label is two lines: the person and a short scope name
(`messages.views.scopeShortLabel`: `Direct`, `Shared`, `Direct + Shared`),
then `View and scope`. Beside the Summary tab's month control the second
line is dropped, so the bar stays one 46 px row. The label is wrapping text whose scope part
(`· Direct + Shared`) is `nowrap`, so a long name wraps before the scope
instead of either being cut short; there is no ellipsis. The trigger is at
least 46 px tall, and on Month and Summary the floating money toggle sits
above it. The household view has one Combined scope: the bar shows only
`Household` and `View`, the dialog has no scope section, and desktop Summary
shows no switch.

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
- Phone island (`SummaryMonthIslandControl` in `summary-month-picker.jsx`,
  entry chunk): beside the View and scope trigger, `All months ▾` with the
  hint `Month`; with a month picked `‹ Sep 2026 ›`, where the arrows step
  through the range's months (disabled at its ends) and the middle opens the
  sheet. Same height, border, radius and shadow as the trigger
  (`.mobile-month-choice`).
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
  header, `All months` then the range's months newest first, in the pill
  style the Spending Mix month chips used (`.summary-focus-button`), with
  `aria-pressed`. Hidden on a phone.
- Spending Mix has no month chips of its own; the month choice drives it.
  All months shows the whole range (`categoryShareChart`). A picked month
  shows that month in the Month content, full width after the money
  insights and before the plan tables (the read-out before the editing
  work, as on All months it sits beside Intent vs Outcome), from the Month
  page DTO's `categoryShareChart` (no request). One component for both
  (`SpendingMixSection`, `spending-mix-section.jsx`): same card, donut and
  category cards; no spending shows the Entries empty state instead of an
  empty donut. Its only Month rule (spacing) is in `month-route.css`.
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
Remaining budget drops its "To allocate" / "Overplanned" detail (a card sets
`detailFollowsAmount`), the Summary lead and the Month plan sheet drop
"under / over plan", "% of plan", "left", "over" and "to come" and keep only
their bar's empty track, wallet pills and Settings drop the statement health
line ("off by"), the Splits strip labels its balance "Net" instead of "You
owe" / "You are owed" / "Settled up", and Splits activity drops "you lent" /
"you borrowed" / "you paid" / "you received". `tests/e2e/money-tones.spec.js`
reads the hidden pages for any such word.

## Pastel Palette

Colour in the app is pastel. The palette lives once, in `:root` of
`public/styles.css`; a state or category surface uses a fill token, and text
on it uses the same hue's `-ink` token, which meets WCAG AA on that fill.
Do not add saturated fills or new hex colours outside these tokens.

| Token | Fill | Ink | Ink on the panel | Ink on a soft tint | Ink on the full fill | Ink on the Splits wash |
| --- | --- | --- | --- | --- | --- | --- |
| mint | `--pastel-mint` #e4f2ea | `--pastel-mint-ink` #17684a | 6.67 | 6.16 | 5.84 | 5.43 |
| rose | `--pastel-rose` #f9e5e1 | `--pastel-rose-ink` #a3352a | 6.71 | 6.02 | 5.59 | 5.21 |
| sky | `--pastel-sky` #e3ecf6 | `--pastel-sky-ink` #2f5b86 | 7.02 | 6.36 | 5.94 | 5.53 |
| lavender | `--pastel-lavender` #ece8f5 | `--pastel-lavender-ink` #5c4d8c | 7.18 | 6.47 | 6.02 | 5.61 |
| butter | `--pastel-butter` #f8efd3 | `--pastel-butter-ink` #735512 | 6.85 | 6.34 | 6.02 | 5.60 |
| neutral | `--pastel-neutral` #f6f4ef | `--text` #26231f | 15.48 | 14.72 | 14.23 | 13.22 |

Contrast is against the white panel, the soft tint (the fill at 60% over the
panel), the full fill, and the Splits wash (the fill at 94% over the darker
end of the orange panel). `--positive` and `--negative` alias the mint and
rose inks, and each hue has a hairline (`--pastel-mint-line` and so on, the
ink at 22%) for borders. Status surfaces use them at the same three
strengths as money: text (delete actions, form errors, match confidence),
a soft fill (status pills, chips, Imports inbox and intake states), and the
full fill for banners that need attention (the environment banners: demo
sky, local mint; the tab badge; the danger button; statement results). `--muted` keeps 4.54 on the neutral fill; on any
other tint, text uses that tint's ink instead.

## Person Colour

Each person keeps one colour across the app, from the category palette:
`src/client/person-colour.js` (`getPersonColour`) gives Tim green, Joyce
coral, Splits-linked rows terracotta and any other owner (Shared) a stable
palette pick. Entries draws it as the row's 5px edge; the Import inbox
owner groups use `getPersonColourVars`: a chip (16% tint, `--person-ink`),
the solid account edge, a 10% header band and a 6% wash on alternate
months. Each statement card on the import review starts its name with the
account owner's chip (`.statement-card-owner`, the same chip). `--person-ink`
is the colour 55% into `--text`, 5.4:1 or more on the chip and band. Any
later per-person cue reuses these, never new hues.

## Money Colour

Money is coloured only by its direction or outcome, and only through the
money tones. `src/domain/money-tone.ts` decides a tone (projections carry it
as a DTO field where the server builds the figure: metric cards, split group
balances, split activity); `src/client/money-tone-class.js` renders it as
`.money-<tone>` at one strength per element.

| Tone | Means | Colour |
| --- | --- | --- |
| `in` | money in or a good outcome: income, a refund, received, owed to you, on or under plan, savings made, a matched statement | mint ink |
| `short` | a deficit, over plan, income still to come, a debt you owe, a statement that is off | rose ink |
| `plan` | an intention: planned income, planned spend, a savings target | sky ink |
| `caution` | something needs a check (a statement not yet checked) | butter ink |
| `out` | money out in a list: an expense row, a negative day, an Imports expense row, the Entries spend total, a settle-up you paid (with its minus sign) | rose ink, text only |
| `neutral` | transfers, zero, counts | plain ink |

Exactly on plan, and a fully allocated budget, count as `in`; zero
realized savings and no income yet are `neutral`.

Three strengths, never two on one element:

- **Text only** (lists and tables, the default): only the amount's text
  takes the ink; no fill, no border. Entries row amounts and daily net, Month
  Actual and Variance columns and totals, Intent vs Outcome values and its
  month total, Splits activity (`you lent`, `you borrowed`, `you received`,
  `you paid`),
  Settings statement health, Imports preview amounts and statement rows, and
  the planned cards on Month, and the planned spend in the Summary lead.
- **Soft tint** (compact summary objects): the fill at 60% with a hairline
  in the same hue, and every line in the ink. Summary's Income and Saved
  pills, Month outcome cards (actual income, actual spend over plan,
  realized savings, remaining budget, spend gap), Entries strip items with a direction (income,
  difference), wallet pills by statement health, and a statement movement
  that is off. Plans stay text-only so a row of cards does not read as a
  traffic light. Balances on the Splits orange (the summary strip and group
  pills) stay plain text with no chip: the owner found tinted chips too much
  there.
- **Emphasis** (rare, one per area): the full fill for a banner that needs
  attention: the import statement result, the overlap mismatch hint, and a
  statement card's bank charges and notices (`.statement-bank-charges`, full
  rose with its ink).

Intent vs Outcome bars take the tone's ink as their fill: the plan a light
sky, actual spend the muted grey, or rose when over plan. The lead card's
actual-vs-plan bar (Summary, the Month plan sheet) follows the same rule.

`tests/money-tone.test.mjs` pins the rule; `tests/e2e/money-tones.spec.js`
reads the computed colours on Summary, Month, Entries and Splits, including
hidden money; `tests/money-colour-guard.test.mjs` fails when a stylesheet
colours with the old raw greens and reds, or a component picks a colour
class by hand.

### Category palette

`src/domain/category-palette.ts` holds the 31 category colours (plus the
fallback), one per former colour and in the same hue family (within 12
degrees), each at least 3:1 on white so a donut segment or icon reads on the
panel. The closest pair is 6.2 apart in Lab; the former palette had two
oranges 3.0 apart. An icon's glyph mixes the colour 70% with the text ink on
its tint (16-34% of the colour); a donut percentage mixes it 62% for 4.5:1.
Stored colours are never rewritten: the category DTO
(`app-repository-categories.ts`) shows a former colour as its calm one and
darkens any other colour toward the text ink only as far as 3:1 needs, so
the picker, the donut and every icon agree. Split group chips and entry
owner cues draw on the same colours.

| Former | Colour | On white | Glyph on its tint | Label on white |
| --- | --- | --- | --- | --- |
| #1F7A63 | #27725F | 5.74 | 4.79 | 8.60 |
| #C97B47 | #BF7D51 | 3.35 | 3.61 | 5.91 |
| #7C8791 | #7C8791 | 3.66 | 3.82 | 6.27 |
| #8FAE4B | #7F9B43 | 3.15 | 3.51 | 5.64 |
| #22B573 | #33A471 | 3.14 | 3.48 | 5.69 |
| #D5A24B | #B88A3D | 3.12 | 3.48 | 5.60 |
| #B8875D | #B9875C | 3.14 | 3.50 | 5.63 |
| #E96A7A | #D77481 | 3.13 | 3.47 | 5.65 |
| #F08FA0 | #D46377 | 3.59 | 3.72 | 6.27 |
| #F7A21B | #C0862A | 3.14 | 3.48 | 5.65 |
| #D4B35D | #AE8E3D | 3.12 | 3.48 | 5.60 |
| #4F8FD6 | #5C90C9 | 3.34 | 3.62 | 5.91 |
| #7EBDC2 | #499DA4 | 3.16 | 3.51 | 5.69 |
| #F85A53 | #DE726D | 3.12 | 3.45 | 5.65 |
| #F062A6 | #DA6DA1 | 3.14 | 3.47 | 5.68 |
| #CC63D8 | #C36ECD | 3.26 | 3.55 | 5.83 |
| #F08B43 | #D07E43 | 3.11 | 3.46 | 5.62 |
| #567CC9 | #5D7EC2 | 4.02 | 4.00 | 6.73 |
| #A06C5B | #A96852 | 4.39 | 4.17 | 7.14 |
| #66D2CF | #3BA19E | 3.10 | 3.46 | 5.63 |
| #62C7B2 | #40A18D | 3.13 | 3.49 | 5.67 |
| #7D86F2 | #838BDF | 3.12 | 3.50 | 5.62 |
| #5EA89B | #48988A | 3.42 | 3.66 | 6.02 |
| #8B78E6 | #9385D9 | 3.18 | 3.53 | 5.69 |
| #D56BDD | #C360CA | 3.59 | 3.72 | 6.28 |
| #FFA51A | #A87321 | 4.09 | 4.01 | 6.80 |
| #D86B73 | #C9656D | 3.77 | 3.83 | 6.47 |
| #C98A5A | #A66C3F | 4.34 | 4.14 | 7.09 |
| #717379 | #717379 | 4.74 | 4.37 | 7.49 |
| #56A4C9 | #519ABD | 3.13 | 3.50 | 5.65 |
| #BDD93C | #879930 | 3.17 | 3.52 | 5.67 |
| #6A7A73 | #6A7A73 | 4.52 | 4.26 | 7.25 |

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

`ui-states.jsx` is the one presentation for "nothing here", "this failed"
and "this screen failed"; callers pass copy from `copy/en-SG.js` and own
every retry handler.

- `EmptyState` renders an empty section as one muted line, or as a titled
  block with actions (the Entries wallet-view mismatch). Empty sections
  say what is missing instead of showing a bare dash.
- `InlineError` renders a failure inside a section as `role="alert"`, with
  an optional retry button; forms, dialogs and the mobile sheet use it.
- `ErrorPanel` is the screen-level failure. `ShellErrorScreen` (shell,
  reference data and first page load) and the screen error boundary both
  render it, so each is an alert with the same layout and a primary
  `dialog-primary` retry. The detail line is plain language
  (`common.loadFailedDetail`); the technical reason sits in the smaller
  issue line below it.

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

## Mobile Sheet

`entry-mobile-sheet.jsx` (`EntryMobileSheet`) is the bottom sheet for the
Month plan sheets, the Entries add and edit sheets, the import progress
sheet and the Claude "I've topped up" sheet. It behaves like the modal
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
  Splits group pills and focus visibility use it.
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
  still one line), and the summary cards' gap and padding, so the tables
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

