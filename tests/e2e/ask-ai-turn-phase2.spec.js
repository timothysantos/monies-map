import { devices, expect, test } from "@playwright/test";

import { loadEntriesPage, loadReferenceData, loadSplitsPage, postJson, reseedDemo } from "./helpers";

// Ask, AI first, Phase 2 (docs/flows/ask-flow.md "Phase 2: changes to saved
// data"). The model is stubbed as in ask-ai-turn.spec.js: the page's real
// /api/ask/turn request reaches the real Worker with the model's answer in
// the X-Ask-Turn-Test-Reply header, so the server still checks the action
// against the demo household and reads the rows it needs. Each change is a
// card that names what changes; nothing is written until its button, which
// posts the existing command.

const iPhone = devices["iPhone 12 Pro"].viewport;
const MONTH = "2026-04";

async function stubModel(page, replies) {
  const seen = [];
  await page.route("**/api/ask/turn", async (route) => {
    seen.push(route.request().postDataJSON());
    const reply = replies.shift();
    const response = await route.fetch({ headers: { ...route.request().headers(), ...(reply ? { "x-ask-turn-test-reply": JSON.stringify(reply) } : {}) } });
    await route.fulfill({ response });
  });
  return seen;
}

async function send(page, text) {
  const message = page.getByRole("textbox", { name: "Message" });
  await message.fill(text);
  await message.press("Enter");
}

async function createEntry(page, fields) {
  const created = await postJson(page, "/api/entries/create", {
    date: "2026-04-23", accountName: "Citi Rewards", categoryName: "Food & Drinks", amountMinor: 1_000, entryType: "expense", ownershipType: "direct", ownerName: "Tim", ...fields
  });
  return created.entryId;
}

async function entryById(page, id, month = MONTH) {
  const data = await loadEntriesPage(page, { view: "person-tim", month });
  return data.monthPage.entries.find((entry) => entry.id === id) ?? null;
}

// A screenshot of the whole card for the owner's review: a tall phone
// screen for the moment, the card in the middle, then the phone size back.
async function shot(page, locator, path) {
  await page.setViewportSize({ width: iPhone.width, height: 1800 });
  await locator.evaluate((element) => element.scrollIntoView({ block: "center" }));
  await page.screenshot({ path });
  await page.setViewportSize(iPhone);
}

async function openSavedEntry(page, entryId) {
  await page.goto(`/ask?saved_entry=${entryId}&month=${MONTH}&view=person-tim&from=shortcut`);
  await expect(page.locator('[data-ask-card="saved"]')).toBeVisible({ timeout: 60_000 });
}

test.describe("Ask, AI first, Phase 2", () => {
  test.use({ viewport: iPhone });

  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => window.localStorage.setItem("monies-map:money-totals-visible", "true"));
    await page.goto("/");
    await reseedDemo(page);
  });

  test("recategorise one: \"make it Taxi\" on the saved entry is a card; Save moves it, Undo moves it back", async ({ page }) => {
    const description = `GRAB HOME ${Date.now()}`;
    const entryId = await createEntry(page, { description });
    const seen = await stubModel(page, [{ action: "recategorise", recategorise: { category: "Taxi" } }]);
    await openSavedEntry(page, entryId);
    await send(page, "make it Taxi");
    await expect.poll(() => seen.length).toBe(1);
    expect(seen[0].focus).toEqual({ kind: "saved_entry", entryId });

    const card = page.locator('[data-change-draft="draft"][data-change-type="recategorise"]');
    await expect(card).toBeVisible();
    await expect(card.locator('[data-change-field="category"]')).toContainText("Food & Drinks");
    await expect(card.locator('[data-change-field="category"]')).toContainText("Taxi");
    expect((await entryById(page, entryId)).categoryName).toBe("Food & Drinks");
    await shot(page, card, "test-results/ask-p2-recategorise-one.png");

    await card.getByRole("button", { name: "Save" }).click();
    await expect(page.locator('[data-change-draft="saved"]')).toBeVisible();
    await expect.poll(async () => (await entryById(page, entryId)).categoryName).toBe("Taxi");
    await page.locator("[data-change-undo]").click();
    await expect(page.locator('[data-change-draft="undone"]')).toBeVisible();
    await expect.poll(async () => (await entryById(page, entryId)).categoryName).toBe("Food & Drinks");
  });

  test("recategorise many: the card lists the matching entries with their count; over ten needs \"Yes, change all\" before Save; the rule is offered after", async ({ page }) => {
    const tag = "ZQXRIDE";
    const ids = [];
    for (let index = 0; index < 11; index += 1) {
      ids.push(await createEntry(page, { description: `${tag} TRIP ${index}`, date: `2026-04-${String(10 + index).padStart(2, "0")}`, amountMinor: 1_000 + index }));
    }
    await stubModel(page, [{ action: "recategorise", recategorise: { category: "Public Transport", words: tag } }]);
    await page.goto(`/ask?view=person-tim&month=${MONTH}`);
    await send(page, `make all ${tag} rides Public Transport`);

    const card = page.locator('[data-change-draft="draft"][data-change-type="recategorise_bulk"]');
    await expect(card).toBeVisible();
    await expect(card).toContainText("11 entries change category");
    await expect(card.locator("[data-change-entry]")).toHaveCount(8);
    await expect(card).toContainText("and 3 more");
    const save = card.getByRole("button", { name: "Change 11 entries" });
    await expect(save).toBeDisabled();
    await shot(page, card, "test-results/ask-p2-recategorise-bulk.png");
    // Nothing moved yet.
    expect((await entryById(page, ids[0])).categoryName).toBe("Food & Drinks");

    await card.locator("[data-change-confirm]").click();
    await expect(save).toBeEnabled();
    await save.click();
    await expect(page.locator('[data-change-draft="saved"]')).toBeVisible();
    await expect(page.locator(".ask-note").filter({ hasText: "Moved 11 entries to Public Transport." })).toBeVisible();
    for (const id of [ids[0], ids[10]]) {
      expect((await entryById(page, id)).categoryName).toBe("Public Transport");
    }
    await shot(page, page.locator('[data-change-draft="saved"]'), "test-results/ask-p2-recategorise-bulk-saved.png");
    await page.locator("[data-change-rule]").click();
    await expect(page.locator(".ask-note").filter({ hasText: "New ones will go to Public Transport too." })).toBeVisible();
  });

  test("link a transfer: the other side with the same amount is found; Link pairs them", async ({ page }) => {
    const stamp = Date.now();
    const { accounts } = await loadReferenceData(page);
    const other = accounts.find((account) => account.kind === "bank" && account.isActive && account.name !== "UOB One");
    const out = await createEntry(page, { description: `FAST OUT ${stamp}`, accountName: "UOB One", categoryName: "Other", amountMinor: 123_457 });
    const into = await createEntry(page, { description: `FAST IN ${stamp}`, accountName: other.name, categoryName: "Other - Income", entryType: "income", amountMinor: 123_457 });
    await stubModel(page, [{ action: "link_transfer" }]);
    await openSavedEntry(page, out);
    await send(page, "this was a transfer to my other account");

    const card = page.locator('[data-change-draft="draft"][data-change-type="link_transfer"]');
    await expect(card).toBeVisible();
    await expect(card.locator('[data-change-field="from"]')).toContainText("UOB One");
    await expect(card.locator('[data-change-field="to"]')).toContainText(other.name);
    await expect(card.locator(`[data-change-entry="${into}"]`)).toBeVisible();
    await shot(page, card, "test-results/ask-p2-link-transfer.png");
    await card.getByRole("button", { name: "Link" }).click();
    await expect(page.locator(".ask-note").filter({ hasText: "Linked as a transfer." })).toBeVisible();
    await expect.poll(async () => (await entryById(page, out)).entryType).toBe("transfer");
    expect((await entryById(page, into)).entryType).toBe("transfer");
  });

  // Making an entry a transfer asks the same question the Entries transfer
  // dialog does: which entry on the other side? (docs/flows/ask-flow.md
  // "Transfers: the other side".) Three wallets: the entry's own (A), the one
  // the person names (B) and a decoy (C), each holding the same amount.
  async function transferWallets(page) {
    const { accounts } = await loadReferenceData(page);
    const banks = accounts.filter((account) => account.kind === "bank" && account.isActive);
    const a = banks.find((account) => account.name !== "UOB One");
    const b = accounts.find((account) => account.name === "UOB One");
    const c = accounts.find((account) => account.isActive && ![a.name, b.name].includes(account.name));
    return { a: a.name, b: b.name, c: c.name };
  }

  test("\"this is a transfer to UOB One\": the matching UOB One entry is pre-selected, the decoy in another wallet is not offered; Link pairs them and Entries shows a matched transfer", async ({ page }) => {
    const stamp = Date.now();
    const wallets = await transferWallets(page);
    const out = await createEntry(page, { description: `XFER OUT ${stamp}`, accountName: wallets.a, categoryName: "Other", amountMinor: 123_458 });
    const intoB = await createEntry(page, { description: `XFER IN UOB ${stamp}`, accountName: wallets.b, categoryName: "Other - Income", entryType: "income", amountMinor: 123_458 });
    const intoC = await createEntry(page, { description: `XFER IN OTHER ${stamp}`, accountName: wallets.c, categoryName: "Other - Income", entryType: "income", amountMinor: 123_458 });
    await stubModel(page, [{ action: "edit_saved_entry", entry: { type: "transfer", to_wallet: wallets.b } }]);
    await openSavedEntry(page, out);
    await send(page, `this is a transfer to ${wallets.b}`);

    const card = page.locator('[data-change-draft="draft"][data-change-type="link_transfer"]');
    await expect(card).toBeVisible();
    await expect(card.locator('[data-change-field="from"]')).toContainText(wallets.a);
    await expect(card.locator('[data-change-field="to"]')).toContainText(wallets.b);
    await expect(card.locator(`[data-change-entry="${intoB}"]`)).toBeVisible();
    await expect(card.locator(`[data-change-entry="${intoC}"]`)).toHaveCount(0);
    await expect(card.locator(`[data-transfer-choice="${intoB}"]`)).toHaveAttribute("aria-pressed", "true");
    await expect(card.locator("[data-transfer-choice]")).toHaveCount(2);
    await expect(card.locator('[data-transfer-choice="none"]')).toHaveText("No other side yet (keep as an unmatched transfer)");
    await shot(page, card, "test-results/ask-p2-transfer-named-wallet.png");
    await card.getByRole("button", { name: "Link" }).click();
    await expect(page.locator(".ask-note").filter({ hasText: "Linked as a transfer." })).toBeVisible();

    const first = await entryById(page, out);
    expect(first.entryType).toBe("transfer");
    expect(first.linkedTransfer?.transactionId).toBe(intoB);
    expect((await entryById(page, intoB)).entryType).toBe("transfer");
    expect((await entryById(page, intoC)).entryType).toBe("income");

    await page.goto(`/entries?view=person-tim&month=${MONTH}`);
    await expect(page.locator(":is(li, tr, article, div)").filter({ hasText: `XFER OUT ${stamp}` }).filter({ hasText: "Matched transfer out" }).first()).toBeVisible({ timeout: 60_000 });
  });

  test("a wallet with no match says so and offers the others as chips; choosing the second links that one", async ({ page }) => {
    const stamp = Date.now();
    const wallets = await transferWallets(page);
    const out = await createEntry(page, { description: `XFER OUT ${stamp}`, accountName: wallets.a, categoryName: "Other", amountMinor: 223_458 });
    const first = await createEntry(page, { date: "2026-04-23", description: `XFER IN FIRST ${stamp}`, accountName: wallets.b, categoryName: "Other - Income", entryType: "income", amountMinor: 223_458 });
    const second = await createEntry(page, { date: "2026-04-25", description: `XFER IN SECOND ${stamp}`, accountName: wallets.c, categoryName: "Other - Income", entryType: "income", amountMinor: 223_458 });
    const empty = (await loadReferenceData(page)).accounts.find((account) => account.isActive && ![wallets.a, wallets.b, wallets.c].includes(account.name));
    await stubModel(page, [{ action: "link_transfer", transfer: { wallet: empty.name, date: null } }]);
    await openSavedEntry(page, out);
    await send(page, `it was a transfer to ${empty.name}`);

    const card = page.locator('[data-change-draft="draft"][data-change-type="link_transfer"]');
    await expect(card).toBeVisible();
    await expect(card.locator("[data-transfer-wallet-missed]")).toHaveText(`Nothing in ${empty.name} has this amount. These other accounts do.`);
    await expect(card.locator(`[data-transfer-choice="${first}"]`)).toHaveAttribute("aria-pressed", "true");
    await card.locator(`[data-transfer-choice="${second}"]`).click();
    await expect(card.locator(`[data-transfer-choice="${second}"]`)).toHaveAttribute("aria-pressed", "true");
    await expect(card.locator(`[data-change-entry="${second}"]`)).toBeVisible();
    await expect(card.locator(`[data-change-entry="${first}"]`)).toHaveCount(0);
    await card.getByRole("button", { name: "Link" }).click();
    await expect(page.locator(".ask-note").filter({ hasText: "Linked as a transfer." })).toBeVisible();
    expect((await entryById(page, out)).linkedTransfer?.transactionId).toBe(second);
    expect((await entryById(page, first)).entryType).toBe("income");
  });

  test("no other side yet: the card offers only the unmatched transfer; Save marks it a transfer with no link, and Undo changes it back", async ({ page }) => {
    const wallets = await transferWallets(page);
    const out = await createEntry(page, { description: `XFER LONE ${Date.now()}`, accountName: wallets.a, categoryName: "Other", amountMinor: 323_459 });
    await stubModel(page, [{ action: "edit_saved_entry", entry: { type: "transfer", to_wallet: wallets.b } }]);
    await openSavedEntry(page, out);
    await send(page, `this is a transfer to ${wallets.b}`);

    const card = page.locator('[data-change-draft="draft"][data-change-type="link_transfer"]');
    await expect(card).toBeVisible();
    await expect(card.locator("[data-transfer-wallet-missed]")).toHaveText(`Nothing in ${wallets.b} has this amount.`);
    await expect(card.locator("[data-transfer-choice]")).toHaveCount(1);
    await expect(card.locator('[data-transfer-choice="none"]')).toHaveAttribute("aria-pressed", "true");
    await expect(card.locator('[data-change-field="to"]')).toContainText("Not matched yet");
    await card.getByRole("button", { name: "Save as a transfer" }).click();
    await expect(page.locator(".ask-note").filter({ hasText: "Marked as a transfer. The other side isn't linked yet." })).toBeVisible();
    await expect.poll(async () => (await entryById(page, out)).entryType).toBe("transfer");
    expect((await entryById(page, out)).linkedTransfer).toBeUndefined();

    await page.locator("[data-change-undo]").click();
    await expect(page.locator(".ask-note").filter({ hasText: "Changed back." })).toBeVisible();
    await expect.poll(async () => (await entryById(page, out)).entryType).toBe("expense");
  });

  test("a new transfer drafted in Ask finds the other side too: pre-selected on the card; Save creates it and links the pair", async ({ page }) => {
    const stamp = Date.now();
    const wallets = await transferWallets(page);
    const into = await createEntry(page, { date: "2026-04-23", description: `XFER IN ${stamp}`, accountName: wallets.b, categoryName: "Other - Income", entryType: "income", amountMinor: 423_458 });
    await stubModel(page, [{ action: "draft_entry", entry: { type: "transfer", amount: "4234.58", wallet: wallets.a, to_wallet: wallets.b, date: "2026-04-23", description: null, category: null, owner: null, note: null } }]);
    await page.goto(`/ask?month=${MONTH}&view=person-tim`);
    await send(page, `moved $4234.58 from ${wallets.a} to ${wallets.b}`);

    const match = page.locator("[data-transfer-match]");
    await expect(match).toBeVisible({ timeout: 60_000 });
    await expect(match).toHaveAttribute("data-transfer-match", into);
    await expect(match.locator("[data-transfer-selected]")).toContainText(`XFER IN ${stamp}`);
    await expect(match.locator("[data-transfer-selected]")).toContainText(wallets.b);
    await expect(match.locator('[data-transfer-choice="none"]')).toBeVisible();
    await shot(page, match, "test-results/ask-p2-transfer-draft.png");
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.locator(".ask-note").filter({ hasText: "Saved to Entries and linked to the other side." })).toBeVisible();

    const entries = (await loadEntriesPage(page, { view: "person-tim", month: MONTH })).monthPage.entries;
    const created = entries.find((entry) => entry.accountName === wallets.a && entry.amountMinor === 423_458 && entry.entryType === "transfer");
    expect(created?.linkedTransfer?.transactionId).toBe(into);
    expect(entries.find((entry) => entry.id === into)?.entryType).toBe("transfer");
  });

  test("a new transfer drafted in Ask with no other side yet saves as a plain transfer; choosing 'No other side yet' skips a candidate", async ({ page }) => {
    const stamp = Date.now();
    const wallets = await transferWallets(page);
    const into = await createEntry(page, { date: "2026-04-23", description: `XFER IN ${stamp}`, accountName: wallets.b, categoryName: "Other - Income", entryType: "income", amountMinor: 523_458 });
    await stubModel(page, [{ action: "draft_entry", entry: { type: "transfer", amount: "5234.58", wallet: wallets.a, to_wallet: wallets.b, date: "2026-04-23", description: null, category: null, owner: null, note: null } }]);
    await page.goto(`/ask?month=${MONTH}&view=person-tim`);
    await send(page, `moved $5234.58 from ${wallets.a} to ${wallets.b}`);
    const match = page.locator("[data-transfer-match]");
    await expect(match.locator(`[data-transfer-choice="${into}"]`)).toHaveAttribute("aria-pressed", "true", { timeout: 60_000 });
    await match.locator('[data-transfer-choice="none"]').click();
    await expect(match).toHaveAttribute("data-transfer-match", "none");
    await expect(match.locator("[data-transfer-selected]")).toContainText("No other side yet");
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.locator(".ask-note").filter({ hasText: "Saved to Entries." })).toBeVisible();
    const entries = (await loadEntriesPage(page, { view: "person-tim", month: MONTH })).monthPage.entries;
    const created = entries.find((entry) => entry.accountName === wallets.a && entry.amountMinor === 523_458 && entry.entryType === "transfer");
    expect(created).toBeTruthy();
    expect(created.linkedTransfer).toBeUndefined();
    expect(entries.find((entry) => entry.id === into)?.entryType).toBe("income");
  });

  test("settle a whole group: Ask opened for the group drafts the group's whole balance; Record payment leaves nothing owed", async ({ page }) => {
    const splits = await loadSplitsPage(page, { view: "person-tim", month: MONTH });
    const group = splits.splitsPage.groups.find((item) => item.id !== "split-group-none" && (item.currency ?? "SGD") === "SGD");
    await postJson(page, "/api/splits/expenses/create", { groupId: group.id, date: "2026-04-20", description: `Dinner ${Date.now()}`, categoryName: "Food & Drinks", payerPersonName: "Tim", amountMinor: 8_000, splitBasisPoints: 5000, currency: "SGD" });
    const before = (await loadSplitsPage(page, { view: "person-tim", month: MONTH })).splitsPage.groups.find((item) => item.id === group.id).balanceMinor;
    expect(before).not.toBe(0);

    const seen = await stubModel(page, [{ action: "split_group", group: { op: "settle" } }]);
    await page.goto(`/ask?split_group=${group.id}&view=person-tim&month=${MONTH}`);
    await send(page, "settle up everything");
    await expect.poll(() => seen.length).toBe(1);
    expect(seen[0].focus).toEqual({ kind: "split_group", groupId: group.id });

    const card = page.locator('[data-settlement-draft="draft"]');
    await expect(card).toBeVisible();
    await expect(card).toContainText(group.name);
    await shot(page, card, "test-results/ask-p2-settle-group.png");
    await card.getByRole("button", { name: "Record payment" }).click();
    await expect(page.locator('[data-settlement-draft="saved"]')).toBeVisible();
    await expect.poll(async () => (await loadSplitsPage(page, { view: "person-tim", month: MONTH })).splitsPage.groups.find((item) => item.id === group.id)?.balanceMinor ?? 0).toBe(0);
  });

  test("note edit: the saved entry's note in the person's words; Save writes it, Undo puts the old one back", async ({ page }) => {
    const entryId = await createEntry(page, { description: `DINNER ${Date.now()}`, note: "dinner" });
    await stubModel(page, [{ action: "edit_note", note_edit: { target: "entry", text: "Joyce's birthday dinner" } }]);
    await openSavedEntry(page, entryId);
    await send(page, "note: Joyce's birthday dinner");

    const card = page.locator('[data-change-draft="draft"][data-change-type="entry_note"]');
    await expect(card.locator('[data-change-field="note"]')).toContainText("Joyce's birthday dinner");
    await shot(page, card, "test-results/ask-p2-note.png");
    await card.getByRole("button", { name: "Save" }).click();
    await expect.poll(async () => (await entryById(page, entryId)).note).toBe("Joyce's birthday dinner");
    await page.locator("[data-change-undo]").click();
    await expect.poll(async () => (await entryById(page, entryId)).note).toBe("dinner");
  });

  test("never from Ask: \"delete this entry\" is not drafted; Ask says why and opens Entries", async ({ page }) => {
    await stubModel(page, [{ action: "cannot_help", blocked: "delete_entry" }]);
    await page.goto(`/ask?view=person-tim&month=${MONTH}`);
    await send(page, "delete my last grab ride");
    await expect(page).toHaveURL(/\/entries\?/);
    await expect(page.locator("[data-change-draft]")).toHaveCount(0);
  });

  test("with AI off a change request is read by the rules: no change card, the one-line note, and nothing changes", async ({ page }) => {
    const description = `ZQXOFF ${Date.now()}`;
    const entryId = await createEntry(page, { description });
    await page.goto(`/ask?view=person-tim&month=${MONTH}`);
    await send(page, "make all zqxoff rides public transport");
    await expect(page.locator(".ask-note").filter({ hasText: "AI isn't available right now" })).toHaveCount(1);
    await expect(page.locator("[data-change-draft]")).toHaveCount(0);
    expect((await entryById(page, entryId)).categoryName).toBe("Food & Drinks");
  });
});
