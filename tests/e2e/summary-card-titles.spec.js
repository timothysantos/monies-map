import { expect, test } from "@playwright/test";

import { postJson, reseedDemo } from "./helpers";

// Summary card titles (design.md "Summary card titles"): every visible card,
// on a desktop and a phone, has its title in the one shared style and one
// quiet subtitle line under it, the same computed sizes on every card; a tile
// and the sheet or dialog it opens show the same title; the Arrange cards
// editor names the same cards the same way.

const now = new Date();
const monthsAgo = (back) => {
  const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - back, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
};

async function addCharges(page) {
  for (let back = 4; back >= 1; back -= 1) {
    await postJson(page, "/api/entries/create", {
      date: `${monthsAgo(back)}-14`, description: "NETFLIX.COM 866-579-7172", accountName: "Citi Rewards", categoryName: "Subscriptions MO",
      entryType: "expense", ownershipType: "direct", ownerName: "Joyce", amountMinor: 1998
    });
  }
  await postJson(page, "/api/entries/create", {
    date: `${monthsAgo(1)}-20`, description: "ANNUAL FEE CITI REWARDS", accountName: "Citi Rewards", categoryName: "Fees",
    entryType: "expense", ownershipType: "direct", ownerName: "Joyce", amountMinor: 19260
  });
}

async function openSummary(page, lead = "plan") {
  await page.addInitScript((view) => {
    window.localStorage.setItem("monies-map:money-totals-visible", "true");
    window.localStorage.setItem("monies-map:lead-view", view);
  }, lead);
  await page.goto("/?view=household");
  await expect(page.locator(".summary-cards-arrange button")).toBeVisible({ timeout: 30_000 });
  await expect(page.locator(".summary-tiles .summary-tile").first()).toBeVisible({ timeout: 30_000 });
  // Lazy cards load as they come into view: walk down the page.
  await page.evaluate(async () => {
    for (let y = 0; y < document.body.scrollHeight; y += 400) {
      window.scrollTo(0, y);
      await new Promise((resolve) => setTimeout(resolve, 120));
    }
  });
  await page.waitForTimeout(1200);
}

// Each drawn card's title and subtitle: text, computed sizes and where the
// subtitle sits against the title.
const readHeads = (page) => page.evaluate(() => {
  const read = (card, title, sub) => {
    const t = title && getComputedStyle(title);
    const s = sub && getComputedStyle(sub);
    const tb = title?.getBoundingClientRect();
    const sb = sub?.getBoundingClientRect();
    return {
      id: card.dataset.summaryCard,
      title: title?.textContent.trim() ?? null,
      sub: sub?.textContent.trim() ?? null,
      titleSize: t?.fontSize ?? null,
      titleWeight: t?.fontWeight ?? null,
      subSize: s?.fontSize ?? null,
      subColour: s?.color ?? null,
      subUnderTitle: Boolean(tb && sb && sb.top >= tb.bottom - 1 && Math.abs(sb.left - tb.left) < 2),
      subLines: sb && s ? Math.round(sb.height / Number.parseFloat(s.lineHeight)) : null
    };
  };
  return [...document.querySelectorAll("[data-summary-card]")].flatMap((card) => {
    const isTile = card.classList.contains("summary-tile-cell");
    const title = card.querySelector(isTile ? ".summary-tile-title" : ".summary-card-title");
    const sub = card.querySelector(isTile ? ".summary-tile-label" : ".summary-card-sub");
    // A card with no body (nothing to show) takes no place.
    return title || sub ? [read(card, title, sub)] : [];
  });
});

const EXPECTED = {
  insights: ["Money insights", "Needs a look, and went well"],
  plan: ["Plan vs actual", /^By month, \w{3} \d{4} to \w{3} \d{4}$/],
  changed: ["What changed", /^\w+ so far, against the same days of \w+$/],
  mix: ["Spending mix", /^By category, \w{3} \d{4} to \w{3} \d{4}$/],
  subs: ["Subscriptions and bills", "A month"],
  coming: ["Coming up", "Next 30 days"],
  investments: ["Investments", "On the latest statements"],
  miles: ["Miles and cashback", "This month, estimate"],
  taxreliefs: ["Tax reliefs", /^For \d{4}$/],
  bankfees: ["Bank fees", "This year"],
  accounts: ["Accounts", "Balances on the latest statements"]
};

function expectUniform(heads) {
  expect(heads.length).toBeGreaterThanOrEqual(8);
  for (const head of heads) {
    const [title, sub] = EXPECTED[head.id] ?? [head.title, head.sub];
    expect(head.title, `${head.id} title`).toBe(title);
    if (sub instanceof RegExp) expect(head.sub, `${head.id} subtitle`).toMatch(sub);
    else expect(head.sub, `${head.id} subtitle`).toBe(sub);
    expect(head.subUnderTitle || head.id === "insights", `${head.id} subtitle sits under its title`).toBe(true);
    expect(head.subLines, `${head.id} subtitle is one line`).toBe(1);
    expect(Number.parseFloat(head.subSize), `${head.id} subtitle size`).toBeGreaterThanOrEqual(12);
  }
  // The same computed style on every card (a tile has its own box but the same sizes).
  expect(new Set(heads.map((head) => head.titleSize)).size, `title sizes ${JSON.stringify(heads.map((head) => [head.id, head.titleSize]))}`).toBe(1);
  expect(new Set(heads.map((head) => head.titleWeight)).size, "title weights").toBe(1);
  expect(new Set(heads.map((head) => head.subSize)).size, `subtitle sizes ${JSON.stringify(heads.map((head) => [head.id, head.subSize]))}`).toBe(1);
  expect(new Set(heads.map((head) => head.subColour)).size, "subtitle colours").toBe(1);
}

for (const [name, size] of [["1440", { width: 1440, height: 900 }], ["390", { width: 390, height: 844 }]]) {
  test.describe(`Summary card titles at ${name}`, () => {
    test.beforeEach(async ({ page }) => {
      await reseedDemo(page);
      await addCharges(page);
      await page.setViewportSize(size);
    });

    test("every visible card has the shared title and one subtitle line under it (Plan)", async ({ page }) => {
      await openSummary(page, "plan");
      const heads = await readHeads(page);
      expect(heads.map((head) => head.id)).toEqual(expect.arrayContaining(["insights", "plan", "mix", "subs", "coming", "bankfees", "accounts"]));
      expectUniform(heads);
    });

    test("Simple names the month card Earned vs spent, by month", async ({ page }) => {
      await openSummary(page, "simple");
      const heads = await readHeads(page);
      const plan = heads.find((head) => head.id === "plan");
      expect(plan.title).toBe("Earned vs spent");
      expect(plan.sub).toMatch(/^By month, \w{3} \d{4} to \w{3} \d{4}$/);
      expect(plan.titleSize).toBe(heads.find((head) => head.id === "mix").titleSize);
    });

    test("a tile and the sheet it opens show the same title and subtitle, and Arrange cards names the card the same way", async ({ page }) => {
      await openSummary(page, "plan");
      // The demo household has no investment statements or tax reliefs, so those two tiles are checked on the showcase data (docs screenshots).
      for (const id of ["bankfees", "coming", "miles"]) {
        const tile = page.locator(`[data-tile="${id}"]`);
        await tile.scrollIntoViewIfNeeded();
        const tileTitle = (await tile.locator(".summary-tile-title").textContent()).trim();
        const tileSub = (await tile.locator(".summary-tile-label").textContent()).trim();
        expect(tileTitle).toBe(EXPECTED[id][0]);
        await tile.click();
        const dialog = page.getByRole("dialog", { name: tileTitle, exact: true });
        await expect(dialog).toBeVisible();
        await expect(dialog.locator(".summary-card-title").first()).toHaveText(tileTitle);
        await expect(dialog.locator(".summary-card-sub").first()).toHaveText(tileSub);
        await expect(dialog).toHaveAccessibleDescription(tileSub);
        await page.keyboard.press("Escape");
        await expect(dialog).toBeHidden();
      }
      await page.getByRole("button", { name: /^(Arrange|Edit) cards$/ }).click();
      const editor = page.getByRole("dialog");
      for (const [id, [title, sub]] of Object.entries(EXPECTED)) {
        const row = editor.locator(`[data-card="${id}"]`);
        if (!(await row.count())) continue;
        await expect(row.locator("strong")).toHaveText(title);
        // Rows show the subtitle without live words (the editor has no data).
        const about = (await row.locator(".summary-cards-name span").textContent()).trim();
        expect(about.length).toBeGreaterThan(0);
        if (typeof sub === "string") expect(about).toBe(sub);
      }
    });
  });
}
