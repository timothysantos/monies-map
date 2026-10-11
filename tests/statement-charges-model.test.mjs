// What a statement card says about the bank's charges and the payment it
// asks for (src/client/statement-charges-model.js). Rows follow Joyce's OCBC
// 365 Sept 2026 statement and Tim's UOB One Card Aug 2026 statement.
import assert from "node:assert/strict";
import test from "node:test";

import { describePaymentDue, summarizeStatementCharges } from "../src/client/statement-charges-model.js";

const row = (description, amountMinor, entryType = "expense") => ({ description, amountMinor, entryType });

test("a statement's late charge and interest are totalled by kind, with the bank's notices", () => {
  const summary = summarizeStatementCharges([
    row("CASH REBATE", 25, "income"),
    row("LATE CHARGE", 10000),
    row("SHOPEE SG MP", 4034),
    row("INTEREST CHARGE", 437)
  ], [{ code: "past_due" }]);
  assert.deepEqual(summary, {
    charges: [{ kind: "late_fee", amountMinor: 10000 }, { kind: "interest", amountMinor: 437 }],
    reversals: [],
    notices: [{ code: "past_due" }],
    hasAnything: true
  });
});

test("a reversed annual fee shows as charged and reversed; currency fees and payments are not charges", () => {
  const summary = summarizeStatementCharges([
    row("CARD MEMBERSHIP FEE -INCLUSIVE OF GST", 19620),
    row("CR CARD MEMBERSHIP FEE - INC OF GST", 19620, "income"),
    row("CCYCONVERSIONFEESGD13.39", 13),
    row("PAYMENT - VISA DIRECT", 26434, "transfer")
  ]);
  assert.deepEqual([summary.charges, summary.reversals], [
    [{ kind: "annual_fee", amountMinor: 19620 }],
    [{ kind: "annual_fee", amountMinor: 19620 }]
  ]);
});

test("a statement with only purchases and currency fees has nothing to say", () => {
  const summary = summarizeStatementCharges([row("SHOPEE SG MP", 2928), row("CCYCONVERSIONFEESGD5.00", 5)], [{ code: "made_up" }]);
  assert.equal(summary.hasAnything, false);
});

test("a card statement that asks for money says how much and by when; one owing nothing says nothing", () => {
  assert.deepEqual(describePaymentDue({
    accountKind: "credit_card", statementBalanceMinor: -3315, paymentDueDate: "2026-10-23", statementEndDate: "2026-10-01", minimumPaymentMinor: 3315
  }), { owedMinor: 3315, dueDate: "2026-10-23", isDueNow: false, minimumMinor: 3315 });
  // OCBC printed "IMMEDIATE": the due date is the statement date.
  assert.deepEqual(describePaymentDue({
    accountKind: "credit_card", statementBalanceMinor: -26434, paymentDueDate: "2026-09-01", statementEndDate: "2026-09-01"
  }), { owedMinor: 26434, dueDate: "2026-09-01", isDueNow: true });
  assert.equal(describePaymentDue({ accountKind: "credit_card", statementBalanceMinor: 1200, paymentDueDate: "2026-10-23" }), null);
  assert.equal(describePaymentDue({ accountKind: "credit_card", statementBalanceMinor: -3315 }), null);
  assert.equal(describePaymentDue({ accountKind: "bank", statementBalanceMinor: -3315, paymentDueDate: "2026-10-23" }), null);
});
