import { figureCopy as copy } from "./copy/figure-copy";
import { buildEntriesFilterSearch, ENTRY_FIGURES } from "./entry-filter-params";
import { formatMonthLabel } from "./formatters";
import { tripFigureSearch } from "./trip-figure-search";

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
 * `view` (data-fig-view) opens the figure in that view whatever the page's:
 * Investments over time and Tax reliefs count whole amounts, so their
 * figures open in the household view.
 * @param {{ fig: string, arg?: string, name?: string, ids?: string[], plan?: string | null, ask?: string, period: { startMonth: string, endMonth: string } | null, search?: string, pathname?: string, hidden?: boolean, view?: string, trip?: { personId?: string, categoryName?: string, group?: string, list?: boolean } }} figure
 */
export function figureMenu({ fig, arg = "", name: ownName = "", ids = [], plan = null, ask = "", period, search: pageSearch = "", pathname = "", hidden = false, view = "", trip = {} }) {
  const search = view ? viewSearch(pageSearch, view) : pageSearch;
  // A trip or event's figure (data-fig="trip", data-fig-arg its id): the
  // trip view, narrowed to the figure's slice. Its Spent lead is the list
  // itself, so it offers Open Splits (a linked split group) and Ask.
  if (fig === "trip") {
    const tripItems = [];
    if (!trip.list) {
      tripItems.push({
        action: "entries",
        label: copy.viewEntries,
        location: { pathname: "/entries", search: tripFigureSearch(search, { tripEventId: arg, personId: trip.personId, categoryName: trip.categoryName, entryIds: ids }) }
      });
    }
    if (trip.group) {
      const current = new URLSearchParams(search);
      const params = new URLSearchParams({ view: current.get("view") || "household", split_group: trip.group });
      if (current.get("month")) params.set("month", current.get("month"));
      tripItems.push({ action: "splits", label: copy.openSplits, location: { pathname: "/splits", search: `?${params.toString()}`, hash: "#splits-activity" } });
    }
    const tripName = ownName || copy.names.trip;
    tripItems.push({ action: "ask", label: copy.ask, question: copy.questions.trip(tripName) });
    return { label: copy.menuLabel(tripName), title: { name: tripName, period: "" }, items: tripItems };
  }
  // An investment statement's figure (data-fig="statement"; Investments
  // over time): it opens that account's statements on Imports (data-fig-arg
  // the account's name; none: every import), and Ask.
  if (fig === "statement") {
    const params = new URLSearchParams({ view: new URLSearchParams(search).get("view") || "household" });
    if (arg) params.set("import_account", arg);
    const statementName = ownName || copy.names.statement;
    return {
      label: copy.menuLabel(statementName),
      title: { name: statementName, period: "" },
      items: [
        { action: "imports", label: arg ? copy.openStatement : copy.openStatements, location: { pathname: "/imports", search: `?${params.toString()}`, hash: "#import-history" } },
        { action: "ask", label: copy.ask, question: copy.questions.investments }
      ]
    };
  }
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
      // An Entries figure: the same list, narrowed to the rows behind it
      // (a category's slice on Entries: to that category alone).
      const next = new URLSearchParams(search);
      next.set("entry_figure", figure);
      if (fig === "category" && arg) {
        next.delete("entry_category");
        next.append("entry_category", arg);
      }
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
      : questionKey === "shop"
        // A Subscriptions and bills figure: the payee its menu is titled with.
        ? questions.shop(ownName, periodWords)
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

// The page's search in another view: that view, its default scope.
function viewSearch(search, view) {
  const next = new URLSearchParams(search);
  next.set("view", view);
  next.delete("scope");
  next.delete("entries_scope");
  return `?${next.toString()}`;
}
