import { expect, test } from "@playwright/test";
import { mkdir } from "node:fs/promises";

import { categoryList, categoryOption, gotoPageAfterApi, loadMonthPage, postJson, reseedDemo } from "./helpers";

// Transfer purpose (DOMAIN.md "Transfer Purpose"), the owner's case: Tim
// sends $450 from UOB Savings to Joyce's bank account each month and the
// bank takes the $900 house loan from Joyce's account. Setting "What is this
// for?" to Home on the transfer makes it Tim's Home spending (his House loan
// line is paid) and lowers Joyce's Home by $450; the household is unchanged.
// The next month's transfer gets the same purpose by itself, with Undo.

const MONTH = "2026-05";
const PHONE = { width: 390, height: 844 };
// CAPTURE_TRANSFER_PURPOSE_SHOTS=1 writes the before/after frames for the
// audit (docs/audits/transfer-purpose/).
const SHOTS = process.env.CAPTURE_TRANSFER_PURPOSE_SHOTS ? "docs/audits/transfer-purpose" : null;

async function shot(page, name, locator = null) {
  if (!SHOTS) {
    return;
  }
  await mkdir(SHOTS, { recursive: true });
  if (locator) {
    // Clear of the sticky date row above it.
    await locator.evaluate((element) => element.scrollIntoView({ block: "center" }));
  }
  await (locator ?? page).screenshot({ path: `${SHOTS}/${name}.png` });
}

async function createEntry(page, body) {
  const created = await postJson(page, "/api/entries/create", { ownershipType: "direct", ownerName: "Tim", ...body });
  return created.entryId;
}

// Joyce's bank account, her loan debit, Tim's linked transfer and his plan line.
async function seedOwnerCase(page) {
  await postJson(page, "/api/accounts/create", { name: "Joyce Bank", institution: "DBS", kind: "bank", currency: "SGD", openingBalanceMinor: 0, ownerPersonId: "person-joyce" });
  await createEntry(page, { date: `${MONTH}-05`, description: "HDB loan GIRO", accountName: "Joyce Bank", categoryName: "Home", entryType: "expense", amountMinor: 90_000, ownerName: "Joyce" });
  const outId = await createEntry(page, { date: `${MONTH}-01`, description: "FAST to Joyce", accountName: "UOB Savings", categoryName: "Transfer", entryType: "transfer", transferDirection: "out", amountMinor: 45_000 });
  const inId = await createEntry(page, { date: `${MONTH}-01`, description: "FAST from Tim", accountName: "Joyce Bank", categoryName: "Transfer", entryType: "transfer", transferDirection: "in", amountMinor: 45_000, ownerName: "Joyce" });
  await postJson(page, "/api/transfers/link", { fromEntryId: outId, toEntryId: inId });
  await postJson(page, "/api/month-plan/save", {
    rowId: "e2e-house-loan", month: MONTH, sectionKey: "planned_items", categoryName: "Home", label: "House loan",
    planDate: `${MONTH}-01`, accountName: "UOB Savings", plannedMinor: 45_000, ownershipType: "direct", ownerName: "Tim"
  });
  return { outId, inId };
}

async function homeAndSpend(page, view, month = MONTH) {
  const { monthPage } = await loadMonthPage(page, { view, month });
  return {
    home: monthPage.categoryShareChart.find((slice) => slice.label === "Home")?.valueMinor ?? 0,
    spend: monthPage.metricCards.find((card) => card.label === "Actual spend").amountMinor,
    houseLoan: monthPage.planSections.flatMap((section) => section.rows).find((row) => row.id === "e2e-house-loan")?.actualMinor ?? null
  };
}

async function openEntryEditor(page, entryId, { month = MONTH } = {}) {
  await gotoPageAfterApi(
    page,
    `/entries?view=household&month=${month}&editing_entry=${entryId}`,
    "/api/entries-page",
    () => page.getByRole("button", { name: /^What is this for\?/ })
  );
}

// The Entries page's view pills (Household, Tim, Joyce).
async function switchView(page, name) {
  await page.locator(".context-block .pill-row").getByRole("button", { name, exact: true }).click();
  await expect(page.locator(".panel-context")).toContainText(`Viewing entries for ${name}`);
}

async function choosePurpose(page, name) {
  const saved = page.waitForResponse((response) => response.url().includes("/api/transfers/purpose") && response.ok());
  await page.getByRole("button", { name: /^What is this for\?/ }).click();
  await expect(categoryList(page)).toBeVisible();
  // Only categories a transfer can pay for are offered.
  await expect(categoryOption(page, "Transfer")).toHaveCount(0);
  await expect(categoryOption(page, "Savings")).toHaveCount(0);
  await categoryOption(page, name).click();
  await saved;
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem("monies-map:money-totals-visible", "true");
    window.__MONIES_MAP_WARMUP_MODE__ = "off";
  });
  await page.goto("/");
  await reseedDemo(page);
  // A fresh stack's first page saw the empty household; load the reseeded
  // people (Tim, Joyce) before switching views by name.
  await page.goto("/");
});

test("desktop: What is this for? Home moves $450 into Tim's Home and out of Joyce's, pays House loan, and leaves the household as it was", async ({ page }) => {
  const { outId } = await seedOwnerCase(page);
  const before = {
    tim: await homeAndSpend(page, "person-tim"),
    joyce: await homeAndSpend(page, "person-joyce"),
    household: await homeAndSpend(page, "household")
  };
  expect(before.tim.houseLoan).toBe(0);
  if (SHOTS) {
    await gotoPageAfterApi(page, `/entries?view=household&month=${MONTH}`, "/api/entries-page", () => page.locator(`[id="${outId}"]`));
    await switchView(page, "Tim");
    await shot(page, "desktop-before-row-tim", page.locator(`[id="${outId}"]`));
    await gotoPageAfterApi(page, `/month?view=household&month=${MONTH}`, "/api/month-page", () => page.locator(".context-block .pill-row"));
    await page.locator(".context-block .pill-row").getByRole("button", { name: "Tim", exact: true }).click();
    await expect(page).toHaveURL(/view=person-tim/);
    await shot(page, "desktop-before-month-tim", page.locator("tr").filter({ hasText: "House loan" }).filter({ hasText: "Home" }).first());
  }

  await openEntryEditor(page, outId);
  const editor = page.locator(".entry-inline-editor");
  await expect(editor.getByRole("button", { name: /^What is this for\?/ })).toContainText("Not set");
  await shot(page, "desktop-before-editor", editor);
  await choosePurpose(page, "Home");
  await expect(editor.getByRole("button", { name: /^What is this for\?/ })).toContainText("Home");
  await expect(editor.getByRole("button", { name: "Just a transfer" })).toBeVisible();
  await shot(page, "desktop-after-editor", editor);
  await editor.getByRole("button", { name: "Cancel editing entry" }).click();

  // The household row stays a transfer and says what it was for.
  const row = page.locator(`[id="${outId}"]`);
  await expect(row.locator(".entry-chip-transfer")).toHaveText("Matched transfer out · for Home");
  await shot(page, "desktop-after-row-household", row);

  // In Tim's view the row reads as his Home spending and is still visibly a transfer.
  await switchView(page, "Tim");
  await expect(row.locator(".entry-chip-transfer")).toHaveText("Transfer to Joyce");
  await expect(row.locator(".entry-row-category-label")).toContainText("Home");
  await shot(page, "desktop-after-row-tim", row);

  // Tim links it to his House loan line from the Month page's plan link.
  await postJson(page, "/api/month-plan/links", { rowId: "e2e-house-loan", month: MONTH, transactionIds: [outId] });
  const after = {
    tim: await homeAndSpend(page, "person-tim"),
    joyce: await homeAndSpend(page, "person-joyce"),
    household: await homeAndSpend(page, "household")
  };
  expect(after.tim).toEqual({ home: before.tim.home + 45_000, spend: before.tim.spend + 45_000, houseLoan: 45_000 });
  expect(after.joyce).toEqual({ ...before.joyce, home: before.joyce.home - 45_000, spend: before.joyce.spend - 45_000 });
  expect(after.household).toEqual(before.household);
  expect(after.tim.home + after.joyce.home).toBe(after.household.home);

  // Joyce's list shows Tim's transfer as his part of her Home.
  await switchView(page, "Joyce");
  await expect(row.locator(".entry-chip-transfer")).toHaveText("Tim's transfer to you");
  await expect(row.locator(".entry-row-category-label")).toContainText("Home");
  await shot(page, "desktop-after-row-joyce", row);

  // Tim's Month: the House loan line now shows the $450 paid.
  if (SHOTS) {
    await gotoPageAfterApi(page, `/month?view=household&month=${MONTH}`, "/api/month-page", () => page.locator(".context-block .pill-row"));
    await page.locator(".context-block .pill-row").getByRole("button", { name: "Tim", exact: true }).click();
    await expect(page).toHaveURL(/view=person-tim/);
    // Tim's own line (Home, 1 May), not the demo's Loans line of the same name.
    const houseLoan = page.locator("tr").filter({ hasText: "House loan" }).filter({ hasText: "Home" }).first();
    await expect(houseLoan).toContainText("$450.00");
    await houseLoan.scrollIntoViewIfNeeded();
    await shot(page, "desktop-after-month-tim", houseLoan);
  }
});

test("next month's transfer gets the purpose by itself, says so, and Undo clears it", async ({ page }) => {
  const { outId } = await seedOwnerCase(page);
  await postJson(page, "/api/transfers/purpose", { entryId: outId, categoryName: "Home" });
  const june = await createEntry(page, { date: "2026-06-01", description: "FAST to Joyce", accountName: "UOB Savings", categoryName: "Transfer", entryType: "transfer", transferDirection: "out", amountMinor: 45_000 });
  expect((await homeAndSpend(page, "person-tim", "2026-06")).home).toBeGreaterThanOrEqual(45_000);

  await openEntryEditor(page, june, { month: "2026-06" });
  const editor = page.locator(".entry-inline-editor");
  await expect(editor.getByText("Set like last month")).toBeVisible();
  await expect(editor.getByRole("button", { name: /^What is this for\?/ })).toContainText("Home");
  await shot(page, "desktop-remembered-editor", editor);
  const undone = page.waitForResponse((response) => response.url().includes("/api/transfers/purpose") && response.ok());
  await editor.getByRole("button", { name: "Undo" }).click();
  await undone;
  // Not matched with Joyce's side yet, so with the purpose gone the row
  // is not offered again until it is.
  await expect(editor.getByText("Set like last month")).toHaveCount(0);
  await expect(editor.getByRole("button", { name: /^What is this for\?/ })).toHaveCount(0);
  const { monthPage } = await loadMonthPage(page, { view: "person-tim", month: "2026-06" });
  const listed = monthPage.entries.find((entry) => entry.id === june);
  expect([listed.entryType, listed.transferPurpose]).toEqual(["transfer", undefined]);
});

test("a move between Tim's own accounts offers no What is this for?", async ({ page }) => {
  const outId = await createEntry(page, { date: `${MONTH}-03`, description: "Card bill", accountName: "UOB Savings", categoryName: "Transfer", entryType: "transfer", transferDirection: "out", amountMinor: 20_000 });
  const inId = await createEntry(page, { date: `${MONTH}-03`, description: "Card bill paid", accountName: "UOB One", categoryName: "Transfer", entryType: "transfer", transferDirection: "in", amountMinor: 20_000 });
  await postJson(page, "/api/transfers/link", { fromEntryId: outId, toEntryId: inId });
  await gotoPageAfterApi(page, `/entries?view=household&month=${MONTH}&editing_entry=${outId}`, "/api/entries-page", () => page.getByRole("button", { name: "Manage transfer" }));
  await expect(page.getByRole("button", { name: /^What is this for\?/ })).toHaveCount(0);
});

test("390px: the edit sheet sets What is this for? and Tim's row reads as Home spending", async ({ page }) => {
  await page.setViewportSize(PHONE);
  const { outId } = await seedOwnerCase(page);
  const before = await homeAndSpend(page, "person-tim");
  await openEntryEditor(page, outId);
  const sheet = page.locator('.entry-mobile-sheet[aria-label="Edit entry"]');
  await expect(sheet).toBeVisible();
  await shot(page, "phone-before-sheet");
  await choosePurpose(page, "Home");
  await expect(sheet.getByRole("button", { name: /^What is this for\?/ })).toContainText("Home");
  await shot(page, "phone-after-sheet");
  expect((await homeAndSpend(page, "person-tim")).home).toBe(before.home + 45_000);
  // No horizontal scroll at phone width.
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
