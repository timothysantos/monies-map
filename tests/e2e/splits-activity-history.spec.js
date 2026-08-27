import { expect, test } from "@playwright/test";

import { loadSplitsPage, postJson, reseedDemo } from "./helpers";

test("deleted split expenses remain in history and restore with their original record", async ({ page }) => {
  await reseedDemo(page);
  const description = `History split ${Date.now()}`;
  const group = await postJson(page, "/api/splits/groups/create", {
    name: `History travel ${Date.now()}`,
    currency: "JPY"
  });
  const created = await postJson(page, "/api/splits/expenses/create", {
    groupId: group.splitGroupId,
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

  await postJson(page, "/api/splits/expenses/delete", { splitExpenseId: created.splitExpenseId });
  const deleted = await loadSplitsPage(page, { view: "person-tim", month: "2026-08" });
  expect(deleted.splitsPage.activity.some((item) => item.id === created.splitExpenseId)).toBe(false);
  const historyItem = deleted.splitsPage.activityHistory.find((item) => item.recordId === created.splitExpenseId && item.action === "deleted");
  expect(historyItem).toMatchObject({ recordKind: "expense", amountMinor: 12345, currency: "JPY", canRestore: true });

  await postJson(page, "/api/splits/activity-history/restore", { recordKind: "expense", recordId: created.splitExpenseId });
  const restored = await loadSplitsPage(page, { view: "person-tim", month: "2026-08" });
  const restoredExpense = restored.splitsPage.activity.find((item) => item.id === created.splitExpenseId);
  expect(restoredExpense).toMatchObject({ description, totalAmountMinor: 12345, currency: "JPY", note: "Original travel note" });
  expect(restored.splitsPage.activityHistory.some((item) => item.recordId === created.splitExpenseId && item.action === "restored")).toBe(true);
});

test("restoring an already active split is rejected instead of duplicating it", async ({ page }) => {
  await reseedDemo(page);
  const created = await postJson(page, "/api/splits/expenses/create", {
    groupId: "split-group-okaeri",
    date: "2026-08-21",
    description: `Active history split ${Date.now()}`,
    categoryName: "Food & Drinks",
    payerPersonName: "Tim",
    amountMinor: 500,
    currency: "SGD"
  });
  const response = await page.request.post("/api/splits/activity-history/restore", { data: { recordKind: "expense", recordId: created.splitExpenseId } });
  expect(response.status()).toBe(400);
  expect(await response.text()).toContain("already active");

  const invalidResponse = await page.request.post("/api/splits/activity-history/restore", { data: { recordKind: "unknown", recordId: created.splitExpenseId } });
  expect(invalidResponse.status()).toBe(400);
  expect(await invalidResponse.text()).toContain("Invalid split history record fields");
});
