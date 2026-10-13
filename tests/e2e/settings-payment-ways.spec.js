// Settings -> Payment ways: per person, the account a typed "paynow" or
// "cash" goes to. Each select saves straight away, survives a reload, and a
// typed sentence then uses it through the entry draft route. Phone and
// desktop layouts both fit.
import { expect, test } from "@playwright/test";

import { postJson, reseedDemo } from "./helpers.js";

async function openPaymentWays(page) {
  await page.goto("/settings?view=household");
  await page.getByRole("button", { name: /Payment ways/ }).click();
  return {
    person: (name) => page.getByRole("group", { name }),
    status: page.locator(".settings-payment-ways .settings-shortcut-status")
  };
}

async function createAccount(page, input) {
  const created = await postJson(page, "/api/accounts/create", { currency: "SGD", ...input });
  return created.accountId;
}

test("each person's payment ways are chosen in Settings, kept, and used by a typed sentence", async ({ page }) => {
  await reseedDemo(page);
  const purse = await createAccount(page, { name: "Joyce Purse", institution: "Pocket", kind: "cash", ownerPersonId: "person-joyce" });

  const section = await openPaymentWays(page);
  const tim = section.person("Tim");
  const joyce = section.person("Joyce");
  // Defaults: Tim's own bank account; Joyce owns none, so none.
  await expect(tim.getByLabel("PayNow and bank transfers").locator("option:checked")).toHaveText("UOB Savings (Tim)");
  await expect(tim.getByLabel("Cash").locator("option:checked")).toHaveText("None");
  await expect(joyce.getByLabel("PayNow and bank transfers")).toHaveValue("");
  // Bank accounts only, Joyce's own first: no cards in the list.
  await expect(joyce.getByLabel("PayNow and bank transfers").locator("option")).toHaveText([
    "None",
    "Household Float (Shared)",
    "UOB Savings (Tim)"
  ]);
  await expect(joyce.getByLabel("Cash").locator("option")).toHaveText(["None", "Joyce Purse (Joyce)"]);

  await joyce.getByLabel("PayNow and bank transfers").selectOption({ label: "Household Float (Shared)" });
  await expect(section.status).toHaveText("Joyce's payment ways saved.");
  await joyce.getByLabel("Cash").selectOption({ label: "Joyce Purse (Joyce)" });
  await expect(section.status).toHaveText("Joyce's payment ways saved.");

  await page.reload();
  const reloaded = await openPaymentWays(page);
  await expect(reloaded.person("Joyce").getByLabel("PayNow and bank transfers")).toHaveValue("acct-household");
  await expect(reloaded.person("Joyce").getByLabel("Cash")).toHaveValue(purse);

  const draft = async (text, viewId) => (await postJson(page, "/api/ai-assist/entry-draft", { text, viewId })).draft;
  const paynow = await draft("lunch at nasi lemak bmv 7.20, paynow, mine", "person-joyce");
  expect(paynow.fields.accountId).toEqual({ value: "acct-household", source: "rule" });
  expect(paynow.createBody).toMatchObject({ description: "lunch at nasi lemak bmv", amountMinor: 720, ownerName: "Joyce" });
  expect((await draft("taxi 15 cash", "person-joyce")).fields.accountId).toEqual({ value: purse, source: "rule" });
  expect((await draft("kopi 2.40 paynow", "person-tim")).fields.accountId).toEqual({ value: "acct-uob-savings", source: "rule" });
});

test("negative: a refused choice shows the reason and puts the select back", async ({ page }) => {
  await reseedDemo(page);
  const spare = await createAccount(page, { name: "Spare Bank", institution: "OCBC", kind: "bank", ownerPersonId: "person-joyce" });
  const section = await openPaymentWays(page);
  const joyceBank = section.person("Joyce").getByLabel("PayNow and bank transfers");
  await expect(joyceBank).toHaveValue(spare);
  await joyceBank.selectOption({ label: "None" });
  await expect(section.status).toHaveText("Joyce's payment ways saved.");

  // Archived after the page loaded, so the stale option is still listed.
  await postJson(page, "/api/accounts/archive", { accountId: spare });
  await joyceBank.selectOption({ label: "Spare Bank (Joyce)" });
  await expect(page.locator(".settings-payment-ways .form-error")).toHaveText("Choose an active bank account for PayNow and bank transfers.");
  await expect(joyceBank).toHaveValue("");
});

for (const viewport of [
  { name: "phone", size: { width: 390, height: 844 } },
  { name: "desktop", size: { width: 1280, height: 900 } }
]) {
  test(`the payment ways section fits a ${viewport.name}`, async ({ page }) => {
    await page.setViewportSize(viewport.size);
    await reseedDemo(page);
    await createAccount(page, { name: "Tim Wallet", institution: "Pocket", kind: "cash", ownerPersonId: "person-tim" });
    const section = await openPaymentWays(page);
    const tim = section.person("Tim");
    // Two Detail rows, one under the other, on a phone and on a computer.
    const bank = await tim.getByLabel("PayNow and bank transfers").boundingBox();
    const cash = await tim.getByLabel("Cash").boundingBox();
    expect(cash.y).toBeGreaterThan(bank.y + bank.height - 1);
    expect(bank.height).toBeGreaterThanOrEqual(44);
    expect(cash.height).toBeGreaterThanOrEqual(44);
    expect(cash.x + cash.width).toBeLessThanOrEqual(viewport.size.width);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);

    await tim.getByLabel("Cash").selectOption({ label: "Tim Wallet (Tim)" });
    await expect(section.status).toHaveText("Tim's payment ways saved.");
  });
}
