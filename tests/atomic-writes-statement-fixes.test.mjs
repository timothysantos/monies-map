// Statement fixes are written with the import commit in one db.batch(), and
// undone with its rollback in one batch: a failure at any statement leaves
// every entry, fix record, certificate and audit event as it was. Real local
// D1 (Miniflare) seeded with the demo household; the scenario is the
// two-card UOB statement with two purchases on the wrong card.
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
import {
  commitBody,
  previewStatement,
  setUpWrongCardScenario,
  suggestedFixes
} from "./support/uob-wrong-card-scenario.mjs";

let template;
test.before(async () => {
  template = await createSeededTemplate();
});
test.after(async () => {
  await template?.dispose();
});

async function prepareFixedCommit(api) {
  const scenario = await setUpWrongCardScenario(api);
  const fixes = suggestedFixes(await previewStatement(api, scenario.statement));
  assert.equal(fixes.length, 2);
  const fixed = await previewStatement(api, scenario.statement, fixes);
  return { ...scenario, body: commitBody(scenario.statement, fixed, fixes) };
}

for (const [label, pattern, skip] of [
  // The second move: the first one has already been queued in the batch.
  ["the second move", /SET account_id = \?, updated_at = CURRENT_TIMESTAMP/, 1],
  ["a fix record", /INSERT INTO import_statement_fixes/, 1],
  ["a statement certificate", /INSERT INTO statement_reconciliation_certificates/, 1]
]) {
  test(`a failure writing ${label} leaves both moves and the whole import unsaved`, async (t) => {
    const { db, api } = await openSeededDatabase(t, template);
    const { body, entryIds, ladysCardId } = await prepareFixedCommit(api);
    const before = await dumpDatabase(db);
    const faulty = failingStatement(db, pattern, { skip });

    const { status, payload } = await api("/api/imports/commit", body, { database: faulty.db });

    assert.equal(faulty.state.fired, true);
    assert.equal(status, 400);
    assert.match(payload.error, /injected_failure_missing_table/);
    assertSameDatabase(await dumpDatabase(db), before);
    const accounts = await rows(db, "SELECT id, account_id FROM transactions WHERE id IN (?, ?) ORDER BY id", entryIds.openai, entryIds.buyandship);
    assert.deepEqual(accounts.map((row) => row.account_id), [ladysCardId, ladysCardId]);

    // The same statement commits afterwards, moves included.
    const retry = await api("/api/imports/commit", body);
    assert.equal(retry.status, 200, JSON.stringify(retry.payload));
    assert.equal((await rows(db, "SELECT id FROM import_statement_fixes WHERE import_id = ?", retry.payload.importId)).length, 2);
  });
}

test("a failure during the rollback leaves the moved entries and their fix records in place", async (t) => {
  const { db, api } = await openSeededDatabase(t, template);
  const { body } = await prepareFixedCommit(api);
  const commit = await api("/api/imports/commit", body);
  assert.equal(commit.status, 200, JSON.stringify(commit.payload));
  const before = await dumpDatabase(db);
  const faulty = failingStatement(db, /DELETE FROM import_statement_fixes/);

  const { status } = await api("/api/imports/rollback", { importId: commit.payload.importId }, { database: faulty.db });

  assert.equal(faulty.state.fired, true);
  assert.equal(status, 500);
  assertSameDatabase(await dumpDatabase(db), before);
});
