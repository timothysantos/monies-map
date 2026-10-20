import { expect, test } from "@playwright/test";

import { gotoPageAfterApi, loadSplitsPage, postJson, reseedDemo } from "./helpers";

// The Splits activity list shows only what is still open. The records a
// settle-up covered (a settlement checkpoint that is not reopened or voided)
// wait in one collapsed section per settlement at the end of the list:
// "Settled up on 20 May · 4 entries · $1,000.00". Expanding it shows the rows,
// read-only as before; a search opens it; hidden money hides its total; the
// Archived batches sheet lists it beside the settled batches.

const month = "2026-05";
const PHONE = { width: 390, height: 844 };
const HEADING = /^Settled up on 20 May( 2026)? · 4 entries · \$1,000\.00$/;

async function createExpense(page, groupId, description, date, amountMinor) {
  return postJson(page, "/api/splits/expenses/create", {
    groupId,
    date,
    description,
    categoryName: "Food & Drinks",
    payerPersonName: "Tim",
    amountMinor,
    splitAmountMinor: amountMinor / 2,
    currency: "SGD",
    paymentMethod: "cash",
    paymentStatus: "recorded"
  });
}

// A group like the real one: four older expenses ($1,000.00) covered by a
// bank-matched settlement on 20 May, then two newer open ones.
async function createSettledGroup(page, stamp, { match = true } = {}) {
  const group = await postJson(page, "/api/splits/groups/create", { name: `Okaeri ${stamp}`, currency: "SGD", expenseSource: "mixed" });
  const older = [
    [`Old rent ${stamp}`, `${month}-02`, 10_000],
    [`Old flights ${stamp}`, `${month}-03`, 20_000],
    [`Old hotel ${stamp}`, `${month}-04`, 30_000],
    [`Old tour ${stamp}`, `${month}-05`, 40_000]
  ];
  for (const [description, date, amountMinor] of older) {
    await createExpense(page, group.groupId, description, date, amountMinor);
  }
  const checkpoint = await postJson(page, "/api/splits/checkpoints/create", { viewerPersonId: "person-tim", date: `${month}-20`, currency: "SGD" });
  if (match && checkpoint.status === "open") {
    const transfer = await postJson(page, "/api/entries/create", {
      date: `${month}-21`,
      description: `Settle-up transfer ${stamp}`,
      accountName: "UOB One",
      categoryName: "Transfer",
      amountMinor: checkpoint.amountMinor,
      entryType: "transfer",
      transferDirection: "in",
      ownershipType: "direct",
      ownerName: "Tim"
    });
    await postJson(page, "/api/splits/checkpoints/match", { checkpointId: checkpoint.checkpointId, transactionId: transfer.entryId });
  }
  await createExpense(page, group.groupId, `New dinner ${stamp}`, `${month}-25`, 3_000);
  await createExpense(page, group.groupId, `New taxi ${stamp}`, `${month}-26`, 4_500);
  return { groupId: group.groupId, checkpointId: checkpoint.checkpointId, olderDescriptions: older.map(([description]) => description) };
}

async function openGroup(page, groupId, extra = "") {
  await gotoPageAfterApi(page, `/splits?view=person-tim&month=${month}&split_group=${groupId}${extra}`, "/api/splits-page", () => page.locator(".splits-lead"));
}

function settledSection(page) {
  return page.locator(".split-settled-section");
}

function settledToggle(page) {
  return settledSection(page).locator(".split-settled-section-toggle");
}

for (const [name, size] of [["desktop", { width: 1280, height: 800 }], ["phone", PHONE]]) {
  test.describe(name, () => {
    test.beforeEach(async ({ page }) => {
      await page.addInitScript(() => window.localStorage.setItem("monies-map:money-totals-visible", "true"));
      await page.goto("/");
      await reseedDemo(page);
      await page.setViewportSize(size);
    });

    test("the list shows only open records; a settlement waits collapsed at the end and opens read-only", async ({ page }) => {
      const stamp = Date.now();
      const settled = await createSettledGroup(page, stamp);
      const data = await loadSplitsPage(page, { view: "person-tim", month });
      expect(data.splitsPage.settlementCheckpoints.find((item) => item.id === settled.checkpointId)?.status).toBe("matched");
      await openGroup(page, settled.groupId);

      const list = page.locator(".split-activity-list");
      await expect(list.locator(".split-activity-card").filter({ hasText: `New dinner ${stamp}` })).toBeVisible();
      await expect(list.locator(".split-activity-card").filter({ hasText: `New taxi ${stamp}` })).toBeVisible();
      // Collapsed: the settled rows are not even drawn.
      for (const description of settled.olderDescriptions) {
        await expect(list.getByText(description)).toHaveCount(0);
      }
      await expect(settledSection(page)).toHaveCount(1);
      await expect(settledToggle(page)).toHaveText(HEADING);
      await expect(settledToggle(page)).toHaveAttribute("aria-expanded", "false");
      // At the end of the list, after the last open day.
      expect(await page.evaluate(() => {
        const days = [...document.querySelectorAll(".split-activity-list .split-date-group:not(.split-settled-section .split-date-group)")];
        const section = document.querySelector(".split-settled-section");
        return Boolean(days.length && section && (days.at(-1).compareDocumentPosition(section) & Node.DOCUMENT_POSITION_FOLLOWING));
      })).toBe(true);

      await settledToggle(page).click();
      await expect(settledToggle(page)).toHaveAttribute("aria-expanded", "true");
      const settledRows = settledSection(page).locator(".split-activity-card");
      await expect(settledRows).toHaveCount(4);
      await expect(settledRows.first()).toContainText("Included in simplified settlement");

      // A settled row still opens read-only, with the reason and Undo on top.
      await settledRows.filter({ hasText: `Old hotel ${stamp}` }).click();
      const lock = page.locator(".settlement-lock-error").first();
      await expect(lock).toBeVisible();
      await expect(lock.getByRole("button", { name: "Undo simplification" })).toBeVisible();
      await expect(page.getByRole("button", { name: "Save expense" })).toHaveCount(0);
      await page.getByRole("button", { name: "Close", exact: true }).first().click();
      await expect(lock).toHaveCount(0);

      await settledToggle(page).click();
      await expect(settledToggle(page)).toHaveAttribute("aria-expanded", "false");
      await expect(settledSection(page).locator(".split-activity-card")).toHaveCount(0);
    });

    test("a search finds a settled record inside its opened section", async ({ page }) => {
      const stamp = Date.now();
      const settled = await createSettledGroup(page, stamp);
      await openGroup(page, settled.groupId, `&split_search=${encodeURIComponent(`Old flights ${stamp}`)}`);

      await expect(settledToggle(page)).toHaveAttribute("aria-expanded", "true");
      await expect(settledToggle(page)).toHaveText(/^Settled up on 20 May( 2026)? · 1 entry · \$200\.00$/);
      await expect(settledSection(page).locator(".split-activity-card")).toHaveCount(1);
      await expect(settledSection(page).locator(".split-activity-card")).toContainText(`Old flights ${stamp}`);
      await expect(page.locator(".split-activity-card").filter({ hasText: `New dinner ${stamp}` })).toHaveCount(0);
      await expect(page.getByText("No split activity matches this search.")).toHaveCount(0);

      // Negative: a word nothing has shows the no-results card and no section.
      await openGroup(page, settled.groupId, "&split_search=zzqqxxnothing");
      await expect(page.getByText("No split activity matches this search.")).toBeVisible();
      await expect(settledSection(page)).toHaveCount(0);
    });

    test("hidden money hides the settlement's total and keeps its count", async ({ page }) => {
      const settled = await createSettledGroup(page, Date.now());
      await openGroup(page, settled.groupId);
      await expect(settledToggle(page)).toHaveText(HEADING);
      await page.getByRole("button", { name: "Hide money totals" }).first().click();
      await expect(settledToggle(page)).toHaveText(/^Settled up on 20 May( 2026)? · 4 entries · ••••$/);
      await expect(settledToggle(page)).not.toContainText("$");
    });

    test("Archived batches lists the settlement, and choosing it opens the section in the list", async ({ page }) => {
      const settled = await createSettledGroup(page, Date.now());
      await openGroup(page, settled.groupId);
      const trigger = page.locator(".split-archive-trigger");
      await expect(trigger).toContainText("1 earlier settle-up");
      await trigger.click();
      const dialog = page.getByRole("dialog");
      const row = dialog.locator(".split-archive-row.is-settlement").filter({ hasText: "Settled up" });
      await expect(row).toBeVisible();
      await expect(row).toContainText("4 entries");
      await expect(row).toContainText(/for every group/);
      await row.click();
      await expect(dialog).toHaveCount(0);
      await expect(settledToggle(page)).toHaveAttribute("aria-expanded", "true");
      await expect(settledSection(page).locator(".split-activity-card").first()).toBeInViewport();
    });
  });
}

test.describe("desktop only", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => window.localStorage.setItem("monies-map:money-totals-visible", "true"));
    await page.goto("/");
    await reseedDemo(page);
    await page.setViewportSize({ width: 1280, height: 800 });
  });

  test("a simplified settlement still waiting for its payment says Simplified, not Settled up", async ({ page }) => {
    const settled = await createSettledGroup(page, Date.now(), { match: false });
    await openGroup(page, settled.groupId);
    await expect(settledToggle(page)).toHaveText(/^Simplified on 20 May( 2026)? · 4 entries · \$1,000\.00$/);
  });

  test("a reopened settlement puts its records back in the open list, with no section", async ({ page }) => {
    const stamp = Date.now();
    const settled = await createSettledGroup(page, stamp, { match: false });
    await postJson(page, "/api/splits/checkpoints/reopen", { checkpointId: settled.checkpointId });
    await openGroup(page, settled.groupId);
    await expect(settledSection(page)).toHaveCount(0);
    for (const description of settled.olderDescriptions) {
      await expect(page.locator(".split-activity-card").filter({ hasText: description })).toBeVisible();
    }
    await expect(page.locator(".split-archive-trigger")).not.toContainText("earlier settle-up");
  });
});
