import { expect, test } from "@playwright/test";

import { gotoPageAfterApi, loadSplitsPage, postJson, reseedDemo } from "./helpers";

// The round 2 Splits page (design.md, "Lead · Support · Detail"): the group
// lead card, its search field, the flat activity list and the dialogs and
// panels in the same language. Tim's demo groups: Non-group expenses (You
// owe Joyce $260.25), Baby River (You owe Joyce $117.03) and Okaeri (settled).

const INK = {
  short: "rgb(147, 54, 41)",
  text: "rgb(53, 43, 36)"
};
const month = "2025-10";
const groupUrl = (groupId) => `/splits?view=person-tim&month=${month}&split_group=${groupId}`;

async function revealMoney(page) {
  await page.addInitScript(() => window.localStorage.setItem("monies-map:money-totals-visible", "true"));
}

async function openGroup(page, groupId) {
  await gotoPageAfterApi(page, groupUrl(groupId), "/api/splits-page", () => page.locator(".splits-lead"));
}

test.beforeEach(async ({ page }) => {
  await revealMoney(page);
  await page.goto("/");
  await reseedDemo(page);
  await page.setViewportSize({ width: 1280, height: 800 });
});

test("the lead names the open group, its balance in words and its spend; the primary is Settle group", async ({ page }) => {
  const data = await loadSplitsPage(page, { view: "person-tim", month });
  const group = data.splitsPage.groups.find((item) => item.id === "split-group-baby-river");
  expect(group.balanceMinor).toBeLessThan(0);
  await openGroup(page, group.id);

  const lead = page.locator(".splits-lead");
  await expect(lead.locator(".lsd-title")).toHaveText(group.name);
  await expect(lead.locator(".lsd-subtitle")).toHaveText(`${group.currency} · ${group.entryCount} ${group.entryCount === 1 ? "entry" : "entries"}`);
  await expect(lead.locator(".lsd-amount")).toHaveText("$117.03");
  await expect(lead.locator(".lsd-amount-caption")).toHaveText("You owe Joyce");
  // A debt is rose text on the white card, never a fill.
  await expect(lead.locator(".lsd-amount")).toHaveCSS("color", INK.short);
  await expect(lead.locator(".lsd-amount")).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
  await expect(lead.locator(".lsd-chip.is-person")).toHaveText("Joyce");
  await expect(lead.locator(".lsd-chip").filter({ hasText: "Group spend" })).toContainText(/Group spend \$[\d,.]+/);

  // History and + Add expense are quiet; Settle group is the one primary, last.
  const buttons = lead.locator(".splits-lead-actions > button");
  await expect(buttons).toHaveText(["History", "+ Add expense", "Settle group"]);
  await expect(buttons.last()).toHaveClass(/lsd-primary/);
  await expect(buttons.last()).toBeEnabled();
  await expect(lead.locator(".lsd-primary")).toHaveCount(1);
  // On a wide screen Simplify settlement stays in the page head, not the card.
  await expect(lead.getByRole("button", { name: "Simplify settlement" })).toHaveCount(0);
  await expect(page.locator(".split-header-toolbar").getByRole("button", { name: "Simplify settlement" })).toBeVisible();
  // The old summary strip and its chevron are gone.
  await expect(page.locator(".splits-summary-strip")).toHaveCount(0);
});

test("a settled group says Settled up with a plain figure and Settle group is off", async ({ page }) => {
  await openGroup(page, "split-group-okaeri");
  const lead = page.locator(".splits-lead");
  await expect(lead.locator(".lsd-amount-caption")).toHaveText("Settled up");
  await expect(lead.locator(".lsd-amount")).toHaveCSS("color", INK.text);
  await expect(lead.getByRole("button", { name: "Settle group" })).toBeDisabled();
  // Negative: nothing is owed, so no person chip says who owes whom either way.
  await expect(lead.locator(".lsd-amount-caption")).not.toContainText("owe");
});

test("hidden money keeps the card but says nothing about which side of zero it is", async ({ page }) => {
  await page.addInitScript(() => window.localStorage.setItem("monies-map:money-totals-visible", "false"));
  await openGroup(page, "split-group-baby-river");
  const lead = page.locator(".splits-lead");
  await expect(lead.locator(".lsd-amount")).toHaveText("••••");
  await expect(lead.locator(".lsd-amount-caption")).toHaveText("Balance with Joyce");
  await expect(lead.locator(".lsd-amount")).toHaveCSS("color", INK.text);
  await expect(lead.locator(".lsd-chip").filter({ hasText: "Group spend" })).toContainText("••••");
  await expect(lead).not.toContainText(/owe|Settled|\$/);
});

test("the group spend chip opens and closes the category breakdown", async ({ page }) => {
  await openGroup(page, "split-group-none");
  const chip = page.getByRole("button", { name: "Toggle split donut" });
  await expect(chip).toHaveAttribute("aria-expanded", "false");
  await expect(page.locator(".split-donut-panel")).toHaveCount(0);
  await chip.click();
  await expect(chip).toHaveAttribute("aria-expanded", "true");
  await expect(page.locator(".split-donut-panel")).toBeVisible();
  await chip.click();
  await expect(chip).toHaveAttribute("aria-expanded", "false");
  await expect(page.locator(".split-donut-panel")).toHaveCount(0);
});

test("History on the lead opens the activity history as a list sheet with Close", async ({ page }) => {
  const created = await postJson(page, "/api/splits/expenses/create", { date: `${month}-17`, description: `Lead history ${Date.now()}`, categoryName: "Groceries", payerPersonName: "Tim", amountMinor: 1500, splitBasisPoints: 5000, groupId: null, note: "" });
  await postJson(page, "/api/splits/expenses/delete", { splitExpenseId: created.splitExpenseId });
  await openGroup(page, "split-group-none");
  await page.locator(".splits-lead").getByRole("button", { name: "Activity history" }).click();
  const dialog = page.getByRole("dialog", { name: "Split activity history" });
  await expect(dialog).toBeVisible();
  // The rows are one rounded group; Close is the one bottom action.
  await expect(dialog.locator(".lsd-rows .split-history-row").first()).toBeVisible();
  await expect(dialog.locator(".split-list-sheet-actions .lsd-primary")).toHaveText("Close");
  await dialog.getByRole("button", { name: "Close" }).click();
  await expect(dialog).toHaveCount(0);
});

test("search is its own field named for the group, and it still filters the list", async ({ page }) => {
  await openGroup(page, "split-group-none");
  const search = page.getByRole("combobox", { name: "Search" });
  await expect(search).toHaveAttribute("placeholder", "Search Non-group expenses");
  const rows = page.locator(".split-activity-card");
  const before = await rows.count();
  expect(before).toBeGreaterThan(1);
  const first = (await rows.first().locator(".split-activity-copy strong").innerText()).trim();
  await search.fill(first);
  await expect(rows.filter({ hasText: first })).not.toHaveCount(0);
  await expect.poll(async () => rows.count()).toBeLessThan(before);
  await search.fill("zzz no such split");
  await expect(page.getByText("No split activity matches this search.")).toBeVisible();
});

test("the bank-match review has its own lead and the group card steps aside", async ({ page }) => {
  await page.goto(`/splits?view=person-tim&month=${month}&split_mode=matches`);
  await expect(page.locator(".split-match-lead")).toBeVisible();
  await expect(page.locator(".split-match-lead .lsd-title")).toHaveText("Matches");
  await expect(page.locator(".splits-lead")).toHaveCount(0);
  const card = page.locator(".split-match-card").first();
  await expect(card).toBeVisible();
  // The two records are Detail rows; Match is the one primary, Keep separate quiet.
  await expect(card.locator(".lsd-row .lsd-row-label")).toHaveText(["Existing split", "Imported ledger row"]);
  await expect(card.locator(".lsd-chip")).toHaveCount(1);
  await expect(card.getByRole("button", { name: "Keep separate" })).toHaveClass(/lsd-quiet/);
  await expect(card.getByRole("button", { name: "Match", exact: true })).toHaveClass(/lsd-primary/);
  // Back returns to the group and its card.
  await page.getByRole("button", { name: "Back to split group" }).first().click();
  await expect(page.locator(".splits-lead")).toBeVisible();
  await expect(page.locator(".split-match-lead")).toHaveCount(0);
});

test("activity is flat rows: a date divider, one white group per day, hairlines, amounts at the right", async ({ page }) => {
  const date = `${month}-16`;
  const first = await postJson(page, "/api/splits/expenses/create", { date, description: `Flat list one ${Date.now()}`, categoryName: "Groceries", payerPersonName: "Tim", amountMinor: 1200, splitBasisPoints: 5000, groupId: null, note: "" });
  const second = await postJson(page, "/api/splits/expenses/create", { date, description: `Flat list two ${Date.now()}`, categoryName: "Groceries", payerPersonName: "Joyce", amountMinor: 3400, splitBasisPoints: 5000, groupId: null, note: "" });
  expect(first.splitExpenseId && second.splitExpenseId).toBeTruthy();
  await openGroup(page, "split-group-none");

  const day = page.locator(".split-date-group").filter({ has: page.locator(".split-date-header strong", { hasText: "16 Oct 2025" }) });
  await expect(day).toHaveCount(1);
  // The date is a quiet divider, not a card header: small caps text with no fill of its own beyond the sticky band.
  await expect(day.locator(".split-date-header strong")).toHaveCSS("text-transform", "uppercase");
  await expect(day).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
  await expect(day).toHaveCSS("border-top-width", "0px");
  // That day's rows share one rounded white group.
  const items = day.locator(".split-date-items");
  await expect(items).toHaveCSS("background-color", "rgb(255, 255, 255)");
  await expect(items).toHaveCSS("border-top-left-radius", "16px");
  const cards = items.locator(".split-activity-card");
  await expect(cards).toHaveCount(2);
  await expect(cards.nth(0)).toHaveCSS("border-top-width", "0px");
  await expect(cards.nth(1)).toHaveCSS("border-top-width", "1px");
  expect((await cards.nth(0).boundingBox()).height).toBeGreaterThanOrEqual(63);
  // The viewer's words and figure sit at the right edge of the row.
  const trailing = cards.nth(0).locator(".split-activity-trailing");
  await expect(trailing).toHaveCSS("text-align", "right");
  const [cardBox, trailingBox] = await Promise.all([cards.nth(0).boundingBox(), trailing.boundingBox()]);
  expect(cardBox.x + cardBox.width - (trailingBox.x + trailingBox.width)).toBeLessThanOrEqual(16);
});

test("Record settlement is a lead card with an amount in place, Detail rows and a bottom bar", async ({ page }) => {
  await openGroup(page, "split-group-none");
  await page.locator(".splits-lead").getByRole("button", { name: "Settle group" }).click();
  const dialog = page.getByRole("dialog", { name: "Record settlement" });
  await expect(dialog).toBeVisible();

  const lead = dialog.locator(".lsd-card");
  await expect(lead.locator(".lsd-title")).toHaveText("Joyce paid Tim");
  await expect(lead.locator(".lsd-subtitle")).toHaveText("Non-group expenses");
  const amount = dialog.getByRole("textbox", { name: "Amount" });
  await expect(amount).toHaveValue("260.25");
  await expect(dialog.locator(".lsd-row .lsd-row-label")).toHaveText(["Group", "Paid by", "Received by", "Date", "Note", "Paid using", "Currency", "Evidence"]);
  // Negative: the old two-column label grid and its centred Cancel are gone.
  await expect(dialog.locator(".split-dialog-grid, .split-dialog-field")).toHaveCount(0);

  // A typed amount is what is saved, from the primary in the bottom bar.
  const save = dialog.getByRole("button", { name: "Save settlement" });
  await amount.fill("100");
  await expect(save).toBeEnabled();
  await expect(save).toHaveClass(/lsd-primary/);
  await save.click();
  await expect(dialog).toHaveCount(0);
  await expect.poll(async () => {
    const data = await loadSplitsPage(page, { view: "person-tim", month });
    return data.splitsPage.activity.some((item) => item.kind === "settlement" && item.totalAmountMinor === 10000 && item.groupId === "split-group-none");
  }).toBe(true);
});

test("Create group is a lead with the name typed in place and two Detail rows", async ({ page }) => {
  await openGroup(page, "split-group-none");
  await page.getByRole("button", { name: "Create group" }).first().click();
  const dialog = page.getByRole("dialog", { name: "Create group" });
  await expect(dialog).toBeVisible();
  await expect(dialog.locator(".lsd-card")).toBeVisible();
  await expect(dialog.locator(".lsd-row .lsd-row-label")).toHaveText(["Group currency", "Purchase source"]);
  await expect(dialog.locator(".split-dialog-field")).toHaveCount(0);

  const name = `Lead trip ${Date.now()}`;
  await dialog.getByLabel("Group name").fill(name);
  await dialog.getByLabel("Group currency").selectOption("KRW");
  await dialog.getByLabel("Purchase source").selectOption("ledger");
  // The chips under the name follow the choices.
  await expect(dialog.locator(".lsd-chip")).toHaveText(["KRW", "Bank/card"]);
  await dialog.getByRole("button", { name: "Save group" }).click();
  await expect(dialog).toHaveCount(0);
  await expect.poll(async () => {
    const data = await loadSplitsPage(page, { view: "person-tim", month });
    const group = data.splitsPage.groups.find((item) => item.name === name);
    return group ? `${group.currency}/${group.expenseSource}` : "";
  }).toBe("KRW/ledger");
});

test("Archived batches are rows in one group that open a batch, with Back and Close", async ({ page }) => {
  await openGroup(page, "split-group-baby-river");
  await page.locator(".splits-lead").getByRole("button", { name: "Settle group" }).click();
  const settle = page.getByRole("dialog", { name: "Record settlement" });
  await settle.getByRole("textbox", { name: "Note" }).fill("Settled for the archive look");
  await settle.getByRole("button", { name: "Save settlement" }).click();
  await expect(settle).toHaveCount(0);

  await page.locator(".split-archive-trigger").click();
  const archive = page.getByRole("dialog", { name: "Archived batches" });
  await expect(archive).toBeVisible();
  await expect(archive.locator(".lsd-rows .split-archive-row")).toHaveCount(1);
  await archive.locator(".split-archive-row").click();
  // Opening a batch retitles the dialog, so it is found by its role alone.
  const open = page.getByRole("dialog");
  await expect(open.getByRole("button", { name: "Back to archived batches" })).toBeVisible();
  // The rows of a batch are the same flat rows in a rounded group.
  await expect(open.locator(".split-date-items .split-activity-card").first()).toBeVisible();
  await open.getByRole("button", { name: "Back to archived batches" }).click();
  await expect(open.locator(".split-archive-row")).toHaveCount(1);
  await open.getByRole("button", { name: "Close" }).click();
  await expect(open).toHaveCount(0);
});

test("the simplified settlement is a lead, Detail rows and Mark paid; View included activity scrolls to the rows", async ({ page }) => {
  await openGroup(page, "split-group-none");
  await page.setViewportSize({ width: 1280, height: 500 });
  await page.locator(".split-header-toolbar").getByRole("button", { name: "Simplify settlement" }).click();
  const panel = page.locator(".split-checkpoint-panel");
  await expect(panel).toBeVisible();
  await expect(panel.locator(".lsd-card .lsd-title")).toHaveText("Simplified settlement");
  await expect(panel.locator(".lsd-amount")).toHaveText(/\$[\d,.]+/);
  await expect(panel.locator(".lsd-subtitle")).toHaveText(/ pays /);
  await expect(panel.locator(".lsd-rows .lsd-row").first()).toHaveText(/View included activity/);
  await expect(panel.getByRole("button", { name: "Mark paid" })).toHaveClass(/lsd-primary/);
  await expect(panel.getByRole("button", { name: "Undo simplification" })).toHaveClass(/lsd-quiet/);
  // The old "Settlement status" cream panel layout is gone; its hints stay.
  await expect(panel.locator(".split-checkpoint-completion-actions small")).toHaveText("Moves this repayment out of the active view. It remains awaiting a bank transfer match.");

  // View included activity brings an included row into view (it did nothing before).
  const included = page.locator(".split-activity-card.is-settlement-included").first();
  await expect(included).toBeVisible();
  await page.evaluate(() => window.scrollTo({ top: document.body.scrollHeight, behavior: "instant" }));
  await panel.getByRole("button", { name: "View included activity" }).click();
  await expect(included).toBeInViewport();
});

test.describe("on a phone", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("Simplify settlement is a Detail row in the lead, the head and + Add expense are gone", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openGroup(page, "split-group-none");
    const lead = page.locator(".splits-lead");
    await expect(lead.locator('[data-row="simplify"]')).toHaveText(/Simplify settlement/);
    await expect(lead.getByRole("button", { name: "+ Add expense" })).toHaveCount(0);
    await expect(page.locator(".split-header-toolbar")).toHaveCount(0);
    // History and Settle group share the bottom row; the card never scrolls sideways.
    const [historyBox, settleBox, leadBox] = await Promise.all([
      lead.getByRole("button", { name: "Activity history" }).boundingBox(),
      lead.getByRole("button", { name: "Settle group" }).boundingBox(),
      lead.boundingBox()
    ]);
    expect(Math.abs(historyBox.y - settleBox.y)).toBeLessThanOrEqual(12);
    expect(settleBox.x + settleBox.width).toBeLessThanOrEqual(leadBox.x + leadBox.width);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

    // The row does what the head link did, and goes once a simplification is open.
    const created = page.waitForResponse((response) => response.url().includes("/api/splits/checkpoints/create") && response.request().method() === "POST");
    await lead.locator('[data-row="simplify"]').click();
    await created;
    await expect(page.locator(".split-checkpoint-panel")).toBeVisible();
    await expect(lead.locator('[data-row="simplify"]')).toHaveCount(0);
  });

  test("Record settlement is a bottom sheet with the same lead, rows and bar", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openGroup(page, "split-group-none");
    await page.locator(".splits-lead").getByRole("button", { name: "Settle group" }).click();
    const sheet = page.getByRole("dialog", { name: "Record settlement" });
    await expect(sheet).toBeVisible();
    await expect(sheet.locator(".sheet-drag-handle")).toBeVisible();
    await expect(sheet.locator(".lsd-card .lsd-title")).toHaveText("Joyce paid Tim");
    await expect(sheet.getByRole("textbox", { name: "Amount" })).toHaveValue("260.25");
    // A choice opens the app's picker sheet, as on the other cards.
    await sheet.locator('[data-row="to"]').click();
    await expect(page.getByRole("dialog", { name: "Received by" })).toBeVisible();
  });
});
