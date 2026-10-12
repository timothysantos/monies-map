import { useNavigate, useSearchParams } from "react-router-dom";

import { openAskDock } from "../ask-dock";
import { messages } from "../copy/en-SG";
import { buildEntriesFilterSearch } from "../entry-filter-params";
import { formatMonthLabel } from "../formatters";
import { moneyActionTarget } from "../money-jobs-model";
import { isMobileLayout } from "../use-viewport";

const copy = messages.summary.lead.moneyActions;

// The small menu a savings bar part or a money job opens (design.md "Money
// jobs"): "View entries" opens Entries filtered to the money behind it, for
// the period's last month (Entries shows one month), in the page's view and
// scope; "Ask about this" opens Ask with a question in the message box for
// the person to send (the Ask page on a phone, the Ask panel beside the page
// on a wide screen). The question carries no amount, so the Ask URL never
// holds one. `period` is { startMonth, endMonth }.
export function MoneyActions({ actionKey, name, figures, hidden, period }) {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const target = moneyActionTarget(actionKey, { figures, hidden });
  if (!target) {
    return null;
  }
  const { startMonth, endMonth } = period;
  const viewId = searchParams.get("view") || "household";
  const scope = searchParams.get("scope") || "direct_plus_shared";
  const endLabel = formatMonthLabel(endMonth);
  const periodWords = startMonth === endMonth ? copy.inMonth(endLabel) : copy.inRange(formatMonthLabel(startMonth), endLabel);
  const question = copy.questions[target.question](periodWords);

  const viewEntries = () => {
    const params = buildEntriesFilterSearch({ month: endMonth, viewId, scope, ...target.entries }, { fromAsk: false });
    navigate({ pathname: "/entries", search: `?${params.toString()}` });
  };
  const ask = () => {
    if (isMobileLayout()) {
      const params = new URLSearchParams({ view: viewId, month: endMonth, scope, ask_text: question });
      navigate({ pathname: "/ask", search: `?${params.toString()}` });
    } else {
      openAskDock({ intent: { mode: "chat" }, text: question });
    }
  };

  return (
    <span className="money-actions" role="group" aria-label={copy.label(name)} data-money-actions={actionKey}>
      {target.entries ? (
        <button type="button" className="money-action" data-action="entries" onClick={viewEntries}>
          {startMonth === endMonth ? copy.viewEntries : copy.viewMonthEntries(endLabel)}
        </button>
      ) : null}
      <button type="button" className="money-action" data-action="ask" data-question={question} onClick={ask}>
        {copy.ask}
      </button>
    </span>
  );
}
