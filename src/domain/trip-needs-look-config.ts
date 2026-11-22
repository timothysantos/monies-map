import { SECOND_TAP_WINDOW_SECONDS, WAITING_TAP_EXPIRE_DAYS } from "./waiting-taps-config";

// The thresholds behind a trip page's "Needs a look" list (DOMAIN.md "Trip
// page", "needs a look"; trip-page.ts `tripNeedsLook`), in one place so the
// owner can change them with a deploy.
//
// Why these values:
// - ESTIMATE_LOOK_AFTER_DAYS: a card statement covers about a month and is
//   imported some days after it closes, so a purchase in another currency is
//   normally confirmed within 40 days. Past that, the estimate's statement is
//   probably missing or did not pair with it. It is the same 40 days the
//   scheduled check allows a statement to be recent.
// - NO_AMOUNT_LOOK_AFTER_SECONDS: a waiting tap can still be finished by a
//   second Apple Pay run within the second-tap window; after it only the
//   person can add the amount. A tap nobody finished leaves after
//   WAITING_TAP_EXPIRE_DAYS (it is then put away, waiting-taps-config.ts).
// - NEEDS_LOOK_MAX_ITEMS: the most the page is sent; a trip with more has a
//   bigger problem than a list can show.
export const ESTIMATE_LOOK_AFTER_DAYS = 40;

export const NO_AMOUNT_LOOK_AFTER_SECONDS = SECOND_TAP_WINDOW_SECONDS;

export const NO_AMOUNT_KEPT_DAYS = WAITING_TAP_EXPIRE_DAYS;

export const NEEDS_LOOK_MAX_ITEMS = 50;
