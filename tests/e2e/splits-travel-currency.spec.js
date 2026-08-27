import { expect, test } from "@playwright/test";

import { loadSplitsPage, postJson, reseedDemo } from "./helpers";

test("travel group keeps foreign amount and matches a later home-currency transfer with explicit FX", async ({ page }) => {
  await page.goto("/");
  await reseedDemo(page);
  const group = await postJson(page, "/api/splits/groups/create", { name: `Tokyo ${Date.now()}`, currency: "JPY" });
  const expense = await postJson(page, "/api/splits/expenses/create", {
    groupId: group.groupId,
    date: "2026-08-10",
    description: "Family ramen",
    categoryName: "Food & Drinks",
    payerPersonName: "Joyce",
    amountMinor: 20000,
    currency: "JPY",
    paymentMethod: "card",
    paymentStatus: "awaiting_statement",
    note: "Baby ate from the shared meal"
  });

  const pageData = await loadSplitsPage(page, { view: "person-tim", month: "2026-08" });
  const savedExpense = pageData.splitsPage.activity.find((item) => item.id === expense.splitExpenseId);
  expect(savedExpense.currency).toBe("JPY");
  expect(savedExpense.paymentStatus).toBe("awaiting_statement");

  const checkpoint = await postJson(page, "/api/splits/checkpoints/create", { viewerPersonId: "person-tim", date: "2026-08-27", currency: "JPY" });
  const transfer = await postJson(page, "/api/entries/create", {
    date: "2026-08-27",
    description: "Travel repayment",
    accountName: "UOB One",
    categoryName: "Transfer",
    amountMinor: 750,
    entryType: "transfer",
    transferDirection: "in",
    ownershipType: "direct",
    ownerName: "Tim"
  });

  const match = await postJson(page, "/api/splits/checkpoints/match", {
    checkpointId: checkpoint.checkpointId,
    transactionId: transfer.entryId,
    fxRateBasisPoints: 13333
  });
  expect(match.matchedAmountMinor).toBeGreaterThan(0);
  const afterMatch = await loadSplitsPage(page, { view: "person-tim", month: "2026-08" });
  expect(afterMatch.splitsPage.settlementCheckpoints[0].currency).toBe("JPY");
  expect(afterMatch.splitsPage.settlementCheckpoints[0].matchedTransfers[0].currency).toBe("SGD");
});
