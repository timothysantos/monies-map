import { expect, test } from "@playwright/test";

import { reseedDemo } from "./helpers";

// Route code warmup (H05). Vite dev serves each route panel as its own
// module, so a warmed route shows up as a request for its panel file.
// Development builds carry no cost block (unknown cost = no automatic mobile
// warmup), so tests that expect automatic mobile warmup inject a small one.

const PANEL_PATTERN = /\/src\/client\/(summary|month|entries|splits|imports|settings|faq)-panel\.jsx/;
const MOBILE = { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true };
const DESKTOP = { viewport: { width: 1440, height: 900 } };

function recordPanelRequests(page) {
  const requests = [];
  page.on("request", (request) => {
    const match = new URL(request.url()).pathname.match(PANEL_PATTERN);
    if (match) {
      requests.push(match[1]);
    }
  });
  return requests;
}

async function injectWarmupCosts(page, entriesBytes = 1_000) {
  await page.addInitScript((bytes) => {
    const routes = Object.fromEntries(["summary", "month", "entries", "splits", "imports", "settings", "faq"].map((id) => [id, {
      entry: `${id}-panel.jsx`,
      estimatedGzipBytes: id === "entries" ? bytes : 1_000,
      chunks: [{ file: `assets/${id}-panel.js`, estimatedGzipBytes: id === "entries" ? bytes : 1_000 }]
    }]));
    const insert = () => {
      const block = document.createElement("script");
      block.id = "monies-warmup-costs";
      block.type = "application/json";
      block.textContent = JSON.stringify({ schemaVersion: 1, buildId: "e2e", revision: "e2e", routes });
      document.head.append(block);
    };
    document.addEventListener("DOMContentLoaded", insert, { once: true });
  }, entriesBytes);
}

async function setWarmupMode(page, mode) {
  await page.addInitScript((value) => { window.__MONIES_MAP_WARMUP_MODE__ = value; }, mode);
}

async function waitUsable(page) {
  await expect.poll(() => page.evaluate(() => window.__MONIES_MAP_ROUTE_WORK__?.usable ?? false), { timeout: 30_000 }).toBe(true);
}

async function newPage(browser, options) {
  const context = await browser.newContext(options);
  const page = await context.newPage();
  await page.goto("/");
  // Let the setup page finish loading, so none of its late module requests
  // are counted by a test that starts recording afterwards.
  await waitUsable(page);
  await reseedDemo(page);
  return { context, page };
}

test.describe("route warmup on mobile", () => {
  test("loads only the likely-next route, and only after the page is usable and quiet", async ({ browser }) => {
    const { context, page } = await newPage(browser, MOBILE);
    await injectWarmupCosts(page);
    const requests = recordPanelRequests(page);
    await page.goto("/summary?view=household&month=2026-05");
    await waitUsable(page);
    expect(requests).toEqual(["summary"]);
    await page.waitForTimeout(1_000);
    expect(requests).toEqual(["summary"]);
    await expect.poll(() => requests, { timeout: 10_000 }).toEqual(["summary", "entries"]);
    await page.waitForTimeout(5_000);
    expect(requests).toEqual(["summary", "entries"]);
    await context.close();
  });

  test("unknown route cost means no automatic warmup", async ({ browser }) => {
    const { context, page } = await newPage(browser, MOBILE);
    const requests = recordPanelRequests(page);
    await page.goto("/summary?view=household&month=2026-05");
    await waitUsable(page);
    await page.waitForTimeout(6_000);
    expect(requests).toEqual(["summary"]);
    await context.close();
  });

  test("an open editor blocks warmup; closing it starts a new quiet interval", async ({ browser }) => {
    const { context, page } = await newPage(browser, MOBILE);
    await injectWarmupCosts(page);
    const requests = recordPanelRequests(page);
    await page.goto("/summary?view=household&month=2026-05");
    await waitUsable(page);
    await page.getByRole("button", { name: "Edit Bills" }).first().click();
    await expect(page.getByText("Edit category")).toBeVisible();
    await page.waitForTimeout(5_000);
    expect(requests).toEqual(["summary"]);
    await page.keyboard.press("Escape");
    await expect(page.getByText("Edit category")).toHaveCount(0);
    await page.waitForTimeout(1_000);
    expect(requests).toEqual(["summary"]);
    await expect.poll(() => requests, { timeout: 10_000 }).toEqual(["summary", "entries"]);
    await context.close();
  });

  test("touch pointer-down on a route link loads its code before the tap navigates", async ({ browser }) => {
    const { context, page } = await newPage(browser, MOBILE);
    await setWarmupMode(page, "intent-only");
    const requests = recordPanelRequests(page);
    await page.goto("/summary?view=household&month=2026-05");
    await waitUsable(page);
    await page.waitForTimeout(3_000);
    expect(requests).toEqual(["summary"], "intent-only: no automatic warmup");
    await page.getByRole("link", { name: "Month", exact: true }).dispatchEvent("pointerdown", { pointerType: "touch", isPrimary: true });
    await expect.poll(() => requests).toEqual(["summary", "month"]);
    await expect(page).toHaveURL(/\/summary\?/);
    await page.getByRole("link", { name: "Month", exact: true }).click();
    await expect(page).toHaveURL(/\/month\?/);
    await waitUsable(page);
    expect(requests.filter((id) => id === "month")).toHaveLength(1);
    await context.close();
  });

  test("save-data blocks speculative code, but navigation still loads the route", async ({ browser }) => {
    const { context, page } = await newPage(browser, MOBILE);
    await injectWarmupCosts(page);
    await page.addInitScript(() => {
      Object.defineProperty(navigator, "connection", {
        configurable: true,
        value: { saveData: true, effectiveType: "4g", addEventListener() {}, removeEventListener() {} }
      });
    });
    const requests = recordPanelRequests(page);
    await page.goto("/summary?view=household&month=2026-05");
    await waitUsable(page);
    await page.getByRole("link", { name: "Month", exact: true }).dispatchEvent("pointerdown", { pointerType: "touch", isPrimary: true });
    await page.waitForTimeout(5_000);
    expect(requests).toEqual(["summary"]);
    await page.getByRole("link", { name: "Entries", exact: true }).click();
    await expect(page.locator(".panel-context")).toContainText("Viewing entries for Household");
    expect(requests).toEqual(["summary", "entries"]);
    await context.close();
  });
});

test.describe("route warmup on desktop", () => {
  test("warms one likely-next route after 1.2 s and never the whole route set", async ({ browser }) => {
    const { context, page } = await newPage(browser, DESKTOP);
    const requests = recordPanelRequests(page);
    await page.goto("/summary?view=household&month=2026-05");
    await waitUsable(page);
    expect(requests).toEqual(["summary"]);
    await expect.poll(() => requests, { timeout: 10_000 }).toEqual(["summary", "entries"]);
    await page.waitForTimeout(8_000);
    expect(requests).toEqual(["summary", "entries"]);
    await context.close();
  });

  test("mouse hover and keyboard focus warm the exact route", async ({ browser }) => {
    const { context, page } = await newPage(browser, DESKTOP);
    await setWarmupMode(page, "intent-only");
    const requests = recordPanelRequests(page);
    await page.goto("/summary?view=household&month=2026-05");
    await waitUsable(page);
    await page.getByRole("link", { name: "Splits", exact: true }).hover();
    await expect.poll(() => requests).toEqual(["summary", "splits"]);

    const monthLink = page.getByRole("link", { name: "Month", exact: true });
    for (let press = 0; press < 40; press += 1) {
      if (await monthLink.evaluate((link) => link === document.activeElement)) break;
      await page.keyboard.press("Tab");
    }
    await expect(monthLink).toBeFocused();
    await expect.poll(() => requests).toEqual(["summary", "splits", "month"]);
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/month\?/);
    await context.close();
  });

  test("a mouse sweeping across the tabs does not warm the routes it passes", async ({ browser }) => {
    const { context, page } = await newPage(browser, DESKTOP);
    await setWarmupMode(page, "intent-only");
    const requests = recordPanelRequests(page);
    await page.goto("/summary?view=household&month=2026-05");
    await waitUsable(page);
    // Pointer events and in-page timers, so the order of "leave" and the
    // 100 ms dwell holds however loaded the machine is.
    const hover = (name, stayMs) => page.evaluate(async ({ name, stayMs }) => {
      const link = [...document.querySelectorAll("a")].find((anchor) => anchor.textContent.trim() === name);
      link.dispatchEvent(new PointerEvent("pointerover", { bubbles: true, pointerType: "mouse" }));
      await new Promise((resolve) => setTimeout(resolve, stayMs));
      link.dispatchEvent(new PointerEvent("pointerout", { bubbles: true, pointerType: "mouse", relatedTarget: document.body }));
    }, { name, stayMs });
    for (const name of ["Month", "Entries", "Splits"]) {
      await hover(name, 50);
    }
    await page.waitForTimeout(1_500);
    expect(requests).toEqual(["summary"]);
    await hover("Splits", 250);
    await expect.poll(() => requests).toEqual(["summary", "splits"]);
    await context.close();
  });

  test("warmup off leaves navigation working", async ({ browser }) => {
    const { context, page } = await newPage(browser, DESKTOP);
    await setWarmupMode(page, "off");
    const requests = recordPanelRequests(page);
    await page.goto("/summary?view=household&month=2026-05");
    await waitUsable(page);
    await page.getByRole("link", { name: "Splits", exact: true }).hover();
    await page.waitForTimeout(4_000);
    expect(requests).toEqual(["summary"]);
    await page.getByRole("link", { name: "Entries", exact: true }).click();
    await expect(page.locator(".panel-context")).toContainText("Viewing entries for Household");
    expect(requests).toEqual(["summary", "entries"]);
    await context.close();
  });
});
