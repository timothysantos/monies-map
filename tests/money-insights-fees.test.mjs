// Money insights, "fees this year" (feesThisYear, summary-signals.ts): the
// exact words from the year's fees, when it may lead, and when it is quiet.
import assert from "node:assert/strict";
import test from "node:test";

import { buildBankFeesYear } from "../src/domain/bank-fees-year.ts";
import { FEES_REFUNDED_SENTENCE, feesThisYearSignal } from "../src/domain/money-signals/summary-signals.ts";
import { findAppJargon, findToneProblems } from "../src/domain/money-signals/tone.ts";

const money = (minor) => `${minor < 0 ? "-" : ""}$${(Math.abs(minor) / 100).toLocaleString("en-SG", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
let counter = 0;
const row = (accountId, date, description, amountMinor, extra = {}) => ({
  id: `f${(counter += 1)}`, accountId, accountKind: "credit_card", date, description, amountMinor, direction: "out", offsetsSpending: false, ...extra
});
const refund = (accountId, date, description, amountMinor) => row(accountId, date, description, amountMinor, { direction: "in", offsetsSpending: true });

// The design's example: a $100 late fee, $18.40 in interest, $8.00 in
// foreign currency fees, and a $196.20 annual fee refunded a week later.
const yearRows = () => [
  row("citi", "2026-04-18", "LATE PAYMENT CHARGE", 10_000),
  row("ocbc", "2026-06-02", "INTEREST CHARGES", 1_840),
  ...[150, 120, 180, 100, 130, 120].map((amount, index) => row("citi", `2026-0${index + 3}-11`, "CCY CONVERSION FEE", amount)),
  row("citi", "2026-03-02", "ANNUAL MEMBERSHIP FEE", 19_620),
  refund("citi", "2026-03-09", "ANNUALMEMBERFEEREV", 19_620)
];
const input = (fees, extra = {}) => ({
  audience: "household",
  viewLabel: "Household",
  today: "2026-11-10",
  focusMonth: "",
  months: [{ month: "2026-10" }, { month: "2026-11" }],
  categoryShareByMonth: [],
  accountPills: [],
  accountKinds: {},
  availableMonths: [],
  formatMoney: money,
  bankFeesYear: fees,
  ...extra
});

test("the line names each kind with fixed words and the refunded fee apart", () => {
  const fees = buildBankFeesYear("2026", yearRows());
  const signal = feesThisYearSignal(input(fees));
  assert.equal(signal.key, "fees-this-year:2026");
  assert.equal(signal.kind, "worth_a_look");
  assert.equal(signal.numbers.primaryMinor, 12_640);
  assert.deepEqual(signal.phrasings.map((phrasing) => phrasing.fact), [
    "You paid $126.40 in bank fees so far in 2026: a $100.00 late fee, $18.40 in interest and $8.00 in foreign currency fees. Another $196.20, an annual fee, was charged and then refunded, so it isn't counted.",
    "Bank fees came to $126.40 in 2026 so far: a $100.00 late fee, $18.40 in interest and $8.00 in foreign currency fees. Another $196.20, an annual fee, was charged and then refunded, so it isn't counted.",
    "So far in 2026, banks charged your accounts $126.40 in fees: a $100.00 late fee, $18.40 in interest and $8.00 in foreign currency fees. Another $196.20, an annual fee, was charged and then refunded, so it isn't counted.",
    "$126.40 went on bank fees in 2026, across 8 charges: a $100.00 late fee, $18.40 in interest and $8.00 in foreign currency fees. Another $196.20, an annual fee, was charged and then refunded, so it isn't counted."
  ]);
  assert.equal(signal.phrasings[0].thinks.length, 3);
  // November had no late fee, interest or annual fee: steady, on its turn.
  assert.equal(signal.steady, true);
  assert.equal(signal.turn, 1);
  assert.deepEqual(signal.action, { id: "show-entries", label: "Show those fees", entryIds: fees.ids, month: "2026-11", fromMonth: "2026-01" });
  for (const line of [FEES_REFUNDED_SENTENCE, ...signal.phrasings.map((phrasing) => phrasing.fact)]) {
    assert.deepEqual(findToneProblems(line), [], line);
    assert.deepEqual(findAppJargon(line), [], line);
  }
});

test("it may lead in a month a late fee was charged and in December; a person view names whose accounts", () => {
  const withNovemberFee = buildBankFeesYear("2026", [...yearRows(), row("citi", "2026-11-05", "LATE PAYMENT CHARGE", 10_000)]);
  assert.equal(feesThisYearSignal(input(withNovemberFee)).steady, false);
  const december = feesThisYearSignal(input(buildBankFeesYear("2026", yearRows()), { months: [{ month: "2026-12" }] }));
  assert.equal(december.steady, false);
  const tim = feesThisYearSignal(input(buildBankFeesYear("2026", yearRows()), { audience: "person", viewLabel: "Tim" }));
  assert.match(tim.phrasings[2].fact, /^So far in 2026, banks charged Tim's accounts \$126\.40 in fees/);
});

test("quiet under $20, quiet for foreign currency fees alone, and only under Also while the card's own line shows", () => {
  assert.equal(feesThisYearSignal(input(buildBankFeesYear("2026", [row("citi", "2026-04-18", "INTEREST CHARGES", 1_999)]))), null);
  assert.equal(feesThisYearSignal(input(buildBankFeesYear("2026", Array.from({ length: 30 }, (_, index) => row("citi", "2026-05-11", "CCY CONVERSION FEE", 100 + index))))), null);
  assert.equal(feesThisYearSignal(input(undefined)), null);
  const pills = [{ accountId: "citi", accountName: "Citi", unreversedCharges: [{ date: "2026-11-05", kind: "late_fee", amountMinor: 10_000 }] }];
  const withNovemberFee = buildBankFeesYear("2026", [...yearRows(), row("citi", "2026-11-05", "LATE PAYMENT CHARGE", 10_000)]);
  const signal = feesThisYearSignal(input(withNovemberFee, { accountPills: pills }));
  assert.equal(signal.steady, true);
  assert.equal(signal.turn, undefined);
});
