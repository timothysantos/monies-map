import "./pace-line.css";

import { paceCopy as copy } from "./copy/pace-copy";
import { paceTotals } from "../domain/pace";

// If this keeps up (DOMAIN.md "Pace"; design.md "If this keeps up"): where
// this month's spending ends if the month keeps going as it has, always a
// range, drawn in the plan tone (sky) only: what is spent is solid, the low
// end a dashed continuation, the high end a hatched block, with the plan's
// mark. It is a figure (`data-fig="pace"`) whose menu says how it is worked
// out and offers Ask about this; never View entries (nothing in it has
// happened yet). Hidden money draws nothing at all, not even the shape.

const MONTH_END = (month) => {
  const [year, number] = month.split("-").map(Number);
  return `${month}-${String(new Date(Date.UTC(year, number, 0)).getUTCDate()).padStart(2, "0")}`;
};

function stepWords(minor) {
  return Math.abs(minor) < 100_000 ? "$10" : Math.abs(minor) < 1_000_000 ? "$50" : "$100";
}

/**
 * @param {{ pace: any, spentSoFarMinor?: number | null, planMinor?: number | null, money: (minor: number) => string, hidden: boolean, showLeft?: boolean, className?: string }} props
 */
export function PaceLine({ pace, spentSoFarMinor = null, planMinor = null, money, hidden, showLeft = false, className = "" }) {
  if (hidden || !pace?.range) {
    return null;
  }
  const spent = Number.isFinite(spentSoFarMinor) ? spentSoFarMinor : pace.spentSoFarMinor ?? 0;
  const totals = paceTotals(spent, pace.range);
  const low = money(totals.shown.lowMinor);
  const high = money(totals.shown.highMinor);
  const plan = Number.isFinite(planMinor) && planMinor > 0 ? planMinor : null;
  // The plan is named when the whole range is on one side of it.
  const side = !plan ? null : totals.highMinor <= plan ? "under" : totals.lowMinor > plan ? "over" : null;
  const sentence = `${copy.line(low, high, MONTH_END(pace.month))}${side ? `, ${copy.plan(money(plan), side === "over")}` : ""}.`;
  const oneOffs = (pace.range.oneOffs ?? []).reduce((sum, item) => sum + item.amountMinor, 0);
  const note = [
    copy.workedOut,
    copy.spentSoFar(money(spent)),
    copy.everyday(pace.range.daysLeft, money(pace.range.everydayLowMinor), money(pace.range.everydayHighMinor)),
    copy.bills(money(pace.range.billsLowMinor), money(pace.range.billsHighMinor)),
    ...(oneOffs > 0 ? [copy.onceOnly(money(oneOffs))] : []),
    copy.roundedTo(stepWords(totals.highMinor))
  ].join(" · ");
  const scale = Math.max(totals.highMinor, plan ?? 0, 1);
  const pct = (value) => `${Math.max(0, Math.min(100, (value / scale) * 100)).toFixed(2)}%`;
  return (
    <div className={`pace-line ${className}`.trim()} data-fig-period={`${pace.month}:${pace.month}`}>
      <div className="pace-bar" aria-hidden="true">
        <span className="pace-bar-spent" style={{ width: pct(spent) }} />
        <span className="pace-bar-low" style={{ left: pct(spent), width: pct(totals.lowMinor - spent) }} />
        <span className="pace-bar-high" style={{ left: pct(totals.lowMinor), width: pct(totals.highMinor - totals.lowMinor) }} />
        {plan ? <span className="pace-bar-plan" style={{ left: pct(plan) }} /> : null}
      </div>
      <p className="pace-text">
        <span data-fig="pace" data-fig-note={note} data-fig-ask="plan" data-fig-plan="" tabIndex={0} role="button">{sentence}</span>
        {showLeft && pace.range.incomeMinor > 0 ? ` ${copy.left(money(totals.leftShown.lowMinor), money(totals.leftShown.highMinor))}` : ""}
      </p>
    </div>
  );
}
