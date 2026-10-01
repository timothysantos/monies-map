// Statement corrections from a Settings statement comparison are applied and
// undone in one db.batch(): a failure at any statement leaves every entry,
// correction record and audit event as it was. Real local D1 (Miniflare)
// seeded with the demo household; the two-card UOB statement with OpenAI and
// Buyandship recorded on the wrong card.
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
  compareLadysCard,
  previewStatement,
  setUpHandRecordedStatement,
  setUpWrongCardScenario,
  STATEMENT_MONTH
} from "./support/uob-wrong-card-scenario.mjs";

let template;
test.before(async () => {
  template = await createSeededTemplate();
});
test.after(async () => {
  await template?.dispose();
});

// The suggested moves, after the statements were saved by hand.
async function prepareMoves(api) {
  const scenario = await setUpHandRecordedStatement(api);
  const corrections = (await compareLadysCard(api, scenario.statement, scenario.ladysCardId)).statementDiagnosis.findings.map((finding) => finding.fix);
  assert.equal(corrections.length, 2);
  return { ...scenario, body: { accountId: scenario.ladysCardId, checkpointMonth: STATEMENT_MONTH, corrections } };
}

// The suggested removals, after the statement import added the purchases
// to the right card.
async function prepareRemovals(api) {
  const scenario = await setUpWrongCardScenario(api);
  const commit = await api("/api/imports/commit", commitBody(scenario.statement, await previewStatement(api, scenario.statement)));
  assert.equal(commit.status, 200, JSON.stringify(commit.payload));
  const corrections = (await compareLadysCard(api, scenario.statement, scenario.ladysCardId)).statementDiagnosis.findings.map((finding) => finding.fix);
  assert.deepEqual(corrections.map((fix) => fix.kind), ["remove_duplicate_entry", "remove_duplicate_entry"]);
  return { ...scenario, body: { accountId: scenario.ladysCardId, checkpointMonth: STATEMENT_MONTH, corrections } };
}

for (const [label, prepare, pattern, skip] of [
  // The first move has already been queued in the batch.
  ["the second move", prepareMoves, /SET account_id = \?, updated_at = CURRENT_TIMESTAMP/, 1],
  ["a correction record", prepareMoves, /INSERT INTO statement_corrections/, 1],
  ["the second removal", prepareRemovals, /DELETE FROM transactions/, 1],
  ["a month refresh marker", prepareRemovals, /monthly_snapshot_refreshes/, 0]
]) {
  test(`a failure writing ${label} leaves every correction unapplied`, async (t) => {
    const { db, api } = await openSeededDatabase(t, template);
    const { body } = await prepare(api);
    const before = await dumpDatabase(db);
    const faulty = failingStatement(db, pattern, { skip });

    const { status } = await api("/api/accounts/checkpoints/statement-corrections/apply", body, { database: faulty.db });

    assert.equal(faulty.state.fired, true);
    assert.equal(status, 500);
    assertSameDatabase(await dumpDatabase(db), before);

    // The same corrections apply afterwards.
    const retry = await api("/api/accounts/checkpoints/statement-corrections/apply", body);
    assert.equal(retry.status, 200, JSON.stringify(retry.payload));
    assert.equal((await rows(db, "SELECT id FROM statement_corrections WHERE undone_at IS NULL")).length, 2);
  });
}

for (const [label, prepare, pattern] of [
  ["a moved entry", prepareMoves, /SET account_id = \?, updated_at = CURRENT_TIMESTAMP/],
  ["a restored entry", prepareRemovals, /INSERT INTO transactions/]
]) {
  test(`a failure undoing ${label} leaves the corrections in place`, async (t) => {
    const { db, api } = await openSeededDatabase(t, template);
    const { body } = await prepare(api);
    const applied = await api("/api/accounts/checkpoints/statement-corrections/apply", body);
    assert.equal(applied.status, 200, JSON.stringify(applied.payload));
    const before = await dumpDatabase(db);
    // The second undo write: the first one has already been queued.
    const faulty = failingStatement(db, pattern, { skip: 1 });

    const { status } = await api("/api/accounts/checkpoints/statement-corrections/undo", { correctionIds: applied.payload.correctionIds }, { database: faulty.db });

    assert.equal(faulty.state.fired, true);
    assert.equal(status, 500);
    assertSameDatabase(await dumpDatabase(db), before);
    const undone = await api("/api/accounts/checkpoints/statement-corrections/undo", { correctionIds: applied.payload.correctionIds });
    assert.equal(undone.status, 200, JSON.stringify(undone.payload));
  });
}
