import { expect, test } from "@playwright/test";

import { gotoPageAfterApi, openEntryComposer, reseedDemo } from "./helpers";

// The Entries form on a wide screen is reached from the round + button:
// Ask's new entry card, then "Edit in form". Both that and the Apple Pay
// Shortcut open the form through the same add-expense link. The warning
// "Shortcut did not pass an amount" is about a Shortcut that lost its Amount
// variable, so it shows only for a Shortcut link, never for a blank card a
// person opens by hand.

const MONTH = "2026-05";
const AMOUNT_WARNING = "Shortcut did not pass an amount. Check that the URL uses the real Amount variable, not placeholder text.";

test.beforeEach(async ({ page }) => {
  await reseedDemo(page);
});

test("a blank card opened with Edit in form shows no Shortcut warning", async ({ page }) => {
  const rows = page.locator(".entry-row");
  await gotoPageAfterApi(page, `/entries?view=person-tim&month=${MONTH}`, "/api/entries-page", () => rows.first());

  await openEntryComposer(page);

  const composer = page.locator(".entry-composer");
  await expect(composer.getByLabel("Description")).toHaveValue("");
  await expect(page.getByText("Shortcut did not pass")).toHaveCount(0);
  await expect(composer.locator(".entry-submit-error")).toHaveCount(0);
});

test("a Shortcut link without an amount still warns in the form", async ({ page }) => {
  const rows = page.locator(".entry-row");
  await gotoPageAfterApi(
    page,
    `/entries?view=person-tim&month=${MONTH}&action=add-expense&merchant=Toast%20Box`,
    "/api/entries-page",
    () => rows.first()
  );

  const composer = page.locator(".entry-composer");
  await expect(composer).toBeVisible();
  await expect(composer.getByLabel("Description")).toHaveValue("Toast Box");
  await expect(composer.locator(".entry-submit-error")).toHaveText(AMOUNT_WARNING);
});
