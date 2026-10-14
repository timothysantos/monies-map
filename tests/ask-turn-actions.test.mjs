// Ask's Phase 2 actions (src/domain/ask-turn-actions.ts): each change the
// model asks for is checked against the household's data and becomes a
// change card naming exactly what changes, the existing command it saves
// through and its Undo; anything that does not check out is asked back or
// explained, never saved. Pure: the rows a change needs are given here as
// the route would load them.
import assert from "node:assert/strict";
import test from "node:test";

import { parseAskTurnAction, validateAskTurnAction } from "../src/domain/ask-turn.ts";
import {
  ASK_CHANGE_PATHS,
  buildBulkRecategorise,
  buildGroupMove,
  buildGroupSettle,
  buildMatches,
  buildMonthNote,
  buildPlanLink,
  buildSimplify,
  buildTransferLink
} from "../src/domain/ask-turn-actions.ts";

const TODAY = "2026-10-13";

function account(id, name, ownerPersonId, extra = {}) {
  return { id, institutionId: "inst", name, institution: "Bank", kind: "credit_card", ownerLabel: ownerPersonId === "person-tim" ? "Tim" : "Joyce", ownerPersonId, currency: "SGD", isJoint: false, isActive: true, ...extra };
}

const CATEGORY_NAMES = ["Food & Drinks", "Groceries", "Transport", "Taxi", "Other", "Other - Income", "Transfer"];

function makeContext(overrides = {}) {
  const people = [{ id: "person-tim", name: "Tim" }, { id: "person-joyce", name: "Joyce" }];
  return {
    today: TODAY,
    month: "2026-10",
    viewId: "person-tim",
    scope: "direct_plus_shared",
    page: "ask",
    people,
    entry: {
      today: TODAY,
      accounts: [
        account("acct-citi", "Citi Rewards", "person-tim"),
        account("acct-uob", "UOB One", "person-tim", { kind: "bank" }),
        account("acct-dbs-joyce", "DBS Joyce", "person-joyce", { kind: "bank" }),
        account("acct-cash-tim", "Tim cash", "person-tim", { kind: "cash" })
      ],
      people,
      categoryNames: CATEGORY_NAMES,
      categoryMatchRules: [],
      defaultAccountPriorityIds: ["acct-citi"],
      paymentWays: [
        { personId: "person-tim", bankTransferAccountId: "acct-uob", cashAccountId: "acct-cash-tim" },
        { personId: "person-joyce", bankTransferAccountId: "acct-dbs-joyce", cashAccountId: "" }
      ],
      viewerName: "Tim"
    },
    groups: [{ id: "split-group-bali", name: "Bali trip", currency: "IDR" }, { id: "split-group-home", name: "Home", currency: "SGD" }],
    planLines: ["Groceries", "Netflix"],
    categories: CATEGORY_NAMES.map((name) => ({ id: `cat-${name.toLowerCase().replace(/[^a-z]+/g, "-")}`, name, colorHex: "#8B897A", isSystem: ["Other", "Other - Income", "Transfer"].includes(name) })),
    focus: null,
    history: [],
    text: "",
    ...overrides
  };
}

const ENTRY = {
  entryId: "txn-1",
  description: "GRAB RIDE 123",
  categoryName: "Food & Drinks",
  date: "2026-10-10",
  entryType: "expense",
  accountId: "acct-citi",
  accountName: "Citi Rewards",
  currency: "SGD",
  amountMinor: 1_850,
  payerPersonId: "person-tim",
  linkedToSplits: false,
  ownerName: "Tim",
  note: "",
  postDate: null,
  transferDirection: null,
  linkedToTransfer: false,
  lockedMonth: null
};

function saved(entry = {}) {
  return { kind: "saved_entry", entry: { ...ENTRY, ...entry } };
}

function act(action, fields = {}) {
  const parsed = parseAskTurnAction({ action, ...fields });
  assert.ok(parsed, `${action} parses`);
  return parsed;
}

function turn(action, fields, overrides) {
  return validateAskTurnAction(act(action, fields), makeContext(overrides));
}

function assertSavesThroughKnownCommands(change) {
  for (const step of [...change.save, ...(change.undo ?? [])]) {
    assert.ok(ASK_CHANGE_PATHS.includes(step.path), step.path);
  }
}

// --- edit_saved_entry -------------------------------------------------------

test("edit_saved_entry: the saved entry's amount, wallet and note change; Save and Undo are the entry update with every other fact kept", () => {
  const reply = turn("edit_saved_entry", { entry: { amount: "18", wallet: "UOB One", note: "with Joyce" } }, { focus: saved(), text: "it was $18 on UOB One, note with Joyce" });
  assert.equal(reply.kind, "change");
  const { change } = reply;
  assert.equal(change.type, "edit_entry");
  assert.deepEqual(change.rows, [
    { field: "amount", before: "", after: "", beforeMinor: 1_850, afterMinor: 1_800, currency: "SGD" },
    { field: "wallet", before: "Citi Rewards", after: "UOB One" },
    { field: "note", before: "", after: "with Joyce" }
  ]);
  assert.deepEqual(change.save, [{
    path: "/api/entries/update",
    body: { entryId: "txn-1", date: "2026-10-10", postDate: null, description: "GRAB RIDE 123", accountId: "acct-uob", categoryName: "Food & Drinks", amountMinor: 1_800, entryType: "expense", ownershipType: "direct", ownerName: "Tim", note: "with Joyce" }
  }]);
  assert.deepEqual(change.undo, [{
    path: "/api/entries/update",
    body: { entryId: "txn-1", date: "2026-10-10", postDate: null, description: "GRAB RIDE 123", accountId: "acct-citi", categoryName: "Food & Drinks", amountMinor: 1_850, entryType: "expense", ownershipType: "direct", ownerName: "Tim", note: "" }
  }]);
  assert.equal(change.month, "2026-10");
  assertSavesThroughKnownCommands(change);
});

test("negative: a statement-certified entry keeps its bank facts and says why; its category, owner and note still change", () => {
  const locked = saved({ lockedMonth: "2026-09" });
  assert.deepEqual(turn("edit_saved_entry", { entry: { amount: "18" } }, { focus: locked, text: "make it 18" }), {
    kind: "note",
    text: "The bank's September 2026 statement confirms this entry's amount, date, description and wallet, so they stay as the bank has them. You can still change its category, owner or note."
  });
  assert.equal(turn("edit_saved_entry", { entry: { date: "2026-10-09" } }, { focus: locked, text: "it was on the 9th" }).kind, "note");
  assert.equal(turn("edit_saved_entry", { entry: { wallet: "UOB One" } }, { focus: locked, text: "on UOB One" }).kind, "note");
  const category = turn("edit_saved_entry", { entry: { category: "Taxi", owner: "Joyce" } }, { focus: locked, text: "taxi, Joyce's" });
  assert.equal(category.kind, "change");
  assert.deepEqual(category.change.rows.map((row) => row.field), ["category", "owner"]);
});

test("negative: no entry in focus, an amount the person never wrote, a stranger, or nothing to change is never a change", () => {
  assert.deepEqual(turn("edit_saved_entry", { entry: { amount: "18" } }, { text: "make it 18" }), { kind: "note", text: "Which entry should change? Open it from Entries, then ask again." });
  // A figure the person never wrote is replaced by the one amount they did write ...
  const replaced = turn("edit_saved_entry", { entry: { amount: "99" } }, { focus: saved(), text: "make it 18" });
  assert.equal(replaced.kind, "change");
  assert.equal(replaced.change.rows[0].afterMinor, 1_800);
  // ... and with none or two to choose from it is asked.
  assert.equal(turn("edit_saved_entry", { entry: { amount: "99" } }, { focus: saved(), text: "make it bigger" }).kind, "clarify");
  assert.equal(turn("edit_saved_entry", { entry: { amount: "99" } }, { focus: saved(), text: "make it 18 or 20" }).kind, "clarify");
  assert.equal(turn("edit_saved_entry", { entry: { owner: "Serene" } }, { focus: saved(), text: "Serene's" }).kind, "clarify");
  assert.equal(turn("edit_saved_entry", { entry: { note: "call the bank at 2am" } }, { focus: saved(), text: "add a note" }).kind, "clarify");
  assert.equal(turn("edit_saved_entry", { entry: { category: "Food & Drinks" } }, { focus: saved(), text: "food" }).kind, "clarify");
});

// --- recategorise -----------------------------------------------------------

test("recategorise one: the entry in focus moves category through the category command; Undo moves it back", () => {
  const reply = turn("recategorise", { recategorise: { category: "Taxi" } }, { focus: saved(), text: "make it taxi" });
  assert.equal(reply.change.type, "recategorise");
  assert.deepEqual(reply.change.save, [{ path: "/api/entries/update-category", body: { changes: [{ entryId: "txn-1", fromCategoryName: "Food & Drinks", categoryName: "Taxi" }] } }]);
  assert.deepEqual(reply.change.undo, [{ path: "/api/entries/update-category", body: { changes: [{ entryId: "txn-1", fromCategoryName: "Taxi", categoryName: "Food & Drinks" }] } }]);
  assert.equal(turn("recategorise", { recategorise: { category: "Food & Drinks" } }, { focus: saved(), text: "food" }).kind, "note");
  assert.equal(turn("recategorise", { recategorise: { category: "Taxi" } }, { focus: saved({ entryType: "transfer" }), text: "taxi" }).kind, "note");
  assert.equal(turn("recategorise", { recategorise: { category: "Transfer" } }, { focus: saved(), text: "transfer" }).request.type, "link_transfer");
  assert.equal(turn("recategorise", { recategorise: { category: "Pets" } }, { focus: saved(), text: "pets" }).kind, "clarify");
});

test("recategorise many: the words the person wrote go to the route, which reads the entries again; made-up words are asked back", () => {
  assert.deepEqual(turn("recategorise", { recategorise: { category: "Transport", words: "grab", month: null } }, { text: "make all Grab rides Transport" }), {
    kind: "resolve",
    request: { type: "recategorise_bulk", words: "grab", categoryName: "Transport", fromCategoryName: null, month: null }
  });
  assert.equal(turn("recategorise", { recategorise: { category: "Transport", words: "gojek" } }, { text: "make all Grab rides Transport" }).kind, "clarify");
  // The list Ask showed last supplies the words.
  assert.deepEqual(turn("recategorise", { recategorise: { category: "Transport" } }, { focus: { kind: "entry_list", list: { month: "2026-09", search: "grab", categories: [] } }, text: "make these Transport" }).request, {
    type: "recategorise_bulk", words: "grab", categoryName: "Transport", fromCategoryName: null, month: "2026-09"
  });
});

function candidate(id, extra = {}) {
  return { entryId: id, date: "2026-09-10", description: "GRAB RIDE", originalDescription: null, amountMinor: 1_200, currency: "SGD", categoryName: "Food & Drinks", entryType: "expense", ...extra };
}

test("bulk preview: exactly the entries a rule with the words matches, outside the target category, transfers left out, with an optional rule", () => {
  const request = { type: "recategorise_bulk", words: "grab", categoryName: "Transport", fromCategoryName: null, month: null };
  const rows = [
    candidate("a", { date: "2026-09-12" }),
    candidate("b", { date: "2026-08-01", categoryName: "Other" }),
    candidate("c", { categoryName: "Transport" }),
    candidate("d", { entryType: "transfer", categoryName: "Transfer" }),
    candidate("e", { description: "GRABBAG STORE" }),
    candidate("f", { description: "KOPI", originalDescription: "GRAB*FOOD 4417" })
  ];
  const reply = buildBulkRecategorise(request, rows, makeContext({ text: "make all Grab rides Transport" }));
  assert.equal(reply.kind, "change");
  const { change } = reply;
  assert.equal(change.type, "recategorise_bulk");
  // "grab" (4 letters) matches inside GRABBAG too, exactly as a rule would.
  assert.deepEqual(change.entries.map((entry) => entry.entryId), ["a", "e", "f", "b"]);
  assert.equal(change.count, 4);
  assert.equal(change.confirmCount, null);
  assert.deepEqual(change.save[0].body.changes.map((item) => [item.entryId, item.fromCategoryName, item.categoryName]), [
    ["a", "Food & Drinks", "Transport"], ["e", "Food & Drinks", "Transport"], ["f", "Food & Drinks", "Transport"], ["b", "Other", "Transport"]
  ]);
  assert.deepEqual(change.undo[0].body.changes.map((item) => [item.entryId, item.fromCategoryName, item.categoryName]), [
    ["a", "Transport", "Food & Drinks"], ["e", "Transport", "Food & Drinks"], ["f", "Transport", "Food & Drinks"], ["b", "Transport", "Other"]
  ]);
  assert.deepEqual(change.rule, { pattern: "GRAB", categoryId: "cat-transport", categoryName: "Transport" });
});

test("negative: over 10 rows the card needs an explicit confirm; over 200 or none are not offered; an existing rule is not offered again", () => {
  const request = { type: "recategorise_bulk", words: "grab", categoryName: "Transport", fromCategoryName: null, month: null };
  const eleven = Array.from({ length: 11 }, (_, index) => candidate(`r${String(index).padStart(2, "0")}`));
  const reply = buildBulkRecategorise(request, eleven, makeContext());
  assert.equal(reply.change.confirmCount, 11);
  assert.equal(reply.change.entries.length, 8);
  assert.equal(reply.change.save[0].body.confirmedCount, undefined, "the confirm comes from the person's tap, not the server");
  assert.equal(reply.change.undo[0].body.confirmedCount, 11);
  const many = Array.from({ length: 201 }, (_, index) => candidate(`m${index}`));
  assert.deepEqual(buildBulkRecategorise(request, many, makeContext()), { kind: "note", text: "That's 201 entries, more than Ask changes at once (200). Filter them in Entries instead." });
  assert.deepEqual(buildBulkRecategorise(request, [candidate("c", { categoryName: "Transport" })], makeContext()), { kind: "note", text: "No entries with \"grab\" are outside Transport." });
  const ruled = makeContext();
  ruled.entry.categoryMatchRules = [{ id: "rule-1", pattern: "GRAB", categoryId: "cat-transport", categoryName: "Transport", priority: 10, isActive: true }];
  assert.equal(buildBulkRecategorise(request, [candidate("a")], ruled).change.rule, null);
});

// --- notes -----------------------------------------------------------------

test("edit_note: the entry's note or a month's note, in the person's own words, with Undo to what it said", () => {
  const entry = turn("edit_note", { note_edit: { target: "entry", text: "Joyce's birthday dinner" } }, { focus: saved({ note: "dinner" }), text: "note: Joyce's birthday dinner" });
  assert.deepEqual(entry.change.save, [{ path: "/api/entries/update-note", body: { entryId: "txn-1", note: "Joyce's birthday dinner" } }]);
  assert.deepEqual(entry.change.undo, [{ path: "/api/entries/update-note", body: { entryId: "txn-1", note: "dinner" } }]);
  assert.equal(turn("edit_note", { note_edit: { target: "entry", text: "paid by card 4417" } }, { focus: saved(), text: "note it" }).kind, "clarify");
  assert.equal(turn("edit_note", { note_edit: { target: "entry", text: "dinner" } }, { text: "note dinner" }).kind, "note");
  const month = turn("edit_note", { note_edit: { target: "month", text: "Bali trip month", month: "2026-09" } }, { text: "September note: Bali trip month" });
  assert.deepEqual(month, { kind: "resolve", request: { type: "month_note", month: "2026-09", personScope: "person-tim", text: "Bali trip month" } });
  const built = buildMonthNote(month.request, "Quiet month");
  assert.deepEqual(built.change.save, [{ path: "/api/month-note/update", body: { month: "2026-09", personScope: "person-tim", note: "Bali trip month" } }]);
  assert.deepEqual(built.change.undo[0].body.note, "Quiet month");
  assert.equal(buildMonthNote(month.request, "Bali trip month").kind, "note");
});

// --- transfers ---------------------------------------------------------------

function other(id, extra = {}) {
  return { entryId: id, date: "2026-10-10", description: "FAST TRANSFER", accountId: "acct-uob", accountName: "UOB One", amountMinor: 1_850, currency: "SGD", categoryName: "Other - Income", linked: false, ...extra };
}

test("link_transfer: the best match is pre-selected (money leaves the entry in focus, reaches the other); up to 3 more are choices; an entry that is not a transfer yet can stay unmatched", () => {
  const request = turn("link_transfer", { transfer: { wallet: null, date: null } }, { focus: saved(), text: "this was a transfer" });
  assert.equal(request.kind, "resolve");
  const card = buildTransferLink(request.request, [other("t2")]);
  assert.equal(card.kind, "change");
  assert.deepEqual(card.change.save, [{ path: "/api/transfers/link", body: { fromEntryId: "txn-1", toEntryId: "t2" } }]);
  assert.equal(card.change.undo, null);
  assert.deepEqual(card.change.rows.slice(0, 2), [{ field: "from", before: "", after: "Citi Rewards" }, { field: "to", before: "", after: "UOB One" }]);
  assert.deepEqual(card.change.transfer.options.map((option) => option.id), ["t2"]);
  assert.equal(card.change.transfer.walletMissed, "");
  const incoming = buildTransferLink({ ...request.request, entry: { ...ENTRY, entryType: "income" } }, [other("t2")]);
  assert.deepEqual(incoming.change.save[0].body, { fromEntryId: "t2", toEntryId: "txn-1" });

  // Several: the best (first) is selected and pre-saved; at most 3 more follow.
  const many = [
    other("t2"),
    other("t3", { accountName: "DBS Joyce", accountId: "acct-dbs-joyce", date: "2026-10-11" }),
    other("t4", { accountName: "Tim cash", accountId: "acct-cash-tim", date: "2026-10-12" }),
    other("t5", { date: "2026-10-13" }),
    other("t6", { date: "2026-10-14" })
  ];
  const several = buildTransferLink(request.request, many);
  assert.equal(several.kind, "change");
  assert.deepEqual(several.change.transfer.options.map((option) => option.id), ["t2", "t3", "t4", "t5"]);
  assert.deepEqual(several.change.save, several.change.transfer.options[0].save);
  assert.deepEqual(several.change.transfer.options[1].save, [{ path: "/api/transfers/link", body: { fromEntryId: "txn-1", toEntryId: "t3" } }]);
  assert.deepEqual(several.change.transfer.options[1].rows.slice(0, 2), [{ field: "from", before: "", after: "Citi Rewards" }, { field: "to", before: "", after: "DBS Joyce" }]);

  // "No other side yet": the entry becomes an unmatched transfer through the entry update, and can be changed back.
  const none = several.change.transfer.none;
  assert.equal(none.id, "none");
  assert.deepEqual(none.save, [{
    path: "/api/entries/update",
    body: { entryId: "txn-1", date: "2026-10-10", postDate: null, description: "GRAB RIDE 123", accountId: "acct-citi", categoryName: "Transfer", amountMinor: 1_850, entryType: "transfer", transferDirection: "out", ownershipType: "direct", ownerName: "Tim", note: "" }
  }]);
  assert.deepEqual(none.undo, [{
    path: "/api/entries/update",
    body: { entryId: "txn-1", date: "2026-10-10", postDate: null, description: "GRAB RIDE 123", accountId: "acct-citi", categoryName: "Food & Drinks", amountMinor: 1_850, entryType: "expense", ownershipType: "direct", ownerName: "Tim", note: "" }
  }]);
  assert.deepEqual(none.rows.slice(0, 2), [{ field: "from", before: "", after: "Citi Rewards" }, { field: "to", before: "", after: "Not matched yet" }]);
  assertSavesThroughKnownCommands({ save: none.save, undo: none.undo });
  const incomingNone = buildTransferLink({ ...request.request, entry: { ...ENTRY, entryType: "income" } }, []).change.transfer.none;
  assert.equal(incomingNone.save[0].body.transferDirection, "in");

  assert.equal(turn("link_transfer", {}, { focus: saved({ linkedToTransfer: true }), text: "link it" }).kind, "note");
  assert.equal(turn("link_transfer", {}, { focus: saved({ linkedToSplits: true }), text: "link it" }).kind, "note");
  assert.equal(turn("link_transfer", {}, { text: "link it" }).kind, "note");
});

test("link_transfer: no candidates offers only the unmatched transfer; an entry that already is an unmatched transfer has nothing to offer; a pair already linked is never offered", () => {
  const request = turn("link_transfer", {}, { focus: saved(), text: "this is a transfer" }).request;
  const nothing = buildTransferLink(request, []);
  assert.equal(nothing.kind, "change");
  assert.deepEqual(nothing.change.transfer.options, []);
  assert.deepEqual(nothing.change.save, nothing.change.transfer.none.save);
  assert.equal(nothing.change.count, 1);
  const taken = buildTransferLink(request, [other("t2", { linked: true })]);
  assert.deepEqual(taken.change.transfer.options, []);
  const already = { ...request, entry: { ...ENTRY, entryType: "transfer", categoryName: "Transfer", transferDirection: "out" } };
  assert.equal(buildTransferLink(already, []).kind, "note");
  assert.equal(buildTransferLink(already, [other("t2")]).change.transfer.none, null);
});

test("link_transfer: a wallet the person named narrows the choices; with no match there the card says so and offers the others", () => {
  const request = turn("link_transfer", { transfer: { wallet: "DBS Joyce", date: null } }, { focus: saved(), text: "transfer to DBS Joyce" });
  assert.equal(request.request.walletId, "acct-dbs-joyce");
  assert.equal(request.request.walletName, "DBS Joyce");
  const both = [other("t2"), other("t3", { accountName: "DBS Joyce", accountId: "acct-dbs-joyce", date: "2026-10-11" })];
  const narrowed = buildTransferLink(request.request, both);
  assert.deepEqual(narrowed.change.transfer.options.map((option) => option.id), ["t3"]);
  assert.equal(narrowed.change.transfer.walletMissed, "");
  const missed = buildTransferLink(request.request, [other("t2"), other("t4", { accountName: "Tim cash", accountId: "acct-cash-tim" })]);
  assert.deepEqual(missed.change.transfer.options.map((option) => option.id), ["t2", "t4"]);
  assert.equal(missed.change.transfer.walletMissed, "DBS Joyce");
  const empty = buildTransferLink(request.request, []);
  assert.deepEqual(empty.change.transfer.options, []);
  assert.equal(empty.change.transfer.walletMissed, "DBS Joyce");
  // The entry's own wallet is never the other side, so naming it names nobody.
  assert.equal(turn("link_transfer", { transfer: { wallet: "Citi Rewards", date: null } }, { focus: saved(), text: "transfer" }).request.walletId, null);
  // A day the person named keeps only that day's rows.
  const day = turn("link_transfer", { transfer: { wallet: null, date: "2026-10-11" } }, { focus: saved(), text: "transfer on the 11th" });
  assert.deepEqual(buildTransferLink(day.request, both).change.transfer.options.map((option) => option.id), ["t3"]);
});

test("every Ask action that makes an entry a transfer runs the same search: edit type, edit category Transfer, recategorise to Transfer; a bulk recategorise to Transfer still cannot", () => {
  const focus = saved();
  const byType = turn("edit_saved_entry", { entry: { type: "transfer", to_wallet: "UOB One" } }, { focus, text: "this is a transfer to my UOB One" });
  assert.deepEqual(byType, { kind: "resolve", request: { type: "link_transfer", entry: focus.entry, walletId: "acct-uob", walletName: "UOB One", date: null } });
  const byEdit = turn("edit_draft", { entry: { type: "transfer" } }, { focus, text: "make it a transfer" });
  assert.equal(byEdit.request.type, "link_transfer");
  assert.equal(byEdit.request.walletId, null);
  assert.equal(turn("edit_saved_entry", { entry: { category: "Transfer" } }, { focus, text: "make it a transfer" }).request.type, "link_transfer");
  const byCategory = turn("recategorise", { recategorise: { category: "Transfer" } }, { focus, text: "make it Transfer" });
  assert.equal(byCategory.request.type, "link_transfer");
  assert.equal(turn("recategorise", { recategorise: { category: "Transfer", words: "grab" } }, { focus, text: "make all grab Transfer" }).kind, "note");
  assert.equal(turn("edit_saved_entry", { entry: { type: "transfer" } }, { focus: saved({ linkedToTransfer: true }), text: "transfer" }).kind, "note");
  assert.equal(turn("edit_saved_entry", { entry: { type: "transfer", to_wallet: "no such bank" } }, { focus, text: "transfer to no such bank" }).kind, "clarify");
  // An entry that already is a transfer keeps editing as before.
  assert.equal(turn("edit_saved_entry", { entry: { type: "transfer", amount: "5" } }, { focus: saved({ entryType: "transfer", categoryName: "Transfer" }), text: "make it 5" }).change.type, "edit_entry");
});

// --- split groups ----------------------------------------------------------

test("split_group create: a new group named in the person's words; an existing name or made-up one is not created", () => {
  const reply = turn("split_group", { group: { op: "create", name: "Japan trip", currency: "JPY" } }, { text: "new group Japan trip in JPY" });
  assert.deepEqual(reply.change.save, [{ path: "/api/splits/groups/create", body: { name: "Japan trip", currency: "JPY" } }]);
  assert.equal(turn("split_group", { group: { op: "create", name: "Home" } }, { text: "new group home" }).kind, "note");
  assert.equal(turn("split_group", { group: { op: "create", name: "Paris" } }, { text: "new group" }).kind, "clarify");
});

function splitFacts(extra = {}) {
  return { id: "split-1", groupId: null, groupName: "", date: "2026-10-10", description: "GRAB RIDE 123", categoryName: "Food & Drinks", payerPersonName: "Tim", totalAmountMinor: 1_850, currency: "SGD", paymentMethod: "card", paymentStatus: "recorded", firstBasisPoints: 5000, firstAmountMinor: 925, closed: false, ...extra };
}

test("split_group move: the split of the entry in focus moves group through the split update, every other fact kept; Undo moves it back", () => {
  const request = turn("split_group", { group: { op: "move", name: "Home" } }, { focus: saved({ linkedToSplits: true }), text: "move it to Home" });
  assert.equal(request.kind, "resolve");
  const card = buildGroupMove(request.request, splitFacts());
  assert.deepEqual(card.change.save[0], {
    path: "/api/splits/expenses/update",
    body: { splitExpenseId: "split-1", groupId: "split-group-home", date: "2026-10-10", description: "GRAB RIDE 123", categoryName: "Food & Drinks", payerPersonName: "Tim", amountMinor: 1_850, note: "", splitBasisPoints: 5000, splitAmountMinor: 925, currency: "SGD", paymentMethod: "card", paymentStatus: "recorded" }
  });
  assert.equal(card.change.undo[0].body.groupId, null);
  assert.equal(buildGroupMove({ ...request.request, group: { id: "split-group-bali", name: "Bali trip", currency: "IDR" } }, splitFacts()).kind, "clarify");
  assert.equal(buildGroupMove(request.request, splitFacts({ closed: true })).kind, "note");
  assert.equal(buildGroupMove(request.request, null).kind, "note");
  assert.equal(turn("split_group", { group: { op: "move", name: "Home" } }, { focus: saved(), text: "move it to Home" }).kind, "note");
});

test("split_group settle: the group's whole balance as a settle-up payment draft, today; nothing owed says so", () => {
  const request = turn("split_group", { group: { op: "settle", name: null } }, { focus: { kind: "split_group", group: { id: "split-group-home", name: "Home", currency: "SGD" } }, text: "settle up everything" });
  assert.deepEqual(request, { kind: "resolve", request: { type: "group_settle", group: { id: "split-group-home", name: "Home", currency: "SGD" } } });
  assert.deepEqual(buildGroupSettle(request.request, 4_200, makeContext()), {
    kind: "settlement_draft",
    settlement: { fromPersonName: "Joyce", toPersonName: "Tim", amountMinor: 4_200, currency: "SGD", date: TODAY, groupId: "split-group-home", groupName: "Home" }
  });
  assert.equal(buildGroupSettle(request.request, -900, makeContext()).settlement.fromPersonName, "Tim");
  assert.deepEqual(buildGroupSettle(request.request, 0, makeContext()), { kind: "note", text: "Nothing is owed in Home right now." });
  assert.equal(turn("split_group", { group: { op: "settle", name: "Paris" } }, { text: "settle paris" }).kind, "clarify");
});

test("split_group simplify: the one payment the command would record, with Undo reopening it; already simplified opens Splits", () => {
  const request = turn("split_group", { group: { op: "simplify" } }, { text: "simplify everything" });
  assert.deepEqual(request, { kind: "resolve", request: { type: "simplify", currency: null } });
  const card = buildSimplify({ ok: true, currency: "SGD", recordCount: 3, fromPersonName: "Joyce", toPersonName: "Tim", amountMinor: 6_000 }, makeContext());
  assert.deepEqual(card.change.save, [{ path: "/api/splits/checkpoints/create", body: { viewerPersonId: "person-tim", date: TODAY, currency: "SGD" } }]);
  assert.deepEqual(card.change.undo, [{ path: "/api/splits/checkpoints/reopen", body: {}, fromResult: { key: "checkpointId", as: "checkpointId" } }]);
  assert.equal(card.change.count, 3);
  assert.equal(buildSimplify({ ok: false, reason: "already" }, makeContext()).kind, "open_page");
  assert.equal(buildSimplify({ ok: false, reason: "none" }, makeContext()).kind, "note");
});

// --- matches ---------------------------------------------------------------

test("review_matches: the month's matches as Splits lists them, at most six; none says so", () => {
  const request = turn("review_matches", { matches: { month: "2026-09" } }, { text: "any matches in september" });
  assert.deepEqual(request, { kind: "resolve", request: { type: "matches", month: "2026-09" } });
  const match = { id: "m1", kind: "expense", splitRecordId: "split-1", transactionId: "txn-9", groupName: "", splitDescription: "Dinner", splitDate: "2026-09-02", splitAmountMinor: 8_000, splitCurrency: "SGD", transactionDescription: "RESTAURANT", transactionDate: "2026-09-02", amountMinor: 8_000, transactionCurrency: "SGD", canLink: true };
  assert.deepEqual(buildMatches(request.request, Array(8).fill(match)).matches.length, 6);
  assert.deepEqual(buildMatches(request.request, []), { kind: "note", text: "No bank rows are waiting to be matched to splits in September 2026." });
});

// --- payment ways, categories, plan links ----------------------------------

test("set_payment_way: a bank wallet for PayNow, a cash wallet for cash, with Undo to the old choice; the wrong kind is asked", () => {
  const reply = turn("set_payment_way", { payment_way: { person: "Joyce", paynow_wallet: "UOB One" } }, { text: "Joyce's PayNow is UOB One" });
  assert.deepEqual(reply.change.save, [{ path: "/api/settings/payment-ways/save", body: { personId: "person-joyce", bankTransferAccountId: "acct-uob", cashAccountId: "" } }]);
  assert.deepEqual(reply.change.undo[0].body, { personId: "person-joyce", bankTransferAccountId: "acct-dbs-joyce", cashAccountId: "" });
  assert.deepEqual(reply.change.rows, [{ field: "paynow", before: "DBS Joyce", after: "UOB One" }]);
  assert.deepEqual(turn("set_payment_way", { payment_way: { paynow_wallet: "Citi Rewards" } }, { text: "my paynow is citi" }), { kind: "clarify", question: "Which bank wallet should PayNow mean?", options: ["UOB One", "DBS Joyce"] });
  assert.equal(turn("set_payment_way", { payment_way: { paynow_wallet: "UOB One" } }, { text: "my paynow is uob" }).kind, "note");
});

test("edit_category: create, rename and recolour through the category commands; a built-in name or a colour outside the palette is not changed here", () => {
  const created = turn("edit_category", { category_edit: { op: "create", new_name: "Pets", colour: "teal" } }, { text: "add a category Pets in teal" });
  assert.deepEqual(created.change.save, [{ path: "/api/categories/create", body: { name: "Pets", colorHex: "#46788E" } }]);
  const renamed = turn("edit_category", { category_edit: { op: "rename", category: "Taxi", new_name: "Rides" } }, { text: "rename Taxi to Rides" });
  assert.deepEqual(renamed.change.save, [{ path: "/api/categories/update", body: { categoryId: "cat-taxi", name: "Rides" } }]);
  assert.deepEqual(renamed.change.undo, [{ path: "/api/categories/update", body: { categoryId: "cat-taxi", name: "Taxi" } }]);
  const coloured = turn("edit_category", { category_edit: { op: "colour", category: "Taxi", colour: "rust" } }, { text: "make taxi rust" });
  assert.deepEqual(coloured.change.save[0].body, { categoryId: "cat-taxi", colorHex: "#C36351" });
  assert.deepEqual(coloured.change.undo[0].body, { categoryId: "cat-taxi", colorHex: "#8B897A" });
  assert.equal(turn("edit_category", { category_edit: { op: "rename", category: "Other", new_name: "Misc" } }, { text: "rename other to misc" }).kind, "note");
  assert.equal(turn("edit_category", { category_edit: { op: "create", new_name: "Groceries" } }, { text: "add groceries" }).kind, "note");
  const neon = turn("edit_category", { category_edit: { op: "colour", category: "Taxi", colour: "neon" } }, { text: "make taxi neon" });
  assert.deepEqual(neon, { kind: "open_page", page: "settings", params: {}, why: "Pick the colour in Settings: it shows every colour a category can have." });
});

test("link_plan: the month's expenses with the words link to a planned item, its links kept; Undo restores them", () => {
  const request = turn("link_plan", { plan_link: { line: "netflix", month: "2026-10", words: "netflix" } }, { text: "link netflix to the Netflix plan line" });
  assert.deepEqual(request, { kind: "resolve", request: { type: "plan_link", line: "Netflix", month: "2026-10", words: "netflix" } });
  const rows = [{ id: "row-netflix", label: "Netflix", section: "planned_items", linkedEntryIds: ["txn-old"] }];
  const card = buildPlanLink(request.request, rows, [
    candidate("n1", { date: "2026-10-03", description: "NETFLIX.COM" }),
    candidate("n2", { date: "2026-09-03", description: "NETFLIX.COM" }),
    candidate("txn-old", { date: "2026-10-01", description: "NETFLIX.COM" })
  ]);
  assert.deepEqual(card.change.save, [{ path: "/api/month-plan/links", body: { rowId: "row-netflix", month: "2026-10", transactionIds: ["txn-old", "n1"] } }]);
  assert.deepEqual(card.change.undo[0].body.transactionIds, ["txn-old"]);
  assert.equal(buildPlanLink(request.request, [{ ...rows[0], section: "budget_buckets" }], [candidate("n1", { date: "2026-10-03", description: "NETFLIX.COM" })]).kind, "note");
  assert.equal(turn("link_plan", { plan_link: { line: "Rent", words: "rent" } }, { text: "link rent" }).kind, "clarify");
});

// --- never from Ask ----------------------------------------------------------

test("never from Ask: deleting, imports, reconciling, accounts and people open their page with the reason, and nothing is drafted", () => {
  assert.deepEqual(turn("cannot_help", { blocked: "delete_entry" }, { text: "delete this entry" }), {
    kind: "open_page", page: "entries", params: { view: "person-tim", month: "2026-10" },
    why: "Ask doesn't delete entries. Open the entry in Entries and delete it there, where you can check it first."
  });
  for (const [blocked, page] of [["delete_month", "month"], ["delete_import", "imports"], ["import_statement", "imports"], ["undo_import", "imports"], ["reconcile", "settings"], ["accounts", "settings"], ["people", "settings"]]) {
    const reply = turn("cannot_help", { blocked }, { text: "do it" });
    assert.equal(reply.kind, "open_page", blocked);
    assert.equal(reply.page, page, blocked);
    assert.ok(reply.why.length > 20, blocked);
  }
});
