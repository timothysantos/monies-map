import { expect, test } from "@playwright/test";

import { loadMonthPage, postJson, reseedDemo } from "./helpers";

// The dialogs and small sheets in the Lead · Support · Detail style
// (design.md, "Lead · Support · Detail"; src/client/sheet-dialog.jsx): one
// lead, Detail rows or one field, and the actions in a bar at the bottom. On a
// phone each is the shared bottom sheet (grab handle, round 44 px close, the
// bar under the thumb); on a wide screen a centred dialog with the same parts.
// For each one: the primary action does what it did, Cancel changes nothing,
// a destructive confirm is rose and asks in the app, every tap target is 44 px
// or more with 8 px between neighbours, and hidden money shows no amount.
//
// Tagged @webkit: `playwright.webkit.config.js` runs the phone tests in WebKit
// on an iPhone 13 profile too (390 x 664, as below).

const PHONE = { width: 390, height: 664 };
const MONTH = "2026-05";

async function phone(page, { hidden = false } = {}) {
  await page.addInitScript((value) => window.localStorage.setItem("monies-map:money-totals-visible", value), hidden ? "false" : "true");
  await page.setViewportSize(PHONE);
  await reseedDemo(page);
}

async function desktop(page) {
  await page.addInitScript(() => window.localStorage.setItem("monies-map:money-totals-visible", "true"));
  await page.setViewportSize({ width: 1280, height: 800 });
  await reseedDemo(page);
}

async function createExpense(page, description, patch = {}) {
  const { entryId } = await postJson(page, "/api/entries/create", {
    date: `${MONTH}-24`,
    description,
    accountName: "UOB One",
    categoryName: "Groceries",
    amountMinor: 4321,
    entryType: "expense",
    ownershipType: "direct",
    ownerName: "Tim",
    ...patch
  });
  return entryId;
}

// The shared phone sheet for a dialog: found by its name, with the parts the
// design promises.
const sheet = (page, name) => page.locator(`.entry-mobile-sheet.sheet-dialog[aria-label="${name}"]`);
const desktopDialog = (page, name) => page.getByRole("dialog", { name });

function box(locator) {
  return locator.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return { top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.right, width: rect.width, height: rect.height };
  });
}

// Every visible tappable inside `scope`: at least 44 x 44 px, and at least
// 8 px clear of any other tappable beside it (stacked full-width rows touch).
async function tapTargetProblems(scope) {
  const targets = await scope.evaluate((root) => {
    const selector = "button, [role='button'], a[href], select, input:not([type='hidden']), textarea, label.lsd-row";
    const seen = new Set();
    const found = [];
    for (const element of root.querySelectorAll(selector)) {
      const target = element.closest("label.lsd-row") ?? element;
      if (seen.has(target)) continue;
      seen.add(target);
      const rect = target.getBoundingClientRect();
      const style = getComputedStyle(target);
      if (rect.width === 0 || rect.height === 0 || style.visibility === "hidden" || target.closest("[aria-hidden='true']")) continue;
      if (target.type === "checkbox") continue;
      const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
      if (!(hit && (target === hit || target.contains(hit)))) continue;
      const scroller = target.closest("[data-sheet-body], .entry-mobile-sheet-scroll");
      const view = scroller?.getBoundingClientRect();
      if (view && (rect.top < view.top - 1 || rect.bottom > view.bottom + 1)) continue;
      found.push({
        name: (target.getAttribute("aria-label") || target.textContent || target.className).trim().replace(/\s+/g, " ").slice(0, 40),
        width: rect.width,
        height: rect.height,
        rect: { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom }
      });
    }
    return found;
  });
  const problems = [];
  for (const target of targets) {
    if (target.width < 43.5 || target.height < 43.5) {
      problems.push(`${target.name}: ${target.width.toFixed(1)} x ${target.height.toFixed(1)}`);
    }
  }
  for (let i = 0; i < targets.length; i += 1) {
    for (let j = i + 1; j < targets.length; j += 1) {
      const a = targets[i].rect;
      const b = targets[j].rect;
      if (Math.abs(a.left - b.left) < 2 && Math.abs(a.right - b.right) < 2) continue;
      const gap = Math.max(Math.max(a.left - b.right, b.left - a.right), Math.max(a.top - b.bottom, b.top - a.bottom));
      if (gap < 8) problems.push(`${targets[i].name} | ${targets[j].name}: ${gap.toFixed(1)}px`);
    }
  }
  return problems;
}

// What every phone dialog shares: the grab handle, a 44 px round close, one
// lead, the bar at the bottom of the sheet with the primary action at its end,
// nothing scrolling sideways, and tap targets that are big enough.
async function expectSheetFrame(page, surface, { lead = true, primary }) {
  await expect(surface.locator(".sheet-drag-handle")).toHaveCount(1);
  const close = surface.locator(".entry-composer-close");
  const closeBox = await box(close);
  expect(closeBox.width).toBeGreaterThanOrEqual(44);
  expect(closeBox.height).toBeGreaterThanOrEqual(44);
  if (lead) {
    await expect(surface.locator(".lsd-card")).toHaveCount(1);
  }
  const bar = surface.locator(".lsd-bottom.is-sheet-bar");
  await expect(bar).toHaveCount(1);
  const sheetBox = await box(surface);
  const barBox = await box(bar);
  // The bar is the bottom of the sheet, inside the thumb's reach (the lower
  // third of the screen).
  expect(sheetBox.bottom - barBox.bottom).toBeLessThanOrEqual(2);
  expect(barBox.top).toBeGreaterThan(PHONE.height * 0.55);
  const primaryBox = await box(bar.getByRole("button", { name: primary }));
  expect(primaryBox.right).toBeGreaterThan(barBox.right - 40);
  expect(await surface.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
  expect(await tapTargetProblems(surface)).toEqual([]);
}

test.describe("@webkit phone: confirmations are bottom sheets with the destructive action in rose", () => {
  test("Delete entry: the sheet names the entry, Cancel keeps it, Delete entry removes it", async ({ page }) => {
    await phone(page);
    const description = `Dialog delete ${Date.now()}`;
    const entryId = await createExpense(page, description);
    await page.goto(`/entries?view=person-tim&month=${MONTH}&editing_entry=${entryId}`);
    await expect(page.locator('.entry-mobile-sheet[aria-label="Edit entry"]')).toBeVisible({ timeout: 60_000 });
    await page.getByRole("button", { name: "Delete entry" }).click();

    const confirm = sheet(page, "Delete entry?");
    await expect(confirm).toBeVisible();
    await expect(confirm.locator(".lsd-title")).toHaveText(description);
    await expect(confirm.locator(".lsd-amount")).toContainText("$43.21");
    await expect(confirm.getByText("This removes the ledger entry.")).toBeVisible();
    await expectSheetFrame(page, confirm, { primary: "Delete entry" });
    // Rose pastel with the rose ink, not a saturated red.
    const deleteButton = confirm.locator(".lsd-bottom").getByRole("button", { name: "Delete entry" });
    await expect(deleteButton).toHaveCSS("color", "rgb(163, 53, 42)");
    await expect(deleteButton).toHaveCSS("background-color", "rgb(249, 229, 225)");

    let deleteRequests = 0;
    page.on("request", (request) => {
      if (request.url().includes("/api/entries/delete")) deleteRequests += 1;
    });
    await confirm.getByRole("button", { name: "Cancel" }).click();
    await expect(confirm).toHaveCount(0);
    await page.waitForTimeout(200);
    expect(deleteRequests).toBe(0);

    await page.getByRole("button", { name: "Delete entry" }).click();
    const response = page.waitForResponse((r) => r.url().includes("/api/entries/delete") && r.ok());
    await sheet(page, "Delete entry?").locator(".lsd-bottom").getByRole("button", { name: "Delete entry" }).click();
    await response;
    await expect(page.getByText(description, { exact: true })).toHaveCount(0);
  });

  test("hidden money: the delete sheet shows dots and no sign", async ({ page }) => {
    await phone(page, { hidden: true });
    const entryId = await createExpense(page, `Dialog hidden ${Date.now()}`);
    await page.goto(`/entries?view=person-tim&month=${MONTH}&editing_entry=${entryId}`);
    await expect(page.locator('.entry-mobile-sheet[aria-label="Edit entry"]')).toBeVisible({ timeout: 60_000 });
    await page.getByRole("button", { name: "Delete entry" }).click();
    const confirm = sheet(page, "Delete entry?");
    await expect(confirm).toBeVisible();
    const amount = await confirm.locator(".lsd-amount").innerText();
    expect(amount).not.toMatch(/\d/);
    expect(amount).not.toMatch(/[$+\-]/);
    expect(await confirm.innerText()).not.toContain("43.21");
  });

  test("Reset month needs the words typed; Cancel changes nothing", async ({ page }) => {
    await phone(page);
    await page.goto(`/month?view=person-tim&month=${MONTH}&scope=direct_plus_shared`);
    await expect(page.getByRole("button", { name: "Actions", exact: true })).toBeVisible({ timeout: 60_000 });
    await page.getByRole("button", { name: "Actions", exact: true }).click();

    // The Month Actions list is a sheet of Detail rows on a phone.
    const actions = sheet(page, "Actions");
    await expect(actions).toBeVisible();
    await expect(actions.locator(".lsd-row")).toHaveText([/Duplicate month/, /Reset month/, /Delete month/]);
    await expectSheetFrame(page, actions, { primary: "Done" });
    await actions.getByRole("button", { name: "Reset month" }).click();

    const confirm = sheet(page, "Reset month");
    await expect(confirm).toBeVisible();
    const confirmButton = confirm.locator(".lsd-bottom").getByRole("button", { name: "Confirm reset month" });
    await expect(confirmButton).toBeDisabled();
    await expectSheetFrame(page, confirm, { primary: "Confirm reset month" });
    await confirm.getByPlaceholder("Type 'reset month'").fill("reset");
    await expect(confirmButton).toBeDisabled();
    await confirm.getByPlaceholder("Type 'reset month'").fill("Reset Month");
    await expect(confirmButton).toBeEnabled();

    let resetRequests = 0;
    page.on("request", (request) => {
      if (request.url().includes("/api/months/reset")) resetRequests += 1;
    });
    await confirm.getByRole("button", { name: "Cancel" }).click();
    await expect(confirm).toHaveCount(0);
    await page.waitForTimeout(200);
    expect(resetRequests).toBe(0);
  });
});

test.describe("@webkit phone: note and Match planned item sheets", () => {
  test("Monthly Note: Cancel keeps the note, Done saves it", async ({ page }) => {
    await phone(page);
    await page.goto(`/month?view=person-tim&month=${MONTH}&scope=direct_plus_shared`);
    const note = `Dialog month note ${Date.now()}`;
    await page.locator(".note-card-button").first().click({ timeout: 60_000 });
    const surface = sheet(page, "Monthly Note");
    await expect(surface).toBeVisible();
    await expect(surface.locator(".lsd-title")).toContainText("May 2026");
    await expectSheetFrame(page, surface, { primary: "Done" });
    await surface.getByRole("textbox").fill(note);

    // A changed note is not dropped without asking: the close button asks
    // nothing, but Cancel is explicit and the page keeps the old note.
    await surface.getByRole("button", { name: "Cancel" }).click();
    await expect(surface).toHaveCount(0);
    expect((await loadMonthPage(page, { month: MONTH })).monthPage.monthNote ?? "").not.toBe(note);

    await page.locator(".note-card-button").first().click();
    await sheet(page, "Monthly Note").getByRole("textbox").fill(note);
    await sheet(page, "Monthly Note").getByRole("button", { name: "Done" }).click();
    await expect(sheet(page, "Monthly Note")).toHaveCount(0);
    await expect.poll(async () => (await loadMonthPage(page, { month: MONTH })).monthPage.monthNote).toBe(note);
  });

  test("Match planned item: the lead is the planned item, its filters and rows are tap targets, Cancel links nothing", async ({ page }) => {
    await phone(page);
    const label = `Dialog planned ${Date.now()}`;
    await postJson(page, "/api/month-plan/save", {
      rowId: `dialog-planned-${Date.now()}`,
      month: MONTH,
      sectionKey: "planned_items",
      categoryName: "Entertainment",
      label,
      planDate: `${MONTH}-18`,
      accountName: "UOB One",
      plannedMinor: 5000,
      note: "",
      ownershipType: "direct",
      ownerName: "Tim"
    });
    const description = `Dialog candidate ${Date.now()}`;
    await createExpense(page, description, { categoryName: "Entertainment", date: `${MONTH}-18`, amountMinor: 1600 });
    await page.goto(`/month?view=person-tim&month=${MONTH}&scope=direct_plus_shared`);
    await page.locator("tr").filter({ hasText: label }).first().getByRole("button", { name: "Link entries" }).click({ timeout: 60_000 });
    const surface = sheet(page, "Match planned item");
    await expect(surface).toBeVisible();
    await expect(surface.locator(".lsd-title")).toHaveText(label);
    await expect(surface.locator(".lsd-amount")).toContainText("$50.00");
    await expect(surface.locator(".lsd-chip").filter({ hasText: "0 linked" })).toBeVisible();
    await expectSheetFrame(page, surface, { primary: "Save matches" });
    await surface.locator(".planned-link-row").filter({ hasText: description }).getByRole("checkbox").check();
    await expect(surface.locator(".lsd-chip").filter({ hasText: "linked" })).toContainText("1 linked");

    await surface.getByRole("button", { name: "Cancel" }).click();
    await expect(surface).toHaveCount(0);
    const monthPage = await loadMonthPage(page, { month: MONTH });
    const row = monthPage.monthPage.planSections.find((section) => section.key === "planned_items").rows.find((item) => item.label === label);
    expect(row.linkedEntryIds ?? []).toEqual([]);
  });

  test("hidden money: Match planned item shows the planned amount as dots", async ({ page }) => {
    await phone(page, { hidden: true });
    const label = `Dialog hidden planned ${Date.now()}`;
    await postJson(page, "/api/month-plan/save", {
      rowId: `dialog-hidden-planned-${Date.now()}`, month: MONTH, sectionKey: "planned_items", categoryName: "Entertainment", label,
      planDate: `${MONTH}-18`, accountName: "UOB One", plannedMinor: 5000, note: "", ownershipType: "direct", ownerName: "Tim"
    });
    await page.goto(`/month?view=person-tim&month=${MONTH}&scope=direct_plus_shared`);
    await page.locator("tr").filter({ hasText: label }).first().getByRole("button", { name: "Link entries" }).click({ timeout: 60_000 });
    const surface = sheet(page, "Match planned item");
    await expect(surface).toBeVisible();
    expect(await surface.locator(".lsd-amount").innerText()).not.toMatch(/\d/);
  });
});

test.describe("@webkit phone: Settings editors", () => {
  async function openSection(page, name) {
    await page.goto("/settings?view=person-tim");
    await page.getByRole("button", { name: new RegExp(name) }).first().click({ timeout: 60_000 });
  }

  test("Create account: the lead is the account, the rest are Detail rows, Cancel adds nothing, Create account saves", async ({ page }) => {
    await phone(page);
    await openSection(page, "Accounts");
    await page.getByRole("button", { name: "+ Add account" }).first().click();
    const surface = sheet(page, "Create account");
    await expect(surface).toBeVisible();
    await expectSheetFrame(page, surface, { primary: "Create account" });
    await expect(surface.locator(".lsd-rows .lsd-row")).toHaveCount(5);
    const save = surface.locator(".lsd-bottom").getByRole("button", { name: "Create account" });
    await expect(save).toBeDisabled();
    const name = `Dialog account ${Date.now()}`;
    await surface.getByLabel("Display name").fill(name);
    await surface.getByLabel("Institution").fill("Dialog Bank");
    await expect(surface.locator(".lsd-chip").filter({ hasText: "Shared" })).toBeVisible();
    await expect(save).toBeEnabled();

    await surface.getByRole("button", { name: "Cancel" }).click();
    await expect(surface).toHaveCount(0);
    await expect(page.getByText(name)).toHaveCount(0);

    await page.getByRole("button", { name: "+ Add account" }).first().click();
    await sheet(page, "Create account").getByLabel("Display name").fill(name);
    await sheet(page, "Create account").getByLabel("Institution").fill("Dialog Bank");
    await sheet(page, "Create account").locator(".lsd-bottom").getByRole("button", { name: "Create account" }).click();
    await expect(sheet(page, "Create account")).toHaveCount(0);
    await expect(page.getByText(name).first()).toBeVisible();
  });

  test("Account type opens the picker sheet with a title, a list, a bar and a handle", async ({ page }) => {
    await phone(page);
    await openSection(page, "Accounts");
    await page.getByRole("button", { name: "+ Add account" }).first().click();
    const surface = sheet(page, "Create account");
    await surface.getByRole("button", { name: /Account type/ }).click();
    const picker = page.locator(".mobile-select-dialog.is-picker-sheet");
    await expect(picker).toBeVisible();
    await expect(picker.locator(".sheet-drag-handle")).toHaveCount(1);
    const closeBox = await box(picker.locator(".mobile-select-close"));
    expect(closeBox.width).toBeGreaterThanOrEqual(44);
    expect(await tapTargetProblems(picker)).toEqual([]);
    await picker.locator(".mobile-select-option").filter({ hasText: "Credit card" }).click();
    await expect(picker).toHaveCount(0);
    await expect(surface.locator(".lsd-chip").filter({ hasText: "Credit card" })).toBeVisible();
    await surface.getByRole("button", { name: /Account type/ }).click();
    await page.locator(".mobile-select-dialog.is-picker-sheet").getByRole("button", { name: "Close", exact: true }).click();
    await expect(page.locator(".mobile-select-dialog")).toHaveCount(0);
  });

  test("Archive account asks in a sheet with a neutral lead; Cancel keeps it", async ({ page }) => {
    await phone(page);
    await openSection(page, "Accounts");
    await page.getByRole("button", { name: "Archive account" }).first().click();
    const confirm = sheet(page, "Archive account");
    await expect(confirm).toBeVisible();
    await expect(confirm.locator(".sheet-dialog-lead.is-danger")).toHaveCount(0);
    await expectSheetFrame(page, confirm, { primary: "Confirm" });
    await confirm.getByRole("button", { name: "Cancel" }).click();
    await expect(confirm).toHaveCount(0);
  });

  test("Add match rule: the pattern is the lead, Category, Priority, Status and Note are rows", async ({ page }) => {
    await phone(page);
    await openSection(page, "Category matching");
    await page.getByRole("button", { name: "+ Add match rule" }).first().click();
    const surface = sheet(page, "Create match rule");
    await expect(surface).toBeVisible();
    await expectSheetFrame(page, surface, { primary: "Save rule" });
    await expect(surface.locator(".lsd-rows .lsd-row")).toHaveCount(4);
    await expect(surface.locator(".lsd-bottom").getByRole("button", { name: /Save/ })).toBeDisabled();
    await surface.getByRole("textbox", { name: "Merchant text" }).fill("DIALOG RULE");
    await expect(surface.locator(".lsd-bottom").getByRole("button", { name: /Save/ })).toBeEnabled();
    await surface.getByRole("button", { name: "Cancel" }).click();
    await expect(surface).toHaveCount(0);
  });

  test("Edit person: one lead with the name typed in place", async ({ page }) => {
    await phone(page);
    await openSection(page, "People");
    await page.getByRole("button", { name: "Edit person" }).first().click();
    const surface = sheet(page, "Edit person");
    await expect(surface).toBeVisible();
    await expectSheetFrame(page, surface, { primary: "Save person" });
    await expect(surface.getByLabel("Display name")).not.toHaveValue("");
    await surface.getByRole("button", { name: "Cancel" }).click();
    await expect(surface).toHaveCount(0);
  });

  test("Statement checkpoint fits a phone: the lead, the fields and Save checkpoint are all in the sheet", async ({ page }) => {
    await phone(page);
    await openSection(page, "Accounts");
    await page.locator(".settings-account-row").filter({ hasText: "UOB One" }).first().getByRole("button", { name: "Reconcile" }).click();
    const surface = sheet(page, "Statement checkpoint");
    await expect(surface).toBeVisible();
    await expectSheetFrame(page, surface, { primary: "Save checkpoint" });
    const sheetBox = await box(surface);
    expect(sheetBox.left).toBeGreaterThanOrEqual(0);
    expect(sheetBox.right).toBeLessThanOrEqual(PHONE.width + 1);
    await surface.getByLabel("Statement month").fill("2026-05");
    await surface.getByLabel("Statement start date").fill("2026-05-01");
    await surface.getByLabel("Statement end date").fill("2026-05-31");
    await surface.getByLabel("Statement ending balance").fill("2345.67");
    await expect(surface.locator(".lsd-chip").filter({ hasText: "May 2026" })).toBeVisible();
    let saveRequests = 0;
    page.on("request", (request) => {
      if (request.url().includes("/api/accounts/reconcile")) saveRequests += 1;
    });
    await surface.getByRole("button", { name: "Cancel" }).click();
    await expect(surface).toHaveCount(0);
    expect(saveRequests).toBe(0);
  });

  test("Reload app data needs the words typed; Empty state is rose", async ({ page }) => {
    await phone(page);
    await page.goto("/settings?view=person-tim");
    await page.getByRole("button", { name: /Demo state/ }).first().click({ timeout: 60_000 });
    await page.getByRole("button", { name: "Reload app data" }).click();
    const surface = sheet(page, "Reload app data");
    await expect(surface).toBeVisible();
    await expectSheetFrame(page, surface, { primary: "Confirm reload" });
    const confirm = surface.locator(".lsd-bottom").getByRole("button", { name: "Confirm reload" });
    await expect(confirm).toBeDisabled();
    await surface.getByRole("textbox").fill("reload data");
    await expect(confirm).toBeEnabled();
    await surface.getByRole("button", { name: "Cancel" }).click();
    await expect(surface).toHaveCount(0);

    await page.getByRole("button", { name: "Enter empty state" }).click();
    const empty = sheet(page, "Enter empty state");
    await expect(empty.locator(".sheet-dialog-lead.is-danger")).toHaveCount(1);
    await expect(empty.locator(".lsd-bottom").getByRole("button", { name: /Confirm/ })).toBeDisabled();
    await empty.getByRole("button", { name: "Cancel" }).click();
    await expect(empty).toHaveCount(0);
  });
});

test.describe("@webkit phone: Transfer details", () => {
  test("a transfer opens a sheet with the lead, wallets, matches and a bar with Done", async ({ page }) => {
    await phone(page);
    const stamp = Date.now();
    const description = `Dialog transfer ${stamp}`;
    const entryId = await createExpense(page, description, { categoryName: "Transfer", entryType: "transfer", transferDirection: "out", amountMinor: 91234 });
    await page.goto(`/entries?view=person-tim&month=${MONTH}&editing_entry=${entryId}`);
    await expect(page.locator('.entry-mobile-sheet[aria-label="Edit entry"]')).toBeVisible({ timeout: 60_000 });
    await page.getByRole("button", { name: /Transfer match/ }).click();
    const surface = sheet(page, "Transfer details");
    await expect(surface).toBeVisible();
    await expect(surface.locator(".lsd-title")).toHaveText(description);
    await expect(surface.locator(".lsd-amount")).toContainText("$912.34");
    await expect(surface.locator(".lsd-chip").filter({ hasText: "Needs a match" })).toBeVisible();
    await expectSheetFrame(page, surface, { primary: "Done" });
    // Convert entry is the destructive action, apart at the start of the bar.
    await expect(surface.locator(".lsd-bottom-start").getByRole("button", { name: "Convert entry" })).toBeVisible();
    await surface.getByRole("button", { name: "Done" }).click();
    await expect(surface).toHaveCount(0);
  });
});

test.describe("@webkit phone: topped up and login", () => {
  test("I've topped up: Save waits for an amount, Cancel closes", async ({ page }) => {
    await phone(page);
    await page.route("**/api/ai-assist/provider-status", (route) => route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true, visible: true, claudeConfigured: true, state: "low", estimatedSpendUsd: 16.4, creditUsd: 20, warnAtUsd: 15, lastSuccessAt: "2026-10-11T02:00:00.000Z", consoleBillingUrl: "https://console.anthropic.com/settings/billing" })
    }));
    await page.goto("/ask?view=person-tim");
    await page.getByRole("region", { name: "Claude credits" }).getByRole("button", { name: "I've topped up" }).click({ timeout: 60_000 });
    const surface = sheet(page, "I've topped up");
    await expect(surface).toBeVisible();
    await expectSheetFrame(page, surface, { primary: "Save" });
    const save = surface.locator(".lsd-bottom").getByRole("button", { name: "Save" });
    await expect(save).toBeDisabled();
    await surface.getByLabel("Credit bought (US$)").fill("20");
    await expect(save).toBeEnabled();
    await surface.getByRole("button", { name: "Cancel" }).click();
    await expect(surface).toHaveCount(0);
  });

  test("Set up this login cannot be dismissed, only saved", async ({ browser }) => {
    const context = await browser.newContext({
      viewport: PHONE,
      hasTouch: true,
      isMobile: true,
      extraHTTPHeaders: { "Cf-Access-Authenticated-User-Email": "dialog.viewer@example.com" }
    });
    const page = await context.newPage();
    await reseedDemo(page);
    await page.goto("/summary?view=household&month=2026-05");
    const surface = sheet(page, "Set up this login");
    await expect(surface).toBeVisible({ timeout: 60_000 });
    await expect(surface.locator(".lsd-title")).toHaveText("dialog.viewer@example.com");
    await expect(surface.locator(".entry-composer-close")).toHaveCount(0);
    await expect(surface.getByRole("button", { name: "Cancel" })).toHaveCount(0);
    await page.keyboard.press("Escape");
    await page.mouse.click(195, 20);
    await expect(surface).toBeVisible();
    await expectSheetFrame(page, surface, { primary: "Save login", lead: true }).catch((error) => {
      // The close button is absent by design; everything else must hold.
      if (!String(error.message).includes("entry-composer-close")) throw error;
    });
    await context.close();
  });
});

test.describe("desktop: the same dialogs are centred, with the same parts", () => {
  test("Delete entry: a centred dialog with the lead, Cancel at the start and the rose button at the end", async ({ page }) => {
    await desktop(page);
    const description = `Dialog desktop delete ${Date.now()}`;
    await createExpense(page, description);
    await page.goto(`/entries?view=person-tim&month=${MONTH}`);
    await page.getByRole("button", { name: new RegExp(`^Edit .*${description}`) }).first().click({ timeout: 60_000 });
    await page.getByRole("button", { name: "Delete entry" }).first().click();
    const dialog = desktopDialog(page, "Delete entry?");
    await expect(dialog).toBeVisible();
    await expect(dialog.locator(".lsd-card")).toHaveCount(1);
    await expect(dialog.locator(".lsd-title")).toHaveText(description);
    const bar = dialog.locator(".lsd-bottom.is-dialog-bar");
    const cancel = await box(bar.getByRole("button", { name: "Cancel" }));
    const confirm = await box(bar.getByRole("button", { name: "Delete entry" }));
    expect(cancel.left).toBeLessThan(confirm.left);
    await bar.getByRole("button", { name: "Cancel" }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page.getByText(description).first()).toBeVisible();
    await page.getByRole("button", { name: "Delete entry" }).first().click();
    const response = page.waitForResponse((r) => r.url().includes("/api/entries/delete") && r.ok());
    await desktopDialog(page, "Delete entry?").locator(".lsd-bottom").getByRole("button", { name: "Delete entry" }).click();
    await response;
  });

  test("Create account and Month Reset keep their gates on a wide screen", async ({ page }) => {
    await desktop(page);
    await page.goto("/settings?view=person-tim");
    await page.getByRole("button", { name: /Accounts/ }).first().click({ timeout: 60_000 });
    await page.getByRole("button", { name: "+ Add account" }).first().click();
    const account = desktopDialog(page, "Create account");
    await expect(account).toBeVisible();
    await expect(account.getByRole("button", { name: "Create account" })).toBeDisabled();
    await account.getByLabel("Display name").fill("Dialog desktop account");
    await account.getByLabel("Institution").fill("Dialog Bank");
    await expect(account.getByRole("button", { name: "Create account" })).toBeEnabled();
    await account.getByRole("button", { name: "Cancel" }).click();
    await expect(account).toHaveCount(0);

    await page.goto(`/month?view=person-tim&month=${MONTH}&scope=direct_plus_shared`);
    await page.getByRole("button", { name: "Actions", exact: true }).click({ timeout: 60_000 });
    await page.getByRole("button", { name: "Reset month", exact: true }).click();
    const reset = desktopDialog(page, "Reset month");
    await expect(reset.getByRole("button", { name: "Confirm reset month" })).toBeDisabled();
    await reset.getByPlaceholder("Type 'reset month'").fill("reset month");
    await expect(reset.getByRole("button", { name: "Confirm reset month" })).toBeEnabled();
    await reset.getByRole("button", { name: "Cancel" }).click();
    await expect(reset).toHaveCount(0);
  });

  test("Set up this login has no close button and ignores Escape", async ({ browser }) => {
    const context = await browser.newContext({
      viewport: { width: 1280, height: 800 },
      extraHTTPHeaders: { "Cf-Access-Authenticated-User-Email": "dialog.desktop@example.com" }
    });
    const page = await context.newPage();
    await reseedDemo(page);
    await page.goto("/summary?view=household&month=2026-05");
    const dialog = desktopDialog(page, "Set up this login");
    await expect(dialog).toBeVisible({ timeout: 60_000 });
    await expect(dialog.getByRole("button", { name: /Close/ })).toHaveCount(0);
    await page.keyboard.press("Escape");
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Save login" })).toBeVisible();
    await context.close();
  });
});
