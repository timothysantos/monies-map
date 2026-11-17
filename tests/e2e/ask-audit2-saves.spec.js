import { expect, test } from "@playwright/test";

import { loadSplitsPage, reseedDemo } from "./helpers";

// What Ask's saves really write (Ask audit 2; docs/flows/ask-flow.md "What a
// save writes"), on a 390 px phone with the real Worker and AI off, so the
// built-in rules read every message. Each test reads the Splits balances
// before and after from the page API.
//
// - B1: a shared draft saved with a group chosen lands in that group, and the
//   note says it is on Splits.
// - B2: Undo of that save takes the split away too: the balance is back.
// - B3/B4: the card lists each person's share before Save; with the Splits
//   switch off nothing goes on Splits.
// - B9: "Joyce paid me back $50" asks which group, shows what is owed before
//   and after, and records exactly that.
//
// ASK_FIX2_SHOTS=<folder> saves the screenshots for the owner's review.

const SHOTS = process.env.ASK_FIX2_SHOTS ?? "";

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

async function shot(page, name) {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}` });
}

async function openAsk(page) {
  await page.addInitScript(() => window.localStorage.setItem("monies-map:money-totals-visible", "true"));
  await page.goto("/");
  await reseedDemo(page);
  await page.goto("/ask?view=person-tim");
  await expect(page.getByRole("textbox", { name: "Message" })).toBeVisible({ timeout: 60_000 });
}

async function send(page, text) {
  const box = page.getByRole("textbox", { name: "Message" });
  await box.fill(text);
  await box.press("Enter");
}

const chips = (page) => page.getByRole("group", { name: "Suggestions" }).getByRole("button");

// What Joyce owes Tim in each group, as the Splits page shows it.
async function balances(page) {
  const month = await page.evaluate(() => new Date().toISOString().slice(0, 7));
  const data = await loadSplitsPage(page, { view: "person-tim", month });
  return Object.fromEntries(data.splitsPage.groups.map((group) => [group.name, group.balanceMinor]));
}

async function chooseGroup(page, name) {
  await page.locator('[data-ask-row="splitGroup"]').click();
  await page.locator(".mobile-select-dialog .mobile-select-option").filter({ hasText: name }).first().click();
}

test("B1, B2, B4: a stated share shows on the card, saves in the chosen group, and Undo takes it back off Splits", async ({ page }) => {
  await openAsk(page);
  const before = await balances(page);
  await send(page, "dinner $80 at jumbo split with Joyce, her share is 30");
  const card = page.locator('[data-ask-card="draft"]');
  await expect(card).toBeVisible();
  await expect(page.getByRole("switch", { name: "Share with Joyce on Splits" })).toHaveAttribute("aria-checked", "true");
  await expect(card.locator('[data-card-share="Tim"]')).toContainText("$50.00");
  await expect(card.locator('[data-card-share="Joyce"]')).toContainText("$30.00");
  await chooseGroup(page, "Baby River");
  await shot(page, "B4-after-1-shares-on-card.png");

  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.locator('[data-ask-card="saved"]')).toBeVisible();
  await expect(page.locator(".ask-note").filter({ hasText: "Saved to Entries and added to Splits." })).toBeVisible();
  await expect(page.getByText("couldn't be added to Splits")).toHaveCount(0);
  await shot(page, "B1-after-1-group-kept.png");
  const after = await balances(page);
  expect(after["Baby River"] - (before["Baby River"] ?? 0)).toBe(3_000);
  expect(after["Non-group expenses"] ?? 0).toBe(before["Non-group expenses"] ?? 0);

  await page.locator('[data-ask-card="saved"]').getByRole("button", { name: "Undo" }).click();
  await expect(page.locator(".ask-note").filter({ hasText: "Removed" }).last()).toBeVisible();
  await expect.poll(async () => (await balances(page))["Baby River"] ?? 0).toBe(before["Baby River"] ?? 0);
  await shot(page, "B2-after-1-undo-balance-back.png");
});

test("B3: Splits switched off saves the entry as one person's and nothing on Splits", async ({ page }) => {
  await openAsk(page);
  const before = await balances(page);
  await send(page, "lunch 9.90 with Joyce, her share 4");
  const card = page.locator('[data-ask-card="draft"]');
  const share = page.getByRole("switch", { name: "Share with Joyce on Splits" });
  await expect(share).toHaveAttribute("aria-checked", "true");
  await expect(card.locator('[data-card-share="Tim"]')).toContainText("$5.90");
  await expect(card.locator('[data-card-share="Joyce"]')).toContainText("$4.00");
  await shot(page, "B3-after-1-switch-on-with-shares.png");
  await share.click();
  await expect(share).toHaveAttribute("aria-checked", "false");
  await expect(card.locator("[data-card-share]")).toHaveCount(0);
  await expect(card.locator('[data-chip="owner"]')).toHaveText("Tim");
  await shot(page, "B3-after-2-switch-off-one-owner.png");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.locator(".ask-note").filter({ hasText: "Saved to Entries." }).last()).toBeVisible();
  expect(await balances(page)).toEqual(before);
});

test("B9: a payment back asks which group, shows what is owed before and after, and records exactly that", async ({ page }) => {
  await openAsk(page);
  const before = await balances(page);
  await send(page, "Joyce paid me back $50");
  await expect(chips(page).filter({ hasText: "in Baby River" })).toBeVisible();
  await shot(page, "B9-after-1-which-group.png");
  await chips(page).filter({ hasText: "in Baby River" }).click();
  const payment = page.locator('[data-settlement-draft="draft"]');
  await expect(payment).toContainText("Baby River");
  const owed = payment.locator("[data-settlement-owed]");
  await expect(owed).toContainText("Owed");
  await shot(page, "B9-after-2-owed-before-after.png");
  await payment.getByRole("button", { name: "Record payment" }).click();
  await expect(page.locator('[data-settlement-draft="saved"]')).toBeVisible();
  await expect.poll(async () => (await balances(page))["Baby River"]).toBe((before["Baby River"] ?? 0) - 5_000);
});
