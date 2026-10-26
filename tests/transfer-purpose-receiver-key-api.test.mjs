// Transfer purpose learning by receiver through the real Worker and a local
// D1 (owner decision, 2026-10-26; DOMAIN.md "Transfer Purpose", "Learning").
// Production case: Tim's monthly $450 to Joyce was "Funds Transfer JOYCE"
// (1 Sep, tagged Home); on 1 Oct the bank text became "Funds Transfer HDB
// mortgage JO..." and the old description rule missed it. The key is now the
// sending account, the receiving person, the amount and the currency; the
// receiver is known once Joyce's side is matched, so the purpose is applied
// then (and when an import or a manual add already has the pair).
import assert from "node:assert/strict";
import test from "node:test";

import {
  createEntry,
  createSeededTemplate,
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

async function get(api, pathname) {
  const response = await api(pathname);
  assert.equal(response.status, 200, JSON.stringify(response.payload));
  return response.payload;
}

async function addJoyceBank(db) {
  const [{ id: householdId }] = await rows(db, "SELECT id FROM households LIMIT 1");
  const [{ institution_id: institutionId }] = await rows(db, "SELECT institution_id FROM accounts WHERE id = 'acct-uob-savings'");
  await db.prepare("INSERT OR IGNORE INTO accounts (id, household_id, institution_id, owner_person_id, account_name, account_kind, currency) VALUES ('acct-joyce-bank', ?, ?, 'person-joyce', 'Joyce Bank', 'bank', 'SGD')")
    .bind(householdId, institutionId).run();
}

const out = (api, date, description, amountMinor = 45_000) => createEntry(api, {
  date, description, accountName: "UOB Savings", categoryName: "Transfer", amountMinor,
  entryType: "transfer", transferDirection: "out", ownerName: "Tim"
});

async function receive(api, outId, date, amountMinor = 45_000) {
  const inId = await createEntry(api, {
    date, description: "FAST from Tim", accountName: "Joyce Bank", categoryName: "Transfer", amountMinor,
    entryType: "transfer", transferDirection: "in", ownerName: "Joyce"
  });
  const link = await api("/api/transfers/link", { fromEntryId: outId, toEntryId: inId });
  assert.equal(link.status, 200, JSON.stringify(link.payload));
  return { inId, link };
}

// September's matched transfer, tagged Home by hand.
async function taggedSeptember(db, api) {
  await addJoyceBank(db);
  const september = await out(api, "2026-09-01", "Funds Transfer JOYCE");
  await receive(api, september, "2026-09-01");
  await api("/api/transfers/purpose", { entryId: september, categoryName: "Home" });
  return september;
}

const purposeOf = (db, id) => rows(db, "SELECT transfer_purpose_category_id AS category, transfer_purpose_person_id AS person, transfer_purpose_source AS source FROM transactions WHERE id = ?", id);

test("October's 'HDB mortgage' transfer gets Home like last month once Joyce's side is matched, and the editor offers Undo", async (t) => {
  const { db, api } = await openSeededDatabase(t, template);
  await taggedSeptember(db, api);

  // Saved before the other side is matched: the receiver is not known and
  // the wording changed, so the description rule finds nothing.
  const october = await out(api, "2026-10-01", "Funds Transfer HDB mortgage JO");
  assert.deepEqual(await purposeOf(db, october), [{ category: null, person: null, source: null }]);

  await receive(api, october, "2026-10-01");
  const [stored] = await purposeOf(db, october);
  assert.deepEqual([stored.person, stored.source], ["person-joyce", "remembered"]);
  const listed = (await get(api, "/api/entries-page?view=person-tim&month=2026-10")).monthPage.entries.find((entry) => entry.id === october);
  assert.deepEqual(listed.transferPurpose, { categoryName: "Home", toPersonId: "person-joyce", toPersonName: "Joyce", remembered: true });
  const [audit] = await rows(db, "SELECT action FROM audit_events WHERE entity_id = ? ORDER BY rowid DESC LIMIT 1", october);
  assert.equal(audit.action, "transfer_purpose_remembered");

  // Undo is the existing clear command.
  assert.equal((await api("/api/transfers/purpose", { entryId: october, categoryName: null })).payload.updated, true);
  assert.deepEqual(await purposeOf(db, october), [{ category: null, person: null, source: null }]);
});

test("another amount is never carried over, and a month cleared by hand stops the next one", async (t) => {
  const { db, api } = await openSeededDatabase(t, template);
  await taggedSeptember(db, api);

  const other = await out(api, "2026-10-01", "Funds Transfer HDB mortgage JO", 45_100);
  await receive(api, other, "2026-10-01", 45_100);
  assert.deepEqual(await purposeOf(db, other), [{ category: null, person: null, source: null }]);

  const october = await out(api, "2026-10-01", "Funds Transfer HDB mortgage JO");
  await receive(api, october, "2026-10-01");
  assert.equal((await purposeOf(db, october))[0].source, "remembered");

  await api("/api/transfers/purpose", { entryId: october, categoryName: null });
  const november = await out(api, "2026-11-01", "Funds Transfer HDB mortgage JOYCE");
  await receive(api, november, "2026-11-01");
  assert.deepEqual(await purposeOf(db, november), [{ category: null, person: null, source: null }]);
});

test("a purpose applied when the pair is matched that fails part way is not written, and the link itself stands", async (t) => {
  const { db, api } = await openSeededDatabase(t, template);
  await taggedSeptember(db, api);
  const october = await out(api, "2026-10-01", "Funds Transfer HDB mortgage JO");
  const inId = await createEntry(api, { date: "2026-10-01", description: "FAST from Tim", accountName: "Joyce Bank", categoryName: "Transfer", amountMinor: 45_000, entryType: "transfer", transferDirection: "in", ownerName: "Joyce" });
  const faulty = failingStatement(db, /transfer_purpose_source = 'remembered'/);

  const link = await api("/api/transfers/link", { fromEntryId: october, toEntryId: inId }, { database: faulty.db });

  assert.equal(link.status, 200, JSON.stringify(link.payload));
  assert.equal(faulty.state.fired, true);
  assert.deepEqual(await purposeOf(db, october), [{ category: null, person: null, source: null }]);
  assert.equal((await rows(db, "SELECT transfer_group_id FROM transactions WHERE id = ?", october))[0].transfer_group_id, link.payload.groupId);
});
