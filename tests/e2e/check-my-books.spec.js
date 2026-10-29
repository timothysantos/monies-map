import { devices, expect, test } from "@playwright/test";

import { postJson, reseedDemo } from "./helpers";

// The "Check my books" page (docs/flows/check-flow.md), at a desktop width and
// at 390 px: it opens from the page menu, runs the check only then, shows the
// report grouped by what went wrong, hides a thing with "This is fine" and
// brings it back with Undo, opens the fix, keeps money hidden when the person
// asked, and says plainly when it could not check. The household has problems
// of three kinds made through the public routes: seven transfers whose two
// sides are not linked (a group big enough to need "Show more"), a purchase
// entered twice and an entry dated far ahead.

const DESKTOP = { width: 1280, height: 900 };
const PHONE = devices["iPhone 12 Pro"].viewport;

function isoDay(offsetDays) {
  return new Date(Date.now() + offsetDays * 86_400_000).toISOString().slice(0, 10);
}

async function seedProblems(page) {
  await postJson(page, "/api/accounts/create", { name: "Joyce Bank", institution: "DBS", kind: "bank", currency: "SGD", openingBalanceMinor: 0, ownerPersonId: "person-joyce" });
  const entry = (body) => postJson(page, "/api/entries/create", { ownershipType: "direct", ownerName: "Tim", categoryName: "Groceries", entryType: "expense", ...body });
  for (let index = 1; index <= 7; index += 1) {
    const amountMinor = 70_000 + index * 1_111;
    const date = isoDay(-(20 + index));
    await entry({ date, description: `FAST to Joyce ${index}`, accountName: "UOB Savings", categoryName: "Transfer", entryType: "transfer", transferDirection: "out", amountMinor });
    await entry({ date, description: `FAST from Tim ${index}`, accountName: "Joyce Bank", categoryName: "Transfer", entryType: "transfer", transferDirection: "in", amountMinor, ownerName: "Joyce" });
  }
  for (let copy = 0; copy < 2; copy += 1) {
    await entry({ date: isoDay(-12), description: "Duplicate lunch", accountName: "UOB One", amountMinor: 1850 });
  }
  await entry({ date: isoDay(40), description: "Far ahead", accountName: "UOB One", amountMinor: 999 });
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

const group = (page, key) => page.locator(`[data-group="${key}"]`);
const rowsIn = (page, key) => group(page, key).locator(".check-item[data-finding-id]");
const headline = (page) => page.locator("#check-summary-title");

async function openFromMenu(page, { phone }) {
  if (phone) {
    await page.getByRole("button", { name: "More pages" }).click();
    await page.locator(".tab-overflow-popover").getByRole("link", { name: "Check my books" }).click();
  } else {
    await page.locator("nav.tab-strip").first().getByRole("link", { name: "Check my books", exact: true }).click();
  }
  await expect(page).toHaveURL(/\/check(\?|$)/);
}

async function loadCheck(page, query = "view=household") {
  const answered = page.waitForResponse((response) => response.url().includes("/api/ledger-checkup") && response.request().method() === "GET");
  await page.goto(`/check?${query}`);
  await answered;
  await expect(page.getByRole("heading", { name: "Check my books", level: 2 })).toBeVisible();
}

for (const [label, viewport, phone] of [["desktop", DESKTOP, false], ["390 px phone", PHONE, true]]) {
  test.describe(`Check my books on ${label}`, () => {
    test.use({ viewport });

    test.beforeEach(async ({ page }) => {
      await page.addInitScript(() => window.localStorage.setItem("monies-map:money-totals-visible", "true"));
      await page.goto("/");
      await reseedDemo(page);
      await seedProblems(page);
    });

    test("opens from the page menu, and the check runs only then", async ({ page }) => {
      const checkRequests = [];
      page.on("request", (request) => {
        if (request.url().includes("/api/ledger-checkup")) checkRequests.push(`${request.method()} ${new URL(request.url()).pathname}${new URL(request.url()).search}`);
      });
      await page.goto("/summary?view=household&month=2026-05");
      await expect(page.locator("nav.tab-strip").first()).toBeVisible();
      await page.waitForLoadState("networkidle");
      // Nothing reads or runs the check while another page is open.
      expect(checkRequests).toEqual([]);

      await openFromMenu(page, { phone });
      await expect(page.getByRole("heading", { name: "Check my books", level: 2 })).toBeVisible();
      await expect(headline(page)).toBeVisible();
      expect(checkRequests).toEqual(["GET /api/ledger-checkup"]);
    });

    test("the summary counts are the report's, in plain words, with the three sections in order", async ({ page }) => {
      const report = await readReport(page);
      expect(report.tierCounts.high).toBe(7);
      await loadCheck(page);
      await expect(headline(page)).toHaveText(summaryText(report.tierCounts));
      await expect(page.locator(".check-summary-detail")).toContainText(/^Checked \d/);
      await expect(page.locator(".check-tier h3")).toHaveText([
        `Needs fixing${report.tierCounts.high}`,
        `Worth checking${report.tierCounts.check}`,
        `Good to know${report.tierCounts.note}`
      ]);
      await expect(page.locator(".check-intro")).toHaveText("Looks over your entries, statements, shared expenses and plans for things that seem wrong. It only looks: nothing changes unless you choose to fix it.");
      // No engine word reaches the page.
      const text = await page.locator(".check-panel").innerText();
      expect(text).not.toMatch(/\b(finding|detector|tier|evidence|dismiss)/i);
    });

    test("problems are grouped by what went wrong, and only the first group starts open", async ({ page }) => {
      await loadCheck(page);
      const transfers = group(page, "high:transfers");
      await expect(transfers.getByRole("button", { name: /^Transfers waiting for their other side/ })).toHaveAttribute("aria-expanded", "true");
      await expect(group(page, "check:duplicates").getByRole("button", { name: /^Possible duplicates/ })).toHaveAttribute("aria-expanded", "false");
      await expect(group(page, "check:tidy").getByRole("button", { name: /^Tidy-ups/ })).toHaveAttribute("aria-expanded", "false");
      await expect(group(page, "note:tidy").getByRole("button", { name: /^Tidy-ups/ })).toHaveAttribute("aria-expanded", "false");
      // A closed group shows no rows; its count is in its heading.
      await expect(rowsIn(page, "check:duplicates")).toHaveCount(0);
      await expect(group(page, "check:duplicates").locator(".check-count")).toHaveText("1");

      await group(page, "check:duplicates").getByRole("button", { name: /^Possible duplicates/ }).click();
      await expect(rowsIn(page, "check:duplicates")).toHaveCount(1);
      const row = rowsIn(page, "check:duplicates").first();
      await expect(row.locator(".check-item-title")).toHaveText("Two entries look the same");
      await expect(row.locator(".check-item-summary")).toContainText("Two purchases of $18.50 for Duplicate lunch");
      await expect(row.locator(".check-evidence li")).toHaveCount(2);
      await expect(row.locator(".check-item-money")).toHaveText("$18.50 involved");

      await transfers.getByRole("button", { name: /^Transfers waiting/ }).click();
      await expect(transfers.getByRole("button", { name: /^Transfers waiting/ })).toHaveAttribute("aria-expanded", "false");
      await expect(rowsIn(page, "high:transfers")).toHaveCount(0);
    });

    test("which groups are open is remembered on this device", async ({ page }) => {
      await loadCheck(page);
      await group(page, "check:duplicates").getByRole("button", { name: /^Possible duplicates/ }).click();
      await group(page, "high:transfers").getByRole("button", { name: /^Transfers waiting/ }).click();
      await page.reload();
      await expect(headline(page)).toBeVisible();
      await expect(group(page, "check:duplicates").getByRole("button", { name: /^Possible duplicates/ })).toHaveAttribute("aria-expanded", "true");
      await expect(group(page, "high:transfers").getByRole("button", { name: /^Transfers waiting/ })).toHaveAttribute("aria-expanded", "false");
    });

    test("a group shows five rows, then 'Show 2 more', then 'Show fewer'", async ({ page }) => {
      await loadCheck(page);
      const transfers = group(page, "high:transfers");
      await expect(rowsIn(page, "high:transfers")).toHaveCount(5);
      await transfers.getByRole("button", { name: "Show 2 more" }).click();
      await expect(rowsIn(page, "high:transfers")).toHaveCount(7);
      await expect(transfers.getByRole("button", { name: "Show 2 more" })).toHaveCount(0);
      await transfers.getByRole("button", { name: "Show fewer" }).click();
      await expect(rowsIn(page, "high:transfers")).toHaveCount(5);
    });

    test("'This is fine' hides one thing in place, the counts move, and Undo brings it back", async ({ page }) => {
      const before = await readReport(page);
      await loadCheck(page);
      const first = rowsIn(page, "high:transfers").first();
      const title = await first.locator(".check-item-title").innerText();
      const findingId = await first.getAttribute("data-finding-id");
      await first.getByRole("button", { name: `This is fine: ${title}` }).click();

      const hiddenNote = group(page, "high:transfers").locator("[data-hidden-now]");
      await expect(hiddenNote).toContainText("Hidden.");
      await expect(headline(page)).toHaveText(summaryText({ ...before.tierCounts, high: before.tierCounts.high - 1 }));
      // Focus moves to Undo, so the keyboard is not left on a row that is gone.
      await expect(hiddenNote.getByRole("button", { name: /^Undo hiding/ })).toBeFocused();
      // The server kept it.
      await expect.poll(async () => (await readReport(page)).dismissedCount).toBe(1);
      expect((await readReport(page)).findings.some((finding) => finding.id === findingId)).toBe(false);

      await hiddenNote.getByRole("button", { name: /^Undo hiding/ }).click();
      await expect(headline(page)).toHaveText(summaryText(before.tierCounts));
      await expect(group(page, "high:transfers").locator(`[data-finding-id="${findingId}"]`)).toBeVisible();
      await expect.poll(async () => (await readReport(page)).dismissedCount).toBe(0);
    });

    test("a hidden thing stays hidden after the check runs again, and 'Show hidden' lists it with 'Show again'", async ({ page }) => {
      const before = await readReport(page);
      await loadCheck(page);
      const first = rowsIn(page, "high:transfers").first();
      const title = await first.locator(".check-item-title").innerText();
      await first.getByRole("button", { name: `This is fine: ${title}` }).click();
      await expect(headline(page)).toHaveText(summaryText({ ...before.tierCounts, high: before.tierCounts.high - 1 }));

      await page.getByRole("button", { name: "Check again" }).click();
      await expect(headline(page)).toHaveText(summaryText({ ...before.tierCounts, high: before.tierCounts.high - 1 }));
      await expect(page.locator("[data-hidden-now]")).toHaveCount(0);

      const toggle = page.getByRole("button", { name: "Show hidden (1)" });
      await expect(page.locator("#check-hidden-title")).toHaveCount(0);
      const answered = page.waitForResponse((response) => response.url().includes("dismissed=1"));
      await toggle.click();
      await answered;
      const hiddenSection = page.locator(".check-hidden");
      await expect(hiddenSection.locator("h3")).toHaveText("Hidden by you1");
      const hiddenGroup = hiddenSection.locator('[data-group="hidden:transfers"]');
      await hiddenGroup.getByRole("button", { name: /^Transfers waiting/ }).click();
      await expect(hiddenGroup.locator(".check-item[data-finding-id]")).toHaveCount(1);
      // The section counts never include it.
      await expect(headline(page)).toHaveText(summaryText({ ...before.tierCounts, high: before.tierCounts.high - 1 }));

      await hiddenGroup.getByRole("button", { name: `Show again: ${title}` }).click();
      await expect(headline(page)).toHaveText(summaryText(before.tierCounts));
      await expect(page.getByRole("button", { name: /^(Show|Hide) hidden/ })).toHaveCount(0);
      await expect.poll(async () => (await readReport(page)).dismissedCount).toBe(0);
    });

    test("a transfer's quiet 'Open in Entries' opens its entry in the editor (the main button links in place)", async ({ page }) => {
      await loadCheck(page);
      const first = rowsIn(page, "high:transfers").first();
      const title = await first.locator(".check-item-title").innerText();
      await expect(first.getByRole("button", { name: new RegExp(`^Link these two: ${title}`) })).toBeVisible();
      const button = first.getByRole("button", { name: new RegExp(`^Open in Entries: ${title}`) });
      await button.click();
      await expect(page).toHaveURL(/\/entries\?.*editing_entry=txn-/);
      await expect(page.getByRole("button", { name: "Manage transfer" })).toBeVisible({ timeout: 60_000 });
    });

    test("the buttons are at least 44 px tall", async ({ page }) => {
      await loadCheck(page);
      await group(page, "check:duplicates").getByRole("button", { name: /^Possible duplicates/ }).click();
      await expect(rowsIn(page, "check:duplicates")).toHaveCount(1);
      const heights = await page.locator(".check-panel button:visible").evaluateAll((buttons) => buttons.map((button) => ({ name: button.textContent.trim().slice(0, 40), height: Math.round(button.getBoundingClientRect().height) })));
      expect(heights.length).toBeGreaterThan(8);
      for (const item of heights) expect(item.height, `${item.name} is ${item.height}px`).toBeGreaterThanOrEqual(44);
    });

    test("no horizontal scroll and nothing shifts while the result lands", async ({ page }) => {
      await page.addInitScript(() => {
        window.__layoutShift = 0;
        new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) {
            if (!entry.hadRecentInput) window.__layoutShift += entry.value;
          }
        }).observe({ type: "layout-shift", buffered: true });
      });
      await loadCheck(page);
      await expect(headline(page)).toBeVisible();
      await page.waitForTimeout(500);
      expect(await page.evaluate(() => window.__layoutShift)).toBeLessThan(0.05);
      expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
    });

    test("hidden money: no amount on the page, the counts stay", async ({ page }) => {
      await page.addInitScript(() => window.localStorage.setItem("monies-map:money-totals-visible", "false"));
      const report = await readReport(page);
      await loadCheck(page);
      await expect(headline(page)).toHaveText(summaryText(report.tierCounts));
      await group(page, "check:duplicates").getByRole("button", { name: /^Possible duplicates/ }).click();
      await expect(rowsIn(page, "check:duplicates")).toHaveCount(1);
      const text = await page.locator(".check-panel").innerText();
      expect(text).not.toMatch(/\$\s?\d/);
      expect(text).not.toMatch(/\binvolved\b/);
      await expect(rowsIn(page, "check:duplicates").first().locator(".check-item-summary")).toContainText("••••");
    });

    test("the person's view is sent with the check", async ({ page }) => {
      const urls = [];
      page.on("request", (request) => {
        if (request.url().includes("/api/ledger-checkup")) urls.push(new URL(request.url()).search);
      });
      await loadCheck(page, "view=person-joyce");
      expect(urls).toContain("?view=person-joyce");
      await expect(page.locator(".panel-context")).toHaveText("Checking Joyce and anything shared");
      const joyce = await readReport(page, "?view=person-joyce");
      await expect(headline(page)).toHaveText(summaryText(joyce.tierCounts));
    });
  });
}

test.describe("Check my books, states", () => {
  test.use({ viewport: DESKTOP });

  const finding = (overrides = {}) => ({
    id: "odd_entry:x1", kind: "odd_entry", tier: "check", title: "An entry is dated far ahead", summary: "Far ahead ($9.99) is dated 6 Dec, more than 14 days from today.",
    evidence: [{ role: "entry", label: "Far ahead", date: "2026-12-06", amountMinor: 999, currency: "SGD", accountName: "UOB One" }],
    amountMinor: 999, currency: "SGD", occurredOn: "2026-12-06", personIds: [], fix: null, fixNote: "Nothing to fix in the books.", evidenceKey: "k1", dismissed: false, ...overrides
  });
  const report = (overrides = {}) => ({
    ok: true, generatedAt: new Date().toISOString(), tierCounts: { high: 0, check: 0, note: 0 }, kindCounts: {}, dismissedCount: 0, findings: [], moreByKind: {}, incompleteKinds: [], unavailableKinds: [], ...overrides
  });
  const mockBare = (page, handler) => page.route(/\/api\/ledger-checkup$/, handler);

  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => window.localStorage.setItem("monies-map:money-totals-visible", "true"));
    await page.goto("/");
    await reseedDemo(page);
  });

  test("nothing wrong: 'Everything checks out' with the time and a way to check again", async ({ page }) => {
    await mockBare(page, (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify(report()) }));
    await page.goto("/check?view=household");
    await expect(page.locator(".check-empty")).toContainText("Everything checks out");
    await expect(page.locator(".check-empty")).toContainText(/Checked \d.*Nothing looks wrong in your entries, statements, shared expenses or plans\./);
    await expect(page.getByRole("button", { name: "Check again" })).toBeEnabled();
    await expect(page.locator(".check-tier")).toHaveCount(0);
    await expect(page.getByRole("status").filter({ hasText: "Check finished. Everything checks out." })).toHaveCount(1);
  });

  test("while it checks: a skeleton with a 'Checking…' button; then the result, with no new request until asked", async ({ page }) => {
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    let requests = 0;
    await mockBare(page, async (route) => {
      requests += 1;
      await gate;
      await route.fulfill({ contentType: "application/json", body: JSON.stringify(report()) });
    });
    await page.goto("/check?view=household");
    await expect(page.locator(".check-skeleton")).toBeVisible();
    await expect(page.getByRole("button", { name: "Checking…" })).toBeDisabled();
    const reserved = await page.locator(".check-skeleton").evaluate((element) => element.getBoundingClientRect().height);
    expect(reserved).toBeGreaterThanOrEqual(400);
    release();
    await expect(page.locator(".check-empty")).toBeVisible();
    await expect(page.locator(".check-skeleton")).toHaveCount(0);
    await page.waitForTimeout(400);
    expect(requests).toBe(1);
  });

  test("it could not check: a plain message with 'Try again'", async ({ page }) => {
    let calls = 0;
    await mockBare(page, (route) => {
      calls += 1;
      if (calls === 1) return route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ ok: false }) });
      return route.fulfill({ contentType: "application/json", body: JSON.stringify(report({ tierCounts: { high: 0, check: 1, note: 0 }, kindCounts: { odd_entry: { high: 0, check: 1, note: 0 } }, findings: [finding()] })) });
    });
    await page.goto("/check?view=household");
    const error = page.locator(".check-error");
    await expect(error).toContainText("Could not check your books");
    await expect(error).toContainText("Check your connection and try again. Nothing was changed.");
    await error.getByRole("button", { name: "Try again" }).click();
    await expect(headline(page)).toHaveText("1 worth checking");
    expect(calls).toBe(2);
  });

  test("'Check again' failing keeps the earlier result and offers 'Try again'", async ({ page }) => {
    let calls = 0;
    await mockBare(page, (route) => {
      calls += 1;
      if (calls === 2) return route.fulfill({ status: 500, contentType: "application/json", body: "{}" });
      return route.fulfill({ contentType: "application/json", body: JSON.stringify(report({ tierCounts: { high: 0, check: 1, note: 0 }, kindCounts: { odd_entry: { high: 0, check: 1, note: 0 } }, findings: [finding()] })) });
    });
    await page.goto("/check?view=household");
    await expect(headline(page)).toHaveText("1 worth checking");
    await page.getByRole("button", { name: "Check again" }).click();
    await expect(page.getByRole("alert").filter({ hasText: "Could not check again" })).toContainText("Showing the result from before.");
    await expect(headline(page)).toHaveText("1 worth checking");
    await page.getByRole("alert").getByRole("button", { name: "Try again" }).click();
    await expect(page.getByRole("alert").filter({ hasText: "Could not check again" })).toHaveCount(0);
  });

  test("a quiet note replaces the button when there is no fix", async ({ page }) => {
    await mockBare(page, (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify(report({ tierCounts: { high: 0, check: 1, note: 0 }, kindCounts: { odd_entry: { high: 0, check: 1, note: 0 } }, findings: [finding()] })) }));
    await page.goto("/check?view=household");
    const row = page.locator(".check-item[data-finding-id]").first();
    await expect(row.locator(".check-item-note")).toHaveText("Nothing to fix in the books.");
    await expect(row.locator(".check-fix")).toHaveCount(0);
    await expect(row.getByRole("button", { name: /^This is fine/ })).toBeVisible();
  });

  test("more exist than the 50 sent: 'Showing 50 of 137'; a read that hit its limit says there may be more", async ({ page }) => {
    const findings = Array.from({ length: 50 }, (_, index) => finding({ id: `unmatched_transfer:${String(index).padStart(3, "0")}`, kind: "unmatched_transfer", tier: "high", title: "Two sides of one transfer are not linked", fixNote: null, amountMinor: null }));
    await mockBare(page, (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify(report({
      findings,
      tierCounts: { high: 137, check: 0, note: 0 },
      kindCounts: { unmatched_transfer: { high: 137, check: 0, note: 0 } },
      moreByKind: { unmatched_transfer: 87 },
      incompleteKinds: ["unmatched_transfer"]
    })) }));
    await page.goto("/check?view=household");
    await expect(headline(page)).toHaveText("137 things need fixing");
    const transfers = group(page, "high:transfers");
    await expect(transfers.locator(".check-count")).toHaveText("137");
    await expect(transfers).toContainText("There may be more than shown");
    await expect(rowsIn(page, "high:transfers")).toHaveCount(5);
    await transfers.getByRole("button", { name: "Show 45 more" }).click();
    await expect(rowsIn(page, "high:transfers")).toHaveCount(50);
    await expect(transfers.locator(".check-note").filter({ hasText: "Showing 50 of 137" })).toBeVisible();
  });

  test("a check that could not run is named, with 'Try again' that runs the check again", async ({ page }) => {
    let calls = 0;
    await mockBare(page, (route) => {
      calls += 1;
      return route.fulfill({ contentType: "application/json", body: JSON.stringify(calls === 1
        ? report({ unavailableKinds: ["duplicate_entry", "duplicate_split"] })
        : report()) });
    });
    await page.goto("/check?view=household");
    await expect(page.locator(".check-empty")).toContainText("Nothing found in the checks that ran");
    const notice = page.locator(".check-unavailable");
    await expect(notice).toContainText("Possible duplicates");
    await expect(notice).toContainText("Could not check this");
    await notice.getByRole("button", { name: "Try again" }).click();
    await expect(page.locator(".check-empty")).toContainText("Everything checks out");
    await expect(page.locator(".check-unavailable")).toHaveCount(0);
  });

  test("a refused 'This is fine' puts the row back and says so", async ({ page }) => {
    await mockBare(page, (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify(report({ tierCounts: { high: 0, check: 1, note: 0 }, kindCounts: { odd_entry: { high: 0, check: 1, note: 0 } }, findings: [finding()] })) }));
    await page.route("**/api/ledger-checkup/dismiss", (route) => route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ ok: false }) }));
    await page.goto("/check?view=household");
    await page.getByRole("button", { name: /^This is fine/ }).click();
    await expect(page.getByRole("alert").filter({ hasText: "Could not hide this. Try again." })).toBeVisible();
    await expect(headline(page)).toHaveText("1 worth checking");
    await expect(page.locator("[data-hidden-now]")).toHaveCount(0);
  });

  test("keyboard: the group buttons open and close with Enter and keep their order", async ({ page }) => {
    await mockBare(page, (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify(report({
      tierCounts: { high: 0, check: 2, note: 0 },
      kindCounts: { odd_entry: { high: 0, check: 1, note: 0 }, duplicate_entry: { high: 0, check: 1, note: 0 } },
      findings: [finding(), finding({ id: "duplicate_entry:d1", kind: "duplicate_entry", title: "Two entries look the same", amountMinor: 100 })]
    })) }));
    await page.goto("/check?view=household");
    await expect(headline(page)).toHaveText("2 worth checking");
    const toggles = page.locator(".check-group-toggle");
    await expect(toggles).toHaveCount(2);
    const second = toggles.nth(1);
    await second.focus();
    await page.keyboard.press("Enter");
    await expect(second).toHaveAttribute("aria-expanded", "true");
    await page.keyboard.press("Enter");
    await expect(second).toHaveAttribute("aria-expanded", "false");
    // The page's own buttons come before the groups, in reading order.
    const order = await page.locator(".check-panel button:visible").evaluateAll((buttons) => buttons.map((button) => button.textContent.trim().slice(0, 18)));
    expect(order[0]).toBe("Check again");
  });

  test("reduced motion: the group arrow does not animate", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await mockBare(page, (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify(report({ tierCounts: { high: 0, check: 1, note: 0 }, kindCounts: { odd_entry: { high: 0, check: 1, note: 0 } }, findings: [finding()] })) }));
    await page.goto("/check?view=household");
    const duration = await page.locator(".check-chevron").first().evaluate((element) => getComputedStyle(element).transitionDuration);
    expect(duration).toBe("0s");
  });

  test("opening the hidden list asks for hidden items, and the toggle names how many", async ({ page }) => {
    const urls = [];
    await page.route(/\/api\/ledger-checkup(\?.*)?$/, (route) => {
      urls.push(new URL(route.request().url()).search);
      const hidden = route.request().url().includes("dismissed=1");
      return route.fulfill({ contentType: "application/json", body: JSON.stringify(report({
        dismissedCount: 1,
        tierCounts: { high: 0, check: 1, note: 0 },
        kindCounts: { odd_entry: { high: 0, check: 1, note: 0 } },
        findings: hidden ? [finding(), finding({ id: "odd_entry:h1", dismissed: true, title: "An entry has no amount" })] : [finding()]
      })) });
    });
    await page.goto("/check?view=household");
    await page.getByRole("button", { name: "Show hidden (1)" }).click();
    await expect(page.getByRole("button", { name: "Hide hidden (1)" })).toBeVisible();
    expect(urls.at(-1)).toBe("?dismissed=1");
    await page.getByRole("button", { name: "Hide hidden (1)" }).click();
    await expect(page.locator(".check-hidden")).toHaveCount(0);
  });
});
