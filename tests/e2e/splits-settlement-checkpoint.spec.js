import { expect, test } from "@playwright/test";

import { gotoPageAfterApi, loadSplitsPage, postJson, reseedDemo } from "./helpers";

test("simplified settlement checkpoints preserve backdated additions and can reopen", async ({ page }) => {
  const month = "2025-10";
  const firstDescription = `Checkpoint first ${Date.now()}`;
  const lateDescription = `Checkpoint late ${Date.now()}`;

  await reseedDemo(page);
  await postJson(page, "/api/splits/expenses/create", {
    date: `${month}-10`,
    description: firstDescription,
    categoryName: "Food & Drinks",
    payerPersonName: "Joyce",
    amountMinor: 2000,
    groupId: null,
    note: "checkpoint inclusion"
  });

  await gotoPageAfterApi(
    page,
    `/splits?view=person-tim&month=${month}&split_group=split-group-none`,
    "/api/splits-page",
    () => page.locator(".split-activity-card").filter({ hasText: firstDescription }).first()
  );

  const before = await loadSplitsPage(page, { view: "person-tim", month });
  const beforeCount = before.splitsPage.activity.length;
  const checkpointResponse = page.waitForResponse((response) => response.url().includes("/api/splits/checkpoints/create") && response.request().method() === "POST");
  await page.getByRole("button", { name: "Simplify settlement" }).first().click();
  const checkpoint = await (await checkpointResponse).json();
  expect(checkpoint.amountMinor).toBeGreaterThan(0);

  await page.reload();
  await expect(page.locator(".split-checkpoint-panel")).toContainText("Simplified settlement");
  const checkpointed = await loadSplitsPage(page, { view: "person-tim", month });
  expect(checkpointed.splitsPage.settlementCheckpoints[0].id).toBe(checkpoint.checkpointId);
  expect(checkpointed.splitsPage.activity.filter((item) => item.settlementCheckpointId === checkpoint.checkpointId).length).toBeGreaterThan(0);

  await postJson(page, "/api/splits/expenses/create", {
    date: `${month}-01`,
    description: lateDescription,
    categoryName: "Food & Drinks",
    payerPersonName: "Joyce",
    amountMinor: 1000,
    groupId: null,
    note: "added after checkpoint"
  });

  const afterLate = await loadSplitsPage(page, { view: "person-tim", month });
  expect(afterLate.splitsPage.activity.length).toBeGreaterThan(beforeCount);
  const lateRow = afterLate.splitsPage.activity.find((item) => item.description === lateDescription);
  expect(lateRow?.settlementCheckpointId).toBeUndefined();
  expect(afterLate.splitsPage.groups.find((group) => group.id === "split-group-none")?.entryCount).toBeGreaterThan(0);

  await postJson(page, "/api/splits/checkpoints/reopen", { checkpointId: checkpoint.checkpointId });
  const reopened = await loadSplitsPage(page, { view: "person-tim", month });
  expect(reopened.splitsPage.settlementCheckpoints[0].status).toBe("reopened");
  expect(reopened.splitsPage.activity.some((item) => item.description === firstDescription && !item.settlementCheckpointId)).toBe(true);
});
