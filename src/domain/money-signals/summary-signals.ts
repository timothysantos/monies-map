// Summary's check-in signals, over the selected range. Everything comes
// from what Summary already loads: per-month totals, category totals per
// month, and the view's account pills (joined to the reference account
// kinds for the cushion). No extra month is fetched: the same-season line
// shows only when last year's month is already in the range.
import {
  addMonths,
  approxMoney,
  compactMoney,
  daysInMonth,
  lowerLabel,
  monthName,
  monthYear,
  monthsBetween,
  numberWord,
  phrase,
  sum,
  type CopyCatalogue,
  type FormatMoney
} from "./format";
import { calmLinesFor } from "./calm-lines";
import type { TriviaRotation } from "./rotation";
import { statementGapSignal, triviaSignal, type WalletHealthPill } from "./shared-signals";
import type { Audience, MoneySignal } from "./types";

export const SUMMARY_COPY = {
  spendingAboveIncome: {
    phrasings: [
      "Spending has been above income for {count} months running.",
      "For {count} months running, more went out than came in: {gap} in all.",
      "The last {count} months each spent more than came in, {gap} altogether."
    ],
    think: [
      "Changing one category is easier than changing everything. Which one matters least to you?",
      "Streaks like this often come from one or two big items. Knowing which ones makes the next step clearer.",
      "A few months like this can happen for good reasons. Worth a calm look at whether it was planned.",
      "One category usually carries most of a streak like this. Starting there keeps it simple."
    ]
  },
  categoryCreep: {
    phrasings: [
      "{category} has risen {count} months in a row and is {above} above its {window}-month average.",
      "{category} is {above} above its usual month, after {count} rises in a row.",
      "{count} months ago {category} was {then}; now it's {now}."
    ],
    think: [
      "Rises like this usually happen without anyone deciding. If it's spending you enjoy, keep it; just make it a choice.",
      "Gradual rises are easy to miss month to month. Seeing the trend is the useful part.",
      "Some rises simply follow a change in life. Worth asking whether this one does.",
      "A rising category is worth one question: is this still the amount you'd choose?"
    ]
  },
  subscriptions: {
    phrasings: [
      "Subscriptions came to {amount} in {month}, about {yearly} a year.",
      {
        fact: "{yearly} a year goes to subscriptions. Still using all of them?",
        think: [
          "Automatic payments are easy to stop noticing.",
          "The ones used every week are easy to keep.",
          "A quick look once a year keeps the list current.",
          "Each one only needs to earn its place."
        ]
      },
      "Your subscriptions cost about {daily} a day."
    ],
    think: [
      "Automatic payments are easy to stop noticing. Judge each one by its yearly cost.",
      "A subscription that still earns its place is money well spent. The yearly cost makes that easy to judge.",
      "Once a year is a good rhythm for checking which ones you still use.",
      "Small monthly amounts look different at their yearly cost. That view makes each one easier to judge."
    ]
  },
  monthsUnderPlan: {
    phrasings: [
      "{under} of the last {total} months came in under plan.",
      "Under plan in {under} of the last {total} months, {saved} below plan in all.",
      "{saved} stayed inside the plan across {under} of the last {total} months."
    ],
    think: [
      "Consistency matters more than any single month. This is what a working plan looks like.",
      "Months like these are the plan doing its job. That's worth noticing.",
      "A plan that holds most months is a plan that fits your life.",
      "Staying under plan this often leaves room for the things you care about."
    ]
  },
  keepRate: {
    phrasings: [
      "Over the last {count} months {subject} kept {rate}% of what came in ({kept}).",
      "For every {ten} that came in over the last {count} months, about {stayed} stayed.",
      {
        fact: "{kept} kept over the last {count} months. One heavy month barely moves that.",
        think: [
          "The year is the fairer scorecard.",
          "That's the steady part that builds up.",
          "Month to month it moves; the year shows the pattern.",
          "Over time, that's what gives plans room."
        ]
      },
      "Kept over the last {count} months: {kept}, about {rate}% of what came in."
    ],
    think: [
      "One heavy month barely moves a year; the year is the fairer scorecard.",
      "What stays over a year is the number that builds up over time.",
      "Month to month it moves around; over a year the pattern shows.",
      "Keeping some of each month's income is what gives future plans room."
    ]
  },
  cushion: {
    phrasings: [
      "Bank balances would cover about {months} of your usual spending.",
      "At your usual spending of about {usual} a month, bank balances would last about {months}.",
      "{balance} in bank accounts is about {months} of your usual spending."
    ],
    think: [
      "A cushion turns surprises into inconveniences. How big feels right is your call.",
      "A cushion gives room to handle the unexpected calmly. How much is enough is yours to decide.",
      "Months of cover is a simple way to see how much room you have.",
      "Knowing the number is the useful part; the right size depends on your life."
    ]
  },
  sameSeason: {
    phrasings: [
      "{month} spending was about {diff} {direction} than {month} last year.",
      "Compared with {month} last year, spending was about {diff} {direction}.",
      "{month} last year: {then}. This {month}: {now}."
    ],
    think: [
      "The same month last year is the fair comparison: holidays, bonuses and school terms line up.",
      "Comparing like with like takes the seasons out of the picture.",
      "A year apart, the same month shows what really changed.",
      "Seasonal costs repeat. Last year's month is a gentle guide to this one."
    ]
  },
  chineseNewYear: {
    phrasings: [
      "Chinese New Year falls in {cnyMonth}. Last year's Chinese New Year month, {lastMonth}, came to {amount} of spending.",
      "Last Chinese New Year month, {lastMonth}, spending came to {amount}. This year's falls in {cnyMonth}.",
      "{amount}: what {lastMonth}, last year's Chinese New Year month, came to."
    ],
    think: [
      "Festive months have their own shape. Knowing last year's helps this one feel planned rather than surprising.",
      "Festive months come round every year. Last year's number makes this one easier to plan.",
      "Reunion dinners, red packets and visits add up. Last year's month is a useful guide.",
      "Knowing roughly what the season costs lets you enjoy it without surprises."
    ]
  },
  categoryFraction: {
    phrasings: ["About one in every {fraction} dollars in {month} went to {category}."],
    think: ""
  },
  halfOfSpending: {
    phrasings: ["{count} categories made up half of {month}'s spending."],
    think: ""
  },
  lastYearTop: {
    phrasings: ["A year ago, {category} was your biggest category."],
    think: ""
  },
  everyMonthCategory: {
    phrasings: ["{category} showed up in all {count} months of this range, about {amount} a month on average."],
    think: ""
  },
  mostEntriesMonth: {
    phrasings: ["The month with the most entries in this range: {month}, with {count}."],
    think: ""
  },
  quietestMonth: {
    phrasings: ["The quietest month for spending in this range: {month}, at {amount}."],
    think: ""
  },
  biggestMonth: {
    phrasings: ["The biggest month for spending in this range: {month}, at {amount}."],
    think: ""
  },
  averageMonth: {
    phrasings: ["An average month in this range came to about {amount} of spending."],
    think: ""
  },
  weeklyCategory: {
    phrasings: ["{category} came to about {amount} a week across this range."],
    think: ""
  },
  categoriesCount: {
    phrasings: ["{count} different categories show up across this range."],
    think: ""
  },
  topCategoryMonths: {
    phrasings: ["{category} was the biggest category in {count} of the {total} months here."],
    think: ""
  },
  topCategoryEntries: {
    phrasings: ["{category} had the most entries in {month}: {count}."],
    think: ""
  },
  entriesTotal: {
    phrasings: ["This range in numbers: {count} entries across {months} months."],
    think: ""
  },
  mostIncomeMonth: {
    phrasings: ["The most money came in during {month}: {amount}."],
    think: ""
  },
  categoryPeak: {
    phrasings: ["The biggest single category month in this range: {category} in {month}, at {amount}."],
    think: ""
  },
  dailyAverage: {
    phrasings: ["Across this range, spending averaged about {amount} a day."],
    think: ""
  },
  rangeTotal: {
    phrasings: ["Spending across this range came to about {amount} over {months} months."],
    think: ""
  },
  rangeShare: {
    phrasings: ["{category} took about one in every {fraction} dollars across this range."],
    think: ""
  },
  secondCategory: {
    phrasings: ["{category} came second across this range, after {top}."],
    think: ""
  },
  incomeMonths: {
    phrasings: ["Income came in during {count} of the {total} months here."],
    think: ""
  },
  yearRecap: {
    phrasings: ["{year} in numbers: {entries} entries, and {category} was the biggest category."],
    think: ""
  },
  anniversary: {
    phrasings: ["{years} of Monie's Map: your first month here was {firstMonth}."],
    think: ""
  }
} satisfies CopyCatalogue;

export const SUMMARY_CALM_LINE = "Nothing in this range needs a look right now.";
export const SUMMARY_CALM_LINES = calmLinesFor("this range", SUMMARY_CALM_LINE);

// Summary's year of Just for fun, by the range's last month: twelve
// columns, one per month number, each a type and (for some) a reserve. A
// year recap (a range ending in December) and an anniversary (a range
// ending this month, a whole number of years after the first month) are
// moments: each fires in at most one period of any twelve. See rotation.ts.
export const SUMMARY_TRIVIA_ROTATION: TriviaRotation = {
  columns: [
    ["category-fraction"],
    ["every-month-category", "range-total"],
    ["most-entries-month", "last-year-top", "income-months"],
    ["quietest-month", "daily-average"],
    ["weekly-category"],
    ["categories-count", "top-category-entries"],
    ["biggest-month", "second-category"],
    ["top-category-months"],
    ["entries-total"],
    ["average-month"],
    ["most-income-month", "category-peak", "range-share"],
    ["half-of-spending"]
  ],
  moments: ["year-recap", "anniversary"]
};

export interface SummarySignalMonth {
  month: string;
  plannedIncomeMinor?: number;
  actualIncomeMinor?: number;
  estimatedExpensesMinor?: number;
  realExpensesMinor?: number;
}

export interface SummarySignalInput {
  audience: Audience;
  viewLabel: string;
  today: string;
  // The focus month, or "" for the whole range.
  focusMonth: string;
  months: SummarySignalMonth[];
  categoryShareByMonth: Array<{ month: string; data: Array<{ label: string; valueMinor: number; entryCount?: number }> }>;
  accountPills: WalletHealthPill[];
  accountKinds: Record<string, string>;
  availableMonths: string[];
  formatMoney: FormatMoney;
}

const MIN_STREAK = 3;
const CREEP_MIN_ABOVE_MINOR = 5_000;
// Subscriptions are notable when the month's total moved by this much from
// the month before (either one): a new or cancelled subscription, a price
// change. Otherwise they take their turn once a quarter.
export const SUBSCRIPTIONS_CHANGE_RATIO = 0.1;
export const SUBSCRIPTIONS_CHANGE_MINOR = 2_000;
const NOT_LIFESTYLE = /saving|invest|transfer/i;
const NOT_FUN = /loan|mortgage|rent|housing|insurance|tax|saving|invest|transfer|bill|utilit/i;

// Chinese New Year dates from the lunar calendar, 2024 to 2035.
const CHINESE_NEW_YEAR: Record<number, string> = {
  2024: "2024-02-10", 2025: "2025-01-29", 2026: "2026-02-17", 2027: "2027-02-06", 2028: "2028-01-26", 2029: "2029-02-13",
  2030: "2030-02-03", 2031: "2031-01-23", 2032: "2032-02-11", 2033: "2033-01-31", 2034: "2034-02-19", 2035: "2035-02-08"
};

function completeMonths(input: SummarySignalInput) {
  const currentMonth = input.today.slice(0, 7);
  return [...input.months]
    .filter((month) => month.month < currentMonth)
    .sort((left, right) => left.month.localeCompare(right.month));
}

// The month the month-level lines talk about: the focus month, or the
// latest complete month of the range.
function targetMonth(input: SummarySignalInput) {
  if (input.focusMonth) {
    return input.focusMonth;
  }
  return completeMonths(input).at(-1)?.month ?? [...input.months].sort((left, right) => left.month.localeCompare(right.month)).at(-1)?.month ?? "";
}

function spendOf(month: SummarySignalMonth | undefined) {
  return Math.max(0, month?.realExpensesMinor ?? 0);
}

function categoryTotals(input: SummarySignalInput, month: string) {
  return (input.categoryShareByMonth.find((item) => item.month === month)?.data ?? [])
    .filter((item) => item.valueMinor > 0)
    .sort((left, right) => right.valueMinor - left.valueMinor || left.label.localeCompare(right.label));
}

// Bigger question: the latest complete months in a row spent more than came
// in (only once the range records income at all).
export function spendingAboveIncomeSignal(input: SummarySignalInput): MoneySignal | null {
  const months = completeMonths(input);
  if (!months.some((month) => (month.actualIncomeMinor ?? 0) > 0)) {
    return null;
  }
  let count = 0;
  let gapMinor = 0;
  for (let index = months.length - 1; index >= 0; index -= 1) {
    const month = months[index];
    const gap = spendOf(month) - Math.max(0, month.actualIncomeMinor ?? 0);
    if (gap <= 0) {
      break;
    }
    count += 1;
    gapMinor += gap;
  }
  if (count < MIN_STREAK) {
    return null;
  }
  const gap = input.formatMoney(gapMinor);
  return {
    key: "spending-above-income",
    kind: "bigger_question",
    weight: gapMinor,
    numbers: { primaryMinor: gapMinor, count },
    primaryText: gap,
    phrasings: phrase(SUMMARY_COPY.spendingAboveIncome, { count, gap })
  };
}

// Worth a look: a category that rose several complete months in a row and
// now sits well above its average.
export function categoryCreepSignal(input: SummarySignalInput): MoneySignal | null {
  const months = completeMonths(input).map((month) => month.month).slice(-13);
  if (months.length < MIN_STREAK + 2) {
    return null;
  }
  const labels = new Set(months.flatMap((month) => categoryTotals(input, month).map((item) => item.label)));
  let best: { label: string; count: number; aboveMinor: number; window: number; thenMinor: number; nowMinor: number } | null = null;
  for (const label of labels) {
    if (NOT_LIFESTYLE.test(label)) {
      continue;
    }
    const series = months.map((month) => categoryTotals(input, month).find((item) => item.label === label)?.valueMinor ?? 0);
    const last = series.length - 1;
    let count = 0;
    while (last - count - 1 >= 0 && series[last - count] > series[last - count - 1]) {
      count += 1;
    }
    const history = series.slice(0, last);
    if (count < MIN_STREAK || history.length < MIN_STREAK) {
      continue;
    }
    const averageMinor = Math.round(sum(history) / history.length);
    const aboveMinor = series[last] - averageMinor;
    if (aboveMinor < CREEP_MIN_ABOVE_MINOR || (best && aboveMinor <= best.aboveMinor)) {
      continue;
    }
    best = { label, count, aboveMinor, window: history.length, thenMinor: series[last - count], nowMinor: series[last] };
  }
  if (!best) {
    return null;
  }
  return {
    key: `category-creep:${best.label}`,
    kind: "worth_a_look",
    weight: best.aboveMinor,
    numbers: { primaryMinor: best.aboveMinor, count: best.count },
    primaryText: approxMoney(input.formatMoney, best.aboveMinor),
    phrasings: phrase(SUMMARY_COPY.categoryCreep, {
      category: best.label,
      count: best.count,
      above: approxMoney(input.formatMoney, best.aboveMinor),
      window: best.window,
      then: approxMoney(input.formatMoney, best.thenMinor),
      now: approxMoney(input.formatMoney, best.nowMinor)
    }),
    topic: "change"
  };
}

function subscriptionsIn(input: SummarySignalInput, month: string) {
  return sum(categoryTotals(input, month)
    .filter((item) => /subscription/i.test(item.label))
    .map((item) => item.valueMinor));
}

// Worth a look: subscriptions in the month, at their yearly cost. Notable
// when they changed from the month before (10% or $20), when that month is
// loaded with spending of its own; otherwise steady, leading only in the
// last month of each quarter.
export function subscriptionsSignal(input: SummarySignalInput): MoneySignal | null {
  const month = targetMonth(input);
  const amountMinor = subscriptionsIn(input, month);
  if (!month || amountMinor <= 0) {
    return null;
  }
  const previousMonth = addMonths(month, -1);
  const previousKnown = categoryTotals(input, previousMonth).length > 0;
  const previousMinor = previousKnown ? subscriptionsIn(input, previousMonth) : null;
  const changeMinor = previousMinor === null ? 0 : Math.abs(amountMinor - previousMinor);
  const changed = previousMinor !== null
    && (previousMinor === 0 || changeMinor >= SUBSCRIPTIONS_CHANGE_MINOR || changeMinor / previousMinor >= SUBSCRIPTIONS_CHANGE_RATIO);
  const yearlyMinor = amountMinor * 12;
  const amount = input.formatMoney(amountMinor);
  return {
    key: "subscriptions",
    kind: "worth_a_look",
    weight: yearlyMinor,
    numbers: { primaryMinor: amountMinor, ...(previousMinor === null ? {} : { previousMinor }) },
    steady: !changed,
    turn: 2,
    primaryText: amount,
    phrasings: phrase(SUMMARY_COPY.subscriptions, {
      amount,
      month: monthName(month),
      yearly: approxMoney(input.formatMoney, yearlyMinor),
      daily: input.formatMoney(Math.round(yearlyMinor / 365))
    }),
    topic: "small-costs"
  };
}

// Going well: most of the last (up to) 12 complete months came in under
// their spending plan. Steady (true month after month for a household that
// keeps to its plan), leading in the first month of each quarter; notable
// when the latest month came back under plan after one over it.
export function monthsUnderPlanSignal(input: SummarySignalInput): MoneySignal | null {
  const planned = completeMonths(input).filter((month) => (month.estimatedExpensesMinor ?? 0) > 0).slice(-12);
  const under = planned.filter((month) => spendOf(month) <= (month.estimatedExpensesMinor ?? 0));
  if (planned.length < MIN_STREAK || under.length < Math.max(MIN_STREAK, Math.ceil(planned.length * 2 / 3))) {
    return null;
  }
  const savedMinor = sum(under.map((month) => (month.estimatedExpensesMinor ?? 0) - spendOf(month)));
  const saved = input.formatMoney(savedMinor);
  const isUnder = (month: SummarySignalMonth | undefined) => Boolean(month) && spendOf(month) <= (month?.estimatedExpensesMinor ?? 0);
  const backUnder = planned.length >= 2 && isUnder(planned.at(-1)) && !isUnder(planned.at(-2));
  return {
    key: "months-under-plan",
    kind: "going_well",
    weight: savedMinor,
    numbers: { primaryMinor: savedMinor, under: under.length, total: planned.length, backUnder: backUnder ? 1 : 0 },
    steady: !backUnder,
    turn: 0,
    primaryText: saved,
    phrasings: phrase(SUMMARY_COPY.monthsUnderPlan, { under: under.length, total: planned.length, saved }),
    topic: "steady"
  };
}

// Long view: the share of income kept over the last (up to) 12 complete
// months.
export function keepRateSignal(input: SummarySignalInput): MoneySignal | null {
  const months = completeMonths(input).slice(-12);
  const incomeMinor = sum(months.map((month) => Math.max(0, month.actualIncomeMinor ?? 0)));
  const keptMinor = incomeMinor - sum(months.map(spendOf));
  if (months.length < MIN_STREAK || incomeMinor <= 0 || keptMinor <= 0) {
    return null;
  }
  const rate = Math.round((keptMinor / incomeMinor) * 100);
  const stayed = Math.round(rate / 10);
  const kept = input.formatMoney(keptMinor);
  const phrasings = phrase(SUMMARY_COPY.keepRate, {
    count: months.length,
    subject: input.audience === "person" ? "you" : "the household",
    rate,
    kept,
    ten: compactMoney(input.formatMoney, 1_000),
    stayed: compactMoney(input.formatMoney, stayed * 100)
  });
  return {
    key: "keep-rate",
    kind: "long_view",
    weight: keptMinor,
    numbers: { primaryMinor: keptMinor, rate },
    primaryText: kept,
    // "about $0 stayed" says nothing, so that phrasing waits for $1 in $10.
    phrasings: stayed >= 1 ? phrasings : phrasings.filter((_phrasing, index) => index !== 1),
    topic: "keep"
  };
}

// Long view (Summary only): how many months of usual spending the bank
// accounts' balances would cover. Bank accounts only, never cards; usual
// spending is the average actual spend of the range's complete months.
export function cushionSignal(input: SummarySignalInput): MoneySignal | null {
  const balanceMinor = sum(input.accountPills
    .filter((pill) => input.accountKinds[pill.accountId] === "bank")
    .map((pill) => pill.balanceMinor ?? 0));
  const spendingMonths = completeMonths(input).filter((month) => spendOf(month) > 0);
  const months = spendingMonths.length ? spendingMonths : input.months.filter((month) => spendOf(month) > 0);
  if (balanceMinor <= 0 || !months.length) {
    return null;
  }
  const usualMinor = Math.round(sum(months.map(spendOf)) / months.length);
  const count = Math.round(balanceMinor / usualMinor);
  if (count < 1) {
    return null;
  }
  return {
    key: "cushion",
    kind: "long_view",
    weight: balanceMinor,
    numbers: { primaryMinor: balanceMinor, count },
    phrasings: phrase(SUMMARY_COPY.cushion, {
      months: count === 1 ? "1 month" : `${count} months`,
      usual: approxMoney(input.formatMoney, usualMinor),
      balance: approxMoney(input.formatMoney, balanceMinor)
    }),
    topic: "enough"
  };
}

// Long view: the month against the same month last year, when both are in
// the range and the month is complete.
export function sameSeasonSignal(input: SummarySignalInput): MoneySignal | null {
  const month = targetMonth(input);
  if (!month || month >= input.today.slice(0, 7)) {
    return null;
  }
  const current = input.months.find((item) => item.month === month);
  const lastYear = input.months.find((item) => item.month === addMonths(month, -12));
  if (!current || !lastYear || spendOf(lastYear) <= 0 || spendOf(current) <= 0) {
    return null;
  }
  const diffMinor = spendOf(current) - spendOf(lastYear);
  if (Math.abs(diffMinor) < 100) {
    return null;
  }
  return {
    key: "same-season",
    kind: "long_view",
    weight: Math.abs(diffMinor),
    numbers: { primaryMinor: diffMinor },
    phrasings: phrase(SUMMARY_COPY.sameSeason, {
      month: monthName(month),
      diff: approxMoney(input.formatMoney, Math.abs(diffMinor)),
      direction: diffMinor < 0 ? "lower" : "higher",
      then: input.formatMoney(spendOf(lastYear)),
      now: input.formatMoney(spendOf(current))
    }),
    topic: "change"
  };
}

// Long view, seasonal: in the month before or of Chinese New Year, last
// year's Chinese New Year month, when it is in the range.
export function chineseNewYearSignal(input: SummarySignalInput): MoneySignal | null {
  const currentMonth = input.today.slice(0, 7);
  const year = Number(input.today.slice(0, 4));
  const upcoming = [CHINESE_NEW_YEAR[year], CHINESE_NEW_YEAR[year + 1]]
    .find((date) => date && monthsBetween(currentMonth, date.slice(0, 7)) >= 0 && monthsBetween(currentMonth, date.slice(0, 7)) <= 1);
  if (!upcoming) {
    return null;
  }
  const lastDate = CHINESE_NEW_YEAR[Number(upcoming.slice(0, 4)) - 1];
  const lastMonth = input.months.find((month) => month.month === lastDate?.slice(0, 7));
  if (!lastMonth || spendOf(lastMonth) <= 0) {
    return null;
  }
  const amount = input.formatMoney(spendOf(lastMonth));
  return {
    key: `chinese-new-year:${upcoming.slice(0, 4)}`,
    kind: "long_view",
    weight: spendOf(lastMonth),
    numbers: { primaryMinor: spendOf(lastMonth) },
    phrasings: phrase(SUMMARY_COPY.chineseNewYear, { cnyMonth: monthName(upcoming.slice(0, 7)), lastMonth: monthYear(lastMonth.month), amount }),
    topic: "plan",
    moment: true
  };
}

// The range's last month: the period Summary's rotation follows.
function rangeEnd(input: SummarySignalInput) {
  return [...input.months].map((month) => month.month).sort().at(-1) ?? "";
}

// Category totals across the range's complete months.
function rangeCategoryTotals(input: SummarySignalInput) {
  const totals = new Map<string, { valueMinor: number; entryCount: number; months: number }>();
  for (const month of completeMonths(input)) {
    for (const item of categoryTotals(input, month.month)) {
      const current = totals.get(item.label) ?? { valueMinor: 0, entryCount: 0, months: 0 };
      current.valueMinor += item.valueMinor;
      current.entryCount += Number(item.entryCount ?? 0);
      current.months += 1;
      totals.set(item.label, current);
    }
  }
  return [...totals.entries()].sort((left, right) => right[1].valueMinor - left[1].valueMinor || left[0].localeCompare(right[0]));
}

const isOther = (label: string) => /^(other|uncategori[sz]ed)$/i.test(label);

// The single highest item by a value, or null when two share it.
function uniqueMax<T>(items: T[], valueOf: (item: T) => number): T | null {
  const sorted = [...items].sort((left, right) => valueOf(right) - valueOf(left));
  return sorted[0] && (!sorted[1] || valueOf(sorted[1]) !== valueOf(sorted[0])) ? sorted[0] : null;
}

function uniqueMin<T>(items: T[], valueOf: (item: T) => number): T | null {
  return uniqueMax(items, (item) => -valueOf(item));
}

// Just for fun: the month's biggest category as a plain fraction (12.1% is
// about one in every eight dollars).
export function categoryFractionTrivia(input: SummarySignalInput): MoneySignal | null {
  const month = targetMonth(input);
  const totals = categoryTotals(input, month);
  const totalMinor = sum(totals.map((item) => item.valueMinor));
  // Other says nothing, and a routine obligation (a loan, rent, insurance)
  // is not a fun fact.
  const top = totals.find((item) => !isOther(item.label) && !NOT_FUN.test(item.label));
  if (!top || totalMinor <= 0) {
    return null;
  }
  const share = top.valueMinor / totalMinor;
  const fraction = Math.round(1 / share);
  if (share > 0.5 || fraction < 2 || fraction > 12) {
    return null;
  }
  return triviaSignal("category-fraction", `${month}:${top.label}`, SUMMARY_COPY.categoryFraction, {
    fraction: numberWord(fraction),
    month: monthName(month),
    category: lowerLabel(top.label)
  }, { weight: top.valueMinor });
}

// Just for fun: how few categories made up half of the month's spending.
export function halfOfSpendingTrivia(input: SummarySignalInput): MoneySignal | null {
  const month = targetMonth(input);
  const totals = categoryTotals(input, month);
  const totalMinor = sum(totals.map((item) => item.valueMinor));
  let runningMinor = 0;
  const count = totals.findIndex((item) => {
    runningMinor += item.valueMinor;
    return runningMinor * 2 >= totalMinor;
  }) + 1;
  if (totalMinor <= 0 || count < 2 || count >= totals.length) {
    return null;
  }
  return triviaSignal("half-of-spending", month, SUMMARY_COPY.halfOfSpending, { count: numberWord(count), month: monthName(month) });
}

// Just for fun: the biggest category of the same month last year, when it
// is in the range.
export function lastYearTopTrivia(input: SummarySignalInput): MoneySignal | null {
  const month = targetMonth(input);
  const top = month ? categoryTotals(input, addMonths(month, -12))[0] : undefined;
  if (!top) {
    return null;
  }
  return triviaSignal("last-year-top", month, SUMMARY_COPY.lastYearTop, { category: top.label }, { weight: top.valueMinor });
}

// Just for fun: of the categories in every complete month, the steadiest
// one (the least spread around its average).
export function everyMonthCategoryTrivia(input: SummarySignalInput): MoneySignal | null {
  const months = completeMonths(input);
  if (months.length < MIN_STREAK) {
    return null;
  }
  // Everyday categories only: a fixed bill is steady by design.
  const [steadiest] = rangeCategoryTotals(input)
    .filter(([label, item]) => item.months === months.length && !isOther(label) && !NOT_FUN.test(label) && !/subscription/i.test(label))
    .map(([label]) => {
      const series = months.map((month) => categoryTotals(input, month.month).find((item) => item.label === label)?.valueMinor ?? 0);
      const averageMinor = sum(series) / series.length;
      const spread = Math.sqrt(sum(series.map((value) => (value - averageMinor) ** 2)) / series.length) / averageMinor;
      return { label, averageMinor, spread };
    })
    .sort((left, right) => left.spread - right.spread || right.averageMinor - left.averageMinor || left.label.localeCompare(right.label));
  if (!steadiest) {
    return null;
  }
  return triviaSignal("every-month-category", steadiest.label, SUMMARY_COPY.everyMonthCategory, {
    category: steadiest.label,
    count: months.length,
    amount: approxMoney(input.formatMoney, steadiest.averageMinor)
  });
}

function monthEntryCount(input: SummarySignalInput, month: string) {
  return sum(categoryTotals(input, month).map((item) => Number(item.entryCount ?? 0)));
}

// Just for fun: the complete month with the most entries.
export function mostEntriesMonthTrivia(input: SummarySignalInput): MoneySignal | null {
  const months = completeMonths(input).map((month) => ({ month: month.month, count: monthEntryCount(input, month.month) })).filter((item) => item.count > 0);
  const top = months.length >= MIN_STREAK ? uniqueMax(months, (item) => item.count) : null;
  return top ? triviaSignal("most-entries-month", top.month, SUMMARY_COPY.mostEntriesMonth, { month: monthYear(top.month), count: top.count }) : null;
}

// Just for fun: the complete month with the least spending.
export function quietestMonthTrivia(input: SummarySignalInput): MoneySignal | null {
  const months = completeMonths(input).filter((month) => spendOf(month) > 0);
  const quietest = months.length >= MIN_STREAK ? uniqueMin(months, spendOf) : null;
  return quietest ? triviaSignal("quietest-month", quietest.month, SUMMARY_COPY.quietestMonth, { month: monthYear(quietest.month), amount: input.formatMoney(spendOf(quietest)) }) : null;
}

// Just for fun: the complete month with the most spending.
export function biggestMonthTrivia(input: SummarySignalInput): MoneySignal | null {
  const months = completeMonths(input).filter((month) => spendOf(month) > 0);
  const biggest = months.length >= MIN_STREAK ? uniqueMax(months, spendOf) : null;
  return biggest ? triviaSignal("biggest-month", biggest.month, SUMMARY_COPY.biggestMonth, { month: monthYear(biggest.month), amount: input.formatMoney(spendOf(biggest)) }) : null;
}

// Just for fun: an average complete month's spending.
export function averageMonthTrivia(input: SummarySignalInput): MoneySignal | null {
  const months = completeMonths(input).filter((month) => spendOf(month) > 0);
  if (months.length < MIN_STREAK) {
    return null;
  }
  return triviaSignal("average-month", rangeEnd(input), SUMMARY_COPY.averageMonth, { amount: approxMoney(input.formatMoney, sum(months.map(spendOf)) / months.length) });
}

// Just for fun: the range's biggest everyday category, per week.
export function weeklyCategoryTrivia(input: SummarySignalInput): MoneySignal | null {
  const months = completeMonths(input);
  const top = rangeCategoryTotals(input).find(([label]) => !isOther(label) && !NOT_FUN.test(label));
  if (months.length < MIN_STREAK || !top) {
    return null;
  }
  const days = sum(months.map((month) => daysInMonth(month.month)));
  return triviaSignal("weekly-category", top[0], SUMMARY_COPY.weeklyCategory, { category: top[0], amount: approxMoney(input.formatMoney, (top[1].valueMinor / days) * 7) });
}

// Just for fun: how many categories the range's complete months used.
export function categoriesCountTrivia(input: SummarySignalInput): MoneySignal | null {
  const count = rangeCategoryTotals(input).filter(([label]) => !isOther(label)).length;
  return completeMonths(input).length >= 2 && count >= MIN_STREAK ? triviaSignal("categories-count", rangeEnd(input), SUMMARY_COPY.categoriesCount, { count }) : null;
}

// Just for fun: the category that was biggest in the most months.
export function topCategoryMonthsTrivia(input: SummarySignalInput): MoneySignal | null {
  const months = completeMonths(input);
  const wins = new Map<string, number>();
  for (const month of months) {
    const top = categoryTotals(input, month.month)[0];
    if (top) {
      wins.set(top.label, (wins.get(top.label) ?? 0) + 1);
    }
  }
  const top = uniqueMax([...wins.entries()], ([, count]) => count);
  if (!top || top[1] < 2 || months.length < MIN_STREAK) {
    return null;
  }
  return triviaSignal("top-category-months", top[0], SUMMARY_COPY.topCategoryMonths, { category: top[0], count: top[1], total: months.length });
}

// Just for fun: the category with the most entries in the month.
export function topCategoryEntriesTrivia(input: SummarySignalInput): MoneySignal | null {
  const month = targetMonth(input);
  const top = uniqueMax(categoryTotals(input, month).filter((item) => !isOther(item.label) && Number(item.entryCount ?? 0) >= 2), (item) => Number(item.entryCount ?? 0));
  return top ? triviaSignal("top-category-entries", `${month}:${top.label}`, SUMMARY_COPY.topCategoryEntries, { category: top.label, month: monthName(month), count: Number(top.entryCount) }) : null;
}

// Just for fun: the range's entries in numbers.
export function entriesTotalTrivia(input: SummarySignalInput): MoneySignal | null {
  const months = completeMonths(input);
  const count = sum(months.map((month) => monthEntryCount(input, month.month)));
  return months.length >= 2 && count > 0
    ? triviaSignal("entries-total", rangeEnd(input), SUMMARY_COPY.entriesTotal, { count: count.toLocaleString("en-SG"), months: months.length })
    : null;
}

// Just for fun: the complete month when the most income arrived.
export function mostIncomeMonthTrivia(input: SummarySignalInput): MoneySignal | null {
  const months = completeMonths(input).filter((month) => (month.actualIncomeMinor ?? 0) > 0);
  const top = months.length >= MIN_STREAK ? uniqueMax(months, (month) => month.actualIncomeMinor ?? 0) : null;
  return top ? triviaSignal("most-income-month", top.month, SUMMARY_COPY.mostIncomeMonth, { month: monthYear(top.month), amount: input.formatMoney(top.actualIncomeMinor ?? 0) }) : null;
}

// Just for fun: the largest single category-month of the range (an
// everyday category, not a bill or a loan).
export function categoryPeakTrivia(input: SummarySignalInput): MoneySignal | null {
  const peaks = completeMonths(input).flatMap((month) => categoryTotals(input, month.month)
    .filter((item) => !isOther(item.label) && !NOT_FUN.test(item.label))
    .map((item) => ({ month: month.month, label: item.label, valueMinor: item.valueMinor })));
  const peak = completeMonths(input).length >= MIN_STREAK ? uniqueMax(peaks, (item) => item.valueMinor) : null;
  return peak
    ? triviaSignal("category-peak", `${peak.month}:${peak.label}`, SUMMARY_COPY.categoryPeak, { category: peak.label, month: monthYear(peak.month), amount: input.formatMoney(peak.valueMinor) })
    : null;
}

function everydayRanking(input: SummarySignalInput) {
  return rangeCategoryTotals(input).filter(([label]) => !isOther(label) && !NOT_FUN.test(label));
}

// Just for fun: the range's spending per day.
export function dailyAverageTrivia(input: SummarySignalInput): MoneySignal | null {
  const months = completeMonths(input).filter((month) => spendOf(month) > 0);
  if (months.length < 2) {
    return null;
  }
  const days = sum(months.map((month) => daysInMonth(month.month)));
  return triviaSignal("daily-average", rangeEnd(input), SUMMARY_COPY.dailyAverage, { amount: approxMoney(input.formatMoney, sum(months.map(spendOf)) / days) });
}

// Just for fun: the range's spending in all.
export function rangeTotalTrivia(input: SummarySignalInput): MoneySignal | null {
  const months = completeMonths(input).filter((month) => spendOf(month) > 0);
  if (months.length < 2) {
    return null;
  }
  return triviaSignal("range-total", rangeEnd(input), SUMMARY_COPY.rangeTotal, { amount: approxMoney(input.formatMoney, sum(months.map(spendOf))), months: months.length });
}

// Just for fun: the range's biggest everyday category as "one in every N
// dollars".
export function rangeShareTrivia(input: SummarySignalInput): MoneySignal | null {
  const ranking = rangeCategoryTotals(input);
  const totalMinor = sum(ranking.map(([, item]) => item.valueMinor));
  const [top] = everydayRanking(input);
  const fraction = top && totalMinor > 0 ? Math.round(totalMinor / top[1].valueMinor) : 0;
  if (!top || completeMonths(input).length < 2 || fraction < 2 || fraction > 12) {
    return null;
  }
  return triviaSignal("range-share", top[0], SUMMARY_COPY.rangeShare, { category: top[0], fraction: numberWord(fraction) });
}

// Just for fun: the everyday category in second place across the range.
export function secondCategoryTrivia(input: SummarySignalInput): MoneySignal | null {
  const [top, second] = everydayRanking(input);
  if (!top || !second || top[1].valueMinor === second[1].valueMinor || completeMonths(input).length < 2) {
    return null;
  }
  return triviaSignal("second-category", second[0], SUMMARY_COPY.secondCategory, { category: second[0], top: lowerLabel(top[0]) });
}

// Just for fun: how many complete months had income come in.
export function incomeMonthsTrivia(input: SummarySignalInput): MoneySignal | null {
  const months = completeMonths(input);
  const count = months.filter((month) => (month.actualIncomeMinor ?? 0) > 0).length;
  return count >= 1 && months.length >= 2 ? triviaSignal("income-months", rangeEnd(input), SUMMARY_COPY.incomeMonths, { count, total: months.length }) : null;
}

// Just for fun, a moment: a range ending in December recaps that year from
// the range's months of it. Only a December period can fire it, so at most
// one period in any twelve.
export function yearRecapTrivia(input: SummarySignalInput): MoneySignal | null {
  const end = rangeEnd(input);
  if (end.slice(5, 7) !== "12") {
    return null;
  }
  const year = end.slice(0, 4);
  const monthsOfYear = input.categoryShareByMonth.filter((item) => item.month.startsWith(`${year}-`));
  if (monthsOfYear.length < MIN_STREAK) {
    return null;
  }
  const byCategory = new Map<string, number>();
  let entries = 0;
  for (const item of monthsOfYear) {
    for (const datum of item.data) {
      byCategory.set(datum.label, (byCategory.get(datum.label) ?? 0) + Math.max(0, datum.valueMinor));
      entries += Number(datum.entryCount ?? 0);
    }
  }
  const [category] = [...byCategory.entries()].sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))[0] ?? [];
  if (!category || entries <= 0) {
    return null;
  }
  return triviaSignal("year-recap", year, SUMMARY_COPY.yearRecap, { year, entries: entries.toLocaleString("en-SG"), category }, { weight: entries, moment: true });
}

// Just for fun, a moment: a year (or several) since the first month here,
// on a range that ends this month. Only this month's period can fire it.
export function anniversaryTrivia(input: SummarySignalInput): MoneySignal | null {
  const first = [...input.availableMonths].sort()[0];
  const currentMonth = input.today.slice(0, 7);
  const elapsed = first ? monthsBetween(first, currentMonth) : 0;
  if (rangeEnd(input) !== currentMonth || elapsed < 12 || elapsed % 12 !== 0) {
    return null;
  }
  const years = elapsed / 12;
  return triviaSignal("anniversary", String(years), SUMMARY_COPY.anniversary, { years: years === 1 ? "A year" : `${years} years`, firstMonth: monthYear(first) }, { moment: true });
}

export function buildSummarySignals(input: SummarySignalInput): MoneySignal[] {
  return [
    statementGapSignal({ accountPills: input.accountPills, audience: input.audience, viewLabel: input.viewLabel, formatMoney: input.formatMoney }),
    spendingAboveIncomeSignal(input),
    categoryCreepSignal(input),
    subscriptionsSignal(input),
    monthsUnderPlanSignal(input),
    chineseNewYearSignal(input),
    keepRateSignal(input),
    cushionSignal(input),
    sameSeasonSignal(input),
    yearRecapTrivia(input),
    anniversaryTrivia(input),
    categoryFractionTrivia(input),
    halfOfSpendingTrivia(input),
    lastYearTopTrivia(input),
    everyMonthCategoryTrivia(input),
    mostEntriesMonthTrivia(input),
    quietestMonthTrivia(input),
    biggestMonthTrivia(input),
    averageMonthTrivia(input),
    weeklyCategoryTrivia(input),
    categoriesCountTrivia(input),
    topCategoryMonthsTrivia(input),
    topCategoryEntriesTrivia(input),
    entriesTotalTrivia(input),
    mostIncomeMonthTrivia(input),
    categoryPeakTrivia(input),
    dailyAverageTrivia(input),
    rangeTotalTrivia(input),
    rangeShareTrivia(input),
    secondCategoryTrivia(input),
    incomeMonthsTrivia(input)
  ].filter((signal): signal is MoneySignal => Boolean(signal));
}
