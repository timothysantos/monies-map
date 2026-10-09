import assert from "node:assert/strict";
import test from "node:test";

import { buildStatementRecovery, buildRecoveryImportRow } from "../src/client/import-statement-recovery-model.js";

const ETSY_LEFTOVER = {
  id: "leftover-amount-1-1478",
  evidence: "leftover-amount",
  row: { date: "2026-10-02", description: "Etsy WWW.ETSY.COM", expense: "", income: "", account: "HSBC Visa Revolution", category: "Other", note: "", type: "expense" },
  amountMinor: 2992,
  isCredit: false
};
const DCC_UNREAD = {
  id: "unread-amount-1-1564",
  evidence: "unread-amount",
  row: { date: "2026-10-03", description: "DCC FEE", expense: "", income: "", account: "HSBC Visa Revolution", category: "Other", note: "txn date: 2026-10-03", type: "expense" },
  isCredit: false
};

function expense(rowId, date, description, amountMinor, extra = {}) {
  return { rowId, date, description, amountMinor, entryType: "expense", ...extra };
}

const OCT_ROWS = [
  expense("r1", "2026-09-16", "KINOKUNIYA-TAKASHIMAYA SINGAPORE SG", 3495),
  expense("r2", "2026-09-19", "FAMILY-COM ELECTRONICS SINGAPORE SG", 9800),
  expense("r3", "2026-09-26", "I CREATIVE SALON LLP SINGAPORE SG", 3700),
  expense("r4", "2026-10-02", "Buyandship Limited Hong Kong HK", 1800),
  expense("r5", "2026-10-02", "DCC FEE", 18),
  expense("r6", "2026-10-03", "DCC FEE", 30)
];

test("no recovery when the parser reconciled the statement", () => {
  assert.equal(buildStatementRecovery({ reconciliation: undefined, previewRows: OCT_ROWS }), null);
});

test("a leftover amount equal to the live difference is offered; the check stays unbalanced", () => {
  const recovery = buildStatementRecovery({
    reconciliation: { expectedDebitMinor: 21835, expectedCreditMinor: 0, candidates: [ETSY_LEFTOVER] },
    previewRows: OCT_ROWS
  });
  assert.deepEqual(recovery.totals, [
    { isCredit: false, expectedMinor: 21835, foundMinor: 18843, differenceMinor: 2992 },
    { isCredit: true, expectedMinor: 0, foundMinor: 0, differenceMinor: 0 }
  ]);
  assert.equal(recovery.isBalanced, false);
  assert.deepEqual(recovery.offeredLeftovers.map((candidate) => candidate.id), [ETSY_LEFTOVER.id]);
  assert.deepEqual(recovery.unreadRows, []);
});

test("once the offered row is in the preview the check balances and nothing is offered", () => {
  const recovery = buildStatementRecovery({
    reconciliation: { expectedDebitMinor: 21835, expectedCreditMinor: 0, candidates: [ETSY_LEFTOVER] },
    previewRows: [...OCT_ROWS, expense("r7", "2026-10-02", "Etsy WWW.ETSY.COM", 2992)]
  });
  assert.equal(recovery.isBalanced, true);
  assert.deepEqual(recovery.offeredLeftovers, []);
});

test("a leftover is not offered while it differs from the difference; typing the unread amount makes it exact", () => {
  const reconciliation = { expectedDebitMinor: 21835, expectedCreditMinor: 0, candidates: [DCC_UNREAD, ETSY_LEFTOVER] };
  const withoutDcc = OCT_ROWS.filter((row) => row.rowId !== "r6");
  const before = buildStatementRecovery({ reconciliation, previewRows: withoutDcc });
  assert.equal(before.totals[0].differenceMinor, 3022);
  assert.deepEqual(before.offeredLeftovers, [], "29.92 is not 30.22");
  assert.deepEqual(before.unreadRows.map((candidate) => candidate.id), [DCC_UNREAD.id]);

  const after = buildStatementRecovery({ reconciliation, previewRows: [...withoutDcc, expense("r6", "2026-10-03", "DCC FEE", 30)] });
  assert.deepEqual(after.unreadRows, [], "the typed row is in the preview");
  assert.deepEqual(after.offeredLeftovers.map((candidate) => candidate.id), [ETSY_LEFTOVER.id]);
});

test("a corrected amount in the rows balances the check without any candidate", () => {
  const reconciliation = { expectedDebitMinor: 52370, expectedCreditMinor: 0, candidates: [] };
  const misread = buildStatementRecovery({ reconciliation, previewRows: [expense("m", "2026-08-08", "MOTHERCARE", 45900)] });
  assert.equal(misread.isBalanced, false);
  assert.equal(misread.totals[0].differenceMinor, 6470);
  const corrected = buildStatementRecovery({ reconciliation, previewRows: [expense("m", "2026-08-08", "MOTHERCARE", 52370)] });
  assert.equal(corrected.isBalanced, true);
});

test("payments count as credits; excluded rows still count toward the statement", () => {
  const recovery = buildStatementRecovery({
    reconciliation: { expectedDebitMinor: 52370, expectedCreditMinor: 52370, candidates: [] },
    previewRows: [
      expense("m", "2026-08-08", "MOTHERCARE", 45900),
      expense("i", "2026-08-17", "IKEA", 6470, { commitStatus: "skipped" }),
      { rowId: "p", date: "2026-09-02", description: "PAYMENT VIA UOB VISA DIRECT SG", amountMinor: 52370, entryType: "transfer", transferDirection: "in" }
    ]
  });
  assert.equal(recovery.isBalanced, true);
});

test("two leftovers of the same amount are not offered: the difference cannot say which", () => {
  const twin = { ...ETSY_LEFTOVER, id: "leftover-amount-1-1700", row: { ...ETSY_LEFTOVER.row, description: "Other" } };
  const recovery = buildStatementRecovery({
    reconciliation: { expectedDebitMinor: 21835, expectedCreditMinor: 0, candidates: [ETSY_LEFTOVER, twin] },
    previewRows: OCT_ROWS
  });
  assert.deepEqual(recovery.offeredLeftovers, []);
  assert.equal(recovery.isBalanced, false);
});

test("buildRecoveryImportRow fills the amount on the right side", () => {
  assert.deepEqual(buildRecoveryImportRow(ETSY_LEFTOVER, 2992), { ...ETSY_LEFTOVER.row, expense: "29.92", income: "" });
  const payment = { ...DCC_UNREAD, isCredit: true, row: { ...DCC_UNREAD.row, type: "transfer" } };
  assert.deepEqual(buildRecoveryImportRow(payment, 52370), { ...payment.row, expense: "", income: "523.70" });
  assert.throws(() => buildRecoveryImportRow(DCC_UNREAD, 0), /positive amount/);
});
