// Editing an entry refuses an amount of zero or less, the same rule as
// creating one. The editor reads a cleared or unreadable amount field as 0,
// and the update used to accept it and quietly keep the stored amount, so
// the save looked done while the person's change was lost. Leaving the
// amount out of an update still keeps the stored amount. Real local D1
// (Miniflare) seeded with the demo household.
import assert from "node:assert/strict";
import test from "node:test";

import {
  assertSameDatabase,
  createEntry,
  createSeededTemplate,
  dumpDatabase,
  openSeededDatabase,
  rows
} from "./support/d1-workspace.mjs";

let template;
test.before(async () => {
  template = await createSeededTemplate();
});
test.after(async () => {
  await template?.dispose();
});

function entryUpdate(entryId, overrides) {
  return {
    entryId,
    date: "2026-05-14",
    description: "Amount guard groceries",
    accountName: "UOB One",
    categoryName: "Groceries",
    amountMinor: 4_250,
    entryType: "expense",
    ownershipType: "direct",
    ownerName: "Tim",
    ...overrides
  };
}

test("an entry update with an amount of zero, a negative amount or no readable amount is refused and changes nothing", async (t) => {
  const { db, api } = await openSeededDatabase(t, template);
  const entryId = await createEntry(api, { date: "2026-05-14", description: "Amount guard groceries", amountMinor: 4_250 });
  const before = await dumpDatabase(db);

  for (const amountMinor of [0, -1_250, null, "abc"]) {
    const update = await api("/api/entries/update", entryUpdate(entryId, { amountMinor, description: "Amount guard renamed" }));
    assert.deepEqual(
      { status: update.status, payload: update.payload },
      { status: 400, payload: { ok: false, error: "Amount must be greater than zero" } },
      `amountMinor ${JSON.stringify(amountMinor)}`
    );
  }

  // Not even the other fields of the refused save were written.
  assertSameDatabase(await dumpDatabase(db), before);
});

// The composer sends the same 0 for a cleared field. The create route turns
// a non-number away earlier, as a missing field.
test("creating an entry refuses a zero or negative amount with the same reason", async (t) => {
  const { db, api } = await openSeededDatabase(t, template);
  const before = await dumpDatabase(db);

  for (const [amountMinor, error] of [
    [0, "Amount must be greater than zero"],
    [-1_250, "Amount must be greater than zero"],
    [null, "Missing entry create fields"],
    ["abc", "Missing entry create fields"]
  ]) {
    const { entryId: _entryId, ...create } = entryUpdate(undefined, { amountMinor });
    const created = await api("/api/entries/create", create);
    assert.deepEqual(
      { status: created.status, payload: created.payload },
      { status: 400, payload: { ok: false, error } },
      `amountMinor ${JSON.stringify(amountMinor)}`
    );
  }

  assertSameDatabase(await dumpDatabase(db), before);
});

test("an entry update with a positive amount saves it, and one without an amount keeps the stored amount", async (t) => {
  const { db, api } = await openSeededDatabase(t, template);
  const entryId = await createEntry(api, { date: "2026-05-14", description: "Amount guard groceries", amountMinor: 4_250 });

  const changed = await api("/api/entries/update", entryUpdate(entryId, { amountMinor: 3_100 }));
  assert.equal(changed.status, 200, JSON.stringify(changed.payload));
  assert.deepEqual(await rows(db, "SELECT amount_minor, description FROM transactions WHERE id = ?", entryId), [
    { amount_minor: 3_100, description: "Amount guard groceries" }
  ]);

  const { amountMinor: _omitted, ...withoutAmount } = entryUpdate(entryId, { description: "Amount guard renamed" });
  const renamed = await api("/api/entries/update", withoutAmount);
  assert.equal(renamed.status, 200, JSON.stringify(renamed.payload));
  assert.deepEqual(await rows(db, "SELECT amount_minor, description FROM transactions WHERE id = ?", entryId), [
    { amount_minor: 3_100, description: "Amount guard renamed" }
  ]);
});
