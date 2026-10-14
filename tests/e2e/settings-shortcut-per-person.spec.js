// Settings -> Apple Pay shortcut: one connection per person. "Who is this
// phone for?" picks the person; their key, Default account list and revoke
// are their own; a purchase saved with their key is theirs. Phone and desktop
// layouts both fit. No browser dialogs: stopping a phone asks in an app dialog.
import { expect, test } from "@playwright/test";

import { loadEntriesPage, loadSettingsPage, postJson, reseedDemo } from "./helpers.js";

async function openShortcutSection(page) {
  await page.goto("/settings?view=household");
  await page.getByRole("button", { name: /Apple Pay shortcut/ }).click();
  return {
    who: page.getByLabel("Whose phone the Apple Pay shortcut is set up for"),
    status: page.locator(".settings-shortcut-status")
  };
}

async function purchase(page, key, body = {}) {
  return page.request.post(`/api/shortcuts/entries/create?shortcut_token=${encodeURIComponent(key)}`, {
    data: { date: "2026-10-03", amount: "SGD 6.60", description: "Per-person coffee", ...body }
  });
}

test("Joyce's phone gets its own key and cards, and a purchase with it is hers; stopping it leaves Tim's phone alone", async ({ page }) => {
  await reseedDemo(page);
  const timKey = `mm_tim_${Date.now()}`;
  const accounts = (await loadSettingsPage(page)).settingsPage.accounts;
  const timCard = accounts.find((account) => account.name === "UOB One");
  await postJson(page, "/api/settings/shortcuts/save", { apiKey: timKey, defaultAccountPriorityIds: [timCard.id] });

  const section = await openShortcutSection(page);
  await expect(page.getByText("Who is this phone for?")).toBeVisible();
  await expect(section.who.locator("option")).toHaveText(["Tim", "Joyce"]);
  await expect(page.getByRole("button", { name: "Install Apple Shortcut for Tim" })).toBeVisible();

  await section.who.selectOption({ label: "Joyce" });
  await expect(page.getByRole("button", { name: "Install Apple Shortcut for Joyce" })).toBeVisible();
  await expect(page.getByText("Purchases from Joyce's phone are saved as Joyce's, to Joyce's own list of accounts.")).toBeVisible();
  // Her list starts with her own cards, not Tim's.
  await page.getByRole("button", { name: /Default account/ }).click();
  const firstRow = page.locator(".settings-shortcut-account-row").first();
  await expect(firstRow).toContainText(/UOB Lady's|Citi Rewards/);

  await page.getByRole("button", { name: "More shortcut settings" }).click();
  await page.getByRole("button", { name: "Generate key" }).click();
  await page.getByRole("button", { name: "Save shortcut settings" }).click();
  await expect(section.status).toHaveText("Shortcut settings saved.");

  const joyce = (await loadSettingsPage(page)).settingsPage.shortcutSettings.connections.find((connection) => connection.personId === "person-joyce");
  expect(joyce.apiKeySource).toBe("app");
  expect(joyce.apiKey).toMatch(/^mm_/);
  expect(joyce.apiKey).not.toBe(timKey);

  const hers = await purchase(page, joyce.apiKey, { ownerName: "Tim" });
  expect(hers.ok(), await hers.text()).toBeTruthy();
  const created = await hers.json();
  expect(created.accountId).toBe(joyce.defaultAccountPriorityIds[0]);
  // The request named Tim as owner; the key's person wins.
  const saved = (await loadEntriesPage(page, { view: "household", month: "2026-10" })).monthPage.entries.find((entry) => entry.id === created.entryId);
  expect(saved.ownerName).toBe("Joyce");

  // Stop her phone: an app dialog, then her key is refused and his still works.
  await page.getByRole("button", { name: "Stop this phone" }).click();
  await expect(page.getByRole("dialog")).toContainText("Joyce's phone will stop saving purchases");
  await page.getByRole("button", { name: "Stop saving" }).click();
  await expect(section.status).toContainText("Joyce's phone has stopped.");
  expect((await purchase(page, joyce.apiKey, { description: "After stop" })).status()).toBe(401);
  expect((await purchase(page, timKey, { description: "Tim after Joyce stopped" })).ok()).toBeTruthy();
});

test("negative: two phones cannot save the same key", async ({ page }) => {
  await reseedDemo(page);
  const timKey = `mm_tim_${Date.now()}`;
  const accounts = (await loadSettingsPage(page)).settingsPage.accounts;
  await postJson(page, "/api/settings/shortcuts/save", { apiKey: timKey, defaultAccountPriorityIds: [accounts[0].id] });
  const clash = await page.request.post("/api/settings/shortcuts/save", {
    data: { personId: "person-joyce", apiKey: timKey, defaultAccountPriorityIds: [accounts[0].id] }
  });
  expect(clash.status()).toBe(400);
  expect((await clash.json()).error).toBe("Another person's phone already uses this key. Generate a new key for this one.");
});

for (const viewport of [
  { name: "phone", size: { width: 390, height: 844 } },
  { name: "desktop", size: { width: 1280, height: 900 } }
]) {
  test(`the phone row and buttons fit a ${viewport.name}`, async ({ page }) => {
    await page.setViewportSize(viewport.size);
    await reseedDemo(page);
    const section = await openShortcutSection(page);
    const row = await section.who.boundingBox();
    expect(row.height).toBeGreaterThanOrEqual(44);
    expect(row.x + row.width).toBeLessThanOrEqual(viewport.size.width);
    await section.who.selectOption({ label: "Joyce" });
    const install = await page.getByRole("button", { name: "Install Apple Shortcut for Joyce" }).boundingBox();
    expect(install.x + install.width).toBeLessThanOrEqual(viewport.size.width);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });
}
