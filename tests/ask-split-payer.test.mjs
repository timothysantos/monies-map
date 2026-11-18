// Who paid an entry put on Splits (Ask audit B28; DOMAIN.md "Split Payer";
// src/domain/split-payer.ts): a wallet that belongs to one person means that
// person paid; a joint wallet keeps the entry's owner. Through the real
// Worker on a local D1 seeded with the demo household (Tim and Joyce): the
// Ask card says what it assumed with one chip to switch, Save goes through
// the existing Add to Splits command, and the split rows and balances are
// pinned to the cent. Entries' own Add to splits follows the same rule. A
// split already saved keeps its payer.
import assert from "node:assert/strict";
import test from "node:test";

import worker from "../src/index.ts";
import { splitPayerForEntry } from "../src/domain/split-payer.ts";
import { todayInAppTimeZone } from "../src/lib/app-calendar.ts";
import { loadSummarySplitBalances } from "../src/domain/pages/summary-split-balances.ts";
import { createSeededTemplate, openSeededDatabase, rows } from "./support/d1-workspace.mjs";

let template;
test.before(async () => {
  template = await createSeededTemplate();
});
test.after(async () => {
  await template?.dispose();
});

const TODAY = todayInAppTimeZone();
const THIS_MONTH = TODAY.slice(0, 7);

function stubAi(reply) {
  return { async run() { return { choices: [{ message: { role: "assistant", content: JSON.stringify(reply) } }] }; } };
}

async function turn(db, body, { ai = null } = {}) {
  const env = { DB: db, ...template.config.vars, ...(ai ? { AI: ai, AI_ASSIST_ENABLED: "true" } : {}) };
  const response = await worker.fetch(new Request("http://127.0.0.1/api/ask/turn", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ viewId: "person-tim", scope: "direct_plus_shared", month: THIS_MONTH, page: "ask", history: [], ...body })
  }), env);
  assert.equal(response.status, 200);
  return response.json();
}

// Tim's own card, and a joint wallet, from the seeded household.
async function wallets(db, api) {
  const accounts = await rows(db, "SELECT id, account_name, owner_person_id, is_joint, is_active FROM accounts WHERE is_active = 1 ORDER BY account_name");
  const timCard = accounts.find((account) => account.owner_person_id === "person-tim" && !account.is_joint);
  let joint = accounts.find((account) => account.is_joint);
  if (!joint) {
    const created = await api("/api/accounts/create", { name: "Joint Everyday", institution: "DBS", kind: "bank", currency: "SGD", openingBalanceMinor: 0, ownerPersonId: "", isJoint: true });
    joint = { id: created.payload.accountId, account_name: "Joint Everyday" };
  }
  assert.ok(timCard && joint);
  return { timCard, joint };
}

async function joyceEntry(api, accountId, description = "DINNER AT JUMBO") {
  const created = await api("/api/entries/create", { date: TODAY, description, accountId, categoryName: "Food & Drinks", amountMinor: 700, entryType: "expense", ownershipType: "direct", ownerName: "Joyce" });
  assert.equal(created.status, 200, JSON.stringify(created.payload));
  return created.payload.entryId;
}

const addToSplits = (shares, payer = null) => ({ action: "add_entry_to_splits", split: { payer, group: null, shares } });

async function owedToTim(db) {
  const lines = await loadSummarySplitBalances(db, "person-tim", {});
  return lines.find((line) => line.id === "split-group-none")?.balanceMinor ?? 0;
}

test("the rule: a one-person wallet is who paid; a joint or ownerless wallet keeps the entry's owner", () => {
  assert.deepEqual(splitPayerForEntry({ entryOwnerPersonId: "joyce", walletOwnerPersonId: "tim", walletIsJoint: false }), { payerPersonId: "tim", fromWallet: true });
  assert.deepEqual(splitPayerForEntry({ entryOwnerPersonId: "tim", walletOwnerPersonId: "tim", walletIsJoint: false }), { payerPersonId: "tim", fromWallet: false });
  assert.deepEqual(splitPayerForEntry({ entryOwnerPersonId: "joyce", walletOwnerPersonId: "tim", walletIsJoint: true }), { payerPersonId: "joyce", fromWallet: false });
  assert.deepEqual(splitPayerForEntry({ entryOwnerPersonId: "joyce", walletOwnerPersonId: null, walletIsJoint: false }), { payerPersonId: "joyce", fromWallet: false });
  assert.deepEqual(splitPayerForEntry({ entryOwnerPersonId: null, walletOwnerPersonId: "tim", walletIsJoint: false }), { payerPersonId: "tim", fromWallet: false });
});

test("B28: Joyce's entry on Tim's card: the card says Tim paid from his wallet, with one chip for Joyce; Save writes Tim as payer to the cent", async (t) => {
  const { db, api } = await openSeededDatabase(t, template);
  const { timCard } = await wallets(db, api);
  const entryId = await joyceEntry(api, timCard.id);
  const before = await owedToTim(db);

  const payload = await turn(db, { text: "add to splits, joyce pays 3", focus: { kind: "saved_entry", entryId } }, { ai: stubAi(addToSplits([{ person: "Joyce", value: "3" }])) });

  assert.equal(payload.reply.kind, "split_proposal", JSON.stringify(payload.reply));
  const { proposal } = payload.reply;
  assert.equal(proposal.payerName, "Tim");
  assert.equal(proposal.payerPersonId, "person-tim");
  assert.deepEqual(proposal.shares, [{ personName: "Tim", basisPoints: 5714, amountMinor: 400 }, { personName: "Joyce", basisPoints: 4286, amountMinor: 300 }]);
  assert.deepEqual(payload.reply.assumptions, [{
    text: `It was paid from ${timCard.account_name}, which is Tim's, so Splits shows Tim as the one who paid. Add it that way?`,
    chips: ["Add to Splits, Joyce paid"]
  }]);

  // Save: the existing command, with the payer the card showed.
  const saved = await api("/api/splits/expenses/from-entry", { entryId, splitGroupId: null, splitBasisPoints: proposal.splitBasisPoints, splitAmountMinor: proposal.splitAmountMinor, payerPersonId: proposal.payerPersonId });
  assert.equal(saved.status, 200, JSON.stringify(saved.payload));
  assert.deepEqual(await rows(db, "SELECT payer_person_id, total_amount_minor FROM split_expenses WHERE id = ?", saved.payload.splitExpenseId), [{ payer_person_id: "person-tim", total_amount_minor: 700 }]);
  assert.deepEqual(await rows(db, "SELECT person_id, amount_minor FROM split_expense_shares WHERE split_expense_id = ? ORDER BY person_id", saved.payload.splitExpenseId), [
    { person_id: "person-joyce", amount_minor: 300 },
    { person_id: "person-tim", amount_minor: 400 }
  ]);
  // Joyce owes Tim $3.00 more.
  assert.equal(await owedToTim(db) - before, 300);
});

test("B28: the chip \"Add to Splits, Joyce paid\" makes Joyce the payer, with AI and with the rules", async (t) => {
  const { db, api } = await openSeededDatabase(t, template);
  const { timCard } = await wallets(db, api);
  const entryId = await joyceEntry(api, timCard.id);
  const before = await owedToTim(db);

  const withAi = await turn(db, { text: "Add to Splits, Joyce paid", focus: { kind: "saved_entry", entryId } }, { ai: stubAi(addToSplits([], "Joyce")) });
  assert.equal(withAi.reply.proposal.payerName, "Joyce");
  assert.equal(withAi.reply.proposal.payerPersonId, "person-joyce");
  assert.ok(!(withAi.reply.assumptions ?? []).some((line) => /paid from/.test(line.text)));

  const rules = await turn(db, { text: "Add to Splits, Joyce paid", focus: { kind: "saved_entry", entryId } });
  assert.equal(rules.mode, "rules");
  assert.equal(rules.reply.kind, "split_proposal");
  assert.equal(rules.reply.proposal.payerPersonId, "person-joyce");

  const saved = await api("/api/splits/expenses/from-entry", { entryId, splitGroupId: null, splitBasisPoints: rules.reply.proposal.splitBasisPoints, payerPersonId: rules.reply.proposal.payerPersonId });
  assert.equal(saved.status, 200, JSON.stringify(saved.payload));
  assert.deepEqual(await rows(db, "SELECT payer_person_id FROM split_expenses WHERE id = ?", saved.payload.splitExpenseId), [{ payer_person_id: "person-joyce" }]);
  // Joyce paid $7.00, half each: Tim owes her $3.50.
  assert.equal(await owedToTim(db) - before, -350);
});

test("B28: a joint wallet keeps the entry's owner and says nothing; Entries' Add to splits follows the wallet rule too", async (t) => {
  const { db, api } = await openSeededDatabase(t, template);
  const { timCard, joint } = await wallets(db, api);
  const jointEntry = await joyceEntry(api, joint.id, "GROCER JOINT");
  const payload = await turn(db, { text: "add to splits", focus: { kind: "saved_entry", entryId: jointEntry } }, { ai: stubAi(addToSplits([])) });
  assert.equal(payload.reply.proposal.payerName, "Joyce");
  assert.ok(!(payload.reply.assumptions ?? []).some((line) => /paid from/.test(line.text)));

  // Entries' Add to splits sends no payer: the server's rule decides.
  const onTimsCard = await joyceEntry(api, timCard.id, "TAXI ON TIMS CARD");
  const added = await api("/api/splits/expenses/from-entry", { entryId: onTimsCard, splitGroupId: null, splitBasisPoints: 5000 });
  assert.equal(added.status, 200, JSON.stringify(added.payload));
  assert.deepEqual(await rows(db, "SELECT payer_person_id FROM split_expenses WHERE id = ?", added.payload.splitExpenseId), [{ payer_person_id: "person-tim" }]);
  const jointAdded = await api("/api/splits/expenses/from-entry", { entryId: jointEntry, splitGroupId: null, splitBasisPoints: 5000 });
  assert.deepEqual(await rows(db, "SELECT payer_person_id FROM split_expenses WHERE id = ?", jointAdded.payload.splitExpenseId), [{ payer_person_id: "person-joyce" }]);
});

test("B28 negatives: a payer outside the two is refused and writes nothing; a split already saved keeps its payer", async (t) => {
  const { db, api } = await openSeededDatabase(t, template);
  const { timCard } = await wallets(db, api);
  const before = await rows(db, "SELECT id, payer_person_id FROM split_expenses ORDER BY id");
  const entryId = await joyceEntry(api, timCard.id);
  const refused = await api("/api/splits/expenses/from-entry", { entryId, splitGroupId: null, splitBasisPoints: 5000, payerPersonId: "person-nobody" });
  assert.equal(refused.status, 400);
  assert.equal((await rows(db, "SELECT COUNT(*) AS count FROM split_expenses WHERE linked_transaction_id = ?", entryId))[0].count, 0);
  // Every split saved before keeps the payer it had.
  assert.deepEqual(await rows(db, "SELECT id, payer_person_id FROM split_expenses WHERE id IN (" + (before.map(() => "?").join(", ") || "''") + ") ORDER BY id", ...before.map((row) => row.id)), before);
  // A payer the household does not have, named on the card, is asked back.
  const unknown = await turn(db, { text: "add to splits, bob paid", focus: { kind: "saved_entry", entryId } }, { ai: stubAi(addToSplits([], "Bob")) });
  assert.equal(unknown.reply.kind, "clarify");
});
