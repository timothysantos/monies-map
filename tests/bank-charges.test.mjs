// Bank charges on a card statement (src/domain/bank-charges.ts): late
// charges, interest, annual fees and currency fees, and the reversals banks
// post when they waive one. The descriptions are the ones real OCBC, UOB,
// Citi and HSBC statements print (Citi glues words together).
import assert from "node:assert/strict";
import test from "node:test";

import { classifyBankCharge, findUnreversedBankCharges } from "../src/domain/bank-charges.ts";

const facts = (description) => {
  const charge = classifyBankCharge(description);
  return charge ? [charge.kind, charge.isReversal] : null;
};

test("charges are recognised by kind on every bank's wording", () => {
  assert.deepEqual(facts("LATE CHARGE"), ["late_fee", false]);
  assert.deepEqual(facts("LATE CHARGES"), ["late_fee", false]);
  assert.deepEqual(facts("LATECHARGEFEE"), ["late_fee", false]);
  assert.deepEqual(facts("LATE PAYMENT FEE"), ["late_fee", false]);
  assert.deepEqual(facts("INTEREST CHARGE"), ["interest", false]);
  assert.deepEqual(facts("INTERESTS"), ["interest", false]);
  assert.deepEqual(facts("FINANCE CHARGE"), ["interest", false]);
  assert.deepEqual(facts("ANNUALMEMBERSHIPFEE"), ["annual_fee", false]);
  assert.deepEqual(facts("GSTONANNUALMEMBERSHIPFEE"), ["annual_fee", false]);
  assert.deepEqual(facts("CARD MEMBERSHIP FEE -INCLUSIVE OF GST"), ["annual_fee", false]);
  assert.deepEqual(facts("ANNUAL FEE"), ["annual_fee", false]);
  assert.deepEqual(facts("CCYCONVERSIONFEESGD13.39"), ["fx_fee", false]);
  assert.deepEqual(facts("DCC FEE"), ["fx_fee", false]);
  assert.deepEqual(facts("OVERLIMIT FEE"), ["other_fee", false]);
  assert.deepEqual(facts("CASH ADVANCE FEE"), ["other_fee", false]);
});

test("reversals of a charge are recognised as reversals of the same kind", () => {
  assert.deepEqual(facts("CR LATE CHARGE"), ["late_fee", true]);
  assert.deepEqual(facts("AUTOLATEFEEREVERSAL"), ["late_fee", true]);
  assert.deepEqual(facts("CR INTEREST"), ["interest", true]);
  assert.deepEqual(facts("INTEREST REVERSAL"), ["interest", true]);
  assert.deepEqual(facts("ANNUALMEMBERFEEREV"), ["annual_fee", true]);
  assert.deepEqual(facts("GSTONMEMBERSHIPFEEREVERSAL"), ["annual_fee", true]);
  assert.deepEqual(facts("CR CARD MEMBERSHIP FEE - INC OF GST"), ["annual_fee", true]);
  assert.deepEqual(facts("LATE CHARGE WAIVER"), ["late_fee", true]);
});

test("shops and payments whose names only contain the words are not charges", () => {
  for (const description of [
    "AMAZE*FEES",
    "THE COFFEE BEAN-GWC SINGAPORE",
    "Cabcharge Asia Pte Ltd SINGAPORE",
    "Grab* 0-C8CFEE3DA3DWRJ Singapore",
    "EzypaySGD*KX Pilates R Singapore",
    "PAYMENT - VISA DIRECT",
    "CASH REBATE",
    "INTEREST CREDIT",
    "BONUS INTEREST",
    ""
  ]) {
    assert.equal(classifyBankCharge(description), null, description);
  }
});

// Joyce's OCBC 365 card and her UOB One Card, Aug–Sept 2026: the late charge,
// interest and the UOB annual fee were never reversed. Tim's UOB One Card
// annual fee was reversed the next day, and his Citi Miles fee (with its GST)
// two weeks later.
test("charges with no reversal of the same kind and amount on the same account are listed, oldest first", () => {
  const entries = [
    { id: "a", accountId: "ocbc", date: "2026-08-24", description: "LATE CHARGE", amountMinor: 10000, direction: "out" },
    { id: "b", accountId: "ocbc", date: "2026-09-01", description: "INTEREST CHARGE", amountMinor: 437, direction: "out" },
    { id: "c", accountId: "uob-joyce", date: "2026-08-31", description: "CARD MEMBERSHIP FEE -INCLUSIVE OF GST", amountMinor: 19620, direction: "out" },
    { id: "d", accountId: "uob-tim", date: "2026-08-31", description: "CARD MEMBERSHIP FEE -INCLUSIVE OF GST", amountMinor: 19620, direction: "out" },
    { id: "e", accountId: "uob-tim", date: "2026-09-01", description: "CR CARD MEMBERSHIP FEE - INC OF GST", amountMinor: 19620, direction: "in" },
    { id: "f", accountId: "citi", date: "2026-08-11", description: "ANNUALMEMBERSHIPFEE", amountMinor: 18000, direction: "out" },
    { id: "g", accountId: "citi", date: "2026-08-11", description: "GSTONANNUALMEMBERSHIPFEE", amountMinor: 1620, direction: "out" },
    { id: "h", accountId: "citi", date: "2026-08-26", description: "ANNUALMEMBERFEEREV", amountMinor: 18000, direction: "in" },
    { id: "i", accountId: "citi", date: "2026-08-26", description: "GSTONMEMBERSHIPFEEREVERSAL", amountMinor: 1620, direction: "in" },
    // A currency fee is the cost of a foreign purchase, not a charge to chase.
    { id: "j", accountId: "citi", date: "2026-08-20", description: "CCYCONVERSIONFEESGD13.39", amountMinor: 13, direction: "out" },
    // A reversal on another account does not cancel this one.
    { id: "k", accountId: "uob-joyce", date: "2026-09-01", description: "CR LATE CHARGE", amountMinor: 10000, direction: "in" }
  ];
  const unreversed = findUnreversedBankCharges(entries);
  assert.deepEqual(unreversed.map((item) => [item.id, item.accountId, item.kind, item.amountMinor]), [
    ["a", "ocbc", "late_fee", 10000],
    ["c", "uob-joyce", "annual_fee", 19620],
    ["b", "ocbc", "interest", 437]
  ]);
});

test("one reversal cancels one charge, and a reversal before the charge does not count", () => {
  const entries = [
    { id: "a", accountId: "uob", date: "2026-06-03", description: "LATE CHARGES", amountMinor: 10000, direction: "out" },
    { id: "b", accountId: "uob", date: "2026-07-03", description: "LATE CHARGES", amountMinor: 10000, direction: "out" },
    { id: "c", accountId: "uob", date: "2026-06-05", description: "CR LATE CHARGE", amountMinor: 10000, direction: "in" },
    { id: "d", accountId: "uob", date: "2026-05-01", description: "CR INTEREST", amountMinor: 500, direction: "in" },
    { id: "e", accountId: "uob", date: "2026-06-12", description: "INTERESTS", amountMinor: 500, direction: "out" }
  ];
  // Oldest first.
  assert.deepEqual(findUnreversedBankCharges(entries).map((item) => item.id), ["e", "b"]);
});
