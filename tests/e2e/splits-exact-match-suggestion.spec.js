import { expect, test } from "@playwright/test";

import { gotoPageAfterApi, loadSplitsPage, postJson, reseedDemo } from "./helpers";

// A manual split expense and an imported bank row of exactly the same amount
// on the same day are suggested as a match even when their descriptions share
// no word ("SINGAPOREAIR Korea KOR KRW" and "SINGAPORE6182478320308"). The card
// says why in one plain line; nothing is linked until the person taps Match.
// Two equal rows are a tie and suggest nothing.

const month = "2026-05";
const date = "2026-05-14";
const amountMinor = 105_184;
const PHONE = { width: 390, height: 844 };

async function importCardRow(page, description, amount = amountMinor) {
  const csv = [
    "date,description,amount,account,category,note",
    `${date},${description},-${(amount / 100).toFixed(2)},UOB One,Travel,`
  ].join("\n");
  const preview = await postJson(page, "/api/imports/preview", { sourceLabel: description, sourceType: "csv", csv, ownershipType: "direct", ownerName: "Tim" });
  await postJson(page, "/api/imports/commit", { sourceLabel: description, sourceType: "csv", parserKey: "generic_csv", rows: preview.preview.previewRows });
}

async function createSplit(page, description) {
  const created = await postJson(page, "/api/splits/expenses/create", {
    groupId: null,
    date,
    description,
    categoryName: "Travel",
    payerPersonName: "Tim",
    amountMinor,
    splitBasisPoints: 5_000,
    currency: "SGD",
    paymentMethod: "card",
    paymentStatus: "awaiting_statement"
  });
  return created.splitExpenseId;
}

async function showMoney(page) {
  await page.addInitScript(() => window.localStorage.setItem("monies-map:money-totals-visible", "true"));
}

async function openMatches(page) {
  await gotoPageAfterApi(page, `/splits?view=person-tim&month=${month}&split_mode=matches`, "/api/splits-page", () => page.locator(".split-match-review-section"));
}

for (const [name, size] of [["desktop", { width: 1280, height: 800 }], ["phone", PHONE]]) {
  test.describe(name, () => {
    test.beforeEach(async ({ page }) => {
      await showMoney(page);
      await page.goto("/");
      await reseedDemo(page);
      await page.setViewportSize(size);
    });

    test("same amount and date is suggested with its reason, and only linked when the person taps Match", async ({ page }) => {
      const stamp = Date.now();
      await importCardRow(page, `SINGAPORE${stamp}`);
      const splitId = await createSplit(page, `SINGAPOREAIR Korea KOR KRW ${stamp}`);

      const before = await loadSplitsPage(page, { view: "person-tim", month });
      const suggestion = before.splitsPage.matches.find((match) => match.splitRecordId === splitId);
      expect(suggestion).toBeTruthy();
      expect(suggestion.amountDeltaMinor).toBe(0);
      expect(suggestion.dateDeltaDays).toBe(0);

      await openMatches(page);
      const card = page.locator(".split-match-card").filter({ hasText: `SINGAPORE${stamp}` }).first();
      await expect(card).toBeVisible();
      await expect(card.locator(".split-match-headline strong")).toHaveText("Same amount and date as this split expense");
      await expect(card.locator(".split-match-headline")).toContainText("High");
      await expect(card.locator(".split-match-compare")).toContainText(`SINGAPOREAIR Korea KOR KRW ${stamp}`);
      await expect(card.locator(".split-match-compare")).toContainText("$1,051.84");
      await expect(card.locator(".split-match-deltas")).toContainText("0 days apart");
      // Nothing links by itself: the split is still unlinked until Match.
      const unlinked = await loadSplitsPage(page, { view: "person-tim", month });
      expect(unlinked.splitsPage.activity.find((item) => item.id === splitId)?.linkedTransactionId).toBeFalsy();

      await card.getByRole("button", { name: "Match", exact: true }).click();
      await expect.poll(async () => {
        const data = await loadSplitsPage(page, { view: "person-tim", month });
        return Boolean(data.splitsPage.activity.find((item) => item.id === splitId)?.linkedTransactionId);
      }).toBe(true);
      const after = await loadSplitsPage(page, { view: "person-tim", month });
      expect(after.splitsPage.matches.some((match) => match.splitRecordId === splitId)).toBe(false);
    });

    test("two bank rows of the same amount on the same day are a tie: no suggestion", async ({ page }) => {
      const stamp = Date.now();
      await importCardRow(page, `SINGAPORE${stamp}`);
      await importCardRow(page, `MERCHANT TWO ${stamp}`);
      const splitId = await createSplit(page, `SINGAPOREAIR Korea KOR KRW ${stamp}`);

      const data = await loadSplitsPage(page, { view: "person-tim", month });
      expect(data.splitsPage.matches.some((match) => match.splitRecordId === splitId)).toBe(false);
      await openMatches(page);
      await expect(page.locator(".split-match-card").filter({ hasText: `${stamp}` })).toHaveCount(0);
    });

    test("a bank row another split already holds is not suggested to a second split", async ({ page }) => {
      const stamp = Date.now();
      await importCardRow(page, `SINGAPOREAIR ${stamp}`);
      const first = await createSplit(page, `SINGAPOREAIR flights ${stamp}`);
      const before = await loadSplitsPage(page, { view: "person-tim", month });
      const match = before.splitsPage.matches.find((item) => item.splitRecordId === first);
      expect(match).toBeTruthy();
      await postJson(page, "/api/splits/matches/link-expense", { splitExpenseId: first, transactionId: match.transactionId });
      const second = await createSplit(page, `SINGAPOREAIR flights again ${stamp}`);

      const after = await loadSplitsPage(page, { view: "person-tim", month });
      expect(after.splitsPage.matches.some((item) => item.splitRecordId === second)).toBe(false);
    });
  });
}
