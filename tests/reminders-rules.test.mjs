// The reminder rules (src/domain/reminders/, docs/proposals/reminders): each
// kind with a concrete scenario from the proposal's showcase data (Serene's
// view, today Monday 12 October 2026) and the negatives that keep it quiet.
// Every rule is a pure function of its facts and `today`, so nothing here
// needs a database or a clock.
import assert from "node:assert/strict";
import test from "node:test";

import { cardBillReminders, expectedStatement, statementMissingReminders } from "../src/domain/reminders/account-reminders.ts";
import { buildReminders } from "../src/domain/reminders/build-reminders.ts";
import { monthCloseReminder, monthCloseReminders, monthsWithAllStatements } from "../src/domain/reminders/month-close-reminder.ts";
import { priceChangeReminders } from "../src/domain/reminders/price-change-reminders.ts";
import { splitsWaitingReminders } from "../src/domain/reminders/splits-reminders.ts";

const TODAY = "2026-10-12";
const SERENE = { id: "person-serene", name: "Serene" };
const ETHAN = { id: "person-ethan", name: "Ethan" };
const PEOPLE = [ETHAN, SERENE];

const statement = (month, endDate, extra = {}) => ({ month, statementEndDate: endDate, statementBalanceMinor: 0, ...extra });
const account = (id, name, kind, checkpoints, extra = {}) => ({
  id, name, kind, currency: "SGD", isActive: true, isJoint: false, ownerPersonId: SERENE.id, checkpoints, ...extra
});
const payment = (accountId, date, amountMinor) => ({
  id: `${accountId}:${date}`, account_id: accountId, transaction_date: date, post_date: null,
  description: "PAYMENT", amount_minor: amountMinor, entry_type: "transfer", transfer_direction: "in"
});

// The month-close facts the loader reads for each candidate month: nothing
// left in Other and a note written, unless a test says otherwise.
const closeFacts = (facts = { otherEntryCount: 0, hasNote: true }) => Object.fromEntries(
  ["2026-08", "2026-09", "2026-10", "2026-11", "2026-12"].map((month) => [month, facts])
);

function inputs(overrides = {}) {
  return {
    today: TODAY,
    viewId: SERENE.id,
    people: PEOPLE,
    accounts: [],
    cardPayments: [],
    charges: [],
    splits: { settleUps: [], groups: [] },
    monthClose: closeFacts(),
    ...overrides
  };
}

// ---------------------------------------------------------------------------
// Card bill due

const uobPrvi = (extra = {}, checkpointExtra = {}) => account("uob-prvi", "UOB PRVI Miles", "credit_card", [
  statement("2026-09", "2026-09-28", { statementBalanceMinor: -52773, paymentDueDate: "2026-10-18", ...checkpointExtra })
], extra);

test("a card bill shows from 7 days before its due date, with what is left to pay", () => {
  const [bill] = cardBillReminders(inputs({ accounts: [uobPrvi()] }));
  assert.deepEqual(bill, {
    key: "card_bill:uob-prvi:2026-09",
    kind: "card_bill",
    accountId: "uob-prvi",
    accountName: "UOB PRVI Miles",
    statementMonth: "2026-09",
    dueDate: "2026-10-18",
    daysUntilDue: 6,
    leftMinor: 52773,
    paidMinor: 0,
    currency: "SGD"
  });
});

test("a part payment lowers what is left; a full payment, or a bill 8 days out, shows nothing", () => {
  const part = cardBillReminders(inputs({ accounts: [uobPrvi()], cardPayments: [payment("uob-prvi", "2026-10-02", 20000)] }));
  assert.equal(part[0].leftMinor, 32773);
  assert.equal(part[0].paidMinor, 20000);

  assert.deepEqual(cardBillReminders(inputs({ accounts: [uobPrvi()], cardPayments: [payment("uob-prvi", "2026-10-02", 52773)] })), []);
  // Paid before the statement closed is not a payment towards it.
  assert.equal(cardBillReminders(inputs({ accounts: [uobPrvi()], cardPayments: [payment("uob-prvi", "2026-09-20", 52773)] })).length, 1);
  // Due 20 Oct is 8 days away: not yet.
  assert.deepEqual(cardBillReminders(inputs({ accounts: [uobPrvi({}, { paymentDueDate: "2026-10-20" })] })), []);
  assert.equal(cardBillReminders(inputs({ accounts: [uobPrvi({}, { paymentDueDate: "2026-10-19" })] })).length, 1);
});

test("an overdue bill shows for 30 days while less than the minimum is paid", () => {
  const overdue = uobPrvi({}, { paymentDueDate: "2026-10-05", minimumPaymentMinor: 5000 });
  const [bill] = cardBillReminders(inputs({ accounts: [overdue] }));
  assert.equal(bill.daysUntilDue, -7);

  // The minimum is paid: no longer asked about, though the bill is not cleared.
  assert.deepEqual(cardBillReminders(inputs({ accounts: [overdue], cardPayments: [payment("uob-prvi", "2026-10-06", 5000)] })), []);
  // Without a printed minimum, the whole bill must be paid.
  const noMinimum = uobPrvi({}, { paymentDueDate: "2026-10-05" });
  assert.equal(cardBillReminders(inputs({ accounts: [noMinimum], cardPayments: [payment("uob-prvi", "2026-10-06", 5000)] })).length, 1);
  // 30 days past due is the last day; 31 is gone.
  assert.equal(cardBillReminders(inputs({ accounts: [uobPrvi({}, { paymentDueDate: "2026-09-12" })] })).length, 1);
  assert.deepEqual(cardBillReminders(inputs({ accounts: [uobPrvi({}, { paymentDueDate: "2026-09-11" })] })), []);
});

test("no card bill for a statement with no due date, one that owes nothing, a bank account, or another person's card", () => {
  assert.deepEqual(cardBillReminders(inputs({ accounts: [uobPrvi({}, { paymentDueDate: undefined })] })), []);
  assert.deepEqual(cardBillReminders(inputs({ accounts: [uobPrvi({}, { statementBalanceMinor: 2500 })] })), []);
  assert.deepEqual(cardBillReminders(inputs({ accounts: [uobPrvi({ kind: "bank" })] })), []);
  assert.deepEqual(cardBillReminders(inputs({ accounts: [uobPrvi({ ownerPersonId: ETHAN.id })] })), []);
  // The household sees every card, a joint card is in both person views.
  assert.equal(cardBillReminders(inputs({ viewId: "household", accounts: [uobPrvi({ ownerPersonId: ETHAN.id })] })).length, 1);
  assert.equal(cardBillReminders(inputs({ accounts: [uobPrvi({ ownerPersonId: undefined, isJoint: true })] })).length, 1);
  assert.deepEqual(cardBillReminders(inputs({ accounts: [uobPrvi({ isActive: false })] })), []);
});

// ---------------------------------------------------------------------------
// Statement not imported yet

const ocbc365 = (checkpoints, extra = {}) => account("ocbc-365", "OCBC 365 Card", "credit_card", checkpoints, extra);
// Statements close at month-end.
const monthEnd = [statement("2026-06", "2026-06-30"), statement("2026-07", "2026-07-31"), statement("2026-08", "2026-08-31")];

test("a statement is expected on the median closing day a month after the latest, and shows 5 days later", () => {
  const [reminder] = statementMissingReminders(inputs({ accounts: [ocbc365(monthEnd)] }));
  assert.deepEqual(reminder, {
    key: "statement:ocbc-365:2026-09",
    kind: "statement_missing",
    accountId: "ocbc-365",
    accountName: "OCBC 365 Card",
    statementMonth: "2026-09",
    expectedOn: "2026-09-30",
    daysSinceExpected: 12
  });
  // Closing day 31 (June 30, July 31, Aug 31): median 31, kept inside September.
  assert.equal(expectedStatement(ocbc365(monthEnd), "2026-10-05").daysSinceExpected, 5);
  assert.equal(expectedStatement(ocbc365(monthEnd), "2026-10-04"), null);
});

test("the closing day comes from the last three statements, and two are enough", () => {
  const mid = [statement("2026-05", "2026-05-01"), statement("2026-06", "2026-06-15"), statement("2026-07", "2026-07-15"), statement("2026-08", "2026-08-15")];
  // Last three end on the 15th: expected 15 Sep, so 27 days ago.
  assert.equal(expectedStatement(ocbc365(mid), TODAY).expectedOn, "2026-09-15");
  const two = [statement("2026-07", "2026-07-20"), statement("2026-08", "2026-08-10")];
  // Two statements: the lower day (10th) is the usual one.
  assert.equal(expectedStatement(ocbc365(two), TODAY).expectedOn, "2026-09-10");
});

test("no missing-statement reminder for an account with fewer than two statements, one archived, or a statement already in", () => {
  assert.deepEqual(statementMissingReminders(inputs({ accounts: [ocbc365([statement("2026-08", "2026-08-31")])] })), []);
  assert.deepEqual(statementMissingReminders(inputs({ accounts: [ocbc365([])] })), []);
  assert.deepEqual(statementMissingReminders(inputs({ accounts: [ocbc365(monthEnd, { isActive: false })] })), []);
  // September's statement is imported: the next one (October) is not due yet.
  assert.deepEqual(statementMissingReminders(inputs({ accounts: [ocbc365([...monthEnd, statement("2026-09", "2026-09-30")])] })), []);
  // A cash wallet has no statements.
  assert.deepEqual(statementMissingReminders(inputs({ accounts: [account("cash", "Cash", "cash", monthEnd)] })), []);
  // Another person's account stays out of this person's view.
  assert.deepEqual(statementMissingReminders(inputs({ accounts: [ocbc365(monthEnd, { ownerPersonId: ETHAN.id })] })), []);
});

// ---------------------------------------------------------------------------
// Splits balance waiting

const settleUp = (extra = {}) => ({
  id: "cp-1", fromPersonId: SERENE.id, toPersonId: ETHAN.id, amountMinor: 104724, currency: "SGD",
  settlementDate: "2026-09-06", status: "open", ...extra
});

test("an open settle-up waiting more than 14 days shows in whole weeks, from the viewer's side", () => {
  const [mine] = splitsWaitingReminders(inputs({ splits: { settleUps: [settleUp()], groups: [] } }));
  assert.deepEqual(mine, {
    key: "splits:settle_up:cp-1",
    kind: "splits_waiting",
    variant: "settle_up",
    fromName: "Serene",
    toName: "Ethan",
    direction: "you_owe",
    amountMinor: 104724,
    currency: "SGD",
    sinceDate: "2026-09-06",
    weeks: 5
  });
  const [theirs] = splitsWaitingReminders(inputs({ viewId: ETHAN.id, splits: { settleUps: [settleUp()], groups: [] } }));
  assert.equal(theirs.direction, "owed_to_you");
  const [both] = splitsWaitingReminders(inputs({ viewId: "household", splits: { settleUps: [settleUp()], groups: [] } }));
  assert.equal(both.direction, "between");
  assert.equal(both.fromName, "Serene");
});

test("a settle-up that is paid, matched, 14 days old, zero or between other people shows nothing", () => {
  const none = (extra) => splitsWaitingReminders(inputs({ splits: { settleUps: [settleUp(extra)], groups: [] } }));
  assert.deepEqual(none({ settledAt: "2026-09-20 10:00:00" }), []);
  assert.deepEqual(none({ status: "matched" }), []);
  assert.deepEqual(none({ status: "partially_matched" }), []);
  assert.deepEqual(none({ status: "reopened" }), []);
  // 14 days is not "more than 14"; 15 is.
  assert.deepEqual(none({ settlementDate: "2026-09-28" }), []);
  assert.equal(none({ settlementDate: "2026-09-27" }).length, 1);
  assert.deepEqual(none({ amountMinor: 0 }), []);
  assert.deepEqual(none({ fromPersonId: "person-other", toPersonId: ETHAN.id }), []);
});

const group = (extra = {}) => ({ id: "g-bali", name: "Bali trip", currency: "SGD", balanceMinor: -8520, oldestOpenDate: "2026-09-10", ...extra });

test("a group's open balance of $20 or more shows once its oldest open record is 28 days old", () => {
  const [reminder] = splitsWaitingReminders(inputs({ splits: { settleUps: [], groups: [group()] } }));
  assert.equal(reminder.variant, "group_balance");
  assert.equal(reminder.key, "splits:group:g-bali:2026-09-10");
  assert.equal(reminder.direction, "you_owe");
  assert.equal(reminder.toName, "Ethan");
  assert.equal(reminder.amountMinor, 8520);
  assert.equal(reminder.groupName, "Bali trip");
  assert.equal(reminder.weeks, 4);
  const positive = splitsWaitingReminders(inputs({ splits: { settleUps: [], groups: [group({ balanceMinor: 8520 })] } }));
  assert.equal(positive[0].direction, "owed_to_you");
  // Household: a positive balance is the second person (Serene) owing the first (Ethan).
  const household = splitsWaitingReminders(inputs({ viewId: "household", splits: { settleUps: [], groups: [group({ balanceMinor: 8520 })] } }));
  assert.deepEqual([household[0].fromName, household[0].toName, household[0].direction], ["Serene", "Ethan", "between"]);
});

test("a group balance under $20, younger than 28 days, settled, or foreign with no rate shows nothing", () => {
  const none = (extra) => splitsWaitingReminders(inputs({ splits: { settleUps: [], groups: [group(extra)] } }));
  assert.deepEqual(none({ balanceMinor: -1999 }), []);
  assert.equal(none({ balanceMinor: -2000 }).length, 1);
  assert.deepEqual(none({ oldestOpenDate: "2026-09-15" }), []);
  assert.equal(none({ oldestOpenDate: "2026-09-14" }).length, 1);
  assert.deepEqual(none({ balanceMinor: 0 }), []);
  assert.deepEqual(none({ oldestOpenDate: undefined }), []);
  // JPY 6,000 at 0.0092 SGD each is $55: over the floor through the rate; without one it cannot be compared.
  assert.equal(none({ currency: "JPY", balanceMinor: -600000, homeRateBasisPoints: 92 }).length, 1);
  assert.deepEqual(none({ currency: "JPY", balanceMinor: -600000 }), []);
  assert.deepEqual(none({ currency: "JPY", balanceMinor: -150000, homeRateBasisPoints: 92 }), []);
});

// ---------------------------------------------------------------------------
// Subscription price change

const charge = (date, amountMinor, extra = {}) => ({
  accountId: "ocbc-365", date, description: "SPOTIFY P3A1B2C3D4", amountMinor, currency: "SGD", period: "monthly", isForeign: false, ...extra
});
const monthly = (prices, firstMonth = "2026-01") => prices.map((price, index) => {
  const month = Number(firstMonth.slice(5)) + index;
  return charge(`${firstMonth.slice(0, 4)}-${String(month).padStart(2, "0")}-07`, price);
});
const SPOTIFY_OLD = [1598, 1598, 1598, 1598, 1598, 1598, 1598, 1598, 1598];
const priceInputs = (charges, extra = {}) => inputs({ accounts: [account("ocbc-365", "OCBC 365 Card", "credit_card", [])], charges, ...extra });

test("a payee charged one amount for 3+ months, then a price $1 and 5% higher, shows for 45 days", () => {
  const [reminder] = priceChangeReminders(priceInputs(monthly([...SPOTIFY_OLD, 1798])));
  assert.deepEqual(reminder, {
    key: "price:monthly|SPOTIFY:2026-10-07",
    kind: "price_change",
    payeeName: "Spotify",
    period: "monthly",
    fromMinor: 1598,
    toMinor: 1798,
    firstNewChargeDate: "2026-10-07",
    priorChargeCount: 9,
    currency: "SGD"
  });
});

test("a price change needs a stable history, a big enough step, a recent first charge and no foreign currency", () => {
  const none = (prices, extra) => priceChangeReminders(priceInputs(monthly(prices), extra));
  // Only two charges at the old price.
  assert.deepEqual(none([1598, 1598, 1798]), []);
  assert.equal(none([1598, 1598, 1598, 1798]).length, 0, "four months from January ends in April, long past the 45 days");
  const recent = (prices) => priceChangeReminders(priceInputs(monthly(prices, "2026-07")));
  assert.equal(recent([1598, 1598, 1598, 1798]).length, 1, "Jul-Oct: the new charge is 7 Oct");
  assert.deepEqual(recent([1598, 1598, 1798, 1798]), []);
  // $0.99 more and 6%: under the $1 floor. $2 on $60: 3.3%, under 5%.
  assert.deepEqual(recent([1598, 1598, 1598, 1697]), []);
  assert.deepEqual(recent([6000, 6000, 6000, 6200]), []);
  assert.equal(recent([6000, 6000, 6000, 6300]).length, 1);
  // A price drop that big counts too: it is a change worth knowing.
  assert.equal(recent([1798, 1798, 1798, 1598]).length, 1);
  // Always-different amounts (a utility bill) never form a stable run.
  assert.deepEqual(recent([8120, 9340, 7750, 10210]), []);
  // A foreign-currency charge is never read.
  const foreign = monthly([1598, 1598, 1598, 1798], "2026-07").map((row) => ({ ...row, isForeign: true }));
  assert.deepEqual(priceChangeReminders(priceInputs(foreign)), []);
  // A charge on another person's account stays out of this view.
  assert.deepEqual(priceChangeReminders(priceInputs(monthly([1598, 1598, 1598, 1798], "2026-07"), { viewId: ETHAN.id })), []);
});

test("a price change stops showing 45 days after its first new charge", () => {
  const charges = monthly([1598, 1598, 1598, 1798], "2026-07");
  assert.equal(priceChangeReminders(priceInputs(charges, { today: "2026-11-21" })).length, 1, "45 days after 7 Oct");
  assert.deepEqual(priceChangeReminders(priceInputs(charges, { today: "2026-11-22" })), []);
});

test("a missed month breaks the run, and a payee billed twice in a month is not one series", () => {
  const gap = [charge("2026-06-07", 1598), charge("2026-07-07", 1598), charge("2026-09-07", 1598), charge("2026-10-07", 1798)];
  assert.deepEqual(priceChangeReminders(priceInputs(gap)), []);
  const twice = [...monthly([1598, 1598, 1598, 1798], "2026-07"), charge("2026-10-20", 500)];
  assert.deepEqual(priceChangeReminders(priceInputs(twice)), []);
});

test("a yearly subscription needs two yearly charges at the old price, a year apart", () => {
  const yearly = (...pairs) => pairs.map(([date, amountMinor]) => charge(date, amountMinor, { description: "ADOBE CREATIVE CLOUD A1B2C3", period: "yearly" }));
  const [reminder] = priceChangeReminders(priceInputs(yearly(["2024-09-20", 28800], ["2025-09-20", 28800], ["2026-09-21", 31200])));
  assert.equal(reminder.period, "yearly");
  assert.equal(reminder.priorChargeCount, 2);
  assert.equal(reminder.fromMinor, 28800);
  assert.equal(reminder.toMinor, 31200);
  assert.deepEqual(priceChangeReminders(priceInputs(yearly(["2025-09-20", 28800], ["2026-09-21", 31200]))), []);
  // Charges six months apart are not a yearly series.
  assert.deepEqual(priceChangeReminders(priceInputs(yearly(["2025-09-20", 28800], ["2026-03-20", 28800], ["2026-09-21", 31200]))), []);
});

// ---------------------------------------------------------------------------
// Month ready to close

// September: every statement account has September's statement.
const septemberAccounts = [
  account("ocbc-365", "OCBC 365 Card", "credit_card", [...monthEnd, statement("2026-09", "2026-09-30")]),
  account("uob-prvi", "UOB PRVI Miles", "credit_card", [statement("2026-08", "2026-08-28"), statement("2026-09", "2026-09-28")])
];

test("the last complete month is ready to close once every statement account has its statement", () => {
  const card = monthCloseReminder(inputs({
    accounts: septemberAccounts,
    monthClose: closeFacts(),
    splits: { settleUps: [settleUp()], groups: [] }
  }));
  assert.deepEqual(card, {
    key: "month_close:2026-09",
    kind: "month_close",
    month: "2026-09",
    allDone: false,
    checks: [
      { id: "statements", done: true, count: 2 },
      { id: "other", done: true, count: 0 },
      { id: "splits", done: false, count: 1, amountMinor: 104724, currency: "SGD", withName: "Ethan" },
      { id: "note", done: true, count: 1 }
    ]
  });
});

test("month close counts entries left in Other, an unwritten note, and is allDone only when every check is", () => {
  const open = monthCloseReminder(inputs({ accounts: septemberAccounts, monthClose: closeFacts({ otherEntryCount: 3, hasNote: false }) }));
  assert.deepEqual(open.checks.map((check) => [check.id, check.done, check.count]), [
    ["statements", true, 2], ["other", false, 3], ["splits", true, 0], ["note", false, 0]
  ]);
  assert.equal(open.allDone, false);
  const done = monthCloseReminder(inputs({ accounts: septemberAccounts }));
  assert.equal(done.allDone, true);
  // Records dated after the month do not hold it open.
  const later = monthCloseReminder(inputs({ accounts: septemberAccounts, splits: { settleUps: [settleUp({ settlementDate: "2026-10-03" })], groups: [] } }));
  assert.equal(later.allDone, true);
  // A group with an open balance dated in September does.
  const grouped = monthCloseReminder(inputs({ accounts: septemberAccounts, splits: { settleUps: [], groups: [group({ oldestOpenDate: "2026-09-10" })] } }));
  assert.equal(grouped.checks[2].done, false);
});

test("no month-close card while a statement is missing or for no statement accounts, and the month follows the calendar", () => {
  const missing = [...septemberAccounts, account("dbs", "DBS Account", "bank", [statement("2026-07", "2026-07-31"), statement("2026-08", "2026-08-31")])];
  assert.equal(monthCloseReminder(inputs({ accounts: missing })), null);
  // An account that has never had a statement does not hold the month open.
  assert.notEqual(monthCloseReminder(inputs({ accounts: [...septemberAccounts, account("new", "New Card", "credit_card", [])] })), null);
  assert.equal(monthCloseReminder(inputs({ accounts: [] })), null);
  // The last complete month moves on with the calendar: in November it is October,
  // whose statements these accounts do not have yet.
  assert.equal(monthCloseReminder(inputs({ accounts: septemberAccounts, today: "2026-11-02" })), null);
  assert.equal(monthCloseReminder(inputs({ accounts: septemberAccounts, today: "2026-10-31" })).month, "2026-09");
  assert.equal(monthCloseReminder(inputs({ accounts: septemberAccounts, today: "2027-01-05" })), null);
});

test("a month's card stays for 45 days after it ended, then the next month is the only candidate", () => {
  // 10 Nov: September ended 41 days ago and is still open, October has no statements yet.
  const november = monthCloseReminders(inputs({ accounts: septemberAccounts, today: "2026-11-10" }));
  assert.deepEqual(november.map((card) => card.key), ["month_close:2026-09"]);
  assert.deepEqual(monthsWithAllStatements({ today: "2026-11-10", accounts: septemberAccounts, viewId: SERENE.id }), ["2026-09"]);
  // 14 Nov is day 45, 15 Nov is day 46.
  assert.equal(monthCloseReminders(inputs({ accounts: septemberAccounts, today: "2026-11-14" })).length, 1);
  assert.deepEqual(monthCloseReminders(inputs({ accounts: septemberAccounts, today: "2026-11-15" })), []);
  // With both months' statements in, the older month comes first.
  const both = septemberAccounts.map((item) => ({ ...item, checkpoints: [...item.checkpoints, statement("2026-10", "2026-10-30")] }));
  assert.deepEqual(monthCloseReminders(inputs({ accounts: both, today: "2026-11-10" })).map((card) => card.month), ["2026-09", "2026-10"]);
});

// ---------------------------------------------------------------------------
// The whole list: ordering and no duplicates

test("reminders come in order: overdue bills, bills due soonest, month close, statements, Splits, price changes", () => {
  const cards = [
    uobPrvi(),
    account("citi", "Citi Rewards", "credit_card", [statement("2026-09", "2026-09-20", { statementBalanceMinor: -12000, paymentDueDate: "2026-10-08" })]),
    account("hsbc", "HSBC Visa", "credit_card", [statement("2026-09", "2026-09-25", { statementBalanceMinor: -9000, paymentDueDate: "2026-10-14" })])
  ];
  const list = buildReminders(inputs({
    accounts: [
      ...cards,
      account("ocbc-365", "OCBC 365 Card", "credit_card", monthEnd),
      account("dbs", "DBS Account", "bank", [statement("2026-07", "2026-07-15"), statement("2026-08", "2026-08-15")])
    ],
    splits: { settleUps: [settleUp()], groups: [] },
    charges: monthly([1598, 1598, 1598, 1798], "2026-07")
  }));
  assert.deepEqual(list.map((reminder) => reminder.key), [
    "card_bill:citi:2026-09",
    "card_bill:hsbc:2026-09",
    "card_bill:uob-prvi:2026-09",
    // The OCBC 365 statement is 12 days late, DBS's closed on the 15th and is 27 days late.
    "statement:dbs:2026-09",
    "statement:ocbc-365:2026-09",
    "splits:settle_up:cp-1",
    "price:monthly|SPOTIFY:2026-10-07"
  ]);
});

test("while the month-close card asks about Splits it replaces the standalone Splits reminder", () => {
  const splits = { settleUps: [settleUp()], groups: [] };
  const withCard = buildReminders(inputs({ accounts: septemberAccounts, splits }));
  // 12 Oct is 42 days after August ended, so August's (finished) card is also in the list.
  assert.deepEqual(withCard.map((reminder) => [reminder.kind, reminder.month, reminder.allDone]), [
    ["month_close", "2026-08", true],
    ["month_close", "2026-09", false]
  ]);
  // Without a month-close card the Splits reminder stands on its own.
  const without = buildReminders(inputs({ accounts: [], splits }));
  assert.deepEqual(without.map((reminder) => reminder.kind), ["splits_waiting"]);
});

test("ties on rank put the larger amount first, and the same facts always give the same list", () => {
  const cards = [
    account("a", "Card A", "credit_card", [statement("2026-09", "2026-09-20", { statementBalanceMinor: -5000, paymentDueDate: "2026-10-16" })]),
    account("b", "Card B", "credit_card", [statement("2026-09", "2026-09-20", { statementBalanceMinor: -9000, paymentDueDate: "2026-10-16" })])
  ];
  const first = buildReminders(inputs({ accounts: cards }));
  // Both cards have September's statement, so month close follows the two bills.
  assert.deepEqual(first.map((reminder) => reminder.accountId ?? reminder.kind), ["b", "a", "month_close"]);
  assert.deepEqual(buildReminders(inputs({ accounts: [...cards].reverse() })), first);
});

test("a view with nothing to say gets an empty list", () => {
  assert.deepEqual(buildReminders(inputs()), []);
});

// ---------------------------------------------------------------------------
// Tax relief room (December)

import { buildTaxReliefsYear } from "../src/domain/tax-reliefs.ts";

const reliefRow = (id, ownerPersonId, categoryName, amountMinor, extra = {}) => ({
  id, date: "2026-03-10", entryType: "transfer", transferDirection: "out", amountMinor, ownerPersonId, categoryName, ...extra
});
const taxYear = (today, rows) => buildTaxReliefsYear({ today, people: PEOPLE, rows });
const ROWS = [
  reliefRow("srs-1", ETHAN.id, "SRS top-up", 600_000),
  reliefRow("cpf-1", ETHAN.id, "CPF top-up", 800_000),
  reliefRow("cpf-2", SERENE.id, "CPF top-up", 400_000),
  reliefRow("gift-1", ETHAN.id, "Charity gift", 50_000, { entryType: "expense", transferDirection: null })
];

test("in December, each started relief below its limit is one To do with the room left; a full one and a gift are left out", () => {
  const today = "2026-12-05";
  const [reminder] = buildReminders(inputs({ today, viewId: "household", taxRelief: taxYear(today, ROWS) })).filter((item) => item.kind === "tax_relief");
  assert.deepEqual(reminder, {
    key: "tax_relief:2026",
    kind: "tax_relief",
    year: "2026",
    daysLeft: 26,
    items: [
      { personId: ETHAN.id, personName: "Ethan", relief: "srs", roomMinor: 930_000 },
      { personId: SERENE.id, personName: "Serene", relief: "cpf_self", roomMinor: 400_000 }
    ]
  });
});

test("a person's view counts only that person's room, and a view with none left has no To do", () => {
  const today = "2026-12-05";
  const taxRelief = taxYear(today, ROWS);
  const own = (viewId) => buildReminders(inputs({ today, viewId, taxRelief })).filter((item) => item.kind === "tax_relief");
  assert.deepEqual(own(SERENE.id)[0].items.map((item) => [item.personName, item.relief, item.roomMinor]), [["Serene", "cpf_self", 400_000]]);
  assert.deepEqual(own(ETHAN.id)[0].items.map((item) => item.relief), ["srs"]);
  const full = taxYear(today, [reliefRow("cpf-full", ETHAN.id, "CPF top-up", 800_000)]);
  assert.deepEqual(buildReminders(inputs({ today, viewId: ETHAN.id, taxRelief: full })).filter((item) => item.kind === "tax_relief"), []);
});

test("no To do before December, on a year that has changed, or for a relief nobody started", () => {
  const kinds = (today, taxRelief, viewId = "household") => buildReminders(inputs({ today, viewId, taxRelief })).filter((item) => item.kind === "tax_relief");
  assert.deepEqual(kinds("2026-11-30", taxYear("2026-11-30", ROWS)), []);
  assert.deepEqual(kinds("2027-01-02", taxYear("2026-12-31", ROWS)), []);
  assert.equal(kinds("2026-12-01", taxYear("2026-12-01", ROWS)).length, 1);
  assert.equal(kinds("2026-12-31", taxYear("2026-12-31", ROWS))[0].daysLeft, 0);
  assert.deepEqual(kinds("2026-12-10", taxYear("2026-12-10", [])), []);
  assert.deepEqual(kinds("2026-12-10", undefined), []);
  // Only a charity gift: no limit to fill, so nothing to say.
  assert.deepEqual(kinds("2026-12-10", taxYear("2026-12-10", [ROWS[3]])), []);
});
