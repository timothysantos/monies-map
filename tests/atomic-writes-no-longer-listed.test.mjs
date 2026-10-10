// An activity export that removes an entry the bank no longer lists does so
// in its own commit batch, and its rollback re-creates the entry in its own
// batch: a failure partway changes nothing. Real local D1 (Miniflare) seeded
// with the demo household.
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
import { enableShortcut, postWalletPurchase, saveRate } from "./support/foreign-wallet.mjs";

let template;
test.before(async () => {
  template = await createSeededTemplate();
});
test.after(async () => {
  await template?.dispose();
});

const row = (date, description, expense) => ({ date, description, expense, income: "", account: "Citi Rewards", category: "Other", type: "expense" });
const FIRST = [row("2026-10-03", "COFFEE CORNER SINGAPORE SG", "4.20"), row("2026-10-05", "GRAB* A-HOLD JAKARTA PUSAT IDN IDR 502,200", "36.06"), row("2026-10-07", "BOOKSHOP SINGAPORE SG", "12.00")];
const NEXT = [FIRST[0], FIRST[2], row("2026-10-09", "BAKERY SINGAPORE SG", "6.50")];

async function importExport(api, sourceLabel, exportRows, options = {}) {
  const preview = await api("/api/imports/preview", { sourceLabel, sourceType: "csv", rows: exportRows, ownershipType: "direct", ownerName: "Tim" });
  assert.equal(preview.status, 200, JSON.stringify(preview.payload));
  const body = {
    sourceLabel,
    sourceType: "csv",
    parserKey: "citibank_credit_card_activity_csv",
    rows: preview.payload.preview.previewRows.filter((item) => item.commitStatus === "included"),
    noLongerListedEntries: preview.payload.preview.noLongerListedEntries ?? []
  };
  const commit = await api("/api/imports/commit", body, options);
  return { body, preview: preview.payload.preview, commit };
}

const holdRows = (db) => rows(db, `
  SELECT id, import_id, import_row_id, account_id, transaction_date, post_date, description, amount_minor,
    currency, entry_type, category_id, owner_person_id, offsets_category, note, bank_certification_status
  FROM transactions WHERE description LIKE 'GRAB* A-HOLD%'`);

test("removing an entry the bank no longer lists, then rolling back, gives the entry back as it was", async (t) => {
  const { db, api } = await openSeededDatabase(t, template);
  assert.equal((await importExport(api, "Citi activity 8 Oct", FIRST)).commit.status, 200);
  await db.prepare("UPDATE transactions SET note = 'hold?' WHERE description LIKE 'GRAB* A-HOLD%'").run();
  const before = await holdRows(db);

  const next = await importExport(api, "Citi activity 10 Oct", NEXT);
  assert.deepEqual(next.preview.noLongerListedEntries.map((entry) => entry.transactionId), [before[0].id]);
  assert.equal(next.commit.status, 200, JSON.stringify(next.commit.payload));
  assert.deepEqual(await holdRows(db), []);

  assert.equal((await api("/api/imports/rollback", { importId: next.commit.payload.importId })).status, 200);
  assert.deepEqual(await holdRows(db), before);
  assert.deepEqual(await rows(db, "SELECT COUNT(*) AS n FROM import_no_longer_listed_entries"), [{ n: 0 }]);
});

test("an export commit that fails partway keeps the entry the bank no longer lists", async (t) => {
  const { db, api } = await openSeededDatabase(t, template);
  await importExport(api, "Citi activity 8 Oct", FIRST);
  const before = await dumpDatabase(db);
  const faulty = failingStatement(db, /UPDATE imports\s+SET status = 'completed'/);

  const { commit } = await importExport(api, "Citi activity 10 Oct", NEXT, { database: faulty.db });

  assert.equal(faulty.state.fired, true);
  assert.notEqual(commit.status, 200);
  assertSameDatabase(await dumpDatabase(db), before);
});

test("a rollback that fails partway leaves the entry removed and the export in place", async (t) => {
  const { db, api } = await openSeededDatabase(t, template);
  await importExport(api, "Citi activity 8 Oct", FIRST);
  const { commit } = await importExport(api, "Citi activity 10 Oct", NEXT);
  const before = await dumpDatabase(db);
  const faulty = failingStatement(db, /UPDATE imports SET status = 'rolled_back'/);

  const { status } = await api("/api/imports/rollback", { importId: commit.payload.importId }, { database: faulty.db });

  assert.equal(faulty.state.fired, true);
  assert.equal(status, 500);
  assertSameDatabase(await dumpDatabase(db), before);
});

// An estimate saved at a hold's amount, updated by the first export's hold
// row; the next export no longer lists the hold.
async function estimateOnReleasedHold(t) {
  const workspace = await openSeededDatabase(t, template);
  const { db, api, fetch: fetchWorker } = workspace;
  const [citi] = await rows(db, "SELECT id FROM accounts WHERE account_name = ?", "Citi Rewards");
  await enableShortcut(db, { foreignCurrencyAccountId: citi.id });
  await saveRate(db);
  const { payload } = await postWalletPurchase(fetchWorker, { amount: "IDR 502,200", description: "GrabFood Mr.Smash Burger", date: "2026-10-05" });
  assert.equal((await importExport(api, "Citi activity 8 Oct", FIRST)).commit.status, 200);
  const next = await api("/api/imports/preview", { sourceLabel: "Citi activity 10 Oct", sourceType: "csv", rows: NEXT, ownershipType: "direct", ownerName: "Tim" });
  const body = {
    sourceLabel: "Citi activity 10 Oct",
    sourceType: "csv",
    parserKey: "citibank_credit_card_activity_csv",
    rows: next.payload.preview.previewRows.filter((item) => item.commitStatus === "included"),
    reopenedEstimates: next.payload.preview.unlistedEstimates.map(({ transactionId, importId }) => ({ transactionId, importId }))
  };
  assert.deepEqual(body.reopenedEstimates.map((entry) => entry.transactionId), [payload.entryId]);
  return { ...workspace, body, estimateId: payload.entryId };
}

test("an export commit that fails partway leaves the estimate on the hold's row", async (t) => {
  const { db, api, body } = await estimateOnReleasedHold(t);
  const before = await dumpDatabase(db);
  const faulty = failingStatement(db, /UPDATE imports\s+SET status = 'completed'/);

  const { status } = await api("/api/imports/commit", body, { database: faulty.db });

  assert.equal(faulty.state.fired, true);
  assert.notEqual(status, 200);
  assertSameDatabase(await dumpDatabase(db), before);
});

test("a rollback that fails partway leaves the estimate back at its own amount", async (t) => {
  const { db, api, body, estimateId } = await estimateOnReleasedHold(t);
  const commit = await api("/api/imports/commit", body);
  assert.equal(commit.status, 200, JSON.stringify(commit.payload));
  assert.deepEqual(await rows(db, "SELECT import_id FROM transactions WHERE id = ?", estimateId), [{ import_id: null }]);
  const before = await dumpDatabase(db);
  const faulty = failingStatement(db, /UPDATE imports SET status = 'rolled_back'/);

  const { status } = await api("/api/imports/rollback", { importId: commit.payload.importId }, { database: faulty.db });

  assert.equal(faulty.state.fired, true);
  assert.equal(status, 500);
  assertSameDatabase(await dumpDatabase(db), before);
});
