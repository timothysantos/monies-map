import { figureCopy as copy } from "./copy/figure-copy";
import { buildEntriesFilterSearch, ENTRY_FIGURES } from "./entry-filter-params";
import { formatMonthLabel } from "./formatters";

// What an openable figure's menu offers (design.md "Openable figures"), as
// data, so it is tested without a page: figure-menu.js reads the figure's
// attributes and draws it.

// The question a figure asks when it names none.
const DEFAULT_QUESTION = {
  spending: "spentMost",
  spent: "spentMost",
  expenses: "spentMost",
  outflow: "spentMost",
  transfers: "spentMost",
  invested: "invested",
  took_out: "invested",
  kept: "saved",
  difference: "saved",
  earned: "income",
  from_savings: "spentMore",
  plan: "plan",
  category: "category",
  splits: "owed"
};

// With money hidden a question never says which side of the plan or of
// income the money fell.
const HIDDEN_QUESTION = { spentOverPlan: "spentVsPlan", spentMore: "spentVsIncome" };

/**
 * The menu a figure opens, as data: its label and its items, each with the
 * location it opens or the question it asks. Pure: the DOM is read by
 * readFigure.
 * @param {{ fig: string, arg?: string, name?: string, ids?: string[], plan?: string | null, ask?: string, period: { startMonth: string, endMonth: string } | null, search?: string, pathname?: string, hidden?: boolean }} figure
 */
export function figureMenu({ fig, arg = "", name: ownName = "", ids = [], plan = null, ask = "", period, search = "", pathname = "", hidden = false }) {
  // A Money insights line: Ask about this is its only item (the line
  // carries its own signal; figure-menu.js fires it back at the line).
  if (fig === "insight") {
    /** @type {Array<{ action: string, label: string, location?: any, question?: string }>} */
    const askOnly = [{ action: "ask-insight", label: copy.ask }];
    return { label: copy.menuLabel(copy.names.insight), title: { name: "", period: "" }, items: askOnly };
  }
  const current = new URLSearchParams(search);
  const viewId = current.get("view") || "household";
  const scope = current.get("entries_scope") || current.get("scope") || "direct_plus_shared";
  const items = [];
  // Without a period of its own a figure is about the page's month, or the
  // period of months Entries lists (entry_from, entry_to).
  const month = current.get("month") ?? "";
  const startMonth = period?.startMonth ?? ((current.get("entry_to") === month && current.get("entry_from")) || month);
  const endMonth = period?.endMonth ?? (month || startMonth);
  const endLabel = formatMonthLabel(endMonth);
  const isRange = Boolean(startMonth && endMonth && startMonth < endMonth);

  // View entries: the rows behind the figure, over the figure's period.
  const figure = fig === "category" ? "spent" : fig;
  if (ENTRY_FIGURES.includes(figure)) {
    let location;
    if (pathname.startsWith("/entries") && !period) {
      // An Entries figure: the same list, narrowed to the rows behind it.
      const next = new URLSearchParams(search);
      next.set("entry_figure", figure);
      location = { pathname: "/entries", search: `?${next.toString()}` };
    } else {
      const params = buildEntriesFilterSearch({
        month: endMonth,
        fromMonth: isRange ? startMonth : "",
        viewId,
        scope,
        figure,
        categories: fig === "category" && arg ? [arg] : [],
        entryIds: ids
      }, { fromAsk: false });
      location = { pathname: "/entries", search: `?${params.toString()}` };
    }
    items.push({ action: "entries", label: copy.viewEntries, location });
  }

  // Open plan: the Month page's plan for the period's last month.
  if (plan !== null && endMonth) {
    const params = new URLSearchParams({ view: viewId, month: endMonth, scope });
    items.push({
      action: "plan",
      label: isRange ? copy.openMonthPlan(endLabel) : copy.openPlan,
      location: { pathname: "/month", search: `?${params.toString()}`, hash: plan === "income" ? "#month-plan-income" : "#month-plan" }
    });
  }

  // Open Splits: the group, at its list of what made the balance.
  if (fig === "splits" && arg) {
    const params = new URLSearchParams({ view: viewId, month: current.get("month") || endMonth, split_group: arg });
    items.push({ action: "splits", label: copy.openSplits, location: { pathname: "/splits", search: `?${params.toString()}`, hash: "#splits-activity" } });
  }

  // Ask about this: asked at once, as if typed.
  let questionKey = ask || DEFAULT_QUESTION[fig] || "spentMost";
  if (hidden) {
    // The spending questions a figure picks by which side of its plan (or
    // of income) it fell would tell: with money hidden they are all the
    // neutral one.
    if (plan !== null && ["spentOverPlan", "spentMost"].includes(questionKey)) {
      questionKey = "spentVsPlan";
    } else if (["spending", "from_savings", "kept"].includes(fig) && ["spentMore", "spentMost"].includes(questionKey)) {
      questionKey = "spentVsIncome";
    } else {
      questionKey = HIDDEN_QUESTION[questionKey] ?? questionKey;
    }
  }
  const periodWords = !startMonth
    ? ""
    : isRange ? copy.inRange(formatMonthLabel(startMonth), endLabel) : copy.inMonth(endLabel);
  const questions = copy.questions;
  const question = questionKey === "owed"
    ? questions.owed
    : questionKey === "category"
      ? questions.category(arg, periodWords)
      : (questions[questionKey] ?? questions.spentMost)(periodWords);
  items.push({ action: "ask", label: copy.ask, question: question.replace(/ \?$/, "?") });

  // What the figure is, first in the menu: a category (or a plan row's
  // category) by its name alone, any other figure by its name and period
  // ("Invested · Jun 2025 – May 2026"). Money hidden changes no word of it.
  const isCategory = fig === "category" || (fig === "spent" && Boolean(arg));
  const name = ownName || (isCategory ? arg : copy.names[fig]) || copy.ask;
  const periodLabel = isCategory || fig === "splits" || !startMonth ? "" : isRange ? copy.periodRange(formatMonthLabel(startMonth), endLabel) : endLabel;
  return { label: copy.menuLabel(name), title: { name, period: periodLabel }, items };
}
