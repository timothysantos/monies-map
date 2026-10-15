import { earnedSpentChartCopy as copy } from "./copy/earned-spent-chart-copy";
import { formatMonthLabel, money } from "./formatters";
import { buildEarnedSpentMonths } from "./summary-earned-spent-model";

// The column + line chart above Summary's month-by-month list
// (earned-spent-chart.js). Its figures are the card's own, so the chart and
// the list never disagree, and it fetches nothing:
// - Simple: Earned and Spent columns and a Kept line, from
//   buildEarnedSpentMonths (the list's rows). Kept can be below zero.
// - Plan: Earned and Spent columns as the Intent vs Outcome cards count them
//   (the Summary month row's actual income and real expenses) and a Planned
//   spending line (the month's estimated expenses, the figure the Plan lead
//   measures spend against). A month with no plan has no point there: the
//   line breaks, it is never drawn through zero.
// Months run oldest to newest, left to right (the list runs newest first).
// Pure: the component draws what this returns.

/**
 * The series each mode draws, in legend order. `fig` is the openable figure
 * the column or point opens (figure-menu-model.js).
 * @param {"plan" | "simple"} mode
 */
export function chartSeries(mode) {
  const words = copy.series;
  return mode === "plan"
    ? [
      { key: "earned", kind: "bar", label: words.earned, tone: "in" },
      { key: "spent", kind: "bar", label: words.spent, tone: "short" },
      { key: "plan", kind: "line", label: words.plan, tone: "plan" }
    ]
    : [
      { key: "earned", kind: "bar", label: words.earned, tone: "in" },
      { key: "spent", kind: "bar", label: words.spent, tone: "short" },
      { key: "kept", kind: "line", label: words.kept, tone: "in" }
    ];
}

/**
 * One entry per month, oldest first: earnedMinor, spentMinor and lineMinor
 * (Kept in Simple, Planned spending in Plan; null where there is no plan).
 */
export function buildChartMonths({ mode, months = [], categoryShareByMonth = [], investmentMovesByMonth = [] }) {
  if (mode === "simple") {
    return buildEarnedSpentMonths(months, categoryShareByMonth, investmentMovesByMonth)
      .reverse()
      .map((row) => ({ month: row.month, earnedMinor: row.earnedMinor, spentMinor: row.spentMinor, lineMinor: row.keptMinor }));
  }
  return [...months]
    .sort((left, right) => left.month.localeCompare(right.month))
    .map((row) => ({
      month: row.month,
      earnedMinor: row.actualIncomeMinor,
      spentMinor: row.realExpensesMinor,
      // As the Intent vs Outcome card reads it: no planned spend is no plan.
      lineMinor: row.estimatedExpensesMinor > 0 ? row.estimatedExpensesMinor : null
    }));
}

/** Hides or shows a series; the last one showing stays (an empty chart says nothing). */
export function toggleSeries(hidden, key, allKeys) {
  const next = new Set(hidden);
  if (next.has(key)) {
    next.delete(key);
  } else if (allKeys.filter((candidate) => !next.has(candidate)).length > 1) {
    next.add(key);
  }
  return next;
}

// 1, 2, 5 times a power of ten, never below $1.
function niceStep(rawMinor) {
  const raw = Math.max(100, rawMinor);
  const power = 10 ** Math.floor(Math.log10(raw));
  const fraction = raw / power;
  const nice = fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 5 ? 5 : 10;
  return nice * power;
}

/**
 * The y scale: zero is always on it, a few round gridlines, and the top and
 * bottom are gridlines too. In minor units.
 * @param {Array<number | null>} values
 */
export function niceScale(values, { targetTicks = 4 } = {}) {
  const numbers = values.filter((value) => Number.isFinite(value));
  const low = Math.min(0, ...numbers);
  const high = Math.max(0, ...numbers);
  const step = niceStep((high - low || 100_000) / targetTicks);
  const min = Math.floor(low / step) * step;
  let max = Math.ceil(high / step) * step;
  if (max === min) {
    max = min + step * targetTicks;
  }
  const ticks = [];
  for (let tick = min; tick <= max; tick += step) {
    ticks.push(tick);
  }
  return { min, max, step, ticks };
}

/** An axis label: "$800", "$8k", "$1.5k", "-$2k", "$2.5M". */
export function compactMoney(minor) {
  const sign = minor < 0 ? "-" : "";
  const dollars = Math.abs(minor) / 100;
  if (Math.round(dollars) < 1000) {
    return `${sign}$${Math.round(dollars)}`;
  }
  const thousands = Math.round((dollars / 1000) * 10) / 10;
  if (thousands < 1000) {
    return `${sign}$${thousands}k`;
  }
  return `${sign}$${Math.round((dollars / 1_000_000) * 10) / 10}M`;
}

const MIN_SCROLL_BAND = 36;
const BAR_GAP = 2;
const MAX_BAR = 28;

/**
 * Where the columns sit. Twelve months or fewer always fit the width by
 * narrowing the columns; past twelve, and only when a month would be
 * narrower than 36 px, the plot scrolls sideways while the y axis stays put.
 * @param {{ width: number, monthCount: number, barCount: number, height?: number }} input
 */
export function chartGeometry({ width, monthCount, barCount, height = 232 }) {
  const axisWidth = 40;
  const available = Math.max(120, width - axisWidth);
  const scrolls = monthCount > 12 && available / monthCount < MIN_SCROLL_BAND;
  const plotWidth = scrolls ? monthCount * MIN_SCROLL_BAND : available;
  const band = plotWidth / Math.max(1, monthCount);
  const bars = Math.max(1, barCount);
  const barWidth = Math.max(4, Math.min(MAX_BAR, Math.floor((band * 0.74 - BAR_GAP * (bars - 1)) / bars)));
  const groupWidth = barWidth * bars + BAR_GAP * (bars - 1);
  const top = 14;
  const bottom = 36;
  return {
    axisWidth,
    plotWidth,
    height,
    top,
    plotHeight: height - top - bottom,
    band,
    barWidth,
    groupWidth,
    scrolls,
    bandStart: (index) => index * band,
    bandCenter: (index) => index * band + band / 2,
    barX: (index, barIndex) => index * band + (band - groupWidth) / 2 + barIndex * (barWidth + BAR_GAP)
  };
}

/**
 * What a column or point is as an openable figure (figure-menu.js): the
 * figure it opens, the question it asks, its plan link, its name, quick
 * facts and the label assistive tech reads. The month is its own period, so
 * View entries lists that month's rows behind the figure.
 * @param {"plan" | "simple"} mode
 * @param {{ key: string }} series
 * @param {{ month: string, earnedMinor: number, spentMinor: number, lineMinor: number | null }} row
 */
export function pointFigure(mode, series, row) {
  const monthLabel = formatMonthLabel(row.month);
  const period = `${row.month}:${row.month}`;
  const spent = money(row.spentMinor);
  const earned = money(row.earnedMinor);
  const planned = row.lineMinor;
  const base = { period, seriesKey: series.key, month: row.month, plan: null, ask: "", name: "" };
  const labelled = (word, amountMinor) => copy.pointLabel(monthLabel, word, money(Math.abs(amountMinor)));

  if (series.key === "earned") {
    return {
      ...base,
      fig: "earned",
      plan: mode === "plan" ? "income" : null,
      label: labelled(copy.seriesWord.earned, row.earnedMinor),
      note: [earned, copy.wentOut(spent)]
    };
  }
  if (series.key === "kept") {
    const over = row.lineMinor < 0;
    return {
      ...base,
      fig: "kept",
      ask: over ? "spentMore" : "",
      label: labelled(over ? copy.seriesWord.overspent : copy.seriesWord.kept, row.lineMinor),
      note: [over ? copy.overspentAmount(money(-row.lineMinor)) : copy.keptAmount(money(row.lineMinor)), copy.earnedAndSpent(earned, spent)]
    };
  }
  if (series.key === "plan") {
    return {
      ...base,
      fig: "spent",
      plan: "",
      ask: "plan",
      name: copy.series.plan,
      label: labelled(copy.seriesWord.plan, planned),
      note: [copy.planned(money(planned)), copy.spentAmount(spent)]
    };
  }
  // Spent.
  if (mode === "simple") {
    const percent = row.earnedMinor > 0 ? Math.round((row.spentMinor * 100) / row.earnedMinor) : null;
    return {
      ...base,
      fig: "spending",
      label: labelled(copy.seriesWord.spent, row.spentMinor),
      note: percent === null ? [spent] : [spent, copy.percentOfEarned(percent)]
    };
  }
  if (planned === null) {
    return { ...base, fig: "spent", label: labelled(copy.seriesWord.spent, row.spentMinor), note: [spent, copy.noPlan] };
  }
  const gap = planned - row.spentMinor;
  return {
    ...base,
    fig: "spent",
    plan: "",
    ask: gap < 0 ? "spentOverPlan" : "",
    label: labelled(copy.seriesWord.spent, row.spentMinor),
    note: [spent, gap === 0 ? copy.onPlan : gap < 0 ? copy.overPlan(money(-gap)) : copy.underPlan(money(gap))]
  };
}
