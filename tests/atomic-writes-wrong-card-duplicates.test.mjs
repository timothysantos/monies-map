// Removing wrong-card Apple Pay duplicates is all or nothing: the removal,
// each entry's saved copy, its audit event and the month refresh markers
// commit with the import in one batch, and the rollback's restore runs in
// the rollback's own batch. A failure at any statement changes nothing.
// Real local D1 (Miniflare) seeded with the demo household.
import assert from "node:assert/strict";
import test from "node:test";

import { assertSameDatabase, createSeededTemplate, dumpDatabase, failingStatement, openSeededDatabase, rows } from "./support/d1-workspace.mjs";
import {
  LADYS_FILE,
  ONE_CARD_FILE,
  commitBody,
  commitFile,
  createCards,
  previewFile,
  saveApplePayEntries
} from "./support/wrong-card-scenario.mjs";

let template;
test.before(async () => {
  template = await createSeededTemplate();
});
test.after(async () => {
  await template?.dispose();
});

const ONE_LABEL = "CC_TXN_History_14Oct2026-onecard";
const LADY_LABEL = "CC_TXN_History_13Oct2026-ladys";

async function readyToRemove(t) {
  const workspace = await openSeededDatabase(t, template);
  await createCards(workspace.api);
  const entryIds = await saveApplePayEntries(workspace);
  await commitFile(workspace.api, await previewFile(workspace.api, ONE_CARD_FILE, ONE_LABEL), ONE_LABEL);
  const preview = await previewFile(workspace.api, LADYS_FILE, LADY_LABEL);
  assert.equal(preview.wrongCardDuplicates.length, 3);
  return { ...workspace, entryIds, preview, body: commitBody(preview, LADY_LABEL, { remove: preview.wrongCardDuplicates }) };
}

const entryCount = async (db, entryIds) => (await rows(db, `SELECT COUNT(*) AS n FROM transactions WHERE id IN (${entryIds.map(() => "?").join(", ")})`, ...entryIds))[0].n;

// Each of the removal's own statements, then the commit's last ones.
const FAULTS = [
  ["the saved copy of the first entry", /INSERT INTO import_wrong_card_duplicates/, 0],
  ["the audit event of the second entry", /INSERT INTO audit_events[\s\S]*entry_removed_as_wrong_card_duplicate/, 1],
  ["the removal of the third entry", /DELETE FROM transactions\s+WHERE household_id = \? AND id = \? AND account_id = \? AND import_id IS NULL/, 2],
  ["the commit's own completed mark", /UPDATE imports\s+SET status = 'completed'/, 0]
];

for (const [name, pattern, skip] of FAULTS) {
  test(`a commit that fails at ${name} leaves every entry and the import unchanged`, async (t) => {
    const { db, api, body, entryIds } = await readyToRemove(t);
    const before = await dumpDatabase(db);
    const faulty = failingStatement(db, pattern, { skip });

    const { status } = await api("/api/imports/commit", body, { database: faulty.db });

    assert.equal(faulty.state.fired, true, "the fault was reached");
    assert.notEqual(status, 200);
    assertSameDatabase(await dumpDatabase(db), before);
    assert.equal(await entryCount(db, entryIds), 3);
    assert.deepEqual(await rows(db, "SELECT COUNT(*) AS n FROM import_wrong_card_duplicates"), [{ n: 0 }]);
  });
}

test("a rollback that fails partway leaves the entries removed and the import in place", async (t) => {
  const { db, api, body, entryIds } = await readyToRemove(t);
  const commit = await api("/api/imports/commit", body);
  assert.equal(commit.status, 200, JSON.stringify(commit.payload));
  assert.equal(await entryCount(db, entryIds), 0);
  const before = await dumpDatabase(db);
  const faulty = failingStatement(db, /UPDATE imports SET status = 'rolled_back'/);

  const { status } = await api("/api/imports/rollback", { importId: commit.payload.importId }, { database: faulty.db });

  assert.equal(faulty.state.fired, true);
  assert.equal(status, 500);
  assertSameDatabase(await dumpDatabase(db), before);
  assert.equal(await entryCount(db, entryIds), 0);
});

test("a rollback that fails while restoring the second entry restores none", async (t) => {
  const { db, api, body, entryIds } = await readyToRemove(t);
  const commit = await api("/api/imports/commit", body);
  assert.equal(commit.status, 200, JSON.stringify(commit.payload));
  const before = await dumpDatabase(db);
  const faulty = failingStatement(db, /INSERT OR IGNORE INTO transactions \(/, { skip: 1 });

  const { status } = await api("/api/imports/rollback", { importId: commit.payload.importId }, { database: faulty.db });

  assert.equal(faulty.state.fired, true);
  assert.equal(status, 500);
  assertSameDatabase(await dumpDatabase(db), before);
  assert.equal(await entryCount(db, entryIds), 0);
});

test("an entry confirmed by a statement after the preview stops the commit before anything is written", async (t) => {
  const { db, api, body, entryIds } = await readyToRemove(t);
  await db.prepare("UPDATE transactions SET bank_certification_status = 'statement_certified' WHERE id = ?").bind(entryIds[0]).run();

  const { status } = await api("/api/imports/commit", body);

  assert.equal(status, 400);
  assert.equal(await entryCount(db, entryIds), 3);
  assert.deepEqual(await rows(db, "SELECT COUNT(*) AS n FROM import_wrong_card_duplicates"), [{ n: 0 }]);
});

test("every removal statement is guarded: an entry that changes between the checks and the batch is left whole and unrecorded", async (t) => {
  const { db, body, entryIds, preview } = await readyToRemove(t);
  const { buildWrongCardDuplicateRemoval } = await import("../src/domain/import-wrong-card-duplicates.ts");
  const removal = await buildWrongCardDuplicateRemoval(db, "import-guard-check", {
    requests: body.wrongCardDuplicates,
    reviewedRows: preview.previewRows,
    committedRows: body.rows,
    sourceLabel: LADY_LABEL
  });
  assert.equal(removal.statements.length, 9);
  await db.prepare("INSERT OR IGNORE INTO imports (id, household_id, source_type, source_label, status) VALUES ('import-guard-check', 'household-1', 'csv', 'guard', 'completed')").run();
  // The first entry is linked to a split after the checks ran.
  const [expense] = await rows(db, "SELECT id FROM split_expenses WHERE linked_transaction_id IS NULL LIMIT 1");
  await db.prepare("UPDATE split_expenses SET linked_transaction_id = ? WHERE id = ?").bind(entryIds[0], expense.id).run();

  await db.batch(removal.statements);

  assert.equal(await entryCount(db, entryIds), 1, "only the entry that changed is left; the other two were still what was checked");
  assert.deepEqual((await rows(db, "SELECT transaction_id FROM import_wrong_card_duplicates")).map((row) => row.transaction_id).sort(), [entryIds[1], entryIds[2]].sort());
  assert.equal((await rows(db, "SELECT COUNT(*) AS n FROM audit_events WHERE action = 'entry_removed_as_wrong_card_duplicate'"))[0].n, 2);
  assert.equal((await rows(db, "SELECT COUNT(*) AS n FROM transactions WHERE id = ?", entryIds[0]))[0].n, 1);
});
