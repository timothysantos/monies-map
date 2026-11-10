// Tax reliefs this year (DOMAIN.md "Tax Relief"): each person's SRS and CPF
// top-ups and charity gifts against the year's limits, the December
// reminder's facts, the dated limits list and its fallback, and the route
// through the real Worker and a real local D1 seeded with the demo household.
import assert from "node:assert/strict";
import test from "node:test";

import { buildTaxReliefsDto } from "../src/domain/pages/tax-reliefs.ts";
import { buildTaxReliefsYear, classifyTaxReliefRow, taxReliefDaysLeft, taxReliefRoomLeft } from "../src/domain/tax-reliefs.ts";
import { SG_TAX_RELIEF_LIMITS, taxReliefLimitsFor } from "../src/domain/sg-tax-relief-limits.ts";
import { seedEmptyStateReferenceData } from "../src/domain/app-repository-seed.ts";
import { assertSameDatabase, createEntry, createSeededTemplate, dumpDatabase, openSeededDatabase, rows } from "./support/d1-workspace.mjs";

const TIM = "person-tim";
const JOYCE = "person-joyce";
const PEOPLE = [{ id: TIM, name: "Tim" }, { id: JOYCE, name: "Joyce" }];

let template;
test.before(async () => {
  template = await createSeededTemplate();
});
test.after(async () => {
  await template?.dispose();
});

const row = (overrides) => ({ id: "e", date: "2026-03-01", entryType: "expense", transferDirection: null, amountMinor: 10_000, ownerPersonId: TIM, categoryName: "Groceries", purposeCategoryName: null, purposePersonId: null, ...overrides });

test("an entry counts by its category or its transfer's purpose, for its owner, money out only", () => {
  assert.deepEqual(classifyTaxReliefRow(row({ categoryName: "SRS top-up" })), { personId: TIM, kind: "srs" });
  assert.deepEqual(classifyTaxReliefRow(row({ categoryName: "srs Top Up" })), { personId: TIM, kind: "srs" });
  assert.deepEqual(classifyTaxReliefRow(row({ categoryName: "CPF top-up" })), { personId: TIM, kind: "cpf_self" });
  assert.deepEqual(classifyTaxReliefRow(row({ categoryName: "Charity gift" })), { personId: TIM, kind: "charity" });
  // A transfer out with the purpose, to someone else: for family.
  assert.deepEqual(classifyTaxReliefRow(row({ entryType: "transfer", transferDirection: "out", categoryName: "Transfer", purposeCategoryName: "CPF top-up", purposePersonId: JOYCE })), { personId: TIM, kind: "cpf_family" });
  // A transfer out filed under the category itself, with no purpose: for yourself.
  assert.deepEqual(classifyTaxReliefRow(row({ entryType: "transfer", transferDirection: "out", categoryName: "CPF top-up" })), { personId: TIM, kind: "cpf_self" });
  // Never: money in (a refund), the receiving side, no owner, another category, nothing paid.
  assert.equal(classifyTaxReliefRow(row({ entryType: "income", categoryName: "Charity gift" })), null);
  assert.equal(classifyTaxReliefRow(row({ entryType: "transfer", transferDirection: "in", purposeCategoryName: "CPF top-up", purposePersonId: JOYCE })), null);
  assert.equal(classifyTaxReliefRow(row({ ownerPersonId: null, categoryName: "SRS top-up" })), null);
  assert.equal(classifyTaxReliefRow(row({ categoryName: "Tax" })), null);
  assert.equal(classifyTaxReliefRow(row({ categoryName: "SRS top-up", amountMinor: 0 })), null);
  // A purpose only counts on a transfer: an expense's stray purpose is ignored.
  assert.deepEqual(classifyTaxReliefRow(row({ categoryName: "SRS top-up", purposeCategoryName: "CPF top-up", purposePersonId: JOYCE })), { personId: TIM, kind: "srs" });
});

test("each person's use against each limit, the room left, and charity counted at its multiplier", () => {
  const year = buildTaxReliefsYear({
    today: "2026-11-10",
    people: PEOPLE,
    rows: [
      row({ id: "srs-1", categoryName: "SRS top-up", amountMinor: 600_000 }),
      row({ id: "srs-2", categoryName: "SRS top-up", amountMinor: 400_000, date: "2026-10-01" }),
      row({ id: "srs-old", categoryName: "SRS top-up", amountMinor: 999_900, date: "2025-12-30" }),
      row({ id: "cpf-1", categoryName: "CPF top-up", amountMinor: 900_000 }),
      row({ id: "gift-1", categoryName: "Charity gift", amountMinor: 50_000 }),
      row({ id: "j-cpf", ownerPersonId: JOYCE, categoryName: "CPF top-up", amountMinor: 400_000 })
    ]
  });
  assert.equal(year.year, "2026");
  assert.equal(year.daysLeft, 51);
  assert.equal(year.limitsYear, "2026");
  assert.equal(year.limitsFallback, false);
  const [tim, joyce] = year.people;
  assert.deepEqual(tim.reliefs, [
    { key: "srs", amountMinor: 1_000_000, ids: ["srs-1", "srs-2"], limitMinor: 1_530_000, roomMinor: 530_000 },
    // Over the limit: no room, never below zero.
    { key: "cpf_self", amountMinor: 900_000, ids: ["cpf-1"], limitMinor: 800_000, roomMinor: 0 },
    { key: "cpf_family", amountMinor: 0, ids: [], limitMinor: 800_000, roomMinor: 800_000 }
  ]);
  assert.deepEqual(tim.charity, { amountMinor: 50_000, ids: ["gift-1"], deductionMinor: 125_000 });
  assert.equal(joyce.reliefs[1].roomMinor, 400_000);
  assert.equal(joyce.charity.amountMinor, 0);
});

test("the December reminder names only reliefs started and not full, and only in December", () => {
  const rows = [
    row({ id: "srs-1", categoryName: "SRS top-up", amountMinor: 1_000_000, date: "2026-02-01" }),
    row({ id: "cpf-1", categoryName: "CPF top-up", amountMinor: 800_000, date: "2026-02-01" }),
    row({ id: "j-cpf", ownerPersonId: JOYCE, categoryName: "CPF top-up", amountMinor: 400_000, date: "2026-02-01" })
  ];
  const december = buildTaxReliefsYear({ today: "2026-12-01", people: PEOPLE, rows });
  assert.deepEqual(taxReliefRoomLeft(december, "2026-12-01"), [
    { personId: TIM, name: "Tim", key: "srs", roomMinor: 530_000 },
    { personId: JOYCE, name: "Joyce", key: "cpf_self", roomMinor: 400_000 }
  ]);
  assert.equal(taxReliefRoomLeft(december, "2026-12-31").length, 2);
  // November: not yet. Another year's facts: never.
  assert.deepEqual(taxReliefRoomLeft(buildTaxReliefsYear({ today: "2026-11-30", people: PEOPLE, rows }), "2026-11-30"), []);
  assert.deepEqual(taxReliefRoomLeft(december, "2027-12-01"), []);
  // Every limit full: nothing to say.
  const full = buildTaxReliefsYear({ today: "2026-12-05", people: PEOPLE, rows: [row({ categoryName: "SRS top-up", amountMinor: 1_530_000, date: "2026-03-01" })] });
  assert.deepEqual(taxReliefRoomLeft(full, "2026-12-05"), []);
});

test("the limits are one dated list; a year it does not know reads the latest known year, marked", () => {
  for (const entry of SG_TAX_RELIEF_LIMITS) {
    assert.ok(entry.source.length > 0, `${entry.year} names its source`);
  }
  assert.deepEqual(taxReliefLimitsFor(2026), { ...SG_TAX_RELIEF_LIMITS.find((entry) => entry.year === 2026), fallback: false });
  const later = taxReliefLimitsFor(2031);
  assert.equal(later.fallback, true);
  assert.equal(later.year, Math.max(...SG_TAX_RELIEF_LIMITS.map((entry) => entry.year)));
  const list = [{ year: 2024, srsMinor: 1, cpfSelfMinor: 2, cpfFamilyMinor: 3, charityTimes: 2.5, source: "x" }, { year: 2026, srsMinor: 4, cpfSelfMinor: 5, cpfFamilyMinor: 6, charityTimes: 2.5, source: "y" }];
  assert.equal(taxReliefLimitsFor(2025, list).srsMinor, 1);
  assert.equal(taxReliefLimitsFor(2023, list).fallback, true);
  assert.equal(buildTaxReliefsYear({ today: "2031-03-01", people: PEOPLE, rows: [] }).limitsFallback, true);
  assert.equal(taxReliefDaysLeft("2026-12-31"), 0);
  assert.equal(taxReliefDaysLeft("2026-01-01"), 364);
});

async function seedReliefs(api) {
  const joyceBank = await api("/api/accounts/create", { name: "Joyce OCBC", institution: "OCBC", kind: "bank", currency: "SGD", openingBalanceMinor: 0, ownerPersonId: JOYCE });
  assert.equal(joyceBank.status, 200, JSON.stringify(joyceBank.payload));
  const ids = {};
  ids.srs = await createEntry(api, { date: "2026-03-15", description: "SRS CONTRIBUTION", categoryName: "SRS top-up", amountMinor: 1_000_000 });
  ids.cpfSelf = await createEntry(api, { date: "2026-04-02", description: "CPF BOARD TOPUP", categoryName: "CPF top-up", amountMinor: 800_000 });
  ids.gift = await createEntry(api, { date: "2026-06-20", description: "GIVING.SG", categoryName: "Charity gift", amountMinor: 50_000, accountName: "Citi Rewards", ownerName: "Joyce" });
  // Tim sends Joyce money for her CPF: a transfer with that purpose.
  const out = await createEntry(api, { date: "2026-05-05", description: "TO JOYCE CPF", categoryName: "Transfer", entryType: "transfer", transferDirection: "out", amountMinor: 300_000 });
  const into = await createEntry(api, { date: "2026-05-05", description: "FROM TIM", accountName: "Joyce OCBC", ownerName: "Joyce", categoryName: "Transfer", entryType: "transfer", transferDirection: "in", amountMinor: 300_000 });
  assert.equal((await api("/api/transfers/link", { fromEntryId: out, toEntryId: into })).status, 200);
  const purpose = await api("/api/transfers/purpose", { entryId: out, categoryName: "CPF top-up" });
  assert.equal(purpose.status, 200, JSON.stringify(purpose.payload));
  ids.cpfFamily = out;
  // Last year's top-up and a refund never count.
  await createEntry(api, { date: "2025-12-28", description: "SRS CONTRIBUTION", categoryName: "SRS top-up", amountMinor: 500_000 });
  await createEntry(api, { date: "2026-07-01", description: "GIVING.SG REFUND", categoryName: "Charity gift", entryType: "income", amountMinor: 5_000, accountName: "Citi Rewards", ownerName: "Joyce" });
  return ids;
}

test("the route's card: each person's reliefs from real entries, a person view alone, and nothing written", async (t) => {
  const { api, db, fetch } = await openSeededDatabase(t, template);
  const ids = await seedReliefs(api);
  const before = await dumpDatabase(db);
  const dto = await buildTaxReliefsDto(db, "household", "2026-11-10");
  assertSameDatabase(await dumpDatabase(db), before);
  assert.deepEqual(dto.people.map((person) => person.name), ["Tim", "Joyce"]);
  const [tim, joyce] = dto.people;
  assert.deepEqual(tim.reliefs.map((relief) => [relief.key, relief.amountMinor, relief.ids]), [
    ["srs", 1_000_000, [ids.srs]],
    ["cpf_self", 800_000, [ids.cpfSelf]],
    ["cpf_family", 300_000, [ids.cpfFamily]]
  ]);
  assert.deepEqual(joyce.charity, { amountMinor: 50_000, ids: [ids.gift], deductionMinor: 125_000 });
  assert.equal(dto.charityTimes, 2.5);

  const joyceView = await buildTaxReliefsDto(db, JOYCE, "2026-11-10");
  assert.deepEqual(joyceView.people.map((person) => person.name), ["Joyce"]);

  const response = await fetch("/api/tax-reliefs?view=household");
  assert.equal(response.status, 200);
  assert.match(response.headers.get("server-timing") ?? "", /^app;dur=/);
  assert.equal((await fetch("/api/tax-reliefs", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" })).status, 405);
});

test("no relief this year: no card, in the household view and in a person view with none of their own", async (t) => {
  const { api, db } = await openSeededDatabase(t, template);
  assert.deepEqual(await buildTaxReliefsDto(db, "household", "2026-11-10"), { viewId: "household", today: "2026-11-10", people: [] });
  await createEntry(api, { date: "2026-06-20", description: "GIVING.SG", categoryName: "Charity gift", amountMinor: 50_000, accountName: "Citi Rewards", ownerName: "Joyce" });
  assert.equal((await buildTaxReliefsDto(db, "household", "2026-11-10")).people.length, 2);
  assert.deepEqual((await buildTaxReliefsDto(db, TIM, "2026-11-10")).people, []);
});

test("the three categories reach an existing household once, and a household's own same-named category is kept", async (t) => {
  const { db } = await openSeededDatabase(t, template);
  const names = async () => (await rows(db, "SELECT id, name FROM categories WHERE slug IN ('srs-top-up', 'cpf-top-up', 'charity-gift') ORDER BY slug")).map((item) => `${item.id}:${item.name}`);
  assert.deepEqual(await names(), ["cat-charity-gift:Charity gift", "cat-cpf-top-up:CPF top-up", "cat-srs-top-up:SRS top-up"]);
  await db.prepare("DELETE FROM categories WHERE id IN ('cat-srs-top-up', 'cat-cpf-top-up', 'cat-charity-gift')").run();
  // The household made its own Charity gift category before the default arrived.
  await db.prepare("INSERT INTO categories (id, household_id, name, slug, reporting_group) VALUES ('cat-mine', 'household-1', 'Charity gift', 'charity-gift', 'charity-gift')").run();
  await seedEmptyStateReferenceData(db);
  assert.deepEqual(await names(), ["cat-mine:Charity gift", "cat-cpf-top-up:CPF top-up", "cat-srs-top-up:SRS top-up"]);
  await seedEmptyStateReferenceData(db);
  assert.equal((await names()).length, 3);
});
