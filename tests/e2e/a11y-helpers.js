import AxeBuilder from "@axe-core/playwright";

// Shared pieces of the accessibility specs (docs/audits/a11y-pass.md).
//
// axe-core runs the WCAG 2.0/2.1/2.2 A and AA rules plus its best-practice
// rules. Two things are set up here so its verdict is trustworthy:
// - the page's body gradient is replaced by its flat --bg while auditing,
//   because axe cannot judge text on a gradient ("incomplete") and the flat
//   colour is the worst case for the gradient;
// - `page-has-heading-one` is off: the app's pages have an h2 title and no
//   h1, which is a site-wide structure decision listed in the audit.

const FLAT_PAGE_BACKGROUND = "body{background:var(--bg) !important}";
const RULES_OFF = ["page-has-heading-one"];

/**
 * Violations axe finds on the page (or inside `include`), one line each:
 * "rule-id: target :: html start :: why". An empty array is a clean page.
 * @param {import("@playwright/test").Page} page
 * @param {{ include?: string, exclude?: string[], disable?: string[] }} [options]
 */
export async function axeViolations(page, { include = undefined, exclude = [], disable = [] } = {}) {
  await page.addStyleTag({ content: FLAT_PAGE_BACKGROUND });
  let builder = new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"])
    .disableRules([...RULES_OFF, ...disable]);
  if (include) builder = builder.include(include);
  for (const selector of exclude) builder = builder.exclude(selector);
  const results = await builder.analyze();
  return results.violations.flatMap((violation) => violation.nodes.map((node) => (
    `${violation.id}: ${node.target.join(" ")} :: ${node.html.slice(0, 90).replace(/\s+/g, " ")} :: ${(node.any[0] ?? node.all[0] ?? node.none[0])?.message ?? ""}`.slice(0, 400)
  )));
}

/**
 * What document.activeElement is, in one readable string ("BODY" when focus
 * is on the page itself, i.e. lost).
 * @param {import("@playwright/test").Page} page
 */
export function activeElementName(page) {
  return page.evaluate(() => {
    const element = document.activeElement;
    if (!element || element === document.body) return "BODY";
    const name = element.getAttribute("aria-label") || element.textContent?.trim().slice(0, 40) || "";
    return `${element.tagName.toLowerCase()}${element.className && typeof element.className === "string" ? `.${element.className.split(" ")[0]}` : ""}:${name}`;
  });
}

/**
 * Focusable elements that are on screen by CSS but covered by something
 * else at their centre, so a keyboard or screen reader reaches a control
 * nobody can see.
 * @param {import("@playwright/test").Page} page
 */
export function coveredFocusables(page) {
  return page.evaluate(() => {
    const selector = "a[href], button:not([disabled]), input:not([type=hidden]):not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])";
    const covered = [];
    for (const element of document.querySelectorAll(selector)) {
      if (element.closest("[inert], [hidden]")) continue;
      const style = getComputedStyle(element);
      if (style.visibility === "hidden" || style.display === "none") continue;
      const rect = element.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) continue;
      const inView = rect.bottom > 0 && rect.top < innerHeight && rect.right > 0 && rect.left < innerWidth;
      if (!inView) continue;
      const hit = document.elementFromPoint(
        Math.min(Math.max(rect.left + rect.width / 2, 0), innerWidth - 1),
        Math.min(Math.max(rect.top + rect.height / 2, 0), innerHeight - 1)
      );
      if (!(hit && (element === hit || element.contains(hit) || hit.contains(element)))) {
        covered.push(`${element.tagName.toLowerCase()}.${String(element.className).split(" ")[0]} ${element.getAttribute("aria-label") || element.textContent.trim().slice(0, 30)}`);
      }
    }
    return covered;
  });
}

/**
 * Waits until nothing on the page is mid-animation (an arriving card fades
 * in; axe would read its half-faded colours).
 * @param {import("@playwright/test").Page} page
 */
export function settleAnimations(page) {
  return page.waitForFunction(() => document.getAnimations().every((animation) => (
    animation.playState === "finished" || animation.playState === "idle" || animation.effect?.getComputedTiming().iterations === Infinity
  )));
}

/**
 * Presses Tab up to `limit` times from the top of the page and reports each
 * stop: what it is, and whether showing keyboard focus on it changes how it
 * looks (the region around it is drawn focused and blurred and compared, so
 * a ring on a wrapper counts and a missing one does not). A stop that is off
 * screen is skipped for the look check. Stops: [{ name, ring }].
 * @param {import("@playwright/test").Page} page
 * @param {{ limit?: number }} [options]
 */
export async function tabStops(page, { limit = 40 } = {}) {
  await page.addStyleTag({ content: "*{caret-color:transparent !important}" });
  // Start from the top: the sequential-focus start point is the body.
  await page.evaluate(() => {
    document.activeElement?.blur?.();
    window.getSelection()?.removeAllRanges();
    document.body.setAttribute("tabindex", "-1");
    document.body.focus();
    document.body.removeAttribute("tabindex");
  });
  const stops = [];
  const seen = new Set();
  for (let index = 0; index < limit; index += 1) {
    await page.keyboard.press("Tab");
    const handle = await page.evaluateHandle(() => document.activeElement);
    const element = handle.asElement();
    const name = await handle.evaluate((node) => {
      if (!node || node === document.body) return "BODY";
      const label = node.getAttribute("aria-label") || node.textContent?.trim().replace(/\s+/g, " ").slice(0, 40) || node.getAttribute("placeholder") || "";
      return `${node.tagName.toLowerCase()}${node.className && typeof node.className === "string" ? `.${node.className.split(" ")[0]}` : ""} "${label}"`;
    });
    if (name === "BODY") break;
    let ring = "skipped";
    const box = element ? await element.boundingBox() : null;
    const viewport = page.viewportSize();
    if (box && viewport && box.width > 0 && box.height > 0 && box.y >= 0 && box.y + box.height <= viewport.height && box.x >= 0 && box.x + box.width <= viewport.width) {
      const pad = 8;
      const x = Math.max(0, box.x - pad);
      const y = Math.max(0, box.y - pad);
      const clip = { x, y, width: Math.min(viewport.width - x, box.width + pad * 2), height: Math.min(viewport.height - y, box.height + pad * 2) };
      const focused = await page.screenshot({ clip, animations: "disabled" });
      await element.evaluate((node) => node.blur());
      const blurred = await page.screenshot({ clip, animations: "disabled" });
      await element.evaluate((node) => node.focus({ preventScroll: true }));
      ring = focused.equals(blurred) ? "none" : "shown";
    }
    const key = `${name}@${Math.round(box?.x ?? 0)},${Math.round(box?.y ?? 0)}`;
    if (seen.has(key)) break;
    seen.add(key);
    stops.push({ name, ring });
  }
  return stops;
}
