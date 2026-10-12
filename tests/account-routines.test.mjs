// What a bank account does every month and what changed (src/domain/account-routines.ts).
// The fixture follows a real household's 2026 (names and references
// sanitised): a salary that moved from an OCBC 360 to a UOB One on 23 Jul,
// two investment GIROs ($1,000 and $500 around the 3rd) left on the OCBC
// 360, its statements closing at $2,227.49 (31 Jul), $125.52 (31 Aug) and
// $103.52 (30 Sep), both GIROs failing on 4 Sep with a $10 charge each, a $2
// monthly fee from July, and a $5,000 transfer between the owner's own
// accounts counted as income.
import assert from "node:assert/strict";
import test from "node:test";

import { buildAccountRoutineFacts, classifyAccountCharge, payeeName } from "../src/domain/account-routines.ts";

const OCBC = "acct-ocbc-360";
const UOB = "acct-uob-one";
const CARD = "acct-uob-card";
const TIM_BANK = "acct-tim-uob";

const checkpoint = (month, end, balanceMinor) => ({ month, statementEndDate: end, statementBalanceMinor: balanceMinor, computedBalanceMinor: balanceMinor, deltaMinor: 0 });
const OCBC_CHECKPOINTS = [
  checkpoint("2026-05", "2026-05-31", 2319099),
  checkpoint("2026-06", "2026-06-30", 509228),
  checkpoint("2026-07", "2026-07-31", 222749),
  checkpoint("2026-08", "2026-08-31", 12552),
  checkpoint("2026-09", "2026-09-30", 10352)
];

function accounts(throughMonth = "2026-09") {
  return [
    { id: OCBC, name: "OCBC 360", kind: "bank", ownerPersonId: "joyce", checkpointHistory: OCBC_CHECKPOINTS.filter((item) => item.month <= throughMonth) },
    { id: UOB, name: "UOB One", kind: "bank", ownerPersonId: "joyce", checkpointHistory: [] },
    { id: CARD, name: "UOB One Card", kind: "credit_card", ownerPersonId: "joyce", checkpointHistory: [] },
    { id: TIM_BANK, name: "UOB One", kind: "bank", ownerPersonId: "tim", checkpointHistory: [] }
  ];
}

let seq = 0;
function row(account, date, description, amountMinor, entryType = "expense", extra = {}) {
  seq += 1;
  return {
    id: `txn-${seq}`,
    account_id: account,
    transaction_date: date,
    description,
    amount_minor: amountMinor,
    entry_type: entryType,
    transfer_direction: null,
    transfer_group_id: null,
    category_name: entryType === "income" ? "Salary" : "Other",
    ...extra
  };
}

const PAY_OCBC = "IBG GIRO SALA NORTHWIND PTE LTD SALARY TRANSACTIO";
const PAY_UOB = "GIRO - SALARY SALA NORTHWIND PTE LTD SALARY TRANS";
const GIRO_1000 = "IBG GIRO COLL P0000192 IFAST FINANCIAL PL- P0000192";
const GIRO_500 = "IBG GIRO COLL P0000194 IFAST FINANCIAL PL- P0000194";

// Everything recorded by 23 Aug: the OCBC 360 up to its July statement, and
// the July salary already in the UOB One.
function rowsSeenOn23Aug() {
  return [
    row(OCBC, "2026-03-25", PAY_OCBC, 833185, "income"),
    row(OCBC, "2026-04-23", PAY_OCBC, 833185, "income"),
    row(OCBC, "2026-05-22", PAY_OCBC, 833185, "income"),
    row(OCBC, "2026-06-03", GIRO_1000, 100000, "expense", { category_name: "Investments" }),
    row(OCBC, "2026-06-03", GIRO_500, 50000, "expense", { category_name: "Investments" }),
    row(OCBC, "2026-06-24", PAY_OCBC, 833185, "income"),
    row(OCBC, "2026-07-03", GIRO_1000, 100000, "expense", { category_name: "Investments" }),
    row(OCBC, "2026-07-03", GIRO_500, 50000, "expense", { category_name: "Investments" }),
    row(OCBC, "2026-07-31", "SERVICE CHARGE", 200, "expense", { category_name: "Fees" }),
    row(UOB, "2026-07-23", PAY_UOB, 833185, "income"),
    // A card's charges belong to the card bill signals, never here.
    row(CARD, "2026-07-20", "SERVICE CHARGE", 200, "expense"),
    // Another person's regular church gift stays out of it.
    row(TIM_BANK, "2026-06-01", "PAYNOW-FAST GRACE COMMUNITY CHURCH OTHR", 76200),
    row(TIM_BANK, "2026-07-01", "PAYNOW-FAST GRACE COMMUNITY CHURCH OTHR", 76200)
  ];
}

// Everything recorded by 11 Oct: August and September for both accounts.
function rowsSeenOn11Oct() {
  return [
    ...rowsSeenOn23Aug(),
    row(OCBC, "2026-08-05", GIRO_1000, 100000, "expense", { category_name: "Investments" }),
    row(OCBC, "2026-08-05", GIRO_500, 50000, "expense", { category_name: "Investments" }),
    row(OCBC, "2026-08-27", "CASH WITHDRAWAL ATM VIA QR CODE OCBC-GREAT WORLD SINGAPORE", 100000),
    row(OCBC, "2026-08-27", "PAYMENT/TRANSFER DBSS from J DOE OTHR Transfer", 40000, "transfer", { transfer_direction: "in" }),
    row(OCBC, "2026-08-31", "SERVICE CHARGE", 200, "expense", { category_name: "Fees" }),
    row(OCBC, "2026-09-04", "IBG SVC CHARGE IFAST FINANCIAL PL-", 1000, "expense", { category_name: "Investments" }),
    row(OCBC, "2026-09-04", "IBG SVC CHARGE IFAST FINANCIAL PL-", 1000, "expense", { category_name: "Investments" }),
    row(OCBC, "2026-09-26", "FAST PAYMENT via PayNow-Mobile to J DOE", 500000, "transfer", { transfer_direction: "out" }),
    row(OCBC, "2026-09-30", "SERVICE CHARGE", 200, "expense", { category_name: "Fees" }),
    row(UOB, "2026-08-24", PAY_UOB, 833185, "income"),
    row(UOB, "2026-09-24", PAY_UOB, 833185, "income"),
    row(UOB, "2026-09-26", "PAYNOW-FAST PAYNOW OTHR J DOE OTHR", 500000, "income", { category_name: "Other - Income" })
  ];
}

test("bank descriptions read as the payee's name, and bank-account charges are recognised", () => {
  assert.equal(payeeName(GIRO_1000), "Ifast Financial");
  assert.equal(payeeName(PAY_UOB), "Northwind");
  assert.equal(classifyAccountCharge("IBG SVC CHARGE IFAST FINANCIAL PL-"), "failed_payment");
  assert.equal(classifyAccountCharge("SERVICE CHARGE"), "account_fee");
  assert.equal(classifyAccountCharge("FALL BELOW FEE"), "account_fee");
  // A shop with "charge" in its name, or a card's own fee wording, is not one.
  assert.equal(classifyAccountCharge("CHARGEPLUS EV SINGAPORE"), null);
  assert.equal(classifyAccountCharge("GIRO SERVICE CHARGE REFUND PROMO"), null);
});

test("on 23 Aug: the salary has moved, the GIROs haven't, and September's won't fit", () => {
  const facts = buildAccountRoutineFacts({ accounts: accounts("2026-07"), transactions: rowsSeenOn23Aug(), today: "2026-08-23" });
  const ocbc = facts.get(OCBC);
  assert.deepEqual(ocbc.incomeMoved, {
    payer: "Northwind",
    isSalary: true,
    toAccountId: UOB,
    toAccountName: "UOB One",
    movedSince: "2026-07-23",
    payments: [{ payee: "Ifast Financial", amountMinor: 100000 }, { payee: "Ifast Financial", amountMinor: 50000 }],
    statementEndDate: "2026-07-31",
    statementBalanceMinor: 222749
  });
  assert.deepEqual(ocbc.upcomingShortfall, {
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
  });
  assert.deepEqual(ocbc.accountCharges, [{ date: "2026-07-31", kind: "account_fee", amountMinor: 200 }]);
  assert.equal(ocbc.missedPayments, undefined);
  // The UOB One, the card and the other person's account have nothing to say.
  assert.equal(facts.get(UOB), undefined);
  assert.equal(facts.get(CARD), undefined);
  assert.equal(facts.get(TIM_BANK), undefined);
});

test("on 11 Oct: both GIROs failed on 4 Sep, the charges add up, October's won't fit, and own money counts as income", () => {
  const facts = buildAccountRoutineFacts({ accounts: accounts(), transactions: rowsSeenOn11Oct(), today: "2026-10-11" });
  const ocbc = facts.get(OCBC);
  assert.deepEqual(ocbc.missedPayments, [
    { payee: "Ifast Financial", amountMinor: 100000, dueDate: "2026-09-04", chargeMinor: 1000 },
    { payee: "Ifast Financial", amountMinor: 50000, dueDate: "2026-09-04", chargeMinor: 1000 }
  ]);
  assert.deepEqual(ocbc.accountCharges.map((charge) => `${charge.date} ${charge.kind} ${charge.amountMinor}`), [
    "2026-07-31 account_fee 200",
    "2026-08-31 account_fee 200",
    "2026-09-04 failed_payment 1000",
    "2026-09-04 failed_payment 1000",
    "2026-09-30 account_fee 200"
  ]);
  assert.equal(ocbc.upcomingShortfall.statementEndDate, "2026-09-30");
  assert.equal(ocbc.upcomingShortfall.balanceMinor, 10352);
  assert.equal(ocbc.upcomingShortfall.firstShortDate, "2026-10-03");
  assert.equal(ocbc.upcomingShortfall.shortMinor, 139648);
  assert.equal(ocbc.incomeMoved.statementBalanceMinor, 10352);
  const own = facts.get(UOB).ownTransfersAsIncome;
  assert.equal(own.length, 1);
  assert.deepEqual({ ...own[0], entryId: undefined, fromEntryId: undefined }, {
    entryId: undefined,
    fromEntryId: undefined,
    date: "2026-09-26",
    fromDate: "2026-09-26",
    amountMinor: 500000,
    categoryName: "Other - Income",
    fromAccountName: "OCBC 360"
  });
});

test("a payment that simply stops, with no charge for trying, is not a missed payment", () => {
  const rows = rowsSeenOn11Oct().filter((item) => !item.description.startsWith("IBG SVC CHARGE"));
  const facts = buildAccountRoutineFacts({ accounts: accounts(), transactions: rows, today: "2026-10-11" });
  assert.equal(facts.get(OCBC).missedPayments, undefined);
  // And a payment that stopped is no longer scheduled, so nothing is short.
  assert.equal(facts.get(OCBC).upcomingShortfall, undefined);
});

test("the scheduled check stays quiet with enough money, or with a statement older than 40 days", () => {
  const rich = accounts("2026-07").map((account) => account.id === OCBC
    ? { ...account, checkpointHistory: [checkpoint("2026-07", "2026-07-31", 400000)] }
    : account);
  assert.equal(buildAccountRoutineFacts({ accounts: rich, transactions: rowsSeenOn23Aug(), today: "2026-08-23" }).get(OCBC).upcomingShortfall, undefined);
  // 30 Sep is 46 days before 15 Nov.
  assert.equal(buildAccountRoutineFacts({ accounts: accounts(), transactions: rowsSeenOn11Oct(), today: "2026-11-15" }).get(OCBC)?.upcomingShortfall, undefined);
});

test("moved income says nothing once the payments moved too, and a linked transfer is not counted as income", () => {
  const moved = [
    ...rowsSeenOn23Aug().filter((item) => !(item.account_id === OCBC && item.description.includes("IFAST") && item.transaction_date >= "2026-07-01")),
    row(UOB, "2026-07-03", GIRO_1000, 100000),
    row(UOB, "2026-07-03", GIRO_500, 50000)
  ];
  assert.equal(buildAccountRoutineFacts({ accounts: accounts("2026-07"), transactions: moved, today: "2026-08-23" }).get(OCBC)?.incomeMoved, undefined);
  const linked = rowsSeenOn11Oct().map((item) => item.transaction_date === "2026-09-26" ? { ...item, transfer_group_id: "tg-1", entry_type: "transfer", transfer_direction: item.account_id === UOB ? "in" : "out" } : item);
  assert.equal(buildAccountRoutineFacts({ accounts: accounts(), transactions: linked, today: "2026-10-11" }).get(UOB)?.ownTransfersAsIncome, undefined);
  // The same amount leaving another person's account is not the owner's own money.
  const otherOwner = rowsSeenOn11Oct().map((item) => item.description === "FAST PAYMENT via PayNow-Mobile to J DOE" ? { ...item, account_id: TIM_BANK } : item);
  assert.equal(buildAccountRoutineFacts({ accounts: accounts(), transactions: otherOwner, today: "2026-10-11" }).get(UOB)?.ownTransfersAsIncome, undefined);
});
