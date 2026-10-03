// Settings → Apple Pay shortcut → Paying in another currency: the card a
// Wallet purchase in another currency goes to (an Amaze card abroad charges
// the linked Citi card). Saves straight away and survives a reload.
import { expect, test } from "@playwright/test";

import { postJson, reseedDemo } from "./helpers.js";

test("the card for purchases in another currency is chosen in Settings and kept", async ({ page }) => {
  await reseedDemo(page);
  const settings = await (await page.request.get("/api/settings-page?view=household")).json();
  const activeIds = settings.settingsPage.accounts.filter((account) => account.isActive).map((account) => account.id);
  await postJson(page, "/api/settings/shortcuts/save", { apiKey: "mm_e2e_key", defaultAccountPriorityIds: activeIds });

  await page.goto("/settings?view=household");
  await page.getByRole("button", { name: /Apple Pay shortcut/ }).click();
  const select = page.getByLabel("Purchases in another currency go to");
  await expect(select).toHaveValue("");
  await expect(select.locator("option").first()).toHaveText("Same as other purchases");

  await select.selectOption({ label: "Citi Rewards" });
  await expect(page.locator(".settings-shortcut-status")).toHaveText("Card for other currencies saved.");

  await page.reload();
  await page.getByRole("button", { name: /Apple Pay shortcut/ }).click();
  await expect(page.getByLabel("Purchases in another currency go to").locator("option:checked")).toHaveText("Citi Rewards");
});
