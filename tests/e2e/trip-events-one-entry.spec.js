import { devices, expect, test } from "@playwright/test";

import { gotoPageAfterApi, postJson, reseedDemo } from "./helpers";

// Trips and events, one entry (DOMAIN.md "Trip or Event"): a row on a trip
// shows a plain chip with its name; the chip and the entry card's "Trip or
// event" row open the picker (search, the trip on now first, recent, None,
// and "Make" for a new name), choosing saves at once, and the note's Undo
// puts it back. Desktop popover and phone sheet.

const MONTH = "2026-05";
const { defaultBrowserType: _browser, ...iPhone13 } = devices["iPhone 13"];
const SHOTS = process.env.TRIP_SHOTS_DIR ?? "";

async function seed(page) {
  await reseedDemo(page);
  const stamp = Date.now();
  const make = (description, day, amountMinor) => postJson(page, "/api/entries/create", {
    date: `${MONTH}-${day}`,
    description,
    accountName: "UOB One",
    categoryName: "Food & Drinks",
    amountMinor,
    entryType: "expense",
    ownershipType: "direct",
    ownerName: "Tim"
  });
  const onTrip = await make(`Gwangjang Market ${stamp}`, "14", 3_680);
  const loose = await make(`Olive Young ${stamp}`, "15", 13_750);
  const { tripEvent } = await postJson(page, "/api/trip-events/save", { name: "Seoul trip", startDate: `${MONTH}-13`, endDate: `${MONTH}-19`, currency: "KRW" });
  await postJson(page, "/api/trip-events/entries/set", { entryIds: [onTrip.entryId], tripEventId: tripEvent.id });
  await postJson(page, "/api/trip-events/save", { name: "Bali trip", startDate: "2026-01-12", endDate: "2026-01-19" });
  return { stamp, tripEvent, onTripId: onTrip.entryId, looseId: loose.entryId };
}

async function openEntries(page, text) {
  const row = page.locator(".entry-row").filter({ hasText: text }).first();
  await gotoPageAfterApi(page, `/entries?view=person-tim&month=${MONTH}`, "/api/entries-page", () => row);
  return row;
}

const picker = (page) => page.getByRole("listbox", { name: "Trips & events" });
const option = (page, name) => page.locator(`[data-trip-option="${name}"]`);
const note = (page) => page.locator("[data-trip-note]");
const tripCount = async (page, name) => {
  const response = await page.request.get("/api/trip-events");
  const body = await response.json();
  return body.tripEvents.find((trip) => trip.name === name)?.entryCount ?? null;
};

test.describe("desktop", () => {
  test("the chip opens the picker; None takes it off with Undo, and a new name is made from the card's row", async ({ page }) => {
    const { stamp } = await seed(page);
    const tripRow = await openEntries(page, `Gwangjang Market ${stamp}`);
    const chip = tripRow.locator("[data-trip-chip]");
    await expect(chip).toHaveText("Seoul trip");
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/slice2-desktop-row-chip.png` });

    await chip.click();
    await expect(picker(page)).toBeVisible();
    await expect(page.getByRole("combobox", { name: "Find or make a trip or event" })).toBeFocused();
    // The trip on now (its dates hold today in no test) is in Recent here;
    // the current one is checked and None is offered.
    await expect(option(page, "Seoul trip")).toHaveAttribute("aria-selected", "true");
    await expect(option(page, "none")).toBeVisible();
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/slice2-desktop-picker.png` });

    await option(page, "none").click();
    await expect(note(page)).toContainText("Taken off its trip or event");
    await expect(tripRow.locator("[data-trip-chip]")).toHaveCount(0);
    await expect.poll(() => tripCount(page, "Seoul trip")).toBe(0);

    await note(page).getByRole("button", { name: "Undo" }).click();
    await expect(note(page)).toContainText("Undone");
    await expect(tripRow.locator("[data-trip-chip]")).toHaveText("Seoul trip");
    await expect.poll(() => tripCount(page, "Seoul trip")).toBe(1);

    // The card's row on the other entry: type a new name and press Enter.
    const looseRow = page.locator(".entry-row").filter({ hasText: `Olive Young ${stamp}` }).first();
    await looseRow.locator(".entry-row-main").click();
    const tripDetail = page.locator('[data-row="tripEvent"]');
    await expect(tripDetail).toContainText("None");
    await tripDetail.click();
    const search = page.getByRole("combobox", { name: "Find or make a trip or event" });
    await search.fill("Jeju weekend");
    await expect(option(page, "make")).toContainText('Make "Jeju weekend"');
    await search.press("Enter");
    await expect(note(page)).toContainText("Put on Jeju weekend");
    await expect.poll(() => tripCount(page, "Jeju weekend")).toBe(1);
    await expect(page.locator('[data-row="tripEvent"]')).toContainText("Jeju weekend");
  });

  test("a failed save keeps the picker open with the reason and changes nothing", async ({ page }) => {
    const { stamp } = await seed(page);
    const tripRow = await openEntries(page, `Gwangjang Market ${stamp}`);
    await page.route("**/api/trip-events/entries/set", (route) => route.fulfill({ status: 400, contentType: "application/json", body: JSON.stringify({ ok: false, error: "That trip or event was not found." }) }));
    await tripRow.locator("[data-trip-chip]").click();
    await option(page, "Bali trip").click();
    await expect(page.getByRole("alert")).toContainText("That trip or event was not found.");
    await expect(picker(page)).toBeVisible();
    await expect(tripRow.locator("[data-trip-chip]")).toHaveText("Seoul trip");
  });
});

test.describe("phone", () => {
  test.use({ ...iPhone13 });

  test("the entry sheet's row opens the picker sheet; a tap moves it at once, rows are at least 44 px", async ({ page }) => {
    const { stamp } = await seed(page);
    const row = await openEntries(page, `Olive Young ${stamp}`);
    await row.locator(".entry-row-main").click();
    const tripDetail = page.locator('[data-row="tripEvent"]');
    await expect(tripDetail).toBeVisible();
    await tripDetail.click();
    await expect(picker(page)).toBeVisible();
    const box = await option(page, "Seoul trip").boundingBox();
    expect(box.height).toBeGreaterThanOrEqual(44);
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/slice2-phone-picker.png` });
    await option(page, "Seoul trip").click();
    await expect(note(page)).toContainText("Put on Seoul trip");
    await expect(page.locator('[data-row="tripEvent"]')).toContainText("Seoul trip");
    await expect.poll(() => tripCount(page, "Seoul trip")).toBe(2);
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/slice2-phone-card.png` });
  });
});
