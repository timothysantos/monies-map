import { useMemo } from "react";
import * as Dialog from "@radix-ui/react-dialog";

import { messages } from "./copy/en-SG";
import { formatMonthLabel, money } from "./formatters";
import { PrivateMoney, useMoneyPrivacy } from "./money-privacy";
import { buildMonthSheetModel, PLAN_TONE_CLASS } from "./summary-month-choice";
import "./summary-month-sheet.css";

const copy = messages.summary.monthChoice;
// Tiles show whole dollars so three fit across a phone; the All months card
// keeps cents, as the Summary cards do.
const wholeMoneyFormatter = new Intl.NumberFormat("en-SG", {
  style: "currency",
  currency: "SGD",
  minimumFractionDigits: 0,
  maximumFractionDigits: 0
});
const shortMonthFormatter = new Intl.DateTimeFormat("en-SG", { month: "short" });

function shortMonthLabel(month) {
  const [year, monthNumber] = month.split("-").map(Number);
  return shortMonthFormatter.format(new Date(year, monthNumber - 1, 1));
}

// Spend against plan as a thin bar: the track is the plan, the fill what was
// spent (capped at the plan). Over plan the fill takes the rose money tone;
// with money hidden the tone turns neutral in the stylesheet.
function SpendBar({ barPercent, toneClass }) {
  return (
    <span className="summary-month-bar" aria-hidden="true">
      <span className={`summary-month-bar-fill ${toneClass}`} style={{ width: `${barPercent}%` }} />
    </span>
  );
}

// The selected tile's tick, drawn here rather than with the icon library: a
// shared icon would split a tiny extra chunk into the first screen.
function CheckMark() {
  return (
    <svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

// The phone's "Pick a month" sheet, opened from the floating island on the
// Summary tab: All months (the range's spend against its plan) and one tile
// per range month, grouped by year, newest first. Figures come from the
// Summary page months already loaded (estimated and real spend). A modal
// Radix dialog, like the View and scope sheet: focus stays inside, Escape or
// a backdrop tap closes it, and focus returns to the island control.
export default function SummaryMonthSheet({
  open,
  onOpenChange,
  rangeStartMonth,
  rangeEndMonth,
  months,
  pickedMonth,
  onPick,
  onChangeRange
}) {
  const { areTotalsVisible } = useMoneyPrivacy();
  const model = useMemo(() => buildMonthSheetModel(months), [months]);
  const { total } = model;

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="note-dialog-overlay" />
        <Dialog.Content
          className="note-dialog-content split-dialog-content mobile-context-dialog summary-month-sheet"
          // Focus the sheet itself rather than its first button, so Tab and
          // a screen reader start inside it without a focus ring on Done.
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            if (event.currentTarget instanceof HTMLElement) {
              event.currentTarget.focus({ preventScroll: true });
            }
          }}
        >
          <div className="note-dialog-head mobile-context-dialog-head">
            <div>
              <Dialog.Title>{copy.sheetTitle}</Dialog.Title>
              <Dialog.Description className="summary-month-sheet-range">
                {rangeStartMonth && rangeEndMonth
                  ? `${formatMonthLabel(rangeStartMonth)} – ${formatMonthLabel(rangeEndMonth)}`
                  : null}
                {" · "}
                <button type="button" className="summary-month-sheet-change-range" onClick={onChangeRange}>
                  {copy.changeRange}
                </button>
              </Dialog.Description>
            </div>
            <Dialog.Close asChild>
              <button type="button" className="subtle-action mobile-context-dialog-close">{copy.done}</button>
            </Dialog.Close>
          </div>

          <div className="summary-month-sheet-body">
            <button
              type="button"
              className={`summary-month-all ${pickedMonth ? "" : "is-selected"}`}
              aria-pressed={!pickedMonth}
              onClick={() => onPick("")}
            >
              <span className="summary-month-all-top">
                <span className="summary-month-all-copy">
                  <strong>{copy.allMonths}</strong>
                  <small>{copy.allMonthsDetail}</small>
                </span>
                <span className="summary-month-all-amount">
                  <strong className={total.toneClass}>
                    <PrivateMoney>{money(total.actualMinor)}</PrivateMoney>
                  </strong>
                  <small className={PLAN_TONE_CLASS}>
                    {copy.planPrefix} <PrivateMoney>{money(total.plannedMinor)}</PrivateMoney> {copy.planSuffix}
                  </small>
                </span>
              </span>
              <SpendBar barPercent={total.barPercent} toneClass={total.toneClass} />
            </button>

            {model.years.map(({ year, months: yearMonths }) => (
              <section key={year} className="summary-month-year" aria-label={year}>
                <h3 className="summary-month-year-label">{year}</h3>
                <div className="summary-month-tiles">
                  {yearMonths.map((month) => {
                    const isSelected = month.month === pickedMonth;
                    return (
                      <button
                        key={month.month}
                        type="button"
                        className={`summary-month-tile ${isSelected ? "is-selected" : ""}`}
                        aria-pressed={isSelected}
                        onClick={() => onPick(month.month)}
                      >
                        <strong>
                          {shortMonthLabel(month.month)}
                          <span className="summary-month-tile-year"> {year}</span>
                        </strong>
                        <span className={`summary-month-tile-amount ${month.toneClass}`}>
                          <PrivateMoney>{wholeMoneyFormatter.format(month.actualMinor / 100)}</PrivateMoney>
                          {/* "over" says the sign, so hidden money drops it. */}
                          {month.isOver && areTotalsVisible ? ` · ${copy.over}` : null}
                        </span>
                        <SpendBar barPercent={month.barPercent} toneClass={month.toneClass} />
                        {isSelected ? (
                          <span className="summary-month-tile-check" aria-hidden="true"><CheckMark /></span>
                        ) : null}
                      </button>
                    );
                  })}
                </div>
              </section>
            ))}

            <p className="summary-month-legend" aria-hidden="true">
              <span><i className="summary-month-legend-spent" />{copy.legendSpent}</span>
              <span><i className="summary-month-legend-over money-short" />{copy.legendOver}</span>
            </p>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
