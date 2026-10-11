// The check-in's card bill and bank charge signals
// (src/domain/money-signals/shared-signals.ts), read from the account pills.
// Figures follow Joyce's OCBC 365 card (Oct 2026: $33.15 due 23 Oct; a $100
// late charge and $4.37 interest in Sept, not reversed) and her UOB One Card
// (a $196.20 annual fee on 31 Aug, not reversed).
import assert from "node:assert/strict";
import test from "node:test";

import { bankChargesSignal, cardBillSignal } from "../src/domain/money-signals/shared-signals.ts";
import { findToneProblems } from "../src/domain/money-signals/tone.ts";

const formatMoney = (minor) => `$${(minor / 100).toFixed(2)}`;
const ocbcBill = (extra = {}) => ({
  accountId: "ocbc",
  accountName: "OCBC 365 Credit Card",
  ownerLabel: "Joyce",
  cardBill: { statementMonth: "2026-10", statementEndDate: "2026-10-01", paymentDueDate: "2026-10-23", owedMinor: 3315, minimumMinor: 3315, paidSinceMinor: 0, ...extra }
});
const bill = (pills, today, audience = "household", viewLabel = "Household") => cardBillSignal({ accountPills: pills, audience, viewLabel, today, formatMoney });

function assertTone(signal) {
  for (const phrasing of signal.phrasings) {
    assert.deepEqual(findToneProblems(phrasing.fact), [], phrasing.fact);
    for (const think of phrasing.thinks) {
      assert.deepEqual(findToneProblems(think), [], think);
    }
  }
}

test("a card bill due within a week with no payment yet is a quick fix naming the card, amount and day", () => {
  const signal = bill([ocbcBill()], "2026-10-20");
  assert.equal(signal.kind, "quick_fix");
  assert.equal(signal.key, "card-bill:ocbc:2026-10");
  assert.equal(signal.primaryText, "$33.15");
  assert.equal(signal.phrasings[0].fact, "Joyce's OCBC 365 Credit Card bill of $33.15 is due in 3 days (Fri 23 Oct), with no payment to it recorded here yet.");
  assertTone(signal);
  // The person's own view says "your".
  assert.match(bill([ocbcBill()], "2026-10-23", "person", "Joyce").phrasings[0].fact, /^Your OCBC 365 Credit Card bill of \$33\.15 is due today/);
  assert.match(bill([ocbcBill()], "2026-10-22").phrasings[0].fact, /is due tomorrow/);
});

test("a part payment leaves the rest to pay; a full payment, or a bill more than a week away, says nothing", () => {
  const part = bill([ocbcBill({ paidSinceMinor: 1000 })], "2026-10-20");
  assert.equal(part.primaryText, "$23.15");
  assert.match(part.phrasings[0].fact, /\$23\.15 of Joyce's OCBC 365 Credit Card bill is still to pay/);
  assert.equal(bill([ocbcBill({ paidSinceMinor: 3315 })], "2026-10-20"), null);
  assert.equal(bill([ocbcBill()], "2026-10-12"), null);
  assert.equal(bill([{ accountId: "x", accountName: "X" }], "2026-10-20"), null);
});

test("an overdue bill with less than the minimum paid says so; one with the minimum paid does not", () => {
  const overdue = bill([ocbcBill()], "2026-10-26");
  assert.equal(overdue.kind, "quick_fix");
  assert.equal(overdue.phrasings[0].fact, "Joyce's OCBC 365 Credit Card bill was due on Fri 23 Oct, and $33.15 still shows as unpaid here.");
  assertTone(overdue);
  assert.equal(bill([ocbcBill({ owedMinor: 26434, minimumMinor: 5000, paidSinceMinor: 5000 })], "2026-10-26"), null);
  // An overdue bill comes before one that is only due.
  const both = bill([
    { ...ocbcBill(), accountId: "due", accountName: "Due Card", cardBill: { ...ocbcBill().cardBill, paymentDueDate: "2026-10-28" } },
    ocbcBill()
  ], "2026-10-26");
  assert.equal(both.key, "card-bill:ocbc:2026-10");
});

test("bank charges with no reversal in the last two months are worth a look, listed by kind", () => {
  const signal = bankChargesSignal({
    accountPills: [
      { accountId: "ocbc", accountName: "OCBC 365 Credit Card", ownerLabel: "Joyce", unreversedCharges: [
        { date: "2026-08-24", kind: "late_fee", amountMinor: 10000 },
        { date: "2026-09-01", kind: "interest", amountMinor: 437 }
      ] },
      { accountId: "uob", accountName: "UOB One Card", ownerLabel: "Joyce", unreversedCharges: [
        { date: "2026-08-31", kind: "annual_fee", amountMinor: 19620 }
      ] }
    ],
    audience: "household",
    viewLabel: "Household",
    today: "2026-10-12",
    formatMoney
  });
  assert.equal(signal.kind, "worth_a_look");
  // The largest total leads: the UOB annual fee.
  assert.equal(signal.key, "bank-charges:uob:2026-08-31");
  assert.equal(signal.phrasings[0].fact, "Joyce's UOB One Card was charged a $196.20 annual fee on Mon 31 Aug, and no refund of it shows here yet.");
  assertTone(signal);
});

test("several charges on one card are named together; charges older than two months say nothing", () => {
  const pills = [{ accountId: "ocbc", accountName: "OCBC 365 Credit Card", ownerLabel: "Joyce", unreversedCharges: [
    { date: "2026-08-24", kind: "late_fee", amountMinor: 10000 },
    { date: "2026-09-01", kind: "interest", amountMinor: 437 }
  ] }];
  const signal = bankChargesSignal({ accountPills: pills, audience: "household", viewLabel: "Household", today: "2026-10-12", formatMoney });
  assert.equal(signal.primaryText, "$104.37");
  assert.equal(signal.phrasings[0].fact, "Joyce's OCBC 365 Credit Card has been charged a $100.00 late charge and $4.37 interest since Mon 24 Aug, and no refund shows here yet.");
  assert.equal(bankChargesSignal({ accountPills: pills, audience: "household", viewLabel: "Household", today: "2026-11-05", formatMoney }), null);
});

test("a card on penalty interest with money owed is worth a look, naming the rate beside the amount", async () => {
  const { penaltyInterestSignal } = await import("../src/domain/money-signals/shared-signals.ts");
  const { findPercentWithoutMoney } = await import("../src/domain/money-signals/tone.ts");
  const pill = (owedMinor) => ({
    accountId: "ocbc",
    accountName: "OCBC 365 Credit Card",
    ownerLabel: "Joyce",
    cardNotices: { statementMonth: "2026-10", owedMinor, notices: [{ code: "penalty_interest", annualRatePercent: 30.78 }] }
  });
  const signal = penaltyInterestSignal({ accountPills: [pill(3315)], audience: "household", viewLabel: "Household", formatMoney });
  assert.equal(signal.kind, "worth_a_look");
  assert.equal(signal.key, "penalty-interest:ocbc:2026-10");
  assert.equal(signal.phrasings[0].fact, "Joyce's OCBC 365 Credit Card October bill shows $33.15 owed at a penalty interest rate of 30.78% a year.");
  assertTone(signal);
  for (const phrasing of signal.phrasings) {
    assert.deepEqual(findPercentWithoutMoney(phrasing.fact), [], phrasing.fact);
  }
  // Nothing owed, or only a past-due notice: nothing to say here.
  assert.equal(penaltyInterestSignal({ accountPills: [pill(0)], audience: "household", viewLabel: "Household", formatMoney }), null);
  assert.equal(penaltyInterestSignal({
    accountPills: [{ ...pill(3315), cardNotices: { statementMonth: "2026-10", owedMinor: 3315, notices: [{ code: "past_due" }] } }],
    audience: "household", viewLabel: "Household", formatMoney
  }), null);
});
