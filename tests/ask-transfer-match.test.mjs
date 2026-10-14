// A transfer's other side in Ask's page (docs/flows/ask-flow.md "Transfers:
// the other side"): the change card's choices (a transfer change reply read
// back, the choice the card saves with) and the draft card's candidates (when
// to ask, what is offered and selected, the pair body after the entry is
// saved). Nothing is written until Save.
import assert from "node:assert/strict";
import test from "node:test";

import { requestTransferMatches } from "../src/client/ask-api.js";
import { chooseTransferMatch, createAskCard, setCardField, setCardVariant } from "../src/client/ask-card-model.js";
import { buildAskChips } from "../src/client/ask-chips.js";
import { NO_OTHER_SIDE, readTransferMatchResponse, resolveTransferMatch, transferLinkBody, transferMatchRequestFor } from "../src/client/ask-transfer-match.js";
import { effectiveChange, readAskTurnResponse, selectedChoiceId } from "../src/client/ask-turn-api.js";

const context = {
  today: "2026-10-12",
  viewId: "person-tim",
  people: [{ id: "person-tim", name: "Tim" }],
  accounts: [
    { id: "acct-citi", name: "Citi Rewards", currency: "SGD", isActive: true },
    { id: "acct-uob", name: "UOB One", currency: "SGD", isActive: true },
    { id: "acct-dbs", name: "DBS Joyce", currency: "SGD", isActive: true }
  ],
  categories: [{ name: "Other" }, { name: "Transfer" }]
};

function transferCard(extra = {}) {
  const card = setCardVariant(setCardField(createAskCard(context), { amountInput: "500", accountId: "acct-citi", date: "2026-10-12", ...extra }, context), "transfer", context);
  return card;
}

const candidate = (entryId, extra = {}) => ({ entryId, date: "2026-10-12", description: "FAST", accountId: "acct-uob", accountName: "UOB One", categoryName: "Other - Income", amountMinor: 50_000, ...extra });

test("a draft transfer asks the server only with an amount, a date and a wallet; any other card or state never asks", () => {
  assert.deepEqual(transferMatchRequestFor(transferCard()), { date: "2026-10-12", accountId: "acct-citi", amountMinor: 50_000, transferDirection: "out" });
  assert.equal(transferMatchRequestFor(transferCard({ amountInput: "" })), null);
  assert.equal(transferMatchRequestFor({ ...transferCard(), status: "saved" }), null);
  assert.equal(transferMatchRequestFor(setCardField(createAskCard(context), { amountInput: "5" }, context)), null);
  assert.equal(transferMatchRequestFor(null), null);
  const incoming = { ...transferCard(), fields: { ...transferCard().fields, transferDirection: "in" } };
  assert.equal(transferMatchRequestFor(incoming).transferDirection, "in");
});

test("the best match is selected; the person's choice, or 'no other side yet', replaces it; a choice that is gone falls back to the best", () => {
  const candidates = [candidate("t1"), candidate("t2", { accountId: "acct-dbs", accountName: "DBS Joyce", date: "2026-10-13" })];
  const card = transferCard();
  assert.deepEqual(resolveTransferMatch(card, candidates), { options: candidates, walletMissed: "", selectedId: "t1" });
  assert.equal(resolveTransferMatch(chooseTransferMatch(card, "t2"), candidates).selectedId, "t2");
  assert.equal(resolveTransferMatch(chooseTransferMatch(card, NO_OTHER_SIDE), candidates).selectedId, NO_OTHER_SIDE);
  assert.equal(resolveTransferMatch(chooseTransferMatch(card, "gone"), candidates).selectedId, "t1");
  assert.equal(resolveTransferMatch(card, []).selectedId, NO_OTHER_SIDE);
  assert.equal(chooseTransferMatch({ ...card, status: "saved" }, "t2").transferMatchId, "");
});

test("a named other wallet keeps only its rows; none there offers the others and names the wallet", () => {
  const candidates = [candidate("t1"), candidate("t2", { accountId: "acct-dbs", accountName: "DBS Joyce" })];
  const named = transferCard({ transferAccountId: "acct-dbs" });
  assert.deepEqual(resolveTransferMatch(named, candidates).options.map((option) => option.entryId), ["t2"]);
  const missed = resolveTransferMatch(transferCard({ transferAccountId: "acct-citi" }), candidates);
  assert.deepEqual(missed.options.map((option) => option.entryId), ["t1", "t2"]);
  assert.equal(missed.walletMissed, "Citi Rewards");
});

test("the pair body: money leaves the From side, whichever side the card posts", () => {
  assert.deepEqual(transferLinkBody(transferCard(), "new", "other"), { fromEntryId: "new", toEntryId: "other" });
  const incoming = { ...transferCard(), fields: { ...transferCard().fields, transferDirection: "in" } };
  assert.deepEqual(transferLinkBody(incoming, "new", "other"), { fromEntryId: "other", toEntryId: "new" });
});

test("the server's candidates are checked; unreadable or failed answers are no candidates", async () => {
  assert.deepEqual(readTransferMatchResponse({ ok: true, candidates: [candidate("t1"), { entryId: "bad" }, candidate("t3", { amountMinor: -5 })] }), [candidate("t1")]);
  assert.equal(readTransferMatchResponse({ ok: false }), null);
  assert.equal(readTransferMatchResponse(null), null);
  let seen = "";
  const found = await requestTransferMatches({ date: "2026-10-12", accountId: "acct-citi", amountMinor: 50_000, transferDirection: "out" }, {
    fetchImpl: async (path) => {
      seen = path;
      return new Response(JSON.stringify({ ok: true, candidates: [candidate("t1")] }));
    }
  });
  assert.equal(seen, "/api/transfers/draft-candidates?date=2026-10-12&accountId=acct-citi&amountMinor=50000&transferDirection=out");
  assert.equal(found.length, 1);
  assert.equal(await requestTransferMatches({ date: "x", accountId: "a", amountMinor: 1, transferDirection: "out" }, { fetchImpl: async () => new Response("{}", { status: 400 }) }), null);
  assert.equal(await requestTransferMatches({ date: "x", accountId: "a", amountMinor: 1, transferDirection: "out" }, { fetchImpl: async () => { throw new TypeError("offline"); } }), null);
});

test("saving a transfer card leaves the Undo chip out once it is linked to its other side", () => {
  const saved = { ...transferCard(), status: "saved", saved: { entryId: "new", splitExpenseId: null } };
  const actions = new Proxy({}, { get: (_, name) => () => name });
  const intent = { mode: "add", from: "entries" };
  const keys = (card) => buildAskChips({ intent, card, context, splitGroups: [], actions }).items.map((item) => item.key);
  assert.ok(keys(saved).includes("undo"));
  assert.ok(!keys({ ...saved, saved: { ...saved.saved, transferLinkedEntryId: "other" } }).includes("undo"));
});

// --- the change card -------------------------------------------------------------

function step(toEntryId) {
  return { path: "/api/transfers/link", body: { fromEntryId: "txn-1", toEntryId } };
}

function option(id, wallet) {
  return {
    id,
    rows: [{ field: "from", before: "", after: "Citi Rewards" }, { field: "to", before: "", after: wallet }],
    entries: [
      { entryId: "txn-1", date: "2026-10-10", description: "GRAB", amountMinor: 1_850, currency: "SGD", categoryName: "Other" },
      { entryId: id, date: "2026-10-11", description: "FAST", amountMinor: 1_850, currency: "SGD", categoryName: "Other - Income", accountName: wallet }
    ],
    count: 2,
    save: [step(id)],
    undo: null
  };
}

const NONE = {
  id: "none",
  rows: [{ field: "from", before: "", after: "Citi Rewards" }, { field: "to", before: "", after: "Not matched yet" }],
  entries: [{ entryId: "txn-1", date: "2026-10-10", description: "GRAB", amountMinor: 1_850, currency: "SGD", categoryName: "Other" }],
  count: 1,
  save: [{ path: "/api/entries/update", body: { entryId: "txn-1", entryType: "transfer" } }],
  undo: [{ path: "/api/entries/update", body: { entryId: "txn-1", entryType: "expense" } }]
};

function transferChange(overrides = {}) {
  const options = [option("t2", "UOB One"), option("t3", "DBS Joyce")];
  return {
    type: "link_transfer",
    title: "GRAB",
    rows: options[0].rows,
    entries: options[0].entries,
    count: 2,
    save: options[0].save,
    undo: null,
    month: "2026-10",
    refresh: ["entries", "month", "summary"],
    transfer: { options, none: NONE, walletMissed: "" },
    ...overrides
  };
}

test("a transfer change card is kept with its choices; the card saves the choice the person made, the best match by default", () => {
  const kept = readAskTurnResponse({ ok: true, mode: "ai", action: "link_transfer", reply: { kind: "change", change: transferChange() } });
  assert.equal(kept.reply.kind, "change");
  const { change } = kept.reply;
  assert.equal(selectedChoiceId(change), "t2");
  assert.deepEqual(effectiveChange(change).save, [step("t2")]);
  assert.equal(selectedChoiceId(change, "t3"), "t3");
  assert.deepEqual(effectiveChange(change, "t3").save, [step("t3")]);
  assert.equal(effectiveChange(change, "t3").entries[1].accountName, "DBS Joyce");
  assert.equal(selectedChoiceId(change, NO_OTHER_SIDE), "none");
  const none = effectiveChange(change, "none");
  assert.deepEqual(none.save, NONE.save);
  assert.deepEqual(none.undo, NONE.undo);
  assert.equal(none.count, 1);
  assert.equal(selectedChoiceId(change, "gone"), "t2");
  // Another change has no choices and is returned as it is.
  const plain = { ...transferChange(), transfer: null };
  assert.equal(effectiveChange(plain, "t3"), plain);
  assert.equal(selectedChoiceId(plain), "");
});

test("negative: a transfer change naming a step outside the known commands, or with nothing to save, is not shown", () => {
  const badStep = { path: "/api/entries/delete", body: { entryId: "txn-1" } };
  for (const bad of [
    transferChange({ transfer: { options: [{ ...option("t2", "UOB One"), save: [badStep] }], none: NONE, walletMissed: "" } }),
    transferChange({ transfer: { options: [option("t2", "UOB One")], none: { ...NONE, undo: [badStep] }, walletMissed: "" } }),
    transferChange({ transfer: { options: [], none: null, walletMissed: "" } }),
    transferChange({ transfer: { options: Array.from({ length: 5 }, (_, index) => option(`t${index}`, "UOB One")), none: NONE, walletMissed: "" } }),
    transferChange({ transfer: "everything" })
  ]) {
    assert.deepEqual(readAskTurnResponse({ ok: true, mode: "ai", action: "link_transfer", reply: { kind: "change", change: bad } }), { ok: false });
  }
});
