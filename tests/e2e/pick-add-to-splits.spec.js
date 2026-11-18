import { devices, expect, test } from "@playwright/test";

import { expectFits } from "./fit-check";
import { gotoPageAfterApi, postJson, reseedDemo } from "./helpers";

// "Add to Splits" in the picked rows' bar on Entries (design.md "Picking
// many"). The bar offers it beside Category; it opens a small choice (the
// split group, the share, a plain preview line), "Add N" puts the picked
// expenses on Splits through the one bulk command and the note offers Undo.
// Rows already on Splits, and income or transfers, are counted and left; more
// than 10 asks "Yes, add all N" in the bar; more than 200 is refused in the
// bar's own words. A phone gets the same choice as a sheet.

const MONTH = "2026-05";
const { defaultBrowserType: _browser, ...iPhone13 } = devices["iPhone 13"];
const SHOTS = process.env.BULK_SHOTS_DIR ?? "";

const showMoney = (page) => page.addInitScript(() => window.localStorage.setItem("monies-map:money-totals-visible", "true"));

async function makeEntry(page, description, day, amountMinor, extra = {}) {
  const created = await postJson(page, "/api/entries/create", {
    date: `${MONTH}-${day}`,
    description,
    accountName: "UOB One",
    categoryName: "Food & Drinks",
    amountMinor,
    entryType: "expense",
    ownershipType: "direct",
    ownerName: "Tim",
    ...extra
  });
  return created.entryId;
}

async function openEntries(page, stamp, firstText) {
  const row = page.locator(".entry-row").filter({ hasText: firstText }).first();
  await gotoPageAfterApi(page, `/entries?view=person-tim&month=${MONTH}&entry_search=${stamp}`, "/api/entries-page", () => row);
  return row;
}

const rowMain = (page, text) => page.locator(".entry-row").filter({ hasText: text }).locator(".entry-row-main");
const bar = (page) => page.locator("[data-pick-bar]");
const note = (page) => page.locator("[data-trip-note]");
const choice = (page) => page.locator("[data-pick-splits]");
const addToSplits = (bar_) => bar_.getByRole("button", { name: "Add to Splits" });

// One entry on Tim's own card and one on Joyce's own account: two different
// people paid, so the sheet names no one (DOMAIN.md "Split Payer").
async function seedMixedPayers(page, stamp) {
  await postJson(page, "/api/accounts/create", { name: `Joyce Wallet ${stamp}`, institution: "DBS", kind: "bank", currency: "SGD", openingBalanceMinor: 0, ownerPersonId: "person-joyce" });
  const onTim = await makeEntry(page, `Tims ${stamp}`, "06", 2_400);
  const onJoyce = await makeEntry(page, `Joyces ${stamp}`, "06", 1_600, { accountName: `Joyce Wallet ${stamp}` });
  return { onTim, onJoyce };
}

// The three choices by name, the line for each, and no name anywhere.
async function checkMixedSheet(page, scope, count) {
  const preview = scope.locator("[data-pick-splits-preview]");
  const lines = [
    ["Half each", `${count} entries to Splits, half each, in Okaeri`],
    ["The one who didn't pay owes it all", `${count} entries to Splits, the one who didn't pay owes it all, in Okaeri`],
    ["All on the one who paid", `${count} entries to Splits, all on the one who paid, in Okaeri`]
  ];
  await scope.getByRole("radio", { name: /Okaeri/ }).click();
  for (const [label, line] of lines) {
    await scope.getByRole("radio", { name: label, exact: true }).click();
    await expect(preview).toHaveText(line);
  }
  await expect(scope.getByRole("radio", { name: "the other person owes all of it" })).toHaveCount(0);
  await expect(scope.getByRole("radio", { name: /^All the payer/ })).toHaveCount(0);
}

async function splitRowOf(page, entryId) {
  const response = await page.request.get(`/api/entries-page?view=person-tim&month=${MONTH}`);
  const body = await response.json();
  const entry = body.monthPage.entries.find((candidate) => candidate.id === entryId);
  return entry ?? null;
}

test.describe("desktop", () => {
  test("pick rows, Add to Splits: choose the group and share, see the plain line, add; a note counts what was left and Undo takes them back", async ({ page }) => {
    await showMoney(page);
    await reseedDemo(page);
    const stamp = `ps${Date.now()}`;
    const ids = {
      alpha: await makeEntry(page, `Alpha ${stamp}`, "14", 1_000),
      bravo: await makeEntry(page, `Bravo ${stamp}`, "14", 2_000),
      charlie: await makeEntry(page, `Charlie ${stamp}`, "13", 3_000),
      delta: await makeEntry(page, `Delta ${stamp}`, "12", 4_000),
      salary: await makeEntry(page, `Salary ${stamp}`, "12", 5_000, { entryType: "income", categoryName: "Other - Income" })
    };
    await postJson(page, "/api/splits/expenses/from-entry", { entryId: ids.delta, splitGroupId: null });
    await openEntries(page, stamp, `Alpha ${stamp}`);

    await page.getByRole("button", { name: "Pick", exact: true }).click();
    await page.locator(`[data-pick-day="${MONTH}-14"]`).click();
    await page.locator(`[data-pick-day="${MONTH}-13"]`).click();
    await page.locator(`[data-pick-day="${MONTH}-12"]`).click();
    await expect(bar(page)).toContainText("5 picked");
    await expect(addToSplits(bar(page))).toBeEnabled();
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/bulk-desktop-bar.png` });

    // The choice: only the 3 that can go are counted.
    await addToSplits(bar(page)).click();
    await expect(choice(page)).toBeVisible();
    await expect(page.locator(".trip-pick-title")).toHaveText("Add 3 entries to Splits");
    await choice(page).getByRole("radio", { name: /Okaeri/ }).click();
    await expect(choice(page).getByRole("radio", { name: "Half each" })).toHaveAttribute("aria-checked", "true");
    await expect(page.locator("[data-pick-splits-preview]")).toHaveText("3 entries to Splits with Joyce, half each, in Okaeri");
    await choice(page).getByRole("radio", { name: "Joyce owes all of it" }).click();
    await expect(page.locator("[data-pick-splits-preview]")).toHaveText("3 entries to Splits with Joyce, Joyce owes all of it, in Okaeri");
    await choice(page).getByRole("radio", { name: "Half each" }).click();
    await expect(page.locator("[data-pick-splits-preview]")).toHaveText("3 entries to Splits with Joyce, half each, in Okaeri");
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/bulk-desktop-choice.png` });

    await choice(page).getByRole("button", { name: "Add 3" }).click();
    await expect(note(page)).toContainText("3 entries added to Splits. 1 was already on Splits. 1 income or transfer was left out");
    await expect(bar(page)).toHaveCount(0);
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/bulk-desktop-result.png` });
    for (const id of [ids.alpha, ids.bravo, ids.charlie]) {
      await expect.poll(async () => (await splitRowOf(page, id))?.linkedSplitExpenseId ?? "").not.toBe("");
      const row = await splitRowOf(page, id);
      expect(row.linkedSplitGroupName).toBe("Okaeri");
      expect(row.linkedSplitShares.map((share) => share.ratioBasisPoints)).toEqual([5000, 5000]);
    }
    expect((await splitRowOf(page, ids.salary)).linkedSplitExpenseId ?? "").toBe("");

    await note(page).getByRole("button", { name: "Undo" }).click();
    await expect(note(page)).toContainText("Undone");
    for (const id of [ids.alpha, ids.bravo, ids.charlie]) {
      await expect.poll(async () => (await splitRowOf(page, id))?.linkedSplitExpenseId ?? "").toBe("");
    }
    // The one that was already on Splits stays there.
    expect((await splitRowOf(page, ids.delta)).linkedSplitExpenseId).toBeTruthy();
  });

  test("more than 10 ask Yes, add all N in the bar; nothing changes until it is tapped", async ({ page }) => {
    await showMoney(page);
    await reseedDemo(page);
    const stamp = `pt${Date.now()}`;
    const ids = [];
    for (let index = 0; index < 11; index += 1) ids.push(await makeEntry(page, `Dozen ${String(index).padStart(2, "0")} ${stamp}`, "20", 500 + index));
    await openEntries(page, stamp, `Dozen 00 ${stamp}`);
    await page.getByRole("button", { name: "Pick", exact: true }).click();
    await page.locator(`[data-pick-day="${MONTH}-20"]`).click();
    await expect(bar(page)).toContainText("11 picked");

    await addToSplits(bar(page)).click();
    await choice(page).getByRole("button", { name: "Add 11" }).click();
    await expect(bar(page)).toContainText("Add all 11 to Splits?");
    await expect(choice(page)).toHaveCount(0);
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/bulk-desktop-confirm.png` });
    expect((await splitRowOf(page, ids[0])).linkedSplitExpenseId ?? "").toBe("");
    // Cancel changes nothing; the picked rows stay picked.
    await bar(page).locator(".is-confirm").getByRole("button", { name: "Cancel" }).click();
    await expect(bar(page)).toContainText("11 picked");
    expect((await splitRowOf(page, ids[0])).linkedSplitExpenseId ?? "").toBe("");

    await addToSplits(bar(page)).click();
    await choice(page).getByRole("button", { name: "Add 11" }).click();
    await bar(page).getByRole("button", { name: "Yes, add all 11" }).click();
    await expect(note(page)).toContainText("11 entries added to Splits");
    for (const id of ids) {
      await expect.poll(async () => (await splitRowOf(page, id))?.linkedSplitExpenseId ?? "").not.toBe("");
    }
  });

  test("rows paid by different people: the choices say who paid, not a name, and the line has no 'with'", async ({ page }) => {
    await reseedDemo(page);
    const stamp = `px${Date.now()}`;
    await seedMixedPayers(page, stamp);
    await openEntries(page, stamp, `Tims ${stamp}`);
    await page.getByRole("button", { name: "Pick", exact: true }).click();
    await page.locator(`[data-pick-day="${MONTH}-06"]`).click();
    await expect(bar(page)).toContainText("2 picked");
    await addToSplits(bar(page)).click();
    await expect(choice(page)).toBeVisible();
    await checkMixedSheet(page, choice(page), 2);
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/mixed-desktop-choice.png` });
  });

  test("everything picked is already on Splits or is income: the bar says so and opens nothing", async ({ page }) => {
    await reseedDemo(page);
    const stamp = `pn${Date.now()}`;
    const onSplits = await makeEntry(page, `Shared ${stamp}`, "09", 1_200);
    await makeEntry(page, `Pay ${stamp}`, "09", 3_000, { entryType: "income", categoryName: "Other - Income" });
    await postJson(page, "/api/splits/expenses/from-entry", { entryId: onSplits, splitGroupId: null });
    await openEntries(page, stamp, `Shared ${stamp}`);
    await page.getByRole("button", { name: "Pick", exact: true }).click();
    await page.locator(`[data-pick-day="${MONTH}-09"]`).click();
    await addToSplits(bar(page)).click();
    await expect(bar(page).getByRole("alert")).toHaveText("Nothing to add: these are already on Splits, or they are income or transfers.");
    await expect(choice(page)).toHaveCount(0);
  });

  test("a stale pick: rows put on Splits meanwhile are counted as already there and the rest still go", async ({ page }) => {
    await reseedDemo(page);
    const stamp = `pl${Date.now()}`;
    const first = await makeEntry(page, `First ${stamp}`, "08", 700);
    const second = await makeEntry(page, `Second ${stamp}`, "08", 800);
    await openEntries(page, stamp, `First ${stamp}`);
    await page.getByRole("button", { name: "Pick", exact: true }).click();
    await page.locator(`[data-pick-day="${MONTH}-08"]`).click();
    await addToSplits(bar(page)).click();
    // Another device adds the first row while the choice is open.
    await postJson(page, "/api/splits/expenses/from-entry", { entryId: first, splitGroupId: null });
    await choice(page).getByRole("button", { name: "Add 2" }).click();
    await expect(note(page)).toContainText("1 entry added to Splits. 1 was already on Splits");
    await expect.poll(async () => (await splitRowOf(page, second))?.linkedSplitExpenseId ?? "").not.toBe("");
  });

  test("201 picked: Add to Splits refuses in the bar with the same words as the other changes", async ({ page }) => {
    test.setTimeout(240_000);
    await showMoney(page);
    await reseedDemo(page);
    const stamp = `pm${Date.now()}`;
    const ids = [];
    for (let start = 0; start < 201; start += 20) {
      const batch = Array.from({ length: Math.min(20, 201 - start) }, (_, offset) => makeEntry(page, `Bulk ${String(start + offset).padStart(3, "0")} ${stamp}`, "20", 100));
      ids.push(...await Promise.all(batch));
    }
    await openEntries(page, stamp, `Bulk 000 ${stamp}`);
    await expect(page.locator(".entry-row")).toHaveCount(201);
    await page.getByRole("button", { name: "Pick", exact: true }).click();
    await page.locator(`[data-pick-day="${MONTH}-20"]`).click();
    await expect(bar(page)).toContainText("201 picked");
    await addToSplits(bar(page)).click();
    await expect(bar(page).getByRole("alert")).toHaveText("Pick 200 or fewer to change them together.");
    await expect(choice(page)).toHaveCount(0);
    // The server refuses it too, and nothing changes.
    const response = await page.request.post("/api/splits/expenses/add-chosen", { data: { splitGroupId: null, payerShareBasisPoints: 5000, entryIds: ids, confirmedCount: 201 } });
    expect(response.status()).toBe(400);
    expect((await response.json()).error).toContain("At most 200");
  });
});

test.describe("phone", () => {
  test.use({ ...iPhone13 });

  test("the bar's Add to Splits opens a sheet with the same choices; Add puts the rows on Splits and Undo takes them back", async ({ page }) => {
    await showMoney(page);
    await reseedDemo(page);
    const stamp = `pq${Date.now()}`;
    const first = await makeEntry(page, `Ramen ${stamp}`, "05", 2_400);
    const second = await makeEntry(page, `Gyoza ${stamp}`, "05", 1_600);
    await openEntries(page, stamp, `Ramen ${stamp}`);
    // Press and hold (a still finger for most of a second) starts picking; "Pick day" adds the rest.
    const target = rowMain(page, `Ramen ${stamp}`).locator(".entry-row-description > strong");
    await target.evaluate((element) => element.scrollIntoView({ block: "center" }));
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
    await rowMain(page, `Gyoza ${stamp}`).tap();
    await expect(bar(page)).toContainText("2 picked");
    for (const button of await bar(page).getByRole("button").all()) {
      expect((await button.boundingBox()).height).toBeGreaterThanOrEqual(44);
    }
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/bulk-phone-bar.png` });

    await addToSplits(bar(page)).tap();
    const sheet = page.getByRole("dialog", { name: "Add 2 entries to Splits" });
    await expect(sheet).toBeVisible();
    await sheet.getByRole("radio", { name: /Okaeri/ }).tap();
    await expect(sheet.locator("[data-pick-splits-preview]")).toHaveText("2 entries to Splits with Joyce, half each, in Okaeri");
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/bulk-phone-sheet.png` });
    await sheet.getByRole("button", { name: "Add 2" }).tap();
    await expect(note(page)).toContainText("2 entries added to Splits");
    await expect(bar(page)).toHaveCount(0);
    await expect.poll(async () => (await splitRowOf(page, first))?.linkedSplitExpenseId ?? "").not.toBe("");
    await expect.poll(async () => (await splitRowOf(page, second))?.linkedSplitExpenseId ?? "").not.toBe("");
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/bulk-phone-result.png` });

    await note(page).getByRole("button", { name: "Undo" }).tap();
    await expect(note(page)).toContainText("Undone");
    await expect.poll(async () => (await splitRowOf(page, first))?.linkedSplitExpenseId ?? "").toBe("");
  });

  test("rows paid by different people: the sheet fits at 320x568 and 390x844 and names no one", async ({ page }) => {
    await showMoney(page);
    await reseedDemo(page);
    const stamp = `py${Date.now()}`;
    await seedMixedPayers(page, stamp);
    await openEntries(page, stamp, `Tims ${stamp}`);
    const target = rowMain(page, `Tims ${stamp}`).locator(".entry-row-description > strong");
    await target.evaluate((element) => element.scrollIntoView({ block: "center" }));
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
    await rowMain(page, `Joyces ${stamp}`).tap();
    await expect(bar(page)).toContainText("2 picked");
    await addToSplits(bar(page)).tap();
    const sheet = page.getByRole("dialog", { name: "Add 2 entries to Splits" });
    await expect(sheet).toBeVisible();
    await checkMixedSheet(page, sheet, 2);
    for (const size of [{ width: 320, height: 568 }, { width: 390, height: 844 }]) {
      await page.setViewportSize(size);
      await expect.poll(() => page.evaluate(() => window.innerWidth)).toBe(size.width);
      await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      // A short phone scrolls the choices above the Add bar: the line is read at the end of that scroll.
      await sheet.locator("[data-pick-splits-preview]").scrollIntoViewIfNeeded();
      if (SHOTS) await page.screenshot({ path: `${SHOTS}/mixed-phone-${size.width}.png` });
      await expectFits(page, { mustSee: ["[data-pick-splits-preview]"] });
      // The longest choice shows whole: its text is not cut off by its pill.
      const longest = sheet.getByRole("radio", { name: "The one who didn't pay owes it all", exact: true });
      await longest.scrollIntoViewIfNeeded();
      expect(await longest.evaluate((element) => element.scrollWidth <= element.clientWidth + 1 && element.scrollHeight <= element.clientHeight + 1)).toBe(true);
      if (SHOTS && size.width === 390) await page.screenshot({ path: `${SHOTS}/mixed-phone-sheet.png` });
    }
  });
});
