// Ask's turn validator (src/domain/ask-turn.ts): the model's one action is
// checked against the household's real data before the page shows any
// draft. Each action has its accepted shape and its refusals: an unknown
// person, wallet or group, shares that do not add up to the whole, an
// amount the person never wrote, a date in the future, and no entry in
// focus. The prompt carries no account, card, phone or ID number and no
// amount from the household's records.
import assert from "node:assert/strict";
import test from "node:test";

import {
  ASK_TURN_SCHEMA,
  buildAskTurnPrompt,
  parseAskTurnAction,
  readAmountMinor,
  validateAskTurnAction
} from "../src/domain/ask-turn.ts";

const TODAY = "2026-10-13";

function account(id, name, ownerPersonId, extra = {}) {
  return { id, institutionId: "inst", name, institution: "Bank", kind: "credit_card", ownerLabel: ownerPersonId === "person-tim" ? "Tim" : "Joyce", ownerPersonId, currency: "SGD", isJoint: false, isActive: true, ...extra };
}

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
        account("acct-citi", "Citi Rewards 4417", "person-tim"),
        account("acct-uob", "UOB One", "person-tim", { kind: "bank" }),
        account("acct-joyce-dbs", "DBS Joyce", "person-joyce", { kind: "bank" }),
        account("acct-old", "Old Card", "person-tim", { isActive: false })
      ],
      people,
      categoryNames: ["Food & Drinks", "Groceries", "Transport", "Other", "Other - Income", "Transfer"],
      categoryMatchRules: [],
      defaultAccountPriorityIds: ["acct-citi"],
      viewerName: "Tim"
    },
    groups: [{ id: "split-group-bali", name: "Bali trip", currency: "IDR" }, { id: "split-group-home", name: "Home", currency: "SGD" }],
    planLines: ["Groceries", "Food"],
    focus: null,
    history: [],
    text: "",
    ...overrides
  };
}

const APPLE_PAY_ENTRY = {
  entryId: "txn-apple-1",
  description: "STARBUCKS PAYNOW 91234567 S1234567D",
  categoryName: "Food & Drinks",
  date: "2026-10-12",
  entryType: "expense",
  accountName: "Citi Rewards 4417",
  currency: "SGD",
  amountMinor: 4_250,
  payerPersonId: "person-tim",
  linkedToSplits: false
};

function savedFocus(entry = {}) {
  return { kind: "saved_entry", entry: { ...APPLE_PAY_ENTRY, ...entry } };
}

function act(action, fields = {}) {
  const parsed = parseAskTurnAction({ action, ...fields });
  assert.ok(parsed, `${action} parses`);
  return parsed;
}

// --- Shape ------------------------------------------------------------------

test("the model's answer must name one known action; anything else is not an action", () => {
  assert.equal(parseAskTurnAction(null), null);
  assert.equal(parseAskTurnAction({}), null);
  assert.equal(parseAskTurnAction({ action: "delete_entry" }), null);
  assert.equal(parseAskTurnAction([{ action: "draft_entry" }]), null);
  assert.deepEqual(parseAskTurnAction({ action: "cannot_help", note: "No.", entry: "x", blocked: "format_disk" }), {
    action: "cannot_help", entry: null, split: null, settlement: null, plan: null, question: null, search: null, page: null, clarify: null, note: "No.",
    recategorise: null, note_edit: null, transfer: null, group: null, matches: null, payment_way: null, category_edit: null, plan_link: null, blocked: null,
    lookup: null, target_entry: null
  });
  // The schema the providers get asks for exactly those actions (Phase 2's
  // changes to saved data after the first eleven).
  assert.deepEqual(ASK_TURN_SCHEMA.properties.action.enum, [
    "draft_entry", "edit_draft", "add_entry_to_splits", "draft_split_expense", "draft_settlement", "plan_change",
    "answer_question", "search_entries", "open_page", "ask_clarification", "cannot_help",
    "edit_saved_entry", "recategorise", "edit_note", "link_transfer", "split_group", "review_matches", "set_payment_way", "edit_category", "link_plan",
    "look_up"
  ]);
  // Deleting is never an action, only a reason to open the page that does it.
  assert.ok(!ASK_TURN_SCHEMA.properties.action.enum.some((name) => /delete|remove|import|reconcile/.test(name)));
});

test("amounts read as written, and nothing past S$10m", () => {
  assert.equal(readAmountMinor("42.50"), 4_250);
  assert.equal(readAmountMinor("$1,200"), 120_000);
  assert.equal(readAmountMinor("1.2k"), 120_000);
  assert.equal(readAmountMinor(12), 1_200);
  assert.equal(readAmountMinor("0"), null);
  assert.equal(readAmountMinor("-5"), null);
  assert.equal(readAmountMinor("20000000"), null);
  // Words for a number read too ("fifty bucks"); a word that is no number does not.
  assert.equal(readAmountMinor("twelve"), 1_200);
  assert.equal(readAmountMinor("lunch"), null);
});

// --- add_entry_to_splits (the owner's case) -----------------------------------

test("\"Add to splits, all Joyce\" on the Apple Pay entry: Tim paid, Joyce's share is the whole amount", () => {
  const context = makeContext({ focus: savedFocus(), text: "Add to splits, all Joyce" });
  const reply = validateAskTurnAction(act("add_entry_to_splits", { split: { payer: null, group: null, shares: [{ person: "Joyce", all: true }] } }), context);
  assert.deepEqual(reply, {
    kind: "split_proposal",
    proposal: {
      entryId: "txn-apple-1",
      description: APPLE_PAY_ENTRY.description,
      date: "2026-10-12",
      amountMinor: 4_250,
      currency: "SGD",
      payerName: "Tim",
      groupId: null,
      groupName: "",
      splitBasisPoints: 0,
      shares: [
        { personName: "Tim", basisPoints: 0, amountMinor: 0 },
        { personName: "Joyce", basisPoints: 10_000, amountMinor: 4_250 }
      ]
    }
  });
});

test("\"I meant all splits share is Joyce, I'm the owner\": the payer said as \"me\" is the entry's payer, the same proposal", () => {
  const context = makeContext({
    focus: savedFocus(),
    history: [{ role: "user", text: "Add to splits" }, { role: "app", text: "Added a 50/50 draft." }],
    text: "I meant all splits share is Joyce, I'm the owner"
  });
  const reply = validateAskTurnAction(act("add_entry_to_splits", { split: { payer: "me", group: null, shares: [{ person: "Joyce", percent: 100 }, { person: "Tim", percent: 0 }] } }), context);
  assert.equal(reply.kind, "split_proposal");
  assert.equal(reply.proposal.payerName, "Tim");
  assert.equal(reply.proposal.splitBasisPoints, 0);
});

test("a dollar share is the person's written amount, the rest the other's, from the entry's own total", () => {
  const context = makeContext({ focus: savedFocus(), text: "split it, Joyce owes me $12.50" });
  const reply = validateAskTurnAction(act("add_entry_to_splits", { split: { payer: "Tim", group: "Home", shares: [{ person: "Joyce", amount: "12.50" }] } }), context);
  assert.equal(reply.kind, "split_proposal");
  assert.equal(reply.proposal.groupId, "split-group-home");
  assert.equal(reply.proposal.splitAmountMinor, 3_000);
  assert.deepEqual(reply.proposal.shares, [
    { personName: "Tim", basisPoints: 7_059, amountMinor: 3_000 },
    { personName: "Joyce", basisPoints: 2_941, amountMinor: 1_250 }
  ]);
});

test("no shares named is an even split", () => {
  const reply = validateAskTurnAction(act("add_entry_to_splits", { split: { shares: [] } }), makeContext({ focus: savedFocus(), text: "put this on splits" }));
  assert.equal(reply.proposal.splitBasisPoints, 5_000);
  assert.deepEqual(reply.proposal.shares.map((share) => share.amountMinor), [2_125, 2_125]);
});

test("negative: an unknown person asks who, naming the household's two people", () => {
  const reply = validateAskTurnAction(act("add_entry_to_splits", { split: { shares: [{ person: "Serene", all: true }] } }), makeContext({ focus: savedFocus(), text: "all Serene" }));
  assert.deepEqual(reply, {
    kind: "clarify",
    question: "Whose share do you mean? This household has Tim and Joyce.",
    options: ["Tim", "Joyce"],
    error: { code: "unknown_person", field: "split.shares.person", valid: ["Tim", "Joyce"], got: "Serene" }
  });
});

test("negative: shares that do not add up to 100% are asked, never rounded off", () => {
  const context = makeContext({ focus: savedFocus(), text: "Tim 60 Joyce 60" });
  const reply = validateAskTurnAction(act("add_entry_to_splits", { split: { shares: [{ person: "Tim", percent: 60 }, { person: "Joyce", percent: 60 }] } }), context);
  assert.deepEqual(reply, {
    kind: "clarify",
    question: "How should it be split? The two shares need to add up to the whole amount.",
    options: ["Split 50/50", "All Tim's", "All Joyce's"],
    error: { code: "shares_mismatch", field: "split.shares", valid: ["Tim", "Joyce"] }
  });
  const over = validateAskTurnAction(act("add_entry_to_splits", { split: { shares: [{ person: "Joyce", percent: 140 }] } }), context);
  assert.equal(over.kind, "clarify");
});

test("negative: a dollar share the person never wrote, or one past the total, is refused", () => {
  const context = makeContext({ focus: savedFocus(), text: "Joyce pays her part" });
  const invented = validateAskTurnAction(act("add_entry_to_splits", { split: { shares: [{ person: "Joyce", amount: "20" }] } }), context);
  assert.deepEqual(invented, { kind: "clarify", question: "How much was it? Type the amount as a number.", options: [], error: { code: "amount_not_stated", field: "split.shares" } });
  const tooMuch = validateAskTurnAction(act("add_entry_to_splits", { split: { shares: [{ person: "Joyce", amount: "50" }] } }), makeContext({ focus: savedFocus(), text: "Joyce owes $50" }));
  assert.equal(tooMuch.kind, "clarify");
});

test("negative: no saved entry in focus (or an id the route could not find) is never guessed", () => {
  const reply = validateAskTurnAction(act("add_entry_to_splits", { split: { shares: [{ person: "Joyce", all: true }] } }), makeContext({ text: "add to splits all Joyce" }));
  assert.deepEqual(reply, { kind: "note", text: "Which entry should go on Splits? Open it from Entries, then ask again." });
});

test("negative: an entry already on Splits, an income, or a payer other than the wallet's owner", () => {
  const all = { split: { shares: [{ person: "Joyce", all: true }] } };
  assert.deepEqual(validateAskTurnAction(act("add_entry_to_splits", all), makeContext({ focus: savedFocus({ linkedToSplits: true }), text: "all Joyce" })), { kind: "note", text: "This entry is already on Splits." });
  assert.deepEqual(validateAskTurnAction(act("add_entry_to_splits", all), makeContext({ focus: savedFocus({ entryType: "income" }), text: "all Joyce" })), { kind: "note", text: "Only an expense can go on Splits." });
  // A payer other than the wallet's owner is not asked: the card shows the
  // wallet owner as the payer, and says so.
  const otherPayer = validateAskTurnAction(act("add_entry_to_splits", { split: { payer: "Joyce", shares: [{ person: "Tim", all: true }] } }), makeContext({ focus: savedFocus(), text: "Joyce paid, all mine" }));
  assert.equal(otherPayer.kind, "split_proposal");
  assert.equal(otherPayer.proposal.payerName, "Tim");
  assert.equal(otherPayer.assumptions[0].text, "This entry is Tim's, so Splits shows Tim as the one who paid.");
  assert.deepEqual(otherPayer.assumptions[0].chips, []);
});

test("negative: an unknown group is asked; a group in another currency is left out and said", () => {
  const unknown = validateAskTurnAction(act("add_entry_to_splits", { split: { group: "Tokyo", shares: [] } }), makeContext({ focus: savedFocus(), text: "tokyo group" }));
  assert.deepEqual(unknown, {
    kind: "clarify",
    question: "Which split group should it go in?",
    options: ["Bali trip", "Home", "No group"],
    error: { code: "unknown_group", field: "group", valid: ["Bali trip", "Home"], got: "Tokyo" }
  });
  const currency = validateAskTurnAction(act("add_entry_to_splits", { split: { group: "Bali trip", shares: [] } }), makeContext({ focus: savedFocus(), text: "bali" }));
  assert.equal(currency.kind, "split_proposal");
  assert.equal(currency.proposal.groupId, null);
  assert.ok(currency.assumptions.some((line) => /IDR and this is in SGD, so I left it out of the group/.test(line.text)));
});

// --- Entries ------------------------------------------------------------------

test("draft_entry: the model's fields that check out fill the draft, marked ai, with the create body", () => {
  const context = makeContext({ text: "coffee at starbucks 6.90 yesterday on my UOB" });
  const reply = validateAskTurnAction(act("draft_entry", {
    entry: { type: "expense", description: "Starbucks coffee", amount: "6.90", date: "2026-10-12", wallet: "UOB One", category: "Food & Drinks", owner: "me" }
  }), context);
  assert.equal(reply.kind, "entry_draft");
  assert.equal(reply.share, null);
  assert.deepEqual(reply.draft.createBody, {
    date: "2026-10-12",
    description: "Starbucks coffee",
    accountId: "acct-uob",
    accountName: "UOB One",
    categoryName: "Food & Drinks",
    amountMinor: 690,
    entryType: "expense",
    ownershipType: "direct",
    ownerName: "Tim"
  });
  assert.equal(reply.draft.fields.amountMinor.source, "ai");
  assert.deepEqual(reply.draft.missing, []);
});

test("draft_entry negatives: an invented amount, a future date, an unknown or inactive wallet, an unknown person are left off the card and said", () => {
  const context = makeContext({ text: "lunch with joyce" });
  // Each is a draft with the field missing (the card asks it), never a question first.
  const invented = validateAskTurnAction(act("draft_entry", { entry: { amount: "15" } }), context);
  assert.equal(invented.kind, "entry_draft");
  assert.equal(invented.draft.fields.amountMinor, undefined);
  assert.ok(invented.draft.missing.includes("amountMinor"));
  const future = validateAskTurnAction(act("draft_entry", { entry: { date: "2026-10-20" } }), context);
  assert.equal(future.kind, "entry_draft");
  assert.equal(future.draft.fields.date?.source !== "ai", true);
  const inactive = validateAskTurnAction(act("draft_entry", { entry: { wallet: "Old Card" } }), context);
  assert.equal(inactive.kind, "entry_draft");
  assert.notEqual(inactive.draft.fields.accountId?.value, "acct-old");
  assert.notEqual(inactive.draft.fields.accountId?.source, "ai");
  assert.equal(inactive.assumptions[0].text, 'I couldn\'t find a wallet called "Old Card", so I left the wallet out.');
  assert.ok(inactive.assumptions[0].chips.every((chip) => chip.startsWith("On ")));
  const stranger = validateAskTurnAction(act("draft_entry", { entry: { owner: "Serene" } }), context);
  assert.equal(stranger.kind, "entry_draft");
  assert.notEqual(stranger.draft.fields.ownerName?.source, "ai");
  assert.deepEqual(stranger.assumptions[0].chips, ["It's Tim's", "It's Joyce's"]);
  // A description with words the person never wrote is dropped, not shown.
  const reply = validateAskTurnAction(act("draft_entry", { entry: { description: "Expensive steak dinner" } }), context);
  assert.equal(reply.kind, "entry_draft");
  assert.notEqual(reply.draft.fields.description?.value, "Expensive steak dinner");
});

test("draft_split_expense: a shared expense with the payer and Joyce's share, on Splits in the named group", () => {
  const context = makeContext({ text: "dinner at nobu 120, I paid, Joyce owes 70%, home group" });
  const reply = validateAskTurnAction(act("draft_split_expense", {
    entry: { description: "dinner at nobu", amount: "120", wallet: "Citi Rewards" },
    split: { payer: "Tim", group: "home", shares: [{ person: "Joyce", percent: 70 }] }
  }), context);
  assert.equal(reply.kind, "entry_draft");
  assert.deepEqual(reply.share, { on: true, groupId: "split-group-home" });
  assert.equal(reply.draft.createBody.ownershipType, "shared");
  assert.equal(reply.draft.createBody.splitBasisPoints, 3_000);
  assert.equal(reply.draft.createBody.ownerName, "Tim");
});

test("edit_draft: only the named fields change on the card being filled; on a saved card it is an edit of that entry", () => {
  const draft = { variant: "expense", description: "Lunch", date: TODAY, accountName: "Citi Rewards 4417", categoryName: "Other", ownerName: "Tim", amountMinor: 1_200, shareOn: false, splitGroupName: "" };
  const reply = validateAskTurnAction(act("edit_draft", { entry: { amount: "15", category: "food & drinks" } }), makeContext({ focus: { kind: "draft", draft }, text: "make it $15, food" }));
  assert.deepEqual(reply, { kind: "draft_patch", patch: { amountMinor: 1_500, categoryName: "Food & Drinks" }, share: null });
  const shared = validateAskTurnAction(act("edit_draft", { split: { shares: [{ person: "Joyce", all: true }] } }), makeContext({ focus: { kind: "draft", draft }, text: "all Joyce" }));
  assert.deepEqual(shared, { kind: "draft_patch", patch: { ownerName: "Shared", splitBasisPoints: 0 }, share: { on: true, groupId: "" } });
  const saved = validateAskTurnAction(act("edit_draft", { entry: { amount: "15" } }), makeContext({ focus: savedFocus({ accountId: "acct-citi" }), text: "make it 15" }));
  assert.equal(saved.kind, "change");
  assert.equal(saved.change.type, "edit_entry");
  assert.deepEqual(saved.change.rows, [{ field: "amount", before: "", after: "", beforeMinor: 4_250, afterMinor: 1_500, currency: "SGD" }]);
  assert.equal(validateAskTurnAction(act("edit_draft", { entry: { category: "Gifts" } }), makeContext({ focus: { kind: "draft", draft }, text: "gifts" })).kind, "clarify");
});

test("'coffee 4.50' then 'coffee': the category is never left on Other when a rule or an everyday word fits, on the first turn and on the follow-up that edits the card", () => {
  const turnOne = (entry) => validateAskTurnAction(act("draft_entry", { entry }), makeContext({ text: "coffee 4.50" }));
  for (const category of ["Other", undefined]) {
    const first = turnOne({ type: "expense", description: "coffee", amount: "4.50", ...(category ? { category } : {}) });
    assert.equal(first.kind, "entry_draft");
    assert.equal(first.draft.fields.categoryName.value, "Food & Drinks");
    assert.ok(!(first.assumptions ?? []).some((line) => /couldn't tell the category/.test(line.text)));
  }
  // The card the owner had: description coffee, amount 4.50, category Other (an earlier turn).
  const draft = { variant: "expense", description: "coffee", date: TODAY, accountName: "Citi Rewards 4417", categoryName: "Other", ownerName: "Tim", amountMinor: 450, shareOn: false, splitGroupName: "" };
  const second = (entry) => validateAskTurnAction(act("edit_draft", { entry }), makeContext({ focus: { kind: "draft", draft }, text: "coffee" }));
  for (const entry of [{ description: "coffee", category: "Other" }, { description: "coffee" }, {}]) {
    const reply = second(entry);
    assert.equal(reply.kind, "draft_patch");
    assert.equal(reply.patch.categoryName, "Food & Drinks");
    assert.ok(!(reply.assumptions ?? []).some((line) => /couldn't tell the category/.test(line.text)));
  }
  // A household rule beats the word list on the follow-up too.
  const ruled = makeContext({ focus: { kind: "draft", draft }, text: "coffee" });
  ruled.entry.categoryMatchRules = [{ id: "r1", pattern: "COFFEE", categoryName: "Groceries", priority: 1, isActive: true }];
  assert.equal(validateAskTurnAction(act("edit_draft", { entry: { description: "coffee", category: "Other" } }), ruled).patch.categoryName, "Groceries");
  // Negatives: a category the person names wins, a change that is not about the description leaves it, and a stranger word stays Other and says so.
  const named = validateAskTurnAction(act("edit_draft", { entry: { description: "coffee", category: "Groceries" } }), makeContext({ focus: { kind: "draft", draft }, text: "coffee, groceries" }));
  assert.equal(named.patch.categoryName, "Groceries");
  const amountOnly = validateAskTurnAction(act("edit_draft", { entry: { amount: "6" } }), makeContext({ focus: { kind: "draft", draft }, text: "make it 6" }));
  assert.deepEqual(amountOnly, { kind: "draft_patch", patch: { amountMinor: 600 }, share: null });
  const stranger = validateAskTurnAction(act("edit_draft", { entry: { description: "zorblax", category: "Other" } }), makeContext({ focus: { kind: "draft", draft }, text: "zorblax" }));
  assert.equal(stranger.kind, "draft_patch");
  assert.equal(stranger.patch.categoryName, undefined);
  assert.ok(stranger.assumptions.some((line) => line.text === "I couldn't tell the category, so I used Other."));
});

test("the everyday words reach the household's own category names ('Transport' for a taxi word, 'Food and Drinks' for coffee)", () => {
  const context = makeContext({ text: "grab 14" });
  context.entry.categoryNames = ["Food and Drinks", "Transport", "Other", "Transfer"];
  const taxi = validateAskTurnAction(act("draft_entry", { entry: { type: "expense", description: "grab", amount: "14", category: "Other" } }), context);
  assert.equal(taxi.draft.fields.categoryName.value, "Transport");
  const coffee = makeContext({ text: "coffee 4" });
  coffee.entry.categoryNames = ["Food and Drinks", "Other", "Transfer"];
  assert.equal(validateAskTurnAction(act("draft_entry", { entry: { type: "expense", description: "coffee", amount: "4" } }), coffee).draft.fields.categoryName.value, "Food and Drinks");
});

// --- Settlements, plans, questions, search, pages ------------------------------

test("draft_settlement: who paid whom and the written amount; one person both ways or no amount is asked", () => {
  const context = makeContext({ text: "Joyce paid me back $80 today" });
  assert.deepEqual(validateAskTurnAction(act("draft_settlement", { settlement: { from: "Joyce", to: "me", amount: "80" } }), context), {
    kind: "settlement_draft",
    settlement: { fromPersonName: "Joyce", toPersonName: "Tim", amountMinor: 8_000, currency: "SGD", date: TODAY, groupId: null, groupName: "" }
  });
  assert.equal(validateAskTurnAction(act("draft_settlement", { settlement: { from: "Tim", to: "me", amount: "80" } }), context).kind, "clarify");
  assert.equal(validateAskTurnAction(act("draft_settlement", { settlement: { from: "Joyce", to: "Tim", amount: null } }), makeContext({ text: "settle up with joyce" })).kind, "clarify");
});

test("plan_change goes through the plan reader's check: names and amounts the person wrote", () => {
  const context = makeContext({ text: "move 50 from food to groceries in october" });
  const reply = validateAskTurnAction(act("plan_change", { plan: { month: "2026-10", copy_from: null, ops: [{ kind: "move", from: "food", to: "groceries", amount: "50" }] } }), context);
  assert.deepEqual(reply, { kind: "plan", request: { month: "2026-10", copyFrom: null, ops: [{ kind: "move", from: "food", to: "groceries", amountMinor: 5_000 }] } });
  const invented = validateAskTurnAction(act("plan_change", { plan: { month: "2026-10", ops: [{ kind: "set", line: "groceries", amount: "300" }] } }), context);
  assert.equal(invented.kind, "clarify");
});

test("answer_question becomes a sentence the answer route reads as the same topic", () => {
  const context = makeContext({ text: "where did it all go last month?" });
  const cases = [
    [{ topic: "spending_where", month: "2026-09" }, "Where did my money go in September 2026?"],
    [{ topic: "spending_why", month: "2026-09" }, "Why was spending so high in September 2026?"],
    [{ topic: "plan", month: "2026-09" }, "Did we stick to the plan in September 2026?"],
    [{ topic: "compare", month: "2026-09", other_month: "2026-08" }, "Compare September 2026 with August 2026"],
    [{ topic: "biggest", month: "2026-09" }, "What were the biggest expenses in September 2026?"],
    [{ topic: "owed", person: "Joyce" }, "What do I owe Joyce?"],
    [{ topic: "income", month: "2026-09" }, "How much income came in in September 2026?"],
    [{ topic: "invested", from_month: "2026-07", to_month: "2026-09" }, "How much did I invest from July 2026 to September 2026?"],
    [{ topic: "saved", month: "2026-09" }, "How much did I save in September 2026?"],
    [{ topic: "spent_vs_earned", month: "2026-09" }, "Did I spend more than I earned in September 2026?"]
  ];
  for (const [question, text] of cases) {
    const reply = validateAskTurnAction(act("answer_question", { question }), context);
    assert.equal(reply.kind, "question", JSON.stringify(question));
    assert.equal(reply.text, text);
  }
  const joyce = validateAskTurnAction(act("answer_question", { question: { topic: "spending_where", month: "2026-09", person: "Joyce" } }), context);
  assert.equal(joyce.viewId, "person-joyce");
  const noMonthSaid = makeContext({ text: "did we stick to the plan" });
  assert.equal(validateAskTurnAction(act("answer_question", { question: { topic: "plan", month: "2027-01" } }), noMonthSaid).kind, "note");
  // The month the person wrote wins over the one the model worked out (here a wrong one).
  const wrong = validateAskTurnAction(act("answer_question", { question: { topic: "spending_where", month: "2025-03" } }), context);
  assert.equal(wrong.text, "Where did my money go in September 2026?");
  assert.equal(validateAskTurnAction(act("answer_question", { question: { topic: "compare", month: "2026-09" } }), context).kind, "clarify");
});

test("search_entries: an Entries filter from the household's own names; an unknown category is asked", () => {
  const context = makeContext({ text: "grab rides over $20 in september on citi" });
  const reply = validateAskTurnAction(act("search_entries", { search: { words: "grab", categories: ["Transport"], wallets: ["Citi Rewards"], month: "2026-09", type: "expense", min_amount: "20" } }), context);
  assert.deepEqual(reply, {
    kind: "search",
    filter: { month: "2026-09", viewId: "person-tim", scope: "direct_plus_shared", search: "grab", categories: ["Transport"], wallets: ["acct-citi"], type: "expense", minAmountMinor: 2_000, maxAmountMinor: null }
  });
  assert.equal(validateAskTurnAction(act("search_entries", { search: { categories: ["Pets"] } }), context).kind, "clarify");
  // Search words the person never wrote are dropped.
  const dropped = validateAskTurnAction(act("search_entries", { search: { words: "uber", month: "2026-09" } }), context);
  assert.equal(dropped.filter.search, "");
});

test("open_page keeps the view and month; clarification prose with an invented figure is replaced", () => {
  assert.deepEqual(validateAskTurnAction(act("open_page", { page: { name: "splits", person: "Joyce" } }), makeContext({ text: "show joyce's splits" })), {
    kind: "open_page", page: "splits", params: { view: "person-joyce", month: "2026-10" }
  });
  const context = makeContext({ text: "add lunch" });
  assert.deepEqual(validateAskTurnAction(act("ask_clarification", { clarify: { question: "Was it $14.20 at the cafe?", options: ["Yes"] } }), context), { kind: "clarify", question: "Can you say that another way?", options: [], error: { code: "other", field: "clarify.question" } });
  assert.deepEqual(validateAskTurnAction(act("ask_clarification", { clarify: { question: "Which wallet did you pay lunch with?", options: ["UOB One", "Citi Rewards", "UOB One", "Cash", "PayNow"] } }), context), {
    kind: "clarify", question: "Which wallet did you pay lunch with?", options: ["UOB One", "Citi Rewards", "Cash", "PayNow"]
  });
});

// --- The prompt -----------------------------------------------------------------

test("the prompt names people, wallets, categories, groups and lines but no account, phone or ID number and no amount from the records", () => {
  const prompt = buildAskTurnPrompt(makeContext({ focus: savedFocus(), text: "Add to splits, all Joyce", history: [{ role: "user", text: "card 4417 1234 5678 9012 was used" }] }));
  assert.match(prompt, /Tim, Joyce/);
  assert.match(prompt, /UOB One/);
  assert.match(prompt, /Bali trip \(IDR\)/);
  assert.match(prompt, /a saved expense "[^"]*Starbucks[^"]*"/i);
  assert.match(prompt, /<message>Add to splits, all Joyce<\/message>/);
  // No account, card, phone or NRIC number, from the wallet name, the entry's description or the history.
  assert.doesNotMatch(prompt, /4417/);
  assert.doesNotMatch(prompt, /91234567/);
  assert.doesNotMatch(prompt, /S1234567D/i);
  assert.doesNotMatch(prompt, /9012/);
  // No amount from the household's records: the entry's 42.50 is not sent.
  assert.doesNotMatch(prompt, /42\.5|4250|4,250/);
  // About 4 characters a token: a typical turn stays well under 2k tokens.
  assert.ok(prompt.length < 6_000, `prompt is ${prompt.length} characters`);
});

// Anthropic's structured-output validator refuses an enum whose values do not
// all match one declared type ("Enum value 'expense' does not match declared
// type ['string','null']"), which returned a 400 for every Ask turn.
test("the Ask turn schema never mixes a type list with an enum", () => {
  const offenders = [];
  const walk = (node, path) => {
    if (Array.isArray(node)) { node.forEach((item, index) => walk(item, `${path}[${index}]`)); return; }
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node.type) && node.enum) offenders.push(path);
    for (const [key, value] of Object.entries(node)) walk(value, `${path}.${key}`);
  };
  walk(ASK_TURN_SCHEMA, "schema");
  assert.deepEqual(offenders, []);
  const blocked = ASK_TURN_SCHEMA.properties.blocked;
  assert.deepEqual(blocked.anyOf[1], { type: "null" });
  assert.equal(blocked.anyOf[0].type, "string");
  assert.ok(blocked.anyOf[0].enum.length > 0);
});
