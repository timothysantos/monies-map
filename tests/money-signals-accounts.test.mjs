// The bank-account signals (src/domain/money-signals/account-signals.ts),
// the trip still filed as Other (trip-signal.ts) and the settlement payment
// on Splits, worded from the facts a real household's 2026 produced
// (sanitised; see tests/account-routines.test.mjs for the facts themselves).
import assert from "node:assert/strict";
import test from "node:test";

import {
  accountChargesSignal,
  incomeMovedSignal,
  missedPaymentsSignal,
  ownTransferIncomeSignal,
  upcomingShortfallSignal
} from "../src/domain/money-signals/account-signals.ts";
import { rankSignals } from "../src/domain/money-signals/checkin.ts";
import { buildEntriesSignals, uncategorizedSignal } from "../src/domain/money-signals/entries-signals.ts";
import { settlementPaymentSignal } from "../src/domain/money-signals/splits-signals.ts";
import { findAppJargon, findToneProblems } from "../src/domain/money-signals/tone.ts";
import { tripInOtherSignal } from "../src/domain/money-signals/trip-signal.ts";

const formatMoney = (minor) => `$${(minor / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const ocbc = (facts) => ({ accountId: "acct-ocbc-360", accountName: "OCBC 360", ownerLabel: "Joyce", ...facts });
const uob = (facts) => ({ accountId: "acct-uob-one", accountName: "UOB One", ownerLabel: "Joyce", ...facts });
const household = (pills, today) => ({ accountPills: pills, audience: "household", viewLabel: "Household", today, formatMoney });
const joyceView = (pills, today) => ({ accountPills: pills, audience: "person", viewLabel: "Joyce", today, formatMoney });

function assertTone(signal) {
  for (const phrasing of signal.phrasings) {
    for (const line of [phrasing.fact, ...phrasing.thinks]) {
      assert.deepEqual(findToneProblems(line), [], line);
      assert.deepEqual(findAppJargon(line), [], line);
      assert.doesNotMatch(line, /\{\w+\}/, `unfilled token in: ${line}`);
    }
  }
}

const giros = [{ payee: "Ifast Financial", amountMinor: 100000 }, { payee: "Ifast Financial", amountMinor: 50000 }];
const movedOn23Aug = { payer: "Northwind", isSalary: true, toAccountId: "acct-uob-one", toAccountName: "UOB One", movedSince: "2026-07-23", payments: giros, statementEndDate: "2026-07-31", statementBalanceMinor: 222749 };

test("salary moved, payments didn't: a To do naming both accounts, the payments and the last balance", () => {
  const signal = incomeMovedSignal(household([ocbc({ incomeMoved: movedOn23Aug })], "2026-08-23"));
  assert.equal(signal.kind, "quick_fix");
  assert.equal(signal.key, "income-moved:acct-ocbc-360:2026-07-23");
  assert.equal(signal.phrasings[0].fact, "Joyce's salary has gone into UOB One since Thu 23 Jul, but OCBC 360 still pays $1,500.00 a month to Ifast Financial. It had $2,227.49 on Fri 31 Jul.");
  assert.equal(signal.phrasings[0].think, "When a payment's account runs low, the bank can't make it and charges for trying. Moving the payment, or topping the account up, clears it.");
  // One payee's monthly total is one amount: it "leaves", never "leave".
  assert.equal(signal.phrasings[1].fact, "Since Thu 23 Jul, Joyce's salary lands in UOB One, while $1,500.00 a month to Ifast Financial still leaves OCBC 360. It had $2,227.49 on Fri 31 Jul.");
  const twoPayees = incomeMovedSignal(household([ocbc({ incomeMoved: { ...movedOn23Aug, payments: [giros[0], { payee: "HDB", amountMinor: 84700 }] } })], "2026-08-23"));
  assert.match(twoPayees.phrasings[1].fact, /\$1,000\.00 to Ifast Financial and \$847\.00 to HDB a month still leave OCBC 360/);
  assertTone(signal);
  // Joyce's own view says "your"; income from someone else is named.
  assert.match(incomeMovedSignal(joyceView([ocbc({ incomeMoved: movedOn23Aug })], "2026-08-23")).phrasings[0].fact, /^Your salary has gone into UOB One/);
  assert.match(incomeMovedSignal(household([ocbc({ incomeMoved: { ...movedOn23Aug, isSalary: false, statementEndDate: undefined } })], "2026-08-23")).phrasings[0].fact, /^Joyce's income from Northwind has gone into UOB One since Thu 23 Jul, but OCBC 360 still pays \$1,500\.00 a month to Ifast Financial\.$/);
  assert.equal(incomeMovedSignal(household([ocbc({}), uob({})], "2026-08-23")), null);
});

test("a payment the bank couldn't make: names the payments, the day and the charge", () => {
  const missed = [
    { payee: "Ifast Financial", amountMinor: 100000, dueDate: "2026-09-04", chargeMinor: 1000 },
    { payee: "Ifast Financial", amountMinor: 50000, dueDate: "2026-09-04", chargeMinor: 1000 }
  ];
  const signal = missedPaymentsSignal(household([ocbc({ missedPayments: missed })], "2026-10-11"));
  assert.equal(signal.kind, "quick_fix");
  assert.equal(signal.phrasings[0].fact, "Joyce's Ifast Financial payments ($1,000.00 and $500.00) didn't go through on Fri 4 Sep. OCBC 360 charged $10.00 for each instead.");
  assert.equal(signal.phrasings[0].think, "September's $1,500.00 to Ifast Financial didn't go out. Paying it by hand catches up, if it's still wanted.");
  assertTone(signal);
  const one = missedPaymentsSignal(household([ocbc({ missedPayments: [missed[1]] })], "2026-10-11"));
  assert.equal(one.phrasings[0].fact, "Joyce's $500.00 payment to Ifast Financial didn't go through on Fri 4 Sep. OCBC 360 charged $10.00 instead.");
  // Older than 75 days, it has had its say.
  assert.equal(missedPaymentsSignal(household([ocbc({ missedPayments: missed })], "2026-11-20")), null);
});

test("bank-account charges: a failed payment's charge always counts; a $2 fee alone only after three months in a row", () => {
  const charges = [
    { date: "2026-07-31", kind: "account_fee", amountMinor: 200 },
    { date: "2026-08-31", kind: "account_fee", amountMinor: 200 },
    { date: "2026-09-04", kind: "failed_payment", amountMinor: 1000, payee: "Ifast Financial" },
    { date: "2026-09-04", kind: "failed_payment", amountMinor: 1000, payee: "Ifast Financial" },
    { date: "2026-09-30", kind: "account_fee", amountMinor: 200 }
  ];
  const signal = accountChargesSignal(household([ocbc({ accountCharges: charges })], "2026-10-11"));
  assert.equal(signal.kind, "worth_a_look");
  assert.equal(signal.phrasings[0].fact, "The bank charged Joyce's OCBC 360 $22.00 in September: two $10.00 charges for failed payments and its $2.00 monthly fee.");
  assert.ok(signal.phrasings[0].thinks.includes("OCBC 360's $2.00 monthly fee has come every month since July. Banks usually waive it while the balance stays above a minimum."));
  assertTone(signal);
  // One $2 fee says nothing; three in a row are worth knowing.
  assert.equal(accountChargesSignal(household([ocbc({ accountCharges: [charges[0]] })], "2026-08-10")), null);
  const fees = accountChargesSignal(household([ocbc({ accountCharges: charges.filter((charge) => charge.kind === "account_fee") })], "2026-10-11"));
  assert.equal(fees.phrasings[0].fact, "The bank has charged Joyce's OCBC 360 a $2.00 monthly fee every month since July.");
  assert.ok(fees.phrasings[0].thinks.includes("It's small, but it adds up to $24.00 a year."));
  assertTone(fees);
});

test("own money counted as income: names the amount, both accounts and links to both entries", () => {
  const item = { entryId: "txn-in", fromEntryId: "txn-out", date: "2026-09-26", fromDate: "2026-09-26", amountMinor: 500000, categoryName: "Other - Income", fromAccountName: "OCBC 360" };
  const signal = ownTransferIncomeSignal(household([uob({ ownTransfersAsIncome: [item] })], "2026-10-11"));
  assert.equal(signal.kind, "quick_fix");
  assert.equal(signal.phrasings[0].fact, "$5,000.00 into Joyce's UOB One on Sat 26 Sep is counted as other income, but it left Joyce's OCBC 360 the same day. It's money moving between Joyce's own accounts.");
  assert.deepEqual(signal.action, { id: "show-entries", label: "Show these entries", entryIds: ["txn-in", "txn-out"], month: "2026-09" });
  assertTone(signal);
  assert.match(ownTransferIncomeSignal(joyceView([uob({ ownTransfersAsIncome: [item] })], "2026-10-11")).phrasings[0].fact, /left your OCBC 360 the same day\. It's money moving between your own accounts\.$/);
  const several = ownTransferIncomeSignal(household([uob({ ownTransfersAsIncome: [item, { ...item, entryId: "txn-in-2", fromEntryId: "txn-out-2", date: "2026-08-12", fromDate: "2026-08-11", amountMinor: 100000, categoryName: "Salary" }] })], "2026-10-11"));
  assert.equal(several.phrasings[0].fact, "2 payments into Joyce's UOB One ($6,000.00) are counted as income, but each left Joyce's OCBC 360 within a few days. They're money moving between Joyce's own accounts.");
  // The link opens the newest month with that month's entries.
  assert.deepEqual(several.action.entryIds, ["txn-in", "txn-out"]);
});

test("the scheduled check, as it read on 23 Aug and as it reads on 11 Oct", () => {
  const aug = upcomingShortfallSignal(household([ocbc({
    upcomingShortfall: {
      statementEndDate: "2026-07-31",
      statementBalanceMinor: 222749,
      balanceMinor: 222749,
      payments: [
        { payee: "Ifast Financial", amountMinor: 50000, dueDate: "2026-08-03" },
        { payee: "Ifast Financial", amountMinor: 100000, dueDate: "2026-08-03" },
        { payee: "Ifast Financial", amountMinor: 50000, dueDate: "2026-09-03" },
        { payee: "Ifast Financial", amountMinor: 100000, dueDate: "2026-09-03" }
      ],
      shortMinor: 77251,
      firstShortDate: "2026-09-03"
    }
  })], "2026-08-23"));
  assert.equal(aug.kind, "quick_fix");
  assert.equal(aug.phrasings[0].fact, "Joyce's OCBC 360 had $2,227.49 on Fri 31 Jul. Its Ifast Financial payments take $1,500.00 around the 3rd, so August's leaves about $727.49 and September's won't fit.");
  assert.equal(aug.phrasings[0].think, "Based on the Fri 31 Jul statement and the payments that came from it each month before. A top-up, or moving the payments, clears it.");
  assertTone(aug);
  const oct = upcomingShortfallSignal(household([ocbc({
    upcomingShortfall: {
      statementEndDate: "2026-09-30",
      statementBalanceMinor: 10352,
      balanceMinor: 10352,
      payments: [
        { payee: "Ifast Financial", amountMinor: 50000, dueDate: "2026-10-03" },
        { payee: "Ifast Financial", amountMinor: 100000, dueDate: "2026-10-03" }
      ],
      shortMinor: 139648,
      firstShortDate: "2026-10-03"
    }
  })], "2026-10-11"));
  assert.equal(oct.phrasings[0].fact, "Joyce's OCBC 360 had $103.52 on Wed 30 Sep. Its Ifast Financial payments take $1,500.00 around the 3rd, so October's won't fit.");
  assert.equal(oct.phrasings[3].fact, "Going by the Wed 30 Sep statement, Joyce's OCBC 360 is $1,396.48 short for the Ifast Financial payments due by Sat 3 Oct.");
  assertTone(oct);
  assert.equal(upcomingShortfallSignal(household([ocbc({})], "2026-10-11")), null);
});

const trip = [
  ["2026-09-02", "(JOO)AEGYEONGTAUNSeoul KR", 14500],
  ["2026-09-02", "E-MARTYONGSANBR0947Seoul KR", 8658],
  ["2026-09-03", "I-PARK MALL CO.,LTD Seoul KRW 28,800.00", 2793],
  ["2026-09-04", "Lotte world mall(Maste Seoul KRW 257,400.00", 24948],
  ["2026-09-05", "LOTTEMATEU UEOLDEUTAUE Seoul KRW 109,960.00", 10727],
  ["2026-09-07", "SHINSEGAE DEPARTMENT S Seoul KRW 203,000.00", 19914]
].map(([date, description, amountMinor], index) => ({ id: `trip-${index}`, date, description, amountMinor, categoryName: "Other", entryType: "expense" }));

test("a trip still in Other: counts the purchases abroad, names the place and links to them", () => {
  const entries = [
    ...trip,
    // Food bought abroad already has a category; a purchase at home is not part of the trip.
    { id: "food", date: "2026-09-03", description: "KFCSeoul KR", amountMinor: 1355, categoryName: "Food & Drinks", entryType: "expense" },
    { id: "home", date: "2026-09-04", description: "GRAIN - SINGAPORE", amountMinor: 104095, categoryName: "Other", entryType: "expense" }
  ];
  const signal = tripInOtherSignal({ entries, formatMoney });
  assert.equal(signal.kind, "quick_fix");
  assert.equal(signal.phrasings[0].fact, "6 overseas purchases from 2–7 Sep ($815.40, Seoul) are in Other. Moving them to Travel shows what the trip cost.");
  assert.deepEqual(signal.action.entryIds, trip.map((entry) => entry.id));
  assertTone(signal);
  // Four purchases, or one day, is not a trip.
  assert.equal(tripInOtherSignal({ entries: trip.slice(0, 4), formatMoney }), null);
  assert.equal(tripInOtherSignal({ entries: trip.map((entry) => ({ ...entry, date: "2026-09-02" })), formatMoney }), null);
  // On Entries, the plain "entries in Other" line counts only what's left.
  const rest = uncategorizedSignal({ audience: "household", month: "2026-09", today: "2026-10-11", entries, formatMoney });
  assert.equal(rest.numbers.count, 1);
  assert.equal(rest.numbers.primaryMinor, 104095);
  // The trip leads Entries even when what's left in Other is more money; the
  // plain line waits under Also.
  const signals = buildEntriesSignals({ audience: "household", month: "2026-09", today: "2026-10-11", entries, formatMoney });
  const [lead] = rankSignals(signals, { signals: {} }, Date.parse("2026-10-11T04:00:00Z"), "2026-09");
  assert.equal(lead.key, "trip-in-other:2026-09-02:2026-09-07");
  assert.equal(signals.find((signal) => signal.key === "uncategorized").steady, true);
  // With no trip, the plain line is a normal To do again.
  const noTrip = buildEntriesSignals({ audience: "household", month: "2026-09", today: "2026-10-11", entries: entries.filter((entry) => !entry.id.startsWith("trip")), formatMoney });
  assert.equal(noTrip.find((signal) => signal.key === "uncategorized").steady, undefined);
});

test("a settlement payment waiting to be matched, and nothing once it's matched", () => {
  const checkpoint = {
    id: "split-checkpoint-1",
    fromPersonName: "Joyce",
    toPersonName: "Tim",
    settlementDate: "2026-08-27",
    paymentCandidate: { date: "2026-08-31", amountMinor: 708217, entryIds: ["txn-joyce", "txn-tim"], countedAsSpending: true }
  };
  const input = (checkpoints) => ({ audience: "household", viewId: "household", viewLabel: "Household", people: [], group: null, activity: [], pendingMatchCount: 0, settlementCheckpoints: checkpoints, today: "2026-10-11", formatMoney });
  const signal = settlementPaymentSignal(input([checkpoint]));
  assert.equal(signal.kind, "quick_fix");
  assert.equal(signal.phrasings[0].fact, "Joyce's $7,082.17 payment to Tim on Mon 31 Aug matches the Thu 27 Aug settlement. Matching it marks the settlement paid.");
  assert.equal(signal.phrasings[0].think, "Until it's matched, the payment counts as Joyce's spending and Tim's income.");
  assert.deepEqual(signal.action, { id: "show-entries", label: "Show the payment", entryIds: ["txn-joyce", "txn-tim"], month: "2026-08" });
  assertTone(signal);
  // Each person's own view talks to them.
  const tims = settlementPaymentSignal({ ...input([checkpoint]), audience: "person", viewLabel: "Tim" });
  assert.equal(tims.phrasings[1].fact, "The $7,082.17 Joyce paid you on Mon 31 Aug is the settlement from Thu 27 Aug, waiting to be matched.");
  assert.equal(tims.phrasings[0].think, "Until it's matched, the payment counts as Joyce's spending and your income.");
  const joyces = settlementPaymentSignal({ ...input([checkpoint]), audience: "person", viewLabel: "Joyce" });
  assert.equal(joyces.phrasings[0].fact, "Your $7,082.17 payment to Tim on Mon 31 Aug matches the Thu 27 Aug settlement. Matching it marks the settlement paid.");
  assertTone(tims);
  const linked = settlementPaymentSignal(input([{ ...checkpoint, paymentCandidate: { ...checkpoint.paymentCandidate, countedAsSpending: false } }]));
  assert.match(linked.phrasings[0].fact, /^Joyce's \$7,082\.17 transfer to Tim/);
  assert.equal(linked.phrasings[0].think, "Matching it under the settlement marks it paid.");
  assert.equal(settlementPaymentSignal(input([{ ...checkpoint, paymentCandidate: undefined }])), null);
});
