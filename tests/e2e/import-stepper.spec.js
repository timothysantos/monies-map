// The Imports page's sticky import bar: the three steps, one chip per file
// of this session's batch, and what still blocks a clean commit of the file
// in review, each chip a jump to the control that fixes it. Uses the
// sanitized two-card UOB statement printed to a real PDF
// (tests/fixtures/pdf-statement-text/uob-card-two-card-may-2026-sanitized).
import { expect, test } from "@playwright/test";
import { writeFile } from "node:fs/promises";

import { postJson, reseedDemo } from "./helpers.js";
import { LADYS_CARD, ONE_CARD, setUpWrongCardLedger, writeStatementPdf } from "./uob-wrong-card-statement.js";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => window.localStorage.setItem("monies-map:money-totals-visible", "true"));
});

// Lady's Card exists with OpenAI and Buyandship recorded on it, so its
// balance is off; One Card has no account yet, so it must be mapped. "My One
// Card" is the account it will be mapped to.
async function setUpUnmappedLedger(page) {
  await reseedDemo(page);
  const createAccount = async (name, openingBalanceMinor) => (await postJson(page, "/api/accounts/create", {
    name,
    institution: "UOB",
    kind: "credit_card",
    currency: "SGD",
    openingBalanceMinor,
    ownerPersonId: "person-tim",
    isJoint: false
  })).accountId;
  const ladysCardId = await createAccount(LADYS_CARD, -1250);
  await createAccount("My One Card", 15000);
  for (const [date, description, amountMinor, categoryName] of [
    ["2026-04-30", "Don Don Donki", 1890, "Groceries"],
    ["2026-04-20", "OpenAI", 2949, "Subscriptions MO"],
    ["2026-05-05", "Buyandship", 1313, "Shopping"],
    ["2026-05-14", "Sabai Sabai - Valley P", 2049, "Food & Drinks"]
  ]) {
    await postJson(page, "/api/entries/create", {
      accountId: ladysCardId,
      date,
      description,
      amountMinor,
      categoryName,
      entryType: "expense",
      ownershipType: "direct",
      ownerName: "Tim"
    });
  }
}

async function writeFiles(page, testInfo) {
  const pdfPath = testInfo.outputPath("eStatement_UOB_Cards_12May2026.pdf");
  const oneCardCsv = testInfo.outputPath("one-card-activity.csv");
  const ladysCsv = testInfo.outputPath("ladys-card-activity.csv");
  await writeStatementPdf(page, pdfPath);
  await writeFile(oneCardCsv, [
    "date,description,amount,account,category",
    `2026-04-21,OPENAI *CHATGPT SUBSCR,-29.49,${ONE_CARD},Other`,
    `2026-05-15,GRAB RIDES SINGAPORE,-12.30,${ONE_CARD},Other`
  ].join("\n"));
  await writeFile(ladysCsv, [
    "date,description,amount,account,category",
    `2026-05-20,KOPI TIAM,-4.20,${LADYS_CARD},Other`
  ].join("\n"));
  return [ladysCsv, pdfPath, oneCardCsv];
}

const bar = (page) => page.getByRole("navigation", { name: "Import progress" });

// The target sits fully below the sticky bar, inside the window.
async function expectBelowBar(page, locator) {
  await expect(locator).toBeInViewport();
  await expect.poll(async () => {
    const barBox = await bar(page).boundingBox();
    const box = await locator.boundingBox();
    return Boolean(barBox && box) && box.y >= barBox.y + barBox.height - 1;
  }).toBe(true);
}

test("the import bar follows a long review, lists the batch and jumps to each blocker", async ({ page }, testInfo) => {
  test.setTimeout(150_000);
  await page.setViewportSize({ width: 1280, height: 800 });
  await setUpUnmappedLedger(page);
  const files = await writeFiles(page, testInfo);

  await page.goto("/imports");
  await page.locator("input[type=file]").setInputFiles(files);
  const chips = bar(page).locator(".import-file-chip");
  // One chip per file, in review order: the statement first.
  await expect(chips).toHaveText(["UOB cards May", "one-card-activity.csv", "ladys-card-activity.csv"]);
  await expect(bar(page)).toContainText("File 1 of 3");

  // A waiting chip opens its file like the queue's Review button.
  await chips.filter({ hasText: "UOB cards May" }).click();
  await expect(page.locator(".statement-review")).toBeVisible({ timeout: 30_000 });
  await expect(chips.filter({ hasText: "UOB cards May" })).toHaveAttribute("aria-current", "step");
  await expect(chips.filter({ hasText: "one-card-activity.csv" })).not.toHaveAttribute("aria-current", "step");

  const blockers = bar(page).locator(".import-blockers");
  await expect(blockers).toContainText("Before you can commit:");
  await expect(blockers.locator(".import-blocker-chip")).toHaveText([
    "Map 1 account",
    `${ONE_CARD} doesn't match`,
    `${LADYS_CARD} off by $42.62`
  ]);
  const commitBar = page.locator(".import-commit-bar");
  await expect(commitBar).toContainText("3 things left");

  // The bar stays at the top while the review scrolls under it.
  await page.evaluate(() => window.scrollTo({ top: document.documentElement.scrollHeight, behavior: "instant" }));
  await expect(bar(page)).toBeInViewport();
  await expect.poll(async () => (await bar(page).boundingBox())?.y).toBeLessThan(40);

  // A card chip scrolls its card into view below the bar and focuses it.
  await blockers.getByRole("button", { name: `${LADYS_CARD} off by $42.62` }).click();
  const ladysCard = page.locator(".statement-card").filter({ hasText: `${LADYS_CARD} • May 2026` });
  await expectBelowBar(page, ladysCard);
  await expect(ladysCard).toBeFocused();

  // Jump to next goes to the first thing to fix: the card to map.
  await commitBar.getByRole("button", { name: "Jump to next" }).click();
  const oneCardSelect = page.getByRole("combobox", { name: `Detected: ${ONE_CARD}` });
  await expectBelowBar(page, oneCardSelect);
  await expect(oneCardSelect).toBeFocused();

  // Mapping it removes its chip; the count follows.
  await oneCardSelect.selectOption({ label: "My One Card - Tim" });
  await expect(blockers.getByRole("button", { name: "Map 1 account" })).toHaveCount(0, { timeout: 30_000 });
  await expect(page.locator(".import-blockers-live")).not.toContainText("3 things left");

  // Commit anyway: the statement is done, the count stays on its file.
  await commitBar.locator(".import-commit-button").click();
  await page.getByRole("button", { name: "Commit anyway" }).click();
  await expect(page.locator(".import-done-card")).toBeVisible({ timeout: 30_000 });
  await expect(chips).toHaveText(["UOB cards May", "one-card-activity.csv", "ladys-card-activity.csv"]);
  await expect(chips.first()).toHaveClass(/is-done/);
  await expect(bar(page)).toContainText("File 1 of 3");
  await expect(bar(page).locator(".import-blockers")).toHaveCount(0);
  // The done chip goes to its summary.
  await page.evaluate(() => window.scrollTo({ top: document.documentElement.scrollHeight, behavior: "instant" }));
  await chips.first().click();
  await expectBelowBar(page, page.locator(".import-done-card h3"));
});

test("a waiting chip asks before it drops an applied fix, and Cancel keeps the review", async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1280, height: 800 });
  await setUpWrongCardLedger(page);
  const pdfPath = testInfo.outputPath("eStatement_UOB_Cards_12May2026.pdf");
  const csvPath = testInfo.outputPath("one-card-activity.csv");
  await writeStatementPdf(page, pdfPath);
  await writeFile(csvPath, ["date,description,amount,account,category", `2026-05-15,GRAB RIDES SINGAPORE,-12.30,${ONE_CARD},Other`].join("\n"));

  await page.goto("/imports");
  await page.locator("input[type=file]").setInputFiles([pdfPath, csvPath]);
  const chips = bar(page).locator(".import-file-chip");
  await chips.filter({ hasText: "UOB cards May" }).click();
  const ladysCard = page.locator(".statement-reconciliation-row").filter({ hasText: `${LADYS_CARD} • May 2026` });
  await ladysCard.getByRole("button", { name: "Move 2 entries to UOB One Card" }).click();
  await expect(page.locator(".statement-review-actions .pill")).toHaveText("Both cards balance");
  // With every card balanced only the matched rows are left to show.
  await expect(bar(page).locator(".import-blocker-chip")).toHaveCount(0);
  await expect(page.locator(".import-commit-bar")).not.toContainText("things left");

  await chips.filter({ hasText: "one-card-activity.csv" }).click();
  const question = page.locator(".import-file-switch-warning");
  await expect(question).toContainText("Opening one-card-activity.csv drops your changes to this file.");
  await question.getByRole("button", { name: "Cancel" }).click();
  await expect(question).toHaveCount(0);
  await expect(page.locator(".statement-review-actions .pill")).toHaveText("Both cards balance");
  await expect(chips.filter({ hasText: "UOB cards May" })).toHaveAttribute("aria-current", "step");

  await chips.filter({ hasText: "one-card-activity.csv" }).click();
  await page.locator(".import-file-switch-warning").getByRole("button", { name: "Open anyway" }).click();
  await expect(page.locator(".statement-review")).toHaveCount(0);
  await expect(chips.filter({ hasText: "one-card-activity.csv" })).toHaveAttribute("aria-current", "step");
});

test("a statement opened with nothing changed switches files without asking", async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1280, height: 800 });
  await setUpWrongCardLedger(page);
  const pdfPath = testInfo.outputPath("eStatement_UOB_Cards_12May2026.pdf");
  const csvPath = testInfo.outputPath("one-card-activity.csv");
  await writeStatementPdf(page, pdfPath);
  await writeFile(csvPath, ["date,description,amount,account,category", `2026-05-15,GRAB RIDES SINGAPORE,-12.30,${ONE_CARD},Other`].join("\n"));

  await page.goto("/imports");
  await page.locator("input[type=file]").setInputFiles([pdfPath, csvPath]);
  const chips = bar(page).locator(".import-file-chip");
  await chips.filter({ hasText: "UOB cards May" }).click();
  await expect(page.locator(".statement-review")).toBeVisible({ timeout: 30_000 });
  await chips.filter({ hasText: "one-card-activity.csv" }).click();
  await expect(page.locator(".import-file-switch-warning")).toHaveCount(0);
  await expect(chips.filter({ hasText: "one-card-activity.csv" })).toHaveAttribute("aria-current", "step");
});

test("on a phone the import bar scrolls with the page and the commit bar stays", async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 390, height: 844 });
  await setUpUnmappedLedger(page);
  const files = await writeFiles(page, testInfo);

  await page.goto("/imports");
  await page.locator("input[type=file]").setInputFiles(files);
  await bar(page).locator(".import-file-chip").filter({ hasText: "UOB cards May" }).click();
  await expect(page.locator(".statement-review")).toBeVisible({ timeout: 30_000 });
  await expect(page.locator(".import-commit-bar")).toContainText("3 things left");

  // Halfway down the review.
  await page.evaluate(() => {
    const review = document.querySelector(".statement-review").getBoundingClientRect();
    window.scrollTo({ top: window.scrollY + review.top + review.height / 2 - window.innerHeight / 2, behavior: "instant" });
  });
  await expect(bar(page)).not.toBeInViewport();
  await expect(page.locator(".import-commit-bar .import-commit-button")).toBeInViewport();
  expect(await bar(page).evaluate((element) => getComputedStyle(element).position)).not.toBe("sticky");

  // A blocker still jumps to its control, with nothing sticky over it.
  await page.locator(".import-commit-bar").getByRole("button", { name: "Jump to next" }).click();
  const oneCardSelect = page.getByRole("combobox", { name: `Detected: ${ONE_CARD}` });
  await expect(oneCardSelect).toBeInViewport();
  await expect(oneCardSelect).toBeFocused();
});

test("a CSV's missing columns and its row to check are chips that jump to their controls", async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1280, height: 800 });
  await setUpWrongCardLedger(page);
  // Headers the mapping step cannot guess; one row is near an entry Lady's
  // Card already has (Sabai Sabai on 14 May), so it needs a decision.
  const csvPath = testInfo.outputPath("ladys-export.csv");
  await writeFile(csvPath, [
    "when,what,howmuch,card",
    `2026-05-19,SABAI SABAI VALLEY POINT,-20.49,${LADYS_CARD}`,
    `2026-05-21,KOPI TIAM,-4.20,${LADYS_CARD}`
  ].join("\n"));

  await page.goto("/imports");
  await page.locator("input[type=file]").setInputFiles(csvPath);
  const blockers = page.locator(".import-blockers");
  await expect(blockers.locator(".import-blocker-chip")).toHaveText(["Map the date column", "Map the description column", "Map an amount column"]);
  await blockers.getByRole("button", { name: "Map the date column" }).click();
  const whenSelect = page.locator(".import-column-card").filter({ hasText: "when" }).locator("select");
  await expect(whenSelect).toBeFocused();

  await whenSelect.selectOption("date");
  await page.locator(".import-column-card").filter({ hasText: "what" }).locator("select").selectOption("description");
  await page.locator(".import-column-card").filter({ hasText: "howmuch" }).locator("select").selectOption("amount");
  await page.locator(".import-column-card").filter({ hasText: "card" }).locator("select").selectOption("account");
  await expect(blockers.locator(".import-blocker-chip")).toHaveCount(0);
  await page.getByRole("button", { name: "Preview import" }).click();

  await expect(blockers.locator(".import-blocker-chip")).toHaveText(["1 row to check"], { timeout: 30_000 });
  await expect(page.locator(".import-commit-bar .import-commit-button")).toBeDisabled();
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
  await blockers.getByRole("button", { name: "1 row to check" }).click();
  const reviewRow = page.locator('tr[data-commit-status="needs_review"]');
  await expect(reviewRow.locator("button").first()).toBeFocused();
  await expect(reviewRow).toBeInViewport();

  // Deciding the row clears the last blocker and enables the commit.
  await reviewRow.locator("button").first().click();
  await expect(blockers.locator(".import-blocker-chip")).toHaveCount(0);
  await expect(page.locator(".import-commit-bar")).not.toContainText("things left");
  await expect(page.locator(".import-commit-bar .import-commit-button")).toBeEnabled();
});

test("a statement's row to check opens the row editor at that row", async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1280, height: 800 });
  await setUpWrongCardLedger(page);
  // The statement certifies every row of this fixture, so the server's
  // answer is changed to leave one row for the user to decide.
  await page.route("**/api/imports/preview", async (route) => {
    const response = await route.fetch();
    const json = await response.json();
    const row = json.preview?.previewRows?.find((item) => item.commitStatus === "included" && !item.reconciliationTargetTransactionId);
    if (row) {
      row.commitStatus = "needs_review";
    }
    await route.fulfill({ response, json });
  });
  const pdfPath = testInfo.outputPath("eStatement_UOB_Cards_12May2026.pdf");
  await writeStatementPdf(page, pdfPath);

  await page.goto("/imports");
  await page.locator("input[type=file]").setInputFiles(pdfPath);
  await expect(page.locator(".statement-review")).toBeVisible({ timeout: 30_000 });
  const rowsChip = bar(page).getByRole("button", { name: /rows? to check$/ });
  await expect(rowsChip).toBeVisible();
  // The row editor is closed until the chip opens it.
  await expect(page.locator(".import-preview-table")).toHaveCount(0);
  await rowsChip.click();
  const reviewRow = page.locator('tr[data-commit-status="needs_review"]').first();
  await expect(reviewRow.locator("button").first()).toBeFocused();
  await expectBelowBar(page, reviewRow);
});
