import { useEffect, useId, useRef, useState } from "react";

import { messages } from "../copy/en-SG";
import { useMoneyPrivacy } from "../money-privacy";
import { buildSavingsBarModel } from "../savings-bar-model";

const copy = messages.summary.lead.savingsBar;

// The savings bar under the lead figure (design.md, "Lead · Support ·
// Detail"; model in savings-bar-model.js): money earned is the bar, spent is
// rose and kept is mint, with a thin plan bar under it and one plain line.
// Each segment is a button: hover (mouse), tap or Enter opens its popover
// with the percentage of income; screen readers read the same text through
// aria-describedby, which is always in the page. Hidden money keeps the
// percentages and neutral colours, and shows no amount anywhere.
export function SavingsBar({ income, spent, plannedSpend, savingsTarget }) {
  const { areTotalsVisible } = useMoneyPrivacy();
  const baseId = useId();
  const rootRef = useRef(null);
  const lastPointer = useRef("");
  const [openKey, setOpenKey] = useState(null);
  const model = buildSavingsBarModel({
    incomeMinor: income,
    spentMinor: spent,
    plannedSpendMinor: plannedSpend,
    savingsTargetMinor: savingsTarget,
    hidden: !areTotalsVisible
  });

  // A tap or press outside, or Escape, closes the open popover.
  useEffect(() => {
    if (!openKey) {
      return undefined;
    }
    const close = (event) => {
      if (event.type === "keydown" ? event.key === "Escape" : !rootRef.current?.contains(event.target)) {
        setOpenKey(null);
      }
    };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", close);
    };
  }, [openKey]);

  if (!model) {
    return null;
  }

  let start = 0;
  const placed = model.segments.map((segment) => {
    const placement = { ...segment, centre: start + segment.widthPercent / 2 };
    start += segment.widthPercent;
    return placement;
  });

  return (
    <div className="savings-bar" ref={rootRef} data-savings-bar>
      <div className="savings-bar-track" role="group" aria-label={copy.label}>
        {placed.map((segment) => (
          <button
            key={segment.key}
            type="button"
            className={`savings-bar-segment money-${segment.tone} ${segment.hatched ? "is-hatched" : ""}`}
            data-segment={segment.key}
            style={{ width: `${segment.widthPercent}%` }}
            aria-label={segment.name}
            aria-describedby={`${baseId}-${segment.key}`}
            aria-expanded={openKey === segment.key}
            onPointerEnter={(event) => event.pointerType === "mouse" && setOpenKey(segment.key)}
            onPointerLeave={(event) => event.pointerType === "mouse" && setOpenKey((current) => (current === segment.key ? null : current))}
            onPointerDown={(event) => { lastPointer.current = event.pointerType; }}
            onKeyDown={() => { lastPointer.current = "keyboard"; }}
            // A mouse click keeps the hover popover open; a tap or Enter toggles.
            onClick={() => setOpenKey((current) => (lastPointer.current === "mouse" || current !== segment.key ? segment.key : null))}
          />
        ))}
        {model.tickPercent !== null ? (
          <span className={`savings-bar-tick ${model.tickPercent > 75 ? "is-late" : ""}`} style={{ left: `${model.tickPercent}%` }} aria-hidden="true">
            <span className="savings-bar-tick-label">{copy.incomeTick}</span>
          </span>
        ) : null}
        {placed.map((segment) => (
          <span
            key={segment.key}
            id={`${baseId}-${segment.key}`}
            role="tooltip"
            className="savings-bar-popover"
            data-popover={segment.key}
            hidden={openKey !== segment.key}
            style={{ left: `${segment.centre}%`, transform: `translateX(-${segment.centre}%)` }}
          >
            {segment.popover}
          </span>
        ))}
      </div>
      {model.plan ? (
        <span className="savings-bar-plan" aria-hidden="true">
          <span className="savings-bar-plan-spend" style={{ width: `${model.plan.spendPercent}%` }} />
          <span className="savings-bar-plan-save" style={{ width: `${model.plan.savePercent}%` }} />
        </span>
      ) : null}
      <p className="savings-bar-sentence" data-savings-sentence>{model.sentence}</p>
      {model.plan ? <p className="savings-bar-plan-line" data-savings-plan>{model.plan.line}</p> : null}
    </div>
  );
}
