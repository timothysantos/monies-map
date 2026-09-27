import assert from "node:assert/strict";
import test from "node:test";

import { buildSplitsPage } from "../src/domain/splits-projection.ts";
import { getArchivedBatchSummary, selectSplitDonutChart } from "../src/client/split-helpers.js";

const people = { "person-tim": "Tim", "person-joyce": "Joyce" };

function expense({ id, groupId, groupName, currency, totalAmountMinor }) {
  const half = totalAmountMinor / 2;
  return {
    id,
    groupId,
    groupName,
    date: "2025-10-14",
    description: `${groupName} dinner`,
    categoryName: "Food & Drinks",
    payerPersonId: "person-joyce",
    payerPersonName: "Joyce",
    totalAmountMinor,
    currency,
    paymentMethod: "cash",
    paymentStatus: "recorded",
    shares: [
      { personId: "person-tim", personName: "Tim", ratioBasisPoints: 5000, amountMinor: half },
      { personId: "person-joyce", personName: "Joyce", ratioBasisPoints: 5000, amountMinor: half }
    ]
  };
}

function buildPage(viewId) {
  return buildSplitsPage(
    viewId,
    [
      { id: "split-group-tokyo", name: "Tokyo trip", sortOrder: 1, currency: "JPY", expenseSource: "cash" },
      { id: "split-group-kuwait", name: "Kuwait trip", sortOrder: 2, currency: "KWD", expenseSource: "cash" },
      { id: "split-group-home", name: "Home", sortOrder: 3, currency: "SGD", expenseSource: "mixed" }
    ],
    [
      expense({ id: "split-expense-yen", groupId: "split-group-tokyo", groupName: "Tokyo trip", currency: "JPY", totalAmountMinor: 1_200_000 }),
      expense({ id: "split-expense-dinar", groupId: "split-group-kuwait", groupName: "Kuwait trip", currency: "KWD", totalAmountMinor: 2_000 }),
      expense({ id: "split-expense-sgd", groupId: "split-group-home", groupName: "Home", currency: "SGD", totalAmountMinor: 1_200_000 })
    ],
    [],
    [],
    [],
    "2025-10",
    people
  );
}

test("a travel group's pill balance is written in the group currency", () => {
  const groups = buildPage("person-tim").groups;
  const byId = Object.fromEntries(groups.map((group) => [group.id, group]));

  assert.equal(byId["split-group-tokyo"].currency, "JPY");
  assert.equal(byId["split-group-tokyo"].balanceMinor, -600_000);
  assert.equal(byId["split-group-tokyo"].summaryText, "You owe Joyce JP¥6,000");
  assert.equal(byId["split-group-kuwait"].summaryText, "You owe Joyce KWD\u00a010.000");
  // Negative: a home-currency group keeps dollars with cents.
  assert.equal(byId["split-group-home"].summaryText, "You owe Joyce $6,000.00");
  assert.equal(byId["split-group-none"].summaryText, "Settled up");
});

test("the household and the partner view also use the group currency", () => {
  const household = buildPage("household").groups.find((group) => group.id === "split-group-tokyo");
  assert.equal(household.summaryText, "Net balance JP¥6,000");
  const joyce = buildPage("person-joyce").groups.find((group) => group.id === "split-group-tokyo");
  assert.equal(joyce.summaryText, "Tim owes you JP¥6,000");
});

test("an archived travel batch names its settle-up in the group currency", () => {
  const settlement = {
    kind: "settlement",
    date: "2025-10-20",
    fromPersonId: "person-tim",
    fromPersonName: "Tim",
    toPersonId: "person-joyce",
    toPersonName: "Joyce",
    totalAmountMinor: 600_000,
    currency: "JPY"
  };
  const batch = { label: "Tokyo trip settled batch", items: [settlement] };

  assert.deepEqual(getArchivedBatchSummary(batch, "person-tim"), {
    title: "Tim fully settled up with Joyce",
    subtitle: "You paid Joyce JP¥6,000"
  });
  assert.equal(getArchivedBatchSummary(batch, "person-joyce").subtitle, "Tim paid you JP¥6,000");
  assert.equal(getArchivedBatchSummary(batch, "household").subtitle, "Tim paid Joyce JP¥6,000");
  // Negative: an SGD settle-up (or one with no stored currency) stays in dollars.
  assert.equal(getArchivedBatchSummary({ ...batch, items: [{ ...settlement, currency: "SGD" }] }, "household").subtitle, "Tim paid Joyce $6,000.00");
  assert.equal(getArchivedBatchSummary({ ...batch, items: [{ ...settlement, currency: undefined }] }, "household").subtitle, "Tim paid Joyce $6,000.00");
});

test("the Splits category donut charts each currency on its own and never counts yen or dinars as dollars", () => {
  const page = buildPage("person-tim");
  // Joyce paid each: Tim's view charts his half, in the expense's currency.
  assert.deepEqual(page.donutChart.map(({ label, valueMinor, entryCount }) => ({ label, valueMinor, entryCount })), [
    { label: "Food & Drinks", valueMinor: 600_000, entryCount: 1 }
  ]);
  assert.deepEqual(Object.keys(page.donutChartsByCurrency), ["JPY", "KWD"]);
  assert.equal(page.donutChartsByCurrency.JPY[0].valueMinor, 600_000);
  assert.equal(page.donutChartsByCurrency.KWD[0].valueMinor, 1_000);

  // The Splits panel shows the chart for the active group's currency.
  assert.equal(selectSplitDonutChart(page, "JPY"), page.donutChartsByCurrency.JPY);
  assert.equal(selectSplitDonutChart(page, "KWD"), page.donutChartsByCurrency.KWD);
  assert.equal(selectSplitDonutChart(page, "SGD"), page.donutChart);
  assert.equal(selectSplitDonutChart(page, undefined), page.donutChart);

  // Negative: an SGD-only page has no per-currency charts, and a travel
  // group without open expenses shows an empty chart, never the SGD one.
  const sgdOnly = buildSplitsPage(
    "person-tim",
    [{ id: "split-group-tokyo", name: "Tokyo trip", sortOrder: 1, currency: "JPY", expenseSource: "cash" }],
    [expense({ id: "split-expense-sgd", groupId: undefined, groupName: "Non-group expenses", currency: "SGD", totalAmountMinor: 1_000 })],
    [],
    [],
    [],
    "2025-10",
    people
  );
  assert.equal("donutChartsByCurrency" in sgdOnly, false);
  assert.equal(sgdOnly.donutChart[0].valueMinor, 500);
  assert.deepEqual(selectSplitDonutChart(sgdOnly, "JPY"), []);
});
