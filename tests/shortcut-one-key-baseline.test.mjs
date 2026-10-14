// Why the Shortcut needed a connection per person: with one household key, a
// second phone that installs the same Shortcut puts its purchases on the first
// card of the one Default account list, owned by that card's owner. This test
// pins that fact (real Worker, real local D1, demo household); the per-person
// connections are tested in shortcut-per-person.test.mjs.
import assert from "node:assert/strict";
import test from "node:test";

import { createSeededTemplate, openSeededDatabase, rows } from "./support/d1-workspace.mjs";
import { enableShortcut, postWalletPurchase } from "./support/foreign-wallet.mjs";

let template;
test.before(async () => {
  template = await createSeededTemplate();
});
test.after(async () => {
  await template?.dispose();
});

test("one household key sends a second phone's purchase to the first priority card, owned by that card's owner", async (t) => {
  const { db, fetch: fetchWorker } = await openSeededDatabase(t, template);
  const [uobOne] = await rows(db, "SELECT id FROM accounts WHERE account_name = 'UOB One'");
  await enableShortcut(db, { defaultAccountPriorityIds: [uobOne.id] });

  // Joyce's phone, installed from the same connection.
  const { status, payload } = await postWalletPurchase(fetchWorker, { amount: "SGD 8.40", description: "Joyce's coffee" });

  assert.equal(status, 200, JSON.stringify(payload));
  assert.equal(payload.accountId, uobOne.id);
  const [entry] = await rows(db, "SELECT owner_person_id FROM transactions WHERE id = ?", payload.entryId);
  assert.equal(entry.owner_person_id, "person-tim", "her purchase shows as his");
});
