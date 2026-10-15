// StashAway statement imports: the commit's deposit, transfer link, closing
// value and remembered reference code, and the rollback that undoes them, are
// all-or-nothing. Each case makes one statement fail partway and proves the
// database is exactly what it was before.
import assert from "node:assert/strict";
import test from "node:test";

import {
  assertSameDatabase,
  createEntry,
  createSeededTemplate,
  dumpDatabase,
  failingStatement,
  openSeededDatabase,
  rows
} from "./support/d1-workspace.mjs";
import { parseSeptemberWithDeposit } from "./support/stashaway-fixtures.mjs";

let template;
test.before(async () => {
  template = await createSeededTemplate();
});
test.after(async () => {
  await template?.dispose();
});

async function seedImport(api) {
  await api("/api/accounts/create", { name: "OCBC 360", institution: "OCBC", kind: "bank", ownerPersonId: "person-tim", isJoint: false });
  const investment = await api("/api/accounts/create", { name: "Alex Sample Holder StashAway", institution: "StashAway", kind: "investment", ownerPersonId: "person-tim", isJoint: false });
  const paymentId = await createEntry(api, {
    accountName: "OCBC 360",
    date: "2026-09-01",
    description: "FAST PAYMENT STASHAWAY 00 XYZ00X",
    amountMinor: 50_000,
    categoryName: "Investments",
    ownerName: "Tim"
  });
  const parsed = parseSeptemberWithDeposit();
  const preview = await api("/api/imports/preview", {
    sourceLabel: parsed.sourceLabel,
    sourceType: "pdf",
    rows: parsed.rows,
    ownershipType: "direct",
    ownerName: "Tim",
    statementCheckpoints: parsed.checkpoints
  });
  assert.equal(preview.status, 200, JSON.stringify(preview.payload));
  assert.equal(preview.payload.preview.previewRows[0].transferMatch?.transactionId, paymentId);
  return {
    investmentId: investment.payload.accountId,
    paymentId,
    body: {
      sourceLabel: parsed.sourceLabel,
      sourceType: "pdf",
      parserKey: parsed.parserKey,
      rows: preview.payload.preview.previewRows,
      statementCheckpoints: parsed.checkpoints
    }
  };
}

test("a commit whose closing value cannot be saved leaves no import, deposit, link or paired bank entry", async (t) => {
  const { db, api } = await openSeededDatabase(t, template);
  const { body } = await seedImport(api);
  const before = await dumpDatabase(db);
  const faulty = failingStatement(db, /INSERT INTO investment_statement_values/);

  const { status, payload } = await api("/api/imports/commit", body, { database: faulty.db });

  assert.equal(faulty.state.fired, true);
  assert.equal(status, 400);
  assert.match(payload.error, /injected_failure_missing_table/);
  assertSameDatabase(await dumpDatabase(db), before);

  const retry = await api("/api/imports/commit", body);
  assert.equal(retry.payload.created, true);
});

test("a commit that fails while remembering the reference code leaves the value, deposit and link unsaved", async (t) => {
  const { db, api } = await openSeededDatabase(t, template);
  const { body, investmentId } = await seedImport(api);
  const before = await dumpDatabase(db);
  const faulty = failingStatement(db, /UPDATE accounts\s+SET last4 = \?/);

  const { status } = await api("/api/imports/commit", body, { database: faulty.db });

  assert.equal(faulty.state.fired, true);
  assert.equal(status, 400);
  assertSameDatabase(await dumpDatabase(db), before);
  assert.deepEqual(await rows(db, "SELECT last4 FROM accounts WHERE id = ?", investmentId), [{ last4: null }]);
});

test("a commit whose transfer link fails leaves the bank entry and the deposit untouched", async (t) => {
  const { db, api } = await openSeededDatabase(t, template);
  const { body, paymentId } = await seedImport(api);
  const before = await dumpDatabase(db);
  const faulty = failingStatement(db, /INSERT INTO import_transfer_links/);

  const { status } = await api("/api/imports/commit", body, { database: faulty.db });

  assert.equal(faulty.state.fired, true);
  assert.equal(status, 400);
  assertSameDatabase(await dumpDatabase(db), before);
  assert.deepEqual(await rows(db, "SELECT entry_type, transfer_group_id FROM transactions WHERE id = ?", paymentId), [{ entry_type: "expense", transfer_group_id: null }]);
});

test("a rollback that fails while removing the value leaves the committed import exactly as it was", async (t) => {
  const { db, api } = await openSeededDatabase(t, template);
  const { body } = await seedImport(api);
  const commit = await api("/api/imports/commit", body);
  assert.equal(commit.status, 200, JSON.stringify(commit.payload));
  const before = await dumpDatabase(db);
  const faulty = failingStatement(db, /DELETE FROM investment_statement_values/);

  const { status } = await api("/api/imports/rollback", { importId: commit.payload.importId }, { database: faulty.db });

  assert.equal(faulty.state.fired, true);
  assert.equal(status, 500);
  assertSameDatabase(await dumpDatabase(db), before);
});
