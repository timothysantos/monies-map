# Ask Flow

This doc describes the Ask page flow in three parts:

- route flow
- state flow
- data flow

The Ask page is one full page (not a sheet) where a person adds an entry by
hand, from a typed or spoken sentence or from a receipt photo, finds entries
by asking ("grab rides in september"), and sees what changed since they last
looked. Its visual design is in `design.md` ("Ask page").

## Route Flow

Route entry:

- `/ask`: chat mode, from the Ask tab.
- `/ask?mode=add&from=entries`: add mode, from the Entries + button.
- `/ask?mode=expense&from=splits&split_group=<id>`: add mode with the Splits
  switch on for that group, from the Splits receipt button.
- `/ask?mode=add&from=ask` and `/ask?mode=expense&from=ask`: add mode from the
  chat mode's Add entry and Add expense chips.
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

On a phone the tab bar reads Summary, Entries, Splits, Ask, ··· (one grid
column per primary tab; Month is not a tab, it is the Summary tab's month
choice). On a wide screen (761 px and up) the Ask tab is hidden: the Ask
field at the bottom right of every page opens the same conversation beside
the page (see "Desktop" below). `/ask` itself still renders in the main
area there (the Entries + and Splits receipt buttons, the Shortcut's link,
the From Ask chip's way back), and shows no field or panel.

Chips leave Ask for: Entries (`Back to Entries`, `‹ Entries`, and an
answer's `Open in Entries`, see "Search and filter"), the entry's
editor (`Open this entry`: `/entries?editing_entry=<id>` in the entry's month),
Splits (`Back to Splits`, `‹ Splits`, `Open on Splits`:
`/splits?editing_split_expense=<id>`), and the old forms (`Edit in form`: the
Entries composer through `?action=add-expense` with the card's values, or the
Splits expense dialog through `?split_action=add-expense`).

## Desktop

On a wide screen Ask has no tab. A one-line field, "Ask, or drop a
receipt…", is fixed at the bottom right of every page but `/ask`, beside
the Entries + or the Splits receipt button where there is one
(`ask-dock.jsx`, in the first screen). Focusing, clicking or typing in it,
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

## State Flow

Ask state is split between:

- route state: the way in (`readAskIntent`) and the view, month and scope;
- the conversation, owned by the Ask conversation store
  (`ask-conversation-store.js`, see "Continuity"): the person's messages,
  receipt thumbnails (memory only), the page's notes, answers, the one
  entry card and where it sits in the thread, the words typed but not sent,
  and an open follow-up (a filter question or a view change);
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
  question it cannot read gets the "not answered yet" note. While a card
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
  `composeCheckInHeadline` in `financial-insight.jsx`). Never fetched and no
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
  worker (`ocr-worker.js`) reads the photo on the device and
  `parseReceiptText` picks out the shop, total, date and card ending.

Both fail soft: any error leaves the card manual with a calm note.

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

After a write Ask publishes the entry (and split) mutation through the
shell's `broadcastEntryMutation` / `broadcastSplitMutation`, and refreshes
that month's Entries page DTO through `runBackgroundRefresh`: a failure keeps
the saved card and shows the retryable refresh notice.

## Ownership Notes

Ask owns:

- the conversation and the entry card (through the Ask conversation store);
- the filter reader and the answer card;
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
  composer's create path).

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
- After a save the card shows Saved and the chips offer the way back first.
- Spoken words land in the message box and are sent only when the person
  taps Send; the mic is hidden when neither voice path is available.
- The + inside the field opens an in-app menu (Take a photo, Choose a
  photo, Paste); each glyph keeps a 44 × 44 px hit area and every
  placeholder fits one line at 375 px.
- An answer's total and count equal the Entries page `Open in Entries`
  opens; a request that could mean two things asks with chips; a view or
  scope change waits for its chip.
- Leaving Ask and coming back, or reloading the tab, keeps the
  conversation; the Ask tab shows a dot meanwhile.
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

- No new write route and no new table. A saved entry is an ordinary manual
  entry, with `external_reference` = `ask:<client id>` (the existing unique
  index per household makes a repeat create return the same entry). The one
  new route, `/api/ai-assist/transcribe`, only writes the shared AI allowance
  counter. The Claude credit notice uses the existing provider-status routes;
  I've topped up writes only that aggregate row.
- A transfer card posts one row: the From wallet's side (or the To wallet's
  when turned round); the other wallet is shown but not posted, for the
  later transfer match, as the entry draft defines.
- The conversation is kept only in this browser tab's sessionStorage (text,
  the card's fields, filters; never photos, audio or status lines) and is
  gone when the tab closes. Nothing about it, the sentences, photos, voice
  clips or spoken words is sent to be stored or logged.

## Audit Status

Current status: aligned with tests (`tests/ask-dock-layout.test.mjs`,
`tests/ask-dock-state.test.mjs`, `tests/e2e/ask-dock.spec.js` (desktop:
1,024, 1,280 and 1,440 px), the docked header case in
`tests/e2e/header-tab-fit.spec.js`, `tests/ask-card-model.test.mjs`,
`tests/ask-api.test.mjs`, `tests/ask-chips.test.mjs`,
`tests/ask-entry-dedupe.test.mjs`,
`tests/ask-voice.test.mjs`, `tests/transcribe-route.test.mjs`,
`tests/shortcut-gateway.test.mjs`, `tests/ask-filter-reader.test.mjs`,
`tests/ask-filter-answer.test.mjs`, `tests/ask-conversation-store.test.mjs`,
`tests/claude-credit-notice.test.mjs`,
`tests/e2e/ask-page.spec.js`, `tests/e2e/ask-voice.spec.js`,
`tests/e2e/ask-composer.spec.js`, `tests/e2e/ask-search.spec.js`,
`tests/e2e/claude-credit-notice.spec.js`, the last two also in WebKit on an
iPhone 13 profile) and runtime behaviour on a phone.

## Known Exceptions / Watch Areas

- On a wide screen the Entries + and Splits receipt buttons still open
  `/ask` in the main area, where the panel hides (one Ask on screen at a
  time); it comes back on the next page. Whether they should open the
  panel's new entry instead is an open decision.
- Only the header and Month follow the page's width when the panel narrows
  it; other pages keep their window-width rules (Splits' toolbar is tight
  at 1,280 px with the panel docked, as it is in a 960 px window).

- The Claude credit figures are the server's estimate from token counts
  since the last "I've topped up"; the Claude Console balance is the real
  one. Topping up does not lift a monthly spending limit (`capped`), which
  stays until a Claude call succeeds.

- Questions that are not a search or a filter are not answered yet (no
  answering endpoint); the page says so instead of reading them as entries.
- The filter reader has no AI gap-filler: a request it cannot read gets the
  "not answered yet" note. A later optional AI reader would be an explicit
  action with a strict schema (AGENTS.md "Optional AI Assistance").
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
