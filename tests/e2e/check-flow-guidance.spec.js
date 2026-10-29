import { mkdirSync } from "node:fs";

import { devices, expect, test } from "@playwright/test";

import { postJson, reseedDemo } from "./helpers";

// "Check my books" guides the person (docs/flows/check-flow.md, "Fixing and
// coming back"), at a desktop width and at 390 px:
// - a problem is fixed where it is: two unlinked sides with one match are
//   linked after the app's small confirmation, a transfer with several
//   matches (or none) opens the Transfer details dialog over the page, and a
//   settled-period mistake opens the correction dialog over the page; the
//   row leaves at once, the line says "Fixed. N things left.", and focus moves
//   to the next problem in the group;
// - a fix that is a page (Entries, Splits, Imports, Month) shows "‹ Check my
//   books" on that page, and the link and the browser's back both return to
//   the list with its scroll, open rows and the person's view, read again;
// - the link is only for people who came from Check, and only for that hop.
// Set CHECK_GUIDANCE_FRAMES=<directory> to save the screenshots the audit keeps.

const DESKTOP = { width: 1280, height: 900 };
const PHONE = devices["iPhone 12 Pro"].viewport;
const FRAMES_DIR = process.env.CHECK_GUIDANCE_FRAMES ?? "";

function isoDay(offsetDays) {
  return new Date(Date.now() + offsetDays * 86_400_000).toISOString().slice(0, 10);
}

async function frame(page, name) {
  if (!FRAMES_DIR) return;
  mkdirSync(FRAMES_DIR, { recursive: true });
  await page.screenshot({ path: `${FRAMES_DIR}/${name}.png` });
}

const entry = (page, body) => postJson(page, "/api/entries/create", { ownershipType: "direct", ownerName: "Tim", categoryName: "Groceries", entryType: "expense", ...body });

// Seven transfers out of Tim's savings whose other side, at Joyce's bank, is
// not linked: each has exactly one possible match. Tall enough to scroll.
async function seedPairs(page) {
  await postJson(page, "/api/accounts/create", { name: "Joyce Bank", institution: "DBS", kind: "bank", currency: "SGD", openingBalanceMinor: 0, ownerPersonId: "person-joyce" });
  for (let index = 1; index <= 7; index += 1) {
    const amountMinor = 70_000 + index * 1_111;
    const date = isoDay(-(20 + index));
    await entry(page, { date, description: `FAST to Joyce ${index}`, accountName: "UOB Savings", categoryName: "Transfer", entryType: "transfer", transferDirection: "out", amountMinor });
    await entry(page, { date, description: `FAST from Tim ${index}`, accountName: "Joyce Bank", categoryName: "Transfer", entryType: "transfer", transferDirection: "in", amountMinor, ownerName: "Joyce" });
  }
}

// One transfer out with two possible matches at Joyce's bank.
async function seedSeveralMatches(page) {
  const amountMinor = 33_333;
  await postJson(page, "/api/accounts/create", { name: "Joyce Bank", institution: "DBS", kind: "bank", currency: "SGD", openingBalanceMinor: 0, ownerPersonId: "person-joyce" });
  await entry(page, { date: isoDay(-14), description: "Rent to Joyce", accountName: "UOB Savings", categoryName: "Transfer", entryType: "transfer", transferDirection: "out", amountMinor });
  await entry(page, { date: isoDay(-14), description: "Rent received A", accountName: "Joyce Bank", categoryName: "Transfer", entryType: "transfer", transferDirection: "in", amountMinor, ownerName: "Joyce" });
  await entry(page, { date: isoDay(-13), description: "Rent received B", accountName: "Joyce Bank", categoryName: "Transfer", entryType: "transfer", transferDirection: "in", amountMinor, ownerName: "Joyce" });
}

// The flight entered twice in a group and both copies settled up together.
async function seedSettledMistake(page) {
  const group = await postJson(page, "/api/splits/groups/create", { name: "Okaeri", currency: "SGD", expenseSource: "mixed" });
  for (let copy = 0; copy < 2; copy += 1) {
    await postJson(page, "/api/splits/expenses/create", {
      groupId: group.groupId, date: isoDay(-120), description: "Singapore Airlines flights", categoryName: "Travel", payerPersonName: "Tim",
      amountMinor: 105_185, splitAmountMinor: 52_592, currency: "SGD", paymentMethod: "cash", paymentStatus: "recorded"
    });
  }
  const checkpoint = await postJson(page, "/api/splits/checkpoints/create", { viewerPersonId: "person-tim", date: isoDay(-60), currency: "SGD" });
  await postJson(page, "/api/splits/checkpoints/mark-paid", { checkpointId: checkpoint.checkpointId });
}

async function readReport(page, query = "") {
  const response = await page.request.get(`/api/ledger-checkup${query}`);
  expect(response.ok()).toBe(true);
  return response.json();
}

function summaryText(counts) {
  const parts = [];
  if (counts.high) parts.push(`${counts.high} ${counts.high === 1 ? "thing needs" : "things need"} fixing`);
  if (counts.check) parts.push(`${counts.check} worth checking`);
  if (counts.note) parts.push(`${counts.note} good to know`);
  return parts.join(" · ");
}

const total = (report) => report.tierCounts.high + report.tierCounts.check + report.tierCounts.note;
const group = (page, key) => page.locator(`[data-group="${key}"]`);
const rowsIn = (page, key) => group(page, key).locator(".check-item[data-finding-id]");
const headline = (page) => page.locator("#check-summary-title");
const context = (page) => page.locator(".check-context");
const returnLink = (page) => page.locator("a.return-to-check");

async function loadCheck(page, query = "view=household") {
  const answered = page.waitForResponse((response) => response.url().includes("/api/ledger-checkup") && response.request().method() === "GET");
  await page.goto(`/check?${query}`);
  await answered;
  await expect(page.getByRole("heading", { name: "Check my books", level: 2 })).toBeVisible();
  await expect(headline(page)).toBeVisible();
}

// Scrolls a button to the middle of the window at once (the page's own smooth
// scrolling would still be moving when the position is read).
async function bringIntoView(locator) {
  await locator.evaluate((element) => element.scrollIntoView({ block: "center", behavior: "instant" }));
  await locator.page().waitForTimeout(150);
}

function trackCheckReads(page) {
  const reads = [];
  page.on("request", (request) => {
    if (request.method() === "GET" && /\/api\/ledger-checkup(\?|$)/.test(request.url())) reads.push(request.url());
  });
  return reads;
}

for (const [label, viewport, phone] of [["desktop", DESKTOP, false], ["390 px phone", PHONE, true]]) {
  test.describe(`Check my books guides the person, on ${label}`, () => {
    test.use({ viewport });

    test.beforeEach(async ({ page }) => {
      await page.addInitScript(() => window.localStorage.setItem("monies-map:money-totals-visible", "true"));
      await page.goto("/");
      await reseedDemo(page);
    });

    test("two unlinked sides with one match are linked in place after the small confirmation, and the list moves on", async ({ page }) => {
      await seedPairs(page);
      const before = await readReport(page);
      await loadCheck(page);
      const reads = trackCheckReads(page);
      const rows = rowsIn(page, "high:transfers");
      const first = rows.first();
      const firstId = await first.getAttribute("data-finding-id");
      const secondId = await rows.nth(1).getAttribute("data-finding-id");
      await frame(page, `${phone ? "phone" : "desktop"}-1-list`);

      // Primary on its own, then the quiet page link and "This is fine".
      const primary = first.getByRole("button", { name: /^Link these two/ });
      await expect(primary).toBeVisible();
      await expect(first.getByRole("button", { name: /^Open in Entries/ })).toBeVisible();
      await expect(first.getByRole("button", { name: /^This is fine/ })).toBeVisible();
      for (const button of await first.getByRole("button").all()) {
        expect((await button.boundingBox()).height).toBeGreaterThanOrEqual(44);
      }
      if (phone) {
        // Primary full width on its own line; the other two share the next.
        const boxes = await Promise.all([primary, first.getByRole("button", { name: /^Open in Entries/ }), first.getByRole("button", { name: /^This is fine/ })].map((button) => button.boundingBox()));
        expect(boxes[0].width).toBeGreaterThan(boxes[1].width * 1.5);
        expect(boxes[1].y).toBeGreaterThan(boxes[0].y + boxes[0].height - 2);
        expect(Math.abs(boxes[1].y - boxes[2].y)).toBeLessThan(4);
      }

      await primary.click();
      const dialog = page.getByRole("dialog", { name: "Link these two?" });
      await expect(dialog).toBeVisible();
      // It stays on the page, and it says who sent and who received, with amount and date.
      await expect(page).toHaveURL(/\/check\?/);
      await expect(dialog).toContainText("Money out");
      await expect(dialog).toContainText("Money in");
      await expect(dialog).toContainText(/FAST to Joyce \d/);
      await expect(dialog).toContainText(/FAST from Tim \d/);
      await expect(dialog).toContainText(/\$7\d\d\.\d\d/);
      await expect(dialog).toContainText("Nothing is deleted.");
      await frame(page, `${phone ? "phone" : "desktop"}-2-confirm`);

      // Cancel changes nothing and returns focus to the button.
      await dialog.getByRole("button", { name: "Cancel" }).click();
      await expect(dialog).toBeHidden();
      await expect(primary).toBeFocused();
      expect(total(await readReport(page))).toBe(total(before));

      // Confirm: one existing command, no other write.
      const writes = [];
      page.on("request", (request) => { if (request.method() === "POST") writes.push(new URL(request.url()).pathname); });
      await primary.click();
      await expect(dialog).toContainText(/FAST to Joyce \d/);
      const linked = page.waitForResponse((response) => response.url().endsWith("/api/transfers/link") && response.request().method() === "POST");
      await dialog.getByRole("button", { name: "Link these two" }).click();
      expect((await linked).ok()).toBe(true);
      await expect(dialog).toBeHidden();
      await expect(page).toHaveURL(/\/check\?/);

      // The row has left; the counts moved; the line says what is left.
      await expect(page.locator(`[data-finding-id="${firstId}"]`)).toHaveCount(0);
      const expectedTotal = total(before) - 1;
      await expect(context(page)).toHaveText(`Fixed. ${expectedTotal} things left.`);
      await expect(page.getByRole("status").filter({ hasText: `Fixed. ${expectedTotal} things left.` })).toHaveCount(1);
      await expect(headline(page)).toContainText(`${before.tierCounts.high - 1} ${before.tierCounts.high - 1 === 1 ? "thing needs" : "things need"} fixing`);
      // Focus is on the next problem of the group, ready for the next link.
      await expect(page.locator(`[data-finding-id="${secondId}"] .check-fix`)).toBeFocused();
      await frame(page, `${phone ? "phone" : "desktop"}-3-after`);

      // One quiet read after the write, and nothing else was written.
      await expect.poll(() => reads.length).toBe(1);
      expect(writes.filter((path) => path !== "/api/transfers/link")).toEqual([]);
      const after = await readReport(page);
      expect(total(after)).toBe(expectedTotal);
      expect(after.findings.some((item) => item.id === firstId)).toBe(false);

      // The line goes by itself and the page says what it was checking again.
      await expect(context(page)).toHaveText("Checking the whole household", { timeout: 10_000 });
    });

    test("a link the server refuses puts the row back and says so, and the same two can be tried again", async ({ page }) => {
      await seedPairs(page);
      const before = await readReport(page);
      await loadCheck(page);
      let refuse = true;
      await page.route("**/api/transfers/link", (route) => (refuse ? route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ ok: false }) }) : route.continue()));
      const first = rowsIn(page, "high:transfers").first();
      const firstId = await first.getAttribute("data-finding-id");
      await first.getByRole("button", { name: /^Link these two/ }).click();
      const dialog = page.getByRole("dialog", { name: "Link these two?" });
      await dialog.getByRole("button", { name: "Link these two" }).click();
      await expect(dialog).toContainText("Nothing was linked. Check your connection and try again.");
      await expect(dialog).toBeVisible();
      // Behind it the row is back where it stood and the counts are as before.
      await expect(page.locator(`[data-finding-id="${firstId}"]`)).toHaveCount(1);
      await expect(headline(page)).toContainText(`${before.tierCounts.high} things need fixing`);
      expect(total(await readReport(page))).toBe(total(before));
      refuse = false;
      await dialog.getByRole("button", { name: "Link these two" }).click();
      await expect(dialog).toBeHidden();
      await expect(page.locator(`[data-finding-id="${firstId}"]`)).toHaveCount(0);
    });

    test("a transfer with several matches opens Transfer details over the page; choosing one links it and closes", async ({ page }) => {
      await seedSeveralMatches(page);
      const before = await readReport(page);
      const several = before.findings.find((item) => item.kind === "unmatched_transfer" && !item.id.includes("+") && !item.id.includes("series:"));
      expect(several, "a transfer with several possible matches").toBeTruthy();
      await loadCheck(page);
      const row = page.locator(`[data-finding-id="${several.id}"]`);
      await group(page, "check:transfers").getByRole("button", { name: /^Transfers waiting for their other side/ }).click({ trial: true }).catch(() => undefined);
      if (!(await row.isVisible())) {
        await group(page, "check:transfers").getByRole("button", { name: /^Transfers waiting for their other side/ }).click();
      }
      await expect(row).toBeVisible();
      await expect(row.getByRole("button", { name: /^Open transfer details/ })).toBeVisible();
      await row.getByRole("button", { name: /^Open transfer details/ }).click();

      const dialog = page.getByRole("dialog", { name: "Transfer details" });
      await expect(dialog).toBeVisible();
      await expect(page).toHaveURL(/\/check\?/);
      await expect(dialog.locator(".transfer-match-card")).toHaveCount(2);
      await frame(page, `${phone ? "phone" : "desktop"}-4-transfer-details`);

      const linked = page.waitForResponse((response) => response.url().endsWith("/api/transfers/link") && response.request().method() === "POST");
      await dialog.locator(".transfer-match-card").first().getByRole("button", { name: "Use match" }).click();
      expect((await linked).ok()).toBe(true);
      await expect(dialog).toBeHidden();
      await expect(page).toHaveURL(/\/check\?/);
      await expect(page.locator(`[data-finding-id="${several.id}"]`)).toHaveCount(0);
      await expect(context(page)).toContainText(/^Fixed\. \d+ things? left\.$|^Nothing changed\.$/);
      // The server agrees: that transfer is no longer waiting.
      await expect.poll(async () => (await readReport(page)).findings.some((item) => item.id === several.id)).toBe(false);
    });

    test("closing Transfer details without choosing changes nothing and returns focus to its button", async ({ page }) => {
      await seedSeveralMatches(page);
      const before = await readReport(page);
      await loadCheck(page);
      const several = before.findings.find((item) => item.kind === "unmatched_transfer" && !item.id.includes("+") && !item.id.includes("series:"));
      const row = page.locator(`[data-finding-id="${several.id}"]`);
      if (!(await row.isVisible())) {
        await group(page, "check:transfers").getByRole("button", { name: /^Transfers waiting for their other side/ }).click();
      }
      const open = row.getByRole("button", { name: /^Open transfer details/ });
      await open.click();
      const dialog = page.getByRole("dialog", { name: "Transfer details" });
      await expect(dialog).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(dialog).toBeHidden();
      await expect(open).toBeFocused();
      expect(total(await readReport(page))).toBe(total(before));
    });

    test("a settled-period mistake is corrected in place, over the page", async ({ page }) => {
      await seedSettledMistake(page);
      const before = await readReport(page);
      const mistake = before.findings.find((item) => item.kind === "settled_period_error");
      expect(mistake, "the check offers the correction").toBeTruthy();
      await loadCheck(page);
      const row = page.locator(`[data-finding-id="${mistake.id}"]`);
      if (!(await row.isVisible())) {
        await group(page, `${mistake.tier}:settle_up`).getByRole("button", { name: /^Settle-up mistakes/ }).click();
      }
      await expect(row.getByRole("button", { name: /^Correct this/ })).toBeVisible();
      await expect(row.getByRole("button", { name: /^Open in Splits/ })).toBeVisible();
      await row.getByRole("button", { name: /^Correct this/ }).click();
      const dialog = page.getByRole("dialog", { name: "Correct a settled mistake" });
      await expect(dialog).toBeVisible({ timeout: 30_000 });
      await expect(page).toHaveURL(/\/check\?/);
      await expect(dialog).toContainText("This adds a $525.93 correction");
      await frame(page, `${phone ? "phone" : "desktop"}-5-correction`);
      const added = page.waitForResponse((response) => response.url().endsWith("/api/splits/corrections") && response.request().method() === "POST");
      await dialog.getByRole("button", { name: "Add correction" }).click();
      expect((await added).ok()).toBe(true);
      await expect(dialog).toBeHidden();
      await expect(page).toHaveURL(/\/check\?/);
      await expect(page.locator(`[data-finding-id="${mistake.id}"]`)).toHaveCount(0);
      await expect(context(page)).toContainText(/^Fixed\. /);
      await expect.poll(async () => (await readReport(page)).findings.some((item) => item.id === mistake.id)).toBe(false);
    });

    test("'Open in Entries' shows '‹ Check my books' there; the link returns to the list as it was, read again", async ({ page }) => {
      await seedPairs(page);
      await loadCheck(page, "view=person-tim");
      const rows = rowsIn(page, "high:transfers");
      // More rows shown, and a group the person opened, are kept.
      await group(page, "high:transfers").getByRole("button", { name: /^Show \d+ more/ }).click();
      const shown = await rows.count();
      expect(shown).toBeGreaterThan(5);
      const tierGroups = await page.locator("[data-group]").evaluateAll((nodes) => nodes.map((node) => [node.getAttribute("data-group"), node.getAttribute("data-open")]));
      const target = rows.nth(5);
      await bringIntoView(target.getByRole("button", { name: /^Open in Entries/ }));
      const scrollBefore = await page.evaluate(() => window.scrollY);
      const beforeReport = await readReport(page, "?view=person-tim");
      const targetId = await target.getAttribute("data-finding-id");
      await frame(page, `${phone ? "phone" : "desktop"}-6-before-leaving`);

      await target.getByRole("button", { name: /^Open in Entries/ }).click();
      await expect(page).toHaveURL(/\/entries\?.*editing_entry=txn-/);
      const back = returnLink(page);
      await expect(back).toBeVisible({ timeout: 60_000 });
      await expect(back).toHaveText("‹ Check my books");
      await expect(back).toHaveAttribute("aria-label", "Back to Check my books");
      expect((await back.boundingBox()).height).toBeGreaterThanOrEqual(44);
      // Top left, above the page, before anything else on the page in the tab order.
      expect((await back.boundingBox()).x).toBeLessThan(90);
      await frame(page, `${phone ? "phone" : "desktop"}-7-entries-with-back`);
      // The editor sheet Check opened covers the page while it is open: closing it
      // leaves the link, still there, a tab stop of its own.
      await page.keyboard.press("Escape");
      await expect(back).toBeVisible();
      await back.focus();
      await expect(back).toBeFocused();

      const reads = trackCheckReads(page);
      await page.keyboard.press("Enter");
      await expect(page).toHaveURL(/\/check\?.*view=person-tim/);
      await expect(page.getByRole("heading", { name: "Check my books", level: 2 })).toBeVisible();
      await expect(headline(page)).toBeVisible();
      // The same rows are shown, the same groups open, at the same place.
      await expect(rows).toHaveCount(shown);
      await expect(page.locator(`[data-finding-id="${targetId}"]`)).toBeVisible();
      expect(await page.locator("[data-group]").evaluateAll((nodes) => nodes.map((node) => [node.getAttribute("data-group"), node.getAttribute("data-open")]))).toEqual(tierGroups);
      await expect.poll(() => page.evaluate(() => window.scrollY), { timeout: 8_000 }).toBeGreaterThan(scrollBefore - 40);
      expect(Math.abs((await page.evaluate(() => window.scrollY)) - scrollBefore)).toBeLessThanOrEqual(40);
      // The person's view is still Tim's (the list is Tim's, not the household's), read once more.
      await expect(headline(page)).toHaveText(summaryText(beforeReport.tierCounts));
      expect(reads.length).toBe(1);
      expect(total(await readReport(page, "?view=person-tim"))).toBe(total(beforeReport));
      await expect(page.getByRole("status").filter({ hasText: "Nothing changed." })).toHaveCount(1);
      await frame(page, `${phone ? "phone" : "desktop"}-8-back-on-check`);
      // Back on Check the link is gone from every page it was on.
      await expect(returnLink(page)).toHaveCount(0);
    });

    test("the browser's back does the same: the list, its place and its open rows, read again", async ({ page }) => {
      await seedPairs(page);
      await loadCheck(page);
      await group(page, "high:transfers").getByRole("button", { name: /^Show \d+ more/ }).click();
      const rows = rowsIn(page, "high:transfers");
      const shown = await rows.count();
      const target = rows.nth(5);
      await bringIntoView(target.getByRole("button", { name: /^Open in Entries/ }));
      const scrollBefore = await page.evaluate(() => window.scrollY);
      await target.getByRole("button", { name: /^Open in Entries/ }).click();
      await expect(returnLink(page)).toBeVisible({ timeout: 60_000 });
      const reads = trackCheckReads(page);
      await page.goBack();
      await expect(page).toHaveURL(/\/check\?/);
      await expect(headline(page)).toBeVisible();
      await expect(rows).toHaveCount(shown);
      await expect.poll(() => page.evaluate(() => window.scrollY), { timeout: 8_000 }).toBeGreaterThan(scrollBefore - 40);
      expect(Math.abs((await page.evaluate(() => window.scrollY)) - scrollBefore)).toBeLessThanOrEqual(40);
      expect(reads.length).toBe(1);
      await expect(returnLink(page)).toHaveCount(0);
    });

    test("a transfer linked on Entries is gone from the list when the person comes back, and the line says so", async ({ page }) => {
      await seedPairs(page);
      const before = await readReport(page);
      await loadCheck(page);
      const first = rowsIn(page, "high:transfers").first();
      const firstId = await first.getAttribute("data-finding-id");
      await first.getByRole("button", { name: /^Open in Entries/ }).click();
      await expect(page).toHaveURL(/\/entries\?.*editing_entry=txn-/);
      await page.getByRole("button", { name: "Manage transfer" }).click({ timeout: 60_000 });
      const dialog = page.getByRole("dialog", { name: "Transfer details" });
      await expect(dialog).toBeVisible();
      const linked = page.waitForResponse((response) => response.url().endsWith("/api/transfers/link") && response.request().method() === "POST");
      await dialog.getByRole("button", { name: "Use match" }).first().click();
      expect((await linked).ok()).toBe(true);
      await expect(dialog).toBeHidden();
      // The link is still there on the page the person fixed it on.
      await expect(returnLink(page)).toBeVisible();
      await returnLink(page).click();
      await expect(page).toHaveURL(/\/check\?/);
      await expect(page.locator(`[data-finding-id="${firstId}"]`)).toHaveCount(0);
      await expect(context(page)).toHaveText(`Fixed. ${total(before) - 1} things left.`);
    });

    test("the link is not there when Entries is opened normally, nor after leaving by a tab", async ({ page }) => {
      await seedPairs(page);
      await page.goto("/entries?view=household");
      await expect(page.getByRole("heading", { level: 2 }).first()).toBeVisible({ timeout: 60_000 });
      await expect(returnLink(page)).toHaveCount(0);

      await loadCheck(page);
      await rowsIn(page, "high:transfers").first().getByRole("button", { name: /^Open in Entries/ }).click();
      await expect(returnLink(page)).toBeVisible({ timeout: 60_000 });

      // Leaving Entries by a tab ends the hop, and Entries by a tab has no link.
      await page.keyboard.press("Escape");
      if (phone) {
        await page.getByRole("button", { name: "More pages" }).click();
        await page.locator(".tab-overflow-popover").getByRole("link", { name: "Imports" }).click();
      } else {
        await page.locator("nav.tab-strip").first().getByRole("link", { name: "Imports", exact: true }).click();
      }
      await expect(page).toHaveURL(/\/imports/);
      await expect(returnLink(page)).toHaveCount(0);
      await page.goto("/entries?view=household");
      await expect(page.getByRole("heading", { level: 2 }).first()).toBeVisible({ timeout: 60_000 });
      await expect(returnLink(page)).toHaveCount(0);
    });

    test("'Open in Splits' keeps the way back through the correction dialog and the settled link", async ({ page }) => {
      await seedSettledMistake(page);
      const before = await readReport(page);
      const mistake = before.findings.find((item) => item.kind === "settled_period_error");
      await loadCheck(page);
      const row = page.locator(`[data-finding-id="${mistake.id}"]`);
      if (!(await row.isVisible())) {
        await group(page, `${mistake.tier}:settle_up`).getByRole("button", { name: /^Settle-up mistakes/ }).click();
      }
      await row.getByRole("button", { name: /^Open in Splits/ }).click();
      await expect(page).toHaveURL(/\/splits\?.*correct_settled=/);
      await expect(page.getByRole("dialog", { name: "Correct a settled mistake" })).toBeVisible({ timeout: 60_000 });
      await expect(returnLink(page)).toBeVisible();
      await expect(returnLink(page)).toHaveText("‹ Check my books");
    });

    test("pages that are not fixed in place also give the way back: Imports and the month's plan", async ({ page }) => {
      const finding = (overrides) => ({
        id: "x:1", kind: "statement_gap", tier: "high", title: "A statement is missing", summary: "There is no statement for Aug.", evidence: [],
        amountMinor: null, currency: "SGD", occurredOn: "2026-08-31", personIds: [], fix: { label: "Upload the missing statement in Imports", path: "/imports" }, fixNote: null, evidenceKey: "k", dismissed: false, ...overrides
      });
      const findings = [
        finding(),
        finding({ id: "plan_line_unpaid:1", kind: "plan_line_unpaid", tier: "check", title: "A planned bill was not paid", fix: { label: "Open the month's plan", path: "/month?view=household&month=2026-09#month-plan" } })
      ];
      await page.route(/\/api\/ledger-checkup$/, (route) => route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          ok: true, generatedAt: new Date().toISOString(), tierCounts: { high: 1, check: 1, note: 0 },
          kindCounts: { statement_gap: { high: 1, check: 0, note: 0 }, plan_line_unpaid: { high: 0, check: 1, note: 0 } },
          dismissedCount: 0, findings, moreByKind: {}, incompleteKinds: [], unavailableKinds: [], clearTransferPairCount: 0
        })
      }));
      await loadCheck(page);
      await page.getByRole("button", { name: /^Upload the missing statement in Imports/ }).click();
      await expect(page).toHaveURL(/\/imports/);
      await expect(returnLink(page)).toBeVisible({ timeout: 60_000 });
      await returnLink(page).click();
      await expect(page).toHaveURL(/\/check\?/);
      await expect(headline(page)).toBeVisible();
      await expect(context(page)).toHaveText("Nothing changed.");

      await group(page, "check:plan").getByRole("button", { name: /^Plan problems/ }).click();
      await page.getByRole("button", { name: /^Open the month's plan/ }).click();
      await expect(page).toHaveURL(/\/month\?.*month=2026-09/);
      await expect(returnLink(page)).toBeVisible({ timeout: 60_000 });
      await expect(returnLink(page)).toHaveText("‹ Check my books");
    });

    test("hidden money: the confirmation shows no amount, and nothing on the page reveals one", async ({ page }) => {
      await seedPairs(page);
      await page.addInitScript(() => window.localStorage.setItem("monies-map:money-totals-visible", "false"));
      await loadCheck(page);
      const first = rowsIn(page, "high:transfers").first();
      await first.getByRole("button", { name: /^Link these two/ }).click();
      const dialog = page.getByRole("dialog", { name: "Link these two?" });
      await expect(dialog).toContainText(/FAST to Joyce \d/);
      expect(await dialog.innerText()).not.toMatch(/\$\s?\d/);
      await dialog.getByRole("button", { name: "Cancel" }).click();
      expect(await page.locator(".check-panel").innerText()).not.toMatch(/\$\s?\d/);
    });

    test("the keyboard does it all: open, cancel, open again, confirm, and land on the next problem", async ({ page }) => {
      await seedPairs(page);
      await loadCheck(page);
      const rows = rowsIn(page, "high:transfers");
      const first = rows.first();
      const secondId = await rows.nth(1).getAttribute("data-finding-id");
      const primary = first.getByRole("button", { name: /^Link these two/ });
      await primary.focus();
      await page.keyboard.press("Enter");
      const dialog = page.getByRole("dialog", { name: "Link these two?" });
      await expect(dialog).toBeVisible();
      await expect(dialog.getByRole("button", { name: "Link these two" })).toBeEnabled();
      await page.keyboard.press("Escape");
      await expect(dialog).toBeHidden();
      await expect(primary).toBeFocused();
      await page.keyboard.press("Enter");
      await expect(dialog.getByRole("button", { name: "Link these two" })).toBeEnabled();
      await dialog.getByRole("button", { name: "Link these two" }).focus();
      await page.keyboard.press("Enter");
      await expect(dialog).toBeHidden();
      await expect(page.locator(`[data-finding-id="${secondId}"] .check-fix`)).toBeFocused();
    });

    test("nothing shifts while a problem is fixed in place", async ({ page }) => {
      await seedPairs(page);
      await page.addInitScript(() => {
        window.__layoutShift = 0;
        new PerformanceObserver((list) => {
          for (const item of list.getEntries()) {
            if (!item.hadRecentInput) window.__layoutShift += item.value;
          }
        }).observe({ type: "layout-shift", buffered: true });
      });
      await loadCheck(page);
      await page.waitForTimeout(400);
      const settled = await page.evaluate(() => window.__layoutShift);
      const first = rowsIn(page, "high:transfers").first();
      await first.getByRole("button", { name: /^Link these two/ }).click();
      const dialog = page.getByRole("dialog", { name: "Link these two?" });
      await dialog.getByRole("button", { name: "Link these two" }).click();
      await expect(dialog).toBeHidden();
      await expect(context(page)).toContainText("Fixed.");
      await page.waitForTimeout(600);
      // The line takes the place of the 'Checking' line, so the head does not move.
      expect((await page.evaluate(() => window.__layoutShift)) - settled).toBeLessThan(0.05);
      expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
    });
  });
}
