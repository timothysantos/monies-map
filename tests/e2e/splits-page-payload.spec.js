import { expect, test } from "@playwright/test";

import { postJson, reseedDemo } from "./helpers";

// The Splits page carries only the month slice it uses: the month key and
// the month's transfers (for matching a settlement checkpoint to a bank
// transfer), adjusted for the person view. Plan rows, income rows, metric
// cards and non-transfer entries belong to the Month page.

async function getJson(page, path) {
  const response = await page.request.get(path);
  expect(response.ok(), await response.text()).toBeTruthy();
  return response.json();
}

test("the Splits page month slice is the month plus exactly the month's transfers", async ({ page }) => {
  await reseedDemo(page);
  const transfer = await postJson(page, "/api/entries/create", {
    date: "2026-05-14", description: "Splits payload transfer out", accountName: "UOB Savings", categoryName: "Transfer",
    amountMinor: 12_000, entryType: "transfer", transferDirection: "out", ownershipType: "direct", ownerName: "Tim"
  });
  await postJson(page, "/api/entries/create", {
    date: "2026-05-15", description: "Splits payload expense", accountName: "UOB One", categoryName: "Groceries",
    amountMinor: 3_300, entryType: "expense", ownershipType: "direct", ownerName: "Tim"
  });

  for (const view of ["person-tim", "household"]) {
    const splits = await getJson(page, `/api/splits-page?view=${view}&month=2026-05`);
    const entries = await getJson(page, `/api/entries-page?view=${view}&month=2026-05`);
    expect(Object.keys(splits.monthPage).sort()).toEqual(["entries", "month"]);
    expect(splits.monthPage.month).toBe("2026-05");
    expect(splits.monthPage.entries.length).toBeGreaterThan(0);
    expect(splits.monthPage.entries.every((entry) => entry.entryType === "transfer")).toBe(true);
    expect(splits.monthPage.entries.some((entry) => entry.id === transfer.entryId)).toBe(true);
    // Same transfers, same order, same values as the Entries page for this view.
    expect(splits.monthPage.entries).toEqual(entries.monthPage.entries.filter((entry) => entry.entryType === "transfer"));
    expect(splits.splitsPage.groups.length).toBeGreaterThan(0);
  }
});
