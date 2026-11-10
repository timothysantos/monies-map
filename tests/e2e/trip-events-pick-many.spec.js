import { devices, expect, test } from "@playwright/test";

import { categoryList, categoryOption, gotoPageAfterApi, postJson, reseedDemo } from "./helpers";

// Trips and events, many entries at once (design.md "Trips and events on
// Entries", "Picking many"). A computer: Ctrl-click or Shift-click a row (or
// "Pick") starts picking, Shift-click picks a run in screen order, "Pick the
// whole day" a day, T opens the trip picker, Esc stops. The floating bar
// shows "N picked · $total" and offers "Put on a trip or event" and
// "Category" (the bulk category command, Undo the same way back); more than
// 200 are refused. A phone: press and hold starts picking, taps add rows, and
// the bar takes the tab bar's place.

const MONTH = "2026-05";
const { defaultBrowserType: _browser, ...iPhone13 } = devices["iPhone 13"];
const SHOTS = process.env.TRIP_SHOTS_DIR ?? "";

const showMoney = (page) => page.addInitScript(() => window.localStorage.setItem("monies-map:money-totals-visible", "true"));

async function makeEntry(page, description, day, amountMinor) {
  const created = await postJson(page, "/api/entries/create", {
    date: `${MONTH}-${day}`,
    description,
    accountName: "UOB One",
    categoryName: "Food & Drinks",
    amountMinor,
    entryType: "expense",
    ownershipType: "direct",
    ownerName: "Tim"
  });
  return created.entryId;
}

async function saveTrip(page, body) {
  const { tripEvent } = await postJson(page, "/api/trip-events/save", body);
  return tripEvent;
}

// Only this test's rows are listed: the search holds the stamp.
async function openEntries(page, stamp, firstText) {
  const row = page.locator(".entry-row").filter({ hasText: firstText }).first();
  await gotoPageAfterApi(page, `/entries?view=person-tim&month=${MONTH}&entry_search=${stamp}`, "/api/entries-page", () => row);
  return row;
}

const rowMain = (page, text) => page.locator(".entry-row").filter({ hasText: text }).locator(".entry-row-main");
const bar = (page) => page.locator("[data-pick-bar]");
const tripPicker = (page) => page.getByRole("listbox", { name: "Trips & events" });
const tripOption = (page, name) => page.locator(`[data-trip-option="${name}"]`);
const note = (page) => page.locator("[data-trip-note]");
const tripCounts = async (page) => {
  const response = await page.request.get("/api/trip-events");
  const body = await response.json();
  return Object.fromEntries(body.tripEvents.map((trip) => [trip.name, trip.entryCount]));
};
const chipOf = (page, text) => page.locator(".entry-row").filter({ hasText: text }).locator("[data-trip-chip]");

test.describe("desktop", () => {
  test("Ctrl-click, a Shift-click run and the whole day; T puts them on a trip and Undo puts each back where it was", async ({ page }) => {
    await showMoney(page);
    await reseedDemo(page);
    const stamp = `pk${Date.now()}`;
    const ids = {
      alpha: await makeEntry(page, `Alpha ${stamp}`, "14", 1_000),
      bravo: await makeEntry(page, `Bravo ${stamp}`, "14", 2_000),
      charlie: await makeEntry(page, `Charlie ${stamp}`, "13", 3_000),
      delta: await makeEntry(page, `Delta ${stamp}`, "12", 4_000),
      echo: await makeEntry(page, `Echo ${stamp}`, "12", 5_000)
    };
    const seoul = await saveTrip(page, { name: "Seoul trip", startDate: `${MONTH}-13`, endDate: `${MONTH}-19` });
    const bali = await saveTrip(page, { name: "Bali trip", startDate: "2026-01-12", endDate: "2026-01-19" });
    await saveTrip(page, { name: "Mum's 70th" });
    await postJson(page, "/api/trip-events/entries/set", { entryIds: [ids.alpha, ids.echo], tripEventId: seoul.id });
    await postJson(page, "/api/trip-events/entries/set", { entryIds: [ids.bravo], tripEventId: bali.id });

    await openEntries(page, stamp, `Alpha ${stamp}`);
    // The rows in the order on screen: the 14th's two, then the 13th, then the 12th's two.
    const order = await page.locator(".entry-row .entry-row-description > strong").allTextContents();
    const names = order.map((text) => text.split(" ")[0]);
    expect(names).toHaveLength(5);
    expect(new Set(names.slice(0, 2))).toEqual(new Set(["Alpha", "Bravo"]));
    expect(names[2]).toBe("Charlie");
    expect(new Set(names.slice(3))).toEqual(new Set(["Delta", "Echo"]));
    const [first, second] = order;
    await expect(bar(page)).toHaveCount(0);
    await expect(rowMain(page, first)).not.toHaveAttribute("aria-pressed", /.*/);

    // Ctrl-click starts picking and picks the first row; nothing opens.
    await rowMain(page, first).click({ modifiers: ["ControlOrMeta"] });
    await expect(bar(page)).toBeVisible();
    await expect(rowMain(page, first)).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator(".entry-inline-editor")).toHaveCount(0);
    await expect(bar(page)).toContainText("1 picked");
    // The bubble became a tick box in the same place.
    await expect(rowMain(page, first).locator(".entry-pick-tick")).toBeVisible();

    // Shift-click Charlie: the run from the first row down to it.
    await rowMain(page, `Charlie ${stamp}`).click({ modifiers: ["Shift"] });
    await expect(bar(page)).toContainText("3 picked");
    await expect(rowMain(page, second)).toHaveAttribute("aria-pressed", "true");
    await expect(rowMain(page, `Delta ${stamp}`)).toHaveAttribute("aria-pressed", "false");

    // The 12th's whole day.
    await page.locator(`[data-pick-day="${MONTH}-12"]`).click();
    await expect(page.locator(`[data-pick-day="${MONTH}-12"]`)).toHaveText("Pick the whole day");
    await expect(bar(page)).toContainText("5 picked");
    // A plain click while picking takes Charlie off (it never joins the trip).
    await rowMain(page, `Charlie ${stamp}`).click();
    await expect(rowMain(page, `Charlie ${stamp}`)).toHaveAttribute("aria-pressed", "false");
    await expect(bar(page)).toContainText("4 picked");
    // The total of the picked rows as they show: 10 + 20 + 40 + 50.
    await expect(bar(page)).toContainText("$120.00");
    await expect(bar(page).getByRole("button", { name: /Put on a trip or event/ })).toBeVisible();
    await expect(bar(page).getByRole("button", { name: "Category" })).toBeVisible();
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/slice4-desktop-picking.png` });

    // T opens the same picker for the picked rows.
    await page.keyboard.press("t");
    await expect(tripPicker(page)).toBeVisible();
    await expect(page.locator(".trip-pick-title")).toHaveText("Put 4 entries on…");
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/slice4-desktop-picker.png` });
    await tripOption(page, "Mum's 70th").click();
    await expect(note(page)).toContainText("4 entries put on Mum's 70th");
    // Picking ends after the change.
    await expect(bar(page)).toHaveCount(0);
    await expect(rowMain(page, first)).not.toHaveAttribute("aria-pressed", /.*/);
    for (const name of ["Alpha", "Bravo", "Delta", "Echo"]) {
      await expect(chipOf(page, `${name} ${stamp}`)).toHaveText("Mum's 70th");
    }
    await expect(chipOf(page, `Charlie ${stamp}`)).toHaveCount(0);
    await expect.poll(() => tripCounts(page)).toMatchObject({ "Mum's 70th": 4, "Seoul trip": 0, "Bali trip": 0 });
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/slice4-desktop-result.png` });

    // Undo puts each row back where it was: two on Seoul, one on Bali, one on none.
    await note(page).getByRole("button", { name: "Undo" }).click();
    await expect(note(page)).toContainText("Undone");
    await expect.poll(() => tripCounts(page)).toMatchObject({ "Mum's 70th": 0, "Seoul trip": 2, "Bali trip": 1 });
    await expect(chipOf(page, `Alpha ${stamp}`)).toHaveText("Seoul trip");
    await expect(chipOf(page, `Echo ${stamp}`)).toHaveText("Seoul trip");
    await expect(chipOf(page, `Bravo ${stamp}`)).toHaveText("Bali trip");
    await expect(chipOf(page, `Delta ${stamp}`)).toHaveCount(0);
  });

  test("Pick, two rows, Category: the bulk change with its note, and Undo puts each back", async ({ page }) => {
    await showMoney(page);
    await reseedDemo(page);
    const stamp = `pc${Date.now()}`;
    await makeEntry(page, `Kopi ${stamp}`, "10", 450);
    await makeEntry(page, `Toast ${stamp}`, "10", 380);
    await openEntries(page, stamp, `Kopi ${stamp}`);
    const categoryOf = (text) => page.locator(".entry-row").filter({ hasText: text }).locator(".entry-row-category-label strong");
    await expect(categoryOf(`Kopi ${stamp}`)).toHaveText("Food & Drinks");

    await page.getByRole("button", { name: "Pick", exact: true }).click();
    await expect(page.getByRole("button", { name: "Pick", exact: true })).toHaveAttribute("aria-pressed", "true");
    await expect(bar(page)).toContainText("0 picked");
    await expect(bar(page).getByRole("button", { name: /Put on a trip or event/ })).toBeDisabled();
    // A click on the category label while picking picks the row, it does not open the list.
    await page.locator(".entry-row").filter({ hasText: `Kopi ${stamp}` }).locator(".entry-row-category-button").click();
    await expect(categoryList(page)).toHaveCount(0);
    await rowMain(page, `Toast ${stamp}`).click();
    await expect(bar(page)).toContainText("2 picked");
    await expect(bar(page)).toContainText("$8.30");

    await bar(page).getByRole("button", { name: "Category" }).click();
    await expect(categoryList(page)).toBeVisible();
    await categoryOption(page, "Groceries").click();
    await expect(note(page)).toContainText("2 entries moved to Groceries");
    await expect(bar(page)).toHaveCount(0);
    await expect(categoryOf(`Kopi ${stamp}`)).toHaveText("Groceries");
    await expect(categoryOf(`Toast ${stamp}`)).toHaveText("Groceries");

    await note(page).getByRole("button", { name: "Undo" }).click();
    await expect(note(page)).toContainText("Undone");
    await expect(categoryOf(`Kopi ${stamp}`)).toHaveText("Food & Drinks");
    await expect(categoryOf(`Toast ${stamp}`)).toHaveText("Food & Drinks");
  });

  test("Esc stops picking, and a plain click opens the row again", async ({ page }) => {
    await reseedDemo(page);
    const stamp = `pe${Date.now()}`;
    await makeEntry(page, `Laksa ${stamp}`, "09", 650);
    await makeEntry(page, `Satay ${stamp}`, "09", 900);
    await openEntries(page, stamp, `Laksa ${stamp}`);
    await rowMain(page, `Laksa ${stamp}`).click({ modifiers: ["ControlOrMeta"] });
    await expect(bar(page)).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(bar(page)).toHaveCount(0);
    await expect(page.locator("[data-pick-day]")).toHaveCount(0);
    await expect(rowMain(page, `Laksa ${stamp}`)).not.toHaveAttribute("aria-pressed", /.*/);
    await rowMain(page, `Satay ${stamp}`).click();
    await expect(page.locator(".entry-inline-editor")).toBeVisible();
  });

  test("201 picked: the bar says so and refuses; the server refuses too", async ({ page }) => {
    test.setTimeout(240_000);
    await showMoney(page);
    await reseedDemo(page);
    const stamp = `pm${Date.now()}`;
    const ids = [];
    for (let start = 0; start < 201; start += 20) {
      const batch = Array.from({ length: Math.min(20, 201 - start) }, (_, offset) => makeEntry(page, `Bulk ${String(start + offset).padStart(3, "0")} ${stamp}`, "20", 100));
      ids.push(...await Promise.all(batch));
    }
    expect(ids.length).toBe(201);
    await openEntries(page, stamp, `Bulk 000 ${stamp}`);
    await expect(page.locator(".entry-row")).toHaveCount(201);
    await page.getByRole("button", { name: "Pick", exact: true }).click();
    await page.locator(`[data-pick-day="${MONTH}-20"]`).click();
    await expect(bar(page)).toContainText("201 picked");
    await bar(page).getByRole("button", { name: /Put on a trip or event/ }).click();
    await expect(bar(page).getByRole("alert")).toHaveText("Pick 200 or fewer to change them together.");
    await expect(tripPicker(page)).toHaveCount(0);
    await bar(page).getByRole("button", { name: "Category" }).click();
    await expect(categoryList(page)).toHaveCount(0);
    await expect(bar(page).getByRole("alert")).toHaveText("Pick 200 or fewer to change them together.");
    // T refuses the same way.
    await page.keyboard.press("t");
    await expect(tripPicker(page)).toHaveCount(0);

    // Taking one off brings it to 200, which is fine.
    await rowMain(page, `Bulk 000 ${stamp}`).click();
    await expect(bar(page)).toContainText("200 picked");
    await expect(bar(page).getByRole("alert")).toHaveCount(0);

    // The server's own limits.
    const trip = await saveTrip(page, { name: "Too many" });
    const tripResponse = await page.request.post("/api/trip-events/entries/set", { data: { entryIds: ids, tripEventId: trip.id } });
    expect((await tripResponse.json()).ok).toBe(false);
    const categoryResponse = await page.request.post("/api/entries/update-category", {
      data: { changes: ids.map((entryId) => ({ entryId, fromCategoryName: "Food & Drinks", categoryName: "Groceries" })), confirmedCount: 201 }
    });
    expect(categoryResponse.status()).toBe(400);
    expect((await categoryResponse.json()).error).toContain("At most 200");
  });
});

test.describe("phone", () => {
  test.use({ ...iPhone13 });

  test("press and hold starts picking, a tap adds a row, the bar sits where the tab bar was and puts them on a trip", async ({ page }) => {
    await showMoney(page);
    await reseedDemo(page);
    const stamp = `pp${Date.now()}`;
    await makeEntry(page, `Tosokchon ${stamp}`, "05", 4_260);
    await makeEntry(page, `Ader Error ${stamp}`, "05", 16_270);
    await makeEntry(page, `Kakao taxi ${stamp}`, "04", 1_780);
    await saveTrip(page, { name: "Seoul trip", startDate: `${MONTH}-03`, endDate: `${MONTH}-09` });
    await openEntries(page, stamp, `Tosokchon ${stamp}`);
    const tabs = page.locator("nav.tab-strip");
    await expect(tabs).toBeVisible();
    const tabsBox = await tabs.boundingBox();

    // Press and hold (a still finger for most of a second) on the first row.
    const target = rowMain(page, `Tosokchon ${stamp}`).locator(".entry-row-description > strong");
    await target.evaluate((element) => element.scrollIntoView({ block: "center" }));
    // Still in the middle of the screen (the scroll has settled) before the finger goes down.
    let box = await target.boundingBox();
    await expect.poll(async () => {
      const previous = box;
      box = await target.boundingBox();
      return Math.abs(box.y - previous.y) < 1 && box.y > 120 && box.y < page.viewportSize().height - 240;
    }).toBe(true);
    const cdp = await page.context().newCDPSession(page);
    const point = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [point] });
    await page.waitForTimeout(700);
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await expect(bar(page)).toBeVisible();
    await expect(bar(page)).toContainText("1 picked");
    await expect(rowMain(page, `Tosokchon ${stamp}`)).toHaveAttribute("aria-pressed", "true");
    // The hold did not also open the entry.
    await expect(page.locator(".entry-mobile-sheet")).toHaveCount(0);

    // A tap adds another row.
    await rowMain(page, `Ader Error ${stamp}`).tap();
    await expect(bar(page)).toContainText("2 picked");
    await expect(bar(page)).toContainText("$205.30");
    await expect(page.locator(`[data-pick-day="${MONTH}-05"]`)).toHaveText("Pick day");

    // The bar takes the tab bar's place, and its targets are at least 44 px.
    await expect(tabs).toBeHidden();
    const barBox = await bar(page).boundingBox();
    expect(Math.abs((barBox.y + barBox.height) - (tabsBox.y + tabsBox.height))).toBeLessThanOrEqual(2);
    for (const button of await bar(page).getByRole("button").all()) {
      const buttonBox = await button.boundingBox();
      expect(buttonBox.height).toBeGreaterThanOrEqual(44);
    }
    expect((await page.locator(`[data-pick-day="${MONTH}-05"]`).boundingBox()).height).toBeGreaterThanOrEqual(44);
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/slice4-phone-picking.png` });

    await bar(page).getByRole("button", { name: /Put on a trip or event/ }).tap();
    await expect(tripPicker(page)).toBeVisible();
    await expect(page.getByRole("dialog").getByRole("heading", { name: "Put 2 entries on…" })).toBeVisible();
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/slice4-phone-sheet.png` });
    await tripOption(page, "Seoul trip").tap();
    await expect(note(page)).toContainText("2 entries put on Seoul trip");
    await expect(bar(page)).toHaveCount(0);
    await expect(tabs).toBeVisible();
    await expect.poll(() => tripCounts(page)).toMatchObject({ "Seoul trip": 2 });
    await expect(chipOf(page, `Kakao taxi ${stamp}`)).toHaveCount(0);
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/slice4-phone-result.png` });
  });
});
