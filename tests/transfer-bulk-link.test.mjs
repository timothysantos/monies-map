// "Link these N clear pairs" through the real Worker and a local D1 (owner
// approval, docs/flows/check-flow.md, docs/audits/ledger-checkup.md "Clear
// pairs"). The preview lists the clear pairs; the command links exactly the
// pairs the person was shown that are still clear, all in one batch, with the
// single link's own writes, one audit event per pair, one marker set for the
// months, and the transfer purpose learned in date order. Anything that
// stopped being clear is skipped by name, nothing else is touched.
import assert from "node:assert/strict";
import test from "node:test";

import {
  assertSameDatabase,
  createSeededTemplate,
  dumpDatabase,
  failingStatement,
  openSeededDatabase,
  rows,
  snapshotTotals
} from "./support/d1-workspace.mjs";
import { SAVINGS, TIM_CARD, daysAgo, insertAccount, insertEntry, categoryId } from "./support/ledger-checkup-seed.mjs";

let template;
test.before(async () => {
  template = await createSeededTemplate();
});
test.after(async () => {
  await template?.dispose();
});

const PATH = "/api/ledger-checkup/clear-pairs";
const JOYCE_BANK = "acct-bulk-joyce";

// A transfer out of Tim's savings and the matching transfer in on Joyce's
// bank, unlinked, with fixed ids so two databases can hold the same pair.
async function addPair(db, key, { date, inDate = date, amountMinor = 45_017, from = SAVINGS, to = JOYCE_BANK, outDescription = `FAST to Joyce ${key}`, certified = false } = {}) {
  const transferId = await categoryId(db, "Transfer");
  const fromEntryId = await insertEntry(db, { id: `txn-bulk-${key}-out`, account: from, date, amountMinor, description: outDescription, type: "transfer", direction: "out", owner: "person-tim", categoryId: transferId, certified });
  const toEntryId = await insertEntry(db, { id: `txn-bulk-${key}-in`, account: to, date: inDate, amountMinor, description: `FAST from Tim ${key}`, type: "transfer", direction: "in", owner: "person-joyce", categoryId: transferId, certified });
  return { fromEntryId, toEntryId };
}

async function openWorkspace(t) {
  const workspace = await openSeededDatabase(t, template);
  await insertAccount(workspace.db, { id: JOYCE_BANK, name: "Joyce Bank", owner: "person-joyce" });
  return workspace;
}

const preview = async (api, query = "") => {
  const { status, payload } = await api(`${PATH}${query}`);
  assert.equal(status, 200, JSON.stringify(payload));
  return payload;
};
const link = (api, pairs, options) => api(PATH, { pairs: pairs.map(({ fromEntryId, toEntryId }) => ({ fromEntryId, toEntryId })) }, options);
const stateOf = (db, ids) => rows(db, `SELECT id, entry_type, transfer_direction, transfer_group_id, category_id, offsets_category, amount_minor, account_id, transaction_date, bank_certification_status FROM transactions WHERE id IN (${ids.map(() => "?").join(", ")}) ORDER BY id`, ...ids);

test("the preview lists the clear pairs oldest first with names, the first ten, the month range and the cap, and writes nothing", async (t) => {
  const { db, api } = await openWorkspace(t);
  const made = [];
  for (let month = 0; month < 14; month += 1) {
    made.push(await addPair(db, `m${String(month).padStart(2, "0")}`, { date: daysAgo(30 * (14 - month) + 20), inDate: daysAgo(30 * (14 - month) + 19), amountMinor: 45_017 }));
  }
  await api("/api/ledger-checkup");
  const before = await dumpDatabase(db);

  const payload = await preview(api);

  assertSameDatabase(await dumpDatabase(db), before);
  assert.equal(payload.total, 14);
  assert.equal(payload.cap, 100);
  assert.equal(payload.linkCount, 14);
  assert.equal(payload.remaining, 0);
  assert.deepEqual(payload.pairs, made.map(({ fromEntryId, toEntryId }) => ({ fromEntryId, toEntryId })));
  assert.equal(payload.rows.length, 10);
  assert.deepEqual(payload.rows[0], { fromEntryId: made[0].fromEntryId, toEntryId: made[0].toEntryId, date: daysAgo(30 * 14 + 20), amountMinor: 45_017, currency: "SGD", fromAccountName: "UOB Savings", toAccountName: "Joyce Bank" });
  assert.match(payload.firstMonth, /^\d{4}-\d\d$/);
  assert.equal(payload.firstMonth, daysAgo(30 * 14 + 20).slice(0, 7));
  assert.equal(payload.lastMonth, daysAgo(30 * 1 + 20).slice(0, 7));
});

test("the check-up report says how many clear pairs there are, and a person's view counts only theirs", async (t) => {
  const { db, api } = await openWorkspace(t);
  await addPair(db, "a", { date: daysAgo(40) });
  await addPair(db, "b", { date: daysAgo(80), amountMinor: 12_300 });
  const report = (await api("/api/ledger-checkup")).payload;
  assert.equal(report.clearTransferPairCount, 2);
  assert.equal(report.kindCounts.unmatched_transfer.high, 2);
  assert.equal((await api("/api/ledger-checkup?view=person-joyce")).payload.clearTransferPairCount, 2, "Joyce's bank is one side of each");
  await insertAccount(db, { id: "acct-bulk-other", name: "Other", owner: "person-tim" });
  await addPair(db, "c", { date: daysAgo(50), amountMinor: 7_700, to: "acct-bulk-other" });
  assert.equal((await api("/api/ledger-checkup?view=person-joyce")).payload.clearTransferPairCount, 2, "a pair between Tim's own accounts is not Joyce's");
  assert.equal((await api("/api/ledger-checkup")).payload.clearTransferPairCount, 3);
});

test("linking the shown pairs does what the single link does for each: one group, types, Transfer category, one audit event, month totals", async (t) => {
  const { db, api } = await openWorkspace(t);
  const made = [await addPair(db, "a", { date: daysAgo(70) }), await addPair(db, "b", { date: daysAgo(40), amountMinor: 12_300 }), await addPair(db, "c", { date: daysAgo(15), amountMinor: 9_900, certified: true })];
  const shown = await preview(api);
  assert.equal(shown.total, 3);

  const { status, payload } = await link(api, shown.pairs);

  assert.equal(status, 200, JSON.stringify(payload));
  assert.equal(payload.ok, true);
  assert.deepEqual(payload.skipped, []);
  assert.deepEqual(payload.linked.map((item) => [item.fromEntryId, item.toEntryId]), made.map((pair) => [pair.fromEntryId, pair.toEntryId]));
  const transferId = await categoryId(db, "Transfer");
  for (const [index, pair] of made.entries()) {
    const groupId = payload.linked[index].groupId;
    assert.match(groupId, /^tg-/);
    const states = await stateOf(db, [pair.fromEntryId, pair.toEntryId]);
    const from = states.find((row) => row.id === pair.fromEntryId);
    const to = states.find((row) => row.id === pair.toEntryId);
    assert.deepEqual([from.transfer_group_id, from.entry_type, from.transfer_direction, from.category_id, from.offsets_category], [groupId, "transfer", "out", transferId, 0]);
    assert.deepEqual([to.transfer_group_id, to.entry_type, to.transfer_direction, to.category_id, to.offsets_category], [groupId, "transfer", "in", transferId, 0]);
    assert.equal(from.amount_minor, to.amount_minor);
  }
  // A certified pair keeps its bank facts.
  const certified = await stateOf(db, [made[2].fromEntryId, made[2].toEntryId]);
  assert.deepEqual(certified.map((row) => [row.bank_certification_status, row.amount_minor, row.transaction_date]), [["statement_certified", 9_900, daysAgo(15)], ["statement_certified", 9_900, daysAgo(15)]]);
  assert.deepEqual(await rows(db, "SELECT COUNT(*) AS n FROM transfer_groups WHERE id IN (?, ?, ?)", ...payload.linked.map((item) => item.groupId)), [{ n: 3 }]);
  const events = await rows(db, "SELECT entity_id, detail FROM audit_events WHERE action = 'transfer_linked' ORDER BY detail");
  assert.deepEqual(events.map((event) => event.detail), made.map((pair) => `Linked transfer pair ${pair.fromEntryId} -> ${pair.toEntryId}.`).sort());
  assert.deepEqual(await rows(db, "SELECT month_key FROM monthly_snapshot_refreshes"), [], "the marked months were refreshed and their markers cleared");
  // The month totals were refreshed: a month's snapshot exists for the months of the pairs.
  for (const pair of made) {
    const month = (await stateOf(db, [pair.fromEntryId]))[0].transaction_date.slice(0, 7);
    assert.ok((await snapshotTotals(db, month)).length > 0, `${month} has a snapshot`);
  }
  // The check-up no longer lists the pairs, and the preview is empty.
  const after = await preview(api);
  assert.equal(after.total, 0);
  assert.deepEqual(after.pairs, []);
  assert.equal((await api("/api/ledger-checkup")).payload.clearTransferPairCount, 0);
  assert.equal((await api("/api/ledger-checkup")).payload.kindCounts.unmatched_transfer?.high ?? 0, 0, "no pair is waiting for its other side any more");
});

test("a pair can be unlinked afterwards with the existing command", async (t) => {
  const { db, api } = await openWorkspace(t);
  const pair = await addPair(db, "a", { date: daysAgo(40) });
  const { payload } = await link(api, (await preview(api)).pairs);
  assert.equal(payload.linked.length, 1);
  const update = await api("/api/entries/update", { entryId: pair.fromEntryId, date: daysAgo(40), description: "FAST to Joyce a", accountName: "UOB Savings", categoryName: "Shopping", amountMinor: 45_017, entryType: "expense", ownershipType: "direct", ownerName: "Tim" });
  assert.equal(update.status, 200, JSON.stringify(update.payload));
  assert.deepEqual(await rows(db, "SELECT id FROM transfer_groups WHERE id = ?", payload.linked[0].groupId), []);
  assert.deepEqual((await stateOf(db, [pair.toEntryId]))[0].transfer_group_id, null);
});

test("an id that stopped being clear is skipped by name; a pair that was never clear is refused; nothing else changes", async (t) => {
  const { db, api } = await openWorkspace(t);
  const first = await addPair(db, "a", { date: daysAgo(70) });
  const second = await addPair(db, "b", { date: daysAgo(40), amountMinor: 12_300 });
  const third = await addPair(db, "c", { date: daysAgo(20), amountMinor: 9_900 });
  const shown = await preview(api);
  assert.equal(shown.total, 3);

  // After the person looked: a lookalike arrives next to the second pair, and the third is linked by hand.
  await insertEntry(db, { id: "txn-bulk-rival", account: "acct-uob-one", date: daysAgo(41), amountMinor: 12_300, type: "expense" });
  assert.equal((await api("/api/transfers/link", { fromEntryId: third.fromEntryId, toEntryId: third.toEntryId })).status, 200);
  // And a pair the person was never shown: money in matched with money out the wrong way round, or two unrelated entries.
  const stranger = await insertEntry(db, { id: "txn-bulk-stranger", account: TIM_CARD, date: daysAgo(30), amountMinor: 45_017, type: "expense" });
  const elsewhere = await addPair(db, "e", { date: daysAgo(25), amountMinor: 8_800 });
  const reversed = await addPair(db, "d", { date: daysAgo(26), amountMinor: 6_600 });
  const before = await dumpDatabase(db);

  const { status, payload } = await link(api, [
    ...shown.pairs,
    { fromEntryId: stranger, toEntryId: elsewhere.toEntryId },
    { fromEntryId: reversed.toEntryId, toEntryId: reversed.fromEntryId }
  ]);

  assert.equal(status, 200, JSON.stringify(payload));
  assert.deepEqual(payload.linked.map((item) => item.fromEntryId), [first.fromEntryId]);
  assert.deepEqual(payload.skipped.map((item) => [item.fromEntryId, item.toEntryId, item.reason]), [
    [second.fromEntryId, second.toEntryId, "changed"],
    [third.fromEntryId, third.toEntryId, "changed"],
    [stranger, elsewhere.toEntryId, "changed"],
    [reversed.toEntryId, reversed.fromEntryId, "changed"]
  ]);
  const [from, to] = await stateOf(db, [first.fromEntryId, first.toEntryId]);
  assert.equal(from.transfer_group_id, payload.linked[0].groupId);
  assert.equal(to.transfer_group_id, payload.linked[0].groupId);
  // The skipped ones are exactly as they were.
  const after = await dumpDatabase(db);
  for (const id of [second.fromEntryId, second.toEntryId, stranger, "txn-bulk-rival", elsewhere.fromEntryId, elsewhere.toEntryId, reversed.fromEntryId, reversed.toEntryId]) {
    assert.deepEqual(after.transactions.find((row) => row.id === id), before.transactions.find((row) => row.id === id));
  }
  assert.equal(after.transfer_groups.length, before.transfer_groups.length + 1);

  // Nothing left to link: no batch, no audit event, an honest empty result.
  const none = await link(api, [{ fromEntryId: second.fromEntryId, toEntryId: second.toEntryId }]);
  assert.equal(none.status, 200);
  assert.deepEqual([none.payload.linked.length, none.payload.skipped.length], [0, 1]);
  assert.equal((await rows(db, "SELECT COUNT(*) AS n FROM audit_events WHERE action = 'transfer_linked'"))[0].n, 2);
});

test("a pair marked as fine in the check-up, a held transfer, a young one and a different amount are never offered or linked", async (t) => {
  const { db, api } = await openWorkspace(t);
  const fine = await addPair(db, "fine", { date: daysAgo(60), amountMinor: 11_100 });
  const held = await addPair(db, "held", { date: daysAgo(55), amountMinor: 22_200 });
  const young = await addPair(db, "young", { date: daysAgo(3), amountMinor: 33_300 });
  const odd = await addPair(db, "odd", { date: daysAgo(45), amountMinor: 44_400 });
  await db.prepare("UPDATE transactions SET amount_minor = 44_401 WHERE id = ?").bind(odd.toEntryId).run();
  await db.prepare("UPDATE transactions SET transfer_review_dismissed_at = CURRENT_TIMESTAMP WHERE id = ?").bind(held.fromEntryId).run();
  const good = await addPair(db, "good", { date: daysAgo(50), amountMinor: 55_500 });
  const finding = (await api("/api/ledger-checkup")).payload.findings.find((item) => item.id.includes(fine.fromEntryId));
  assert.equal(finding.tier, "high");
  assert.equal((await api("/api/ledger-checkup/dismiss", { id: finding.id, evidenceKey: finding.evidenceKey })).status, 200);

  const shown = await preview(api);
  assert.deepEqual(shown.pairs, [{ fromEntryId: good.fromEntryId, toEntryId: good.toEntryId }]);
  const { payload } = await link(api, [fine, held, young, odd, good]);
  assert.deepEqual(payload.linked.map((item) => item.fromEntryId), [good.fromEntryId]);
  assert.deepEqual(payload.skipped.map((item) => item.fromEntryId), [fine.fromEntryId, held.fromEntryId, young.fromEntryId, odd.fromEntryId]);
});

test("a request is refused when it is empty, malformed, repeats an entry, or asks for more than 100 pairs", async (t) => {
  const { db, api } = await openWorkspace(t);
  const pair = await addPair(db, "a", { date: daysAgo(40) });
  const before = await dumpDatabase(db);
  const bad = async (body) => {
    const { status, payload } = await api(PATH, body);
    assert.equal(status, 400, JSON.stringify(payload));
    assert.equal(payload.ok, false);
    return payload.error;
  };
  await bad({});
  await bad({ pairs: [] });
  await bad({ pairs: [{ fromEntryId: pair.fromEntryId }] });
  await bad({ pairs: [{ fromEntryId: pair.fromEntryId, toEntryId: pair.fromEntryId }] });
  await bad({ pairs: [pair, pair] });
  await bad({ pairs: [pair, { fromEntryId: pair.fromEntryId, toEntryId: "txn-other" }] });
  const tooMany = Array.from({ length: 101 }, (_, index) => ({ fromEntryId: `txn-x-${index}-out`, toEntryId: `txn-x-${index}-in` }));
  assert.match(await bad({ pairs: tooMany }), /at most 100/);
  assertSameDatabase(await dumpDatabase(db), before);
  // Exactly the cap is accepted (and the unknown ids are skipped, not an error).
  const cap = await api(PATH, { pairs: tooMany.slice(0, 100) });
  assert.equal(cap.status, 200);
  assert.equal(cap.payload.skipped.length, 100);
});

test("a failure at any write of the batch leaves the database exactly as it was", async (t) => {
  const { db, api } = await openWorkspace(t);
  const pairs = [await addPair(db, "a", { date: daysAgo(70) }), await addPair(db, "b", { date: daysAgo(40), amountMinor: 12_300 })];
  const shown = (await preview(api)).pairs;
  const before = await dumpDatabase(db);
  for (const [name, pattern, skip] of [
    ["the first transfer group", /INSERT INTO transfer_groups/, 0],
    ["the second transfer group", /INSERT INTO transfer_groups/, 1],
    ["a sending side", /transfer_direction = 'out'/, 1],
    ["a receiving side", /transfer_direction = 'in'/, 0],
    ["the first audit event", /INTO audit_events/, 0],
    ["the last audit event", /INTO audit_events/, 1],
    ["the month markers", /INTO monthly_snapshot_refreshes/, 0]
  ]) {
    const faulty = failingStatement(db, pattern, { skip });
    const result = await link(api, shown, { database: faulty.db });
    assert.equal(faulty.state.fired, true, `${name} was reached`);
    assert.notEqual(result.status, 200, name);
    assert.equal(result.payload.ok, false, name);
    assertSameDatabase(await dumpDatabase(db), before);
  }
  // And with no fault the same request still links both.
  assert.equal((await link(api, shown)).payload.linked.length, pairs.length);
});

test("a series learns what it is for in date order: each month's pair carries the purpose of the one before it, which none of them could from the first alone", async (t) => {
  const { db, api } = await openWorkspace(t);
  // Three monthly transfers 80 days apart: the third is 160 days after the first, beyond the 100 days a
  // purpose is remembered over, so it can only learn from the second's.
  const months = [await addPair(db, "m1", { date: daysAgo(170), outDescription: "JOYCE rent" }), await addPair(db, "m2", { date: daysAgo(90), outDescription: "HDB mortgage" }), await addPair(db, "m3", { date: daysAgo(12), outDescription: "Monthly top up" })];
  // The first month was linked by hand and tagged Home.
  assert.equal((await api("/api/transfers/link", { fromEntryId: months[0].fromEntryId, toEntryId: months[0].toEntryId })).status, 200);
  assert.equal((await api("/api/transfers/purpose", { entryId: months[0].fromEntryId, categoryName: "Home" })).status, 200);
  const shown = await preview(api);
  assert.deepEqual(shown.pairs.map((pair) => pair.fromEntryId), [months[1].fromEntryId, months[2].fromEntryId]);

  const { status, payload } = await link(api, [...shown.pairs].reverse());

  assert.equal(status, 200, JSON.stringify(payload));
  assert.equal(payload.purposesLearned, 2);
  const purposes = await rows(db, "SELECT id, transfer_purpose_person_id AS person, transfer_purpose_source AS source, (SELECT name FROM categories WHERE id = transfer_purpose_category_id) AS category FROM transactions WHERE id IN (?, ?, ?) ORDER BY id", ...months.map((pair) => pair.fromEntryId));
  assert.deepEqual(purposes, months.map((pair, index) => ({ id: pair.fromEntryId, person: "person-joyce", source: index === 0 ? "person" : "remembered", category: "Home" })).sort((left, right) => left.id.localeCompare(right.id)));
  const remembered = await rows(db, "SELECT detail FROM audit_events WHERE action = 'transfer_purpose_remembered' ORDER BY rowid");
  assert.deepEqual(remembered.map((row) => row.detail.split(" pays for the same as ")[1]), [`${months[0].fromEntryId}.`, `${months[1].fromEntryId}.`], "the second learned from the first, the third from the second, in date order whatever order the request listed them in");
});

test("a purpose cleared by hand stops the series, as it does one pair at a time", async (t) => {
  const { db, api } = await openWorkspace(t);
  const months = [await addPair(db, "m1", { date: daysAgo(150) }), await addPair(db, "m2", { date: daysAgo(100) }), await addPair(db, "m3", { date: daysAgo(50) })];
  assert.equal((await api("/api/transfers/link", { fromEntryId: months[0].fromEntryId, toEntryId: months[0].toEntryId })).status, 200);
  assert.equal((await api("/api/transfers/purpose", { entryId: months[0].fromEntryId, categoryName: "Home" })).status, 200);
  // Month two was linked, learned Home and the person said "just a transfer".
  assert.equal((await api("/api/transfers/link", { fromEntryId: months[1].fromEntryId, toEntryId: months[1].toEntryId })).status, 200);
  assert.equal((await api("/api/transfers/purpose", { entryId: months[1].fromEntryId, categoryName: null })).status, 200);
  const shown = await preview(api);
  const { payload } = await link(api, shown.pairs);
  assert.equal(payload.linked.length, 1);
  assert.equal(payload.purposesLearned, 0);
  assert.deepEqual(await rows(db, "SELECT transfer_purpose_category_id AS c FROM transactions WHERE id = ?", months[2].fromEntryId), [{ c: null }]);
});

test("the batch and the purposes it triggers fail apart: a failed purpose step keeps the links and says so", async (t) => {
  const { db, api } = await openWorkspace(t);
  const months = [await addPair(db, "m1", { date: daysAgo(90) }), await addPair(db, "m2", { date: daysAgo(40) })];
  assert.equal((await api("/api/transfers/link", { fromEntryId: months[0].fromEntryId, toEntryId: months[0].toEntryId })).status, 200);
  await api("/api/transfers/purpose", { entryId: months[0].fromEntryId, categoryName: "Home" });
  const faulty = failingStatement(db, /transfer_purpose_source = 'remembered'/);
  const { status, payload } = await link(api, (await preview(api)).pairs, { database: faulty.db });
  assert.equal(faulty.state.fired, true);
  assert.equal(status, 200, "the links are kept");
  assert.equal(payload.linked.length, 1);
  assert.equal(payload.purposesLearned, 0);
  assert.equal(payload.purposesFailed, true);
  assert.deepEqual(await rows(db, "SELECT transfer_purpose_category_id AS c FROM transactions WHERE id = ?", months[1].fromEntryId), [{ c: null }]);
});
