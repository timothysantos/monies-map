// The best guess for the category list (DOMAIN.md "Category Guess"): the one
// category worth showing first for an entry's description. Pure and
// deterministic (no AI, no reads, no writes); pages/category-guess.ts loads
// its inputs. It only orders a list: the category changes on the person's pick.
//
// The first layer that has an answer wins:
// 1. the household's category rules (first active match, by priority),
// 2. an Ask habit for the shop (confidence high or suggest),
// 3. the household's own entries at the same shop over the last 12 months
//    (the most used category, at least 2 entries, newest wins a tie),
// 4. the everyday-word map (category-everyday-words.ts).
// A catch-all ("Other", "Other - Income") and Transfer are never a guess, and
// a category that does not exist for the household is skipped.

import { normalizeDescriptionForMatch } from "./app-repository-helpers";
import { matchCategoryRule } from "./app-repository-category-match-rules";
import { habitConfidence, habitMerchantKey, type AskHabit } from "./ask-habits";
import { categoryFromEverydayWords } from "./category-everyday-words";

export const CATEGORY_GUESS_POLICY = Object.freeze({ lookbackDays: 365, minHistoryEntries: 2 });

const NEVER_A_GUESS: ReadonlySet<string> = new Set(["Other", "Other - Income", "Transfer"]);

export type CategoryGuessSource = "rule" | "habit" | "history" | "words";

export interface CategoryGuess {
  categoryName: string;
  source: CategoryGuessSource;
}

export interface CategoryGuessHistoryRow {
  description: string;
  categoryName: string;
  // ISO YYYY-MM-DD
  date: string;
}

type Rules = Parameters<typeof matchCategoryRule>[1];

export function guessCategory(input: {
  description: string;
  categoryNames: readonly string[];
  rules: Rules;
  habit: AskHabit | null;
  history: readonly CategoryGuessHistoryRow[];
  today: string;
}): CategoryGuess | null {
  const description = input.description.trim();
  if (!description) return null;
  const usable = (name: string | undefined): name is string => Boolean(name) && !NEVER_A_GUESS.has(name as string) && input.categoryNames.includes(name as string);

  const ruled = matchCategoryRule(description, input.rules);
  if (usable(ruled)) return { categoryName: ruled, source: "rule" };

  const habitValue = input.habit?.kind === "category" ? (input.habit.value as { categoryName?: string }).categoryName : undefined;
  if (input.habit && usable(habitValue) && habitConfidence(input.habit, input.today) !== "none") {
    return { categoryName: habitValue, source: "habit" };
  }

  const shop = normalizeDescriptionForMatch(description);
  if (shop) {
    const tallies = new Map<string, { count: number; latest: string }>();
    for (const row of input.history) {
      if (!usable(row.categoryName) || normalizeDescriptionForMatch(row.description) !== shop) continue;
      const tally = tallies.get(row.categoryName) ?? { count: 0, latest: "" };
      tally.count += 1;
      if (row.date > tally.latest) tally.latest = row.date;
      tallies.set(row.categoryName, tally);
    }
    const ranked = [...tallies.entries()]
      .filter(([, tally]) => tally.count >= CATEGORY_GUESS_POLICY.minHistoryEntries)
      .sort((left, right) => right[1].count - left[1].count || right[1].latest.localeCompare(left[1].latest) || left[0].localeCompare(right[0]));
    if (ranked.length) return { categoryName: ranked[0][0], source: "history" };
  }

  const worded = categoryFromEverydayWords(description, input.categoryNames);
  return usable(worded) ? { categoryName: worded, source: "words" } : null;
}

// The habit key the page loader reads (the shop, long digit runs dropped).
export function categoryGuessHabitKey(description: string): string {
  return habitMerchantKey(description);
}
