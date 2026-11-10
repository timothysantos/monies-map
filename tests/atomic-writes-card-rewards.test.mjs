// Cards and rewards: copying the usual rules in, save, reset, restore
// (Undo) and "Suggest cards from" each write their rows and their audit
// event in one db.batch(), so a failure on any statement leaves the
// database as it was. Real local D1, demo household.
import assert from "node:assert/strict";
import test from "node:test";

import { changeCardRewardRules, saveCardRewardSuggestFrom } from "../src/domain/app-repository-card-rewards.ts";
import { buildCardRewardRulesDto } from "../src/domain/pages/card-rewards.ts";
import {
  assertSameDatabase,
  createSeededTemplate,
  dumpDatabase,
  failingStatement,
  openSeededDatabase
} from "./support/d1-workspace.mjs";

let template;
test.before(async () => {
  template = await createSeededTemplate();
});
test.after(async () => {
  await template?.dispose();
});

const LADYS = "acct-uob-lady";
const LADYS_RULES = {
  unit: "miles", baseRate: 0.4, excludedCategories: ["Tax"], minSpendMinor: null, minCount: null,
  bonuses: [{ id: "chosen", categories: ["Shopping"], channels: [], rate: 4, capMinor: 100_000, cycle: { kind: "calendar", day: 1 } }]
};

const seeded = (db) => buildCardRewardRulesDto(db);

function countingBatches(db) {
  const batches = [];
  const proxy = new Proxy(db, {
    get(target, property) {
      if (property === "batch") {
        return (statements) => {
          batches.push(statements.length);
          return target.batch(statements);
        };
      }
      const value = Reflect.get(target, property);
      return typeof value === "function" ? value.bind(target) : value;
    }
  });
  return { proxy, batches };
}

test("copying the usual rules in: a failure on a row or on its audit event leaves the database as it was", async (t) => {
  for (const pattern of [/INSERT OR IGNORE INTO card_reward_rules/, /INSERT INTO audit_events/]) {
    const { db } = await openSeededDatabase(t, template);
    const before = await dumpDatabase(db);
    const faulty = failingStatement(db, pattern);
    await assert.rejects(seeded(faulty.db), /injected_failure_missing_table/);
    assert.equal(faulty.state.fired, true);
    assertSameDatabase(await dumpDatabase(db), before);
  }
  const { db } = await openSeededDatabase(t, template);
  const { proxy, batches } = countingBatches(db);
  await seeded(proxy);
  // Three cards and one audit event, in one batch; the next read writes none.
  assert.deepEqual(batches, [4]);
  await seeded(proxy);
  assert.deepEqual(batches, [4]);
});

const commands = [
  ["save", (db) => changeCardRewardRules(db, { accountId: LADYS, action: "save", rules: LADYS_RULES }), /INSERT INTO card_reward_rules/],
  ["reset", (db) => changeCardRewardRules(db, { accountId: LADYS, action: "reset" }), /INSERT INTO card_reward_rules/],
  ["restore to not set up", (db) => changeCardRewardRules(db, { accountId: LADYS, action: "restore", rules: null }), /DELETE FROM card_reward_rules/],
  ["suggest cards from", (db) => saveCardRewardSuggestFrom(db, { from: "own" }), /INSERT INTO app_settings/]
];

for (const [name, run, pattern] of commands) {
  for (const [what, match] of [["its write", pattern], ["its audit event", /INSERT INTO audit_events/]]) {
    test(`${name}: a failure on ${what} leaves the database as it was`, async (t) => {
      const { db } = await openSeededDatabase(t, template);
      await seeded(db);
      await saveCardRewardSuggestFrom(db, { from: "household" });
      const before = await dumpDatabase(db);
      const faulty = failingStatement(db, match);
      await assert.rejects(run(faulty.db), /injected_failure_missing_table/);
      assert.equal(faulty.state.fired, true);
      assertSameDatabase(await dumpDatabase(db), before);
    });
  }

  test(`${name}: success commits the write and its audit event in one batch`, async (t) => {
    const { db } = await openSeededDatabase(t, template);
    await seeded(db);
    await saveCardRewardSuggestFrom(db, { from: "household" });
    const { proxy, batches } = countingBatches(db);
    await run(proxy);
    assert.deepEqual(batches, [2]);
  });
}
