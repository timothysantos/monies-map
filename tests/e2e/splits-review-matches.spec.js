import { expect, test } from "@playwright/test";

import {
  loadEntriesPage,
  loadSplitsPage,
  postJson,
  reseedDemo
} from "./helpers";

test("review matches links a split expense into entries and hides already-linked fixtures from review", async ({ page }) => {
  await page.goto("/");
  await reseedDemo(page);
  await page.goto("/entries?view=person-tim&month=2025-10");

  const beforeEntries = await loadEntriesPage(page, { view: "person-tim", month: "2025-10" });
  const beforeLinkedEntry = beforeEntries.monthPage.entries.find((entry) => entry.id === "txn-import-split-pantry-match");
  expect(beforeLinkedEntry).toBeTruthy();
  expect(beforeLinkedEntry?.linkedSplitExpenseId).toBeFalsy();

  const beforeSplits = await loadSplitsPage(page, { view: "person-tim", month: "2025-10" });
  expect(beforeSplits.splitsPage.matches.some((match) => match.splitRecordId === "split-expense-baby-river-family")).toBe(false);
  const pantryMatch = beforeSplits.splitsPage.matches.find((match) => match.splitRecordId === "split-expense-nongroup-pantry-match");
  expect(pantryMatch).toBeTruthy();
  expect(pantryMatch?.splitDescription).toBe("Pantry restock");
  expect(pantryMatch?.splitAmountMinor).toBe(18640);
  expect(pantryMatch?.amountDeltaMinor).toBe(0);
  expect(beforeSplits.splitsPage.matches.some((match) => match.splitRecordId === "split-settlement-nongroup-transfer-match")).toBe(true);

  await page.goto("/splits?view=person-tim&month=2025-10");
  const matchCallout = page.locator(".split-match-inbox-callout");
  await expect(matchCallout).toContainText("possible split links");
  await matchCallout.getByRole("button", { name: "Review matches" }).click();
  await expect(page).toHaveURL(/split_mode=matches/);

  await page.goto("/splits?view=person-tim&month=2025-10&split_mode=matches");
  await expect(page).toHaveURL(/split_mode=matches/);
  await expect.poll(async () => {
    const data = await loadSplitsPage(page, { view: "person-tim", month: "2025-10" });
    return data.splitsPage.matches.some((match) => match.splitRecordId === "split-expense-nongroup-pantry-match");
  }).toBe(true);
  await expect(page.getByText(pantryMatch?.transactionDescription ?? "", { exact: true })).toBeVisible();
  await expect(page.getByText("Existing split", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("Imported ledger row", { exact: true }).first()).toBeVisible();
  await expect(page.locator(".split-match-deltas").filter({ hasText: "0 days apart" }).first()).toBeVisible();
  await expect(page.getByText("Joyce paynow settle up", { exact: true })).toBeVisible();
  await expect(page.getByText("Baby River family support import", { exact: true })).toHaveCount(0);

  const pantryMatchCard = page.locator(".split-match-card").filter({ hasText: pantryMatch?.transactionDescription ?? "" }).first();
  await pantryMatchCard.getByRole("button", { name: "Match" }).click();

  await expect.poll(async () => {
    const data = await loadSplitsPage(page, { view: "person-tim", month: "2025-10" });
    return data.splitsPage.matches.some((match) => match.splitRecordId === "split-expense-nongroup-pantry-match");
  }).toBe(false);

  const afterSplits = await loadSplitsPage(page, { view: "person-tim", month: "2025-10" });
  const linkedExpense = afterSplits.splitsPage.activity.find((item) => item.id === "split-expense-nongroup-pantry-match");
  expect(linkedExpense?.linkedTransactionId).toBe("txn-import-split-pantry-match");

  const afterEntries = await loadEntriesPage(page, { view: "person-tim", month: "2025-10" });
  const linkedEntry = afterEntries.monthPage.entries.find((entry) => entry.id === "txn-import-split-pantry-match");
  expect(linkedEntry).toBeTruthy();
  expect(linkedEntry?.ownershipType).toBe("direct");
  expect(linkedEntry?.linkedSplitExpenseId).toBe("split-expense-nongroup-pantry-match");
  expect(linkedEntry?.linkedSplitShares?.length).toBeGreaterThan(0);

  await page.goto("/entries?view=household&month=2025-10");
  const linkedEntryRow = page.locator(".entry-row").filter({ hasText: pantryMatch?.transactionDescription ?? "" }).first();
  await expect(linkedEntryRow).toBeVisible();
  await expect(linkedEntryRow.locator(".entry-chip-linked-split")).toContainText("On splits");
  const ownerBorderColor = await linkedEntryRow.locator(".entry-row-main").evaluate((element) => getComputedStyle(element).borderLeftColor);
  expect(ownerBorderColor).not.toBe("rgba(0, 0, 0, 0)");
  expect(ownerBorderColor).not.toBe("transparent");

  await page.goto("/splits?view=person-tim&month=2025-10&split_group=split-group-none");
  await page.waitForLoadState("networkidle");
  const pantryCard = page.locator(".split-activity-card").filter({ hasText: "Tracked in splits before the imported grocery charge was reviewed." }).first();
  await pantryCard.click();

  const inlineEditor = page.locator(".split-inline-editor-card").first();
  await expect(inlineEditor.getByRole("button", { name: "View entry" })).toBeVisible();
  await inlineEditor.getByRole("button", { name: "View entry" }).click();

  await expect(page).toHaveURL(/\/entries\?/);
  await expect(page).toHaveURL(/editing_entry=txn-import-split-pantry-match/);
  await expect(page.getByLabel("Description")).toHaveValue(pantryMatch?.transactionDescription ?? "");
  await expect(page.locator(".entry-chip-linked-split").first()).toContainText("On splits");
});

test("mobile split match review has readable actions and a clear back path", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await reseedDemo(page);

  const beforeSplits = await loadSplitsPage(page, { view: "person-tim", month: "2025-10" });
  const pantryMatch = beforeSplits.splitsPage.matches.find((match) => match.splitRecordId === "split-expense-nongroup-pantry-match");
  expect(pantryMatch).toBeTruthy();

  await page.goto("/splits?view=person-tim&month=2025-10&split_mode=matches");
  await page.waitForLoadState("networkidle");

  const backButton = page.getByRole("button", { name: "Back to split group" }).first();
  await expect(backButton).toBeVisible();

  const matchCard = page.locator(".split-match-card").filter({ hasText: pantryMatch?.transactionDescription ?? "" }).first();
  await expect(matchCard).toBeVisible();
  const keepSeparate = matchCard.getByRole("button", { name: "Keep separate" });
  const matchButton = matchCard.getByRole("button", { name: "Match", exact: true });
  await expect(keepSeparate).toHaveCSS("color", "rgb(177, 94, 47)");
  await expect(matchButton).toHaveCSS("background-color", "rgb(177, 94, 47)");

  const layout = await matchCard.locator(".split-match-actions").evaluate((element) => {
    const card = element.closest(".split-match-card");
    const actions = element.getBoundingClientRect();
    const cardBox = card?.getBoundingClientRect();
    return {
      actionsLeft: actions.left,
      cardLeft: cardBox?.left ?? 0,
      cardRight: cardBox?.right ?? 0
    };
  });
  expect(layout.actionsLeft).toBeGreaterThanOrEqual(layout.cardLeft - 1);
  expect(layout.actionsLeft).toBeLessThan(layout.cardRight);

  await backButton.click();
  await expect(page).not.toHaveURL(/split_mode=matches/);
  await expect(page.locator(".split-match-inbox-callout")).toBeVisible();
});

test("review matches links a settlement and the linked entry can be opened from splits history", async ({ page }) => {
  await page.goto("/");
  await reseedDemo(page);

  const beforeSplits = await loadSplitsPage(page, { view: "person-tim", month: "2025-10" });
  const settlementMatch = beforeSplits.splitsPage.matches.find((match) => match.splitRecordId === "split-settlement-nongroup-transfer-match");
  expect(settlementMatch).toBeTruthy();

  await page.goto("/splits?view=person-tim&month=2025-10&split_mode=matches");
  await page.waitForLoadState("networkidle");

  const settlementMatchCard = page.locator(".split-match-card").filter({ hasText: settlementMatch?.transactionDescription ?? "" }).first();
  await expect(settlementMatchCard).toBeVisible();
  await settlementMatchCard.getByRole("button", { name: "Match" }).click();

  await page.goto("/splits?view=person-tim&month=2025-10&split_group=split-group-none");
  const settlementCard = page.locator(".split-activity-card").filter({ hasText: "Cash float settle-up waiting for the imported transfer row." }).first();
  await settlementCard.click();

  const inlineEditor = page.locator(".split-inline-editor-card").first();
  await expect(inlineEditor.getByRole("button", { name: "View entry" })).toBeVisible();
  await inlineEditor.getByRole("button", { name: "View entry" }).click();

  await expect(page).toHaveURL(/\/entries\?/);
  await expect(page).toHaveURL(/editing_entry=txn-import-split-settlement-match/);
  await expect(page.getByLabel("Description")).toHaveValue(settlementMatch?.transactionDescription ?? "");
});

test("mobile view entry from a split scrolls the background entries row into place", async ({ page }) => {
  const month = "2026-05";
  const targetDescription = `Mobile split linked row ${Date.now()}`;

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await reseedDemo(page);

  const targetEntry = await postJson(page, "/api/entries/create", {
    date: `${month}-01`,
    description: targetDescription,
    accountName: "UOB One",
    categoryName: "Groceries",
    amountMinor: 2440,
    entryType: "expense",
    ownershipType: "direct",
    ownerName: "Tim"
  });

  for (let index = 0; index < 16; index += 1) {
    await postJson(page, "/api/entries/create", {
      date: `${month}-${String(28 - index).padStart(2, "0")}`,
      description: `Mobile split filler ${index} ${Date.now()}`,
      accountName: "UOB One",
      categoryName: "Groceries",
      amountMinor: 1000 + index,
      entryType: "expense",
      ownershipType: "direct",
      ownerName: "Tim"
    });
  }

  const splitData = await postJson(page, "/api/splits/expenses/from-entry", {
    entryId: targetEntry.entryId,
    splitGroupId: null
  });

  await page.goto(`/splits?view=person-tim&month=${month}&split_group=split-group-none&editing_split_expense=${splitData.splitExpenseId}`);
  const splitDialog = page.getByRole("dialog", { name: "Edit split" });
  await expect(splitDialog).toBeVisible();
  await splitDialog.getByRole("button", { name: "View entry" }).click();

  await expect(page).toHaveURL(/\/entries\?/);
  await expect(page).toHaveURL(new RegExp(`editing_entry=${targetEntry.entryId}`));
  const entryDialog = page.getByRole("dialog", { name: "Edit entry" });
  await expect(entryDialog).toBeVisible();
  await expect(entryDialog.locator(".entry-mobile-sheet-actions .subtle-cancel")).toHaveText("Close");
  await expect(entryDialog.getByRole("button", { name: "Save" })).toBeDisabled();
  const entryActions = entryDialog.locator(".entry-mobile-sheet-actions");
  const entryActionBox = await entryActions.boundingBox();
  expect(entryActionBox).toMatchObject({ x: 0, width: 390 });
  await expect.poll(async () => entryActions.evaluate((actions) => {
    const rect = actions.getBoundingClientRect();
    const sampleY = Math.min(window.innerHeight - 1, Math.floor(rect.top + 8));
    return [1, window.innerWidth - 2].every((sampleX) => (
      document.elementFromPoint(sampleX, sampleY)?.closest(".entry-mobile-sheet-actions") === actions
    ));
  })).toBe(true);
  const finalActionRow = entryActions.locator(".entry-mobile-sheet-primary-row");
  const finalActionRowBox = await finalActionRow.boundingBox();
  expect(entryActionBox.y + entryActionBox.height - (finalActionRowBox.y + finalActionRowBox.height)).toBeGreaterThanOrEqual(18);

  const targetRow = page.locator(`#${targetEntry.entryId}`);
  await expect(targetRow).toBeVisible();
  await expect(targetRow).toHaveClass(/is-editing/);
  await expect.poll(async () => targetRow.evaluate((element) => {
    const sheet = document.querySelector(".entry-mobile-sheet");
    const rowRect = element.getBoundingClientRect();
    const sheetRect = sheet?.getBoundingClientRect();
    return rowRect.top >= 0 && (!sheetRect || rowRect.top < sheetRect.top);
  })).toBe(true);

  await entryDialog.getByLabel("Note").fill("Reviewed from split sheet");
  await expect(entryDialog.locator(".entry-mobile-sheet-actions .subtle-cancel")).toHaveText("Cancel");
  await expect(entryDialog.getByRole("button", { name: "Save" })).toBeEnabled();
});

test("archived linked split history can still open the linked entry", async ({ page }) => {
  await page.goto("/");
  await reseedDemo(page);

  await page.goto("/splits?view=household&month=2025-10&split_group=split-group-okaeri");
  await page.locator(".split-archive-trigger").click();

  const archiveDialog = page.getByRole("dialog");
  await expect(archiveDialog).toContainText("Archived batches");
  await archiveDialog.getByRole("button", { name: /fully settled up with Tim/i }).click();

  await expect(archiveDialog).toContainText("October dining");
  const archivedDiningCard = archiveDialog.locator(".split-activity-card").filter({ hasText: "October dining" }).first();
  await archivedDiningCard.getByRole("button", { name: "View entry" }).click();

  await expect(page).toHaveURL(/\/entries\?/);
  await expect(page).toHaveURL(/editing_entry=txn-import-split-okaeri-linked/);
  await expect(page.getByLabel("Description")).toHaveValue("October dining imported from Citi");
});
