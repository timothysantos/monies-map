import { Eye } from "lucide-react";

import { useMoneyPrivacy } from "./money-privacy";
import { askCopy } from "./copy/ask-copy";

// With money hidden, an Ask card that is all figures says so and offers the
// app's own show/hide money control right there (Ask audit A14): the Ask
// page has no header eye to reach for. Tapping it shows totals everywhere,
// as the eye does.
export function AskHiddenTotals({ text = askCopy.briefHidden }) {
  const { toggleTotalsVisibility } = useMoneyPrivacy();
  return (
    <div className="ask-brief-hidden-row">
      <p className="ask-brief-hidden">{text}</p>
      <button type="button" className="ask-show-totals" onClick={toggleTotalsVisibility} data-ask-show-totals>
        <Eye size={16} aria-hidden="true" />
        {askCopy.showTotals}
      </button>
    </div>
  );
}
