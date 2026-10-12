// Copy for the Claude credit notice on Ask and the Ask and AI section in
// Settings (claude-credit-notice.jsx). It ships with those two routes only,
// never with the first screen. Plain words: "Claude" is the paid model, "the
// basic model" the free one Ask falls back to.

function monthModeText(mode) {
  if (mode === "basic_first") {
    return "everything is using the basic model to save budget";
  }
  return mode === "ask_only"
    ? "background help is using the basic model to save budget"
    : "background help is using Claude";
}

export const claudeCreditCopy = {
  regionLabel: "Claude credits",
  low: (spent, credit) => `Claude credits are running low: about ${spent} of ${credit} used. Ask still works.`,
  lowHidden: "Claude credits are running low. Ask still works.",
  exhausted: "Claude credits are used up, so Ask is using the basic model for now.",
  capped: "This month's Claude spending limit is reached, so Ask is using the basic model until it resets.",
  ok: (spent, credit) => `Claude credits are fine: about ${spent} of ${credit} used.`,
  okHidden: "Claude credits are fine.",
  notSetUp: "Claude isn't set up, so Ask uses the basic model.",
  // The auto-balance line in Settings: this month's Claude spend against the
  // monthly target, and who the other help asks first.
  monthLine: (spent, target, mode) => `Claude this month: ${spent} of ${target} \u00b7 ${monthModeText(mode)}`,
  monthLineHidden: (mode) => `Claude this month \u00b7 ${monthModeText(mode)}`,
  notUsedYet: "Claude hasn't been used yet.",
  topUp: "Top up in the Claude Console",
  toppedUp: "I've topped up",
  dismiss: "Hide this notice",
  lastChecked: (when) => `Last checked ${when}`,
  settingsTitle: "Ask and AI",
  settingsDetail: "Claude credits for Ask",
  // The lead at the top of the opened Ask and AI section.
  settingsLead: {
    title: "Ask",
    usesClaude: "Uses Claude",
    usesBasic: "Uses the basic model",
    usesBasicForNow: "Uses the basic model for now",
    modelLabel: "Model",
    modelClaude: "Claude",
    modelBasic: "Basic model",
    chipNotSetUp: "Claude not set up",
    chipNotUsedYet: "Not used yet",
    chipOk: "Credits fine",
    chipLow: "Credits running low",
    chipExhausted: "Credits used up",
    chipCapped: "Monthly limit reached"
  },
  lastCheckedLabel: "Last checked",
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
