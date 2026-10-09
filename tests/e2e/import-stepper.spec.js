// The Imports page's sticky import bar: the three steps, one chip per file
// of this session's batch, and what still blocks a clean commit of the file
// in review, each chip a jump to the control that fixes it. Uses the
// sanitized two-card UOB statement printed to a real PDF
// (tests/fixtures/pdf-statement-text/uob-card-two-card-may-2026-sanitized).
import { expect, test } from "@playwright/test";
import { writeFile } from "node:fs/promises";

import { openPasteRowsAndDefaults, postJson, reseedDemo } from "./helpers.js";
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
// What the bar shows: stuck, it is shorter than the space it keeps in the page.
const barSurface = (page) => bar(page).locator(".import-batch-bar-surface");

// The target sits fully below the sticky bar, inside the window.
async function expectBelowBar(page, locator) {
  await expect(locator).toBeInViewport();
  await expect.poll(async () => {
    const barBox = await barSurface(page).boundingBox();
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
  // One chip per file, in review order: the statement first, all waiting.
  await expect(chips).toHaveText(["UOB cards May · waiting", "one-card-activity.csv · waiting", "ladys-card-activity.csv · waiting"]);
  await expect(bar(page)).toContainText("File 1 of 3");

  // A waiting chip opens its file like the queue's Review button.
  await chips.filter({ hasText: "UOB cards May" }).click();
  await expect(page.locator(".statement-review")).toBeVisible({ timeout: 30_000 });
  await expect(chips.filter({ hasText: "UOB cards May" })).toHaveAttribute("aria-current", "step");
  await expect(chips.filter({ hasText: "one-card-activity.csv" })).not.toHaveAttribute("aria-current", "step");

  const blockers = bar(page).locator(".import-blockers");
  await expect(blockers).toContainText("Before you can commit:");
  await expect(blockers.locator(".import-blocker-chip")).toHaveText([
    // The unmapped One Card is named once, by "Map 1 account".
    "Map 1 account",
    `${LADYS_CARD} off by $42.62`
  ]);
  const commitBar = page.locator(".import-commit-bar");
  await expect(commitBar).toContainText("2 things left");

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
  await expect(page.locator(".import-blockers-live")).not.toContainText("2 things left");

  // Commit anyway: the statement is done and the next file opens.
  await commitBar.locator(".import-commit-button").click();
  await page.getByRole("button", { name: "Commit anyway" }).click();
  await expect(page.locator(".import-done-card")).toBeVisible({ timeout: 30_000 });
  await expect(chips).toHaveText(["UOB cards May", "one-card-activity.csv · reviewing", "ladys-card-activity.csv · waiting"]);
  await expect(chips.first()).toHaveClass(/is-done/);
  await expect(bar(page)).toContainText("File 2 of 3");
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
  await expect(page.locator(".import-commit-bar")).toContainText("2 things left");

  // Halfway down the review.
  await page.evaluate(() => {
    const review = document.querySelector(".statement-review").getBoundingClientRect();
    window.scrollTo({ top: window.scrollY + review.top + review.height / 2 - window.innerHeight / 2, behavior: "instant" });
  });
  await expect(bar(page)).not.toBeInViewport();
  await expect(page.locator(".import-commit-bar .import-commit-button")).toBeInViewport();
  expect(await bar(page).evaluate((element) => getComputedStyle(element).position)).not.toBe("sticky");
  await expect(bar(page)).not.toHaveClass(/is-stuck/);

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

test("J and K move between the blockers in order, and are left alone while typing", async ({ page }, testInfo) => {
  test.setTimeout(150_000);
  await page.setViewportSize({ width: 1280, height: 800 });
  await setUpUnmappedLedger(page);
  const files = await writeFiles(page, testInfo);

  await page.goto("/imports");
  await page.locator("input[type=file]").setInputFiles(files);
  await bar(page).locator(".import-file-chip").filter({ hasText: "UOB cards May" }).click();
  await expect(page.locator(".statement-review")).toBeVisible({ timeout: 30_000 });
  const commitBar = page.locator(".import-commit-bar");
  await expect(commitBar).toContainText("2 things left");
  // The shortcuts are named on the jump link only; desktop has no sheet.
  await expect(commitBar.getByRole("button", { name: "Jump to next" })).toHaveAttribute("title", "Next: J · Previous: K");
  await expect(commitBar.getByRole("button", { name: "2 things left" })).toHaveCount(0);

  const oneCardSelect = page.getByRole("combobox", { name: `Detected: ${ONE_CARD}` });
  const oneCard = page.locator(".statement-card").filter({ hasText: `${ONE_CARD} • May 2026` });
  const ladysCard = page.locator(".statement-card").filter({ hasText: `${LADYS_CARD} • May 2026` });
  const selected = await oneCardSelect.inputValue();

  await page.keyboard.press("j");
  await expect(oneCardSelect).toBeFocused();
  await expectBelowBar(page, oneCardSelect);
  // J again leaves the select it jumped to without choosing an option. The
  // unmapped One Card has no card blocker of its own.
  await page.keyboard.press("j");
  await expect(ladysCard).toBeFocused();
  expect(await oneCardSelect.inputValue()).toBe(selected);
  await expectBelowBar(page, ladysCard);
  await expect(oneCard).not.toBeFocused();
  // Past the last one it wraps to the first; K goes back.
  await page.keyboard.press("j");
  await expect(oneCardSelect).toBeFocused();
  await page.keyboard.press("k");
  await expect(ladysCard).toBeFocused();
  await page.keyboard.press("k");
  await expect(oneCardSelect).toBeFocused();
  // With a modifier held it is not a jump.
  await page.keyboard.press("Control+j");
  await expect(oneCardSelect).toBeFocused();

  // In a text field J is a letter.
  await bar(page).getByRole("button", { name: "Change" }).click();
  await openPasteRowsAndDefaults(page);
  const sourceLabel = page.getByLabel("Source label");
  await sourceLabel.fill("May statement");
  await page.keyboard.press("j");
  await expect(sourceLabel).toBeFocused();
  await expect(sourceLabel).toHaveValue(/j$/);
});

test("on a phone things left opens a sheet of the files and blockers", async ({ page }, testInfo) => {
  test.setTimeout(150_000);
  await page.setViewportSize({ width: 390, height: 844 });
  await setUpUnmappedLedger(page);
  const files = await writeFiles(page, testInfo);

  await page.goto("/imports");
  await page.locator("input[type=file]").setInputFiles(files);
  await bar(page).locator(".import-file-chip").filter({ hasText: "UOB cards May" }).click();
  await expect(page.locator(".statement-review")).toBeVisible({ timeout: 30_000 });

  const trigger = page.locator(".import-commit-bar").getByRole("button", { name: "2 things left" });
  const sheet = page.getByRole("dialog", { name: "Import progress" });
  const focusIsInside = () => sheet.evaluate((element) => element.contains(document.activeElement));

  await trigger.click();
  await expect(sheet).toBeVisible();
  await expect.poll(focusIsInside).toBe(true);
  // The same file chips and blockers as the desktop bar.
  const sheetChips = sheet.locator(".import-file-chip");
  await expect(sheetChips).toHaveText(["UOB cards May · reviewing", "one-card-activity.csv · waiting", "ladys-card-activity.csv · waiting"]);
  await expect(sheetChips.first()).toHaveAttribute("aria-current", "step");
  await expect(sheet.locator(".import-blocker-chip")).toHaveText([
    // The unmapped One Card is named once, by "Map 1 account".
    "Map 1 account",
    `${LADYS_CARD} off by $42.62`
  ]);
  await page.keyboard.press("Escape");
  await expect(sheet).toHaveCount(0);
  await expect(trigger).toBeFocused();

  // A tap on the backdrop closes it too.
  await trigger.click();
  await expect(sheet).toBeVisible();
  await page.mouse.click(195, 40);
  await expect(sheet).toHaveCount(0);
  await expect(trigger).toBeFocused();

  // A blocker closes the sheet and goes to its control.
  await trigger.click();
  await sheet.getByRole("button", { name: "Map 1 account" }).click();
  await expect(sheet).toHaveCount(0);
  const oneCardSelect = page.getByRole("combobox", { name: `Detected: ${ONE_CARD}` });
  await expect(oneCardSelect).toBeFocused();
  await expect(oneCardSelect).toBeInViewport();

  // A waiting file opens from the sheet, with nothing changed to ask about.
  await trigger.click();
  await sheet.locator(".import-file-chip").filter({ hasText: "one-card-activity.csv" }).click();
  await expect(sheet).toHaveCount(0);
  await expect(bar(page).locator(".import-file-chip").filter({ hasText: "one-card-activity.csv" })).toHaveAttribute("aria-current", "step");
});

// Every part of the statement header and the commit bar sits inside the
// review card's padding and the window: nothing is cut off on the right.
async function overflowingParts(page) {
  return page.evaluate(() => {
    const card = document.querySelector("[data-import-target='preview-rows']");
    const cardBox = card.getBoundingClientRect();
    const style = getComputedStyle(card);
    const left = cardBox.left + parseFloat(style.paddingLeft) - 0.5;
    const right = cardBox.right - parseFloat(style.paddingRight) + 0.5;
    const width = document.documentElement.clientWidth;
    const parts = [...document.querySelectorAll(".statement-review-head, .statement-review-head *, .import-commit-bar, .import-commit-bar *")];
    const out = parts
      .map((element) => ({ element, box: element.getBoundingClientRect() }))
      .filter(({ box }) => box.width > 0 && (box.left < left || box.right > right || box.right > width))
      .map(({ element, box }) => `${element.className || element.tagName} ${Math.round(box.left)}..${Math.round(box.right)}`);
    if (cardBox.right > width + 0.5 || cardBox.left < -0.5) out.push(`card ${Math.round(cardBox.left)}..${Math.round(cardBox.right)}`);
    if (document.documentElement.scrollWidth > width) out.push(`page ${document.documentElement.scrollWidth}`);
    return out;
  });
}

test("on a phone the statement header and the commit bar wrap inside the review card", async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 390, height: 844 });
  await setUpUnmappedLedger(page);
  const files = await writeFiles(page, testInfo);

  await page.goto("/imports");
  await page.locator("input[type=file]").setInputFiles(files);
  await bar(page).locator(".import-file-chip").filter({ hasText: "UOB cards May" }).click();
  await expect(page.locator(".statement-review")).toBeVisible({ timeout: 30_000 });
  await expect(page.locator(".import-commit-bar")).toContainText("Skip for now");
  await expect.poll(() => overflowingParts(page)).toEqual([]);
  // Wrapped, not squeezed: the commit button keeps its words on one line.
  const button = page.locator(".import-commit-bar .import-commit-button");
  const lines = await button.evaluate((element) => {
    const range = document.createRange();
    range.selectNodeContents(element);
    return new Set([...range.getClientRects()].map((box) => Math.round(box.bottom))).size;
  });
  expect(lines).toBe(1);
  await expect(button).toHaveText("Commit and open next");
});

test("stuck to the top, the import bar spans the window, casts a shadow and folds its steps to one line", async ({ page }, testInfo) => {
  test.setTimeout(150_000);
  await page.setViewportSize({ width: 1280, height: 800 });
  await setUpUnmappedLedger(page);
  const files = await writeFiles(page, testInfo);

  await page.goto("/imports");
  await page.locator("input[type=file]").setInputFiles(files);
  await bar(page).locator(".import-file-chip").filter({ hasText: "UOB cards May" }).click();
  await expect(page.locator(".statement-review")).toBeVisible({ timeout: 30_000 });

  const nav = bar(page);
  const surface = barSurface(page);
  const summary = nav.locator(".import-stepper-summary").first();
  // What sits at the window's edges, level with the bar.
  const edgeHits = () => surface.evaluate((element) => {
    const box = element.getBoundingClientRect();
    const y = box.top + box.height / 2;
    const width = document.documentElement.clientWidth;
    return [2, width - 2].map((x) => Boolean(document.elementFromPoint(x, y)?.closest(".import-batch-bar")));
  });
  const flowTop = () => page.locator(".statement-review").evaluate((element) => Math.round(element.getBoundingClientRect().top + window.scrollY));

  // At the top of the page the bar is in its place, as wide as the panel.
  await expect(nav).not.toHaveClass(/is-stuck/);
  await expect(summary).toBeVisible();
  expect((await surface.boundingBox()).height).toBeGreaterThan(150);
  expect(await edgeHits()).toEqual([false, false]);
  const reviewTop = await flowTop();

  // Scrolled into the review it sticks: edge to edge, shadowed, one line of
  // steps, and short.
  await page.evaluate(() => window.scrollTo({ top: 900, behavior: "instant" }));
  await expect(nav).toHaveClass(/is-stuck/);
  await expect(summary).toBeHidden();
  await expect.poll(async () => (await surface.boundingBox()).height).toBeLessThanOrEqual(120);
  await expect.poll(edgeHits).toEqual([true, true]);
  await expect.poll(() => surface.evaluate((element) => getComputedStyle(element, "::after").opacity)).toBe("1");
  expect(await surface.evaluate((element) => getComputedStyle(element, "::after").boxShadow)).not.toBe("none");
  // A solid background: no text shows through it.
  expect(await surface.evaluate((element) => getComputedStyle(element, "::before").backgroundColor)).toMatch(/^rgb\(/);
  // Sticking moves nothing in the page and adds no sideways scroll.
  expect(await flowTop()).toBe(reviewTop);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  // The step in review still reads as current.
  await expect(nav.locator(".import-stepper-step.is-current .import-stepper-label")).toHaveText("2 · Review");

  // A jump lands just below the stuck bar.
  const ladysCard = page.locator(".statement-card").filter({ hasText: `${LADYS_CARD} • May 2026` });
  await nav.getByRole("button", { name: `${LADYS_CARD} off by $42.62` }).click();
  await expect(ladysCard).toBeFocused();
  await expect.poll(async () => {
    const barBox = await surface.boundingBox();
    const box = await ladysCard.boundingBox();
    return box.y - (barBox.y + barBox.height);
  }).toBeGreaterThanOrEqual(-1);
  await expect.poll(async () => {
    const barBox = await surface.boundingBox();
    const box = await ladysCard.boundingBox();
    return box.y - (barBox.y + barBox.height);
  }).toBeLessThan(40);

  // Back at the top it lets go.
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
  await expect(nav).not.toHaveClass(/is-stuck/);
  await expect(summary).toBeVisible();
  await expect.poll(edgeHits).toEqual([false, false]);
});

test("the stuck bar changes without animation when reduced motion is asked for", async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width: 1280, height: 800 });
  await setUpUnmappedLedger(page);
  const files = await writeFiles(page, testInfo);

  await page.goto("/imports");
  await page.locator("input[type=file]").setInputFiles(files);
  await bar(page).locator(".import-file-chip").filter({ hasText: "UOB cards May" }).click();
  await expect(page.locator(".statement-review")).toBeVisible({ timeout: 30_000 });
  await page.evaluate(() => window.scrollTo({ top: 900, behavior: "instant" }));
  await expect(bar(page)).toHaveClass(/is-stuck/);
  const durations = await barSurface(page).evaluate((element) => [
    getComputedStyle(element, "::before").transitionDuration,
    getComputedStyle(element, "::after").transitionDuration,
    getComputedStyle(element.querySelector(".import-stepper-summary")).transitionDuration,
    getComputedStyle(element.querySelector(".import-stepper-step")).transitionDuration
  ]);
  for (const duration of durations) {
    expect(duration.split(",").every((value) => parseFloat(value) === 0)).toBe(true);
  }
});

test("at 1280 px the commit bar with Skip for now stays on one line", async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1280, height: 800 });
  await setUpUnmappedLedger(page);
  const files = await writeFiles(page, testInfo);

  await page.goto("/imports");
  await page.locator("input[type=file]").setInputFiles(files);
  await bar(page).locator(".import-file-chip").filter({ hasText: "UOB cards May" }).click();
  const commitBar = page.locator(".import-commit-bar");
  await expect(commitBar).toContainText("Skip for now", { timeout: 30_000 });
  await expect(commitBar.locator(".import-commit-button")).toHaveText("Commit and open next");
  // One row: the summary, the count and jump, Start over, Skip for now and
  // the commit button side by side, no taller than the button needs.
  const layout = await commitBar.evaluate((element) => {
    const parts = [...element.children, ...element.querySelector(".import-commit-bar-actions").children].map((child) => child.getBoundingClientRect());
    const button = element.querySelector(".import-commit-button").getBoundingClientRect();
    return {
      spread: Math.max(...parts.map((box) => box.top + box.height / 2)) - Math.min(...parts.map((box) => box.top + box.height / 2)),
      extraHeight: element.getBoundingClientRect().height - button.height
    };
  });
  expect(layout.spread).toBeLessThan(4);
  expect(layout.extraHeight).toBeLessThanOrEqual(32);
});

// What a chip and a step look like in each state: done is a mint surface
// with a tick, the one in review an outline with a file icon and bold text,
// a waiting one a neutral outline with a clock.
async function stateLook(locator) {
  return locator.evaluate((element) => {
    const style = getComputedStyle(element);
    const root = getComputedStyle(document.documentElement);
    const rgb = (value) => {
      const probe = document.createElement("span");
      probe.style.color = value;
      document.body.append(probe);
      const color = getComputedStyle(probe).color;
      probe.remove();
      return color;
    };
    return {
      background: style.backgroundColor === rgb(root.getPropertyValue("--pastel-mint")) ? "mint" : style.backgroundColor,
      ink: style.color === rgb(root.getPropertyValue("--pastel-mint-ink")) ? "mint-ink" : style.color === rgb(root.getPropertyValue("--muted")) ? "muted" : style.color,
      weight: Number(style.fontWeight),
      icon: element.querySelector("svg")?.getAttribute("class")?.match(/lucide-([a-z-]+)/)?.[1] ?? null
    };
  });
}

test("done steps and done files read as done; the file in review and the waiting files each look different", async ({ page }, testInfo) => {
  test.setTimeout(150_000);
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.addInitScript(() => window.localStorage.setItem("monies-map:money-totals-visible", "true"));
  await setUpUnmappedLedger(page);
  const files = await writeFiles(page, testInfo);

  await page.goto("/imports");
  await page.locator("input[type=file]").setInputFiles(files);
  // The row says what the chips are.
  const strip = bar(page).locator(".import-file-strip");
  await expect(strip.locator(".import-blockers-title")).toHaveText("Your files:");
  await expect(strip.getByRole("list", { name: "Your files:" })).toBeVisible();

  await bar(page).locator(".import-file-chip").filter({ hasText: "UOB cards May" }).click();
  await expect(page.locator(".statement-review")).toBeVisible({ timeout: 30_000 });
  const chips = bar(page).locator(".import-file-chip");
  const reviewing = chips.filter({ hasText: "UOB cards May" });
  const waiting = chips.filter({ hasText: "one-card-activity.csv" });
  await expect(reviewing).toHaveText("UOB cards May · reviewing");
  await expect(reviewing).toHaveAttribute("title", "eStatement_UOB_Cards_12May2026.pdf");
  await expect(waiting).toHaveText("one-card-activity.csv · waiting");
  const reviewingLook = await stateLook(reviewing);
  expect(reviewingLook.icon).toBe("file-text");
  expect(reviewingLook.weight).toBeGreaterThanOrEqual(700);
  expect(reviewingLook.background).not.toBe("mint");
  const waitingLook = await stateLook(waiting);
  expect(waitingLook).toMatchObject({ icon: "clock", ink: "muted" });
  expect(waitingLook.weight).toBeLessThan(700);

  // The finished Bring files step: mint, mint ink and a tick; the current
  // step keeps its outline and the next one stays plain.
  const steps = bar(page).locator(".import-stepper-step");
  const doneStep = await stateLook(steps.nth(0));
  expect(doneStep).toMatchObject({ background: "mint", ink: "mint-ink", icon: "check" });
  expect(await stateLook(steps.nth(1))).toMatchObject({ icon: null });
  expect((await stateLook(steps.nth(1))).background).not.toBe("mint");
  expect((await stateLook(steps.nth(2))).background).not.toBe("mint");
  await expect(steps.nth(0).locator(".import-stepper-label")).toHaveText("1 · Bring files · done");
  // Pinned, the done step keeps its look.
  await page.evaluate(() => window.scrollTo({ top: 900, behavior: "instant" }));
  await expect(bar(page)).toHaveClass(/is-stuck/);
  expect(await stateLook(steps.nth(0))).toMatchObject({ background: "mint", ink: "mint-ink", icon: "check" });

  // Commit anyway: the statement's chip turns mint with a tick, like the step.
  await page.getByRole("combobox", { name: `Detected: ${ONE_CARD}` }).selectOption({ label: "My One Card - Tim" });
  await page.locator(".import-commit-bar .import-commit-button").click();
  await page.getByRole("button", { name: "Commit anyway" }).click();
  await expect(chips.first()).toHaveClass(/is-done/, { timeout: 30_000 });
  expect(await stateLook(chips.first())).toMatchObject({ background: "mint", ink: "mint-ink", icon: "check" });
  await expect(chips.first()).toHaveText("UOB cards May");
});
