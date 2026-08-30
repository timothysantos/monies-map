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

  const firstTransfer = await postJson(page, "/api/entries/create", {
    date: `${month}-20`,
    description: `Settlement transfer 1 ${Date.now()}`,
    accountName: "UOB One",
    categoryName: "Transfer",
    amountMinor: checkpoint.amountMinor - 100,
    entryType: "transfer",
    transferDirection: "out",
    ownershipType: "direct",
    ownerName: "Tim"
  });
  const secondTransfer = await postJson(page, "/api/entries/create", {
    date: `${month}-21`,
    description: `Settlement transfer 2 ${Date.now()}`,
    accountName: "UOB One",
    categoryName: "Transfer",
    amountMinor: 100,
    entryType: "transfer",
    transferDirection: "out",
    ownershipType: "direct",
    ownerName: "Tim"
  });

  await page.reload();
  await expect(page.locator(".split-checkpoint-panel")).toContainText("Simplified settlement");
  await expect(page.locator(".split-checkpoint-panel").getByRole("button", { name: "View included activity" })).toBeVisible();
  expect(await page.locator(".split-checkpoint-panel").evaluate((element) => element.compareDocumentPosition(document.querySelector(".split-activity-list")) & Node.DOCUMENT_POSITION_FOLLOWING)).toBeTruthy();
  await page.getByLabel(/Transfer to match/).selectOption(firstTransfer.entryId);
  await page.getByRole("button", { name: "Match transfer" }).click();
  await expect(page.locator(".split-checkpoint-panel")).toContainText("partially matched");
  await page.getByLabel(/Transfer to match/).selectOption(secondTransfer.entryId);
  await page.getByRole("button", { name: "Match transfer" }).click();
  await expect(page.locator(".split-checkpoint-panel")).toHaveCount(0);
  const fullyMatched = await loadSplitsPage(page, { view: "person-tim", month });
  expect(fullyMatched.splitsPage.settlementCheckpoints[0].status).toBe("matched");
  await postJson(page, "/api/splits/checkpoints/unmatch", { checkpointId: checkpoint.checkpointId, transactionId: secondTransfer.entryId });
  await page.reload();
  await expect(page.locator(".split-checkpoint-panel")).toContainText("partially matched");
  await expect(page.locator(".split-checkpoint-transfer")).toHaveCount(1);
  await expect(page.locator(".split-settlement-marker").first()).toContainText("Included in simplified settlement");
  await page.locator(".split-checkpoint-transfer").first().getByRole("button", { name: "Remove" }).click();
  await expect(page.locator(".split-checkpoint-panel")).toContainText("open");
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

  await page.reload();
  const lateRowCard = page.locator(".split-activity-card").filter({ hasText: lateDescription }).first();
  await expect(lateRowCard).toBeVisible();
  await expect(lateRowCard).not.toHaveClass(/is-settlement-included/);
  await expect(lateRowCard.locator(".split-settlement-marker")).toHaveCount(0);

  await postJson(page, "/api/splits/checkpoints/reopen", { checkpointId: checkpoint.checkpointId });
  const reopened = await loadSplitsPage(page, { view: "person-tim", month });
  expect(reopened.splitsPage.settlementCheckpoints[0].status).toBe("reopened");
  expect(reopened.splitsPage.activity.some((item) => item.description === firstDescription && !item.settlementCheckpointId)).toBe(true);
});

test("a paid simplified settlement collapses until its later bank transfer is matched", async ({ page }) => {
  const month = "2026-05";
  const firstDescription = `Paid checkpoint first ${Date.now()}`;
  const nextDescription = `Paid checkpoint next ${Date.now()}`;

  await reseedDemo(page);
  await postJson(page, "/api/splits/expenses/create", {
    date: `${month}-10`,
    description: firstDescription,
    categoryName: "Food & Drinks",
    payerPersonName: "Joyce",
    amountMinor: 2000,
    groupId: null,
    note: "paid settlement follow-up"
  });

  await gotoPageAfterApi(
    page,
    `/splits?view=person-tim&month=${month}&split_group=split-group-none`,
    "/api/splits-page",
    () => page.locator(".split-activity-card").filter({ hasText: firstDescription }).first()
  );
  const checkpoint = await postJson(page, "/api/splits/checkpoints/create", {
    viewerPersonId: "person-tim",
    date: `${month}-11`,
    currency: "SGD"
  });
  await page.reload();
  await expect(page.locator(".split-checkpoint-panel")).toContainText("Simplified settlement");
  await page.getByRole("button", { name: "Mark paid" }).click();
  await expect(page.locator(".split-checkpoint-panel")).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Settled, awaiting bank match \(1\)/ })).toBeVisible();

  const paid = await loadSplitsPage(page, { view: "person-tim", month });
  expect(paid.splitsPage.settlementCheckpoints[0].settledAt).toBeTruthy();
  expect(paid.splitsPage.settlementCheckpoints[0].status).toBe("open");

  await page.getByRole("button", { name: /Settled, awaiting bank match \(1\)/ }).click();
  await page.getByRole("button", { name: "Undo paid" }).click();
  await expect(page.locator(".split-checkpoint-panel")).toContainText("Simplified settlement");
  await page.getByRole("button", { name: "Mark paid" }).click();
  await expect(page.locator(".split-checkpoint-panel")).toHaveCount(0);

  await postJson(page, "/api/splits/expenses/create", {
    date: `${month}-12`,
    description: nextDescription,
    categoryName: "Food & Drinks",
    payerPersonName: "Joyce",
    amountMinor: 1000,
    groupId: null,
    note: "activity after paid settlement"
  });
  const nextCheckpoint = await postJson(page, "/api/splits/checkpoints/create", {
    viewerPersonId: "person-tim",
    date: `${month}-12`,
    currency: "SGD"
  });
  expect(nextCheckpoint.checkpointId).not.toBe(checkpoint.checkpointId);

  const transfer = await postJson(page, "/api/entries/create", {
    date: `${month}-13`,
    description: `Later settlement transfer ${Date.now()}`,
    accountName: "UOB One",
    categoryName: "Transfer",
    amountMinor: checkpoint.amountMinor,
    entryType: "transfer",
    transferDirection: "out",
    ownershipType: "direct",
    ownerName: "Tim"
  });
  await page.reload();
  await page.getByRole("button", { name: /Settled, awaiting bank match \(1\)/ }).click();
  const followUp = page.locator(".split-settlement-follow-up").filter({ hasText: "Marked paid" });
  await expect(followUp.getByRole("button", { name: "View included activity" })).toHaveCSS("color", "rgb(113, 56, 25)");
  await expect(followUp.getByRole("button", { name: "Undo paid" })).toHaveCSS("color", "rgb(145, 45, 32)");
  await expect(followUp.getByRole("button", { name: "Match bank transfer" })).toHaveCSS("background-color", "rgb(169, 73, 32)");
  await expect(followUp.getByRole("button", { name: "Match bank transfer" })).toHaveCSS("color", "rgb(255, 250, 246)");
  await followUp.getByRole("button", { name: "Match bank transfer" }).click();
  await followUp.getByLabel(/Transfer to match/).selectOption(transfer.entryId);
  await followUp.getByRole("button", { name: "Match transfer" }).click();
  await expect(page.getByRole("button", { name: /Settled, awaiting bank match/ })).toHaveCount(0);

  const matched = await loadSplitsPage(page, { view: "person-tim", month });
  const original = matched.splitsPage.settlementCheckpoints.find((item) => item.id === checkpoint.checkpointId);
  expect(original?.status).toBe("matched");
  expect(original?.settledAt).toBeTruthy();
});
