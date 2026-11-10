// The words on the reminder cards at the top of Ask (docs/flows/
// reminders-flow.md). Fixed templates over the facts the rules found: no AI
// words anything here. It ships with the Ask route only, never the first
// screen (the Ask tab's cue has no words but its label). Plain words, no app
// jargon: AGENTS.md "Readability"; tests/reminders-copy-lint.test.mjs walks
// every string. A phrase about money takes the amount already formatted (or
// "••••" while money is hidden) and never says who owes whom while hidden.

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const LONG_MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function dateParts(isoDate) {
  const [year, month, day] = String(isoDate ?? "").split("-").map(Number);
  if (!year || !month || !day) {
    return null;
  }
  return { year, month, day, weekday: new Date(Date.UTC(year, month - 1, day)).getUTCDay() };
}

// "Sun 18 Oct".
export function reminderDate(isoDate) {
  const parts = dateParts(isoDate);
  return parts ? `${WEEKDAYS[parts.weekday]} ${parts.day} ${MONTHS[parts.month - 1]}` : "";
}

// "6 Sep".
export function reminderShortDate(isoDate) {
  const parts = dateParts(isoDate);
  return parts ? `${parts.day} ${MONTHS[parts.month - 1]}` : "";
}

// "September" for 2026-09.
export function reminderMonthName(month) {
  const index = Number(String(month).slice(5, 7)) - 1;
  return LONG_MONTHS[index] ?? "";
}

const plural = (count, one, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;

export const remindersCopy = {
  heading: "Reminders",
  headingLabel: "Reminders",
  more: (count) => `${count} more ${count === 1 ? "reminder" : "reminders"}`,
  fewer: "Show fewer",
  later: "Later",
  gotIt: "Got it",
  cancel: "Cancel",
  undo: "Undo",

  // The Ask tab and the desktop Ask field while something new is waiting.
  cue: {
    tab: (count) => `Ask, ${plural(count, "reminder")}`,
    tabWithConversation: (count) => `Ask, conversation in progress and ${plural(count, "reminder")}`
  },

  cardBill: {
    title: (name, daysUntilDue) => {
      if (daysUntilDue > 1) return `${name} bill due in ${daysUntilDue} days`;
      if (daysUntilDue === 1) return `${name} bill due tomorrow`;
      if (daysUntilDue === 0) return `${name} bill due today`;
      if (daysUntilDue === -1) return `${name} bill was due yesterday`;
      return `${name} bill was due ${-daysUntilDue} days ago`;
    },
    // What has been paid since the statement, said without a figure while money is hidden.
    sentence: ({ dueText, overdue, paidText, hasPaid }) => {
      const due = overdue ? `Was due ${dueText}.` : `Due ${dueText}.`;
      if (!hasPaid) return `${due} Nothing paid to it since the statement.`;
      return `${due} ${paidText ? `${paidText} paid` : "Part of it paid"} since the statement.`;
    },
    open: "Open card",
    laterTitle: (name) => `${name} bill`,
    skip: { label: "Not for this bill", hint: "back for the next one" },
    elsewhere: { label: "Paid from another account", hint: "stops this bill's reminder" },
    laterNote: "This only hides it on this device. It goes away by itself once the payment shows in your records."
  },

  statement: {
    title: (name, monthName) => `${name}'s ${monthName} statement should be out`,
    sentence: (daysSinceExpected, expectedText, monthName) => (
      `It usually closes around ${expectedText}, about ${plural(daysSinceExpected, "day")} ago. Importing it checks ${monthName}'s spending.`
    ),
    open: "Import statement",
    laterTitle: (name, monthName) => `${name}'s ${monthName} statement`,
    skip: (nextMonthName) => ({ label: "Not for this statement", hint: `back for ${nextMonthName}'s` }),
    laterNote: "This only hides it on this device. It goes away by itself once the statement is imported."
  },

  splits: {
    settleUpTitle: ({ direction, otherName, fromName, toName, weeks }) => {
      const waiting = `waiting ${plural(weeks, "week")}`;
      return direction === "between"
        ? `Settle-up between ${fromName} and ${toName} ${waiting}`
        : `Settle-up with ${otherName} ${waiting}`;
    },
    settleUpSentence: ({ direction, otherName, fromName, toName, dateText, hidden }) => {
      if (hidden) return `Agreed on ${dateText} to even out your shared costs.`;
      if (direction === "between") return `On ${dateText} ${fromName} agreed to pay ${toName} this to even out their shared costs.`;
      return direction === "you_owe"
        ? `On ${dateText} you agreed to pay ${otherName} this to even out your shared costs.`
        : `On ${dateText} ${otherName} agreed to pay you this to even out your shared costs.`;
    },
    balanceTitle: ({ direction, otherName, fromName, toName, weeks }) => {
      const waiting = `waiting ${plural(weeks, "week")}`;
      return direction === "between"
        ? `Shared costs between ${fromName} and ${toName} ${waiting}`
        : `Shared costs with ${otherName} ${waiting}`;
    },
    balanceSentence: ({ direction, otherName, fromName, toName, groupName, dateText, hidden }) => {
      if (hidden) return `In ${groupName}, shared costs have been open since ${dateText}.`;
      if (direction === "between") return `In ${groupName}, ${fromName} owes ${toName} for costs open since ${dateText}.`;
      return direction === "you_owe"
        ? `In ${groupName}, you owe ${otherName} for costs open since ${dateText}.`
        : `In ${groupName}, ${otherName} owes you for costs open since ${dateText}.`;
    },
    open: "Open Splits",
    laterTitle: (name) => `Shared costs with ${name}`,
    laterTitleHousehold: "Shared costs",
    skip: { label: "Not for this balance", hint: "back if it changes" },
    laterNote: "This only hides it on this device. It goes away by itself once it is settled up."
  },

  price: {
    title: ({ payeeName, newText, period, hidden }) => (
      hidden ? `${payeeName}'s price changed` : `${payeeName} now costs ${newText} a ${period === "yearly" ? "year" : "month"}`
    ),
    sentence: ({ oldText, higher, priorCount, period, dateText, hidden }) => {
      if (hidden) return `Its first new charge was on ${dateText}.`;
      const before = period === "yearly" ? plural(priorCount, "yearly charge") : plural(priorCount, "month");
      return `${higher ? "Up" : "Down"} from ${oldText}, its price for the ${before} before. First new charge on ${dateText}.`;
    },
    open: "See charges"
  },

  // December only: room left in a tax relief already started (DOMAIN.md
  // "Tax Relief"). It states the room and the deadline; it never says how
  // much tax a top-up saves and never tells anyone what to do.
  taxRelief: {
    title: (daysLeft) => (daysLeft <= 0 ? "Last day to use this year's tax reliefs" : `${plural(daysLeft, "day")} left to use this year's tax reliefs`),
    // One person's room, then the next: "Ethan: $9,300 more in SRS top-ups would still count."
    line: ({ name, parts, withName }) => `${withName ? `${name}: ` : ""}${parts.join(" and ")} would still count.`,
    part: (amountText, relief) => `${amountText} more in ${relief}`,
    reliefs: { srs: "SRS top-ups", cpf_self: "CPF cash top-ups for yourself", cpf_family: "CPF cash top-ups for family" },
    hiddenSentence: "Some of this year's tax relief limits are not full yet. Gifts and top-ups count when they are made by 31 Dec.",
    open: "Open Summary",
    laterTitle: "Tax reliefs",
    skip: { label: "Not for this year", hint: "back next December" },
    laterNote: "This only hides it on this device."
  },

  monthClose: {
    title: (monthName, allDone) => (allDone ? `${monthName} is all in` : `${monthName} is ready to close`),
    allInSentence: "Every statement is in and nothing is left to check.",
    sentence: (doneCount, total) => `Every statement is in. ${doneCount} of ${total} checks done.`,
    progressLabel: (doneCount, total) => `${doneCount} of ${total} checks done`,
    open: (monthName) => `Open ${monthName}`,
    laterTitle: (monthName) => `${monthName}'s checks`,
    skip: { label: "Not for this month", hint: "back for the next month" },
    laterNote: "This only hides it on this device.",
    checks: {
      statements: { label: "Statements imported", value: (count) => (count === 1 ? "The only one" : `All ${count}`) },
      other: {
        label: "Left in Other (no category)",
        value: (count) => (count === 0 ? "None" : plural(count, "entry", "entries"))
      },
      splits: {
        label: "Splits to settle",
        none: "Nothing to settle",
        many: (count) => `${count} to settle`,
        withName: (name) => `with ${name}`
      },
      note: { label: "Month note", written: "Written", notWritten: "Not written yet" }
    }
  },

  laterSheet: {
    title: "Remind me later",
    close: "Close",
    tomorrow: "Tomorrow",
    inThreeDays: "In 3 days",
    nextWeek: "Next week"
  },

  folded: {
    until: (dateText) => `Back on ${dateText}`,
    skipped: "Hidden on this device",
    gotIt: "Got it"
  },

  // Said in plain words while money is hidden: never the amount, never who owes.
  hiddenAmount: "••••"
};
