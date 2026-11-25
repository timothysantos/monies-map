# Waiting taps: design, evidence, privacy, cost and write boundary (November 2026)

An Apple Pay payment that reaches the app without its amount is kept as a
waiting tap (DOMAIN.md "Waiting Tap") instead of a question in the middle of
paying. Built 2026-11-17 on branch `waiting-tap`. Shortcut v8
(`apple-pay-api-2026-11-17-v8`).

## The problem

Overseas, some terminals need two taps: the first asks which currency to pay
in, the second pays. On the owner's Bali trip (4 of 4 such payments, with v6,
whose run ended at once) the Wallet automation ran the Shortcut on the first
tap with a blank amount and no entry came from the second. v7 (2026-11-10)
answered `needsAmount` and asked "How much was it?" at once: in the middle of
paying, and possibly keeping the run open when the second tap comes.

## What the research says (2026-11-17)

- Apple publishes nothing on whether a personal automation runs again while
  an earlier run of the same Shortcut is still open (waiting or asking), or
  whether a second Wallet tap fires a second run. Community reports are
  anecdotal and old. **Unknown.**
- The Wallet run starts at the tap and waits for Wallet's record; it can time
  out and fires even on a declined tap. A blank amount or merchant has several
  causes (a currency choice, a declined tap, a transit gate, a card check).
  (Coordinator's research: Apple Developer Forums threads 765516, 797233,
  773797; Apple's Shortcuts guide; Visa's acceptance device guide;
  Worldline's DCC compliance guide.)
- Runs with Wait are reported to stop after a few minutes and to pause when
  the phone locks; Ask for Input needs an unlocked phone; Wallet is in front
  at the terminal. **Anecdotal, low to medium confidence.**

## Decisions

| Rule | Value | Where |
|---|---|---|
| Which clients get a held tap | Since 2026-11-26 every release with a request id (v2 and later, `canKeepTap`), each answered in the shape it shows ("Bare taps" below); v8 reads `held` (`canHoldTap`); v1 and runs with no version keep `needsAmount` exactly | `canKeepTap`, `canHoldTap` |
| Ask inside the run | Never by default (`ASK_AFTER_SECONDS = null`); the Worker var `WAITING_TAP_ASK_AFTER_SECONDS` (0 to 120, or `off`) turns it on without a reinstall | `waiting-taps-config.ts` |
| Second run completes the tap | Backstop only: same person, same card (or the card the Wallet name or order picks before a currency is known), within 600 s, merchants agree | `findTapForSecondRun` |
| Main way to finish | The card at the top of Entries and Ask's reminder | design.md "Waiting tap card" |
| Import clears | The bank's row on the tap's card or the person's card for other currencies, within 7 days (the posting room a one-off charge gets), same shop (`matchMerchants` strong or the `AMAZE*` prefix rule); or a certified statement covering the day on every card the tap could be on without such a row | `planWaitingTapClears` |
| Put away | After 7 days unfinished (`expired`, audit line) | `WAITING_TAP_EXPIRE_DAYS` |
| Completion seam | One save path (`saveShortcutEntry`) with `completed_by`: `second_tap`, `shortcut_answer`, `app`; `bank_alert` from the bank's own payment alert ("Bank alerts" below) | `waiting-taps.ts` |

The brief's first default was to wait 45 seconds and ask. It changed to never
ask in the run on the coordinator's findings above: a held-open run might be
what stops the second tap, and the question could not be answered at the till.

## Duplicate runs

The request id guard makes a repeat of the same run save once. Two runs for
one payment that **both** carry the amount, each with its own request id,
save two entries today (`tests/waiting-taps-route.test.mjs`, "duplicate
runs"). Other apps merge the same amount, shop and card within 90 seconds;
that rule is not built here. Reported, not widened.

## Privacy

- Stored per tap: person, card ids, the merchant and Wallet card name as the
  Shortcut sent them, the day, received time, the Shortcut's request id and
  version, status and how it ended. No amount (there is none), no card
  number, no location. Rows stay after they are resolved (a few per trip) so
  the Shortcut can ask a tap's status and `second_run_*` can show whether the
  second tap ever runs. Demo reseed clears the table.
- No AI anywhere. Nothing is logged but error names.

## Cost

- One extra read on every Shortcut post with an amount (the person's waiting
  taps), one more statement on the Entries page (same wave, no rows while
  nothing waits; budget 8 to 9 in `tests/page-load-scale-guard.test.mjs`),
  one on reminders, and one on each import commit (two when taps wait).

## Write boundary and security

- The Shortcut path writes only the tap and its audit line, or the entry and
  the tap's completion in one batch. Entries' two routes are behind Access
  and the cross-site guard.
- `POST /api/shortcuts/taps/status` answers the person's key only, POST only,
  through the Shortcut Worker and the Access exemption beside the create
  path; another person's key, an unknown id or no key is 404 or 401.
- Every command is all-or-nothing (`tests/atomic-writes-waiting-taps.test.mjs`).
- The table is additive; with it missing everything behaves as before.

## Bank alerts (2026-11-17)

The bank's own payment alert finishes a waiting tap (DOMAIN.md "Bank
Alert"). Built on branch `bank-alert-shortcut`; Shortcut "Bank alert to
Monies Map" `bank-alert-2026-11-17-v1`.

- Why: MAS E-Payments User Protection Guidelines para 4.10 require
  Singapore issuers to send a real-time alert for each card transaction
  with the amount (and currency), time and merchant's trading name, by SMS,
  email or push. iOS Shortcuts' Notification trigger (an app posts a
  notification), Message trigger and Email trigger can each run a Shortcut
  with that text.
- **Unverified**: whether each bank app's notification text reaches a
  Shortcut, and every bank's exact wording. The six wordings in
  `src/domain/bank-alerts-config.ts` (DBS / POSB labelled email, UOB
  "A transaction of ... was made", Citi "A SGD ... transaction was made",
  OCBC "was charged ... at", Amaze "You spent ... at AMAZE*", and a generic
  "payment word, amount, at shop") are invented, structure-faithful guesses
  marked `verified: false`.
- Matching: exactly one of the key's person's waiting taps, from 10 minutes
  before to 30 minutes after the tap, shops agreeing (`AMAZE*` dropped).
  None or several: nothing. Never a new entry, never an entry that has an
  amount. Completion is the one save path (`completed_by` `bank_alert`), so
  the foreign-currency estimate, category guess, habits, trips and the
  audit line behave as for any completed tap.

Privacy:

- Sent by the phone: the alert's text as the automation got it (up to
  8 KiB), the phone's time, a request id and the Shortcut's version, to the
  household's own Worker with the person's Shortcut key. Nothing goes to AI.
- Read: only the first 4,000 characters; a text that looks like a one-time
  code (a word like OTP and a 6 to 8 figure code) is dropped before
  anything is read; card, account, phone and NRIC digits are scrubbed
  before the amount and shop are read.
- Kept: nothing of the text. The amount (and its currency) becomes the
  entry's amount; the entry keeps the tap's own shop, day and card; the
  tap's existing audit line says it was completed by the bank's alert. The
  alert's shop name, wording, card digits and request id are not stored.
- Never kept or logged: the text, any one-time code, any card or account
  digit. The route logs only an error's name.
  `tests/bank-alert-route.test.mjs` checks every row written and every log
  line for the alert's card and phone digits and wording.

Cost: one read of the person's waiting taps per alert (one row set, usually
empty), and the usual save when one fits. No AI.

The phone check that settles the unverified part: install the Shortcut,
make a Notification automation for the bank's app, pay a small amount, and
open the Shortcuts app's automation log: did it run, and did a waiting tap
(made by tapping a terminal that asks the currency, or by hand on a test
day) finish with `completed_by = 'bank_alert'`? If it ran but nothing
finished, the bank's wording needs a config entry.

## Bare taps (2026-11-26)

DOMAIN.md "Bare Tap". The owner's phone screenshots in Japan (iOS 27.2):
his Wallet automation ("When UOB Lady's World Mastercard and 6 more is
tapped") ran three **Set Dictionary Value** actions (`merchant` from Shortcut
Input's Merchant, `value` from Amount, `name` from Name) and then Run
Shortcut. Wallet fired the automation before it had the transaction's
details, so Merchant (and probably Amount) was empty and iOS stopped with
"No Value Provided — No value was provided to the Set Dictionary Value
action for the key "merchant"." The Shortcut never ran, nothing reached the
server, and iOS then backed off ("Last attempt to run your Shortcut failed.
Please wait before trying again"). Wallet's own notification named the shop
a little later, often with no amount. Production had no waiting tap at all
on 2026-11-26 (one SELECT): consistent with nothing ever arriving.

Where the wrapper came from: our setup text never named Set Dictionary
Value, but it never said how to build the Dictionary either. Settings said
"keep the Dictionary with value, merchant, and name from the transaction"
and the developer guide "If the existing automation already creates this
dictionary, leave it unchanged": it endorsed the owner's own older wrapper
(from the "Register Apple Pay Transaction" automation it replaced). Now
Settings, the user guide, the developer guide and the Shortcut README give
one exact wrapper and name the iOS error.

The sturdier wrapper (Settings "How to set it up", user guide):

1. Remove every Set Dictionary Value action from the automation.
2. Add one **Dictionary** action with three **Text** items: key `merchant`,
   value the variable Shortcut Input with its Merchant property; key
   `value`, Shortcut Input's Amount; key `name`, Shortcut Input's Name.
   Text, not Number: the amount carries its currency sign.
3. **Run Shortcut** "Monies Map Apple Pay API" (or the owner's copy), input
   set to that Dictionary.

What is proven and what is reasoned:

- Proven (the owner's screenshots): Set Dictionary Value stops the run on
  an empty value, before the Shortcut starts.
- Proven (decoded signed releases, `shortcuts/apple-pay-api/releases`, AEA
  signature checked with the certificate in each file): releases 2 to 8
  read their input only as a Dictionary (`Get Dictionary from Input` on
  Shortcut Input, then keys `value`, `merchant`, `name`), accept only app,
  rich text, text and file input, and render exactly the lines in the
  table below.
- Reasoned, not run on a phone: a Dictionary action's Text item is a text
  template, so an empty variable in it makes an empty text, not "no
  value", and the run goes on; the released Shortcut's Set Variable and
  Get Contents of URL take that empty text as "". Apple documents the
  Dictionary action ("Enter text, numbers, values, dictionaries, or lists
  into a Dictionary action") but not empty values. The quick home check:
  a test shortcut with an empty Text action, then a Dictionary whose
  `merchant` Text item holds it, then Show Result: it should show
  `merchant` with nothing after it, and no error.
- Alternatives considered: three **Text** actions feeding Set Dictionary
  Value (still Set Dictionary Value: an empty Text output may count as no
  value, unproven either way); an **If Shortcut Input's Merchant has any
  value** guard (needs an Otherwise branch that still runs the Shortcut,
  more steps, same Dictionary in the end); passing **Shortcut Input**
  straight to Run Shortcut with no wrapper (no: releases 6 and 8 read
  `merchant`, `value`, `name` keys from a Dictionary; a Wallet transaction
  passed through Run Shortcut is not such a Dictionary and is not one of
  their input types, so every field would arrive empty or the input would
  be dropped. A v9 that reads the transaction's Merchant, Amount and Name
  itself would need no wrapper; not built: it needs a new signed release
  and a phone to prove it).
- Sources for the Wallet side: Apple Developer Forums threads 797233
  (Merchant and Amount sometimes blank and 0.0 from the transaction
  trigger) and 765516 (the trigger times out when the card's record is
  late); Apple's Shortcuts guide "Using Dictionaries".

The server keeps what arrives (`keepWaitingTap`, shortcut-entry-route.ts).
What each release shows for each shape (`tests/shortcut-released-versions.test.mjs`
replays every release; card "Citibank Singapore", which matches no account,
so a tap with no amount lands on the person's first card, UOB One):

| Release | No shop, no amount | Shop only | Amount only (JP¥965) | Both |
|---|---|---|---|---|
| v1 | nothing shown, nothing kept (no request id) | nothing shown (400 needsAmount) | nothing shown | "Saved shop • JP¥965" |
| v2–v6 | "Not saved  • Payment on UOB One kept on Entries until its details come in." | "Not saved shop • Kept on Entries until its amount comes in." | "Not saved  • Payment of JPY 965 on Citi Rewards kept on Entries until its details come in." | "Saved shop • JP¥965 • Citi Rewards" |
| v7 | as v2–v6 | asks "How much was it?" (the tap kept too; the answer finishes it, Cancel leaves it on Entries) | as v2–v6 | as v2–v6 |
| v8 | "Payment on UOB One noted. Waiting for its details." | "shop noted. Waiting for the amount." | "Payment of JPY 965 on Citi Rewards noted. Waiting for its details." | as v2–v6 |

No release shows "Saved" for a kept tap: v2 to v8 show "Saved" only with
`openUrl`, which a kept tap's reply to v2–v7 never carries (v8 reads `held`
first). "Not saved" is true (no entry was saved) and the rest of the line
says where the payment waits. Every reply finishes the run normally (an HTTP
202 or 400 is read like any reply; nothing in v1 to v8 stops on a status).
Past the day's bound the reply is 429 with `error` "Too many payments came
without details today. This one was not kept." (v2–v8: "Not saved  • …").

Guards: nonce and replay as before (the request id is unique per household:
the same run again is the same tap; another person's request id is 409); at
most 20 bare taps a person a phone-day; put away after 7 days like any
waiting tap; nothing new stored (no amount, no alert text, no Wallet
notification text; `merchant` is "" and `wallet_name` is the card name as
before). A bank alert that finishes a bare tap gives the entry the alert's
shop (scrubbed of digits): that is the entry's own description, nothing
else of the alert is kept.

Cost: one more COUNT on a bare tap's hold; nothing on page loads.

Not changed: the trip ledger import (`trip-ledger-plan.ts`) holds a line
only for a waiting tap whose shop agrees; a bare tap on the same day is not
named there yet.

## What was not tested

A real two-tap terminal. The device test: tap, choose the currency, tap again
a few seconds apart; compare Wallet's card history with the Shortcuts
automation run log, and read the tap's `second_run_seconds`.
