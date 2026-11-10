import "./sheet-dialog.css";
import "./summary-card-editor.css";
import { useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";

import { SheetDialog } from "./sheet-dialog";
import { canHideSummaryCard, moveSummaryCard } from "./summary-card-order";

// Arrange Summary (design.md "Arrange Summary"): the cards under the top
// summary in their order, each shown or hidden, moved with Up and Down (44 px
// buttons, so nothing moves while scrolling a phone and the keyboard reaches
// every move). Nothing is saved until Done; Cancel, Escape or the close
// button leave everything as it was. Loaded only when "Arrange cards" (or
// "Edit cards" on a phone) is opened.

const NAMES = {
  insights: { name: "Money insights", about: "What needs a look, and what went well" },
  changed: { name: "What changed this month", about: "This month so far against the same days last month" },
  subs: { name: "Subscriptions and bills", about: "Charges that come back every month or year" },
  investments: { name: "Investments over time", about: "What your investments were worth on their statements" },
  taxreliefs: { name: "Tax reliefs this year", about: "What you put into SRS, CPF and charity gifts, against the limits" },
  mix: { name: "Spending Mix", about: "Spending by category" },
  plan: { name: "Intent vs Outcome", about: "Each month against its plan" },
  planSimple: { name: "Earned vs spent by month", about: "What came in and what went out, month by month" },
  accounts: { name: "The accounts shown", about: "Current wallet balances" }
};

/**
 * @param {{ cards: Array<{ id: string, hidden: boolean }>, leadView: string, phone: boolean, onSave: (cards: any[] | null) => void, onClose: () => void }} props
 */
export function SummaryCardEditor({ cards, leadView, phone, onSave, onClose }) {
  const [draft, setDraft] = useState(cards);
  const [announcement, setAnnouncement] = useState("");
  const describe = (id) => NAMES[id === "plan" && leadView === "simple" ? "planSimple" : id];
  const move = (index, step) => {
    const next = moveSummaryCard(draft, index, step);
    setDraft(next);
    const name = describe(draft[index].id).name;
    setAnnouncement(`${name}: ${index + step + 1} of ${draft.length}`);
  };
  const toggle = (index) => {
    setDraft(draft.map((card, at) => (at === index && canHideSummaryCard(card.id) ? { ...card, hidden: !card.hidden } : card)));
  };
  const dirty = draft.some((card, index) => card.id !== cards[index].id || card.hidden !== cards[index].hidden);

  return (
    <SheetDialog
      className="is-three-actions"
      title={phone ? "Edit cards" : "Arrange cards"}
      primaryLabel="Done"
      onSubmit={() => onSave(draft)}
      isDirty={dirty}
      secondary={(
        <button type="button" className="lsd-secondary" onClick={() => { onSave(null); }}>Reset to the usual order</button>
      )}
      onClose={onClose}
    >
      <p className="summary-cards-note">The top summary always stays first.</p>
      <ol className="summary-cards-list" aria-label="Summary cards">
        {draft.map((card, index) => {
          const { name, about } = describe(card.id);
          const hideable = canHideSummaryCard(card.id);
          return (
            <li key={card.id} className={`summary-cards-row ${card.hidden ? "is-hidden" : ""}`} data-card={card.id}>
              <button
                type="button"
                className="summary-cards-name"
                aria-pressed={!card.hidden}
                disabled={!hideable}
                onClick={() => toggle(index)}
              >
                <strong>{name}</strong>
                <span>{card.hidden ? "Hidden on Summary. Still on Month and in Settings." : about}</span>
              </button>
              <span className="summary-cards-state">{card.hidden ? "Hidden" : "Shown"}</span>
              <button type="button" className="summary-cards-move" aria-label={`Move ${name} up`} disabled={index === 0} onClick={() => move(index, -1)}>
                <ChevronUp size={18} aria-hidden="true" />
              </button>
              <button type="button" className="summary-cards-move" aria-label={`Move ${name} down`} disabled={index === draft.length - 1} onClick={() => move(index, 1)}>
                <ChevronDown size={18} aria-hidden="true" />
              </button>
            </li>
          );
        })}
      </ol>
      {phone ? <p className="summary-cards-note">Tap a card's name to show or hide it.</p> : null}
      <p className="lsd-sr-only" aria-live="polite">{announcement}</p>
    </SheetDialog>
  );
}

