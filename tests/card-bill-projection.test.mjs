// Each card's latest bill and the bank charges no reversal cancelled
// (src/domain/card-bill-projection.ts), the facts the Summary and Month
// check-in reads from the account pills. Figures follow Joyce's OCBC 365
// card (Oct 2026 statement owes $33.15, due 23 Oct) and her UOB One Card
// (annual fee $196.20 on 31 Aug, not reversed).
import assert from "node:assert/strict";
import test from "node:test";

import { buildCardBillFacts } from "../src/domain/card-bill-projection.ts";

const card = (id, history, kind = "credit_card") => ({ id, kind, checkpointHistory: history });
const checkpoint = (month, endDate, balanceMinor, extra = {}) => ({
  month, statementEndDate: endDate, statementBalanceMinor: balanceMinor, computedBalanceMinor: balanceMinor, deltaMinor: 0, ...extra
});
const entry = (accountId, date, description, amountMinor, entryType = "expense", transferDirection = null) => ({
  id: `${accountId}:${date}:${description}`, account_id: accountId, transaction_date: date, post_date: null, description, amount_minor: amountMinor, entry_type: entryType, transfer_direction: transferDirection
});

test("a card's latest statement gives its bill, with the payments made to it since", () => {
  const facts = buildCardBillFacts({
    today: "2026-10-12",
    accounts: [card("ocbc", [
      checkpoint("2026-10", "2026-10-01", -3315, { paymentDueDate: "2026-10-23", minimumPaymentMinor: 3315 }),
      checkpoint("2026-09", "2026-09-01", -26434, { paymentDueDate: "2026-09-01" })
    ])],
    transactions: [
      // Paid before this statement: not a payment towards it.
      entry("ocbc", "2026-09-18", "PAYMENT - VISA DIRECT", 26434, "transfer", "in"),
      entry("ocbc", "2026-10-05", "PAYMENT - VISA DIRECT", 1000, "transfer", "in"),
      entry("ocbc", "2026-10-06", "CASH REBATE", 12, "income")
    ]
  });
  assert.deepEqual(facts.get("ocbc").cardBill, {
    statementMonth: "2026-10",
    statementEndDate: "2026-10-01",
    paymentDueDate: "2026-10-23",
    owedMinor: 3315,
    minimumMinor: 3315,
    paidSinceMinor: 1000
  });
});

test("no bill for a statement that owes nothing, has no due date, is long past, or is a bank account", () => {
  const facts = buildCardBillFacts({
    today: "2026-10-12",
    accounts: [
      card("in-credit", [checkpoint("2026-10", "2026-10-01", 1200, { paymentDueDate: "2026-10-23" })]),
      card("no-due", [checkpoint("2026-10", "2026-10-01", -5000)]),
      card("old", [checkpoint("2026-06", "2026-06-01", -5000, { paymentDueDate: "2026-06-23" })]),
      card("bank", [checkpoint("2026-10", "2026-10-01", -5000, { paymentDueDate: "2026-10-23" })], "bank")
    ],
    transactions: []
  });
  assert.deepEqual(["in-credit", "no-due", "old", "bank"].map((id) => facts.get(id)?.cardBill), [undefined, undefined, undefined, undefined]);
});

test("charges from the last four months with no reversal are listed per card; currency fees and reversed ones are not", () => {
  const facts = buildCardBillFacts({
    today: "2026-10-12",
    accounts: [card("ocbc", []), card("uob-joyce", []), card("uob-tim", [])],
    transactions: [
      entry("ocbc", "2026-08-24", "LATE CHARGE", 10000),
      entry("ocbc", "2026-09-01", "INTEREST CHARGE", 437),
      entry("uob-joyce", "2026-08-31", "CARD MEMBERSHIP FEE -INCLUSIVE OF GST", 19620),
      entry("uob-tim", "2026-08-31", "CARD MEMBERSHIP FEE -INCLUSIVE OF GST", 19620),
      entry("uob-tim", "2026-09-01", "CR CARD MEMBERSHIP FEE - INC OF GST", 19620, "income"),
      entry("uob-tim", "2026-09-20", "CCYCONVERSIONFEESGD13.39", 13),
      // Older than four months: not listed.
      entry("uob-tim", "2026-05-03", "LATE CHARGES", 10000)
    ]
  });
  assert.deepEqual(facts.get("ocbc").unreversedCharges, [
    { date: "2026-08-24", kind: "late_fee", amountMinor: 10000 },
    { date: "2026-09-01", kind: "interest", amountMinor: 437 }
  ]);
  assert.deepEqual(facts.get("uob-joyce").unreversedCharges, [{ date: "2026-08-31", kind: "annual_fee", amountMinor: 19620 }]);
  assert.equal(facts.get("uob-tim")?.unreversedCharges, undefined);
});
