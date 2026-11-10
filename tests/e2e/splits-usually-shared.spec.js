import { expect, test } from "@playwright/test";

import { postJson, reseedDemo } from "./helpers";

// Splits: "Usually shared, not on Splits yet" (DOMAIN.md "Usually Shared").
// Past entries at a shop Tim usually puts on Splits are listed by shop with
// ticks; Add puts the ticked ones on Splits with the shop's usual split, and
// Undo takes them back. More than 10 in one Add asks for "Yes, add all N".
// A phone gets one count row that opens a sheet.

const SHOP = `Usual Shop ${Date.now()}`;
const daysAgo = (days) => {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
};

async function entry(page, days, amountMinor, description = SHOP) {
  const created = await postJson(page, "/api/entries/create", {
    date: daysAgo(days),
    description,
    accountName: "UOB One",
    categoryName: "Groceries",
    amountMinor,
    entryType: "expense",
    ownershipType: "direct",
    ownerName: "Tim"
  });
  return created.entryId;
}

// Tim shared the shop `shared` times long ago (half each, no group) and
// bought there `recent` times lately without adding them. The recent ones are
// made first so Ask's own habits never add them by themselves.
async function seed(page, { shared = 3, recent = 2 } = {}) {
  await page.request.post("/api/ask/habits/setting", { data: { enabled: false } });
  const newest = [];
  for (let index = 0; index < recent; index += 1) newest.push(await entry(page, 3 + (index % 80), 1_000 + index));
  for (let index = 0; index < shared; index += 1) {
    const id = await entry(page, 100 + index * 8, 2_000);
    await postJson(page, "/api/splits/expenses/from-entry", { entryId: id, splitGroupId: null });
  }
  return newest;
}

async function openSplits(page) {
  const ready = page.waitForResponse((response) => response.url().includes("/api/splits-usually-shared") || response.url().includes("/api/splits/usually-shared"), { timeout: 60_000 });
  await page.goto("/splits?view=person-tim");
  await ready;
}

test("a shop usually shared is listed, ticks choose the entries, Add puts them on Splits and Undo takes them back", async ({ page }) => {
  await page.goto("/");
  await reseedDemo(page);
  const ids = await seed(page);
  await openSplits(page);

  const section = page.getByRole("region", { name: "Usually shared, not on Splits yet" });
  await expect(section).toBeVisible();
  await expect(section.getByText("You usually share these: 2 entries at 1 shop.")).toBeVisible();
  await section.getByRole("button", { name: "Review" }).click();

  const card = section.locator(`[data-usually-shop="${SHOP}"]`);
  await expect(card).toBeVisible();
  await expect(card.getByText("Usually half each with Joyce.")).toBeVisible();
  await expect(card.getByText("Shared 3 of 4 times.")).toBeVisible();
  // The group's amount is an openable figure over exactly its entries.
  const figure = card.locator("[data-fig='spent']");
  await expect(figure).toHaveAttribute("data-fig-ids", ids.join(" "));
  await expect(card.getByRole("button", { name: "Add 2" })).toBeVisible();

  const first = card.getByRole("checkbox").first();
  await first.uncheck();
  await expect(card.getByRole("button", { name: "Add 1" })).toBeVisible();
  await first.check();
  await expect(card.getByRole("button", { name: "Add 2" })).toBeVisible();

  await card.getByRole("button", { name: "Add 2" }).click();
  await expect(section.getByText("Added 2 entries to Splits.")).toBeVisible();
  await expect(section.locator(`[data-usually-shop="${SHOP}"]`)).toHaveCount(0);
  for (const id of ids) {
    const rows = await page.request.get(`/api/entries-page?view=person-tim&month=${daysAgo(3).slice(0, 7)}`);
    expect(rows.ok()).toBe(true);
    const data = await rows.json();
    const found = data.monthPage.entries.find((item) => item.id === id);
    if (found) expect(found.linkedSplitExpenseId).toBeTruthy();
  }

  await section.getByRole("button", { name: "Undo" }).click();
  await expect(section.getByText("Taken back off Splits.")).toBeVisible();
  // The list was left open, and the two entries are on it again.
  await expect(section.locator(`[data-usually-shop="${SHOP}"]`)).toBeVisible();
  await expect(section.getByRole("button", { name: "Hide" })).toBeVisible();
});

test("more than ten entries in one Add ask for Yes, add all N first", async ({ page }) => {
  await page.goto("/");
  await reseedDemo(page);
  await seed(page, { shared: 20, recent: 12 });
  await openSplits(page);

  const section = page.getByRole("region", { name: "Usually shared, not on Splits yet" });
  await section.getByRole("button", { name: "Review" }).click();
  const card = section.locator(`[data-usually-shop="${SHOP}"]`);
  await card.getByRole("button", { name: "Add 12" }).click();
  await expect(card.getByText("This puts 12 entries on Splits at once.")).toBeVisible();
  await card.getByRole("button", { name: "Cancel" }).click();
  await expect(card.getByRole("button", { name: "Add 12" })).toBeVisible();
  await card.getByRole("button", { name: "Add 12" }).click();
  await card.getByRole("button", { name: "Yes, add all 12" }).click();
  await expect(section.getByText("Added 12 entries to Splits.")).toBeVisible();
});

test("nothing is shown when nothing is found, and a shop shared too rarely is never listed", async ({ page }) => {
  await page.goto("/");
  await reseedDemo(page);
  await page.request.post("/api/ask/habits/setting", { data: { enabled: false } });
  await entry(page, 5, 1_500, `${SHOP} rarely`);
  await openSplits(page);
  await expect(page.getByRole("region", { name: "Usually shared, not on Splits yet" })).toHaveCount(0);
  await expect(page.locator(".panel-splits")).toBeVisible();
});

test("on a phone the section is one count row that opens a sheet", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await reseedDemo(page);
  await seed(page);
  await openSplits(page);

  const section = page.getByRole("region", { name: "Usually shared, not on Splits yet" });
  await expect(section.getByText("You usually share these: 2 entries at 1 shop.")).toBeVisible();
  await expect(section.locator(".split-usually-group")).toHaveCount(0);
  await section.getByRole("button", { name: "Review" }).click();
  const sheet = page.getByRole("dialog", { name: "Usually shared" });
  await expect(sheet).toBeVisible();
  await expect(sheet.locator(`[data-usually-shop="${SHOP}"]`)).toBeVisible();
  await sheet.getByRole("button", { name: "Add 2" }).click();
  await expect(sheet.getByText("Added 2 entries to Splits.")).toBeVisible();
  await sheet.getByRole("button", { name: "Close" }).click();
  await expect(sheet).toHaveCount(0);
});
