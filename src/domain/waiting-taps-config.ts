import { STANDARD_DUPLICATE_MAX_DAY_DISTANCE } from "./import-preview-match-policy";

// Every timing and rule the waiting tap (DOMAIN.md "Waiting Tap") runs on,
// in one place, so the owner can change how the Apple Pay Shortcut behaves
// with a deploy and no reinstall.
//
// Why these values (docs/audits/waiting-taps.md):
// - The Wallet automation starts at the tap, waits for Wallet's record, can
//   time out, and runs even for a declined tap; a blank amount has several
//   causes (a currency choice, a declined tap, a transit gate, a card check).
//   Nothing published says a second tap runs the automation again (our own
//   evidence: 4 of 4 did not), and nobody knows whether a run held open
//   stops the next one. Runs with Wait are reported to stop after a few
//   minutes or when the phone locks, Ask for Input needs an unlocked phone,
//   and Wallet is in front at the terminal. So the blank-amount run ends at
//   once with a quiet notification, and the main way to finish a tap is the
//   card at the top of Entries (and Ask's reminder).
// - ASK_AFTER_SECONDS: null (the default) never asks inside the Shortcut
//   run. A number makes the reply carry askAfterSeconds: the Shortcut waits
//   that long, checks the tap, and asks only if it still waits (0 asks at
//   once). The Worker var WAITING_TAP_ASK_AFTER_SECONDS overrides it ("" or
//   "off" for never).
// - SECOND_TAP_WINDOW_SECONDS: a backstop only. If a second run with the
//   amount does arrive for the same person and card within 10 minutes, it
//   completes the tap; a later purchase at the same shop stays separate.
// - WAITING_TAP_EXPIRE_DAYS: a tap nobody finished leaves the card and the
//   reminders after 7 days (marked expired, with an audit line) instead of
//   asking forever; many blank taps were never payments.
// - FIRST_HOLDING_SHORTCUT_VERSION: Shortcut v7 and older (and any client
//   that sends no version) keep the older needsAmount answer exactly.

export const SECOND_TAP_WINDOW_SECONDS = 10 * 60;

export const ASK_AFTER_SECONDS: number | null = null;

export const WAITING_TAP_EXPIRE_DAYS = 7;

export const FIRST_HOLDING_SHORTCUT_VERSION = 8;

// Bare taps (DOMAIN.md "Bare Tap", docs/audits/waiting-taps.md "Bare taps"):
// since iOS 27.2 (about 14 Nov 2026), and on most taps abroad, Wallet can run
// the automation before it has the payment's details, so the Shortcut gets
// no shop and often no amount, only the card.
// - FIRST_KEEPING_SHORTCUT_VERSION: every released Apple Pay Shortcut from
//   v2 sends a request id (the replay guard), so from v2 a tap with a
//   missing shop or amount is kept, whatever the release shows. v1 sends no
//   request id and no card name, and a run with no version is someone's own
//   test: both keep the older answers.
// - BARE_TAPS_PER_PERSON_PER_DAY: junk guard. A phone in a loop (or a key
//   that leaked) cannot fill the Entries card; past it, the run is refused
//   with words the Shortcut shows. A day of real travel taps is well under.
// - BARE_TAP_SECOND_RUN_SECONDS: a later run that does carry the shop and
//   amount finishes a bare tap only within this short time, on the same
//   card, and only when exactly one bare tap fits. Longer, and a separate
//   purchase at the next shop would swallow a payment nobody saw.
export const FIRST_KEEPING_SHORTCUT_VERSION = 2;

export const BARE_TAPS_PER_PERSON_PER_DAY = 20;

export const BARE_TAP_SECOND_RUN_SECONDS = 2 * 60;

// An import's bank row clears a waiting tap on the same card when its
// purchase or posting day is at most this many days from the tap's day:
// the posting-day room a one-off charge gets when it meets an Apple Pay
// entry (STANDARD_DUPLICATE_MAX_DAY_DISTANCE, import-preview-match-policy.js).
export const IMPORT_CLEAR_MAX_DAY_DISTANCE: number = STANDARD_DUPLICATE_MAX_DAY_DISTANCE;

// The ask delay a reply carries: the Worker var when set, else the config.
// null: the Shortcut never asks.
export function readAskAfterSeconds(override: string | undefined) {
  const text = override?.trim().toLowerCase();
  if (text === undefined) {
    return ASK_AFTER_SECONDS;
  }
  if (text === "" || text === "off" || text === "never") {
    return null;
  }
  const seconds = Number(text);
  return Number.isInteger(seconds) && seconds >= 0 && seconds <= 120 ? seconds : ASK_AFTER_SECONDS;
}
