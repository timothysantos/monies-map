// node explore.mjs <phone|desktop> <url> <outName> [selector to dump text/classes of]
// Screenshots a real page and optionally prints the structure of a selector.
import path from "node:path";
import { fileURLToPath } from "node:url";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const { chromium, devices, webkit } = await import(`${ROOT}/node_modules/@playwright/test/index.mjs`);
const [device, url, name, selector] = process.argv.slice(2);
const browser = await (device === "phone" ? webkit : chromium).launch();
const context = await browser.newContext(device === "phone"
  ? { ...devices["iPhone 13"], deviceScaleFactor: 2, baseURL: "http://127.0.0.1:5471", locale: "en-SG", timezoneId: "Asia/Singapore" }
  : { viewport: { width: 1280, height: 800 }, baseURL: "http://127.0.0.1:5471", locale: "en-SG", timezoneId: "Asia/Singapore" });
await context.addInitScript(() => window.localStorage.setItem("monies-map:money-totals-visible", "true"));
const page = await context.newPage();
await page.goto(url, { waitUntil: "domcontentloaded" });
await page.waitForFunction(() => window.__MONIES_MAP_ROUTE_WORK__?.usable, null, { timeout: 45000 });
await page.waitForTimeout(1200);
await page.screenshot({ path: path.resolve(path.dirname(fileURLToPath(import.meta.url)), `out/explore-${name}.png`) });
if (selector) {
  const dump = await page.evaluate((sel) => {
    const walk = (el, depth) => {
      if (depth > 6) return "";
      const kids = [...el.children].map((c) => walk(c, depth + 1)).join("");
      const own = [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent.trim()).filter(Boolean).join(" | ");
      return `${"  ".repeat(depth)}<${el.tagName.toLowerCase()} class="${el.className?.baseVal ?? el.className}">${own}\n${kids}`;
    };
    return [...document.querySelectorAll(sel)].slice(0, 3).map((e) => walk(e, 0)).join("\n----\n");
  }, selector);
  console.log(dump);
}
await browser.close();
