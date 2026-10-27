// The Ledger check-up's only writes, "This is fine" and its undo, are
// all-or-nothing: the setting row and its audit event commit together or not at
// all (docs/code-spec.md "Persistence Atomicity Contract"). Real local D1.
import assert from "node:assert/strict";
import test from "node:test";

import { dismissCheckupFinding, loadCheckupDismissals, undoCheckupDismissal } from "../src/domain/app-repository-ledger-checkup.ts";
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

const ID = "unmatched_transfer:series:acct-uob-savings:out:45000:SGD";
const KEY = "0123456789abcd";

const commands = [
  ["dismiss", (db) => dismissCheckupFinding(db, { id: ID, evidenceKey: KEY }), /INSERT INTO app_settings/, false],
  ["undo", (db) => undoCheckupDismissal(db, { id: ID }), /DELETE FROM app_settings/, true]
];

for (const [name, run, writePattern, needsDismissal] of commands) {
  for (const [what, match] of [["its write", writePattern], ["its audit event", /INSERT INTO audit_events/]]) {
    test(`${name}: a failure on ${what} leaves the database as it was`, async (t) => {
      const { db } = await openSeededDatabase(t, template);
      if (needsDismissal) {
        await dismissCheckupFinding(db, { id: ID, evidenceKey: KEY });
      }
      const before = await dumpDatabase(db);
      const faulty = failingStatement(db, match);
      await assert.rejects(run(faulty.db), /injected_failure_missing_table/);
      assert.equal(faulty.state.fired, true);
      assertSameDatabase(await dumpDatabase(db), before);
    });
  }
}

test("a successful dismissal writes exactly its setting and one audit event, and undo removes exactly those", async (t) => {
  const { db } = await openSeededDatabase(t, template);
  const before = await dumpDatabase(db);
  await dismissCheckupFinding(db, { id: ID, evidenceKey: KEY });
  const after = await dumpDatabase(db);
  assert.deepEqual(Object.keys(after).filter((table) => JSON.stringify(after[table]) !== JSON.stringify(before[table])).sort(), ["app_settings", "audit_events"]);
  assert.equal(after.app_settings.length, before.app_settings.length + 1);
  assert.equal(after.audit_events.length, before.audit_events.length + 1);
  assert.deepEqual([...await loadCheckupDismissals(db)], [[ID, KEY]]);
  const [audit] = await rows(db, "SELECT entity_type, entity_id, action, detail FROM audit_events WHERE action = 'ledger_checkup_dismissed'");
  assert.deepEqual({ type: audit.entity_type, id: audit.entity_id }, { type: "ledger_checkup", id: ID });
  assert.doesNotMatch(audit.detail, /45000|acct-uob-savings/, "the audit line is plain words, no ids or amounts");

  await undoCheckupDismissal(db, { id: ID });
  assert.deepEqual([...await loadCheckupDismissals(db)], []);
  assert.equal((await rows(db, "SELECT COUNT(*) AS n FROM audit_events WHERE action = 'ledger_checkup_dismissal_undone'"))[0].n, 1);
});
