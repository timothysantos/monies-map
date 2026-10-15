// Plan Studio's words (DOMAIN.md "Plan Studio", design.md "Plan Studio"):
// the Month plan as money jobs. They live in the Month route's chunk, not the
// first screen. Plain words: what happened to the person's money, then the
// number. Each function takes amounts already formatted (and masked when money
// is hidden), so the copy never decides how a figure looks.
export const planStudioCopy = {
  region: "Plan the month",
  placeholder: "Loading the plan",

  jobs: { income: "Money in", spend: "Spend", save: "Save", invest: "Invest", left: "Left over" },

  // The big picture card.
  monthLine: (monthLabel, day, daysInMonth) => (day ? `${monthLabel} · day ${day} of ${daysInMonth}` : monthLabel),
  barTitle: "Where planned money in goes",
  barTitleJob: (jobName) => `${jobName}: one slice per category`,
  barHint: "Drag a line to move money between jobs. Tap a job to resize its categories.",
  barHintJob: "Drag a line to move money between neighbours. The last line takes from left over.",
  allJobs: "All jobs",
  resizeCategories: (jobName) => `Resize categories in ${jobName}`,
  plannedIn: (amount) => `Planned in ${amount}`,
  over: (amount) => `${amount} over`,
  moveLine: (from, to) => `Move the line between ${from} and ${to}`,
  moveLineValue: (amount) => `${amount} planned so far`,

  // The plan balance, in plain words, with its one-tap fix.
  balance: {
    covered: { title: "Your plan covers everything.", text: (amount) => `${amount} is left over.` },
    exact: { title: "Every planned dollar has a job.", text: () => "Money in and money out match exactly." },
    over: { title: "The plan doesn't add up.", text: (amount) => `${amount} more goes out than comes in.` },
    empty: { title: "No money in is planned yet.", text: () => "Add your salary first, then give each dollar a job." },
    // With money hidden the headline must not say which side of zero it is.
    hidden: { title: "Plan balance", text: () => "Show money to see how the plan adds up." },
    addToSavings: (amount) => `Add ${amount} to savings`,
    lower: (label, amount) => `Lower ${label} by ${amount}`
  },

  // How the month is going against the plan: pace markers and the two bars.
  pace: {
    heading: "How the month is going",
    moneyIn: "Money in so far",
    spent: "Spent so far",
    ofPlanned: (amount) => `of ${amount} planned`,
    today: "Today",
    usualByToday: "Usual by today",
    verdict: { on_track: "On track", ahead: "A bit ahead of pace", over: "Over plan" },
    hiddenVerdict: "Spending so far",
    onTrack: (spent, expected) => `Spent ${spent} so far. The plan expects about ${expected} by today.`,
    ahead: (spent, by) => `Spent ${spent} so far, ${by} more than the plan expects by today.`,
    over: (spent, by) => `Spent ${spent}, ${by} past the plan.`,
    hiddenText: "Show money to see how spending compares with the plan.",
    inOnPlan: "Money in is on plan.",
    inToCome: (amount) => `${amount} of planned money in is still to come.`
  },

  // What a row says about itself under its slider.
  status: {
    income_full: () => "Received in full",
    income_more: (amount) => `Received ${amount} more than planned`,
    income_to_come: (amount) => `${amount} still to come`,
    save_ahead: (amount) => `Kept ${amount} more than the target so far`,
    save_to_go: (amount) => `${amount} still to keep`,
    invest_full: () => "Moved in full",
    invest_to_move: (amount) => `${amount} still to move`,
    spend_over: (amount) => `Over plan by ${amount}`,
    spend_nothing: () => "Nothing yet",
    spend_to_pay: (amount) => `${amount} still to pay`,
    spend_on_track: () => "On track",
    spend_ahead: () => "Ahead of pace",
    spend_left: (amount) => `On track, ${amount} left`
  },
  planned: "planned",
  groupPlanned: (amount) => `${amount} planned`,
  keptSoFar: "kept so far",

  // Row controls and chips.
  row: {
    amountButton: (label) => `Type the planned amount for ${label}`,
    lock: (label) => `Lock ${label}`,
    unlock: (label) => `Unlock ${label}`,
    lower: (label, step) => `Lower ${label} by ${step}`,
    raise: (label, step) => `Raise ${label} by ${step}`,
    sliderLabel: (label) => `Planned amount for ${label}`,
    sliderHint: "Arrow keys change it by one step. Hold Shift for five steps, Alt for one dollar.",
    fineHint: "On a touch screen, press and hold, then drag for fine control.",
    fine: "Fine control",
    shared: "Shared",
    sharedEqual: (amount) => `Shared · ${amount} each`,
    sharedSplit: (parts) => `Shared · ${parts.map((part) => `${part.name} ${part.amount}`).join(" · ")}`,
    fromSaved: (signedAmount) => `${signedAmount} from saved`,
    viewEntries: (label) => `View the entries behind ${label}`,
    readOnly: "Change this one in the plan list below.",
    locked: (label) => `${label} is locked. Unlock it to change it.`
  },

  // The toolbar.
  toolbar: {
    undo: "Undo",
    reset: "Reset to saved",
    save: "Save plan",
    saving: "Saving…",
    takeFrom: "Take from",
    leftOver: "Left over",
    takeFromLabel: "When I change a number, take the money from"
  },
  notices: {
    undone: "Undone.",
    nothingToUndo: "Nothing to undo.",
    reset: "Back to the saved plan.",
    saved: "Plan saved.",
    locked: (label) => `${label} is locked.`,
    partial: (amount, label) => `Only ${amount} left to take from ${label}.`,
    lineLocked: (label) => `Unlock ${label} to move this line.`,
    saveFailed: "The plan could not be saved. Your changes are still here.",
    saveConflict: "The plan changed while you were editing. Your changes are still here. Reload the month to see it as it is now.",
    retry: "Try again"
  },

  // The amount popover (tap or click a row's amount).
  amount: {
    title: (label) => `Planned amount for ${label}`,
    field: "Planned amount",
    saved: (amount) => `Saved: ${amount}`,
    change: (signedAmount) => `${signedAmount} from saved`,
    noChange: "Same as saved",
    set: "Set amount",
    cancel: "Cancel",
    resetRow: "Reset to saved",
    chips: ["+$5", "+$10", "+$50", "−$5", "−$10", "−$50"],
    errors: {
      empty: "Type an amount.",
      not_a_number: "Use numbers only, like 137 or 137.50.",
      too_many_decimals: "Use dollars and cents, like 137.50.",
      too_big: "That is more than a plan line can hold."
    }
  },

  // What if I save more? (changes the plan only; never a forecast).
  whatIf: {
    title: "What if I save more?",
    note: "Changes the plan only. Spending is not predicted.",
    target: "Savings target",
    tryLabel: (amount) => `${amount} (try)`,
    left: "Left over",
    room: "Room to spend",
    roomPerDay: (amount, days) => `${amount} a day, ${days} days left`,
    planOut: "Plan out",
    saveTotal: "Save total",
    apply: "Apply to plan",
    cancel: "Cancel",
    slide: "Slide to try a new savings target first.",
    applied: "Applied to the plan. Save plan to keep it.",
    fromLeft: (amount) => `${amount} from left over`,
    fromRow: (amount, label) => `${amount} from ${label}`,
    fromRows: (amount, count) => `${amount} from ${count} categories`,
    short: (amount) => `${amount} is not available, so the plan would not add up.`,
    giveBack: (amount) => `${amount} goes back to left over.`,
    takeFrom: "Take the rest from",
    spreadAuto: "Spread over my flexible categories",
    noSaveRow: "Add a Savings line to the plan to try this."
  },

  // Money hidden: figures are dots, and the words give no sign away.
  hidden: "Amount hidden",
  hiddenFigure: "••••",

  // The room reserved while the studio's code arrives.
  loading: "Loading the plan"
};
