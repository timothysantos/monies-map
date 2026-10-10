// A category rule only files future imports. Settings lists the past entries
// still in Other or Other - Income that a rule now matches, and can move them
// in one go. Entries already in a real category are never touched. The move
// is all-or-nothing: entries, audit event and month refresh markers commit
// in one batch.
import assert from "node:assert/strict";
import test from "node:test";

import {
  assertSameDatabase,
  createEntry,
  createSeededTemplate,
  dumpDatabase,
  failingStatement,
  openSeededDatabase,
  rows,
  statementSql
} from "./support/d1-workspace.mjs";

let template;
test.before(async () => {
  template = await createSeededTemplate();
});
test.after(async () => {
  await template?.dispose();
});

async function categoryOf(db, entryId) {
  const [row] = await rows(db, "SELECT categories.name AS name FROM transactions JOIN categories ON categories.id = transactions.category_id WHERE transactions.id = ?", entryId);
  return row?.name;
}

async function seedKopiScenario(db, api) {
  const otherId = await createEntry(api, { date: "2026-05-12", description: "ZEPHYR KOPI BAR SINGAPORE", categoryName: "Other", amountMinor: 650 });
  const laterId = await createEntry(api, { date: "2026-06-03", description: "ZEPHYR KOPI BAR SINGAPORE SG", categoryName: "Other", amountMinor: 720 });
  const paybackId = await createEntry(api, { date: "2026-05-13", description: "PAYNOW ZEPHYR KOPI BAR", categoryName: "Other - Income", entryType: "income", amountMinor: 300 });
  // Already filed by hand: a rule must never overwrite it.
  const handFiledId = await createEntry(api, { date: "2026-05-14", description: "ZEPHYR KOPI BAR BEANS", categoryName: "Groceries", amountMinor: 2_400 });
  // An earlier-priority rule wins for this one, so the new rule does not own it.
  const shadowedId = await createEntry(api, { date: "2026-05-15", description: "ZEPHYR KOPI BAR DELIVEROO", categoryName: "Other", amountMinor: 1_100 });
  const food = (await rows(db, "SELECT id FROM categories WHERE name = 'Food & Drinks'"))[0].id;
  const travel = (await rows(db, "SELECT id FROM categories WHERE name = 'Travel'"))[0].id;
  let saved = await api("/api/category-match-rules/save", { pattern: "DELIVEROO", categoryId: travel, priority: 10 });
  assert.equal(saved.status, 200, JSON.stringify(saved.payload));
  saved = await api("/api/category-match-rules/save", { pattern: "ZEPHYR KOPI BAR", categoryId: food, priority: 45 });
  assert.equal(saved.status, 200, JSON.stringify(saved.payload));
  return { otherId, laterId, paybackId, handFiledId, shadowedId, ruleId: saved.payload.ruleId };
}

test("Settings lists the past entries in Other a rule now matches, then moves exactly those", async (t) => {
  const { db, api } = await openSeededDatabase(t, template);
  const ids = await seedKopiScenario(db, api);

  const page = await api("/api/settings-page");
  const backfill = page.payload.settingsPage.categoryRuleBackfills.find((item) => item.ruleId === ids.ruleId);
  assert.deepEqual(backfill, {
    ruleId: ids.ruleId,
    pattern: "ZEPHYR KOPI BAR",
    categoryName: "Food & Drinks",
    entryCount: 3,
    sampleDescriptions: ["ZEPHYR KOPI BAR SINGAPORE SG", "PAYNOW ZEPHYR KOPI BAR", "ZEPHYR KOPI BAR SINGAPORE"]
  });

  const applied = await api("/api/category-match-rules/apply-to-past", { ruleId: ids.ruleId });
  assert.equal(applied.status, 200, JSON.stringify(applied.payload));
  assert.deepEqual(applied.payload, { ok: true, ruleId: ids.ruleId, movedCount: 3, months: ["2026-05", "2026-06"] });

  assert.equal(await categoryOf(db, ids.otherId), "Food & Drinks");
  assert.equal(await categoryOf(db, ids.laterId), "Food & Drinks");
  assert.equal(await categoryOf(db, ids.paybackId), "Food & Drinks");
  assert.equal(await categoryOf(db, ids.handFiledId), "Groceries");
  assert.equal(await categoryOf(db, ids.shadowedId), "Other");

  const audit = await rows(db, "SELECT entity_id, action, detail FROM audit_events WHERE action = 'category_rule_applied_to_past'");
  assert.deepEqual(audit, [{ entity_id: ids.ruleId, action: "category_rule_applied_to_past", detail: "Moved 3 past entries from Other to Food & Drinks with the rule ZEPHYR KOPI BAR." }]);
  // The follow-up refresh cleared the markers it set.
  assert.deepEqual(await rows(db, "SELECT month_key FROM monthly_snapshot_refreshes WHERE month_key IN ('2026-05', '2026-06')"), []);

  const after = await api("/api/settings-page");
  assert.equal(after.payload.settingsPage.categoryRuleBackfills.find((item) => item.ruleId === ids.ruleId), undefined);
});

test("applying a rule with nothing left to move, or an unknown rule, changes nothing", async (t) => {
  const { db, api } = await openSeededDatabase(t, template);
  const ids = await seedKopiScenario(db, api);
  await api("/api/category-match-rules/apply-to-past", { ruleId: ids.ruleId });
  const before = await dumpDatabase(db);

  const again = await api("/api/category-match-rules/apply-to-past", { ruleId: ids.ruleId });
  assert.deepEqual(again.payload, { ok: true, ruleId: ids.ruleId, movedCount: 0, months: [] });
  const unknown = await api("/api/category-match-rules/apply-to-past", { ruleId: "catrule-missing" });
  assert.equal(unknown.status, 400);
  assert.equal(unknown.payload.ok, false);
  assertSameDatabase(await dumpDatabase(db), before);
});

test("a failure partway through moving past entries leaves the database unchanged", async (t) => {
  const { db, api } = await openSeededDatabase(t, template);
  const ids = await seedKopiScenario(db, api);
  const before = await dumpDatabase(db);

  const { db: failingDb, state } = failingStatement(db, /^\s*UPDATE transactions SET category_id/, { skip: 1 });
  const result = await api("/api/category-match-rules/apply-to-past", { ruleId: ids.ruleId }, { database: failingDb });
  assert.equal(state.fired, true);
  assert.equal(result.payload.ok, false);
  assertSameDatabase(await dumpDatabase(db), before);
});

test("an entry filed by hand while the move runs stops the whole move", async (t) => {
  const { db, api } = await openSeededDatabase(t, template);
  const ids = await seedKopiScenario(db, api);
  const shopping = (await rows(db, "SELECT id FROM categories WHERE name = 'Shopping'"))[0].id;
  // Another tab files one of the entries between the command's read and its batch.
  const racingDb = new Proxy(db, {
    get(target, property) {
      if (property === "batch") {
        return async (statements) => {
          if (statements.some((statement) => /UPDATE transactions SET category_id/.test(statementSql(statement)))) {
            await target.prepare("UPDATE transactions SET category_id = ? WHERE id = ?").bind(shopping, ids.laterId).run();
          }
          return target.batch(statements);
        };
      }
      const value = Reflect.get(target, property);
      return typeof value === "function" ? value.bind(target) : value;
    }
  });

  const result = await api("/api/category-match-rules/apply-to-past", { ruleId: ids.ruleId }, { database: racingDb });
  assert.equal(result.status, 400);
  assert.equal(result.payload.error, "Some of these entries were changed meanwhile. Reload Settings and try again.");
  assert.equal(await categoryOf(db, ids.laterId), "Shopping");
  assert.equal(await categoryOf(db, ids.otherId), "Other");
  assert.equal(await categoryOf(db, ids.paybackId), "Other - Income");
  assert.deepEqual(await rows(db, "SELECT id FROM audit_events WHERE action = 'category_rule_applied_to_past'"), []);
});
