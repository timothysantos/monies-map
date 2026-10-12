// node run.mjs <scenarios.mjs> [name filter...]
// Renders each scenario's BEFORE (the real app) and AFTER (CSS/DOM injected
// with the app's own tokens and lsd- blocks) and saves PNGs to ./out.
import { readFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const { chromium, devices, webkit } = await import(`${ROOT}/node_modules/@playwright/test/index.mjs`);
const BASE = "http://127.0.0.1:5471";
const OUT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "out");
const [scenarioFile, ...filters] = process.argv.slice(2);
const { scenarios } = await import(path.resolve(scenarioFile));
const lsdCss = await readFile(`${ROOT}/src/client/ui/lead-support-detail.css`, "utf8");
const kitJs = await readFile(path.resolve(path.dirname(new URL(import.meta.url).pathname), "kit.js"), "utf8");
const mockCss = await readFile(path.resolve(path.dirname(new URL(import.meta.url).pathname), "mock.css"), "utf8");
await mkdir(OUT, { recursive: true });

export async function waitUsable(page) {
  await page.waitForFunction(() => window.__MONIES_MAP_ROUTE_WORK__?.usable, null, { timeout: 45000 });
  await page.waitForTimeout(1000);
}

const browsers = {};
async function contextFor(device, hidden) {
  browsers[device] ??= await (device === "phone" ? webkit : chromium).launch();
  const context = await browsers[device].newContext(device === "phone"
    ? { ...devices["iPhone 13"], deviceScaleFactor: 2, baseURL: BASE, locale: "en-SG", timezoneId: "Asia/Singapore" }
    : { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1, baseURL: BASE, locale: "en-SG", timezoneId: "Asia/Singapore" });
  await context.addInitScript((visible) => {
    window.localStorage.setItem("monies-map:money-totals-visible", visible ? "true" : "false");
  }, !hidden);
  return context;
}

const helpers = {
  waitUsable,
  async open(page, url) {
    await page.goto(url, { waitUntil: "domcontentloaded" });
    await waitUsable(page);
    await page.addStyleTag({ content: "*{caret-color:transparent !important} ::-webkit-scrollbar{display:none}" });
  },
  async scrollTo(page, selector, offset = 0) {
    await page.locator(selector).first().evaluate((el, top) => {
      const rect = el.getBoundingClientRect();
      window.scrollTo({ top: Math.max(0, window.scrollY + rect.top - top), behavior: "instant" });
    }, offset);
    await page.waitForTimeout(400);
  },
  async scrollY(page, y) {
    await page.evaluate((top) => window.scrollTo({ top, behavior: "instant" }), y);
    await page.waitForTimeout(400);
  },
  // The lsd- blocks' stylesheet, verbatim from the app, plus mock CSS.
  async inject(page, css, build) {
    await page.addStyleTag({ content: lsdCss });
    await page.addStyleTag({ content: mockCss });
    await page.addScriptTag({ content: kitJs });
    if (css) await page.addStyleTag({ content: css });
    if (build) await page.evaluate(build.fn ?? build, build.arg);
    await page.waitForTimeout(350);
  }
};

// The app's small round floating buttons (privacy eye, Add entry/expense, Ask
// dock) sit over the right edge of whatever scrolls under them, so they hide
// the first screen's rows in a still picture. They stay exactly as today in the
// app; the pictures hide them so BEFORE and AFTER compare like for like.
async function calmFloaters(page) {
  await page.evaluate(() => {
    for (const el of document.querySelectorAll("body *")) {
      const cs = getComputedStyle(el);
      if (cs.position !== "fixed" || el.classList.contains("mk-float-bar") || el.classList.contains("mk-sticky-bar")) continue;
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.width <= 110 && r.height <= 110 && r.right > innerWidth - 40 && r.top > 120 && !el.closest("nav,.mk-sheet")) {
        el.style.setProperty("display", "none", "important");
      }
    }
  });
  await page.waitForTimeout(150);
}

const failures = [];
for (const scenario of scenarios) {
  if (filters.length && !filters.some((f) => scenario.name.includes(f))) continue;
  const context = await contextFor(scenario.device, scenario.hidden);
  const page = await context.newPage();
  try {
    await scenario.run(page, helpers, async (suffix, opts = {}) => {
      if (scenario.device === "phone" && !opts.keepFloaters) await calmFloaters(page);
      const file = path.join(OUT, `${scenario.name}-${suffix}.png`);
      await page.screenshot({ path: file, fullPage: Boolean(opts.fullPage) });
      console.log(file);
    });
  } catch (error) {
    failures.push(scenario.name);
    console.error(`FAILED ${scenario.name}: ${error.message.split("\n").slice(0, 3).join(" | ")}`);
    await page.screenshot({ path: path.join(OUT, `${scenario.name}-FAILED.png`) }).catch(() => {});
  } finally {
    await context.close();
  }
}
await Promise.all(Object.values(browsers).map((b) => b.close()));
if (failures.length) { console.error("failed:", failures.join(", ")); process.exitCode = 1; }
