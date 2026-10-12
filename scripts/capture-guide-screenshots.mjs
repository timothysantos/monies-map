#!/usr/bin/env node
// Captures every screenshot the in-app User guide references
// (docs/user-guide.md), so the pictures can be regenerated with one command:
//
//   npm run build                # the Worker serves dist/, so build first
//   npm run docs:screenshots     # all shots
//   npm run docs:screenshots -- summary-household phone-month-sheet
//   npm run docs:screenshots -- --list
//   npm run docs:screenshots -- --base-url http://127.0.0.1:5442   (reuse a stack)
//   npm run docs:screenshots -- --import-iphone <dir>   (compress real iPhone captures)
//
//   npm run docs:screenshots -- --seed-month 2026-10     (see SEED_MONTH)
//
// It starts its own isolated stack (Vite 5442, Wrangler 8842, inspector 9442,
// D1 in .wrangler/state-guide) and never touches 5173/8787 or real data. The
// stack's Worker runs the showcase demo dataset (Ethan and Serene, the data
// of the public demo site: DEMO_DATASET=showcase) around a fixed seed month,
// so the data is the same on every run. The script reseeds it through POST
// /api/demo/reseed, reveals money totals, then walks each workflow at desktop
// 1280x800 in Chromium and on an iPhone 13 profile in WebKit (Safari's engine;
// `npx playwright install webkit` once).
// Output: WebP files plus thumbnails under public/faq/guide/{desktop,phone,iphone}/
// (the "On your iPhone" gallery is shot on the phone profile at the iphone size).
/* global window, document, HTMLElement -- only inside page.evaluate / waitForFunction / addInitScript, which run in the browser */
import { copyFile, mkdir, readdir, stat } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { chromium, devices, webkit } from "@playwright/test";
import sharp from "sharp";
import { prepareStack, startStack } from "./e2e-stack.mjs";

// The showcase's seed month: its last month (M0), with 16 months of history
// before it, seeded in full. The Import inbox asks for files against the
// real current month, so the inbox shot shows the showcase's intended state
// (one missing statement) only when this is the month you capture in; pass
// --seed-month with the current month when regenerating later.
const seedMonthArg = process.argv.indexOf("--seed-month");
const SEED_MONTH = seedMonthArg === -1 ? "2026-09" : process.argv[seedMonthArg + 1];
if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(SEED_MONTH ?? "")) throw new Error("--seed-month needs a YYYY-MM month.");

function addMonths(month, count) {
  const [year, monthNumber] = month.split("-").map(Number);
  const index = year * 12 + (monthNumber - 1) + count;
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, "0")}`;
}

// Most shots show the last complete month (M-1): every statement imported.
// The showcase stories are relative to the seed month (demo-showcase-data.ts).
const MONTH = addMonths(SEED_MONTH, -1);
// The oldest month (M-16): a range from it holds last month's same month a
// year earlier (M-13), so the check-in can show a same-season comparison.
const OLDEST_MONTH = addMonths(SEED_MONTH, -16);
const OUT_DIR = path.resolve("public/faq/guide");
const GUIDE_STACK = {
  index: "guide",
  uiPort: 5442,
  apiPort: 8842,
  inspectorPort: 9442,
  baseURL: "http://127.0.0.1:5442",
  apiOrigin: "http://127.0.0.1:8842",
  persistTo: ".wrangler/state-guide",
  viteCacheDir: "node_modules/.vite-guide",
  serverLog: "test-results/guide-screenshots/servers.log",
  // Over wrangler.test.jsonc: reseed builds the showcase around SEED_MONTH.
  // AI_ALERT_EMAILS "*" as wrangler.jsonc ships it, so Settings lists Ask
  // and AI as it does in production (Claude is not set up here).
  vars: { DEMO_DATASET: "showcase", DEMO_SEED_MONTH: SEED_MONTH, AI_ALERT_EMAILS: "*" }
};

// Output sizes. Desktop shots are taken at 1280x800 (device scale 1); phone
// shots at the iPhone 13 profile (390x664 CSS px, scale 3) and scaled down.
const SIZES = {
  desktop: { full: 1280, thumb: 640, quality: 72, thumbQuality: 70 },
  phone: { full: 780, thumb: 390, quality: 70, thumbQuality: 68 },
  iphone: { full: 600, thumb: 300, quality: 68, thumbQuality: 66 }
};

// ---------------------------------------------------------------------------
// Page helpers

async function waitUsable(page, { timeout = 45_000 } = {}) {
  await page.waitForFunction(() => {
    const work = window.__MONIES_MAP_ROUTE_WORK__;
    return Boolean(work && work.usable);
  }, null, { timeout });
  // Let charts finish their entry animation and the check-in settle.
  await page.waitForTimeout(900);
}

async function open(page, url) {
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await waitUsable(page);
}

// Ask, asked how much went on public transport this month.
async function openAskAnswer(page) {
  await open(page, `/ask?view=person-ethan&month=${MONTH}&scope=direct_plus_shared`);
  const message = page.getByRole("textbox", { name: "Message" });
  await message.fill("How much on public transport?");
  await message.press("Enter");
  await page.locator(".ask-answer[data-ask-answer]:not([data-ask-answer=''])").waitFor();
  await message.blur();
  await waitUsable(page);
}

async function hideCaret(page) {
  await page.addStyleTag({ content: "*{caret-color:transparent !important} ::-webkit-scrollbar{display:none}" });
}

// While files are in review the import bar is stuck to the top (about
// 120 px at 1280 wide); shots below it scroll their subject under it.
const STUCK_IMPORT_BAR_OFFSET = 140;

async function scrollToLocator(page, locator, offset = 90) {
  await locator.first().waitFor({ state: "visible", timeout: 20_000 });
  await locator.first().evaluate((element, top) => {
    const rect = element.getBoundingClientRect();
    window.scrollTo({ top: Math.max(0, window.scrollY + rect.top - top), behavior: "instant" });
  }, offset);
  await page.waitForTimeout(350);
}

async function reseed(page) {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const response = await page.request.post("/api/demo/reseed").catch(() => null);
    if (response?.ok()) return;
    await page.waitForTimeout(750);
  }
  throw new Error("Could not reseed the demo data.");
}

// Settings sections start collapsed; open one by its heading.
async function openSettingsSection(page, heading) {
  await open(page, "/settings?view=household");
  const toggle = page.locator(".settings-section-toggle").filter({ has: page.getByRole("heading", { name: heading, exact: true }) }).first();
  await toggle.click();
  await page.waitForTimeout(500);
  await scrollToLocator(page, toggle, 20);
}

// A sanitized UOB card export (it names "UOB One Card", which the showcase
// does not have), copied under the bank's plain file name so the batch name
// does not carry the test fixture's suffix.
const SAMPLE_EXPORT_NAME = "CC_TXN_History_06052026211223";
const SAMPLE_CARD_ACCOUNT = "UOB One Card (new)";
async function sampleCardExport() {
  const target = path.resolve("test-results/guide-screenshots", `${SAMPLE_EXPORT_NAME}.xls`);
  await mkdir(path.dirname(target), { recursive: true });
  await copyFile("tests/fixtures/uob-current-transactions/CC_TXN_History_06052026211223-onecard-tim-06-may.xls", target);
  return target;
}

const splitsUrl = (view = "person-ethan", extra = "") => `/splits?view=${view}&month=${MONTH}${extra}`;

// ---------------------------------------------------------------------------
// The shots. `reseed: true` restores the demo first, because the shot (or the
// one before it) changes data. Read-only shots come first.

const SHOTS = [
  // Start here
  {
    name: "summary-household", device: "desktop",
    run: (page) => open(page, `/summary?view=household&month=${MONTH}`)
  },
  {
    name: "summary-person", device: "desktop",
    run: (page) => open(page, `/summary?view=person-ethan&month=${MONTH}`)
  },
  {
    name: "money-hidden", device: "desktop", hidden: true,
    run: (page) => open(page, `/summary?view=household&month=${MONTH}`)
  },
  {
    name: "summary-insight-expanded", device: "desktop",
    run: async (page) => {
      // From the oldest month, the range holds last month's same month a year
      // earlier, so the Long view can compare them (docs/demo-tour.md, step 2).
      // Its month-level lines talk about the range's latest month (MONTH).
      await open(page, `/summary?view=household&month=${MONTH}&summary_start=${OLDEST_MONTH}&summary_end=${MONTH}`);
      await page.getByRole("button", { name: "See all insights" }).first().click();
      await scrollToLocator(page, page.locator(".financial-insight"), 20);
    }
  },
  {
    name: "summary-range-picker", device: "desktop",
    run: async (page) => {
      await open(page, `/summary?view=household&month=${MONTH}`);
      await page.locator(".period-range-segment").first().click();
      await page.waitForTimeout(400);
    }
  },
  {
    name: "summary-charts", device: "desktop",
    run: async (page) => {
      await open(page, `/summary?view=household&month=${MONTH}`);
      await scrollToLocator(page, page.getByText("Intent vs Outcome", { exact: true }), 20);
    }
  },
  {
    name: "summary-wallets", device: "desktop",
    run: async (page) => {
      await open(page, `/summary?view=household&month=${MONTH}`);
      await scrollToLocator(page, page.getByText("Wallets in view", { exact: true }), 120);
    }
  },
  // Month
  {
    name: "month-person", device: "desktop",
    run: (page) => open(page, `/month?view=person-ethan&month=${MONTH}`)
  },
  {
    name: "month-household", device: "desktop",
    run: async (page) => {
      await open(page, `/month?view=household&month=${MONTH}`);
      await scrollToLocator(page, page.getByText("Combined household view is read-only.", { exact: false }), 200);
    }
  },
  {
    name: "month-edit-row", device: "desktop",
    run: async (page) => {
      await open(page, `/month?view=person-ethan&month=${MONTH}`);
      const row = page.locator("tr").filter({ hasText: "Food & Drinks" }).first();
      await scrollToLocator(page, row, 220);
      await row.locator(".month-cell-item").click();
      await page.locator(".month-inline-action-row").first().waitFor();
      await page.waitForTimeout(300);
    }
  },
  {
    name: "month-link-entries", device: "desktop",
    run: async (page) => {
      await open(page, `/month?view=person-ethan&month=${MONTH}`);
      const row = page.locator("tr").filter({ hasText: "Prudential premium" }).first();
      await scrollToLocator(page, row, 300);
      await row.locator(".planned-link-manage-trigger").first().click();
      await page.getByRole("dialog").first().waitFor();
      await page.waitForTimeout(500);
    }
  },
  {
    name: "month-actions", device: "desktop",
    run: async (page) => {
      await open(page, `/month?view=person-ethan&month=${MONTH}`);
      await page.getByRole("button", { name: "Actions", exact: true }).click();
      await page.waitForTimeout(400);
    }
  },
  // Entries
  {
    name: "entries-person", device: "desktop",
    run: (page) => open(page, `/entries?view=person-ethan&month=${MONTH}`)
  },
  {
    name: "entries-add", device: "desktop",
    run: async (page) => {
      await open(page, `/entries?view=person-ethan&month=${MONTH}`);
      await page.getByRole("button", { name: "+ Add entry" }).first().click();
      const composer = page.locator(".entry-composer").first();
      await composer.getByLabel("Description").fill("Kopi and kaya toast");
      await composer.getByLabel("Amount").fill("6.80");
      await composer.locator("select").first().selectOption({ label: "Food & Drinks" });
      await scrollToLocator(page, composer, 60);
      await hideCaret(page);
    }
  },
  {
    name: "entries-edit", device: "desktop",
    run: async (page) => {
      await open(page, `/entries?view=person-ethan&month=${MONTH}`);
      const row = page.locator(".entry-row").filter({ hasText: "GOLDEN VILLAGE" }).first();
      await scrollToLocator(page, row, 160);
      await row.click();
      await page.getByRole("button", { name: "Done editing entry" }).waitFor();
      await scrollToLocator(page, page.locator(".entry-row.is-inline-editing"), 90);
      await hideCaret(page);
    }
  },
  {
    name: "entries-filtered", device: "desktop",
    run: async (page) => {
      await open(page, `/entries?view=household&month=${MONTH}&entry_category=Bills`);
      await scrollToLocator(page, page.locator(".entries-filter-bar"), 20);
    }
  },
  // Splits
  {
    name: "splits-person", device: "desktop",
    run: (page) => open(page, splitsUrl())
  },
  {
    name: "splits-add-expense", device: "desktop",
    run: async (page) => {
      await open(page, splitsUrl("person-ethan", "&split_group=split-group-dinners"));
      await page.locator(".splits-summary-strip").getByRole("button", { name: "+ Add expense" }).click();
      const dialog = page.getByRole("dialog", { name: "New split expense" });
      await dialog.getByLabel("Description").fill("Dinner at Din Tai Fung");
      await dialog.getByLabel("Category").selectOption("Food & Drinks");
      await dialog.getByLabel("Expense total").fill("86.40");
      await dialog.getByLabel("Note").fill("Birthday dinner");
      // Back to the top, so the shot leads with the card and its total.
      await page.evaluate(() => document.activeElement instanceof HTMLElement && document.activeElement.blur());
      await dialog.locator(".split-dialog-scroll").evaluate((element) => { element.scrollTop = 0; });
      await page.waitForTimeout(400);
      await hideCaret(page);
    }
  },
  {
    name: "splits-settle-group", device: "desktop",
    run: async (page) => {
      await open(page, splitsUrl("person-ethan", "&split_group=split-group-dinners"));
      await page.getByRole("button", { name: "Settle group" }).first().click();
      await page.getByRole("dialog").first().waitFor();
      await page.waitForTimeout(400);
    }
  },
  {
    name: "splits-matches", device: "desktop",
    run: (page) => open(page, splitsUrl("person-ethan", "&split_mode=matches"))
  },
  {
    name: "splits-create-group", device: "desktop",
    run: async (page) => {
      await open(page, splitsUrl());
      await page.locator(".splits-strip").getByRole("button", { name: "Create group" }).click();
      const dialog = page.getByRole("dialog", { name: "Create group" });
      await dialog.getByLabel("Group name").fill("Seoul trip");
      await dialog.getByLabel("Group currency").selectOption("KRW");
      await page.waitForTimeout(300);
      await hideCaret(page);
    }
  },
  // Imports
  {
    name: "imports-inbox", device: "desktop",
    run: (page) => open(page, `/imports?view=household&month=${MONTH}`)
  },
  {
    name: "imports-upload", device: "desktop",
    run: async (page) => {
      await open(page, `/imports?view=household&month=${MONTH}`);
      await scrollToLocator(page, page.getByText("Import and certify", { exact: true }), 20);
    }
  },
  // Settings
  {
    name: "settings-overview", device: "desktop",
    run: (page) => open(page, "/settings?view=household")
  },
  {
    name: "settings-accounts", device: "desktop",
    run: async (page) => {
      await openSettingsSection(page, "Accounts");
    }
  },
  {
    name: "settings-add-account", device: "desktop",
    run: async (page) => {
      await openSettingsSection(page, "Accounts");
      await page.getByRole("button", { name: "+ Add account" }).first().click();
      await page.getByRole("dialog").first().waitFor();
      await page.waitForTimeout(400);
      await hideCaret(page);
    }
  },
  {
    name: "settings-reconcile", device: "desktop",
    run: async (page) => {
      await openSettingsSection(page, "Accounts");
      await page.getByRole("button", { name: "Reconcile" }).first().click();
      await page.getByRole("dialog").first().waitFor();
      await page.waitForTimeout(400);
      await hideCaret(page);
    }
  },
  {
    name: "settings-people", device: "desktop",
    run: async (page) => {
      await openSettingsSection(page, "People");
    }
  },
  {
    name: "settings-trust", device: "desktop",
    run: async (page) => {
      await openSettingsSection(page, "Balance trust rules");
    }
  },
  {
    name: "settings-category-rules", device: "desktop",
    run: async (page) => {
      await open(page, "/settings?view=household&settings_section=categoryRules");
      await scrollToLocator(page, page.getByRole("heading", { name: "Category matching", exact: true }), 20);
    }
  },
  {
    name: "settings-shortcut", device: "desktop",
    run: async (page) => {
      await openSettingsSection(page, "Apple Pay shortcut");
    }
  },
  {
    name: "settings-payment-ways", device: "desktop",
    run: async (page) => {
      await openSettingsSection(page, "Payment ways");
    }
  },
  // Help
  {
    name: "faq-tabs", device: "desktop",
    run: async (page) => {
      await open(page, "/faq?view=household");
      await page.getByRole("navigation", { name: "Contents" }).waitFor();
    }
  },
  // Troubleshooting: a page that could not load, with its retry button.
  {
    name: "page-load-error", device: "desktop",
    run: async (page) => {
      await page.route("**/api/month-page**", (route) => route.fulfill({ status: 503, contentType: "text/plain", body: "Service unavailable" }));
      await page.goto(`/month?view=person-ethan&month=${MONTH}`, { waitUntil: "domcontentloaded" });
      await page.getByRole("button", { name: /Try/ }).first().waitFor({ timeout: 60_000 });
      await page.waitForTimeout(400);
      await page.unroute("**/api/month-page**");
    }
  },
  // Phone
  {
    name: "phone-summary", device: "phone",
    run: (page) => open(page, `/summary?view=person-ethan&month=${MONTH}`)
  },
  {
    name: "phone-month", device: "phone",
    run: (page) => open(page, `/month?view=person-ethan&month=${MONTH}`)
  },
  {
    name: "phone-view-scope", device: "phone",
    run: async (page) => {
      await open(page, `/month?view=person-ethan&month=${MONTH}`);
      await page.locator(".mobile-context-trigger").first().click();
      await page.getByRole("dialog").first().waitFor();
      await page.waitForTimeout(500);
    }
  },
  {
    // The Summary tab's "Pick a month" sheet, opened from the month in the
    // floating bar with a month picked.
    name: "phone-month-picker", device: "phone",
    run: async (page) => {
      await open(page, `/month?view=person-ethan&month=${MONTH}`);
      await page.locator(".mobile-month-choice-open").click();
      await page.getByRole("dialog", { name: "Pick a month" }).waitFor();
      await page.waitForTimeout(600);
    }
  },
  {
    name: "phone-month-sheet", device: "phone",
    run: async (page) => {
      await open(page, `/month?view=person-ethan&month=${MONTH}`);
      const row = page.locator("tr").filter({ hasText: "Food & Drinks" }).first();
      await scrollToLocator(page, row, 260);
      await row.locator(".month-cell-item").click();
      await page.getByRole("dialog").first().waitFor();
      await page.waitForTimeout(600);
      await hideCaret(page);
    }
  },
  {
    name: "phone-entries", device: "phone",
    run: (page) => open(page, `/entries?view=person-ethan&month=${MONTH}`)
  },
  {
    // The round + button opens the Ask page's new entry card.
    name: "phone-entries-add", device: "phone",
    run: async (page) => {
      await open(page, `/entries?view=person-ethan&month=${MONTH}`);
      await page.locator(".entries-fab:not(.splits-fab)").click();
      await page.locator('[data-ask-card="draft"]').waitFor();
      await page.waitForTimeout(600);
      await hideCaret(page);
    }
  },
  {
    // Desktop Ask: asked from the bottom-right field on Entries, docked
    // beside the page, which narrows (1,280 px).
    name: "desktop-ask-docked", device: "desktop",
    run: async (page) => {
      await open(page, `/entries?view=person-ethan&month=${MONTH}`);
      await page.getByRole("textbox", { name: "Ask", exact: true }).click();
      // The field goes once the conversation is in the panel.
      await page.locator(".ask-dock-field").waitFor({ state: "detached" });
      const message = page.getByRole("textbox", { name: "Message" });
      await message.fill("How much on public transport?");
      await message.press("Enter");
      await page.locator(".ask-dock .ask-answer[data-ask-answer]:not([data-ask-answer=''])").waitFor();
      await message.blur();
      await waitUsable(page);
      await hideCaret(page);
    }
  },
  {
    // A smaller window (1,024 px): the same conversation as a popup over
    // the page.
    name: "desktop-ask-popup", device: "desktop",
    run: async (page) => {
      await page.setViewportSize({ width: 1024, height: 768 });
      await open(page, `/summary?view=person-ethan&month=${MONTH}`);
      await page.getByRole("textbox", { name: "Ask", exact: true }).click();
      await page.getByRole("textbox", { name: "Message" }).waitFor();
      await page.getByRole("textbox", { name: "Message" }).blur();
      await waitUsable(page);
      await hideCaret(page);
    }
  },
  {
    // The Ask tab, opened after Summary so "Since you last looked" has
    // the insights Summary loaded.
    name: "phone-ask", device: "phone",
    run: async (page) => {
      await open(page, `/summary?view=person-ethan&month=${MONTH}`);
      await page.locator("nav.tab-strip").getByRole("link", { name: "Ask" }).click();
      await page.getByRole("heading", { name: "Ask", exact: true }).waitFor();
      await waitUsable(page);
    }
  },
  {
    // A question answered on Ask: the total, the count and the filters,
    // with Open in Entries first in the chips.
    name: "phone-ask-answer", device: "phone",
    run: async (page) => {
      await openAskAnswer(page);
      await hideCaret(page);
    }
  },
  {
    // Open in Entries from that answer: the list it counted, with the
    // From Ask chip above the View and scope bar.
    name: "phone-entries-from-ask", device: "phone",
    run: async (page) => {
      await openAskAnswer(page);
      await page.getByRole("group", { name: "Suggestions" }).getByRole("button", { name: "Open in Entries" }).click();
      await page.getByRole("group", { name: "From Ask" }).waitFor();
      await waitUsable(page);
    }
  },
  {
    name: "phone-splits", device: "phone",
    run: (page) => open(page, splitsUrl())
  },
  {
    name: "phone-faq", device: "phone",
    run: async (page) => {
      await open(page, "/faq?view=household");
      await page.getByRole("navigation", { name: "Contents" }).waitFor();
    }
  },
  {
    name: "phone-more", device: "phone",
    run: async (page) => {
      await open(page, `/summary?view=household&month=${MONTH}`);
      await page.getByRole("button", { name: /More pages/ }).first().click();
      await page.waitForTimeout(500);
    }
  },
  // The "On your iPhone" gallery: each screen as it opens on an iPhone, in
  // WebKit, saved at the iphone size under public/faq/guide/iphone/.
  ...[
    ["01-summary", `/summary?view=person-ethan&month=${MONTH}`],
    ["02-month", `/month?view=person-ethan&month=${MONTH}`],
    ["03-entries", `/entries?view=person-ethan&month=${MONTH}`],
    ["04-splits", splitsUrl()],
    ["05-imports", "/imports?view=household"],
    ["06-settings", "/settings?view=household"],
    ["07-faq", "/faq?view=household"],
    ["08-household-summary", `/summary?view=household&month=${MONTH}`]
  ].map(([name, url]) => ({
    name, device: "phone", kind: "iphone",
    run: (page) => open(page, url)
  })),
  {
    name: "entries-add-to-splits", device: "desktop",
    run: async (page) => {
      await open(page, `/entries?view=person-ethan&month=${MONTH}`);
      const row = page.locator(".entry-row").filter({ hasText: "GOLDEN VILLAGE" }).first();
      await scrollToLocator(page, row, 160);
      await row.click();
      await page.getByRole("button", { name: "Add to splits" }).first().click();
      await page.getByRole("dialog", { name: "Add to splits" }).waitFor();
      await page.waitForTimeout(400);
    }
  },
  // Workflows that change data: each starts from a fresh demo. `also` names
  // the extra step shots the workflow captures on the way.
  {
    name: "imports-mapping", device: "desktop", reseed: true, also: ["imports-preview", "imports-committed", "imports-rollback"],
    run: async (page, capture) => {
      // The sample export is from May 2026. Serene's showcase cards already
      // have confirmed May statements, which keep every row of an old export
      // out, so the export goes to a new card that has no statement yet.
      const reference = await (await page.request.get("/api/reference-data")).json();
      const serene = reference.accounts.find((account) => account.name === "UOB PRVI Miles Card")?.ownerPersonId;
      await page.request.post("/api/accounts/create", {
        data: { name: SAMPLE_CARD_ACCOUNT, institution: "UOB", kind: "credit_card", currency: "SGD", openingBalanceMinor: 0, ownerPersonId: serene ?? null, isJoint: false }
      });
      await open(page, `/imports?view=household&month=${MONTH}`);
      // The import defaults sit behind "Paste rows or set defaults".
      await page.getByRole("button", { name: "Paste rows or set defaults" }).click();
      await page.getByLabel("Default account").selectOption({ label: `${SAMPLE_CARD_ACCOUNT} - Serene` });
      await page.locator("input[type=file]").first().setInputFiles(await sampleCardExport());
      // The stuck import bar folds this line away, so wait for it to exist.
      await page.getByText(/ready for review/).first().waitFor({ state: "attached", timeout: 60_000 });
      await page.waitForTimeout(1500);
      await scrollToLocator(page, page.getByText("Preview rows", { exact: true }), STUCK_IMPORT_BAR_OFFSET);
      // The export names the card ("UOB One Card"): map it to the account.
      await capture("imports-mapping");
      await page.getByRole("combobox").filter({ has: page.locator("option", { hasText: "Choose account" }) }).first().selectOption({ label: `${SAMPLE_CARD_ACCOUNT} - Serene` });
      await page.locator("button:has-text('Commit import to ledger'):enabled").first().waitFor({ timeout: 60_000 });
      await page.waitForTimeout(1500);
      await scrollToLocator(page, page.getByText("Preview rows", { exact: true }), STUCK_IMPORT_BAR_OFFSET);
      await capture("imports-preview");
      await page.getByRole("button", { name: "Commit import to ledger" }).first().click();
      await page.getByText(/^File imported:/).first().waitFor({ timeout: 60_000 });
      await page.waitForTimeout(800);
      // Recent imports starts closed.
      await page.locator(".import-history-toggle").click();
      await scrollToLocator(page, page.getByRole("heading", { name: "Recent imports", exact: true }), STUCK_IMPORT_BAR_OFFSET);
      await capture("imports-committed");
      // The showcase's own imports are stamped later in the seed month, so
      // the new batch is not the first row: roll back that one.
      const batch = page.locator(".import-card-compact").filter({ hasText: SAMPLE_EXPORT_NAME }).first();
      await scrollToLocator(page, batch, 300);
      await batch.getByRole("button", { name: "Rollback import" }).click();
      await page.getByRole("button", { name: "Confirm rollback" }).first().waitFor();
      await page.waitForTimeout(300);
    }
  },
  {
    name: "splits-edit", device: "desktop", reseed: true, also: ["splits-delete", "splits-history-restore"],
    run: async (page, capture) => {
      await open(page, splitsUrl("person-ethan", "&split_group=split-group-dinners"));
      const card = page.locator(".split-activity-card").filter({ hasText: "Jumbo Seafood dinner" }).first();
      await scrollToLocator(page, card, 200);
      await card.click();
      // An open expense edits in place; its form replaces the row.
      const editor = page.locator(".split-date-group").filter({ has: page.getByRole("button", { name: "Delete", exact: true }) }).first();
      await editor.waitFor();
      await scrollToLocator(page, editor, 60);
      await hideCaret(page);
      await capture("splits-edit");
      await editor.getByRole("button", { name: "Delete", exact: true }).click();
      const confirm = page.getByRole("dialog", { name: "Delete split row" });
      await confirm.waitFor();
      await page.waitForTimeout(300);
      await capture("splits-delete");
      await confirm.getByRole("button", { name: "Delete split row" }).click();
      await page.getByRole("dialog").first().waitFor({ state: "hidden", timeout: 30_000 });
      await waitUsable(page);
      await page.getByRole("button", { name: "Activity history" }).click();
      await page.getByRole("dialog", { name: "Split activity history" }).getByRole("button", { name: "Restore" }).first().waitFor();
      await page.waitForTimeout(400);
    }
  },
  {
    // The showcase already holds an open simplified settlement (Home & Bills
    // with Dinners out), waiting for its bank transfer.
    name: "splits-simplify", device: "desktop", reseed: true,
    run: async (page) => {
      await open(page, splitsUrl("person-ethan", "&split_group=split-group-home-bills"));
      await page.locator(".split-checkpoint-panel").first().waitFor({ timeout: 30_000 });
      await scrollToLocator(page, page.locator(".split-checkpoint-panel"), 120);
    }
  },
  {
    name: "month-add-planned", device: "desktop", reseed: true,
    run: async (page) => {
      await open(page, `/month?view=person-ethan&month=${MONTH}`);
      const add = page.getByRole("button", { name: "+ Add planned item" });
      await scrollToLocator(page, add, 200);
      await add.click();
      await page.locator(".month-inline-action-row").first().waitFor();
      await page.waitForTimeout(400);
      await hideCaret(page);
    }
  },
  {
    // A money question answered on Ask: July (the over-plan month) against
    // its plan, the change from June, where it went and the biggest costs,
    // with Open in Entries and Open Month first in the chips.
    name: "phone-ask-money-answer", device: "phone",
    run: async (page) => {
      await open(page, `/ask?view=household&month=${MONTH}&scope=direct_plus_shared`);
      const message = page.getByRole("textbox", { name: "Message" });
      await message.fill(`Why was ${new Date(`${addMonths(SEED_MONTH, -2)}-01T00:00:00Z`).toLocaleString("en-SG", { month: "long", timeZone: "UTC" })} so expensive?`);
      await message.press("Enter");
      await page.locator("[data-ask-money-answer]").waitFor();
      await message.blur();
      await waitUsable(page);
      await hideCaret(page);
    }
  },
  {
    // The check before an answer: the settle-up Serene still owes, paid by
    // PayNow and filed as spending and income, is asked about first.
    // Adds two entries, so it reseeds first and runs near the end.
    name: "phone-ask-money-check", device: "phone", reseed: true,
    run: async (page) => {
      const splits = await (await page.request.get(`/api/splits-page?view=person-ethan&month=${MONTH}`)).json();
      const checkpoint = splits.splitsPage.settlementCheckpoints.find((item) => item.status === "open");
      const date = checkpoint.settlementDate.replace(/\d{2}$/, (day) => String(Math.min(28, Number(day) + 2)).padStart(2, "0"));
      for (const entry of [
        { description: "PAYNOW TRANSFER TO ETHAN", accountName: "UOB One Account", categoryName: "Other", entryType: "expense", ownerName: "Serene" },
        { description: "PAYNOW FROM SERENE", accountName: "OCBC 360 Account", categoryName: "Other - Income", entryType: "income", ownerName: "Ethan" }
      ]) {
        await page.request.post("/api/entries/create", { data: { ...entry, date, amountMinor: checkpoint.amountMinor, ownershipType: "direct" } });
      }
      await open(page, `/ask?view=household&month=${date.slice(0, 7)}&scope=direct_plus_shared`);
      const message = page.getByRole("textbox", { name: "Message" });
      await message.fill("How am I doing against the plan?");
      await message.press("Enter");
      await page.locator('[data-skew-check="open"]').waitFor();
      await message.blur();
      await waitUsable(page);
      await hideCaret(page);
    }
  },
  {
    // A card filled in by hand and saved, with its follow-up chips. Last,
    // because it adds an entry.
    name: "phone-ask-saved", device: "phone", reseed: true,
    run: async (page) => {
      await open(page, `/ask?view=person-ethan&month=${MONTH}&mode=add&from=entries`);
      await page.getByRole("textbox", { name: "What it was" }).fill("Koufu lunch");
      await page.getByRole("textbox", { name: "Amount" }).fill("12.50");
      await page.getByLabel("Date", { exact: true }).fill(`${MONTH}-28`);
      await page.getByRole("button", { name: "Save", exact: true }).click();
      await page.locator('[data-ask-card="saved"]').waitFor();
      await page.waitForTimeout(600);
      await hideCaret(page);
    }
  }
];

// ---------------------------------------------------------------------------
// Encoding

async function writeImage(buffer, kind, name) {
  const size = SIZES[kind];
  const fullDir = path.join(OUT_DIR, kind);
  const thumbDir = path.join(fullDir, "thumbs");
  await mkdir(thumbDir, { recursive: true });
  await sharp(buffer).resize({ width: size.full, withoutEnlargement: true }).webp({ quality: size.quality, effort: 6 }).toFile(path.join(fullDir, `${name}.webp`));
  await sharp(buffer).resize({ width: size.thumb, withoutEnlargement: true }).webp({ quality: size.thumbQuality, effort: 6 }).toFile(path.join(thumbDir, `${name}.webp`));
}

async function importIphoneShots(sourceDir) {
  const files = (await readdir(sourceDir)).filter((file) => file.endsWith(".png")).sort();
  for (const file of files) {
    const { default: fs } = await import("node:fs/promises");
    await writeImage(await fs.readFile(path.join(sourceDir, file)), "iphone", file.replace(/\.png$/, ""));
    console.log(`iphone/${file.replace(/\.png$/, ".webp")}`);
  }
}

async function folderBytes(dir) {
  let total = 0;
  for (const entry of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
    const full = path.join(dir, entry.name);
    total += entry.isDirectory() ? await folderBytes(full) : (await stat(full)).size;
  }
  return total;
}

// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const options = { names: [], baseURL: null, list: false, importIphone: null };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--list") options.list = true;
    else if (arg === "--base-url") options.baseURL = argv[++index];
    else if (arg === "--import-iphone") options.importIphone = argv[++index];
    else if (arg === "--seed-month") index += 1; // read at the top, before SHOTS
    else options.names.push(arg);
  }
  return options;
}

async function newContext(browser, device, baseURL, { hidden = false } = {}) {
  const context = await browser.newContext(device === "phone"
    ? { ...devices["iPhone 13"], baseURL, locale: "en-SG", timezoneId: "Asia/Singapore" }
    : { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1, baseURL, locale: "en-SG", timezoneId: "Asia/Singapore" });
  await context.addInitScript((visible) => {
    window.localStorage.setItem("monies-map:money-totals-visible", visible ? "true" : "false");
  }, !hidden);
  return context;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.list) {
    for (const shot of SHOTS) console.log(`${[shot.name, ...(shot.also ?? [])].join(", ")} (${shot.device})`);
    return;
  }
  if (options.importIphone) {
    await importIphoneShots(path.resolve(options.importIphone));
    return;
  }
  const unknown = options.names.filter((name) => !SHOTS.some((shot) => shot.name === name));
  if (unknown.length) throw new Error(`Unknown shot name(s): ${unknown.join(", ")}. Use --list.`);
  const selected = options.names.length ? SHOTS.filter((shot) => options.names.includes(shot.name)) : SHOTS;

  let stop = async () => {};
  let baseURL = options.baseURL;
  if (!baseURL) {
    await prepareStack(GUIDE_STACK);
    ({ stop } = await startStack(GUIDE_STACK));
    baseURL = GUIDE_STACK.baseURL;
  }
  const browsers = {};
  // Desktop shots use Chromium; phone shots use WebKit so they render like
  // iPhone Safari. Each engine starts only when a selected shot needs it.
  const browserFor = async (device) => {
    browsers[device] ??= await (device === "phone" ? webkit : chromium).launch();
    return browsers[device];
  };
  const failures = [];
  try {
    const setup = await newContext(await browserFor("desktop"), "desktop", baseURL);
    const setupPage = await setup.newPage();
    await reseed(setupPage);
    for (const shot of selected) {
      if (shot.reseed) await reseed(setupPage);
      const context = await newContext(await browserFor(shot.device), shot.device, baseURL, { hidden: shot.hidden });
      const page = await context.newPage();
      const captured = new Set();
      // `kind` picks the output folder and size when it differs from the
      // device (the iPhone gallery is shot on the phone profile).
      const kind = shot.kind ?? shot.device;
      const capture = async (name) => {
        await writeImage(await page.screenshot({ type: "png" }), kind, name);
        captured.add(name);
        console.log(`${kind}/${name}.webp`);
      };
      try {
        await shot.run(page, capture);
        if (!captured.has(shot.name)) await capture(shot.name);
        else if (shot.also?.length) await capture(shot.also[shot.also.length - 1]);
      } catch (error) {
        failures.push(shot.name);
        console.error(`FAILED ${shot.name}: ${error.message.split("\n")[0]}`);
        // Keep a picture of where it stopped, for debugging only.
        await mkdir("test-results/guide-screenshots", { recursive: true });
        await page.screenshot({ path: `test-results/guide-screenshots/${shot.name}-failed.png` }).catch(() => {});
      } finally {
        await context.close();
      }
    }
    await setup.close();
  } finally {
    await Promise.all(Object.values(browsers).map((browser) => browser.close()));
    await stop();
  }
  const kb = Math.round((await folderBytes(OUT_DIR)) / 1024);
  console.log(`public/faq/guide now holds ${kb} KB.`);
  if (failures.length) {
    console.error(`${failures.length} shot(s) failed: ${failures.join(", ")}`);
    process.exitCode = 1;
  }
}

await main();
