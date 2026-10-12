import { useEffect, useId, useRef, useState } from "react";

import { messages } from "../copy/en-SG";
import { buildSavingsBarModel } from "../savings-bar-model";
import { MoneyActions } from "./money-actions";

const copy = messages.summary.lead.savingsBar;

// The savings bar under the lead figure (design.md, "Lead · Support ·
// Detail"; model in savings-bar-model.js): money earned is the bar, spent is
// rose, invested plum and kept mint, with a thin plan bar under it and one
// plain line. Each segment is a button. Its popover has the percentage of
// income: hover (mouse) shows it; a click, a tap or Enter shows it with the
// segment's menu (MoneyActions: View entries, Ask about this). Screen
// readers read the popover through aria-describedby, which is always in the
// page. Hidden money keeps the percentages and neutral colours, and shows no
// amount anywhere.
export function SavingsBar({ figures, hidden, period }) {
  const baseId = useId();
  const rootRef = useRef(null);
  const lastPointer = useRef("");
  const [openKey, setOpenKey] = useState(null);
  // The segment whose menu is open (a click, tap or Enter); hover alone
  // shows only the popover.
  const [menuKey, setMenuKey] = useState(null);
  const model = buildSavingsBarModel({ figures, hidden });

  // A tap or press outside, or Escape, closes the open popover and menu.
  useEffect(() => {
    if (!openKey) {
      return undefined;
    }
    const close = (event) => {
      if (event.type === "keydown" ? event.key === "Escape" : !rootRef.current?.contains(event.target)) {
        setOpenKey(null);
        setMenuKey(null);
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

  // A mouse click opens the menu under the hover popover and keeps it open;
  // a tap or Enter toggles both.
  const press = (key) => {
    const opening = lastPointer.current === "mouse" || openKey !== key || menuKey !== key;
    setOpenKey(opening ? key : null);
    setMenuKey(opening ? key : null);
  };

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
            aria-expanded={menuKey === segment.key}
            onPointerEnter={(event) => {
              if (event.pointerType === "mouse" && menuKey === null) setOpenKey(segment.key);
            }}
            onPointerLeave={(event) => {
              if (event.pointerType === "mouse" && menuKey === null) setOpenKey((current) => (current === segment.key ? null : current));
            }}
            onPointerDown={(event) => { lastPointer.current = event.pointerType; }}
            onKeyDown={() => { lastPointer.current = "keyboard"; }}
            onClick={() => press(segment.key)}
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
            className="savings-bar-float"
            hidden={openKey !== segment.key}
            style={{ left: `${segment.centre}%`, transform: `translateX(-${segment.centre}%)` }}
          >
            <span id={`${baseId}-${segment.key}`} role="tooltip" className="savings-bar-popover" data-popover={segment.key}>
              {segment.popover}
            </span>
            {menuKey === segment.key ? (
              <MoneyActions actionKey={segment.key} name={segment.name} figures={figures} hidden={hidden} period={period} onDone={() => { setOpenKey(null); setMenuKey(null); }} />
            ) : null}
          </span>
        ))}
      </div>
      {model.plan ? (
        <span className="savings-bar-plan" aria-hidden="true">
          <span className="savings-bar-plan-spend" style={{ width: `${model.plan.spendPercent}%` }} />
          <span className="savings-bar-plan-invest" style={{ width: `${model.plan.investPercent}%` }} />
          <span className="savings-bar-plan-save" style={{ width: `${model.plan.savePercent}%` }} />
        </span>
      ) : null}
      <p className="savings-bar-sentence" data-savings-sentence>{model.sentence}</p>
    </div>
  );
}
