// A cold Worker isolate runs the schema repairs and the default seeding before
// its first request answers. Every statement there is one sequential D1
// round trip, so the count is the cold-start latency: a production isolate
// that issued ~380 of them made the first page after each idle spell take
// 4-50 seconds. This pins the cold path to a small fixed number of round
// trips and the steady state to reads only.
import assert from "node:assert/strict";
import test from "node:test";

import { countingDatabase } from "./support/d1-counting.mjs";
import { createSeededTemplate, openSeededDatabase, rows } from "./support/d1-workspace.mjs";
import { ensureDemoSchema } from "../src/domain/app-repository-schema.ts";
import { seedEmptyStateReferenceData } from "../src/domain/app-repository-seed.ts";
import { ensureDefaultCategoryMatchRules } from "../src/domain/app-repository-category-match-rules.ts";
import { defaultCategoryMatchRules, deprecatedDefaultCategoryMatchRuleIds } from "../src/domain/category-match-defaults.ts";

// Round trips a cold isolate may spend: it was ~384 before the fix.
const COLD_START_ROUND_TRIP_BUDGET = 60;
// An up-to-date database needs only the two one-statement upkeep writes (the
// household upsert and the palette repair), never a write per default row.
const ALLOWED_UPKEEP_WRITES = [/^INSERT INTO households/, /^UPDATE categories SET color_hex/];

let template;
test.before(async () => {
  template = await createSeededTemplate();
});
test.after(async () => {
  await template?.dispose();
});

test("a cold isolate on an up-to-date empty-state database uses a small fixed number of round trips", async (t) => {
  const { db } = await openSeededDatabase(t, template);
  const counting = countingDatabase(db);
  await ensureDemoSchema(counting.db);
  await seedEmptyStateReferenceData(counting.db);
  const { statements } = counting.summary();
  assert.ok(
    statements <= COLD_START_ROUND_TRIP_BUDGET,
    `cold start issued ${statements} round trips (budget ${COLD_START_ROUND_TRIP_BUDGET}); biggest repeats: ${repeatedStatements(counting.calls)}`
  );
  // Nothing was missing, so nothing else may be written by the default seeding.
  const writes = counting.calls
    .filter((call) => /^\s*(INSERT|UPDATE|DELETE)/i.test(call.sql) || call.kind === "batch")
    .filter((call) => !ALLOWED_UPKEEP_WRITES.some((pattern) => pattern.test(call.sql)));
  assert.deepEqual(writes.map((call) => call.sql.slice(0, 80)), []);
});

test("default match rules: a missing default comes back, a retired one goes, everything else is untouched", async (t) => {
  const { db } = await openSeededDatabase(t, template);
  const missing = defaultCategoryMatchRules[3];
  const retiredId = deprecatedDefaultCategoryMatchRuleIds[0];
  const groceries = await db.prepare("SELECT id FROM categories WHERE name = 'Groceries'").first();
  await db.prepare("DELETE FROM category_match_rules WHERE id = ?").bind(missing.id).run();
  await db
    .prepare("INSERT INTO category_match_rules (id, household_id, pattern, category_id, priority, is_active, note) VALUES (?, 'household-1', ?, ?, 5, 1, NULL)")
    .bind(retiredId, missing.pattern, groceries.id)
    .run();
  await db
    .prepare("INSERT INTO category_match_rules (id, household_id, pattern, category_id, priority, is_active, note) VALUES ('rule-owner-made', 'household-1', 'OWNER MADE PATTERN', ?, 7, 0, 'mine')")
    .bind(groceries.id)
    .run();
  const before = await rows(db, "SELECT id, pattern, category_id, priority, is_active, note FROM category_match_rules WHERE id NOT IN (?, ?) ORDER BY id", missing.id, retiredId);

  await ensureDefaultCategoryMatchRules(db);

  const restored = await db.prepare("SELECT pattern, priority, is_active FROM category_match_rules WHERE id = ?").bind(missing.id).first();
  assert.deepEqual(restored, { pattern: missing.pattern, priority: missing.priority, is_active: 1 });
  assert.equal(await db.prepare("SELECT id FROM category_match_rules WHERE id = ?").bind(retiredId).first(), null);
  const after = await rows(db, "SELECT id, pattern, category_id, priority, is_active, note FROM category_match_rules WHERE id NOT IN (?, ?) ORDER BY id", missing.id, retiredId);
  assert.deepEqual(after, before, "no other rule, including the owner's own and inactive ones, may change");
});

test("default match rules: a rule the owner re-pointed or edited is not overwritten", async (t) => {
  const { db } = await openSeededDatabase(t, template);
  const rule = defaultCategoryMatchRules[5];
  const other = await db.prepare("SELECT id FROM categories WHERE name = 'Groceries'").first();
  await db.prepare("UPDATE category_match_rules SET category_id = ?, priority = 77, is_active = 0 WHERE id = ?").bind(other.id, rule.id).run();
  await ensureDefaultCategoryMatchRules(db);
  const kept = await db.prepare("SELECT category_id, priority, is_active FROM category_match_rules WHERE id = ?").bind(rule.id).first();
  assert.deepEqual(kept, { category_id: other.id, priority: 77, is_active: 0 });
});

function repeatedStatements(calls) {
  const counts = new Map();
  for (const call of calls) {
    const key = call.sql.slice(0, 48);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()].sort((left, right) => right[1] - left[1]).slice(0, 3).map(([key, count]) => `${count}x ${key}`).join("; ");
}
