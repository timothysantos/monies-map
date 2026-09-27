// The showcase demo dataset (DEMO_DATASET=showcase, docs/demo-tour.md): a
// fictional two-adult household with 17 months of history, seeded through
// the real /api/demo/reseed route into a real local D1 and read back through
// the page APIs the screens use. With the variable unset the default demo
// seed is produced, unchanged. Seed month 2026-05, so the showcase months are
// 2025-01 .. 2026-05 (M-16 .. M0).
import assert from "node:assert/strict";
import test from "node:test";

import {
  assertSameDatabase,
  createSeededTemplate,
  dumpDatabase,
  failingStatement,
  openSeededDatabase,
  rows,
  snapshotTotals
} from "./support/d1-workspace.mjs";
import { ensureAppData, invalidateAppDataCache } from "../src/domain/app-shell.ts";
import { reseedDemoSettings } from "../src/domain/demo-settings.ts";
import { reseedShowcaseData } from "../src/domain/app-repository-showcase-seed.ts";
import { buildShowcaseDataset } from "../src/domain/demo-showcase-data.ts";

const SEED_MONTH = "2026-05";
const SHOWCASE_VARS = { DEMO_DATASET: "showcase", DEMO_SEED_MONTH: SEED_MONTH };
const MONTHS = Array.from({ length: 17 }, (_, index) => {
  const date = new Date(Date.UTC(2025, index, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
});
const ETHAN = "person-ethan";
const SERENE = "person-serene";
const SCOPES = ["direct", "shared", "direct_plus_shared"];

let showcase;
let defaults;
test.before(async () => {
  [showcase, defaults] = await Promise.all([
    createSeededTemplate({ vars: SHOWCASE_VARS }),
    createSeededTemplate()
  ]);
});
test.after(async () => {
  await Promise.all([showcase?.dispose(), defaults?.dispose()]);
});

async function get(api, pathname) {
  const response = await api(pathname);
  assert.equal(response.status, 200, `${pathname}: ${JSON.stringify(response.payload).slice(0, 400)}`);
  return response.payload;
}

function card(metricCards, label) {
  return metricCards.find((item) => item.label === label)?.amountMinor;
}

async function demoSettingsJson(db) {
  const [row] = await rows(db, "SELECT value_json FROM demo_settings WHERE key = 'current'");
  return JSON.parse(row.value_json);
}

test("the showcase replaces the household with a fictional one and records the dataset", async (t) => {
  const { db } = await openSeededDatabase(t, showcase);
  const settings = await demoSettingsJson(db);
  assert.equal(settings.dataset, "showcase");
  assert.equal(settings.emptyState, false);

  assert.deepEqual(
    await rows(db, "SELECT id, display_name, role FROM people ORDER BY created_at"),
    [
      { id: ETHAN, display_name: "Ethan", role: "owner" },
      { id: SERENE, display_name: "Serene", role: "partner" }
    ]
  );
  assert.deepEqual(
    (await rows(db, "SELECT account_name, account_kind, is_joint FROM accounts ORDER BY account_name")).map((row) => `${row.account_name}|${row.account_kind}|${row.is_joint}`),
    [
      "Citi Cash Back Card|credit_card|0",
      "OCBC 360 Account|bank|0",
      "OCBC 365 Card|credit_card|0",
      "POSB Joint Account|bank|1",
      "UOB One Account|bank|0",
      "UOB PRVI Miles Card|credit_card|0"
    ]
  );

  // Nothing from the default household, its people or real statements.
  const dump = JSON.stringify(await dumpDatabase(db));
  assert.doesNotMatch(dump, /\bTim\b|\bJoyce\b|person-tim|person-joyce|Household Float|Baby River|Okaeri/);
  const [{ count }] = await rows(db, "SELECT COUNT(*) AS count FROM transactions");
  assert.equal(count, buildShowcaseDataset({ seedMonth: SEED_MONTH }).transactions.length);
  assert.ok(count >= 900 && count <= 1500, `a few hundred to ~1,500 entries, got ${count}`);
});

test("tracked months span 17 months ending at the seed month", async (t) => {
  const { api } = await openSeededDatabase(t, showcase);
  const shell = await get(api, `/api/app-shell?month=${SEED_MONTH}&scope=direct_plus_shared`);
  assert.deepEqual(shell.trackedMonths, MONTHS);
  assert.deepEqual(shell.availableViewIds, ["household", ETHAN, SERENE]);

  // The default Summary range is the last 12 months; a range from the first
  // month holds the same month a year earlier (the same-season comparison).
  const defaultRange = await get(api, `/api/summary-page?view=household&month=${SEED_MONTH}&scope=direct_plus_shared`);
  assert.deepEqual(defaultRange.summaryPage.rangeMonths, MONTHS.slice(5));
  const fullRange = await get(api, `/api/summary-page?view=household&month=${SEED_MONTH}&scope=direct_plus_shared&summary_start=2025-01&summary_end=${SEED_MONTH}`);
  assert.deepEqual(fullRange.summaryPage.rangeMonths, MONTHS);
  const april = Object.fromEntries(fullRange.summaryPage.months.filter((month) => month.month.endsWith("-04")).map((month) => [month.month, month]));
  // Last April had the Bali weekend; this April spends less and earns more
  // (Ethan's pay rise).
  assert.ok(april["2025-04"].realExpensesMinor > april["2026-04"].realExpensesMinor);
  assert.ok(april["2026-04"].actualIncomeMinor > april["2025-04"].actualIncomeMinor);
});

test("plans: typical months under plan, the Japan month on plan, the aircon month over plan", async (t) => {
  const { api } = await openSeededDatabase(t, showcase);
  const summary = await get(api, `/api/summary-page?view=household&month=${SEED_MONTH}&scope=direct_plus_shared&summary_start=2025-01&summary_end=${SEED_MONTH}`);
  const variance = Object.fromEntries(summary.summaryPage.months.map((month) => [month.month, month.estimatedExpensesMinor - month.realExpensesMinor]));
  assert.equal(variance["2026-03"], -312_814, "aircon and sofa: $3,128.14 over plan");
  assert.equal(variance["2025-12"], 3_577, "Japan: $35.77 unspent");
  assert.equal(variance["2026-04"], 268_770, "last complete month: $2,687.70 unspent");
  assert.deepEqual(Object.entries(variance).filter(([, value]) => value < 0).map(([month]) => month), ["2026-03"]);

  const march = await get(api, "/api/month-page?view=household&month=2026-03&scope=direct_plus_shared");
  assert.equal(card(march.monthPage.metricCards, "Planned spend"), 726_309);
  assert.equal(card(march.monthPage.metricCards, "Actual spend"), 1_039_123);
  assert.equal(card(march.monthPage.metricCards, "Savings target"), 250_000);
  assert.match(march.monthPage.monthNote, /aircon/);
  const planned = march.monthPage.planSections.find((section) => section.key === "planned_items").rows;
  const hdb = planned.find((row) => row.label === "HDB loan");
  assert.equal(hdb.actualMinor, 148_000, "the HDB loan row is linked to its GIRO entry");
  // Income rows use one category each, so each shows only its own entries.
  assert.deepEqual(
    march.monthPage.incomeRows.map((row) => [row.label, row.plannedMinor, row.actualMinor]),
    [["Ethan salary", 830_000, 830_000], ["Serene freelance income", 520_000, 521_000]]
  );
});

test("person views: Direct, Shared and Direct + Shared give different totals that add up", async (t) => {
  const { api, db } = await openSeededDatabase(t, showcase);
  const spend = {};
  for (const view of [ETHAN, SERENE]) {
    for (const scope of SCOPES) {
      const page = await get(api, `/api/month-page?view=${view}&month=2026-03&scope=${scope}`);
      spend[`${view}:${scope}`] = card(page.monthPage.metricCards, "Actual spend");
    }
  }
  const household = card((await get(api, "/api/month-page?view=household&month=2026-03&scope=direct_plus_shared")).monthPage.metricCards, "Actual spend");
  assert.deepEqual(spend, {
    // Ethan's own card and bank spend; Serene's own cards.
    "person-ethan:direct": 133_891,
    // Half of the aircon (1,640.00), the sofa (1,095.00), SP Group, Singtel
    // and three dinners; the odd cents go to Serene.
    "person-ethan:shared": 310_303,
    "person-ethan:direct_plus_shared": 444_194,
    "person-serene:direct": 73_967,
    "person-serene:shared": 310_305,
    "person-serene:direct_plus_shared": 384_272
  });
  for (const view of [ETHAN, SERENE]) {
    assert.equal(spend[`${view}:direct`] + spend[`${view}:shared`], spend[`${view}:direct_plus_shared`]);
  }
  // The joint account's costs belong to the household only.
  const [{ joint }] = await rows(db, "SELECT SUM(amount_minor) AS joint FROM transactions WHERE account_id = 'acct-joint-posb' AND entry_type = 'expense' AND transaction_date LIKE '2026-03-%'");
  assert.equal(household, spend[`${ETHAN}:direct_plus_shared`] + spend[`${SERENE}:direct_plus_shared`] + joint);
});

test("stored month totals equal their entries for every month and scope", async (t) => {
  const { api, db } = await openSeededDatabase(t, showcase);
  for (const month of MONTHS) {
    const stored = Object.fromEntries((await snapshotTotals(db, month)).map((row) => [row.person_scope, row]));
    assert.deepEqual(Object.keys(stored).sort(), ["household", ETHAN, SERENE].sort(), `${month} has a snapshot per scope`);
    for (const view of ["household", ETHAN, SERENE]) {
      const page = await get(api, `/api/month-page?view=${view}&month=${month}&scope=direct_plus_shared`);
      assert.equal(stored[view].total_expense_minor, card(page.monthPage.metricCards, "Actual spend"), `${month} ${view} spend`);
      assert.equal(stored[view].estimated_expense_minor, card(page.monthPage.metricCards, "Planned spend"), `${month} ${view} plan`);
      const plannedIncome = page.monthPage.incomeRows.reduce((sum, row) => sum + row.plannedMinor, 0);
      assert.equal(stored[view].total_income_minor, plannedIncome, `${month} ${view} income`);
    }
  }
});

test("transfers: card bills, contributions and settle-ups are matched pairs; one SRS top-up is unresolved", async (t) => {
  const { api, db } = await openSeededDatabase(t, showcase);
  const groups = await rows(db, `
    SELECT transfer_group_id, COUNT(*) AS size, SUM(CASE WHEN transfer_direction = 'in' THEN amount_minor ELSE -amount_minor END) AS net,
      COUNT(DISTINCT account_id) AS accounts, MIN(transaction_date) = MAX(transaction_date) AS same_day
    FROM transactions WHERE transfer_group_id IS NOT NULL GROUP BY transfer_group_id
  `);
  assert.equal(groups.length, 84);
  assert.ok(groups.every((group) => group.size === 2 && group.net === 0 && group.accounts === 2 && group.same_day === 1));

  const settings = await get(api, "/api/settings-page?view=household");
  assert.deepEqual(
    settings.settingsPage.unresolvedTransfers.map((entry) => [entry.description, entry.amountMinor, entry.accountName]),
    [["FAST TRANSFER TO SRS A/C XXXX-0000", 150_000, "UOB One Account"]]
  );
  const entries = await get(api, "/api/entries-page?view=household&month=2026-04");
  const bill = entries.monthPage.entries.find((entry) => entry.description === "PAYMENT RECEIVED - THANK YOU");
  assert.ok(bill.linkedTransfer, "a card bill payment shows its matched other half");
});

test("statements: every account reconciled except the OCBC card, off by $42.80 with its next statement due", async (t) => {
  const { api, db } = await openSeededDatabase(t, showcase);
  const settings = await get(api, "/api/settings-page?view=household");
  const accounts = Object.fromEntries(settings.settingsPage.accounts.map((account) => [account.name, account]));
  assert.deepEqual(
    Object.fromEntries(Object.entries(accounts).map(([name, account]) => [name, [account.reconciliationStatus, account.latestCheckpointMonth, account.latestCheckpointDeltaMinor, account.unresolvedTransferCount]])),
    {
      "Citi Cash Back Card": ["matched", "2026-04", 0, 0],
      "OCBC 360 Account": ["matched", "2026-04", 0, 0],
      "OCBC 365 Card": ["mismatch", "2026-03", 4_280, 0],
      "POSB Joint Account": ["matched", "2026-04", 0, 0],
      "UOB One Account": ["matched", "2026-04", 0, 1],
      "UOB PRVI Miles Card": ["matched", "2026-04", 0, 0]
    }
  );
  // Every older checkpoint reconciles too.
  for (const account of Object.values(accounts)) {
    const offBy = account.checkpointHistory.filter((item) => item.deltaMinor !== 0).map((item) => item.month);
    assert.deepEqual(offBy, account.name === "OCBC 365 Card" ? ["2026-03"] : [], account.name);
  }
  assert.deepEqual(
    settings.settingsPage.reconciliationExceptions.map((item) => [item.accountName, item.checkpointMonth, item.kind, item.status]),
    [["OCBC 365 Card", "2026-03", "missing_bank_row", "open"]]
  );

  const imports = await get(api, "/api/imports-page");
  const recent = imports.importsPage.recentImports;
  assert.equal(recent.length, 47);
  assert.equal(recent.filter((item) => item.sourceType === "pdf" && item.statementCertificateStatus === "certified").length, 28);
  assert.deepEqual(recent.filter((item) => item.statementCertificateStatus === "exception").map((item) => item.sourceLabel), ["ocbc-365-statement-2026-03"]);
  assert.deepEqual(recent.filter((item) => item.status === "rolled_back").map((item) => item.transactionCount), [0]);
  // Only the newest statement per account can be rolled back.
  assert.equal(recent.filter((item) => item.sourceType === "pdf" && !item.rollbackProtected).length, 5);
  assert.equal(imports.importsPage.pendingSplitMatchCount, 1);

  // Imported rows are traceable to their batch; the three certification
  // states all appear.
  const states = await rows(db, `
    SELECT bank_certification_status AS status, import_id IS NULL AS manual, COUNT(*) AS count
    FROM transactions GROUP BY status, manual ORDER BY status, manual
  `);
  assert.deepEqual(states.map((row) => [row.status, row.manual]), [["provisional", 0], ["provisional", 1], ["statement_certified", 0]]);
  const [{ orphans }] = await rows(db, "SELECT COUNT(*) AS orphans FROM transactions WHERE import_id IS NOT NULL AND import_row_id NOT IN (SELECT id FROM import_rows WHERE import_rows.import_id = transactions.import_id)");
  assert.equal(orphans, 0);
});

test("splits: a JPY trip with home shares, settled batches, one simplification and one archived duplicate", async (t) => {
  const { api, db } = await openSeededDatabase(t, showcase);
  const household = (await get(api, "/api/splits-page?view=household&month=2026-05")).splitsPage;
  const groups = Object.fromEntries(household.groups.map((group) => [group.name, group]));
  assert.equal(groups["Japan trip"].currency, "JPY");
  assert.equal(groups["Japan trip"].isDefault, true, "Splits opens on the trip");
  assert.equal(groups["Non-group expenses"].entryCount, 0);

  // Both people see the same balance from opposite sides.
  const ethan = Object.fromEntries((await get(api, "/api/splits-page?view=person-ethan&month=2026-05")).splitsPage.groups.map((group) => [group.name, group.balanceMinor]));
  const serene = Object.fromEntries((await get(api, "/api/splits-page?view=person-serene&month=2026-05")).splitsPage.groups.map((group) => [group.name, group.balanceMinor]));
  for (const name of Object.keys(ethan)) {
    assert.equal(ethan[name] + serene[name], 0, `${name} nets to zero`);
  }
  // ¥46,730 owed after the trip, ¥20,000 handed over in cash.
  assert.equal(Math.abs(ethan["Japan trip"]), 2_673_000);

  const [{ unbalanced }] = await rows(db, `
    SELECT COUNT(*) AS unbalanced FROM split_expenses
    WHERE total_amount_minor <> (SELECT SUM(amount_minor) FROM split_expense_shares WHERE split_expense_id = split_expenses.id)
  `);
  assert.equal(unbalanced, 0);

  // A card-paid travel split shows each person's share in SGD on the entry.
  const december = await get(api, "/api/entries-page?view=person-ethan&month=2025-12");
  const hotel = december.monthPage.entries.find((entry) => entry.description === "AGODA.COM HOTEL TOKYO JP");
  assert.equal(hotel.linkedSplitGroupName, "Japan trip");
  assert.deepEqual(hotel.linkedSplitShares.map((share) => share.amountMinor), [76_440, 76_440]);
  assert.equal(hotel.amountMinor, 76_440);

  // Two settled Home & Bills batches, each closed by the settle-up that paid it.
  const closed = await rows(db, `
    SELECT split_batches.id, split_batches.closed_on, split_settlements.settlement_date, split_settlements.amount_minor,
      (SELECT COUNT(*) FROM split_expenses WHERE split_batch_id = split_batches.id) AS expenses
    FROM split_batches INNER JOIN split_settlements ON split_settlements.split_batch_id = split_batches.id
    WHERE split_batches.closed_on IS NOT NULL ORDER BY split_batches.closed_on
  `);
  assert.deepEqual(closed.map((row) => [row.closed_on, row.settlement_date === row.closed_on, row.amount_minor, row.expenses]), [
    ["2025-07-28", true, 119_175, 15],
    ["2026-01-28", true, 92_485, 12]
  ]);

  assert.deepEqual(household.settlementCheckpoints.map((item) => [item.status, item.currency, item.fromPersonName, item.toPersonName, item.amountMinor, item.includedRecordCount]), [
    ["open", "SGD", "Serene", "Ethan", 101_917, 27]
  ]);
  assert.deepEqual(household.activityHistory.map((item) => [item.action, item.recordKind, item.description]), [
    ["deleted", "expense", "Haidilao Vivocity (entered twice)"]
  ]);
  assert.deepEqual(household.matches.map((item) => [item.splitDescription, item.transactionDescription, item.amountDeltaMinor]), [
    ["Jumbo Seafood dinner", "JUMBO SEAFOOD RIVERSIDE", 0]
  ]);
});

test("entries carry notes, a refund and all three bank certification labels", async (t) => {
  const { api, db } = await openSeededDatabase(t, showcase);
  const [{ notes }] = await rows(db, "SELECT COUNT(*) AS notes FROM transactions WHERE note IS NOT NULL");
  assert.ok(notes >= 15, `entry notes: ${notes}`);
  const march = await get(api, "/api/entries-page?view=household&month=2026-03");
  const aircon = march.monthPage.entries.find((entry) => entry.description === "COURTS MEGASTORE TAMPINES");
  assert.match(aircon.note, /aircon/);
  assert.equal(aircon.bankCertificationStatus, "statement_certified");
  assert.equal(aircon.linkedSplitGroupName, "Home & Bills");

  // Last month is statement certified; this month comes from current
  // activity files plus today's hand-typed entry.
  const april = await get(api, "/api/entries-page?view=household&month=2026-04");
  const may = await get(api, `/api/entries-page?view=household&month=${SEED_MONTH}`);
  const labels = (page) => [...new Set(page.monthPage.entries.map((entry) => entry.bankCertificationStatus))].sort();
  assert.deepEqual(labels(april), ["import_provisional", "statement_certified"]);
  assert.deepEqual(labels(may), ["import_provisional", "manual_provisional"]);
  const manual = may.monthPage.entries.filter((entry) => entry.bankCertificationStatus === "manual_provisional");
  assert.ok(manual.some((entry) => entry.description === "TIONG BAHRU HAWKER CENTRE" && entry.date === "2026-05-31"));

  const january = await get(api, "/api/entries-page?view=household&month=2026-01");
  const refund = january.monthPage.entries.find((entry) => entry.description === "UNIQLO BUGIS REFUND");
  assert.equal(refund.entryType, "income");
  assert.equal(refund.offsetsCategory, true);
});

test("categories and rules: two custom categories, the household's own rules and a pending suggestion", async (t) => {
  const { api } = await openSeededDatabase(t, showcase);
  const settings = await get(api, "/api/settings-page?view=household");
  const custom = settings.settingsPage.categoryMatchRules.filter((rule) => rule.id.startsWith("catrule-showcase-"));
  assert.deepEqual(custom.map((rule) => [rule.pattern, rule.categoryName]).sort(), [
    ["HARBOURLINE LOGISTICS", "Salary"],
    ["KITE & CO", "Freelance Income"],
    ["LUMEN STUDIO", "Freelance Income"],
    ["PET LOVERS CENTRE", "Pet Care"],
    ["SHENG SIONG", "Groceries"],
    ["SINGTEL", "Bills"],
    ["TAMPINES TOWN COUNCIL", "Bills"]
  ]);
  assert.deepEqual(settings.settingsPage.categoryMatchRuleSuggestions.map((item) => [item.pattern, item.categoryName]), [["YA KUN", "Food & Drinks"]]);
  const reference = await get(api, "/api/reference-data");
  const names = reference.categories.map((category) => category.name);
  assert.ok(names.includes("Freelance Income") && names.includes("Pet Care"));
});

test("the showcase reseed stays well inside D1's per-invocation and per-statement limits", async (t) => {
  const { db } = await openSeededDatabase(t, defaults);
  const usage = { queries: 0, batches: [], maxBindings: 0, maxSqlBytes: 0 };
  const encoder = new TextEncoder();
  const counting = new Proxy(db, {
    get(target, property) {
      if (property === "prepare") {
        return (sql) => {
          usage.queries += 1;
          usage.maxSqlBytes = Math.max(usage.maxSqlBytes, encoder.encode(sql).length);
          const statement = target.prepare(sql);
          const bind = statement.bind.bind(statement);
          statement.bind = (...values) => {
            usage.maxBindings = Math.max(usage.maxBindings, values.length);
            return bind(...values);
          };
          return statement;
        };
      }
      if (property === "batch") {
        return (statements) => {
          usage.batches.push(statements.length);
          return target.batch(statements);
        };
      }
      const value = Reflect.get(target, property);
      return typeof value === "function" ? value.bind(target) : value;
    }
  });
  await reseedShowcaseData(counting, { seedMonth: SEED_MONTH });
  t.diagnostic(`queries ${usage.queries}, batches ${usage.batches.join("/")}, max bindings ${usage.maxBindings}, max statement bytes ${usage.maxSqlBytes}`);
  assert.ok(usage.queries < 500, `queries ${usage.queries}`);
  assert.ok(usage.batches[usage.batches.length - 2] < 150, `seed batch ${usage.batches.join(",")}`);
  assert.ok(usage.maxBindings <= 100, `bindings ${usage.maxBindings}`);
  assert.ok(usage.maxSqlBytes <= 100_000, `statement bytes ${usage.maxSqlBytes}`);
});

test("without DEMO_DATASET the default demo seed is produced and no dataset is recorded", async (t) => {
  const { api, db } = await openSeededDatabase(t, defaults);
  const settings = await demoSettingsJson(db);
  assert.equal("dataset" in settings, false);
  assert.deepEqual((await rows(db, "SELECT id FROM people ORDER BY created_at")).map((row) => row.id), ["person-tim", "person-joyce"]);
  const reseed = await api("/api/demo/reseed", {});
  assert.equal(reseed.status, 200);
  assert.equal("dataset" in reseed.payload.demo, false);
  // Any other value is the default seed too.
  const other = await reseedDemoSettings(db, SEED_MONTH, "something-else");
  assert.equal("dataset" in other, false);
  assert.equal((await rows(db, "SELECT COUNT(*) AS count FROM people WHERE id = 'person-ethan'"))[0].count, 0);
});

test("a cold start over showcase data inserts no default-seed rows", async (t) => {
  const { db } = await openSeededDatabase(t, showcase);
  const before = await dumpDatabase(db);
  invalidateAppDataCache();
  try {
    const demo = await ensureAppData(db);
    assert.equal(demo.dataset, "showcase");
    assertSameDatabase(await dumpDatabase(db), before);
  } finally {
    invalidateAppDataCache();
  }
});

test("a cold start over a showcase database missing its rows reseeds the showcase, not the default", async (t) => {
  const { db } = await openSeededDatabase(t, showcase);
  await db.batch([
    db.prepare("DELETE FROM monthly_plan_entry_links"),
    db.prepare("DELETE FROM monthly_plan_rows"),
    db.prepare("DELETE FROM monthly_snapshots")
  ]);
  invalidateAppDataCache();
  try {
    await ensureAppData(db);
  } finally {
    invalidateAppDataCache();
  }
  assert.deepEqual((await rows(db, "SELECT id FROM people ORDER BY created_at")).map((row) => row.id), [ETHAN, SERENE]);
  const [{ count }] = await rows(db, "SELECT COUNT(*) AS count FROM transactions WHERE id LIKE 'txn-%'");
  assert.equal(count, 0, "no default-seed entries");
  const [{ income }] = await rows(db, "SELECT COUNT(*) AS income FROM monthly_plan_rows WHERE section_key = 'income'");
  assert.ok(income >= 34);
});

test("a failed showcase reseed leaves the previous data untouched", async (t) => {
  const { db } = await openSeededDatabase(t, defaults);
  const before = await dumpDatabase(db);
  const { db: failing, state } = failingStatement(db, /INSERT INTO split_expenses/);
  await assert.rejects(() => reseedDemoSettings(failing, SEED_MONTH, "showcase"));
  assert.equal(state.fired, true);
  assertSameDatabase(await dumpDatabase(db), before);
});
