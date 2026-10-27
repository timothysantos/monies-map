import { expect, test } from "@playwright/test";

import { postJson, reseedDemo } from "./helpers";

// Correct a settled mistake (DOMAIN.md "Split Correction"): a shared cost that
// was entered twice and counted twice by a settle-up. The Ledger check-up's fix
// opens a dialog that says in plain words what Add correction does, with the
// amount the app worked out; adding it puts a correction row in the open
// period and moves the balance by that share (and by nothing else); Undo
// correction takes it away again. Desktop and a 390px phone.

const PHONE = { width: 390, height: 844 };

function isoDaysAgo(days) {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
}

const month = isoDaysAgo(0).slice(0, 7);

// The flight entered twice in a group (Tim paid; Joyce's share is the larger
// cent, $525.93) and both copies settled up together.
async function settledFlight(page) {
  const ids = [];
  const group = await postJson(page, "/api/splits/groups/create", { name: "Okaeri", currency: "SGD", expenseSource: "mixed" });
  for (let copy = 0; copy < 2; copy += 1) {
    const created = await postJson(page, "/api/splits/expenses/create", {
      groupId: group.groupId,
      date: isoDaysAgo(120),
      description: "Singapore Airlines flights",
      categoryName: "Travel",
      payerPersonName: "Tim",
      amountMinor: 105_185,
      splitAmountMinor: 52_592,
      currency: "SGD",
      paymentMethod: "cash",
      paymentStatus: "recorded"
    });
    ids.push(created.splitExpenseId);
  }
  const checkpoint = await postJson(page, "/api/splits/checkpoints/create", { viewerPersonId: "person-tim", date: isoDaysAgo(60), currency: "SGD" });
  await postJson(page, "/api/splits/checkpoints/mark-paid", { checkpointId: checkpoint.checkpointId });
  return { groupId: group.groupId, ids, checkpointId: checkpoint.checkpointId };
}

async function checkupFix(page) {
  const response = await page.request.get("/api/ledger-checkup");
  expect(response.ok(), await response.text()).toBeTruthy();
  const report = await response.json();
  const finding = report.findings.find((item) => item.kind === "settled_period_error");
  expect(finding?.fix, "the check-up offers the fix").toBeTruthy();
  expect(finding.fix.label).toBe("Correct this settled mistake");
  return finding.fix;
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => window.localStorage.setItem("monies-map:money-totals-visible", "true"));
  await page.goto("/");
  await reseedDemo(page);
});

for (const [name, viewport] of [["desktop", null], ["phone 390px", PHONE]]) {
  test(`the check-up's fix adds a correction in the open period, the balance moves by exactly its share, and Undo takes it away (${name})`, async ({ page }) => {
    if (viewport) await page.setViewportSize(viewport);
    const { groupId } = await settledFlight(page);
    const fix = await checkupFix(page);

    // The fix opens the dialog: the effect in plain words, the amount worked out by the app.
    await page.goto(fix.path);
    const dialog = page.getByRole("dialog", { name: "Correct a settled mistake" });
    await expect(dialog).toBeVisible({ timeout: 60_000 });
    await expect(dialog).toContainText("This adds a $525.93 correction in Joyce’s favour to the current period.");
    await expect(dialog).toContainText("settle-up stays as it is.");
    await expect(dialog.getByLabel("Reason")).toBeVisible();
    // Nothing to type for the amount.
    await expect(dialog.getByRole("textbox")).toHaveCount(1);

    // Cancel closes it and changes nothing.
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(dialog).toBeHidden();
    expect((await (await page.request.get("/api/ledger-checkup")).json()).findings.some((item) => item.kind === "settled_period_error")).toBe(true);

    // Add it, removing the extra copy in the same step.
    await page.goto(fix.path);
    await expect(dialog).toBeVisible({ timeout: 60_000 });
    await dialog.getByLabel("Also remove the duplicate").check();
    const added = page.waitForResponse((response) => response.url().endsWith("/api/splits/corrections") && response.request().method() === "POST");
    await dialog.getByRole("button", { name: "Add correction" }).click();
    expect((await added).ok()).toBe(true);
    await expect(dialog).toBeHidden();
    await expect(page.getByText("Correction added.")).toBeVisible();

    // The finding is resolved by the correction.
    expect((await (await page.request.get("/api/ledger-checkup")).json()).findings.some((item) => item.kind === "settled_period_error")).toBe(false);

    // Joyce's view: the correction row sits in the open period with its reason, and Tim owes her that share.
    await page.goto(`/splits?view=person-joyce&month=${month}&split_group=${groupId}`);
    const row = page.locator(".split-activity-card").filter({ hasText: "Correction: Singapore Airlines flights" });
    await expect(row).toBeVisible({ timeout: 60_000 });
    await expect(row).toContainText("counted twice in the");
    await expect(row).toContainText("In Joyce’s favour");
    await expect(row).toContainText("$525.93");
    await expect(page.locator(".split-lead-card, .split-group-lead, main").first()).toContainText("Tim owes you $525.93");
    // Spending is untouched: the group has no open expense, so the spend chip stays at zero
    // (the removed copy left the settled section: one entry of $1,051.85 remains there).
    await expect(page.getByRole("button", { name: /Toggle split donut/ })).toContainText("Spent since last settle-up");
    await expect(page.getByRole("button", { name: /Toggle split donut/ })).toContainText("$0.00");
    await expect(page.getByRole("button", { name: /Settled up on .* · 1 entry · \$1,051\.85/ })).toBeVisible();

    // Undo correction takes it away, and the check-up reports the mistake again.
    const undone = page.waitForResponse((response) => response.url().endsWith("/api/splits/corrections/undo"));
    await row.getByRole("button", { name: "Undo correction" }).click();
    expect((await undone).ok()).toBe(true);
    await expect(row).toHaveCount(0, { timeout: 60_000 });
    await expect(page.getByText("Correction undone.")).toBeVisible();
    const again = await (await page.request.get("/api/ledger-checkup")).json();
    expect(again.findings.some((item) => item.kind === "settled_period_error")).toBe(true);
  });
}

test("hidden money stays hidden in the dialog and on the correction row", async ({ page }) => {
  await page.addInitScript(() => window.localStorage.setItem("monies-map:money-totals-visible", "false"));
  const { groupId } = await settledFlight(page);
  const fix = await checkupFix(page);
  await page.goto(fix.path);
  const dialog = page.getByRole("dialog", { name: "Correct a settled mistake" });
  await expect(dialog).toBeVisible({ timeout: 60_000 });
  await expect(dialog).not.toContainText("525.93");
  await expect(dialog).toContainText("••••");
  await dialog.getByRole("button", { name: "Add correction" }).click();
  await expect(dialog).toBeHidden();

  await page.goto(`/splits?view=person-joyce&month=${month}&split_group=${groupId}`);
  const row = page.locator(".split-activity-card").filter({ hasText: "Correction: Singapore Airlines flights" });
  await expect(row).toBeVisible({ timeout: 60_000 });
  await expect(row).not.toContainText("525.93");
  await expect(page.getByText("525.93")).toHaveCount(0);
});

test("a link to a mistake that is already corrected shows why there is nothing to add", async ({ page }) => {
  await settledFlight(page);
  const fix = await checkupFix(page);
  const sourceRecordId = new URL(fix.path, "http://app.local").searchParams.get("correct_settled");
  await postJson(page, "/api/splits/corrections", { sourceRecordId });

  await page.goto(fix.path);
  const dialog = page.getByRole("dialog", { name: "Correct a settled mistake" });
  await expect(dialog).toBeVisible({ timeout: 60_000 });
  await expect(dialog).toContainText("A correction for this is already in the activity list.");
  await expect(dialog.getByRole("button", { name: "Add correction" })).toHaveCount(0);
  await dialog.getByRole("button", { name: "Close" }).first().click();
  await expect(dialog).toBeHidden();
});

test("the link is on the settled card of the flagged copy only, and opens the same dialog", async ({ page }) => {
  const { groupId, ids, checkpointId } = await settledFlight(page);
  const fix = await checkupFix(page);
  const flagged = new URL(fix.path, "http://app.local").searchParams.get("correct_settled");
  const kept = ids.find((id) => id !== flagged);
  await page.goto(`/splits?view=person-tim&month=${month}&split_group=${groupId}`);
  await page.locator(`[data-settlement-section="${checkpointId}"] .split-settled-section-toggle`).click({ timeout: 60_000 });

  // The kept copy's card says why it is locked and offers nothing more.
  await page.locator(`#split-activity-expense-${kept}`).click();
  await expect(page.getByRole("button", { name: "Undo simplification" })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("button", { name: "Correct this settled mistake" })).toHaveCount(0);
  await page.getByRole("button", { name: "Close" }).first().click();

  // The flagged copy's card carries the link.
  await page.locator(`#split-activity-expense-${flagged}`).click();
  const link = page.getByRole("button", { name: "Correct this settled mistake" });
  await expect(link).toBeVisible({ timeout: 30_000 });
  await link.click();
  const dialog = page.getByRole("dialog", { name: "Correct a settled mistake" });
  await expect(dialog).toContainText("This adds a $525.93 correction in Joyce’s favour");
});
