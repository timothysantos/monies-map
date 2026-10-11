# Ask Flow

This doc describes the Ask page flow in three parts:

- route flow
- state flow
- data flow

The Ask page is one full page (not a sheet) where a person adds an entry by
hand, from a typed sentence or from a receipt photo, and sees what changed
since they last looked. Its visual design is in `design.md` ("Ask page").

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
`saved_entry` or `split_group` changing) starts a new conversation.

On a phone the tab bar reads Summary, Entries, Splits, Ask, ··· (one grid
column per primary tab; Month is not a tab, it is the Summary tab's month
choice). On a wide screen the Ask tab is hidden for now (a
docked panel comes later) and `/ask` renders in the main area.

Chips leave Ask for: Entries (`Back to Entries`, `‹ Entries`), the entry's
editor (`Open this entry`: `/entries?editing_entry=<id>` in the entry's month),
Splits (`Back to Splits`, `‹ Splits`, `Open on Splits`:
`/splits?editing_split_expense=<id>`), and the old forms (`Edit in form`: the
Entries composer through `?action=add-expense` with the card's values, or the
Splits expense dialog through `?split_action=add-expense`).

## State Flow

Ask state is split between:

- route state: the way in (`readAskIntent`) and the view, month and scope;
- workflow state in `AskConversation` (`ask-panel.jsx`): the conversation
  (the person's messages, receipt thumbnails, the page's notes), the one
  entry card, what is being read or saved, which picker or detail fold is
  open;
- the card itself, a pure state machine (`ask-card-model.js`): `draft` →
  `saving` → `saved`, back to `draft` on a failed save or Undo; its variant
  (expense, income, transfer); `filled` (which fields a sentence, a rule, AI
  or a receipt supplied); `questions`; the `share` switch; `saved` (entry,
  split expense and group ids).

The chip row is derived from the mode and the card (`ask-chips.js`); nothing
else in Ask holds chip state. A card being edited, read or saved reports the
route busy, so no optional warmup runs under it.

## Data Flow

Ask reads nothing of its own:

- the shell's people, wallets and categories (`appShell`, reference data);
- the Entries page DTO of a view and month (`GET /api/entries-page`), for
  the split groups the Splits switch offers and for the Shortcut's saved
  entry. Read from the query cache when Entries or Splits loaded it, else
  fetched only when the card needs it, through the shell's required read
  (`fetchRoutePageResponse`, `fetchQueryWithLease` with the Entries route's
  query key), so going back to Entries joins that data;
- the Summary page and wallet pills already cached for the view, for the
  "since you last looked" card (`ask-brief-card.jsx`, composed by
  `composeCheckInHeadline` in `financial-insight.jsx`). Never fetched and no
  AI on open; with nothing cached the card does not show.

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

Writes, all existing routes:

- Save: `POST /api/entries/create`, then `POST /api/splits/expenses/from-entry`
  when the Splits switch is on (`createEntryFromDraft` in
  `entry-create-request.js`, the Entries composer's path).
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

- the conversation and the entry card;
- the chip row and the question wording (the readers send structured
  questions; the client words them);
- the receipt photo while it is on screen (memory only, revoked on leave).

Ask does not own:

- any page DTO (Entries and Summary data are borrowed from the cache);
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
- No system alert, confirm or prompt anywhere.

## Persisted / Query Contract

- No new route and no new table. A saved entry is an ordinary manual entry.
- A transfer card posts one row: the From wallet's side (or the To wallet's
  when turned round); the other wallet is shown but not posted, for the
  later transfer match, as the entry draft defines.
- Nothing about the conversation, sentences or photos is stored.

## Audit Status

Current status: aligned with tests (`tests/ask-card-model.test.mjs`,
`tests/ask-api.test.mjs`, `tests/ask-chips.test.mjs`,
`tests/shortcut-gateway.test.mjs`, `tests/e2e/ask-page.spec.js`) and
runtime behaviour on a phone.

## Known Exceptions / Watch Areas

- Questions typed in chat mode are not answered yet (no answering endpoint);
  the page says so instead of reading them as entries.
- The two reader endpoints are stubbed in the browser tests; the unit test
  `tests/ask-api-server-contract.test.mjs` runs `ask-api.js` against the
  real routes so their shapes cannot drift. `ask-api.js` still also accepts
  the brief's flat shape.
