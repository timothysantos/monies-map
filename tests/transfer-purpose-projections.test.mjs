// Transfer purpose through the real Worker and a local D1 (DOMAIN.md
// "Transfer Purpose"): the owner's case end to end. Tim moves $450 from UOB
// Savings to Joyce's bank account each month and the bank takes the $900
// house loan from Joyce's account. With "What is this for?" set to Home:
// - Tim's Summary, Month (spend, Home, his "House loan" plan line) and stored
//   month total rise by $450; Joyce's Home falls by $450;
// - every household figure is the same as without the purpose;
// - the two people add up to the household, category by category;
// - the write is all-or-nothing, refusals change nothing, and the next
//   month's transfer gets the same purpose by itself until it is undone.
import assert from "node:assert/strict";
import test from "node:test";

import {
  assertSameDatabase,
  createEntry,
  createSeededTemplate,
  dumpDatabase,
  failingStatement,
  openSeededDatabase,
  rows,
  snapshotTotals
} from "./support/d1-workspace.mjs";

let template;
test.before(async () => {
  template = await createSeededTemplate();
});
test.after(async () => {
  await template?.dispose();
});

const MONTH = "2026-10";
const VIEWS = ["household", "person-tim", "person-joyce"];

async function get(api, pathname) {
  const response = await api(pathname);
  assert.equal(response.status, 200, JSON.stringify(response.payload));
  return response.payload;
}

// Joyce's bank account (the demo household gives her cards only), Joyce's
// $900 loan debit on it, Tim's linked $450 transfer to it, and Tim's dated
// "House loan" plan line.
async function seedOwnerCase(db, api, { month = MONTH, loanDay = "05", withPlan = true } = {}) {
  const [{ id: householdId }] = await rows(db, "SELECT id FROM households LIMIT 1");
  const [{ institution_id: institutionId }] = await rows(db, "SELECT institution_id FROM accounts WHERE id = 'acct-uob-savings'");
  await db.prepare("INSERT OR IGNORE INTO accounts (id, household_id, institution_id, owner_person_id, account_name, account_kind, currency) VALUES ('acct-joyce-bank', ?, ?, 'person-joyce', 'Joyce Bank', 'bank', 'SGD')")
    .bind(householdId, institutionId).run();
  const loanId = await createEntry(api, { date: `${month}-${loanDay}`, description: "HDB loan GIRO", accountName: "Joyce Bank", categoryName: "Home", amountMinor: 90_000, ownerName: "Joyce" });
  const pair = await transferPair(api, `${month}-01`);
  if (withPlan) {
    const save = await api("/api/month-plan/save", {
      rowId: `plan-house-loan-${month}`, month, sectionKey: "planned_items", categoryName: "Home", label: "House loan",
      planDate: `${month}-01`, accountName: "UOB Savings", plannedMinor: 45_000, ownershipType: "direct", ownerName: "Tim"
    });
    assert.equal(save.status, 200, JSON.stringify(save.payload));
  }
  return { loanId, ...pair };
}

async function transferPair(api, date, { amountMinor = 45_000, description = "FAST to Joyce" } = {}) {
  const outId = await createEntry(api, { date, description, accountName: "UOB Savings", categoryName: "Transfer", amountMinor, entryType: "transfer", transferDirection: "out", ownerName: "Tim" });
  const inId = await createEntry(api, { date, description: "FAST from Tim", accountName: "Joyce Bank", categoryName: "Transfer", amountMinor, entryType: "transfer", transferDirection: "in", ownerName: "Joyce" });
  const link = await api("/api/transfers/link", { fromEntryId: outId, toEntryId: inId });
  assert.equal(link.status, 200, JSON.stringify(link.payload));
  return { outId, inId };
}

const chartMinor = (chart, label) => chart.find((item) => item.label === label)?.valueMinor ?? 0;
const withoutPurposeField = (value) => JSON.parse(JSON.stringify(value, (key, field) => (key === "transferPurpose" ? undefined : field)));

// What one view shows for the month: Summary, Month and the Entries list.
async function readView(api, view, month = MONTH) {
  const summary = await get(api, `/api/summary-page?view=${view}&month=${month}&scope=direct_plus_shared&summary_start=${month}&summary_end=${month}`);
  const monthPage = await get(api, `/api/month-page?view=${view}&month=${month}&scope=direct_plus_shared`);
  const entries = await get(api, `/api/entries-page?view=${view}&month=${month}`);
  return { summary, monthPage, entries };
}

function figures({ summary, monthPage }) {
  const summaryMonth = summary.summaryPage.months.find((item) => item.month === MONTH);
  const houseLoan = monthPage.monthPage.planSections.find((section) => section.key === "planned_items").rows.find((row) => row.label === "House loan");
  return {
    summarySpend: summaryMonth.realExpensesMinor,
    summaryIncome: summaryMonth.actualIncomeMinor,
    summaryHome: chartMinor(summary.summaryPage.categoryShareChart, "Home"),
    monthSpend: monthPage.monthPage.metricCards.find((card) => card.label === "Actual spend").amountMinor,
    monthHome: chartMinor(monthPage.monthPage.categoryShareChart, "Home"),
    houseLoanActual: houseLoan?.actualMinor ?? null
  };
}

test("owner case: Tim's view rises by $450 in Home and pays House loan, Joyce's Home falls by $450, the household is unchanged", async (t) => {
  const { db, api } = await openSeededDatabase(t, template);
  const { outId } = await seedOwnerCase(db, api);
  const link = await api("/api/month-plan/links", { rowId: `plan-house-loan-${MONTH}`, month: MONTH, transactionIds: [outId] });
  assert.equal(link.status, 400, "a plain transfer cannot pay a plan line");

  const before = Object.fromEntries(await Promise.all(VIEWS.map(async (view) => [view, await readView(api, view)])));
  const storedBefore = await snapshotTotals(db, MONTH);

  const set = await api("/api/transfers/purpose", { entryId: outId, categoryName: "Home" });
  assert.deepEqual([set.status, set.payload], [200, { ok: true, entryId: outId, categoryName: "Home", updated: true }]);

  // Invariant 1: every household figure is the same; only the entry rows
  // carry the new field.
  const householdWithPurpose = await readView(api, "household");
  assert.deepEqual(withoutPurposeField(householdWithPurpose), withoutPurposeField(before.household));

  // Tim's view: the transfer now pays his dated plan line.
  const linked = await api("/api/month-plan/links", { rowId: `plan-house-loan-${MONTH}`, month: MONTH, transactionIds: [outId] });
  assert.equal(linked.status, 200, JSON.stringify(linked.payload));

  const after = Object.fromEntries(await Promise.all(VIEWS.map(async (view) => [view, await readView(api, view)])));
  const tim = { before: figures(before["person-tim"]), after: figures(after["person-tim"]) };
  const joyce = { before: figures(before["person-joyce"]), after: figures(after["person-joyce"]) };

  assert.deepEqual(tim.after, {
    ...tim.before,
    summarySpend: tim.before.summarySpend + 45_000,
    summaryHome: tim.before.summaryHome + 45_000,
    monthSpend: tim.before.monthSpend + 45_000,
    monthHome: tim.before.monthHome + 45_000,
    houseLoanActual: 45_000
  });
  assert.equal(tim.before.houseLoanActual, 0);
  assert.deepEqual(joyce.after, {
    ...joyce.before,
    summarySpend: joyce.before.summarySpend - 45_000,
    summaryHome: joyce.before.summaryHome - 45_000,
    monthSpend: joyce.before.monthSpend - 45_000,
    monthHome: joyce.before.monthHome - 45_000
  });
  assert.equal(joyce.after.summaryIncome, joyce.before.summaryIncome, "a contribution is not Joyce's income");

  assert.deepEqual(figures(after.household), figures(before.household), "the household plan line counts expenses only, as before");

  // Invariant 2: the people add up to the household in every category.
  const categories = new Set(VIEWS.flatMap((view) => after[view].summary.summaryPage.categoryShareChart.map((item) => item.label)));
  for (const category of categories) {
    const people = chartMinor(after["person-tim"].summary.summaryPage.categoryShareChart, category)
      + chartMinor(after["person-joyce"].summary.summaryPage.categoryShareChart, category);
    assert.equal(people, chartMinor(after.household.summary.summaryPage.categoryShareChart, category), category);
  }
  assert.equal(figures(after["person-tim"]).summarySpend + figures(after["person-joyce"]).summarySpend, figures(after.household).summarySpend);

  // The stored month totals move the same way; the household's does not.
  const storedAfter = Object.fromEntries((await snapshotTotals(db, MONTH)).map((row) => [row.person_scope, row.total_expense_minor]));
  const storedBeforeByScope = Object.fromEntries(storedBefore.map((row) => [row.person_scope, row.total_expense_minor]));
  assert.deepEqual(storedAfter, {
    household: storedBeforeByScope.household,
    "person-tim": storedBeforeByScope["person-tim"] + 45_000,
    "person-joyce": storedBeforeByScope["person-joyce"] - 45_000
  });

  // The Entries list keeps the ledger facts (a transfer out), with its purpose.
  const listed = after["person-tim"].entries.monthPage.entries.find((entry) => entry.id === outId);
  assert.deepEqual(
    { entryType: listed.entryType, transferDirection: listed.transferDirection, categoryName: listed.categoryName, transferPurpose: listed.transferPurpose },
    { entryType: "transfer", transferDirection: "out", categoryName: "Transfer", transferPurpose: { categoryName: "Home", toPersonId: "person-joyce", toPersonName: "Joyce" } }
  );
  const [audit] = await rows(db, "SELECT action, detail FROM audit_events WHERE entity_id = ? AND action LIKE 'transfer_purpose%' ORDER BY rowid DESC LIMIT 1", outId);
  assert.deepEqual(audit, { action: "transfer_purpose_set", detail: "FAST to Joyce on 2026-10-01 pays for Home." });
});

test("clearing the purpose brings every view back to exactly what it was", async (t) => {
  const { db, api } = await openSeededDatabase(t, template);
  const { outId } = await seedOwnerCase(db, api, { withPlan: false });
  const before = await Promise.all(VIEWS.map((view) => readView(api, view)));
  await api("/api/transfers/purpose", { entryId: outId, categoryName: "Home" });
  const cleared = await api("/api/transfers/purpose", { entryId: outId, categoryName: null });
  assert.deepEqual(cleared.payload, { ok: true, entryId: outId, categoryName: null, updated: true });
  assert.deepEqual(await Promise.all(VIEWS.map((view) => readView(api, view))), before);
  assert.deepEqual(await rows(db, "SELECT transfer_purpose_category_id, transfer_purpose_person_id, transfer_purpose_source FROM transactions WHERE id = ?", outId), [
    { transfer_purpose_category_id: null, transfer_purpose_person_id: null, transfer_purpose_source: null }
  ]);
});

test("a write that fails part way changes nothing, and a refused one writes nothing", async (t) => {
  const { db, api } = await openSeededDatabase(t, template);
  const { outId, inId } = await seedOwnerCase(db, api, { withPlan: false });
  const before = await dumpDatabase(db);

  for (const pattern of [/INSERT INTO audit_events/, /INSERT INTO monthly_snapshot_refreshes/]) {
    const faulty = failingStatement(db, pattern);
    const failed = await api("/api/transfers/purpose", { entryId: outId, categoryName: "Home" }, { database: faulty.db });
    assert.equal(faulty.state.fired, true, String(pattern));
    assert.equal(failed.status, 500);
    assertSameDatabase(await dumpDatabase(db), before);
  }

  const refusals = [
    [{ entryId: inId, categoryName: "Home" }, "Only money sent to someone in the household can say what it is for. Open the sending side of this transfer."],
    [{ entryId: outId, categoryName: "Savings" }, "Savings is not spending, so a transfer can't be for it. Choose a category like Home."],
    [{ entryId: outId, categoryName: "No such category" }, "Choose a category from the list."],
    [{ entryId: "txn-missing", categoryName: "Home" }, "Entry not found."]
  ];
  for (const [body, error] of refusals) {
    assert.deepEqual(await api("/api/transfers/purpose", body), { status: 400, payload: { ok: false, error } });
  }
  assert.equal((await api("/api/transfers/purpose", { entryId: outId })).status, 400);
  assertSameDatabase(await dumpDatabase(db), before);
});

test("a move between Tim's own accounts cannot have a purpose", async (t) => {
  const { db, api } = await openSeededDatabase(t, template);
  const outId = await createEntry(api, { date: "2026-10-03", description: "Card bill", accountName: "UOB Savings", categoryName: "Transfer", amountMinor: 20_000, entryType: "transfer", transferDirection: "out" });
  const inId = await createEntry(api, { date: "2026-10-03", description: "Card bill paid", accountName: "UOB One", categoryName: "Transfer", amountMinor: 20_000, entryType: "transfer", transferDirection: "in" });
  const unlinked = await api("/api/transfers/purpose", { entryId: outId, categoryName: "Home" });
  assert.equal(unlinked.payload.error, "Match this transfer with the account it went to first, so the app knows who it was for.");
  await api("/api/transfers/link", { fromEntryId: outId, toEntryId: inId });
  const before = await dumpDatabase(db);
  assert.deepEqual(await api("/api/transfers/purpose", { entryId: outId, categoryName: "Home" }), { status: 400, payload: { ok: false, error: "A move between your own accounts stays a transfer." } });
  assertSameDatabase(await dumpDatabase(db), before);
});

test("a purpose transfer is not a settle-up: matching it to a checkpoint is refused, and a settle-up gets no purpose", async (t) => {
  const { db, api } = await openSeededDatabase(t, template);
  const { outId, inId } = await seedOwnerCase(db, api, { withPlan: false });
  await api("/api/transfers/purpose", { entryId: outId, categoryName: "Home" });
  const [{ id: householdId }] = await rows(db, "SELECT id FROM households LIMIT 1");
  await db.prepare("INSERT INTO split_settlement_checkpoints (id, household_id, from_person_id, to_person_id, amount_minor, settlement_date, status) VALUES ('cp-test', ?, 'person-tim', 'person-joyce', 45000, '2026-10-01', 'open')")
    .bind(householdId).run();
  const before = await dumpDatabase(db);
  for (const transactionId of [outId, inId]) {
    const refused = await api("/api/splits/checkpoints/match", { checkpointId: "cp-test", transactionId });
    assert.deepEqual(refused.payload, { ok: false, error: "This transfer pays for Home. Clear \"What is this for?\" first to use it as a settle-up." });
  }
  assertSameDatabase(await dumpDatabase(db), before);
  // Without the purpose the same match goes through, as before.
  await api("/api/transfers/purpose", { entryId: outId, categoryName: null });
  assert.equal((await api("/api/splits/checkpoints/match", { checkpointId: "cp-test", transactionId: outId })).status, 200);

  // The other way round: a transfer used as a settle-up cannot get a purpose.
  assert.deepEqual((await api("/api/transfers/purpose", { entryId: outId, categoryName: "Home" })).payload, {
    ok: false,
    error: "This transfer is a settle-up on Splits. Remove it from the settle-up first."
  });
  const pair = await transferPair(api, "2026-10-09", { amountMinor: 12_345, description: "Settle up" });
  await db.prepare("INSERT INTO split_settlements (id, household_id, settlement_date, from_person_id, to_person_id, amount_minor, linked_transaction_id) VALUES ('settle-test', ?, '2026-10-09', 'person-tim', 'person-joyce', 12345, ?)")
    .bind(householdId, pair.inId).run();
  assert.deepEqual((await api("/api/transfers/purpose", { entryId: pair.outId, categoryName: "Home" })).payload, {
    ok: false,
    error: "This transfer is a settle-up on Splits. Remove it from the settle-up first."
  });
});

test("relinking: the purpose follows the other side's owner, and a type change away from transfer out clears it", async (t) => {
  const { db, api } = await openSeededDatabase(t, template);
  const { outId } = await seedOwnerCase(db, api, { withPlan: false });
  await api("/api/transfers/purpose", { entryId: outId, categoryName: "Home" });
  // Relinked to Tim's own card: no longer between two people.
  const ownIn = await createEntry(api, { date: "2026-10-01", description: "Into my card", accountName: "UOB One", categoryName: "Transfer", amountMinor: 45_000, entryType: "transfer", transferDirection: "in" });
  await api("/api/transfers/link", { fromEntryId: outId, toEntryId: ownIn });
  assert.deepEqual(await rows(db, "SELECT transfer_purpose_category_id FROM transactions WHERE id = ?", outId), [{ transfer_purpose_category_id: null }]);

  const second = await transferPair(api, "2026-10-12", { amountMinor: 5_000, description: "FAST to Joyce groceries" });
  await api("/api/transfers/purpose", { entryId: second.outId, categoryName: "Groceries" });
  const reclassified = await api("/api/entries/update-classification", { entryId: second.outId, entryType: "expense", categoryName: "Groceries" });
  assert.equal(reclassified.status, 200, JSON.stringify(reclassified.payload));
  assert.deepEqual(await rows(db, "SELECT entry_type, transfer_purpose_category_id FROM transactions WHERE id = ?", second.outId), [{ entry_type: "expense", transfer_purpose_category_id: null }]);
});

test("learning: next month's transfer gets the purpose by itself, shown as set like last month; after Undo the next one does not", async (t) => {
  const { db, api } = await openSeededDatabase(t, template);
  const { outId } = await seedOwnerCase(db, api, { withPlan: false });
  await api("/api/transfers/purpose", { entryId: outId, categoryName: "Home" });

  // November: imported or typed, before the other side is even matched.
  const november = await createEntry(api, { date: "2026-11-01", description: "FAST to Joyce", accountName: "UOB Savings", categoryName: "Transfer", amountMinor: 45_000, entryType: "transfer", transferDirection: "out", ownerName: "Tim" });
  assert.deepEqual(await rows(db, "SELECT transfer_purpose_person_id, transfer_purpose_source FROM transactions WHERE id = ?", november), [
    { transfer_purpose_person_id: "person-joyce", transfer_purpose_source: "remembered" }
  ]);
  const listed = (await get(api, "/api/entries-page?view=person-tim&month=2026-11")).monthPage.entries.find((entry) => entry.id === november);
  assert.deepEqual(listed.transferPurpose, { categoryName: "Home", toPersonId: "person-joyce", toPersonName: "Joyce", remembered: true });
  const [audit] = await rows(db, "SELECT action FROM audit_events WHERE entity_id = ? ORDER BY rowid DESC LIMIT 1", november);
  assert.equal(audit.action, "transfer_purpose_remembered");
  const timNovember = await get(api, "/api/month-page?view=person-tim&month=2026-11&scope=direct_plus_shared");
  assert.equal(chartMinor(timNovember.monthPage.categoryShareChart, "Home"), 45_000);

  // Undo November: December's is left alone.
  await api("/api/transfers/purpose", { entryId: november, categoryName: null });
  const december = await createEntry(api, { date: "2026-12-01", description: "FAST to Joyce", accountName: "UOB Savings", categoryName: "Transfer", amountMinor: 45_000, entryType: "transfer", transferDirection: "out", ownerName: "Tim" });
  assert.deepEqual(await rows(db, "SELECT transfer_purpose_category_id FROM transactions WHERE id = ?", december), [{ transfer_purpose_category_id: null }]);
  // A different amount is a different transfer.
  const other = await createEntry(api, { date: "2026-11-02", description: "FAST to Joyce", accountName: "UOB Savings", categoryName: "Transfer", amountMinor: 45_100, entryType: "transfer", transferDirection: "out", ownerName: "Tim" });
  assert.deepEqual(await rows(db, "SELECT transfer_purpose_category_id FROM transactions WHERE id = ?", other), [{ transfer_purpose_category_id: null }]);
});

test("a remembered purpose that fails part way is not written, and the entry itself is still saved", async (t) => {
  const { db, api } = await openSeededDatabase(t, template);
  const { outId } = await seedOwnerCase(db, api, { withPlan: false });
  await api("/api/transfers/purpose", { entryId: outId, categoryName: "Home" });
  const faulty = failingStatement(db, /transfer_purpose_source = 'remembered'/);
  const created = await api("/api/entries/create", {
    date: "2026-11-01", description: "FAST to Joyce", accountName: "UOB Savings", categoryName: "Transfer", amountMinor: 45_000,
    entryType: "transfer", transferDirection: "out", ownershipType: "direct", ownerName: "Tim"
  }, { database: faulty.db });
  assert.equal(created.status, 200);
  assert.equal(faulty.state.fired, true);
  assert.deepEqual(await rows(db, "SELECT transfer_purpose_category_id FROM transactions WHERE id = ?", created.payload.entryId), [{ transfer_purpose_category_id: null }]);
  assert.deepEqual(await rows(db, "SELECT action FROM audit_events WHERE entity_id = ? AND action = 'transfer_purpose_remembered'", created.payload.entryId), []);
});

test("invariant 3: money moved into an investment account keeps its own rule and cannot have a purpose", async (t) => {
  const { db, api } = await openSeededDatabase(t, template);
  const [{ id: householdId }] = await rows(db, "SELECT id FROM households LIMIT 1");
  const [{ institution_id: institutionId }] = await rows(db, "SELECT institution_id FROM accounts WHERE id = 'acct-uob-savings'");
  await db.prepare("INSERT INTO accounts (id, household_id, institution_id, owner_person_id, account_name, account_kind, currency) VALUES ('acct-joyce-invest', ?, ?, 'person-joyce', 'Joyce Invest', 'investment', 'SGD')")
    .bind(householdId, institutionId).run();
  const outId = await createEntry(api, { date: "2026-10-04", description: "To Joyce invest", accountName: "UOB Savings", categoryName: "Transfer", amountMinor: 10_000, entryType: "transfer", transferDirection: "out" });
  const inId = await createEntry(api, { date: "2026-10-04", description: "From Tim", accountName: "Joyce Invest", categoryName: "Transfer", amountMinor: 10_000, entryType: "transfer", transferDirection: "in", ownerName: "Joyce" });
  await api("/api/transfers/link", { fromEntryId: outId, toEntryId: inId });
  assert.equal((await api("/api/transfers/purpose", { entryId: outId, categoryName: "Home" })).payload.error, "Money moved into or out of investments keeps its own rule.");
});

test("the schema check adds the purpose columns to a database that predates them, and every page still loads", async (t) => {
  const { db, api } = await openSeededDatabase(t, template);
  for (const column of ["transfer_purpose_category_id", "transfer_purpose_person_id", "transfer_purpose_source"]) {
    await db.exec(`ALTER TABLE transactions DROP COLUMN ${column}`);
  }
  const columns = async () => (await rows(db, "PRAGMA table_info(transactions)")).map((column) => column.name).filter((name) => name.startsWith("transfer_purpose"));
  assert.deepEqual(await columns(), []);

  for (const pathname of ["/api/entries-page?view=household&month=2026-10", "/api/month-page?view=person-tim&month=2026-10", "/api/summary-page?view=person-joyce&month=2026-10"]) {
    assert.equal((await api(pathname)).status, 200, pathname);
  }
  assert.deepEqual(await columns(), ["transfer_purpose_category_id", "transfer_purpose_person_id", "transfer_purpose_source"]);
  assert.deepEqual(await rows(db, "SELECT COUNT(*) AS count FROM transactions WHERE transfer_purpose_category_id IS NOT NULL OR transfer_purpose_person_id IS NOT NULL OR transfer_purpose_source IS NOT NULL"), [{ count: 0 }]);
});
