import { defaultCategoryMatchRules, deprecatedDefaultCategoryMatchRuleIds } from "./category-match-defaults";
import { DEFAULT_HOUSEHOLD_ID } from "./app-repository-constants";
import { slugify } from "./app-repository-helpers";
import { recordAuditEvent } from "./app-repository-audit";
import type { CategoryMatchRuleDto, CategoryMatchRuleSuggestionDto } from "../types/dto";

export async function ensureDefaultCategoryMatchRules(db: D1Database) {
  for (const ruleId of deprecatedDefaultCategoryMatchRuleIds) {
    await db
      .prepare("DELETE FROM category_match_rules WHERE household_id = ? AND id = ?")
      .bind(DEFAULT_HOUSEHOLD_ID, ruleId)
      .run();
  }

  for (const rule of defaultCategoryMatchRules) {
    const category = await db
      .prepare("SELECT id FROM categories WHERE household_id = ? AND name = ?")
      .bind(DEFAULT_HOUSEHOLD_ID, rule.categoryName)
      .first<{ id: string }>();

    if (!category) {
      continue;
    }

    await db
      .prepare(`
        INSERT INTO category_match_rules (
          id, household_id, pattern, category_id, priority, is_active, note
        ) VALUES (?, ?, ?, ?, ?, 1, ?)
        ON CONFLICT(household_id, pattern) DO NOTHING
      `)
      .bind(
        rule.id,
        DEFAULT_HOUSEHOLD_ID,
        rule.pattern,
        category.id,
        rule.priority,
        rule.note ?? null
      )
      .run();
  }
}

export async function loadCategoryMatchRules(db: D1Database): Promise<CategoryMatchRuleDto[]> {
  const result = await db
    .prepare(`
      SELECT
        category_match_rules.id,
        category_match_rules.pattern,
        category_match_rules.category_id,
        categories.name AS category_name,
        category_match_rules.priority,
        category_match_rules.is_active,
        category_match_rules.note
      FROM category_match_rules
      INNER JOIN categories ON categories.id = category_match_rules.category_id
      WHERE category_match_rules.household_id = ?
      ORDER BY category_match_rules.priority, lower(category_match_rules.pattern)
    `)
    .bind(DEFAULT_HOUSEHOLD_ID)
    .all<{
      id: string;
      pattern: string;
      category_id: string;
      category_name: string;
      priority: number;
      is_active: number;
      note: string | null;
    }>();

  return result.results.map((row) => ({
    id: row.id,
    pattern: row.pattern,
    categoryId: row.category_id,
    categoryName: row.category_name,
    priority: Number(row.priority ?? 100),
    isActive: Boolean(row.is_active),
    note: row.note ?? undefined
  }));
}

export async function loadCategoryMatchRuleSuggestions(db: D1Database): Promise<CategoryMatchRuleSuggestionDto[]> {
  const result = await db
    .prepare(`
      SELECT
        category_match_rule_suggestions.id,
        category_match_rule_suggestions.pattern,
        category_match_rule_suggestions.category_id,
        categories.name AS category_name,
        category_match_rule_suggestions.source_count,
        category_match_rule_suggestions.sample_descriptions_json,
        category_match_rule_suggestions.updated_at
      FROM category_match_rule_suggestions
      INNER JOIN categories ON categories.id = category_match_rule_suggestions.category_id
      WHERE category_match_rule_suggestions.household_id = ?
        AND category_match_rule_suggestions.status = 'pending'
        AND category_match_rule_suggestions.source_count >= 2
      ORDER BY category_match_rule_suggestions.updated_at DESC, lower(category_match_rule_suggestions.pattern)
    `)
    .bind(DEFAULT_HOUSEHOLD_ID)
    .all<{
      id: string;
      pattern: string;
      category_id: string;
      category_name: string;
      source_count: number;
      sample_descriptions_json: string;
      updated_at: string;
    }>();

  return result.results.map((row) => ({
    id: row.id,
    pattern: row.pattern,
    categoryId: row.category_id,
    categoryName: row.category_name,
    sourceCount: Number(row.source_count ?? 0),
    sampleDescriptions: parseSuggestionSamples(row.sample_descriptions_json),
    lastSeenAt: row.updated_at
  }));
}

export function matchCategoryRule(description: string, rules: CategoryMatchRuleDto[]) {
  const normalizedDescription = normalizeRuleText(description);
  const upperDescription = description.toUpperCase();

  return rules
    .filter((rule) => rule.isActive)
    .find((rule) => {
      const normalizedPattern = normalizeRuleText(rule.pattern);
      if (!normalizedPattern) {
        return false;
      }

      // Short tokens such as "GV" are useful for bank abbreviations but too
      // broad for a raw substring check, so require a raw token boundary.
      if (normalizedPattern.length <= 3) {
        return new RegExp(`(^|[^A-Z0-9])${escapeRegExp(rule.pattern.toUpperCase())}([^A-Z0-9]|$)`).test(upperDescription);
      }

      return normalizedDescription.includes(normalizedPattern);
    })?.categoryName;
}

export async function saveCategoryMatchRule(
  db: D1Database,
  input: {
    ruleId?: string;
    sourceSuggestionId?: string;
    pattern: string;
    categoryId: string;
    priority?: number;
    isActive?: boolean;
    note?: string | null;
  }
) {
  const pattern = input.pattern.trim();
  if (!pattern) {
    throw new Error("Match pattern is required.");
  }

  const category = await db
    .prepare("SELECT id, name FROM categories WHERE household_id = ? AND id = ?")
    .bind(DEFAULT_HOUSEHOLD_ID, input.categoryId)
    .first<{ id: string; name: string }>();

  if (!category) {
    throw new Error("Choose a valid category for this rule.");
  }

  const existing = input.ruleId
    ? await db
      .prepare("SELECT id, pattern FROM category_match_rules WHERE household_id = ? AND id = ?")
      .bind(DEFAULT_HOUSEHOLD_ID, input.ruleId)
      .first<{ id: string; pattern: string }>()
    : null;
  const ruleId = existing?.id ?? `catrule-${slugify(pattern)}-${crypto.randomUUID().slice(0, 8)}`;

  if (existing) {
    await db
      .prepare(`
        UPDATE category_match_rules
        SET pattern = ?, category_id = ?, priority = ?, is_active = ?, note = ?, updated_at = CURRENT_TIMESTAMP
        WHERE household_id = ? AND id = ?
      `)
      .bind(
        pattern,
        category.id,
        Math.round(input.priority ?? 100),
        input.isActive === false ? 0 : 1,
        input.note?.trim() || null,
        DEFAULT_HOUSEHOLD_ID,
        ruleId
      )
      .run();
  } else {
    await db
      .prepare(`
        INSERT INTO category_match_rules (
          id, household_id, pattern, category_id, priority, is_active, note
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `)
      .bind(
        ruleId,
        DEFAULT_HOUSEHOLD_ID,
        pattern,
        category.id,
        Math.round(input.priority ?? 100),
        input.isActive === false ? 0 : 1,
        input.note?.trim() || null
      )
      .run();
  }

  await recordAuditEvent(db, {
    entityType: "category_match_rule",
    entityId: ruleId,
    action: existing ? "category_match_rule_updated" : "category_match_rule_created",
    detail: `${existing ? "Updated" : "Created"} category match rule ${pattern} -> ${category.name}.`
  });

  if (input.sourceSuggestionId) {
    await db
      .prepare(`
        UPDATE category_match_rule_suggestions
        SET status = 'accepted', updated_at = CURRENT_TIMESTAMP
        WHERE household_id = ? AND id = ?
      `)
      .bind(DEFAULT_HOUSEHOLD_ID, input.sourceSuggestionId)
      .run();
  }

  return { ruleId, saved: true };
}

export async function recordCategoryMatchSuggestion(
  db: D1Database,
  input: {
    description: string;
    categoryName: string;
  }
) {
  if (["Other", "Other - Income"].includes(input.categoryName)) {
    return;
  }

  const pattern = deriveSuggestionPattern(input.description);
  if (pattern.length < 4) {
    return;
  }

  const existingRules = await loadCategoryMatchRules(db);
  if (matchCategoryRule(input.description, existingRules) === input.categoryName) {
    return;
  }

  const category = await db
    .prepare("SELECT id FROM categories WHERE household_id = ? AND name = ?")
    .bind(DEFAULT_HOUSEHOLD_ID, input.categoryName)
    .first<{ id: string }>();

  if (!category) {
    return;
  }

  const existing = await db
    .prepare(`
      SELECT id, source_count, sample_descriptions_json, status
      FROM category_match_rule_suggestions
      WHERE household_id = ? AND pattern = ? AND category_id = ?
    `)
    .bind(DEFAULT_HOUSEHOLD_ID, pattern, category.id)
    .first<{ id: string; source_count: number; sample_descriptions_json: string; status: string }>();

  const samples = [...parseSuggestionSamples(existing?.sample_descriptions_json), input.description.trim()]
    .filter(Boolean)
    .filter((value, index, list) => list.indexOf(value) === index)
    .slice(0, 3);

  if (existing) {
    if (existing.status === "ignored") {
      return;
    }

    await db
      .prepare(`
        UPDATE category_match_rule_suggestions
        SET source_count = ?, sample_descriptions_json = ?, status = 'pending', updated_at = CURRENT_TIMESTAMP
        WHERE household_id = ? AND id = ?
      `)
      .bind(
        Math.max(1, Number(existing.source_count ?? 0) + 1),
        JSON.stringify(samples),
        DEFAULT_HOUSEHOLD_ID,
        existing.id
      )
      .run();
    return;
  }

  await db
    .prepare(`
      INSERT INTO category_match_rule_suggestions (
        id, household_id, pattern, category_id, source_count, sample_descriptions_json
      ) VALUES (?, ?, ?, ?, 1, ?)
    `)
    .bind(
      `catrulesug-${slugify(pattern)}-${crypto.randomUUID().slice(0, 8)}`,
      DEFAULT_HOUSEHOLD_ID,
      pattern,
      category.id,
      JSON.stringify(samples)
    )
    .run();
}

export async function ignoreCategoryMatchRuleSuggestion(db: D1Database, suggestionId: string) {
  const existing = await db
    .prepare(`
      SELECT id, pattern
      FROM category_match_rule_suggestions
      WHERE household_id = ? AND id = ? AND status = 'pending'
    `)
    .bind(DEFAULT_HOUSEHOLD_ID, suggestionId)
    .first<{ id: string; pattern: string }>();

  if (!existing) {
    throw new Error("Unknown category match suggestion.");
  }

  await db
    .prepare(`
      UPDATE category_match_rule_suggestions
      SET status = 'ignored', updated_at = CURRENT_TIMESTAMP
      WHERE household_id = ? AND id = ?
    `)
    .bind(DEFAULT_HOUSEHOLD_ID, suggestionId)
    .run();

  await recordAuditEvent(db, {
    entityType: "category_match_rule_suggestion",
    entityId: suggestionId,
    action: "category_match_rule_suggestion_ignored",
    detail: `Ignored category match suggestion ${existing.pattern}.`
  });

  return { suggestionId, ignored: true };
}

export async function deleteCategoryMatchRule(db: D1Database, ruleId: string) {
  const existing = await db
    .prepare("SELECT id, pattern FROM category_match_rules WHERE household_id = ? AND id = ?")
    .bind(DEFAULT_HOUSEHOLD_ID, ruleId)
    .first<{ id: string; pattern: string }>();

  if (!existing) {
    throw new Error("Unknown category match rule.");
  }

  await db
    .prepare("DELETE FROM category_match_rules WHERE household_id = ? AND id = ?")
    .bind(DEFAULT_HOUSEHOLD_ID, ruleId)
    .run();

  await recordAuditEvent(db, {
    entityType: "category_match_rule",
    entityId: ruleId,
    action: "category_match_rule_deleted",
    detail: `Deleted category match rule ${existing.pattern}.`
  });

  return { ruleId, deleted: true };
}

function normalizeRuleText(value: string) {
  return value.toUpperCase().replace(/[^A-Z0-9]+/g, "");
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function deriveSuggestionPattern(description: string) {
  const normalized = description
    .toUpperCase()
    .replace(/\b(OTHR|REF|REFERENCE|AUTH|CARD|SGD|VISA|MASTERCARD)\b/g, " ")
    .replace(/X{3,}/g, " ")
    .replace(/\d{4,}/g, " ")
    .replace(/[^A-Z0-9*.+/-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  return normalized.slice(0, 48).trim();
}

function parseSuggestionSamples(value?: string | null) {
  if (!value) {
    return [];
  }

  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed.filter((sample): sample is string => typeof sample === "string").slice(0, 3)
      : [];
  } catch {
    return [];
  }
}
