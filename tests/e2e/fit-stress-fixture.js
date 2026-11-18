import { expect } from "@playwright/test";

import { postJson, reseedDemo } from "./helpers";

// A heavy household for the phone fit checks (fit-check.js), on the demo
// data only: 12 wallets with long names, long people names, 40 categories,
// merchant names of 60+ characters (some with no spaces), six-figure and
// long IDR amounts, a split group with a long name, and 25 entries that
// share one word for a bulk change. Tim has no cash wallet in Payment ways;
// Joyce has one. The app has two people; a third cannot be added.

export const STRESS = {
  month: new Date().toISOString().slice(0, 7),
  today: new Date().toISOString().slice(0, 10),
  tim: "Timothy Bartholomew Lim",
  joyce: "Joyce Evangeline Tan-Rodriguez",
  bulkWord: "ZQXSTRESSRIDE",
  longShop: "THE VERY LONG NAME OF A NEIGHBOURHOOD COFFEE ROASTERY AND BAKERY PTE LTD SINGAPORE",
  noSpaceShop: "PAYNOW-FAST-OTHR-PARCHMENT-REFERENCE-0000000000-SUPERCALIFRAGILISTIC",
  group: "Bali and Lombok family holiday with the grandparents and cousins",
  trip: "Bali and Lombok holiday with grandparents and all cousins",
  wallets: [
    "Tim's Everyday Multi-Currency Savings Account",
    "Joyce's Cashback Platinum Visa Signature Card",
    "Household Emergency Fund High-Yield Deposit",
    "Tim's Travel Miles World Elite Mastercard",
    "Joyce's Payroll Account With Bonus Interest",
    "Shared Grocery and Utilities Debit Card",
    "Joyce's Cash Envelope For Small Spending"
  ]
};

export async function seedStressHousehold(page) {
  await reseedDemo(page);
  const response = await page.request.post("/api/demo/reseed?fx_rate=IDR:14025");
  expect(response.ok(), await response.text()).toBeTruthy();
  await postJson(page, "/api/people/update", { personId: "person-tim", name: STRESS.tim });
  await postJson(page, "/api/people/update", { personId: "person-joyce", name: STRESS.joyce });

  const owners = ["person-tim", "person-joyce", "", "person-tim", "person-joyce", "", "person-joyce"];
  const ids = [];
  for (const [index, name] of STRESS.wallets.entries()) {
    const kind = name.includes("Card") && !name.includes("Debit") ? "credit_card" : name.includes("Cash Envelope") ? "cash" : "bank";
    const created = await postJson(page, "/api/accounts/create", {
      name, institution: kind === "cash" ? "Cash" : "Synthetic Test Bank", kind, currency: "SGD", openingBalanceMinor: 0, ownerPersonId: owners[index], isJoint: owners[index] === ""
    });
    ids.push(created.accountId);
  }
  // Joyce has a cash wallet; Tim has none.
  await postJson(page, "/api/settings/payment-ways/save", { personId: "person-joyce", bankTransferAccountId: "", cashAccountId: ids.at(-1) });

  for (const name of ["Kids' enrichment classes and weekend tuition", "Car park, ERP and petrol", "Pets", "Parents' allowance", "Home repairs and renovation", "Wedding and red packets"]) {
    await postJson(page, "/api/categories/create", { name, slug: name.toLowerCase().replace(/[^a-z]+/g, "-").replace(/^-|-$/g, ""), iconKey: "receipt", colorHex: "#566432" });
  }

  const entry = (fields) => postJson(page, "/api/entries/create", {
    date: STRESS.today, accountName: "UOB One", categoryName: "Food & Drinks", amountMinor: 1_000, entryType: "expense", ownershipType: "direct", ownerName: STRESS.tim, ...fields
  });
  await entry({ description: STRESS.longShop, amountMinor: 12_345_678, accountName: STRESS.wallets[0] });
  await entry({ description: STRESS.noSpaceShop, amountMinor: 4_311, categoryName: "Kids' enrichment classes and weekend tuition" });
  await entry({ description: "Salary credit with a long payroll reference 2026-11 BONUS", amountMinor: 12_345_678, entryType: "income", categoryName: "Salary", accountName: STRESS.wallets[4], ownerName: STRESS.joyce });
  for (let index = 0; index < 25; index += 1) {
    await entry({ description: `${STRESS.bulkWord} ${STRESS.longShop.slice(0, 30)} TRIP ${index + 1}`, amountMinor: 1_000 + index * 137 });
  }
  // "mixed" is the default kind of group (cash, ledger or mixed are allowed);
  // seeding fails loudly, so the fit checks always see the long group name.
  await postJson(page, "/api/splits/groups/create", { name: STRESS.group, currency: "SGD", expenseSource: "mixed" });

  // A trip with a long name and a long rupiah amount on it.
  const idr = await postJson(page, "/api/cash-entries/create", { requestId: crypto.randomUUID(), personId: "person-tim", way: "card", accountId: "acct-uob-one", amountMinor: 1_234_567_800, currency: "IDR" }).catch(() => null);
  const { tripEvent } = await postJson(page, "/api/trip-events/save", { name: STRESS.trip, startDate: `${STRESS.month}-01`, endDate: STRESS.today, currency: "IDR" });
  const tripEntries = (await (await page.request.get(`/api/entries-page?view=household&month=${STRESS.month}`)).json()).monthPage.entries
    .filter((item) => item.description.startsWith(STRESS.bulkWord)).slice(0, 6).map((item) => item.id);
  await postJson(page, "/api/trip-events/entries/set", { entryIds: [...tripEntries, ...(idr?.entry?.entryId ? [idr.entry.entryId] : [])], tripEventId: tripEvent.id });
  // The long names are what the screens are tested with: make sure they stuck.
  await expect.poll(async () => JSON.stringify(await (await page.request.get(`/api/app-shell?month=${STRESS.month}`)).json()).includes(STRESS.joyce)).toBe(true);
  return { walletIds: ids, tripEvent, idrEntryId: idr?.entry?.entryId ?? null };
}

const TOKEN = "mm_e2e_fit_stress";

/** `count` Apple Pay payments that arrived without an amount (Entries' Waiting Tap card). */
export async function addWaitingTaps(page, count) {
  const settings = await (await page.request.get("/api/settings-page?view=household")).json();
  const activeIds = settings.settingsPage.accounts.filter((account) => account.isActive).map((account) => account.id);
  await postJson(page, "/api/settings/shortcuts/save", { apiKey: TOKEN, defaultAccountPriorityIds: activeIds });
  for (let index = 0; index < count; index += 1) {
    const held = await page.request.post("/api/shortcuts/entries/create", {
      headers: { "X-Monies-Shortcut-Token": TOKEN },
      data: { amount: "", description: `${STRESS.longShop.slice(0, 50)} ${index + 1}`, name: STRESS.wallets[3], date: STRESS.today, requestId: `fit-tap-${Date.now()}-${index}`, clientVersion: "apple-pay-api-2026-11-17-v8" }
    });
    expect(held.status(), await held.text()).toBe(202);
  }
}

/** Card payments typed on the pad with no words (Ask's "need a few words" reminder). */
export async function addPaymentsNeedingWords(page, count) {
  for (let index = 0; index < count; index += 1) {
    await postJson(page, "/api/cash-entries/create", { requestId: crypto.randomUUID(), personId: "person-tim", way: "card", accountId: "acct-uob-one", amountMinor: 8_500_000 + index * 100_000, currency: "IDR" });
  }
}

/** The demo household emptied (the first-run state). */
export async function emptyHousehold(page) {
  const response = await page.request.post("/api/demo/empty");
  expect(response.ok(), await response.text()).toBeTruthy();
}
