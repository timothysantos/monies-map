import { devices, expect, test } from "@playwright/test";

import { gotoPageAfterApi, postJson, reseedDemo } from "./helpers";

// A trip or event's own page (DOMAIN.md "Trip page"): reached from the trip
// view's "Open Seoul trip" and from each row's arrow in Trips & events, it
// shows Spent, Day by day (a tap opens the day in place), Where it went,
// Who paid, Still owed (the hotel is on Splits) and Biggest spending, and
// every figure opens the trip view on Entries at that figure. Desktop
// (1440) and phone (iPhone 13, 390).

const MONTH = "2026-05";
const { defaultBrowserType: _browser, ...iPhone13 } = devices["iPhone 13"];
const SHOTS = process.env.TRIP_PAGE_SHOTS_DIR ?? "";

async function seedTrip(page) {
  await reseedDemo(page);
  const make = (description, date, amountMinor, extra = {}) => postJson(page, "/api/entries/create", {
    date, description, accountName: "UOB One", categoryName: "Travel", amountMinor, entryType: "expense", ownershipType: "direct", ownerName: "Tim", ...extra
  }).then((body) => body.entryId);
  const ids = [
    await make("SINGAPORE AIRLINES", "2026-04-14", 128_640, { note: "Flights to Seoul for two\nBooked in the April sale" }),
    await make("LOTTE HOTEL SEOUL", `${MONTH}-13`, 119_820),
    await make("GWANGJANG MARKET", `${MONTH}-14`, 3_680, { categoryName: "Food & Drinks", accountName: "Citi Rewards", ownerName: "Joyce", note: "Bindaetteok and makgeolli\nat the market" }),
    await make("KAKAO T", `${MONTH}-15`, 1_780, { categoryName: "Public Transport" })
  ];
  await postJson(page, "/api/splits/expenses/from-entry", { entryId: ids[1], splitGroupId: null, splitBasisPoints: 5000 });
  const { tripEvent } = await postJson(page, "/api/trip-events/save", { name: "Seoul trip", startDate: `${MONTH}-13`, endDate: `${MONTH}-19`, currency: "KRW" });
  await postJson(page, "/api/trip-events/entries/set", { entryIds: ids, tripEventId: tripEvent.id });
  return tripEvent;
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => window.localStorage.setItem("monies-map:money-totals-visible", "true"));
});

const tripPage = (page) => page.locator("[data-trip-page]");
const lead = (page) => page.locator("[data-trip-lead]");
const menu = (page) => page.locator('[data-figure-menu="trip"]');

async function expectTripPage(page) {
  await expect(tripPage(page)).toBeVisible();
  await expect(tripPage(page).getByRole("heading", { level: 2, name: "Seoul trip" })).toBeVisible();
  await expect(tripPage(page).locator("[data-trip-spent]")).toHaveText("$2,539.20");
  await expect(tripPage(page)).toContainText("13 – 19 May 2026 · 4 entries");
}

test.describe("desktop", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("the trip view opens the page; days open in place; every figure opens Entries at itself", async ({ page }) => {
    const tripEvent = await seedTrip(page);
    await gotoPageAfterApi(page, `/entries?view=household&month=${MONTH}&entry_trip=${tripEvent.id}`, "/api/entries-page", () => lead(page));
    const pageRead = page.waitForResponse((response) => response.url().includes("/api/trip-page?") && !response.url().includes("day="));
    await lead(page).getByRole("button", { name: "Open Seoul trip" }).click();
    await pageRead;
    await expect(page).toHaveURL(new RegExp(`/trips/${tripEvent.id}\\?view=household&month=${MONTH}`));
    await expectTripPage(page);
    // The Entries tab stays the one lit: the page belongs to it.
    await expect(page.locator("nav.tab-strip").getByRole("link", { name: "Entries" })).toHaveAttribute("aria-current", "page");

    // Day by day: one row a day, the flights' April day first.
    const days = page.locator("[data-trip-day]");
    await expect(days).toHaveCount(4);
    await expect(days.first()).toContainText("Tue 14 Apr");
    await expect(days.first()).toContainText("$1,286.40");
    // A tap opens the day's entries in place, the note's first line as the name.
    const marketDay = page.locator(`[data-trip-day="${MONTH}-14"]`);
    await marketDay.locator(".trip-row-main").click();
    await expect(marketDay.locator(".trip-row-main")).toHaveAttribute("aria-expanded", "true");
    await expect(marketDay.locator("[data-trip-entry]")).toHaveCount(1);
    await expect(marketDay.locator(".trip-entry-name")).toHaveText("Bindaetteok and makgeolli");
    await expect(marketDay.locator(".trip-entry-meta")).toContainText("Food & Drinks · Joyce");
    await expect(marketDay.locator(".trip-entry-amount")).toHaveText("-$36.80");

    // Where it went: Summary's Spending mix, by category.
    const mix = page.locator('[data-trip-card="mix"]');
    await expect(mix.getByRole("heading", { name: "Where it went" })).toBeVisible();
    await expect(mix.locator("[data-fig-row]")).toHaveCount(3);
    await expect(mix.locator('[data-fig-row="Travel"]')).toContainText("$2,484.60");

    // Who paid, in each person's colour.
    const payers = page.locator('[data-trip-card="payers"]');
    await expect(payers.locator('[data-trip-payer="Tim"]')).toContainText("$2,502.40");
    await expect(payers.locator('[data-trip-payer="Joyce"]')).toContainText("$36.80");
    // Still owed: the hotel is on Splits, half each.
    const owed = page.locator('[data-trip-card="owed"]');
    await expect(owed.locator("[data-trip-owed]")).toContainText("Joyce owes Tim");
    await expect(owed.locator("[data-trip-owed]")).toContainText("$599.10");
    await expect(owed.getByRole("button", { name: "Open Splits" })).toBeVisible();
    // Biggest spending: all four, biggest first.
    const biggest = page.locator('[data-trip-card="biggest"] [data-trip-entry]');
    await expect(biggest).toHaveCount(4);
    await expect(biggest.first().locator(".trip-entry-name")).toHaveText("Flights to Seoul for two");
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/desktop-trip-page.png`, fullPage: true });

    // Spent's menu: View entries (the trip view, household), Open Splits, Ask; never Open Seoul trip here.
    await tripPage(page).locator("[data-trip-spent]").click();
    await expect(menu(page).getByRole("button", { name: "Open Seoul trip" })).toHaveCount(0);
    await expect(menu(page).getByRole("button", { name: "Ask about this" })).toBeVisible();
    await page.keyboard.press("Escape");

    // A day's arrow opens Entries at that day's money.
    await page.locator(`[data-trip-day="${MONTH}-13"]`).getByRole("button", { name: "View entries for Wed 13 May" }).click();
    await menu(page).getByRole("button", { name: "View entries" }).click();
    await expect(page).toHaveURL(/\/entries\?.*entry_trip=/);
    await expect(lead(page).locator("[data-trip-spent]")).toHaveText("$1,198.20");
    await expect(page.locator(".entry-row")).toHaveCount(1);

    // Back on the page, a payer opens Entries at what they paid.
    await page.goBack();
    await expectTripPage(page);
    await page.locator('[data-trip-payer="Tim"] .trip-payer-amount').click();
    await menu(page).getByRole("button", { name: "View entries" }).click();
    await expect(lead(page).locator("[data-trip-spent]")).toHaveText("$2,502.40");
  });

  test("Trips & events' arrow opens the page; hidden money hides every amount; a gone trip says so", async ({ page }) => {
    await seedTrip(page);
    await gotoPageAfterApi(page, `/entries?view=household&month=${MONTH}`, "/api/entries-page", () => page.locator(".entry-row").first());
    await page.locator("[data-trip-filter]").click();
    await page.getByRole("dialog", { name: "Trips & events" }).getByRole("button", { name: "Open Seoul trip" }).click();
    await expect(page).toHaveURL(/\/trips\//);
    await expectTripPage(page);

    await page.getByRole("button", { name: "Hide money totals" }).first().click();
    await expect(tripPage(page).locator("[data-trip-spent]")).toHaveText("••••");
    await expect(tripPage(page)).not.toContainText("$");
    // No money tone shows through hidden money.
    const toned = await tripPage(page).locator(".money-out, .money-in, .money-short").evaluateAll((nodes) => nodes.map((node) => getComputedStyle(node).color));
    const ink = await tripPage(page).locator(".trip-page-title h2").evaluate((node) => getComputedStyle(node).color);
    expect(toned.every((colour) => colour === ink)).toBeTruthy();

    await page.goto(`/trips/trip-nowhere?view=household&month=${MONTH}`);
    await expect(page.getByText("This trip or event is gone.")).toBeVisible();
    await page.getByRole("button", { name: "Open Entries" }).click();
    await expect(page).toHaveURL(/\/entries/);
  });
});

test.describe("phone", () => {
  test.use({ ...iPhone13 });

  test("the page fits a phone, a day opens in place and Spent opens the trip view", async ({ page }) => {
    const tripEvent = await seedTrip(page);
    await gotoPageAfterApi(page, `/trips/${tripEvent.id}?view=household&month=${MONTH}`, "/api/trip-page", () => tripPage(page));
    await expectTripPage(page);
    // Nothing runs off the side.
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();
    const day = page.locator(`[data-trip-day="${MONTH}-15"]`);
    const box = await day.locator(".trip-row-main").boundingBox();
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
    await day.locator(".trip-row-main").click();
    await expect(day.locator(".trip-entry-name")).toHaveText("KAKAO T");
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/phone-trip-page.png`, fullPage: true });

    await tripPage(page).locator("[data-trip-spent]").click();
    await menu(page).getByRole("button", { name: "View entries" }).click();
    await expect(page).toHaveURL(/entry_trip=/);
    await expect(lead(page).locator("[data-trip-spent]")).toHaveText("$2,539.20");
  });
});
