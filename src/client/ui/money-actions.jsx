import { messages } from "../copy/en-SG";
import { buildEntriesFilterSearch } from "../entry-filter-params";
import { formatMonthLabel } from "../formatters";
import { MONEY_ACTION_EVENT, moneyActionTarget } from "../money-jobs-model";

const copy = messages.summary.lead.moneyActions;

// The small menu a savings bar part or a money job opens (design.md "Money
// jobs"): "View entries" opens Entries filtered to the money behind it, for
// the period's last month (Entries shows one month), in the page's view and
// scope; "Ask about this" opens Ask with a question in the message box for
// the person to send. The question carries no amount, so the Ask URL never
// holds one. `period` is { startMonth, endMonth }.
//
// The shell does the navigating (App.jsx listens for MONEY_ACTION_EVENT):
// on a phone the Ask page, on a wider screen the Ask panel beside the page.
// That keeps the router and the Ask dock's launcher out of this first-screen
// chunk (scripts/check-initial-bundle.mjs counts its files).
export function MoneyActions({ actionKey, name, figures, hidden, period, onDone }) {
  const target = moneyActionTarget(actionKey, { figures, hidden });
  if (!target) {
    return null;
  }
  const { startMonth, endMonth } = period;
  const endLabel = formatMonthLabel(endMonth);
  const periodWords = startMonth === endMonth ? copy.inMonth(endLabel) : copy.inRange(formatMonthLabel(startMonth), endLabel);
  const question = copy.questions[target.question](periodWords);
  // The menu closes as it goes, so coming back finds the lead as it was.
  const send = (detail) => {
    onDone?.();
    window.dispatchEvent(new CustomEvent(MONEY_ACTION_EVENT, { detail }));
  };

  const viewEntries = () => {
    const current = new URLSearchParams(window.location.search);
    const params = buildEntriesFilterSearch({
      month: endMonth,
      viewId: current.get("view") || "household",
      scope: current.get("scope") || "direct_plus_shared",
      ...target.entries
    }, { fromAsk: false });
    send({ entries: { pathname: "/entries", search: `?${params.toString()}` } });
  };

  return (
    <span className="money-actions" role="group" aria-label={copy.label(name)} data-money-actions={actionKey}>
      {target.entries ? (
        <button type="button" className="money-action" data-action="entries" onClick={viewEntries}>
          {startMonth === endMonth ? copy.viewEntries : copy.viewMonthEntries(endLabel)}
        </button>
      ) : null}
      <button type="button" className="money-action" data-action="ask" data-question={question} onClick={() => send({ askText: question })}>
        {copy.ask}
      </button>
    </span>
  );
}
