// Ask's "Check this first" (skew candidates) and Money insights (a
// settlement's payment candidate on Splits, own-account transfers counted as
// income on the account pills) read one detector (src/domain/internal-moves.ts,
// DOMAIN.md "Internal Move"), so on the same entries they name the same
// pairs: Money insights never names a pair Ask would not check first, and
// never pairs the entries another way.
import assert from "node:assert/strict";
import test from "node:test";

import { buildAccountRoutineFacts } from "../src/domain/account-routines.ts";
import { moveSideOf, settlementPaymentCandidate } from "../src/domain/internal-moves.ts";
import { findSkewCandidates } from "../src/domain/skew-candidates.ts";

const ETHAN = { id: "person-ethan", name: "Ethan" };
const SERENE = { id: "person-serene", name: "Serene" };
const PEOPLE = [ETHAN, SERENE];
const ACCOUNTS = [
  { id: "acct-ocbc", name: "OCBC 360 Account", kind: "bank", ownerPersonId: ETHAN.id, isJoint: false, currency: "SGD" },
  { id: "acct-uob", name: "UOB One Account", kind: "bank", ownerPersonId: ETHAN.id, isJoint: false, currency: "SGD" },
  { id: "acct-trust", name: "Trust Savings", kind: "bank", ownerPersonId: ETHAN.id, isJoint: false, currency: "SGD" },
  { id: "acct-dbs", name: "DBS Multiplier Account", kind: "bank", ownerPersonId: SERENE.id, isJoint: false, currency: "SGD" },
  { id: "acct-joint", name: "POSB Joint Account", kind: "bank", isJoint: true, currency: "SGD" }
];
const accountById = new Map(ACCOUNTS.map((account) => [account.id, account]));
const MONTH = "2026-05";
const TODAY = "2026-05-28";

// One spec, read as an Entries row (skew candidates) and as a bank row
// (account routines), so both readers see exactly the same entries.
function spec(id, date, accountId, entryType, amountMinor, extra = {}) {
  return { id, date, accountId, entryType, amountMinor, categoryName: entryType === "income" ? "Other - Income" : entryType === "transfer" ? "Transfer" : "Other", description: id, ...extra };
}

function asEntry(item) {
  const account = accountById.get(item.accountId);
  const owner = PEOPLE.find((person) => person.id === account.ownerPersonId);
  return {
    id: item.id,
    date: item.date,
    description: item.description,
    accountId: item.accountId,
    accountName: account.name,
    accountOwnerLabel: owner?.name ?? "Shared",
    categoryName: item.categoryName,
    entryType: item.entryType,
    ...(item.transferDirection ? { transferDirection: item.transferDirection } : {}),
    ...(item.linked ? { linkedTransfer: { transactionId: "elsewhere", accountName: "x", amountMinor: item.amountMinor, transactionDate: item.date } } : {}),
    ownershipType: "direct",
    ownerName: owner?.name,
    amountMinor: item.amountMinor,
    offsetsCategory: false,
    splits: owner ? [{ personId: owner.id, personName: owner.name, ratioBasisPoints: 10000, amountMinor: item.amountMinor }] : []
  };
}

function asRoutineRow(item) {
  return {
    id: item.id,
    account_id: item.accountId,
    transaction_date: item.date,
    description: item.description,
    amount_minor: item.amountMinor,
    entry_type: item.entryType,
    transfer_direction: item.transferDirection ?? null,
    transfer_group_id: item.linked ? "transfer-group-1" : null,
    category_name: item.categoryName
  };
}

function asSide(item) {
  const side = moveSideOf({ ...item, linked: Boolean(item.linked) }, accountById.get(item.accountId));
  return side ? { ...side, entryType: item.entryType } : null;
}

function skew(items, overrides = {}) {
  return findSkewCandidates({
    month: MONTH,
    viewId: "household",
    scope: "direct_plus_shared",
    entries: items.map(asEntry),
    accounts: ACCOUNTS,
    people: PEOPLE,
    settlementCheckpoints: [],
    groupBalances: [],
    ...overrides
  });
}

// What Money insights says about own-account moves: [incomeId, fromId] pairs.
function insightOwnMoves(items) {
  const facts = buildAccountRoutineFacts({ accounts: ACCOUNTS, transactions: items.map(asRoutineRow), today: TODAY });
  return [...facts.values()].flatMap((fact) => fact.ownTransfersAsIncome ?? []).map((item) => [item.fromEntryId, item.entryId]);
}

// What Ask would check first before an income answer: high-confidence own
// transfers that change the month's income.
function askOwnMoves(items) {
  return skew(items).candidates
    .filter((candidate) => candidate.kind === "own_transfer" && candidate.confidence === "high")
    .map((candidate) => candidate.entryIds);
}

const CHECKPOINT = {
  id: "split-checkpoint-may",
  fromPersonId: ETHAN.id,
  fromPersonName: ETHAN.name,
  toPersonId: SERENE.id,
  toPersonName: SERENE.name,
  amountMinor: 18245,
  currency: "SGD",
  settlementDate: "2026-05-10",
  status: "open",
  matchedAmountMinor: 0,
  matchedTransfers: [],
  includedRecordCount: 2,
  includedRecordIds: []
};

function insightSettlement(items, checkpoint = CHECKPOINT) {
  return settlementPaymentCandidate(checkpoint, items.map(asSide).filter(Boolean));
}

function askSettlements(items, checkpoint = CHECKPOINT) {
  return skew(items, { settlementCheckpoints: [checkpoint] }).candidates
    .filter((candidate) => candidate.kind === "settlement" && candidate.confidence === "high");
}

// ------------------------------------------------------- own-account moves

test("an own-account transfer counted as income: Money insights and Ask name the same pair", () => {
  const items = [
    spec("out-ocbc", "2026-05-03", "acct-ocbc", "transfer", 50000, { transferDirection: "out" }),
    spec("in-uob", "2026-05-04", "acct-uob", "income", 50000, { categoryName: "Salary" })
  ];
  assert.deepEqual(insightOwnMoves(items), [["out-ocbc", "in-uob"]]);
  assert.deepEqual(askOwnMoves(items), [["out-ocbc", "in-uob"]]);
  assert.deepEqual(skew(items).candidates[0].skew, { spendingMinor: 0, incomeMinor: 50000 });
});

test("two equally close receiving entries: neither names a pair (Ask only marks it medium)", () => {
  const items = [
    spec("out-ocbc", "2026-05-10", "acct-ocbc", "transfer", 60000, { transferDirection: "out" }),
    spec("in-uob", "2026-05-11", "acct-uob", "income", 60000),
    spec("in-trust", "2026-05-09", "acct-trust", "income", 60000)
  ];
  assert.deepEqual(insightOwnMoves(items), []);
  assert.deepEqual(askOwnMoves(items), []);
  const [candidate] = skew(items).candidates;
  assert.equal(candidate.confidence, "medium");
  // Paired by date then id, the same way for every reader.
  assert.deepEqual(candidate.entryIds, ["out-ocbc", "in-trust"]);
});

test("an earlier outflow of the same amount takes the income for both readers, so Money insights stays quiet", () => {
  // The expense on the 15th pairs first (oldest outflow); the transfer on
  // the 16th is left with nothing. Before the shared detector, Money
  // insights paired the transfer and Ask the expense.
  const items = [
    spec("expense-ocbc", "2026-05-15", "acct-ocbc", "expense", 30000),
    spec("transfer-ocbc", "2026-05-16", "acct-ocbc", "transfer", 30000, { transferDirection: "out" }),
    spec("in-uob", "2026-05-16", "acct-uob", "income", 30000)
  ];
  assert.deepEqual(askOwnMoves(items), [["expense-ocbc", "in-uob"]]);
  assert.deepEqual(insightOwnMoves(items), []);
});

test("negative: a linked transfer, a move between two people, or one four days apart is named by neither", () => {
  const linked = [
    spec("out-ocbc", "2026-05-03", "acct-ocbc", "transfer", 50000, { transferDirection: "out", linked: true }),
    spec("in-uob", "2026-05-04", "acct-uob", "income", 50000)
  ];
  const twoPeople = [
    spec("out-ocbc", "2026-05-03", "acct-ocbc", "transfer", 50000, { transferDirection: "out" }),
    spec("in-dbs", "2026-05-04", "acct-dbs", "income", 50000)
  ];
  const tooFar = [
    spec("out-ocbc", "2026-05-03", "acct-ocbc", "transfer", 50000, { transferDirection: "out" }),
    spec("in-uob", "2026-05-07", "acct-uob", "income", 50000)
  ];
  for (const items of [linked, twoPeople, tooFar]) {
    assert.deepEqual(insightOwnMoves(items), []);
    assert.deepEqual(askOwnMoves(items), []);
  }
});

test("Money insights mentions only moves of $50 or more; Ask still checks a smaller one", () => {
  const items = [
    spec("out-ocbc", "2026-05-03", "acct-ocbc", "transfer", 4999, { transferDirection: "out" }),
    spec("in-uob", "2026-05-04", "acct-uob", "income", 4999)
  ];
  assert.deepEqual(insightOwnMoves(items), []);
  assert.deepEqual(askOwnMoves(items), [["out-ocbc", "in-uob"]]);
});

// ------------------------------------------------------------- settlements

const payerOut = (date = "2026-05-13", extra = {}) => spec("paynow-out", date, "acct-ocbc", "expense", 18245, { description: "PAYNOW TRANSFER TO SERENE", ...extra });
const payeeIn = (date = "2026-05-13", extra = {}) => spec("paynow-in", date, "acct-dbs", "income", 18245, { description: "PAYNOW FROM ETHAN", ...extra });

test("a settlement paid on both sides: the payment candidate and Ask's check hold the same two entries", () => {
  const items = [payerOut(), payeeIn()];
  assert.deepEqual(insightSettlement(items), { date: "2026-05-13", amountMinor: 18245, entryIds: ["paynow-out", "paynow-in"], countedAsSpending: true });
  assert.deepEqual(askSettlements(items).map((candidate) => candidate.entryIds), [["paynow-out", "paynow-in"]]);
});

test("one side that names nobody: Money insights offers it, so Ask checks it first too", () => {
  const items = [payerOut("2026-05-13", { description: "FAST PAYMENT 0412" })];
  assert.deepEqual(insightSettlement(items)?.entryIds, ["paynow-out"]);
  const [candidate] = askSettlements(items);
  assert.deepEqual(candidate.entryIds, ["paynow-out"]);
  assert.equal(candidate.bothSidesFound, false);
});

test("the window is the same for both: 5 days before to 14 days after the settlement date", () => {
  for (const date of ["2026-05-05", "2026-05-24"]) {
    assert.deepEqual(insightSettlement([payerOut(date)])?.entryIds, ["paynow-out"], date);
    assert.deepEqual(askSettlements([payerOut(date)]).map((candidate) => candidate.entryIds), [["paynow-out"]], date);
  }
  for (const date of ["2026-05-04", "2026-05-25"]) {
    assert.equal(insightSettlement([payerOut(date)]), undefined, date);
    assert.deepEqual(askSettlements([payerOut(date)]), [], date);
  }
});

test("of two payments of the amount, both pick the one nearest the settlement date", () => {
  const items = [
    spec("early", "2026-05-07", "acct-ocbc", "expense", 18245),
    spec("near", "2026-05-12", "acct-ocbc", "expense", 18245)
  ];
  assert.deepEqual(insightSettlement(items)?.entryIds, ["near"]);
  assert.deepEqual(askSettlements(items).map((candidate) => candidate.entryIds), [["near"]]);
});

test("negative: a joint account, a cent off, the wrong direction or a matched checkpoint is named by neither", () => {
  const cases = [
    [[spec("joint", "2026-05-12", "acct-joint", "expense", 18245)], CHECKPOINT],
    [[payerOut("2026-05-12", { amountMinor: 18244 })], CHECKPOINT],
    [[spec("serene-out", "2026-05-12", "acct-dbs", "expense", 18245), spec("ethan-in", "2026-05-12", "acct-uob", "income", 18245)], CHECKPOINT],
    [[payerOut()], { ...CHECKPOINT, status: "matched", matchedAmountMinor: 18245 }]
  ];
  for (const [items, checkpoint] of cases) {
    assert.equal(insightSettlement(items, checkpoint), undefined, JSON.stringify(items));
    assert.deepEqual(askSettlements(items, checkpoint), [], JSON.stringify(items));
  }
});

test("refiled as transfers, the payment candidate stays but no longer counts, and Ask has nothing to check", () => {
  const items = [
    payerOut("2026-05-13", { entryType: "transfer", transferDirection: "out", categoryName: "Transfer" }),
    payeeIn("2026-05-13", { entryType: "transfer", transferDirection: "in", categoryName: "Transfer" })
  ];
  assert.equal(insightSettlement(items).countedAsSpending, false);
  assert.deepEqual(askSettlements(items), []);
});
