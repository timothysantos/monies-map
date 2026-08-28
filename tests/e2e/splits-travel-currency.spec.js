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

test("active simplified settlements are independent per currency", async ({ page }) => {
  await page.goto("/");
  await reseedDemo(page);
  const tokyo = await postJson(page, "/api/splits/groups/create", { name: `Tokyo checkpoint ${Date.now()}`, currency: "JPY" });
  await postJson(page, "/api/splits/expenses/create", {
    groupId: tokyo.groupId, date: "2026-08-10", description: "Tokyo train",
    categoryName: "Taxi", payerPersonName: "Tim", amountMinor: 2400,
    currency: "JPY", paymentMethod: "cash", paymentStatus: "recorded"
  });
  const jpyCheckpoint = await postJson(page, "/api/splits/checkpoints/create", {
    viewerPersonId: "person-tim", date: "2026-08-28", currency: "JPY"
  });
  const sgdCheckpoint = await postJson(page, "/api/splits/checkpoints/create", {
    viewerPersonId: "person-tim", date: "2026-08-28", currency: "SGD"
  });

  expect(jpyCheckpoint.currency).toBe("JPY");
  expect(sgdCheckpoint.currency).toBe("SGD");
  const data = await loadSplitsPage(page, { view: "person-tim", month: "2026-08" });
  expect(data.splitsPage.settlementCheckpoints.filter((item) => !["reopened", "voided"].includes(item.status)).map((item) => item.currency).sort()).toEqual(["JPY", "SGD"]);

  const duplicate = await page.request.post("/api/splits/checkpoints/create", {
    data: { viewerPersonId: "person-tim", date: "2026-08-28", currency: "JPY" }
  });
  expect(duplicate.status()).toBe(400);
  expect(await duplicate.text()).toContain("active JPY settlement checkpoint");
});

test("a group settlement closes only that group and creates no simplified checkpoint", async ({ page }) => {
  await page.goto("/");
  await reseedDemo(page);
  const tokyo = await postJson(page, "/api/splits/groups/create", { name: `Tokyo settle ${Date.now()}`, currency: "JPY" });
  const daily = await postJson(page, "/api/splits/groups/create", { name: `Daily life ${Date.now()}`, currency: "SGD" });
  const tripExpense = await postJson(page, "/api/splits/expenses/create", {
    groupId: tokyo.groupId, date: "2026-08-12", description: "Airport meal",
    categoryName: "Food & Drinks", payerPersonName: "Tim", amountMinor: 5000,
    currency: "JPY", paymentMethod: "cash", paymentStatus: "recorded"
  });
  const dailyExpense = await postJson(page, "/api/splits/expenses/create", {
    groupId: daily.groupId, date: "2026-08-20", description: "Home groceries",
    categoryName: "Groceries", payerPersonName: "Joyce", amountMinor: 4200,
    currency: "SGD", paymentMethod: "card", paymentStatus: "awaiting_statement"
  });
  await postJson(page, "/api/splits/settlements/create", {
    groupId: tokyo.groupId, date: "2026-08-28", fromPersonName: "Joyce",
    toPersonName: "Tim", amountMinor: 2500, currency: "JPY",
    paymentMethod: "cash", paymentStatus: "recorded", note: "Tokyo group settled independently"
  });

  const data = await loadSplitsPage(page, { view: "person-tim", month: "2026-08" });
  expect(data.splitsPage.activity.find((item) => item.id === tripExpense.splitExpenseId)?.batchClosedAt).toBeTruthy();
  expect(data.splitsPage.activity.find((item) => item.id === dailyExpense.splitExpenseId)?.batchClosedAt).toBeFalsy();
  expect(data.splitsPage.settlementCheckpoints).toHaveLength(0);
});

test("foreign pending card expense links to final SGD evidence without changing its JPY shares", async ({ page }) => {
  await page.goto("/");
  await reseedDemo(page);
  const seeded = await loadSplitsPage(page, { view: "person-tim", month: "2025-10" });
  const pantry = seeded.splitsPage.matches.find((match) => match.splitRecordId === "split-expense-nongroup-pantry-match");
  expect(pantry).toBeTruthy();
  const tokyo = await postJson(page, "/api/splits/groups/create", { name: `Tokyo FX ${Date.now()}`, currency: "JPY" });
  const expense = await postJson(page, "/api/splits/expenses/create", {
    groupId: tokyo.groupId,
    date: pantry.transactionDate,
    description: pantry.transactionDescription,
    categoryName: "Groceries",
    payerPersonName: "Tim",
    amountMinor: 2000000,
    splitAmountMinor: 700000,
    currency: "JPY",
    paymentMethod: "card",
    paymentStatus: "awaiting_statement"
  });

  const before = await loadSplitsPage(page, { view: "person-tim", month: "2025-10" });
  const fxMatch = before.splitsPage.matches.find((match) => match.splitRecordId === expense.splitExpenseId);
  expect(fxMatch?.requiresFxReview).toBe(true);
  expect(fxMatch?.splitCurrency).toBe("JPY");
  expect(fxMatch?.transactionCurrency).toBe("SGD");

  await postJson(page, "/api/splits/matches/link-expense", {
    splitExpenseId: expense.splitExpenseId,
    transactionId: fxMatch.transactionId
  });
  const after = await loadSplitsPage(page, { view: "person-tim", month: "2025-10" });
  const linked = after.splitsPage.activity.find((item) => item.id === expense.splitExpenseId);
  expect(linked.currency).toBe("JPY");
  expect(linked.totalAmountMinor).toBe(2000000);
  expect(linked.homeAmountMinor).toBe(Math.abs(fxMatch.amountMinor));
  expect(linked.paymentStatus).toBe("certified");
  expect(linked.shares.map((share) => share.amountMinor)).toEqual([700000, 1300000]);

  const reused = await page.request.post("/api/splits/matches/link-expense", {
    data: { splitExpenseId: "split-expense-nongroup-pantry-match", transactionId: fxMatch.transactionId }
  });
  expect(reused.ok()).toBe(false);
});

test("ledger entries cannot be inserted directly into a group with another currency", async ({ page }) => {
  await page.goto("/");
  await reseedDemo(page);
  const tokyo = await postJson(page, "/api/splits/groups/create", { name: `Tokyo invariant ${Date.now()}`, currency: "JPY" });
  const entry = await postJson(page, "/api/entries/create", {
    date: "2026-08-20", description: "SGD card purchase", accountName: "UOB One",
    categoryName: "Groceries", amountMinor: 2400, entryType: "expense",
    ownershipType: "direct", ownerName: "Tim"
  });
  const response = await page.request.post("/api/splits/expenses/from-entry", {
    data: { entryId: entry.entryId, splitGroupId: tokyo.groupId }
  });
  expect(response.status()).toBe(400);
  expect(await response.text()).toContain("group uses JPY");
});

test("foreign group settle-up links to an imported SGD transfer with certified FX evidence", async ({ page }) => {
  await page.goto("/");
  await reseedDemo(page);
  const seeded = await loadSplitsPage(page, { view: "person-tim", month: "2025-10" });
  const seededMatch = seeded.splitsPage.matches.find((match) => match.splitRecordId === "split-settlement-nongroup-transfer-match");
  expect(seededMatch).toBeTruthy();
  const tokyo = await postJson(page, "/api/splits/groups/create", { name: `Tokyo transfer ${Date.now()}`, currency: "JPY" });
  const settlement = await postJson(page, "/api/splits/settlements/create", {
    groupId: tokyo.groupId,
    date: seededMatch.transactionDate,
    fromPersonName: "Joyce",
    toPersonName: "Tim",
    amountMinor: 500000,
    currency: "JPY",
    paymentMethod: "bank",
    paymentStatus: "awaiting_statement"
  });

  const before = await loadSplitsPage(page, { view: "person-tim", month: "2025-10" });
  const fxMatch = before.splitsPage.matches.find((match) => match.splitRecordId === settlement.settlementId);
  expect(fxMatch?.requiresFxReview).toBe(true);
  expect(fxMatch?.transactionCurrency).toBe("SGD");
  await postJson(page, "/api/splits/matches/link-settlement", {
    settlementId: settlement.settlementId,
    transactionId: fxMatch.transactionId
  });

  const after = await loadSplitsPage(page, { view: "person-tim", month: "2025-10" });
  const linked = after.splitsPage.activity.find((item) => item.id === settlement.settlementId);
  expect(linked.currency).toBe("JPY");
  expect(linked.totalAmountMinor).toBe(500000);
  expect(linked.paymentStatus).toBe("certified");
  expect(linked.fxRateBasisPoints).toBeGreaterThan(0);
});

test("holiday cash and bank/card groups keep purchase sources separate", async ({ page }) => {
  await page.goto("/");
  await reseedDemo(page);
  const cashGroup = await postJson(page, "/api/splits/groups/create", {
    name: `Tokyo cash ${Date.now()}`, currency: "JPY", expenseSource: "cash"
  });
  const ledgerGroup = await postJson(page, "/api/splits/groups/create", {
    name: `Tokyo cards ${Date.now()}`, currency: "JPY", expenseSource: "ledger"
  });

  const cashExpense = await postJson(page, "/api/splits/expenses/create", {
    groupId: cashGroup.groupId, date: "2026-08-10", description: "Cash ramen",
    categoryName: "Food & Drinks", payerPersonName: "Tim", amountMinor: 3000,
    currency: "JPY", paymentMethod: "cash", paymentStatus: "recorded"
  });
  expect(cashExpense.splitExpenseId).toBeTruthy();

  const rejectedCashInLedgerGroup = await page.request.post("/api/splits/expenses/create", {
    data: {
      groupId: ledgerGroup.groupId, date: "2026-08-10", description: "Untracked cash",
      categoryName: "Food & Drinks", payerPersonName: "Tim", amountMinor: 3000,
      currency: "JPY", paymentMethod: "cash", paymentStatus: "recorded"
    }
  });
  expect(rejectedCashInLedgerGroup.status()).toBe(400);
  expect(await rejectedCashInLedgerGroup.text()).toContain("Bank/card purchases");

  const rejectedCardInCashGroup = await page.request.post("/api/splits/expenses/create", {
    data: {
      groupId: cashGroup.groupId, date: "2026-08-10", description: "Card in cash group",
      categoryName: "Food & Drinks", payerPersonName: "Tim", amountMinor: 3000,
      currency: "JPY", paymentMethod: "card", paymentStatus: "awaiting_statement"
    }
  });
  expect(rejectedCardInCashGroup.status()).toBe(400);
  expect(await rejectedCardInCashGroup.text()).toContain("Cash only");

  const loaded = await loadSplitsPage(page, { view: "person-tim", month: "2026-08" });
  expect(loaded.splitsPage.groups.find((group) => group.id === cashGroup.groupId).expenseSource).toBe("cash");
  expect(loaded.splitsPage.groups.find((group) => group.id === ledgerGroup.groupId).expenseSource).toBe("ledger");
});
