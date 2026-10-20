// Bank-match suggestions skip settled split records (owner approved,
// 2026-10-20). A record an active settlement checkpoint covers is settled and
// locked: it sits in a collapsed settled section, so suggesting it a bank row
// was noise, and scanning ~350 of them against every imported row in their
// date windows was ~2.1 s of the Splits page on the 10k fixture. A closed
// batch's records are still scanned: Settle group files its own settle-up
// record in the batch it closes, and that record waits for its transfer.
//
// The old scan is frozen in tests/support/split-match-candidates-before.ts.
// For every other record the new scan must suggest exactly what the old one
// did; for a settled record it must suggest nothing; and reopening or voiding
// the checkpoint must bring its records back.
import assert from "node:assert/strict";
import test from "node:test";

import { createSeededTemplate, openSeededDatabase } from "./support/d1-workspace.mjs";
import { seedSettledSplitHistory, SETTLED_HISTORY } from "./support/settled-split-history.mjs";
import { buildLargeHousehold } from "./support/large-household.mjs";
import { loadSplitMatchCandidatesBefore } from "./support/split-match-candidates-before.ts";
import { loadSplitMatchCandidates, reopenSplitSettlementCheckpoint } from "../src/domain/app-repository-splits.ts";

let template;
test.before(async () => {
  template = await createSeededTemplate();
});
test.after(async () => {
  await template?.dispose();
});

const MONTH = "2025-10";

// An imported bank row for every unlinked record of the production-shaped
// history, settled or open: the same date, amount and description for an
// expense, a same-amount transfer for a settle-up. Without them the old scan
// found nothing for the settled records, and the test would prove nothing.
async function addImportedTwins(db) {
  const account = (await db.prepare("SELECT id FROM accounts WHERE household_id = 'household-1' ORDER BY id LIMIT 1").first()).id;
  await db.batch([
    db.prepare(`INSERT INTO imports (id, household_id, source_type, source_label, parser_key, imported_at, status)
      VALUES ('smscan-import', 'household-1', 'csv', 'Twins statement', 'generic_csv', '2025-10-01T00:00:00Z', 'completed')`),
    db.prepare(`INSERT INTO transactions (id, household_id, import_id, account_id, transaction_date, description, amount_minor, currency, entry_type)
      SELECT 'twin-' || id, 'household-1', 'smscan-import', '${account}', expense_date, description || ' SG', total_amount_minor, 'SGD', 'expense'
      FROM split_expenses WHERE id LIKE 'prod-shape-exp-%' AND linked_transaction_id IS NULL`),
    db.prepare(`INSERT INTO transactions (id, household_id, import_id, account_id, transaction_date, description, amount_minor, currency, entry_type)
      SELECT 'twin-' || id, 'household-1', 'smscan-import', '${account}', settlement_date, 'PAYNOW TRANSFER', amount_minor, 'SGD', 'transfer'
      FROM split_settlements WHERE id LIKE 'prod-shape-set-%' AND linked_transaction_id IS NULL`)
  ]);
}

// Settled by a checkpoint, written out independently in SQL: covered by one
// that is not reopened or voided (the settlement lock's rule).
async function settledRecordIds(db) {
  const rows = await db.prepare(`
    SELECT items.record_id AS id FROM split_settlement_checkpoint_items AS items
    INNER JOIN split_settlement_checkpoints AS checkpoints ON checkpoints.id = items.checkpoint_id
    WHERE checkpoints.status NOT IN ('reopened', 'voided')
  `).all();
  return new Set(rows.results.map((row) => row.id));
}

async function compareWithOldScan(db) {
  const settled = await settledRecordIds(db);
  const before = (await loadSplitMatchCandidatesBefore(db, MONTH)).matches;
  const after = await loadSplitMatchCandidates(db, MONTH);
  return { settled, before, after, beforeOpen: before.filter((match) => !settled.has(match.splitRecordId)) };
}

test("open records get the old scan's suggestions, value for value; settled records get none", async (t) => {
  const { db, api } = await openSeededDatabase(t, template);
  await seedSettledSplitHistory(db);
  await addImportedTwins(db);
  const { settled, before, after, beforeOpen } = await compareWithOldScan(db);

  // The old scan suggested a bank row for most of the 352 settled records.
  const beforeSettled = before.filter((match) => settled.has(match.splitRecordId));
  assert.equal(beforeSettled.length, 178, "the old scan suggested every one of the 178 unlinked settled records");
  assert.ok(beforeSettled.some((match) => match.kind === "settlement"), "and settled settle-ups");

  assert.deepEqual(after.filter((match) => settled.has(match.splitRecordId)), [], "no suggestion for a settled record");
  assert.deepEqual(after, beforeOpen, "open records: the same suggestions, in the same order");
  // The 5 unlinked open records of the history and the demo seed's own 2.
  const openHistory = after.filter((match) => match.splitRecordId.startsWith("prod-shape-"));
  assert.deepEqual(openHistory.map((match) => match.splitRecordId).sort(), [
    "prod-shape-exp-0349", "prod-shape-exp-0351", "prod-shape-exp-0353", "prod-shape-exp-0355", "prod-shape-exp-0357"
  ]);
  assert.equal(openHistory[0].transactionId, `twin-${openHistory[0].splitRecordId}`);
  assert.ok(after.length >= openHistory.length + 2);

  // The pages that show them: the Splits page's Matches list and its count,
  // and the Imports page's count.
  for (const view of ["household", "person-tim", "person-joyce"]) {
    const page = (await api(`/api/splits-page?view=${view}&month=${MONTH}`)).payload.splitsPage;
    assert.deepEqual(page.matches.filter((match) => settled.has(match.splitRecordId)), [], `${view}: no settled record in Matches`);
    assert.equal(page.groups.reduce((sum, group) => sum + group.pendingMatchCount, 0), page.matches.length, `${view}: the count is the list`);
    if (view === "household") {
      assert.deepEqual(page.matches.map((match) => match.id), after.map((match) => match.id));
    }
  }
  assert.equal((await api("/api/imports-page")).payload.importsPage.pendingSplitMatchCount, after.length);
});

test("reopening or voiding the checkpoint brings its records' suggestions back", async (t) => {
  const { db } = await openSeededDatabase(t, template);
  await seedSettledSplitHistory(db);
  await addImportedTwins(db);
  const locked = await loadSplitMatchCandidates(db, MONTH);
  assert.equal(locked.filter((match) => match.splitRecordId.startsWith("prod-shape-")).length, 5);

  await reopenSplitSettlementCheckpoint(db, SETTLED_HISTORY.checkpointId);
  const reopened = await compareWithOldScan(db);
  assert.deepEqual([...reopened.settled].filter((id) => id.startsWith("prod-shape-")), [], "none of its records is settled once it is reopened");
  assert.deepEqual(reopened.after, reopened.beforeOpen, "its records are scanned again, as before");
  assert.ok(reopened.after.filter((match) => match.splitRecordId.startsWith("prod-shape-")).length >= 150);

  await db.prepare("UPDATE split_settlement_checkpoints SET status = 'matched' WHERE id = ?").bind(SETTLED_HISTORY.checkpointId).run();
  assert.deepEqual(await loadSplitMatchCandidates(db, MONTH), locked, "settled again: back to the open records only");
  await db.prepare("UPDATE split_settlement_checkpoints SET status = 'voided' WHERE id = ?").bind(SETTLED_HISTORY.checkpointId).run();
  assert.deepEqual(await loadSplitMatchCandidates(db, MONTH), reopened.after, "a voided checkpoint covers nothing");
});

// Settle group files its settle-up record in the batch it closes, and the
// bank transfer that pays it arrives later: that record (and the batch's
// expenses) keep their suggestions, as before.
test("a closed batch's records keep their suggestions: a group settle-up still waits for its transfer", async (t) => {
  const { db } = await openSeededDatabase(t, template);
  await seedSettledSplitHistory(db);
  await db.batch([
    db.prepare(`INSERT INTO split_batches (id, household_id, split_group_id, batch_name, opened_on, closed_on)
      VALUES ('smscan-batch', 'household-1', '${SETTLED_HISTORY.smallGroupId}', 'Settled flat costs', '2025-09-01', '2025-09-20')`),
    db.prepare("UPDATE split_expenses SET split_batch_id = 'smscan-batch' WHERE id IN ('prod-shape-exp-0349', 'prod-shape-exp-0351')"),
    db.prepare(`INSERT INTO split_settlements (id, household_id, split_group_id, split_batch_id, from_person_id, to_person_id, settlement_date, amount_minor, currency, payment_method, payment_status)
      VALUES ('prod-shape-set-batch', 'household-1', '${SETTLED_HISTORY.smallGroupId}', 'smscan-batch', 'person-joyce', 'person-tim', '2025-09-20', 4321, 'SGD', 'bank', 'awaiting_statement')`)
  ]);
  await addImportedTwins(db);
  const { settled, after, before } = await compareWithOldScan(db);
  assert.ok(!settled.has("prod-shape-set-batch"));
  assert.deepEqual(after, before.filter((match) => !settled.has(match.splitRecordId)));
  const suggested = after.map((match) => match.splitRecordId);
  for (const id of ["prod-shape-set-batch", "prod-shape-exp-0349", "prod-shape-exp-0351"]) {
    assert.ok(suggested.includes(id), `${id} is still suggested its bank row`);
  }
  assert.equal(after.find((match) => match.splitRecordId === "prod-shape-set-batch").transactionId, "twin-prod-shape-set-batch");
});

test("on the 10k-transaction household the open records' suggestions are unchanged", async (t) => {
  const { db } = await openSeededDatabase(t, template);
  await buildLargeHousehold(db);
  await seedSettledSplitHistory(db);
  await addImportedTwins(db);
  const { settled, before, after, beforeOpen } = await compareWithOldScan(db);
  assert.ok(before.filter((match) => settled.has(match.splitRecordId)).length >= 150);
  assert.deepEqual(after, beforeOpen);
  assert.ok(after.length >= 7);
});
