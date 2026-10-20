// Transfer purpose, the person reading (DOMAIN.md "Transfer Purpose"): a
// transfer out to another person of the household that says what it pays
// for counts as the sender's spending in that category and lowers the
// receiver's spending there by the same amount. The household view never
// changes. Pure scenarios over EntryDto rows, checked with the same money
// rules every page uses (person-entry-amount.ts, category-offset.ts).
import assert from "node:assert/strict";
import test from "node:test";

import { spendingMinor, incomeMinor } from "../src/domain/category-offset.ts";
import { personEntryAmountMinor } from "../src/domain/person-entry-amount.ts";
import { filterEntriesForView } from "../src/domain/person-view-scope.ts";
import { adjustEntriesForView } from "../src/domain/month-projection.ts";
import {
  isTransferPurposeCategoryName,
  readEntriesForView,
  readEntryForPerson,
  TRANSFER_PURPOSE_COPY,
  transferPurposeRefusal
} from "../src/domain/transfer-purpose.ts";
import { rememberedTransferPurpose } from "../src/domain/app-repository-transfer-purpose.ts";

const TIM = "person-tim";
const JOYCE = "person-joyce";
const PEOPLE = [TIM, JOYCE];

function owned(personId, amountMinor) {
  return [{ personId, personName: personId === TIM ? "Tim" : "Joyce", ratioBasisPoints: 10000, amountMinor }];
}

function expense(id, { date = "2026-10-05", amountMinor, categoryName = "Home", owner = JOYCE } = {}) {
  return {
    id, date, description: id, accountName: "Joyce bank", categoryName, entryType: "expense",
    ownershipType: "direct", amountMinor, offsetsCategory: false, splits: owned(owner, amountMinor)
  };
}

// Tim's transfer out to Joyce, with or without a purpose, and its other side.
function purposeTransfer(id, { date = "2026-10-01", amountMinor = 45000, purpose = "Home", to = JOYCE, from = TIM } = {}) {
  return {
    id, date, description: "FAST to Joyce", accountName: "UOB Savings", categoryName: "Transfer",
    entryType: "transfer", transferDirection: "out", ownershipType: "direct", amountMinor, offsetsCategory: false,
    splits: owned(from, amountMinor),
    linkedTransfer: { transactionId: `${id}-in`, accountName: "Joyce bank", amountMinor, transactionDate: date },
    ...(purpose ? { transferPurpose: { categoryName: purpose, toPersonId: to, toPersonName: to === JOYCE ? "Joyce" : "Tim" } } : {})
  };
}

function receivingSide(id, { date = "2026-10-01", amountMinor = 45000 } = {}) {
  return {
    id: `${id}-in`, date, description: "FAST from Tim", accountName: "Joyce bank", categoryName: "Transfer",
    entryType: "transfer", transferDirection: "in", ownershipType: "direct", amountMinor, offsetsCategory: false,
    splits: owned(JOYCE, amountMinor)
  };
}

const withoutPurpose = (entries) => entries.map(({ transferPurpose, ...entry }) => entry);

// A view's spending and income per month and category, the way every page
// counts them: the view's own entries at their own amounts.
function viewFigures(entries, viewId, scope = "direct_plus_shared") {
  const visible = filterEntriesForView(adjustEntriesForView(entries, viewId), viewId, scope);
  const byKey = {};
  let income = 0;
  for (const entry of visible) {
    const amount = viewId === "household" ? entry.amountMinor : personEntryAmountMinor(entry, viewId, scope) ?? 0;
    const key = `${entry.date.slice(0, 7)} ${entry.categoryName}`;
    byKey[key] = (byKey[key] ?? 0) + spendingMinor(entry, amount);
    income += incomeMinor(entry, amount);
  }
  return { spending: Object.fromEntries(Object.entries(byKey).filter(([, value]) => value !== 0)), income };
}

// Invariant 2: per month and category, the people add up to the household.
function assertPeopleAddUp(entries) {
  const household = viewFigures(entries, "household");
  const sum = {};
  let income = 0;
  for (const person of PEOPLE) {
    const figures = viewFigures(entries, person);
    for (const [key, value] of Object.entries(figures.spending)) {
      sum[key] = (sum[key] ?? 0) + value;
    }
    income += figures.income;
  }
  assert.deepEqual(Object.fromEntries(Object.entries(sum).filter(([, value]) => value !== 0)), household.spending, "people add up to the household");
  assert.equal(income, household.income, "income adds up");
}

test("owner case: Tim's $450 for Home is his Home spending and lowers Joyce's $900 loan to $450; the household counts the loan once", () => {
  const entries = [purposeTransfer("t1"), receivingSide("t1"), expense("loan", { amountMinor: 90000 })];

  assert.deepEqual(viewFigures(entries, "household"), { spending: { "2026-10 Home": 90000 }, income: 0 });
  assert.deepEqual(viewFigures(entries, TIM), { spending: { "2026-10 Home": 45000 }, income: 0 });
  assert.deepEqual(viewFigures(entries, JOYCE), { spending: { "2026-10 Home": 45000 }, income: 0 });
  assertPeopleAddUp(entries);
});

test("invariant 1: the household reads the same with or without the purpose, and gets the very same array", () => {
  const entries = [purposeTransfer("t1"), receivingSide("t1"), expense("loan", { amountMinor: 90000 })];
  assert.equal(readEntriesForView(entries, "household"), entries);
  assert.deepEqual(viewFigures(entries, "household"), viewFigures(withoutPurpose(entries), "household"));
  // Without a purpose the transfer is nobody's spending, as before.
  assert.deepEqual(viewFigures(withoutPurpose(entries), TIM), { spending: {}, income: 0 });
  assert.deepEqual(viewFigures(withoutPurpose(entries), JOYCE), { spending: { "2026-10 Home": 90000 }, income: 0 });
});

test("the loan debit lands next month: each month still adds up; Joyce's October Home dips by the contribution", () => {
  const entries = [purposeTransfer("t1", { date: "2026-10-30" }), receivingSide("t1", { date: "2026-11-01" }), expense("loan", { date: "2026-11-02", amountMinor: 90000 })];
  assert.deepEqual(viewFigures(entries, TIM).spending, { "2026-10 Home": 45000 });
  assert.deepEqual(viewFigures(entries, JOYCE).spending, { "2026-10 Home": -45000, "2026-11 Home": 90000 });
  assert.deepEqual(viewFigures(entries, "household").spending, { "2026-11 Home": 90000 });
  assertPeopleAddUp(entries);
});

test("a contribution larger than the expense, and two purpose transfers, still add up to the cent", () => {
  const larger = [purposeTransfer("t1", { amountMinor: 100001 }), receivingSide("t1", { amountMinor: 100001 }), expense("loan", { amountMinor: 90000 })];
  assert.deepEqual(viewFigures(larger, JOYCE).spending, { "2026-10 Home": -10001 });
  assertPeopleAddUp(larger);

  const two = [
    purposeTransfer("t1"), receivingSide("t1"),
    purposeTransfer("t2", { amountMinor: 12345, purpose: "Groceries" }), receivingSide("t2", { amountMinor: 12345 }),
    expense("loan", { amountMinor: 90000 }), expense("market", { amountMinor: 30000, categoryName: "Groceries" })
  ];
  assert.deepEqual(viewFigures(two, TIM).spending, { "2026-10 Home": 45000, "2026-10 Groceries": 12345 });
  assert.deepEqual(viewFigures(two, JOYCE).spending, { "2026-10 Home": 45000, "2026-10 Groceries": 17655 });
  assertPeopleAddUp(two);
});

test("a purpose transfer beside a shared Splits expense: both apply and the views still add up", () => {
  const shared = {
    ...expense("loan", { amountMinor: 90000 }),
    linkedSplitExpenseId: "split-1",
    linkedSplitShares: [...owned(TIM, 45000), ...owned(JOYCE, 45000)]
  };
  const entries = [purposeTransfer("t1"), receivingSide("t1"), shared];
  assert.deepEqual(viewFigures(entries, TIM).spending, { "2026-10 Home": 90000 });
  assert.deepEqual(viewFigures(entries, JOYCE).spending, {});
  assertPeopleAddUp(entries);
  // Scope: the contribution is direct money for both, never a split share.
  assert.deepEqual(viewFigures(entries, TIM, "shared").spending, { "2026-10 Home": 45000 });
  assert.deepEqual(viewFigures(entries, TIM, "direct").spending, { "2026-10 Home": 45000 });
  assert.deepEqual(viewFigures(entries, JOYCE, "direct").spending, { "2026-10 Home": -45000 });
});

test("the readings: an expense for the sender, a payback (not income) for the receiver, untouched for anyone else", () => {
  const entry = purposeTransfer("t1");
  const sent = readEntryForPerson(entry, TIM);
  assert.deepEqual(
    { entryType: sent.entryType, categoryName: sent.categoryName, transferDirection: sent.transferDirection, role: sent.transferPurpose.role, ledgerCategoryName: sent.transferPurpose.ledgerCategoryName },
    { entryType: "expense", categoryName: "Home", transferDirection: "out", role: "sent", ledgerCategoryName: "Transfer" }
  );
  const received = readEntryForPerson(entry, JOYCE);
  assert.deepEqual(
    { entryType: received.entryType, categoryName: received.categoryName, offsetsCategory: received.offsetsCategory, splits: received.splits.map((split) => split.personId), ownerName: received.ownerName, role: received.transferPurpose.role },
    { entryType: "income", categoryName: "Home", offsetsCategory: true, splits: [JOYCE], ownerName: undefined, role: "received" }
  );
  assert.equal(incomeMinor(received), 0);
  assert.equal(spendingMinor(received), -45000);
  assert.equal(readEntryForPerson(entry, "person-someone"), entry);
  // The ledger entry itself is never changed.
  assert.equal(entry.entryType, "transfer");
});

test("Loans can be a purpose: the receiver's side still lowers Loans instead of counting as income", () => {
  const entries = [purposeTransfer("t1", { purpose: "Loans" }), receivingSide("t1"), expense("loan", { amountMinor: 90000, categoryName: "Loans" })];
  assert.deepEqual(viewFigures(entries, JOYCE), { spending: { "2026-10 Loans": 45000 }, income: 0 });
  assertPeopleAddUp(entries);
});

test("a purpose that cannot count is ignored: not a transfer out, on Splits, no owner, or to the sender", () => {
  const cases = [
    { ...purposeTransfer("a"), transferDirection: "in" },
    { ...purposeTransfer("b"), entryType: "expense" },
    { ...purposeTransfer("c"), linkedSplitExpenseId: "split-x", linkedSplitShares: owned(TIM, 45000) },
    { ...purposeTransfer("d"), splits: [] },
    purposeTransfer("e", { to: TIM }),
    purposeTransfer("f", { purpose: "Savings" })
  ];
  for (const entry of cases) {
    assert.equal(readEntryForPerson(entry, TIM), entry, entry.id);
    assert.equal(readEntryForPerson(entry, JOYCE), entry, entry.id);
  }
});

test("only spending categories (and Loans) can be a purpose", () => {
  assert.deepEqual(
    ["Home", "Groceries", "Loans", "Transfer", "Savings", "Investments", "Other", "Other - Income", "Salary", "Extra Income", ""].map(isTransferPurposeCategoryName),
    [true, true, true, false, false, false, false, false, false, false, false]
  );
});

const subject = (overrides = {}) => ({
  entryType: "transfer", transferDirection: "out", ownerPersonId: TIM, accountKind: "bank", currency: "SGD",
  linkedToSplits: false, usedAsSettleUp: false,
  counterpart: { ownerPersonId: JOYCE, accountKind: "bank", currency: "SGD", usedAsSettleUp: false },
  ...overrides
});

test("setting a purpose: allowed between two people, refused in plain words otherwise", () => {
  assert.equal(transferPurposeRefusal(subject(), JOYCE), null);
  // An unlinked transfer keeps the receiver it was given (set like last month).
  assert.equal(transferPurposeRefusal(subject({ counterpart: null }), JOYCE), null);
  assert.equal(transferPurposeRefusal(subject({ counterpart: null }), null), TRANSFER_PURPOSE_COPY.needsOtherSide);
  assert.equal(transferPurposeRefusal(subject(), TIM), TRANSFER_PURPOSE_COPY.ownAccounts);
  assert.equal(transferPurposeRefusal(subject({ counterpart: { ...subject().counterpart, ownerPersonId: null } }), null), TRANSFER_PURPOSE_COPY.noReceiver);
  assert.equal(transferPurposeRefusal(subject({ transferDirection: "in" }), JOYCE), TRANSFER_PURPOSE_COPY.notATransferOut);
  assert.equal(transferPurposeRefusal(subject({ entryType: "expense" }), JOYCE), TRANSFER_PURPOSE_COPY.notATransferOut);
  assert.equal(transferPurposeRefusal(subject({ ownerPersonId: null }), JOYCE), TRANSFER_PURPOSE_COPY.noOwner);
  assert.equal(transferPurposeRefusal(subject({ usedAsSettleUp: true }), JOYCE), TRANSFER_PURPOSE_COPY.settleUp);
  assert.equal(transferPurposeRefusal(subject({ counterpart: { ...subject().counterpart, usedAsSettleUp: true } }), JOYCE), TRANSFER_PURPOSE_COPY.settleUp);
  assert.equal(transferPurposeRefusal(subject({ accountKind: "investment" }), JOYCE), TRANSFER_PURPOSE_COPY.investments);
  assert.equal(transferPurposeRefusal(subject({ counterpart: { ...subject().counterpart, accountKind: "investment" } }), JOYCE), TRANSFER_PURPOSE_COPY.investments);
  // Foreign currency: the two sides must be in the same currency.
  assert.equal(transferPurposeRefusal(subject({ counterpart: { ...subject().counterpart, currency: "USD" } }), JOYCE), TRANSFER_PURPOSE_COPY.currencies);
});

test("learning: the newest earlier transfer like this one decides, digits in the description ignored", () => {
  const history = [
    { id: "aug", accountId: "acct-a", amountMinor: 45000, date: "2026-08-01", description: "FAST to Joyce 88812345", purposeCategoryId: "cat-home", purposePersonId: JOYCE },
    { id: "sep", accountId: "acct-a", amountMinor: 45000, date: "2026-09-01", description: "FAST to Joyce 99954321", purposeCategoryId: "cat-home", purposePersonId: JOYCE },
    { id: "other-amount", accountId: "acct-a", amountMinor: 45001, date: "2026-09-20", description: "FAST to Joyce", purposeCategoryId: null, purposePersonId: null },
    { id: "other-account", accountId: "acct-b", amountMinor: 45000, date: "2026-09-25", description: "FAST to Joyce", purposeCategoryId: null, purposePersonId: null }
  ];
  const october = { id: "oct", accountId: "acct-a", amountMinor: 45000, date: "2026-10-01", description: "FAST to Joyce 77700000" };
  assert.deepEqual(rememberedTransferPurpose(october, history), { categoryId: "cat-home", personId: JOYCE, fromEntryId: "sep" });

  // Undone in September (no purpose): October is left alone.
  const undone = history.map((entry) => entry.id === "sep" ? { ...entry, purposeCategoryId: null, purposePersonId: null } : entry);
  assert.equal(rememberedTransferPurpose(october, undone), null);
  // A different amount, account, description or more than 100 days back is not the same transfer.
  assert.equal(rememberedTransferPurpose({ ...october, amountMinor: 45100 }, history), null);
  assert.equal(rememberedTransferPurpose({ ...october, accountId: "acct-c" }, history), null);
  assert.equal(rememberedTransferPurpose({ ...october, description: "FAST to Ethan" }, history), null);
  assert.equal(rememberedTransferPurpose({ ...october, date: "2027-01-15" }, history), null);
});
