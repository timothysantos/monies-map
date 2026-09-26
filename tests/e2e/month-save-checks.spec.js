import { devices, expect, test } from "@playwright/test";

import { loadMonthPage, postJson, reseedDemo } from "./helpers";

// Month writes other than "Save matches": deleting a plan or income row,
// saving a row note, saving the month note, and the month actions (duplicate,
// reset, delete). Each checks the server's answer. A failure keeps the row or
// draft on screen with the error; the screen changes only after a success, so
// a totals card never shows an unsaved change as saved. A saved row reopened
// before the background reload lands shows the values just saved.

const MONTH_URL = "/month?view=person-tim&month=2026-05&scope=direct_plus_shared";

async function openMonth(page) {
  await page.addInitScript(() => window.localStorage.setItem("monies-map:money-totals-visible", "true"));
  await page.goto("/");
  await reseedDemo(page);
}

async function seedPlanRow(page, suffix, sectionKey = "planned_items", note = "") {
  const label = `Playwright save check ${suffix}`;
  await postJson(page, "/api/month-plan/save", {
    rowId: `playwright-save-check-${suffix}`,
    month: "2026-05",
    sectionKey,
    categoryName: sectionKey === "income" ? "Salary" : "Entertainment",
    label,
    planDate: sectionKey === "planned_items" ? "2026-05-18" : null,
    accountName: sectionKey === "planned_items" ? "UOB One" : null,
    plannedMinor: 4321,
    note,
    ownershipType: "direct",
    ownerName: "Tim"
  });
  return label;
}

async function findRow(page, label) {
  const monthPage = await loadMonthPage(page, { month: "2026-05" });
  const rows = [
    ...(monthPage.monthPage.incomeRows ?? []),
    ...monthPage.monthPage.planSections.flatMap((section) => section.rows)
  ];
  return rows.find((row) => row.label === label);
}

// Holds matching requests until released, then fails them; afterwards lets
// them through. Returns counters and switches for the test.
async function holdThenFail(page, pattern, message) {
  const state = { count: 0, fail: true };
  let release;
  const held = new Promise((resolve) => { release = resolve; });
  await page.route(pattern, async (route) => {
    state.count += 1;
    if (!state.fail) {
      await route.continue();
      return;
    }
    await held;
    await route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ ok: false, error: message }) });
  });
  return { state, release };
}

test.afterEach(async ({ page }) => {
  await page.unrouteAll({ behavior: "ignoreErrors" });
});

test("desktop: a plan row delete that fails keeps the row and shows why; a successful one removes it", async ({ page }) => {
  await openMonth(page);
  const label = await seedPlanRow(page, `delete-${Date.now()}`);
  await page.goto(MONTH_URL);
  const row = page.locator("tr").filter({ hasText: label }).first();
  await row.click();

  const { state, release } = await holdThenFail(page, "**/api/month-plan/delete", "Delete exploded");
  await page.getByRole("button", { name: `Delete ${label}` }).click();
  const confirm = page.getByRole("button", { name: "Confirm" });
  await confirm.click();
  // While the delete is in flight the confirmation shows it is working and
  // cannot be sent again.
  await expect(page.getByRole("button", { name: "Working..." })).toBeDisabled();
  release();

  await expect(page.getByRole("alert").filter({ hasText: "Delete exploded" })).toBeVisible();
  // The row is still on screen (it is open for editing, so its own delete
  // action is the visible handle) and still saved.
  await expect(page.getByRole("button", { name: `Delete ${label}` })).toBeVisible();
  expect(state.count).toBe(1);
  expect(await findRow(page, label)).toBeTruthy();

  state.fail = false;
  await confirm.click();
  await expect(page.locator("tr").filter({ hasText: label })).toHaveCount(0);
  await expect.poll(async () => Boolean(await findRow(page, label))).toBe(false);
});

test("desktop: an income row delete that fails keeps the row", async ({ page }) => {
  await openMonth(page);
  // An income row can be deleted only while another income row remains.
  await seedPlanRow(page, `income-keep-${Date.now()}`, "income");
  const label = await seedPlanRow(page, `income-${Date.now()}`, "income");
  await page.goto(MONTH_URL);
  // The Income section starts collapsed.
  await page.getByRole("button", { name: /^Income Planned income sources/ }).click();
  await page.locator("tr").filter({ hasText: label }).first().click();

  const { state, release } = await holdThenFail(page, "**/api/month-plan/delete", "Income delete exploded");
  await page.getByRole("button", { name: `Delete ${label}` }).click();
  await page.getByRole("button", { name: "Confirm" }).click();
  release();

  await expect(page.getByRole("alert").filter({ hasText: "Income delete exploded" })).toBeVisible();
  await expect(page.getByRole("button", { name: `Delete ${label}` })).toBeVisible();
  expect(state.count).toBe(1);
  expect(await findRow(page, label)).toBeTruthy();
});

const layouts = [
  { name: "desktop", context: {} },
  { name: "mobile", context: devices["iPhone 12 Pro"] }
];

for (const layout of layouts) {
  test(`${layout.name}: a month note save that fails keeps the dialog, draft and old note; success saves it`, async ({ browser }) => {
    const context = await browser.newContext(layout.context);
    const page = await context.newPage();
    await openMonth(page);
    await page.goto(MONTH_URL);
    const draft = `Playwright month note ${layout.name} ${Date.now()}`;
    const before = (await loadMonthPage(page, { month: "2026-05" })).monthPage.monthNote ?? "";

    await page.locator(".note-card-button").click();
    const dialog = page.getByRole("dialog");
    await dialog.locator("textarea").fill(draft);
    const { state, release } = await holdThenFail(page, "**/api/month-note/update", "Month note exploded");
    const save = dialog.locator('button[type="submit"]');
    await save.click();
    await expect(save).toBeDisabled();
    await page.keyboard.press("Escape");
    release();

    await expect(dialog.getByRole("alert").filter({ hasText: "Month note exploded" })).toBeVisible();
    await expect(dialog.locator("textarea")).toHaveValue(draft);
    expect(state.count).toBe(1);
    expect((await loadMonthPage(page, { month: "2026-05" })).monthPage.monthNote ?? "").toBe(before);

    state.fail = false;
    await save.click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page.locator(".note-card-button")).toContainText(draft);
    await context.close();
  });

  test(`${layout.name}: a row note save that fails keeps the dialog and does not show the note as saved`, async ({ browser }) => {
    const context = await browser.newContext(layout.context);
    const page = await context.newPage();
    await openMonth(page);
    const label = await seedPlanRow(page, `note-${layout.name}-${Date.now()}`);
    await page.goto(MONTH_URL);
    const draft = `Playwright row note ${layout.name}`;
    const row = page.locator("tr").filter({ hasText: label }).first();

    await row.locator(".note-trigger").click();
    const dialog = page.getByRole("dialog").filter({ hasText: "Edit note" });
    await dialog.locator("textarea").fill(draft);
    const { state, release } = await holdThenFail(page, "**/api/month-plan/save", "Row note exploded");
    const save = dialog.locator('button[type="submit"]');
    await save.click();
    await expect(save).toBeDisabled();
    await page.keyboard.press("Escape");
    release();

    await expect(dialog.getByRole("alert").filter({ hasText: "Row note exploded" })).toBeVisible();
    await expect(dialog.locator("textarea")).toHaveValue(draft);
    await expect(row.locator(".note-trigger")).not.toContainText(draft);
    expect(state.count).toBe(1);
    expect((await findRow(page, label))?.note ?? "").toBe("");

    state.fail = false;
    await save.click();
    await expect(dialog).toHaveCount(0);
    await expect(row.locator(".note-trigger")).toContainText(draft);
    await expect.poll(async () => (await findRow(page, label))?.note).toBe(draft);
    await context.close();
  });
}

// After a row save the Month page reloads in the background. A row reopened
// before that reload lands must show what was just saved, not the old values.
// Holds every Month page reload until released.
async function holdMonthReload(page) {
  const state = { count: 0 };
  let release;
  const held = new Promise((resolve) => { release = resolve; });
  await page.route("**/api/month-page**", async (route) => {
    state.count += 1;
    await held;
    await route.continue().catch(() => {});
  });
  return { state, release };
}

test("mobile: a plan row reopened before the reload shows the amount and note just saved", async ({ browser }) => {
  const context = await browser.newContext(devices["iPhone 12 Pro"]);
  const page = await context.newPage();
  await openMonth(page);
  const label = await seedPlanRow(page, `reopen-mobile-${Date.now()}`, "planned_items", "Note before save");
  await page.goto(MONTH_URL);
  // The phone layout opens a row by tapping it; the row's own open button is
  // for wider layouts.
  const rowOpener = page.locator("tr").filter({ hasText: label }).first().getByText(label, { exact: true });
  const sheet = page.locator('.entry-mobile-sheet[aria-label="Edit planned item"]');

  await rowOpener.click();
  await sheet.locator('input[value="43.21"]').fill("45.67");
  await sheet.locator("textarea").fill("Saved before reload");
  const { state, release } = await holdMonthReload(page);
  await sheet.locator("button.dialog-primary").click();
  await expect(sheet).toHaveCount(0);
  await expect.poll(() => state.count).toBeGreaterThan(0);

  await rowOpener.click();
  await expect(sheet.getByRole("textbox", { name: "Planned" })).toHaveValue("45.67");
  await expect(sheet.locator("textarea")).toHaveValue("Saved before reload");
  expect((await findRow(page, label))?.plannedMinor).toBe(4567);

  // Once the reload lands the reopened row still shows the saved amount.
  const reloaded = page.waitForResponse((response) => response.url().includes("/api/month-page") && response.ok());
  release();
  await reloaded;
  await page.keyboard.press("Escape");
  await expect(sheet).toHaveCount(0);
  await rowOpener.click();
  await expect(sheet.getByRole("textbox", { name: "Planned" })).toHaveValue("45.67");
  await context.close();
});

test("desktop: a plan row reopened for inline editing before the reload shows the amount just saved", async ({ page }) => {
  await openMonth(page);
  const label = await seedPlanRow(page, `reopen-desktop-${Date.now()}`);
  await page.goto(MONTH_URL);
  const row = page.locator("tr").filter({ hasText: label }).first();
  // While editing, the item name is an input, so find the row by its state.
  const editingRow = page.locator("tr.is-editing");
  const saveButton = page.getByTestId("month-inline-save-button");

  await row.getByRole("button", { name: `Edit ${label} row` }).click();
  await editingRow.locator(".table-edit-input-money").fill("45.67");
  const { state, release } = await holdMonthReload(page);
  await saveButton.click();
  await expect(saveButton).toHaveCount(0);
  await expect(row).toContainText("45.67");
  await expect.poll(() => state.count).toBeGreaterThan(0);

  await row.getByRole("button", { name: `Edit ${label} row` }).click();
  await expect(editingRow.locator(".table-edit-input-money")).toHaveValue("45.67");
  await page.getByTestId("month-inline-cancel-button").click();
  await expect(row).toContainText("45.67");
  release();
});

for (const layout of layouts) {
  test(`${layout.name}: a row note reopened in the row editor before the reload shows the note just saved`, async ({ browser }) => {
    const context = await browser.newContext(layout.context);
    const page = await context.newPage();
    await openMonth(page);
    // A row that already has a note, so a stale copy would show that note.
    const label = await seedPlanRow(page, `reopen-note-${layout.name}-${Date.now()}`, "planned_items", "Note before save");
    await page.goto(MONTH_URL);
    const row = page.locator("tr").filter({ hasText: label }).first();
    const draft = `Reopened note ${layout.name}`;

    await row.locator(".note-trigger").click();
    const noteDialog = page.getByRole("dialog").filter({ hasText: "Edit note" });
    await noteDialog.locator("textarea").fill(draft);
    const { state, release } = await holdMonthReload(page);
    await noteDialog.locator('button[type="submit"]').click();
    await expect(noteDialog).toHaveCount(0);
    await expect(row.locator(".note-trigger")).toContainText(draft);
    await expect.poll(() => state.count).toBeGreaterThan(0);

    if (layout.name === "mobile") {
      await row.getByText(label, { exact: true }).click();
      const sheet = page.locator('.entry-mobile-sheet[aria-label="Edit planned item"]');
      await expect(sheet.locator("textarea")).toHaveValue(draft);
    } else {
      await row.getByRole("button", { name: `Edit ${label} row` }).click();
      await expect(page.locator("tr.is-editing .note-trigger")).toContainText(draft);
    }
    release();
    await context.close();
  });
}

async function openMonthActions(page, suffix) {
  await openMonth(page);
  const label = await seedPlanRow(page, suffix);
  await page.goto(MONTH_URL);
  await expect(page.locator("tr").filter({ hasText: label }).first()).toBeVisible();
  await page.getByRole("button", { name: "Actions", exact: true }).click();
  return label;
}

function failWith(message) {
  return (route) => route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ ok: false, error: message }) });
}

test("desktop: a duplicate that fails stays on this month and says why", async ({ page }) => {
  await openMonthActions(page, `dup-${Date.now()}`);
  await page.route("**/api/months/duplicate*", failWith("Duplicate exploded"));
  await page.getByRole("button", { name: "Duplicate month" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Duplicate exploded" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Duplicate month" })).toBeVisible();
  await expect(page).toHaveURL(/month=2026-05/);
});

for (const action of [
  { name: "reset", item: "Reset month", phrase: "reset month", confirm: "Confirm reset month", route: "**/api/months/reset*" },
  { name: "delete", item: "Delete month", phrase: "delete month", confirm: "Confirm delete month", route: "**/api/months/delete*" }
]) {
  test(`desktop: a month ${action.name} that fails keeps its dialog open, says why and keeps the rows`, async ({ page }) => {
    const label = await openMonthActions(page, `${action.name}-${Date.now()}`);
    await page.route(action.route, failWith(`${action.item} exploded`));
    await page.getByRole("button", { name: action.item, exact: true }).click();
    const dialog = page.getByRole("dialog").filter({ hasText: action.confirm });
    await dialog.locator("input").fill(action.phrase);
    await dialog.getByRole("button", { name: action.confirm }).click();
    await expect(dialog.getByRole("alert").filter({ hasText: `${action.item} exploded` })).toBeVisible();
    await expect(dialog).toBeVisible();
    expect(await findRow(page, label)).toBeTruthy();
    await expect(page.locator("tr").filter({ hasText: label }).first()).toBeVisible();
  });
}
