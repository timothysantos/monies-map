// Category rules file future imports. This module finds the past entries a
// rule now matches that are still uncategorised (Other or Other - Income) and
// moves them to the rule's category on request. Entries already in a real
// category are never touched, so nothing filed by hand is overwritten.
//
// A rule owns an entry only when it is the first active rule (by priority)
// to match it, the same order an import uses.

import { buildAuditEventStatement } from "./app-repository-audit";
import { loadCategoryMatchRules, matchCategoryRule } from "./app-repository-category-match-rules";
import { DEFAULT_HOUSEHOLD_ID } from "./app-repository-constants";
import { buildMonthlySnapshotRefreshMarkers, refreshMonthlySnapshotsAfterWrite } from "./app-repository-snapshots";
import type { CategoryMatchRuleBackfillDto, CategoryMatchRuleDto } from "../types/dto";

const UNCATEGORISED = ["Other", "Other - Income"];
const SAMPLE_LIMIT = 3;

type UncategorisedEntry = {
  id: string;
  description: string;
  original_description: string | null;
  transaction_date: string;
  post_date: string | null;
  category_id: string;
};

async function loadUncategorisedEntries(db: D1Database) {
  const result = await db
    .prepare(`
      SELECT transactions.id, transactions.description, transactions.original_description,
        transactions.transaction_date, transactions.post_date, transactions.category_id
      FROM transactions
      JOIN categories ON categories.id = transactions.category_id
      WHERE transactions.household_id = ?
        AND transactions.entry_type != 'transfer'
        AND categories.name IN (${UNCATEGORISED.map(() => "?").join(", ")})
      ORDER BY transactions.transaction_date DESC, transactions.id
    `)
    .bind(DEFAULT_HOUSEHOLD_ID, ...UNCATEGORISED)
    .all<UncategorisedEntry>();
  return result.results;
}

// The first active rule for an entry, matched on the bank's own text first.
function owningRule(entry: UncategorisedEntry, rules: CategoryMatchRuleDto[]) {
  for (const rule of rules) {
    if (!rule.isActive) {
      continue;
    }
    const descriptions = [entry.original_description, entry.description].filter((text): text is string => Boolean(text));
    if (descriptions.some((text) => matchCategoryRule(text, [rule]))) {
      return rule;
    }
  }
  return undefined;
}

// A rule that files into Other or Transfer would not categorise anything.
function canFile(rule: CategoryMatchRuleDto) {
  return !UNCATEGORISED.includes(rule.categoryName) && rule.categoryName !== "Transfer";
}

function entriesOwnedBy(entries: UncategorisedEntry[], rules: CategoryMatchRuleDto[]) {
  const owned = new Map<string, UncategorisedEntry[]>();
  for (const entry of entries) {
    const rule = owningRule(entry, rules);
    if (rule && canFile(rule)) {
      owned.set(rule.id, [...(owned.get(rule.id) ?? []), entry]);
    }
  }
  return owned;
}

// For Settings: each rule with uncategorised past entries it now matches.
export async function loadCategoryRuleBackfills(db: D1Database, rules?: CategoryMatchRuleDto[] | Promise<CategoryMatchRuleDto[]>): Promise<CategoryMatchRuleBackfillDto[]> {
  const [activeRules, entries] = await Promise.all([rules ?? loadCategoryMatchRules(db), loadUncategorisedEntries(db)]);
  const owned = entriesOwnedBy(entries, activeRules);
  return activeRules
    .filter((rule) => owned.has(rule.id))
    .map((rule) => {
      const matched = owned.get(rule.id)!;
      return {
        ruleId: rule.id,
        pattern: rule.pattern,
        categoryName: rule.categoryName,
        entryCount: matched.length,
        sampleDescriptions: [...new Set(matched.map((entry) => entry.description))].slice(0, SAMPLE_LIMIT)
      };
    })
    .sort((left, right) => right.entryCount - left.entryCount || left.pattern.localeCompare(right.pattern));
}

const STALE_ENTRIES_SQL = (count: number) => `
  SELECT transactions.id FROM transactions
  LEFT JOIN categories ON categories.id = transactions.category_id
  WHERE transactions.household_id = ?
    AND transactions.id IN (${Array(count).fill("?").join(", ")})
    AND (categories.name IS NULL OR categories.name NOT IN (${UNCATEGORISED.map(() => "?").join(", ")}))
`;

// The batch's first statement: it fails the whole batch when an entry was
// filed between the read and the write (malformed JSON for any stale row),
// so the move, its audit event and markers never commit half-true.
function buildStillUncategorisedGuard(db: D1Database, ids: string[]) {
  return db
    .prepare(`SELECT json('{' || id) AS stale FROM (${STALE_ENTRIES_SQL(ids.length)})`)
    .bind(DEFAULT_HOUSEHOLD_ID, ...ids, ...UNCATEGORISED);
}

async function stillUncategorised(db: D1Database, ids: string[]) {
  const stale = await db.prepare(STALE_ENTRIES_SQL(ids.length)).bind(DEFAULT_HOUSEHOLD_ID, ...ids, ...UNCATEGORISED).first();
  return !stale;
}

// Moves a rule's uncategorised past entries to its category. Reads and checks
// first, then commits every entry, the audit event and the month refresh
// markers in one guarded batch.
export async function applyCategoryRuleToPastEntries(db: D1Database, ruleId: string) {
  const rules = await loadCategoryMatchRules(db);
  const rule = rules.find((item) => item.id === ruleId);
  if (!rule) {
    throw new Error("Category match rule not found.");
  }
  if (!rule.isActive || !canFile(rule)) {
    return { ruleId, movedCount: 0, months: [] as string[] };
  }

  const entries = entriesOwnedBy(await loadUncategorisedEntries(db), rules).get(ruleId) ?? [];
  if (!entries.length) {
    return { ruleId, movedCount: 0, months: [] as string[] };
  }

  const months = [...new Set(entries.flatMap((entry) => [entry.transaction_date, entry.post_date ?? entry.transaction_date].map((date) => date.slice(0, 7))))].sort();
  const statements = [
    ...entries.map((entry) => db
      .prepare("UPDATE transactions SET category_id = ?, updated_at = CURRENT_TIMESTAMP WHERE household_id = ? AND id = ?")
      .bind(rule.categoryId, DEFAULT_HOUSEHOLD_ID, entry.id)),
    buildAuditEventStatement(db, {
      entityType: "category_match_rule",
      entityId: ruleId,
      action: "category_rule_applied_to_past",
      detail: `Moved ${entries.length} past ${entries.length === 1 ? "entry" : "entries"} from Other to ${rule.categoryName} with the rule ${rule.pattern}.`
    }),
    ...buildMonthlySnapshotRefreshMarkers(db, months)
  ];
  const ids = entries.map((entry) => entry.id);
  try {
    await db.batch([buildStillUncategorisedGuard(db, ids), ...statements]);
  } catch (error) {
    if (!(await stillUncategorised(db, ids))) {
      throw new Error("Some of these entries were changed meanwhile. Reload Settings and try again.");
    }
    throw error;
  }
  await refreshMonthlySnapshotsAfterWrite(db, months);

  return { ruleId, movedCount: entries.length, months };
}
