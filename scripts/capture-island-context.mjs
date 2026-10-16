/* global window, document -- browser evaluation callbacks */
// Demo-only phone review captures. Uses an isolated Worker/D1 stack.
// Run with: node scripts/capture-island-context.mjs
import { mkdir, readdir, writeFile } from "node:fs/promises";
import { chromium, expect } from "@playwright/test";
import { prepareStack, shardStack, startStack } from "./e2e-stack.mjs";

const output = "test-results/island-context-review";
const stack = shardStack(1, { portOffset: 1300, logDir: `${output}/logs` });
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
      localStorage.setItem("monies-map:plan-mode", "tables");
    }, { palette, mode });
    const page = await context.newPage();
    await page.clock.setFixedTime(new Date("2025-10-15T02:00:00Z"));
    expect((await page.request.post(`${stack.baseURL}/api/demo/reseed`)).ok()).toBe(true);
    for (let index = 0; index < 14; index += 1) {
      const response = await page.request.post(`${stack.baseURL}/api/entries/create`, { data: {
        date: `2025-10-${String(index + 1).padStart(2, "0")}`, description: `Coffee and groceries ${index + 1}`,
        accountName: "UOB One", categoryName: "Groceries", amountMinor: 1200 + index,
        entryType: "expense", ownershipType: "direct", ownerName: "Tim"
      } });
      expect(response.ok()).toBe(true);
    }
    const entries = "/entries?view=person-tim&month=2025-10&entries_scope=direct_plus_shared";
    const capture = async (name, path, ready = ".mobile-context-sticky-bar", after = null) => {
      await page.goto(`${stack.baseURL}${path}`);
      await expect(page.locator(ready)).toBeVisible();
      await expect.poll(() => page.evaluate(() => window.__MONIES_MAP_ROUTE_WORK__?.usable ?? false)).toBe(true);
      await page.evaluate(() => document.fonts.ready);
      // The island body is lazy and can settle after the page becomes usable.
      if (/entry_(category|search)|^\/month/.test(path)) {
        await expect(page.locator(".mobile-context-line-action")).toBeVisible();
      }
      if (after) await after();
      await page.waitForTimeout(200);
      await page.screenshot({ animations: "disabled", path: `${output}/${palette}-${mode}-${name}.png` });
    };
    await capture("before", entries);
    await capture("category", `${entries}&entry_category=Groceries`);
    await capture("search", `${entries}&entry_search=coffee`);
    await capture("many-filters", `${entries}&entry_search=coffee&entry_category=Groceries&entry_type=expense`);
    await capture("long-search", `${entries}&entry_search=an+especially+long+coffee+search+with+no+matches`);
    await capture("shared-scope", `${entries.replace("direct_plus_shared", "shared")}&entry_category=Groceries`);
    await capture("cleared", `${entries}&entry_category=Groceries`, undefined, async () => {
      await page.getByRole("button", { name: "Clear all filters" }).click();
      await expect(page.locator(".mobile-context-scope")).toHaveText("Direct + Shared");
    });
    await capture("past-month", "/month?view=person-tim&month=2025-08&summary_start=2025-06&summary_end=2025-10&scope=direct_plus_shared");
    await capture("past-month-shared", "/month?view=person-tim&month=2025-08&summary_start=2025-06&summary_end=2025-10&scope=shared");
    await capture("splits-search", "/splits?view=person-tim&month=2025-10&split_group=split-group-none&split_search=coffee", ".splits-strip", async () => {
      await page.evaluate(() => window.scrollTo({ top: document.body.scrollHeight, behavior: "instant" }));
      await expect(page.locator(".splits-group-bar-clear")).toBeVisible();
    });
    await context.close();
  }
  const files = (await readdir(output)).filter((name) => name.endsWith(".png")).sort();
  await writeFile(`${output}/index.html`, `<!doctype html><meta charset="utf-8"><title>Phone island review</title><style>body{font:16px system-ui;margin:24px;background:#eee;color:#222}main{display:flex;gap:20px;flex-wrap:wrap}figure{margin:0;width:300px}img{width:100%;height:auto}figcaption{padding:10px 0}</style><h1>Phone island review</h1><p>390px · demo data · light, dark and 60s Mod. Before, filters, cleared, non-default scope, past month and Splits.</p><main>${files.map((name) => `<figure><a href="${name}"><img src="${name}" loading="lazy"></a><figcaption>${name}</figcaption></figure>`).join("")}</main>`);
  console.log(`Review screenshots: ${output} (30 states across light, dark and 60s Mod)`);
} finally {
  await browser.close();
  await server.stop();
}
