// The key proof for "Link these N clear pairs": linking a set of pairs in one
// request leaves the database exactly where linking the same pairs one at a
// time, oldest first, through the single link route would leave it. Two real
// local databases start from the same seed; one takes the bulk request, the
// other the single link for each pair. Every table and the page projections are
// then compared, with only what cannot be the same dropped and said so:
// generated ids (a transfer group's id stands for its sending entry), wall-clock
// timestamps and refresh tokens, and the transfer group's note (the bulk link
// says it came from Check my books).
import assert from "node:assert/strict";
import test from "node:test";

import { createSeededTemplate, dumpDatabase, openSeededDatabase, rows } from "./support/d1-workspace.mjs";
import { SAVINGS, daysAgo, insertAccount, insertEntry, categoryId } from "./support/ledger-checkup-seed.mjs";

let template;
test.before(async () => {
  template = await createSeededTemplate();
});
test.after(async () => {
  await template?.dispose();
});

const JOYCE_BANK = "acct-eq-joyce";
const TIM_SECOND = "acct-eq-tim2";

// The same pairs in both databases, ids fixed: a monthly series 80 days apart
// (so the third can only learn its purpose from the second), a pair whose
// sender already carries a purpose for the wrong person, a pair between two of
// Tim's own accounts whose sender carries one (the link clears it), a certified
// pair, and a pair of another currency's amount shape.
async function seed(db, api) {
  await insertAccount(db, { id: JOYCE_BANK, name: "Joyce Bank", owner: "person-joyce" });
  await insertAccount(db, { id: TIM_SECOND, name: "Tim Second", owner: "person-tim" });
  const transferId = await categoryId(db, "Transfer");
  const homeId = await categoryId(db, "Home");
  const pair = (key, { date, inDate = date, amountMinor, to = JOYCE_BANK, toOwner = "person-joyce", certified = false, outDescription = `eq out ${key}` }) => Promise.all([
    insertEntry(db, { id: `txn-eq-${key}-out`, account: SAVINGS, date, amountMinor, description: outDescription, type: "transfer", direction: "out", owner: "person-tim", categoryId: transferId, certified }),
    insertEntry(db, { id: `txn-eq-${key}-in`, account: to, date: inDate, amountMinor, description: `eq in ${key}`, type: "transfer", direction: "in", owner: toOwner, categoryId: transferId, certified })
  ]);
  const series = [
    ["s1", daysAgo(250), "rent top up"],
    ["s2", daysAgo(170), "mortgage share"],
    ["s3", daysAgo(90), "monthly transfer"],
    ["s4", daysAgo(15), "another one"]
  ];
  for (const [key, date, outDescription] of series) {
    await pair(key, { date, inDate: date, amountMinor: 45_017, outDescription });
  }
  await pair("wrong", { date: daysAgo(200), amountMinor: 3_333 });
  await pair("own", { date: daysAgo(120), amountMinor: 4_444, to: TIM_SECOND, toOwner: "person-tim" });
  await pair("cert", { date: daysAgo(60), amountMinor: 5_555, certified: true });
  await pair("late", { date: daysAgo(30), inDate: daysAgo(28), amountMinor: 6_666 });
  // The sender of "wrong" carries a purpose for Tim; "own"'s carries one at all.
  await db.prepare("UPDATE transactions SET transfer_purpose_category_id = ?, transfer_purpose_person_id = 'person-tim', transfer_purpose_source = 'person' WHERE id = 'txn-eq-wrong-out'").bind(homeId).run();
  await db.prepare("UPDATE transactions SET transfer_purpose_category_id = ?, transfer_purpose_person_id = 'person-joyce', transfer_purpose_source = 'person' WHERE id = 'txn-eq-own-out'").bind(homeId).run();
  // The first of the series was matched by hand and tagged Home, in both databases alike.
  assert.equal((await api("/api/transfers/link", { fromEntryId: "txn-eq-s1-out", toEntryId: "txn-eq-s1-in" })).status, 200);
  assert.equal((await api("/api/transfers/purpose", { entryId: "txn-eq-s1-out", categoryName: "Home" })).status, 200);
}

const TO_LINK = ["s2", "s3", "s4", "wrong", "own", "cert", "late"];

// Chronological by the sending side's date, as the bulk command orders them.
async function chronological(db) {
  return rows(db, `SELECT id AS fromEntryId, transaction_date AS date, REPLACE(id, '-out', '-in') AS toEntryId FROM transactions WHERE id IN (${TO_LINK.map(() => "?").join(", ")}) ORDER BY transaction_date, id`, ...TO_LINK.map((key) => `txn-eq-${key}-out`));
}

const VOLATILE_COLUMN = /(_at|_token)$|^(created|updated)/;

async function normalized(db) {
  const groups = new Map();
  for (const row of await rows(db, "SELECT id, transfer_group_id FROM transactions WHERE transfer_group_id IS NOT NULL AND id LIKE 'txn-eq-%-out'")) {
    groups.set(row.transfer_group_id, `GROUP(${row.id})`);
  }
  const swap = (value) => (typeof value === "string" ? value.replace(/tg-[0-9a-f-]{36}/g, (match) => groups.get(match) ?? match) : value);
  const dump = await dumpDatabase(db);
  const out = {};
  for (const [table, list] of Object.entries(dump)) {
    out[table] = list
      .map((row) => Object.fromEntries(Object.entries(row)
        .filter(([key]) => !VOLATILE_COLUMN.test(key) && !(key === "id" && ["audit_events", "monthly_snapshots"].includes(table)) && !(table === "transfer_groups" && key === "note"))
        .map(([key, value]) => [key, swap(value)])))
      .map((row) => JSON.stringify(row))
      .sort();
  }
  return out;
}

test("bulk linking equals linking the same pairs one at a time, oldest first: every table and the page projections", async (t) => {
  const bulk = await openSeededDatabase(t, template);
  const single = await openSeededDatabase(t, template);
  await seed(bulk.db, bulk.api);
  await seed(single.db, single.api);
  const beforeLink = await normalized(single.db);
  assert.deepEqual(await normalized(bulk.db), beforeLink, "both start identical");

  const order = await chronological(bulk.db);
  assert.equal(order.length, TO_LINK.length);
  // Bulk: one request, listed in no particular order.
  const shown = await bulk.api("/api/ledger-checkup/clear-pairs");
  assert.equal(shown.payload.total, TO_LINK.length, JSON.stringify(shown.payload.rows));
  const result = await bulk.api("/api/ledger-checkup/clear-pairs", { pairs: [...shown.payload.pairs].reverse() });
  assert.equal(result.status, 200, JSON.stringify(result.payload));
  assert.equal(result.payload.linked.length, TO_LINK.length);
  assert.deepEqual(result.payload.skipped, []);
  // One at a time through the single route, the order the bulk command uses.
  for (const { fromEntryId, toEntryId } of order) {
    const linked = await single.api("/api/transfers/link", { fromEntryId, toEntryId });
    assert.equal(linked.status, 200, JSON.stringify(linked.payload));
  }

  const after = await normalized(bulk.db);
  const expected = await normalized(single.db);
  for (const table of new Set([...Object.keys(after), ...Object.keys(expected)])) {
    assert.deepEqual(after[table], expected[table], `table ${table}`);
  }
  // The comparison saw something: the links, their audit events, the learned purposes and the cleared and re-pointed ones.
  assert.equal(expected.transfer_groups.length, beforeLink.transfer_groups.length + TO_LINK.length);
  const purposes = await rows(bulk.db, "SELECT id, transfer_purpose_person_id AS person, transfer_purpose_source AS source FROM transactions WHERE id LIKE 'txn-eq-%-out' AND transfer_purpose_category_id IS NOT NULL ORDER BY id");
  assert.deepEqual(purposes, [
    { id: "txn-eq-s1-out", person: "person-joyce", source: "person" },
    { id: "txn-eq-s2-out", person: "person-joyce", source: "remembered" },
    { id: "txn-eq-s3-out", person: "person-joyce", source: "remembered" },
    { id: "txn-eq-s4-out", person: "person-joyce", source: "remembered" },
    { id: "txn-eq-wrong-out", person: "person-joyce", source: "person" }
  ], "the series learned in order, the wrong receiver was re-pointed, and the pair between Tim's own accounts lost its purpose");
  assert.equal((await rows(bulk.db, "SELECT COUNT(*) AS n FROM audit_events WHERE action = 'transfer_linked'"))[0].n, TO_LINK.length + 1);

  // The projections a person sees agree too (entries and the month totals behind Summary).
  const months = [...new Set((await rows(bulk.db, "SELECT DISTINCT substr(transaction_date, 1, 7) AS month FROM transactions WHERE id LIKE 'txn-eq-%'")).map((row) => row.month))].sort();
  for (const month of months) {
    for (const path of [`/api/entries-page?view=household&month=${month}`, `/api/summary-page?view=household&month=${month}`]) {
      const [left, right] = await Promise.all([bulk.api(path), single.api(path)]);
      assert.equal(left.status, right.status, path);
      assert.equal(JSON.stringify(scrub(left.payload)), JSON.stringify(scrub(right.payload)), path);
    }
  }
});

// Generated group ids are the only random values in a page response.
function scrub(value) {
  return JSON.parse(JSON.stringify(value, (key, item) => (typeof item === "string" ? item.replace(/tg-[0-9a-f-]{36}/g, "GROUP") : item)));
}
