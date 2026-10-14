import "./figure-menu.css";
import { figureMenu } from "./figure-menu-model";

// Openable figures (design.md "Openable figures"): every figure on a card
// can be opened. The figure keeps its text; it carries `data-fig` and a few
// data attributes, and one listener in the shell (App.jsx) loads this module
// on the first tap, click, Enter or Space and calls toggleFigureMenu. The
// module draws a small menu under the figure with the places that explain
// it: "View entries" (Entries narrowed to exactly the money behind the
// figure, so its total is the figure), "Open plan" (the Month page's plan),
// "Open Splits" (the group) and "Ask about this" (the question asked and
// answered at once). It imports no React (the menu is a few DOM nodes), so
// it adds no first-screen file.
//
// A figure's attributes:
// - data-fig: what it is. A money figure (src/domain/money-figures.ts:
//   spending, invested, kept, earned, from_savings, took_out, spent,
//   transfers, outflow, difference), or `category` (a category's spending;
//   data-fig-arg is the category), `plan` (a plan figure: Open plan and
//   Ask only) or `splits` (a split balance; data-fig-arg is the group id).
// - data-fig-period: "YYYY-MM:YYYY-MM", on the figure or any parent (the
//   lead group sets it once for its figures).
// - data-fig-ids: entry ids, space separated (a Month plan row's actual).
// - data-fig-plan: the figure has a plan line: "Open plan" goes to that
//   part of the Month plan ("income", or "" for the whole plan).
// - data-fig-ask: the question to ask, a key of figureCopy.questions.
// - data-fig-note: a line that explains the figure, shown first in the menu
//   (Month's To allocate).
// The view and scope are the page's own (the URL).

// What a figure element says about itself (see the attributes above).
export function readFigure(element) {
  const periodText = element.closest("[data-fig-period]")?.getAttribute("data-fig-period") ?? "";
  const [startMonth, endMonth] = periodText.split(":");
  const ids = (element.getAttribute("data-fig-ids") ?? "").split(" ").filter(Boolean);
  return {
    fig: element.getAttribute("data-fig") ?? "",
    arg: element.getAttribute("data-fig-arg") ?? "",
    ids,
    plan: element.hasAttribute("data-fig-plan") ? element.getAttribute("data-fig-plan") ?? "" : null,
    ask: element.getAttribute("data-fig-ask") ?? "",
    period: startMonth ? { startMonth, endMonth: endMonth || startMonth } : null,
    search: window.location.search,
    pathname: window.location.pathname,
    hidden: document.documentElement.dataset.moneyPrivacy === "hidden"
  };
}

// The window event the shell (App.jsx) navigates on: { entries: location }
// opens Entries, the Month plan or Splits; { askText } asks Ask.
export const MONEY_ACTION_EVENT = "monies:money-action";

let open = null;

function close({ restoreFocus = false } = {}) {
  if (!open) {
    return;
  }
  const { trigger, menu, cleanup } = open;
  open = null;
  cleanup();
  menu.remove();
  trigger.setAttribute("aria-expanded", "false");
  if (restoreFocus && trigger.isConnected) {
    trigger.focus();
  }
}

// Under the figure, inside the page's 16 px gutters; above it when there is
// no room below. A donut slice (SVG) is anchored at its middle, or at the
// pointer that rested on it (`point`).
function place(menu, trigger, point) {
  let rect = trigger.getBoundingClientRect();
  if (point || trigger instanceof SVGElement) {
    const x = point?.x ?? rect.left + rect.width / 2;
    const y = point?.y ?? rect.top + rect.height / 2;
    rect = { left: x, top: y, bottom: y + 4 };
  }
  const width = menu.offsetWidth;
  const height = menu.offsetHeight;
  const viewport = document.documentElement.clientWidth;
  const left = Math.max(16, Math.min(rect.left, viewport - width - 16));
  const below = rect.bottom + 6;
  const top = below + height > window.innerHeight - 8 && rect.top - height - 6 > 8 ? rect.top - height - 6 : below;
  menu.style.left = `${left + window.scrollX}px`;
  menu.style.top = `${top + window.scrollY}px`;
}

/**
 * Opens the figure's menu, or closes it when it is the one open. Enter or
 * Space opens it with the first item focused; Escape closes it and gives
 * the figure its focus back; a press outside, scrolling the page sideways or
 * resizing closes it. Choosing an item closes it and sends the shell the
 * place to open.
 */
export function toggleFigureMenu(trigger) {
  if (open?.trigger === trigger) {
    // A menu a resting pointer opened stays open for the click that follows.
    if (open.byHover) {
      open.byHover = false;
      open.menu.querySelector("button")?.focus({ preventScroll: true });
      return;
    }
    close({ restoreFocus: true });
    return;
  }
  openFigureMenu(trigger);
}

/**
 * Opens the figure's menu (a donut slice's on a resting pointer: `point`
 * places it there and `focus: false` leaves the focus where it is). Already
 * open for this figure, it stays as it is.
 * @param {Element} trigger
 * @param {{ point?: { x: number, y: number }, focus?: boolean }} [options]
 */
export function openFigureMenu(trigger, { point = undefined, focus = true } = {}) {
  if (open?.trigger === trigger || !trigger.isConnected) {
    return;
  }
  close();
  const view = figureMenu(readFigure(trigger));
  const menu = document.createElement("div");
  menu.className = "figure-menu money-actions";
  menu.setAttribute("role", "group");
  menu.setAttribute("aria-label", view.label);
  menu.setAttribute("data-figure-menu", trigger.getAttribute("data-fig") ?? "");
  // The figure's explanation or quick facts, one per line.
  const note = trigger.getAttribute("data-fig-note");
  if (note) {
    const facts = document.createElement("div");
    facts.className = "figure-menu-note";
    for (const text of note.split("\n")) {
      const line = document.createElement("p");
      line.textContent = text;
      facts.appendChild(line);
    }
    menu.appendChild(facts);
  }
  for (const item of view.items) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "money-action";
    button.dataset.action = item.action;
    button.textContent = item.label;
    if (item.question) {
      button.dataset.question = item.question;
    }
    button.addEventListener("click", () => {
      close();
      window.dispatchEvent(new CustomEvent(MONEY_ACTION_EVENT, { detail: item.location ? { entries: item.location } : { askText: item.question } }));
    });
    menu.appendChild(button);
  }
  document.body.appendChild(menu);
  place(menu, trigger, point);
  trigger.setAttribute("aria-expanded", "true");

  const onKey = (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      close({ restoreFocus: true });
    }
  };
  const onPress = (event) => {
    if (!menu.contains(event.target) && !trigger.contains(event.target)) {
      close();
    }
  };
  // Focus leaving both the menu and the figure (Tab past the last item).
  const onFocusOut = (event) => {
    const next = event.relatedTarget;
    if (next && !menu.contains(next) && next !== trigger) {
      close();
    }
  };
  // Resizing, or Back to another page, closes it.
  const onResize = () => close();
  document.addEventListener("keydown", onKey);
  document.addEventListener("click", onPress);
  menu.addEventListener("focusout", onFocusOut);
  window.addEventListener("resize", onResize);
  window.addEventListener("popstate", onResize);
  open = {
    trigger,
    menu,
    byHover: !focus,
    cleanup: () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("click", onPress);
      menu.removeEventListener("focusout", onFocusOut);
      window.removeEventListener("resize", onResize);
      window.removeEventListener("popstate", onResize);
    }
  };
  if (focus) {
    menu.querySelector("button")?.focus({ preventScroll: true });
  }
}

// The menu leaves with the page it belongs to (a route change).
export function closeFigureMenu() {
  close();
}
