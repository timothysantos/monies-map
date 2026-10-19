import { expect, test } from "@playwright/test";

import { gotoPageAfterApi, loadEntriesPage, loadSplitsPage, postJson, reseedDemo, pickCategory } from "./helpers";

test("entries can add a direct expense to splits and jump into the created split", async ({ page }) => {
  const description = `Playwright add to splits ${Date.now()}`;

  await page.goto("/");
  await reseedDemo(page);

  const entry = await postJson(page, "/api/entries/create", {
    date: "2026-04-24",
    description,
    accountName: "UOB One",
    categoryName: "Groceries",
    amountMinor: 2550,
    entryType: "expense",
    ownershipType: "direct",
    ownerName: "Tim"
  });

  const splitData = await postJson(page, "/api/splits/expenses/from-entry", {
    entryId: entry.entryId,
    splitGroupId: null
  });

  await expect.poll(async () => {
    const entriesData = await loadEntriesPage(page, { view: "person-tim", month: "2026-04" });
    return entriesData.monthPage.entries.some((item) => item.description === description);
  }).toBe(true);

  const entriesData = await loadEntriesPage(page, { view: "person-tim", month: "2026-04" });
  const createdEntry = entriesData.monthPage.entries.find((item) => item.description === description);
  expect(createdEntry).toBeTruthy();
  expect(createdEntry?.ownershipType).toBe("direct");
  expect(createdEntry?.ownerName).toBe("Tim");
  expect(createdEntry?.linkedSplitExpenseId).toBe(splitData.splitExpenseId);
  expect(createdEntry?.linkedSplitShares).toEqual([
    expect.objectContaining({ personId: "person-tim", amountMinor: 1275 }),
    expect.objectContaining({ personId: "person-joyce", amountMinor: 1275 })
  ]);

  const splitsData = await loadSplitsPage(page, { view: "person-tim", month: "2026-04" });
  const createdSplit = splitsData.splitsPage.activity.find((item) => item.description === description);
  expect(createdSplit).toBeTruthy();
  expect(createdSplit?.linkedTransactionId).toBe(entry.entryId);

  const splitsPageReady = page.waitForResponse((response) => (
    response.url().includes("/api/splits-page") && response.ok()
  ), { timeout: 60_000 });
  await page.goto(`/splits?view=person-tim&month=2026-04&editing_split_expense=${splitData.splitExpenseId}`);
  await splitsPageReady;
  const splitCard = page.locator(".split-inline-editor-card");
  await expect(splitCard).toBeVisible({ timeout: 60_000 });
  await expect(splitCard.getByLabel("Description")).toHaveValue(description);
});

test("entries shared scope is based on the linked split record, not ledger ownership", async ({ page }) => {
  const month = "2026-05";
  const description = `Playwright split scope contract ${Date.now()}`;

  await page.goto("/");
  await reseedDemo(page);

  const entry = await postJson(page, "/api/entries/create", {
    date: `${month}-24`,
    description,
    accountName: "UOB One",
    categoryName: "Groceries",
    amountMinor: 2550,
    entryType: "expense",
    ownershipType: "direct",
    ownerName: "Tim"
  });

  await postJson(page, "/api/splits/expenses/from-entry", {
    entryId: entry.entryId,
    splitGroupId: null
  });

  const timDirectData = await loadEntriesPage(page, { view: "person-tim", month });
  const linkedTimEntry = timDirectData.monthPage.entries.find((item) => item.description === description);
  expect(linkedTimEntry?.ownershipType).toBe("direct");
  expect(linkedTimEntry?.linkedSplitExpenseId).toBeTruthy();

  await gotoPageAfterApi(
    page,
    `/entries?view=person-tim&month=${month}&entries_scope=direct`,
    "/api/entries-page",
    () => page.locator(".panel").first()
  );
  await expect(page.locator(".entry-row").filter({ hasText: description })).toHaveCount(0);

  await gotoPageAfterApi(
    page,
    `/entries?view=person-joyce&month=${month}&entries_scope=shared`,
    "/api/entries-page",
    () => page.locator(".entry-row").filter({ hasText: description }).first()
  );
  const joyceSharedRow = page.locator(".entry-row").filter({ hasText: description }).first();
  await expect(joyceSharedRow).toBeVisible();
  await expect(joyceSharedRow.locator(".entry-chip-linked-split")).toContainText("On splits");
  await expect(joyceSharedRow.locator(".entry-chip-split")).toContainText("50%");
});

test("linked entry category save preserves ledger amount and can update the connected split category", async ({ page }) => {
  const month = "2026-05";
  const description = `Playwright linked category sync ${Date.now()}`;

  await page.goto("/");
  await reseedDemo(page);

  const entry = await postJson(page, "/api/entries/create", {
    date: `${month}-22`,
    description,
    accountName: "UOB One",
    categoryName: "Food & Drinks",
    amountMinor: 2200,
    entryType: "expense",
    ownershipType: "direct",
    ownerName: "Tim"
  });

  const splitData = await postJson(page, "/api/splits/expenses/from-entry", {
    entryId: entry.entryId,
    splitGroupId: null
  });

  await page.goto(`/entries?view=person-tim&month=${month}&entries_scope=direct_plus_shared&editing_entry=${entry.entryId}`);
  const editor = page.locator(".entry-inline-editor").first();
  await expect(editor).toBeVisible();
  await expect(editor.getByLabel("Amount")).toHaveValue("22.00");

  await pickCategory(page, editor.locator("[data-row='category']"), "Entertainment");
  await editor.getByRole("button", { name: "Done editing entry" }).click();

  const syncDialog = page.getByRole("dialog", { name: "Update connected split category?" });
  await expect(syncDialog).toBeVisible();
  await expect(syncDialog).toContainText("Entry category being saved");
  await expect(syncDialog).toContainText("Entertainment");
  await expect(syncDialog).toContainText("Connected split current category");
  await expect(syncDialog).toContainText("Food & Drinks");

  const entryUpdate = page.waitForResponse((response) => response.url().includes("/api/entries/update") && response.ok());
  const splitCategoryUpdate = page.waitForResponse((response) => response.url().includes("/api/splits/expenses/update-category") && response.ok());
  await syncDialog.getByRole("button", { name: "Update both" }).click();
  await entryUpdate;
  await splitCategoryUpdate;
  await expect(syncDialog).toHaveCount(0);

  const entriesData = await loadEntriesPage(page, { view: "person-tim", month });
  const updatedEntry = entriesData.monthPage.entries.find((item) => item.id === entry.entryId);
  expect(updatedEntry?.categoryName).toBe("Entertainment");
  expect(updatedEntry?.amountMinor).toBe(1100);
  expect(updatedEntry?.totalAmountMinor).toBe(2200);

  const splitsData = await loadSplitsPage(page, { view: "person-tim", month });
  const updatedSplit = splitsData.splitsPage.activity.find((item) => item.id === splitData.splitExpenseId);
  expect(updatedSplit?.categoryName).toBe("Entertainment");
});

test("newly added split can be viewed immediately and preserves the entries scope", async ({ page }) => {
  const month = "2026-05";
  const description = `Playwright immediate view split ${Date.now()}`;

  await page.goto("/");
  await reseedDemo(page);

  const createdEntry = await postJson(page, "/api/entries/create", {
    date: `${month}-24`,
    description,
    accountName: "UOB One",
    categoryName: "Groceries",
    amountMinor: 2550,
    entryType: "expense",
    ownershipType: "direct",
    ownerName: "Tim"
  });

  await page.goto(`/splits?view=household&month=${month}&split_group=split-group-none`);
  await expect(page.locator("article.panel-splits")).toBeVisible();

  await page.goto(`/entries?view=household&month=${month}&entries_scope=direct_plus_shared&editing_entry=${createdEntry.entryId}`);
  const editor = page.locator(".entry-inline-editor").first();
  await expect(editor).toBeVisible();

  const splitResponse = page.waitForResponse((response) => response.url().includes("/api/splits/expenses/from-entry") && response.ok());
  await editor.getByRole("button", { name: "Add to splits" }).click();
  const groupPicker = page.getByRole("dialog", { name: "Add to splits" });
  await expect(groupPicker).toBeVisible();
  // A desktop dialog is centred in the window, whole: its top never runs
  // above the window however tall it is (a stray bottom anchor once did).
  const viewport = page.viewportSize();
  const pickerBox = await groupPicker.boundingBox();
  expect(pickerBox.y).toBeGreaterThanOrEqual(0);
  expect(pickerBox.y + pickerBox.height).toBeLessThanOrEqual(viewport.height);
  expect(Math.abs(pickerBox.y + pickerBox.height / 2 - viewport.height / 2)).toBeLessThanOrEqual(2);
  await expect(groupPicker.getByRole("button", { name: "Add to splits" })).toBeDisabled();
  // Each choice has a visible edge, like the other choice buttons.
  await expect(groupPicker.getByRole("radio", { name: "0%", exact: true })).not.toHaveCSS("border-top-style", "none");
  await expect(groupPicker.getByRole("radio", { name: "Non-group expenses" })).not.toHaveCSS("border-top-style", "none");
  await expect(groupPicker.getByText("0% means Tim owes none; if they paid, they are owed the full amount.")).toBeVisible();
  await expect(groupPicker.getByRole("radio", { name: "50%", exact: true })).toHaveAttribute("aria-checked", "true");
  await groupPicker.getByRole("radio", { name: "Non-group expenses" }).click();
  await groupPicker.getByRole("radio", { name: "0%", exact: true }).click();
  await groupPicker.getByRole("button", { name: "Add to splits" }).click();
  const createdSplit = await splitResponse;
  expect(JSON.parse(createdSplit.request().postData() ?? "{}")).toMatchObject({ splitBasisPoints: 0 });

  const viewSplitButton = editor.getByRole("button", { name: "View split" });
  await expect(viewSplitButton).toBeVisible({ timeout: 30_000 });

  const splitsPageReady = page.waitForResponse((response) => response.url().includes("/api/splits-page") && response.ok());
  await viewSplitButton.click();
  await splitsPageReady;

  await expect(page).toHaveURL(/\/splits\?/);
  // Splits intentionally has no household projection, so the route recovers to
  // the primary person while preserving the rest of the entries handoff.
  expect(new URL(page.url()).searchParams.get("view")).toBe("person-tim");
  expect(new URL(page.url()).searchParams.get("month")).toBe(month);
  expect(new URL(page.url()).searchParams.get("scope")).toBe("direct_plus_shared");
  const splitInline = page.locator(".split-inline-editor-card");
  await expect(splitInline).toBeVisible({ timeout: 60_000 });
  await expect(splitInline.getByLabel("Description")).toHaveValue(description);

  await splitInline.locator("[data-row='linkedEntry']").click();
  await expect(page).toHaveURL(/\/entries\?/);
  const returnUrl = new URL(page.url());
  expect(returnUrl.searchParams.get("view")).toBe("person-tim");
  expect(returnUrl.searchParams.get("month")).toBe(month);
  expect(returnUrl.searchParams.get("entries_scope")).toBe("direct_plus_shared");
  expect(returnUrl.searchParams.get("editing_entry")).toBe(createdEntry.entryId);
  await expect(page.getByLabel("Description")).toHaveValue(description);

  await page.goBack({ waitUntil: "domcontentloaded" });
  await expect(page).toHaveURL(/\/splits\?/);
});

test("editing a linked entry note can update the connected split note", async ({ page }) => {
  const month = "2026-05";
  const description = `Playwright linked note sync ${Date.now()}`;
  const entryNote = "entry original note";
  const splitNote = "split current note";
  const syncedNote = "shared linked note";

  await page.goto("/");
  await reseedDemo(page);

  const entry = await postJson(page, "/api/entries/create", {
    date: `${month}-24`,
    description,
    accountName: "UOB One",
    categoryName: "Groceries",
    amountMinor: 2550,
    entryType: "expense",
    ownershipType: "direct",
    ownerName: "Tim",
    note: entryNote
  });

  const splitData = await postJson(page, "/api/splits/expenses/from-entry", {
    entryId: entry.entryId,
    splitGroupId: null
  });
  await postJson(page, "/api/splits/expenses/update-note", {
    splitExpenseId: splitData.splitExpenseId,
    note: splitNote
  });

  await page.goto(`/entries?view=person-tim&month=${month}&editing_entry=${entry.entryId}`);
  const editor = page.locator(".entry-inline-editor").first();
  await expect(editor).toBeVisible();
  await editor.getByRole("textbox", { name: "Note", exact: true }).fill(syncedNote);
  await editor.getByRole("button", { name: "Done editing entry" }).click();

  const syncDialog = page.getByRole("dialog", { name: "Update connected note?" });
  await expect(syncDialog).toBeVisible();
  await expect(syncDialog).toContainText(syncedNote);
  await expect(syncDialog).toContainText(splitNote);
  await syncDialog.getByRole("button", { name: "Update both" }).click();

  await expect(syncDialog).toBeHidden({ timeout: 60_000 });
  const entriesData = await loadEntriesPage(page, { view: "person-tim", month });
  const updatedEntry = entriesData.monthPage.entries.find((item) => item.id === entry.entryId);
  expect(updatedEntry?.note).toBe(syncedNote);

  const splitsData = await loadSplitsPage(page, { view: "person-tim", month });
  const updatedSplit = splitsData.splitsPage.activity.find((item) => item.id === splitData.splitExpenseId);
  expect(updatedSplit?.note).toBe(syncedNote);
});

test("add to splits refreshes split groups and forces group selection when multiple groups exist", async ({ page }) => {
  const month = "2026-05";
  const description = `Playwright split picker refresh ${Date.now()}`;

  await page.goto("/");
  await reseedDemo(page);

  const entry = await postJson(page, "/api/entries/create", {
    date: `${month}-24`,
    description,
    accountName: "UOB One",
    categoryName: "Groceries",
    amountMinor: 2550,
    entryType: "expense",
    ownershipType: "direct",
    ownerName: "Tim"
  });

  await postJson(page, "/api/splits/groups/create", { name: "Holiday" });
  await postJson(page, "/api/splits/groups/create", { name: "Home" });

  const entriesPage = await loadEntriesPage(page, { view: "person-tim", month });
  const splitGroupNames = entriesPage.splitGroups.map((group) => group.name);
  expect(splitGroupNames).toContain("Non-group expenses");
  expect(splitGroupNames).toContain("Holiday");
  expect(splitGroupNames).toContain("Home");
  const holidayGroup = entriesPage.splitGroups.find((group) => group.name === "Holiday");
  expect(holidayGroup).toBeTruthy();

  const splitResponse = await page.request.post("/api/splits/expenses/from-entry", {
    data: {
      entryId: entry.entryId,
      splitGroupId: holidayGroup?.id
    }
  });
  expect(splitResponse.ok()).toBeTruthy();

  const afterEntriesPage = await loadEntriesPage(page, { view: "person-tim", month });
  const linkedEntry = afterEntriesPage.monthPage.entries.find((item) => item.id === entry.entryId);
  expect(linkedEntry?.linkedSplitExpenseId).toBeTruthy();
  expect(linkedEntry?.linkedSplitGroupName).toBe("Holiday");

  await page.goto(`/entries?view=person-tim&month=${month}`);
  const linkedEntryRow = page.locator(".entry-row").filter({ hasText: description }).first();
  await expect(linkedEntryRow).toBeVisible();
  const linkedSplitChip = linkedEntryRow.locator(".entry-chip-linked-split");
  await expect(linkedSplitChip.locator(".entry-chip-linked-split-base")).toHaveText("On splits");
  await expect(linkedSplitChip.locator(".entry-chip-linked-split-group")).toHaveText("Holiday");
  await expect(linkedSplitChip.locator(".entry-chip-linked-split-base")).toHaveCSS("color", "rgb(180, 83, 9)");
  await expect(linkedSplitChip.locator(".entry-chip-linked-split-group")).not.toHaveCSS("color", "rgb(180, 83, 9)");
});

test("add to splits opens the group picker without waiting for the freshness refresh", async ({ page }) => {
  const month = "2026-05";
  const description = `Playwright split picker immediate ${Date.now()}`;

  await page.goto("/");
  await reseedDemo(page);

  const createdEntry = await postJson(page, "/api/entries/create", {
    date: `${month}-24`,
    description,
    accountName: "UOB One",
    categoryName: "Groceries",
    amountMinor: 2550,
    entryType: "expense",
    ownershipType: "direct",
    ownerName: "Tim"
  });
  await postJson(page, "/api/splits/groups/create", { name: "Holiday" });
  await postJson(page, "/api/splits/groups/create", { name: "Home" });
  await postJson(page, "/api/splits/groups/create", { name: "Away" });

  await page.goto(`/entries?view=person-tim&month=${month}&editing_entry=${createdEntry.entryId}`);
  const editor = page.locator(".entry-inline-editor").first();
  await expect(editor).toBeVisible();

  await page.route("**/api/entries-page**", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 3000));
    await route.continue();
  });

  await editor.getByRole("button", { name: "Add to splits" }).click();
  const picker = page.getByRole("dialog", { name: "Add to splits" });
  await expect(picker).toBeVisible({ timeout: 1000 });
  await expect(picker.getByRole("radio", { name: "Holiday" })).toBeVisible();
  const groupChoices = picker.locator(".entry-split-group-choice");
  expect(await groupChoices.count()).toBeGreaterThan(3);
  await expect(groupChoices.first()).toHaveCSS("cursor", "pointer");
  const firstGroupBox = await groupChoices.first().boundingBox();
  const fourthGroupBox = await groupChoices.nth(3).boundingBox();
  expect(fourthGroupBox?.y).toBeGreaterThan(firstGroupBox?.y ?? 0);
  await expect(picker.getByRole("radio", { name: "0%", exact: true })).toBeVisible();
  await expect(picker.getByRole("radio", { name: "50%", exact: true })).toHaveAttribute("aria-checked", "true");
  await expect(picker.getByRole("button", { name: "Add to splits" })).toBeDisabled();
});

test("phone Add to splits asks for a preset share after the group", async ({ page }) => {
  const month = "2026-05";
  const description = `Playwright phone split share ${Date.now()}`;
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await reseedDemo(page);

  const entry = await postJson(page, "/api/entries/create", {
    date: `${month}-24`,
    description,
    accountName: "UOB One",
    categoryName: "Groceries",
    amountMinor: 2550,
    entryType: "expense",
    ownershipType: "direct",
    ownerName: "Tim"
  });

  await page.goto(`/entries?view=person-tim&month=${month}&editing_entry=${entry.entryId}`);
  const sheet = page.getByRole("dialog", { name: "Edit entry" });
  await expect(sheet).toBeVisible();
  await sheet.getByRole("button", { name: "Splits Add to splits" }).click();
  await expect(sheet).toBeVisible();

  const groupPicker = page.locator(".mobile-select-dialog").filter({ hasText: "Split group" });
  await expect(groupPicker).toBeVisible();
  await groupPicker.getByRole("button", { name: "Non-group expenses" }).click();
  await expect(groupPicker).toHaveCount(0);

  await expect(sheet.getByText("0% means Tim owes none; if they paid, they are owed the full amount.")).toBeVisible();
  await expect(sheet.getByRole("radio", { name: "50%", exact: true })).toHaveAttribute("aria-checked", "true");
  await sheet.getByRole("radio", { name: "100%", exact: true }).click();
  const splitResponse = page.waitForResponse((response) => response.url().includes("/api/splits/expenses/from-entry") && response.ok());
  await sheet.getByRole("button", { name: "Add to splits", exact: true }).click();
  const createdSplit = await splitResponse;
  expect(JSON.parse(createdSplit.request().postData() ?? "{}")).toMatchObject({ splitBasisPoints: 10000 });
});

test("editing an entry then adding it to splits keeps the saved row stable across tabs", async ({ page }) => {
  const month = "2026-05";
  const originalDescription = `Playwright split workflow original ${Date.now()}`;
  const updatedDescription = `Playwright split workflow updated ${Date.now()}`;
  const secondPage = await page.context().newPage();

  await page.goto("/");
  await reseedDemo(page);

  const createdEntry = await postJson(page, "/api/entries/create", {
    date: `${month}-24`,
    description: originalDescription,
    accountName: "UOB One",
    categoryName: "Groceries",
    amountMinor: 2550,
    entryType: "expense",
    ownershipType: "direct",
    ownerName: "Tim"
  });

  await page.goto(`/entries?view=person-tim&month=${month}&editing_entry=${createdEntry.entryId}`);
  await secondPage.goto(`/splits?view=person-tim&month=${month}&split_group=split-group-none`);
  await secondPage.waitForLoadState("networkidle");

  const editor = page.locator(".entry-inline-editor").first();
  await expect(editor).toBeVisible();
  await editor.getByLabel("Description").fill(updatedDescription);

  const updateResponse = page.waitForResponse((response) => response.url().includes("/api/entries/update") && response.ok());
  const splitResponse = page.waitForResponse((response) => response.url().includes("/api/splits/expenses/from-entry") && response.ok());
  await editor.getByRole("button", { name: "Add to splits" }).click();
  await page.getByRole("dialog", { name: "Add to splits" }).getByRole("radio", { name: "Non-group expenses" }).click();
  await page.getByRole("dialog", { name: "Add to splits" }).getByRole("button", { name: "Add to splits" }).click();
  await updateResponse;
  await splitResponse;

  const updatedRow = page.locator(".entry-row").filter({ hasText: updatedDescription }).first();
  await expect(updatedRow).toBeVisible();
  await expect(updatedRow).toContainText("View split");

  await expect(secondPage.getByText(updatedDescription)).toBeVisible({ timeout: 60_000 });
  await secondPage.reload({ waitUntil: "domcontentloaded" });
  await expect(secondPage.getByText(updatedDescription)).toBeVisible({ timeout: 60_000 });
  await expect(secondPage.getByText("Reference data could not load.")).toHaveCount(0);

  const entriesData = await loadEntriesPage(page, { view: "person-tim", month });
  const updatedEntry = entriesData.monthPage.entries.find((item) => item.description === updatedDescription);
  expect(updatedEntry?.ownershipType).toBe("direct");
  expect(updatedEntry?.ownerName).toBe("Tim");
  expect(updatedEntry?.linkedSplitExpenseId).toBeTruthy();

  await secondPage.close();
});
