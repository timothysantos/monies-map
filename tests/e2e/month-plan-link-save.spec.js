import { devices, expect, test } from "@playwright/test";

import { loadMonthPage, postJson, reseedDemo } from "./helpers";

// Saving "Match planned item" is a real write. While it is in flight the
// dialog (desktop) or sheet (mobile) shows it is saving, takes one submit
// only and ignores Escape and Cancel. A failed save keeps it open with the
// draft and an inline error; only a successful save closes it.

async function seedPlanRowWithCandidate(page, suffix) {
  const label = `Playwright match save ${suffix}`;
  await postJson(page, "/api/month-plan/save", {
    rowId: `playwright-match-save-${suffix}`,
    month: "2026-05",
    sectionKey: "planned_items",
    categoryName: "Entertainment",
    label,
    planDate: "2026-05-18",
    accountName: "UOB One",
    plannedMinor: 5000,
    note: "",
    ownershipType: "direct",
    ownerName: "Tim"
  });
  const description = `Playwright match candidate ${suffix}`;
  const entry = await postJson(page, "/api/entries/create", {
    date: "2026-05-18",
    description,
    accountName: "UOB One",
    categoryName: "Entertainment",
    amountMinor: 1600,
    entryType: "expense",
    ownershipType: "direct",
    ownerName: "Tim"
  });
  return { label, description, entryId: entry.entryId };
}

async function readLinkedEntryIds(page, label) {
  const monthPage = await loadMonthPage(page, { month: "2026-05" });
  const plannedItems = monthPage.monthPage.planSections.find((section) => section.key === "planned_items");
  return plannedItems?.rows.find((item) => item.label === label)?.linkedEntryIds ?? [];
}

const layouts = [
  { name: "desktop", context: {}, surface: (page) => page.locator(".planned-link-dialog") },
  { name: "mobile", context: devices["iPhone 12 Pro"], surface: (page) => page.locator('.entry-mobile-sheet[aria-label="Match planned item"]') }
];

for (const layout of layouts) {
  test(`${layout.name}: a match save shows saving, submits once, keeps the draft on failure and closes only on success`, async ({ browser }) => {
    const context = await browser.newContext(layout.context);
    const page = await context.newPage();
    const pageErrors = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    await page.addInitScript(() => window.localStorage.setItem("monies-map:money-totals-visible", "true"));
    await page.goto("/");
    await reseedDemo(page);
    const { label, description, entryId } = await seedPlanRowWithCandidate(page, `${layout.name}-${Date.now()}`);

    await page.goto("/month?view=person-tim&month=2026-05&scope=direct_plus_shared");
    await page.locator("tr").filter({ hasText: label }).first().getByRole("button", { name: "Link entries" }).click();
    const surface = layout.surface(page);
    await expect(surface).toBeVisible();
    const candidate = surface.locator(".planned-link-row").filter({ hasText: description }).getByRole("checkbox");
    await candidate.check();

    let linkRequests = 0;
    let failLinks = true;
    let releaseLinks;
    const linksHeld = new Promise((resolve) => { releaseLinks = resolve; });
    await page.route("**/api/month-plan/links", async (route) => {
      linkRequests += 1;
      if (!failLinks) {
        await route.continue();
        return;
      }
      await linksHeld;
      await route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ ok: false, error: "Links exploded" }) });
    });

    const save = surface.getByRole("button", { name: "Save matches" });
    await save.dblclick();
    const saving = surface.getByRole("button", { name: "Saving..." });
    await expect(saving).toBeDisabled();
    // Escape and Cancel wait while the save is in flight.
    await page.keyboard.press("Escape");
    await expect(surface).toBeVisible();
    await surface.getByRole("button", { name: "Cancel" }).click({ force: true });
    await expect(surface).toBeVisible();
    expect(linkRequests).toBe(1);

    releaseLinks();
    const error = surface.getByRole("alert");
    await expect(error).toContainText("Links exploded");
    await expect(surface).toBeVisible();
    await expect(candidate).toBeChecked();
    await expect(surface.getByRole("button", { name: "Save matches" })).toBeEnabled();
    expect(await readLinkedEntryIds(page, label)).toEqual([]);

    failLinks = false;
    await surface.getByRole("button", { name: "Save matches" }).click();
    await expect(surface).toHaveCount(0);
    await expect.poll(() => readLinkedEntryIds(page, label)).toEqual([entryId]);
    expect(linkRequests).toBe(2);
    expect(pageErrors).toEqual([]);

    await context.close();
  });
}

test("desktop: a failed match save clears its error when the dialog is reopened", async ({ page }) => {
  await page.addInitScript(() => window.localStorage.setItem("monies-map:money-totals-visible", "true"));
  await page.goto("/");
  await reseedDemo(page);
  const { label, description } = await seedPlanRowWithCandidate(page, `reopen-${Date.now()}`);
  await page.goto("/month?view=person-tim&month=2026-05&scope=direct_plus_shared");
  const planRow = page.locator("tr").filter({ hasText: label }).first();
  await planRow.getByRole("button", { name: "Link entries" }).click();
  const dialog = page.locator(".planned-link-dialog");
  await dialog.locator(".planned-link-row").filter({ hasText: description }).getByRole("checkbox").check();
  await page.route("**/api/month-plan/links", (route) => route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ ok: false, error: "Links exploded" }) }));
  await dialog.getByRole("button", { name: "Save matches" }).click();
  await expect(dialog.getByRole("alert")).toContainText("Links exploded");

  // After the save settles, Escape discards the draft as before.
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await planRow.getByRole("button", { name: "Link entries" }).click();
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("alert")).toHaveCount(0);
  await expect(dialog.locator(".planned-link-row").filter({ hasText: description }).getByRole("checkbox")).not.toBeChecked();
});
