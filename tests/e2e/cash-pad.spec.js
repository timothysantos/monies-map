import { devices, expect, test } from "@playwright/test";

import { gotoPageAfterApi, loadEntriesPage, openJustPaid, postJson, reseedDemo } from "./helpers";

// The cash pad (design.md "Cash pad"; docs/flows/cash-entry-flow.md): from
// the Entries + button, Just paid opens a number pad already set to Tim's cash
// wallet, the trip's currency, today and Tim. An amount and Save is the
// whole entry; after Save come Undo and the optional chips. A Save that
// cannot reach the server waits on the phone and is sent again with the
// same request id, so it is saved once. The test Worker cannot fetch
// exchange rates, so the cash saves carry the test-only rate header.

const iPhone = devices["iPhone 12 Pro"].viewport;
const TIM = "person-tim";

function today() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Singapore", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

function shiftDay(day, days) {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

async function setUpTrip(page) {
  const wallet = await postJson(page, "/api/accounts/create", { name: "Tim's cash", institution: "Cash", kind: "cash", currency: "SGD", ownerPersonId: TIM });
  await postJson(page, "/api/settings/payment-ways/save", { personId: TIM, bankTransferAccountId: "", cashAccountId: wallet.accountId });
  await postJson(page, "/api/trip-events/save", { name: "Bali trip", startDate: shiftDay(today(), -2), endDate: shiftDay(today(), 5), currency: "IDR" });
  return wallet.accountId;
}

async function withTestRate(page) {
  await page.route("**/api/cash-entries/create", async (route) => {
    await route.continue({ headers: { ...route.request().headers(), "x-cash-test-rate": "SGD/IDR=12500" } });
  });
}

async function openPad(page, { phone = true } = {}) {
  await gotoPageAfterApi(page, `/entries?view=${TIM}&month=${today().slice(0, 7)}`, "/api/entries-page", () => page.locator(".entries-fab:not(.splits-fab)"));
  const pad = await openJustPaid(page);
  // The defaults have arrived: the quiet line names the wallet.
  await expect(pad.locator(".cash-pad-line")).toContainText("Tim's cash", { timeout: 30_000 });
  if (phone) {
    await expect(pad.locator(".cash-pad-line")).toContainText("IDR");
  }
  return pad;
}

async function press(pad, keys) {
  for (const key of keys) {
    const name = key === "000" ? "Three zeros" : key === "." ? "Decimal point" : key;
    await pad.getByRole("button", { name, exact: true }).click();
  }
}

async function entryOf(page, entryId) {
  const data = await loadEntriesPage(page, { view: "household", month: today().slice(0, 7) });
  return data.monthPage.entries.find((entry) => entry.id === entryId) ?? null;
}

test.describe("Cash pad on a phone", () => {
  test.use({ viewport: iPhone });

  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => window.localStorage.setItem("monies-map:money-totals-visible", "true"));
    await page.goto("/");
    await reseedDemo(page);
  });

  test("an amount and Save is a whole entry in the trip's currency; the chips tidy it after; Undo removes it", async ({ page }) => {
    const walletId = await setUpTrip(page);
    await withTestRate(page);
    const pad = await openPad(page);
    await expect(pad.locator(".cash-pad-line")).toHaveText(/Tim's cash.*IDR.*Today.*Tim/);
    // Rupiah has no cents: 000 and no decimal key.
    await expect(pad.getByRole("button", { name: "Three zeros" })).toBeVisible();
    await expect(pad.getByRole("button", { name: "Decimal point" })).toHaveCount(0);

    await press(pad, ["3", "5", "000"]);
    await expect(pad.locator(".cash-pad-amount")).toHaveText("Rp35,000");
    await page.screenshot({ path: "test-results/cash-pad-typed.png" });
    const saved = page.waitForResponse((response) => response.url().includes("/api/cash-entries/create") && response.ok());
    await pad.getByRole("button", { name: "Save", exact: true }).click();
    const { entry } = await (await saved).json();

    await expect(pad.locator(".cash-pad-saved-line")).toHaveText("Saved: Cash, Rp 35,000");
    expect(entry).toMatchObject({ accountId: walletId, paidAmountMinor: 3_500_000, paidCurrency: "IDR", amountMinor: 280, description: "Cash", categoryName: "Other", personId: TIM });
    await expect.poll(async () => (await entryOf(page, entry.entryId))?.amountMinor).toBe(280);
    await page.screenshot({ path: "test-results/cash-pad-saved.png" });

    await pad.getByRole("button", { name: "Food & Drinks" }).click();
    await expect(pad.locator(".cash-pad-chip.is-done")).toHaveText("Food & Drinks");
    await expect.poll(async () => (await entryOf(page, entry.entryId))?.categoryName).toBe("Food & Drinks");

    // A few words name it (the words box, read by Ask's rules here).
    await pad.getByRole("textbox", { name: "What was it?" }).fill("Kopi at the warung");
    await pad.getByRole("button", { name: "Add", exact: true }).click();
    await pad.locator('[data-change-draft="draft"]').getByRole("button", { name: "Save", exact: true }).click();
    await expect(pad.locator(".cash-pad-saved-line")).toHaveText("Saved: Kopi at the warung, Rp 35,000");
    await expect.poll(async () => (await entryOf(page, entry.entryId))?.description ?? "").toBe("Kopi at the warung");
    // The rupiah line the save wrote stays in the note.
    expect((await entryOf(page, entry.entryId)).note).toContain("Paid IDR 35,000 cash.");

    await pad.locator(".cash-pad-after-actions").getByRole("button", { name: "Undo" }).click();
    await expect(pad.getByText("Removed that payment.")).toBeVisible();
    await expect.poll(() => entryOf(page, entry.entryId)).toBeNull();
    // The pad is ready for the next one.
    await expect(pad.locator(".cash-pad-amount")).toHaveText("Rp0");
  });

  test("Again fills a recent payment; with money hidden the chips show names only", async ({ page }) => {
    await setUpTrip(page);
    await page.request.post("/api/cash-entries/create", {
      data: { requestId: crypto.randomUUID(), personId: TIM, amountMinor: 3_500_000, currency: "IDR", description: "Coffee", categoryName: "Food & Drinks", note: "Warung" },
      headers: { "x-cash-test-rate": "SGD/IDR=12500" }
    });
    await withTestRate(page);
    const pad = await openPad(page);
    const again = pad.getByRole("group", { name: "Again" });
    await expect(again.getByRole("button")).toHaveText(["Coffee 35,000"]);

    await again.getByRole("button", { name: "Coffee 35,000" }).click();
    await expect(pad.locator(".cash-pad-amount")).toHaveText("Rp35,000");
    const saved = page.waitForResponse((response) => response.url().includes("/api/cash-entries/create") && response.ok());
    await pad.getByRole("button", { name: "Save", exact: true }).click();
    const { entry } = await (await saved).json();
    expect(entry).toMatchObject({ description: "Coffee", categoryName: "Food & Drinks", note: "Warung", paidAmountMinor: 3_500_000 });

    // Hide money: the saved line and the chips keep names only.
    await pad.getByRole("button", { name: "Add another" }).click();
    // Runs after the describe's init script, so money stays hidden.
    await page.addInitScript(() => window.localStorage.setItem("monies-map:money-totals-visible", "false"));
    await page.reload();
    await page.getByRole("button", { name: "Just paid", exact: true }).click({ timeout: 60_000 });
    const hiddenPad = page.getByRole("dialog", { name: "Just paid" });
    await expect(hiddenPad.getByRole("group", { name: "Again" }).getByRole("button")).toHaveText(["Coffee"]);
  });

  test("a Save whose answer never arrives waits on the phone, then sends once with the same request id", async ({ page }) => {
    await setUpTrip(page);
    const requests = [];
    let dropAnswers = true;
    await page.route("**/api/cash-entries/create", async (route) => {
      requests.push(route.request().postDataJSON().requestId);
      const response = await route.fetch({ headers: { ...route.request().headers(), "x-cash-test-rate": "SGD/IDR=12500" } });
      if (dropAnswers) {
        // The server saved it; the phone never hears back.
        await route.abort("internetdisconnected");
      } else {
        await route.fulfill({ response });
      }
    });
    const pad = await openPad(page);
    await press(pad, ["2", "0", "000"]);
    await pad.getByRole("button", { name: "Save", exact: true }).click();

    const waiting = pad.getByRole("region", { name: "Waiting to send" });
    await expect(waiting).toBeVisible();
    await expect(waiting).toContainText("Cash, Rp 20,000");
    await expect(pad.locator(".cash-pad-message")).toHaveText("Waiting to send: Cash, Rp 20,000");
    await page.screenshot({ path: "test-results/cash-pad-waiting.png" });

    // The connection is back.
    dropAnswers = false;
    await page.evaluate(() => window.dispatchEvent(new Event("online")));
    await expect(waiting).toBeHidden();
    await expect(pad.locator(".cash-pad-message")).toHaveText("1 waiting payment sent.");
    expect(new Set(requests).size).toBe(1);
    expect(requests.length).toBeGreaterThanOrEqual(2);

    const data = await loadEntriesPage(page, { view: "household", month: today().slice(0, 7) });
    const twenty = data.monthPage.entries.filter((entry) => entry.description === "Cash" && entry.amountMinor === 160);
    expect(twenty).toHaveLength(1);
  });

  test("the pad and Save sit under the thumb with nothing over them", async ({ page }) => {
    await setUpTrip(page);
    const pad = await openPad(page);
    const viewport = page.viewportSize();
    const save = pad.getByRole("button", { name: "Save", exact: true });
    const saveBox = await save.boundingBox();
    expect(saveBox.y + saveBox.height).toBeLessThanOrEqual(viewport.height);
    expect(saveBox.y).toBeGreaterThan(viewport.height * 0.8);
    expect(saveBox.height).toBeGreaterThanOrEqual(56);
    for (const name of ["1", "5", "9", "0", "Three zeros", "Delete last digit"]) {
      const box = await pad.getByRole("button", { name, exact: true }).boundingBox();
      expect(box.height, name).toBeGreaterThanOrEqual(56);
      expect(box.y, name).toBeGreaterThan(viewport.height * 0.45);
    }
    // What a thumb touches at each key's and Save's centre is that control,
    // not a floating bar or the Ask field.
    const hits = await page.evaluate(() => [...document.querySelectorAll(".cash-pad-key, .cash-pad-save")].map((element) => {
      const box = element.getBoundingClientRect();
      const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
      return Boolean(hit && (hit === element || element.contains(hit)));
    }));
    expect(hits.every(Boolean)).toBe(true);
    await page.screenshot({ path: "test-results/cash-pad-reach.png" });
  });
});

test.describe("Cash pad on a wide screen", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => window.localStorage.setItem("monies-map:money-totals-visible", "true"));
    await page.goto("/");
    await reseedDemo(page);
  });

  test("the keyboard types the amount and Enter saves in Singapore dollars without a trip", async ({ page }) => {
    const wallet = await postJson(page, "/api/accounts/create", { name: "Tim's cash", institution: "Cash", kind: "cash", currency: "SGD", ownerPersonId: TIM });
    await postJson(page, "/api/settings/payment-ways/save", { personId: TIM, bankTransferAccountId: "", cashAccountId: wallet.accountId });
    const pad = await openPad(page, { phone: false });
    await expect(pad.locator(".cash-pad-line")).toHaveText(/Tim's cash.*SGD.*Today.*Tim/);
    await expect(pad.getByRole("button", { name: "Decimal point" })).toBeVisible();
    await page.keyboard.type("4.5");
    await expect(pad.locator(".cash-pad-amount")).toHaveText("$4.5");
    const saved = page.waitForResponse((response) => response.url().includes("/api/cash-entries/create") && response.ok());
    await page.keyboard.press("Enter");
    const { entry } = await (await saved).json();
    expect(entry).toMatchObject({ amountMinor: 450, accountCurrency: "SGD", paidCurrency: "SGD", accountId: wallet.accountId });
    await expect(pad.locator(".cash-pad-saved-line")).toHaveText("Saved: Cash, $4.50");
  });

  test("with no cash wallet the pad asks which wallet, cash first, and saves on the one chosen", async ({ page }) => {
    const spare = await postJson(page, "/api/accounts/create", { name: "Spare cash", institution: "Cash", kind: "cash", currency: "SGD", ownerPersonId: TIM });
    await gotoPageAfterApi(page, `/entries?view=${TIM}&month=${today().slice(0, 7)}`, "/api/entries-page", () => page.locator(".entries-fab:not(.splits-fab)"));
    const pad = await openJustPaid(page);
    await expect(pad.locator(".cash-pad-line")).toContainText("Choose a wallet");
    await page.keyboard.type("7");
    await page.keyboard.press("Enter");
    await expect(pad.getByRole("alert")).toHaveText("Which wallet did the cash come from?");
    const walletRow = pad.locator(".cash-pad-choice-row").filter({ hasText: "Cash from" });
    await expect(walletRow.getByRole("button").first()).toHaveText("Spare cash");
    // The person already said Save: the wallet picked saves it, with Undo.
    const saved = page.waitForResponse((response) => response.url().includes("/api/cash-entries/create") && response.ok());
    await walletRow.getByRole("button", { name: "Spare cash" }).click();
    expect((await (await saved).json()).entry.accountId).toBe(spare.accountId);
    await expect(pad.locator(".cash-pad-saved-line")).toHaveText("Saved: Cash, $7.00");
    await expect(pad.getByRole("button", { name: "Undo" })).toBeVisible();
  });
});
