// Cash entries are all-or-nothing (docs/code-spec.md "Persistence Atomicity
// Contract"): the cash command decides the fields, then saves through the
// entry create command's one batch (the entry, its audit event and the
// month refresh markers). A statement that fails partway leaves the
// database exactly as it was, and the same request saved later is one entry.
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

let template;
test.before(async () => {
  template = await createSeededTemplate();
});
test.after(async () => {
  await template?.dispose();
});

async function cashWallet(api) {
  const account = await api("/api/accounts/create", { name: "Tim's cash", institution: "Cash", kind: "cash", currency: "SGD", ownerPersonId: "person-tim" });
  await api("/api/settings/payment-ways/save", { personId: "person-tim", bankTransferAccountId: "", cashAccountId: account.payload.accountId });
  return account.payload.accountId;
}

test("a cash save writes the entry and its audit event together", async (t) => {
  const { db, api } = await openSeededDatabase(t, template);
  const walletId = await cashWallet(api);
  const requestId = crypto.randomUUID();

  const saved = await api("/api/cash-entries/create", { requestId, personId: "person-tim", amountMinor: 450, currency: "SGD", description: "bus" });

  assert.equal(saved.status, 200, JSON.stringify(saved.payload));
  const entryId = saved.payload.entry.entryId;
  assert.deepEqual(await rows(db, "SELECT account_id, amount_minor, description, external_reference FROM transactions WHERE id = ?", entryId), [
    { account_id: walletId, amount_minor: 450, description: "Bus", external_reference: `cash:${requestId}` }
  ]);
  assert.deepEqual(await rows(db, "SELECT action FROM audit_events WHERE entity_id = ?", entryId), [{ action: "entry_created" }]);
});

test("a cash save whose audit event fails writes nothing, and the same request later saves once", async (t) => {
  const { db, api } = await openSeededDatabase(t, template);
  await cashWallet(api);
  const requestId = crypto.randomUUID();
  const body = { requestId, personId: "person-tim", amountMinor: 450, currency: "SGD", description: "bus" };
  const before = await dumpDatabase(db);
  const faulty = failingStatement(db, /INSERT INTO audit_events/);

  const failed = await api("/api/cash-entries/create", body, { database: faulty.db });

  assert.equal(faulty.state.fired, true);
  assert.notEqual(failed.status, 200);
  assertSameDatabase(await dumpDatabase(db), before);

  const retried = await api("/api/cash-entries/create", body);
  const again = await api("/api/cash-entries/create", body);
  assert.equal(retried.status, 200, JSON.stringify(retried.payload));
  assert.equal(retried.payload.entry.created, true);
  assert.equal(again.payload.entry.created, false);
  assert.deepEqual(await rows(db, "SELECT COUNT(*) AS n FROM transactions WHERE external_reference = ?", `cash:${requestId}`), [{ n: 1 }]);
});
