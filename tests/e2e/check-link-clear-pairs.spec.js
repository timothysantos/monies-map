import { devices, expect, test } from "@playwright/test";

import { postJson, reseedDemo } from "./helpers";

// "Link these N clear pairs" on Check my books (docs/flows/check-flow.md,
// "Link clear pairs"), at a desktop width and at 390 px. Seven unlinked
// transfer pairs of different amounts (each side has exactly one possible
// match) make the group; the button opens one preview, nothing changes until
// the confirming button, the result line says how many were linked and
// skipped, the list and the counts then refresh, and a pair that changed
// while the dialog was open is skipped by name. Money hidden shows no amount.

const DESKTOP = { width: 1280, height: 900 };
const PHONE = devices["iPhone 12 Pro"].viewport;
const PAIRS = 7;

function isoDay(offsetDays) {
  return new Date(Date.now() + offsetDays * 86_400_000).toISOString().slice(0, 10);
}

async function seedPairs(page) {
  await postJson(page, "/api/accounts/create", { name: "Joyce Bank", institution: "DBS", kind: "bank", currency: "SGD", openingBalanceMinor: 0, ownerPersonId: "person-joyce" });
  const entry = (body) => postJson(page, "/api/entries/create", { ownershipType: "direct", ownerName: "Tim", categoryName: "Groceries", entryType: "expense", ...body });
  const ids = [];
  for (let index = 1; index <= PAIRS; index += 1) {
    const amountMinor = 70_000 + index * 1_111;
    const date = isoDay(-(20 + index * 3));
    const out = await entry({ date, description: `FAST to Joyce ${index}`, accountName: "UOB Savings", categoryName: "Transfer", entryType: "transfer", transferDirection: "out", amountMinor });
    const into = await entry({ date, description: `FAST from Tim ${index}`, accountName: "Joyce Bank", categoryName: "Transfer", entryType: "transfer", transferDirection: "in", amountMinor, ownerName: "Joyce" });
    ids.push({ fromEntryId: out.entryId, toEntryId: into.entryId });
  }
  return ids;
}

async function readReport(page) {
  const response = await page.request.get("/api/ledger-checkup");
  expect(response.ok()).toBe(true);
  return response.json();
}

async function loadCheck(page) {
  const answered = page.waitForResponse((response) => response.url().includes("/api/ledger-checkup") && response.request().method() === "GET");
  await page.goto("/check?view=household");
  await answered;
  await expect(page.getByRole("heading", { name: "Check my books", level: 2 })).toBeVisible();
}

const group = (page) => page.locator('[data-group="high:transfers"]');
const dialog = (page) => page.getByRole("dialog");

for (const [label, viewport] of [["desktop", DESKTOP], ["390 px phone", PHONE]]) {
  test.describe(`Link clear pairs on ${label}`, () => {
    test.use({ viewport });
    let seeded;

    test.beforeEach(async ({ page }) => {
      await page.addInitScript(() => window.localStorage.setItem("monies-map:money-totals-visible", "true"));
      await page.goto("/");
      await reseedDemo(page);
      seeded = await seedPairs(page);
    });

    test("the group says what clear means and offers the button with the server's count", async ({ page }) => {
      const report = await readReport(page);
      expect(report.clearTransferPairCount).toBe(PAIRS);
      await loadCheck(page);
      await expect(group(page).getByText("Only pairs with exactly one possible match on each side.")).toBeVisible();
      await expect(group(page).getByRole("button", { name: `Link these ${PAIRS} clear pairs of transfers` })).toHaveText(`Link these ${PAIRS} clear pairs`);
      // The ordinary rows are still there, each with its own link in place.
      await expect(group(page).locator(".check-item[data-finding-id]").first().getByRole("button", { name: /^Link these two/ })).toBeVisible();
    });

    test("the preview lists the pairs, Cancel changes nothing, and opening it shifts nothing", async ({ page }) => {
      await loadCheck(page);
      await page.evaluate(() => {
        window.__shift = 0;
        new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) if (!entry.hadRecentInput) window.__shift += entry.value;
        }).observe({ type: "layout-shift", buffered: false });
      });
      const panelTop = async () => page.locator(".check-panel").evaluate((node) => Math.round(node.getBoundingClientRect().top + window.scrollY));
      // Positions on the page itself (not the viewport, which the scroll moves).
      const groupBox = async () => group(page).evaluate((node) => {
        const box = node.getBoundingClientRect();
        return { top: Math.round(box.top + window.scrollY), left: Math.round(box.left), width: Math.round(box.width), height: Math.round(box.height) };
      });
      const groupBefore = await groupBox();
      const topBefore = await panelTop();
      const before = await readReport(page);

      await group(page).getByRole("button", { name: `Link these ${PAIRS} clear pairs of transfers` }).click();
      await expect(dialog(page)).toBeVisible();
      await expect(dialog(page)).toHaveAccessibleName(`Link ${PAIRS} clear pairs`);
      await expect(dialog(page)).toContainText(`Link ${PAIRS} clear pairs`);
      await expect(dialog(page).getByText(/^7 pairs, [A-Z][a-z]{2} \d{4}( to [A-Z][a-z]{2} \d{4})?$|^7 pairs in [A-Z][a-z]{2} \d{4}$/)).toBeVisible();
      await expect(dialog(page).locator(".check-pairs-list li")).toHaveCount(PAIRS);
      const first = dialog(page).locator(".check-pairs-list li").first();
      await expect(first).toContainText("UOB Savings → Joyce Bank");
      await expect(first.locator(".check-pairs-amount")).toHaveText(/^\$\d+/);
      await expect(dialog(page)).toContainText("Each pair will become one move between your accounts. Nothing is deleted. You can unlink a pair from its details.");
      await expect(dialog(page)).toContainText("There is no undo for all of them at once.");
      await expect(dialog(page).getByRole("button", { name: `Link ${PAIRS} pairs` })).toBeEnabled();

      await dialog(page).getByRole("button", { name: "Cancel" }).click();
      await expect(dialog(page)).toHaveCount(0);
      expect(await readReport(page)).toEqual({ ...before, generatedAt: expect.any(String) });
      expect((await page.request.get("/api/ledger-checkup/clear-pairs")).ok()).toBe(true);
      await expect(group(page).locator(".check-item[data-finding-id]").first()).toBeVisible();
      expect(await panelTop()).toBe(topBefore);
      expect(await groupBox()).toEqual(groupBefore);
      expect(await page.evaluate(() => window.__shift)).toBe(0);
    });

    test("confirming links every pair once, says so, and the page then shows them gone", async ({ page }) => {
      await loadCheck(page);
      const linkRequests = [];
      page.on("request", (request) => {
        if (request.method() === "POST" && request.url().includes("/api/ledger-checkup/clear-pairs")) linkRequests.push(request.postDataJSON());
      });
      await group(page).getByRole("button", { name: `Link these ${PAIRS} clear pairs of transfers` }).click();
      await dialog(page).getByRole("button", { name: `Link ${PAIRS} pairs` }).click();
      await expect(dialog(page).getByRole("status").filter({ hasText: "Linked" })).toHaveText(`Linked ${PAIRS} pairs. 0 skipped.`);
      // One request with exactly the pairs that were shown.
      expect(linkRequests).toHaveLength(1);
      expect(linkRequests[0].pairs.map((pair) => `${pair.fromEntryId}>${pair.toEntryId}`).sort()).toEqual(seeded.map((pair) => `${pair.fromEntryId}>${pair.toEntryId}`).sort());
      await dialog(page).getByRole("button", { name: "Close", exact: true }).click();
      await expect(dialog(page)).toHaveCount(0);

      // The list and the counts refreshed: the group of waiting pairs is gone.
      await expect(page.locator('[data-group="high:transfers"]')).toHaveCount(0);
      const report = await readReport(page);
      expect(report.clearTransferPairCount).toBe(0);
      expect(report.kindCounts.unmatched_transfer?.high ?? 0).toBe(0);
      await expect(page.locator("#check-summary-title")).not.toContainText("need");
      // Focus did not fall back to the top of the document.
      await expect(page.locator("#check-title")).toBeFocused();
      // The entries really are linked pairs now.
      const entries = await page.request.get(`/api/entries-page?view=household&month=${isoDay(-23).slice(0, 7)}`);
      expect(entries.ok()).toBe(true);
    });

    test("a pair that changed while the dialog was open is skipped by name, the rest are linked", async ({ page }) => {
      await loadCheck(page);
      await group(page).getByRole("button", { name: `Link these ${PAIRS} clear pairs of transfers` }).click();
      await expect(dialog(page).locator(".check-pairs-list li")).toHaveCount(PAIRS);
      // Meanwhile one of them is linked by hand elsewhere.
      const linked = await page.request.post("/api/transfers/link", { data: seeded[0] });
      expect(linked.ok()).toBe(true);
      await dialog(page).getByRole("button", { name: `Link ${PAIRS} pairs` }).click();
      await expect(dialog(page).getByRole("status").filter({ hasText: "Linked" })).toHaveText(`Linked ${PAIRS - 1} pairs. 1 changed since you looked and was skipped.`);
      await dialog(page).getByRole("button", { name: "Close", exact: true }).click();
      expect((await readReport(page)).clearTransferPairCount).toBe(0);
    });

    test("with money hidden no amount is shown in the dialog", async ({ page }) => {
      await page.addInitScript(() => window.localStorage.setItem("monies-map:money-totals-visible", "false"));
      await loadCheck(page);
      await group(page).getByRole("button", { name: `Link these ${PAIRS} clear pairs of transfers` }).click();
      await expect(dialog(page).locator(".check-pairs-list li")).toHaveCount(PAIRS);
      await expect(dialog(page).locator(".check-pairs-amount")).toHaveCount(0);
      expect(await dialog(page).innerText()).not.toMatch(/\$|\b\d{2,3},?\d{3}\b|71,111/);
      await dialog(page).getByRole("button", { name: "Cancel" }).click();
    });

    test("it works from the keyboard: Enter opens it, Escape closes it without linking, Enter on the confirming button links", async ({ page }) => {
      await loadCheck(page);
      const button = group(page).getByRole("button", { name: `Link these ${PAIRS} clear pairs of transfers` });
      await button.focus();
      await page.keyboard.press("Enter");
      await expect(dialog(page)).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(dialog(page)).toHaveCount(0);
      await expect(button).toBeFocused();
      expect((await readReport(page)).clearTransferPairCount).toBe(PAIRS);

      await page.keyboard.press("Enter");
      const confirm = dialog(page).getByRole("button", { name: `Link ${PAIRS} pairs` });
      await expect(confirm).toBeVisible();
      await confirm.focus();
      await page.keyboard.press("Enter");
      await expect(dialog(page).getByRole("status").filter({ hasText: "Linked" })).toHaveText(`Linked ${PAIRS} pairs. 0 skipped.`);
      await page.keyboard.press("Escape");
      await expect(dialog(page)).toHaveCount(0);
    });

    test("a failed link says nothing was linked and the same pairs can be tried again", async ({ page }) => {
      await loadCheck(page);
      let failures = 1;
      await page.route("**/api/ledger-checkup/clear-pairs", async (route) => {
        if (route.request().method() === "POST" && failures > 0) {
          failures -= 1;
          await route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ ok: false, error: "Nothing was linked. Try again." }) });
          return;
        }
        await route.continue();
      });
      await group(page).getByRole("button", { name: `Link these ${PAIRS} clear pairs of transfers` }).click();
      await dialog(page).getByRole("button", { name: `Link ${PAIRS} pairs` }).click();
      await expect(dialog(page)).toContainText("Nothing was linked. Check your connection and try again.");
      expect((await readReport(page)).clearTransferPairCount).toBe(PAIRS);
      await dialog(page).getByRole("button", { name: `Link ${PAIRS} pairs` }).click();
      await expect(dialog(page).getByRole("status").filter({ hasText: "Linked" })).toHaveText(`Linked ${PAIRS} pairs. 0 skipped.`);
    });
  });
}
