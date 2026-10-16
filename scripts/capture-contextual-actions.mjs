/* global window, document -- browser evaluation callbacks */
// Demo-only before/after review of slider safety and contextual phone actions.
import { mkdir, readdir, writeFile } from "node:fs/promises";
import { chromium, expect } from "@playwright/test";
import { prepareStack, shardStack, startStack } from "./e2e-stack.mjs";

const before = process.argv.includes("--before");
const output = "test-results/contextual-actions-review";
const stack = shardStack(1, { portOffset: 1700, logDir: `${output}/logs` });
await mkdir(output, { recursive: true });
await prepareStack(stack);
const server = await startStack(stack);
const browser = await chromium.launch();
try {
  for (const [palette, mode] of [["70s", "light"], ["70s", "dark"], ["60s", "light"]]) {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, reducedMotion: "reduce" });
    await context.addInitScript(({ palette, mode }) => {
      localStorage.setItem("monies-map:palette", palette);
      localStorage.setItem("monies-map:colour-mode", mode);
      localStorage.setItem("monies-map:money-totals-visible", "true");
      localStorage.setItem("monies-map:lead-view", "plan");
      localStorage.setItem("monies-map:plan-mode", "studio");
    }, { palette, mode });
    const page = await context.newPage();
    await page.clock.setFixedTime(new Date("2026-05-15T02:00:00Z"));
    expect((await page.request.post(`${stack.baseURL}/api/demo/reseed`)).ok()).toBe(true);
    expect((await page.request.post(`${stack.baseURL}/api/month-plan/save`, { data: {
      rowId: "context-review-salary", month: "2026-05", sectionKey: "income", categoryName: "Salary", label: "Salary",
      planDate: null, accountName: "", plannedMinor: 600000, note: "", ownershipType: "direct", ownerName: "Tim"
    } })).ok()).toBe(true);
    const open = async (path, ready) => {
      await page.goto(`${stack.baseURL}${path}`);
      await expect(page.locator(ready)).toBeVisible();
      await expect.poll(() => page.evaluate(() => window.__MONIES_MAP_ROUTE_WORK__?.usable ?? false)).toBe(true);
      await page.evaluate(() => document.fonts.ready);
    };
    const capture = async (name) => {
      await page.waitForTimeout(200);
      await page.screenshot({ animations: "disabled", path: `${output}/${palette}-${mode}-${name}-${before ? "before" : "after"}.png` });
    };
    const month = "/month?view=person-tim&month=2026-05&scope=direct_plus_shared";
    await open(month, "[data-plan-studio]");
    const food = page.locator("[data-ps-row]").filter({ has: page.locator(".ps-row-label", { hasText: /^Food$/ }) });
    await food.scrollIntoViewIfNeeded();
    await capture("sliders");
    await food.locator("[data-ps-amount]").click();
    const amount = page.getByRole("textbox", { name: "Planned amount" });
    await amount.fill("1374");
    await amount.press("Enter");
    await expect(food.getByRole("slider")).toHaveAttribute("aria-valuenow", "1374");
    await capture("undo");
    await food.locator("[data-ps-info-button]").tap();
    await expect(page.locator("[data-ps-info]")).toBeVisible();
    await capture("pinned-info");
    await page.keyboard.press("Escape");
    await food.locator("[data-ps-menu-button]").tap();
    await expect(page.locator(".ps-menu")).toBeVisible();
    await capture("row-menu");
    await page.keyboard.press("Escape");
    await page.locator('[data-plan-mode="tables"]').check();
    await page.locator(".month-plan-stack").scrollIntoViewIfNeeded();
    await capture("list");
    await open(month.replace("direct_plus_shared", "direct"), "[data-plan-studio]");
    await capture("non-default-scope");
    await open("/month?view=person-tim&month=2025-09&scope=direct_plus_shared&summary_start=2025-06&summary_end=2026-05", "[data-plan-studio]");
    await expect(page.locator(".mobile-context-line-action.is-month")).toBeVisible();
    await capture("past-month");

    const entries = "/entries?view=person-tim&month=2025-10&entries_scope=direct_plus_shared";
    await open(`${entries}&entry_search=coffee`, ".mobile-context-line-text");
    await page.locator(".mobile-context-line-text").click();
    await expect(page.locator(".mobile-context-dialog .search-filter-input")).toBeVisible();
    if (!before) await expect(page.locator(".mobile-context-dialog .search-filter-input")).toBeFocused();
    await capture("search-focus");
    await open(`${entries}&entry_category=Groceries`, ".mobile-context-line-text");
    await page.locator(".mobile-context-line-text").click();
    if (!before) await expect(page.getByRole("dialog", { name: "By category", exact: true }).locator('[data-category-option="Groceries"]')).toBeVisible();
    else await expect(page.locator(".mobile-context-dialog")).toBeVisible();
    await capture("category-target");
    await context.close();
  }
  const files = (await readdir(output)).filter((name) => name.endsWith(".png")).sort();
  await writeFile(`${output}/index.html`, `<!doctype html><meta charset="utf-8"><title>Contextual phone actions</title><style>body{font:16px system-ui;margin:24px;background:#eee;color:#222}main{display:flex;gap:20px;flex-wrap:wrap}figure{margin:0;width:300px}img{width:100%;height:auto}figcaption{padding:10px 0}</style><h1>Contextual phone actions</h1><p>390px · demo data · before and after · 70s light/dark and 60s Mod.</p><main>${files.map((name) => `<figure><a href="${name}"><img src="${name}" loading="lazy"></a><figcaption>${name}</figcaption></figure>`).join("")}</main>`);
  console.log(`Review: ${output}/index.html (${files.length} captures)`);
} finally {
  await browser.close();
  await server.stop();
}
