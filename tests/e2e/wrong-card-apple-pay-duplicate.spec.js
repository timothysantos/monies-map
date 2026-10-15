// Wrong-card Apple Pay duplicates on Imports (src/client/wrong-card-
// duplicates.jsx). Three Apple Pay entries sit on UOB Lady's Card, but the
// purchases were paid with UOB One Card, whose activity file already holds the
// same three bank rows. Importing the Lady's Card file shows a card per
// group with the proof; "Remove from UOB Lady's Card" asks first in an in-app
// dialog; the commit removes exactly those entries; rolling the import back
// brings them back. A purchase the file lists, a doubtful match and an entry
// linked to a split never get a removal. Desktop and a 390 px phone.
// The docs screenshots (docs/audits/wrong-card-apple-pay/) are written when
// WRONG_CARD_SHOT_DIR is set.
import { expect, test } from "@playwright/test";

import { openRecentImports, postJson } from "./helpers.js";
import {
  APPLE_PAY_ENTRIES,
  LADYS_CARD,
  LADYS_ROWS,
  ONE_CARD,
  ONE_CARD_ROWS,
  accountBalanceMinor,
  expenseTotalMinor,
  importFileThroughApi,
  ladysCardEntries,
  saveApplePayEntry,
  setUpWrongCardApplePay,
  uploadAndPreview,
  writeCsv
} from "./wrong-card-apple-pay.js";

const SHOT_DIR = process.env.WRONG_CARD_SHOT_DIR;
const REMOVE = `Remove from ${LADYS_CARD}`;
const TITLE = `3 Apple Pay entries on ${LADYS_CARD} look like purchases paid with another card`;
const VIEWPORTS = [["desktop", { width: 1280, height: 900 }], ["phone", { width: 390, height: 844 }]];

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => window.localStorage.setItem("monies-map:money-totals-visible", "true"));
});

async function openLadysFile(page, testInfo, { viewport, entries } = {}) {
  if (viewport) {
    await page.setViewportSize(viewport);
  }
  const setUp = await setUpWrongCardApplePay(page, { entries });
  const csvPath = testInfo.outputPath("CC_TXN_History_13Oct2026-ladys.csv");
  await writeCsv(csvPath, LADYS_ROWS);
  await uploadAndPreview(page, csvPath);
  return { ...setUp, csvPath };
}

// The writes the page may send from here on (the preview refresh is not one
// of them: only the commit and rollback change data).
function watchWrites(page) {
  const writes = [];
  page.on("request", (request) => {
    if (request.method() !== "GET" && request.url().includes("/api/")) {
      writes.push(`${request.method()} ${new URL(request.url()).pathname}`);
    }
  });
  return writes;
}

const wrongCardCard = (page) => page.locator(".wrong-card-card").filter({ hasText: TITLE });

for (const [name, viewport] of VIEWPORTS) {
  test(`importing the Lady's Card file shows the proof and a real Remove button on ${name}`, async ({ page }, testInfo) => {
    test.setTimeout(180_000);
    await openLadysFile(page, testInfo, { viewport });
    const card = wrongCardCard(page);
    await expect(card).toBeVisible({ timeout: 60_000 });

    // The detail says what happens to the money, the rows carry the proof.
    await expect(card).toContainText(`This file doesn't list them for ${LADYS_CARD}, but ${ONE_CARD} does, so the purchases show up twice.`);
    await expect(card).toContainText(`Removing them takes $19.34 off ${LADYS_CARD} and leaves ${ONE_CARD} as it is.`);
    const cold = card.locator(".statement-fix-row", { hasText: /^Cold Storage-Star Vist/ });
    await expect(cold).toContainText("$1.80");
    await expect(cold).toContainText(`${ONE_CARD} has COLD STORAGE-STAR VISTA SINGAPORE SG on 11 Oct 2026 (imported `);
    await expect(card.locator(".statement-fix-row")).toHaveCount(3);
    await expect(card.locator(".statement-fix-row", { hasText: /^CS Fresh/ })).toContainText("$9.70");
    await expect(card.locator(".statement-fix-row", { hasText: /^FairPrice finest/ })).toContainText("$7.84");

    const remove = card.getByRole("button", { name: REMOVE });
    const keep = card.getByRole("button", { name: "Keep as is" });
    await expect(remove).toHaveClass(/dialog-primary/);
    await expect(keep).toHaveClass(/statement-fix-keep/);
    for (const button of [remove, keep]) {
      expect((await button.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
    }
    // The standing "do this for me" choice is not offered for this feature.
    await expect(card.getByText(/Do this for me next time/)).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    if (SHOT_DIR) {
      await card.scrollIntoViewIfNeeded();
      await card.screenshot({ path: `${SHOT_DIR}/${name}-card.png` });
      await page.screenshot({ path: `${SHOT_DIR}/${name}-review-after.png`, fullPage: false });
    }
  });
}

test("Keep as is leaves everything alone and sends nothing", async ({ page }, testInfo) => {
  test.setTimeout(180_000);
  await openLadysFile(page, testInfo);
  const card = wrongCardCard(page);
  await expect(card).toBeVisible({ timeout: 60_000 });
  const writes = watchWrites(page);

  await card.getByRole("button", { name: "Keep as is" }).click();

  await expect(card).toHaveCount(0);
  await expect(page.getByText(/entries? will be removed/)).toHaveCount(0);
  expect(writes).toEqual([]);
});

test("Remove asks first: Cancel and Escape send nothing, Confirm marks them, the commit removes exactly those three, and the rollback restores them", async ({ page }, testInfo) => {
  test.setTimeout(240_000);
  const { entryIds } = await openLadysFile(page, testInfo);
  const card = wrongCardCard(page);
  await expect(card).toBeVisible({ timeout: 60_000 });
  const writes = watchWrites(page);
  const remove = card.getByRole("button", { name: REMOVE });

  // Select the button and read the dialog: nothing is sent.
  await remove.click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("heading", { name: `Remove 3 entries from ${LADYS_CARD}?` })).toBeVisible();
  await expect(dialog).toContainText(`These purchases are on ${ONE_CARD} already. Removing them takes $19.34 off ${LADYS_CARD} and leaves ${ONE_CARD} as it is.`);
  await expect(dialog).toContainText("Nothing is saved until you commit the import, Undo on the card takes the removal back before then, and rolling the import back brings them back.");
  expect(writes).toEqual([]);
  if (SHOT_DIR) {
    await page.screenshot({ path: `${SHOT_DIR}/desktop-dialog.png` });
  }

  // Cancel changes nothing and returns focus to the button; so does Escape.
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(remove).toBeFocused();
  await remove.click();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(writes).toEqual([]);
  await expect(page.getByText(`3 entries will be removed from ${LADYS_CARD} when you commit.`)).toHaveCount(0);

  // Confirm marks the three for removal; the commit bar counts them; Undo takes it back.
  await remove.click();
  await page.getByRole("dialog").getByRole("button", { name: "Remove entries" }).click();
  await expect(page.getByText(`3 entries will be removed from ${LADYS_CARD} when you commit.`)).toBeVisible();
  await expect(page.locator(".import-commit-bar-summary")).toContainText("3 entries will be removed");
  expect(writes).toEqual([]);
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(page.locator(".import-commit-bar-summary")).not.toContainText("will be removed");
  await remove.click();
  await page.getByRole("dialog").getByRole("button", { name: "Remove entries" }).click();
  await expect(page.locator(".import-commit-bar-summary")).toContainText("3 entries will be removed");
  if (SHOT_DIR) {
    await page.screenshot({ path: `${SHOT_DIR}/desktop-confirmed.png` });
  }

  const balanceBefore = await accountBalanceMinor(page, LADYS_CARD);
  await page.getByRole("button", { name: "Commit import to ledger" }).first().click();
  await expect(page.locator(".import-file-card")).toHaveCount(0, { timeout: 60_000 });
  expect(writes.filter((write) => write.endsWith("/api/imports/commit"))).toHaveLength(1);

  // Exactly the three Apple Pay entries are gone; the file's own rows are in.
  const after = await ladysCardEntries(page);
  for (const id of entryIds) {
    expect(after.some((entry) => entry.id === id)).toBe(false);
  }
  expect(after.some((entry) => entry.addedBy === "apple_pay_shortcut")).toBe(false);
  // Balances now match the card's own file: the three purchases are on One Card only.
  const ladysFileTotal = expenseTotalMinor(LADYS_ROWS);
  expect(await accountBalanceMinor(page, LADYS_CARD)).toBe(-ladysFileTotal);
  // Before the commit the card held only the three stray entries.
  expect(balanceBefore).toBe(-1934);
  expect(await accountBalanceMinor(page, ONE_CARD)).toBe(-expenseTotalMinor(ONE_CARD_ROWS));

  // Rolling the import back from Recent imports brings all three back.
  await page.goto("/imports");
  await openRecentImports(page);
  const importCard = page.locator(".import-card").filter({ hasText: "13Oct2026-ladys" });
  await expect(importCard).toBeVisible({ timeout: 60_000 });
  await importCard.getByRole("button", { name: "Rollback import" }).click();
  const rolledBack = page.waitForResponse((response) => response.url().includes("/api/imports/rollback") && response.ok());
  await page.getByRole("button", { name: "Confirm rollback" }).click();
  await rolledBack;
  const restored = await ladysCardEntries(page);
  for (const id of entryIds) {
    expect(restored.some((entry) => entry.id === id)).toBe(true);
  }
  expect(await accountBalanceMinor(page, LADYS_CARD)).toBe(-1934);
});

test("the other order: the One Card file imported second flags the entries on the Lady's Card", async ({ page }, testInfo) => {
  test.setTimeout(240_000);
  await setUpWrongCardApplePay(page, { importOneCardFile: false });
  await importFileThroughApi(page, LADYS_ROWS, "CC_TXN_History_13Oct2026-ladys");
  const csvPath = testInfo.outputPath("CC_TXN_History_14Oct2026-onecard.csv");
  await writeCsv(csvPath, ONE_CARD_ROWS);
  await uploadAndPreview(page, csvPath);

  const card = wrongCardCard(page);
  await expect(card).toBeVisible({ timeout: 60_000 });
  await expect(card).toContainText(`The file you imported for ${LADYS_CARD} on `);
  await expect(card).toContainText(`${ONE_CARD} has COLD STORAGE-STAR VISTA SINGAPORE SG on 11 Oct 2026 in this file.`);
  await card.getByRole("button", { name: REMOVE }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Remove entries" }).click();
  await page.getByRole("button", { name: "Commit import to ledger" }).first().click();
  await expect(page.locator(".import-file-card")).toHaveCount(0, { timeout: 60_000 });
  expect((await ladysCardEntries(page)).some((entry) => entry.addedBy === "apple_pay_shortcut")).toBe(false);
  expect(await accountBalanceMinor(page, LADYS_CARD)).toBe(-expenseTotalMinor(LADYS_ROWS));
});

test("no card for a purchase the file lists: a legitimately pending Apple Pay entry pairs with its row", async ({ page }, testInfo) => {
  test.setTimeout(180_000);
  await openLadysFile(page, testInfo, { entries: [...APPLE_PAY_ENTRIES, { description: "Sabai Sabai - Valley P", amount: "20.49", date: "2026-10-08" }] });
  // The three stray entries are still flagged, the pending one is not among them.
  const card = wrongCardCard(page);
  await expect(card).toBeVisible({ timeout: 60_000 });
  await expect(card.locator(".statement-fix-row")).toHaveCount(3);
  await expect(card).not.toContainText("Sabai Sabai");
  await expect(page.locator(".wrong-card-notes")).toHaveCount(0);
});

test("a doubtful match is only a note: no Remove button and no dialog", async ({ page }, testInfo) => {
  test.setTimeout(180_000);
  // Three days between the Apple Pay entry and the One Card row: not sure enough to offer.
  await openLadysFile(page, testInfo, { entries: [{ description: "Cold Storage-Star Vist", amount: "1.80", date: "2026-10-08" }] });
  const notes = page.locator(".wrong-card-notes");
  await expect(notes).toBeVisible({ timeout: 60_000 });
  await expect(notes).toContainText(`Cold Storage-Star Vist $1.80 on ${LADYS_CARD} may be the same purchase as COLD STORAGE-STAR VISTA SINGAPORE SG on ${ONE_CARD} (11 Oct 2026). We aren't sure enough to offer removing it.`);
  await expect(page.getByRole("button", { name: REMOVE })).toHaveCount(0);
  await expect(page.locator(".wrong-card-card")).toHaveCount(0);
});

test("an entry linked to a split is a note too, and says why it stays", async ({ page }, testInfo) => {
  test.setTimeout(180_000);
  const { entryIds } = await setUpWrongCardApplePay(page, { entries: [APPLE_PAY_ENTRIES[0]] });
  await postJson(page, "/api/splits/expenses/from-entry", { entryId: entryIds[0], splitGroupId: null });
  const csvPath = testInfo.outputPath("CC_TXN_History_13Oct2026-ladys.csv");
  await writeCsv(csvPath, LADYS_ROWS);
  await uploadAndPreview(page, csvPath);

  const notes = page.locator(".wrong-card-notes");
  await expect(notes).toBeVisible({ timeout: 60_000 });
  await expect(notes).toContainText("It is linked to a split or a plan, so it stays until you unlink it.");
  await expect(page.getByRole("button", { name: REMOVE })).toHaveCount(0);
  // Still there after the commit.
  await page.getByRole("button", { name: "Commit import to ledger" }).first().click();
  await expect(page.locator(".import-file-card")).toHaveCount(0, { timeout: 60_000 });
  expect((await ladysCardEntries(page)).some((entry) => entry.id === entryIds[0])).toBe(true);
});

test("an Apple Pay entry saved without the Shortcut's marker is never offered", async ({ page }, testInfo) => {
  test.setTimeout(180_000);
  await setUpWrongCardApplePay(page, { entries: [] });
  // A manual entry with the same words and amount, no Apple Pay marker.
  await postJson(page, "/api/entries/create", {
    accountName: LADYS_CARD, categoryName: "Groceries", entryType: "expense", ownershipType: "direct", ownerName: "Tim",
    date: "2026-10-11", description: "Cold Storage-Star Vist", amountMinor: 180
  });
  await saveApplePayEntry(page, { description: "Unrelated Shop", amount: "55.55", date: "2026-10-11" });
  const csvPath = testInfo.outputPath("CC_TXN_History_13Oct2026-ladys.csv");
  await writeCsv(csvPath, LADYS_ROWS);
  await uploadAndPreview(page, csvPath);
  await expect(page.locator(".import-file-card")).toBeVisible({ timeout: 60_000 });
  await expect(page.locator(".wrong-card-card")).toHaveCount(0);
  await expect(page.locator(".wrong-card-notes")).toHaveCount(0);
});
