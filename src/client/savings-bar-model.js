import { messages } from "./copy/en-SG";

const copy = messages.summary.lead.savingsBar;

// Whole dollars: the lines are read at a glance and have to fit one line on a
// phone, and the cents are on the figures above.
const wholeMoneyFormatter = new Intl.NumberFormat("en-SG", { style: "currency", currency: "SGD", maximumFractionDigits: 0 });
const wholeMoney = (minor) => wholeMoneyFormatter.format(minor / 100);

// The savings bar under the Summary and Month lead (ui/savings-bar.jsx,
// design.md "Lead · Support · Detail"): all the money earned in the period is
// one bar (income = 100%). Spent is the rose part and kept (income minus
// spent) the mint part. When more went out than came in, the bar is as long
// as the spending: rose up to an income tick, and the part past the tick is
// hatched (still rose) because it came out of savings. A thin plan bar under
// it, on the same scale, is the planned spend and the savings goal.
//
// Every figure is one the lead already has (income, spend, planned spend,
// savings target), so no new API field is needed. It only describes what
// already happened and the household's own plan: no forecast, no limit.
// Hidden money keeps the percentages and drops every amount.
//
// Returns null when there is nothing to draw (no income and no spending).
export function buildSavingsBarModel({ incomeMinor, spentMinor, plannedSpendMinor = 0, savingsTargetMinor = 0, hidden = false, formatMoney = wholeMoney }) {
  const income = Math.max(0, incomeMinor ?? 0);
  const spent = Math.max(0, spentMinor ?? 0);
  if (income === 0 && spent === 0) {
    return null;
  }
  const amount = (minor) => (hidden ? null : formatMoney(minor));
  const isOver = spent > income;
  // The bar is the income, or the spending when that is longer.
  const scaleMinor = isOver ? spent : income;
  const share = (minor) => (income > 0 ? Math.round((minor * 100) / income) : null);
  const segments = [];
  let tickPercent = null;
  let sentence;

  if (isOver) {
    const overMinor = spent - income;
    const withinPercent = (income / spent) * 100;
    if (income > 0) {
      segments.push({
        key: "spent",
        tone: "short",
        widthPercent: withinPercent,
        name: copy.spentName,
        popover: copy.popover(copy.spentName, amount(spent), share(spent))
      });
      tickPercent = withinPercent;
    }
    segments.push({
      key: "savings",
      tone: "short",
      hatched: true,
      widthPercent: 100 - withinPercent,
      name: copy.savingsName,
      popover: copy.popover(copy.savingsName, amount(overMinor), share(overMinor))
    });
    sentence = hidden ? copy.hiddenSentence : copy.spentMore(formatMoney(overMinor));
  } else {
    const keptMinor = income - spent;
    // The two shares always add to 100.
    const keptShare = Math.round((keptMinor * 100) / income);
    if (spent > 0) {
      segments.push({
        key: "spent",
        tone: "short",
        widthPercent: (spent / income) * 100,
        name: copy.spentName,
        popover: copy.popover(copy.spentName, amount(spent), 100 - keptShare)
      });
    }
    if (keptMinor > 0) {
      segments.push({
        key: "kept",
        tone: "in",
        widthPercent: (keptMinor / income) * 100,
        name: copy.keptName,
        popover: copy.popover(copy.keptName, amount(keptMinor), keptShare)
      });
    }
    sentence = hidden ? copy.hiddenSentence : copy.kept(formatMoney(keptMinor), formatMoney(income), keptShare);
  }

  return {
    segments,
    tickPercent,
    sentence,
    plan: hidden ? null : buildPlan(scaleMinor, plannedSpendMinor, savingsTargetMinor, formatMoney)
  };
}

// The plan bar shares the income bar's scale. A plan that is bigger than the
// bar is cut at its end, with the planned spend first; the line under says
// the full figures.
function buildPlan(scaleMinor, plannedSpendMinor, savingsTargetMinor, formatMoney) {
  const spend = Math.max(0, plannedSpendMinor ?? 0);
  const save = Math.max(0, savingsTargetMinor ?? 0);
  if (scaleMinor <= 0 || (spend === 0 && save === 0)) {
    return null;
  }
  const spendPercent = Math.min(100, (spend / scaleMinor) * 100);
  const savePercent = Math.min(100 - spendPercent, (save / scaleMinor) * 100);
  return {
    spendPercent,
    savePercent,
    line: copy.plan(spend > 0 ? formatMoney(spend) : null, save > 0 ? formatMoney(save) : null)
  };
}
