import { expect, test } from "@playwright/test";

import { openRecentImports, postJson, reseedDemo } from "./helpers";

// Every desktop dialog fits the window (design.md, "Dialogs and small
// sheets", "Fits the window"): it is centred, its top is never above the
// window and its bottom never below, the title stays at the top and the
// actions at the bottom, and only what is between them scrolls. Transfer
// details used to scroll as one box, so at 1280 x 600 Done and Convert entry
// sat below the dialog's edge and, scrolled down, its title went off the top.

const MONTH = "2026-05";
const SHORT = { width: 1280, height: 600 };
const LARGE = { width: 1440, height: 900 };
const WINDOWS = [SHORT, { width: 1280, height: 720 }, { width: 1366, height: 768 }, LARGE];

function rect(locator) {
  return locator.evaluate((element) => {
    const box = element.getBoundingClientRect();
    return { top: box.top, bottom: box.bottom, height: box.height };
  });
}

// The dialog is centred and inside the window; its title and each named
// action are inside the dialog's own box.
async function expectDialogFits(page, dialog, { title, actions }) {
  const viewport = page.viewportSize();
  const frame = await rect(dialog);
  expect(frame.top, "dialog top is inside the window").toBeGreaterThanOrEqual(0);
  expect(frame.bottom, "dialog bottom is inside the window").toBeLessThanOrEqual(viewport.height);
  expect(Math.abs(frame.top + frame.height / 2 - viewport.height / 2), "dialog is centred").toBeLessThanOrEqual(2);
  const heading = await rect(dialog.getByRole("heading", { name: title, exact: true }).first());
  expect(heading.top, "title is not above the dialog").toBeGreaterThanOrEqual(frame.top);
  expect(heading.bottom, "title is not below the dialog").toBeLessThanOrEqual(frame.bottom);
  for (const action of actions) {
    const button = await rect(dialog.getByRole("button", { name: action, exact: true }).last());
    expect(button.top, `${action} is not above the dialog`).toBeGreaterThanOrEqual(frame.top);
    expect(button.bottom, `${action} is not below the dialog`).toBeLessThanOrEqual(frame.bottom);
  }
  // The body scrolls instead of squeezing its parts: no part (the Wallets
  // rows, say) is shorter than what it holds.
  const squeezed = await dialog.evaluate((root) => [...root.querySelectorAll(".sheet-dialog-body > *")]
    .filter((part) => part.scrollHeight > part.clientHeight + 1 && !/(auto|scroll)/.test(getComputedStyle(part).overflowY))
    .map((part) => part.className || part.tagName));
  expect(squeezed, "no part of the body is squeezed").toEqual([]);
}

// Opening an entry scrolls the page to its editor; wait until that is done.
async function settledPageScroll(page) {
  let last = -1;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const now = await page.evaluate(() => window.scrollY);
    if (now === last) return now;
    last = now;
    await page.waitForTimeout(150);
  }
  return last;
}

// Wheel to the end of the dialog: the page under it stays put, every
// scrolling part of the dialog reaches its end, and the title and actions
// are still in place.
async function expectBodyScrollsToEnd(page, dialog, fit) {
  const pageScroll = await settledPageScroll(page);
  const frame = await dialog.boundingBox();
  await page.mouse.move(frame.x + frame.width / 2, frame.y + frame.height / 2);
  for (let turn = 0; turn < 4; turn += 1) {
    await page.mouse.wheel(0, 1500);
  }
  await expect.poll(() => dialog.evaluate((root) => {
    const scrollers = [root, ...root.querySelectorAll("*")].filter((element) => {
      const style = getComputedStyle(element);
      return /(auto|scroll)/.test(style.overflowY) && element.scrollHeight > element.clientHeight + 1;
    });
    return scrollers.every((element) => element.scrollTop + element.clientHeight >= element.scrollHeight - 2);
  }), { message: "the dialog scrolled to its end" }).toBe(true);
  expect(await page.evaluate(() => window.scrollY), "only the dialog scrolled, not the page").toBe(pageScroll);
  await expectDialogFits(page, dialog, fit);
}

async function createEntry(page, patch = {}) {
  const { entryId } = await postJson(page, "/api/entries/create", {
    date: `${MONTH}-24`,
    description: `Dialog fit ${Date.now()}`,
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

async function openSettingsSection(page, name) {
  await page.goto("/settings?view=person-tim");
  await page.getByRole("button", { name: new RegExp(name) }).first().click({ timeout: 60_000 });
}

// An unmatched transfer, so the dialog shows every section down to "Not a
// transfer?".
async function openTransferDetails(page) {
  const entryId = await createEntry(page, { categoryName: "Transfer", entryType: "transfer", transferDirection: "out", amountMinor: 91234 });
  await page.goto(`/entries?view=person-tim&month=${MONTH}&editing_entry=${entryId}`);
  const trigger = page.getByRole("button", { name: "Manage transfer" });
  await expect(trigger).toBeVisible({ timeout: 60_000 });
  await trigger.click();
  return page.getByRole("dialog", { name: "Transfer details" });
}

// The other tall desktop dialogs, each with the actions its bar must keep in
// view.
const DIALOGS = [
  {
    name: "Add to splits",
    actions: ["Cancel", "Add to splits"],
    async open(page) {
      const entryId = await createEntry(page);
      await page.goto(`/entries?view=household&month=${MONTH}&entries_scope=direct_plus_shared&editing_entry=${entryId}`);
      await page.locator(".entry-inline-editor").first().getByRole("button", { name: "Add to splits" }).click({ timeout: 60_000 });
      return page.getByRole("dialog", { name: "Add to splits" });
    }
  },
  {
    name: "New split expense",
    actions: ["Cancel", "Save expense"],
    async open(page) {
      await page.goto("/splits?view=person-tim&month=2025-10&split_group=split-group-none");
      await page.locator(".splits-lead").getByRole("button", { name: "+ Add expense" }).click({ timeout: 60_000 });
      return page.getByRole("dialog", { name: "New split expense" });
    }
  },
  {
    name: "Record settlement",
    actions: ["Cancel", "Save settlement"],
    async open(page) {
      await page.goto("/splits?view=person-tim&month=2025-10&split_group=split-group-baby-river");
      await page.locator(".splits-lead").getByRole("button", { name: "Settle group" }).click({ timeout: 60_000 });
      return page.getByRole("dialog", { name: "Record settlement" });
    }
  },
  {
    name: "Match bill or dated payment",
    actions: ["Cancel", "Save matches"],
    async open(page) {
      const label = `Dialog fit plan ${Date.now()}`;
      await postJson(page, "/api/month-plan/save", {
        rowId: `dialog-fit-${Date.now()}`,
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
      await page.goto(`/month?view=person-tim&month=${MONTH}&scope=direct_plus_shared`);
      await page.locator("tr").filter({ hasText: label }).first().getByRole("button", { name: "Link entries" }).click({ timeout: 60_000 });
      return page.getByRole("dialog", { name: "Match bill or dated payment" });
    }
  },
  {
    name: "Create match rule",
    actions: ["Cancel", "Save rule"],
    async open(page) {
      await openSettingsSection(page, "Category matching");
      await page.getByRole("button", { name: "+ Add match rule" }).first().click();
      return page.getByRole("dialog", { name: "Create match rule" });
    }
  },
  {
    name: "Statement checkpoint",
    actions: ["Cancel", "Save checkpoint"],
    async open(page) {
      await openSettingsSection(page, "Accounts");
      await page.locator(".settings-account-row").filter({ hasText: "UOB One" }).first().getByRole("button", { name: "Reconcile" }).click();
      return page.getByRole("dialog", { name: "Statement checkpoint" });
    }
  },
  {
    name: "Create account",
    actions: ["Cancel", "Create account"],
    async open(page) {
      await openSettingsSection(page, "Accounts");
      await page.getByRole("button", { name: "+ Add account" }).first().click();
      return page.getByRole("dialog", { name: "Create account" });
    }
  },
  {
    name: "Rollback import",
    actions: ["Cancel", "Confirm rollback"],
    async open(page) {
      const sourceLabel = `Dialog fit import ${Date.now()}`;
      const csv = ["date,description,amount,account,category,note", `${MONTH}-19,DIALOG FIT SHOP,-12.30,UOB One,Groceries,`].join("\n");
      const preview = await postJson(page, "/api/imports/preview", { sourceLabel, sourceType: "csv", csv, ownershipType: "direct", ownerName: "Tim" });
      await postJson(page, "/api/imports/commit", { sourceLabel, sourceType: "csv", parserKey: "generic_csv", rows: preview.preview.previewRows });
      await page.goto("/imports?view=person-tim");
      await openRecentImports(page);
      await page.locator(".import-card").filter({ hasText: sourceLabel }).getByRole("button", { name: "Rollback import" }).click({ timeout: 60_000 });
      return page.getByRole("dialog");
    }
  }
];

test.describe("desktop dialogs fit the window", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => window.localStorage.setItem("monies-map:money-totals-visible", "true"));
    await page.goto("/");
    await reseedDemo(page);
  });

  for (const size of WINDOWS) {
    test(`Transfer details at ${size.width} x ${size.height}: the title and the bar stay put, the body scrolls`, async ({ page }) => {
      await page.setViewportSize(size);
      const dialog = await openTransferDetails(page);
      await expect(dialog).toBeVisible();
      const fit = { title: "Transfer details", actions: ["Convert entry", "Done"] };
      await expectDialogFits(page, dialog, fit);
      await expectBodyScrollsToEnd(page, dialog, fit);
      // The last section, "Not a transfer?", is reachable.
      await expect(dialog.locator(".transfer-settlement")).toBeInViewport({ ratio: 1 });
    });
  }

  // A phone keeps the bottom sheet (it lifts above the keyboard; see
  // category-sheet-keyboard.spec.js): it too stays inside the window with its
  // title and Done in view.
  test("Transfer details on a phone is a sheet inside the window", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 664 });
    const entryId = await createEntry(page, { categoryName: "Transfer", entryType: "transfer", transferDirection: "out", amountMinor: 91234 });
    await page.goto(`/entries?view=person-tim&month=${MONTH}&editing_entry=${entryId}`);
    await expect(page.locator('.entry-mobile-sheet[aria-label="Edit entry"]')).toBeVisible({ timeout: 60_000 });
    await page.getByRole("button", { name: /Transfer match/ }).click();
    const sheet = page.locator('.entry-mobile-sheet.sheet-dialog[aria-label="Transfer details"]');
    await expect(sheet).toBeVisible();
    const frame = await rect(sheet);
    expect(frame.top).toBeGreaterThanOrEqual(0);
    expect(frame.bottom).toBeLessThanOrEqual(664 + 1);
    await expect(sheet.getByText("Transfer details", { exact: true }).first()).toBeInViewport({ ratio: 1 });
    await expect(sheet.getByRole("button", { name: "Done", exact: true })).toBeInViewport({ ratio: 1 });
  });

  for (const item of DIALOGS) {
    for (const size of [SHORT, LARGE]) {
      test(`${item.name} at ${size.width} x ${size.height} fits the window`, async ({ page }) => {
        await page.setViewportSize(size);
        const dialog = await item.open(page);
        await expect(dialog).toBeVisible();
        const fit = { title: item.title ?? item.name, actions: item.actions };
        await expectDialogFits(page, dialog, fit);
        await expectBodyScrollsToEnd(page, dialog, fit);
      });
    }
  }
});
