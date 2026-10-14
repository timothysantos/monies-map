import { simpleViewCopy as copy } from "./copy/simple-view-copy";
import { wholeMoney } from "./money-jobs-model";
import { buildSimpleMetrics } from "./simple-metrics-model";
import { renderEarnedSpent } from "./summary-earned-spent";

// The Simple view's parts that load only when Simple is shown (design.md
// "Plan or Simple"): `part: "metrics"` is the facts under the savings bar,
// `part: "months"` is Summary's "Earned vs spent by month". It imports no
// React: `h` is the page's createElement (SimpleDetail in
// ui/spend-lead-group.jsx), so the chunk leans only on the first screen's
// own chunks and adds no first-screen file, as money-jobs-detail.js does.
export function renderSimpleDetail(h, props) {
  return props.part === "months" ? renderEarnedSpent(h, props) : renderSimpleMetrics(h, props);
}

// "Daily spend $56", then "Top spending" with the three biggest categories
// and their share of spending, each opening that category's entries. What
// was kept is the savings bar's line above. Hidden money keeps only the
// categories' shares.
function renderSimpleMetrics(h, { figures, categoryShare, period, hidden, onOpenCategory }) {
  const metrics = buildSimpleMetrics({ figures, categoryShare, startMonth: period?.startMonth, endMonth: period?.endMonth, today: todayKey() });
  if (!metrics) {
    return null;
  }
  const { dailySpend, topCategories } = metrics;
  if ((hidden || !dailySpend) && topCategories.length === 0) {
    return null;
  }
  return h(
    "div",
    { className: "simple-metrics", role: "group", "aria-label": copy.metricsLabel, "data-simple-metrics": "" },
    hidden || !dailySpend ? null : h("span", { className: "simple-metric", "data-metric": "daily" }, copy.dailySpend(wholeMoney(dailySpend.amountMinor), dailySpend.soFar)),
    topCategories.length === 0 ? null : h(
      "div",
      { className: "simple-top", "data-metric": "top" },
      h("span", { className: "simple-top-label" }, copy.topSpending),
      topCategories.map((category) => h(
        "button",
        {
          key: category.name,
          type: "button",
          className: "simple-top-category",
          "data-category": category.name,
          "aria-label": `${copy.topCategory(category.name, category.percent)}. ${copy.openCategory(category.name)}`,
          onClick: () => onOpenCategory?.(category.name)
        },
        copy.topCategory(category.name, category.percent)
      ))
    )
  );
}

function todayKey() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}
