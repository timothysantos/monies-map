import "./simple-view.css";
import { simpleViewCopy as copy } from "./copy/simple-view-copy";
import { formatMonthLabel, money } from "./formatters";
import { buildEarnedSpentMonths } from "./summary-earned-spent-model";

// Summary's month-by-month list in the Simple view (lead-view.js; design.md
// "Plan or Simple"), in place of Intent vs Outcome: one row per month,
// newest first. The month name opens the month (a 44 px target, as in
// Intent vs Outcome); beside it what was kept (mint) or overspent (rose);
// under it "Earned $x  Spent $y" and a thin bar on that month's own scale in
// the savings bar's colours. Nothing about a plan. Each figure is openable
// (design.md "Openable figures", figure-menu.js): View entries for that
// month narrowed to the money behind it, and Ask about this. Hidden money
// keeps the bar (in greys) and the share of income spent, and drops every
// amount and the kept or overspent word.
//
// It loads only when Simple is shown, and imports no React (`h` is the
// page's createElement, `MonthIcon` its chevron), so its chunk leans only
// on the first screen's own chunks, as money-jobs-detail.js does.
export function renderEarnedSpent(h, { months, categoryShareByMonth, investmentMovesByMonth, hidden, onOpenMonth, MonthIcon }) {
  const rows = buildEarnedSpentMonths(months, categoryShareByMonth, investmentMovesByMonth);
  return h(
    "section",
    { className: "chart-card summary-earned-spent", "data-earned-spent": "" },
    h("div", { className: "chart-head" }, h("h3", null, copy.title), h("p", null, copy.detail)),
    h("ul", { className: "earned-spent-months" }, rows.map((row) => h(
      "li",
      { key: row.month, className: "earned-spent-row", "data-month": row.month, "data-fig-period": `${row.month}:${row.month}` },
      h(
        "button",
        { type: "button", className: "summary-month-link", onClick: () => onOpenMonth(row.month) },
        formatMonthLabel(row.month),
        h(MonthIcon, { size: 16, "aria-hidden": "true" })
      ),
      result(h, row, hidden),
      hidden ? null : h(
        "p",
        { className: "earned-spent-figures" },
        h("span", open("earned"), `${copy.earned} ${money(row.earnedMinor)}`),
        h("span", open("spending"), `${copy.spent} ${money(row.spentMinor)}`),
        row.investedMinor > 0 ? h("span", open("invested"), `${copy.invested} ${money(row.investedMinor)}`) : null
      ),
      h("span", { className: "earned-spent-bar", "aria-hidden": "true" }, row.bar.map((part) => h("span", {
        key: part.key,
        className: `savings-bar-segment money-${part.tone}${part.hatched ? " is-hatched" : ""}`,
        "data-segment": part.key,
        style: { width: `${part.widthPercent}%` }
      })))
    )))
  );
}

// An openable figure's attributes (figure-menu.js): the money figure and,
// when not its own, the question for Ask.
const open = (fig, ask = "") => ({ "data-fig": fig, "data-fig-ask": ask || undefined, role: "button", tabIndex: 0 });

// "Kept $x" in mint or "Overspent $x" in rose (kept below zero: the
// figure it opens is the same kept, as the Month lead counts it); with
// money hidden, the share of income spent (nothing when nothing was
// earned).
function result(h, row, hidden) {
  if (hidden) {
    return row.spentPercent === null ? null : h("span", { className: "earned-spent-result", "data-result": "share", ...open("spending", "spentVsIncome") }, copy.hiddenShare(row.spentPercent));
  }
  return h(
    "span",
    { className: `earned-spent-result money-${row.isOver ? "short" : "in"}`, "data-result": row.isOver ? "over" : "kept", ...open("kept", row.isOver ? "spentMore" : "") },
    `${row.isOver ? copy.overspent : copy.kept} ${money(Math.abs(row.keptMinor))}`
  );
}
