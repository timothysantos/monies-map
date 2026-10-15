// A small built-in word list for everyday spending words ("coffee", "grab",
// "groceries") so a short typed entry gets a sensible category when none of
// the household's own category rules match. It is the second choice, after
// the household's rules (matchCategoryRule), and before the model's
// suggestion and the "Other" default. A word only counts when a category it
// names exists for the household: each group lists the names households
// commonly use, in order of preference, and the first one the household has
// is used. Order matters: the first group whose word appears wins, so "grab
// food" is food, not a taxi.

import { matchCategoryRule } from "./app-repository-category-match-rules";
import { categoryFromEverydayWords } from "./category-everyday-words";

export { categoryFromEverydayWords, everydayWordsFor } from "./category-everyday-words";

type Rules = Parameters<typeof matchCategoryRule>[1];

// The category a description points at for this household: its own rules
// first, then the everyday words; undefined when nothing fits.
export function categoryFromDescription(description: string, categoryNames: readonly string[], rules: Rules): string | undefined {
  const ruled = description ? matchCategoryRule(description, rules) : undefined;
  if (ruled && ruled !== "Transfer" && (!categoryNames.length || categoryNames.includes(ruled))) return ruled;
  return categoryFromEverydayWords(description, categoryNames);
}
