# Reminders Flow

Reminders in Ask (built 2026-10-28 on the owner's instruction to complete it; DOMAIN.md "Reminder",
[`docs/proposals/reminders/README.md`](../proposals/reminders/README.md) for the
approved proposal and its mockups,
[`docs/audits/reminders.md`](../audits/reminders.md) for the rules as built,
the false-positive analysis, the budgets and the decisions on the proposal's
open questions). Up to a few short cards at the top of the Ask conversation:
a card bill due soon, a statement that should be out but is not imported, a
Splits settle-up that has waited, a subscription whose price changed and a
month ready to close. Fixed rules decide when each shows. No AI, nothing
pushed, nothing stored on the server.

## Route Flow

- There is no route of its own and no page: the cards are a section at the
  top of the Ask thread (`reminders-block.jsx`, in the Ask route chunk,
  `ask-panel.jsx`), after the Claude credit notice and before "Since you last
  looked". Chat mode only: add mode (Entries +, Splits receipt) and the Apple
  Pay Shortcut's saved card show none and never ask for them. Never a banner
  over a page, a modal or a browser alert.
- The same section renders in the phone's Ask page, in the desktop docked panel
  (3 cards) and in the popup (2 cards): `placement` decides (`cardLimitFor`).
- A card's main action opens the page that settles it through Ask's own
  `goTo` (so the view, month and scope carry over, and in the dock the page
  opens beside the panel): card bill `/entries` filtered to that card
  (`entry_wallet`), statement `/imports`, Splits `/splits`, price change
  `/entries` searched for the payee (`entry_search`), month checklist `/month`
  for that month, and its rows `/imports`, `/entries` in Other for the month
  (`entry_category=Other`), `/splits` and `/month`.
- The cue is the existing 7 px accent dot (`.tab-dot`): on the phone's Ask
  tab (`ShellRouteTabs` `remindersCount`) and on the desktop Ask field's
  sparkle while the panel is closed (`AskDockField` `remindersCount`,
  `.ask-dock-field-dot`). It is the conversation-in-progress dot: one dot for
  both, and the link's label says why ("Ask, 3 reminders", "Ask,
  conversation in progress and 3 reminders").
- Not in v1: push, email, calendar, Web Notification, home-screen badges,
  a Settings page for reminders.

## State Flow

| State | Owner | Notes |
| --- | --- | --- |
| the answer for a view | the query cache, `queryKeys.reminders(viewId)`, read by `use-reminders.js` | one store; the dot and the "Since you last looked" card read the same entry; no `useState` copy |
| Later, hidden for good, seen, a checklist shown open or finished | `localStorage` `monies.reminders.v1` through `reminders-device-state.js` (read, subscribe) and `reminders-actions.js` (the writes) | per device, versioned, pruned after 90 days, every access in `try/catch`; with storage blocked every reminder shows and a choice holds for the page's life |
| the folded line after a choice, "N more" open, the finished checklists to show | component state in `reminders-block.jsx` | for this visit only |
| money hidden | `useMoneyPrivacy` | the model masks every amount (`••••`), drops tones and the words that say who owes whom |

- Reading: Ask reads the answer once it is usable (`routeUsable`) through the
  shell's required read (`fetchRequiredQuery`: `fetchQueryWithLease`), joining
  a kept answer for 60 seconds, and again when a save that can change a
  reminder invalidates a page (entries, splits, imports, month, summary,
  shell) once it settles. A failure leaves no answer and nothing on screen.
- Choosing: Later (Tomorrow, In 3 days, Next week = the coming Monday, each
  with its date, then the kind's "not for this one") folds the card into one
  muted line, "Back on Thu 15 Oct" with Undo, for the rest of the visit; the
  card is gone on the next visit until its day. A price change has Got it in
  place of Later. On a phone Later is a bottom sheet (`SheetDialog`), on a wide
  screen a small menu under the button (Radix popover).
- Seen: opening Ask with reminders on show marks every active one seen (the
  "N more" line says the rest exist), so the dot comes back only for a new
  reminder or one returning from Later. Later clears the reminder's seen
  mark, so its day brings the dot back.
- Month checklist: a card shown with something to do is remembered as open;
  when it is later finished the next visit shows one mint line, "September is
  all in", once, and then nothing. A finished checklist this device never
  showed open shows nothing.

## Data Flow

- `GET /api/reminders[?view=<person id|household>]` (`src/index.ts`,
  `src/domain/pages/reminders.ts` `buildRemindersDto`): read-only, GET only
  (405 otherwise), behind the same access gate as every `/api` route, `Server-
  Timing` as every page API, at most 20 reminders, no AI, no writes, not part of
  any page payload.
- Loader: people, accounts and statement checkpoints (two small reads), card
  payments (transfers into cards since the card bill window), subscription
  charges (three categories, about 13 months, 26 for yearly), Splits (the
  Splits page's own loaders and `buildSplitsPage`), and per month a month
  checklist can show for (every statement account has its statement), that
  month's entries and note. About 13 to 16 statements on the 10k household
  (`docs/audits/reminders.md`).
- Rules: `src/domain/reminders/` is pure. `account-reminders.ts` (card bill,
  statement), `splits-reminders.ts`, `price-change-reminders.ts`,
  `month-close-reminder.ts`, `build-reminders.ts` (order, the Splits
  replacement, the cap) over `facts.ts`, with every number in
  `thresholds.ts`. Reuses `card-bill-projection.ts`, `payeeKey` from
  `account-routines.ts` and the Splits projection; nothing is re-derived.
- Words: `src/client/copy/reminders-copy.js`, fixed templates over the facts,
  linted for jargon (`tests/reminders-copy-lint.test.mjs`).
- Order: overdue bills, bills due soonest, month checklists (oldest month
  first), statements (oldest first), Splits (longest waiting first), price
  changes; ties, more money first, then key.
- Views: a person view reads that person's accounts plus joint ones and
  Splits from that person's side ("with Ethan"); the household view reads
  every account and Splits "between Ethan and Serene".

## Ownership Notes

- Rules and thresholds belong to `src/domain/reminders/`; what the page shows
  of them belongs to `reminders-model.js` (pure) and `reminders-block.jsx`;
  what the device remembers belongs to `reminders-device-state.js` (the one
  first-screen file with the Ask tab's dot, `reminders-cue.js`).
- The Ledger check-up owns "what looks wrong"; reminders never duplicate a
  finding. The Summary check-in owns its headline; a reminder card that says a
  card bill covers that bill's signal (`coveredSignalKeys`).
- Reminders never write to the household's data: no command, no table, no
  audit event.

## Visible User Contract

- Cards: an icon bubble, a title, one plain sentence, the amount when there is
  one (plain ink; a late bill and "you owe" are rose, "owed to you" mint;
  text only), the main action and Later. At most 2 cards on a phone, 3 in the
  docked panel, then one 44 px text button, "N more reminders", that opens the
  rest in place.
- Hidden money: `••••`, no tone, "Agreed on 6 Sep to even out your shared
  costs" (never who pays whom), "Spotify's price changed".
- Nothing shows when there is nothing, when every reminder is put away, in add
  mode, or when the read fails; nothing moves on screen when the answer is
  empty.
- Later and Got it are for this device only, and say so.

## Persisted / Query Contract

- Server: none written. One read-only route (above); payload budget key
  `reminders` in `tests/e2e/api-payload-budget.json`.
- Browser: `localStorage` `monies.reminders.v1` (shape in
  `reminders-device-state.js`); the query cache key `["reminders", viewId]`.
- No change to `schema.sql`.

## Audit Status

Built and shipped 2026-10-28. Rule tests (`tests/reminders-rules.test.mjs`),
API and Worker tests (`tests/reminders-api.test.mjs`), read budget
(`tests/reminders-budget.test.mjs`), client model and device memory
(`tests/reminders-client-model.test.mjs`), copy lint
(`tests/reminders-copy-lint.test.mjs`) and the browser spec
(`tests/e2e/reminders-in-ask.spec.js`, phone and 1440 docked) pass.

## Known Exceptions / Watch Areas

- The dot needs no request of its own, so it lights only once Ask has read
  the reminders in this visit (the cache), for a reminder back from Later or
  a new one a refresh found; a reminder that arose while the app was closed is
  seen when Ask is opened. The reasons and the measured alternative are in
  `docs/audits/reminders.md` ("The dot").
- A payment from a bank not imported yet is invisible to the card bill rule
  ("Paid from another account").
- The payments a card bill sees are transfers into the card; a bill paid by
  an entry not marked as a transfer still shows until the due date passes.
