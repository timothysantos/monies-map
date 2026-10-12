import { expect, test } from "@playwright/test";

import { loadEntriesPage, postJson, reseedDemo } from "./helpers";

// The Entries screen in the Lead · Support · Detail language (design.md,
// "Entries top" and "Entries list"; the owner-approved round-2 mock-ups).
// - Totals: "Spent · month" as the lead in plain ink with Income,
//   Difference, Transfers and Outflow as four pills, and on a phone two
//   Detail rows (Spending by category, Filters). The old strip clipped at
//   390 and 1024 px; nothing here may.
// - Rows and day headers: quiet category above the merchant, the wallet as
//   a quiet line, the amount right-aligned, the day as a hairline divider
//   with the daily net. The person's colour edge stays.
// - The inline editor (wide screen): no Detail row repeats a lead chip, so
//   the date, wallet and owner chips edit their own field, as the Splits
//   inline card does. A certified entry keeps its locked chips.

const MONTH = "2026-05";
const INK = {
  in: "rgb(76, 94, 26)",
  short: "rgb(151, 50, 35)",
  text: "rgb(59, 42, 31)",
  muted: "rgb(110, 95, 84)"
};
const TRANSPARENT = "rgba(0, 0, 0, 0)";
const PHONE = { width: 390, height: 664 };

async function setUp(page, { hidden = false, width = 1280, height = 800 } = {}) {
  await page.addInitScript((value) => window.localStorage.setItem("monies-map:money-totals-visible", value), hidden ? "false" : "true");
  await page.setViewportSize({ width, height });
  await reseedDemo(page);
}

async function openEntries(page, { view = "person-tim", month = MONTH } = {}) {
  await page.goto(`/entries?view=${view}&month=${month}`);
  await expect(page.locator(".entries-totals")).toBeVisible({ timeout: 60_000 });
  await expect(page.locator(".entry-row").first()).toBeVisible();
}

function looks(locator) {
  return locator.evaluate((element) => {
    const style = getComputedStyle(element);
    return { color: style.color, background: style.backgroundColor };
  });
}

function box(locator) {
  return locator.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height, bottom: rect.bottom, right: rect.right };
  });
}

// Everything inside the totals block stays inside the viewport and inside
// its own box (nothing scrolls sideways or is cut off), and the page itself
// does not scroll sideways.
function clipReport(page) {
  return page.evaluate(() => {
    const viewport = document.documentElement.clientWidth;
    const report = { pageOverflow: document.documentElement.scrollWidth - viewport, outside: [], clipped: [] };
    const scope = document.querySelector(".entries-totals");
    for (const element of [scope, ...scope.querySelectorAll("*")]) {
      const rect = element.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) continue;
      const name = `${element.tagName.toLowerCase()}.${String(element.className).split(" ")[0]} "${(element.textContent ?? "").trim().slice(0, 24)}"`;
      if (rect.left < -0.5 || rect.right > viewport + 0.5) report.outside.push(name);
      if (element.clientWidth > 0 && element.scrollWidth > element.clientWidth + 1) report.clipped.push(`${name} ${element.scrollWidth}>${element.clientWidth}`);
    }
    return report;
  });
}

test.describe("Entries totals: the lead and four pills", () => {
  test("Spent is the lead in plain ink with the strip's figures as pills (Tim, May)", async ({ page }) => {
    await setUp(page);
    await openEntries(page);
    const totals = page.locator(".entries-totals");

    // The sideways strip and its inline Add entry button are gone.
    await expect(page.locator(".entries-totals-strip")).toHaveCount(0);
    await expect(totals.getByRole("button", { name: "+ Add entry" })).toHaveCount(0);

    const lead = totals.locator(".lsd-card");
    await expect(lead.locator(".lsd-eyebrow")).toHaveText("Spent · May 2026");
    await expect(lead.locator(".lsd-amount")).toHaveText("$4,371.67");
    expect((await looks(lead.locator(".lsd-amount"))).color).toBe(INK.text);

    const pills = totals.locator(".entries-totals-pill");
    await expect(pills.locator(".entries-totals-label")).toHaveText(["Income", "Difference", "Transfers", "Outflow"]);
    await expect(pills.locator("strong")).toHaveText(["$0.00", "-$4,371.67", "$931.50", "$5,303.17"]);
    // A deficit is the one tinted pill here: rose ink on a soft fill. No
    // income is plain; transfers and outflow stay plain ink.
    const difference = pills.nth(1);
    expect((await looks(difference.locator("strong"))).color).toBe(INK.short);
    expect((await looks(difference)).background).not.toBe(TRANSPARENT);
    for (const index of [0, 2, 3]) {
      expect((await looks(pills.nth(index).locator("strong"))).color, `pill ${index}`).toBe(INK.text);
    }

    // The same figures in the household and Joyce's views.
    await openEntries(page, { view: "household" });
    await expect(totals.locator(".lsd-amount")).toHaveText("$5,596.66");
    await expect(pills.locator("strong")).toHaveText(["$0.00", "-$5,596.66", "$931.50", "$6,528.16"]);
    await openEntries(page, { view: "person-joyce" });
    await expect(totals.locator(".lsd-amount")).toHaveText("$1,224.99");
    await expect(pills.locator("strong")).toHaveText(["$0.00", "-$1,224.99", "$0.00", "$1,224.99"]);
  });

  test("income and a surplus are mint pills; spend and outflow stay plain", async ({ page }) => {
    await setUp(page);
    // $10,000 of income turns Tim's May from a deficit into a surplus.
    await postJson(page, "/api/entries/create", {
      date: `${MONTH}-26`, description: "Totals bonus", accountName: "UOB One", categoryName: "Salary",
      amountMinor: 1_000_000, entryType: "income", ownershipType: "direct", ownerName: "Tim"
    });
    await openEntries(page);
    const pills = page.locator(".entries-totals-pill");
    await expect(pills.locator("strong")).toHaveText(["$10,000.00", "$5,628.33", "$931.50", "$5,303.17"]);
    for (const index of [0, 1]) {
      expect((await looks(pills.nth(index).locator("strong"))).color, `pill ${index}`).toBe(INK.in);
      expect((await looks(pills.nth(index))).background, `pill ${index}`).not.toBe(TRANSPARENT);
    }
    expect((await looks(page.locator(".entries-totals .lsd-amount"))).color).toBe(INK.text);
    expect((await looks(pills.nth(3).locator("strong"))).color).toBe(INK.text);
  });

  test("hidden money shows dots, no tint and no sign", async ({ page }) => {
    await setUp(page, { hidden: true });
    await openEntries(page, { month: "2026-04" });
    const totals = page.locator(".entries-totals");
    await expect(totals.locator(".lsd-amount")).toHaveText("••••");
    await expect(totals.locator(".entries-totals-pill strong")).toHaveText(["••••", "••••", "••••", "••••"]);
    expect(await totals.innerText()).not.toMatch(/[-−]\s?••••|\$\d/);
    for (const pill of await totals.locator(".entries-totals-pill").all()) {
      const surface = (await looks(pill)).background.match(/[\d.]+/g).slice(0, 3).map(Number);
      // No mint or rose tint: the palette's cream neutral, or nothing.
      const neutral = (await page.evaluate(() => {
        const probe = document.createElement("span");
        probe.style.color = "var(--pastel-neutral)";
        document.body.append(probe);
        const colour = getComputedStyle(probe).color;
        probe.remove();
        return colour;
      })).match(/[\d.]+/g).slice(0, 3).map(Number);
      surface.forEach((channel, index) => expect(Math.abs(channel - neutral[index])).toBeLessThan(3));
      expect((await looks(pill.locator("strong"))).color).toBe(INK.text);
    }
  });

  for (const width of [390, 1024, 1280]) {
    test(`nothing is cut off or scrolls sideways at ${width} px`, async ({ page }) => {
      await setUp(page, { width, height: width === 390 ? PHONE.height : 800 });
      await openEntries(page, { view: "household" });
      const report = await clipReport(page);
      expect(report.pageOverflow).toBeLessThanOrEqual(0);
      expect(report.outside).toEqual([]);
      expect(report.clipped).toEqual([]);

      // Every pill and the lead are whole boxes inside the block.
      const [blockBox, leadBox] = await Promise.all([box(page.locator(".entries-totals")), box(page.locator(".entries-totals .lsd-card"))]);
      expect(leadBox.right).toBeLessThanOrEqual(blockBox.right + 0.5);
      for (const pill of await page.locator(".entries-totals-pill").all()) {
        const pillBox = await box(pill);
        expect(pillBox.right).toBeLessThanOrEqual(blockBox.right + 0.5);
        // One line for the label and one for the figure.
        expect(pillBox.height).toBeLessThan(86);
      }
      // The round add button is a circle, not a wrapped tile.
      const fab = await box(page.locator(".entries-fab"));
      expect(Math.abs(fab.width - fab.height)).toBeLessThan(2);
    });
  }

  test("at 1024 px the search keeps room to read what is typed and Reset filters is one line", async ({ page }) => {
    await setUp(page, { width: 1024, height: 800 });
    await openEntries(page);
    const field = page.locator(".entries-filter-bar .search-filter-input");
    const room = await field.evaluate((input) => {
      const style = getComputedStyle(input);
      return input.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
    });
    expect(room).toBeGreaterThanOrEqual(150);
    const reset = await box(page.getByRole("button", { name: "Reset filters" }));
    expect(reset.height).toBeLessThan(44);
    const bar = await box(page.locator(".entries-filter-bar"));
    expect(bar.right).toBeLessThanOrEqual(1024);
    // Two rows here: the search on its own row, then the three filters.
    expect(bar.height).toBeLessThan(190);
  });
});

test.describe("Entries totals on a phone", () => {
  test("two Detail rows open the category breakdown and the View and scope sheet", async ({ page }) => {
    await setUp(page, { width: PHONE.width, height: PHONE.height });
    await openEntries(page);
    const rows = page.locator(".entries-totals .lsd-rows");
    await expect(rows.locator(".lsd-row-label")).toHaveText(["Spending by category", "Filters"]);
    await expect(rows.locator("[data-row='filters'] .lsd-row-value")).toHaveText("All entries");

    const breakdown = rows.getByRole("button", { name: "Spending by category" });
    await expect(breakdown).toHaveAttribute("aria-expanded", "false");
    await expect(page.locator(".entries-breakdown-panel")).toHaveCount(0);
    await breakdown.click();
    await expect(breakdown).toHaveAttribute("aria-expanded", "true");
    await expect(page.locator(".entries-breakdown-panel")).toBeVisible();
    await breakdown.click();
    await expect(page.locator(".entries-breakdown-panel")).toHaveCount(0);

    await rows.getByRole("button", { name: /^Filters/ }).click();
    const sheet = page.getByRole("dialog", { name: "View and scope" });
    await expect(sheet).toBeVisible();
    await expect(sheet.getByLabel("Search")).toBeVisible();
    // A filter shows in the row once it is set.
    await sheet.getByLabel("Search").fill("grab");
    await sheet.getByRole("button", { name: "Done" }).click();
    await expect(sheet).toHaveCount(0);
    await expect(rows.locator("[data-row='filters'] .lsd-row-value")).toHaveText("1 filter on");
  });

  test("a wide screen keeps the breakdown row but no Filters row (the filter bar is on the page)", async ({ page }) => {
    await setUp(page);
    await openEntries(page);
    await expect(page.locator(".entries-totals .lsd-rows .lsd-row-label")).toHaveText(["Spending by category"]);
    await expect(page.locator(".entries-filter-bar")).toBeVisible();
  });
});

test.describe("Entries rows and day headers", () => {
  test("wide: a quiet category over the merchant, no empty note line, the person's edge kept", async ({ page }) => {
    await setUp(page);
    await openEntries(page, { view: "household" });
    const rows = page.locator(".entry-row:not(.is-editing)");

    const row = rows.first();
    const category = row.locator(".entry-row-category-label strong");
    const merchant = row.locator(".entry-row-description > strong");
    expect((await looks(category)).color).toBe(INK.muted);
    const [categoryStyle, merchantStyle] = await Promise.all([
      category.evaluate((element) => ({ size: parseFloat(getComputedStyle(element).fontSize), weight: getComputedStyle(element).fontWeight })),
      merchant.evaluate((element) => ({ size: parseFloat(getComputedStyle(element).fontSize), weight: getComputedStyle(element).fontWeight }))
    ]);
    expect(categoryStyle.size).toBeLessThan(merchantStyle.size);
    // Merchant is not bolder (the owner declined that variant).
    expect(Number(merchantStyle.weight)).toBeLessThanOrEqual(400);
    expect((await box(category)).bottom).toBeLessThanOrEqual((await box(merchant)).y + 1);

    // No "—" placeholder lines for an empty note or wallet detail.
    const placeholders = await page.locator(".entry-row-description p, .entry-row-transfer p").evaluateAll((nodes) => nodes.filter((node) => node.textContent.trim() === "—").length);
    expect(placeholders).toBe(0);

    // The owner's colour edge: 5 px, solid, a different colour per person.
    const edges = await rows.evaluateAll((nodes) => nodes.slice(0, 40).map((node) => {
      const style = getComputedStyle(node.querySelector(".entry-row-main"));
      return { width: style.borderLeftWidth, colour: style.borderLeftColor, owner: node.querySelector(".entry-chip-owner")?.textContent?.trim() };
    }));
    expect(edges.every((edge) => edge.width === "5px" && edge.colour !== TRANSPARENT)).toBe(true);
    const colourByOwner = new Map(edges.filter((edge) => edge.owner).map((edge) => [edge.owner, edge.colour]));
    expect(colourByOwner.size).toBeGreaterThan(1);
    expect(new Set(colourByOwner.values()).size).toBe(colourByOwner.size);
  });

  test("wide: the amount is right-aligned and tabular; a matched transfer is a quiet line", async ({ page }) => {
    await setUp(page);
    await openEntries(page);
    const row = page.locator("#txn-oct-transfer-out");
    await expect(row).toBeVisible();
    const amount = row.locator(".entry-row-amount > strong");
    expect(await amount.evaluate((element) => getComputedStyle(element).fontVariantNumeric)).toContain("tabular-nums");
    const [rowBox, amountBox] = await Promise.all([box(row), box(amount)]);
    expect(rowBox.right - amountBox.right).toBeLessThan(40);

    const matched = row.locator(".entry-chip-transfer");
    await expect(matched).toHaveText(/^Matched transfer (in|out)$/);
    const quiet = await matched.evaluate((element) => {
      const style = getComputedStyle(element);
      return { background: style.backgroundColor, borderWidth: style.borderTopWidth, color: style.color };
    });
    expect(quiet).toEqual({ background: TRANSPARENT, borderWidth: "0px", color: INK.muted });
  });

  test("the day header is a hairline divider with the daily net at the right", async ({ page }) => {
    await setUp(page);
    await openEntries(page);
    const head = page.locator(".entries-date-head").first();
    const [headBox, dateBox, actionsBox] = await Promise.all([box(head), box(head.locator("strong")), box(head.locator(".entries-date-actions"))]);
    expect(actionsBox.right).toBeGreaterThan(headBox.right - 24);
    expect(dateBox.x).toBeLessThan(headBox.x + 8);
    const rule = await head.locator("strong").evaluate((element) => {
      const style = getComputedStyle(element, "::after");
      return { content: style.content, height: style.height };
    });
    expect(rule.content).not.toBe("none");
    expect(rule.height).toBe("1px");
    await expect(head.locator(".entries-date-actions")).toContainText("Daily net");
    // One day's rows sit in one rounded white group.
    const group = page.locator(".entries-date-group .entries-rows").first();
    const style = await group.evaluate((element) => ({ radius: parseFloat(getComputedStyle(element).borderTopLeftRadius), overflow: getComputedStyle(element).overflow }));
    expect(style.radius).toBeGreaterThanOrEqual(12);
    expect(style.overflow).toBe("hidden");
  });

  test("phone: a 68 px row with the wallet as a quiet line and the amount on the merchant's line", async ({ page }) => {
    await setUp(page, { width: PHONE.width, height: PHONE.height });
    await openEntries(page);
    const row = page.locator("#txn-oct-transfer-out");
    await expect(row).toBeVisible();
    const main = row.locator(".entry-row-main");
    expect((await box(main)).height).toBeGreaterThanOrEqual(68);

    const wallet = row.locator(".entry-row-transfer strong");
    await expect(wallet).toBeVisible();
    expect((await wallet.textContent()).trim().length).toBeGreaterThan(0);
    await expect(row.locator(".entry-row-transfer p")).toBeHidden();
    expect((await looks(wallet)).color).toBe(INK.muted);

    const [merchantBox, amountBox, walletBox] = await Promise.all([
      box(row.locator(".entry-row-description > strong")), box(row.locator(".entry-row-amount > strong")), box(wallet)
    ]);
    expect(Math.abs(amountBox.y - merchantBox.y)).toBeLessThan(14);
    expect(walletBox.y).toBeGreaterThanOrEqual(merchantBox.bottom - 1);
    // Nothing scrolls sideways.
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
  });

  test("hidden money keeps the wallet line and shows dots for the amount and the daily net", async ({ page }) => {
    await setUp(page, { hidden: true, width: PHONE.width, height: PHONE.height });
    await openEntries(page);
    const row = page.locator("#txn-oct-transfer-out");
    await expect(row.locator(".entry-row-amount > strong")).toHaveText(/^•+$/);
    await expect(row.locator(".entry-row-transfer strong")).toBeVisible();
    await expect(page.locator(".entries-date-head .entries-date-actions .private-money").first()).toHaveText(/^•+$/);
  });
});

// A manual entry with every field the inline editor's chips change.
async function createManualEntry(page, patch = {}) {
  const { entryId } = await postJson(page, "/api/entries/create", {
    date: `${MONTH}-24`,
    description: "Chip entry fixed",
    accountName: "UOB One",
    categoryName: "Groceries",
    amountMinor: 3_210,
    entryType: "expense",
    ownershipType: "direct",
    ownerName: "Tim",
    ...patch
  });
  return entryId;
}

// A savings account with one certified purchase: the statement import locks
// its bank facts (as in support-chips.spec.js).
async function createCertifiedPurchase(page) {
  const accountName = `Lsd Savings ${Date.now()}`;
  const { accountId } = await postJson(page, "/api/accounts/create", {
    name: accountName, institution: "Synthetic Test Bank", kind: "bank", openingBalanceMinor: 0, currency: "SGD", ownerPersonId: "", isJoint: false
  });
  const { entryId } = await postJson(page, "/api/entries/create", {
    accountId, accountName, ownershipType: "direct", ownerName: "Tim",
    date: `${MONTH}-21`, description: "NTUC FAIRPRICE", categoryName: "Groceries", amountMinor: 1_250, entryType: "expense"
  });
  const statementCheckpoints = [{
    accountId, accountName, detectedAccountName: accountName, checkpointMonth: MONTH,
    statementStartDate: `${MONTH}-01`, statementEndDate: `${MONTH}-31`, statementBalanceMinor: -1_250, note: "Lsd checkpoint"
  }];
  const preview = await postJson(page, "/api/imports/preview", {
    sourceLabel: "Lsd statement", sourceType: "pdf",
    rows: [{ date: `${MONTH}-21`, description: "NTUC FAIRPRICE", expense: "12.50", accountId, account: accountName, category: "Groceries" }],
    defaultAccountName: accountName, ownershipType: "direct", ownerName: "Tim", statementCheckpoints
  });
  const previewRows = preview.preview.previewRows;
  expect(previewRows.map((row) => row.reconciliationTargetTransactionId)).toEqual([entryId]);
  await postJson(page, "/api/imports/commit", {
    sourceLabel: "Lsd statement", sourceType: "pdf", parserKey: "uob_savings_pdf",
    rows: previewRows.filter((row) => row.commitStatus === "included"),
    statementCheckpoints, statementControlRows: previewRows, statementReconciliations: preview.preview.statementReconciliations
  });
  return { entryId, accountName };
}

async function openInlineEditor(page, entryId) {
  // The household view keeps the entry in the list when its owner changes.
  await page.goto(`/entries?view=household&month=${MONTH}&editing_entry=${entryId}`);
  const card = page.locator(".entry-edit-card.is-inline");
  await expect(card).toBeVisible({ timeout: 60_000 });
  return card;
}

// The wide screen's inline editor: nothing repeats a lead chip, so the chips
// are the fields.
test.describe("Entries inline editor: the lead chips edit date, wallet and owner", () => {
  test("no Date, Wallet or Owner row; the rows are the ones no chip repeats", async ({ page }) => {
    await setUp(page);
    const card = await openInlineEditor(page, await createManualEntry(page));
    for (const key of ["date", "wallet", "owner"]) {
      await expect(card.locator(`[data-row='${key}']`), key).toHaveCount(0);
    }
    await expect(card.locator(".lsd-rows .lsd-row-label")).toHaveText(["Category", "Splits", "Note", "Posted date", "Type"]);
    await expect(card.locator(".lsd-card .lsd-chip")).toHaveText(["Sun 24 May", "UOB One", "Tim", "Manual provisional"]);
  });

  test("the chips change the date, wallet and owner and save the request the old rows sent", async ({ page }) => {
    await setUp(page);
    const entryId = await createManualEntry(page);
    const card = await openInlineEditor(page, entryId);
    const lead = card.locator(".lsd-card");

    // Each chip is its own field: a date field, and a native list for the wallet and the owner.
    const dateField = lead.getByLabel("Change date, Sun 24 May");
    await expect(dateField).toHaveAttribute("type", "date");
    await dateField.fill(`${MONTH}-20`);
    const walletField = lead.getByLabel("Change wallet, UOB One");
    expect(await walletField.evaluate((element) => element.tagName)).toBe("SELECT");
    // The wallet list is the one the Wallet row had: every account, "name - owner".
    expect(await walletField.locator("option").allTextContents()).toEqual([
      "Citi Rewards - Joyce", "Household Float - Shared", "UOB Lady's - Joyce", "UOB One - Tim", "UOB Savings - Tim"
    ]);
    await walletField.selectOption("acct-citi-rewards");
    const ownerField = lead.getByLabel("Change owner, Tim");
    expect(await ownerField.evaluate((element) => element.tagName)).toBe("SELECT");
    // The owner list is the household's people, as the Owner row's was.
    expect((await ownerField.locator("option").allTextContents()).sort()).toEqual(["Joyce", "Tim"]);
    await ownerField.selectOption("Joyce");
    await expect(lead.locator(".lsd-chip")).toHaveText(["Wed 20 May", "Citi Rewards", "Joyce", "Manual provisional"]);

    // The 44 px tap targets stay (each chip's field covers its pill).
    for (const chip of ["date", "wallet", "owner"]) {
      const target = await box(lead.locator(`[data-chip='${chip}']`));
      expect(target.height, chip).toBeGreaterThanOrEqual(44);
    }

    const update = page.waitForRequest((request) => request.url().includes("/api/entries/update"));
    await page.getByRole("button", { name: "Done editing entry" }).click();
    // The body the Date, Wallet and Owner rows sent for the same three changes.
    expect((await update).postDataJSON()).toEqual({
      entryId,
      date: `${MONTH}-20`,
      postDate: null,
      description: "Chip entry fixed",
      accountId: "acct-citi-rewards",
      accountName: "Citi Rewards",
      categoryName: "Groceries",
      amountMinor: 3210,
      entryType: "expense",
      ownershipType: "direct",
      ownerName: "Joyce",
      note: ""
    });
    await expect(card).toHaveCount(0);
    const saved = (await loadEntriesPage(page, { view: "household", month: MONTH })).monthPage.entries.find((item) => item.id === entryId);
    expect(saved).toMatchObject({ date: `${MONTH}-20`, accountName: "Citi Rewards", ownerName: "Joyce" });
  });

  test("a certified entry's date and wallet chips stay locked: no field, no row; the owner chip still edits", async ({ page }) => {
    await setUp(page);
    const { entryId, accountName } = await createCertifiedPurchase(page);
    const card = await openInlineEditor(page, entryId);
    const lead = card.locator(".lsd-card");

    for (const key of ["date", "wallet"]) {
      const chip = lead.locator(`[data-chip='${key}']`);
      await expect(chip, key).toHaveClass(/is-locked/);
      await expect(chip.locator(".lsd-chip-lock")).toHaveCount(1);
      await expect(chip.locator(".lsd-sr-only")).toHaveText(", locked by the statement");
      await expect(chip.locator("input, select, button")).toHaveCount(0);
      await expect(card.locator(`[data-row='${key}']`)).toHaveCount(0);
    }
    await expect(lead.locator("[data-chip='wallet']")).toContainText(accountName);
    await expect(lead.getByLabel(/^Change (date|wallet),/)).toHaveCount(0);
    // The description and amount are read-only too, as the rows were.
    await expect(lead.getByRole("textbox", { name: "Description" })).toHaveAttribute("readonly", "");
    await expect(lead.getByRole("textbox", { name: "Amount" })).toHaveCount(0);
    // The owner is not a bank fact.
    await expect(lead.getByLabel("Change owner, Tim")).toBeVisible();
    await expect(card.locator(".lsd-rows .lsd-row-label")).toHaveText(["Category", "Splits", "Note", "Posted date", "Type"]);
  });

  test("the inline card stays compact at 1280 px (height cap)", async ({ page }) => {
    await setUp(page, { width: 1280, height: 800 });
    const card = await openInlineEditor(page, await createManualEntry(page));
    const editor = page.locator(".entry-inline-editor");
    // About 400 px tall with Date, Wallet and Owner rows; the chips replaced
    // those three rows, so the two columns are one row shorter.
    expect((await box(editor)).height).toBeLessThan(380);
    expect((await box(card)).height).toBeLessThan(310);
    // The lead spans the top and the rows run in two columns.
    // (Polled: the description field resizes to its text as the card settles.)
    await expect.poll(async () => {
      const [leadBox, rowsBox] = await Promise.all([box(card.locator(".lsd-card")), box(card.locator(".lsd-rows"))]);
      return leadBox.width > rowsBox.width - 4 && rowsBox.y > leadBox.bottom - 1;
    }).toBe(true);
    const columns = await card.locator(".lsd-rows .lsd-row").evaluateAll((rows) => [...new Set(rows.map((row) => Math.round(row.getBoundingClientRect().x)))]);
    expect(columns).toHaveLength(2);
  });

  test("the phone sheet is unchanged: the rows are still there and the chips open the pickers", async ({ page }) => {
    await setUp(page, { width: PHONE.width, height: PHONE.height });
    const entryId = await createManualEntry(page);
    await page.goto(`/entries?view=person-tim&month=${MONTH}&editing_entry=${entryId}`);
    const sheet = page.locator('.entry-mobile-sheet[aria-label="Edit entry"]');
    await expect(sheet).toBeVisible({ timeout: 60_000 });
    await expect(sheet.locator(".lsd-rows > .lsd-row-group .lsd-row-label, .lsd-rows > .lsd-row .lsd-row-label")).toContainText(["Category", "Owner"]);
    await sheet.getByRole("button", { name: /More details/ }).click();
    for (const key of ["date", "wallet"]) {
      await expect(sheet.locator(`[data-row='${key}']`), key).toHaveCount(1);
    }
    await expect(sheet.locator("[data-row='owner']")).toHaveCount(1);
    await sheet.locator(".lsd-card").getByRole("button", { name: "Change owner, Tim" }).click();
    await expect(page.locator(".mobile-select-dialog").getByRole("heading", { name: "Owner", exact: true })).toBeVisible();
  });
});
