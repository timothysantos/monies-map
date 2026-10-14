// Every new string for Ask's habits (suggestion row, Done for you) and
// Settings' "What Ask remembers". Plain words: what happened to the person's
// money, never the app's own state. Listed in the PR for the owner's eyes.

export const askHabitsCopy = {
  suggestion: {
    group: "Suggestion",
    apply: "Do this",
    dismiss: "Not this time",
    applying: "Doing this",
    failed: "That could not be done just now."
  },
  done: {
    title: "Done for you",
    hint: "What Ask did by itself in the last 30 days. Undo puts it back.",
    empty: "Nothing yet.",
    undo: "Undo",
    undoing: "Undoing",
    undone: "Undone",
    stop: "Stop doing this",
    stopped: "Ask will stop doing this.",
    inlineLabel: "Done for you",
    count: (n) => (n === 1 ? "1 thing" : `${n} things`),
    // "Today", "Yesterday" or the date, then the time of day.
    when: (label, time) => `${label}, ${time}`,
    today: "Today",
    yesterday: "Yesterday"
  },
  settings: {
    title: "What Ask remembers",
    statusNone: "Nothing yet",
    status: (n) => (n === 1 ? "1 habit" : `${n} habits`),
    statusOff: "Off",
    toggleLabel: "Let Ask handle safe things",
    toggleHint: "When on, a new Apple Pay or hand-made entry gets the category and the split you usually use, and Ask tells you under Done for you with an Undo. Ask never changes amounts, dates, wallets or people, and never touches an entry the bank has confirmed.",
    habitsTitle: "What Ask has learned",
    empty: "Nothing yet. Ask learns from the categories and splits you choose.",
    sure: "Ask does this by itself",
    suggestOnly: "Ask only suggests this",
    edit: "Change",
    editTitle: (label) => `Change what Ask does for ${label}`,
    categoryField: "Category",
    shareField: "Your share",
    personField: "Means",
    save: "Save",
    saving: "Saving",
    cancel: "Cancel",
    delete: "Forget this",
    deletePrompt: (label) => `Ask will forget what it knows about ${label}. Your entries are not changed.`,
    forget: "Forget everything",
    forgetTitle: "Forget everything Ask remembers?",
    forgetPrompt: "Ask stops suggesting and handling things until it learns again from what you do. Your entries are not changed.",
    forgotten: "Ask forgot everything.",
    saveFailed: "That could not be saved.",
    loadFailed: "What Ask remembers could not be loaded just now.",
    unavailable: "Ask cannot keep habits yet.",
    sharePercent: (payer) => `${payer}/${100 - payer}`
  }
};
