// Deleting a category match rule removes the rule, the "ignored" marks on
// duplicate issues that name it, and records the audit event as one
// all-or-nothing batch. Deleting a rule that is already gone (another tab or
// device removed it first) is a no-op that succeeds, so a stale list heals on
// the refresh that follows instead of showing an error nobody sees.
import assert from "node:assert/strict";
import test from "node:test";

import {
  assertSameDatabase,
  createSeededTemplate,
  dumpDatabase,
  failingStatement,
  openSeededDatabase,
  rows
} from "./support/d1-workspace.mjs";

let template;
test.before(async () => {
  template = await createSeededTemplate();
});
test.after(async () => {
  await template?.dispose();
});

async function seedOverlappingRules(db, api) {
  const food = (await rows(db, "SELECT id FROM categories WHERE name = 'Food & Drinks'"))[0].id;
  const first = await api("/api/category-match-rules/save", { pattern: "PWDEL KOPI", categoryId: food, priority: 40 });
  const second = await api("/api/category-match-rules/save", { pattern: "PWDEL KOPI BAR", categoryId: food, priority: 80 });
  assert.equal(first.status, 200, JSON.stringify(first.payload));
  assert.equal(second.status, 200, JSON.stringify(second.payload));
  const issueId = [first.payload.ruleId, second.payload.ruleId].sort().join(":");
  const ignored = await api("/api/category-match-rules/ignore-issue", { issueId });
  assert.equal(ignored.status, 200, JSON.stringify(ignored.payload));
  return { firstId: first.payload.ruleId, secondId: second.payload.ruleId, issueId };
}

test("deleting a rule removes it, its ignored duplicate marks and writes one audit event", async (t) => {
  const { db, api } = await openSeededDatabase(t, template);
  const ids = await seedOverlappingRules(db, api);

  const result = await api("/api/category-match-rules/delete", { ruleId: ids.secondId });
  assert.equal(result.status, 200, JSON.stringify(result.payload));
  assert.deepEqual(result.payload, { ok: true, ruleId: ids.secondId, deleted: true });

  assert.deepEqual(await rows(db, "SELECT id FROM category_match_rules WHERE id = ?", ids.secondId), []);
  assert.equal((await rows(db, "SELECT id FROM category_match_rules WHERE id = ?", ids.firstId)).length, 1);
  assert.deepEqual(await rows(db, "SELECT issue_key FROM category_match_rule_issue_ignores WHERE issue_key = ?", ids.issueId), []);
  assert.deepEqual(
    await rows(db, "SELECT entity_id, action, detail FROM audit_events WHERE action = 'category_match_rule_deleted'"),
    [{ entity_id: ids.secondId, action: "category_match_rule_deleted", detail: "Deleted category match rule PWDEL KOPI BAR." }]
  );
});

test("deleting a rule that is already gone succeeds and changes nothing", async (t) => {
  const { db, api } = await openSeededDatabase(t, template);
  const ids = await seedOverlappingRules(db, api);
  await api("/api/category-match-rules/delete", { ruleId: ids.secondId });
  const before = await dumpDatabase(db);

  const again = await api("/api/category-match-rules/delete", { ruleId: ids.secondId });
  assert.equal(again.status, 200, JSON.stringify(again.payload));
  assert.deepEqual(again.payload, { ok: true, ruleId: ids.secondId, deleted: false });
  assertSameDatabase(await dumpDatabase(db), before);

  const missingId = await api("/api/category-match-rules/delete", {});
  assert.equal(missingId.status, 400);
});

test("a failure while recording the audit event leaves the rule and its ignored marks in place", async (t) => {
  const { db, api } = await openSeededDatabase(t, template);
  const ids = await seedOverlappingRules(db, api);
  const before = await dumpDatabase(db);

  const { db: failingDb, state } = failingStatement(db, /INSERT INTO audit_events/);
  const result = await api("/api/category-match-rules/delete", { ruleId: ids.secondId }, { database: failingDb });
  assert.equal(state.fired, true);
  assert.equal(result.payload.ok, false);
  assertSameDatabase(await dumpDatabase(db), before);
});
