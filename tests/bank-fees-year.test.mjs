// Bank fees this year (src/domain/bank-fees-year.ts): the year's card and
// bank account fees by kind, each refunded fee paired with its refund and
// left out of the total, through the existing classifiers only.
import assert from "node:assert/strict";
import test from "node:test";

import { buildBankFeesYear } from "../src/domain/bank-fees-year.ts";

let counter = 0;
const row = (accountId, date, description, amountMinor, extra = {}) => ({
  id: `f${(counter += 1)}`,
  accountId,
  accountKind: accountId.startsWith("bank") ? "bank" : "credit_card",
  date,
  description,
  amountMinor,
  direction: "out",
  offsetsSpending: false,
  ...extra
});
const refund = (accountId, date, description, amountMinor) => row(accountId, date, description, amountMinor, { direction: "in", offsetsSpending: true });

const fixture = () => [
  row("citi", "2026-04-18", "LATE PAYMENT CHARGE", 10_000),
  row("ocbc", "2026-06-02", "INTEREST CHARGES", 1_840),
  // UOB: a late charge refunded a week later.
  row("uob", "2026-05-20", "LATE CHARGE", 10_000),
  refund("uob", "2026-05-27", "CR LATE CHARGE", 10_000),
  // Citi's annual fee and its reversal.
  row("citi", "2026-03-02", "ANNUAL MEMBERSHIP FEE", 19_620),
  refund("citi", "2026-03-09", "ANNUALMEMBERFEEREV", 19_620),
  // Six small currency conversion fees, $8.00 in all.
  ...[150, 120, 180, 100, 130, 120].map((amount, index) => row("citi", `2026-0${index + 3}-11`, "CCY CONVERSION FEE", amount)),
  // A bank account's fall-below fee.
  row("bank-dbs", "2026-08-31", "FALL BELOW FEE", 0)
].filter((item) => item.amountMinor > 0);

test("the year's fees by kind, the refunded ones named apart and left out", () => {
  const fees = buildBankFeesYear("2026", fixture());
  assert.equal(fees.year, "2026");
  assert.equal(fees.netMinor, 10_000 + 1_840 + 800);
  assert.equal(fees.refundedMinor, 10_000 + 19_620);
  assert.deepEqual(fees.parts, [
    { kind: "late_fee", minor: 10_000, count: 1 },
    { kind: "interest", minor: 1_840, count: 1 },
    { kind: "fx_fee", minor: 800, count: 6 }
  ]);
  assert.deepEqual(fees.refundedParts, [
    { kind: "annual_fee", minor: 19_620, count: 1 },
    { kind: "late_fee", minor: 10_000, count: 1 }
  ]);
  assert.equal(fees.ids.length, 12);
});

test("a bank account's own charges count; shop names with 'fees' in them never do", () => {
  const fees = buildBankFeesYear("2026", [
    row("bank-dbs", "2026-08-31", "FALL BELOW FEE", 200),
    row("bank-dbs", "2026-09-02", "IBG SVC CHARGE GIRO RETURNED", 1_200),
    row("citi", "2026-05-01", "AMAZE*FEES SINGAPORE", 4_500),
    row("citi", "2026-05-02", "CABCHARGE ASIA PTE LTD", 2_300),
    row("citi", "2026-05-03", "NTUC FAIRPRICE", 8_000),
    // An account fee wording on a card is not a card fee.
    row("citi", "2026-05-04", "FALL BELOW FEE", 200)
  ]);
  assert.deepEqual(fees.parts, [
    { kind: "failed_payment", minor: 1_200, count: 1 },
    { kind: "account_fee", minor: 200, count: 1 }
  ]);
  assert.equal(fees.netMinor, 1_400);
});

test("a refund on another account, of another amount, or filed as income does not pair", () => {
  const fees = buildBankFeesYear("2026", [
    row("uob", "2026-05-20", "LATE CHARGE", 10_000),
    refund("citi", "2026-05-27", "CR LATE CHARGE", 10_000),
    row("ocbc", "2026-06-02", "INTEREST CHARGES", 1_840),
    refund("ocbc", "2026-06-09", "INTEREST REVERSAL", 1_000),
    row("dbs", "2026-07-02", "LATE CHARGE", 8_000),
    row("dbs", "2026-07-09", "LATE CHARGE REVERSAL", 8_000, { direction: "in", offsetsSpending: false })
  ]);
  assert.equal(fees.refundedMinor, 0);
  // A refund with nothing to pair still lowers the total, as it lowers Fees spending.
  assert.equal(fees.netMinor, 10_000 + 1_840 + 8_000 - 10_000 - 1_000);
  assert.equal(fees.ids.includes(fees.ids.at(-1)), true);
  assert.equal(fees.ids.length, 5, "the refund filed as income is not one of the year's rows");
});

test("the standing fees by the month they were charged, oldest first; refunded charges leave their month", () => {
  const fees = buildBankFeesYear("2026", fixture());
  assert.deepEqual(fees.months, [
    { month: "2026-03", minor: 150 },
    { month: "2026-04", minor: 10_120 },
    { month: "2026-05", minor: 180 },
    { month: "2026-06", minor: 1_940 },
    { month: "2026-07", minor: 130 },
    { month: "2026-08", minor: 120 }
  ]);
  // No fees at all: no months.
  assert.deepEqual(buildBankFeesYear("2026", []).months, []);
});
