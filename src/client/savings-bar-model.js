import { messages } from "./copy/en-SG";
import { wholeMoney } from "./money-jobs-model";

const copy = messages.summary.lead.savingsBar;

// The savings bar under the Summary and Month lead (ui/savings-bar.jsx,
// design.md "Lead · Support · Detail"): all the money earned in the period is
// one bar (income = 100%). Spent is the rose part, invested the plum part
// and kept (what is left) the mint part. When more went out than came in,
// the bar is as long as what went out: an income tick marks where the income
// ended, and spending past the tick is hatched (still rose) because it came
// out of savings. A thin plan bar under it, on the same scale, is the
// planned spend, the investment goal and the savings goal.
//
// `figures` is splitMoneyUse's (money-jobs-model.js): every figure is one
// the lead already has, with money filed under Investments and Savings
// taken out of the spend. It only describes what already happened and the
// household's own plan: no forecast, no limit. Hidden money keeps the
// percentages and drops every amount.
//
// Returns null when there is nothing to draw (no income and nothing out).
export function buildSavingsBarModel({ figures, hidden = false, formatMoney = wholeMoney }) {
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
  const segment = (key, tone, minor, name, percent, extra = {}) => ({
    key,
    tone,
    widthPercent: width(minor),
    name,
    popover: copy.popover(name, amount(minor), percent),
    hatched: false,
    ...extra
  });
  const segments = [];
  // The sentence, and its one-line phone form (`short`); only the sentences
  // that name investing differ.
  let sentence;
  let shortSentence = null;

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
    if (hidden) {
      sentence = invested > 0 ? copy.hiddenSentenceInvested : copy.hiddenSentence;
      shortSentence = invested > 0 ? copy.short.hiddenSentenceInvested : null;
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
      shortSentence = invested > 0 ? copy.short.hiddenSentenceInvested : null;
    } else if (invested > 0) {
      sentence = copy.keptAndInvested(formatMoney(kept), formatMoney(invested), formatMoney(income));
      shortSentence = copy.short.keptAndInvested(formatMoney(kept), formatMoney(invested), formatMoney(income));
    } else {
      sentence = copy.kept(formatMoney(kept), formatMoney(income), keptShare);
    }
  }

  return {
    segments,
    // Where the income ends on a bar that is longer than it.
    tickPercent: isOver && income > 0 ? width(income) : null,
    sentence,
    shortSentence: shortSentence ?? sentence,
    plan: hidden ? null : buildPlan(scaleMinor, figures)
  };
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
