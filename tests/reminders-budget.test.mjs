// The reminders read budget (docs/audits/reminders.md, docs/code-spec.md "Cold
// Start And Page Read Budgets"): on the 10k-transaction household with
// production's settled split history and every reminder kind raised, the
// whole answer is a handful of round trips and a few dozen statements at
// most, never pulls the ledger into the Worker, stays inside a CPU and
// payload budget, and every read is answered from an index.
import assert from "node:assert/strict";
import test from "node:test";

import {
  CARD_PAYMENTS_SQL,
  REMINDER_ACCOUNTS_SQL,
  REMINDER_CHECKPOINTS_SQL,
  buildRemindersDto,
  buildSubscriptionChargesSql
} from "../src/domain/pages/reminders.ts";
import { addDays, addMonths } from "../src/domain/money-signals/format.ts";
import { todayInAppTimeZone } from "../src/lib/app-calendar.ts";
import { countingDatabase } from "./support/d1-counting.mjs";
import { createSeededTemplate, openSeededDatabase, rows } from "./support/d1-workspace.mjs";
import { buildLargeHousehold } from "./support/large-household.mjs";
import { seedSettledSplitHistory } from "./support/settled-split-history.mjs";

let template;
test.before(async () => {
  template = await createSeededTemplate();
});
test.after(async () => {
  await template?.dispose();
});

// Measured today: 16 statements (13 when no month card is possible), ~30k rows read, ~110 ms node CPU,
// about 2 KB of response. The bounds leave room for ordinary growth, so only a real regression (an N+1, a whole
// table read, a blob column) trips them.
const BUDGET = {
  maxRoundTrips: 20,
  maxSqlStatements: 20,
  maxRowsRead: 250_000,
  maxRowBytes: 600_000,
  maxMedianCpuMs: 150,
  maxResponseBytes: 8_000
};

const today = todayInAppTimeZone();
const thisMonth = today.slice(0, 7);
const lastMonth = addMonths(thisMonth, -1);

// A card bill due soon, a statement that is late and last month's statements
// in, on the 10k household.
async function seedStatements(db) {
  const [household] = await rows(db, "SELECT id FROM households LIMIT 1");
  const accounts = await rows(db, "SELECT id, account_kind FROM accounts WHERE household_id = ? AND is_active = 1", household.id);
  let index = 0;
  for (const account of accounts.filter((item) => ["bank", "credit_card"].includes(item.account_kind))) {
    for (const [offset, month] of [[-2, addMonths(thisMonth, -2)], [-1, lastMonth]]) {
      await db.prepare(`
        INSERT OR REPLACE INTO account_balance_checkpoints (
          id, household_id, account_id, checkpoint_month, statement_end_date, statement_balance_minor, payment_due_date, minimum_payment_minor
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(`rem-${account.id}-${month}`, household.id, account.id, month, `${month}-20`, account.account_kind === "credit_card" ? -50_000 - index : 0,
        account.account_kind === "credit_card" && offset === -1 ? addDays(today, 3) : null, null).run();
    }
    index += 1;
  }
}

test("on the 10k household the reminders are a few round trips, bounded reads, a small payload and a modest CPU cost", async (t) => {
  const { db } = await openSeededDatabase(t, template);
  await buildLargeHousehold(db);
  await seedSettledSplitHistory(db);
  await seedStatements(db);
  const counting = countingDatabase(db);
  await buildRemindersDto(counting.db, "household"); // warm

  const cpuSamples = [];
  let measured;
  for (let run = 0; run < 5; run += 1) {
    counting.reset();
    const before = process.cpuUsage();
    const dto = await buildRemindersDto(counting.db, "household");
    const used = process.cpuUsage(before);
    cpuSamples.push((used.user + used.system) / 1000);
    measured = { dto, summary: counting.summary(), calls: [...counting.calls], bytes: JSON.stringify(dto).length };
  }
  cpuSamples.sort((left, right) => left - right);
  const { dto, summary, calls, bytes } = measured;
  const rowsRead = summary.rowsRead + summary.batchRowsRead;
  const rowBytes = summary.rowBytes + summary.batchBytes;
  console.log(`# reminders on the 10k household: ${summary.statements} round trips, ${summary.sqlStatements} statements, ${rowsRead} rows read, ${rowBytes} row bytes, ${bytes} response bytes, ${cpuSamples[2].toFixed(0)} ms median node CPU, kinds ${dto.reminders.map((item) => item.kind).join(",")}`);

  // It raised something from the seeded statements (the household has cards with a bill due).
  assert.ok(dto.reminders.some((item) => item.kind === "card_bill"), "a card bill is raised");
  assert.ok(dto.reminders.length <= 20);

  assert.ok(summary.statements <= BUDGET.maxRoundTrips, `${summary.statements} round trips (max ${BUDGET.maxRoundTrips})`);
  assert.ok(summary.sqlStatements <= BUDGET.maxSqlStatements, `${summary.sqlStatements} statements (max ${BUDGET.maxSqlStatements})`);
  assert.ok(rowsRead <= BUDGET.maxRowsRead, `${rowsRead} rows read (max ${BUDGET.maxRowsRead})`);
  assert.ok(rowBytes <= BUDGET.maxRowBytes, `${rowBytes} row bytes (max ${BUDGET.maxRowBytes})`);
  assert.ok(bytes <= BUDGET.maxResponseBytes, `${bytes} response bytes (max ${BUDGET.maxResponseBytes})`);
  assert.ok(cpuSamples[2] <= BUDGET.maxMedianCpuMs, `median node CPU ${cpuSamples[2].toFixed(0)} ms (max ${BUDGET.maxMedianCpuMs})`);

  const sqlSeen = calls.map((call) => call.sql).join("\n");
  assert.doesNotMatch(sqlSeen, /raw_row_json|response_body|app_error_diagnostics/);
});

test("an empty household's reminders are a handful of statements and read almost nothing", async (t) => {
  const { db } = await openSeededDatabase(t, template);
  const counting = countingDatabase(db);
  const dto = await buildRemindersDto(counting.db, "household");
  const summary = counting.summary();
  assert.ok(summary.statements <= 16, `${summary.statements} round trips`);
  assert.ok(summary.sqlStatements <= 16, `${summary.sqlStatements} statements`);
  assert.ok(summary.batchRowsRead + summary.rowsRead < 20_000);
  assert.ok(Array.isArray(dto.reminders));
});

test("every reminder read is answered from an index, never a scan of the ledger", async (t) => {
  const { db } = await openSeededDatabase(t, template);
  const plan = async (sql, ...params) => (await rows(db, `EXPLAIN QUERY PLAN ${sql}`, ...params)).map((row) => row.detail);
  const h = "household-1";
  const reads = {
    cardPayments: [CARD_PAYMENTS_SQL, h, "2026-06-01"],
    charges: [buildSubscriptionChargesSql(3), h, "Bills", "Subscriptions MO", "Subscriptions YR", "2024-08-01"],
    checkpoints: [REMINDER_CHECKPOINTS_SQL, h],
    accounts: [REMINDER_ACCOUNTS_SQL, h]
  };
  const BIG = /^SCAN (?:transactions|split_expenses|split_settlements|import_rows|imports)(?: AS \w+)?$/;
  for (const [name, [sql, ...params]] of Object.entries(reads)) {
    const lines = await plan(sql, ...params);
    for (const line of lines) {
      assert.doesNotMatch(line, BIG, `${name} scans a large table: ${line}`);
    }
  }
  assert.ok((await plan(...reads.cardPayments)).some((line) => /SEARCH transactions USING (?:COVERING )?INDEX/.test(line)), "card payments start from a transactions index");
  assert.ok((await plan(...reads.charges)).some((line) => /SEARCH transactions USING (?:COVERING )?INDEX/.test(line)), "charges start from a transactions index");
});
