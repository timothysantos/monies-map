import { devices, expect, test } from "@playwright/test";

import { gotoPageAfterApi, postJson, reseedDemo } from "./helpers";

// The trip view (DOMAIN.md "Trip or Event"): the "Trip or event" filter
// opens Trips & events, choosing one turns the Entries top into the trip's
// summary (Spent, who it was for, before you went and while away, where it
// went, day by day) over every entry on it across its months, and Clear
// goes back. Desktop filter bar; phone View and scope sheet and island.

const MONTH = "2026-05";
const { defaultBrowserType: _browser, ...iPhone13 } = devices["iPhone 13"];
const SHOTS = process.env.TRIP_SHOTS_DIR ?? "";

async function seedTrip(page) {
  await reseedDemo(page);
  const make = (description, date, amountMinor, extra = {}) => postJson(page, "/api/entries/create", {
    date, description, accountName: "UOB One", categoryName: "Travel", amountMinor, entryType: "expense", ownershipType: "direct", ownerName: "Tim", ...extra
  }).then((body) => body.entryId);
  const ids = [
    await make("SQ flights to Seoul", "2026-04-14", 128_640),
    await make("Lotte Hotel Seoul", `${MONTH}-13`, 119_820),
    await make("Gwangjang Market", `${MONTH}-14`, 3_680, { categoryName: "Food & Drinks", accountName: "Citi Rewards", ownerName: "Joyce" }),
    await make("Kakao T taxi", `${MONTH}-15`, 1_780, { categoryName: "Public Transport" })
  ];
  const { tripEvent } = await postJson(page, "/api/trip-events/save", { name: "Seoul trip", startDate: `${MONTH}-13`, endDate: `${MONTH}-19`, currency: "KRW" });
  await postJson(page, "/api/trip-events/entries/set", { entryIds: ids, tripEventId: tripEvent.id });
  return tripEvent;
}

// The amounts are read, so money shows.
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => window.localStorage.setItem("monies-map:money-totals-visible", "true"));
});

const lead = (page) => page.locator("[data-trip-lead]");
const sheet = (page) => page.getByRole("dialog", { name: "Trips & events" });

test.describe("desktop", () => {
  test("the filter opens Trips & events; a trip turns the top into its summary across months; Clear goes back", async ({ page }) => {
    await seedTrip(page);
    await gotoPageAfterApi(page, `/entries?view=household&month=${MONTH}`, "/api/entries-page", () => page.locator(".entry-row").first());
    await page.locator("[data-trip-filter]").click();
    await expect(sheet(page)).toBeVisible();
    const row = page.locator('[data-trip-sheet-row="Seoul trip"]');
    await expect(row).toContainText("$2,539.20");
    await expect(row).toContainText("4 entries");
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/slice3-desktop-sheet.png` });
    await row.click();

    await expect(page).toHaveURL(/entry_trip=/);
    await expect(lead(page)).toBeVisible();
    await expect(lead(page).locator("[data-trip-spent]")).toHaveText("$2,539.20");
    await expect(lead(page).locator('[data-trip-pill="person-tim"]')).toContainText("$2,502.40");
    await expect(lead(page).locator('[data-trip-pill="person-joyce"]')).toContainText("$36.80");
    await expect(lead(page).locator('[data-trip-pill="before"]')).toContainText("$1,286.40");
    await expect(lead(page).locator('[data-trip-pill="away"]')).toContainText("$1,252.80");
    await expect(lead(page)).toContainText("Where it went");
    await expect(lead(page)).toContainText("Day by day");
    // Every entry on the trip, the April flights too, and nothing else.
    await expect(page.locator(".entry-row")).toHaveCount(4);
    await expect(page.locator(".entry-row").filter({ hasText: "SQ flights to Seoul" })).toHaveCount(1);
    await expect(page.locator("[data-trip-filter]")).toHaveText("Seoul trip");
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/slice3-desktop-trip-view.png`, fullPage: false });

    // Spent is the list itself: its menu offers Ask about this, not View entries.
    await lead(page).locator("[data-trip-spent]").click();
    const menu = page.locator('[data-figure-menu="trip"]');
    await expect(menu).toBeVisible();
    await expect(menu.getByRole("button", { name: "View entries" })).toHaveCount(0);
    await expect(menu.getByRole("button", { name: "Ask about this" })).toBeVisible();
    await page.keyboard.press("Escape");

    // A category bar opens the trip view narrowed to it, leading with its figure.
    await lead(page).locator('[data-fig-trip-category="Travel"]').click();
    await page.locator('[data-figure-menu="trip"]').getByRole("button", { name: "View entries" }).click();
    await expect(page).toHaveURL(/entry_category=Travel/);
    await expect(lead(page).locator("[data-trip-spent]")).toHaveText("$2,484.60");

    await lead(page).getByRole("button", { name: "Clear" }).click();
    await expect(page).not.toHaveURL(/entry_trip=/);
    await expect(lead(page)).toHaveCount(0);
  });

  test("delete takes the trip off its entries with Undo, and the entries stay", async ({ page }) => {
    const tripEvent = await seedTrip(page);
    await gotoPageAfterApi(page, `/entries?view=household&month=${MONTH}&entry_trip=${tripEvent.id}`, "/api/entries-page", () => lead(page));
    await lead(page).getByRole("button", { name: "Delete" }).click();
    const note = page.locator("[data-trip-note]");
    await expect(note).toContainText("Seoul trip deleted. Its entries stay");
    await expect(page).not.toHaveURL(/entry_trip=/);
    await expect(page.locator(".entry-row").filter({ hasText: "Lotte Hotel Seoul" })).toHaveCount(1);
    await note.getByRole("button", { name: "Undo" }).click();
    await expect(page).toHaveURL(/entry_trip=/);
    await expect(lead(page).locator("[data-trip-spent]")).toHaveText("$2,539.20");
  });
});

test.describe("phone", () => {
  test.use({ ...iPhone13 });

  test("the View and scope sheet's Trip or event opens the list; the island names the trip; the breakdowns fold", async ({ page }) => {
    await seedTrip(page);
    await gotoPageAfterApi(page, `/entries?view=household&month=${MONTH}`, "/api/entries-page", () => page.locator(".entry-row").first());
    await page.locator(".entries-totals .lsd-rows").getByRole("button", { name: /^Filters/ }).click();
    const context = page.getByRole("dialog", { name: "View and scope" });
    await expect(context).toBeVisible();
    await context.locator("[data-trip-filter]").click();
    await expect(sheet(page)).toBeVisible();
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/slice3-phone-sheet.png` });
    await page.locator('[data-trip-sheet-row="Seoul trip"]').click();
    await expect(sheet(page)).toHaveCount(0);
    if (await context.isVisible()) {
      await context.getByRole("button", { name: "Done" }).click();
    }
    await expect(lead(page).locator("[data-trip-spent]")).toHaveText("$2,539.20");
    await expect(page.locator(".mobile-context-line-text")).toHaveText("Seoul trip · 4 entries");
    const where = lead(page).getByRole("button", { name: /Where it went/ });
    await expect(where).toHaveAttribute("aria-expanded", "false");
    const box = await where.boundingBox();
    expect(box.height).toBeGreaterThanOrEqual(44);
    await where.click();
    await expect(lead(page).getByRole("region", { name: "Where it went" })).toBeVisible();
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/slice3-phone-trip-view.png` });
    await page.getByRole("button", { name: "Clear all filters" }).click();
    await expect(lead(page)).toHaveCount(0);
  });

  test("with no trips yet, the list teaches what it is for", async ({ page }) => {
    await reseedDemo(page);
    await gotoPageAfterApi(page, `/entries?view=household&month=${MONTH}`, "/api/entries-page", () => page.locator(".entry-row").first());
    await page.locator(".entries-totals .lsd-rows").getByRole("button", { name: /^Filters/ }).click();
    await page.getByRole("dialog", { name: "View and scope" }).locator("[data-trip-filter]").click();
    await expect(page.locator("[data-trip-sheet-empty]")).toContainText("See what a trip really cost");
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/slice3-phone-empty.png` });
  });
});
