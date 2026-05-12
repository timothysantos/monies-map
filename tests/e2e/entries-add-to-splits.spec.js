import { expect, test } from "@playwright/test";

import { loadEntriesPage, loadSplitsPage, postJson, reseedDemo } from "./helpers";

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
  expect(createdEntry?.ownershipType).toBe("shared");
  expect(createdEntry?.linkedSplitExpenseId).toBe(splitData.splitExpenseId);

  const splitsData = await loadSplitsPage(page, { view: "person-tim", month: "2026-04" });
  const createdSplit = splitsData.splitsPage.activity.find((item) => item.description === description);
  expect(createdSplit).toBeTruthy();
  expect(createdSplit?.linkedTransactionId).toBe(entry.entryId);

  await page.goto(`/splits?view=person-tim&month=2026-04&editing_split_expense=${splitData.splitExpenseId}`);
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.getByRole("dialog").getByLabel("Description")).toHaveValue(description);
});

test("add to splits refreshes split groups and forces group selection when multiple groups exist", async ({ page }) => {
  const description = `Playwright split picker refresh ${Date.now()}`;

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

  await postJson(page, "/api/splits/groups/create", { name: "Holiday" });
  await postJson(page, "/api/splits/groups/create", { name: "Home" });

  const entriesPage = await loadEntriesPage(page, { view: "person-tim", month: "2026-04" });
  const splitGroupNames = entriesPage.splitGroups.map((group) => group.name);
  expect(splitGroupNames).toContain("Non-group expenses");
  expect(splitGroupNames).toContain("Holiday");
  expect(splitGroupNames).toContain("Home");

  const splitResponse = await page.request.post("/api/splits/expenses/from-entry", {
    data: {
      entryId: entry.entryId,
      splitGroupId: entriesPage.splitGroups[1].id
    }
  });
  expect(splitResponse.ok()).toBeTruthy();
});

test("equal split amounts keep the rounded cent on the remainder share", async ({ page }) => {
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
  expect(createdEntry?.splits).toEqual([
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
