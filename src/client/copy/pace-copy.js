import { rangeWords } from "../../domain/money-signals/format";

// Words for "If this keeps up" (DOMAIN.md "Pace"), as the owner approved them
// on 10 Nov 2026: always "If this keeps up", always a range, never a
// reassurance (the pace lint, tests/pace-copy-lint.test.mjs).
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const monthName = (month) => MONTHS[Number(String(month).slice(5, 7)) - 1] ?? "";
const dayMonth = (date) => `${Number(String(date).slice(8, 10))} ${SHORT[Number(String(date).slice(5, 7)) - 1] ?? ""}`;

export const paceCopy = {
  label: "If this keeps up",
  // "If this keeps up: about $4,700 to $5,100 by 30 Nov"
  line: (low, high, endDate) => `If this keeps up: about ${rangeWords(low, high)} by ${dayMonth(endDate)}`,
  // "…, under the $5,200 plan." / "…, over the $5,200 plan."
  plan: (plan, over) => `${over ? "over" : "under"} the ${plan} plan`,
  left: (low, high) => `About ${rangeWords(low, high)} left of what comes in.`,
  // How this is worked out (the figure's menu note).
  workedOut: "How this is worked out",
  spentSoFar: (amount) => `Spent so far ${amount}`,
  everyday: (days, low, high) => `Everyday spending, ${days} ${days === 1 ? "day" : "days"} to go: ${rangeWords(low, high)}`,
  bills: (low, high) => `Bills still to come: ${rangeWords(low, high)}`,
  onceOnly: (amount) => `Counted once, not repeated: ${amount}`,
  rounded: "Rounded out to the nearest $50. Only what's recorded; nothing is guessed about new spending.",
  roundedTo: (step) => `Rounded out to the nearest ${step}. Only what's recorded; nothing is guessed about new spending.`,
  // Coming up's 30-day total.
  comingUpTotal: (low, high, endDate) => `About ${rangeWords(low, high)} by ${dayMonth(endDate)}, if they come as usual`,
  // The year-end line (Summary only, from April; owner decision D7).
  year: (low, high, year) => `If this keeps up, about ${rangeWords(low, high)} kept in ${year} by 31 Dec.`,
  ask: (month) => `How will ${monthName(month)} end if this keeps up?`
};
