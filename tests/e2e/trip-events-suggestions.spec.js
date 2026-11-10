import { devices, expect, test } from "@playwright/test";

import { gotoPageAfterApi, postJson, reseedDemo } from "./helpers";

// Trip and event suggestions (design 2d, 2f; DOMAIN.md "Trip or Event",
// "Suggestions"). A computer: picked rows → "New trip or event" opens the New
// sheet with their days and the won they were paid in; "Check them" saves
// and opens the review list (paid in won ticked, dollars and home bills
// not), "Booked before you went?" finds a booking before the first day, and
// "Add N entries" saves with Undo. Adding an entry to a linked split group
// puts it on the trip too ("Also put on Seoul trip · Undo"). A phone: the
// dashed "Seoul trip?" chip on a new Apple Pay entry, one tap and Undo; the
// empty Trips & events list starts one from a split group; the trip view's
// cash line, Change, and Check entries from these dates.

const MONTH = "2026-05";
const { defaultBrowserType: _browser, ...iPhone13 } = devices["iPhone 13"];
const SHOTS = process.env.TRIP_SHOTS_DIR ?? "";
const SHORTCUT_TOKEN = "mm_e2e_key";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => window.localStorage.setItem("monies-map:money-totals-visible", "true"));
});

const makeEntry = (page, body) => postJson(page, "/api/entries/create", {
  accountName: "UOB One", categoryName: "Food & Drinks", entryType: "expense", ownershipType: "direct", ownerName: "Tim", ...body
}).then((created) => created.entryId);

const rowMain = (page, text) => page.locator(".entry-row").filter({ hasText: text }).locator(".entry-row-main");
const bar = (page) => page.locator("[data-pick-bar]");
const note = (page) => page.locator("[data-trip-note]");
const newSheet = (page) => page.locator("[data-trip-edit-sheet]");
const review = (page) => page.locator("[data-trip-review]");
const reviewGroup = (page, key) => review(page).locator(`[data-trip-review-group="${key}"]`);
const reviewRow = (page, text) => review(page).locator(".trip-review-row").filter({ hasText: text });
const lead = (page) => page.locator("[data-trip-lead]");
const tripList = async (page) => (await (await page.request.get("/api/trip-events")).json()).tripEvents;

function todaySingapore() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Singapore", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

function shiftDay(iso, days) {
  const date = new Date(`${iso}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

// A week in Seoul in May: two rows the card printed won on (to pick), the
// hotel (won, not picked), a dollar kopi and a standing order at home in
// the same days, and a booking a month before.
async function seedSeoulWeek(page, stamp) {
  await reseedDemo(page);
  return {
    gwangjang: await makeEntry(page, { date: `${MONTH}-13`, description: `GWANGJANG MARKET SEOUL KOR KRW 38,000 ${stamp}`, accountName: "Citi Rewards", ownerName: "Joyce", amountMinor: 3_680 }),
    oliveYoung: await makeEntry(page, { date: `${MONTH}-14`, description: `OLIVE YOUNG MYEONGDONG SEOUL KOR KRW 142,000 ${stamp}`, accountName: "Citi Rewards", ownerName: "Joyce", categoryName: "Shopping", amountMinor: 13_750 }),
    hotel: await makeEntry(page, { date: `${MONTH}-15`, description: `LOTTE HOTEL SEOUL KOR KRW 1,260,000 ${stamp}`, categoryName: "Travel", amountMinor: 119_820 }),
    kopi: await makeEntry(page, { date: `${MONTH}-15`, description: `CHANGI AIRPORT KOPI ${stamp}`, amountMinor: 860 }),
    bill: await makeEntry(page, { date: `${MONTH}-15`, description: `SP DIGITAL GIRO ${stamp}`, categoryName: "Bills", amountMinor: 14_285 }),
    booking: await makeEntry(page, { date: "2026-04-20", description: `KLOOK SEOUL TOUR BOOKING ${stamp}`, categoryName: "Travel", amountMinor: 8_840 })
  };
}

test.describe("desktop", () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  test("picked rows → New sheet with their days and won; Check them; the review ticks won, not dollars or home bills; Booked before you went; Add with Undo", async ({ page }) => {
    const stamp = `sg${Date.now()}`;
    const ids = await seedSeoulWeek(page, stamp);
    await gotoPageAfterApi(page, `/entries?view=household&month=${MONTH}&entry_search=${stamp}`, "/api/entries-page", () => rowMain(page, "GWANGJANG"));

    await rowMain(page, "GWANGJANG").click({ modifiers: ["ControlOrMeta"] });
    await rowMain(page, "OLIVE YOUNG").click({ modifiers: ["ControlOrMeta"] });
    await expect(bar(page)).toContainText("2 picked");
    await bar(page).getByRole("button", { name: /Put on a trip or event/ }).click();
    await page.locator('[data-trip-option="new"]').click();

    // The New sheet: the picked rows' first and last day, and their won.
    const sheet = newSheet(page);
    await expect(sheet).toHaveAttribute("data-trip-edit-sheet", "new");
    await expect(sheet.getByRole("heading", { name: "New trip or event" })).toBeVisible();
    await expect(sheet.locator('[data-trip-field="start"]')).toHaveValue(`${MONTH}-13`);
    await expect(sheet.locator('[data-trip-field="end"]')).toHaveValue(`${MONTH}-14`);
    await expect(sheet.locator('[data-trip-field="currency"]')).toHaveValue("KRW");
    await sheet.locator('[data-trip-field="name"]').fill("Seoul trip");
    // The icon follows the name until one is picked.
    await expect(sheet.getByRole("radio", { name: "Plane" })).toHaveAttribute("aria-checked", "true");
    await sheet.locator('[data-trip-field="end"]').fill(`${MONTH}-15`);
    // The hotel on the 15th is paid in won; the kopi, the bill and the
    // demo household's own entries in those days are in dollars.
    const preview = sheet.locator("[data-trip-preview]");
    await expect(preview).toContainText("1 entry looks like part of it. 1 paid in won.");
    await expect(preview).toContainText("more in these days were paid in dollars.");
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/slice5-desktop-new-sheet.png` });
    await sheet.getByRole("button", { name: "Check them" }).click();

    // The picked rows went on it, and the review list opens.
    await expect(note(page)).toContainText("2 entries put on Seoul trip");
    await expect(review(page)).toBeVisible();
    await expect(review(page).getByRole("heading", { name: /Add to Seoul trip/ })).toContainText("13 – 15 May");
    await expect(reviewGroup(page, "currency")).toContainText("Paid in won");
    await expect(reviewGroup(page, "currency")).toContainText("1 of 1 ticked");
    await expect(reviewRow(page, "LOTTE HOTEL").locator("input")).toBeChecked();
    await expect(reviewRow(page, "LOTTE HOTEL")).toContainText("15 May · ₩1,260,000 · Tim");
    await expect(reviewRow(page, "LOTTE HOTEL")).toContainText(/1,198\.20/);
    const dollars = reviewGroup(page, "dollars");
    await expect(dollars).toContainText("Also in these dates, in dollars");
    await expect(dollars).toContainText(/0 of \d+/);
    await dollars.locator(".trip-review-group-head").click();
    await expect(reviewRow(page, "CHANGI AIRPORT KOPI").locator("input")).not.toBeChecked();
    await expect(reviewRow(page, "SP DIGITAL GIRO").locator("input")).not.toBeChecked();
    await expect(review(page).locator("[data-trip-home-bills]")).toHaveText("Home bills in these days (rent, standing orders) are left unticked.");

    // Booked before you went: the booking a month before.
    await review(page).locator('[data-trip-review-group="search-form"] .trip-review-group-head').click();
    await review(page).getByLabel("Shop or note").fill("klook");
    await review(page).getByRole("button", { name: "Search", exact: true }).click();
    await expect(reviewGroup(page, "search")).toContainText("Booked before you went?");
    await reviewRow(page, "KLOOK SEOUL TOUR").locator("input").check();
    await expect(review(page).locator("[data-trip-review-add]")).toHaveText("Add 2 entries");
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/slice5-desktop-review.png` });
    await review(page).locator("[data-trip-review-add]").click();

    await expect(note(page)).toContainText("2 entries added to Seoul trip");
    await expect.poll(async () => (await tripList(page)).find((trip) => trip.name === "Seoul trip")?.entryCount).toBe(4);
    const links = await (await page.request.get(`/api/entries-page?view=household&month=${MONTH}&trip=${(await tripList(page))[0].id}`)).json();
    expect(links.monthPage.entries.map((entry) => entry.id).sort()).toEqual([ids.gwangjang, ids.oliveYoung, ids.hotel, ids.booking].sort());
    await note(page).getByRole("button", { name: "Undo" }).click();
    await expect(note(page)).toContainText("Undone");
    await expect.poll(async () => (await tripList(page)).find((trip) => trip.name === "Seoul trip")?.entryCount).toBe(2);
  });

  test("Add to splits on a linked group puts the entry on its trip too, with Undo; the trip view names the group's cash", async ({ page }) => {
    await reseedDemo(page);
    const { groupId } = await postJson(page, "/api/splits/groups/create", { name: "Seoul trip", currency: "SGD" });
    await postJson(page, "/api/splits/expenses/create", { groupId, date: `${MONTH}-14`, description: "Street food, cash", categoryName: "Food & Drinks", payerPersonName: "Joyce", amountMinor: 3_600, paymentMethod: "cash" });
    const { tripEvent } = await postJson(page, "/api/trip-events/save", { name: "Seoul trip", startDate: `${MONTH}-13`, endDate: `${MONTH}-15`, splitGroupId: groupId });
    const hotel = await makeEntry(page, { date: `${MONTH}-13`, description: `Lotte Hotel ${Date.now()}`, categoryName: "Travel", amountMinor: 119_820 });
    await page.addInitScript((id) => window.localStorage.setItem("monies-map:splits-last-group:person-tim", id), groupId);
    await gotoPageAfterApi(page, `/entries?view=person-tim&month=${MONTH}&entries_scope=direct_plus_shared&editing_entry=${hotel}`, "/api/entries-page", () => page.locator(".entry-inline-editor").first());
    await page.locator(".entry-inline-editor").first().getByRole("button", { name: "Add to Seoul trip · Half each" }).click();
    await expect(note(page)).toContainText("Also put on Seoul trip");
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/slice5-desktop-follow-note.png` });
    await expect.poll(async () => (await tripList(page)).find((trip) => trip.id === tripEvent.id)?.entryCount).toBe(1);
    await note(page).getByRole("button", { name: "Undo" }).click();
    await expect(note(page)).toContainText("Undone");
    await expect.poll(async () => (await tripList(page)).find((trip) => trip.id === tripEvent.id)?.entryCount).toBe(0);
    // The split stays.
    const page2 = await (await page.request.get(`/api/entries-page?view=person-tim&month=${MONTH}`)).json();
    expect(page2.monthPage.entries.find((entry) => entry.id === hotel)?.linkedSplitExpenseId).toBeTruthy();

    // The trip view: the group's cash, and Change opens the same sheet.
    await gotoPageAfterApi(page, `/entries?view=household&month=${MONTH}&entry_trip=${tripEvent.id}`, "/api/entries-page", () => lead(page));
    await expect(lead(page).locator('[data-trip-split-cash="SGD"]')).toHaveText("Also $36.00 cash on Seoul trip splits, not in Entries");
    await lead(page).locator("[data-trip-change]").click();
    await expect(newSheet(page)).toHaveAttribute("data-trip-edit-sheet", "change");
    await expect(newSheet(page).locator('[data-trip-field="name"]')).toHaveValue("Seoul trip");
    await expect(newSheet(page).locator('[data-trip-field="split-group"]')).toHaveValue(groupId);
    await newSheet(page).locator('[data-trip-field="name"]').fill("Seoul and Busan trip");
    await newSheet(page).getByRole("button", { name: "Save" }).click();
    await expect(lead(page).getByRole("heading", { name: "Seoul and Busan trip" })).toBeVisible();
  });
});

test.describe("phone", () => {
  test.use({ ...iPhone13 });

  test("a new Apple Pay entry on a wallet already on the trip gets the dashed chip; one tap puts it on, Undo takes it off", async ({ page }) => {
    await reseedDemo(page);
    const today = todaySingapore();
    const stamp = `ch${Date.now()}`;
    const { tripEvent } = await postJson(page, "/api/trip-events/save", { name: "Seoul trip", startDate: shiftDay(today, -2), endDate: shiftDay(today, 2), currency: "KRW" });
    const onTrip = [];
    for (const name of ["Myeongdong kimbap", "Hongdae noraebang", "Namsan cable car"]) {
      onTrip.push(await makeEntry(page, { date: today, description: `${name} ${stamp}`, amountMinor: 1_200 }));
    }
    await postJson(page, "/api/trip-events/entries/set", { entryIds: onTrip, tripEventId: tripEvent.id });
    // On another wallet, so UOB One's last 3 stay the trip's.
    const hand = await makeEntry(page, { date: today, description: `Hand-made kopi ${stamp}`, accountName: "Citi Rewards", ownerName: "Joyce", amountMinor: 380 });
    const settings = await (await page.request.get("/api/settings-page?view=household")).json();
    const activeIds = settings.settingsPage.accounts.filter((account) => account.isActive).map((account) => account.id);
    await postJson(page, "/api/settings/shortcuts/save", { apiKey: SHORTCUT_TOKEN, defaultAccountPriorityIds: activeIds });
    const response = await page.request.post("/api/shortcuts/entries/create", {
      headers: { "X-Monies-Shortcut-Token": SHORTCUT_TOKEN },
      data: { amount: "9.70", description: `Paris Baguette Hongdae ${stamp}`, accountName: "UOB One", date: today, requestId: `e2e-trip-chip-${Date.now()}` }
    });
    expect(response.ok(), await response.text()).toBeTruthy();

    await gotoPageAfterApi(page, `/entries?view=household&month=${today.slice(0, 7)}&entry_search=${stamp}`, "/api/entries-page", () => rowMain(page, "Paris Baguette"));
    const applePayRow = page.locator(".entry-row").filter({ hasText: "Paris Baguette" });
    const chip = applePayRow.locator('[data-trip-suggestion="Seoul trip"]');
    await expect(chip).toHaveText("Seoul trip?");
    await expect(chip).toHaveClass(/is-suggestion/);
    // A hand-made entry in the same days gets nothing.
    await expect(page.locator(".entry-row").filter({ hasText: "Hand-made kopi" }).locator("[data-trip-suggestion], [data-trip-chip]")).toHaveCount(0);
    expect(hand).toBeTruthy();
    await chip.evaluate((element) => element.scrollIntoView({ block: "center" }));
    if (SHOTS) await applePayRow.screenshot({ path: `${SHOTS}/slice5-phone-dashed-chip.png` });

    // One tap; it does not also open the entry.
    await chip.tap();
    await expect(page.locator(".entry-mobile-sheet")).toHaveCount(0);
    await expect(note(page)).toContainText("Put on Seoul trip");
    await expect(applePayRow.locator('[data-trip-chip="Seoul trip"]')).toBeVisible();
    await expect(applePayRow.locator("[data-trip-suggestion]")).toHaveCount(0);
    const added = await (await page.request.get(`/api/entries-page?view=household&month=${today.slice(0, 7)}&trip=${tripEvent.id}`)).json();
    expect(added.monthPage.entries).toHaveLength(4);
    await note(page).getByRole("button", { name: "Undo" }).click();
    await expect(note(page)).toContainText("Undone");
    await expect(applePayRow.locator('[data-trip-suggestion="Seoul trip"]')).toBeVisible();
  });

  test("the empty Trips & events list starts one from the most recent split group, linked, then checks its entries", async ({ page }) => {
    await reseedDemo(page);
    const stamp = `sf${Date.now()}`;
    const ids = await seedSeoulWeek(page, stamp);
    const { groupId } = await postJson(page, "/api/splits/groups/create", { name: "Seoul trip", currency: "KRW" });
    // A card expense on the group, dated after the demo's, makes it the most recent.
    await postJson(page, "/api/splits/expenses/create", { groupId, date: "2026-12-01", description: "Seoul deposit", categoryName: "Travel", payerPersonName: "Tim", amountMinor: 50_000_00, currency: "KRW", paymentMethod: "cash" });
    expect(ids.hotel).toBeTruthy();

    await gotoPageAfterApi(page, `/entries?view=household&month=${MONTH}`, "/api/entries-page", () => page.locator(".entry-row").first());
    await page.locator(".entries-totals .lsd-rows").getByRole("button", { name: /^Filters/ }).click();
    await page.getByRole("dialog", { name: "View and scope" }).locator("[data-trip-filter]").click();
    const empty = page.locator("[data-trip-sheet-empty]");
    await expect(empty).toContainText("See what a trip really cost");
    await expect(empty.locator("[data-trip-make-first]")).toHaveText("Make your first one");
    const startFrom = empty.locator('[data-trip-start-from="Seoul trip"]');
    await expect(startFrom).toHaveText('Start from "Seoul trip" splits');
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/slice5-phone-empty-start-from.png` });
    await startFrom.click();

    const sheet = newSheet(page);
    await expect(sheet.locator('[data-trip-field="name"]')).toHaveValue("Seoul trip");
    await expect(sheet.locator('[data-trip-field="currency"]')).toHaveValue("KRW");
    await expect(sheet.locator('[data-trip-field="split-group"]')).toHaveValue(groupId);
    await expect(sheet.getByRole("radio", { name: "Plane" })).toHaveAttribute("aria-checked", "true");
    await sheet.locator('[data-trip-field="start"]').fill(`${MONTH}-13`);
    await sheet.locator('[data-trip-field="end"]').fill(`${MONTH}-15`);
    await expect(sheet.locator("[data-trip-preview]")).toContainText("3 entries look like part of it. 3 paid in won.");
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/slice5-phone-new-sheet.png` });
    await sheet.getByRole("button", { name: "Check them" }).click();

    await expect(review(page)).toBeVisible();
    await expect(reviewGroup(page, "currency")).toContainText("3 of 3 ticked");
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/slice5-phone-review.png` });
    await review(page).locator("[data-trip-review-add]").click();
    await expect(note(page)).toContainText("3 entries added to Seoul trip");
    const trips = await tripList(page);
    expect(trips.map((trip) => [trip.name, trip.splitGroupId, trip.currency, trip.entryCount])).toEqual([["Seoul trip", groupId, "KRW", 3]]);
  });
});
