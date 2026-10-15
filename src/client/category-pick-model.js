// What the category list shows, as a pure function (design.md "Category
// list"): a search over names and everyday words, the best guess first with
// its tag, then every other category in alphabetical order. The list's
// component only draws what this returns. Loaded with the list, never on the
// first screen.

import { everydayWordsFor } from "../domain/category-everyday-words";

// Catch-all names are never a best guess (the server never sends them; this
// keeps a stale or odd answer from putting one first).
const NEVER_A_GUESS = new Set(["Other", "Other - Income", "Transfer"]);

const collator = new Intl.Collator(undefined, { sensitivity: "base", numeric: true });

/** Lowercase, accents and "&" folded, so "Food & Drinks" is found by "food and". */
export function foldForSearch(text) {
  return String(text ?? "")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/\s+/g, " ")
    .trim();
}

// 0: a word of the name starts with the search, 1: the name holds it,
// 2: an everyday word for the category starts with it, -1: no match.
function matchRank(option, tokens) {
  const label = foldForSearch(option.label);
  const aliases = everydayWordsFor(option.label).map(foldForSearch);
  let worst = 0;
  for (const token of tokens) {
    let rank = -1;
    if (label.startsWith(token) || label.includes(` ${token}`)) rank = 0;
    else if (label.includes(token)) rank = 1;
    else if (aliases.some((alias) => alias.startsWith(token) || alias.includes(` ${token}`))) rank = 2;
    if (rank < 0) return -1;
    worst = Math.max(worst, rank);
  }
  return worst;
}

/**
 * @param {{
 *   options: Array<{ value: string, label: string }>,
 *   value?: string | string[],
 *   bestGuess?: string | null,
 *   query?: string,
 *   pinned?: Array<{ value: string, label: string }>
 * }} input
 * @returns {{ pinned: any[], best: any | null, rest: any[], isEmpty: boolean }}
 *   every item carries `isCurrent` (the checked one(s)).
 */
export function buildCategoryList({ options, value = "", bestGuess = null, query = "", pinned = [] }) {
  const current = new Set(Array.isArray(value) ? value : [value]);
  // A pinned row (All categories) is shown above the list, never twice.
  const pinnedValues = new Set(pinned.map((option) => option.value));
  options = options.filter((option) => !pinnedValues.has(option.value));
  const mark = (option) => ({ ...option, isCurrent: current.has(option.value) });
  const tokens = foldForSearch(query).split(" ").filter(Boolean);

  const ranked = [];
  for (const option of options) {
    const rank = tokens.length ? matchRank(option, tokens) : 0;
    if (rank >= 0) ranked.push({ option, rank });
  }
  ranked.sort((left, right) => left.rank - right.rank || collator.compare(left.option.label, right.option.label));

  const guess = bestGuess && !NEVER_A_GUESS.has(bestGuess) ? ranked.find((item) => item.option.value === bestGuess) : undefined;
  const rest = ranked.filter((item) => item !== guess).map((item) => mark(item.option));
  return {
    pinned: pinned.map(mark),
    best: guess ? mark(guess.option) : null,
    rest,
    isEmpty: !guess && rest.length === 0
  };
}

/** The row Up and Down keys and Enter move over: pinned, best, then the rest. */
export function flattenCategoryList(list) {
  return [...list.pinned, ...(list.best ? [list.best] : []), ...list.rest];
}
