#!/usr/bin/env node
// UI audit walker: screenshots + DOM metrics for every route/state, phone
// (iPhone 13 WebKit, DPR 2) and desktop (Chromium 1280x800, 1024x768).
// Usage: node test-results/ui-audit/audit.mjs [--base-url URL] [--only a,b] [--device phone]
/* global window, document, getComputedStyle, NodeFilter */
import { mkdir, writeFile, readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { chromium, devices, webkit } from "@playwright/test";

const args = process.argv.slice(2);
const argVal = (name, fallback) => { const i = args.indexOf(name); return i === -1 ? fallback : args[i + 1]; };
const BASE = argVal("--base-url", "http://127.0.0.1:5677");
const ONLY = argVal("--only", "")?.split(",").filter(Boolean);
const ONLY_DEVICE = argVal("--device", "");
const OUT = path.resolve("test-results/ui-audit/raw");
const SEED_MONTH = "2026-10";
const MONTH = "2026-09";
const PREV = "2026-08";
const EMPTY_MONTH = "2025-01";

const DEVICES = {
  phone: { engine: "webkit", options: { ...devices["iPhone 13"], deviceScaleFactor: 2 } },
  d1280: { engine: "chromium", options: { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 } },
  d1024: { engine: "chromium", options: { viewport: { width: 1024, height: 768 }, deviceScaleFactor: 1 } }
};

const categoryPalette = (await readFile("src/domain/category-palette.ts", "utf8")).match(/#[0-9a-fA-F]{6}/g).map((h) => h.toLowerCase());

// ---------------------------------------------------------------------------
async function waitUsable(page, timeout = 45_000) {
  await page.waitForFunction(() => Boolean(window.__MONIES_MAP_ROUTE_WORK__?.usable), null, { timeout }).catch(() => {});
  await page.waitForTimeout(800);
}
async function open(page, url) {
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await waitUsable(page);
}
async function hideCaret(page) {
  await page.addStyleTag({ content: "*{caret-color:transparent !important}" }).catch(() => {});
}
async function scrollTo(page, locator, offset = 90) {
  await locator.first().waitFor({ state: "visible", timeout: 15_000 });
  await locator.first().evaluate((el, top) => {
    const r = el.getBoundingClientRect();
    const scroller = el.closest(".entry-mobile-sheet, [role=dialog]") ?? null;
    if (scroller && scroller.scrollHeight > scroller.clientHeight) scroller.scrollTop += r.top - top;
    else window.scrollTo({ top: Math.max(0, window.scrollY + r.top - top), behavior: "instant" });
  }, offset);
  await page.waitForTimeout(300);
}
async function reseed(page) {
  for (let i = 0; i < 10; i += 1) {
    const r = await page.request.post(`${BASE}/api/demo/reseed`).catch(() => null);
    if (r?.ok()) return;
    await page.waitForTimeout(700);
  }
  throw new Error("reseed failed");
}
async function api(page, url) {
  return (await page.request.get(`${BASE}${url}`)).json();
}
const dialog = (page) => page.locator("[role=dialog]:visible, .entry-mobile-sheet:visible").last();
async function waitDialog(page) {
  await dialog(page).waitFor({ state: "visible", timeout: 15_000 });
  await page.waitForTimeout(500);
}
async function openSettingsSection(page, heading) {
  await open(page, "/settings?view=household");
  const toggle = page.locator(".settings-section-toggle").filter({ has: page.getByRole("heading", { name: heading, exact: true }) }).first();
  await toggle.click();
  await page.waitForTimeout(600);
  await scrollTo(page, toggle, 70);
}
async function findEntry(page, view, month, predicate) {
  const data = await api(page, `/api/entries-page?view=${view}&month=${month}`);
  return [...data.monthPage.entries].sort((a, b) => b.date.localeCompare(a.date)).filter((x) => view !== "person-ethan" || x.ownerName === "Ethan").find(predicate);
}
const isPhone = (page) => page.viewportSize().width < 761;
async function openEntryEditor(page, entry, view = "person-ethan", month = MONTH) {
  if (isPhone(page)) {
    await open(page, `/entries?view=${view}&month=${month}&editing_entry=${entry.id}`);
    await waitDialog(page);
  } else {
    await open(page, `/entries?view=${view}&month=${month}`);
    const row = page.locator(".entry-row").filter({ hasText: entry.description }).first();
    await scrollTo(page, row, 200);
    await row.click();
    await page.locator(".entry-row.is-inline-editing").first().waitFor();
    await page.waitForTimeout(500);
  }
  await hideCaret(page);
}
const splitsUrl = (view = "person-ethan", extra = "") => `/splits?view=${view}&month=${MONTH}${extra}`;
async function stubCredit(page, state) {
  const body = {
    ok: true, visible: true, claudeConfigured: true, state,
    estimatedSpendUsd: state === "low" ? 16.4 : 20, creditUsd: 20, warnAtUsd: 15,
    lastSuccessAt: "2026-10-11T02:00:00.000Z", consoleBillingUrl: "https://platform.claude.com/settings/billing"
  };
  await page.route("**/api/ai-assist/provider-status", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) }));
}
async function askQuestion(page, url, text, waitSel) {
  await open(page, url);
  const msg = page.getByRole("textbox", { name: "Message" });
  await msg.fill(text);
  await msg.press("Enter");
  await page.locator(waitSel).first().waitFor({ timeout: 30_000 });
  await msg.blur();
  await waitUsable(page);
  await hideCaret(page);
}

// ---------------------------------------------------------------------------
// The shots. `d`: devices. `full`: also take a full-page shot.
const ALL = ["phone", "d1280", "d1024"];
const PD = ["phone", "d1280"];
const P = ["phone"];
const D = ["d1280"];

const SHOTS = [
  // ---------------- Summary
  { name: "summary-all-months", d: ALL, full: true, run: (p) => open(p, `/summary?view=person-ethan&month=${MONTH}`) },
  { name: "summary-household", d: PD, run: (p) => open(p, `/summary?view=household&month=${MONTH}`) },
  { name: "summary-all-months-scrolled", d: P, run: async (p) => { await open(p, `/summary?view=person-ethan&month=${MONTH}`); await p.evaluate(() => window.scrollTo(0, 700)); await p.waitForTimeout(500); } },
  { name: "summary-intent-outcome", d: PD, run: async (p) => { await open(p, `/summary?view=household&month=${MONTH}`); await scrollTo(p, p.getByText("Intent vs Outcome", { exact: true }), 20); } },
  { name: "summary-wallets", d: PD, run: async (p) => { await open(p, `/summary?view=household&month=${MONTH}`); await scrollTo(p, p.getByText("Wallets in view", { exact: true }), 60); } },
  { name: "summary-insights-expanded", d: PD, run: async (p) => {
    await open(p, `/summary?view=household&month=${MONTH}&summary_start=2025-06&summary_end=${MONTH}`);
    await p.getByRole("button", { name: "See all insights" }).first().click();
    await scrollTo(p, p.locator(".financial-insight"), 20);
  } },
  { name: "summary-range-picker", d: ["d1280", "d1024"], run: async (p) => { await open(p, `/summary?view=household&month=${MONTH}`); await p.locator(".period-range-segment").first().click(); await p.waitForTimeout(500); } },
  { name: "month-person", d: ALL, full: true, run: (p) => open(p, `/month?view=person-ethan&month=${MONTH}`) },
  { name: "month-scrolled-plan", d: P, run: async (p) => { await open(p, `/month?view=person-ethan&month=${MONTH}`); await scrollTo(p, p.locator("tr").filter({ hasText: "Food & Drinks" }), 200); } },
  { name: "month-household-readonly", d: D, run: async (p) => { await open(p, `/month?view=household&month=${MONTH}`); } },
  { name: "month-actions", d: D, run: async (p) => { await open(p, `/month?view=person-ethan&month=${MONTH}`); await p.getByRole("button", { name: "Actions", exact: true }).click(); await p.waitForTimeout(400); } },
  { name: "month-inline-edit", d: ["d1280", "d1024"], run: async (p) => {
    await open(p, `/month?view=person-ethan&month=${MONTH}`);
    const row = p.locator("tr").filter({ hasText: "Food & Drinks" }).first();
    await scrollTo(p, row, 220); await row.getByText("Food & Drinks").first().click();
    await p.locator(".month-inline-action-row").first().waitFor(); await p.waitForTimeout(300); await hideCaret(p);
  } },
  { name: "month-plan-sheet", d: P, run: async (p) => {
    await open(p, `/month?view=person-ethan&month=${MONTH}`);
    const row = p.locator("tr").filter({ hasText: "Food & Drinks" }).first();
    await scrollTo(p, row, 260); await row.getByText("Food & Drinks").first().click();
    await waitDialog(p); await hideCaret(p);
  } },
  { name: "month-link-entries", d: PD, run: async (p) => {
    await open(p, `/month?view=person-ethan&month=${MONTH}`);
    const row = p.locator("tr").filter({ hasText: "Prudential premium" }).first();
    await scrollTo(p, row, 300); await row.locator(".planned-link-manage-trigger").first().click();
    await waitDialog(p);
  } },
  { name: "month-note-dialog", d: D, run: async (p) => {
    await open(p, `/month?view=person-ethan&month=${MONTH}`);
    const btn = p.locator("tr").filter({ hasText: "Bills" }).first().locator("button").last();
    await scrollTo(p, btn, 200); await btn.click(); await waitDialog(p);
  } },

  // ---------------- Shell
  { name: "shell-view-scope-sheet", d: P, run: async (p) => { await open(p, `/summary?view=person-ethan&month=${MONTH}`); await p.locator(".mobile-context-trigger").first().click(); await waitDialog(p); } },
  { name: "shell-view-scope-sheet-entries", d: P, run: async (p) => { await open(p, `/entries?view=person-ethan&month=${MONTH}`); await p.locator(".mobile-context-trigger").first().click(); await waitDialog(p); } },
  { name: "shell-pick-month-sheet", d: P, run: async (p) => { await open(p, `/month?view=person-ethan&month=${MONTH}`); await p.locator(".mobile-month-choice-open").click(); await p.getByRole("dialog", { name: "Pick a month" }).waitFor(); await p.waitForTimeout(600); } },
  { name: "shell-pick-month-sheet-scrolled", d: P, run: async (p) => {
    await open(p, `/summary?view=person-ethan&month=${MONTH}&summary_start=2025-06&summary_end=${MONTH}`);
    await p.locator(".mobile-month-choice-open, .mobile-month-choice").first().click();
    const dlg = p.getByRole("dialog", { name: "Pick a month" }); await dlg.waitFor(); await p.waitForTimeout(500);
    await dlg.evaluate((el) => { const s = [el, ...el.querySelectorAll("*")].find((n) => n.scrollHeight > n.clientHeight + 10 && /auto|scroll/.test(getComputedStyle(n).overflowY)); if (s) s.scrollTop = 400; });
    await p.waitForTimeout(300);
  } },
  { name: "shell-more-pages", d: P, run: async (p) => { await open(p, `/summary?view=household&month=${MONTH}`); await p.getByRole("button", { name: /More pages/ }).first().click(); await p.waitForTimeout(500); } },
  { name: "shell-tabbar-clip", d: P, clip: "bottom", run: (p) => open(p, `/entries?view=person-ethan&month=${MONTH}`) },
  { name: "shell-header-clip", d: ["d1280", "d1024"], clip: "top", run: (p) => open(p, `/month?view=person-ethan&month=${MONTH}`) },
  { name: "shell-period-month-picker", d: D, run: async (p) => { await open(p, `/entries?view=person-ethan&month=${MONTH}`); await p.locator(".period-month-trigger, .period-range-segment, .period-picker-trigger").first().click(); await p.waitForTimeout(500); } },
  { name: "state-loading", d: PD, run: async (p) => {
    await p.route("**/api/summary-page**", async (route) => { await new Promise((r) => setTimeout(r, 20_000)); await route.continue().catch(() => {}); });
    await p.goto(`/summary?view=person-ethan&month=${MONTH}`, { waitUntil: "domcontentloaded" });
    await p.waitForTimeout(2500);
  } },
  { name: "state-loading-entries", d: P, run: async (p) => {
    await open(p, `/summary?view=person-ethan&month=${MONTH}`);
    await p.route("**/api/entries-page**", async (route) => { await new Promise((r) => setTimeout(r, 20_000)); await route.continue().catch(() => {}); });
    await p.locator("nav.tab-strip").getByRole("link", { name: "Entries" }).click();
    await p.waitForTimeout(1500);
  } },
  { name: "state-page-error", d: PD, run: async (p) => {
    await p.route("**/api/month-page**", (route) => route.fulfill({ status: 503, contentType: "text/plain", body: "Service unavailable" }));
    await p.goto(`/month?view=person-ethan&month=${MONTH}`, { waitUntil: "domcontentloaded" });
    await p.getByRole("button", { name: /Try/ }).first().waitFor({ timeout: 60_000 }); await p.waitForTimeout(400);
  } },
  { name: "state-shell-error", d: P, run: async (p) => {
    await p.route("**/api/reference-data**", (route) => route.fulfill({ status: 503, contentType: "text/plain", body: "down" }));
    await p.route("**/api/app-shell**", (route) => route.fulfill({ status: 503, contentType: "text/plain", body: "down" }));
    await p.goto(`/summary?view=person-ethan&month=${MONTH}`, { waitUntil: "domcontentloaded" });
    await p.getByRole("button", { name: /Try|Reload/ }).first().waitFor({ timeout: 60_000 }); await p.waitForTimeout(400);
  } },
  { name: "state-refresh-failure", d: D, reseedAfter: true, run: async (p) => {
    await open(p, `/month?view=person-ethan&month=${MONTH}`);
    const row = p.locator("tr").filter({ hasText: "Food & Drinks" }).first();
    await scrollTo(p, row, 260); await row.getByText("Food & Drinks").first().click();
    await row.locator(".table-edit-input-money").fill("123.45");
    await p.route("**/api/month-page**", (route) => route.fulfill({ status: 500, contentType: "application/json", body: "{\"error\":\"x\"}" }));
    await p.route("**/api/summary-page**", (route) => route.fulfill({ status: 500, contentType: "application/json", body: "{\"error\":\"x\"}" }));
    await p.locator(".month-inline-action-row").first().getByTestId("month-inline-save-button").click();
    await p.locator(".refresh-failure-notice").first().waitFor({ timeout: 20_000 });
    await p.waitForTimeout(400);
  } },
  { name: "state-refresh-failure-phone", d: P, reseedAfter: true, run: async (p) => {
    const e = await findEntry(p, "person-ethan", SEED_MONTH, (x) => x.bankCertificationStatus !== "statement_certified" && x.entryType === "expense" && !x.linkedSplitExpenseId);
    await open(p, `/entries?view=person-ethan&month=${SEED_MONTH}`);
    const row = p.locator(".entry-row").filter({ hasText: e.description }).first();
    await scrollTo(p, row, 200); await row.click(); await waitDialog(p);
    await p.route("**/api/entries-page**", (route) => route.fulfill({ status: 500, contentType: "application/json", body: "{\"error\":\"x\"}" }));
    await p.route("**/api/summary-page**", (route) => route.fulfill({ status: 500, contentType: "application/json", body: "{\"error\":\"x\"}" }));
    await p.route("**/api/app-shell**", (route) => route.fulfill({ status: 500, contentType: "application/json", body: "{\"error\":\"x\"}" }));
    const note = dialog(p).getByLabel("Note").first();
    if (await note.count()) { await note.fill("audit note").catch(() => {}); }
    await dialog(p).getByRole("button", { name: /^Save/ }).last().click();
    await p.locator(".refresh-failure-notice").first().waitFor({ timeout: 20_000 });
    await p.waitForTimeout(400);
  } },
  // Every tracked month in the showcase data has entries, so the empty states are the real
  // responses with the lists blanked out (the DTO shape is unchanged).
  { name: "state-empty-entries", d: PD, run: async (p) => {
    await p.route("**/api/entries-page**", async (route) => { const r = await route.fetch(); const j = await r.json(); j.monthPage.entries = []; await route.fulfill({ response: r, json: j }); });
    await open(p, `/entries?view=person-ethan&month=${MONTH}`);
  } },
  { name: "state-empty-month", d: PD, run: async (p) => {
    await p.route("**/api/month-page**", async (route) => { const r = await route.fetch(); const j = await r.json(); Object.assign(j.monthPage, { incomeRows: [], planSections: [], categoryShareChart: [], entries: [] }); await route.fulfill({ response: r, json: j }); });
    await open(p, `/month?view=person-ethan&month=${MONTH}`);
  } },
  { name: "state-no-filter-match", d: P, run: (p) => open(p, `/entries?view=person-ethan&month=${MONTH}&entry_search=zzzzqq`) },

  // ---------------- Entries
  { name: "entries-list", d: ALL, full: true, run: (p) => open(p, `/entries?view=person-ethan&month=${MONTH}`) },
  { name: "entries-household", d: P, run: (p) => open(p, `/entries?view=household&month=${MONTH}`) },
  { name: "entries-scrolled", d: P, run: async (p) => { await open(p, `/entries?view=person-ethan&month=${MONTH}`); await p.evaluate(() => window.scrollTo(0, 1200)); await p.waitForTimeout(500); } },
  { name: "entries-filters-open", d: PD, run: async (p) => {
    await open(p, `/entries?view=person-ethan&month=${MONTH}`);
    const t = p.locator(".entries-filter-toggle:visible");
    if (await t.count()) await t.first().click();
    else { const trig = p.locator(".mobile-context-trigger:visible"); if (await trig.count()) await trig.first().click(); }
    await p.waitForTimeout(600);
  } },
  { name: "entries-filter-wallet-picker", d: P, run: async (p) => {
    await open(p, `/entries?view=person-ethan&month=${MONTH}`);
    await p.locator(".mobile-context-trigger").first().click(); await waitDialog(p);
    const wallet = dialog(p).getByRole("button", { name: /Wallet/i }).first();
    await wallet.click(); await p.waitForTimeout(700);
  } },
  { name: "entries-filtered", d: PD, run: (p) => open(p, `/entries?view=household&month=${MONTH}&entry_category=Bills`) },
  { name: "entries-add", d: PD, run: async (p) => {
    await open(p, `/entries?view=person-ethan&month=${MONTH}`);
    if (isPhone(p)) { await p.locator(".entries-fab:not(.splits-fab)").click(); await p.locator('[data-ask-card="draft"]').waitFor(); await p.waitForTimeout(600); }
    else { await p.getByRole("button", { name: "+ Add entry" }).first().click(); await p.waitForTimeout(600); await scrollTo(p, p.locator(".entry-composer"), 60); }
    await hideCaret(p);
  } },
  { name: "entries-edit-provisional", d: ALL, run: async (p) => {
    const e = await findEntry(p, "person-ethan", SEED_MONTH, (x) => x.bankCertificationStatus !== "statement_certified" && x.entryType === "expense");
    await openEntryEditor(p, e, "person-ethan", SEED_MONTH);
    if (!isPhone(p)) await scrollTo(p, p.locator(".entry-row.is-inline-editing"), 90);
  } },
  { name: "entries-edit-provisional-bottom", d: P, run: async (p) => {
    const e = await findEntry(p, "person-ethan", SEED_MONTH, (x) => x.bankCertificationStatus !== "statement_certified" && x.entryType === "expense");
    await openEntryEditor(p, e, "person-ethan", SEED_MONTH);
    const more = dialog(p).getByRole("button", { name: /More details/ }).first();
    if (await more.count()) await more.click().catch(() => {});
    await dialog(p).evaluate((el) => { const s = [el, ...el.querySelectorAll("*")].filter((n) => n.scrollHeight > n.clientHeight + 10 && /auto|scroll/.test(getComputedStyle(n).overflowY)); s.forEach((n) => { n.scrollTop = n.scrollHeight; }); });
    await p.waitForTimeout(400);
  } },
  { name: "entries-edit-certified", d: PD, run: async (p) => {
    const e = await findEntry(p, "person-ethan", MONTH, (x) => x.bankCertificationStatus === "statement_certified" && x.entryType === "expense");
    await openEntryEditor(p, e);
    if (!isPhone(p)) await scrollTo(p, p.locator(".entry-row.is-inline-editing"), 90);
  } },
  { name: "entries-transfer-details", d: PD, run: async (p) => {
    const e = await findEntry(p, "person-ethan", MONTH, (x) => x.entryType === "transfer");
    await open(p, `/entries?view=person-ethan&month=${MONTH}&editing_entry=${e.id}`);
    await p.getByRole("button", { name: "Manage transfer" }).first().click();
    await p.getByRole("heading", { name: "Transfer details" }).waitFor(); await p.waitForTimeout(500);
  } },
  { name: "entries-category-dialog", d: PD, run: async (p) => {
    const e = await findEntry(p, "person-ethan", SEED_MONTH, (x) => x.bankCertificationStatus !== "statement_certified" && x.entryType === "expense");
    await openEntryEditor(p, e, "person-ethan", SEED_MONTH);
    const scope = isPhone(p) ? dialog(p) : p.locator(".entry-row.is-inline-editing");
    await scope.locator("button.category-icon-button").first().click();
    await p.waitForTimeout(700);
  } },
  { name: "entries-delete-confirm", d: PD, run: async (p) => {
    const e = await findEntry(p, "person-ethan", SEED_MONTH, (x) => x.bankCertificationStatus !== "statement_certified" && x.entryType === "expense");
    await openEntryEditor(p, e, "person-ethan", SEED_MONTH);
    await p.getByRole("button", { name: "Delete entry" }).first().click();
    await p.getByRole("dialog", { name: "Delete entry?" }).waitFor(); await p.waitForTimeout(400);
  } },
  { name: "entries-add-to-splits", d: PD, run: async (p) => {
    const e = await findEntry(p, "person-ethan", MONTH, (x) => /GOLDEN VILLAGE/.test(x.description)) ?? await findEntry(p, "person-ethan", MONTH, (x) => x.entryType === "expense" && !x.linkedSplitExpenseId);
    await openEntryEditor(p, e);
    await p.getByRole("button", { name: /Add to splits/ }).first().click();
    await p.waitForTimeout(900);
  } },
  { name: "entries-from-ask-chip", d: P, run: async (p) => {
    await askQuestion(p, `/ask?view=person-ethan&month=${MONTH}&scope=direct_plus_shared`, "How much on public transport?", ".ask-answer[data-ask-answer]:not([data-ask-answer=''])");
    await p.getByRole("group", { name: "Suggestions" }).getByRole("button", { name: "Open in Entries" }).click();
    await p.getByRole("group", { name: "From Ask" }).waitFor(); await waitUsable(p);
  } },

  // ---------------- Splits
  { name: "splits-overview", d: ALL, full: true, run: (p) => open(p, splitsUrl()) },
  { name: "splits-household", d: P, run: (p) => open(p, splitsUrl("household")) },
  { name: "splits-group-dinners", d: PD, run: (p) => open(p, splitsUrl("person-ethan", "&split_group=split-group-dinners")) },
  { name: "splits-scrolled", d: P, run: async (p) => { await open(p, splitsUrl()); await p.evaluate(() => window.scrollTo(0, 900)); await p.waitForTimeout(500); } },
  { name: "splits-add-expense", d: PD, run: async (p) => {
    await open(p, splitsUrl("person-ethan", "&split_group=split-group-dinners"));
    if (isPhone(p)) await p.locator(".splits-fab").click();
    else await p.locator(".splits-summary-strip").getByRole("button", { name: "+ Add expense" }).click();
    await p.getByRole("dialog", { name: "New split expense" }).waitFor(); await p.waitForTimeout(500); await hideCaret(p);
  } },
  { name: "splits-add-expense-bottom", d: P, run: async (p) => {
    await open(p, splitsUrl("person-ethan", "&split_group=split-group-dinners"));
    await p.locator(".splits-fab").click();
    const dlg = p.getByRole("dialog", { name: "New split expense" }); await dlg.waitFor(); await p.waitForTimeout(500);
    await dlg.evaluate((el) => { [el, ...el.querySelectorAll("*")].filter((n) => n.scrollHeight > n.clientHeight + 10 && /auto|scroll/.test(getComputedStyle(n).overflowY)).forEach((n) => { n.scrollTop = n.scrollHeight; }); });
    await p.waitForTimeout(300);
  } },
  { name: "splits-edit-expense", d: PD, run: async (p) => {
    await open(p, splitsUrl("person-ethan", "&split_group=split-group-dinners"));
    const card = p.locator(".split-activity-card").filter({ hasText: "Jumbo Seafood dinner" }).first();
    await scrollTo(p, card, 200); await card.click(); await p.waitForTimeout(900);
    const ed = p.locator(".split-date-group").filter({ has: p.getByRole("button", { name: "Delete", exact: true }) }).first();
    if (await ed.count()) await scrollTo(p, ed, 60);
    await hideCaret(p);
  } },
  { name: "splits-delete-confirm", d: PD, run: async (p) => {
    await open(p, splitsUrl("person-ethan", "&split_group=split-group-dinners"));
    const card = p.locator(".split-activity-card").filter({ hasText: "Jumbo Seafood dinner" }).first();
    await scrollTo(p, card, 200); await card.click(); await p.waitForTimeout(900);
    await p.getByRole("button", { name: "Delete", exact: true }).first().click();
    await p.getByRole("dialog", { name: "Delete split row" }).waitFor(); await p.waitForTimeout(400);
  } },
  { name: "splits-settle-group", d: PD, run: async (p) => {
    await open(p, splitsUrl("person-ethan", "&split_group=split-group-dinners"));
    await p.getByRole("button", { name: "Settle group" }).first().click(); await waitDialog(p);
  } },
  { name: "splits-simplify-checkpoint", d: PD, run: async (p) => {
    await open(p, splitsUrl("person-ethan", "&split_group=split-group-home-bills"));
    await p.locator(".split-checkpoint-panel").first().waitFor({ timeout: 30_000 });
    await scrollTo(p, p.locator(".split-checkpoint-panel"), 120);
  } },
  { name: "splits-history", d: PD, run: async (p) => {
    await open(p, splitsUrl("person-ethan", "&split_group=split-group-dinners"));
    await p.getByRole("button", { name: "Activity history" }).first().click();
    await p.getByRole("dialog", { name: "Split activity history" }).waitFor(); await p.waitForTimeout(500);
  } },
  { name: "splits-matches", d: PD, run: (p) => open(p, splitsUrl("person-ethan", "&split_mode=matches")) },
  { name: "splits-create-group", d: PD, run: async (p) => {
    await open(p, splitsUrl());
    await p.getByRole("button", { name: "Create group" }).first().click();
    await p.getByRole("dialog", { name: "Create group" }).waitFor(); await p.waitForTimeout(400); await hideCaret(p);
  } },
  { name: "splits-travel-group", d: P, run: async (p) => {
    const data = await api(p, `/api/splits-page?view=person-ethan&month=${MONTH}`);
    const g = (data.splitsPage?.groups ?? []).find((x) => x.currency && x.currency !== "SGD");
    await open(p, splitsUrl("person-ethan", g ? `&split_group=${g.id}` : ""));
  } },

  // ---------------- Imports
  { name: "imports-inbox", d: ALL, full: true, run: (p) => open(p, `/imports?view=household&month=${MONTH}`) },
  { name: "imports-upload", d: PD, run: async (p) => { await open(p, `/imports?view=household&month=${MONTH}`); await scrollTo(p, p.getByText("Import and certify", { exact: true }), 20); } },
  { name: "imports-paste-defaults", d: PD, run: async (p) => {
    await open(p, `/imports?view=household&month=${MONTH}`);
    await p.getByRole("button", { name: "Paste rows or set defaults" }).click(); await p.waitForTimeout(500);
    await scrollTo(p, p.getByLabel("Default account"), 120);
  } },
  { name: "imports-flow", d: PD, reseed: true, reseedAfter: true, also: ["imports-preview", "imports-committed", "imports-rollback"], run: async (p, cap) => {
    const ref = await api(p, "/api/reference-data");
    const serene = ref.accounts.find((a) => a.name === "UOB PRVI Miles Card")?.ownerPersonId;
    await p.request.post(`${BASE}/api/accounts/create`, { data: { name: "UOB One Card (new)", institution: "UOB", kind: "credit_card", currency: "SGD", openingBalanceMinor: 0, ownerPersonId: serene ?? null, isJoint: false } });
    await open(p, `/imports?view=household&month=${MONTH}`);
    await p.getByRole("button", { name: "Paste rows or set defaults" }).click();
    await p.getByLabel("Default account").selectOption({ label: "UOB One Card (new) - Serene" });
    await p.locator("input[type=file]").first().setInputFiles("tests/fixtures/uob-current-transactions/CC_TXN_History_06052026211223-onecard-tim-06-may.xls");
    await p.getByText(/ready for review/).first().waitFor({ state: "attached", timeout: 60_000 });
    await p.waitForTimeout(1500);
    await scrollTo(p, p.getByText("Preview rows", { exact: true }), 140).catch(() => {});
    await cap("imports-flow");
    await p.getByRole("combobox").filter({ has: p.locator("option", { hasText: "Choose account" }) }).first().selectOption({ label: "UOB One Card (new) - Serene" }).catch(() => {});
    await p.locator("button:has-text('Commit import to ledger'):enabled").first().waitFor({ timeout: 60_000 });
    await p.waitForTimeout(1200);
    await scrollTo(p, p.getByText("Preview rows", { exact: true }), 140).catch(() => {});
    await cap("imports-preview");
    await p.evaluate(() => window.scrollTo(0, 0)); await p.waitForTimeout(300);
    await cap("imports-preview-top");
    await p.getByRole("button", { name: "Commit import to ledger" }).first().click();
    await p.getByText(/^File imported:/).first().waitFor({ timeout: 60_000 });
    await p.waitForTimeout(800);
    await cap("imports-committed-notice");
    await p.locator(".import-history-toggle").click();
    await scrollTo(p, p.getByRole("heading", { name: "Recent imports", exact: true }), 140);
    await cap("imports-committed");
    const batch = p.locator(".import-card-compact").filter({ hasText: "CC_TXN_History" }).first();
    await scrollTo(p, batch, 300);
    await batch.getByRole("button", { name: "Rollback import" }).click();
    await p.getByRole("button", { name: "Confirm rollback" }).first().waitFor(); await p.waitForTimeout(300);
    await cap("imports-rollback");
  } },

  // ---------------- Settings
  { name: "settings-overview", d: ALL, full: true, run: (p) => open(p, "/settings?view=household") },
  ...[
    ["people", "People"], ["accounts", "Accounts"], ["shortcut", "Apple Pay shortcut"], ["ask-ai", "Ask and AI"],
    ["payment-ways", "Payment ways"], ["categories", "Categories"], ["category-rules", "Category matching"],
    ["trust", "Balance trust rules"], ["transfers", "Unresolved transfers"], ["activity", "Recent balance activity"], ["diagnostics", "Error diagnostics"]
  ].map(([slug, heading]) => ({ name: `settings-${slug}`, d: PD, run: (p) => openSettingsSection(p, heading) })),
  { name: "settings-add-account", d: PD, run: async (p) => { await openSettingsSection(p, "Accounts"); await p.getByRole("button", { name: "+ Add account" }).first().click(); await waitDialog(p); await hideCaret(p); } },
  { name: "settings-reconcile", d: PD, run: async (p) => { await openSettingsSection(p, "Accounts"); await p.getByRole("button", { name: "Reconcile" }).first().click(); await waitDialog(p); await hideCaret(p); } },
  { name: "settings-edit-category", d: PD, run: async (p) => {
    await openSettingsSection(p, "Categories");
    const btn = p.locator(".settings-section").filter({ has: p.getByRole("heading", { name: "Categories", exact: true }) }).getByRole("button", { name: /Edit/ }).first();
    await btn.click(); await waitDialog(p);
  } },
  { name: "settings-ask-ai-low-credit", d: P, run: async (p) => { await stubCredit(p, "low"); await openSettingsSection(p, "Ask and AI"); } },

  // ---------------- FAQ
  { name: "faq-user-guide", d: ALL, run: async (p) => { await open(p, "/faq?view=household"); await p.getByRole("navigation", { name: "Contents" }).waitFor().catch(() => {}); } },
  { name: "faq-developer-guide", d: PD, run: async (p) => { await open(p, "/faq?view=household"); await p.getByRole("tab", { name: /developers/i }).first().click(); await p.waitForTimeout(600); } },
  { name: "faq-scrolled", d: P, run: async (p) => { await open(p, "/faq?view=household"); await p.evaluate(() => window.scrollTo(0, 2400)); await p.waitForTimeout(500); } },

  // ---------------- Ask
  { name: "ask-chat-empty", d: P, run: async (p) => { await open(p, `/summary?view=person-ethan&month=${MONTH}`); await p.locator("nav.tab-strip").getByRole("link", { name: "Ask" }).click(); await p.getByRole("heading", { name: "Ask", exact: true }).waitFor(); await waitUsable(p); } },
  { name: "ask-desktop", d: D, run: (p) => open(p, `/ask?view=person-ethan&month=${MONTH}`) },
  { name: "ask-dock-docked-answer", d: D, run: async (p) => {
    await open(p, `/entries?view=person-ethan&month=${MONTH}&scope=direct_plus_shared`);
    await p.getByRole("textbox", { name: /Ask|Message/ }).first().fill("How much on public transport?");
    await p.keyboard.press("Enter");
    await p.locator(".ask-answer[data-ask-answer]:not([data-ask-answer=''])").first().waitFor({ timeout: 30_000 });
    await waitUsable(p); await hideCaret(p);
  } },
  { name: "ask-dock-popup-answer", d: ["d1024"], run: async (p) => {
    await open(p, `/entries?view=person-ethan&month=${MONTH}&scope=direct_plus_shared`);
    await p.getByRole("textbox", { name: /Ask|Message/ }).first().fill("How much on public transport?");
    await p.keyboard.press("Enter");
    await p.locator(".ask-answer[data-ask-answer]:not([data-ask-answer=''])").first().waitFor({ timeout: 30_000 });
    await waitUsable(p); await hideCaret(p);
  } },
  { name: "ask-plus-popover", d: P, run: async (p) => { await open(p, `/ask?view=person-ethan&month=${MONTH}`); await p.getByRole("button", { name: /Add a photo|Attach|More ways|^\+$|Add/ }).first().click().catch(() => {}); await p.waitForTimeout(500); } },
  { name: "ask-answer", d: P, run: (p) => askQuestion(p, `/ask?view=person-ethan&month=${MONTH}&scope=direct_plus_shared`, "How much on public transport?", ".ask-answer[data-ask-answer]:not([data-ask-answer=''])") },
  { name: "ask-money-answer", d: P, run: (p) => askQuestion(p, `/ask?view=household&month=${MONTH}&scope=direct_plus_shared`, "Why was August so expensive?", "[data-ask-money-answer]") },
  { name: "ask-add-card", d: P, run: async (p) => { await open(p, `/ask?view=person-ethan&month=${MONTH}&mode=add&from=entries`); await p.locator('[data-ask-card="draft"]').waitFor(); await hideCaret(p); } },
  { name: "ask-add-card-filled", d: P, run: async (p) => {
    await open(p, `/ask?view=person-ethan&month=${MONTH}&mode=add&from=entries`);
    const msg = p.getByRole("textbox", { name: "Message" });
    await msg.fill("12.50 lunch at koufu yesterday"); await msg.press("Enter"); await p.waitForTimeout(2500); await msg.blur(); await hideCaret(p);
  } },
  { name: "ask-saved", d: P, reseed: true, reseedAfter: true, run: async (p) => {
    await open(p, `/ask?view=person-ethan&month=${MONTH}&mode=add&from=entries`);
    await p.getByRole("textbox", { name: "What it was" }).fill("Koufu lunch");
    await p.getByRole("textbox", { name: "Amount" }).fill("12.50");
    await p.getByLabel("Date", { exact: true }).fill(`${MONTH}-28`).catch(() => {});
    await p.getByRole("button", { name: "Save", exact: true }).click();
    await p.locator('[data-ask-card="saved"]').waitFor(); await p.waitForTimeout(600); await hideCaret(p);
  } },
  { name: "ask-credit-low", d: P, run: async (p) => { await stubCredit(p, "low"); await open(p, `/ask?view=person-ethan&month=${MONTH}`); await p.getByRole("region", { name: "Claude credits" }).waitFor({ timeout: 20_000 }); } },
  { name: "ask-credit-exhausted", d: P, run: async (p) => { await stubCredit(p, "exhausted"); await open(p, `/ask?view=person-ethan&month=${MONTH}`); await p.getByRole("region", { name: "Claude credits" }).waitFor({ timeout: 20_000 }); } },
  { name: "ask-credit-topped-up-sheet", d: P, run: async (p) => {
    await stubCredit(p, "low"); await open(p, `/ask?view=person-ethan&month=${MONTH}`);
    await p.getByRole("region", { name: "Claude credits" }).getByRole("button", { name: /topped up/ }).click(); await waitDialog(p); await hideCaret(p);
  } },

  // ---------------- Hidden money
  { name: "hidden-summary", d: PD, hidden: true, run: (p) => open(p, `/summary?view=person-ethan&month=${MONTH}`) },
  { name: "hidden-month", d: P, hidden: true, run: (p) => open(p, `/month?view=person-ethan&month=${MONTH}`) },
  { name: "hidden-entries", d: PD, hidden: true, run: (p) => open(p, `/entries?view=person-ethan&month=${MONTH}`) },
  { name: "hidden-splits", d: P, hidden: true, run: (p) => open(p, splitsUrl()) },
  { name: "hidden-entry-edit", d: P, hidden: true, run: async (p) => {
    const e = await findEntry(p, "person-ethan", SEED_MONTH, (x) => x.bankCertificationStatus !== "statement_certified" && x.entryType === "expense");
    await openEntryEditor(p, e, "person-ethan", SEED_MONTH);
  } }
];

// ---------------------------------------------------------------------------
// In-page metrics
function collectMetrics(palette) {
  const vw = window.innerWidth; const vh = window.innerHeight;
  const toRgb = (s) => { const m = s && s.match(/rgba?\(([^)]+)\)/); if (!m) return null; const [r, g, b, a = "1"] = m[1].split(/[ ,/]+/).filter(Boolean); return { r: +r, g: +g, b: +b, a: +a }; };
  const hex = ({ r, g, b }) => "#" + [r, g, b].map((v) => Math.round(v).toString(16).padStart(2, "0")).join("");
  const hsl = ({ r, g, b }) => { r /= 255; g /= 255; b /= 255; const mx = Math.max(r, g, b), mn = Math.min(r, g, b); const l = (mx + mn) / 2; let h = 0, s = 0; if (mx !== mn) { const d = mx - mn; s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn); h = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; h *= 60; } return { h, s, l }; };
  const visible = (el) => {
    const cs = getComputedStyle(el); if (cs.visibility === "hidden" || cs.display === "none" || +cs.opacity === 0) return false;
    const r = el.getBoundingClientRect(); if (r.width < 1 || r.height < 1) return false;
    if (r.bottom < 0 || r.top > vh || r.right < 0 || r.left > vw) return false;
    if (el.closest("[aria-hidden=true]") && !el.closest("[role=dialog]")) return false;
    return true;
  };
  const uncovered = (el) => {
    const r = el.getBoundingClientRect();
    const x = Math.min(vw - 1, Math.max(0, r.left + r.width / 2)); const y = Math.min(vh - 1, Math.max(0, r.top + r.height / 2));
    const hit = document.elementFromPoint(x, y); return hit && (hit === el || el.contains(hit) || hit.contains(el) || hit.closest("label") === el.closest("label"));
  };
  const describe = (el) => {
    const cls = (typeof el.className === "string" ? el.className : el.getAttribute("class") || "").trim().split(/\s+/).filter(Boolean).slice(0, 2).join(".");
    const text = (el.getAttribute("aria-label") || el.innerText || el.value || el.getAttribute("title") || "").trim().replace(/\s+/g, " ").slice(0, 40);
    return `${el.tagName.toLowerCase()}${cls ? "." + cls : ""}${text ? ` "${text}"` : ""}`;
  };
  // Tap targets
  const sel = "a[href], button, input:not([type=hidden]), select, textarea, summary, [role=button], [role=tab], [role=switch], [role=checkbox], [role=radio], [role=menuitem], [role=option], [role=link]";
  const small = []; let interactive = 0;
  const seen = new Set();
  for (let el of document.querySelectorAll(sel)) {
    if ((el.type === "checkbox" || el.type === "radio") && el.closest("label")) el = el.closest("label");
    if (seen.has(el)) continue; seen.add(el);
    if (!visible(el) || !uncovered(el)) continue;
    if (el.disabled) continue;
    interactive++;
    const r = el.getBoundingClientRect();
    const inline = Boolean(el.closest("p, li") && el.tagName === "A" && getComputedStyle(el).display === "inline");
    if (r.width < 44 || r.height < 44) small.push({ el: describe(el), w: Math.round(r.width), h: Math.round(r.height), x: Math.round(r.left), y: Math.round(r.top), inline });
  }
  // Text, radii, shadows, colours
  const fontSizes = new Map(); const radii = new Map(); const shadows = new Map(); const saturated = new Map(); const moneyColours = new Map(); const handTone = [];
  const tokens = { "#17684a": "mint-ink", "#a3352a": "rose-ink", "#2f5b86": "sky-ink", "#5c4d8c": "lavender-ink", "#735512": "butter-ink", "#26231f": "text", "#736f69": "muted", "#934923": "accent", "#b15e2f": "accent-strong" };
  const moneyRe = /^[−\-+]?\s?(S?\$|US\$|RM|Rp|¥|€|£)?\s?[−\-+]?\d[\d,]*(\.\d{1,2})?$|^[−\-+]?\$[\d,]+(\.\d\d)?(\s.*)?$/;
  const all = document.body.querySelectorAll("*");
  for (const el of all) {
    if (!visible(el)) continue;
    const cs = getComputedStyle(el);
    const hasOwnText = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
    if (hasOwnText) {
      const fs = cs.fontSize; fontSizes.set(fs, (fontSizes.get(fs) || 0) + 1);
      const t = el.textContent.trim();
      if (t.length < 24 && /\d/.test(t) && moneyRe.test(t) && /[$.]/.test(t)) {
        const c = toRgb(cs.color); const hx = c ? hex(c) : "?"; const name = tokens[hx] || hx;
        moneyColours.set(name, (moneyColours.get(name) || 0) + 1);
        const toned = el.closest("[class*='money-'], .is-positive, .is-negative");
        if ((name === "mint-ink" || name === "rose-ink" || name === "sky-ink") && !toned) handTone.push(`${describe(el)} → ${name}`);
      }
      if (/^•+/.test(el.textContent.trim())) {
        const c = toRgb(cs.color); const hx = c ? hex(c) : "?"; if (["#17684a", "#a3352a", "#2f5b86"].includes(hx)) handTone.push(`HIDDEN money toned: ${describe(el)} → ${tokens[hx]}`);
      }
    }
    const bg = toRgb(cs.backgroundColor); const hasBox = (bg && bg.a > 0.05) || parseFloat(cs.borderTopWidth) > 0 || cs.boxShadow !== "none";
    if (hasBox && cs.borderRadius !== "0px") radii.set(cs.borderRadius, (radii.get(cs.borderRadius) || 0) + 1);
    if (cs.boxShadow !== "none") shadows.set(cs.boxShadow, (shadows.get(cs.boxShadow) || 0) + 1);
    if (bg && bg.a > 0.6) {
      const { h, s, l } = hsl(bg); const hx = hex(bg); const r = el.getBoundingClientRect();
      const accentFamily = h >= 8 && h <= 35; const pal = palette.includes(hx);
      if (s > 0.45 && l > 0.2 && l < 0.8 && !accentFamily && !pal && r.width * r.height > 60) {
        const k = `${hx} (${describe(el)})`; saturated.set(k, (saturated.get(k) || 0) + 1);
      }
    }
  }
  // Sideways scroll containers
  const sideways = [];
  for (const el of all) {
    const cs = getComputedStyle(el);
    if (!/(auto|scroll)/.test(cs.overflowX)) continue;
    if (el.scrollWidth <= el.clientWidth + 4) continue;
    if (!visible(el)) continue;
    const isTable = Boolean(el.querySelector("table"));
    sideways.push({ el: describe(el), scrollWidth: el.scrollWidth, clientWidth: el.clientWidth, children: el.children.length, isTable });
  }
  const pageOverflow = document.documentElement.scrollWidth > document.documentElement.clientWidth + 1 ? document.documentElement.scrollWidth : 0;
  // Dialogs / sheets
  const dialogs = [];
  for (const d of document.querySelectorAll("[role=dialog], [role=alertdialog], .entry-mobile-sheet, [data-radix-popper-content-wrapper] > *")) {
    if (!visible(d)) continue;
    const r = d.getBoundingClientRect();
    const buttons = [...d.querySelectorAll("button, a[href]")].filter(visible);
    const primaryish = buttons.filter((b) => /lsd-primary|dialog-primary|primary|submit/.test(b.className + " " + (b.type || "")) || (() => { const c = toRgb(getComputedStyle(b).backgroundColor); if (!c || c.a < 0.6) return false; const { h, s, l } = hsl(c); return s > 0.3 && l < 0.6 && h >= 8 && h <= 35; })());
    const close = buttons.find((b) => /close|✕|×/i.test((b.getAttribute("aria-label") || "") + b.textContent));
    const heading = d.querySelector("h1, h2, h3, [class*=title]");
    dialogs.push({
      role: d.getAttribute("role") || d.className.toString().slice(0, 40),
      name: (d.getAttribute("aria-label") || heading?.textContent || "").trim().slice(0, 50),
      rect: { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) },
      bottomAnchored: Math.abs(r.bottom - vh) < 4,
      scrolls: [d, ...d.querySelectorAll("*")].some((n) => n.scrollHeight > n.clientHeight + 10 && /auto|scroll/.test(getComputedStyle(n).overflowY)),
      primaries: primaryish.map((b) => ({ label: b.textContent.trim().slice(0, 30), relY: +((b.getBoundingClientRect().top - r.top) / r.height).toFixed(2), absY: Math.round(b.getBoundingClientRect().top), w: Math.round(b.getBoundingClientRect().width), h: Math.round(b.getBoundingClientRect().height) })),
      hasBottomBar: Boolean(d.querySelector(".lsd-bottom-actions, .is-sheet-bar, [class*=bottom-actions], .dialog-actions, .modal-actions, footer")),
      close: close ? { label: (close.getAttribute("aria-label") || close.textContent).trim().slice(0, 30), w: Math.round(close.getBoundingClientRect().width), h: Math.round(close.getBoundingClientRect().height), y: Math.round(close.getBoundingClientRect().top - r.top) } : null,
      handle: Boolean(d.querySelector("[class*=handle], [class*=grabber], [class*=drag]"))
    });
  }
  // Filled accent buttons in the top quarter (actions at top)
  const topActions = [];
  for (const b of document.querySelectorAll("button, a[href]")) {
    if (!visible(b) || !uncovered(b)) continue;
    const r = b.getBoundingClientRect(); if (r.top > vh * 0.3) continue;
    const c = toRgb(getComputedStyle(b).backgroundColor); if (!c || c.a < 0.6) continue;
    const { h, s, l } = hsl(c); if (s > 0.3 && l < 0.6 && h >= 8 && h <= 35) topActions.push(describe(b));
  }
  const sortMap = (m, n = 30) => [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, n);
  return {
    viewport: { w: vw, h: vh }, docHeight: document.documentElement.scrollHeight,
    interactive, smallTargets: small, fontSizes: sortMap(fontSizes), radii: sortMap(radii), shadows: sortMap(shadows, 20),
    saturated: sortMap(saturated, 15), moneyColours: sortMap(moneyColours), handTone: handTone.slice(0, 15),
    sideways, pageOverflow, dialogs, topActions
  };
}

// ---------------------------------------------------------------------------
async function main() {
  await mkdir(OUT, { recursive: true });
  const metricsPath = path.resolve("test-results/ui-audit/metrics.json");
  let metrics = {};
  try { metrics = JSON.parse(await readFile(metricsPath, "utf8")); } catch { metrics = {}; }
  const browsers = {};
  const browserFor = async (engine) => (browsers[engine] ??= await (engine === "webkit" ? webkit : chromium).launch());
  const setup = await (await browserFor("chromium")).newContext({ baseURL: BASE });
  const setupPage = await setup.newPage();
  await reseed(setupPage);
  const failures = [];
  const shots = SHOTS.filter((s) => !ONLY?.length || ONLY.includes(s.name));
  for (const shot of shots) {
    if (shot.reseed) await reseed(setupPage);
    for (const dev of shot.d) {
      if (ONLY_DEVICE && dev !== ONLY_DEVICE) continue;
      const { engine, options } = DEVICES[dev];
      const ctx = await (await browserFor(engine)).newContext({ ...options, baseURL: BASE, locale: "en-SG", timezoneId: "Asia/Singapore" });
      await ctx.addInitScript((visibleMoney) => { try { window.localStorage.setItem("monies-map:money-totals-visible", visibleMoney ? "true" : "false"); } catch {} }, !shot.hidden);
      const page = await ctx.newPage();
      page.setDefaultTimeout(20_000);
      const dir = path.join(OUT, dev); await mkdir(dir, { recursive: true });
      const capture = async (name) => {
        const opts = { path: path.join(dir, `${name}.png`) };
        if (shot.clip === "bottom") { const v = page.viewportSize(); opts.clip = { x: 0, y: v.height - 200, width: v.width, height: 200 }; }
        if (shot.clip === "top") { const v = page.viewportSize(); opts.clip = { x: 0, y: 0, width: v.width, height: 260 }; }
        await page.screenshot(opts);
        metrics[`${dev}/${name}`] = await page.evaluate(collectMetrics, categoryPalette).catch((e) => ({ error: e.message }));
        console.log(`ok ${dev}/${name}`);
      };
      try {
        const captured = [];
        await shot.run(page, async (n) => { await capture(n); captured.push(n); });
        if (!captured.includes(shot.name)) await capture(shot.name);
        if (shot.full) {
          await page.evaluate(() => window.scrollTo(0, 0)); await page.waitForTimeout(300);
          await page.screenshot({ path: path.join(dir, `${shot.name}--full.png`), fullPage: true });
        }
      } catch (error) {
        failures.push(`${dev}/${shot.name}: ${error.message.split("\n")[0]}`);
        console.error(`FAIL ${dev}/${shot.name}: ${error.message.split("\n")[0]}`);
        await page.screenshot({ path: path.join(dir, `${shot.name}--FAILED.png`) }).catch(() => {});
      } finally {
        await ctx.close();
      }
    }
    if (shot.reseedAfter) await reseed(setupPage);
  }
  await writeFile(metricsPath, JSON.stringify(metrics, null, 1));
  await setup.close();
  await Promise.all(Object.values(browsers).map((b) => b.close()));
  console.log(`\n${failures.length} failures`); failures.forEach((f) => console.log("  " + f));
}
await main();
