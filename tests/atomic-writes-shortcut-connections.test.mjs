// Settings -> Apple Pay shortcut: saving or revoking one person's connection
// is all-or-nothing. The stored setting and its audit event commit in one
// db.batch(); a failure on either leaves the database byte-for-byte as it was
// (real local D1, demo household).
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
import { revokeShortcutConnection, saveShortcutSettings } from "../src/domain/app-repository-shortcuts.ts";

let template;
test.before(async () => {
  template = await createSeededTemplate();
});
test.after(async () => {
  await template?.dispose();
});

async function joyceInput(db) {
  const [card] = await rows(db, "SELECT id FROM accounts WHERE account_name = 'UOB Lady''s'");
  return { personId: "person-joyce", apiKey: "mm_joyce", defaultAccountPriorityIds: [card.id] };
}

for (const [label, pattern] of [["audit event", /INSERT INTO audit_events/], ["setting", /INSERT INTO app_settings/]]) {
  test(`a connection save that fails on its ${label} changes nothing`, async (t) => {
    const { db } = await openSeededDatabase(t, template);
    const input = await joyceInput(db);
    const before = await dumpDatabase(db);
    const faulty = failingStatement(db, pattern);

    await assert.rejects(saveShortcutSettings(faulty.db, input), /injected_failure_missing_table/);

    assert.equal(faulty.state.fired, true);
    assertSameDatabase(await dumpDatabase(db), before);
  });

  test(`a revoke that fails on its ${label} keeps the key`, async (t) => {
    const { db } = await openSeededDatabase(t, template);
    await saveShortcutSettings(db, await joyceInput(db));
    const before = await dumpDatabase(db);
    const faulty = failingStatement(db, pattern);

    await assert.rejects(revokeShortcutConnection(faulty.db, { personId: "person-joyce" }), /injected_failure_missing_table/);

    assert.equal(faulty.state.fired, true);
    assertSameDatabase(await dumpDatabase(db), before);
  });
}

test("a save and a revoke each commit the setting and its audit event together, in one batch", async (t) => {
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

  await saveShortcutSettings(counting, await joyceInput(db));
  await revokeShortcutConnection(counting, { personId: "person-joyce" });

  assert.deepEqual(batches, [2, 2]);
  const [setting] = await rows(db, "SELECT value_json FROM app_settings WHERE key = 'shortcut_api_person_person-joyce'");
  assert.deepEqual(JSON.parse(setting.value_json), {
    apiKey: "",
    defaultAccountPriorityIds: JSON.parse(setting.value_json).defaultAccountPriorityIds,
    defaultParams: "",
    revoked: true
  });
  assert.deepEqual(
    (await rows(db, "SELECT action FROM audit_events WHERE entity_id = 'shortcut_api_person_person-joyce' ORDER BY rowid")).map((row) => row.action),
    ["shortcut_settings_updated", "shortcut_connection_revoked"]
  );
});
