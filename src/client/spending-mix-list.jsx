import "./spending-mix-list.css";
import { useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";

import { spendingMixCopy as mixCopy } from "./copy/spending-mix-copy";
import { DetailRows } from "./ui-components";

// Spending Mix's lean ranked list (design.md "Summary body"), shared by
// Summary's and Month's Spending Mix (spending-mix-section.jsx) and the
// Entries page's spending by category (entries-overview.jsx): one 44 px
// line per category in one DetailRows group, biggest first, the top
// `topCount` (five on a desktop, three on a phone), then a last row "Show
// all N" / "Show fewer" (`aria-expanded`). Each page draws its own rows
// (`renderRow`): their taps differ, the look is this file's CSS.
/**
 * @param {{ label: string, items: any[], topCount: number, renderRow: (item: any, index: number) => any, className?: string }} props
 */
export function SpendingMixList({ label, items, topCount, renderRow, className = "" }) {
  const [showAll, setShowAll] = useState(false);
  const listed = showAll ? items : items.slice(0, topCount);
  return (
    <DetailRows className={["summary-mix-list", className].filter(Boolean).join(" ")} label={label}>
      {listed.map((item, index) => renderRow(item, index))}
      {items.length > topCount ? (
        <button type="button" className="lsd-row summary-mix-more" aria-expanded={showAll} onClick={() => setShowAll((current) => !current)}>
          {showAll ? mixCopy.showFewer : mixCopy.showAll(items.length)}
          {showAll ? <ChevronUp size={16} aria-hidden="true" /> : <ChevronDown size={16} aria-hidden="true" />}
        </button>
      ) : null}
    </DetailRows>
  );
}

// A category's share of all spending, to one decimal ("38.8%"): the list's
// and the slice labels' wording.
export function mixShareText(valueMinor, totalMinor) {
  return `${(totalMinor ? (valueMinor / totalMinor) * 100 : 0).toFixed(1)}%`;
}
