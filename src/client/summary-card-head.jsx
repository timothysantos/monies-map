import { cardSubtitle, cardTitle, monthsContext } from "./copy/summary-card-titles";

// Every reader of the list imports it from here, so the list, the head and the
// first-screen chunk that carries them (ui/lead-support-detail.jsx) stay one
// unit and add no file of their own to the first screen.
export { cardSubtitle, cardTitle, monthsContext };

// The one head every Summary card wears (design.md "Summary card titles"): the
// title from the shared list, one quiet subtitle line under it, and an optional
// action at the top right (Show all, a chip, a figure). Styled once in
// summary-body.css, so the title and subtitle look the same on every card.
/** @param {{ id: string, context?: Record<string, any>, titleId?: string, action?: any, className?: string }} props */
export function CardHead({ id, context = {}, titleId = undefined, action = null, className = "" }) {
  return (
    <div className={`summary-card-head ${className}`.trim()}>
      <div className="summary-card-heading">
        <h3 id={titleId} className="summary-card-title">{cardTitle(id)}</h3>
        <p className="summary-card-sub">{cardSubtitle(id, context)}</p>
      </div>
      {action}
    </div>
  );
}
