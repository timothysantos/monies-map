import { messages } from "./copy/en-SG";
import { formatMonthLabel } from "./formatters";

// The Summary tab's month choice controls that ship with the app shell (both
// are small): the phone's floating-island control and the desktop month row.
// The "Pick a month" sheet the island opens is its own lazy module
// (summary-month-sheet.jsx). App owns the choice and the URL; these only lay
// it out (summary-month-choice.js holds the rules).
const copy = messages.summary.monthChoice;

// Phone: beside the View and scope trigger in the floating island. "All
// months ▾" opens the sheet; with a month picked it reads "‹ Sep 2026 ›",
// where the arrows step through the range's months and the middle opens the
// sheet. Disabled until the range's months are known.
export function SummaryMonthIslandControl({
  pickedMonth,
  previousMonth,
  nextMonth,
  disabled = false,
  onStep,
  onOpen,
  intentProps = {}
}) {
  if (!pickedMonth) {
    return (
      <button
        type="button"
        className="mobile-month-choice mobile-month-choice-all"
        aria-haspopup="dialog"
        disabled={disabled}
        onClick={onOpen}
        {...intentProps}
      >
        <span className="mobile-month-choice-copy">
          <strong>{copy.allMonths}</strong>
          <span>{copy.label}</span>
        </span>
        <span className="mobile-month-choice-caret" aria-hidden="true">▾</span>
      </button>
    );
  }

  return (
    <div className="mobile-month-choice" role="group" aria-label={copy.label}>
      <button
        type="button"
        className="mobile-month-choice-step"
        aria-label={copy.previousMonth}
        disabled={disabled || !previousMonth}
        onClick={() => onStep(previousMonth)}
      >
        ‹
      </button>
      <button
        type="button"
        className="mobile-month-choice-open"
        aria-haspopup="dialog"
        disabled={disabled}
        onClick={onOpen}
      >
        <strong>{formatMonthLabel(pickedMonth)}</strong>
        <span>{copy.label} <span aria-hidden="true">▾</span></span>
      </button>
      <button
        type="button"
        className="mobile-month-choice-step"
        aria-label={copy.nextMonth}
        disabled={disabled || !nextMonth}
        onClick={() => onStep(nextMonth)}
      >
        ›
      </button>
    </div>
  );
}

// Desktop and tablet: one compact row under the header, All months then the
// range's months newest first, in the pill style the Spending Mix month chips
// used. Hidden on a phone, where the island control takes its place.
export function SummaryMonthSelector({ rangeMonths, pickedMonth, onPick, intentProps = {} }) {
  if (!rangeMonths.length) {
    return null;
  }
  const option = (month, label) => (
    <button
      key={month || "all"}
      type="button"
      className={`summary-focus-button ${pickedMonth === month ? "is-active" : ""}`}
      aria-pressed={pickedMonth === month}
      onClick={() => onPick(month)}
      {...(month ? intentProps : {})}
    >
      {label}
    </button>
  );
  return (
    <div className="summary-month-selector" role="group" aria-label={copy.label}>
      {option("", copy.allMonths)}
      {rangeMonths.slice().reverse().map((month) => option(month, formatMonthLabel(month)))}
    </div>
  );
}
