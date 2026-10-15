// Month's check-in signals, for one month in one view. Everything comes
// from what Month already loads: the view's entries, the plan rows with
// their linked entries, the income rows, the month's totals and the view's
// account pills. The time of month picks the moment: early looks ahead,
// mid-month looks at pace, late and past months wrap up. Month's Just for
// fun types are about the calendar and the plan (days, weeks, categories);
// Entries' are about the list, so the two never say the same thing.
import {
  addDays,
  amountLine,
  approxMoney,
  compactMoney,
  daysInMonth,
  joinWithAnd,
  lowerLabel,
  monthName,
  monthPhase,
  monthYear,
  numberWord,
  phrase,
  plural,
  shortDay,
  sum,
  textLine,
  tidyName,
  weekdayIndex,
  weekdayNameOf,
  type CopyCatalogue,
  type FormatMoney,
  type MonthPhase
} from "./format";
import { incomeMinor } from "../category-offset";
import { calmLinesFor } from "./calm-lines";
import type { TriviaRotation } from "./rotation";
import { bankChargesSignal, cardBillSignal, penaltyInterestSignal, statementGapSignal, triviaSignal, type WalletHealthPill } from "./shared-signals";
import { buildAccountSignals } from "./account-signals";
import type { Audience, MoneySignal } from "./types";
import { tripInOtherSignal } from "./trip-signal";

// The plan-balance lines point at the plan itself: the two ways to even it.
const PLAN_SHORTFALL_THINKS = [
  "Raising the income you expect, or trimming a budget line, brings the plan back to even.",
  "A plan that spends more than it brings in can't all happen. Raising the income you expect, or trimming a budget line, fixes that.",
  "Changing the plan now is easier than finding the gap at the end of the month.",
  "Either the income you expect is too low or a budget line is too high. If a bonus or extra pay is coming, adding it may close the gap."
];

const UNSPENT_PLAN_THINKS = ["Until it's spent, it can still go anywhere you choose.", "A small decision now keeps it from slipping away.", "You don't have to spend it just because you planned to."];

export const MONTH_COPY = {
  unlinkedBills: {
    phrasings: [
      "{count} bills you planned for {month}, {total} in all, aren't matched to a payment yet.",
      "{count} bills you planned for {month} were due by now, {total} in all, and none is matched to a payment yet.",
      "No payment is matched yet to {count} bills planned for {month}. They come to {total} and were due by now."
    ],
    phrasingsOne: [
      "{label}, a bill you planned for {month} at {total}, isn't matched to a payment yet.",
      "{label} was due by now, planned at {total}, and isn't matched to a payment yet.",
      "No payment is matched yet to {label}, the {total} bill you planned for {month}."
    ],
    think: [
      "They may still be coming, or they never went out. Matching each to its payment (\"linking\") shows which.",
      "Some may have gone out under a different name. Matching each bill to its payment (\"linking\") shows which are still to come.",
      "Once each bill is matched to its payment (\"linking\"), you can see what it really cost next to what you planned.",
      "A bill that hasn't turned up may be late, or cancelled. Matching each to its payment (\"linking\") makes the missing ones easy to spot."
    ],
    thinkOne: [
      "It may still be coming, or it never went out. Matching it to its payment (\"linking\") shows which.",
      "It may have gone out under a different name. Matching the bill to its payment (\"linking\") shows whether it's still to come.",
      "Once the bill is matched to its payment (\"linking\"), you can see what it really cost next to what you planned.",
      "A bill that hasn't turned up may be late, or cancelled. Matching it to its payment (\"linking\") settles which."
    ],
    sorted: {
      fact: "Sorted: every bill you planned so far is matched to its payment.",
      think: "Each one now shows what it really cost next to what you planned."
    }
  },
  planShortfall: {
    phrasings: [
      "In {month} you planned to spend {over} more than you expect to earn.",
      "Your {month} plan spends {over} more than it expects to earn.",
      "{month}'s plan spends {planned} but only expects {income} to come in, {over} less.",
      "The {month} plan doesn't balance: {planned} planned to go out, {income} expected to come in."
    ],
    think: PLAN_SHORTFALL_THINKS,
    sorted: {
      fact: "Sorted: the plan now covers what you planned to spend.",
      think: "The income you expect matches what you planned to spend."
    }
  },
  planShortfallSavings: {
    phrasings: [
      "Your {month} plan spends {over} more than it expects to earn, so only {kept} of the {goal} savings goal fits.",
      "In {month} you planned to spend {over} more than you expect to earn, which leaves room for only {kept} of the {goal} you planned to save.",
      "{month}'s plan spends {planned} against {income} of expected income, so only {kept} of the {goal} savings goal fits.",
      "The {month} plan is {over} short, so only {kept} of the {goal} you planned to save fits."
    ],
    think: PLAN_SHORTFALL_THINKS
  },
  oneOffOverPlan: {
    phrasings: [
      "{items} made up most of the {over} that {month} went past what you planned to spend.",
      "{month}'s spending came to {over} more than you planned, mostly from {items}.",
      "{month} went {over} past what you planned to spend. Most of that was {items}."
    ],
    think: [
      "Big one-offs happen. Was it truly a one-off, or something to plan for next year?",
      "One big cost can make a whole month look different. The rest of the month may be right on track.",
      "A rare treat, or a cost that comes round each year?",
      "Big costs often have a season. Planning for the next one makes it feel lighter."
    ],
    action: "Show these costs"
  },
  categoryOverPlan: {
    phrasings: [
      "{label} came to {actual}, {over} more than the {plan} you planned.",
      "You planned {plan} for {label}, and {actual} has gone on it.",
      "{label} spending went {over} past the {plan} you planned for it."
    ],
    think: [
      "If it was worth it, raise next month's plan. If not, next month starts fresh.",
      "Going over in one category isn't a verdict. It shows where real life and the plan differ.",
      "A plan is a guess made in advance. Changing the plan or the spending are both fine, as long as it's a choice.",
      "A plan that matches real life is easier to keep. This shows where to adjust it."
    ],
    action: "Review {category}"
  },
  incomeAbovePlan: {
    phrasings: [
      "Income {when} was {extra} more than you planned.",
      "{extra} more than you planned arrived {when}.",
      "More money came in than you planned {when}: {extra} extra."
    ],
    think: [
      "Extra money blends into everyday spending quickly. Deciding early how much to put aside leaves the rest to enjoy on purpose.",
      "Decide where extra income goes: some for later, some to enjoy.",
      "A bonus month is the easiest time to move some money toward a goal.",
      "Deciding early where extra money goes makes it feel like more."
    ]
  },
  incomeArrived: {
    phrasings: [
      "{amount} of income came in on {day}.",
      "Payday: {amount} came in on {day}.",
      "{amount} landed on {day}."
    ],
    think: [
      "Payday is the easiest moment to decide where money goes, before it blends into the month.",
      "Right after payday is when a plan is easiest to follow.",
      "Setting savings aside first makes the rest of the month simpler.",
      "A few minutes now, deciding where it goes, saves second-guessing later."
    ]
  },
  planLeft: {
    phrasings: [
      "{left} of what you planned to spend this month hasn't been spent yet.",
      { fact: "{left} is still left to spend in this month's plan. It's worth deciding what it's for.", think: UNSPENT_PLAN_THINKS },
      { fact: "You have {left} left in this month's plan. Savings, next month, or something you've been looking forward to?", think: UNSPENT_PLAN_THINKS },
      { fact: "So far you've spent {left} less than you planned. Nice. Deciding where it goes now keeps it a choice.", think: UNSPENT_PLAN_THINKS }
    ],
    think: [
      "Until it's spent, it can still go anywhere: savings, next month, or something you've been looking forward to.",
      "Deciding what it's for is easier now than at the end of the month.",
      "Deciding before the month ends keeps it from quietly disappearing into everyday spending."
    ]
  },
  planLeftPast: {
    phrasings: [
      "{month} finished {left} under what you planned to spend.",
      "You spent {left} less than you planned in {month}.",
      "{month} came in {left} under your plan."
    ],
    think: [
      "That money isn't set aside for anything yet. It can go to savings or carry into next month.",
      "Spending less than planned leaves a difference. Deciding where it goes makes it count.",
      "Months like this give the next one a head start.",
      "If the difference is still in your account, moving it to savings keeps it from being spent by accident."
    ]
  },
  savingsOnPlan: {
    phrasings: [
      "You saved what you planned {when}.",
      "{saved} went to savings {when}, as planned.",
      "You planned to save {planned} and saved {saved}."
    ],
    think: [
      "With savings covered, spending on what you enjoy is part of the plan, not a slip from it.",
      "Saving first makes everything else simpler.",
      "Savings are covered this month, so the rest of the plan is for spending.",
      "Saving what you planned is the part that builds up over time."
    ]
  },
  upcomingBills: {
    phrasings: [
      "{count} bills you planned are due in the next 10 days, {total} in all.",
      "Coming up in the next 10 days: {count} planned bills, {total} in all.",
      "{total} in planned bills goes out over the next 10 days."
    ],
    phrasingsOne: [
      "1 bill you planned is due in the next 10 days: {label}, {total}.",
      "Coming up in the next 10 days: {label}, {total}.",
      "{total} goes out for {label} in the next 10 days."
    ],
    think: [
      "A fresh month is the easiest time to set things up. Anything to move or cancel before it goes out?",
      "Knowing what's coming makes the rest of the month easier to plan.",
      "A quick look now avoids surprises later in the month.",
      "Bills due soon are easiest to change before they go out."
    ]
  },
  paceSteady: {
    phrasings: [
      "{spent} of the {plan} you planned is spent, with {days} days of {month} to go.",
      "Mid-month: {spent} spent so far, out of the {plan} you planned for {month}.",
      "{left} of the {plan} you planned is still left for the last {days} days of {month}."
    ],
    think: [
      "Spending is on pace with what you planned. A calm middle of the month usually makes for a calm end.",
      "On pace so far, so the plan is working as intended.",
      "Steady spending now leaves room for the unexpected later.",
      "Nothing needs changing. The month is going as planned."
    ]
  },
  paceAhead: {
    phrasings: [
      "{spent} of the {plan} you planned is spent, with {days} days of {month} to go.",
      "Mid-month: {spent} spent so far, out of the {plan} you planned for {month}.",
      "{left} of the {plan} you planned is still left for the last {days} days of {month}."
    ],
    think: [
      "That's a bit faster than the days gone by. Nothing is fixed yet. The rest of the month decides where it lands.",
      "Some months run ahead early. The second half often evens it out.",
      "Running a little ahead is a nudge to glance at what's still planned, nothing more.",
      "There's still money left in the plan. Knowing the pace now keeps the rest of the month a choice."
    ]
  },
  fixedCosts: {
    phrasings: [
      "Bills and subscriptions in your plan take {rate}% of {whose} income ({planned}).",
      "{planned} of {whose} {income} income is already spoken for by planned bills and subscriptions.",
      "Planned bills and subscriptions come to {planned}, out of {income} of income."
    ],
    think: [
      "\"Fixed costs\", the bills and subscriptions that come every month, set how much room is left. The lower they are, the more freedom for everything else.",
      "\"Fixed costs\" (bills and subscriptions that come every month) mostly decide themselves. Knowing their size helps with every other choice.",
      "What's left after \"fixed costs\", the bills that come every month, is where most choices happen.",
      "\"Fixed costs\", the bills that come every month, rarely change. So any change there lasts month after month."
    ]
  },
  regularSpot: {
    phrasings: ["Your regular spot: {name}, {count} visits in {month}."],
    think: ""
  },
  quietWeekday: {
    phrasings: ["{weekday} was the quietest day of the week {when}."],
    think: ""
  },
  weekdayPattern: {
    phrasings: ["Most of your dining out {when} happened on {weekday}s."],
    think: ""
  },
  busiestWeekday: {
    phrasings: ["{weekday} was the busiest day of the week {when}, with spending recorded {count} times."],
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
  longestRun: {
    phrasings: ["Longest stretch without spending {when}: {count} days, {start} to {end}."],
    think: ""
  },
  biggestDay: {
    phrasings: ["Your biggest spending day was {day}, led by {name}."],
    think: ""
  },
  busiestWeek: {
    phrasings: ["The week starting {day} was the biggest {when}, with {amount} spent."],
    think: ""
  },
  halfway: {
    phrasings: ["Half of all spending {when} was done by {day}."],
    think: ""
  },
  dayAverage: {
    phrasings: ["Spending {when} averaged about {amount} a day."],
    think: ""
  },
  weekendShare: {
    phrasings: ["Weekends {when} came to {amount}, about one in every {fraction} dollars spent."],
    think: ""
  },
  categoryShare: {
    phrasings: ["{category} took about one in every {fraction} dollars spent {when}."],
    think: ""
  },
  topTwoCategories: {
    phrasings: ["{top} and {second} were the two biggest spending categories {when}."],
    think: ""
  },
  categoriesCount: {
    phrasings: ["Spending {when} spread across {count} categories."],
    think: ""
  },
  categoryDays: {
    phrasings: ["You spent on {category} on {count} different days {when}."],
    think: ""
  },
  categoryLargest: {
    phrasings: ["The biggest single amount spent on {category} {when}: {name}, {amount}."],
    think: ""
  },
  planCount: {
    phrasings: ["Your plan for {month} has {parts}."],
    think: ""
  },
  biggestBill: {
    phrasings: ["The biggest bill in your plan {when}: {label}, {amount}."],
    think: ""
  }
} satisfies CopyCatalogue;

export function monthCalmLine(month: string) {
  return `Nothing in ${monthName(month)} needs a look right now.`;
}

export function monthCalmLines(month: string) {
  return calmLinesFor(monthName(month), monthCalmLine(month));
}

// Month's year of Just for fun: twelve columns, one per month number,
// each a type and (for most) a reserve. See rotation.ts for the rule.
export const MONTH_TRIVIA_ROTATION: TriviaRotation = {
  columns: [
    ["regular-spot", "quiet-weekday"],
    ["no-spend-days"],
    ["biggest-day"],
    ["longest-run", "plan-count"],
    ["weekend-share"],
    ["category-share", "dining-weekday"],
    ["busiest-weekday", "category-days"],
    ["halfway"],
    ["categories-count"],
    ["busiest-week", "category-largest"],
    ["day-average"],
    ["biggest-bill", "top-two-categories"]
  ]
};

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
const UNCATEGORIZED = /^(other|uncategori[sz]ed)?$/i;
// Places visited out of routine rather than choice: not a "regular spot".
const NOT_FUN_DAY = /saving|invest|transfer|insurance|giro|bill|utilit|loan|mortgage|rent|tax/i;
const NOT_A_SPOT = /transport|transfer|bill|utilit|subscription|insurance|rent|mortgage|loan|saving|invest|tax|salary|income/i;
const MIN_SPENDING = 3;
// A category budget is notable when it is over its plan by at least this
// share of the plan and this much money; a few dollars over is steady
// (shown under Also only).
export const CATEGORY_OVER_RATIO = 0.1;
export const CATEGORY_OVER_MINOR = 2_000;
// A month's plan is out of balance when its planned spend (savings rows
// included) is above its planned income by more than this share of that
// income and this much money, whichever is larger.
export const PLAN_SHORTFALL_RATIO = 0.02;
export const PLAN_SHORTFALL_MINOR = 5_000;
// At most this many rows of a list (bills, savings lines) as basis lines.
const BASIS_ROWS = 6;

function expenses(input: MonthSignalInput) {
  return input.entries.filter((entry) => entry.entryType === "expense" && Math.abs(entry.amountMinor) > 0);
}

function amountOf(entry: MonthSignalEntry) {
  return Math.abs(entry.amountMinor);
}

function rows(input: MonthSignalInput, key?: string) {
  return input.planSections.filter((section) => !key || section.key === key).flatMap((section) => section.rows ?? []);
}

function isLinked(row: MonthSignalPlanRow) {
  return (row.linkedEntryCount ?? row.linkedEntryIds?.length ?? 0) > 0 || row.actualMinor !== 0;
}

function spend(input: MonthSignalInput) {
  return Math.max(0, input.summary?.realExpensesMinor ?? sum(expenses(input).map(amountOf)));
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

// The last day of the month that has happened: the month's end, or today
// in the month in progress; 0 for a month ahead.
function lastDayOf(input: MonthSignalInput) {
  const phase = phaseOf(input);
  return phase === "ahead" ? 0 : phase === "past" ? daysInMonth(input.month) : Number(input.today.slice(8, 10));
}

function dayDate(input: MonthSignalInput, day: number) {
  return `${input.month}-${String(day).padStart(2, "0")}`;
}

function totalsBy<K>(items: MonthSignalEntry[], keyOf: (entry: MonthSignalEntry) => K | undefined) {
  const totals = new Map<K, { totalMinor: number; count: number }>();
  for (const entry of items) {
    const key = keyOf(entry);
    if (key === undefined || key === "") {
      continue;
    }
    const current = totals.get(key) ?? { totalMinor: 0, count: 0 };
    current.totalMinor += amountOf(entry);
    current.count += 1;
    totals.set(key, current);
  }
  return totals;
}

function namedCategory(entry: MonthSignalEntry) {
  const name = String(entry.categoryName ?? "").trim();
  return UNCATEGORIZED.test(name) ? undefined : name;
}

// Categories by money spent, largest first (never Other).
function categoryRanking(input: MonthSignalInput) {
  return [...totalsBy(expenses(input), namedCategory).entries()]
    .sort((left, right) => right[1].totalMinor - left[1].totalMinor || left[0].localeCompare(right[0]));
}

// A share as "one in every N dollars", between one in two and one in
// twelve; null outside that range.
function oneInEvery(partMinor: number, totalMinor: number) {
  if (partMinor <= 0 || totalMinor <= 0) {
    return null;
  }
  const fraction = Math.round(totalMinor / partMinor);
  return fraction >= 2 && fraction <= 12 ? numberWord(fraction) : null;
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
    phrasings: phrase(MONTH_COPY.unlinkedBills, { count: due.length, total, month: monthName(input.month), label: due[0].label || due[0].categoryName || "a planned bill" }, { one: due.length === 1 }),
    sorted: MONTH_COPY.unlinkedBills.sorted,
    basis: {
      lines: [
        ...due.slice(0, BASIS_ROWS).map((row) => amountLine(`${row.label || row.categoryName || "Planned bill"}, planned for ${shortDay(String(row.planDate))}`, row.plannedMinor)),
        amountLine("Planned bills not matched to a payment yet", totalMinor)
      ],
      month: input.month
    },
    topic: "later"
  };
}

// Quick fix: the month's plan spends more than the income it expects. The
// savings rows are part of the planned spend (the Month cards' "Remaining
// budget" is planned income minus planned spend), so the goal is never
// added a second time. Skipped for a finished month, whose plan is history,
// and for a month with no income planned.
export function planShortfallSignal(input: MonthSignalInput): MoneySignal | null {
  if (phaseOf(input) === "past") {
    return null;
  }
  const planRows = rows(input);
  const plannedMinor = sum(planRows.map((row) => row.plannedMinor));
  const incomeMinor = sum(input.incomeRows.map((row) => row.plannedMinor));
  const shortMinor = plannedMinor - incomeMinor;
  if (plannedMinor <= 0 || incomeMinor <= 0 || shortMinor <= Math.max(PLAN_SHORTFALL_MINOR, Math.round(incomeMinor * PLAN_SHORTFALL_RATIO))) {
    return null;
  }
  const goalMinor = sum(planRows.filter((row) => row.label === "Savings").map((row) => row.plannedMinor));
  // Part of the goal still fits only while the shortfall is smaller than it.
  const copy = goalMinor > shortMinor ? MONTH_COPY.planShortfallSavings : MONTH_COPY.planShortfall;
  const over = input.formatMoney(shortMinor);
  return {
    key: "plan-shortfall",
    kind: "quick_fix",
    weight: shortMinor,
    numbers: { primaryMinor: shortMinor, plannedMinor, incomeMinor },
    primaryText: over,
    phrasings: phrase(copy, {
      month: monthName(input.month),
      over,
      planned: input.formatMoney(plannedMinor),
      income: input.formatMoney(incomeMinor),
      kept: input.formatMoney(goalMinor - shortMinor),
      goal: input.formatMoney(goalMinor)
    }),
    sorted: MONTH_COPY.planShortfall.sorted,
    basis: {
      lines: [
        textLine("Month", monthYear(input.month)),
        amountLine("Planned spending, savings included", plannedMinor),
        amountLine("Income you expect", incomeMinor),
        amountLine("Plan spends more than it expects by", shortMinor),
        ...(goalMinor > 0 ? [amountLine("Savings goal in the plan", goalMinor)] : [])
      ],
      month: input.month
    },
    topic: "plan"
  };
}

// Bigger question: one or two large entries made up most of the month's
// spending over plan.
export function oneOffOverPlanSignal(input: MonthSignalInput): MoneySignal | null {
  const overMinor = spend(input) - plan(input);
  if (plan(input) <= 0 || overMinor <= 0) {
    return null;
  }
  const largest = [...expenses(input)].sort((left, right) => amountOf(right) - amountOf(left) || left.id.localeCompare(right.id));
  const items: MonthSignalEntry[] = [];
  let coveredMinor = 0;
  for (const entry of largest.slice(0, 2)) {
    if (amountOf(entry) < overMinor * 0.2 || coveredMinor >= overMinor * 0.5) {
      break;
    }
    items.push(entry);
    coveredMinor += amountOf(entry);
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
    action: { id: "show-entries", label: copy.action, entryIds: items.map((entry) => entry.id) },
    basis: {
      lines: [
        amountLine(`Spent in ${monthYear(input.month)}`, spend(input)),
        amountLine("Planned spending", plan(input)),
        amountLine("Over the plan by", overMinor),
        ...items.map((entry) => amountLine(`${tidyName(entry.description) || "One entry"} on ${shortDay(entry.date)}`, amountOf(entry)))
      ],
      entries: { entryIds: items.map((entry) => entry.id), month: input.month },
      month: input.month
    }
  };
}

// Worth a look: the category budget furthest over its plan. Steady unless
// it is 10% and $20 over (CATEGORY_OVER_RATIO, CATEGORY_OVER_MINOR).
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
    numbers: { primaryMinor: overMinor, plannedMinor: row.plannedMinor },
    steady: overMinor < CATEGORY_OVER_MINOR || overMinor < row.plannedMinor * CATEGORY_OVER_RATIO,
    primaryText: over,
    phrasings: phrase(copy, { label, over, plan: compactMoney(input.formatMoney, row.plannedMinor), actual: input.formatMoney(row.actualMinor) }),
    action: { id: "open-category", label: copy.action.replace("{category}", categoryName), categoryName },
    basis: {
      lines: [
        textLine("Plan line", label),
        amountLine(`Planned for ${monthYear(input.month)}`, row.plannedMinor),
        amountLine("Spent", row.actualMinor),
        amountLine("Over the plan by", overMinor)
      ],
      entries: { categoryName, month: input.month, type: "expense" },
      month: input.month
    },
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
    basis: {
      lines: [
        amountLine(`Income planned for ${monthYear(input.month)}`, plannedMinor),
        amountLine("Income that came in", actualMinor),
        amountLine("More than planned by", extraMinor)
      ],
      entries: { type: "income", month: input.month },
      month: input.month
    },
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
    .filter((entry) => incomeMinor(entry) > 0 && entry.date >= since && entry.date <= input.today && entry.amountMinor > 0)
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
    basis: {
      lines: [amountLine(`${tidyName(arrived.description) || arrived.categoryName || "Income"} on ${shortDay(arrived.date)}`, arrived.amountMinor)],
      entries: { entryIds: [arrived.id], month: input.month },
      month: input.month
    },
    topic: "later",
    moment: true
  };
}

// Going well: plan still unspent (a wrap-up for a finished month). Steady:
// true every month for a household that keeps to its plan, so it leads in
// the second month of each quarter and waits under Also otherwise.
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
    steady: true,
    turn: 1,
    primaryText: left,
    phrasings: phrase(isPast ? MONTH_COPY.planLeftPast : MONTH_COPY.planLeft, { left, month: monthName(input.month) }),
    basis: {
      lines: [
        amountLine(`Planned spending for ${monthYear(input.month)}`, plan(input)),
        amountLine("Spent", spend(input)),
        amountLine("Plan not spent", leftMinor)
      ],
      month: input.month
    },
    topic: "enjoy"
  };
}

// Going well: every savings row in the plan is met. Steady, like plan
// left, leading in the last month of each quarter.
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
    steady: true,
    turn: 2,
    phrasings: phrase(MONTH_COPY.savingsOnPlan, {
      when: whenPhrase(input),
      saved: compactMoney(input.formatMoney, savedMinor),
      planned: compactMoney(input.formatMoney, plannedMinor)
    }),
    basis: {
      lines: [
        ...savingsRows.slice(0, BASIS_ROWS).map((row) => amountLine(`${row.label || row.categoryName || "Savings"}, planned ${compactMoney(input.formatMoney, row.plannedMinor)}`, row.actualMinor)),
        amountLine(`Saved in ${monthYear(input.month)}`, savedMinor),
        amountLine("Planned to save", plannedMinor)
      ],
      month: input.month
    },
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
    basis: {
      lines: [
        ...due.slice(0, BASIS_ROWS).map((row) => amountLine(`${row.label || row.categoryName || "Planned bill"}, planned for ${shortDay(String(row.planDate))}`, row.plannedMinor)),
        amountLine("Planned bills in the next 10 days", totalMinor)
      ],
      month: input.month
    },
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
    basis: {
      lines: [
        amountLine(`Spent so far in ${monthYear(input.month)}`, spentMinor),
        amountLine("Planned spending", plan(input)),
        amountLine("Plan left", leftMinor),
        textLine("Days left in the month", total - day)
      ],
      entries: { type: "expense", month: input.month },
      month: input.month
    },
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
  return count >= 3 ? triviaSignal("regular-spot", name, MONTH_COPY.regularSpot, { name, count, month: monthName(input.month) }) : null;
}

// Entries per weekday, for the weekdays the month has reached.
function weekdayCounts(input: MonthSignalInput, items: MonthSignalEntry[]) {
  const counts = new Map<number, number>();
  for (let day = 1; day <= lastDayOf(input); day += 1) {
    counts.set(weekdayIndex(dayDate(input, day)), 0);
  }
  for (const entry of items) {
    const weekday = weekdayIndex(entry.date);
    if (counts.has(weekday)) {
      counts.set(weekday, (counts.get(weekday) ?? 0) + 1);
    }
  }
  return [...counts.entries()];
}

// Just for fun: the weekday with the fewest entries, once the month has
// reached every weekday (no tie).
export function quietWeekdayTrivia(input: MonthSignalInput): MoneySignal | null {
  const counts = weekdayCounts(input, expenses(input)).sort((left, right) => left[1] - right[1]);
  if (counts.length < 7 || counts[0][1] === counts[1][1] || expenses(input).length < MIN_SPENDING) {
    return null;
  }
  return triviaSignal("quiet-weekday", String(counts[0][0]), MONTH_COPY.quietWeekday, { weekday: weekdayNameOf(counts[0][0]), when: whenPhrase(input) });
}

// Just for fun: the weekday with the most entries (no tie).
export function busiestWeekdayTrivia(input: MonthSignalInput): MoneySignal | null {
  const counts = weekdayCounts(input, expenses(input)).sort((left, right) => right[1] - left[1]);
  if (counts.length < 2 || counts[0][1] === counts[1][1] || counts[0][1] < 2) {
    return null;
  }
  return triviaSignal("busiest-weekday", String(counts[0][0]), MONTH_COPY.busiestWeekday, { weekday: weekdayNameOf(counts[0][0]), count: counts[0][1], when: whenPhrase(input) });
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
  return triviaSignal("dining-weekday", String(weekday), MONTH_COPY.weekdayPattern, { when: whenPhrase(input), weekday: weekdayNameOf(weekday) });
}

function spendingDays(input: MonthSignalInput) {
  return new Set(expenses(input).map((entry) => entry.date).filter((date) => date.startsWith(input.month) && Number(date.slice(8, 10)) <= lastDayOf(input)));
}

// Just for fun: days with no expense (so far, in the month in progress).
export function noSpendDaysTrivia(input: MonthSignalInput): MoneySignal | null {
  const spentDays = spendingDays(input);
  const count = lastDayOf(input) - spentDays.size;
  if (!lastDayOf(input) || count < 2 || spentDays.size === 0) {
    return null;
  }
  return triviaSignal("no-spend-days", input.month, phaseOf(input) === "past" ? MONTH_COPY.noSpendDays : MONTH_COPY.noSpendDaysSoFar, { count, month: monthName(input.month) });
}

// Just for fun: the longest run of days in a row with nothing spent (the
// earliest, when two are as long).
export function longestRunTrivia(input: MonthSignalInput): MoneySignal | null {
  const spentDays = spendingDays(input);
  if (spentDays.size === 0) {
    return null;
  }
  let best = { start: 0, length: 0 };
  let start = 0;
  for (let day = 1; day <= lastDayOf(input) + 1; day += 1) {
    const quiet = day <= lastDayOf(input) && !spentDays.has(dayDate(input, day));
    if (quiet && !start) {
      start = day;
    }
    if (!quiet && start) {
      if (day - start > best.length) {
        best = { start, length: day - start };
      }
      start = 0;
    }
  }
  if (best.length < 2) {
    return null;
  }
  return triviaSignal("longest-run", dayDate(input, best.start), MONTH_COPY.longestRun, {
    count: best.length,
    start: shortDay(dayDate(input, best.start)),
    end: shortDay(dayDate(input, best.start + best.length - 1)),
    when: whenPhrase(input)
  });
}

// Just for fun: the date with the most spending, and its largest entry.
export function biggestDayTrivia(input: MonthSignalInput): MoneySignal | null {
  const byDate = new Map<string, MonthSignalEntry[]>();
  // Money set aside or moved, and routine obligations, are not a fun
  // "biggest day".
  for (const entry of expenses(input).filter((item) => !NOT_FUN_DAY.test(`${item.categoryName ?? ""} ${item.description ?? ""}`))) {
    byDate.set(entry.date, [...(byDate.get(entry.date) ?? []), entry]);
  }
  const [date, dayEntries] = [...byDate.entries()]
    .map(([day, items]) => [day, items, sum(items.map(amountOf))] as const)
    .sort((left, right) => right[2] - left[2] || left[0].localeCompare(right[0]))[0] ?? [];
  if (!date || !dayEntries || byDate.size < 3) {
    return null;
  }
  const largest = dayEntries
    .map((entry) => ({ entry, name: tidyName(entry.description) }))
    .filter((item) => item.name)
    .sort((left, right) => amountOf(right.entry) - amountOf(left.entry))[0];
  return largest ? triviaSignal("biggest-day", date, MONTH_COPY.biggestDay, { day: shortDay(date), name: largest.name }) : null;
}

// Just for fun: the week (Monday to Sunday, within the month) with the
// most spending.
export function busiestWeekTrivia(input: MonthSignalInput): MoneySignal | null {
  const byWeek = new Map<number, number>();
  for (const entry of expenses(input).filter((item) => item.date.startsWith(input.month))) {
    const day = Number(entry.date.slice(8, 10));
    const weekStart = Math.max(1, day - ((weekdayIndex(entry.date) + 6) % 7));
    byWeek.set(weekStart, (byWeek.get(weekStart) ?? 0) + amountOf(entry));
  }
  const [top, next] = [...byWeek.entries()].sort((left, right) => right[1] - left[1] || left[0] - right[0]);
  if (!top || !next || top[1] === next[1]) {
    return null;
  }
  return triviaSignal("busiest-week", dayDate(input, top[0]), MONTH_COPY.busiestWeek, {
    day: shortDay(dayDate(input, top[0])),
    amount: approxMoney(input.formatMoney, top[1]),
    when: whenPhrase(input)
  });
}

// Just for fun: the date by which half of the month's spending had gone.
export function halfwayTrivia(input: MonthSignalInput): MoneySignal | null {
  const list = [...expenses(input)].sort((left, right) => left.date.localeCompare(right.date));
  const totalMinor = sum(list.map(amountOf));
  if (list.length < MIN_SPENDING || new Set(list.map((entry) => entry.date)).size < 2) {
    return null;
  }
  let runningMinor = 0;
  const halfway = list.find((entry) => {
    runningMinor += amountOf(entry);
    return runningMinor * 2 >= totalMinor;
  });
  return halfway ? triviaSignal("halfway", halfway.date, MONTH_COPY.halfway, { day: shortDay(halfway.date), when: whenPhrase(input) }) : null;
}

// Just for fun: the average spending per day of the month so far.
export function dayAverageTrivia(input: MonthSignalInput): MoneySignal | null {
  const totalMinor = sum(expenses(input).map(amountOf));
  if (expenses(input).length < MIN_SPENDING || !lastDayOf(input) || totalMinor < 100) {
    return null;
  }
  return triviaSignal("day-average", input.month, MONTH_COPY.dayAverage, { amount: approxMoney(input.formatMoney, totalMinor / lastDayOf(input)), when: whenPhrase(input) });
}

// Just for fun: weekend spending as "one in every N dollars".
export function weekendShareTrivia(input: MonthSignalInput): MoneySignal | null {
  const list = expenses(input);
  const weekendMinor = sum(list.filter((entry) => [0, 6].includes(weekdayIndex(entry.date))).map(amountOf));
  const fraction = oneInEvery(weekendMinor, sum(list.map(amountOf)));
  if (!fraction || list.length < MIN_SPENDING) {
    return null;
  }
  return triviaSignal("weekend-share", input.month, MONTH_COPY.weekendShare, { amount: input.formatMoney(weekendMinor), fraction, when: whenPhrase(input) });
}

// Just for fun: the biggest everyday category (not a bill, loan or
// savings) as "one in every N dollars".
export function categoryShareTrivia(input: MonthSignalInput): MoneySignal | null {
  const ranking = categoryRanking(input);
  const totalMinor = sum(ranking.map(([, item]) => item.totalMinor));
  const top = ranking.find(([label]) => !NOT_FUN_DAY.test(label));
  const fraction = top ? oneInEvery(top[1].totalMinor, totalMinor) : null;
  if (!top || !fraction) {
    return null;
  }
  return triviaSignal("category-share", top[0], MONTH_COPY.categoryShare, { category: top[0], fraction, when: whenPhrase(input) });
}

// Just for fun: the month's two biggest everyday categories (not bills,
// insurance, loans, rent, tax or savings).
export function topTwoCategoriesTrivia(input: MonthSignalInput): MoneySignal | null {
  const [top, second] = categoryRanking(input).filter(([label]) => !NOT_FUN_DAY.test(label));
  if (!top || !second || top[1].totalMinor === second[1].totalMinor) {
    return null;
  }
  return triviaSignal("top-two-categories", `${top[0]}:${second[0]}`, MONTH_COPY.topTwoCategories, { top: lowerLabel(top[0]), second: lowerLabel(second[0]), when: whenPhrase(input) });
}

// Just for fun: how many categories the month's spending touched.
export function categoriesCountTrivia(input: MonthSignalInput): MoneySignal | null {
  const count = categoryRanking(input).length;
  return count >= 3 ? triviaSignal("categories-count", input.month, MONTH_COPY.categoriesCount, { count, when: whenPhrase(input) }) : null;
}

// Just for fun: the category that showed up on the most different days.
export function categoryDaysTrivia(input: MonthSignalInput): MoneySignal | null {
  const days = new Map<string, Set<string>>();
  for (const entry of expenses(input)) {
    const category = namedCategory(entry);
    if (category) {
      days.set(category, new Set([...(days.get(category) ?? []), entry.date]));
    }
  }
  const [top] = [...days.entries()].sort((left, right) => right[1].size - left[1].size || left[0].localeCompare(right[0]));
  if (!top || top[1].size < 3) {
    return null;
  }
  return triviaSignal("category-days", top[0], MONTH_COPY.categoryDays, { category: top[0], count: top[1].size, when: whenPhrase(input) });
}

// Just for fun: the largest entry of the biggest everyday category.
export function categoryLargestTrivia(input: MonthSignalInput): MoneySignal | null {
  const top = categoryRanking(input).find(([label]) => !NOT_FUN_DAY.test(label));
  const largest = top && expenses(input)
    .filter((entry) => namedCategory(entry) === top[0])
    .map((entry) => ({ entry, name: tidyName(entry.description) }))
    .filter((item) => item.name)
    .sort((left, right) => amountOf(right.entry) - amountOf(left.entry) || left.entry.id.localeCompare(right.entry.id))[0];
  if (!top || !largest || top[1].count < 2) {
    return null;
  }
  return triviaSignal("category-largest", largest.entry.id, MONTH_COPY.categoryLargest, {
    category: lowerLabel(top[0]),
    name: largest.name,
    amount: input.formatMoney(amountOf(largest.entry)),
    when: whenPhrase(input)
  });
}

// Just for fun: how many planned bills and category budgets the plan has.
export function planCountTrivia(input: MonthSignalInput): MoneySignal | null {
  const bills = rows(input, "planned_items").filter((row) => row.plannedMinor > 0).length;
  const budgets = rows(input, "budget_buckets").filter((row) => row.plannedMinor > 0).length;
  const parts = [
    bills ? plural(bills, "planned bill", "planned bills") : "",
    budgets ? plural(budgets, "category budget", "category budgets") : ""
  ].filter(Boolean);
  if (bills + budgets < 2) {
    return null;
  }
  return triviaSignal("plan-count", input.month, MONTH_COPY.planCount, { parts: joinWithAnd(parts), month: monthName(input.month) });
}

// Just for fun: the largest planned bill.
export function biggestBillTrivia(input: MonthSignalInput): MoneySignal | null {
  const bills = rows(input, "planned_items").filter((row) => row.plannedMinor > 0 && (row.label || row.categoryName));
  const [top, next] = [...bills].sort((left, right) => right.plannedMinor - left.plannedMinor);
  if (!top || !next || top.plannedMinor === next.plannedMinor) {
    return null;
  }
  return triviaSignal("biggest-bill", top.id, MONTH_COPY.biggestBill, { label: top.label || top.categoryName || "", amount: input.formatMoney(top.plannedMinor), when: whenPhrase(input) });
}

export function buildMonthSignals(input: MonthSignalInput): MoneySignal[] {
  // The month's own bigger question leads ahead of a wallet's statement
  // gap, which is about the account rather than this month.
  const statementGap = statementGapSignal({ accountPills: input.accountPills, audience: input.audience, viewLabel: input.viewLabel, formatMoney: input.formatMoney });
  const accountSignalInput = { accountPills: input.accountPills, audience: input.audience, viewLabel: input.viewLabel, today: input.today, formatMoney: input.formatMoney };
  return [
    statementGap ? { ...statementGap, yieldsToBiggerQuestion: true } : null,
    cardBillSignal(accountSignalInput),
    bankChargesSignal(accountSignalInput),
    penaltyInterestSignal(accountSignalInput),
    // About the account rather than this month, like the statement gap.
    ...buildAccountSignals(accountSignalInput).map((signal) => ({ ...signal, yieldsToBiggerQuestion: true })),
    tripInOtherSignal({ entries: input.entries, formatMoney: input.formatMoney }),
    unlinkedBillsSignal(input),
    planShortfallSignal(input),
    oneOffOverPlanSignal(input),
    categoryOverPlanSignal(input),
    incomeAbovePlanSignal(input),
    upcomingBillsSignal(input),
    planPaceSignal(input),
    incomeArrivedSignal(input),
    planLeftSignal(input),
    savingsOnPlanSignal(input),
    fixedCostsSignal(input),
    regularSpotTrivia(input),
    quietWeekdayTrivia(input),
    busiestWeekdayTrivia(input),
    weekdayPatternTrivia(input),
    noSpendDaysTrivia(input),
    longestRunTrivia(input),
    biggestDayTrivia(input),
    busiestWeekTrivia(input),
    halfwayTrivia(input),
    dayAverageTrivia(input),
    weekendShareTrivia(input),
    categoryShareTrivia(input),
    topTwoCategoriesTrivia(input),
    categoriesCountTrivia(input),
    categoryDaysTrivia(input),
    categoryLargestTrivia(input),
    planCountTrivia(input),
    biggestBillTrivia(input)
  ].filter((signal): signal is MoneySignal => Boolean(signal));
}
