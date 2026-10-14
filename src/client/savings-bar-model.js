import { messages } from "./copy/en-SG";
import { wholeMoney } from "./money-jobs-model";

const copy = messages.summary.lead.savingsBar;
const earnedWord = messages.summary.lead.earned;

// The savings bar under the Summary and Month lead (ui/savings-bar.jsx,
// design.md "Lead · Support · Detail"): all the money earned in the period is
// one bar (income = 100%). Spent is the rose part, invested the plum part
// and kept (what is left) the mint part. When more went out than came in,
// the bar is as long as what went out: a tick marks where the income ended
// (the legend names it, "All you earned $x", so no label covers the bar), and
// spending past the tick is hatched (still rose) because it came out of
// savings. A thin plan bar under it, on the same scale, is the
// planned spend, the investment goal and the savings goal. A legend under the
// bars (each part's name, figure and share; the plan's figures) is always
// shown, so nothing needs a hover or a tap to be read.
//
// `figures` is splitMoneyUse's (money-jobs-model.js): every figure is one
// the lead already has, with money filed under Investments and Savings
// taken out of the spend. It only describes what already happened and the
// household's own plan: no forecast, no limit. Hidden money keeps the
// percentages and drops every amount.
//
// Invested is net of money taken back out of investment accounts and never
// below zero (splitMoneyUse). A period that took more out than it put in
// says so as one more legend line, "Took out of investments $X", with no
// part on the bar: it is not income and not kept. Hidden money leaves the
// line out (it has no share of income to show instead).
//
// `withPlan: false` is the lead's Simple view (lead-view.js): no plan bar and
// no plan in the legend.
//
// Each part, legend line and the sentence names the money figure it opens
// (`fig`, `sentenceFig`; src/domain/money-figures.ts, design.md "Openable
// figures"): spent is `spending`, invested `invested`, kept `kept` and the
// part that came out of savings `from_savings`.
//
// Returns null when there is nothing to draw (no income and nothing out).
export function buildSavingsBarModel({ figures, hidden = false, withPlan = true, formatMoney = wholeMoney }) {
  const { income, spending, invested, kept } = figures;
  const outMinor = spending + invested;
  if (income === 0 && outMinor === 0) {
    return null;
  }
  const amount = (minor) => (hidden ? null : formatMoney(minor));
  const share = (minor) => (income > 0 ? Math.round((minor * 100) / income) : null);
  const isOver = outMinor > income;
  // The bar is the income, or what went out when that is longer.
  const scaleMinor = isOver ? outMinor : income;
  const width = (minor) => (minor / scaleMinor) * 100;
  // `name` is the part's full name for screen readers; the legend's short
  // `legend.name` is what sighted users read under the bar.
  const segment = (key, tone, minor, name, percent, extra = {}) => ({
    key,
    fig: SEGMENT_FIGURES[key],
    tone,
    widthPercent: width(minor),
    name,
    legend: { name: copy.legend[key], amount: amount(minor), percent },
    hatched: false,
    ...extra
  });
  const segments = [];
  // The sentence, and its one-line phone form (`short`); only the sentences
  // that name investing differ.
  let sentence;
  let shortSentence = null;
  // The figure the sentence is about: what was kept, or what went out
  // past the income (or, past it only through investing, what was invested).
  let sentenceFig = "kept";

  if (isOver) {
    const spentWithin = Math.min(spending, income);
    const spentPast = spending - spentWithin;
    if (spentWithin > 0) {
      segments.push(segment("spent", "short", spending, copy.spentName, share(spending), { widthPercent: width(spentWithin) }));
    }
    if (spentPast > 0) {
      segments.push(segment("savings", "short", spentPast, copy.savingsName, share(spentPast), { hatched: true }));
    }
    if (invested > 0) {
      segments.push(segment("invested", "in", invested, copy.investedName, share(invested)));
    }
    sentenceFig = spentPast > 0 ? "from_savings" : "invested";
    if (hidden) {
      sentence = invested > 0 ? copy.hiddenSentenceInvested : copy.hiddenSentence;
    } else if (spentPast > 0 && invested > 0) {
      sentence = copy.spentMoreAndInvested(formatMoney(spentPast), formatMoney(invested));
      shortSentence = copy.short.spentMoreAndInvested(formatMoney(spentPast), formatMoney(invested));
    } else if (spentPast > 0) {
      sentence = copy.spentMore(formatMoney(spentPast));
    } else {
      sentence = copy.investedFromSavings(formatMoney(invested), formatMoney(outMinor - income));
    }
  } else {
    // The shares always add to 100: spent takes what rounding leaves.
    const keptShare = Math.round((kept * 100) / income);
    const investedShare = Math.round((invested * 100) / income);
    if (spending > 0) {
      segments.push(segment("spent", "short", spending, copy.spentName, 100 - keptShare - investedShare));
    }
    if (invested > 0) {
      segments.push(segment("invested", "in", invested, copy.investedName, investedShare));
    }
    if (kept > 0) {
      segments.push(segment("kept", "in", kept, copy.keptName, keptShare));
    }
    if (hidden) {
      sentence = invested > 0 ? copy.hiddenSentenceInvested : copy.hiddenSentence;
    } else if (invested > 0) {
      sentence = copy.keptAndInvested(formatMoney(kept), formatMoney(invested), formatMoney(income));
      shortSentence = copy.short.keptAndInvested(formatMoney(kept), formatMoney(invested), formatMoney(income));
    } else {
      sentence = copy.kept(formatMoney(kept), formatMoney(income), keptShare);
    }
  }

  const hasTick = isOver && income > 0;
  return {
    segments,
    // Where the income ends on a bar that is longer than it, and its legend
    // line (the figure goes with it when money is shown).
    tickPercent: hasTick ? width(income) : null,
    tickLegend: hasTick ? (hidden ? copy.tick : copy.tickWithAmount(formatMoney(income))) : null,
    // A phone's legend keeps one line: the word alone, "Earned" (the Simple
    // lead's word); the figure is the Income column's and the sentence's.
    tickLegendShort: hasTick ? earnedWord : null,
    sentence,
    shortSentence: shortSentence ?? sentence,
    sentenceFig,
    takenOut: hidden || !(figures.takenFromInvestments > 0)
      ? null
      : { name: copy.legend.takenOut, amount: formatMoney(figures.takenFromInvestments) },
    plan: hidden || !withPlan ? null : buildPlan(scaleMinor, figures),
    // The legend's wording for the thin plan bar: the plan's own figures,
    // not cut to the bar, and only the goals that exist.
    planLegend: hidden || !withPlan ? null : buildPlanLegend(figures, formatMoney)
  };
}

const SEGMENT_FIGURES = { spent: "spending", invested: "invested", kept: "kept", savings: "from_savings" };

function buildPlanLegend({ spendPlan, investPlan, savePlan }, formatMoney) {
  const parts = [
    [copy.planSpend, spendPlan],
    [copy.planInvest, investPlan],
    [copy.planKeep, savePlan]
  ].filter(([, minor]) => minor > 0);
  return parts.length === 0 ? null : copy.planLegend(parts.map(([word, minor]) => `${word} ${formatMoney(minor)}`));
}

// The plan bar shares the income bar's scale: the planned spend, then the
// investment goal, then the savings goal. A plan bigger than the bar is cut
// at its end, in that order.
function buildPlan(scaleMinor, { spendPlan, investPlan, savePlan }) {
  if (spendPlan + investPlan + savePlan === 0) {
    return null;
  }
  let room = 100;
  const part = (minor) => {
    const percent = Math.min(room, (minor / scaleMinor) * 100);
    room -= percent;
    return percent;
  };
  return { spendPercent: part(spendPlan), investPercent: part(investPlan), savePercent: part(savePlan) };
}
