import { expect, test } from "@playwright/test";

import { postJson, reseedDemo } from "./helpers";

// U11 (UI audit): on a phone every tappable is at least 44 x 44 px
// (design.md). A control may be smaller to look at if it carries a hit area,
// so this measures what a finger reaches: from the control's centre it walks
// outward while the point still lands on the control (or something inside it)
// and sums both directions. A hit area clipped by a parent or covered by a
// neighbour measures short, which is the failure we want to catch.
//
// Scope: the controls the audit named as unowned (period segments, date
// refresh buttons, table sort buttons, "See all insights", note triggers,
// icon edit and delete, Settings selects) and their siblings on the same
// screens. The month plan rows' category icon and actual-amount links are
// not measured here: summary-month-lsd redesigns those rows.

const PHONE = { width: 390, height: 844 };
const MIN = 44;
const GAP = 8;

// Selectors per screen. Each screen needs at least one of its `required`
// selectors to match, so the check cannot pass by finding nothing.
const SCREENS = [
  {
    name: "Summary",
    path: "/summary?view=person-tim&month=2026-05",
    required: [".period-range-segment"],
    optional: [
      ".financial-insight-fold", ".financial-insight-toggle", ".summary-mix-arrow", ".summary-mix-main", ".summary-mix-more", ".summary-wallet-row", ".summary-note-trigger",
      ".checkin-action", ".summary-chevron"
    ],
    // The month-by-month section and its chart load beside the first screen
    // and arrive a moment later, pushing the accounts under them about
    // 2,400 px down on a phone: measured before they land, a wallet row's
    // place is stale and the point falls on the chart.
    prepare: async (page) => {
      await page.locator(".summary-intent-month, .earned-spent-row").first().waitFor({ state: "visible", timeout: 30_000 });
      await page.locator("[data-earned-spent-chart]").waitFor({ state: "attached", timeout: 30_000 });
    }
  },
  {
    name: "Month",
    path: "/month?view=person-tim&month=2026-05",
    required: [".period-range-segment", ".table-sort-button"],
    optional: [
      ".month-actions-trigger", ".month-plan-summary-toggle", ".note-trigger",
      ".note-card-actions .subtle-action", ".financial-insight-fold", ".financial-insight-toggle", ".checkin-action"
    ]
  },
  {
    name: "Entries",
    path: "/entries?view=person-tim&month=2026-05",
    required: [".entries-date-refresh-button", ".entries-totals-rows .lsd-row"],
    optional: [".period-range-segment", ".financial-insight-toggle"]
  },
  {
    name: "Splits",
    path: "/splits?view=person-tim&month=2026-05",
    required: [".context-block .pill:not(.pill-disabled)", ".split-date-refresh-button"],
    optional: [".split-matches-link", ".panel-splits .dialog-primary", ".search-filter-input", ".summary-chevron", ".checkin-action"]
  },
  {
    // The Edit entry sheet of an expense not on Splits: the Splits row and,
    // on its own line under it, the quick add ("Add to <group> · Half each").
    name: "Edit entry sheet",
    setup: async (page) => {
      const { entryId } = await postJson(page, "/api/entries/create", {
        date: "2026-05-24", description: `Tap target quick add ${Date.now()}`, accountName: "UOB One", categoryName: "Groceries",
        amountMinor: 2550, entryType: "expense", ownershipType: "direct", ownerName: "Tim"
      });
      return `/entries?view=person-tim&month=2026-05&editing_entry=${entryId}`;
    },
    required: [".entry-split-quick-action", ".entry-split-action-row .lsd-row"],
    optional: [],
    apart: [[".entry-split-action-row .lsd-row", ".entry-split-quick-action"]],
    // The page behind a sheet does not scroll: the quick add is brought into
    // the sheet's own scroll view first.
    prepare: async (page) => {
      await page.locator(".entry-split-quick-action").evaluate((element) => element.scrollIntoView({ block: "center", behavior: "instant" }));
    }
  },
  {
    name: "Imports",
    path: "/imports?view=person-tim&month=2026-05",
    required: [".context-block .pill:not(.pill-disabled)"],
    optional: ["details > summary", "button.subtle-action"]
  },
  {
    name: "Settings",
    path: "/settings?view=person-tim&month=2026-05",
    required: [".settings-account-actions .icon-action", "select.lsd-row-native"],
    optional: ["button.subtle-action"],
    ready: ".settings-section-toggle",
    prepare: async (page) => {
      const closed = page.locator(".settings-section-toggle[aria-expanded='false']");
      while ((await closed.count()) > 0) {
        await closed.first().click();
      }
    }
  }
];

// Runs in the page: how far a finger can land on `el`, in CSS px.
async function measureHitArea(el) {
  // Scroll the page only (never a control's own horizontal strip), without
  // the page's smooth scrolling, and settle twice: rows below the fold change
  // height as they are rendered.
  const nextFrame = () => new Promise((resolve) => requestAnimationFrame(() => resolve()));
  // A control off to the side of a swipeable row is brought on screen first
  // (centred in its row); one already on screen is left where it rests.
  const first = el.getBoundingClientRect();
  if (first.left < 0 || first.right > window.innerWidth) {
    el.scrollIntoView({ block: "nearest", inline: "center", behavior: "instant" });
    await nextFrame();
  }
  for (let pass = 0; pass < 3; pass += 1) {
    const before = el.getBoundingClientRect();
    window.scrollBy({ top: before.top + before.height / 2 - window.innerHeight / 2, behavior: "instant" });
    await nextFrame();
  }
  const rect = el.getBoundingClientRect();
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;
  const lands = (x, y) => {
    if (x < 0 || y < 0 || x >= window.innerWidth || y >= window.innerHeight) return false;
    const hit = document.elementFromPoint(x, y);
    return Boolean(hit && (hit === el || el.contains(hit)));
  };
  if (!lands(cx, cy)) {
    const cover = document.elementFromPoint(Math.min(Math.max(cx, 0), window.innerWidth - 1), Math.min(Math.max(cy, 0), window.innerHeight - 1));
    return { width: 0, height: 0, covered: true, box: `${Math.round(rect.left)},${Math.round(rect.top)}`, coveredBy: cover ? `${cover.tagName.toLowerCase()}.${String(cover.className).split(" ")[0]}` : "nothing" };
  }
  const reach = (dx, dy) => {
    let steps = 0;
    while (steps < 80 && lands(cx + dx * (steps + 1), cy + dy * (steps + 1))) steps += 1;
    return steps;
  };
  return {
    box: `${Math.round(rect.left)},${Math.round(rect.top)} ${Math.round(rect.width)}x${Math.round(rect.height)}; left ${reach(-1, 0)} right ${reach(1, 0)} up ${reach(0, -1)} down ${reach(0, 1)}`,
    width: reach(-1, 0) + reach(1, 0) + 1,
    height: reach(0, -1) + reach(0, 1) + 1,
    covered: false
  };
}

async function measureAll(page, selector) {
  const handles = await page.locator(selector).elementHandles();
  const results = [];
  for (const handle of handles) {
    if (!(await handle.isVisible())) continue;
    if (await handle.evaluate((el) => el.matches(":disabled"))) continue;
    const label = await handle.evaluate((el) => (el.getAttribute("aria-label") || el.textContent || el.className || "").trim().replace(/\s+/g, " ").slice(0, 40));
    const area = await handle.evaluate(measureHitArea);
    results.push({ label, ...area });
  }
  return results;
}

test.describe("phone tap targets", () => {
  // Hit areas are measured at rest: the charts' first-view motion is off, as
  // it is for anyone who asks for reduced motion (design.md "Motion"), so
  // nothing mid-animation is measured.
  test.use({ reducedMotion: "reduce" });

  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => window.localStorage.setItem("monies-map:money-totals-visible", "true"));
    await page.setViewportSize(PHONE);
    await reseedDemo(page);
  });

  for (const screen of SCREENS) {
    test(`${screen.name}: every named control reaches ${MIN} x ${MIN} px`, async ({ page }) => {
      await page.goto(screen.setup ? await screen.setup(page) : screen.path);
      await page.locator(screen.ready ?? screen.required.join(", ")).first().waitFor({ state: "visible", timeout: 60_000 });
      await screen.prepare?.(page);

      const failures = [];
      let measured = 0;
      for (const selector of [...screen.required, ...screen.optional]) {
        const results = await measureAll(page, selector);
        if (screen.required.includes(selector)) {
          expect(results.length, `${screen.name}: nothing matched ${selector}`).toBeGreaterThan(0);
        }
        for (const result of results) {
          measured += 1;
          if (result.width < MIN || result.height < MIN) {
            failures.push(`${selector} "${result.label}" reaches ${result.width} x ${result.height} [${result.box}]${result.covered ? ` (covered by ${result.coveredBy})` : ""}`);
          }
        }
      }
      // Neighbours a screen names keep 8 px clear of each other, so a finger
      // aimed at one never lands on the other.
      for (const [first, second] of screen.apart ?? []) {
        const [a, b] = [await page.locator(first).first().boundingBox(), await page.locator(second).first().boundingBox()];
        const gap = Math.max(a.x - (b.x + b.width), b.x - (a.x + a.width), a.y - (b.y + b.height), b.y - (a.y + a.height));
        if (gap < GAP) failures.push(`${first} and ${second} are ${gap.toFixed(1)} px apart`);
      }
      expect(measured).toBeGreaterThan(0);
      expect(failures).toEqual([]);
    });
  }

  // The measure itself must be able to fail: a control with no hit area is
  // reported short, so the checks above are not vacuous.
  test("the measure reports a small control as short", async ({ page }) => {
    await page.goto("/summary?view=person-tim&month=2026-05");
    await page.locator(".period-range-segment").first().waitFor({ state: "visible", timeout: 60_000 });
    await page.addStyleTag({ content: ".period-range-segment::before { display: none !important; }" });
    const [result] = await measureAll(page, ".period-range-segment");
    expect(result.height).toBeLessThan(MIN);
  });
});
