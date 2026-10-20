import { devices, expect, test } from "@playwright/test";

import { categoryList, categorySearch, gotoPageAfterApi, postJson, reseedDemo } from "./helpers";

// Guard: in every kind of place the one category list opens (design.md
// "Category list"), the last category can be reached and chosen, both by
// scrolling to it and by searching for it, on a phone (iPhone 13 height and
// the smallest supported phone) and on a desktop. "Last" is the last of the
// alphabetical rows: the best guess, when there is one, comes first.
//
// Reached means fully shown inside the list's scroll area and on screen, and
// not covered by the sheet's bar, the dialog's actions or anything else (a
// hit test at its centre lands on the row). Chosen means the place's own row
// or field shows it afterwards.
//
// The places cover each way the list is opened: a Detail row (Edit entry,
// New split expense: a sheet on a phone, a dialog on a desktop, whose scroll
// lock once swallowed the desktop popover's wheel scrolling), a
// ResponsiveSelect (Month plan line: a sheet on a phone, the table row on a
// desktop),
// an Entries row's label (the quick pick) and the Entries category filter
// (several choices, Clear and Done bar).

const MONTH = "2026-05";
const { defaultBrowserType: _browser, ...iPhone13 } = devices["iPhone 13"];

const SCREENS = [
  { name: "phone 390x664", phone: true, use: { ...iPhone13, hasTouch: true, viewport: { width: 390, height: 664 } } },
  { name: "phone 320x568", phone: true, use: { ...iPhone13, hasTouch: true, viewport: { width: 320, height: 568 } } },
  { name: "desktop 1280x800", phone: false, use: { viewport: { width: 1280, height: 800 } } }
];

async function createManualEntry(page, description = `Reach list ${Date.now()}`) {
  const { entryId } = await postJson(page, "/api/entries/create", {
    date: `${MONTH}-24`,
    description,
    accountName: "UOB One",
    categoryName: "Groceries",
    amountMinor: 3_210,
    entryType: "expense",
    ownershipType: "direct",
    ownerName: "Tim"
  });
  return { entryId, description };
}

const press = (screen, locator) => (screen.phone ? locator.tap() : locator.click());

// Each place: `open` shows the category list and returns `shows(label)`,
// which proves the place took the chosen category.
const PLACES = [
  {
    name: "Edit entry",
    async open(page, screen) {
      const { entryId, description } = await createManualEntry(page);
      if (screen.phone) {
        await page.goto(`/entries?view=person-tim&month=${MONTH}&editing_entry=${entryId}`);
        const sheet = page.locator('.entry-mobile-sheet[aria-label="Edit entry"]');
        await expect(sheet).toBeVisible({ timeout: 60_000 });
        await sheet.locator('[data-row="category"]').tap();
        return (label) => expect(sheet.locator('[data-row="category"]')).toContainText(label);
      }
      const row = page.locator(".entry-row").filter({ hasText: description }).first();
      await gotoPageAfterApi(page, `/entries?view=person-tim&month=${MONTH}`, "/api/entries-page", () => row);
      await row.locator(".entry-row-description > strong").first().click();
      const editor = page.locator(".entry-edit-card").first();
      await expect(editor).toBeVisible();
      await editor.locator('[data-row="category"]').click();
      return (label) => expect(editor.locator('[data-row="category"]')).toContainText(label);
    }
  },
  {
    name: "New split expense",
    async open(page, screen) {
      await page.goto("/splits?view=person-tim&month=2025-10&split_group=split-group-none&split_action=add-expense");
      const dialog = page.getByRole("dialog", { name: "New split expense" });
      await expect(dialog).toBeVisible({ timeout: 60_000 });
      await press(screen, dialog.locator('[data-row="category"]'));
      return (label) => expect(dialog.locator('[data-row="category"]')).toContainText(label);
    }
  },
  {
    // A phone edits the line in a sheet, a desktop in the table row itself.
    name: "Month plan line",
    async open(page, screen) {
      const planRow = () => page.locator("tr").filter({ hasText: "Savings" }).first();
      await gotoPageAfterApi(page, `/month?view=person-tim&month=${MONTH}&scope=direct_plus_shared`, "/api/month-page", planRow);
      await press(screen, planRow().getByRole("button", { name: "Edit Savings row" }));
      if (!screen.phone) {
        const trigger = page.locator("tr .responsive-select-trigger").filter({ hasText: "Savings" }).first();
        await expect(trigger).toBeVisible();
        const handle = await trigger.elementHandle();
        await trigger.click();
        return (label) => expect.poll(() => handle.evaluate((element) => element.textContent.trim())).toBe(label);
      }
      const sheet = page.locator('.entry-mobile-sheet[aria-label="Edit bill or dated payment"]');
      await expect(sheet).toBeVisible();
      const categoryRow = sheet.locator("label").filter({ hasText: "Category" });
      await press(screen, categoryRow.locator(".responsive-select-trigger"));
      return (label) => expect(categoryRow.locator(".responsive-select-value")).toHaveText(label);
    }
  },
  {
    name: "Entries row label",
    async open(page, screen) {
      const { description } = await createManualEntry(page);
      const row = page.locator(".entry-row").filter({ hasText: description }).first();
      await gotoPageAfterApi(page, `/entries?view=person-tim&month=${MONTH}`, "/api/entries-page", () => row);
      const label = row.locator(".entry-row-category-button");
      await press(screen, label);
      return (name) => expect(label).toHaveText(name);
    }
  },
  {
    name: "Entries category filter",
    multiple: true,
    async open(page, screen) {
      await gotoPageAfterApi(page, `/entries?view=person-tim&month=${MONTH}`, "/api/entries-page", () => page.locator(".entry-row").first());
      if (screen.phone) {
        await page.getByRole("button", { name: /Filters/ }).first().tap();
      }
      await press(screen, page.getByRole("button", { name: "By category", exact: true }));
      return async (name) => {
        await press(screen, page.getByRole("button", { name: "Done" }).last());
        await expect(page).toHaveURL(new RegExp(`entry_category=${encodeURIComponent(name).replace(/%20/g, "(\\+|%20)")}`));
      };
    }
  }
];

// The open list's scroll area and its rows.
function listParts(page) {
  const listbox = categoryList(page);
  const scroller = page.locator(".category-pick-options").filter({ has: listbox });
  return { listbox, scroller, rows: listbox.locator(".category-pick-row") };
}

// The last alphabetical row: every row but the best guess is in A to Z order,
// and the last of them is the last row of the list.
async function lastAlphabeticalLabel(page) {
  const { rows } = listParts(page);
  const labels = await rows.evaluateAll((elements) => elements.map((element) => ({
    label: element.querySelector(".category-pick-row-label")?.textContent?.trim() ?? "",
    isBestGuess: Boolean(element.querySelector(".category-pick-tag"))
  })));
  const rest = labels.filter((row) => !row.isBestGuess).map((row) => row.label);
  // (The Entries filter lists only the categories in use, about a dozen.)
  expect(rest.length).toBeGreaterThanOrEqual(10);
  expect(rest).toEqual([...rest].sort((left, right) => left.localeCompare(right, undefined, { sensitivity: "base", numeric: true })));
  expect(labels.at(-1).label).toBe(rest.at(-1));
  return rest.at(-1);
}

// The row is wholly inside the list's scroll area and the window, and a tap
// at its centre lands on it (no bar, footer or action covers it).
async function expectRowReachable(page, row) {
  await expect(row).toBeInViewport({ ratio: 0.99 });
  const placement = await row.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const scroller = element.closest(".category-pick-options");
    const area = scroller.getBoundingClientRect();
    const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
    return {
      insideList: rect.top >= area.top - 1 && rect.bottom <= area.bottom + 1,
      insideWindow: rect.top >= 0 && rect.bottom <= window.innerHeight,
      hitsRow: Boolean(hit && element.contains(hit))
    };
  });
  expect(placement, "the last category shows whole and nothing covers it").toEqual({ insideList: true, insideWindow: true, hitsRow: true });
}

// Scrolls the list to its end as a person would: touch swipes on a phone, the
// mouse wheel on a desktop. Each swipe or wheel turn must move it.
async function scrollListToEnd(page, screen, scroller) {
  const position = () => scroller.evaluate((element) => ({ top: element.scrollTop, atEnd: element.scrollTop + element.clientHeight >= element.scrollHeight - 1 }));
  const box = await scroller.boundingBox();
  const x = Math.round(box.x + box.width / 2);
  const cdp = screen.phone ? await page.context().newCDPSession(page) : null;
  const startY = Math.round(Math.min(box.y + box.height, page.viewportSize().height) - 30);
  const distance = Math.round(Math.max(100, startY - Math.max(box.y, 0) - 60));
  let before = await position();
  expect(before.atEnd, "the list starts with more below").toBe(false);
  for (let turn = 0; !before.atEnd; turn += 1) {
    expect(turn, "the list reaches its end within 60 swipes").toBeLessThan(60);
    if (cdp) {
      await cdp.send("Input.synthesizeScrollGesture", { x, y: startY, yDistance: -distance, gestureSourceType: "touch", speed: 1600 });
    } else {
      await page.mouse.move(x, Math.round(box.y + box.height / 2));
      await page.mouse.wheel(0, 120);
      await expect.poll(async () => (await position()).top).toBeGreaterThan(before.top);
    }
    const after = await position();
    expect(after.top, "each swipe moves the list").toBeGreaterThan(before.top);
    before = after;
  }
  await cdp?.detach();
}

for (const screen of SCREENS) {
  test.describe(`category list reaches its last category, ${screen.name}`, () => {
    test.use(screen.use);

    test.beforeEach(async ({ page }) => {
      await reseedDemo(page);
    });

    for (const place of PLACES) {
      test(`${place.name}: by scrolling and by search`, async ({ page }) => {
        // By scrolling.
        let shows = await place.open(page, screen);
        await expect(categoryList(page)).toBeVisible();
        const last = await lastAlphabeticalLabel(page);
        const { scroller, rows } = listParts(page);
        const lastRow = rows.last();
        await expect(lastRow).not.toBeInViewport();
        await scrollListToEnd(page, screen, scroller);
        await expectRowReachable(page, lastRow);
        // The search stays in place above the scrolled list.
        await expect(categorySearch(page)).toBeInViewport();
        await press(screen, lastRow);
        await shows(last);

        // By search, from a fresh opening.
        shows = await place.open(page, screen);
        await expect(categoryList(page)).toBeVisible();
        await press(screen, categorySearch(page));
        await categorySearch(page).fill(last);
        const found = listParts(page).rows.filter({ has: page.locator(".category-pick-row-label", { hasText: new RegExp(`^${last}$`) }) });
        await expect(found).toHaveCount(1);
        await expectRowReachable(page, found);
        await press(screen, found);
        if (place.multiple) {
          await expect(found).toHaveAttribute("aria-selected", "true");
        }
        await shows(last);
      });
    }
  });
}
