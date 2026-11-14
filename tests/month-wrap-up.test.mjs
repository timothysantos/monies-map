// The month wrap-up (DOMAIN.md "Month Wrap-up"; src/domain/month-wrap-up.ts
// and month-wrap-up-projection.ts): which months can be wrapped up, the
// facts each check reads from existing projections, the checklist and its
// one-line fold. Concrete values for every row, and the guarded paths: a
// future month, a month with no entries, the month in progress before its
// last days, a check that cannot apply.
import assert from "node:assert/strict";
import test from "node:test";

import { buildMonthWrapUpChecks, monthWrapUpEndDate, monthWrapUpIsOpen, MONTH_WRAP_UP_CONFIG } from "../src/domain/month-wrap-up.ts";
import { buildMonthWrapUp } from "../src/domain/month-wrap-up-projection.ts";

let counter = 0;
const entry = (date, description, amountMinor, categoryName, entryType = "expense") => ({ id: `e${String((counter += 1)).padStart(3, "0")}`, date, description, categoryName, entryType, amountMinor });

const account = (id, name, institution, latestCheckpointMonth, extra = {}) => ({
  id, institutionId: "", name, institution, kind: "credit_card", ownerLabel: "Ethan", currency: "", isJoint: false, isActive: true,
  ownerPersonId: "person-ethan", latestCheckpointMonth, ...extra
});

const NAMES = { "person-ethan": "Ethan", "person-serene": "Serene" };

// October 2026, read on 14 November: September and October of everyday spending.
function octoberFacts(overrides = {}) {
  counter = 0;
  const entries = [
    entry("2026-09-04", "NTUC FAIRPRICE", 40_000, "Groceries"),
    entry("2026-09-05", "KOUFU", 20_000, "Food & Drinks"),
    entry("2026-09-06", "GRAB", 10_000, "Taxi"),
    entry("2026-09-07", "COURTS", 50_000, "Home"),
    entry("2026-10-04", "NTUC FAIRPRICE", 70_000, "Groceries"), // up $300
    entry("2026-10-05", "KOUFU", 12_000, "Food & Drinks"), // down $80
    entry("2026-10-06", "GRAB", 11_000, "Taxi"), // a small move, left out
    entry("2026-10-07", "MYSTERY SHOP", 4_500, "Other"),
    entry("2026-10-08", "UNKNOWN", 1_500, "Other"),
    entry("2026-10-09", "E-MART YONGSAN", 3_210, "Groceries"),
    entry("2026-10-10", "SALARY", 600_000, "Salary", "income"),
    // Money in under Other is not an expense left to sort.
    entry("2026-10-11", "REFUND", 900, "Other - Income", "income")
  ];
  return {
    viewId: "household",
    scope: "direct_plus_shared",
    month: "2026-10",
    today: "2026-11-14",
    entries,
    estimateIds: ["e010", "not-in-view"],
    statementAccounts: [
      account("acct-uob", "UOB One Card", "UOB", "2026-09"),
      account("acct-ocbc", "OCBC 365", "OCBC", "2026-10"),
      account("acct-dbs", "DBS Account", "DBS", "2026-08", { kind: "bank", ownerLabel: "Serene", ownerPersonId: "person-serene" })
    ],
    recentImports: [],
    splitBalances: [
      { id: "split-group-home", name: "Home", currency: "SGD", balanceMinor: 12_345, owes: "Net balance" },
      { id: "split-group-trip", name: "Bali trip", currency: "SGD", balanceMinor: 0, owes: "Settled up" }
    ],
    personNameById: NAMES,
    usuallyShared: [{
      key: "cold", shopName: "Cold Storage", groupId: "split-group-home", groupName: "Home", basisPoints: 5000,
      ownerPersonId: "person-ethan", ownerName: "Ethan", otherPersonId: "person-serene", otherPersonName: "Serene",
      evidenceCount: 5, matchedCount: 5, matchedBy: "description", currency: "SGD", totalMinor: 9_000,
      entries: [
        { id: "us-1", date: "2026-10-12", description: "Cold Storage", amountMinor: 4_000, currency: "SGD", ownerPersonId: "person-ethan", ownerName: "Ethan" },
        { id: "us-2", date: "2026-10-20", description: "Cold Storage", amountMinor: 5_000, currency: "SGD", ownerPersonId: "person-serene", ownerName: "Serene" },
        // September is another month's to wrap up.
        { id: "us-0", date: "2026-09-28", description: "Cold Storage", amountMinor: 3_000, currency: "SGD", ownerPersonId: "person-ethan", ownerName: "Ethan" }
      ]
    }],
    ...overrides
  };
}

test("a month that has ended can be wrapped up; the month in progress only in its last 3 days; never a future month", () => {
  assert.equal(MONTH_WRAP_UP_CONFIG.lastDaysOfMonth, 3);
  assert.equal(monthWrapUpIsOpen("2026-10", "2026-11-14"), true);
  assert.equal(monthWrapUpIsOpen("2025-01", "2026-11-14"), true);
  // November has 30 days: the 28th, 29th and 30th.
  assert.equal(monthWrapUpIsOpen("2026-11", "2026-11-27"), false);
  assert.equal(monthWrapUpIsOpen("2026-11", "2026-11-28"), true);
  assert.equal(monthWrapUpIsOpen("2026-11", "2026-11-30"), true);
  // February 2027 has 28 days.
  assert.equal(monthWrapUpIsOpen("2027-02", "2027-02-25"), false);
  assert.equal(monthWrapUpIsOpen("2027-02", "2027-02-26"), true);
  assert.equal(monthWrapUpIsOpen("2026-12", "2026-11-30"), false, "a future month");
  assert.equal(monthWrapUpIsOpen("", "2026-11-14"), false);
  assert.equal(monthWrapUpIsOpen("2026-13", "2026-11-14"), false);
  assert.equal(monthWrapUpEndDate("2026-10", "2026-11-14"), "2026-10-31");
  assert.equal(monthWrapUpEndDate("2026-11", "2026-11-29"), "2026-11-29");
});

test("each row's facts, with concrete values, from the projections it reuses", () => {
  const wrapUp = buildMonthWrapUp(octoberFacts());
  assert.equal(wrapUp.month, "2026-10");
  // What changed: the card's rows for the whole of October against September.
  assert.deepEqual(wrapUp.changed, {
    baseMonth: "2026-09",
    // Other (up $60) is the card's fourth row; the wrap-up lists the 3 biggest.
    rowCount: 4,
    rows: [
      { category: "Groceries", direction: "up", diffMinor: 33_210, amountMinor: 73_210, ids: ["e005", "e010"] },
      { category: "Home", direction: "down", diffMinor: -50_000, amountMinor: 0, ids: [] },
      { category: "Food & Drinks", direction: "down", diffMinor: -8_000, amountMinor: 12_000, ids: ["e006"] }
    ]
  });
  // Expenses still in Other; money in under Other is not one.
  assert.deepEqual(wrapUp.other, { ids: ["e008", "e009"], amountMinor: 6_000 });
  // Estimates: only the month's expenses in this view.
  assert.deepEqual(wrapUp.estimates, { ids: ["e010"], amountMinor: 3_210 });
  // Statements: the Import inbox expects October's from UOB (last: September)
  // and DBS (last: August); OCBC has October's.
  assert.deepEqual(wrapUp.statements, {
    accountCount: 3,
    missing: [{ id: "acct-dbs:2026-10:statement", name: "DBS Account" }, { id: "acct-uob:2026-10:statement", name: "UOB One Card" }]
  });
  // Splits: the household names both people; a settled group is left out.
  assert.deepEqual(wrapUp.splits.balances, [
    { id: "split-group-home", name: "Home", currency: "SGD", balanceMinor: 12_345, owes: "Serene owes Ethan", direction: "between" }
  ]);
  assert.deepEqual(wrapUp.splits.usuallySharedIds, ["us-1", "us-2"]);
});

test("a person view keeps its own words, tones and usually shared entries", () => {
  const facts = octoberFacts({
    viewId: "person-ethan",
    splitBalances: [{ id: "split-group-home", name: "Home", currency: "SGD", balanceMinor: -2_500, owes: "You owe Serene" }]
  });
  const wrapUp = buildMonthWrapUp(facts);
  assert.deepEqual(wrapUp.splits.balances.map((balance) => [balance.owes, balance.direction, balance.balanceMinor]), [["You owe Serene", "you_owe", -2_500]]);
  assert.deepEqual(wrapUp.splits.usuallySharedIds, ["us-1"], "only Ethan's own entry");
});

test("the month in progress is read up to today, and its statements are the ones expected after it ends", () => {
  const facts = octoberFacts({ month: "2026-10", today: "2026-10-29" });
  facts.usuallyShared[0].entries[1].date = "2026-10-30";
  const wrapUp = buildMonthWrapUp(facts);
  // OCBC's October statement is in already; UOB's and DBS's are not.
  assert.deepEqual(wrapUp.statements.missing.map((file) => file.name), ["DBS Account", "UOB One Card"]);
  assert.deepEqual(wrapUp.splits.usuallySharedIds, ["us-1"], "the 30th is after today");
  // What changed compares up to the 29th of each month.
  assert.equal(wrapUp.changed.baseMonth, "2026-09");
});

test("nothing to wrap up: a future month, a month with no entries, the month in progress too early", () => {
  assert.equal(buildMonthWrapUp(octoberFacts({ month: "2026-12" })), null, "a future month");
  assert.equal(buildMonthWrapUp(octoberFacts({ month: "2026-08" })), null, "no entries in August");
  assert.equal(buildMonthWrapUp(octoberFacts({ today: "2026-10-20" })), null, "October in progress, before its last days");
  // Nothing compared: no September spending means no "What changed".
  const alone = octoberFacts();
  alone.entries = alone.entries.filter((item) => item.date.startsWith("2026-10"));
  assert.equal(buildMonthWrapUp(alone).changed, null);
});

const planSections = (rows) => [
  { key: "planned_items", rows: [{ id: "rent", label: "Rent", plannedMinor: 200_000, actualMinor: 260_000 }] },
  { key: "budget_buckets", rows }
];

test("the checklist: what is left, a done check stays as a tick, and a check that cannot apply is left out", () => {
  const wrapUp = buildMonthWrapUp(octoberFacts());
  const result = buildMonthWrapUpChecks({
    wrapUp,
    planSections: planSections([
      { id: "groceries", label: "Groceries", categoryName: "Groceries", plannedMinor: 60_000, actualMinor: 73_210 },
      { id: "dining", label: "Dining", categoryName: "Food & Drinks", plannedMinor: 20_000, actualMinor: 12_000 },
      // 50 cents over is not over plan.
      { id: "taxi", label: "Taxi", categoryName: "Taxi", plannedMinor: 10_950, actualMinor: 11_000 }
    ]),
    monthNote: "  "
  });
  assert.deepEqual(result.checks, [
    { id: "other", done: false },
    { id: "estimates", done: false },
    { id: "statements", done: false },
    { id: "splits", done: false },
    { id: "plan", done: false },
    { id: "note", done: false }
  ]);
  // A planned item over its amount (Rent) is not a category over plan.
  assert.deepEqual(result.overPlan, [{ id: "groceries", name: "Groceries", plannedMinor: 60_000, actualMinor: 73_210, overMinor: 13_210 }]);
  assert.equal(result.doneCount, 0);
  assert.equal(result.wrappedUp, false);

  // No statement accounts in the view and no plan: those checks are left out.
  const quiet = buildMonthWrapUpChecks({
    wrapUp: { ...wrapUp, statements: { accountCount: 0, missing: [] } },
    planSections: planSections([{ id: "free", label: "Fun", plannedMinor: 0, actualMinor: 5_000 }]),
    monthNote: "Bali trip"
  });
  assert.deepEqual(quiet.checks.map((check) => [check.id, check.done]), [["other", false], ["estimates", false], ["splits", false], ["note", true]]);
  assert.equal(quiet.hasPlan, false);
});

test("a month with everything done folds to one line", () => {
  const wrapUp = buildMonthWrapUp(octoberFacts({
    estimateIds: [],
    statementAccounts: [account("acct-ocbc", "OCBC 365", "OCBC", "2026-10")],
    splitBalances: [{ id: "split-group-home", name: "Home", currency: "SGD", balanceMinor: 0, owes: "Settled up" }],
    usuallyShared: []
  }));
  wrapUp.other = { ids: [], amountMinor: 0 };
  const result = buildMonthWrapUpChecks({
    wrapUp,
    planSections: planSections([{ id: "groceries", label: "Groceries", plannedMinor: 80_000, actualMinor: 73_210 }]),
    monthNote: "A quiet month"
  });
  assert.deepEqual(result.checks.map((check) => check.done), [true, true, true, true, true, true]);
  assert.equal(result.doneCount, 6);
  assert.equal(result.wrappedUp, true);
});
