// The commands Ask's phase 2 saves through, all-or-nothing (Persistence
// Atomicity Contract, docs/code-spec.md):
// - many entries' categories at once (POST /api/entries/update-category
//   with `changes`): every move, its audit event and the month refresh
//   markers in one guarded batch; a stale entry, an unconfirmed large
//   change, a transfer or too many rows are refused before anything is
//   written;
// - Simplify (createSplitSettlementCheckpoint): the checkpoint, every record
//   it covers and its audit event in one batch;
// - a new category (createCategoryRecord): the category and its audit event
//   in one batch.
// Real local D1, demo household.
import assert from "node:assert/strict";
import test from "node:test";

import {
  assertSameDatabase,
  createEntry,
  createSeededTemplate,
  dumpDatabase,
  failingStatement,
  openSeededDatabase,
  rows
} from "./support/d1-workspace.mjs";
import { updateEntryCategoriesRecord } from "../src/domain/app-repository-entry-commands.ts";
import { createSplitSettlementCheckpoint } from "../src/domain/app-repository-splits.ts";
import { createCategoryRecord } from "../src/domain/app-repository-categories.ts";

let template;
test.before(async () => {
  template = await createSeededTemplate();
});
test.after(async () => {
  await template?.dispose();
});

async function categoryOf(db, entryId) {
  const [row] = await rows(db, "SELECT categories.name AS name FROM transactions JOIN categories ON categories.id = transactions.category_id WHERE transactions.id = ?", entryId);
  return row?.name;
}

async function grabRides(api, count = 3) {
  const ids = [];
  for (let index = 0; index < count; index += 1) {
    ids.push(await createEntry(api, { date: `2026-0${5 + (index % 2)}-1${index % 10}`, description: `GRAB RIDE ${index}`, categoryName: index === 0 ? "Other" : "Food & Drinks", amountMinor: 1_200 + index }));
  }
  return ids;
}

function toTaxi(ids, fromNames) {
  return ids.map((entryId, index) => ({ entryId, fromCategoryName: fromNames[index], categoryName: "Taxi" }));
}

test("many entries move to one category together, with one audit event, and the months' totals refreshed", async (t) => {
  const { db, api } = await openSeededDatabase(t, template);
  const ids = await grabRides(api);
  const result = await api("/api/entries/update-category", { changes: toTaxi(ids, ["Other", "Food & Drinks", "Food & Drinks"]) });
  assert.equal(result.status, 200, JSON.stringify(result.payload));
  assert.deepEqual(result.payload, { ok: true, updatedCount: 3, months: ["2026-05", "2026-06"] });
  for (const id of ids) {
    assert.equal(await categoryOf(db, id), "Taxi");
  }
  const audit = await rows(db, "SELECT action, detail FROM audit_events WHERE action = 'entries_category_updated'");
  assert.deepEqual(audit, [{ action: "entries_category_updated", detail: "Moved 3 entries to Taxi." }]);
  assert.deepEqual(await rows(db, "SELECT month_key FROM monthly_snapshot_refreshes WHERE month_key IN ('2026-05', '2026-06')"), []);

  // Undo: the same command with each entry's own category back.
  const undo = await api("/api/entries/update-category", { changes: ids.map((entryId, index) => ({ entryId, fromCategoryName: "Taxi", categoryName: index === 0 ? "Other" : "Food & Drinks" })) });
  assert.equal(undo.status, 200, JSON.stringify(undo.payload));
  assert.equal(await categoryOf(db, ids[0]), "Other");
  assert.equal(await categoryOf(db, ids[1]), "Food & Drinks");
});

test("a bulk move that fails on its second entry keeps every entry where it was", async (t) => {
  const { db, api } = await openSeededDatabase(t, template);
  const ids = await grabRides(api);
  const before = await dumpDatabase(db);
  const faulty = failingStatement(db, /UPDATE transactions SET category_id/, { skip: 1 });

  await assert.rejects(updateEntryCategoriesRecord(faulty.db, { changes: toTaxi(ids, ["Other", "Food & Drinks", "Food & Drinks"]) }), /injected_failure_missing_table/);

  assert.equal(faulty.state.fired, true);
  assertSameDatabase(await dumpDatabase(db), before);
});

test("a bulk move that fails on its audit event moves nothing", async (t) => {
  const { db, api } = await openSeededDatabase(t, template);
  const ids = await grabRides(api);
  const before = await dumpDatabase(db);
  const faulty = failingStatement(db, /INSERT INTO audit_events/);

  await assert.rejects(updateEntryCategoriesRecord(faulty.db, { changes: toTaxi(ids, ["Other", "Food & Drinks", "Food & Drinks"]) }), /injected_failure_missing_table/);

  assert.equal(faulty.state.fired, true);
  assertSameDatabase(await dumpDatabase(db), before);
});

test("negative: an entry moved since the person saw it refuses the whole change", async (t) => {
  const { db, api } = await openSeededDatabase(t, template);
  const ids = await grabRides(api);
  // The person saw ride 1 in Food & Drinks; it has since moved to Groceries.
  assert.equal((await api("/api/entries/update-category", { entryId: ids[1], categoryName: "Groceries" })).status, 200);
  const before = await dumpDatabase(db);
  const result = await api("/api/entries/update-category", { changes: toTaxi(ids, ["Other", "Food & Drinks", "Food & Drinks"]) });
  assert.equal(result.status, 400);
  assert.equal(result.payload.error, "Some of these entries were changed meanwhile. Ask again to see them as they are now.");
  assertSameDatabase(await dumpDatabase(db), before);
});

test("negative: the guard inside the batch refuses an entry moved between the read and the write", async (t) => {
  const { db, api } = await openSeededDatabase(t, template);
  const ids = await grabRides(api);
  const groceries = (await rows(db, "SELECT id FROM categories WHERE name = 'Groceries'"))[0].id;
  // Moves ride 2 just before the batch runs (after the command's reads).
  let moved = false;
  const racing = new Proxy(db, {
    get(target, property) {
      if (property === "batch") {
        return async (statements) => {
          if (!moved) {
            moved = true;
            await target.prepare("UPDATE transactions SET category_id = ? WHERE id = ?").bind(groceries, ids[2]).run();
          }
          return target.batch(statements);
        };
      }
      const value = Reflect.get(target, property);
      return typeof value === "function" ? value.bind(target) : value;
    }
  });
  const before = await dumpDatabase(db);
  await assert.rejects(updateEntryCategoriesRecord(racing, { changes: toTaxi(ids, ["Other", "Food & Drinks", "Food & Drinks"]) }), /changed meanwhile/);
  const after = await dumpDatabase(db);
  // Only the racing write landed; none of the command's moves did.
  assert.equal(await categoryOf(db, ids[0]), "Other");
  assert.equal(await categoryOf(db, ids[1]), "Food & Drinks");
  assert.equal(after.audit_events.length, before.audit_events.length);
});

test("negative: more than 10 rows need the confirmed count; more than 200 and transfers are refused", async (t) => {
  const { db, api } = await openSeededDatabase(t, template);
  const ids = await grabRides(api, 11);
  const changes = ids.map((entryId, index) => ({ entryId, fromCategoryName: index === 0 ? "Other" : "Food & Drinks", categoryName: "Taxi" }));
  const before = await dumpDatabase(db);
  let result = await api("/api/entries/update-category", { changes });
  assert.equal(result.status, 400);
  assert.equal(result.payload.error, "Confirm changing all 11 entries first.");
  result = await api("/api/entries/update-category", { changes, confirmedCount: 10 });
  assert.equal(result.status, 400);
  result = await api("/api/entries/update-category", { changes: Array.from({ length: 201 }, (_, index) => ({ entryId: `txn-${index}`, fromCategoryName: "Other", categoryName: "Taxi" })), confirmedCount: 201 });
  assert.equal(result.status, 400);
  assert.match(result.payload.error, /At most 200 entries/);
  const transfer = (await rows(db, "SELECT id FROM transactions WHERE entry_type = 'transfer' LIMIT 1"))[0];
  if (transfer) {
    const category = await categoryOf(db, transfer.id);
    result = await api("/api/entries/update-category", { changes: [{ entryId: transfer.id, fromCategoryName: category, categoryName: "Taxi" }] });
    assert.equal(result.status, 400);
    assert.equal(result.payload.error, "A transfer keeps its Transfer category.");
  }
  assertSameDatabase(await dumpDatabase(db), before);

  result = await api("/api/entries/update-category", { changes, confirmedCount: 11 });
  assert.equal(result.status, 200, JSON.stringify(result.payload));
  assert.equal(result.payload.updatedCount, 11);
});

async function openSplits(api) {
  for (const [description, amountMinor] of [["Dinner", 8_000], ["Groceries", 4_000]]) {
    const created = await api("/api/splits/expenses/create", { groupId: null, date: "2026-05-10", description, categoryName: "Food & Drinks", payerPersonName: "Tim", amountMinor, splitBasisPoints: 5000, currency: "SGD" });
    assert.equal(created.status, 200, JSON.stringify(created.payload));
  }
}

test("Simplify that fails on a covered record writes no checkpoint at all", async (t) => {
  const { db, api } = await openSeededDatabase(t, template);
  await openSplits(api);
  const before = await dumpDatabase(db);
  const faulty = failingStatement(db, /INSERT INTO split_settlement_checkpoint_items/, { skip: 1 });

  await assert.rejects(createSplitSettlementCheckpoint(faulty.db, { viewerPersonId: "person-tim", date: "2026-05-20", currency: "SGD" }), /injected_failure_missing_table/);

  assert.equal(faulty.state.fired, true);
  assertSameDatabase(await dumpDatabase(db), before);
});

test("Simplify commits the checkpoint, its records and its audit event in one batch", async (t) => {
  const { db, api } = await openSeededDatabase(t, template);
  await openSplits(api);
  const batches = [];
  const counting = new Proxy(db, {
    get(target, property) {
      if (property === "batch") {
        return (statements) => {
          batches.push(statements.length);
          return target.batch(statements);
        };
      }
      const value = Reflect.get(target, property);
      return typeof value === "function" ? value.bind(target) : value;
    }
  });
  const result = await createSplitSettlementCheckpoint(counting, { viewerPersonId: "person-tim", date: "2026-05-20", currency: "SGD" });
  assert.equal(batches.length, 1);
  const items = await rows(db, "SELECT record_kind FROM split_settlement_checkpoint_items WHERE checkpoint_id = ?", result.checkpointId);
  assert.equal(batches[0], items.length + 2, "the checkpoint, each record and the audit event");
  assert.ok(items.length >= 2);
  assert.equal((await rows(db, "SELECT id FROM audit_events WHERE action = 'split_checkpoint_created'")).length, 1);
});

test("a new category that fails on its audit event is not created", async (t) => {
  const { db } = await openSeededDatabase(t, template);
  const before = await dumpDatabase(db);
  const faulty = failingStatement(db, /INSERT INTO audit_events/);

  await assert.rejects(createCategoryRecord(faulty.db, { name: "Pets" }), /injected_failure_missing_table/);

  assert.equal(faulty.state.fired, true);
  assertSameDatabase(await dumpDatabase(db), before);
  const created = await createCategoryRecord(db, { name: "Pets" });
  assert.equal((await rows(db, "SELECT name FROM categories WHERE id = ?", created.categoryId))[0].name, "Pets");
});
