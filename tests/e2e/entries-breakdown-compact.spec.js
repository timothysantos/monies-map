import { expect, test } from "@playwright/test";

import { gotoPageAfterApi, postJson, reseedDemo } from "./helpers";

// The Entries page's spending by category (design.md "Entries top",
// "Summary body"; docs/audits/entries-donut-compact/). It is folded into one
// Detail row by default, "Spending by category" with the top three shares,
// and the choice is kept on the device. Open, it is the Spending Mix
// treatment, compact: a donut whose bigger slices carry "Name 32.1%" where
// there is room (never a bare share, no icon bubbles), and beside it on a
// desktop (under it on a phone) the lean ranked list, one 44 px line per
// category: a colour dot, the name, the entries count (wide only), the
// amount and the share. The row's tap filters the list to the category (the
// old "Filter"), and a small eye toggle at its end hides or shows its slice
// (the old "Shown"). The top five (three on a phone), then "Show all N".
// Every slice, tiny ones too, opens its menu naming the category.

const MONTH = "2026-08";
const URL_PATH = `/entries?view=person-tim&month=${MONTH}`;
const DESKTOP = { width: 1440, height: 900 };
const PHONE = { width: 390, height: 844 };

// About twenty categories: a few big ones and many tiny ones, as a real
// month has (the owner's screenshot had 0.3%, 1.1% and 1.2% labels stacked
// on top of each other).
const SPEND = [
  ["Travel", 321710], ["Other", 172000], ["Church", 74000], ["Food & Drinks", 61000], ["Groceries", 42000],
  ["Home", 30500], ["Shopping", 15200], ["Bills", 9800], ["Insurance", 6400], ["Entertainment", 3100],
  ["Education", 2400], ["Healthcare", 1500], ["Baby & Kids", 1200], ["Taxi", 900], ["Beauty", 700],
  ["Gifts", 600], ["Fees", 450], ["Sports & Hobbies", 380], ["Family & Personal", 300], ["Public Transport", 210]
];
const TOTAL = SPEND.reduce((sum, [, minor]) => sum + minor, 0);
const share = (minor) => `${((minor / TOTAL) * 100).toFixed(1)}%`;
const moneyFormatter = new Intl.NumberFormat("en-SG", { style: "currency", currency: "SGD" });
const money = (minor) => moneyFormatter.format(minor / 100);

const breakdownRow = (page) => page.locator(".entries-totals [data-row='breakdown']");
const panel = (page) => page.locator(".entries-mix-panel");
const rows = (page) => panel(page).locator(".summary-mix-row");
const rowFor = (page, name) => rows(page).filter({ has: page.locator(".summary-mix-name", { hasText: new RegExp(`^${name.replace(/[&]/g, "\\$&")}$`) }) });
const isPhone = (page) => page.viewportSize().width < 761;

async function seedMonth(page) {
  await reseedDemo(page);
  for (const [categoryName, amountMinor] of SPEND) {
    await postJson(page, "/api/entries/create", {
      date: `${MONTH}-12`,
      description: `Compact breakdown ${categoryName}`,
      accountName: "UOB One",
      categoryName,
      amountMinor,
      entryType: "expense",
      ownershipType: "direct",
      ownerName: "Tim"
    });
  }
}

async function openEntries(page) {
  await gotoPageAfterApi(page, URL_PATH, "/api/entries-page", () => breakdownRow(page));
}

async function openBreakdown(page) {
  await openEntries(page);
  if ((await breakdownRow(page).getAttribute("aria-expanded")) !== "true") {
    await breakdownRow(page).click();
  }
  await expect(panel(page).locator(".recharts-pie")).toBeVisible({ timeout: 30_000 });
  await expect(panel(page).locator(".donut-slice-label").first()).toBeVisible();
}

function box(locator) {
  return locator.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height, right: rect.right, bottom: rect.bottom };
  });
}

// Every piece of text and every bubble in the panel as a box: no two may
// overlap (the old donut stacked its percent labels and icon bubbles).
async function overlappingBoxes(page) {
  const boxes = await panel(page).evaluate((root) => {
    const shown = (rect) => rect.width > 0 && rect.height > 0;
    const items = [];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (!node.textContent.trim()) continue;
      const range = document.createRange();
      range.selectNodeContents(node);
      const rect = range.getBoundingClientRect();
      if (shown(rect)) items.push({ name: node.textContent.trim().slice(0, 30), x: rect.x, y: rect.y, right: rect.right, bottom: rect.bottom });
    }
    for (const badge of root.querySelectorAll(".donut-callout-badge, .category-icon")) {
      const rect = badge.getBoundingClientRect();
      if (shown(rect)) items.push({ name: `bubble ${items.length}`, x: rect.x, y: rect.y, right: rect.right, bottom: rect.bottom });
    }
    return items;
  });
  const overlaps = [];
  for (let i = 0; i < boxes.length; i += 1) {
    for (let j = i + 1; j < boxes.length; j += 1) {
      const a = boxes[i];
      const b = boxes[j];
      const across = Math.min(a.right, b.right) - Math.max(a.x, b.x);
      const down = Math.min(a.bottom, b.bottom) - Math.max(a.y, b.y);
      if (across > 1 && down > 1) overlaps.push(`${a.name} / ${b.name}`);
    }
  }
  return { count: boxes.length, overlaps };
}

for (const device of [
  { name: "desktop", viewport: DESKTOP, use: {} },
  { name: "phone", viewport: PHONE, use: { isMobile: true, hasTouch: true } }
]) {
  test.describe(`Entries spending by category on a ${device.name}`, () => {
    test.use({ viewport: device.viewport, ...device.use, reducedMotion: "reduce" });

    test.beforeEach(async ({ page }) => {
      await page.addInitScript(() => {
        if (!window.sessionStorage.getItem("money-set")) {
          window.sessionStorage.setItem("money-set", "1");
          window.localStorage.setItem("monies-map:money-totals-visible", "true");
        }
      });
      await page.goto("/");
      await seedMonth(page);
    });

    test("folded by default into one row with the top three shares; open or folded is kept on the device", async ({ page }) => {
      await openEntries(page);
      const row = breakdownRow(page);
      await expect(row).toHaveAttribute("aria-expanded", "false");
      await expect(panel(page)).toHaveCount(0);
      const pct = (minor) => `${Math.round((minor / TOTAL) * 100)}%`;
      await expect(row.locator(".lsd-row-text")).toHaveText(`Travel ${pct(SPEND[0][1])} · Other ${pct(SPEND[1][1])} · Church ${pct(SPEND[2][1])}`);
      // One line, inside the page.
      expect((await box(row)).height).toBeLessThanOrEqual(56);
      await row.click();
      await expect(row).toHaveAttribute("aria-expanded", "true");
      await expect(panel(page)).toBeVisible();
      await page.reload();
      await expect(breakdownRow(page)).toHaveAttribute("aria-expanded", "true", { timeout: 30_000 });
      await expect(panel(page)).toBeVisible();
      await breakdownRow(page).click();
      await expect(panel(page)).toHaveCount(0);
      await page.reload();
      await expect(breakdownRow(page)).toHaveAttribute("aria-expanded", "false", { timeout: 30_000 });
      await expect(panel(page)).toHaveCount(0);
    });

    test("compact: the donut with the ranked list beside it (under it on a phone), one line per category, then Show all", async ({ page }) => {
      await openBreakdown(page);
      const top = isPhone(page) ? 3 : 5;
      await expect(rows(page)).toHaveCount(top);
      for (const [index, [name, minor]] of SPEND.slice(0, top).entries()) {
        const row = rows(page).nth(index);
        await expect(row.locator(".summary-mix-name")).toHaveText(name);
        await expect(row.locator(".summary-mix-amount")).toHaveText(money(minor));
        await expect(row.locator(".summary-mix-percent")).toHaveText(share(minor));
        expect((await box(row)).height, `${name} is one line`).toBeLessThanOrEqual(46);
      }
      if (!isPhone(page)) {
        await expect(rows(page).first().locator(".summary-mix-count")).toHaveText("1 entry");
      }
      const chart = await box(panel(page).locator(".spending-mix-chart"));
      const list = await box(panel(page).locator(".summary-mix-list"));
      const section = await box(panel(page));
      if (isPhone(page)) {
        expect(list.y, "list under the donut").toBeGreaterThanOrEqual(chart.bottom - 1);
      } else {
        expect(list.x, "list beside the donut").toBeGreaterThanOrEqual(chart.right - 1);
        expect(list.y).toBeLessThan(chart.bottom);
        // No taller than the donut and its padding: the old panel was about
        // 1,700 px tall at 1,440 px with twenty categories.
        expect(section.height, "section at about the donut's height").toBeLessThanOrEqual(chart.height + 80);
      }
      expect(section.height).toBeLessThanOrEqual(isPhone(page) ? 520 : 400);
      const more = panel(page).getByRole("button", { name: `Show all ${SPEND.length}` });
      await expect(more).toHaveAttribute("aria-expanded", "false");
      await more.click();
      await expect(rows(page)).toHaveCount(SPEND.length);
      await expect(rows(page).last().locator(".summary-mix-name")).toHaveText(SPEND.at(-1)[0]);
      await panel(page).getByRole("button", { name: "Show fewer" }).click();
      await expect(rows(page)).toHaveCount(top);
      const sideways = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(sideways).toBeLessThanOrEqual(1);
    });

    test("no overlapping labels or bubbles: names only on slices with room, none on the tiny ones", async ({ page }) => {
      await openBreakdown(page);
      await expect(panel(page).locator(".donut-callout-badge")).toHaveCount(0);
      const labels = await panel(page).locator(".donut-slice-label").allTextContents();
      expect(labels.length).toBeGreaterThan(1);
      expect(labels[0] ?? "").toContain("Travel");
      for (const text of labels) {
        // Never a bare share: every label names its category.
        expect(text, "a label names its category").toMatch(/^\D/);
        expect(text).not.toMatch(/\$/);
      }
      expect(labels.some((text) => text.startsWith("Public Transport")), "the tiniest slice has no label").toBe(false);
      const { count, overlaps } = await overlappingBoxes(page);
      expect(count).toBeGreaterThan(8);
      expect(overlaps, "overlapping labels or bubbles").toEqual([]);
      await panel(page).getByRole("button", { name: `Show all ${SPEND.length}` }).click();
      expect((await overlappingBoxes(page)).overlaps).toEqual([]);
    });

    test("a row's tap filters the list to its category (the old Filter), and again clears it", async ({ page }) => {
      await openBreakdown(page);
      const church = rowFor(page, "Church");
      const main = church.locator(".summary-mix-main");
      await expect(main).toHaveAttribute("aria-pressed", "false");
      await main.click();
      await expect.poll(() => new URL(page.url()).searchParams.getAll("entry_category")).toEqual(["Church"]);
      await expect(page.locator(".entry-row").filter({ hasText: "Compact breakdown Church" })).toHaveCount(1);
      await expect(page.locator(".entry-row").filter({ hasText: "Compact breakdown Travel" })).toHaveCount(0);
      // The breakdown follows the filtered list: only Church is left, marked.
      await expect(rows(page)).toHaveCount(1);
      await expect(rowFor(page, "Church").locator(".summary-mix-main")).toHaveAttribute("aria-pressed", "true");
      await expect(rowFor(page, "Church")).toContainText("Filtered");
      await rowFor(page, "Church").locator(".summary-mix-main").click();
      await expect.poll(() => new URL(page.url()).searchParams.getAll("entry_category")).toEqual([]);
      await expect(page.locator(".entry-row").filter({ hasText: "Compact breakdown Travel" })).toHaveCount(1);
    });

    test("the eye toggle hides a slice from the donut (the old Shown) and is named for its category", async ({ page }) => {
      await openBreakdown(page);
      const travel = rowFor(page, "Travel");
      const eye = travel.getByRole("button", { name: "Show Travel in the chart" });
      await expect(eye).toHaveAttribute("aria-pressed", "true");
      const total = panel(page).locator(".donut-center strong");
      await expect(total).toHaveText(money(TOTAL));
      await eye.click();
      await expect(eye).toHaveAttribute("aria-pressed", "false");
      await expect(total).toHaveText(money(TOTAL - SPEND[0][1]));
      await expect(travel).toContainText("Hidden");
      await expect(travel).toHaveClass(/is-hidden-from-donut/);
      // Hiding a slice is not a filter: the list keeps every entry.
      expect(new URL(page.url()).searchParams.getAll("entry_category")).toEqual([]);
      await expect(page.locator(".entry-row").filter({ hasText: "Compact breakdown Travel" })).toHaveCount(1);
      // Keyboard: it is a real button.
      await eye.focus();
      await page.keyboard.press("Enter");
      await expect(eye).toHaveAttribute("aria-pressed", "true");
      await expect(total).toHaveText(money(TOTAL));
      await eye.click();
      await panel(page).getByRole("button", { name: "Show 1 hidden category" }).click();
      await expect(eye).toHaveAttribute("aria-pressed", "true");
      if (isPhone(page)) {
        const size = await box(eye);
        expect(size.width).toBeGreaterThanOrEqual(44);
        expect(size.height).toBeGreaterThanOrEqual(44);
      }
    });

    test("a tiny slice opens its menu naming its category, and View entries narrows the list to it", async ({ page }) => {
      await openBreakdown(page);
      const tiny = SPEND.at(-1)[0];
      const slice = panel(page).locator(`.donut-slice[data-slice="${tiny}"]`);
      await expect(slice).toHaveAttribute("aria-label", `${tiny}, ${share(SPEND.at(-1)[1])} of spending`);
      const menu = page.locator('[data-figure-menu="category"]');
      if (isPhone(page)) {
        // A small slice with no label of its own still takes a tap (the
        // tiniest is a sliver, reached by keyboard below).
        const bills = panel(page).locator('.donut-slice[data-slice="Bills"]');
        await expect(bills.locator(".donut-slice-label")).toHaveCount(0);
        await bills.locator(".donut-slice-hit").tap();
        await expect(menu.locator(".figure-menu-title")).toHaveText("Bills");
        await page.keyboard.press("Escape");
        await expect(menu).toHaveCount(0);
      } else {
        // A resting pointer opens a small slice's menu too.
        const bills = panel(page).locator('.donut-slice[data-slice="Bills"] .donut-slice-hit');
        const hit = await box(bills);
        await page.mouse.move(hit.x + hit.width / 2, hit.y + hit.height / 2);
        await expect(menu.locator(".figure-menu-title")).toHaveText("Bills");
        await page.keyboard.press("Escape");
        await page.mouse.move(0, 0);
        await expect(menu).toHaveCount(0);
      }
      await slice.focus();
      await page.keyboard.press("Enter");
      await expect(menu.locator(".figure-menu-title")).toHaveText(tiny);
      await expect(menu.locator(".figure-menu-note p").first()).toHaveText(`${money(SPEND.at(-1)[1])} · ${share(SPEND.at(-1)[1])} of spending`);
      await menu.getByRole("button", { name: "View entries" }).click();
      await expect.poll(() => new URL(page.url()).searchParams.getAll("entry_category")).toEqual([tiny]);
      await expect(page.locator(".entries-totals-lead .lsd-amount")).toHaveText(money(SPEND.at(-1)[1]), { timeout: 30_000 });
      await expect(page.locator(".entry-row").filter({ hasText: "Compact breakdown" })).toHaveCount(1);
    });

    test("hidden money: no amounts in the row or the panel, the shares stay", async ({ page }) => {
      await page.addInitScript(() => window.localStorage.setItem("monies-map:money-totals-visible", "false"));
      await openBreakdown(page);
      await expect(breakdownRow(page).locator(".lsd-row-text")).toHaveText(/^Travel \d+% · /);
      expect(await panel(page).textContent()).not.toMatch(/\$\s?\d/);
      await expect(rows(page).first().locator(".summary-mix-percent")).toHaveText(share(SPEND[0][1]));
      const tiny = SPEND.at(-1)[0];
      const slice = panel(page).locator(`.donut-slice[data-slice="${tiny}"]`);
      await slice.focus();
      await page.keyboard.press("Enter");
      await expect(page.locator("[data-figure-menu] .figure-menu-title")).toHaveText(tiny);
      expect(await page.locator("[data-figure-menu]").textContent()).not.toMatch(/\$/);
    });
  });
}

// A transfer with a purpose (DOMAIN.md "Transfer Purpose"): Tim's $450 to
// Joyce for Home is his Home spending in his view (slice, row amount and
// count; the row's filter lists the transfer; the slice's View entries
// total is the slice), lowers Joyce's Home in hers, and the household's
// Home is unchanged.
test("a transfer with a purpose counts in the breakdown as each view reads it", async ({ page }) => {
  await page.setViewportSize(DESKTOP);
  await page.addInitScript(() => window.localStorage.setItem("monies-map:money-totals-visible", "true"));
  await page.goto("/");
  await reseedDemo(page);
  await postJson(page, "/api/accounts/create", { name: "Joyce Bank", institution: "DBS", kind: "bank", currency: "SGD", openingBalanceMinor: 0, ownerPersonId: "person-joyce" });
  const entry = (body) => postJson(page, "/api/entries/create", { ownershipType: "direct", ownerName: "Tim", ...body });
  await entry({ date: `${MONTH}-03`, description: "Compact Tim home", accountName: "UOB One", categoryName: "Home", entryType: "expense", amountMinor: 30_500 });
  await entry({ date: `${MONTH}-05`, description: "HDB loan GIRO", accountName: "Joyce Bank", categoryName: "Home", entryType: "expense", amountMinor: 90_000, ownerName: "Joyce" });
  const { entryId: outId } = await entry({ date: `${MONTH}-01`, description: "FAST to Joyce", accountName: "UOB Savings", categoryName: "Transfer", entryType: "transfer", transferDirection: "out", amountMinor: 45_000 });
  const { entryId: inId } = await entry({ date: `${MONTH}-01`, description: "FAST from Tim", accountName: "Joyce Bank", categoryName: "Transfer", entryType: "transfer", transferDirection: "in", amountMinor: 45_000, ownerName: "Joyce" });
  await postJson(page, "/api/transfers/link", { fromEntryId: outId, toEntryId: inId });
  await postJson(page, "/api/transfers/purpose", { entryId: outId, categoryName: "Home" });

  const homeRow = async (view) => {
    await gotoPageAfterApi(page, `/entries?view=${view}&month=${MONTH}`, "/api/entries-page", () => breakdownRow(page));
    if ((await breakdownRow(page).getAttribute("aria-expanded")) !== "true") await breakdownRow(page).click();
    await expect(panel(page).locator(".recharts-pie")).toBeVisible({ timeout: 30_000 });
    const more = panel(page).getByRole("button", { name: /^Show all/ });
    if (await more.count()) await more.click();
    return rowFor(page, "Home");
  };

  // Tim: his own $305 and the $450 he sent for Home.
  let home = await homeRow("person-tim");
  await expect(home.locator(".summary-mix-amount")).toHaveText(money(75_500));
  await expect(home.locator(".summary-mix-count")).toHaveText("2 entries");
  await home.locator(".summary-mix-main").click();
  await expect(page.locator(".entry-row").filter({ hasText: "FAST to Joyce" })).toHaveCount(1);
  await expect(page.locator(".entries-totals-lead .lsd-amount")).toHaveText(money(75_500));
  await home.locator(".summary-mix-main").click();
  const slice = panel(page).locator('.donut-slice[data-slice="Home"]');
  await slice.focus();
  await page.keyboard.press("Enter");
  await page.locator('[data-figure-menu="category"]').getByRole("button", { name: "View entries" }).click();
  await expect(page.locator(".entries-totals-lead .lsd-amount")).toHaveText(money(75_500), { timeout: 30_000 });

  // Joyce: her $900 loan less the $450 Tim sent for it.
  home = await homeRow("person-joyce");
  await expect(home.locator(".summary-mix-amount")).toHaveText(money(45_000));

  // The household: the transfer stays a transfer; Home is the two expenses.
  home = await homeRow("household");
  await expect(home.locator(".summary-mix-amount")).toHaveText(money(120_500));
  await expect(home.locator(".summary-mix-count")).toHaveText("2 entries");
});

// The desktop Ask field's paperclip carries no `title`: a browser-drawn
// tooltip ("Add a receipt photo") could stay on the screen when the field is
// hidden under the pointer (a popover or dialog opening hides it), and no
// page code can take it down. Its name stays for assistive tech.
test("the Ask field's receipt button has its name but no browser tooltip", async ({ page }) => {
  await page.setViewportSize(DESKTOP);
  await page.goto(URL_PATH);
  const attach = page.locator(".ask-dock-field-attach");
  await expect(attach).toBeVisible({ timeout: 30_000 });
  await expect(attach).toHaveAccessibleName("Add a receipt photo");
  await expect(attach).not.toHaveAttribute("title", /.*/);
  expect(await page.locator("[title='Add a receipt photo']").count()).toBe(0);
});
