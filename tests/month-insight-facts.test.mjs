// The Month money check-in counts what the Month "Actual spend" card counts:
// every entry for the household; for a person, only their own entries in the
// selected scope (direct entries in full, split-linked entries at their
// share). The page DTO carries every household entry adjusted for the view,
// so the check-in must filter them the way the Worker does.
import assert from "node:assert/strict";
import test from "node:test";

import { selectMonthInsightEntries } from "../src/client/month-insight-facts.js";
import { incomeMinor, spendingMinor } from "../src/domain/category-offset.ts";
import { adjustEntriesForView, buildMonthPage } from "../src/domain/month-projection.ts";
import { buildPersonScopes, effectiveScopeForView } from "../src/domain/person-view-scope.ts";

const MONTH = "2025-10";

function entry(id, fields) {
  return {
    id,
    date: `${MONTH}-10`,
    description: id,
    accountName: "UOB One",
    categoryName: "Dining",
    entryType: "expense",
    ownershipType: "direct",
    offsetsCategory: false,
    ...fields
  };
}

const share = (personId, amountMinor) => ({ personId, personName: personId, ratioBasisPoints: 5_000, amountMinor });

// Raw month entries as the Worker loads them.
const LEDGER = [
  // Joyce paid; linked to a split shared with Tim.
  entry("dining-split", { ownerName: "Joyce", amountMinor: 71_319, splits: [share("person-joyce", 71_319)], linkedSplitExpenseId: "split-dining", linkedSplitShares: [share("person-tim", 35_659), share("person-joyce", 35_660)] }),
  entry("baby-split", { ownerName: "Joyce", amountMinor: 23_407, splits: [share("person-joyce", 23_407)], linkedSplitExpenseId: "split-baby", linkedSplitShares: [share("person-tim", 11_703), share("person-joyce", 11_704)] }),
  // Joyce owns the ledger row, but the split gives her no share.
  entry("tim-only-split", { ownerName: "Joyce", amountMinor: 2_000, splits: [share("person-joyce", 2_000)], linkedSplitExpenseId: "split-tim", linkedSplitShares: [share("person-tim", 2_000)] }),
  entry("joyce-groceries", { ownerName: "Joyce", categoryName: "Groceries", amountMinor: 18_640, splits: [share("person-joyce", 18_640)] }),
  // Someone else's direct entries never count for Joyce.
  entry("tim-transport", { ownerName: "Tim", categoryName: "Transport", amountMinor: 5_000, splits: [share("person-tim", 5_000)] }),
  entry("tim-salary", { ownerName: "Tim", categoryName: "Salary", entryType: "income", amountMinor: 300_000, splits: [share("person-tim", 300_000)] }),
  // A shared-ownership entry that is not linked to a split: each owner's part.
  entry("shared-utilities", { ownershipType: "shared", categoryName: "Utilities", amountMinor: 10_000, splits: [share("person-tim", 4_000), share("person-joyce", 6_000)] })
];

// The Month page DTO for a view and scope, built as month-page.ts builds it.
function monthPageFor(viewId, scope) {
  return buildMonthPage(viewId, scope, [], adjustEntriesForView(LEDGER, viewId), [], [], MONTH, null);
}

// What the check-in's entries add up to, counted as the Actual spend card
// counts them (a payback lowers its category: category-offset.ts).
function totalsFor(viewId, scope) {
  const entries = selectMonthInsightEntries(monthPageFor(viewId, scope), viewId);
  return {
    entryCount: entries.length,
    spendMinor: entries.reduce((total, item) => total + spendingMinor(item, Math.abs(item.amountMinor)), 0),
    incomeMinor: entries.reduce((total, item) => total + incomeMinor(item, Math.abs(item.amountMinor)), 0)
  };
}

function actualSpendCard(monthPage) {
  return monthPage.metricCards.find((card) => card.label === "Actual spend").amountMinor;
}

test("in every view and scope the check-in's spend is the Actual spend card", () => {
  const expected = {
    household: { direct: 130_366, shared: 130_366, direct_plus_shared: 130_366 },
    "person-joyce": { direct: 24_640, shared: 47_364, direct_plus_shared: 72_004 },
    "person-tim": { direct: 9_000, shared: 49_362, direct_plus_shared: 58_362 }
  };
  for (const [viewId, byScope] of Object.entries(expected)) {
    for (const [scope, spendMinor] of Object.entries(byScope)) {
      const monthPage = monthPageFor(viewId, scope);
      assert.equal(actualSpendCard(monthPage), spendMinor, `${viewId} ${scope} card`);
      assert.equal(totalsFor(viewId, scope).spendMinor, spendMinor, `${viewId} ${scope} check-in`);
    }
  }
});

test("a person's check-in counts only their entries in the scope, at their own amounts", () => {
  const ids = (viewId, scope) => selectMonthInsightEntries(monthPageFor(viewId, scope), viewId)
    .map((item) => [item.id, item.amountMinor]);

  assert.deepEqual(ids("person-joyce", "direct"), [["joyce-groceries", 18_640], ["shared-utilities", 6_000]]);
  assert.deepEqual(ids("person-joyce", "shared"), [["dining-split", 35_660], ["baby-split", 11_704]]);
  assert.deepEqual(ids("person-tim", "direct_plus_shared"), [
    ["dining-split", 35_659],
    ["baby-split", 11_703],
    ["tim-only-split", 2_000],
    ["tim-transport", 5_000],
    ["tim-salary", 300_000],
    ["shared-utilities", 4_000]
  ]);

  const joyce = totalsFor("person-joyce", "direct_plus_shared");
  assert.equal(joyce.entryCount, 4);
  // Tim's salary is not Joyce's income, and his transport is not her spend.
  assert.equal(joyce.incomeMinor, 0);
  assert.equal(joyce.spendMinor, 35_660 + 11_704 + 18_640 + 6_000);
});

test("the household check-in counts every entry whatever scope the route carries", () => {
  for (const scope of ["direct", "shared", "direct_plus_shared"]) {
    const totals = totalsFor("household", scope);
    assert.equal(totals.entryCount, LEDGER.length);
    assert.equal(totals.incomeMinor, 300_000);
    assert.equal(totals.spendMinor, 130_366);
  }
});

test("a scope change changes the entries the check-in counts; the same scope keeps them", () => {
  const ids = (scope) => selectMonthInsightEntries(monthPageFor("person-joyce", scope), "person-joyce").map((item) => item.id);
  assert.notDeepEqual(ids("direct"), ids("shared"));
  assert.deepEqual(ids("direct"), ids("direct"));
});

test("a scope the route does not know counts as Direct + Shared, and the household is always Combined", () => {
  assert.equal(effectiveScopeForView("person-joyce", "everything"), "direct_plus_shared");
  assert.equal(effectiveScopeForView("person-joyce", undefined), "direct_plus_shared");
  assert.equal(effectiveScopeForView("person-joyce", "shared"), "shared");
  assert.equal(effectiveScopeForView("household", "shared"), "direct_plus_shared");
  const unknownScopePage = { ...monthPageFor("person-joyce", "direct_plus_shared"), selectedScope: "everything" };
  assert.equal(selectMonthInsightEntries(unknownScopePage, "person-joyce").length, 4);
  assert.deepEqual(buildPersonScopes("household"), [{ key: "direct_plus_shared", label: "Combined" }]);
  assert.deepEqual(buildPersonScopes("person-joyce").map((scope) => scope.label), ["Direct ownership", "Shared", "Direct + Shared"]);
});

test("a person's Month check-in never calls a share of someone else's entry a purchase or payment", async () => {
  const { buildMonthSignals } = await import("../src/domain/money-signals/month-signals.ts");
  for (const scope of ["shared", "direct_plus_shared"]) {
    const entries = selectMonthInsightEntries(monthPageFor("person-tim", scope), "person-tim");
    const spendMinor = entries.filter((item) => item.entryType === "expense").reduce((total, item) => total + item.amountMinor, 0);
    const signals = buildMonthSignals({
      audience: "person",
      viewLabel: "Tim",
      month: MONTH,
      today: "2026-09-27",
      entries,
      planSections: [],
      incomeRows: [],
      summary: { estimatedExpensesMinor: 10_000, realExpensesMinor: spendMinor, plannedIncomeMinor: 0, actualIncomeMinor: 0 },
      accountPills: [],
      formatMoney: (amountMinor) => String(amountMinor)
    });
    const copy = signals.flatMap((signal) => signal.phrasings.flatMap((phrasing) => [phrasing.fact, phrasing.think]));
    // Joyce paid the dinner; Tim's part of it is what his check-in counts.
    const oneOff = signals.find((signal) => signal.key === "one-off-over-plan");
    assert.equal(oneOff.weight, spendMinor - 10_000, scope);
    assert.match(oneOff.phrasings[0].fact, /^Dining-split/);
    assert.ok(copy.every((line) => !/purchase|\bpaid\b/i.test(line)), `${scope}: ${copy.join(" | ")}`);
  }
});

// The Money consequence map (and its "Snapshot confidence" lane) is
// retired. The view's wallet health reaches the Month check-in only as the
// statement-gap To do, whose "Compare with the statement" replaced the map's
// "Review bank-record gaps" link.
const pill = (accountId, fields) => ({
  accountId,
  accountName: accountId,
  ownerLabel: "Joyce",
  balanceMinor: 0,
  unresolvedTransferCount: 0,
  ...fields
});

async function monthSignalsWith(accountPills) {
  const { buildMonthSignals } = await import("../src/domain/money-signals/month-signals.ts");
  return buildMonthSignals({
    audience: "person",
    viewLabel: "Joyce",
    month: MONTH,
    today: "2026-09-27",
    entries: selectMonthInsightEntries(monthPageFor("person-joyce", "direct_plus_shared"), "person-joyce"),
    planSections: [],
    incomeRows: [],
    summary: null,
    accountPills,
    formatMoney: (amountMinor) => `$${(amountMinor / 100).toFixed(2)}`
  });
}

test("a statement mismatch in the view's wallets is the Month check-in's To do, with Compare with the statement", async () => {
  const signals = await monthSignalsWith([
    pill("uob-one", { reconciliationStatus: "matched", latestCheckpointMonth: "2025-09", latestCheckpointDeltaMinor: 0 }),
    pill("ocbc-365", { reconciliationStatus: "mismatch", latestCheckpointMonth: "2025-09", latestCheckpointDeltaMinor: -4_280 })
  ]);
  const gap = signals.find((signal) => signal.key === "statement-gap:ocbc-365");
  assert.equal(gap.kind, "quick_fix");
  assert.deepEqual(gap.action, { id: "review-statement", label: "Compare with the statement" });
  assert.match(gap.phrasings.map((phrasing) => phrasing.fact).join(" "), /\$42\.80/);
});

test("matched wallets give no Quick fix", async () => {
  const signals = await monthSignalsWith([
    pill("uob-one", { reconciliationStatus: "matched", latestCheckpointMonth: "2025-09", latestCheckpointDeltaMinor: 0 }),
    pill("ocbc-365", { reconciliationStatus: "needs_checkpoint", unresolvedTransferCount: 2 })
  ]);
  assert.equal(signals.some((signal) => signal.key.startsWith("statement-gap")), false);
});
