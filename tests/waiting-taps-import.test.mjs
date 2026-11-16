// Imports clear waiting taps silently (DOMAIN.md "Waiting Tap"): the bank's
// row for the purchase (same card, near day, same shop) becomes the entry and
// clears the tap in the import's own batch; a certified statement covering
// the tap's day without such a row clears it too (it was not a payment);
// anything else waits. Rolling the import back puts the tap back. Real
// Worker and real local D1 (demo household).
import assert from "node:assert/strict";
import test from "node:test";

import { holdWaitingTap } from "../src/domain/app-repository-waiting-taps.ts";
import { createSeededTemplate, openSeededDatabase, rows } from "./support/d1-workspace.mjs";

let template;
test.before(async () => {
  template = await createSeededTemplate();
});
test.after(async () => {
  await template?.dispose();
});

const statuses = (db) => rows(db, "SELECT merchant, status, cleared_by_import_id IS NOT NULL AS by_import FROM waiting_taps ORDER BY merchant");

async function holdOn(db, accountId, merchant, tapDate, requestId) {
  const held = await holdWaitingTap(db, { requestId, personId: "person-tim", accountId, merchant, walletName: "", tapDate, clientVersion: "apple-pay-api-2026-11-17-v8" });
  assert.equal(held.outcome, "held");
}

const csvRow = (overrides) => ({
  rowId: "r1", rowIndex: 0, date: "2026-10-08", description: "PERIPLUS BALI DENPASAR", amountMinor: 2294, entryType: "expense",
  accountName: "UOB One", categoryName: "Other", ownershipType: "direct", ownerName: "Tim", splitBasisPoints: 10000, rawRow: {}, ...overrides
});

test("an activity import's row for the purchase clears the tap; another shop's or a far day's does not; a rollback brings it back", async (t) => {
  const { db, api } = await openSeededDatabase(t, template);
  const [{ id: uobOne }] = await rows(db, "SELECT id FROM accounts WHERE account_name = 'UOB One'");
  await holdOn(db, uobOne, "Periplus Bali", "2026-10-05", "apple-pay-20261005120000000");
  await holdOn(db, uobOne, "Bintang Supermarket", "2026-10-05", "apple-pay-20261005130000000");
  await holdOn(db, uobOne, "Starbucks Seminyak", "2026-09-20", "apple-pay-20260920130000000");

  const commit = await api("/api/imports/commit", {
    sourceLabel: "UOB One activity", sourceType: "csv", parserKey: "generic_csv",
    rows: [
      // Posted three days after the tap: inside the posting-day room.
      csvRow({}),
      // Another shop on the tap's day: not this purchase.
      csvRow({ rowId: "r2", rowIndex: 1, date: "2026-10-05", description: "GRAB* A-9THL7", amountMinor: 1200 }),
      // The shop, but 8 days after the tap.
      csvRow({ rowId: "r3", rowIndex: 2, date: "2026-09-28", description: "STARBUCKS SEMINYAK", amountMinor: 650 })
    ]
  });

  assert.equal(commit.status, 200, JSON.stringify(commit.payload));
  assert.deepEqual(await statuses(db), [
    { merchant: "Bintang Supermarket", status: "waiting", by_import: 0 },
    { merchant: "Periplus Bali", status: "bank_row", by_import: 1 },
    { merchant: "Starbucks Seminyak", status: "waiting", by_import: 0 }
  ]);
  const [audit] = await rows(db, "SELECT action, detail FROM audit_events WHERE action = 'waiting_tap_cleared_by_import'");
  assert.equal(audit.detail, `A tap waiting for its amount was cleared: the bank's row for it was imported (${commit.payload.importId}).`);

  const rollback = await api("/api/imports/rollback", { importId: commit.payload.importId });
  assert.equal(rollback.status, 200, JSON.stringify(rollback.payload));
  assert.deepEqual((await statuses(db)).map((row) => row.status), ["waiting", "waiting", "waiting"]);
});

test("a certified statement clears a tap whose day it covers without its row, and its own row clears the tap it pays for", async (t) => {
  const { db, api } = await openSeededDatabase(t, template);
  const created = await api("/api/accounts/create", {
    name: "Tap Card", institution: "Synthetic Test Bank", kind: "credit_card", openingBalanceMinor: 0, currency: "SGD", ownerPersonId: "", isJoint: false
  });
  assert.equal(created.status, 200, JSON.stringify(created.payload));
  const accountId = created.payload.accountId;
  // Paid (the statement has its row) and not paid (no row in the period).
  await holdOn(db, accountId, "OpenAI", "2026-04-16", "apple-pay-20260416090000000");
  await holdOn(db, accountId, "Lazada", "2026-04-22", "apple-pay-20260422090000000");
  // After the statement closed: it stays.
  await holdOn(db, accountId, "Shopee", "2026-05-14", "apple-pay-20260514090000000");

  const statementCheckpoints = [{
    accountId, accountName: "Tap Card", detectedAccountName: "Tap Card", checkpointMonth: "2026-05",
    statementStartDate: "2026-04-13", statementEndDate: "2026-05-12", statementBalanceMinor: 734
  }];
  const preview = await api("/api/imports/preview", {
    sourceLabel: "Tap Card statement", sourceType: "pdf",
    rows: [{ date: "2026-04-17", description: "OPENAI OPENAI.COM USD 5.58", expense: "7.34", accountId, account: "Tap Card", category: "Other", note: "txn date: 2026-04-16" }],
    defaultAccountName: "Tap Card", ownershipType: "direct", ownerName: "Tim", statementCheckpoints
  });
  assert.equal(preview.status, 200, JSON.stringify(preview.payload));
  const previewRows = preview.payload.preview.previewRows;
  assert.equal(preview.payload.preview.statementReconciliations[0].deltaMinor, 0);

  const commit = await api("/api/imports/commit", {
    sourceLabel: "Tap Card statement", sourceType: "pdf", parserKey: "uob_credit_card_pdf",
    rows: previewRows.filter((row) => row.commitStatus === "included"),
    statementCheckpoints, statementControlRows: previewRows,
    statementReconciliations: preview.payload.preview.statementReconciliations
  });

  assert.equal(commit.status, 200, JSON.stringify(commit.payload));
  assert.deepEqual(await statuses(db), [
    { merchant: "Lazada", status: "statement_no_match", by_import: 1 },
    { merchant: "OpenAI", status: "bank_row", by_import: 1 },
    { merchant: "Shopee", status: "waiting", by_import: 0 }
  ]);
  const page = await api("/api/entries-page?view=household&month=2026-05");
  assert.deepEqual(page.payload.waitingTaps.map((item) => item.merchant), ["Shopee"]);
});
