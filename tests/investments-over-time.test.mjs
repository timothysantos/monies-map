// Investments over time (DOMAIN.md "Investments Over Time"): Summary's card
// from the statement values and this year's money put in, through the real
// Worker route and a real local D1 seeded with the demo household. The
// builder is called with a fixed day so the year is known; the route itself
// reads the household's real today.
import assert from "node:assert/strict";
import test from "node:test";

import { buildInvestmentsOverTimeDto } from "../src/domain/pages/investments-over-time.ts";
import { buildInvestmentsOverTime } from "../src/domain/investments-over-time.ts";
import { assertSameDatabase, createEntry, createSeededTemplate, dumpDatabase, openSeededDatabase } from "./support/d1-workspace.mjs";

const TODAY = "2026-11-10";
const TIM = "person-tim";
const JOYCE = "person-joyce";

let template;
test.before(async () => {
  template = await createSeededTemplate();
});
test.after(async () => {
  await template?.dispose();
});

async function createAccount(api, name, ownerPersonId) {
  const created = await api("/api/accounts/create", { name, institution: name.split(" ")[0], kind: "investment", currency: "SGD", openingBalanceMinor: 0, ownerPersonId });
  assert.equal(created.status, 200, JSON.stringify(created.payload));
}

async function linkedTransfer(api, { date, amountMinor, from, to, description, ownerName = "Tim" }) {
  const fromEntryId = await createEntry(api, { date, description, accountName: from, categoryName: "Transfer", entryType: "transfer", transferDirection: "out", amountMinor, ownerName });
  const toEntryId = await createEntry(api, { date, description, accountName: to, categoryName: "Transfer", entryType: "transfer", transferDirection: "in", amountMinor, ownerName });
  const linked = await api("/api/transfers/link", { fromEntryId, toEntryId });
  assert.equal(linked.status, 200, JSON.stringify(linked.payload));
  return { fromEntryId, toEntryId };
}

async function addValue(db, accountName, month, asOfDate, totalMinor, incomeMinor = 0) {
  const importId = `import-value-${accountName.split(" ")[0]}-${month}`.toLowerCase();
  await db.prepare("INSERT INTO imports (id, household_id, source_type, source_label, status) VALUES (?, 'household-1', 'pdf', ?, 'completed')")
    .bind(importId, `${accountName} ${month}.pdf`).run();
  await db.prepare(`
    INSERT INTO investment_statement_values (id, household_id, account_id, value_month, as_of_date, total_assets_minor, market_value_minor, income_minor, import_id)
    VALUES (?, 'household-1', (SELECT id FROM accounts WHERE account_name = ?), ?, ?, ?, ?, ?, ?)
  `).bind(`value-${importId}`, accountName, month, asOfDate, totalMinor, totalMinor, incomeMinor, importId).run();
}

// Tim's Endowus: worth $10,000 at the end of last year; $2,000 in (Feb),
// $500 back out (Apr), $1,000 in after its last statement (Oct), $100 moved
// to Joyce's StashAway (a pair between two investment accounts moves
// nothing), and $3,000 put in last December. Joyce's StashAway: first
// statement in June, $2,800 in (May, unlinked). Tim's IBKR: no statement,
// so not shown.
async function seed(api, db) {
  await createAccount(api, "Endowus Core", TIM);
  await createAccount(api, "StashAway General", JOYCE);
  await createAccount(api, "IBKR Brokerage", TIM);
  const ids = {};
  ids.lastYear = (await linkedTransfer(api, { date: "2025-12-20", amountMinor: 300_000, from: "UOB One", to: "Endowus Core", description: "Endowus top-up" })).toEntryId;
  ids.feb = (await linkedTransfer(api, { date: "2026-02-10", amountMinor: 200_000, from: "UOB One", to: "Endowus Core", description: "Endowus top-up" })).toEntryId;
  ids.apr = (await linkedTransfer(api, { date: "2026-04-20", amountMinor: 50_000, from: "Endowus Core", to: "UOB One", description: "Endowus withdrawal" })).fromEntryId;
  ids.oct = (await linkedTransfer(api, { date: "2026-10-05", amountMinor: 100_000, from: "UOB One", to: "Endowus Core", description: "Endowus top-up" })).toEntryId;
  await linkedTransfer(api, { date: "2026-07-01", amountMinor: 10_000, from: "Endowus Core", to: "StashAway General", description: "Endowus to StashAway" });
  ids.may = await createEntry(api, { date: "2026-05-28", description: "DEPOSIT - FAST", accountName: "StashAway General", categoryName: "Transfer", entryType: "transfer", transferDirection: "in", amountMinor: 280_000, ownerName: "Joyce" });
  await createEntry(api, { date: "2026-06-02", description: "IBKR deposit", accountName: "IBKR Brokerage", categoryName: "Transfer", entryType: "transfer", transferDirection: "in", amountMinor: 70_000 });
  await addValue(db, "Endowus Core", "2025-12", "2025-12-31", 1_000_000);
  await addValue(db, "Endowus Core", "2026-03", "2026-03-31", 1_250_000);
  await addValue(db, "Endowus Core", "2026-06", "2026-06-30", 1_400_000, 1_200);
  await addValue(db, "Endowus Core", "2026-09", "2026-09-30", 1_530_000, 800);
  await addValue(db, "StashAway General", "2026-06", "2026-06-30", 300_000);
  await addValue(db, "StashAway General", "2026-09", "2026-09-30", 330_000);
  return ids;
}

test("the household's card: worth, put in, grew by and paid out per account and added up, and the chart only at statement months", async (t) => {
  const { api, db } = await openSeededDatabase(t, template);
  const ids = await seed(api, db);
  const before = await dumpDatabase(db);
  const dto = await buildInvestmentsOverTimeDto(db, "household", TODAY);
  assertSameDatabase(await dumpDatabase(db), before);

  assert.equal(dto.year, "2026");
  assert.equal(dto.asOfDate, "2026-09-30");
  assert.deepEqual(dto.accounts.map((row) => [row.name, row.provider, row.personName]), [
    ["Endowus Core", "Endowus", "Tim"],
    ["StashAway General", "StashAway", "Joyce"]
  ]);
  const [endowus, stashaway] = dto.accounts;
  assert.deepEqual(endowus.putIn, { amountMinor: 250_000, ids: [ids.apr, ids.feb, ids.oct].sort() });
  assert.equal(endowus.worthMinor, 1_530_000);
  assert.equal(endowus.startWorthMinor, 1_000_000);
  // The October top-up came after the 30 Sep statement, so it is not growth lost.
  assert.equal(endowus.grewMinor, 1_530_000 - 1_000_000 - 150_000);
  assert.equal(endowus.paidOutMinor, 2_000);
  assert.equal(endowus.fromMonth, undefined);
  assert.deepEqual(stashaway.putIn, { amountMinor: 280_000, ids: [ids.may] });
  assert.equal(stashaway.fromMonth, "2026-06");
  assert.equal(stashaway.grewMinor, 50_000);

  assert.equal(dto.worthMinor, 1_860_000);
  assert.equal(dto.putIn.amountMinor, 530_000);
  assert.deepEqual(dto.putIn.ids, [ids.apr, ids.feb, ids.may, ids.oct].sort());
  assert.equal(dto.grewMinor, 430_000);
  assert.equal(dto.paidOutMinor, 2_000);

  const byMonth = Object.fromEntries(dto.months.map((month) => [month.month, month]));
  assert.equal(dto.months.length, 11);
  assert.deepEqual(dto.months.filter((month) => month.worthMinor !== null).map((month) => [month.month, month.worthMinor]), [
    ["2026-03", 1_250_000],
    ["2026-06", 1_700_000],
    ["2026-09", 1_860_000]
  ]);
  assert.equal(byMonth["2026-01"].putInMinor, 1_000_000);
  assert.equal(byMonth["2026-02"].putInMinor, 1_200_000);
  assert.equal(byMonth["2026-04"].putInMinor, 1_150_000);
  assert.equal(byMonth["2026-05"].putInMinor, 1_430_000);
  assert.equal(byMonth["2026-07"].putInMinor, 1_430_000);
  assert.equal(byMonth["2026-11"].putInMinor, 1_530_000);
});

test("a person view shows only that person's accounts; an unknown view is the household's", async (t) => {
  const { api, db } = await openSeededDatabase(t, template);
  await seed(api, db);
  const joyce = await buildInvestmentsOverTimeDto(db, JOYCE, TODAY);
  assert.equal(joyce.viewId, JOYCE);
  assert.deepEqual(joyce.accounts.map((row) => row.name), ["StashAway General"]);
  assert.equal(joyce.worthMinor, 330_000);
  assert.equal(joyce.putIn.amountMinor, 280_000);
  const stranger = await buildInvestmentsOverTimeDto(db, "person-nobody", TODAY);
  assert.equal(stranger.viewId, "household");
  assert.equal(stranger.accounts.length, 2);
});

test("no statement values: nothing to show, and the entries are never read", async (t) => {
  const { api, db } = await openSeededDatabase(t, template);
  await createAccount(api, "IBKR Brokerage", TIM);
  await createEntry(api, { date: "2026-06-02", description: "IBKR deposit", accountName: "IBKR Brokerage", categoryName: "Transfer", entryType: "transfer", transferDirection: "in", amountMinor: 70_000 });
  const statements = [];
  const counting = new Proxy(db, {
    get(target, key) {
      if (key === "prepare") return (sql) => { statements.push(sql); return target.prepare(sql); };
      const value = target[key];
      return typeof value === "function" ? value.bind(target) : value;
    }
  });
  const dto = await buildInvestmentsOverTimeDto(counting, "household", TODAY);
  assert.deepEqual(dto, { viewId: "household", today: TODAY, accounts: [] });
  assert.equal(statements.length, 3);
});

test("the route answers GET with Server-Timing first and refuses other methods", async (t) => {
  const { fetch } = await openSeededDatabase(t, template);
  const response = await fetch("/api/investments-over-time?view=household");
  assert.equal(response.status, 200);
  assert.match(response.headers.get("server-timing") ?? "", /^app;dur=/);
  const body = await response.json();
  assert.deepEqual(body.accounts, []);
  const post = await fetch("/api/investments-over-time", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
  assert.equal(post.status, 405);
});

test("a pair between two investment accounts and a contribution paid by an Investments expense", () => {
  const investmentAccountIds = new Set(["inv-a", "inv-b"]);
  const entries = [
    { id: "giro", date: "2026-03-03", accountId: "bank", entryType: "expense", amountMinor: 50_000, categoryName: "Investments", linkedTransfer: { transactionId: "in-a" } },
    { id: "in-a", date: "2026-03-03", accountId: "inv-a", entryType: "transfer", transferDirection: "in", amountMinor: 50_000, categoryName: "Transfer", linkedTransfer: { transactionId: "giro" } },
    { id: "a-out", date: "2026-04-01", accountId: "inv-a", entryType: "transfer", transferDirection: "out", amountMinor: 9_000, categoryName: "Transfer", linkedTransfer: { transactionId: "b-in" } },
    { id: "b-in", date: "2026-04-01", accountId: "inv-b", entryType: "transfer", transferDirection: "in", amountMinor: 9_000, categoryName: "Transfer", linkedTransfer: { transactionId: "a-out" } }
  ];
  const built = buildInvestmentsOverTime({
    today: "2026-05-01",
    accounts: [{ id: "inv-a", name: "A", provider: "A", personId: "p", personName: "P" }, { id: "inv-b", name: "B", provider: "B", personId: "p", personName: "P" }],
    values: [{ accountId: "inv-a", month: "2026-04", asOfDate: "2026-04-30", worthMinor: 52_000, paidOutMinor: 0 }],
    entries,
    investmentAccountIds
  });
  // B has no statement value, so it is not a row.
  assert.deepEqual(built.accounts.map((row) => [row.accountId, row.putIn]), [["inv-a", { amountMinor: 50_000, ids: ["giro"] }]]);
  assert.equal(built.grewMinor, 2_000);
  assert.equal(buildInvestmentsOverTime({ today: "2026-05-01", accounts: [], values: [], entries, investmentAccountIds }), null);
});
