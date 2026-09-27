// Month's check-in signals, for one month in one view. Everything comes
// from what Month already loads: the view's entries, the plan rows with
// their linked entries, the income rows, the month's totals and the view's
// account pills. The time of month picks the moment: early looks ahead,
// mid-month looks at pace, late and past months wrap up.
import {
  addDays,
  compactMoney,
  daysInMonth,
  monthName,
  monthPhase,
  phrase,
  shortDay,
  sum,
  tidyName,
  weekdayIndex,
  weekdayNameOf,
  joinWithAnd,
  type CopyCatalogue,
  type FormatMoney,
  type MonthPhase
} from "./format";
import { statementGapSignal, triviaSignal, type WalletHealthPill } from "./shared-signals";
import type { Audience, MoneySignal } from "./types";

export const MONTH_COPY = {
  unlinkedBills: {
    phrasings: [
      "{count} planned bills dated before today have no entry linked yet.",
      "{count} planned bills, {total} in all, are still waiting for an entry.",
      "Still unlinked: {count} planned bills dated before today, {total} in total."
    ],
    phrasingsOne: [
      "1 planned bill dated before today has no entry linked yet: {label}.",
      "{label}, planned at {total}, is still waiting for an entry.",
      "Still unlinked: {label}, {total}, dated before today."
    ],
    think: "Linking them keeps the plan honest and catches anything that didn't go out.",
    thinkOne: "Linking it keeps the plan honest and catches anything that didn't go out.",
    sorted: {
      fact: "Sorted: every planned bill dated so far has an entry linked.",
      think: "The plan and the entries agree again, so the numbers here tell the whole story."
    }
  },
  oneOffOverPlan: {
    phrasings: [
      "{items} made up most of {month}'s {over} over plan.",
      "{month} went {over} over plan, mostly {items}.",
      "Most of {month}'s {over} over plan came from {items}."
    ],
    think: "Big one-offs happen. Worth deciding: truly one-off, or something to plan for next year?",
    action: "Show those entries"
  },
  categoryOverPlan: {
    phrasings: [
      "{label} went {over} over its {plan} plan.",
      "{label} is at {actual} against a {plan} plan.",
      "The {label} plan was {plan}; spending came to {actual}."
    ],
    think: "Plans are guesses made in advance. Adjust the plan or the spending; either is fine as long as it's a choice.",
    action: "Review {category}"
  },
  incomeAbovePlan: {
    phrasings: [
      "Income was {extra} above plan {when}.",
      "{extra} more came in than planned {when}.",
      "More came in than planned {when}: {extra} above plan."
    ],
    think: "Extra money blends into everyday spending quickly. Deciding early how much goes to future you keeps the rest yours to enjoy on purpose."
  },
  incomeArrived: {
    phrasings: [
      "{amount} of income arrived on {day}.",
      "Payday: {amount} came in on {day}.",
      "{amount} landed on {day}."
    ],
    think: "Payday is the easiest moment to give money a job, before it blends into the month."
  },
  planLeft: {
    phrasings: [
      "{left} of this month's plan is still unspent.",
      { fact: "{left} of this month's plan is still unspent. Give it a job before it drifts.", think: "Unspent plan isn't spent money yet." },
      { fact: "You have {left} of plan left. Savings, next month, or something you've been looking forward to?", think: "Unspent plan isn't spent money yet." },
      { fact: "Under plan by {left} so far. Nice; decide where it goes while it's still a choice.", think: "Unspent plan isn't spent money yet." }
    ],
    think: "Unspent plan isn't spent money yet. Give it a job: savings, next month, or something you've been looking forward to."
  },
  planLeftPast: {
    phrasings: [
      "{month} finished {left} under plan.",
      "{month} came in {left} under plan.",
      "Under plan by {left} in {month}."
    ],
    think: "Unspent plan isn't spent money yet. Give it a job: savings, next month, or something you've been looking forward to."
  },
  savingsOnPlan: {
    phrasings: [
      "Savings are on plan {when}.",
      "{saved} went to savings {when}, as planned.",
      "Savings came to {saved} against a {planned} plan."
    ],
    think: "With savings covered, spending on what you enjoy is part of the plan, not a slip from it."
  },
  upcomingBills: {
    phrasings: [
      "{count} planned bills are due in the next 10 days, {total} in total.",
      "Coming up in the next 10 days: {count} planned bills, {total} in all.",
      "{total} of planned bills goes out over the next 10 days."
    ],
    phrasingsOne: [
      "1 planned bill is due in the next 10 days: {label}, {total}.",
      "Coming up in the next 10 days: {label}, {total}.",
      "{total} goes out for {label} in the next 10 days."
    ],
    think: "A fresh month is the easiest time to set things up. Anything to move or cancel before it goes out?"
  },
  paceSteady: {
    phrasings: [
      "{spent} of the {plan} plan is used, with {days} days of {month} to go.",
      "Mid-month check: {spent} spent against a {plan} plan.",
      "{left} of the plan is left for the last {days} days of {month}."
    ],
    think: "Spending is keeping pace with the plan so far. A calm middle of the month usually makes for a calm end."
  },
  paceAhead: {
    phrasings: [
      "{spent} of the {plan} plan is used, with {days} days of {month} to go.",
      "Mid-month check: {spent} spent against a {plan} plan.",
      "{left} of the plan is left for the last {days} days of {month}."
    ],
    think: "Spending is running ahead of the calendar. Nothing is fixed yet; the rest of the month decides where it lands."
  },
  fixedCosts: {
    phrasings: [
      "Planned bills and subscriptions take {rate}% of {whose} income ({planned}).",
      "{planned} of {whose} {income} income is already spoken for by planned bills and subscriptions.",
      "Planned bills and subscriptions: {planned}, against {income} of income."
    ],
    think: "Fixed costs set how much room every month has. The lower they are, the more freedom for everything else."
  },
  regularSpot: {
    phrasings: ["Your regular spot: {name}, {count} visits in {month}."],
    think: ""
  },
  weekdayPattern: {
    phrasings: ["Most of your dining out {when} happened on {weekday}s."],
    think: ""
  },
  noSpendDays: {
    phrasings: ["{count} days in {month} with nothing spent."],
    think: ""
  },
  noSpendDaysSoFar: {
    phrasings: ["{count} days so far in {month} with nothing spent."],
    think: ""
  },
  biggestDay: {
    phrasings: ["Your biggest day was {day}: {name}."],
    think: ""
  }
} satisfies CopyCatalogue;

export function monthCalmLine(month: string) {
  return `Nothing in ${monthName(month)} needs a look right now.`;
}

export interface MonthSignalEntry {
  id: string;
  date: string;
  description?: string;
  categoryName?: string;
  entryType: string;
  amountMinor: number;
}

export interface MonthSignalPlanRow {
  id: string;
  label?: string;
  categoryName?: string;
  planDate?: string;
  plannedMinor: number;
  actualMinor: number;
  linkedEntryCount?: number;
  linkedEntryIds?: string[];
}

export interface MonthSignalInput {
  audience: Audience;
  viewLabel: string;
  month: string;
  today: string;
  // The entries the Actual spend card counts, at the view's amounts.
  entries: MonthSignalEntry[];
  planSections: Array<{ key: string; rows: MonthSignalPlanRow[] }>;
  incomeRows: Array<{ plannedMinor: number; actualMinor: number }>;
  summary: { estimatedExpensesMinor?: number; realExpensesMinor?: number; plannedIncomeMinor?: number; actualIncomeMinor?: number } | null;
  accountPills: WalletHealthPill[] | null;
  formatMoney: FormatMoney;
}

const SAVINGS = /saving/i;
const DINING = /food|dining|restaurant|cafe|coffee|drink/i;
// Places visited out of routine rather than choice: not a "regular spot".
const NOT_A_SPOT = /transport|transfer|bill|utilit|subscription|insurance|rent|mortgage|loan|saving|invest|tax|salary|income/i;

function expenses(input: MonthSignalInput) {
  return input.entries.filter((entry) => entry.entryType === "expense" && Math.abs(entry.amountMinor) > 0);
}

function rows(input: MonthSignalInput, key?: string) {
  return input.planSections.filter((section) => !key || section.key === key).flatMap((section) => section.rows ?? []);
}

function isLinked(row: MonthSignalPlanRow) {
  return (row.linkedEntryCount ?? row.linkedEntryIds?.length ?? 0) > 0 || row.actualMinor !== 0;
}

function spend(input: MonthSignalInput) {
  return Math.max(0, input.summary?.realExpensesMinor ?? sum(expenses(input).map((entry) => Math.abs(entry.amountMinor))));
}

function plan(input: MonthSignalInput) {
  return Math.max(0, input.summary?.estimatedExpensesMinor ?? 0);
}

function phaseOf(input: MonthSignalInput): MonthPhase {
  return monthPhase(input.month, input.today);
}

function whenPhrase(input: MonthSignalInput) {
  return phaseOf(input) === "past" ? `in ${monthName(input.month)}` : "this month";
}

// Quick fix: planned bills dated before today with no entry linked.
export function unlinkedBillsSignal(input: MonthSignalInput): MoneySignal | null {
  if (phaseOf(input) === "ahead") {
    return null;
  }
  const due = rows(input, "planned_items")
    .filter((row) => row.planDate && row.planDate < input.today && row.plannedMinor > 0 && !isLinked(row))
    .sort((left, right) => String(left.planDate).localeCompare(String(right.planDate)));
  if (!due.length) {
    return null;
  }
  const totalMinor = sum(due.map((row) => row.plannedMinor));
  const total = input.formatMoney(totalMinor);
  return {
    key: "unlinked-bills",
    kind: "quick_fix",
    weight: totalMinor,
    numbers: { primaryMinor: totalMinor, count: due.length },
    phrasings: phrase(MONTH_COPY.unlinkedBills, { count: due.length, total, label: due[0].label || due[0].categoryName || "A planned bill" }, { one: due.length === 1 }),
    sorted: MONTH_COPY.unlinkedBills.sorted,
    topic: "later"
  };
}

// Bigger question: one or two large entries made up most of the month's
// spending over plan.
export function oneOffOverPlanSignal(input: MonthSignalInput): MoneySignal | null {
  const overMinor = spend(input) - plan(input);
  if (plan(input) <= 0 || overMinor <= 0) {
    return null;
  }
  const largest = [...expenses(input)].sort((left, right) => Math.abs(right.amountMinor) - Math.abs(left.amountMinor) || left.id.localeCompare(right.id));
  const items: MonthSignalEntry[] = [];
  let coveredMinor = 0;
  for (const entry of largest.slice(0, 2)) {
    if (Math.abs(entry.amountMinor) < overMinor * 0.2 || coveredMinor >= overMinor * 0.5) {
      break;
    }
    items.push(entry);
    coveredMinor += Math.abs(entry.amountMinor);
  }
  if (!items.length || coveredMinor < overMinor * 0.5) {
    return null;
  }
  const over = input.formatMoney(overMinor);
  const copy = MONTH_COPY.oneOffOverPlan;
  return {
    key: "one-off-over-plan",
    kind: "bigger_question",
    weight: overMinor,
    numbers: { primaryMinor: overMinor },
    primaryText: over,
    phrasings: phrase(copy, { items: joinWithAnd(items.map((entry) => tidyName(entry.description) || "one entry")), month: monthName(input.month), over }),
    action: { id: "show-entries", label: copy.action, entryIds: items.map((entry) => entry.id) }
  };
}

// Worth a look: the category budget furthest over its plan.
export function categoryOverPlanSignal(input: MonthSignalInput): MoneySignal | null {
  const row = rows(input, "budget_buckets")
    .filter((candidate) => candidate.plannedMinor > 0 && candidate.actualMinor - candidate.plannedMinor >= 100)
    .sort((left, right) => (right.actualMinor - right.plannedMinor) - (left.actualMinor - left.plannedMinor) || left.id.localeCompare(right.id))[0];
  if (!row) {
    return null;
  }
  const overMinor = row.actualMinor - row.plannedMinor;
  const label = row.label || row.categoryName || "A category";
  const over = input.formatMoney(overMinor);
  const copy = MONTH_COPY.categoryOverPlan;
  const categoryName = row.categoryName || label;
  return {
    key: `category-over-plan:${row.id}`,
    kind: "worth_a_look",
    weight: overMinor,
    numbers: { primaryMinor: overMinor },
    primaryText: over,
    phrasings: phrase(copy, { label, over, plan: compactMoney(input.formatMoney, row.plannedMinor), actual: input.formatMoney(row.actualMinor) }),
    action: { id: "open-category", label: copy.action.replace("{category}", categoryName), categoryName },
    topic: "plan"
  };
}

// Worth a look, a moment (a bonus): income well above its plan ($500 and
// 10% or more), not an ordinary pay rise.
export function incomeAbovePlanSignal(input: MonthSignalInput): MoneySignal | null {
  const plannedMinor = Math.max(0, input.summary?.plannedIncomeMinor ?? sum(input.incomeRows.map((row) => row.plannedMinor)));
  const actualMinor = Math.max(0, input.summary?.actualIncomeMinor ?? sum(input.incomeRows.map((row) => row.actualMinor)));
  const extraMinor = actualMinor - plannedMinor;
  if (plannedMinor <= 0 || extraMinor < Math.max(50_000, plannedMinor * 0.1)) {
    return null;
  }
  const extra = input.formatMoney(extraMinor);
  return {
    key: "income-above-plan",
    kind: "worth_a_look",
    weight: extraMinor,
    numbers: { primaryMinor: extraMinor },
    primaryText: extra,
    phrasings: phrase(MONTH_COPY.incomeAbovePlan, { extra, when: whenPhrase(input) }),
    topic: "later",
    moment: true
  };
}

// Going well, a moment (payday): income that arrived in the last few days
// of the month in progress.
export function incomeArrivedSignal(input: MonthSignalInput): MoneySignal | null {
  if (!["early", "mid", "late"].includes(phaseOf(input))) {
    return null;
  }
  const since = addDays(input.today, -3);
  const arrived = input.entries
    .filter((entry) => entry.entryType === "income" && entry.date >= since && entry.date <= input.today && entry.amountMinor > 0)
    .sort((left, right) => right.amountMinor - left.amountMinor || right.date.localeCompare(left.date))[0];
  if (!arrived) {
    return null;
  }
  const amount = input.formatMoney(arrived.amountMinor);
  return {
    key: `income-arrived:${arrived.date}`,
    kind: "going_well",
    weight: arrived.amountMinor,
    numbers: { primaryMinor: arrived.amountMinor },
    phrasings: phrase(MONTH_COPY.incomeArrived, { amount, day: shortDay(arrived.date) }),
    topic: "later",
    moment: true
  };
}

// Going well: plan still unspent (a wrap-up for a finished month).
export function planLeftSignal(input: MonthSignalInput): MoneySignal | null {
  const leftMinor = plan(input) - spend(input);
  if (plan(input) <= 0 || leftMinor <= 0) {
    return null;
  }
  const left = input.formatMoney(leftMinor);
  const isPast = phaseOf(input) === "past";
  return {
    key: "plan-left",
    kind: "going_well",
    weight: leftMinor,
    numbers: { primaryMinor: leftMinor },
    primaryText: left,
    phrasings: phrase(isPast ? MONTH_COPY.planLeftPast : MONTH_COPY.planLeft, { left, month: monthName(input.month) }),
    topic: "enjoy"
  };
}

// Going well: every savings row in the plan is met.
export function savingsOnPlanSignal(input: MonthSignalInput): MoneySignal | null {
  const savingsRows = rows(input).filter((row) => row.plannedMinor > 0 && (SAVINGS.test(row.categoryName ?? "") || SAVINGS.test(row.label ?? "")));
  if (!savingsRows.length || savingsRows.some((row) => row.actualMinor < row.plannedMinor)) {
    return null;
  }
  const savedMinor = sum(savingsRows.map((row) => row.actualMinor));
  const plannedMinor = sum(savingsRows.map((row) => row.plannedMinor));
  return {
    key: "savings-on-plan",
    kind: "going_well",
    weight: savedMinor,
    numbers: { primaryMinor: savedMinor },
    phrasings: phrase(MONTH_COPY.savingsOnPlan, {
      when: whenPhrase(input),
      saved: compactMoney(input.formatMoney, savedMinor),
      planned: compactMoney(input.formatMoney, plannedMinor)
    }),
    topic: "enjoy"
  };
}

function plannedBillsDueSoon(input: MonthSignalInput) {
  const until = addDays(input.today, 10);
  return rows(input, "planned_items")
    .filter((row) => row.planDate && row.planDate > input.today && row.planDate <= until && row.plannedMinor > 0 && !isLinked(row))
    .sort((left, right) => String(left.planDate).localeCompare(String(right.planDate)));
}

// Worth a look, early in the month: planned bills due in the next 10 days.
export function upcomingBillsSignal(input: MonthSignalInput): MoneySignal | null {
  if (phaseOf(input) !== "early") {
    return null;
  }
  const due = plannedBillsDueSoon(input);
  if (!due.length) {
    return null;
  }
  const totalMinor = sum(due.map((row) => row.plannedMinor));
  const total = input.formatMoney(totalMinor);
  return {
    key: "upcoming-bills",
    kind: "worth_a_look",
    weight: totalMinor,
    numbers: { primaryMinor: totalMinor, count: due.length },
    primaryText: total,
    phrasings: phrase(MONTH_COPY.upcomingBills, { count: due.length, total, label: due[0].label || due[0].categoryName || "a planned bill" }, { one: due.length === 1 }),
    topic: "plan",
    moment: true
  };
}

// Mid-month: spending against the plan and the calendar. Going well when
// it keeps pace, worth a look when it runs ahead (still under plan).
export function planPaceSignal(input: MonthSignalInput): MoneySignal | null {
  if (phaseOf(input) !== "mid" || plan(input) <= 0) {
    return null;
  }
  const spentMinor = spend(input);
  const leftMinor = plan(input) - spentMinor;
  if (leftMinor <= 0) {
    return null;
  }
  const day = Number(input.today.slice(8, 10));
  const total = daysInMonth(input.month);
  const steady = spentMinor <= plan(input) * (day / total);
  return {
    key: "plan-pace",
    kind: steady ? "going_well" : "worth_a_look",
    weight: leftMinor,
    numbers: { primaryMinor: spentMinor },
    phrasings: phrase(steady ? MONTH_COPY.paceSteady : MONTH_COPY.paceAhead, {
      spent: input.formatMoney(spentMinor),
      plan: compactMoney(input.formatMoney, plan(input)),
      left: input.formatMoney(leftMinor),
      days: total - day,
      month: monthName(input.month)
    }),
    topic: steady ? "steady" : "plan",
    moment: true
  };
}

// Long view: planned bills and subscriptions against the month's income.
export function fixedCostsSignal(input: MonthSignalInput): MoneySignal | null {
  const plannedMinor = sum(rows(input, "planned_items").map((row) => Math.max(0, row.plannedMinor)));
  const actualIncomeMinor = Math.max(0, input.summary?.actualIncomeMinor ?? 0);
  const incomeMinor = actualIncomeMinor > 0 ? actualIncomeMinor : Math.max(0, input.summary?.plannedIncomeMinor ?? 0);
  if (plannedMinor <= 0 || incomeMinor <= 0 || plannedMinor > incomeMinor) {
    return null;
  }
  return {
    key: "fixed-costs",
    kind: "long_view",
    weight: plannedMinor,
    numbers: { primaryMinor: plannedMinor },
    phrasings: phrase(MONTH_COPY.fixedCosts, {
      rate: Math.round((plannedMinor / incomeMinor) * 100),
      whose: phaseOf(input) === "past" ? `${monthName(input.month)}'s` : "this month's",
      planned: input.formatMoney(plannedMinor),
      income: input.formatMoney(incomeMinor)
    }),
    topic: "plan"
  };
}

// Just for fun: the place visited most often (at least 3 times).
export function regularSpotTrivia(input: MonthSignalInput): MoneySignal | null {
  const counts = new Map<string, number>();
  for (const entry of expenses(input)) {
    const name = tidyName(entry.description);
    if (name && !NOT_A_SPOT.test(entry.categoryName ?? "")) {
      counts.set(name, (counts.get(name) ?? 0) + 1);
    }
  }
  const [name, count] = [...counts.entries()].sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))[0] ?? ["", 0];
  return count >= 3 ? triviaSignal(`regular-spot:${name}`, MONTH_COPY.regularSpot, { name, count, month: monthName(input.month) }) : null;
}

// Just for fun: most dining out on one weekday.
export function weekdayPatternTrivia(input: MonthSignalInput): MoneySignal | null {
  const dining = expenses(input).filter((entry) => DINING.test(entry.categoryName ?? "") && weekdayIndex(entry.date) >= 0);
  if (dining.length < 3) {
    return null;
  }
  const counts = new Map<number, number>();
  for (const entry of dining) {
    counts.set(weekdayIndex(entry.date), (counts.get(weekdayIndex(entry.date)) ?? 0) + 1);
  }
  const [weekday, count] = [...counts.entries()].sort((left, right) => right[1] - left[1] || left[0] - right[0])[0];
  if (count < 3 || count / dining.length <= 0.5) {
    return null;
  }
  return triviaSignal(`weekday:${input.month}:${weekday}`, MONTH_COPY.weekdayPattern, { when: whenPhrase(input), weekday: weekdayNameOf(weekday) });
}

// Just for fun: days with no expense (so far, in the month in progress).
export function noSpendDaysTrivia(input: MonthSignalInput): MoneySignal | null {
  const phase = phaseOf(input);
  if (phase === "ahead") {
    return null;
  }
  const lastDay = phase === "past" ? daysInMonth(input.month) : Number(input.today.slice(8, 10));
  const spentDays = new Set(expenses(input).map((entry) => entry.date).filter((date) => date.startsWith(input.month)));
  const count = lastDay - [...spentDays].filter((date) => Number(date.slice(8, 10)) <= lastDay).length;
  if (count < 2 || spentDays.size === 0) {
    return null;
  }
  return triviaSignal(`no-spend:${input.month}:${count}`, phase === "past" ? MONTH_COPY.noSpendDays : MONTH_COPY.noSpendDaysSoFar, { count, month: monthName(input.month) });
}

// Just for fun: the date with the most spending, and its largest entry.
export function biggestDayTrivia(input: MonthSignalInput): MoneySignal | null {
  const byDate = new Map<string, MonthSignalEntry[]>();
  // Money set aside or moved is not a "biggest day".
  for (const entry of expenses(input).filter((item) => !/saving|invest|transfer/i.test(`${item.categoryName ?? ""} ${item.description ?? ""}`))) {
    byDate.set(entry.date, [...(byDate.get(entry.date) ?? []), entry]);
  }
  const [date, dayEntries] = [...byDate.entries()]
    .map(([day, items]) => [day, items, sum(items.map((item) => Math.abs(item.amountMinor)))] as const)
    .sort((left, right) => right[2] - left[2] || left[0].localeCompare(right[0]))[0] ?? [];
  if (!date || !dayEntries || byDate.size < 3) {
    return null;
  }
  const largest = [...dayEntries].sort((left, right) => Math.abs(right.amountMinor) - Math.abs(left.amountMinor))[0];
  const name = tidyName(largest.description);
  return name ? triviaSignal(`biggest-day:${date}`, MONTH_COPY.biggestDay, { day: shortDay(date), name }) : null;
}

export function buildMonthSignals(input: MonthSignalInput): MoneySignal[] {
  return [
    statementGapSignal({ accountPills: input.accountPills, audience: input.audience, viewLabel: input.viewLabel, formatMoney: input.formatMoney }),
    unlinkedBillsSignal(input),
    oneOffOverPlanSignal(input),
    categoryOverPlanSignal(input),
    incomeAbovePlanSignal(input),
    upcomingBillsSignal(input),
    planPaceSignal(input),
    incomeArrivedSignal(input),
    planLeftSignal(input),
    savingsOnPlanSignal(input),
    fixedCostsSignal(input),
    weekdayPatternTrivia(input),
    regularSpotTrivia(input),
    biggestDayTrivia(input),
    noSpendDaysTrivia(input)
  ].filter((signal): signal is MoneySignal => Boolean(signal));
}
