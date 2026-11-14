import { spendingMixCopy } from "./copy/spending-mix-copy";
import { summaryTilesCopy } from "./copy/summary-tiles-copy";

// The quiet words after a change note's arrow and percent: "vs the month
// before" (a month), "vs the month before (full months only)", or, for
// Investments, "since Jan". The same words Spending mix's note uses.
export function changeWords(note) {
  if (note.vs === "month") return spendingMixCopy.changeVs(1, false);
  if (note.vs === "fullMonths") return spendingMixCopy.changeVs(1, true);
  return summaryTilesCopy.changeSinceJan;
}

/**
 * "▲ 12% vs the month before", the percent in its money tone (mint, or rose
 * for what went up in cost). `note` is changeNote's (change-note.js).
 * @param {{ note: { arrow: string, percent: number, tone: string, vs?: string } | null, className?: string }} props
 */
export function ChangeNoteLine({ note, className = "summary-tile-note" }) {
  if (!note) return null;
  return (
    <span className={className} data-change-note>
      <b className={note.tone === "mint" ? "money-in" : "money-short"}>{note.arrow} {note.percent}%</b> {changeWords(note)}
    </span>
  );
}
