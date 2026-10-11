import { Sparkles, X } from "lucide-react";
import { createPortal } from "react-dom";

import { describeFilterParts, entryFilterCopy } from "./copy/entry-filter-copy";
import { readAskFilterFromParams } from "./entry-filter-params";

// "From Ask · Groceries · over $50  ✕" (design.md "From Ask chip"): shown
// on Entries when an Ask answer's "Open in Entries" set the list filters
// (from_ask=1). The chip goes back to Ask, where the conversation is as it
// was; ✕ clears the filters Ask set and keeps the view, month and scope.
// It names the filters as the URL now has them, so a filter changed by
// hand reads as it is.
//
// On a phone it floats just above the View and scope bar, left of the +
// button: in the thumb zone, and in view while the list scrolls, so the
// person can always see the list is narrowed and undo it in one tap. On a
// wide screen it sits at the top of the list.
export function EntriesAskChip({ searchParams, accounts, people, floating, onReturn, onClear }) {
  const parts = describeFilterParts(readAskFilterFromParams(searchParams), { accounts, people });
  const summary = [entryFilterCopy.fromAsk, ...parts.map((part) => part.label)].join(" · ");
  const chip = (
    <div className={`entries-ask-chip${floating ? " is-floating" : ""}`} role="group" aria-label={entryFilterCopy.fromAsk}>
      <button type="button" className="entries-ask-chip-back" onClick={onReturn} aria-label={entryFilterCopy.backToAsk(summary)}>
        <Sparkles size={15} aria-hidden="true" />
        <span className="entries-ask-chip-text">
          <strong>{entryFilterCopy.fromAsk}</strong>
          {parts.map((part) => <span key={part.key}> · {part.label}</span>)}
        </span>
      </button>
      <button type="button" className="entries-ask-chip-clear" onClick={onClear} aria-label={entryFilterCopy.clear} title={entryFilterCopy.clear}>
        <X size={18} aria-hidden="true" />
      </button>
    </div>
  );
  return floating && typeof document !== "undefined" ? createPortal(chip, document.body) : chip;
}
