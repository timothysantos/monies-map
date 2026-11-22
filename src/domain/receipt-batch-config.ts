// Many receipts at once, and matching a receipt to an entry already in the
// ledger (DOMAIN.md "Receipt Batch", "Receipt Match"). Every limit and
// tolerance lives here, so a change is one line and the UI never hard-codes
// a number.

// How many receipt photos one go reads. More than this and only the first
// ones are read; the page says so.
export const RECEIPT_BATCH_MAX = 10;

// The days around the receipt's date an entry for the same purchase can
// sit on: the shop's time zone can be a day behind the card's, and a card
// row can be dated up to a few days after the purchase.
export const RECEIPT_MATCH_DAYS_BEFORE = 1;
export const RECEIPT_MATCH_DAYS_AFTER = 3;

// At most this many ledger rows are read for one receipt (bounded by date in
// SQL first), and at most this many candidates are offered as chips.
export const RECEIPT_MATCH_MAX_ROWS = 200;
export const RECEIPT_MATCH_MAX_CHOICES = 3;

// A receipt in another currency than the entry's: the entry is the same
// purchase when its amount is within the Foreign Currency Estimate
// tolerance of the receipt's total at the saved day rate (DOMAIN.md
// "Foreign Currency Estimate": at most 5% over and 2% under, at least 10
// cents either way). The rate is the one already saved; no rate, no match
// on amount.
export const RECEIPT_MATCH_ESTIMATE_OVER = 0.05;
export const RECEIPT_MATCH_ESTIMATE_UNDER = 0.02;
export const RECEIPT_MATCH_ESTIMATE_MIN_MINOR = 10;
// How old a saved rate may be to compare a foreign receipt with.
export const RECEIPT_MATCH_RATE_MAX_AGE_DAYS = 14;

// The receipt's lines added to a matched entry's note stay short: the note
// as a whole is capped by the entry note limit (2,000 characters).
export const RECEIPT_NOTE_MAX_CHARS = 600;
