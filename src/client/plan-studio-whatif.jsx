import { useId } from "react";

import { planStudioCopy } from "./copy/plan-studio-copy";
import { AmountEditor } from "./plan-studio-amount";
import { RollingMoney } from "./plan-studio-parts";
import { StudioSlider } from "./plan-studio-slider-control";
import { sliderValueText } from "./plan-studio-slider";
import { ResponsiveSelect } from "./responsive-select";

const copy = planStudioCopy.whatIf;
const noop = () => {};

// Where the extra saving would come from, in plain words. Left over pays
// first, then the categories; a lower target gives money back.
function whereFrom(preview, fmt) {
  if (!preview) return [];
  const lines = [];
  if (preview.givenBackMinor > 0) lines.push({ key: "back", text: copy.giveBack(fmt.money(preview.givenBackMinor)) });
  if (preview.fromLeftMinor > 0) lines.push({ key: "left", text: copy.fromLeft(fmt.money(preview.fromLeftMinor)) });
  if (preview.takenFrom.length === 1) {
    lines.push({ key: "row", text: copy.fromRow(fmt.money(preview.takenFrom[0].minor), preview.takenFrom[0].label) });
  } else if (preview.takenFrom.length > 1) {
    const total = preview.takenFrom.reduce((sum, part) => sum + part.minor, 0);
    lines.push({ key: "rows", text: copy.fromRows(fmt.money(total), preview.takenFrom.length) });
  }
  if (preview.shortfallMinor > 0) lines.push({ key: "short", text: copy.short(fmt.money(preview.shortfallMinor)), short: true });
  return lines;
}

/**
 * "What if I save more?" (design.md "Plan Studio"): try a bigger (or smaller)
 * savings target with a slider or an exact amount and see where the money
 * would come from, the resulting save total and the plan balance, before
 * anything changes. "Apply to plan" holds it as an ordinary change (Undo and
 * Save plan still apply); "Cancel" drops it. It changes the plan only: no
 * spending is predicted, and nothing here is a forecast or a limit.
 */
export function WhatIfCard({
  fmt, hasSaveRow, saveTotalMinor, totals, preview, targetMinor, maxMinor, stepMinor, takeOptions, takeFromKey,
  onTry, onTakeFrom, onApply, onCancel
}) {
  const hintId = useId();
  const trying = Boolean(preview);
  const shown = trying ? targetMinor : saveTotalMinor;
  const after = preview?.totals ?? totals;
  const lines = whereFrom(preview, fmt);
  return (
    <section className="ps-card ps-whatif" data-ps-whatif aria-label={copy.title}>
      <div className="ps-card-head">
        <span className="ps-eyebrow">{copy.title}</span>
      </div>
      <p className="ps-note">{copy.note}</p>
      {hasSaveRow ? (
        <>
          <div className="ps-whatif-target">
            <span>{copy.target}</span>
            <AmountEditor
              label={copy.target}
              valueMinor={shown}
              savedMinor={saveTotalMinor}
              fmt={fmt}
              display={trying ? <span>{copy.tryLabel(fmt.money(shown))}</span> : <RollingMoney minor={shown} fmt={fmt} />}
              onApply={onTry}
            />
          </div>
          <StudioSlider
            label={copy.target}
            valueMinor={shown}
            savedMinor={saveTotalMinor}
            actualMinor={0}
            paceMinor={null}
            maxMinor={maxMinor}
            stepMinor={stepMinor}
            valueText={sliderValueText({ valueMinor: shown, hidden: fmt.hidden, format: fmt.money })}
            spendLike={false}
            hidden={true /* this track draws no spending marks */}
            describedBy={hintId}
            onChange={onTry}
            onGestureStart={noop}
            onGestureEnd={noop}
          />
          <p className="ps-hint" id={hintId}>{trying ? "" : copy.slide}</p>
          <div className="ps-whatif-grid">
            <div><span className="ps-muted">{copy.saveTotal}</span><b><RollingMoney minor={after.save} fmt={fmt} /></b></div>
            <div><span className="ps-muted">{copy.left}</span><b className={after.left < 0 && !fmt.hidden ? "money-short" : ""}><RollingMoney minor={after.left} fmt={fmt} /></b></div>
            <div><span className="ps-muted">{copy.planOut}</span><b><RollingMoney minor={after.out} fmt={fmt} /></b></div>
          </div>
          <ul className="ps-whatif-from" aria-live="polite">
            {lines.map((line) => <li key={line.key} className={line.short && !fmt.hidden ? "money-short" : ""}>{line.text}</li>)}
          </ul>
          {trying ? (
            <label className="ps-whatif-take">
              <span>{copy.takeFrom}</span>
              <ResponsiveSelect
                value={takeFromKey}
                options={takeOptions}
                title={copy.takeFrom}
                className="ps-select"
                onValueChange={onTakeFrom}
              />
            </label>
          ) : null}
          <div className="ps-actions">
            <button type="button" className="ps-quiet" disabled={!trying} onClick={onCancel}>{copy.cancel}</button>
            <button type="button" className="ps-primary" disabled={!trying} onClick={onApply} data-ps-whatif-apply>{copy.apply}</button>
          </div>
        </>
      ) : (
        <p className="ps-hint">{copy.noSaveRow}</p>
      )}
    </section>
  );
}
