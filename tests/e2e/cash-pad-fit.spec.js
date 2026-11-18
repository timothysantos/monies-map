import { expect, test } from "@playwright/test";
import path from "node:path";

import { gotoPageAfterApi, loadEntriesPage, openJustPaid, postJson, reseedDemo } from "./helpers";

// The quick pad fits a phone in every state (design.md "Cash pad", "Fit"):
// on three phone sizes, and each again 110 px shorter (an in-app browser's
// toolbar), with 12 long-named wallets and no cash wallet chosen. Checked by
// geometry, not by picture: the amount is a whole box inside the screen that
// touches nothing else; with the details panel open the number keys are
// gone, the panel has the room, every choice in it can be reached and
// tapped, and Save stays in reach. The wallet question that Save asks
// saves on the wallet picked; the panel opened from the summary line never
// saves.

const TIM = "person-tim";
const SIZES = [
  { width: 375, height: 667 },
  { width: 390, height: 844 },
  { width: 430, height: 932 },
  { width: 375, height: 557 },
  { width: 390, height: 734 },
  { width: 430, height: 822 }
];
// Set to a folder (and a prefix such as "a-") to save a picture of each
// state at 390 wide, for the owner.
const SHOT_DIR = process.env.CASH_PAD_SHOT_DIR ?? "";
const SHOT_PREFIX = process.env.CASH_PAD_SHOT_PREFIX ?? "";

const LONG_WALLETS = [
  "Everyday Household Spending Account",
  "Joint Bills and Utilities Savings",
  "Holiday and Travel Fund Multi-Currency",
  "Emergency Rainy Day Reserve Account",
  "Children's Education Savings Plan",
  "Monthly Groceries and Market Money",
  "Renovation and Home Repairs Pot",
  "Investment Sweep Account Number Two",
  "Gifts, Birthdays and Celebrations",
  "Car Insurance and Road Tax Savings",
  "Medical and Dental Expenses Fund",
  "Weekend Hawker and Coffee Allowance"
];

function today() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Singapore", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

async function seedLongWallets(page) {
  const ids = [];
  for (const name of LONG_WALLETS) {
    const created = await postJson(page, "/api/accounts/create", { name, institution: "Test Bank", kind: "bank", currency: "SGD", ownerPersonId: TIM });
    ids.push(created.accountId);
  }
  return ids;
}

async function openPad(page) {
  await gotoPageAfterApi(page, `/entries?view=${TIM}&month=${today().slice(0, 7)}`, "/api/entries-page", () => page.locator(".entries-fab:not(.splits-fab)"));
  const pad = await openJustPaid(page);
  await expect(pad.locator(".cash-pad-line")).toHaveText(/Choose a wallet.*SGD.*Today.*Tim/, { timeout: 30_000 });
  return pad;
}

async function press(pad, keys) {
  for (const key of keys) {
    const name = key === "000" ? "Three zeros" : key === "." ? "Decimal point" : key;
    await pad.getByRole("button", { name, exact: true }).click();
  }
}

async function shot(page, state) {
  const size = page.viewportSize();
  if (!SHOT_DIR || size.width !== 390) return;
  await page.screenshot({ path: path.join(SHOT_DIR, `${SHOT_PREFIX}${state}-${size.width}x${size.height}.png`) });
}

// The pad's geometry, read in the page: the part of each element that can
// be seen (its box cut by every scrolling or clipping box around it inside
// the pad and by the screen).
async function readLayout(page) {
  return page.evaluate(() => {
    const pad = document.querySelector(".cash-pad");
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const shown = (element) => {
      let rect = element.getBoundingClientRect();
      let box = { top: rect.top, left: rect.left, bottom: rect.bottom, right: rect.right };
      for (let node = element.parentElement; node && node !== document.body; node = node.parentElement) {
        const style = getComputedStyle(node);
        if (style.overflowX !== "visible" || style.overflowY !== "visible") {
          rect = node.getBoundingClientRect();
          box = { top: Math.max(box.top, rect.top), left: Math.max(box.left, rect.left), bottom: Math.min(box.bottom, rect.bottom), right: Math.min(box.right, rect.right) };
        }
      }
      box = { top: Math.max(box.top, 0), left: Math.max(box.left, 0), bottom: Math.min(box.bottom, vh), right: Math.min(box.right, vw) };
      return box.bottom - box.top > 0.5 && box.right - box.left > 0.5 ? box : null;
    };
    const visible = (element) => {
      const style = getComputedStyle(element);
      return style.visibility !== "hidden" && style.display !== "none" && Number(style.opacity) > 0 && style.clip === "auto" && element.getClientRects().length > 0;
    };
    const overlap = (a, b) => Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 0.5 && Math.min(a.right, b.right) - Math.max(a.left, b.left) > 0.5;
    const hits = (element) => {
      const box = element.getBoundingClientRect();
      const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
      return Boolean(hit && (hit === element || element.contains(hit)));
    };

    const amount = pad.querySelector(".cash-pad-amount");
    let amountReport = null;
    if (amount) {
      const rect = amount.getBoundingClientRect();
      const seen = shown(amount);
      const whole = Boolean(seen) && Math.abs(seen.top - rect.top) < 1 && Math.abs(seen.bottom - rect.bottom) < 1 && Math.abs(seen.left - rect.left) < 1 && Math.abs(seen.right - rect.right) < 1;
      // Text that spills out of its box is cut off too.
      const figure = amount.querySelector(".cash-pad-amount-figure");
      const spills = figure ? figure.scrollWidth > figure.clientWidth + 1 || amount.scrollWidth > amount.clientWidth + 1 : false;
      const touching = [];
      for (const other of pad.querySelectorAll("*")) {
        if (other === amount || amount.contains(other) || other.contains(amount) || !visible(other)) continue;
        const otherSeen = shown(other);
        if (otherSeen && overlap(otherSeen, rect)) touching.push(`${other.tagName.toLowerCase()}.${String(other.className).split(" ")[0]}`);
      }
      amountReport = { whole, spills, touching, height: rect.height, top: rect.top, bottom: rect.bottom, text: amount.textContent };
    }
    const keys = [...pad.querySelectorAll(".cash-pad-key")].filter((key) => visible(key) && shown(key));
    const save = [...pad.querySelectorAll(".cash-pad-save")].find(visible) ?? null;
    const panel = pad.querySelector(".cash-pad-change");
    const question = [...pad.querySelectorAll(".cash-pad-error")].find(visible) ?? null;
    const wallets = panel ? [...panel.querySelectorAll(".cash-pad-choice-row")].find((row) => row.querySelector(".cash-pad-eyebrow")?.textContent === "Cash from") ?? null : null;
    return {
      viewport: { width: vw, height: vh },
      amount: amountReport,
      visibleKeys: keys.length,
      keysReachable: keys.every(hits),
      save: save ? { inside: Boolean(shown(save)) && save.getBoundingClientRect().bottom <= vh + 0.5, reachable: hits(save), text: save.textContent } : null,
      panel: panel ? { height: panel.clientHeight, scrolls: panel.scrollHeight > panel.clientHeight + 1 } : null,
      // The question sits right above the wallets it asks about, inside the
      // panel.
      questionAboveWallets: question && wallets ? panel.contains(question) && question.getBoundingClientRect().bottom <= wallets.getBoundingClientRect().top + 0.5 : null
    };
  });
}

async function expectAmountClear(page, label) {
  const layout = await readLayout(page);
  expect(layout.amount, `${label}: the amount shows`).not.toBeNull();
  expect(layout.amount.whole, `${label}: the whole amount is in view (${JSON.stringify(layout.amount)})`).toBe(true);
  expect(layout.amount.spills, `${label}: the amount fits its line`).toBe(false);
  expect(layout.amount.touching, `${label}: nothing overlaps the amount`).toEqual([]);
  return layout;
}

async function expectPanelLayout(page, label) {
  const layout = await expectAmountClear(page, label);
  expect(layout.visibleKeys, `${label}: no number key while the panel is open`).toBe(0);
  expect(layout.amount.height, `${label}: the amount is one compact line`).toBeLessThanOrEqual(56);
  expect(layout.save?.inside && layout.save?.reachable, `${label}: Save is in reach`).toBe(true);
  // The panel scrolls only when it truly cannot fit, and then it has most
  // of the screen.
  if (layout.panel.scrolls) {
    expect(layout.panel.height, `${label}: a scrolling panel has the room`).toBeGreaterThanOrEqual(layout.viewport.height * 0.45);
  }
  return layout;
}

async function expectKeysLayout(page, label) {
  const layout = await expectAmountClear(page, label);
  expect(layout.visibleKeys, `${label}: all twelve keys`).toBe(12);
  expect(layout.keysReachable, `${label}: every key can be tapped`).toBe(true);
  expect(layout.save?.inside && layout.save?.reachable, `${label}: Save is in reach`).toBe(true);
  return layout;
}

// Every choice in a row can be brought into view and tapped where it is.
async function expectRowReachable(pad, row, label) {
  const chips = row.getByRole("button");
  const count = await chips.count();
  expect(count, `${label}: has choices`).toBeGreaterThan(0);
  for (let index = 0; index < count; index += 1) {
    const chip = chips.nth(index);
    // Scrolled the least that shows it, as a thumb would.
    const reachable = await chip.evaluate((element) => {
      element.scrollIntoView({ block: "nearest", inline: "nearest" });
      const box = element.getBoundingClientRect();
      if (box.top < 0 || box.left < 0 || box.bottom > window.innerHeight || box.right > window.innerWidth) return false;
      const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
      return Boolean(hit && (hit === element || element.contains(hit)));
    });
    expect(reachable, `${label}: ${await chip.textContent()} can be tapped`).toBe(true);
  }
  return count;
}

const ROW_LABELS = { way: "Paid with", wallet: "Cash from", currency: "Currency", day: "Day", person: "Who paid" };

function choiceRow(pad, name) {
  return pad.locator(".cash-pad-choice-row").filter({ hasText: new RegExp(`^${ROW_LABELS[name]}`) });
}

for (const size of SIZES) {
  test.describe(`Quick pad fit at ${size.width}x${size.height}`, () => {
    test.use({ viewport: size, isMobile: true, hasTouch: true });

    test.beforeEach(async ({ page }) => {
      await page.addInitScript(() => window.localStorage.setItem("monies-map:money-totals-visible", "true"));
      // Seeded before the first page load, so no page holds the empty
      // household's people from a fresh test database.
      await reseedDemo(page);
    });

    test("Save with no cash wallet: the question opens the wallets in place of the keys, and the wallet picked saves", async ({ page }) => {
      const walletIds = await seedLongWallets(page);
      const pad = await openPad(page);
      await press(pad, ["8", "0"]);
      await expectKeysLayout(page, "typed 80");
      await shot(page, "keys");

      let creates = 0;
      page.on("request", (request) => {
        if (request.url().includes("/api/cash-entries/create")) creates += 1;
      });
      await pad.getByRole("button", { name: "Save", exact: true }).click();
      await expect(pad.locator(".cash-pad-error")).toHaveText("Which wallet did the cash come from?");
      expect(creates).toBe(1);
      const layout = await expectPanelLayout(page, "wallet question");
      expect(layout.amount.text.replace(/\s/g, "")).toBe("$80");
      expect(layout.questionAboveWallets, "the question sits above the wallets").toBe(true);
      await shot(page, "question");

      const wallets = choiceRow(pad, "wallet");
      expect(await expectRowReachable(pad, wallets, "wallets")).toBeGreaterThanOrEqual(LONG_WALLETS.length);
      await expectPanelLayout(page, "wallet question, scrolled");
      await shot(page, "question-scrolled");

      // The person already said Save: the wallet picked saves the payment.
      const last = LONG_WALLETS.at(-1);
      const saved = page.waitForResponse((response) => response.url().includes("/api/cash-entries/create") && response.ok());
      await wallets.getByRole("button", { name: last, exact: true }).click();
      const { entry } = await (await saved).json();
      expect(entry).toMatchObject({ accountId: walletIds.at(-1), paidAmountMinor: 8000, paidCurrency: "SGD", personId: TIM });
      await expect(pad.locator(".cash-pad-saved-line")).toHaveText("Saved: Cash, $80.00");
      await expect(pad.locator(".cash-pad-change")).toHaveCount(0);
      // Undo is right there.
      const undo = pad.locator(".cash-pad-after-actions").getByRole("button", { name: "Undo" });
      await expect(undo).toBeInViewport();
      await shot(page, "saved");
      const month = today().slice(0, 7);
      const data = await loadEntriesPage(page, { view: "household", month });
      expect(data.monthPage.entries.filter((item) => item.id === entry.entryId)).toHaveLength(1);
      expect(creates).toBe(2);
    });

    test("the summary line opens every chooser in place of the keys, picking never saves, and Done brings the keys back", async ({ page }) => {
      await seedLongWallets(page);
      let creates = 0;
      page.on("request", (request) => {
        if (request.url().includes("/api/cash-entries/create")) creates += 1;
      });
      const pad = await openPad(page);
      await press(pad, ["8", "0"]);
      await pad.locator(".cash-pad-line").click();
      await expect(pad.locator(".cash-pad-change")).toBeVisible();
      await expectPanelLayout(page, "panel from the line");
      await shot(page, "panel");

      // Each chooser: every choice reachable, one picked, nothing saved.
      const wallets = choiceRow(pad, "wallet");
      await expectRowReachable(pad, wallets, "wallets");
      await wallets.getByRole("button", { name: LONG_WALLETS[5], exact: true }).click();
      await expect(pad.locator(".cash-pad-line")).toContainText(LONG_WALLETS[5]);
      await expect(pad.locator(".cash-pad-change")).toBeVisible();
      await expectPanelLayout(page, "after picking a wallet");

      const currency = choiceRow(pad, "currency");
      await expectRowReachable(pad, currency, "currencies");
      await currency.getByRole("button", { name: "IDR", exact: true }).click();
      await expect(pad.locator(".cash-pad-line")).toContainText("IDR");
      await expectPanelLayout(page, "after picking a currency");
      await shot(page, "currency");

      const day = choiceRow(pad, "day");
      await expectRowReachable(pad, day, "days");
      await day.getByRole("button", { name: "Yesterday", exact: true }).click();
      await expect(pad.locator(".cash-pad-line")).toContainText("Yesterday");
      await expectPanelLayout(page, "after picking a day");

      const person = choiceRow(pad, "person");
      await expectRowReachable(pad, person, "people");
      await person.getByRole("button", { name: "Joyce", exact: true }).click();
      await expect(pad.locator(".cash-pad-line")).toContainText("Joyce");
      await expectPanelLayout(page, "after picking a person");
      await shot(page, "person");

      const way = choiceRow(pad, "way");
      if (await way.count()) {
        await expectRowReachable(pad, way, "paid with");
      }
      expect(creates, "picking in the panel never saves").toBe(0);

      // Done: back to the keys, the choices kept on the line.
      const done = pad.getByRole("button", { name: "Done", exact: true });
      await done.scrollIntoViewIfNeeded();
      await done.click();
      await expect(pad.locator(".cash-pad-change")).toHaveCount(0);
      await expectKeysLayout(page, "back to the keys");
      await expect(pad.locator(".cash-pad-line")).toContainText("Joyce");
      expect(creates).toBe(0);
    });

    test("Type it instead: the new entry, its chips and the message box sit clear, and its wallet list reaches every wallet", async ({ page }) => {
      await seedLongWallets(page);
      const pad = await openPad(page);
      await pad.getByRole("button", { name: "Type it instead" }).click();
      await expect(pad).toBeHidden();
      const parts = {
        amount: page.getByRole("button", { name: "Amount, opens Just paid" }),
        date: page.locator('[data-chip="date"]'),
        wallet: page.locator('[data-chip="wallet"]'),
        owner: page.locator('[data-chip="owner"]'),
        justPaid: page.getByRole("button", { name: "Just paid", exact: true }),
        message: page.getByRole("textbox").last()
      };
      for (const locator of Object.values(parts)) await expect(locator).toBeVisible();
      await shot(page, "type-instead");
      const boxes = {};
      for (const [name, locator] of Object.entries(parts)) {
        boxes[name] = await locator.evaluate((element) => {
          const box = element.getBoundingClientRect();
          const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
          return { top: box.top, left: box.left, bottom: box.bottom, right: box.right, reachable: Boolean(hit && (hit === element || element.contains(hit))) };
        });
        const box = boxes[name];
        expect(box.top >= 0 && box.left >= 0 && box.bottom <= size.height && box.right <= size.width, `${name} is on screen`).toBe(true);
        expect(box.reachable, `${name} can be tapped`).toBe(true);
      }
      const names = Object.keys(boxes);
      for (const [index, first] of names.entries()) {
        for (const second of names.slice(index + 1)) {
          const a = boxes[first];
          const b = boxes[second];
          const overlaps = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 0.5 && Math.min(a.right, b.right) - Math.max(a.left, b.left) > 0.5;
          expect(overlaps, `${first} and ${second} do not overlap`).toBe(false);
        }
      }

      // The wallet chip's list: every wallet in reach, the one picked shows.
      await parts.wallet.click();
      const sheet = page.locator(".mobile-select-dialog");
      await expect(sheet).toBeVisible();
      const options = sheet.locator(".mobile-select-option");
      await expect(options.filter({ hasText: LONG_WALLETS[0] })).toHaveCount(1);
      await shot(page, "type-instead-wallets");
      expect(await expectRowReachable(page, sheet.locator(".mobile-select-options"), "entry wallets")).toBeGreaterThanOrEqual(LONG_WALLETS.length);
      await options.filter({ hasText: LONG_WALLETS.at(-1) }).click();
      await expect(sheet).toBeHidden();
      await expect(parts.wallet).toContainText(LONG_WALLETS.at(-1).slice(0, 12));
    });

    test("a long foreign amount fits on one line", async ({ page }) => {
      const pad = await openPad(page);
      await pad.locator(".cash-pad-line").click();
      await choiceRow(pad, "currency").getByRole("button", { name: "IDR", exact: true }).click();
      await pad.getByRole("button", { name: "Done", exact: true }).click();
      await press(pad, ["9", "8", "7", "6", "5", "4", "3", "2", "1", "000"]);
      await expect(pad.locator(".cash-pad-amount-figure")).toHaveText("987,654,321,000");
      await expectKeysLayout(page, "long rupiah amount");
      await shot(page, "long-amount");
      await pad.locator(".cash-pad-line").click();
      await expectPanelLayout(page, "long rupiah amount, panel open");
      await shot(page, "long-amount-panel");
    });

    test("a payment waiting to send keeps the keys, the amount and Save clear", async ({ page }) => {
      const wallet = await postJson(page, "/api/accounts/create", { name: "Tim's cash", institution: "Cash", kind: "cash", currency: "SGD", ownerPersonId: TIM });
      await postJson(page, "/api/settings/payment-ways/save", { personId: TIM, bankTransferAccountId: "", cashAccountId: wallet.accountId });
      await page.route("**/api/cash-entries/create", (route) => route.abort("internetdisconnected"));
      await gotoPageAfterApi(page, `/entries?view=${TIM}&month=${today().slice(0, 7)}`, "/api/entries-page", () => page.locator(".entries-fab:not(.splits-fab)"));
      const pad = await openJustPaid(page);
      await expect(pad.locator(".cash-pad-line")).toContainText("Tim's cash", { timeout: 30_000 });
      for (const amount of [["4", "2"], ["1", "7"]]) {
        await press(pad, amount);
        await pad.getByRole("button", { name: "Save", exact: true }).click();
        await expect(pad.locator(".cash-pad-message")).toContainText("Waiting to send");
      }
      await expect(pad.getByRole("region", { name: "Waiting to send" }).locator("li")).toHaveCount(2);
      await press(pad, ["8"]);
      await expectKeysLayout(page, "waiting to send");
      await shot(page, "waiting");
      await pad.locator(".cash-pad-line").click();
      await expectPanelLayout(page, "waiting to send, panel open");
    });
  });
}
