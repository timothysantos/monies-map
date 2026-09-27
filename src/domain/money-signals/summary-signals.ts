// Summary's check-in signals, over the selected range. Everything comes
// from what Summary already loads: per-month totals, category totals per
// month, and the view's account pills (joined to the reference account
// kinds for the cushion). No extra month is fetched: the same-season line
// shows only when last year's month is already in the range.
import {
  addMonths,
  approxMoney,
  compactMoney,
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
import { statementGapSignal, triviaSignal, type WalletHealthPill } from "./shared-signals";
import type { Audience, MoneySignal } from "./types";

export const SUMMARY_COPY = {
  spendingAboveIncome: {
    phrasings: [
      "Spending has been above income for {count} months running.",
      "For {count} months running, more went out than came in: {gap} in all.",
      "The last {count} months each spent more than came in, {gap} altogether."
    ],
    think: "Changing one category is easier than changing everything. Which one matters least to you?"
  },
  categoryCreep: {
    phrasings: [
      "{category} has risen {count} months in a row and is {above} above its {window}-month average.",
      "{category} is {above} above its usual month, after {count} rises in a row.",
      { fact: "{count} months ago {category} was {then}; now it's {now}.", think: "Rises like this usually happen without anyone deciding. If it's spending you enjoy, keep it; just make it a choice." }
    ],
    think: "Rises like this usually happen without anyone deciding. If it's spending you enjoy, keep it; just make it a choice."
  },
  subscriptions: {
    phrasings: [
      "Subscriptions came to {amount} in {month}, about {yearly} a year.",
      { fact: "{yearly} a year goes to subscriptions. Still using all of them?", think: "Automatic payments are easy to stop noticing." },
      "Your subscriptions cost about {daily} a day."
    ],
    think: "Automatic payments are easy to stop noticing. Judge each one by its yearly cost."
  },
  monthsUnderPlan: {
    phrasings: [
      "{under} of the last {total} months came in under plan.",
      "Under plan in {under} of the last {total} months, {saved} below plan in all.",
      "{saved} stayed inside the plan across {under} of the last {total} months."
    ],
    think: "Consistency matters more than any single month. This is what a working plan looks like."
  },
  keepRate: {
    phrasings: [
      "Over the last {count} months {subject} kept {rate}% of what came in ({kept}).",
      "For every {ten} that came in over the last {count} months, about {stayed} stayed.",
      { fact: "{kept} kept over the last {count} months. One heavy month barely moves that.", think: "The year is the fairer scorecard." }
    ],
    think: "One heavy month barely moves a year; the year is the fairer scorecard."
  },
  cushion: {
    phrasings: [
      "Bank balances would cover about {months} of your usual spending.",
      "At your usual spending of about {usual} a month, bank balances would last about {months}.",
      "{balance} in bank accounts is about {months} of your usual spending."
    ],
    think: "A cushion turns surprises into inconveniences. How big feels right is your call."
  },
  sameSeason: {
    phrasings: [
      "{month} spending was about {diff} {direction} than {month} last year.",
      "Compared with {month} last year, spending was about {diff} {direction}.",
      "{month} last year: {then}. This {month}: {now}."
    ],
    think: "The same month last year is the fair comparison: holidays, bonuses and school terms line up."
  },
  chineseNewYear: {
    phrasings: [
      "Chinese New Year falls in {cnyMonth}. Last year's Chinese New Year month, {lastMonth}, came to {amount} of spending.",
      "Last Chinese New Year month, {lastMonth}, spending came to {amount}. This year's falls in {cnyMonth}.",
      "{amount}: what {lastMonth}, last year's Chinese New Year month, came to."
    ],
    think: "Festive months have their own shape. Knowing last year's helps this one feel planned rather than surprising."
  },
  categoryFraction: {
    phrasings: ["About one in every {fraction} dollars in {month} went to {category}."],
    think: ""
  },
  lastYearTop: {
    phrasings: ["A year ago, {category} was your biggest category."],
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

// Worth a look: subscriptions in the month, at their yearly cost.
export function subscriptionsSignal(input: SummarySignalInput): MoneySignal | null {
  const month = targetMonth(input);
  const amountMinor = sum(categoryTotals(input, month)
    .filter((item) => /subscription/i.test(item.label))
    .map((item) => item.valueMinor));
  if (!month || amountMinor <= 0) {
    return null;
  }
  const yearlyMinor = amountMinor * 12;
  const amount = input.formatMoney(amountMinor);
  return {
    key: "subscriptions",
    kind: "worth_a_look",
    weight: yearlyMinor,
    numbers: { primaryMinor: amountMinor },
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
// their spending plan.
export function monthsUnderPlanSignal(input: SummarySignalInput): MoneySignal | null {
  const planned = completeMonths(input).filter((month) => (month.estimatedExpensesMinor ?? 0) > 0).slice(-12);
  const under = planned.filter((month) => spendOf(month) <= (month.estimatedExpensesMinor ?? 0));
  if (planned.length < MIN_STREAK || under.length < Math.max(MIN_STREAK, Math.ceil(planned.length * 2 / 3))) {
    return null;
  }
  const savedMinor = sum(under.map((month) => (month.estimatedExpensesMinor ?? 0) - spendOf(month)));
  const saved = input.formatMoney(savedMinor);
  return {
    key: "months-under-plan",
    kind: "going_well",
    weight: savedMinor,
    numbers: { primaryMinor: savedMinor, under: under.length, total: planned.length },
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

// Just for fun: the month's biggest category as a plain fraction (12.1% is
// about one in every eight dollars).
export function categoryFractionTrivia(input: SummarySignalInput): MoneySignal | null {
  const month = targetMonth(input);
  const totals = categoryTotals(input, month);
  const totalMinor = sum(totals.map((item) => item.valueMinor));
  // Other says nothing, and a routine obligation (a loan, rent, insurance)
  // is not a fun fact.
  const top = totals.find((item) => !/^(other|uncategori[sz]ed)$/i.test(item.label) && !NOT_FUN.test(item.label));
  if (!top || totalMinor <= 0) {
    return null;
  }
  const share = top.valueMinor / totalMinor;
  const fraction = Math.round(1 / share);
  if (share > 0.5 || fraction < 2 || fraction > 12) {
    return null;
  }
  return triviaSignal(`category-fraction:${month}:${top.label}`, SUMMARY_COPY.categoryFraction, {
    fraction: numberWord(fraction),
    month: monthName(month),
    category: lowerLabel(top.label)
  }, { weight: top.valueMinor });
}

// Just for fun: the biggest category of the same month last year, when it
// is in the range.
export function lastYearTopTrivia(input: SummarySignalInput): MoneySignal | null {
  const month = targetMonth(input);
  const top = month ? categoryTotals(input, addMonths(month, -12))[0] : undefined;
  if (!top) {
    return null;
  }
  return triviaSignal(`last-year-top:${month}`, SUMMARY_COPY.lastYearTop, { category: top.label }, { weight: top.valueMinor });
}

// Just for fun, seasonal: a year-in-numbers recap in December (the year so
// far) and January (last year), from the range's months of that year.
export function yearRecapTrivia(input: SummarySignalInput): MoneySignal | null {
  const month = Number(input.today.slice(5, 7));
  if (month !== 12 && month !== 1) {
    return null;
  }
  const year = String(Number(input.today.slice(0, 4)) - (month === 1 ? 1 : 0));
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
  return triviaSignal(`year-recap:${year}`, SUMMARY_COPY.yearRecap, { year, entries: entries.toLocaleString("en-SG"), category }, { weight: entries, moment: true });
}

// Just for fun, milestone: a year (or several) since the first month here.
export function anniversaryTrivia(input: SummarySignalInput): MoneySignal | null {
  const first = [...input.availableMonths].sort()[0];
  const elapsed = first ? monthsBetween(first, input.today.slice(0, 7)) : 0;
  if (elapsed < 12 || elapsed % 12 !== 0) {
    return null;
  }
  const years = elapsed / 12;
  return triviaSignal(`anniversary:${years}`, SUMMARY_COPY.anniversary, { years: years === 1 ? "A year" : `${years} years`, firstMonth: monthYear(first) }, { moment: true });
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
    lastYearTopTrivia(input)
  ].filter((signal): signal is MoneySignal => Boolean(signal));
}
