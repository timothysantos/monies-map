// Fixing data that is already saved: both UOB statements were saved from
// Settings with OpenAI and Buyandship on the wrong card. Comparing the PDF
// against Lady's Card suggests moving them to One Card; applying closes
// both saved statements, and Undo puts them back.
import { expect, test } from "@playwright/test";

import { postJson } from "./helpers.js";
import { LADYS_CARD, ONE_CARD, setUpWrongCardLedger, writeStatementPdf } from "./uob-wrong-card-statement.js";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => window.localStorage.setItem("monies-map:money-totals-visible", "true"));
});

async function setUpSavedStatements(page) {
  const { oneCardId, ladysCardId, openaiId, entry } = await setUpWrongCardLedger(page);
  // The rest of the statement, recorded by hand on the right cards.
  await entry(oneCardId, "2026-04-13", "PAYMENT VIA FAST", 15000, "Transfer", { entryType: "transfer", transferDirection: "in" });
  await entry(oneCardId, "2026-05-09", "BUS/MRT", 394, "Other");
  await entry(ladysCardId, "2026-04-14", "2280 Singapore", 2350, "Other");
  await entry(ladysCardId, "2026-04-17", "NTUC FairPrice", 6435, "Groceries");
  await entry(ladysCardId, "2026-05-03", "Shaw Theatres", 2800, "Other");
  await entry(ladysCardId, "2026-05-05", "NTUC FairPrice refund", 520, "Groceries", { entryType: "income" });
  for (const [accountId, statementBalanceMinor] of [[oneCardId, 5796], [ladysCardId, 11705]]) {
    await postJson(page, "/api/accounts/reconcile", {
      accountId,
      checkpointMonth: "2026-05",
      statementStartDate: "2026-04-13",
      statementEndDate: "2026-05-12",
      statementBalanceMinor
    });
  }
  return { openaiId };
}

async function mayDelta(page, accountName) {
  const payload = await (await page.request.get("/api/settings-page?view=household")).json();
  const account = payload.settingsPage.accounts.find((item) => item.name === accountName);
  return account.checkpointHistory.find((checkpoint) => checkpoint.month === "2026-05").deltaMinor;
}

test("comparing a saved statement moves entries to the card it lists them under, and Undo puts them back", async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  await setUpSavedStatements(page);
  const pdfPath = testInfo.outputPath("eStatement_UOB_Cards_12May2026.pdf");
  await writeStatementPdf(page, pdfPath);
  expect([await mayDelta(page, ONE_CARD), await mayDelta(page, LADYS_CARD)]).toEqual([4262, -4262]);

  await page.goto("/settings?view=household");
  const accountsToggle = page.locator(".settings-section-toggle").filter({ has: page.getByRole("heading", { name: "Accounts", exact: true }) });
  if ((await accountsToggle.getAttribute("aria-expanded")) !== "true") {
    await accountsToggle.click();
  }
  await page.locator(".settings-account-card").filter({ hasText: LADYS_CARD }).getByRole("button", { name: "Compare statement" }).click();
  await page.locator("#statement-compare-account-upload").setInputFiles(pdfPath);

  const fixes = page.locator(".statement-correction-list");
  await expect(fixes.getByRole("heading", { name: "Suggested fixes" })).toBeVisible({ timeout: 30_000 });
  const moveCard = fixes.locator(".statement-fix-card").filter({ hasText: `2 entries belong on ${ONE_CARD}` });
  await expect(moveCard).toContainText(`They are on ${LADYS_CARD} in your ledger, but this statement lists them under ${ONE_CARD}. Moving them takes $42.62 off ${LADYS_CARD}'s difference and the saved statements match. You can undo this.`);
  await expect(moveCard.locator(".statement-fix-row")).toHaveCount(2);
  // Saved data is never changed without asking.
  await expect(moveCard.getByLabel("Do this for me next time when the statement proves it")).toHaveCount(0);

  await moveCard.getByRole("button", { name: `Move 2 entries to ${ONE_CARD}` }).click();
  await expect(fixes.locator(".statement-fix-applied")).toContainText(`Moved 2 entries to ${ONE_CARD}. The saved statement matches now.`);
  await expect(fixes.getByRole("button", { name: `Move 2 entries to ${ONE_CARD}` })).toHaveCount(0);
  expect([await mayDelta(page, ONE_CARD), await mayDelta(page, LADYS_CARD)]).toEqual([0, 0]);

  await fixes.locator(".statement-fix-applied").getByRole("button", { name: "Undo" }).click();
  await expect(page.locator(".settings-statement-compare.is-success")).toContainText("Undone. The entries are back as they were.");
  await expect(fixes.getByRole("button", { name: `Move 2 entries to ${ONE_CARD}` })).toBeVisible();
  expect([await mayDelta(page, ONE_CARD), await mayDelta(page, LADYS_CARD)]).toEqual([4262, -4262]);
});
