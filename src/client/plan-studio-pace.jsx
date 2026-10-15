import { planStudioCopy } from "./copy/plan-studio-copy";
import { RollingMoney } from "./plan-studio-parts";

const copy = planStudioCopy.pace;

// One thin bar on the shared scale: what happened, the plan's dashed line and,
// for spending, a solid mark for the usual by today.
function PaceBar({ actualMinor, planMinor, scaleMinor, todayMinor, hidden, over = false, good = false, markLabel = "" }) {
  const percent = (minor) => `${Math.min(100, (minor / scaleMinor) * 100)}%`;
  return (
    <div className="ps-pace-bar">
      {hidden ? null : <div className={`ps-pace-fill${good ? " is-good" : over ? " is-over" : ""}`} style={{ width: percent(actualMinor) }} />}
      <div className="ps-pace-plan" style={{ left: percent(planMinor) }} />
      {todayMinor !== null && !hidden ? <div className="ps-pace-today" style={{ left: percent(todayMinor) }} data-label={markLabel} /> : null}
    </div>
  );
}

/**
 * How the month is going against the plan (design.md "Plan Studio"): money in
 * so far against planned money in, spent so far against planned spend with a
 * mark for what the plan usually expects by today (bills and rent by their
 * due date, flexible budgets in a straight line), and a plain verdict. It only
 * reads what was recorded against the plan: nothing is predicted.
 */
export function PaceCard({ fmt, incomeMinor, plannedInMinor, spentMinor, plannedSpendMinor, expectedMinor, isCurrent, verdict, moneyInText }) {
  const scaleMinor = Math.max(plannedInMinor, plannedSpendMinor, incomeMinor, spentMinor, 1);
  const text = fmt.hidden
    ? copy.hiddenText
    : verdict.kind === "on_track"
      ? copy.onTrack(fmt.money(spentMinor), fmt.money(verdict.expectedMinor))
      : verdict.kind === "ahead"
        ? copy.ahead(fmt.money(spentMinor), fmt.money(verdict.aheadByMinor))
        : copy.over(fmt.money(spentMinor), fmt.money(verdict.overByMinor));
  return (
    <section className="ps-card ps-pace" data-ps-pace aria-label={copy.heading}>
      <div className="ps-card-head"><span className="ps-eyebrow">{copy.heading}</span></div>
      <div className="ps-mini">
        <div className="ps-mini-label">
          <span>{copy.moneyIn}</span>
          <span><b><RollingMoney minor={incomeMinor} fmt={fmt} /></b> <span className="ps-muted">{copy.ofPlanned(fmt.money(plannedInMinor))}</span></span>
        </div>
        <PaceBar actualMinor={incomeMinor} planMinor={plannedInMinor} scaleMinor={scaleMinor} todayMinor={null} hidden={fmt.hidden} good />
      </div>
      <div className="ps-mini">
        <div className="ps-mini-label">
          <span>{copy.spent}</span>
          <span><b><RollingMoney minor={spentMinor} fmt={fmt} /></b> <span className="ps-muted">{copy.ofPlanned(fmt.money(plannedSpendMinor))}</span></span>
        </div>
        <PaceBar
          actualMinor={spentMinor}
          planMinor={plannedSpendMinor}
          scaleMinor={scaleMinor}
          todayMinor={isCurrent ? expectedMinor : null}
          markLabel={copy.usualByToday}
          over={spentMinor > plannedSpendMinor}
          hidden={fmt.hidden}
        />
      </div>
      <div className={`ps-banner ps-health ${fmt.hidden ? "is-neutral" : `is-${verdict.tone}`}`} data-ps-health data-kind={fmt.hidden ? "hidden" : verdict.kind}>
        <div>
          <b>{fmt.hidden ? copy.hiddenVerdict : copy.verdict[verdict.kind]}</b>
          <span>{text}{fmt.hidden ? "" : ` ${moneyInText}`}</span>
        </div>
      </div>
    </section>
  );
}
