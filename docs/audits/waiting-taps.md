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
| Which clients get a held tap | Shortcut v8 and later (`clientVersion` ends `-v8` or higher) with a request id; v7 and older keep `needsAmount` exactly | `canHoldTap` |
| Ask inside the run | Never by default (`ASK_AFTER_SECONDS = null`); the Worker var `WAITING_TAP_ASK_AFTER_SECONDS` (0 to 120, or `off`) turns it on without a reinstall | `waiting-taps-config.ts` |
| Second run completes the tap | Backstop only: same person, same card (or the card the Wallet name or order picks before a currency is known), within 600 s, merchants agree | `findTapForSecondRun` |
| Main way to finish | The card at the top of Entries and Ask's reminder | design.md "Waiting tap card" |
| Import clears | The bank's row on the tap's card or the person's card for other currencies, within 7 days (the posting room a one-off charge gets), same shop (`matchMerchants` strong or the `AMAZE*` prefix rule); or a certified statement covering the day on every card the tap could be on without such a row | `planWaitingTapClears` |
| Put away | After 7 days unfinished (`expired`, audit line) | `WAITING_TAP_EXPIRE_DAYS` |
| Completion seam | One save path (`saveShortcutEntry`) with `completed_by`: `second_tap`, `shortcut_answer`, `app`; `bank_alert` reserved for a later automation that supplies the amount (an iOS Notification trigger or an email alert). Not built | `waiting-taps.ts` |

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

## What was not tested

A real two-tap terminal. The device test: tap, choose the currency, tap again
a few seconds apart; compare Wallet's card history with the Shortcuts
automation run log, and read the tap's `second_run_seconds`.
