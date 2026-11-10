import "./pace-line.css";

import { paceLineWords, paceYearWords } from "./pace-line-model";

// If this keeps up (DOMAIN.md "Pace"; design.md "If this keeps up"): where
// this month's spending ends if the month keeps going as it has, always a
// range, drawn in the plan tone (sky) only: what is spent is a plain solid
// bar, the low end a dashed continuation, the high end a hatched block,
// with the plan's mark. It is a figure (`data-fig="pace"`) whose menu says
// how it is worked out and offers Ask about this; never View entries
// (nothing in it has happened yet). Hidden money draws nothing at all, not
// even the shape.

/**
 * @param {{ pace: any, spentSoFarMinor?: number | null, planMinor?: number | null, money: (minor: number) => string, hidden: boolean, showLeft?: boolean, yearMonths?: any[] | null, className?: string }} props
 */
export function PaceLine({ pace, spentSoFarMinor = null, planMinor = null, money, hidden, showLeft = false, yearMonths = null, className = "" }) {
  if (hidden || !pace?.range) {
    return null;
  }
  const { spent, totals, plan, sentence, note, left } = paceLineWords({ pace, spentSoFarMinor, planMinor, money });
  const yearLine = yearMonths ? paceYearWords({ pace, spentSoFarMinor, months: yearMonths, money }) : "";
  const scale = Math.max(totals.highMinor, plan ?? 0, 1);
  const pct = (value) => `${Math.max(0, Math.min(100, (value / scale) * 100)).toFixed(2)}%`;
  return (
    <div className={`pace-line ${className}`.trim()} data-pace-line={pace.month} data-fig-period={`${pace.month}:${pace.month}`}>
      <div className="pace-bar" aria-hidden="true">
        <span className="pace-bar-spent" style={{ width: pct(spent) }} />
        <span className="pace-bar-low" style={{ left: pct(spent), width: pct(totals.lowMinor - spent) }} />
        <span className="pace-bar-high" style={{ left: pct(totals.lowMinor), width: pct(totals.highMinor - totals.lowMinor) }} />
        {plan ? <span className="pace-bar-plan" style={{ left: pct(plan) }} /> : null}
      </div>
      <p className="pace-text">
        <span data-fig="pace" data-fig-note={note.join("\n")} tabIndex={0} role="button">{sentence}</span>
        {showLeft && left ? ` ${left}` : ""}
      </p>
      {yearLine ? <p className="pace-text pace-year" data-pace-year={pace.month.slice(0, 4)}>{yearLine}</p> : null}
    </div>
  );
}
