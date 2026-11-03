// The showcase demo keeps itself current (docs/developer-guide.md, "How is
// the demo kept current?"): a cold isolate of the demo Worker
// (APP_ENVIRONMENT=demo, DEMO_DATASET=showcase, no pinned DEMO_SEED_MONTH)
// rebuilds a showcase seeded for an earlier month, or a week or more ago,
// for today. It reuses the demo settings the cold path already reads, and
// never runs anywhere else.
import assert from "node:assert/strict";
import test from "node:test";

import {
  assertSameDatabase,
  createSeededTemplate,
  dumpDatabase,
  failingStatement,
  openSeededDatabase,
  rows
} from "./support/d1-workspace.mjs";
import worker from "../src/index.ts";
import { configureAppData, invalidateAppDataCache } from "../src/domain/app-shell.ts";
import { isShowcaseStale, refreshStaleShowcase, showcaseRefreshesItself } from "../src/domain/demo-settings.ts";
import { loadLatestInvestmentValues } from "../src/domain/import-investment-values.ts";
import { todayInAppTimeZone } from "../src/lib/app-calendar.ts";
import { getCurrentMonthKey } from "../src/lib/month.ts";

const SEED_MONTH = "2026-05";
const DEMO_ENV = { APP_ENVIRONMENT: "demo", DEMO_DATASET: "showcase" };

let showcase;
let defaults;
test.before(async () => {
  [showcase, defaults] = await Promise.all([
    createSeededTemplate({ vars: { DEMO_DATASET: "showcase", DEMO_SEED_MONTH: SEED_MONTH } }),
    createSeededTemplate()
  ]);
});
test.after(async () => {
  await Promise.all([showcase?.dispose(), defaults?.dispose()]);
});

// A first request on a fresh isolate of a Worker with exactly these vars.
async function coldRequest(db, vars) {
  invalidateAppDataCache();
  try {
    const response = await worker.fetch(new Request("http://127.0.0.1/api/app-shell"), { DB: db, ...vars });
    assert.equal(response.status, 200, await response.clone().text());
  } finally {
    invalidateAppDataCache();
    configureAppData({ refreshStaleShowcase: false });
  }
}

async function demoSettingsJson(db) {
  const [row] = await rows(db, "SELECT value_json FROM demo_settings WHERE key = 'current'");
  return JSON.parse(row.value_json);
}

async function newestEntryDate(db) {
  const [row] = await rows(db, "SELECT MAX(transaction_date) AS newest FROM transactions");
  return row.newest;
}

test("a showcase seeded for an earlier month is rebuilt for the current month on the demo's cold start", async (t) => {
  const { db } = await openSeededDatabase(t, showcase);
  assert.equal((await newestEntryDate(db)).slice(0, 7), SEED_MONTH);
  assert.equal((await demoSettingsJson(db)).seedDate, `${SEED_MONTH}-31`);

  await coldRequest(db, DEMO_ENV);

  const today = todayInAppTimeZone();
  const currentMonth = getCurrentMonthKey();
  const newest = await newestEntryDate(db);
  assert.equal(newest.slice(0, 7), currentMonth, "the newest entries are in the current month");
  assert.ok(newest <= today, `nothing after today (${newest})`);
  const settings = await demoSettingsJson(db);
  assert.equal(settings.dataset, "showcase");
  assert.equal(settings.emptyState, false);
  assert.equal(settings.seedDate, today);
  // Still the showcase household, and every month's totals are there.
  assert.deepEqual((await rows(db, "SELECT id FROM people ORDER BY created_at")).map((row) => row.id), ["person-ethan", "person-serene"]);
  const [{ months }] = await rows(db, "SELECT COUNT(DISTINCT printf('%04d-%02d', year, month)) AS months FROM monthly_snapshots");
  assert.equal(months, 17);
  const [{ current }] = await rows(db, "SELECT COUNT(*) AS current FROM monthly_snapshots WHERE printf('%04d-%02d', year, month) = ?", currentMonth);
  assert.ok(current > 0, "the current month has its totals");
});

test("a showcase already seeded today, or this week, is left as it is", async (t) => {
  const { db } = await openSeededDatabase(t, showcase);
  await db.prepare("UPDATE demo_settings SET value_json = json_set(value_json, '$.seedDate', ?) WHERE key = 'current'").bind(todayInAppTimeZone()).run();
  const before = await dumpDatabase(db);
  await coldRequest(db, DEMO_ENV);
  assertSameDatabase(await dumpDatabase(db), before);
});

test("the rebuild never runs outside the demo Worker's showcase", async (t) => {
  // Each a stale showcase database that the Worker must leave alone.
  const cases = [
    ["production (no APP_ENVIRONMENT)", { DEMO_DATASET: "showcase" }],
    ["production", { APP_ENVIRONMENT: "production", DEMO_DATASET: "showcase" }],
    ["local", { APP_ENVIRONMENT: "local", DEMO_DATASET: "showcase" }],
    ["demo with the default dataset", { APP_ENVIRONMENT: "demo" }],
    ["demo with a pinned seed month", { ...DEMO_ENV, DEMO_SEED_MONTH: SEED_MONTH }]
  ];
  for (const [label, vars] of cases) {
    const { db } = await openSeededDatabase(t, showcase);
    const before = await dumpDatabase(db);
    await coldRequest(db, vars);
    assertSameDatabase(await dumpDatabase(db), before);
    assert.equal((await newestEntryDate(db)).slice(0, 7), SEED_MONTH, label);
  }

  // A default-dataset database on the demo Worker is never turned into a
  // showcase by the cold start (it has no showcase to refresh).
  const { db } = await openSeededDatabase(t, defaults);
  await db.prepare("UPDATE demo_settings SET value_json = json_set(value_json, '$.lastSeededAt', '2025-01-01T00:00:00.000Z') WHERE key = 'current'").run();
  await coldRequest(db, DEMO_ENV);
  assert.deepEqual((await rows(db, "SELECT id FROM people ORDER BY created_at")).map((row) => row.id), ["person-tim", "person-joyce"]);
  assert.equal("dataset" in (await demoSettingsJson(db)), false);

  assert.equal(showcaseRefreshesItself(DEMO_ENV), true);
  assert.equal(showcaseRefreshesItself({}), false);
  assert.equal(showcaseRefreshesItself({ APP_ENVIRONMENT: "production", DEMO_DATASET: "showcase" }), false);
  assert.equal(showcaseRefreshesItself({ APP_ENVIRONMENT: "demo", DEMO_DATASET: "default" }), false);
});

test("stale means an earlier month, or a week or more behind; only a showcase can be stale", () => {
  const showcaseSettings = (seedDate) => ({ salaryPerPersonMinor: 1, lastSeededAt: "2026-10-14T03:00:00.000Z", emptyState: false, dataset: "showcase", ...(seedDate ? { seedDate } : {}) });
  assert.equal(isShowcaseStale(showcaseSettings("2026-10-31"), "2026-11-01"), true, "month turn");
  assert.equal(isShowcaseStale(showcaseSettings("2025-11-20"), "2026-11-03"), true, "a year ago");
  assert.equal(isShowcaseStale(showcaseSettings("2026-11-01"), "2026-11-07"), false, "six days");
  assert.equal(isShowcaseStale(showcaseSettings("2026-11-01"), "2026-11-08"), true, "seven days");
  assert.equal(isShowcaseStale(showcaseSettings("2026-11-03"), "2026-11-03"), false, "today");
  assert.equal(isShowcaseStale(showcaseSettings("2026-12-01"), "2026-11-30"), false, "a seed ahead of the clock is left alone");
  // Seeded before the seed date was recorded: the seed time, in Singapore.
  assert.equal(isShowcaseStale(showcaseSettings(), "2026-11-03"), true, "seeded 14 Oct");
  assert.equal(isShowcaseStale(showcaseSettings(), "2026-10-15"), false, "seeded yesterday");
  assert.equal(isShowcaseStale({ ...showcaseSettings(), lastSeededAt: "2026-10-31T17:00:00.000Z" }, "2026-11-01"), false, "1 am on 1 Nov in Singapore");
  // Never the default demo or the empty state.
  assert.equal(isShowcaseStale({ salaryPerPersonMinor: 1, lastSeededAt: "2025-01-01T00:00:00.000Z", emptyState: false }, "2026-11-03"), false);
  assert.equal(isShowcaseStale({ ...showcaseSettings("2025-01-01"), emptyState: true }, "2026-11-03"), false);
});

test("two isolates refreshing at once rebuild the showcase once and both carry on", async (t) => {
  const { db } = await openSeededDatabase(t, showcase);
  const settings = { ...(await demoSettingsJson(db)) };
  const results = await Promise.all([refreshStaleShowcase(db, settings), refreshStaleShowcase(db, settings)]);
  const today = todayInAppTimeZone();
  assert.deepEqual(results.map((item) => item.seedDate), [today, today]);
  // One household, not two: the second batch was refused by the guard
  // before it wrote anything (a second one would also have changed the
  // seed time).
  const once = await dumpDatabase(db);
  const [{ people }] = await rows(db, "SELECT COUNT(*) AS people FROM people");
  assert.equal(people, 2);
  const stored = await demoSettingsJson(db);
  assert.equal(stored.seedDate, today);
  assert.ok(results.some((item) => item.lastSeededAt === stored.lastSeededAt));

  // A later refresh from the same old reading is refused too, and changes nothing.
  const late = await refreshStaleShowcase(db, settings);
  assert.equal(late.seedDate, today);
  assertSameDatabase(await dumpDatabase(db), once);
});

test("a refresh that fails part way leaves the earlier showcase whole", async (t) => {
  const { db } = await openSeededDatabase(t, showcase);
  const before = await dumpDatabase(db);
  const settings = await demoSettingsJson(db);
  const { db: failing, state } = failingStatement(db, /INSERT INTO split_expenses/);
  await assert.rejects(() => refreshStaleShowcase(failing, settings));
  assert.equal(state.fired, true);
  assertSameDatabase(await dumpDatabase(db), before);
});

test("the showcase has iFAST and StashAway statement values that the Summary reads", async (t) => {
  const { db, api } = await openSeededDatabase(t, showcase);
  const values = await rows(db, `
    SELECT accounts.account_name, value.value_month, value.as_of_date, value.total_assets_minor, value.market_value_minor,
      value.cash_minor, value.account_reference, imports.parser_key, imports.status
    FROM investment_statement_values AS value
    JOIN accounts ON accounts.id = value.account_id
    JOIN imports ON imports.id = value.import_id
    ORDER BY accounts.account_name, value.value_month
  `);
  const months = ["2025-11", "2025-12", "2026-01", "2026-02", "2026-03", "2026-04"];
  assert.deepEqual(values.map((row) => `${row.account_name}|${row.value_month}|${row.parser_key}`), [
    ...months.map((month) => `StashAway General Investing|${month}|stashaway_pdf`),
    ...months.map((month) => `iFAST Wrap Account|${month}|ifast_wrap_pdf`)
  ]);
  for (const row of values) {
    assert.equal(row.status, "completed");
    assert.equal(row.account_reference, null, "no account number");
    assert.equal(row.market_value_minor + row.cash_minor, row.total_assets_minor);
    assert.equal(row.as_of_date.slice(0, 7), row.value_month);
  }

  // Worth more than the money put in (the ledger balance), as a portfolio is.
  const ifastLatest = values.find((row) => row.account_name === "iFAST Wrap Account" && row.value_month === "2026-04");
  assert.ok(ifastLatest.total_assets_minor > 1_520_000 && ifastLatest.total_assets_minor < 1_800_000, String(ifastLatest.total_assets_minor));

  const latest = await loadLatestInvestmentValues(db);
  const [ifast] = await rows(db, "SELECT id FROM accounts WHERE account_name = 'iFAST Wrap Account'");
  const [stashAway] = await rows(db, "SELECT id FROM accounts WHERE account_name = 'StashAway General Investing'");
  assert.deepEqual(latest.get(ifast.id), { valueMinor: ifastLatest.total_assets_minor, asOfDate: "2026-04-30" });
  assert.equal(latest.get(stashAway.id)?.asOfDate, "2026-04-30");
  assert.equal(latest.size, 2, "only the two accounts with statements");

  const pills = await api("/api/summary-account-pills?view=household");
  assert.equal(pills.status, 200);
  const worth = pills.payload.accountPills.filter((pill) => pill.investmentValue);
  assert.deepEqual(worth.map((pill) => pill.accountId).sort(), [ifast.id, stashAway.id].sort());

  // No money moves in or out of the iFAST account; StashAway keeps its transfers.
  const [{ ifastEntries }] = await rows(db, "SELECT COUNT(*) AS ifastEntries FROM transactions WHERE account_id = ?", ifast.id);
  assert.equal(ifastEntries, 0);
});
