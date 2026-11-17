# Cash entry flow

How a cash payment is logged with an amount alone: the cash pad in the app
and the "Log cash" Shortcut. Domain rules: DOMAIN.md "Cash Entry". Layout:
design.md "Cash Pad".

## Who it is for

A parent abroad paying cash: notes in one hand, a baby in the other, poor
signal, ten seconds of attention. One thumb, big targets, no decisions
before Save, nothing ever lost.

## Measured: before and after (demo data, phone 390, 17 Nov 2026)

"Paid 35,000 rupiah cash for coffee on a trip", a cash wallet set, a Bali
trip in IDR on today, AI off (the rules reader).

Before (Entries +, Ask's new entry card):

1. Tap + (bottom right). Ask's New entry page loads.
2. Tap "Type or say it…" and type `coffee 35000 IDR cash` (21 keys, two
   keyboard switches for the figures).
3. Tap send. The rules fill "coffee", Food & Drinks and the cash wallet, and
   ask "How much was it?" with one chip, "IDR 35,000.00".
4. That chip fills the card with −$35,000.00 (Singapore dollars). To save
   the right amount the person must scroll up, tap the amount at the top of
   the card (out of thumb reach), work out the rupiah in dollars in their
   head (about 2.80) and type it (4 keys).
5. Tap Save.

About 5 taps, 25 keystrokes, a currency sum done in the head, the amount
control at the top of the screen, and the rupiah amount is not kept. Taking
the chip saves the wrong amount (flagged separately).

After (the cash pad):

1. Tap + (bottom right).
2. Tap **Cash** (the first chip, at the bottom).
3. Tap 3, 5, 000 (the pad is already in rupiah, on the cash wallet, today,
   for Tim).
4. Tap Save.

6 taps, no keyboard, no decision; everything under the thumb. With an
Again chip ("Coffee 35,000") it is 4 taps: +, Cash, the chip, Save.
From the Lock Screen with Log cash: run it, type 35000, Done.

## The pad

- Opens with `GET /api/cash-entries/defaults?person=<id>`: the wallet, the
  currency and why (`trip`, `recent`, `wallet`), the trip on today, the
  Again chips and the person's usual cash categories. The last answer per
  person is kept on the device (no amounts), so it opens with no signal.
- Save posts `POST /api/cash-entries/create` with a request id made when the
  pad was cleared: `{ requestId, personId, amountMinor, currency, date,
  accountId?, description?, categoryName?, note? }` (the last three from an
  Again chip). The answer is `{ ok, entry }` with what was saved in the
  wallet's currency and what was paid.
- After Save, every chip is an existing command: a category
  (`/api/entries/update-category`), the shared category list (More
  categories), Shared (`/api/splits/suggestion` for the habitual group and
  share, then `/api/splits/expenses/from-entry`; with no habit, the
  command's default), a note (`/api/entries/update-note`, keeping the
  rupiah line), Undo (`/api/entries/delete`, the split first). Each calls
  `onEntryMutation`, so Entries, Month and Summary refresh through their
  owners.
- No cash wallet: the server answers 409 `needsWallet` with the person's
  accounts, cash first; the pad opens its change panel on Wallet, and the
  choice is remembered on the device for that person.

## Waiting to send

`src/client/cash-queue.js`. A Save is "waiting" when the request cannot be
made or answered: offline, a timeout (12 s), a 5xx, 429 or 408, or 503
`retry` (no exchange rate yet). Then:

- it is kept in device storage (`monies.cashWaiting.v1`) with its request id,
  body and label, and shown in the pad's Waiting to send panel with Remove;
- it is sent again, oldest first, one round at a time, when the pad opens,
  when the browser says it is back online, on Send now, and when the app is
  opened again (App.jsx loads Ask's chunk, which holds the queue, only when that key exists, once the
  screen is usable);
- a retry carries the same request id, so the server returns the entry it
  already saved when the first answer was lost: never a second entry;
- a 4xx keeps it with its reason ("Not sent: …") until the person removes it.

Scope: this works while the app is loaded or the pad is open. The app shell
itself does not load offline (there is no service worker, by decision for
this slice), so a phone with no signal cannot open the app from cold; a
payment typed while it was loaded is never lost.

A queued payment is local until the server confirms it: it is never in an
Entries list or a total, and it carries the day it was typed (`date`), so
one sent the next morning keeps its day. A foreign one is converted at the
rate on the day it is sent.

## Log cash

`POST /api/shortcuts/cash/create?shortcut_token=<key>` on the Shortcut
Worker (a public path, POST only, outside Access). The key names the person
(per-person Shortcut connections). Body `{ amount?, text?, requestId?,
clientVersion? }`, read through `limited-body` (8 KiB): the number pad's
amount or words like "35000 coffee", "coffee 35,000", "Rp35.000 parking";
a currency word ("rupiah", "won", "yen", a code) sets the currency,
otherwise the pad's default does. Same command, same defaults. Answers:

- 200 `{ ok, entryId, created, notification: "Saved: Coffee, Rp 35,000 cash" }`
- 400 `needsAmount` (no figure), 400 a refused field, 401 a missing or wrong
  key, 409 no cash wallet ("No cash wallet for Tim. Choose one in Monies
  Map, Settings, Payment ways. Nothing was saved."), 503 no exchange rate.

Settings, Apple Pay shortcut, has **Install Log cash shortcut** under the
Apple Pay install button: it saves the person's key as that button does and
copies the same connection on the cash route.

## Tests

- `tests/cash-entry.test.mjs`: currency choice, zero-decimal list and keys,
  the Shortcut's words, Again chips, wording.
- `tests/cash-entry-api.test.mjs`: defaults, amount-only save in the trip's
  currency, retries, person scope, refusals, no wallet, no rate, body limit,
  Log cash (keys, persons, notification), the Shortcut Worker's paths, the
  test-only rate header.
- `tests/atomic-writes-cash-entries.test.mjs`: a failing statement writes
  nothing; the same request later saves once.
- `tests/cash-pad-client.test.mjs`: sends, waits, refusals, the queue, the
  view model (money hidden).
- `tests/e2e/cash-pad.spec.js`: phone 390 and desktop: amount-only save in
  rupiah, chips, Undo, Again, a lost answer sent once, thumb reach, keyboard,
  no wallet. Browser tests add `x-cash-test-rate` because the test Worker
  cannot fetch rates.
