// The Imports page, the Splits page and Ask count possible split links by
// matching each unlinked split record against imported ledger rows. Matching
// only accepts a row within a week of the record's date, so the candidate
// read is bounded to those dates, and skipped when nothing waits for a match.
// It used to read every imported row (7,000+ rows, 1.7 MB in production) on
// every Imports page load.
import assert from "node:assert/strict";
import test from "node:test";

import { countingDatabase } from "./support/d1-counting.mjs";
import { createSeededTemplate, openSeededDatabase } from "./support/d1-workspace.mjs";
import { buildSplitMatchDateWindows, loadSplitMatchCandidates } from "../src/domain/app-repository-splits.ts";

let template;
test.before(async () => {
  template = await createSeededTemplate();
});
test.after(async () => {
  await template?.dispose();
});

const MONTH = "2025-10";

async function insertNoiseImportedRows(db, { count, firstDate, spreadDays, description, amountMinor }) {
  const imp = await db.prepare("SELECT id FROM imports WHERE status = 'completed' LIMIT 1").first();
  const account = await db.prepare("SELECT id FROM accounts LIMIT 1").first();
  const statements = [];
  for (let index = 0; index < count; index += 1) {
    const moved = new Date(`${firstDate}T00:00:00Z`);
    moved.setUTCDate(moved.getUTCDate() + (index % spreadDays));
    statements.push(db
      .prepare(`INSERT INTO transactions (id, household_id, import_id, account_id, transaction_date, description, amount_minor, currency, entry_type)
        VALUES (?, 'household-1', ?, ?, ?, ?, ?, 'SGD', 'expense')`)
      .bind(`noise-${firstDate}-${index}`, imp.id, account.id, moved.toISOString().slice(0, 10), description, amountMinor));
  }
  await db.batch(statements);
}

test("date windows merge nearby records, cap the count, and ignore malformed dates", () => {
  assert.deepEqual(buildSplitMatchDateWindows(["2026-05-10"]), [{ from: "2026-05-02", to: "2026-05-18" }]);
  // Two records a week apart share one window; a distant one gets its own.
  assert.deepEqual(buildSplitMatchDateWindows(["2026-05-17", "2026-05-10", "2026-05-10", "2026-09-01"]), [
    { from: "2026-05-02", to: "2026-05-25" },
    { from: "2026-08-24", to: "2026-09-09" }
  ]);
  assert.deepEqual(buildSplitMatchDateWindows(["not-a-date", ""]), []);
  const sparse = Array.from({ length: 50 }, (_, index) => {
    const moved = new Date(Date.UTC(2020, 0, 1 + index * 60));
    return moved.toISOString().slice(0, 10);
  });
  const capped = buildSplitMatchDateWindows(sparse);
  assert.equal(capped.length, 1);
  assert.equal(capped[0].from, "2019-12-24");
});

test("a large unrelated imported ledger changes neither the matches nor (much) the rows read", async (t) => {
  const { db } = await openSeededDatabase(t, template);
  const baseline = await loadSplitMatchCandidates(db, MONTH);
  assert.ok(baseline.length >= 2, "the demo household has an expense match and a settle-up match");
  const baselineIds = baseline.map((match) => match.id).sort();

  // 6,000 rows of 2020-2021 text that would match perfectly by words and
  // amount if the dates were not a year away.
  const pantry = baseline.find((match) => match.splitDescription === "Pantry restock");
  await insertNoiseImportedRows(db, { count: 6000, firstDate: "2020-01-01", spreadDays: 700, description: "Pantry restock", amountMinor: pantry.splitAmountMinor });

  const counting = countingDatabase(db);
  const withNoise = await loadSplitMatchCandidates(counting.db, MONTH);
  assert.deepEqual(withNoise.map((match) => match.id).sort(), baselineIds);
  assert.deepEqual(withNoise, baseline, "same candidates, same order, same fields");

  const candidateRead = counting.calls.find((call) => /FROM transactions/.test(call.sql) && /imports\.status = 'completed'/.test(call.sql));
  assert.ok(candidateRead, "the candidate read ran");
  assert.ok(candidateRead.rows < 200, `candidate read returned ${candidateRead.rows} rows; the 6,000 distant rows must stay out`);
  assert.ok(candidateRead.bytes < 40_000, `candidate read returned ${candidateRead.bytes} bytes`);
});

test("a closer row inside the date window still beats a worse one", async (t) => {
  const { db } = await openSeededDatabase(t, template);
  const baseline = await loadSplitMatchCandidates(db, MONTH);
  const pantry = baseline.find((match) => match.splitDescription === "Pantry restock");
  // A near-date, same-amount, same-words row that sorts ahead of the seeded one
  // by creation time: the answer must be whichever the full ranking picks, which
  // for an equal amount and date delta is the better word overlap.
  const imp = await db.prepare("SELECT id FROM imports WHERE status = 'completed' LIMIT 1").first();
  const account = await db.prepare("SELECT id FROM accounts LIMIT 1").first();
  await db
    .prepare(`INSERT INTO transactions (id, household_id, import_id, account_id, transaction_date, description, amount_minor, currency, entry_type)
      VALUES ('window-better', 'household-1', ?, ?, ?, 'Pantry restock extra words here', ?, 'SGD', 'expense')`)
    .bind(imp.id, account.id, pantry.splitDate, pantry.splitAmountMinor + 0)
    .run();
  const after = await loadSplitMatchCandidates(db, MONTH);
  const pantryAfter = after.find((match) => match.splitDescription === "Pantry restock");
  assert.equal(pantryAfter.amountDeltaMinor, 0);
  assert.ok(pantryAfter.dateDeltaDays <= pantry.dateDeltaDays);
});

test("nothing waiting for a match means the imported ledger is not read at all", async (t) => {
  const { db } = await openSeededDatabase(t, template);
  await db.prepare("DELETE FROM split_expenses WHERE linked_transaction_id IS NULL").run();
  await db.prepare("DELETE FROM split_settlements WHERE linked_transaction_id IS NULL").run();
  const counting = countingDatabase(db);
  const matches = await loadSplitMatchCandidates(counting.db, MONTH);
  assert.deepEqual(matches, []);
  const ledgerReads = counting.calls.filter((call) => /FROM transactions\s+INNER JOIN imports/.test(call.sql) && /SUBSTR\(transactions\.description/.test(call.sql));
  assert.deepEqual(ledgerReads, [], "no candidate read when every split record is already linked");
});
