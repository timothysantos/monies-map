// The quick pad's timings and limits (DOMAIN.md "Cash Entry", "Quick
// Entry"; docs/flows/cash-entry-flow.md), in one place so the owner can
// change them with a deploy.
//
// - QUICK_WORDS_DAYS: a quick entry nobody has described (the pad's own
//   name, the default category, no note) is gathered into Ask's "need a few
//   words" reminder for this many days, counting today, then it drops off.
//   Three days covers a long weekend away and the evening after.
// - QUICK_WORDS_LIST_LIMIT: the most rows that reminder's list shows at
//   once (the newest first).
// - TAP_OFFER_WINDOW_MINUTES: saving a card payment on the pad while an
//   Apple Pay tap on the same card waits for its amount, received within
//   this many minutes, offers that tap first instead of making a second
//   entry. An hour covers paying again with the plastic card after the phone
//   failed, then opening the pad later at the table.
// - CARD_RECENT_DAYS: how far back "most recently used" orders the person's
//   cards on the pad, when no trip is on (a trip's own days when one is).

export const QUICK_WORDS_DAYS = 3;
export const QUICK_WORDS_LIST_LIMIT = 12;
export const TAP_OFFER_WINDOW_MINUTES = 60;
export const CARD_RECENT_DAYS = 7;
