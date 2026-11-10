import { expect, test } from "@playwright/test";

import { loadEntriesPage, loadSplitsPage, postJson, reseedDemo, pickCategory } from "./helpers";

// The Entries edit sheet and New split expense in the Lead · Support ·
// Detail style (design.md): one lead card, Support chips, quiet Detail rows
// and a bottom bar with the primary action under the thumb. These prove the
// sheets save what the forms saved, keep the statement lock and the in-app
// delete confirmation, keep every tap target at 44 px or more with 8 px
// between neighbours, and hide money with no tone or sign.
//
// Tagged @webkit: `npm run test:e2e:webkit` runs them in WebKit on an
// iPhone 13 profile too (390 x 664, as below).

const PHONE = { width: 390, height: 664 };
const MONTH = "2026-05";
const INK = { text: "rgb(53, 43, 36)", rose: "rgb(147, 54, 41)" };

async function phone(page, { hidden = false } = {}) {
  await page.addInitScript((value) => window.localStorage.setItem("monies-map:money-totals-visible", value), hidden ? "false" : "true");
  await page.setViewportSize(PHONE);
  // Reseed before the first page load, so the household's people are the
  // demo's from the start.
  await reseedDemo(page);
}

async function createManualEntry(page, description, patch = {}) {
  const { entryId } = await postJson(page, "/api/entries/create", {
    date: `${MONTH}-24`,
    description,
    accountName: "UOB One",
    categoryName: "Groceries",
    amountMinor: 3210,
    entryType: "expense",
    ownershipType: "direct",
    ownerName: "Tim",
    ...patch
  });
  return entryId;
}

// A savings account with one certified purchase: the statement import locks
// its bank facts (the same set-up as entries-certified-type.spec.js).
async function createCertifiedPurchase(page) {
  const accountName = `Lead Sheet Savings ${Date.now()}`;
  const { accountId } = await postJson(page, "/api/accounts/create", {
    name: accountName,
    institution: "Synthetic Test Bank",
    kind: "bank",
    openingBalanceMinor: 0,
    currency: "SGD",
    ownerPersonId: "",
    isJoint: false
  });
  const { entryId } = await postJson(page, "/api/entries/create", {
    accountId, accountName, ownershipType: "direct", ownerName: "Tim",
    date: `${MONTH}-21`, description: "NTUC FAIRPRICE", categoryName: "Groceries", amountMinor: 1_250, entryType: "expense"
  });
  const statementCheckpoints = [{
    accountId,
    accountName,
    detectedAccountName: accountName,
    checkpointMonth: MONTH,
    statementStartDate: `${MONTH}-01`,
    statementEndDate: `${MONTH}-31`,
    statementBalanceMinor: -1_250,
    note: "Lead sheet checkpoint"
  }];
  const preview = await postJson(page, "/api/imports/preview", {
    sourceLabel: "Lead sheet statement",
    sourceType: "pdf",
    rows: [{ date: `${MONTH}-21`, description: "NTUC FAIRPRICE", expense: "12.50", accountId, account: accountName, category: "Groceries" }],
    defaultAccountName: accountName,
    ownershipType: "direct",
    ownerName: "Tim",
    statementCheckpoints
  });
  const previewRows = preview.preview.previewRows;
  expect(previewRows.map((row) => row.reconciliationTargetTransactionId)).toEqual([entryId]);
  await postJson(page, "/api/imports/commit", {
    sourceLabel: "Lead sheet statement",
    sourceType: "pdf",
    parserKey: "uob_savings_pdf",
    rows: previewRows.filter((row) => row.commitStatus === "included"),
    statementCheckpoints,
    statementControlRows: previewRows,
    statementReconciliations: preview.preview.statementReconciliations
  });
  return { entryId, accountName };
}

async function openEditSheet(page, entryId) {
  await page.goto(`/entries?view=person-tim&month=${MONTH}&editing_entry=${entryId}`);
  const sheet = page.locator('.entry-mobile-sheet[aria-label="Edit entry"]');
  await expect(sheet).toBeVisible({ timeout: 60_000 });
  return sheet;
}

async function openCreateExpense(page) {
  await page.goto(`/splits?view=person-tim&month=2025-10&split_group=split-group-none&split_action=add-expense`);
  const dialog = page.getByRole("dialog", { name: "New split expense" });
  await expect(dialog).toBeVisible({ timeout: 60_000 });
  return dialog;
}

async function savedEntry(page, entryId) {
  const payload = await loadEntriesPage(page, { view: "person-tim", month: MONTH });
  return payload.monthPage.entries.find((entry) => entry.id === entryId);
}

function box(locator) {
  return locator.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height, bottom: rect.bottom, right: rect.right };
  });
}

// Every visible tappable inside `scope`: at least 44 x 44, and at least 8 px
// clear of any other tappable it sits beside.
async function tapTargets(scope) {
  return scope.evaluate((root) => {
    const selector = "button, [role='button'], a[href], select, input:not([type='hidden']), textarea, label.lsd-row";
    const seen = new Set();
    const targets = [];
    for (const element of root.querySelectorAll(selector)) {
      // A field inside a row label is reached through the whole row.
      const target = element.closest("label.lsd-row") ?? element;
      if (seen.has(target)) continue;
      seen.add(target);
      const rect = target.getBoundingClientRect();
      const style = getComputedStyle(target);
      if (rect.width === 0 || rect.height === 0 || style.visibility === "hidden" || target.closest("[aria-hidden='true']")) continue;
      // Only what is on top at its centre can be tapped (a row scrolled
      // under the bottom bar is not).
      const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
      const onTop = Boolean(hit && (target === hit || target.contains(hit)));
      // A target the sheet's scroll area cuts through is measured where it
      // shows in full (the sheet test checks at its top and its bottom).
      const scroller = target.closest(".entry-mobile-sheet-scroll");
      const view = scroller?.getBoundingClientRect();
      const clipped = Boolean(view && (rect.top < view.top - 1 || rect.bottom > view.bottom + 1));
      targets.push({
        onTop,
        clipped,
        name: (target.getAttribute("aria-label") || target.textContent || target.className).trim().replace(/\s+/g, " ").slice(0, 40),
        width: Math.round(rect.width * 10) / 10,
        height: Math.round(rect.height * 10) / 10,
        rect: { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom }
      });
    }
    return targets;
  });
}

function gapBetween(a, b) {
  const horizontal = Math.max(a.left - b.right, b.left - a.right);
  const vertical = Math.max(a.top - b.bottom, b.top - a.bottom);
  return Math.max(horizontal, vertical);
}

// Rows in one rounded group touch each other by design (a 1 px line between
// them is the row edge); they are full-width and 44 px or taller, so only
// targets side by side or in different groups need the 8 px gap.
function crowdedPairs(allTargets) {
  const targets = allTargets.filter((target) => target.onTop && !target.clipped);
  const pairs = [];
  for (let i = 0; i < targets.length; i += 1) {
    for (let j = i + 1; j < targets.length; j += 1) {
      const a = targets[i].rect;
      const b = targets[j].rect;
      const stacked = Math.abs(a.left - b.left) < 2 && Math.abs(a.right - b.right) < 2;
      if (stacked) continue;
      const gap = gapBetween(a, b);
      if (gap < 8) pairs.push(`${targets[i].name} | ${targets[j].name}: ${gap.toFixed(1)}px`);
    }
  }
  return pairs;
}

test.describe("Lead · Support · Detail sheets on a phone", { tag: "@webkit" }, () => {
  test("the edit sheet saves what the form saved, with Save in the bottom bar", async ({ page }) => {
    await phone(page);
    const description = `Lead sheet edit ${Date.now()}`;
    const entryId = await createManualEntry(page, description);
    const sheet = await openEditSheet(page, entryId);

    // Lead: what it was and the amount, typed in place; Support chips.
    const lead = sheet.locator(".lsd-card");
    await expect(lead.getByRole("textbox", { name: "Description" })).toHaveValue(description);
    // A manual entry saved as "32.1" reads as money until it is typed in.
    await expect(lead.getByRole("textbox", { name: "Amount" })).toHaveValue("32.10");
    await expect(lead.locator(".lsd-subtitle")).toHaveText("Groceries");
    await expect(lead.locator(".lsd-chip")).toHaveText(["Sun 24 May", "UOB One", "Tim", "Manual provisional"]);
    // Detail rows in the agreed order, the bank facts folded with a hint.
    // The Splits row and its quick add share one wrapper (the quick add
    // sits on its own line under the row on a phone).
    await expect(sheet.locator(".lsd-rows > .lsd-row, .lsd-rows > .lsd-row-group > .lsd-row, .lsd-rows > .entry-split-action-row > .lsd-row").locator(".lsd-row-label"))
      .toHaveText(["Category", "Trip or event", "Owner", "Splits", "Note", "More details"]);
    await expect(sheet.locator(".entry-split-action-row > *")).toHaveText(["SplitsAdd to splits", /^Add to .+ · Half each$/]);
    await expect(sheet.locator(".lsd-row-more")).toContainText("Date, wallet, time, posted date, type");
    await expect(sheet.locator("[data-row='splits']")).toContainText("Add to splits");

    // Nothing changed yet: Save is disabled, and sits at the bottom.
    const save = sheet.getByRole("button", { name: "Save", exact: true });
    await expect(save).toBeDisabled();
    const saveBox = await box(save);
    expect(saveBox.bottom).toBeGreaterThan(PHONE.height - 80);
    expect(saveBox.right).toBeGreaterThan(PHONE.width - 40);
    await expect(sheet.getByRole("button", { name: "Delete entry" })).toBeVisible();

    await lead.getByRole("textbox", { name: "Description" }).fill(`${description} renamed`);
    // While typing the field is the raw text; left, it is money again.
    await lead.getByRole("textbox", { name: "Amount" }).fill("48.7");
    await expect(lead.getByRole("textbox", { name: "Amount" })).toHaveValue("48.7");
    await lead.getByRole("textbox", { name: "Amount" }).blur();
    await expect(lead.getByRole("textbox", { name: "Amount" })).toHaveValue("48.70");
    await lead.getByRole("textbox", { name: "Amount" }).fill("48.76");
    await lead.getByRole("textbox", { name: "Amount" }).blur();
    await sheet.getByRole("textbox", { name: "Note", exact: true }).fill("Shelf brackets");

    await sheet.locator("[data-row='category']").click();
    const categoryPicker = page.getByRole("dialog", { name: "Category" });
    await categoryPicker.locator("[data-category-option='Home']").click();
    await expect(categoryPicker).toHaveCount(0);
    await expect(lead.locator(".lsd-subtitle")).toHaveText("Home");

    // The other person in the household (the owner picker lists the people).
    await sheet.locator("[data-row='owner']").click();
    const ownerPicker = page.getByRole("dialog", { name: "Owner" });
    const otherOwner = ownerPicker.locator(".mobile-select-option:not(.is-selected)").first();
    const otherOwnerName = (await otherOwner.innerText()).trim();
    await otherOwner.click();
    await expect(sheet.locator("[data-row='owner']")).toContainText(otherOwnerName);

    await sheet.getByRole("button", { name: /More details/ }).click();
    await sheet.getByLabel("Date", { exact: true }).fill(`${MONTH}-23`);
    await expect(sheet.locator("[data-row='date']")).toContainText("Sat 23 May 2026");

    await expect(save).toBeEnabled();
    const update = page.waitForRequest((request) => request.url().includes("/api/entries/update"));
    await save.click();
    expect((await update).postDataJSON()).toMatchObject({
      entryId,
      date: `${MONTH}-23`,
      description: `${description} renamed`,
      categoryName: "Home",
      amountMinor: 4876,
      entryType: "expense",
      ownershipType: "direct",
      ownerName: otherOwnerName,
      note: "Shelf brackets"
    });
    await expect(sheet).toHaveCount(0);

    await expect.poll(async () => {
      const saved = await savedEntry(page, entryId);
      return saved && { description: saved.description, amountMinor: saved.amountMinor, categoryName: saved.categoryName, ownerName: saved.ownerName, note: saved.note, date: saved.date };
    }).toEqual({ description: `${description} renamed`, amountMinor: 4876, categoryName: "Home", ownerName: otherOwnerName, note: "Shelf brackets", date: `${MONTH}-23` });
  });

  test("a certified entry keeps its bank facts locked in the sheet", async ({ page }) => {
    await phone(page);
    const { entryId, accountName } = await createCertifiedPurchase(page);
    const sheet = await openEditSheet(page, entryId);
    const lead = sheet.locator(".lsd-card");

    await expect(lead.getByRole("textbox", { name: "Description" })).toHaveAttribute("readonly", "");
    await expect(lead.getByRole("textbox", { name: "Amount" })).toHaveCount(0);
    await expect(lead.locator(".lsd-amount")).toHaveText("−$12.50");
    await expect(lead.locator(".lsd-chip.is-mint")).toHaveText("Statement certified");
    await expect(lead.locator(".lsd-chip")).toContainText([accountName]);
    await expect(sheet.locator(".entry-edit-lock-message")).toHaveText(
      "Bank details are locked to the statement. Category, owner, note and splits stay editable."
    );
    // The full rule stays on the lock chip, for a hover and a screen reader.
    const lockChip = lead.locator(".lsd-chip.is-mint");
    await expect(lockChip).toHaveAttribute("title", "This row is statement certified. Description, date, posted date, wallet and amount are locked to the saved statement. Type can switch between Expense and Transfer out, and you can change the note, category, owner or splits.");
    await expect(lockChip).toHaveAccessibleDescription("This row is statement certified. Description, date, posted date, wallet and amount are locked to the saved statement. Type can switch between Expense and Transfer out, and you can change the note, category, owner or splits.");

    await sheet.getByRole("button", { name: /More details/ }).click();
    // Date and wallet are in the chips only; posted date is a locked line.
    await expect(sheet.locator("[data-row='date'], [data-row='wallet']")).toHaveCount(0);
    const postDate = sheet.locator("[data-row='postDate']");
    await expect(postDate).toHaveClass(/is-locked/);
    await expect(postDate.locator("input")).toHaveCount(0);
    await sheet.locator("[data-row='type']").click();
    const typePicker = page.getByRole("dialog", { name: "Type" });
    await expect(typePicker.locator(".mobile-select-option")).toHaveText(["Expense", "Transfer"]);
    await typePicker.getByRole("button", { name: /Close type/ }).click();

    // A note still saves, and the bank facts are unchanged.
    await sheet.getByRole("textbox", { name: "Note", exact: true }).fill("Certified note");
    const update = page.waitForResponse((response) => response.url().includes("/api/entries/update"));
    await sheet.getByRole("button", { name: "Save", exact: true }).click();
    expect((await update).ok()).toBe(true);
    const saved = await savedEntry(page, entryId);
    expect({ note: saved.note, amountMinor: saved.amountMinor, date: saved.date, bankCertificationStatus: saved.bankCertificationStatus })
      .toEqual({ note: "Certified note", amountMinor: 1_250, date: `${MONTH}-21`, bankCertificationStatus: "statement_certified" });
  });

  test("Delete entry at the bottom asks in the app before deleting", async ({ page }) => {
    await phone(page);
    const description = `Lead sheet delete ${Date.now()}`;
    const entryId = await createManualEntry(page, description);
    const browserDialogs = [];
    page.on("dialog", (dialog) => {
      browserDialogs.push(dialog.type());
      void dialog.dismiss();
    });
    let deletes = 0;
    page.on("request", (request) => {
      if (request.url().includes("/api/entries/delete")) deletes += 1;
    });

    const sheet = await openEditSheet(page, entryId);
    const deleteButton = sheet.getByRole("button", { name: "Delete entry" });
    // Destructive, so rose and apart from Cancel and Save.
    await expect(deleteButton).toHaveCSS("color", INK.rose);
    const [deleteBox, cancelBox] = await Promise.all([box(deleteButton), box(sheet.getByRole("button", { name: /^(Close|Cancel)$/ }))]);
    expect(cancelBox.x - (deleteBox.x + deleteBox.width)).toBeGreaterThanOrEqual(8);

    await deleteButton.click();
    const confirm = page.getByRole("dialog", { name: "Delete entry?" });
    await expect(confirm).toBeVisible();
    await page.waitForTimeout(200);
    expect(deletes).toBe(0);
    await confirm.getByRole("button", { name: "Cancel" }).click();
    await expect(confirm).toHaveCount(0);
    await expect(sheet).toBeVisible();

    await deleteButton.click();
    const deleted = page.waitForResponse((response) => response.url().includes("/api/entries/delete") && response.ok());
    await confirm.getByRole("button", { name: "Delete entry" }).click();
    await deleted;
    expect(deletes).toBe(1);
    expect(browserDialogs).toEqual([]);
    await expect.poll(async () => Boolean(await savedEntry(page, entryId))).toBe(false);
  });

  // The edit sheet reads the amount exactly as the old form did (no new
  // check was added): text that is not a number reads as zero when the
  // field is left. A follow-up is proposed for a refusal with its own copy.
  test("an amount that is not a number reads as the form read it, and Save sends what is shown", async ({ page }) => {
    await phone(page);
    const description = `Lead sheet bad amount ${Date.now()}`;
    const entryId = await createManualEntry(page, description);
    const sheet = await openEditSheet(page, entryId);
    const amount = sheet.locator(".lsd-card").getByRole("textbox", { name: "Amount" });
    await amount.fill("abc");
    await sheet.locator(".entry-composer-head").click();
    await expect(amount).toHaveValue("0.00");
    await amount.fill("12.5");
    await sheet.locator(".entry-composer-head").click();
    await expect(amount).toHaveValue("12.50");
    const update = page.waitForRequest((request) => request.url().includes("/api/entries/update"));
    await sheet.getByRole("button", { name: "Save", exact: true }).click();
    expect((await update).postDataJSON()).toMatchObject({ entryId, amountMinor: 1250 });
    await expect(sheet).toHaveCount(0);
  });

  test("every tap target in the edit sheet is 44 px or more with room around it", async ({ page }) => {
    await phone(page);
    const entryId = await createManualEntry(page, `Lead sheet targets ${Date.now()}`);
    const sheet = await openEditSheet(page, entryId);
    await sheet.getByRole("button", { name: /More details/ }).click();
    // Measured with the sheet scrolled to its top, then to its bottom, so
    // every target is seen in full once (the lead's tappable chips too).
    const measured = new Set();
    for (const edge of ["top", "bottom"]) {
      await sheet.locator(".entry-mobile-sheet-scroll").evaluate((scroller, where) => {
        scroller.scrollTop = where === "top" ? 0 : scroller.scrollHeight;
      }, edge);
      const targets = await tapTargets(sheet);
      const small = targets.filter((target) => !target.clipped && (target.width < 44 || target.height < 44)).map((target) => `${target.name} ${target.width}x${target.height}`);
      expect(small).toEqual([]);
      expect(crowdedPairs(targets)).toEqual([]);
      targets.filter((target) => !target.clipped).forEach((target) => measured.add(target.name));
    }
    expect(measured.size).toBeGreaterThan(12);
    expect([...measured]).toEqual(expect.arrayContaining(["Change date, Sun 24 May", "Change wallet, UOB One", "Change owner, Tim"]));
    // The numeric field brings up the number keypad.
    await expect(sheet.locator(".lsd-card").getByRole("textbox", { name: "Amount" })).toHaveAttribute("inputmode", "decimal");
  });

  test("hidden money shows no amount, tone or sign in the sheet", async ({ page }) => {
    await phone(page, { hidden: true });
    const { entryId } = await createCertifiedPurchase(page);
    const sheet = await openEditSheet(page, entryId);
    const amount = sheet.locator(".lsd-card .lsd-amount");
    await expect(amount).toHaveText("••••");
    await expect(amount).toHaveCSS("color", INK.text);
    await expect(amount.locator(".lsd-amount-sign")).toBeHidden();

    // Revealing from the sheet's own eye shows the rose expense amount.
    await sheet.getByRole("button", { name: "Show money totals" }).click();
    await expect(amount).toHaveText("−$12.50");
    await expect(amount).toHaveCSS("color", INK.rose);
  });

  test("hidden money masks the amount being typed and its sign", async ({ page }) => {
    await phone(page, { hidden: true });
    const entryId = await createManualEntry(page, `Lead sheet hidden ${Date.now()}`);
    const sheet = await openEditSheet(page, entryId);
    const input = sheet.locator(".lsd-card").getByRole("textbox", { name: "Amount" });
    await expect(input).toHaveCSS("-webkit-text-security", "disc");
    await expect(sheet.locator(".lsd-card .lsd-amount")).toHaveCSS("color", INK.text);
    await expect(sheet.locator(".lsd-card .lsd-amount-sign")).toBeHidden();
  });

  test("New split expense saves an even split's total and shares as the form did", async ({ page }) => {
    await phone(page);
    const description = `Lead split even ${Date.now()}`;
    const dialog = await openCreateExpense(page);
    const lead = dialog.locator(".lsd-card");

    await expect(lead.locator(".lsd-chip")).toHaveText(["Today", "Paid by Tim", "50 / 50", "Cash"]);
    await expect(dialog.locator(".lsd-rows .lsd-row-label").first()).toHaveText("Tim’s share");
    await lead.getByRole("textbox", { name: "Expense total" }).fill("86.40");
    await lead.getByRole("textbox", { name: "Description" }).fill(description);
    await lead.getByRole("textbox", { name: "Description" }).blur();
    await expect(lead.getByRole("textbox", { name: "Expense total" })).toHaveValue("86.40");
    const shares = dialog.getByRole("group", { name: "Split share amounts" });
    await expect(shares.locator(".lsd-row")).toHaveText(["Tim’s share50% · $43.20", "Joyce’s share50% · $43.20"]);

    const save = dialog.getByRole("button", { name: "Save expense" });
    const saveBox = await box(save);
    expect(saveBox.bottom).toBeGreaterThan(PHONE.height - 80);
    const create = page.waitForRequest((request) => request.url().includes("/api/splits/expenses/create"));
    await save.click();
    expect((await create).postDataJSON()).toMatchObject({
      groupId: null,
      description,
      payerPersonName: "Tim",
      amountMinor: 8640,
      splitBasisPoints: 5000,
      splitAmountMinor: 4320
    });
    await expect(dialog).toHaveCount(0);

    const data = await loadSplitsPage(page, { view: "person-tim", month: "2025-10" });
    const saved = data.splitsPage.activity.find((item) => item.description === description);
    expect(saved.totalAmountMinor).toBe(8640);
    expect(saved.shares).toEqual(expect.arrayContaining([
      expect.objectContaining({ personName: "Tim", amountMinor: 4320 }),
      expect.objectContaining({ personName: "Joyce", amountMinor: 4320 })
    ]));
  });

  test("the share editor keeps percent and amount linked for an uneven split", async ({ page }) => {
    await phone(page);
    const description = `Lead split uneven ${Date.now()}`;
    const dialog = await openCreateExpense(page);
    const lead = dialog.locator(".lsd-card");
    await lead.getByRole("textbox", { name: "Expense total" }).fill("86.40");
    await lead.getByRole("textbox", { name: "Description" }).fill(description);

    // The editor opens from a share row.
    await expect(dialog.getByLabel("Tim share %")).toHaveCount(0);
    await dialog.locator("[data-share-row='Tim']").click();
    await expect(dialog.locator("[data-share-row='Tim']")).toHaveAttribute("aria-expanded", "true");
    await dialog.getByLabel("Tim share %").fill("25");
    await dialog.getByLabel("Tim share %").blur();
    await expect(dialog.getByLabel("Tim share amount")).toHaveValue("21.60");
    const shares = dialog.getByRole("group", { name: "Split share amounts" });
    await expect(shares.locator(".lsd-row")).toHaveText(["Tim’s share25% · $21.60", "Joyce’s share75% · $64.80"]);
    await expect(lead.locator(".lsd-chip").nth(2)).toHaveText("25 / 75");

    // Typing the amount moves the percent, as the old exact amount field did.
    await dialog.getByLabel("Tim share amount").fill("30");
    await dialog.getByLabel("Tim share amount").blur();
    await expect(dialog.getByLabel("Tim share %")).toHaveValue("34.72");
    await expect(shares.locator(".lsd-row")).toHaveText(["Tim’s share34.72% · $30.00", "Joyce’s share65.28% · $56.40"]);

    const create = page.waitForRequest((request) => request.url().includes("/api/splits/expenses/create"));
    await dialog.getByRole("button", { name: "Save expense" }).click();
    expect((await create).postDataJSON()).toMatchObject({ amountMinor: 8640, splitBasisPoints: 3472, splitAmountMinor: 3000 });
    await expect(dialog).toHaveCount(0);
    const data = await loadSplitsPage(page, { view: "person-tim", month: "2025-10" });
    const saved = data.splitsPage.activity.find((item) => item.description === description);
    expect(saved.shares).toEqual(expect.arrayContaining([
      expect.objectContaining({ personName: "Tim", amountMinor: 3000 }),
      expect.objectContaining({ personName: "Joyce", amountMinor: 5640 })
    ]));
  });

  test("a split expense without a total is refused with the existing error and nothing is sent", async ({ page }) => {
    await phone(page);
    const dialog = await openCreateExpense(page);
    let creates = 0;
    page.on("request", (request) => {
      if (request.url().includes("/api/splits/expenses/create")) creates += 1;
    });
    await dialog.locator(".lsd-card").getByRole("textbox", { name: "Description" }).fill("No total yet");
    await dialog.getByRole("button", { name: "Save expense" }).click();
    await expect(dialog.getByText("Expense amount must be greater than zero.")).toBeVisible();
    await expect(dialog).toBeVisible();

    // A share bigger than the total is held at the total, so the shares
    // always add up to it.
    await dialog.locator(".lsd-card").getByRole("textbox", { name: "Expense total" }).fill("20");
    await dialog.locator("[data-share-row='Tim']").click();
    await dialog.getByLabel("Tim share amount").fill("35");
    await dialog.getByLabel("Tim share amount").blur();
    await expect(dialog.getByLabel("Tim share amount")).toHaveValue("20.00");
    await expect(dialog.getByRole("group", { name: "Split share amounts" }).locator(".lsd-row"))
      .toHaveText(["Tim’s share100% · $20.00", "Joyce’s share0% · $0.00"]);

    await dialog.locator(".lsd-card").getByRole("textbox", { name: "Description" }).fill("");
    await dialog.getByRole("button", { name: "Save expense" }).click();
    await expect(dialog.getByText("Expense description, date, payer, and category are required.")).toBeVisible();
    await page.waitForTimeout(200);
    expect(creates).toBe(0);
  });

  test("every tap target in New split expense is 44 px or more with room around it", async ({ page }) => {
    await phone(page);
    const dialog = await openCreateExpense(page);
    await dialog.locator(".lsd-card").getByRole("textbox", { name: "Expense total" }).fill("10.01");
    await dialog.locator("[data-share-row='Tim']").click();
    await dialog.getByRole("button", { name: /More details/ }).click();
    const targets = await tapTargets(dialog);
    const small = targets.filter((target) => target.width < 44 || target.height < 44).map((target) => `${target.name} ${target.width}x${target.height}`);
    expect(small).toEqual([]);
    expect(crowdedPairs(targets)).toEqual([]);
    await expect(dialog.locator(".lsd-card").getByRole("textbox", { name: "Expense total" })).toHaveAttribute("inputmode", "decimal");
    await expect(dialog.getByLabel("Tim share %")).toHaveAttribute("inputmode", "decimal");
    await expect(dialog.getByLabel("Tim share amount")).toHaveAttribute("inputmode", "decimal");
  });

  test("hidden money masks the split total and its shares", async ({ page }) => {
    await phone(page, { hidden: true });
    const dialog = await openCreateExpense(page);
    const total = dialog.locator(".lsd-card").getByRole("textbox", { name: "Expense total" });
    await total.fill("86.40");
    await total.blur();
    await expect(total).toHaveCSS("-webkit-text-security", "disc");
    await expect(dialog.getByRole("group", { name: "Split share amounts" }).locator(".lsd-row"))
      .toHaveText(["Tim’s share50% · ••••", "Joyce’s share50% · ••••"]);
  });
});

test("desktop: the inline editor keeps its fields in Tab order and saves as before", async ({ page }) => {
  await page.addInitScript(() => window.localStorage.setItem("monies-map:money-totals-visible", "true"));
  await reseedDemo(page);
  const description = `Lead inline edit ${Date.now()}`;
  const entryId = await createManualEntry(page, description);
  await page.goto(`/entries?view=person-tim&month=${MONTH}&editing_entry=${entryId}`);
  const editor = page.locator(".entry-inline-editor .entry-edit-card.is-inline");
  await expect(editor).toBeVisible({ timeout: 60_000 });

  // The lead card spans the top, the rows sit under it in two columns, and
  // every row keeps an inline field.
  const [cardBox, rowsBox] = await Promise.all([box(editor.locator(".lsd-card")), box(editor.locator(".lsd-rows"))]);
  expect(rowsBox.y).toBeGreaterThan(cardBox.y + cardBox.height - 1);
  expect(cardBox.width).toBeGreaterThan(rowsBox.width - 4);
  const columnXs = await editor.locator(".lsd-rows .lsd-row").evaluateAll((rows) => [...new Set(rows.map((row) => Math.round(row.getBoundingClientRect().x)))]);
  expect(columnXs).toHaveLength(2);
  // Date, Wallet and Owner are the lead's chips: no row repeats them.
  await expect(editor.locator(".lsd-rows .lsd-row-label")).toHaveText(["Category", "Trip or event", "Splits", "Note", "Time", "Posted date", "Type"]);

  // Tab walks description, amount, then the rows in order (a date field's
  // day, month and year parts are one stop here).
  await editor.getByRole("textbox", { name: "Description" }).focus();
  const order = [];
  // The tappable Support chips (date, wallet, owner) are their own fields on
  // a wide screen: they come after the lead's fields, before the rows
  // (design.md, "Tappable chips").
  // The Splits quick add sits beside the Splits row on a wide screen and
  // comes right after it.
  for (let step = 0; step < 16 && order.length < 10; step += 1) {
    await page.keyboard.press("Tab");
    const name = await page.evaluate(() => document.activeElement?.getAttribute("aria-label") || document.activeElement?.textContent?.trim().slice(0, 30));
    if (order.at(-1) !== name) order.push(name);
  }
  expect(order.slice(0, 10)).toEqual([
    "Amount", "Hide money totals", "Change date, Sun 24 May", "Change wallet, UOB One", "Change owner, Tim",
    "CategoryGroceries", "Trip or eventNone", "SplitsAdd to splits", expect.stringMatching(/^Add to .+ · Half each$/), "Note"
  ]);

  await editor.getByRole("textbox", { name: "Amount" }).fill("12.34");
  await pickCategory(page, editor.locator("[data-row='category']"), "Home");
  const update = page.waitForRequest((request) => request.url().includes("/api/entries/update"));
  await page.getByRole("button", { name: "Done editing entry" }).click();
  // A category change asks first whether to save it now (as before).
  expect((await update).postDataJSON()).toMatchObject({ entryId, amountMinor: 1234, categoryName: "Home", description });
});
