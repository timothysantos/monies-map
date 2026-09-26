// Split workspace API contracts through the real Worker and a real local D1:
// travel currencies and FX evidence, per-currency settlement checkpoints,
// purchase sources, deleted-record history and restore, viewer amounts and
// the Splits page month slice. Moved from the Playwright specs
// splits-travel-currency, splits-activity-history, splits-page-payload,
// splits-viewer-amounts, splits-create-expense and entries-add-to-splits,
// where they never touched the page (see docs/audits/e2e-unit-audit.md); the
// requests and assertions are unchanged. The browser Splits workflows stay in
// tests/e2e/splits-*.spec.js.
import test from "node:test";
import { expect } from "@playwright/test";

import { loadEntriesPage, loadSplitsPage, postJson, useSeededWorkerRequest } from "./support/worker-request.mjs";

const openRequest = useSeededWorkerRequest();

async function getJson(request, path) {
  const response = await request.get(path);
  expect(response.ok(), await response.text()).toBeTruthy();
  return response.json();
}

// ------------------------------------------------ travel groups and currency

test("travel group keeps foreign amount and matches a later home-currency transfer with explicit FX", async (t) => {
  const request = await openRequest(t);
  const group = await postJson(request, "/api/splits/groups/create", { name: `Tokyo ${Date.now()}`, currency: "JPY" });
  const expense = await postJson(request, "/api/splits/expenses/create", {
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

  const pageData = await loadSplitsPage(request, { view: "person-tim", month: "2026-08" });
  const savedExpense = pageData.splitsPage.activity.find((item) => item.id === expense.splitExpenseId);
  expect(savedExpense.currency).toBe("JPY");
  expect(savedExpense.paymentStatus).toBe("awaiting_statement");

  const checkpoint = await postJson(request, "/api/splits/checkpoints/create", { viewerPersonId: "person-tim", date: "2026-08-27", currency: "JPY" });
  const transfer = await postJson(request, "/api/entries/create", {
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

  const match = await postJson(request, "/api/splits/checkpoints/match", {
    checkpointId: checkpoint.checkpointId,
    transactionId: transfer.entryId,
    fxRateBasisPoints: 13333
  });
  expect(match.matchedAmountMinor).toBeGreaterThan(0);
  const afterMatch = await loadSplitsPage(request, { view: "person-tim", month: "2026-08" });
  expect(afterMatch.splitsPage.settlementCheckpoints[0].currency).toBe("JPY");
  expect(afterMatch.splitsPage.settlementCheckpoints[0].matchedTransfers[0].currency).toBe("SGD");
});

test("active simplified settlements are independent per currency", async (t) => {
  const request = await openRequest(t);
  const tokyo = await postJson(request, "/api/splits/groups/create", { name: `Tokyo checkpoint ${Date.now()}`, currency: "JPY" });
  await postJson(request, "/api/splits/expenses/create", {
    groupId: tokyo.groupId, date: "2026-08-10", description: "Tokyo train",
    categoryName: "Taxi", payerPersonName: "Tim", amountMinor: 2400,
    currency: "JPY", paymentMethod: "cash", paymentStatus: "recorded"
  });
  const jpyCheckpoint = await postJson(request, "/api/splits/checkpoints/create", {
    viewerPersonId: "person-tim", date: "2026-08-28", currency: "JPY"
  });
  const sgdCheckpoint = await postJson(request, "/api/splits/checkpoints/create", {
    viewerPersonId: "person-tim", date: "2026-08-28", currency: "SGD"
  });

  expect(jpyCheckpoint.currency).toBe("JPY");
  expect(sgdCheckpoint.currency).toBe("SGD");
  const data = await loadSplitsPage(request, { view: "person-tim", month: "2026-08" });
  expect(data.splitsPage.settlementCheckpoints.filter((item) => !["reopened", "voided"].includes(item.status)).map((item) => item.currency).sort()).toEqual(["JPY", "SGD"]);

  const duplicate = await request.post("/api/splits/checkpoints/create", {
    data: { viewerPersonId: "person-tim", date: "2026-08-28", currency: "JPY" }
  });
  expect(duplicate.status()).toBe(400);
  expect(await duplicate.text()).toContain("active JPY settlement checkpoint");
});

test("a group settlement closes only that group and creates no simplified checkpoint", async (t) => {
  const request = await openRequest(t);
  const tokyo = await postJson(request, "/api/splits/groups/create", { name: `Tokyo settle ${Date.now()}`, currency: "JPY" });
  const daily = await postJson(request, "/api/splits/groups/create", { name: `Daily life ${Date.now()}`, currency: "SGD" });
  const tripExpense = await postJson(request, "/api/splits/expenses/create", {
    groupId: tokyo.groupId, date: "2026-08-12", description: "Airport meal",
    categoryName: "Food & Drinks", payerPersonName: "Tim", amountMinor: 5000,
    currency: "JPY", paymentMethod: "cash", paymentStatus: "recorded"
  });
  const dailyExpense = await postJson(request, "/api/splits/expenses/create", {
    groupId: daily.groupId, date: "2026-08-20", description: "Home groceries",
    categoryName: "Groceries", payerPersonName: "Joyce", amountMinor: 4200,
    currency: "SGD", paymentMethod: "card", paymentStatus: "awaiting_statement"
  });
  await postJson(request, "/api/splits/settlements/create", {
    groupId: tokyo.groupId, date: "2026-08-28", fromPersonName: "Joyce",
    toPersonName: "Tim", amountMinor: 2500, currency: "JPY",
    paymentMethod: "cash", paymentStatus: "recorded", note: "Tokyo group settled independently"
  });

  const data = await loadSplitsPage(request, { view: "person-tim", month: "2026-08" });
  expect(data.splitsPage.activity.find((item) => item.id === tripExpense.splitExpenseId)?.batchClosedAt).toBeTruthy();
  expect(data.splitsPage.activity.find((item) => item.id === dailyExpense.splitExpenseId)?.batchClosedAt).toBeFalsy();
  expect(data.splitsPage.settlementCheckpoints).toHaveLength(0);
});

test("foreign pending card expense links to final SGD evidence without changing its JPY shares", async (t) => {
  const request = await openRequest(t);
  const seeded = await loadSplitsPage(request, { view: "person-tim", month: "2025-10" });
  const pantry = seeded.splitsPage.matches.find((match) => match.splitRecordId === "split-expense-nongroup-pantry-match");
  expect(pantry).toBeTruthy();
  const tokyo = await postJson(request, "/api/splits/groups/create", { name: `Tokyo FX ${Date.now()}`, currency: "JPY" });
  const expense = await postJson(request, "/api/splits/expenses/create", {
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

  const before = await loadSplitsPage(request, { view: "person-tim", month: "2025-10" });
  const fxMatch = before.splitsPage.matches.find((match) => match.splitRecordId === expense.splitExpenseId);
  expect(fxMatch?.requiresFxReview).toBe(true);
  expect(fxMatch?.splitCurrency).toBe("JPY");
  expect(fxMatch?.transactionCurrency).toBe("SGD");

  await postJson(request, "/api/splits/matches/link-expense", {
    splitExpenseId: expense.splitExpenseId,
    transactionId: fxMatch.transactionId
  });
  const after = await loadSplitsPage(request, { view: "person-tim", month: "2025-10" });
  const linked = after.splitsPage.activity.find((item) => item.id === expense.splitExpenseId);
  expect(linked.currency).toBe("JPY");
  expect(linked.totalAmountMinor).toBe(2000000);
  expect(linked.homeAmountMinor).toBe(Math.abs(fxMatch.amountMinor));
  expect(linked.paymentStatus).toBe("certified");
  expect(linked.shares.map((share) => share.amountMinor)).toEqual([700000, 1300000]);

  const reused = await request.post("/api/splits/matches/link-expense", {
    data: { splitExpenseId: "split-expense-nongroup-pantry-match", transactionId: fxMatch.transactionId }
  });
  expect(reused.ok()).toBe(false);
});

test("ledger entries cannot be inserted directly into a group with another currency", async (t) => {
  const request = await openRequest(t);
  const tokyo = await postJson(request, "/api/splits/groups/create", { name: `Tokyo invariant ${Date.now()}`, currency: "JPY" });
  const entry = await postJson(request, "/api/entries/create", {
    date: "2026-08-20", description: "SGD card purchase", accountName: "UOB One",
    categoryName: "Groceries", amountMinor: 2400, entryType: "expense",
    ownershipType: "direct", ownerName: "Tim"
  });
  const response = await request.post("/api/splits/expenses/from-entry", {
    data: { entryId: entry.entryId, splitGroupId: tokyo.groupId }
  });
  expect(response.status()).toBe(400);
  expect(await response.text()).toContain("group uses JPY");
});

test("foreign group settle-up links to an imported SGD transfer with certified FX evidence", async (t) => {
  const request = await openRequest(t);
  const seeded = await loadSplitsPage(request, { view: "person-tim", month: "2025-10" });
  const seededMatch = seeded.splitsPage.matches.find((match) => match.splitRecordId === "split-settlement-nongroup-transfer-match");
  expect(seededMatch).toBeTruthy();
  const tokyo = await postJson(request, "/api/splits/groups/create", { name: `Tokyo transfer ${Date.now()}`, currency: "JPY" });
  const settlement = await postJson(request, "/api/splits/settlements/create", {
    groupId: tokyo.groupId,
    date: seededMatch.transactionDate,
    fromPersonName: "Joyce",
    toPersonName: "Tim",
    amountMinor: 500000,
    currency: "JPY",
    paymentMethod: "bank",
    paymentStatus: "awaiting_statement"
  });

  const before = await loadSplitsPage(request, { view: "person-tim", month: "2025-10" });
  const fxMatch = before.splitsPage.matches.find((match) => match.splitRecordId === settlement.settlementId);
  expect(fxMatch?.requiresFxReview).toBe(true);
  expect(fxMatch?.transactionCurrency).toBe("SGD");
  await postJson(request, "/api/splits/matches/link-settlement", {
    settlementId: settlement.settlementId,
    transactionId: fxMatch.transactionId
  });

  const after = await loadSplitsPage(request, { view: "person-tim", month: "2025-10" });
  const linked = after.splitsPage.activity.find((item) => item.id === settlement.settlementId);
  expect(linked.currency).toBe("JPY");
  expect(linked.totalAmountMinor).toBe(500000);
  expect(linked.paymentStatus).toBe("certified");
  expect(linked.fxRateBasisPoints).toBeGreaterThan(0);
});

test("holiday cash and bank/card groups keep purchase sources separate", async (t) => {
  const request = await openRequest(t);
  const cashGroup = await postJson(request, "/api/splits/groups/create", {
    name: `Tokyo cash ${Date.now()}`, currency: "JPY", expenseSource: "cash"
  });
  const ledgerGroup = await postJson(request, "/api/splits/groups/create", {
    name: `Tokyo cards ${Date.now()}`, currency: "JPY", expenseSource: "ledger"
  });

  const cashExpense = await postJson(request, "/api/splits/expenses/create", {
    groupId: cashGroup.groupId, date: "2026-08-10", description: "Cash ramen",
    categoryName: "Food & Drinks", payerPersonName: "Tim", amountMinor: 3000,
    currency: "JPY", paymentMethod: "cash", paymentStatus: "recorded"
  });
  expect(cashExpense.splitExpenseId).toBeTruthy();

  const rejectedCashInLedgerGroup = await request.post("/api/splits/expenses/create", {
    data: {
      groupId: ledgerGroup.groupId, date: "2026-08-10", description: "Untracked cash",
      categoryName: "Food & Drinks", payerPersonName: "Tim", amountMinor: 3000,
      currency: "JPY", paymentMethod: "cash", paymentStatus: "recorded"
    }
  });
  expect(rejectedCashInLedgerGroup.status()).toBe(400);
  expect(await rejectedCashInLedgerGroup.text()).toContain("Bank/card purchases");

  const rejectedCardInCashGroup = await request.post("/api/splits/expenses/create", {
    data: {
      groupId: cashGroup.groupId, date: "2026-08-10", description: "Card in cash group",
      categoryName: "Food & Drinks", payerPersonName: "Tim", amountMinor: 3000,
      currency: "JPY", paymentMethod: "card", paymentStatus: "awaiting_statement"
    }
  });
  expect(rejectedCardInCashGroup.status()).toBe(400);
  expect(await rejectedCardInCashGroup.text()).toContain("Cash only");

  const loaded = await loadSplitsPage(request, { view: "person-tim", month: "2026-08" });
  expect(loaded.splitsPage.groups.find((group) => group.id === cashGroup.groupId).expenseSource).toBe("cash");
  expect(loaded.splitsPage.groups.find((group) => group.id === ledgerGroup.groupId).expenseSource).toBe("ledger");
});

// ------------------------------------------------ deleted-record history

test("deleted split expenses remain in history and restore with their original record", async (t) => {
  const request = await openRequest(t);
  const description = `History split ${Date.now()}`;
  const group = await postJson(request, "/api/splits/groups/create", {
    name: `History travel ${Date.now()}`,
    currency: "JPY"
  });
  const created = await postJson(request, "/api/splits/expenses/create", {
    groupId: group.groupId,
    date: "2026-08-20",
    description,
    categoryName: "Food & Drinks",
    payerPersonName: "Tim",
    amountMinor: 12345,
    currency: "JPY",
    paymentMethod: "cash",
    paymentStatus: "recorded",
    note: "Original travel note"
  });

  await postJson(request, "/api/splits/expenses/delete", { splitExpenseId: created.splitExpenseId });
  const deleted = await loadSplitsPage(request, { view: "person-tim", month: "2026-08" });
  expect(deleted.splitsPage.activity.some((item) => item.id === created.splitExpenseId)).toBe(false);
  const historyItem = deleted.splitsPage.activityHistory.find((item) => item.recordId === created.splitExpenseId && item.action === "deleted");
  expect(historyItem).toMatchObject({ recordKind: "expense", amountMinor: 12345, currency: "JPY", canRestore: true });

  await postJson(request, "/api/splits/activity-history/restore", { recordKind: "expense", recordId: created.splitExpenseId });
  const restored = await loadSplitsPage(request, { view: "person-tim", month: "2026-08" });
  const restoredExpense = restored.splitsPage.activity.find((item) => item.id === created.splitExpenseId);
  expect(restoredExpense).toMatchObject({ description, totalAmountMinor: 12345, currency: "JPY", note: "Original travel note" });
  // The restore puts it back in the travel group it was created in.
  expect(restoredExpense.groupId).toBe(group.groupId);
  expect(restored.splitsPage.activityHistory.some((item) => item.recordId === created.splitExpenseId && item.action === "restored")).toBe(true);
});

test("restoring an already active split is rejected instead of duplicating it", async (t) => {
  const request = await openRequest(t);
  const created = await postJson(request, "/api/splits/expenses/create", {
    groupId: "split-group-okaeri",
    date: "2026-08-21",
    description: `Active history split ${Date.now()}`,
    categoryName: "Food & Drinks",
    payerPersonName: "Tim",
    amountMinor: 500,
    currency: "SGD"
  });
  const response = await request.post("/api/splits/activity-history/restore", { data: { recordKind: "expense", recordId: created.splitExpenseId } });
  expect(response.status()).toBe(400);
  expect(await response.text()).toContain("already active");

  const invalidResponse = await request.post("/api/splits/activity-history/restore", { data: { recordKind: "unknown", recordId: created.splitExpenseId } });
  expect(invalidResponse.status()).toBe(400);
  expect(await invalidResponse.text()).toContain("Invalid split history record fields");
});

// ------------------------------------------------ Splits page month slice

// The Splits page carries only the month slice it uses: the month key and
// the month's transfers (for matching a settlement checkpoint to a bank
// transfer), adjusted for the person view. Plan rows, income rows, metric
// cards and non-transfer entries belong to the Month page.
test("the Splits page month slice is the month plus exactly the month's transfers", async (t) => {
  const request = await openRequest(t);
  const transfer = await postJson(request, "/api/entries/create", {
    date: "2026-05-14", description: "Splits payload transfer out", accountName: "UOB Savings", categoryName: "Transfer",
    amountMinor: 12_000, entryType: "transfer", transferDirection: "out", ownershipType: "direct", ownerName: "Tim"
  });
  await postJson(request, "/api/entries/create", {
    date: "2026-05-15", description: "Splits payload expense", accountName: "UOB One", categoryName: "Groceries",
    amountMinor: 3_300, entryType: "expense", ownershipType: "direct", ownerName: "Tim"
  });

  for (const view of ["person-tim", "household"]) {
    const splits = await getJson(request, `/api/splits-page?view=${view}&month=2026-05`);
    const entries = await getJson(request, `/api/entries-page?view=${view}&month=2026-05`);
    expect(Object.keys(splits.monthPage).sort()).toEqual(["entries", "month"]);
    expect(splits.monthPage.month).toBe("2026-05");
    expect(splits.monthPage.entries.length).toBeGreaterThan(0);
    expect(splits.monthPage.entries.every((entry) => entry.entryType === "transfer")).toBe(true);
    expect(splits.monthPage.entries.some((entry) => entry.id === transfer.entryId)).toBe(true);
    // Same transfers, same order, same values as the Entries page for this view.
    expect(splits.monthPage.entries).toEqual(entries.monthPage.entries.filter((entry) => entry.entryType === "transfer"));
    expect(splits.splitsPage.groups.length).toBeGreaterThan(0);
  }
});

// ------------------------------------------------ amounts and shares

test("split activity uses the borrowed amount for both borrower and lender views", async (t) => {
  const request = await openRequest(t);

  const [timData, joyceData] = await Promise.all([
    loadSplitsPage(request, { view: "person-tim", month: "2025-10" }),
    loadSplitsPage(request, { view: "person-joyce", month: "2025-10" })
  ]);

  const findTarget = (activity) => activity.find((item) => (
    item.kind === "expense"
      && item.description === "Family support"
      && item.paidByPersonName === "Joyce"
      && item.totalAmountMinor === 23407
      && item.groupName === "Baby River"
  ));

  const timEntry = findTarget(timData.splitsPage.activity);
  const joyceEntry = findTarget(joyceData.splitsPage.activity);

  expect(timEntry?.viewerDirectionLabel).toBe("you borrowed");
  expect(timEntry?.viewerAmountMinor).toBe(11703);
  expect(joyceEntry?.viewerDirectionLabel).toBe("you lent");
  expect(joyceEntry?.viewerAmountMinor).toBe(11703);
});

test("a created split expense is on the Splits page with its note", async (t) => {
  const request = await openRequest(t);
  const description = `Playwright split expense ${Date.now()}`;
  const note = "Created from the splits test.";

  await postJson(request, "/api/splits/expenses/create", {
    date: "2025-10-12",
    description,
    categoryName: "Groceries",
    payerPersonName: "Tim",
    amountMinor: 4200,
    note,
    groupId: null
  });

  const data = await loadSplitsPage(request, { view: "person-tim", month: "2025-10" });
  const createdItem = data.splitsPage.activity.find((item) => item.description === description);
  expect(createdItem).toBeTruthy();
  expect(createdItem?.note).toBe(note);
});

test("equal split amounts keep the odd cent on the deterministic remainder share", async (t) => {
  const request = await openRequest(t);
  const description = `Playwright split rounding ${Date.now()}`;

  const entry = await postJson(request, "/api/entries/create", {
    date: "2026-04-24",
    description,
    accountName: "UOB One",
    categoryName: "Groceries",
    amountMinor: 13999,
    entryType: "expense",
    ownershipType: "direct",
    ownerName: "Tim"
  });

  await postJson(request, "/api/splits/expenses/from-entry", {
    entryId: entry.entryId,
    splitGroupId: null
  });

  const entriesData = await loadEntriesPage(request, { view: "person-tim", month: "2026-04" });
  const createdEntry = entriesData.monthPage.entries.find((item) => item.description === description);
  expect(createdEntry?.ownershipType).toBe("direct");
  expect(createdEntry?.linkedSplitShares).toEqual([
    expect.objectContaining({ personId: "person-tim", amountMinor: 6999 }),
    expect.objectContaining({ personId: "person-joyce", amountMinor: 7000 })
  ]);

  const splitsData = await loadSplitsPage(request, { view: "person-tim", month: "2026-04" });
  const createdSplit = splitsData.splitsPage.activity.find((item) => item.description === description);
  expect(createdSplit?.viewerAmountMinor).toBe(7000);
});
