import { cardSubtitle, cardTitle, monthsContext } from "./copy/summary-card-titles";

// Every reader of the list imports it from here, so the list, the head and the
// first-screen chunk that carries them (ui/lead-support-detail.jsx) stay one
// unit and add no file of their own to the first screen.
export { cardSubtitle, cardTitle, monthsContext };

// The one head every Summary card wears (design.md "Summary card titles"): the
// title from the shared list, one quiet subtitle line under it, and an optional
// action at the top right (Show all, a chip, a figure). Styled once in
// summary-body.css, so the title and subtitle look the same on every card.
// A page outside Summary that reuses a card (the trip page's Spending mix)
// names it itself with `title` and `subtitle`.
/** @param {{ id: string, context?: Record<string, any>, titleId?: string, action?: any, className?: string, title?: string, subtitle?: string }} props */
export function CardHead({ id, context = {}, titleId = undefined, action = null, className = "", title = "", subtitle = "" }) {
  return (
    <div className={`summary-card-head ${className}`.trim()}>
      <div className="summary-card-heading">
        <h3 id={titleId} className="summary-card-title">{title || cardTitle(id)}</h3>
        <p className="summary-card-sub">{subtitle || cardSubtitle(id, context)}</p>
      </div>
      {action}
    </div>
  );
}
