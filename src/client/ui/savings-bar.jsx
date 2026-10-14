import { createElement, useEffect, useId, useRef, useState } from "react";

import { messages } from "../copy/en-SG";
import { loadMoneyJobsDetail, useMoneyJobsDetail } from "../money-jobs-loader";
import { buildSavingsBarModel } from "../savings-bar-model";
import { useIsMobileLayout } from "../use-viewport";

const copy = messages.summary.lead.savingsBar;

// The savings bar under the lead (design.md, "Lead · Support · Detail"; model
// in savings-bar-model.js): money earned is the bar, spent is rose, invested
// plum and kept mint, with a thin plan bar under it, a legend and one plain
// line. The legend is always in the page, with no popover: a swatch, the
// part's short name and its figure (and its share of income where there is
// room; hidden money shows the share alone), then the plan bar's name. Each
// part is a button: a click, a tap or Enter opens its menu (View entries,
// Ask about this; money-jobs-detail.js, which loads on the first hover, focus
// or press) in the page flow under the legend. A part's accessible
// description is its legend item. Hidden money keeps the percentages and
// neutral colours, and shows no amount anywhere.
/**
 * @param {{ figures: any, hidden: boolean, period?: any, withPlan?: boolean }} props `period` is
 * optional: without it (an Ask answer's bar) the parts have no menu and are
 * plain images.
 */
export function SavingsBar({ figures, hidden, period = null, withPlan = true }) {
  const baseId = useId();
  const rootRef = useRef(null);
  // The part whose menu is open (a click, tap or Enter).
  const [menuKey, setMenuKey] = useState(null);
  const model = buildSavingsBarModel({ figures, hidden, withPlan });
  const phone = useIsMobileLayout();
  const detail = useMoneyJobsDetail(menuKey !== null);
  // Start the menu's code on the first sign of interest, so a tap finds it.
  const warm = () => { void loadMoneyJobsDetail().catch(() => {}); };

  // A tap or click outside, or Escape, closes the open menu. It closes on the
  // click, not the press: the menu is in the page flow, so closing on the press
  // would move the rows below it before the tap lands and the tap would hit
  // the wrong row.
  useEffect(() => {
    if (!menuKey) {
      return undefined;
    }
    const close = (event) => {
      if (event.type === "keydown" ? event.key === "Escape" : !rootRef.current?.contains(event.target)) {
        setMenuKey(null);
      }
    };
    document.addEventListener("click", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("click", close);
      document.removeEventListener("keydown", close);
    };
  }, [menuKey]);

  if (!model) {
    return null;
  }

  const lastIndex = model.segments.length - 1;
  const openSegment = model.segments.find((segment) => segment.key === menuKey);
  // The legend's words: "Spent $209,000" and, muted, " · 85%". A phone has no
  // room for the share beside the figure, so it shows the share only when
  // there is no figure (hidden money); the plan bar is named "Plan" there and
  // with its figures on a wider screen.
  const legendText = ({ name, amount, percent }) => [
    amount === null ? name : `${name} ${amount}`,
    percent !== null && (amount === null || !phone) ? <span className="savings-bar-legend-share" key="share">{` · ${percent}%`}</span> : null
  ];

  return (
    <div className="savings-bar" ref={rootRef} data-savings-bar>
      <div className="savings-bar-track" role="group" aria-label={copy.label}>
        {model.segments.map((segment, index) => {
          const props = {
            className: `savings-bar-segment money-${segment.tone} ${segment.hatched ? "is-hatched" : ""} ${index === 0 ? "is-first" : ""} ${index === lastIndex ? "is-last" : ""}`,
            "data-segment": segment.key,
            style: { width: `${segment.widthPercent}%` },
            "aria-label": segment.name,
            "aria-describedby": `${baseId}-${segment.key}`
          };
          return period ? (
            <button
              key={segment.key}
              type="button"
              {...props}
              aria-expanded={menuKey === segment.key}
              onPointerEnter={warm}
              onFocus={warm}
              onPointerDown={warm}
              onClick={() => setMenuKey((current) => (current === segment.key ? null : segment.key))}
            />
          ) : <span key={segment.key} role="img" {...props} />;
        })}
        {model.tickPercent !== null ? (
          <span className={`savings-bar-tick ${model.tickPercent > 75 ? "is-late" : ""}`} style={{ left: `${model.tickPercent}%` }} aria-hidden="true">
            <span className="savings-bar-tick-label">{phone ? model.tickLabel : model.tickLabelWithAmount}</span>
          </span>
        ) : null}
      </div>
      {model.plan ? (
        <span className="savings-bar-plan" aria-hidden="true">
          <span className="savings-bar-plan-spend" style={{ width: `${model.plan.spendPercent}%` }} />
          <span className="savings-bar-plan-invest" style={{ width: `${model.plan.investPercent}%` }} />
          <span className="savings-bar-plan-save" style={{ width: `${model.plan.savePercent}%` }} />
        </span>
      ) : null}
      <ul className="savings-bar-legend" data-savings-legend>
        {model.segments.map((segment) => (
          <li key={segment.key} id={`${baseId}-${segment.key}`} data-legend={segment.key}>
            <span className={`savings-bar-swatch money-${segment.tone} ${segment.hatched ? "is-hatched" : ""}`} data-swatch={segment.key} aria-hidden="true" />
            {legendText(segment.legend)}
          </li>
        ))}
        {/* More taken out of investments than put in: a line with no part. */}
        {model.takenOut ? (
          <li data-legend="taken-out">{`${model.takenOut.name} ${model.takenOut.amount}`}</li>
        ) : null}
        {model.planLegend ? (
          <li data-legend="plan">
            <span className="savings-bar-swatch is-plan" aria-hidden="true" />
            {phone ? copy.planName : model.planLegend}
          </li>
        ) : null}
      </ul>
      {/* The open part's menu, in the page flow under the legend. */}
      {openSegment && detail ? (
        <div className="savings-bar-menu" data-savings-menu>
          {detail.renderMoneyActions(createElement, {
            actionKey: openSegment.key,
            view: detail.moneyActionView(openSegment.key, { name: openSegment.name, figures, hidden, period, search: window.location.search }),
            onDone: () => setMenuKey(null)
          })}
        </div>
      ) : null}
      {/* One line on a phone: the sentences that name investing are shortened there. */}
      <p className="savings-bar-sentence" data-savings-sentence>{phone ? model.shortSentence : model.sentence}</p>
    </div>
  );
}
