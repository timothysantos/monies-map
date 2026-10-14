// The wrong-card card on Imports: "Move N entries to <Card>" is the primary
// button, "Keep as is" the secondary one, both at least 44 px tall on a phone,
// and moving asks first in an in-app dialog. Uses the sanitized two-card UOB
// statement printed to a PDF, with OpenAI and Buyandship on the wrong card.
import { expect, test } from "@playwright/test";

import { LADYS_CARD, ONE_CARD, setUpWrongCardLedger, writeStatementPdf } from "./uob-wrong-card-statement.js";

const MOVE = `Move 2 entries to ${ONE_CARD}`;

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => window.localStorage.setItem("monies-map:money-totals-visible", "true"));
});

async function openWrongCardReview(page, testInfo) {
  await setUpWrongCardLedger(page);
  const pdfPath = testInfo.outputPath("eStatement_UOB_Cards_12May2026.pdf");
  await writeStatementPdf(page, pdfPath);
  await page.goto("/imports");
  await page.locator("input[type=file]").setInputFiles(pdfPath);
  const card = page.locator(".statement-reconciliation-row").filter({ hasText: `${LADYS_CARD} • May 2026` });
  await expect(card.getByRole("button", { name: MOVE })).toBeVisible({ timeout: 30_000 });
  return card;
}

// Counts the requests the move may send: the preview refresh is the only one.
function watchWrites(page) {
  const writes = [];
  page.on("request", (request) => {
    if (request.method() !== "GET" && request.url().includes("/api/")) {
      writes.push(`${request.method()} ${new URL(request.url()).pathname}`);
    }
  });
  return writes;
}

for (const [name, viewport] of [["phone", { width: 390, height: 844 }], ["desktop", { width: 1280, height: 900 }]]) {
  test(`the move and keep actions are real buttons on ${name}`, async ({ page }, testInfo) => {
    test.setTimeout(120_000);
    await page.setViewportSize(viewport);
    const card = await openWrongCardReview(page, testInfo);
    const move = card.getByRole("button", { name: MOVE });
    const keep = card.getByRole("button", { name: "Keep as is" });

    // Shared classes, not the quiet text-link look.
    await expect(move).toHaveClass(/dialog-primary/);
    await expect(move).not.toHaveClass(/subtle-action/);
    await expect(keep).toHaveClass(/statement-fix-keep/);
    await expect(keep).not.toHaveClass(/subtle-action/);

    const styles = await Promise.all([move, keep].map((button) => button.evaluate((element) => {
      const style = getComputedStyle(element);
      return { background: style.backgroundColor, borderWidth: style.borderTopWidth, radius: style.borderTopLeftRadius };
    })));
    expect(styles[0].background).not.toBe("rgba(0, 0, 0, 0)");
    expect(styles[1].borderWidth).toBe("1px");
    for (const button of [move, keep]) {
      const box = await button.boundingBox();
      expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
    }

    // The standing choice stays, below or beside the buttons, and fits the screen.
    const automatic = card.getByLabel("Do this for me next time when the statement proves it");
    await expect(automatic).toBeVisible();
    // Measured in one pass so a scroll between reads cannot skew the layout.
    const [keepBox, moveBox, autoBox] = await card.evaluate((root) => [".statement-fix-keep", ".statement-fix-apply", ".statement-fix-automatic"].map((selector) => {
      const rect = root.querySelector(selector).getBoundingClientRect();
      return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
    }));
    expect(autoBox?.height ?? 0).toBeGreaterThanOrEqual(44);
    if (name === "phone") {
      expect(autoBox.y).toBeGreaterThanOrEqual(Math.max(keepBox.y + keepBox.height, moveBox.y + moveBox.height) - 1);
      expect(Math.max(moveBox.x + moveBox.width, keepBox.x + keepBox.width)).toBeLessThanOrEqual(viewport.width);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    }
  });
}

test("moving entries asks first: Cancel sends nothing, Confirm moves them once", async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  const card = await openWrongCardReview(page, testInfo);
  const writes = watchWrites(page);
  const move = card.getByRole("button", { name: MOVE });

  // Nothing is sent before Confirm: select the button and read the dialog.
  await move.click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("heading", { name: `Move 2 entries to ${ONE_CARD}?` })).toBeVisible();
  await expect(dialog).toContainText(`These entries are on ${LADYS_CARD} now. Moving them to ${ONE_CARD} changes the totals of both cards.`);
  await expect(dialog).toContainText("Nothing is saved until you commit the import, and Undo on the card takes the move back before then.");
  await expect(dialog.getByLabel("Do this for me next time when the statement proves it")).toHaveCount(0);
  expect(writes).toEqual([]);

  // Cancel changes nothing and returns focus to the Move button.
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(move).toBeFocused();
  expect(writes).toEqual([]);

  // Escape does the same.
  await move.click();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(move).toBeFocused();
  expect(writes).toEqual([]);
  await expect(card.getByText("2 entries will move to UOB One Card when you commit.")).toHaveCount(0);

  // Confirm, tapped twice quickly, moves them exactly once.
  await move.click();
  const confirm = page.getByRole("dialog").getByRole("button", { name: "Move entries" });
  await confirm.dblclick({ noWaitAfter: true }).catch(() => undefined);
  await expect(card.getByText("2 entries will move to UOB One Card when you commit.")).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(writes.filter((write) => write.includes("/api/imports/"))).toHaveLength(1);
});
