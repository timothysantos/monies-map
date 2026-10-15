import { expect, test } from "@playwright/test";

import { gotoPageAfterApi, loadEntriesPage, openEntryComposer, postJson, reseedDemo } from "./helpers";

// The time of day an entry was made (DOMAIN.md, "Transaction Time"):
// - an Apple Pay Shortcut entry carries the Singapore time the Shortcut ran,
//   a hand-made entry the time it was given, a bank-imported row none;
// - an Entries row names it ("2:32 pm") beside the wallet line, the day's
//   header stays a date, and a day lists its timed entries latest first;
// - the Edit entry card shows it on the date chip ("Sun 24 May · 2:32 pm")
//   and edits it under More details (a Time row you can clear).
// Desktop edits inline; a phone edits in the Edit entry sheet.

const MONTH = "2026-05";
const DAY = `${MONTH}-24`;
const SHORTCUT_TOKEN = "mm_e2e_key";

const layouts = [
  { name: "desktop", size: { width: 1280, height: 900 }, isSheet: false },
  { name: "phone 390px", size: { width: 390, height: 844 }, isSheet: true }
];

const todaySingapore = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Singapore", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());

async function createEntry(page, patch) {
  const { entryId } = await postJson(page, "/api/entries/create", {
    date: DAY,
    accountName: "UOB One",
    categoryName: "Groceries",
    amountMinor: 1_890,
    entryType: "expense",
    ownershipType: "direct",
    ownerName: "Tim",
    ...patch
  });
  return entryId;
}

async function openEntries(page, month = MONTH) {
  await gotoPageAfterApi(page, `/entries?view=person-tim&month=${month}`, "/api/entries-page", () => page.locator(".entry-row").first());
}

// The time a row shows to the eye: a wide row's second line or a phone row's
// wallet line (the other one is display:none, which toContainText ignores).
const visibleTime = (entryRow, label) => entryRow.locator(".entry-row-transfer").getByText(label).locator("visible=true");
const row = (page, description) => page.locator(".entry-row").filter({ hasText: description });
const editorOf = (page, layout) => (layout.isSheet ? page.getByRole("dialog", { name: "Edit entry" }) : page.locator(".entry-inline-editor"));

async function save(page, editor, layout) {
  const update = page.waitForResponse((response) => response.url().includes("/api/entries/update"));
  await (layout.isSheet
    ? editor.getByRole("button", { name: "Save", exact: true })
    : editor.getByRole("button", { name: "Done editing entry" })).click();
  expect((await update).ok()).toBeTruthy();
}

function clockNow() {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Singapore", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date()).map((part) => [part.type, part.value]));
  return `${parts.hour}:${parts.minute}`;
}

function clockLabel(time) {
  const [hours, minutes] = time.split(":").map(Number);
  return `${hours % 12 === 0 ? 12 : hours % 12}:${String(minutes).padStart(2, "0")} ${hours >= 12 ? "pm" : "am"}`;
}

for (const layout of layouts) {
  test.describe(layout.name, () => {
    test.beforeEach(async ({ page }) => {
      await page.setViewportSize(layout.size);
      await page.goto("/");
      await reseedDemo(page);
    });

    test("a hand-made entry shows its time on the row, the day header stays a date, bank rows show none", async ({ page }) => {
      await createEntry(page, { description: "Time row kopi", time: "14:32" });
      await createEntry(page, { description: "Time row no clock", time: null });
      await openEntries(page);

      const timed = row(page, "Time row kopi");
      await expect(timed).toHaveCount(1);
      await expect(visibleTime(timed, "2:32 pm")).toHaveCount(1);
      await expect(row(page, "Time row no clock").locator(".entry-row-transfer").getByText(/\b[ap]m\b/).locator("visible=true")).toHaveCount(0);
      // The group header names the date only.
      await expect(page.locator(".entries-date-head strong").first()).not.toContainText(/\b[ap]m\b/);
      // Seeded (bank-imported) rows have no time at all.
      const payload = await loadEntriesPage(page, { view: "person-tim", month: MONTH });
      expect(payload.monthPage.entries.filter((entry) => entry.time).map((entry) => entry.description)).toEqual(["Time row kopi"]);
    });

    test("a day lists its timed entries latest first, then the untimed ones", async ({ page }) => {
      await createEntry(page, { description: "Order untimed first made", time: null });
      await createEntry(page, { description: "Order morning", time: "09:10" });
      await createEntry(page, { description: "Order evening", time: "18:45" });
      await createEntry(page, { description: "Order untimed second made", time: null });
      await openEntries(page);

      const rows = page.locator(".entry-row").filter({ hasText: "Order " });
      await expect(rows).toHaveCount(4);
      const expected = ["Order evening", "Order morning", "Order untimed first made", "Order untimed second made"];
      const texts = await rows.allInnerTexts();
      expect(texts.map((text) => expected.find((name) => text.includes(name)))).toEqual(expected);
    });

    test("the time is edited under More details, shown on the date chip and cleared", async ({ page }) => {
      await createEntry(page, { description: "Time edit kopi", time: "14:32" });
      await openEntries(page);
      await row(page, "Time edit kopi").locator(".entry-row-main").click();
      const editor = editorOf(page, layout);
      await expect(editor).toBeVisible();
      await expect(editor.locator("[data-chip='date']")).toContainText("Sun 24 May · 2:32 pm");

      if (layout.isSheet) {
        await editor.getByRole("button", { name: /More details/ }).click();
      }
      const timeInput = editor.getByLabel("Time", { exact: true });
      await expect(timeInput).toHaveValue("14:32");
      await timeInput.fill("09:05");
      await expect(editor.locator("[data-chip='date']")).toContainText("Sun 24 May · 9:05 am");
      await save(page, editor, layout);
      await expect(visibleTime(row(page, "Time edit kopi"), "9:05 am")).toHaveCount(1);

      await row(page, "Time edit kopi").locator(".entry-row-main").click();
      const editorAgain = editorOf(page, layout);
      if (layout.isSheet) {
        await editorAgain.getByRole("button", { name: /More details/ }).click();
      }
      await editorAgain.getByRole("button", { name: "Clear time" }).click();
      await expect(editorAgain.getByLabel("Time", { exact: true })).toHaveValue("");
      await save(page, editorAgain, layout);
      await expect(row(page, "Time edit kopi").locator(".entry-row-transfer").getByText(/\b[ap]m\b/)).toHaveCount(0);
      const payload = await loadEntriesPage(page, { view: "person-tim", month: MONTH });
      expect(payload.monthPage.entries.find((entry) => entry.description === "Time edit kopi")?.time).toBeUndefined();
    });

    test("an Apple Pay Shortcut entry carries the Singapore time it ran", async ({ page }) => {
      const settings = await (await page.request.get("/api/settings-page?view=household")).json();
      const activeIds = settings.settingsPage.accounts.filter((account) => account.isActive).map((account) => account.id);
      await postJson(page, "/api/settings/shortcuts/save", { apiKey: SHORTCUT_TOKEN, defaultAccountPriorityIds: activeIds });
      const today = todaySingapore();
      const before = clockNow();
      const response = await page.request.post("/api/shortcuts/entries/create", {
        headers: { "X-Monies-Shortcut-Token": SHORTCUT_TOKEN },
        data: { amount: "6.80", description: "Time shortcut toast", accountName: "UOB One", date: today, requestId: `e2e-time-${Date.now()}` }
      });
      const body = await response.json();
      expect(response.ok(), JSON.stringify(body)).toBeTruthy();
      const after = clockNow();
      expect([before, after]).toContain(body.time);

      await openEntries(page, today.slice(0, 7));
      const created = row(page, "Time shortcut toast");
      await expect(created).toHaveCount(1);
      await expect(visibleTime(created, clockLabel(body.time))).toHaveCount(1);
    });
  });
}

test("a new entry typed in the form saves the time in its Time field", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/");
  await reseedDemo(page);
  await openEntries(page);
  await openEntryComposer(page);
  const composer = page.locator(".entry-composer");
  await composer.getByLabel("Description").fill("Time form kopi");
  await composer.getByLabel("Amount").fill("4.50");
  await composer.getByLabel("Date", { exact: true }).fill(DAY);
  // Not today: the field starts empty. Fill it and save.
  await expect(composer.getByLabel("Time", { exact: true })).toHaveValue("");
  await composer.getByLabel("Time", { exact: true }).fill("11:20");
  const create = page.waitForResponse((response) => response.url().includes("/api/entries/create"));
  await composer.getByRole("button", { name: "Create entry" }).click();
  expect((await create).ok()).toBeTruthy();
  await expect(visibleTime(row(page, "Time form kopi"), "11:20 am")).toHaveCount(1);
});
