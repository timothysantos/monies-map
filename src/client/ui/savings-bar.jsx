import { useId } from "react";

import { messages } from "../copy/en-SG";
import { buildSavingsBarModel } from "../savings-bar-model";
import { useIsMobileLayout } from "../use-viewport";

const copy = messages.summary.lead.savingsBar;

// The savings bar under the lead (design.md, "Lead · Support · Detail"; model
// in savings-bar-model.js): money earned is the bar, spent is rose, invested
// plum and kept mint, with a thin plan bar under it, a legend and one plain
// line. The legend is always in the page, with no popover: a swatch, the
// part's short name and its figure (and its share of income where there is
// room; hidden money shows the share alone), then the plan bar's name. When
// more went out than came in, the tick marks where the income ends and the
// legend names it ("All you earned $x"), so no label sits on the bar.
//
// With a `period` every part, legend line and the sentence is an openable
// figure (design.md "Openable figures"; `data-fig`, figure-menu.js): a tap,
// click, Enter or Space opens its menu (View entries, Open plan, Ask about
// this). A part's accessible description is its legend item. Hidden money
// keeps the percentages and neutral colours, and shows no amount anywhere.
/**
 * @param {{ figures: any, hidden: boolean, period?: any, withPlan?: boolean }} props `period` is
 * optional: without it (an Ask answer's bar) nothing opens and the parts
 * are plain images.
 */
export function SavingsBar({ figures, hidden, period = null, withPlan = true }) {
  const baseId = useId();
  const model = buildSavingsBarModel({ figures, hidden, withPlan });
  const phone = useIsMobileLayout();

  if (!model) {
    return null;
  }

  // An openable figure (figure-menu.js), or the plain words without a period.
  const open = (fig, extra, children) => (period ? <span data-fig={fig} tabIndex={0} role="button" {...extra}>{children}</span> : children);
  const plan = withPlan ? { "data-fig-plan": "" } : {};
  const lastIndex = model.segments.length - 1;
  // The legend's words: "Spent $209,000" and, muted, " · 85%". A phone has no
  // room for the share beside the figure, so it shows the share only when
  // there is no figure (hidden money); the plan bar is named "Plan" there and
  // with its figures on a wider screen.
  const legendText = ({ name, amount, percent }) => [
    amount === null ? name : `${name} ${amount}`,
    percent !== null && (amount === null || !phone) ? <span className="savings-bar-legend-share" key="share">{` · ${percent}%`}</span> : null
  ];

  return (
    <div className="savings-bar" data-savings-bar>
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
            <button key={segment.key} type="button" {...props} data-fig={segment.fig} {...plan} />
          ) : <span key={segment.key} role="img" {...props} />;
        })}
        {model.tickPercent !== null ? (
          <span className="savings-bar-tick" style={{ left: `${model.tickPercent}%` }} aria-hidden="true" />
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
            {open(segment.fig, plan, legendText(segment.legend))}
          </li>
        ))}
        {/* Where the income ends on a bar longer than it: the tick's name. */}
        {model.tickLegend ? (
          <li data-legend="earned">
            <span className="savings-bar-swatch is-tick" aria-hidden="true" />
            {open("earned", withPlan ? { "data-fig-plan": "income" } : {}, phone ? model.tickLegendShort : model.tickLegend)}
          </li>
        ) : null}
        {/* More taken out of investments than put in: a line with no part. */}
        {model.takenOut ? (
          <li data-legend="taken-out">{open("took_out", {}, `${model.takenOut.name} ${model.takenOut.amount}`)}</li>
        ) : null}
        {model.planLegend ? (
          <li data-legend="plan">
            <span className="savings-bar-swatch is-plan" aria-hidden="true" />
            {open("plan", { "data-fig-plan": "" }, phone ? copy.planName : model.planLegend)}
          </li>
        ) : null}
      </ul>
      {/* One line on a phone: the sentences that name investing are shortened there. */}
      <p className="savings-bar-sentence" data-savings-sentence>
        {open(model.sentenceFig, plan, phone ? model.shortSentence : model.sentence)}
      </p>
    </div>
  );
}
