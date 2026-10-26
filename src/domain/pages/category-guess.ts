import { DEFAULT_HOUSEHOLD_ID } from "../app-repository-constants";
import { normalizeDescriptionForMatch } from "../app-repository-helpers";
import { habitMerchantKey, type AskHabit } from "../ask-habits";
import {
  CATEGORY_GUESS_POLICY,
  guessCategory,
  type CategoryGuess,
  type CategoryGuessHistoryRow
} from "../category-guess";
import type { CategoryMatchRuleDto } from "../../types/dto";
import { todayInAppTimeZone } from "../../lib/app-calendar";
import { payNowMerchantCode } from "../../lib/paynow-reference";

// The best-guess category for one description (POST /api/entries/category-
// guess, DOMAIN.md "Category Guess"). Not a page DTO: the category list asks
// for it once, when it opens. Read-only. Its reads are fixed and sent as ONE
// db.batch round trip (the household's categories, its category rules, the
// shop's Ask habit by primary key, and one bounded history read on the
// household-and-date index); the rule itself is the pure category-guess.ts.

export const CATEGORY_GUESS_HISTORY_ROW_LIMIT = 500;

export function readCategoryGuessRequest(body: unknown): { description: string } | null {
  if (!body || typeof body !== "object") return null;
  const { description } = body as Record<string, unknown>;
  if (typeof description !== "string" || !description.trim() || description.length > 240) return null;
  return { description: description.trim() };
}

export async function buildCategoryGuess(db: D1Database, request: { description: string }): Promise<CategoryGuess | null> {
  const shopKey = normalizeDescriptionForMatch(request.description);
  if (!shopKey) return null;
  const today = todayInAppTimeZone();
  const word = shopKey.split(" ").reduce((longest, candidate) => (candidate.length > longest.length ? candidate : longest), "");
  const habitKey = habitMerchantKey(request.description);
  // A PayNow line's shop is its company code: the one read also takes the rows
  // that carry it, whatever payee text they have.
  const companyCode = payNowMerchantCode(request.description);

  const statements = [
    db.prepare("SELECT name FROM categories WHERE household_id = ?").bind(DEFAULT_HOUSEHOLD_ID),
    db
      .prepare(`
        SELECT category_match_rules.pattern, categories.name AS category_name, category_match_rules.priority, category_match_rules.is_active
        FROM category_match_rules
        INNER JOIN categories ON categories.id = category_match_rules.category_id
        WHERE category_match_rules.household_id = ? AND category_match_rules.is_active = 1
        ORDER BY category_match_rules.priority, lower(category_match_rules.pattern)
      `)
      .bind(DEFAULT_HOUSEHOLD_ID),
    db
      .prepare(`
        SELECT transactions.description, categories.name AS category_name, transactions.transaction_date
        FROM transactions
        INNER JOIN categories ON categories.id = transactions.category_id
        WHERE transactions.household_id = ?
          AND transactions.transaction_date BETWEEN date(?, ?) AND ?
          AND transactions.entry_type IN ('expense', 'income')
          AND (instr(lower(transactions.description), ?) > 0 OR instr(lower(transactions.description), ?) > 0)
        ORDER BY transactions.transaction_date DESC
        LIMIT ?
      `)
      .bind(DEFAULT_HOUSEHOLD_ID, today, `-${CATEGORY_GUESS_POLICY.lookbackDays} days`, today, word, companyCode?.toLowerCase() ?? word, CATEGORY_GUESS_HISTORY_ROW_LIMIT)
  ];
  const habitStatement = habitKey
    ? db
        .prepare(`
          SELECT kind, key, value_json, times_confirmed, times_overridden, last_used, source
          FROM ask_habits
          WHERE household_id = ? AND kind = 'category' AND key = ?
        `)
        .bind(DEFAULT_HOUSEHOLD_ID, habitKey)
    : null;

  let results: D1Result<Record<string, unknown>>[];
  let hasHabitRead = Boolean(habitStatement);
  try {
    results = await db.batch<Record<string, unknown>>(habitStatement ? [...statements, habitStatement] : statements);
  } catch (error) {
    // The Ask habits table is additive and may not exist yet: that is the
    // feature being off, so ask again without it.
    if (!habitStatement) throw error;
    hasHabitRead = false;
    results = await db.batch<Record<string, unknown>>(statements);
  }

  const categoryNames = (results[0].results as Array<{ name: string }>).map((row) => row.name);
  const rules = (results[1].results as Array<{ pattern: string; category_name: string; priority: number; is_active: number }>).map((row, index) => ({
    id: `rule-${index}`,
    pattern: row.pattern,
    categoryId: "",
    categoryName: row.category_name,
    priority: Number(row.priority ?? 100),
    isActive: Boolean(row.is_active)
  })) as CategoryMatchRuleDto[];
  const history: CategoryGuessHistoryRow[] = (results[2].results as Array<{ description: string; category_name: string; transaction_date: string }>).map((row) => ({
    description: row.description,
    categoryName: row.category_name,
    date: row.transaction_date
  }));
  const habitRow = hasHabitRead
    ? ((results[3]?.results as Array<{ key: string; value_json: string; times_confirmed: number; times_overridden: number; last_used: string; source: AskHabit["source"] }> | undefined)?.[0] ?? null)
    : null;
  return guessCategory({
    description: request.description,
    categoryNames,
    rules,
    habit: habitRow ? toCategoryHabit(habitRow) : null,
    history,
    today
  });
}

function toCategoryHabit(row: { key: string; value_json: string; times_confirmed: number; times_overridden: number; last_used: string; source: AskHabit["source"] }): AskHabit | null {
  try {
    const value = JSON.parse(row.value_json);
    if (typeof value?.categoryName !== "string" || !value.categoryName) return null;
    return {
      id: `category:${row.key}`,
      kind: "category",
      key: row.key,
      value: { categoryName: value.categoryName },
      timesConfirmed: row.times_confirmed,
      timesOverridden: row.times_overridden,
      lastUsed: row.last_used,
      source: row.source
    };
  } catch {
    return null;
  }
}
