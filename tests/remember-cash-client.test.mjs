// "Remember this for cash" on the page (docs/flows/cash-entry-flow.md):
// offered only after a save whose cash wallet the person picked, only for a
// cash account of their own or a joint one, never applied by itself; once
// tapped, Ask's chip row says what it did instead. The request is the
// Payment ways command's cash-only form.
import assert from "node:assert/strict";
import test from "node:test";

import { buildAskChips } from "../src/client/ask-chips.js";
import { applyEntryDraft, createAskCard, markCardSaved, setCardField } from "../src/client/ask-card-model.js";
import { readEntryDraftResponse, rememberCashWallet } from "../src/client/ask-api.js";
import { canRememberCash } from "../src/client/cash-pad-model.js";

const context = {
  today: "2026-11-18",
  viewId: "person-tim",
  people: [{ id: "person-tim", name: "Tim" }, { id: "person-joyce", name: "Joyce" }],
  accounts: [
    { id: "acct-tim-cash", name: "Tim's purse", kind: "cash", ownerPersonId: "person-tim", currency: "SGD", isActive: true },
    { id: "acct-joyce-cash", name: "Joyce's purse", kind: "cash", ownerPersonId: "person-joyce", currency: "SGD", isActive: true },
    { id: "acct-tin", name: "Shared tin", kind: "cash", isJoint: true, currency: "SGD", isActive: true },
    { id: "acct-uob", name: "UOB One", kind: "bank", ownerPersonId: "person-tim", currency: "SGD", isActive: true }
  ],
  categories: [{ name: "Other" }, { name: "Food & Drinks" }]
};
const add = { mode: "add", from: "ask", savedEntryId: "", splitGroupId: "" };
const labels = (result) => result.items.map((item) => item.label);

// "kopi 2.40 cash" with no cash wallet, as the entry draft route answers it.
function cashDraft() {
  return readEntryDraftResponse({
    ok: true,
    draft: {
      fields: {
        date: { value: "2026-11-18", source: "default" },
        description: { value: "kopi", source: "sentence" },
        amountMinor: { value: 240, source: "sentence" },
        categoryName: { value: "Food & Drinks", source: "rule" },
        entryType: { value: "expense", source: "default" },
        ownershipType: { value: "direct", source: "default" },
        ownerName: { value: "Tim", source: "default" }
      },
      missing: ["accountId"],
      questions: [{
        field: "accountId",
        reason: "missing",
        options: context.accounts.map((account) => ({ accountId: account.id, accountName: account.name })),
        paymentWay: { kind: "cash", personId: "person-tim" }
      }],
      flags: []
    },
    ai: { requested: false, available: false }
  });
}

function savedWith(accountId) {
  const asked = applyEntryDraft(createAskCard(context), cashDraft(), context);
  assert.equal(asked.cashFor, "person-tim");
  const picked = setCardField(asked, { accountId }, context);
  return markCardSaved(picked, { entryId: "txn-1" });
}

test("which wallets may be remembered: the person's own cash account or a joint one", () => {
  assert.equal(canRememberCash(context.accounts[0], "person-tim"), true);
  assert.equal(canRememberCash(context.accounts[2], "person-tim"), true);
  assert.equal(canRememberCash(context.accounts[1], "person-tim"), false, "another person's");
  assert.equal(canRememberCash(context.accounts[3], "person-tim"), false, "a bank account picked for cash");
  assert.equal(canRememberCash({ ...context.accounts[0], isActive: false }, "person-tim"), false, "archived");
  assert.equal(canRememberCash(context.accounts[0], ""), false, "no one's cash");
  assert.equal(canRememberCash(null, "person-tim"), false);
});

test("after the save, Ask offers Remember this for cash once, before Undo; tapped, it says what it did", () => {
  let called = null;
  const actions = new Proxy({ rememberCash: (personId, account) => { called = [personId, account.id]; } }, { get: (target, name) => target[name] ?? (() => name) });
  const saved = savedWith("acct-tim-cash");
  const result = buildAskChips({ intent: add, card: saved, context, actions });
  assert.deepEqual(labels(result), ["Open this entry", "Remember this for cash", "Undo"]);
  result.items.find((item) => item.key === "remember-cash").onClick();
  assert.deepEqual(called, ["person-tim", "acct-tim-cash"]);

  const remembered = buildAskChips({ intent: add, card: { ...saved, cashRemembered: "Tim's purse" }, context, actions });
  assert.deepEqual(labels(remembered), ["Open this entry", "Undo"]);
  assert.equal(remembered.prompt, "Cash will use Tim's purse from now on. Change it in Settings, Payment ways.");
});

test("negative: no offer for a bank account picked, another person's wallet, a card not asked for cash, or before the save", () => {
  const actions = new Proxy({ rememberCash: () => {} }, { get: (target, name) => target[name] ?? (() => name) });
  for (const accountId of ["acct-uob", "acct-joyce-cash"]) {
    assert.ok(!labels(buildAskChips({ intent: add, card: savedWith(accountId), context, actions })).includes("Remember this for cash"), accountId);
  }
  // A card whose wallet was never asked for cash.
  const plain = markCardSaved(setCardField(createAskCard(context), { accountId: "acct-tim-cash", description: "kopi", amountMinor: 240 }, context), { entryId: "txn-2" });
  assert.ok(!labels(buildAskChips({ intent: add, card: plain, context, actions })).includes("Remember this for cash"));
  // Still a draft: the question is asked, nothing is offered yet.
  const draft = applyEntryDraft(createAskCard(context), cashDraft(), context);
  assert.ok(!labels(buildAskChips({ intent: add, card: draft, context, actions })).includes("Remember this for cash"));
});

test("the request is the Payment ways command's cash-only form; a refusal is { ok: false }", async () => {
  const sent = [];
  const fetchImpl = async (path, init) => {
    sent.push([path, JSON.parse(init.body)]);
    return new Response(JSON.stringify({ ok: true, updated: true }), { status: 200 });
  };
  assert.equal((await rememberCashWallet({ personId: "person-tim", cashAccountId: "acct-tim-cash" }, { fetchImpl })).ok, true);
  assert.deepEqual(sent, [["/api/settings/payment-ways/save", { personId: "person-tim", cashAccountId: "acct-tim-cash", only: "cash" }]]);
  const refused = await rememberCashWallet({ personId: "person-tim", cashAccountId: "acct-joyce-cash" }, {
    fetchImpl: async () => new Response(JSON.stringify({ ok: false, error: "Choose a cash wallet of your own or a joint one." }), { status: 400 })
  });
  assert.deepEqual(refused, { ok: false, error: "Choose a cash wallet of your own or a joint one." });
});
