// The wrong-card check's reads stay bounded (docs/audits/wrong-card-apple-pay-
// duplicate.md): one indexed read for the Apple Pay entries in the file's
// dates and nothing more when there are none; with some, one read of the
// same-amount entries around them, one of each card's earlier export dates
// and one of its Apple Pay posting history. Distant or unrelated ledger rows
// never reach the Worker, and each read is answered from an index.
import assert from "node:assert/strict";
import test from "node:test";

import { countingDatabase } from "./support/d1-counting.mjs";
import { createSeededTemplate, openSeededDatabase, rows } from "./support/d1-workspace.mjs";
import {
  LADYS_FILE,
  ONE_CARD_FILE,
  commitBody,
  commitFile,
  createCards,
  previewFile,
  saveApplePayEntries
} from "./support/wrong-card-scenario.mjs";
import {
  APPLE_PAY_ENTRIES_SQL,
  buildEarlierImportWindowsSql,
  buildNearbyEntriesSql,
  buildPostingLagSql
} from "../src/domain/import-wrong-card-duplicates.ts";

let template;
test.before(async () => {
  template = await createSeededTemplate();
});
test.after(async () => {
  await template?.dispose();
});

const ONE_LABEL = "CC_TXN_History_14Oct2026-onecard";
const LADY_LABEL = "CC_TXN_History_13Oct2026-ladys";

const isWrongCardRead = (call) => /external_reference LIKE 'shortcut:_%'|t\.amount_minor IN|GROUP BY t\.account_id, imports\.id/.test(call.sql);

async function countedPreview(workspace, rowsToPreview, label) {
  const counting = countingDatabase(workspace.db);
  const { status, payload } = await workspace.api("/api/imports/preview", {
    sourceLabel: label, sourceType: "csv", parserKey: "uob_credit_card_current_transactions_xls", rows: rowsToPreview,
    ownershipType: "direct", ownerName: "Tim", statementCheckpoints: []
  }, { database: counting.db });
  assert.equal(status, 200, JSON.stringify(payload));
  return { counting, preview: payload.preview };
}

test("a preview with no Apple Pay entry in its dates adds exactly one read, and it returns nothing", async (t) => {
  const workspace = await openSeededDatabase(t, template);
  await createCards(workspace.api);
  const { counting, preview } = await countedPreview(workspace, ONE_CARD_FILE, ONE_LABEL);
  const reads = counting.calls.filter(isWrongCardRead);
  assert.equal(reads.length, 1);
  assert.match(reads[0].sql, /external_reference LIKE 'shortcut:_%'/);
  assert.equal(reads[0].rows, 0);
  assert.equal(preview.wrongCardDuplicates, undefined);
});

test("with Apple Pay entries it is four reads in all, however much other ledger there is", async (t) => {
  const workspace = await openSeededDatabase(t, template);
  const { db } = workspace;
  const cards = await createCards(workspace.api);
  await saveApplePayEntries(workspace);
  await commitFile(workspace.api, await previewFile(workspace.api, ONE_CARD_FILE, ONE_LABEL), ONE_LABEL);

  // Noise: thousands of other rows on both cards, other amounts, around and far
  // from the dates, and old Apple Pay entries far outside the file's dates.
  const statements = [];
  for (let index = 0; index < 3000; index += 1) {
    const day = new Date(Date.UTC(2024, 0, 1) + (index % 700) * 86_400_000).toISOString().slice(0, 10);
    statements.push(db.prepare(`
      INSERT INTO transactions (id, household_id, account_id, transaction_date, description, amount_minor, currency, entry_type, external_reference)
      VALUES (?, 'household-1', ?, ?, ?, ?, 'SGD', 'expense', ?)`)
      .bind(`noise-${index}`, index % 2 ? cards["UOB One Card"] : cards["UOB Lady's Card"], day, `NOISE SHOP ${index}`, 1000 + index, index % 3 === 0 ? `shortcut:noise-${index}` : null));
  }
  for (let index = 0; index < 600; index += 1) {
    statements.push(db.prepare(`
      INSERT INTO transactions (id, household_id, account_id, transaction_date, description, amount_minor, currency, entry_type)
      VALUES (?, 'household-1', ?, '2026-10-10', ?, ?, 'SGD', 'expense')`)
      .bind(`near-${index}`, cards["UOB One Card"], `OTHER AMOUNT ${index}`, 2000 + index));
  }
  for (let start = 0; start < statements.length; start += 400) {
    await db.batch(statements.slice(start, start + 400));
  }

  const { counting, preview } = await countedPreview(workspace, LADYS_FILE, LADY_LABEL);
  const reads = counting.calls.filter(isWrongCardRead);
  assert.equal(reads.length, 4, reads.map((call) => call.sql.slice(0, 80)).join("\n"));
  const [entries, nearby, windows, lags] = ["external_reference LIKE", "t.amount_minor IN", "GROUP BY t.account_id", "ORDER BY t.transaction_date DESC LIMIT 100"]
    .map((needle) => reads.find((call) => call.sql.includes(needle)));
  // The three Apple Pay entries in the file's dates; the 1,000 old ones stay out.
  assert.equal(entries.rows, 3);
  // The three twins and nothing else of the 3,600 other rows.
  assert.ok(nearby.rows <= 6, `nearby read returned ${nearby.rows} rows`);
  assert.ok(windows.rows <= 4 && lags.rows === 0);
  assert.ok(entries.bytes + nearby.bytes + windows.bytes + lags.bytes < 6_000, `reads returned ${entries.bytes + nearby.bytes + windows.bytes + lags.bytes} bytes`);
  // The cards cost the preview's payload only what the three cards read.
  assert.equal(preview.wrongCardDuplicates.length, 3);
  assert.ok(JSON.stringify(preview.wrongCardDuplicates).length < 2_400, `${JSON.stringify(preview.wrongCardDuplicates).length} bytes`);
});

test("each read is answered from an index, never a full scan of the ledger", async (t) => {
  const { db } = await openSeededDatabase(t, template);
  const plan = async (sql, ...params) => (await rows(db, `EXPLAIN QUERY PLAN ${sql}`, ...params)).map((row) => row.detail).join(" | ");
  const entriesPlan = await plan(APPLE_PAY_ENTRIES_SQL, "household-1", "2026-10-01", "2026-10-31");
  assert.match(entriesPlan, /SEARCH t USING INDEX idx_transactions_household_date \(household_id=\? AND transaction_date>\? AND transaction_date<\?\)/);
  const nearbyPlan = await plan(buildNearbyEntriesSql(2), "household-1", "2026-10-01", "2026-10-31", 180, 970);
  assert.match(nearbyPlan, /SEARCH t USING INDEX idx_transactions_household_date \(household_id=\? AND transaction_date>\? AND transaction_date<\?\)/);
  const windowsPlan = await plan(buildEarlierImportWindowsSql(2), "account-a", "account-b", "2026-06-01", "2026-12-01", "household-1");
  assert.match(windowsPlan, /SEARCH t USING INDEX idx_transactions_account_date \(account_id=\? AND transaction_date>\? AND transaction_date<\?\)/);
  const lagPlan = await plan(buildPostingLagSql(2), "account-a", "account-b", "2025-10-01");
  assert.match(lagPlan, /SEARCH t USING INDEX idx_transactions_account_date \(account_id=\? AND transaction_date>\?\)/);
  for (const text of [entriesPlan, nearbyPlan, windowsPlan, lagPlan]) {
    assert.doesNotMatch(text, /SCAN t\b/);
  }
});

test("a commit with no confirmed removal makes no wrong-card read", async (t) => {
  const workspace = await openSeededDatabase(t, template);
  await createCards(workspace.api);
  await saveApplePayEntries(workspace);
  await commitFile(workspace.api, await previewFile(workspace.api, ONE_CARD_FILE, ONE_LABEL), ONE_LABEL);
  const preview = await previewFile(workspace.api, LADYS_FILE, LADY_LABEL);

  const plain = countingDatabase(workspace.db);
  const kept = await workspace.api("/api/imports/commit", {
    sourceLabel: LADY_LABEL, sourceType: "csv", parserKey: "uob_credit_card_current_transactions_xls",
    rows: preview.previewRows.filter((row) => row.commitStatus === "included")
  }, { database: plain.db });
  assert.equal(kept.status, 200, JSON.stringify(kept.payload));
  assert.equal(plain.calls.filter(isWrongCardRead).length, 0, "no confirmation, no wrong-card read at commit");
});

test("a commit with confirmed removals makes the same four reads once, and one read of the entries' whole rows", async (t) => {
  const workspace = await openSeededDatabase(t, template);
  await createCards(workspace.api);
  await saveApplePayEntries(workspace);
  await commitFile(workspace.api, await previewFile(workspace.api, ONE_CARD_FILE, ONE_LABEL), ONE_LABEL);
  const preview = await previewFile(workspace.api, LADYS_FILE, LADY_LABEL);

  const counting = countingDatabase(workspace.db);
  const removed = await workspace.api("/api/imports/commit", commitBody(preview, LADY_LABEL, { remove: preview.wrongCardDuplicates }), { database: counting.db });
  assert.equal(removed.status, 200, JSON.stringify(removed.payload));
  assert.equal(counting.calls.filter(isWrongCardRead).length, 4);
  assert.equal(counting.calls.filter((call) => /^SELECT \* FROM transactions WHERE household_id = \? AND id IN/.test(call.sql)).length, 1);
});
