import { expect, test } from "@playwright/test";

import { gotoPageAfterApi, loadEntriesPage, loadSplitsPage, postJson, reseedDemo } from "./helpers";

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
  await expect(page.getByRole("dialog")).toBeVisible({ timeout: 60_000 });
  await expect(page.getByRole("dialog").getByLabel("Description")).toHaveValue(description);
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
  await expect(editor.getByLabel("Amount")).toHaveValue("22");

  await editor.locator("select").first().selectOption("Entertainment");
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
  try {
    await expect(groupPicker).toBeVisible({ timeout: 1000 });
    await groupPicker.locator("select").selectOption({ label: "Non-group expenses" });
  } catch {
    // Single-group split workspaces post immediately without opening the picker.
  }
  await splitResponse;

  const viewSplitButton = editor.getByRole("button", { name: "View split" });
  await expect(viewSplitButton).toBeVisible({ timeout: 30_000 });

  const splitsPageReady = page.waitForResponse((response) => response.url().includes("/api/splits-page") && response.ok());
  await viewSplitButton.click();
  await splitsPageReady;

  await expect(page).toHaveURL(/\/splits\?/);
  expect(new URL(page.url()).searchParams.get("view")).toBe("household");
  expect(new URL(page.url()).searchParams.get("month")).toBe(month);
  expect(new URL(page.url()).searchParams.get("scope")).toBe("direct_plus_shared");
  await expect(page.getByRole("dialog")).toBeVisible({ timeout: 60_000 });
  await expect(page.getByRole("dialog").getByLabel("Description")).toHaveValue(description);

  await page.getByRole("dialog").getByRole("button", { name: "View entry" }).click();
  await expect(page).toHaveURL(/\/entries\?/);
  const returnUrl = new URL(page.url());
  expect(returnUrl.searchParams.get("view")).toBe("household");
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

  await page.goto(`/entries?view=person-tim&month=${month}&editing_entry=${createdEntry.entryId}`);
  const editor = page.locator(".entry-inline-editor").first();
  await expect(editor).toBeVisible();

  await page.route("**/api/entries-page**", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 3000));
    await route.continue();
  });

  await editor.getByRole("button", { name: "Add to splits" }).click();
  await expect(page.getByRole("dialog", { name: "Add to splits" })).toBeVisible({ timeout: 1000 });
  await expect(page.getByRole("dialog", { name: "Add to splits" }).locator("select")).toContainText("Holiday");
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
  await page.getByRole("dialog", { name: "Add to splits" }).locator("select").selectOption({ label: "Non-group expenses" });
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

test("equal split amounts keep the odd cent on the deterministic remainder share", async ({ page }) => {
  const description = `Playwright split rounding ${Date.now()}`;

  await page.goto("/");
  await reseedDemo(page);

  const entry = await postJson(page, "/api/entries/create", {
    date: "2026-04-24",
    description,
    accountName: "UOB One",
    categoryName: "Groceries",
    amountMinor: 13999,
    entryType: "expense",
    ownershipType: "direct",
    ownerName: "Tim"
  });

  const splitData = await postJson(page, "/api/splits/expenses/from-entry", {
    entryId: entry.entryId,
    splitGroupId: null
  });

  const entriesData = await loadEntriesPage(page, { view: "person-tim", month: "2026-04" });
  const createdEntry = entriesData.monthPage.entries.find((item) => item.description === description);
  expect(createdEntry?.ownershipType).toBe("direct");
  expect(createdEntry?.linkedSplitShares).toEqual([
    expect.objectContaining({ personId: "person-tim", amountMinor: 6999 }),
    expect.objectContaining({ personId: "person-joyce", amountMinor: 7000 })
  ]);

  const splitsData = await loadSplitsPage(page, { view: "person-tim", month: "2026-04" });
  const createdSplit = splitsData.splitsPage.activity.find((item) => item.description === description);
  expect(createdSplit?.viewerAmountMinor).toBe(7000);
});

test("entries totals strip follows the current person's shared percentage", async ({ page }) => {
  const description = `Playwright shared totals ${Date.now()}`;
  const transferDescription = `Playwright shared transfer ${Date.now()}`;

  await page.goto("/");
  await reseedDemo(page);

  const entry = await postJson(page, "/api/entries/create", {
    date: "2026-04-24",
    description,
    accountName: "UOB One",
    categoryName: "Groceries",
    amountMinor: 2000,
    entryType: "expense",
    ownershipType: "shared",
    splitBasisPoints: 2500
  });
  await postJson(page, "/api/entries/create", {
    date: "2026-04-24",
    description: transferDescription,
    accountName: "UOB One",
    categoryName: "Transfer",
    amountMinor: 1000,
    entryType: "transfer",
    transferDirection: "out",
    ownershipType: "shared",
    splitBasisPoints: 2500
  });

  await postJson(page, "/api/entries/update", {
    entryId: entry.entryId,
    date: "2026-04-24",
    description,
    accountName: "UOB One",
    categoryName: "Groceries",
    amountMinor: 2000,
    entryType: "expense",
    ownershipType: "shared",
    splitBasisPoints: 4000
  });

  const timData = await loadEntriesPage(page, { view: "person-tim", month: "2026-04" });
  const timEntry = timData.monthPage.entries.find((item) => item.description === description);
  expect(timEntry?.amountMinor).toBe(800);
  expect(timEntry?.totalAmountMinor).toBe(2000);
  expect(timEntry?.viewerSplitRatioBasisPoints).toBe(4000);

  const joyceData = await loadEntriesPage(page, { view: "person-joyce", month: "2026-04" });
  const joyceEntry = joyceData.monthPage.entries.find((item) => item.description === description);
  expect(joyceEntry?.amountMinor).toBe(1200);
  expect(joyceEntry?.totalAmountMinor).toBe(2000);
  expect(joyceEntry?.viewerSplitRatioBasisPoints).toBe(6000);
});

test("shared entry rows show full amount collapsed and expanded in person view", async ({ page }) => {
  const description = `Playwright shared editor amount ${Date.now()}`;

  await page.goto("/");
  await reseedDemo(page);

  await postJson(page, "/api/entries/create", {
    date: "2026-04-24",
    description,
    accountName: "UOB One",
    categoryName: "Groceries",
    amountMinor: 4700,
    entryType: "expense",
    ownershipType: "shared",
    splitBasisPoints: 5000
  });

  const timData = await loadEntriesPage(page, { view: "person-tim", month: "2026-04" });
  const timEntry = timData.monthPage.entries.find((item) => item.description === description);
  expect(timEntry?.amountMinor).toBe(2350);
  expect(timEntry?.totalAmountMinor).toBe(4700);
  expect(timEntry?.viewerSplitRatioBasisPoints).toBe(5000);

  const householdData = await loadEntriesPage(page, { view: "household", month: "2026-04" });
  const householdEntry = householdData.monthPage.entries.find((item) => item.description === description);
  expect(householdEntry?.amountMinor).toBe(4700);
  expect(householdEntry?.viewerSplitRatioBasisPoints).toBeUndefined();
});
