// The calm line pools: what a page says for a period with nothing notable
// (checkin.ts takes the page's lines as input). Kept out of checkin.ts so
// the pools load with each page's signals, not with the first screen.
import { fill } from "./format";

// Approved calm lines, for a period with nothing to say. {place} is the
// page's own ("this range", "August", "this list", "this group"); the page
// keeps its original first line. Twelve, so a year of months never repeats
// one (calmLinesFor).
export const CALM_LINE_TEMPLATES = [
  "Nothing in {place} needs a look right now.",
  "All clear in {place}: nothing needs a look.",
  "Nothing in {place} is asking for attention right now.",
  "{place} looks settled. Nothing to check.",
  "Nothing stands out in {place} right now.",
  "A calm picture in {place}: nothing needs you.",
  "No loose ends in {place} right now.",
  "Nothing to sort in {place}. Enjoy the quiet.",
  "{place} is quiet: nothing worth a look.",
  "All calm in {place}. Nothing is waiting.",
  "Nothing in {place} calls for a look.",
  "Nothing pressing in {place} right now."
];

export function calmLinesFor(place: string, first?: string) {
  const lines = CALM_LINE_TEMPLATES.map((template) => {
    const line = fill(template, { place });
    return line[0].toUpperCase() + line.slice(1);
  });
  return first ? [first, ...lines.slice(1)] : lines;
}
