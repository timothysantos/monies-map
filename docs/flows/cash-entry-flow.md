# Cash entry flow

How a payment is logged with an amount alone: the quick pad in the app
(**Just paid**: cash or one of the person's cards, and the Apple Pay taps
that missed their amount) and the "Log cash" Shortcut; then, later, a few
words about it. Domain rules: DOMAIN.md "Cash Entry", "Quick Entry".
Layout: design.md "Cash Pad".

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
the chip saved the wrong amount. Fixed 17 Nov 2026: the reader no longer
offers the rupiah as a chip. With a saved rate the card shows about $2.80,
says "Paid IDR 35,000 cash. Saved as about SGD 2.80 at 1 SGD = 12,500 IDR
(date)." in the conversation and the note, and Save keeps the rupiah beside
it; with no rate the card asks "That was IDR 35,000. What did it cost in
your card's currency?" and has no amount to save. The chip row and the
question wording of other amounts show a no-cents currency in whole units
("IDR 35,000", not "IDR 35,000.00").

After (the cash pad; since "Amount first" the + opens it at once):

1. Tap + (bottom right). The pad is open.
2. Tap 3, 5, 000 (the pad is already in rupiah, on the cash wallet, today,
   for Tim).
3. Tap Save.

5 taps (6 before Amount first, with a Just paid tap), no keyboard, no
decision; everything under the thumb. With an Again chip ("Coffee 35,000")
it is 3 taps: +, the chip, Save.
From the Lock Screen with Log cash: run it, type 35000, Done.

## Amount now, words later (17 Nov 2026)

Tap counts on a phone, demo data, a Bali trip in IDR on today, after
"Amount first" (below; before it each line had one more tap, Just paid):

| Payment | Taps | Keyboard |
| --- | --- | --- |
| Cash, 35,000 rupiah | 5: +, 3, 5, 000, Save (was 6) | none |
| Card, first time today | 8: +, the line, UOB One, Done, 8, 5, 000, Save (was 9) | none |
| Card, again the same day (Paid with is kept) | 5, as cash | none |
| Apple Pay missed the amount | 3 + the amount: +, "Periplus Bali, 14:02", the amount, Save (7 for 450,000) | none |
| A card payment while a tap on that card waits | + 1: "Yes, that one" (finishes the tap) or "No, a new payment" | none |
| Words later, right after Save | 2 + the words: the box, Add, Save | a few words, or the keyboard's microphone |
| Words later, from Ask's reminder | 4 + the words: Add words, the payment, Add, Save | as above |

## Amount first (17 Nov 2026)

Owner feedback: on a new entry "Just paid" was a small chip among others
and did not read as the next step; the eye and thumb went to the big
$0.00 at the top of the card, out of thumb reach. Now, on a phone, the new
entry is three steps: amount, Save, a few words.

- The + on Entries opens the new entry with **Just paid** already open.
  Only that plain +: a link to a new entry, Ask's own Add entry, the Splits
  receipt button, a receipt photo, an Apple Pay entry, an edit and the
  desktop open the entry as before. A reload or coming back to the entry
  does not open the pad again (Ask marks that history entry once shown).
- The pad's one quiet way out, **Type it instead** beside Close, shows the
  new entry with the message box focused (the keyboard comes up), for a
  sentence, a receipt or pasted text. Close shows the same entry.
- While the new entry is empty: **Just paid** is the first chip, filled,
  ahead of "‹ Entries"; the card sits just above the chips with its detail
  rows folded away; its $0.00 opens the pad. Once it has words or an
  amount, everything is as before (the amount typed in place, the rows,
  the card at the top).
- Each part has its switch in `src/domain/quick-pad-config.ts`
  (`NEW_ENTRY_PAD`: `openPadOnNewEntry`, `amountOpensPad`, `justPaidFirst`,
  `emptyEntryLow`), all on; off brings back the earlier screen.
- Desktop: the + opens the Ask panel with no pad, the $0.00 is typed in
  place, and Just paid leads the chips (`justPaidFirst`).
- Tests: `tests/new-entry-pad.test.mjs` (every way in, every switch),
  `tests/ask-chips.test.mjs` (the chip order), `tests/e2e/amount-first.spec.js`
  (phone 390 and desktop: the 5-tap cash payment, the way out and a typed
  sentence saved, $0.00 on an empty and a filled entry, other ways in, the
  switches off, nothing over the pad, card or Save with the keyboard open).
  Browser tests that tap + and then type use `tapAddEntry` (helpers.js),
  which takes the way out as a person does.

## Paid with

- The quiet line names how it was paid: the cash wallet, or the card's
  name. Tap it: **Paid with** shows Cash, then the person's own cards (most
  recently used on this trip, or in the last 7 days, first; names only).
  The choice is kept on this phone for the rest of the day
  (`monies.padWay.v1`); the next day it starts on Cash again.
- A card payment sends `way: "card"` and `accountId`. In the trip's currency
  it is saved like an Apple Pay foreign amount: the card's currency at the
  day's rate, the rupiah kept, "Card payment" as its name, so the card's
  statement row later replaces it (the estimate pairing rule, no change).
- "Apple Pay missed the amount": the person's waiting taps, newest first,
  as "Periplus Bali, 14:02". One tap takes its shop and card (the line names
  the card; "Periplus Bali · UOB One" under the amount); the pad's amount and
  Save send `tapId`, and the route finishes the tap with its own complete
  command (`completed_by` `app`). A lost answer sent again, or a second Save,
  answers with the same entry.
- The tap offer: a card payment while a tap on that card waits (the last 60
  minutes, `TAP_OFFER_WINDOW_MINUTES`) is refused with 409 `offerTap` and
  nothing saved; the pad asks "Is this the Periplus Bali payment from
  14:02?". A payment that waited offline and meets a tap later stays in
  Waiting to send with that question as its reason; the person removes it
  and types it again.

## Words later

- After Save the chips stay (categories, More categories, Shared) and one
  words box replaces Add a note: "What was it?", for example "dinner ramen
  split with joyce", typed or said with the keyboard's microphone.
- Add sends it to `POST /api/ask/turn` with `focus: { kind: "saved_entry",
  entryId, words: true }`. The model (or, with AI off, the rules) reports
  only what was said; the server derives the name (the words, while the
  entry still has the pad's own name, else the note), the category (named,
  else the household's rules and the everyday words), the person and the
  split (stated, else the usual one for that kind of payment, else half
  each, said as assumed). The answer is Ask's change card in place: Save
  posts `/api/entries/update` and then `/api/splits/expenses/add-usual`;
  Undo takes both back. A question back ("Who did you share it with? The
  people are Tim and Joyce.") shows its chips; a chip reads the words again
  with that person.
- Ask's reminder "3 payments from today need a few words" gathers the
  person's quick payments of the last 3 days that still have only the
  pad's name, Other and no note. **Add words** opens the pad on that list:
  each row shows the amount, time and card (no figure while money is
  hidden) and opens the same words box. Later and Not for these follow the
  reminder rules; a new quick payment brings it back.
- Typed straight into Ask: "the 85,000 was ramen with joyce" finds the
  newest of the person's quick payments still needing words with exactly
  that amount (as paid, in its currency) and drafts the same card; none
  says "No payment of 85,000 from the last 3 days is waiting for a few
  words."

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
  accounts, cash first; the pad opens its change panel in the keys' place
  with the question right above the wallets, and the wallet picked saves
  the payment (the person already tapped Save; Undo follows), and is
  remembered on the device for that person. Done or the quiet line puts the
  question away: a wallet picked in a panel opened from the line only
  changes the line, never saves (`nextCashDetails`, `cash-pad-model.js`).
- Remember this for cash (owner-approved, 2026-11-18): after a save whose
  wallet the person picked to answer that question, and only when it is
  their own active cash account or a joint one (`canRememberCash`; a bank
  account picked for cash is never offered), the after-save screen shows
  one chip, **Remember this for cash**, between the category chips and the
  words box, so it never slows the save. A tap posts
  `/api/settings/payment-ways/save` `{ personId, cashAccountId, only:
  "cash" }` (`rememberCashWallet`, ask-api.js): the existing Payment ways
  command writes the cash wallet alone (the PayNow choice is kept, the
  default while never chosen), checks the wallet is the person's own or
  joint, and audits it in the same batch. The chip becomes "Cash will use
  {wallet} from now on. Change it in Settings, Payment ways." with an Undo
  link that posts the same with `""` (no cash wallet; the chip comes back).
  The payment's own Undo / Done / Add another stay. Not tapping changes
  nothing and it is offered again the next time Save asks; it never sets
  anything by itself. Once a cash wallet is set the defaults name it and
  Save no longer asks (tests/remember-cash.test.mjs,
  tests/e2e/remember-cash.spec.js).

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
  rupiah, chips, the words box, Undo, Again, a lost answer sent once, thumb
  reach, keyboard, no wallet.
- `tests/e2e/cash-pad-fit.spec.js`: 375x667, 390x844, 430x932 and each 110
  px shorter, 12 long-named wallets and no cash wallet: by geometry, the
  amount is whole and touches nothing; with the panel open no number key
  shows, every choice (wallet, currency, day, person, paid with) can be
  reached and tapped and Save is in reach; the wallet question saves on the
  pick, the line's panel never saves; a long rupiah amount, the waiting
  list, and Type it instead's entry and wallet list.
- `tests/quick-pad-api.test.mjs`: the person's own cards and taps only, a
  card estimate in rupiah, the card's rows replacing pad estimates (near-real
  Citi Bali rows; an ordinary row never taken), the tap offer and New
  payment, finishing a tap once, another person's tap refused, the words
  rule and the reminder.
- `tests/ask-describe-entry.test.mjs`: the words box with AI off and with
  the model, Save and Undo through the commands, a partial word, an unknown
  person and the payer asked back, a person chip, "the 85,000 was ...".
- `tests/e2e/quick-pad.spec.js`: phone 390 and desktop: a card payment and
  words later with Splits, a waiting tap finished once and offered before a
  duplicate (and nothing over the pad), the reminder's list, money hidden. Browser tests add `x-cash-test-rate` because the test Worker
  cannot fetch rates.
