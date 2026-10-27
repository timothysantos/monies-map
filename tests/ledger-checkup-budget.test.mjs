// The Ledger check-up's read budget (docs/audits/ledger-checkup.md,
// docs/code-spec.md "Cold Start And Page Read Budgets"): on the 10k-transaction
// household with production's settled split history plus every kind of problem
// seeded, the whole check is a handful of round trips and about two dozen
// statements, reads a bounded number of rows, never pulls a ledger into the
// Worker, and stays inside a CPU and payload budget. Every read is answered
// from an index.
import assert from "node:assert/strict";
import test from "node:test";

import { APPLE_PAY_ENTRIES_SQL, buildEarlierImportWindowsSql, buildNearbyEntriesSql, buildPostingLagSql } from "../src/domain/import-wrong-card-duplicates.ts";
import {
  ACCOUNTS_SQL,
  DUPLICATE_ENTRIES_SQL,
  MONTH_ACTIVITY_SQL,
  ODD_ENTRIES_SQL,
  OTHER_ENTRIES_SQL,
  PLAN_ROWS_SQL,
  SPLIT_EXPENSE_PAIRS_SQL,
  SPLIT_SETTLEMENT_PAIRS_SQL,
  STALE_ESTIMATES_SQL,
  STATEMENTS_SQL,
  STATEMENT_SEGMENTS_SQL,
  UNMATCHED_TRANSFERS_SQL,
  buildPlanCandidatesSql
} from "../src/domain/ledger-checkup/loader.ts";
import { buildLedgerCheckupDto } from "../src/domain/pages/ledger-checkup.ts";
import { countingDatabase } from "./support/d1-counting.mjs";
import { createSeededTemplate, openSeededDatabase, rows } from "./support/d1-workspace.mjs";
import { buildLargeHousehold } from "./support/large-household.mjs";
import { SAVINGS, TIM_CARD, daysAgo, insertAccount, insertEntry, insertGroup, insertImport, insertImportRow, insertSplitExpense, seedStatementMonths } from "./support/ledger-checkup-seed.mjs";
import { seedSettledSplitHistory } from "./support/settled-split-history.mjs";

let template;
test.before(async () => {
  template = await createSeededTemplate();
});
test.after(async () => {
  await template?.dispose();
});

// What the check may ask of the database on the heavy household. Bounds are
// about 2x what it measures today, so only a real regression (an N+1, a whole
// table read, a blob column) trips them.
const BUDGET = {
  maxRoundTrips: 5,
  maxSqlStatements: 26,
  maxRowsRead: 250_000,
  maxRowBytes: 600_000,
  maxMedianCpuMs: 400,
  maxResponseBytes: 120_000
};

async function seedProblems(db) {
  // Every kind of problem, in numbers a busy household could have.
  const importA = await insertImport(db);
  const importB = await insertImport(db);
  for (let index = 0; index < 20; index += 1) {
    const hash = `scale-dup-${index}`;
    const date = daysAgo(5 + index);
    const rowA = await insertImportRow(db, { importId: importA, hash, index: index * 2 + 1000 });
    const rowB = await insertImportRow(db, { importId: importB, hash, index: index * 2 + 1001 });
    await insertEntry(db, { date, amountMinor: 700 + index, description: `SCALE DUP ${index}`, importId: importA, importRowId: rowA });
    await insertEntry(db, { date, amountMinor: 700 + index, description: `SCALE DUP ${index}`, importId: importB, importRowId: rowB });
  }
  for (let index = 0; index < 30; index += 1) {
    await insertEntry(db, { account: SAVINGS, date: daysAgo(40 + index * 11), amountMinor: 45_000 + (index % 3), type: "transfer", direction: "out", description: "FAST PAYMENT" });
  }
  const group = await insertGroup(db);
  for (let index = 0; index < 15; index += 1) {
    const bankRow = await insertEntry(db, { account: TIM_CARD, date: daysAgo(3 + index), amountMinor: 5_000 + index, description: `SCALE SHOP ${index}` });
    await insertSplitExpense(db, { groupId: group, date: daysAgo(3 + index), amountMinor: 5_000 + index, description: `Scale shop ${index}` });
    await insertSplitExpense(db, { groupId: group, date: daysAgo(3 + index), amountMinor: 5_000 + index, description: `SCALE SHOP ${index}`, linkedTransactionId: bankRow });
  }
  for (let index = 0; index < 12; index += 1) {
    await insertEntry(db, { account: TIM_CARD, date: daysAgo(40 + index), amountMinor: 1_000 + index, description: `Grab* Bali ${index}`, originalAmountMinor: 10_000_000, originalCurrency: "IDR" });
  }
  for (const [name, kind] of [["Scale Bank A", "bank"], ["Scale Bank B", "bank"], ["Scale Card", "credit_card"]]) {
    const account = await insertAccount(db, { name, kind });
    const months = Array.from({ length: 12 }, (_, offset) => {
      const date = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth() - 12 + offset, 1));
      return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
    });
    await seedStatementMonths(db, account, kind === "bank" ? months : months.filter((_, index) => index !== 5), { amounts: months.map(() => -5_000) });
    if (kind !== "bank") {
      // The card's statement for one month is missing, and the month has entries.
      await insertEntry(db, { account, date: `${months[5]}-12`, amountMinor: 900, createdAt: "2020-01-01 00:00:00" });
    }
  }
}

test("on the 10k household with a settled history and problems of every kind the check is a few round trips, bounded reads and a modest payload", async (t) => {
  const { db } = await openSeededDatabase(t, template);
  await buildLargeHousehold(db);
  await seedSettledSplitHistory(db);
  await seedProblems(db);
  const counting = countingDatabase(db);
  await buildLedgerCheckupDto(counting.db); // warms nothing the cold path owns; the check has no cold path of its own

  const cpuSamples = [];
  let measured;
  for (let run = 0; run < 5; run += 1) {
    counting.reset();
    const before = process.cpuUsage();
    const dto = await buildLedgerCheckupDto(counting.db);
    const used = process.cpuUsage(before);
    cpuSamples.push((used.user + used.system) / 1000);
    measured = { dto, summary: counting.summary(), calls: [...counting.calls], bytes: JSON.stringify(dto).length };
  }
  cpuSamples.sort((left, right) => left - right);
  const { dto, summary, calls, bytes } = measured;
  const rowsRead = summary.rowsRead + summary.batchRowsRead;
  const rowBytes = summary.rowBytes + summary.batchBytes;
  console.log(`# ledger check-up on the 10k household: ${summary.statements} round trips, ${summary.sqlStatements} statements, ${rowsRead} rows read, ${rowBytes} row bytes, ${bytes} response bytes, ${cpuSamples[2].toFixed(0)} ms median node CPU, tiers ${JSON.stringify(dto.tierCounts)}, kinds ${[...new Set(dto.findings.map((item) => item.kind))].join(",")}`);

  // It found the seeded problems of the kinds this household has, and nothing it could not stand behind.
  const kinds = new Set(dto.findings.map((item) => item.kind));
  for (const kind of ["duplicate_entry", "unmatched_transfer", "duplicate_split", "stale_estimate", "statement_gap"]) {
    assert.ok(kinds.has(kind), `${kind} is found on the heavy household`);
  }
  assert.deepEqual(dto.unavailableKinds, []);
  assert.ok(dto.findings.length <= 50 * kinds.size);

  assert.ok(summary.statements <= BUDGET.maxRoundTrips, `${summary.statements} round trips (max ${BUDGET.maxRoundTrips})`);
  assert.ok(summary.sqlStatements <= BUDGET.maxSqlStatements, `${summary.sqlStatements} statements (max ${BUDGET.maxSqlStatements})`);
  assert.ok(rowsRead <= BUDGET.maxRowsRead, `${rowsRead} rows read (max ${BUDGET.maxRowsRead})`);
  assert.ok(rowBytes <= BUDGET.maxRowBytes, `${rowBytes} row bytes (max ${BUDGET.maxRowBytes})`);
  assert.ok(bytes <= BUDGET.maxResponseBytes, `${bytes} response bytes (max ${BUDGET.maxResponseBytes})`);
  assert.ok(cpuSamples[2] <= BUDGET.maxMedianCpuMs, `median node CPU ${cpuSamples[2].toFixed(0)} ms (max ${BUDGET.maxMedianCpuMs})`);

  // Never the heavy tables: no stored preview, no diagnostics, no whole-ledger select.
  const sqlSeen = calls.map((call) => call.sql).join("\n");
  assert.doesNotMatch(sqlSeen, /raw_row_json|response_body|app_error_diagnostics/);
  assert.doesNotMatch(sqlSeen, /FROM transactions(?: AS \w+)?\s*(?:WHERE household_id = \? ORDER BY|$)/);
});

test("a check on an empty-of-problems household is two round trips and reads almost nothing", async (t) => {
  const { db } = await openSeededDatabase(t, template);
  const counting = countingDatabase(db);
  const dto = await buildLedgerCheckupDto(counting.db);
  const summary = counting.summary();
  assert.ok(summary.statements <= 4, `${summary.statements} round trips`);
  assert.ok(summary.sqlStatements <= 20, `${summary.sqlStatements} statements`);
  assert.ok(summary.batchRowsRead + summary.rowsRead < 20_000);
  assert.deepEqual(dto.unavailableKinds, []);
});

test("every read is answered from an index, never a scan of the ledger", async (t) => {
  const { db } = await openSeededDatabase(t, template);
  const plan = async (sql, ...params) => (await rows(db, `EXPLAIN QUERY PLAN ${sql}`, ...params)).map((row) => row.detail);
  const h = "household-1";
  const reads = {
    applePay: [APPLE_PAY_ENTRIES_SQL, h, "2026-06-01", "2026-10-27"],
    statements: [STATEMENTS_SQL, h],
    segments: [STATEMENT_SEGMENTS_SQL, h, h],
    activity: [MONTH_ACTIVITY_SQL, h, "2025-09-01", h],
    duplicateEntries: [DUPLICATE_ENTRIES_SQL, h, "2025-09-01"],
    splitExpenses: [SPLIT_EXPENSE_PAIRS_SQL, h, "2023-10-01"],
    splitSettlements: [SPLIT_SETTLEMENT_PAIRS_SQL, h, "2023-10-01"],
    transfers: [UNMATCHED_TRANSFERS_SQL, h, "2024-08-01", "2026-10-20", h],
    estimates: [STALE_ESTIMATES_SQL, h, "2025-09-01", "2026-10-10"],
    planRows: [PLAN_ROWS_SQL, h, 2026, 10, 2026, 11],
    planCandidates: [buildPlanCandidatesSql(2), h, "2026-09-25", "2026-10-27", 45_000, 12_000],
    other: [OTHER_ENTRIES_SQL, h, "2025-09-01", "2026-08-28"],
    odd: [ODD_ENTRIES_SQL, h, "2025-09-01", "2026-11-10"],
    nearby: [buildNearbyEntriesSql(2), h, "2026-06-01", "2026-10-27", 180, 970],
    windows: [buildEarlierImportWindowsSql(2), "acct-a", "acct-b", "2026-01-01", "2026-12-01", h],
    lags: [buildPostingLagSql(2), "acct-a", "acct-b", "2025-10-01"]
  };
  // Tables a plan may scan: small reference tables, never the ledger or splits.
  const BIG = /^SCAN (?:t|a|b|c|transactions|split_expenses|split_settlements|import_rows|imports)(?: AS \w+)?$/;
  // The wrong-card review's own Apple Pay read (shared, unchanged) checks a handful of
  // candidate entries against the split tables one by one.
  const SPLIT_LINK_CHECKS = /^SCAN (?:split_expenses|split_settlements)$/;
  for (const [name, [sql, ...params]] of Object.entries(reads)) {
    const lines = await plan(sql, ...params);
    assert.ok(lines.some((line) => /USING (?:COVERING )?INDEX/.test(line)), `${name} uses an index: ${lines.join(" | ")}`);
    for (const line of lines) {
      if (name === "applePay" && SPLIT_LINK_CHECKS.test(line)) continue;
      assert.doesNotMatch(line, BIG, `${name} scans a large table: ${line}`);
    }
  }
  // The two big joins start from the household's date index and probe the rest by key.
  assert.match((await plan(...reads.duplicateEntries)).join(" | "), /SEARCH a USING INDEX idx_transactions_household_date/);
  assert.match((await plan(...reads.duplicateEntries)).join(" | "), /SEARCH b USING INDEX idx_transactions_(?:household|account)_date/);
  assert.match((await plan(...reads.splitExpenses)).join(" | "), /SEARCH a USING INDEX idx_split_expenses_household_date/);
  assert.match((await plan(...reads.segments)).join(" | "), /SEARCH t USING INDEX idx_transactions_account_date \(account_id=\?\)/);
  // The accounts read is the one small-table scan (a household has a handful of accounts) and finds each account's last entry through the index.
  const accountsPlan = (await plan(ACCOUNTS_SQL, h)).join(" | ");
  assert.match(accountsPlan, /SCAN a/);
  assert.match(accountsPlan, /idx_transactions_account_date \(account_id=\?\)/);
});
