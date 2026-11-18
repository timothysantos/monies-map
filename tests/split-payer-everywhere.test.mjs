// Who paid, the same everywhere (DOMAIN.md "Split Payer"; owner decision
// 2026-11-18, follow-up to Ask audit B28). The picked rows' "Add to Splits"
// bar on Entries, Usually shared (the Splits list and Ask's card) and Ask's
// habitual split all put an entry on Splits through the one rule
// (src/domain/split-payer.ts): a wallet that belongs to one person means that
// person paid, a joint wallet keeps the entry's owner. Through the real
// Worker on a local D1 seeded with the demo household (Tim and Joyce): split
// rows and balances are pinned to the cent, a split already saved keeps its
// payer, and a failing statement in the middle of a mixed batch writes
// nothing.
import assert from "node:assert/strict";
import test from "node:test";

import { addEntriesToSplitsRecord } from "../src/domain/app-repository-splits.ts";
import { loadSummarySplitBalances } from "../src/domain/pages/summary-split-balances.ts";
import { todayInAppTimeZone } from "../src/lib/app-calendar.ts";
import {
  assertSameDatabase,
  createEntry,
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

const SHOP = "Cold Storage Holland V";
const GROUP = "split-group-baby-river";

function daysAgo(days) {
  const date = new Date(`${todayInAppTimeZone()}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
}

// Tim's own card (UOB One), Joyce's own card and a joint wallet.
async function wallets(db, api) {
  const accounts = await rows(db, "SELECT id, account_name, owner_person_id, is_joint FROM accounts WHERE is_active = 1 ORDER BY account_name");
  const timCard = accounts.find((account) => account.account_name === "UOB One");
  const joyceCard = accounts.find((account) => account.owner_person_id === "person-joyce" && !account.is_joint);
  let joint = accounts.find((account) => account.is_joint);
  if (!joint) {
    const created = await api("/api/accounts/create", { name: "Joint Everyday", institution: "DBS", kind: "bank", currency: "SGD", openingBalanceMinor: 0, ownerPersonId: "", isJoint: true });
    joint = { id: created.payload.accountId, account_name: "Joint Everyday" };
  }
  assert.equal(timCard.owner_person_id, "person-tim");
  assert.ok(joyceCard && joint);
  return { timCard, joyceCard, joint };
}

// A Tim-owned expense on the given wallet.
const timEntry = (api, accountId, extra = {}) => createEntry(api, { accountId, accountName: undefined, date: daysAgo(3), description: SHOP, amountMinor: 1000, ownerName: "Tim", ...extra });

// Tim shared this shop 70/30 in Baby River three times on his own card.
async function teachTimsHabit(api, timCard) {
  await api("/api/ask/habits/setting", { enabled: false });
  for (let index = 0; index < 3; index += 1) {
    const entryId = await timEntry(api, timCard.id, { date: daysAgo(120 + index * 20), amountMinor: 2400 + index });
    const added = await api("/api/splits/expenses/from-entry", { entryId, splitGroupId: GROUP, splitBasisPoints: 7000 });
    assert.equal(added.status, 200, JSON.stringify(added.payload));
  }
}

async function splitOf(db, entryId) {
  const [split] = await rows(db, "SELECT id, payer_person_id, total_amount_minor, split_group_id FROM split_expenses WHERE linked_transaction_id = ? AND deleted_at IS NULL", entryId);
  const shares = split
    ? await rows(db, "SELECT person_id, ratio_basis_points, amount_minor FROM split_expense_shares WHERE split_expense_id = ? ORDER BY person_id", split.id)
    : [];
  return { split, shares };
}

// What Tim is owed across every group (negative: Tim owes Joyce).
async function owedToTim(db) {
  const lines = await loadSummarySplitBalances(db, "person-tim", {});
  return lines.reduce((sum, line) => sum + line.balanceMinor, 0);
}

test("Usually shared: Tim's entry on Joyce's own card lists Joyce as who paid and Tim's usual 70%, and Add writes Joyce as payer to the cent", async (t) => {
  const { db, api } = await openSeededDatabase(t, template);
  const { timCard, joyceCard } = await wallets(db, api);
  await teachTimsHabit(api, timCard);
  const entryId = await timEntry(api, joyceCard.id);
  const before = await owedToTim(db);

  const listed = await api("/api/splits/usually-shared");
  const group = listed.payload.groups.find((candidate) => candidate.entries.some((entry) => entry.id === entryId));
  assert.ok(group, JSON.stringify(listed.payload.groups));
  // The usual split is Tim's habit (Tim 70%); who paid is the wallet's owner.
  assert.equal(group.ownerName, "Tim");
  assert.equal(group.basisPoints, 7000);
  assert.equal(group.payerPersonId, "person-joyce");
  assert.equal(group.payerName, "Joyce");
  assert.equal(group.payerShareBasisPoints, 3000);

  const added = await api("/api/splits/expenses/add-usual", { groups: [{ splitGroupId: GROUP, payerShareBasisPoints: group.payerShareBasisPoints, entryIds: [entryId] }] });
  assert.equal(added.status, 200, JSON.stringify(added.payload));
  const { split, shares } = await splitOf(db, entryId);
  assert.equal(split.payer_person_id, "person-joyce");
  assert.deepEqual(shares, [
    { person_id: "person-joyce", ratio_basis_points: 3000, amount_minor: 300 },
    { person_id: "person-tim", ratio_basis_points: 7000, amount_minor: 700 }
  ]);
  // Joyce paid $10.00 and Tim's share is $7.00: Tim owes her $7.00.
  assert.equal(await owedToTim(db) - before, -700);
});

test("Usually shared: a joint wallet keeps the entry's owner as payer (negative case), and its list row says Tim paid", async (t) => {
  const { db, api } = await openSeededDatabase(t, template);
  const { timCard, joint } = await wallets(db, api);
  await teachTimsHabit(api, timCard);
  const entryId = await timEntry(api, joint.id);
  const before = await owedToTim(db);

  const listed = await api("/api/splits/usually-shared");
  const group = listed.payload.groups.find((candidate) => candidate.entries.some((entry) => entry.id === entryId));
  assert.ok(group);
  assert.deepEqual([group.payerName, group.payerShareBasisPoints, group.basisPoints], ["Tim", 7000, 7000]);

  const added = await api("/api/splits/expenses/add-usual", { groups: [{ splitGroupId: GROUP, payerShareBasisPoints: group.payerShareBasisPoints, entryIds: [entryId] }] });
  assert.equal(added.status, 200, JSON.stringify(added.payload));
  const { split, shares } = await splitOf(db, entryId);
  assert.equal(split.payer_person_id, "person-tim");
  assert.deepEqual(shares.map((share) => [share.person_id, share.amount_minor]), [["person-joyce", 300], ["person-tim", 700]]);
  // Tim paid $10.00 and Joyce's share is $3.00: she owes him $3.00.
  assert.equal(await owedToTim(db) - before, 300);
});

test("Usually shared: entries with different payers are different rows, so one Add never mixes them", async (t) => {
  const { db, api } = await openSeededDatabase(t, template);
  const { timCard, joyceCard } = await wallets(db, api);
  await teachTimsHabit(api, timCard);
  const onTims = await timEntry(api, timCard.id);
  const onJoyces = await timEntry(api, joyceCard.id, { date: daysAgo(4) });
  const listed = await api("/api/splits/usually-shared");
  const groups = listed.payload.groups.filter((candidate) => candidate.shopName === SHOP);
  assert.deepEqual(groups.map((group) => [group.payerName, group.entries.map((entry) => entry.id)]).sort(), [["Joyce", [onJoyces]], ["Tim", [onTims]]].sort());
});

test("the picked rows' bar: each row follows its own wallet, mixed rows included, split rows and balances to the cent", async (t) => {
  const { db, api } = await openSeededDatabase(t, template);
  const { timCard, joyceCard, joint } = await wallets(db, api);
  const onTims = await timEntry(api, timCard.id, { description: "Bar A", amountMinor: 1000 });
  const onJoyces = await timEntry(api, joyceCard.id, { description: "Bar B", amountMinor: 1000 });
  const onJoint = await timEntry(api, joint.id, { description: "Bar C", amountMinor: 1001 });
  const before = await owedToTim(db);

  // "Half each" for every row.
  const added = await api("/api/splits/expenses/add-chosen", { splitGroupId: GROUP, payerShareBasisPoints: 5000, entryIds: [onTims, onJoyces, onJoint] });
  assert.equal(added.status, 200, JSON.stringify(added.payload));
  assert.equal(added.payload.addedCount, 3);
  assert.deepEqual(added.payload.refused, []);

  const paid = async (entryId) => (await splitOf(db, entryId)).split.payer_person_id;
  assert.deepEqual([await paid(onTims), await paid(onJoyces), await paid(onJoint)], ["person-tim", "person-joyce", "person-tim"]);
  assert.deepEqual((await splitOf(db, onJoyces)).shares.map((share) => share.amount_minor), [500, 500]);
  // Tim paid $10.00 (+5.00) and $10.01 (+5.01, Joyce's half is the even cent), Joyce paid $10.00 (-5.00).
  const joint2 = (await splitOf(db, onJoint)).shares;
  assert.equal(joint2.reduce((sum, share) => sum + share.amount_minor, 0), 1001);
  const jointJoyce = joint2.find((share) => share.person_id === "person-joyce").amount_minor;
  assert.equal(await owedToTim(db) - before, 500 - 500 + jointJoyce);
});

test("the picked rows' bar: \"the other person owes all of it\" is the payer's 0%, and it is Tim who owes when Joyce's card paid", async (t) => {
  const { db, api } = await openSeededDatabase(t, template);
  const { joyceCard } = await wallets(db, api);
  const entryId = await timEntry(api, joyceCard.id, { description: "Bar D", amountMinor: 1200 });
  const before = await owedToTim(db);
  const added = await api("/api/splits/expenses/add-chosen", { splitGroupId: null, payerShareBasisPoints: 0, entryIds: [entryId] });
  assert.equal(added.status, 200, JSON.stringify(added.payload));
  const { split, shares } = await splitOf(db, entryId);
  assert.equal(split.payer_person_id, "person-joyce");
  assert.deepEqual(shares.map((share) => [share.person_id, share.amount_minor]), [["person-joyce", 0], ["person-tim", 1200]]);
  assert.equal(await owedToTim(db) - before, -1200);
});

test("negatives: a wallet of someone outside the two is refused by name in the bar, and Undo takes every row back off", async (t) => {
  const { db, api } = await openSeededDatabase(t, template);
  const { joyceCard } = await wallets(db, api);
  const entryId = await timEntry(api, joyceCard.id, { description: "Bar E" });
  const added = await api("/api/splits/expenses/add-chosen", { splitGroupId: null, payerShareBasisPoints: 5000, entryIds: [entryId] });
  assert.equal(added.status, 200, JSON.stringify(added.payload));
  const undone = await api("/api/splits/expenses/remove-added", { splitExpenseIds: added.payload.undoSplitExpenseIds, source: "chosen" });
  assert.equal(undone.status, 200, JSON.stringify(undone.payload));
  assert.equal((await splitOf(db, entryId)).split, undefined);

  // Not on Splits twice: the second add is refused with the existing reason.
  const again = await api("/api/splits/expenses/add-chosen", { splitGroupId: null, payerShareBasisPoints: 5000, entryIds: [entryId] });
  assert.equal(again.status, 200);
  const twice = await api("/api/splits/expenses/add-chosen", { splitGroupId: null, payerShareBasisPoints: 5000, entryIds: [entryId] });
  assert.equal(twice.payload.addedCount, 0);
  assert.match(twice.payload.refused[0].reason, /already/i);
});

test("a split already saved keeps its payer when the same entry's wallet rule would now say otherwise", async (t) => {
  const { db, api } = await openSeededDatabase(t, template);
  const { joyceCard } = await wallets(db, api);
  const entryId = await timEntry(api, joyceCard.id, { description: "Old rule" });
  // An old split, saved when Tim (the entry's owner) was the payer.
  const added = await api("/api/splits/expenses/from-entry", { entryId, splitGroupId: null, splitBasisPoints: 5000, payerPersonId: "person-tim" });
  assert.equal(added.status, 200, JSON.stringify(added.payload));
  const before = await splitOf(db, entryId);
  const again = await api("/api/splits/expenses/add-chosen", { splitGroupId: null, payerShareBasisPoints: 5000, entryIds: [entryId] });
  assert.equal(again.payload.addedCount, 0);
  assert.deepEqual(await splitOf(db, entryId), before);
  assert.equal(before.split.payer_person_id, "person-tim");
});

test("all or nothing: a statement failing in the middle of a mixed-payer batch leaves the database exactly as it was", async (t) => {
  const { db, api } = await openSeededDatabase(t, template);
  const { timCard, joyceCard } = await wallets(db, api);
  const first = await timEntry(api, timCard.id, { description: "Atomic A" });
  const second = await timEntry(api, joyceCard.id, { description: "Atomic B" });
  const before = await dumpDatabase(db);
  const faulty = failingStatement(db, /INSERT INTO split_expense_shares/, { skip: 2 });
  await assert.rejects(addEntriesToSplitsRecord(faulty.db, {
    items: [
      { entryId: first, splitGroupId: null, payerShareBasisPoints: 5000 },
      { entryId: second, splitGroupId: null, payerShareBasisPoints: 5000 }
    ],
    source: "chosen"
  }));
  assert.equal(faulty.state.fired, true);
  assertSameDatabase(await dumpDatabase(db), before);
});

// ---- Ask's habitual split (hands-off safe set) -----------------------------

// Each add to splits is a split confirmation; the habit holds the payer's own
// share, and the payer is who the rule says paid.
async function teachJoycesCard(api, joyceCard) {
  for (let index = 0; index < 3; index += 1) {
    const entryId = await createEntry(api, { accountId: joyceCard.id, accountName: undefined, date: daysAgo(0), description: `Hawker Hub ${91_000_000 + index}`, categoryName: "Food & Drinks", amountMinor: 1200, ownerName: "Tim" });
    const added = await api("/api/splits/expenses/from-entry", { entryId, splitGroupId: null, splitBasisPoints: 7000 });
    assert.equal(added.status, 200, JSON.stringify(added.payload));
  }
}

test("Ask's habitual split: Tim's new entry on Joyce's card is added with Joyce as payer, the log line names her share first, and Undo takes it back", async (t) => {
  const { db, api } = await openSeededDatabase(t, template);
  const { joyceCard } = await wallets(db, api);
  await teachJoycesCard(api, joyceCard);
  // The habit is Joyce's side: she paid, her share is 30%.
  const [habit] = await rows(db, "SELECT value_json FROM ask_habits WHERE kind = 'split'");
  assert.deepEqual(JSON.parse(habit.value_json), { groupId: null, payerPersonId: "person-joyce", payerShareBasisPoints: 3000 });

  // A new hand-made entry is handled as it is created (the hands-off safe set).
  const before = await owedToTim(db);
  const entryId = await createEntry(api, { accountId: joyceCard.id, accountName: undefined, date: daysAgo(0), description: "Hawker Hub 55555555", categoryName: "Food & Drinks", amountMinor: 1000, ownerName: "Tim" });
  const done = (await api("/api/ask/done")).payload.items;
  assert.deepEqual(done.map((item) => [item.kind, item.entryId, item.summary, item.undone]), [["split", entryId, "Added to splits 30/70 with Tim", false]]);

  const { split, shares } = await splitOf(db, entryId);
  assert.equal(split.payer_person_id, "person-joyce");
  assert.deepEqual(shares.map((share) => [share.person_id, share.amount_minor]), [["person-joyce", 300], ["person-tim", 700]]);
  assert.equal(await owedToTim(db) - before, -700);

  const undone = await api("/api/ask/done/undo", { id: done[0].id });
  assert.equal(undone.status, 200, JSON.stringify(undone.payload));
  assert.equal((await splitOf(db, entryId)).split, undefined);
  assert.equal(await owedToTim(db), before);
  // An Undo is an override: nothing is applied to it again.
  const reopened = await api("/api/ask/entry-habits", { entryId });
  assert.deepEqual(reopened.payload.done, []);
  assert.equal((await splitOf(db, entryId)).split, undefined);
});

test("Ask's habitual split: a habit learned from Tim paying on his own card does not speak for a Joyce-paid entry, and a joint wallet keeps Tim", async (t) => {
  const { db, api } = await openSeededDatabase(t, template);
  const { timCard, joyceCard, joint } = await wallets(db, api);
  for (let index = 0; index < 3; index += 1) {
    const entryId = await createEntry(api, { accountId: timCard.id, accountName: undefined, date: daysAgo(0), description: `Noodle Bar ${91_000_000 + index}`, categoryName: "Food & Drinks", amountMinor: 1200, ownerName: "Tim" });
    assert.equal((await api("/api/splits/expenses/from-entry", { entryId, splitGroupId: null, splitBasisPoints: 5000 })).status, 200);
  }
  const make = (accountId) => createEntry(api, { accountId, accountName: undefined, date: daysAgo(0), description: "Noodle Bar 55555555", categoryName: "Food & Drinks", amountMinor: 1000, ownerName: "Tim" });
  // The habit is Tim paying; Joyce's card means Joyce paid, so it is silent.
  const onJoyces = await make(joyceCard.id);
  assert.equal((await splitOf(db, onJoyces)).split, undefined);
  const quiet = await api("/api/ask/entry-habits", { entryId: onJoyces });
  assert.deepEqual(quiet.payload.done, []);
  assert.equal(quiet.payload.suggestion, null);

  const onJoint = await make(joint.id);
  assert.equal((await splitOf(db, onJoint)).split.payer_person_id, "person-tim");
  assert.deepEqual((await api("/api/ask/done")).payload.items.map((item) => [item.entryId, item.summary]), [[onJoint, "Added to splits half each with Joyce"]]);
});
