// What "Link these N clear pairs" asks of the database at its cap
// (docs/code-spec.md "Cold Start And Page Read Budgets", docs/audits/ledger-
// checkup.md "Clear pairs"): on the 10k-transaction household with 100 clear
// pairs (and lookalikes that are not clear) waiting, the preview is a couple of
// round trips over the check-up's own indexed transfer read, and linking all
// 100 is ONE write batch of a few hundred statements with a bounded number of
// reads around it, never a read per pair and never more than D1's 100 bound
// values in a statement. Bounds are about 2x what it measures today.
import assert from "node:assert/strict";
import test from "node:test";

import worker from "../src/index.ts";
import { countingDatabase } from "./support/d1-counting.mjs";
import { createSeededTemplate, openSeededDatabase, rows } from "./support/d1-workspace.mjs";
import { buildLargeHousehold } from "./support/large-household.mjs";
import { SAVINGS, daysAgo, insertAccount, insertEntry, categoryId } from "./support/ledger-checkup-seed.mjs";

let template;
test.before(async () => {
  template = await createSeededTemplate();
});
test.after(async () => {
  await template?.dispose();
});

const PATH = "/api/ledger-checkup/clear-pairs";
const BUDGET = {
  previewRoundTrips: 4,
  previewStatements: 6,
  previewRowsRead: 250_000,
  previewCpuMs: 400,
  // Measured: 281 round trips for 24 months = 11.5 a month plus 5; the batch
  // holds 100 x 4 statements and one marker a month.
  refreshReadsPerMonth: 13,
  linkOtherRoundTrips: 25,
  linkBatchStatements: 700,
  linkCpuMs: 5_000,
  maxBoundValues: 100
};

test("100 clear pairs on the 10k household: a small preview, one write batch, no read per pair", async (t) => {
  const { db } = await openSeededDatabase(t, template);
  await buildLargeHousehold(db);
  await insertAccount(db, { id: "acct-scale-joyce", name: "Joyce Bank", owner: "person-joyce" });
  const transferId = await categoryId(db, "Transfer");
  // 100 pairs over ~25 months (a monthly series plus daily card payments), 10 lookalikes with a rival.
  for (let index = 0; index < 110; index += 1) {
    const date = daysAgo(20 + index * 7);
    const amountMinor = 777_000 + index * 13;
    await insertEntry(db, { id: `txn-scale-${index}-out`, account: SAVINGS, date, amountMinor, description: `scale out ${index}`, type: "transfer", direction: "out", owner: "person-tim", categoryId: transferId });
    await insertEntry(db, { id: `txn-scale-${index}-in`, account: "acct-scale-joyce", date, amountMinor, description: `scale in ${index}`, type: "transfer", direction: "in", owner: "person-joyce", categoryId: transferId });
    if (index >= 100) {
      await insertEntry(db, { id: `txn-scale-${index}-rival`, account: "acct-uob-one", date, amountMinor, description: `scale rival ${index}`, type: "expense" });
    }
  }

  const counting = countingDatabase(db);
  const call = async (pathname, body) => {
    const response = await worker.fetch(new Request(`http://127.0.0.1${pathname}`, {
      method: body ? "POST" : "GET",
      headers: body ? { "content-type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined
    }), { DB: counting.db, ...template.config.vars });
    return { status: response.status, payload: await response.json() };
  };

  await call(PATH); // warms the isolate; the cold path is pinned elsewhere
  const cpuSamples = [];
  let preview;
  let previewSummary;
  for (let run = 0; run < 5; run += 1) {
    counting.reset();
    const before = process.cpuUsage();
    preview = await call(PATH);
    const used = process.cpuUsage(before);
    cpuSamples.push((used.user + used.system) / 1000);
    previewSummary = counting.summary();
  }
  cpuSamples.sort((left, right) => left - right);
  assert.equal(preview.status, 200);
  assert.equal(preview.payload.total, 100, "the 10 with a rival are not clear");
  assert.equal(preview.payload.linkCount, 100);
  assert.equal(preview.payload.rows.length, 10);
  const previewRowsRead = previewSummary.rowsRead + previewSummary.batchRowsRead;
  console.log(`# clear-pair preview: ${previewSummary.statements} round trips, ${previewSummary.sqlStatements} statements, ${previewRowsRead} rows read, ${JSON.stringify(preview.payload).length} response bytes, ${cpuSamples[2].toFixed(0)} ms median node CPU`);
  assert.ok(previewSummary.statements <= BUDGET.previewRoundTrips, `${previewSummary.statements} round trips`);
  assert.ok(previewSummary.sqlStatements <= BUDGET.previewStatements, `${previewSummary.sqlStatements} statements`);
  assert.ok(previewRowsRead <= BUDGET.previewRowsRead, `${previewRowsRead} rows read`);
  assert.ok(cpuSamples[2] <= BUDGET.previewCpuMs, `${cpuSamples[2].toFixed(0)} ms CPU`);

  counting.reset();
  const before = process.cpuUsage();
  const linked = await call(PATH, { pairs: preview.payload.pairs });
  const used = process.cpuUsage(before);
  const cpuMs = (used.user + used.system) / 1000;
  assert.equal(linked.status, 200, JSON.stringify(linked.payload).slice(0, 300));
  assert.equal(linked.payload.linked.length, 100);
  assert.deepEqual(linked.payload.skipped, []);
  const summary = counting.summary();
  const writeBatches = counting.calls.filter((entry) => entry.kind === "batch" && entry.statements > 20);
  const largest = Math.max(...counting.calls.map((entry) => entry.statements ?? 1));
  const reads = counting.calls.filter((entry) => entry.kind !== "batch" && /^SELECT/i.test(entry.sql)).length;
  console.log(`# link 100 clear pairs: ${summary.statements} round trips, ${summary.sqlStatements} statements, ${writeBatches.length} write batch(es) of ${writeBatches.map((entry) => entry.statements).join("+")} statements, ${reads} single reads, ${cpuMs.toFixed(0)} ms node CPU`);
  // What costs round trips is the month totals refresh after the write (about
  // eleven reads for each month a pair touches, the same refresh every write
  // makes), not the pairs: the check-up reads only 800 days of transfers, so
  // at most ~27 months. A read per pair would add 100 more.
  const months = (await rows(db, "SELECT COUNT(DISTINCT substr(transaction_date, 1, 7)) AS n FROM transactions WHERE id LIKE 'txn-scale-%' AND transfer_group_id IS NOT NULL"))[0].n;
  assert.ok(summary.statements <= BUDGET.refreshReadsPerMonth * months + BUDGET.linkOtherRoundTrips, `${summary.statements} round trips for ${months} months`);
  assert.equal(writeBatches.filter((entry) => entry.statements >= 400).length, 1, "the 100 pairs are one batch");
  assert.ok(largest <= BUDGET.linkBatchStatements, `largest batch ${largest} statements`);
  assert.ok(reads <= BUDGET.refreshReadsPerMonth * months + BUDGET.linkOtherRoundTrips, `${reads} reads`);
  assert.ok(cpuMs <= BUDGET.linkCpuMs, `${cpuMs.toFixed(0)} ms CPU`);
  // No statement binds more than D1's 100 values.
  for (const entry of counting.calls) {
    const marks = (entry.sql.match(/\?/g) ?? []).length;
    assert.ok(marks <= BUDGET.maxBoundValues, `a statement binds ${marks} values: ${entry.sql.slice(0, 80)}`);
  }
  assert.equal((await rows(db, "SELECT COUNT(*) AS n FROM transfer_groups WHERE note = 'Linked from Check my books'"))[0].n, 100);
  assert.equal((await rows(db, "SELECT COUNT(*) AS n FROM monthly_snapshot_refreshes"))[0].n, 0);
});
