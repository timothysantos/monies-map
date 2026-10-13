// The Ask page's side of a turn (src/client/ask-turn-api.js): the recent
// conversation and the focus it sends, and the reply it keeps. An
// unreadable reply, a failed request or a timeout is { ok: false }, so the
// page reads the message with its rules.
import assert from "node:assert/strict";
import test from "node:test";

import { ASK_CHANGE_PATHS, buildTurnFocus, buildTurnHistory, linkTurnMatch, readAskTurnResponse, requestAskTurn, runChangeSteps, saveSplitProposal } from "../src/client/ask-turn-api.js";
import { ASK_CHANGE_PATHS as SERVER_CHANGE_PATHS } from "../src/domain/ask-turn-actions.ts";

function change(overrides = {}) {
  return {
    type: "recategorise_bulk",
    title: "grab",
    rows: [{ field: "category", before: "Food & Drinks", after: "Transport" }],
    entries: [{ entryId: "txn-1", date: "2026-09-10", description: "GRAB RIDE", amountMinor: 1_200, currency: "SGD", categoryName: "Food & Drinks" }],
    count: 12,
    confirmCount: 12,
    save: [{ path: "/api/entries/update-category", body: { changes: [{ entryId: "txn-1", fromCategoryName: "Food & Drinks", categoryName: "Transport" }] } }],
    undo: [{ path: "/api/entries/update-category", body: { changes: [{ entryId: "txn-1", fromCategoryName: "Transport", categoryName: "Food & Drinks" }], confirmedCount: 12 } }],
    rule: { pattern: "GRAB", categoryId: "cat-transport", categoryName: "Transport" },
    month: "2026-09",
    refresh: ["entries", "month", "summary"],
    ...overrides
  };
}

function recordingFetch(responses = []) {
  const calls = [];
  const fetchImpl = async (path, init) => {
    calls.push({ path, body: JSON.parse(init.body) });
    const next = responses.shift() ?? { ok: true };
    return new Response(JSON.stringify(next), { status: next.ok === false ? 400 : 200 });
  };
  return { calls, fetchImpl };
}

test("Phase 2: a change card is kept only when every step posts to a known command; the page and server lists agree", () => {
  assert.deepEqual([...ASK_CHANGE_PATHS], [...SERVER_CHANGE_PATHS]);
  const kept = readAskTurnResponse({ ok: true, mode: "ai", action: "recategorise", reply: { kind: "change", change: change() } });
  assert.equal(kept.reply.kind, "change");
  assert.equal(kept.reply.change.confirmCount, 12);
  for (const bad of [
    change({ save: [{ path: "/api/entries/delete", body: { entryId: "txn-1" } }] }),
    change({ undo: [{ path: "/api/imports/rollback", body: {} }] }),
    change({ save: [] }),
    change({ type: "delete_everything" })
  ]) {
    assert.deepEqual(readAskTurnResponse({ ok: true, mode: "ai", action: "recategorise", reply: { kind: "change", change: bad } }), { ok: false });
  }
  const matches = readAskTurnResponse({ ok: true, mode: "ai", action: "review_matches", reply: { kind: "matches", month: "2026-09", matches: [{ id: "m1", kind: "expense", splitRecordId: "split-1", transactionId: "txn-9", amountMinor: -8_000, splitAmountMinor: 8_000 }] } });
  assert.equal(matches.reply.kind, "matches");
  const blocked = readAskTurnResponse({ ok: true, mode: "ai", action: "cannot_help", reply: { kind: "open_page", page: "entries", params: {}, why: "Ask doesn't delete entries." } });
  assert.equal(blocked.reply.why, "Ask doesn't delete entries.");
});

test("Phase 2: Save posts each step; the confirmed count is added only from the person's tap; Undo takes what the save created", async () => {
  const { calls, fetchImpl } = recordingFetch();
  const unconfirmed = await runChangeSteps(change().save, { fetchImpl });
  assert.equal(unconfirmed.ok, true);
  assert.equal(calls[0].body.confirmedCount, undefined);
  await runChangeSteps(change().save, { confirmedCount: 12, fetchImpl });
  assert.equal(calls[1].body.confirmedCount, 12);

  const simplify = recordingFetch([{ ok: true, checkpointId: "split-checkpoint-1", amountMinor: 6_000 }, { ok: true }]);
  const saved = await runChangeSteps([{ path: "/api/splits/checkpoints/create", body: { viewerPersonId: "person-tim", date: "2026-10-13", currency: "SGD" } }], { fetchImpl: simplify.fetchImpl });
  await runChangeSteps([{ path: "/api/splits/checkpoints/reopen", body: {}, fromResult: { key: "checkpointId", as: "checkpointId" } }], { result: saved.result, fetchImpl: simplify.fetchImpl });
  assert.deepEqual(simplify.calls[1], { path: "/api/splits/checkpoints/reopen", body: { checkpointId: "split-checkpoint-1" } });

  const refused = recordingFetch([{ ok: false, error: "Some of these entries were changed meanwhile." }]);
  assert.deepEqual(await runChangeSteps(change().save, { fetchImpl: refused.fetchImpl }), { ok: false, error: "Some of these entries were changed meanwhile.", result: null });
  const unknown = recordingFetch();
  assert.equal((await runChangeSteps([{ path: "/api/entries/delete", body: {} }], { fetchImpl: unknown.fetchImpl })).ok, false);
  assert.equal(unknown.calls.length, 0, "a step to an unknown command is never posted");

  const match = recordingFetch();
  await linkTurnMatch({ kind: "settlement", splitRecordId: "settle-1", transactionId: "txn-2" }, { fetchImpl: match.fetchImpl });
  assert.deepEqual(match.calls, [{ path: "/api/splits/matches/link-settlement", body: { settlementId: "settle-1", transactionId: "txn-2" } }]);
});

test("Phase 2: right after an Entries answer the focus is that list (what it searched), never its rows", () => {
  assert.deepEqual(buildTurnFocus({ list: { month: "2026-09", search: "grab", categories: ["Taxi"], wallets: ["acct-1"] }, card: { status: "saved", saved: { entryId: "txn-1" } } }), {
    kind: "entry_list", list: { month: "2026-09", search: "grab", categories: ["Taxi"] }
  });
  assert.equal(buildTurnHistory([{ kind: "change-draft", change: { type: "recategorise_bulk", title: "grab" }, status: "saved" }])[0].text, "Drafted a change (recategorise bulk) to grab (saved).");
});

test("the history is the person's messages and a short line for each thing Ask showed, newest eight", () => {
  const thread = [
    { kind: "status", text: "Reading your message…" },
    { kind: "me", text: "Add to splits" },
    { kind: "photo", url: "blob:1" },
    { kind: "split-proposal", proposal: { description: "Starbucks" }, status: "draft" },
    { kind: "note", text: "Saved from Apple Pay." },
    { kind: "money-answer", answer: { title: "Where September went" } },
    { kind: "me", text: "an insight question with $12", hiddenText: "an insight question" }
  ];
  assert.deepEqual(buildTurnHistory(thread), [
    { role: "user", text: "Add to splits" },
    { role: "app", text: "Drafted adding Starbucks to Splits." },
    { role: "app", text: "Saved from Apple Pay." },
    { role: "app", text: "Answered: Where September went" },
    { role: "user", text: "an insight question" }
  ]);
  const long = Array.from({ length: 12 }, (_, index) => ({ kind: "me", text: `m${index}` }));
  assert.deepEqual(buildTurnHistory(long).map((line) => line.text), ["m4", "m5", "m6", "m7", "m8", "m9", "m10", "m11"]);
});

test("the focus is the saved entry, else the card being filled, else the split group", () => {
  assert.deepEqual(buildTurnFocus({ card: { status: "saved", saved: { entryId: "txn-1" } } }), { kind: "saved_entry", entryId: "txn-1" });
  const draft = {
    status: "draft",
    variant: "expense",
    fields: { description: "Lunch", date: "2026-10-13", accountId: "acct-uob", categoryName: "Food & Drinks", ownerName: "Tim", amountMinor: 1_250 },
    share: { on: true, splitGroupId: "" }
  };
  assert.deepEqual(buildTurnFocus({ card: draft, intent: { splitGroupId: "split-group-home" } }), {
    kind: "draft",
    draft: { variant: "expense", description: "Lunch", date: "2026-10-13", accountId: "acct-uob", categoryName: "Food & Drinks", ownerName: "Tim", amountMinor: 1_250, shareOn: true, splitGroupId: "split-group-home" }
  });
  assert.deepEqual(buildTurnFocus({ card: null, intent: { splitGroupId: "split-group-home" } }), { kind: "split_group", groupId: "split-group-home" });
  assert.equal(buildTurnFocus({}), null);
});

test("a reply is kept only in a shape the page can show", () => {
  assert.deepEqual(readAskTurnResponse({ ok: true, mode: "rules", reason: "AI assistance is turned off." }), { ok: true, mode: "rules", reason: "AI assistance is turned off." });
  const proposal = {
    entryId: "txn-1", description: "Starbucks", date: "2026-10-12", amountMinor: 4_250, currency: "SGD", payerName: "Tim", groupId: null, groupName: "", splitBasisPoints: 0,
    shares: [{ personName: "Tim", basisPoints: 0, amountMinor: 0 }, { personName: "Joyce", basisPoints: 10_000, amountMinor: 4_250 }]
  };
  assert.deepEqual(readAskTurnResponse({ ok: true, mode: "ai", action: "add_entry_to_splits", reply: { kind: "split_proposal", proposal } }), { ok: true, mode: "ai", action: "add_entry_to_splits", reply: { kind: "split_proposal", proposal } });
  assert.deepEqual(readAskTurnResponse({ ok: true, mode: "ai", reply: { kind: "clarify", question: "Who paid?", options: ["Tim", "Joyce", 3, "", "a", "b"] } }).reply, { kind: "clarify", question: "Who paid?", options: ["Tim", "Joyce", "a", "b"] });
  assert.deepEqual(readAskTurnResponse({ ok: true, mode: "ai", reply: { kind: "draft_patch", patch: { amountMinor: 1_500, variant: "loan", splitBasisPoints: 12_000, ownerName: "Shared" }, share: null } }).reply, { kind: "draft_patch", patch: { amountMinor: 1_500, ownerName: "Shared" }, share: null });
  // Negative: unknown kinds, broken proposals, a page that is not one, a failed body.
  for (const body of [
    null,
    { ok: false },
    { ok: true, mode: "ai", reply: { kind: "delete_entry" } },
    { ok: true, mode: "ai", reply: { kind: "split_proposal", proposal: { ...proposal, shares: [proposal.shares[0]] } } },
    { ok: true, mode: "ai", reply: { kind: "split_proposal", proposal: { ...proposal, amountMinor: -1 } } },
    { ok: true, mode: "ai", reply: { kind: "open_page", page: "admin", params: {} } },
    { ok: true, mode: "ai", reply: { kind: "settlement_draft", settlement: { fromPersonName: "Joyce", toPersonName: "Tim", amountMinor: 0, date: "2026-10-13" } } }
  ]) {
    assert.deepEqual(readAskTurnResponse(body), { ok: false }, JSON.stringify(body));
  }
});

test("a failed or refused request is { ok: false }; the body sent is what the route reads", async () => {
  let sent = null;
  const ok = await requestAskTurn({ text: "hi" }, { fetchImpl: async (url, init) => { sent = { url, body: JSON.parse(init.body) }; return new Response(JSON.stringify({ ok: true, mode: "rules", reason: "off" })); } });
  assert.deepEqual(sent, { url: "/api/ask/turn", body: { text: "hi" } });
  assert.equal(ok.mode, "rules");
  assert.deepEqual(await requestAskTurn({ text: "hi" }, { fetchImpl: async () => new Response("{}", { status: 500 }) }), { ok: false });
  assert.deepEqual(await requestAskTurn({ text: "hi" }, { fetchImpl: async () => { throw new TypeError("offline"); } }), { ok: false });
});

test("Add to Splits posts the existing command with the proposal's share", async () => {
  let sent = null;
  const result = await saveSplitProposal({ entryId: "txn-1", groupId: null, splitBasisPoints: 0 }, {
    fetchImpl: async (url, init) => { sent = { url, body: JSON.parse(init.body) }; return new Response(JSON.stringify({ splitExpenseId: "split-1" })); }
  });
  assert.deepEqual(sent, { url: "/api/splits/expenses/from-entry", body: { entryId: "txn-1", splitGroupId: null, splitBasisPoints: 0 } });
  assert.deepEqual(result, { ok: true, splitExpenseId: "split-1" });
  const refused = await saveSplitProposal({ entryId: "txn-1", splitBasisPoints: 0 }, { fetchImpl: async () => new Response(JSON.stringify({ ok: false, error: "This entry is already linked to a split expense." }), { status: 400 }) });
  assert.deepEqual(refused, { ok: false, error: "This entry is already linked to a split expense." });
});
