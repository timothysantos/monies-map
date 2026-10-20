import { devices, expect, test } from "@playwright/test";

import { categoryList, chooseStudio, gotoPageAfterApi, openRecentImports, postJson, reseedDemo } from "./helpers";

// Guard: every dialog and sheet gives the page its scrolling back when it
// closes, however it closes (its own button, Escape, a tap on the backdrop,
// or an action that closes it, such as Use match), and when a category list
// was open inside it, or when it closed together with the sheet it was opened
// from. Owner report 2026-10-20: after linking a transfer from Edit entry
// (Manage transfer, Use match) the dialog and the Edit entry sheet closed
// together and the page no longer scrolled.
//
// "Scrolls" is checked the way a person would notice: a wheel turn over the
// page moves it, <html> and <body> are not left `overflow: hidden` or
// `position: fixed`, no scroll-lock attribute or `pointer-events: none` is
// left on <body>, the page is not left hidden from assistive tech, and a hit
// test in the middle of the screen lands on the page, not on a leftover
// backdrop. The phone tests are tagged @webkit, so `npm run test:e2e:webkit`
// runs them in WebKit too (keyboard scroll there: mobile WebKit has no wheel).

const MONTH = "2026-05";
const { defaultBrowserType: _browser, ...iPhone13 } = devices["iPhone 13"];

const SCREENS = [
  { name: "phone 390x664", phone: true, use: { ...iPhone13, hasTouch: true, viewport: { width: 390, height: 664 } } },
  { name: "desktop 1440x900", phone: false, use: { viewport: { width: 1440, height: 900 } } }
];

const press = (screen, locator) => (screen.phone ? locator.tap() : locator.click());

async function lockState(page) {
  return page.evaluate(() => {
    const html = document.documentElement;
    const { body } = document;
    const htmlStyle = getComputedStyle(html);
    const bodyStyle = getComputedStyle(body);
    const hit = document.elementFromPoint(window.innerWidth / 2, window.innerHeight / 2);
    return {
      htmlOverflow: htmlStyle.overflowY,
      bodyOverflow: bodyStyle.overflowY,
      bodyPosition: bodyStyle.position,
      bodyPointerEvents: bodyStyle.pointerEvents,
      scrollLockedAttribute: body.getAttribute("data-scroll-locked"),
      appHidden: Boolean(document.querySelector("#root[aria-hidden='true'], #root[inert]")),
      leftoverOverlay: Boolean(hit?.closest(".entry-composer-overlay, .note-dialog-overlay, [role='dialog'], [data-radix-popper-content-wrapper]")),
      openDialogs: document.querySelectorAll("[role='dialog'], [role='alertdialog']").length
    };
  });
}

async function expectPageScrolls(page, { requireScrollable = true } = {}) {
  await expect.poll(() => page.evaluate(() => document.querySelectorAll("[role='dialog'], [role='alertdialog']").length)).toBe(0);
  const state = await lockState(page);
  expect(state).toEqual({
    htmlOverflow: expect.not.stringMatching(/hidden|clip/),
    bodyOverflow: expect.not.stringMatching(/hidden|clip/),
    bodyPosition: expect.not.stringMatching(/fixed/),
    bodyPointerEvents: expect.not.stringMatching(/none/),
    scrollLockedAttribute: null,
    appHidden: false,
    leftoverOverlay: false,
    openDialogs: 0
  });
  // The page must be taller than the window for a scroll to show. A short
  // page (a settings section) is proved by its styles and hit test above.
  const room = await page.evaluate(() => document.documentElement.scrollHeight - window.innerHeight);
  if (requireScrollable) expect(room).toBeGreaterThan(200);
  if (room < 40) return;
  await page.evaluate(() => window.scrollTo(0, 0));
  // A wheel turn where the browser has one; mobile WebKit has no wheel, so
  // there the keyboard scrolls (both are blocked by `overflow: hidden`).
  const isMobileWebKit = page.context().browser()?.browserType().name() === "webkit" && screenIsTouch(page);
  if (isMobileWebKit) {
    await page.evaluate(() => (document.activeElement instanceof HTMLElement ? document.activeElement.blur() : undefined));
  } else {
    await page.mouse.move(page.viewportSize().width / 2, page.viewportSize().height / 2);
  }
  await expect.poll(async () => {
    if (isMobileWebKit) await page.keyboard.press("PageDown");
    else await page.mouse.wheel(0, 400);
    return page.evaluate(() => window.scrollY);
  }, { timeout: 5_000 }).toBeGreaterThan(0);
}

const screenIsTouch = (page) => (page.viewportSize()?.width ?? 1440) < 768;

async function createTransferPair(page) {
  const stamp = `${Date.now()}-${Math.round(Math.random() * 1e6)}`;
  const amountMinor = 40_000 + Math.round(Math.random() * 50_000);
  const out = await postJson(page, "/api/entries/create", {
    date: `${MONTH}-12`,
    description: `Scroll lock transfer out ${stamp}`,
    accountName: "UOB One",
    categoryName: "Transfer",
    amountMinor,
    entryType: "transfer",
    transferDirection: "out",
    ownershipType: "direct",
    ownerName: "Tim"
  });
  const into = await postJson(page, "/api/entries/create", {
    date: `${MONTH}-12`,
    description: `Scroll lock transfer in ${stamp}`,
    accountName: "Citi Rewards",
    categoryName: "Transfer",
    amountMinor,
    entryType: "transfer",
    transferDirection: "in",
    ownershipType: "direct",
    ownerName: "Tim"
  });
  return { outId: out.entryId, inId: into.entryId, inDescription: `Scroll lock transfer in ${stamp}` };
}

async function createExpense(page) {
  const { entryId } = await postJson(page, "/api/entries/create", {
    date: `${MONTH}-20`,
    description: `Scroll lock expense ${Date.now()}`,
    accountName: "UOB One",
    categoryName: "Groceries",
    amountMinor: 2_345,
    entryType: "expense",
    ownershipType: "direct",
    ownerName: "Tim"
  });
  return entryId;
}

// Opens an entry for editing: the Edit entry sheet on a phone, the row's
// inline editor on a desktop. Returns the place its rows live in.
async function openEntryEditor(page, screen, entryId) {
  await gotoPageAfterApi(
    page,
    `/entries?view=person-tim&month=${MONTH}&editing_entry=${entryId}`,
    "/api/entries-page",
    () => (screen.phone ? page.locator('.entry-mobile-sheet[aria-label="Edit entry"]') : page.locator(`[data-entry-id="${entryId}"], .entry-edit-card`).first())
  );
  return screen.phone ? page.locator('.entry-mobile-sheet[aria-label="Edit entry"]') : page;
}

async function openTransferDetails(page, screen, outId) {
  const editor = await openEntryEditor(page, screen, outId);
  await press(screen, editor.getByRole("button", { name: /Manage transfer/ }).first());
  const dialog = page.locator(".transfer-match-dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Use match" })).toBeVisible({ timeout: 30_000 });
  return dialog;
}

// Closes whatever is left open after the dialog (the Edit entry sheet on a
// phone) by its own close button, so the check is about the page.
async function closeEntryEditor(page, screen) {
  if (!screen.phone) return;
  const sheet = page.locator('.entry-mobile-sheet[aria-label="Edit entry"]');
  if (await sheet.count()) {
    await sheet.getByRole("button", { name: "Close edit entry" }).tap();
    await expect(sheet).toHaveCount(0);
  }
}

for (const screen of SCREENS) {
  test.describe(`page scrolls after a dialog closes (${screen.name})${screen.phone ? " @webkit" : ""}`, () => {
    test.use(screen.use);

    test.beforeEach(async ({ page }) => {
      await page.goto("/");
      await reseedDemo(page);
    });

    test("Transfer details: Use match closes it and the page scrolls (the owner's flow)", async ({ page }) => {
      const { outId } = await createTransferPair(page);
      const dialog = await openTransferDetails(page, screen, outId);
      await press(screen, dialog.getByRole("button", { name: "Use match" }).first());
      await expect(dialog).toHaveCount(0);
      await expectPageScrolls(page);
    });

    test("Transfer details: a category list opened inside, then Use match", async ({ page }) => {
      const { outId } = await createTransferPair(page);
      const dialog = await openTransferDetails(page, screen, outId);
      await press(screen, dialog.locator('[data-row="current-category"]'));
      await expect(categoryList(page)).toBeVisible();
      if (screen.phone) {
        await page.keyboard.press("Escape");
        await expect(categoryList(page)).toHaveCount(0);
      } else {
        // The popover stays open: the click on Use match is its outside tap.
        await page.keyboard.press("Escape");
        await expect(categoryList(page)).toHaveCount(0);
      }
      await press(screen, dialog.getByRole("button", { name: "Use match" }).first());
      await expect(dialog).toHaveCount(0);
      await expectPageScrolls(page);
    });

    for (const how of ["Done", "Escape", "close button"]) {
      test(`Transfer details: closed by ${how}`, async ({ page }) => {
        const { outId } = await createTransferPair(page);
        const dialog = await openTransferDetails(page, screen, outId);
        if (how === "Done") await press(screen, dialog.getByRole("button", { name: "Done" }));
        else if (how === "Escape") await page.keyboard.press("Escape");
        else await press(screen, dialog.getByRole("button", { name: "Close transfer manager" }));
        await expect(dialog).toHaveCount(0);
        await closeEntryEditor(page, screen);
        await expectPageScrolls(page);
      });
    }

    test("Transfer details: a category list left open when the dialog closes with Escape", async ({ page }) => {
      const { outId } = await createTransferPair(page);
      const dialog = await openTransferDetails(page, screen, outId);
      await press(screen, dialog.locator('[data-row="current-category"]'));
      await expect(categoryList(page)).toBeVisible();
      // Escape closes the list first, then the dialog.
      await page.keyboard.press("Escape");
      await page.keyboard.press("Escape");
      await expect(dialog).toHaveCount(0);
      await closeEntryEditor(page, screen);
      await expectPageScrolls(page);
    });

    test("Edit entry: a category list opened and closed, then the editor closed", async ({ page }) => {
      const entryId = await createExpense(page);
      const editor = await openEntryEditor(page, screen, entryId);
      await press(screen, editor.locator('[data-row="category"]').first());
      await expect(categoryList(page)).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(categoryList(page)).toHaveCount(0);
      if (screen.phone) {
        await closeEntryEditor(page, screen);
      } else {
        await page.keyboard.press("Escape");
      }
      await expectPageScrolls(page);
    });
  });
}

// Every other kind of dialog and sheet: the shared frame (SheetDialog: a Radix
// modal dialog on a desktop, the EntryMobileSheet on a phone), the phone
// picker sheets (ResponsiveSelect), the category list inside a dialog, and
// Plan Studio's amount popover and sheet. Each `run` opens one and closes it
// the way its name says. `phoneOnly` / `desktopOnly` mark a place that exists
// on one screen; `scrollable` says the page under it is long enough to scroll.
const escape = (page) => page.keyboard.press("Escape");

async function openSettingsSection(page, name) {
  await page.goto("/settings?view=person-tim");
  await page.getByRole("button", { name: new RegExp(name) }).first().click({ timeout: 60_000 });
}

const OTHER_PLACES = [
  {
    name: "Delete entry confirmation, Cancel, then the editor closed",
    scrollable: true,
    async run(page, screen) {
      const entryId = await createExpense(page);
      const editor = await openEntryEditor(page, screen, entryId);
      await press(screen, editor.getByRole("button", { name: "Delete entry" }).first());
      const confirm = page.getByRole("dialog", { name: "Delete entry?" });
      await expect(confirm).toBeVisible();
      await press(screen, confirm.getByRole("button", { name: "Cancel" }));
      await expect(confirm).toHaveCount(0);
      await closeEntryEditor(page, screen);
      if (!screen.phone) await escape(page);
    }
  },
  {
    name: "Delete entry confirmation, Delete entry (closes it and the editor together)",
    scrollable: true,
    async run(page, screen) {
      const entryId = await createExpense(page);
      const editor = await openEntryEditor(page, screen, entryId);
      await press(screen, editor.getByRole("button", { name: "Delete entry" }).first());
      const confirm = page.getByRole("dialog", { name: "Delete entry?" });
      await expect(confirm).toBeVisible();
      await press(screen, confirm.getByRole("button", { name: "Delete entry" }).last());
      await expect(confirm).toHaveCount(0);
    }
  },
  {
    name: "Edit entry, a category picked from the list, then Save",
    scrollable: true,
    async run(page, screen) {
      const entryId = await createExpense(page);
      const editor = await openEntryEditor(page, screen, entryId);
      await press(screen, editor.locator('[data-row="category"]').first());
      await expect(categoryList(page)).toBeVisible();
      await press(screen, page.locator('[data-category-option="Entertainment"]').first());
      await expect(categoryList(page)).toHaveCount(0);
      if (screen.phone) {
        const sheet = page.locator('.entry-mobile-sheet[aria-label="Edit entry"]');
        await press(screen, sheet.getByRole("button", { name: "Save", exact: true }).last());
        await expect(sheet).toHaveCount(0);
      } else {
        await escape(page);
      }
    }
  },
  {
    name: "Add to splits (desktop dialog), Cancel",
    desktopOnly: true,
    scrollable: true,
    async run(page) {
      const entryId = await createExpense(page);
      await page.goto(`/entries?view=household&month=${MONTH}&entries_scope=direct_plus_shared&editing_entry=${entryId}`);
      await page.locator(".entry-inline-editor").first().getByRole("button", { name: "Add to splits" }).click({ timeout: 60_000 });
      const dialog = page.getByRole("dialog", { name: "Add to splits" });
      await expect(dialog).toBeVisible();
      await dialog.getByRole("button", { name: "Cancel" }).click();
      await expect(dialog).toHaveCount(0);
      await escape(page);
    }
  },
  {
    name: "Add to splits (desktop dialog), Add to splits",
    desktopOnly: true,
    scrollable: true,
    async run(page) {
      const entryId = await createExpense(page);
      await page.goto(`/entries?view=household&month=${MONTH}&entries_scope=direct_plus_shared&editing_entry=${entryId}`);
      await page.locator(".entry-inline-editor").first().getByRole("button", { name: "Add to splits" }).click({ timeout: 60_000 });
      const dialog = page.getByRole("dialog", { name: "Add to splits" });
      await expect(dialog).toBeVisible();
      await dialog.getByRole("radio", { name: "Non-group expenses" }).click();
      await dialog.getByRole("button", { name: "Add to splits" }).last().click();
      await expect(dialog).toHaveCount(0);
      await escape(page);
    }
  },
  {
    name: "Add to splits (phone group picker sheet), then Add to splits",
    phoneOnly: true,
    scrollable: true,
    async run(page, screen) {
      const entryId = await createExpense(page);
      const sheet = await openEntryEditor(page, screen, entryId);
      await sheet.getByRole("button", { name: "Splits Add to splits" }).tap();
      const groupPicker = page.locator(".mobile-select-dialog").filter({ hasText: "Split group" });
      await expect(groupPicker).toBeVisible();
      await groupPicker.getByRole("button", { name: "Non-group expenses" }).tap();
      await expect(groupPicker).toHaveCount(0);
      await sheet.getByRole("button", { name: "Add to splits", exact: true }).tap();
      await expect(sheet.getByRole("button", { name: "Add to splits", exact: true })).toHaveCount(0);
      await closeEntryEditor(page, screen);
    }
  },
  {
    name: "New split expense, a category list opened inside, then Escape",
    // A desktop opens it from its button; a phone (next) through Ask's
    // "Edit in form" link.
    desktopOnly: true,
    scrollable: false,
    async run(page, screen) {
      await page.goto("/splits?view=person-tim&month=2025-10&split_group=split-group-none");
      await press(screen, page.locator(".splits-lead").getByRole("button", { name: "+ Add expense" }));
      const dialog = page.getByRole("dialog", { name: "New split expense" });
      await expect(dialog).toBeVisible({ timeout: 60_000 });
      await press(screen, dialog.locator('[data-row="category"]').first());
      await expect(categoryList(page)).toBeVisible();
      await escape(page);
      await expect(categoryList(page)).toHaveCount(0);
      await escape(page);
      await expect(dialog).toHaveCount(0);
    }
  },
  {
    name: "New split expense from Ask's Edit in form link, a category list opened inside, then Escape",
    phoneOnly: true,
    scrollable: false,
    async run(page, screen) {
      await page.goto("/splits?view=person-tim&month=2025-10&split_group=split-group-none&split_action=add-expense");
      const dialog = page.getByRole("dialog", { name: "New split expense" });
      await expect(dialog).toBeVisible({ timeout: 60_000 });
      await press(screen, dialog.locator('[data-row="category"]').first());
      await expect(categoryList(page)).toBeVisible();
      await escape(page);
      await expect(categoryList(page)).toHaveCount(0);
      await escape(page);
      await expect(dialog).toHaveCount(0);
    }
  },
  {
    name: "Record settlement, Cancel",
    scrollable: false,
    async run(page, screen) {
      await page.goto("/splits?view=person-tim&month=2025-10&split_group=split-group-baby-river");
      await press(screen, page.getByRole("button", { name: "Settle group" }).first());
      const dialog = page.getByRole("dialog", { name: "Record settlement" });
      await expect(dialog).toBeVisible({ timeout: 60_000 });
      await press(screen, dialog.getByRole("button", { name: "Cancel" }));
      await expect(dialog).toHaveCount(0);
    }
  },
  {
    name: "Create account, Escape",
    scrollable: false,
    async run(page, screen) {
      await openSettingsSection(page, "Accounts");
      await press(screen, page.getByRole("button", { name: "+ Add account" }).first());
      const dialog = page.getByRole("dialog", { name: "Create account" });
      await expect(dialog).toBeVisible();
      await escape(page);
      await expect(dialog).toHaveCount(0);
    }
  },
  {
    name: "Create match rule, Cancel",
    scrollable: false,
    async run(page, screen) {
      await openSettingsSection(page, "Category matching");
      await press(screen, page.getByRole("button", { name: "+ Add match rule" }).first());
      const dialog = page.getByRole("dialog", { name: "Create match rule" });
      await expect(dialog).toBeVisible();
      await press(screen, dialog.getByRole("button", { name: "Cancel" }));
      await expect(dialog).toHaveCount(0);
    }
  },
  {
    name: "Rollback import, Cancel",
    scrollable: false,
    async run(page, screen) {
      const sourceLabel = `Scroll lock import ${Date.now()}`;
      const csv = ["date,description,amount,account,category,note", `${MONTH}-19,SCROLL LOCK SHOP,-12.30,UOB One,Groceries,`].join("\n");
      const preview = await postJson(page, "/api/imports/preview", { sourceLabel, sourceType: "csv", csv, ownershipType: "direct", ownerName: "Tim" });
      await postJson(page, "/api/imports/commit", { sourceLabel, sourceType: "csv", parserKey: "generic_csv", rows: preview.preview.previewRows });
      await page.goto("/imports?view=person-tim");
      await openRecentImports(page);
      await press(screen, page.locator(".import-card").filter({ hasText: sourceLabel }).getByRole("button", { name: "Rollback import" }));
      const dialog = page.getByRole("dialog");
      await expect(dialog).toBeVisible();
      await press(screen, dialog.getByRole("button", { name: "Cancel" }));
      await expect(dialog).toHaveCount(0);
    }
  },
  {
    name: "Plan Studio amount, set",
    scrollable: false,
    async run(page, screen) {
      await chooseStudio(page);
      await gotoPageAfterApi(page, `/month?view=person-tim&month=${MONTH}&scope=direct_plus_shared`, "/api/month-page", () => page.locator("[data-plan-studio]"));
      const amount = page.locator("[data-ps-row]").filter({ has: page.locator(".ps-row-label", { hasText: /^Food$/ }) }).locator("[data-ps-amount]");
      await press(screen, amount);
      const field = page.getByRole("textbox", { name: "Planned amount" });
      await field.fill("137");
      if (screen.phone) {
        await page.getByRole("dialog").getByRole("button", { name: "Set amount" }).tap();
      } else {
        await field.press("Enter");
      }
      await expect(field).toHaveCount(0);
    }
  }
];

for (const screen of SCREENS) {
  test.describe(`page scrolls after every kind of dialog closes (${screen.name})${screen.phone ? " @webkit" : ""}`, () => {
    test.use(screen.use);

    test.beforeEach(async ({ page }) => {
      await page.addInitScript(() => window.localStorage.setItem("monies-map:money-totals-visible", "true"));
      await page.goto("/");
      await reseedDemo(page);
    });

    for (const place of OTHER_PLACES) {
      if ((place.phoneOnly && !screen.phone) || (place.desktopOnly && screen.phone)) continue;
      test(place.name, async ({ page }) => {
        await place.run(page, screen);
        await expectPageScrolls(page, { requireScrollable: place.scrollable });
      });
    }
  });
}
