import { expect, test } from "@playwright/test";

import { expectFits } from "./fit-check.js";
import { STRESS, seedStressHousehold } from "./fit-stress-fixture.js";
import { gotoPageAfterApi, openJustPaid, postJson, reseedDemo } from "./helpers";

// "Remember this for cash" (docs/flows/cash-entry-flow.md; DOMAIN.md
// "Payment Way"): with no cash wallet, a cash Save asks which wallet; after
// the person picks one, the pad (and Ask, after "kopi 2.40 cash") offers one
// tap that makes it their cash wallet through Settings' Payment ways
// command. Not tapping it changes nothing; once set, cash no longer asks.
// The test Worker has no AI, so Ask reads with its rules here.

const TIM = "person-tim";
const WALLET_KEY = "monies.cashWallet.v1";

function today() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Singapore", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

async function cashWalletOf(page, personId) {
  const response = await page.request.get("/api/settings-page?view=household");
  const data = await response.json();
  return data.settingsPage.paymentWays.find((way) => way.personId === personId)?.cashAccountId ?? "";
}

async function openPad(page) {
  await gotoPageAfterApi(page, `/entries?view=${TIM}&month=${today().slice(0, 7)}`, "/api/entries-page", () => page.locator(".entries-fab:not(.splits-fab)"));
  return openJustPaid(page);
}

// Types an amount, taps Save, answers "Which wallet did the cash come from?"
// with `walletName`, and waits for the saved line.
async function payAndPick(page, pad, walletName) {
  await pad.getByRole("button", { name: "7", exact: true }).click();
  await pad.getByRole("button", { name: "Save", exact: true }).click();
  await expect(pad.getByRole("alert")).toHaveText("Which wallet did the cash come from?");
  const saved = page.waitForResponse((response) => response.url().includes("/api/cash-entries/create") && response.ok());
  await pad.locator(".cash-pad-choice-row").filter({ hasText: "Cash from" }).getByRole("button", { name: walletName, exact: true }).click();
  await saved;
  // The stress household has a trip on today, so its pad may be in rupiah.
  await expect(pad.locator(".cash-pad-saved-line")).toHaveText(/^Saved: Cash, /);
}

const rememberChip = (scope) => scope.getByRole("button", { name: "Remember this for cash", exact: true });

test.describe("Remember this for cash", () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => window.localStorage.setItem("monies-map:money-totals-visible", "true"));
    await reseedDemo(page);
  });

  test("the pad: picking a wallet offers it; a tap sets the cash wallet, Undo takes it back, and once set cash stops asking", async ({ page }) => {
    const pocket = await postJson(page, "/api/accounts/create", { name: "Tim's pocket", institution: "Cash", kind: "cash", currency: "SGD", ownerPersonId: TIM });
    const pad = await openPad(page);
    await payAndPick(page, pad, "Tim's pocket");
    // Offered, never set by itself.
    await expect(rememberChip(pad)).toBeVisible();
    expect(await cashWalletOf(page, TIM)).toBe("");

    await rememberChip(pad).click();
    const done = pad.locator('[data-remember-cash="done"]');
    await expect(done).toContainText("Cash will use Tim's pocket from now on. Change it in Settings, Payment ways.");
    expect(await cashWalletOf(page, TIM)).toBe(pocket.accountId);
    // The pad's own Undo (the payment) is still there beside it.
    await expect(pad.locator(".cash-pad-after-actions").getByRole("button", { name: "Undo" })).toBeVisible();

    // The line's Undo puts back no cash wallet and offers it again.
    const undone = page.waitForResponse((response) => response.url().includes("/api/settings/payment-ways/save") && response.ok());
    await done.getByRole("button", { name: "Undo", exact: true }).click();
    await undone;
    await expect(rememberChip(pad)).toBeEnabled();
    expect(await cashWalletOf(page, TIM)).toBe("");
    await rememberChip(pad).click();
    await expect(done).toBeVisible();
    expect(await cashWalletOf(page, TIM)).toBe(pocket.accountId);

    // Another device (nothing remembered on it): the pad opens on that
    // wallet and Save saves straight away, with no question and no offer.
    await page.evaluate((key) => window.localStorage.removeItem(key), WALLET_KEY);
    const next = await openPad(page);
    await expect(next.locator(".cash-pad-line")).toContainText("Tim's pocket", { timeout: 30_000 });
    await next.getByRole("button", { name: "5", exact: true }).click();
    const saved = page.waitForResponse((response) => response.url().includes("/api/cash-entries/create") && response.ok());
    await next.getByRole("button", { name: "Save", exact: true }).click();
    expect((await (await saved).json()).entry.accountId).toBe(pocket.accountId);
    await expect(next.locator(".cash-pad-saved-line")).toHaveText("Saved: Cash, $5.00");
    await expect(rememberChip(next)).toHaveCount(0);
  });

  test("negative: a bank account picked for cash is not offered, and not tapping changes nothing", async ({ page }) => {
    await postJson(page, "/api/accounts/create", { name: "Tim's pocket", institution: "Cash", kind: "cash", currency: "SGD", ownerPersonId: TIM });
    const pad = await openPad(page);
    await payAndPick(page, pad, "UOB Savings");
    await expect(rememberChip(pad)).toHaveCount(0);
    // A cash wallet picked but the offer left alone (Done): the setting is
    // still none, and the next pad on a fresh device asks again.
    await pad.getByRole("button", { name: "Done", exact: true }).click();
    await page.evaluate((key) => window.localStorage.removeItem(key), WALLET_KEY);
    const again = await openPad(page);
    await payAndPick(page, again, "Tim's pocket");
    await expect(rememberChip(again)).toBeVisible();
    await again.getByRole("button", { name: "Done", exact: true }).click();
    expect(await cashWalletOf(page, TIM)).toBe("");
    await page.evaluate((key) => window.localStorage.removeItem(key), WALLET_KEY);
    const third = await openPad(page);
    await third.getByRole("button", { name: "4", exact: true }).click();
    await third.getByRole("button", { name: "Save", exact: true }).click();
    await expect(third.getByRole("alert")).toHaveText("Which wallet did the cash come from?");
  });

  test("Ask, rules: 'kopi 2.40 cash' asks the wallet; after Save one chip remembers it, and the next cash message is not asked", async ({ page }) => {
    const pocket = await postJson(page, "/api/accounts/create", { name: "Tim's pocket", institution: "Cash", kind: "cash", currency: "SGD", ownerPersonId: TIM });
    await page.goto(`/ask?view=${TIM}`);
    const box = page.getByRole("textbox", { name: "Message" });
    await expect(box).toBeVisible({ timeout: 60_000 });
    await box.fill("kopi 2.40 cash");
    await box.press("Enter");
    const chips = page.getByRole("group", { name: "Suggestions" }).getByRole("button");
    await chips.filter({ hasText: "Tim's pocket" }).click();
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(rememberChip(page)).toBeVisible({ timeout: 30_000 });
    expect(await cashWalletOf(page, TIM)).toBe("");
    await rememberChip(page).click();
    await expect(page.getByText("Cash will use Tim's pocket from now on. Change it in Settings, Payment ways.")).toBeVisible();
    await expect(rememberChip(page)).toHaveCount(0);
    expect(await cashWalletOf(page, TIM)).toBe(pocket.accountId);

    // The next cash message has its wallet: no question, no offer.
    const draft = await postJson(page, "/api/ai-assist/entry-draft", { text: "teh 1.80 cash", viewId: TIM });
    expect(draft.draft.fields.accountId).toEqual({ value: pocket.accountId, source: "rule" });
    expect(draft.draft.questions).toEqual([]);
  });
});

// The phone fit check (docs/code-spec.md "Phone fit check") with the heavy
// household and a long cash wallet name: the pad's offer and its
// confirmation, and Ask's chip row and line, on three small phones.
test("phone fit: Remember this for cash in the pad and in Ask", async ({ page }) => {
  test.setTimeout(300_000);
  await page.addInitScript(() => window.localStorage.setItem("monies-map:money-totals-visible", "true"));
  await seedStressHousehold(page);
  const longName = "Tim's Cash Envelope For Hawker Breakfasts And Lunches";
  await postJson(page, "/api/accounts/create", { name: longName, institution: "Cash", kind: "cash", currency: "SGD", ownerPersonId: TIM });
  for (const size of [{ width: 320, height: 568 }, { width: 375, height: 557 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(size);
    await postJson(page, "/api/settings/payment-ways/save", { personId: TIM, cashAccountId: "", only: "cash" });
    await page.goto(`/ask?view=${TIM}`);
    const box = page.getByRole("textbox", { name: "Message" });
    await expect(box).toBeVisible({ timeout: 60_000 });
    // A fresh conversation each time, so the card is this message's.
    const newChat = page.getByRole("button", { name: "New chat" });
    if (await newChat.isVisible()) await newChat.click();
    await box.fill("kopi 2.40 cash");
    await box.press("Enter");
    await page.getByRole("group", { name: "Suggestions" }).getByRole("button").filter({ hasText: "Hawker Breakfasts" }).click();
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(rememberChip(page)).toBeVisible({ timeout: 30_000 });
    await expectFits(page);
    await rememberChip(page).click();
    await expect(page.getByText(`Cash will use ${longName} from now on.`, { exact: false })).toBeVisible();
    await expectFits(page);
  }
  for (const size of [{ width: 320, height: 568 }, { width: 375, height: 557 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(size);
    await postJson(page, "/api/settings/payment-ways/save", { personId: TIM, cashAccountId: "", only: "cash" });
    await page.evaluate((key) => window.localStorage.removeItem(key), WALLET_KEY).catch(() => {});
    const pad = await openPad(page);
    await payAndPick(page, pad, longName);
    await expect(rememberChip(pad)).toBeVisible();
    await expectFits(page);
    await rememberChip(pad).click();
    const done = pad.locator('[data-remember-cash="done"]');
    await expect(done).toContainText(longName);
    await expectFits(page);
    // Back to no cash wallet for the next size.
    await done.getByRole("button", { name: "Undo", exact: true }).click();
    await expect(rememberChip(pad)).toBeVisible();
    await pad.getByRole("button", { name: "Done", exact: true }).click();
  }

  expect(STRESS.tim).toBeTruthy();
});
