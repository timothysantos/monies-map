// Settings -> Payment ways: saving one person's payment ways is
// all-or-nothing. The stored setting and its audit event commit in one
// db.batch(); a failure on either leaves the database byte-for-byte as it
// was (real local D1, demo household).
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
import { savePaymentWay } from "../src/domain/app-repository-payment-ways.ts";

let template;
test.before(async () => {
  template = await createSeededTemplate();
});
test.after(async () => {
  await template?.dispose();
});

const JOYCE_ON_JOINT = { personId: "person-joyce", bankTransferAccountId: "acct-household", cashAccountId: "" };

test("a payment way save that fails on its audit event keeps the previous setting", async (t) => {
  const { db } = await openSeededDatabase(t, template);
  // An earlier choice exists, so the failed save would have to undo a merge.
  await savePaymentWay(db, { personId: "person-tim", bankTransferAccountId: "acct-uob-savings", cashAccountId: "" });
  const before = await dumpDatabase(db);
  const faulty = failingStatement(db, /INSERT INTO audit_events/);

  await assert.rejects(savePaymentWay(faulty.db, JOYCE_ON_JOINT), /injected_failure_missing_table/);

  assert.equal(faulty.state.fired, true);
  assertSameDatabase(await dumpDatabase(db), before);
});

test("a payment way save that fails on the setting writes no audit event", async (t) => {
  const { db } = await openSeededDatabase(t, template);
  const before = await dumpDatabase(db);
  const faulty = failingStatement(db, /INSERT INTO app_settings/);

  await assert.rejects(savePaymentWay(faulty.db, JOYCE_ON_JOINT), /injected_failure_missing_table/);

  assert.equal(faulty.state.fired, true);
  assertSameDatabase(await dumpDatabase(db), before);
});

test("a successful save commits the setting and its audit event together", async (t) => {
  const { db } = await openSeededDatabase(t, template);
  const batches = [];
  const counting = new Proxy(db, {
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

  await savePaymentWay(counting, JOYCE_ON_JOINT);

  assert.deepEqual(batches, [2], "one batch: the setting and the audit event");
  const [setting] = await rows(db, "SELECT value_json FROM app_settings WHERE key = 'payment_ways'");
  assert.deepEqual(JSON.parse(setting.value_json), { people: { "person-joyce": { bankTransferAccountId: "acct-household", cashAccountId: "" } } });
  assert.equal((await rows(db, "SELECT id FROM audit_events WHERE action = 'payment_way_updated'")).length, 1);
});
