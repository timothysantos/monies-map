import { expect, test } from "@playwright/test";

import { categoryList, categoryOption, gotoPageAfterApi, postJson, reseedDemo } from "./helpers";

// A UOB PayNow-FAST bank line carries the moment of the purchase and the
// payee's company code (DOMAIN.md "PayNow Reference"):
// - an imported PayNow row shows the time its reference names, a line with no
//   valid reference shows none;
// - the category list's best guess follows the company code, so a payee
//   written differently each time is still one shop.
// Desktop and a 390px phone.

const MONTH = "2026-05";
const layouts = [
  { name: "desktop", size: { width: 1280, height: 900 } },
  { name: "phone 390px", size: { width: 390, height: 844 } }
];

const line = (reference, payee, uen = "202627699C") => `PAYNOW-FAST OTHR SBA-${uen} PIB${reference} 86 ${payee}`;
const csvRow = (date, description, amount) => ({ date, description, expense: amount, income: "", account: "UOB One", category: "Other", note: "", type: "expense" });

async function importRows(page, rows) {
  const base = { sourceLabel: "UOB One PayNow", sourceType: "csv", rows, ownershipType: "direct", ownerName: "Tim" };
  const { preview } = await postJson(page, "/api/imports/preview", base);
  const included = preview.previewRows.filter((row) => row.commitStatus === "included");
  expect(included).toHaveLength(rows.length);
  await postJson(page, "/api/imports/commit", { sourceLabel: base.sourceLabel, sourceType: "csv", parserKey: "generic_csv", rows: included });
}

const row = (page, text) => page.locator(".entry-row").filter({ hasText: text });
const visibleTime = (entryRow, label) => entryRow.locator(".entry-row-transfer").getByText(label).locator("visible=true");

for (const layout of layouts) {
  test.describe(layout.name, () => {
    test.beforeEach(async ({ page }) => {
      await page.setViewportSize(layout.size);
      await page.goto("/");
      await reseedDemo(page);
    });

    test("an imported PayNow row shows the time from its reference; a line without one shows none", async ({ page }) => {
      const tag = Date.now();
      await importRows(page, [
        csvRow(`${MONTH}-20`, line("26052020520761", `EVENING SHOP ${tag}`), "18.40"),
        csvRow(`${MONTH}-20`, line("26052025619900", `BADTIME SHOP ${tag}`), "9.10"),
        csvRow(`${MONTH}-20`, `PAYNOW OTHR PLAIN FRIEND ${tag}`, "7.30")
      ]);
      await gotoPageAfterApi(page, `/entries?view=person-tim&month=${MONTH}`, "/api/entries-page", () => page.locator(".entry-row").first());

      await expect(visibleTime(row(page, `EVENING SHOP ${tag}`), "8:52 pm")).toHaveCount(1);
      for (const untimed of [`BADTIME SHOP ${tag}`, `PLAIN FRIEND ${tag}`]) {
        await expect(row(page, untimed)).toHaveCount(1);
        await expect(row(page, untimed).locator(".entry-row-transfer").getByText(/\b[ap]m\b/)).toHaveCount(0);
      }
    });

    test("the category list's best guess follows the company code, whatever the payee text", async ({ page }) => {
      const tag = Date.now();
      for (const [day, payee] of [["12", `FIRST NAME ${tag}`], ["13", `SECOND NAME ${tag}`]]) {
        await postJson(page, "/api/entries/create", {
          date: `${MONTH}-${day}`,
          description: line(`260512${day}000000`, payee),
          accountName: "UOB One",
          categoryName: "Entertainment",
          amountMinor: 1200,
          entryType: "expense",
          ownershipType: "direct",
          ownerName: "Tim"
        });
      }
      await importRows(page, [csvRow(`${MONTH}-24`, line("26052412000000", `THIRD NAME ${tag}`), "21.00")]);
      await gotoPageAfterApi(page, `/entries?view=person-tim&month=${MONTH}`, "/api/entries-page", () => row(page, `THIRD NAME ${tag}`));

      await row(page, `THIRD NAME ${tag}`).locator(".entry-row-category-button").click();
      await expect(categoryList(page)).toBeVisible();
      await expect(categoryOption(page, "Entertainment")).toContainText("Best guess");
      await expect(page.locator(".category-pick-tag")).toHaveCount(1);
      expect(await categoryList(page).locator(".category-pick-row-label").first().textContent()).toBe("Entertainment");
    });
  });
}
