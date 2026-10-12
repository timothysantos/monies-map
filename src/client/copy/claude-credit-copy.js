// Copy for the Claude credit notice on Ask and the Ask and AI section in
// Settings (claude-credit-notice.jsx). It ships with those two routes only,
// never with the first screen. Plain words: "Claude" is the paid model, "the
// basic model" the free one Ask falls back to.

export const claudeCreditCopy = {
  regionLabel: "Claude credits",
  low: (spent, credit) => `Claude credits are running low: about ${spent} of ${credit} used. Ask still works.`,
  lowHidden: "Claude credits are running low. Ask still works.",
  exhausted: "Claude credits are used up, so Ask is using the basic model for now.",
  capped: "This month's Claude spending limit is reached, so Ask is using the basic model until it resets.",
  ok: (spent, credit) => `Claude credits are fine: about ${spent} of ${credit} used.`,
  okHidden: "Claude credits are fine.",
  notSetUp: "Claude isn't set up, so Ask uses the basic model.",
  notUsedYet: "Claude hasn't been used yet.",
  topUp: "Top up in the Claude Console",
  toppedUp: "I've topped up",
  dismiss: "Hide this notice",
  lastChecked: (when) => `Last checked ${when}`,
  settingsTitle: "Ask and AI",
  settingsDetail: "Claude credits for Ask",
  form: {
    title: "I've topped up",
    description: "Enter the Claude credit you bought. Ask counts from this amount again.",
    amountLabel: "Credit bought (US$)",
    save: "Save",
    saving: "Saving...",
    cancel: "Cancel",
    close: "Close top-up",
    invalid: "Enter the credit you bought in US dollars, more than 0 and at most 10,000.",
    failed: "The top-up could not be saved. Check your connection and try again."
  }
};
