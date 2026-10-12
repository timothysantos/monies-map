import { MONEY_ACTION_EVENT } from "../money-jobs-model";

// The small menu a savings bar part or a money job opens (design.md "Money
// jobs"): "View entries" opens Entries filtered to the money behind it, and
// "Ask about this" opens Ask with a question in the message box for the
// person to send. `view` is moneyActionView's (money-jobs-words.js, which
// loads on the first hover, focus or tap, so its words and the Entries
// filter code stay out of the first screen). The question carries no
// amount, so the Ask URL never holds one.
//
// The shell does the navigating (App.jsx listens for MONEY_ACTION_EVENT):
// on a phone the Ask page, on a wider screen the Ask panel beside the page.
// That keeps the router and the Ask dock's launcher out of the lead's
// chunks. The menu closes as it goes, so Back finds the lead as it was.
export function MoneyActions({ actionKey, view, onDone }) {
  if (!view) {
    return null;
  }
  const send = (detail) => {
    onDone?.();
    window.dispatchEvent(new CustomEvent(MONEY_ACTION_EVENT, { detail }));
  };
  return (
    <span className="money-actions" role="group" aria-label={view.label} data-money-actions={actionKey}>
      {view.entries ? (
        <button type="button" className="money-action" data-action="entries" onClick={() => send({ entries: view.entries.location })}>
          {view.entries.label}
        </button>
      ) : null}
      <button type="button" className="money-action" data-action="ask" data-question={view.ask.question} onClick={() => send({ askText: view.ask.question })}>
        {view.ask.label}
      </button>
    </span>
  );
}
