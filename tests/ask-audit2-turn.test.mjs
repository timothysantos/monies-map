// Ask audit 2 (AI on): the server reads what the person wrote where the model
// fell short, and never loops on a question it could answer itself.
// - B14: a bulk change whose category the model left out takes it from the
//   person's words; "Which category?" always comes with categories to tap.
// - B16: a plan change whose lines the model tidied ("shoping" became
//   "Shopping") is read from the person's own words, with "this months plan".
// - B17: a spending question that names a category answers for that
//   category (the Entries answer), never the whole month or a trip.
// - B18: "lunch 9.90" is a new entry even right after a question.
// - B19: a refusal names the thing the person asked for, not the model's.
// - B23: "left the category out" only when it was.
// - B15: "make that one Groceries" in the rules, after a one-entry answer.
// - B32: everyday dish words find Food & Drinks.
// Pure validator and rules tests; the route's side is in
// ask-audit2-route.test.mjs and the eval bank.
import assert from "node:assert/strict";
import test from "node:test";

import { parseAskTurnAction, validateAskTurnAction } from "../src/domain/ask-turn.ts";
import { readCommandIntent } from "../src/domain/ask-rules-intent.ts";
import { mayBeRulesTurn, readTurnRules } from "../src/domain/ask-turn-rules.ts";
import { nameAtEnd, namesMentioned } from "../src/domain/ask-turn-names.ts";
import { readPlanRequest } from "../src/domain/plan-draft-reader.ts";
import { categoryFromEverydayWords } from "../src/domain/category-everyday-words.ts";

const TODAY = "2026-11-18";
const CATEGORIES = ["Food & Drinks", "Groceries", "Taxi", "Public Transport", "Shopping", "Subscriptions MO", "Subscriptions YR", "Other", "Other - Income", "Transfer"];

function account(id, name, ownerPersonId, extra = {}) {
  return { id, institutionId: "inst", name, institution: "Bank", kind: "credit_card", ownerLabel: "", ownerPersonId, currency: "SGD", isJoint: false, isActive: true, ...extra };
}

function makeContext(overrides = {}) {
  const people = [{ id: "person-ethan", name: "Ethan" }, { id: "person-serene", name: "Serene" }];
  return {
    today: TODAY,
    month: "2026-11",
    viewId: "person-ethan",
    scope: "direct_plus_shared",
    page: "ask",
    people,
    entry: {
      today: TODAY,
      accounts: [account("acct-citi", "Citi Rewards Card", "person-ethan"), account("acct-dbs", "DBS Live Fresh", "person-ethan", { kind: "bank" })],
      people,
      categoryNames: CATEGORIES,
      categoryMatchRules: [],
      defaultAccountPriorityIds: ["acct-citi"],
      viewerName: "Ethan"
    },
    groups: [{ id: "split-group-japan", name: "Japan trip", currency: "JPY" }, { id: "split-group-home", name: "Home & Bills", currency: "SGD" }],
    planLines: ["Shopping", "Food & Drinks", "Groceries"],
    focus: null,
    history: [],
    text: "",
    ...overrides
  };
}

function act(action, fields = {}) {
  const parsed = parseAskTurnAction({ action, ...fields });
  assert.ok(parsed, `${action} parses`);
  return parsed;
}

const SAVED = {
  entryId: "txn-koufu",
  description: "KOUFU PTE LTD",
  categoryName: "Food & Drinks",
  date: "2026-11-01",
  entryType: "expense",
  accountName: "Citi Rewards Card",
  currency: "SGD",
  amountMinor: 700,
  payerPersonId: "person-ethan",
  linkedToSplits: false
};

// ---- B14 -----------------------------------------------------------------

test("B14: the model left the category out of \"make all Grab rides Transport\": the server reads it from the words", () => {
  for (const [text, category] of [
    ["make all Grab rides Transport", "Public Transport"],
    ["make all grab rides taxi", "Taxi"],
    ["move all my grab entries to the Public Transport category", "Public Transport"],
    ["move all grab to food & drinks please", "Food & Drinks"]
  ]) {
    const reply = validateAskTurnAction(act("recategorise", { recategorise: { category: null, words: "grab" } }), makeContext({ text }));
    assert.deepEqual(reply, { kind: "resolve", request: { type: "recategorise_bulk", words: "grab", categoryName: category, fromCategoryName: null, month: null } }, text);
  }
});

test("B14: \"Taxi\" answering \"Which category?\" is the category; the shop words come from the conversation", () => {
  const context = makeContext({ text: "Taxi", history: [{ role: "user", text: "make all grab rides" }, { role: "app", text: "Which category should it go in?" }] });
  const reply = validateAskTurnAction(act("recategorise", { recategorise: { category: null, words: "grab" } }), context);
  assert.equal(reply.kind, "resolve");
  assert.equal(reply.request.categoryName, "Taxi");
  assert.equal(reply.request.words, "grab");
});

test("B14 negative: no category in the words is a question with categories to tap, as whole messages, the shop's own guess first", () => {
  const reply = validateAskTurnAction(act("recategorise", { recategorise: { category: null, words: "grab" } }), makeContext({ text: "make all grab rides" }));
  assert.equal(reply.kind, "clarify");
  assert.equal(reply.question, "Which category should it go in?");
  assert.ok(reply.options.length >= 1 && reply.options.length <= 3, JSON.stringify(reply.options));
  assert.equal(reply.options[0], "Move all grab to Taxi");
  for (const option of reply.options) assert.match(option, /^Move all grab to /);
  // Other and Transfer are never offered.
  assert.ok(reply.options.every((option) => !/Other|Transfer/.test(option)));
});

test("B14: a shop word that points nowhere still offers spending categories, never income or savings", () => {
  const context = makeContext({ text: "make all zqshop", entry: { ...makeContext().entry, categoryNames: ["Income", "Savings", "Investments", ...CATEGORIES] } });
  const reply = validateAskTurnAction(act("recategorise", { recategorise: { category: null, words: "zqshop" } }), context);
  assert.equal(reply.kind, "clarify");
  assert.ok(reply.options.length > 0);
  assert.ok(reply.options.every((option) => /^Move all zqshop to /.test(option) && !/Income|Savings|Investments/.test(option)), JSON.stringify(reply.options));
});

test("B14: a category that is no category asks with chips, whole messages when the shop is known", () => {
  const reply = validateAskTurnAction(act("recategorise", { recategorise: { category: "Rides", words: "grab" } }), makeContext({ text: "make all grab Rides" }));
  assert.equal(reply.kind, "clarify");
  assert.ok(reply.options.length > 0);
  for (const option of reply.options) assert.match(option, /^Move all grab to /);
});

test("B14: on the saved entry in focus the chips are \"Make it …\"", () => {
  const reply = validateAskTurnAction(act("recategorise", { recategorise: { category: null } }), makeContext({ text: "change the category", focus: { kind: "saved_entry", entry: SAVED } }));
  assert.equal(reply.kind, "clarify");
  assert.ok(reply.options.length > 0);
  for (const option of reply.options) assert.match(option, /^Make it /);
});

test("nameAtEnd and namesMentioned read only clear names", () => {
  assert.equal(CATEGORIES[nameAtEnd("make all Grab rides Transport", CATEGORIES)], "Public Transport");
  assert.equal(nameAtEnd("make all grab rides", CATEGORIES), null);
  assert.equal(nameAtEnd("", CATEGORIES), null);
  assert.deepEqual(namesMentioned("how much did we spend on food this month?", CATEGORIES).map((index) => CATEGORIES[index]), ["Food & Drinks"]);
  assert.deepEqual(namesMentioned("how much did we spend this month?", CATEGORIES), []);
  // "Other" is never named by the word other.
  assert.deepEqual(namesMentioned("the other one", CATEGORIES), []);
});

// ---- B15 (rules) ------------------------------------------------------------

test("B15: with AI off, \"make that one Groceries\" on the one entry an answer showed is a change card request for it", () => {
  assert.equal(mayBeRulesTurn("make that one groceries", "entry_list"), true);
  const reading = readTurnRules(makeContext({ text: "make that one groceries", focus: { kind: "saved_entry", entry: SAVED } }));
  assert.equal(reading.action.action, "recategorise");
  assert.equal(reading.action.recategorise.category, "Groceries");
  const reply = validateAskTurnAction(reading.action, makeContext({ text: "make that one groceries", focus: { kind: "saved_entry", entry: SAVED } }));
  assert.equal(reply.kind, "change");
  assert.equal(reply.change.entries[0].entryId, "txn-koufu");
  assert.deepEqual(reply.change.rows, [{ field: "category", before: "Food & Drinks", after: "Groceries" }]);
});

test("B15: \"make these Taxi\" after a list answer moves the list's entries (rules), and a list with no words asks which", () => {
  const list = { kind: "entry_list", list: { month: "2026-11", search: "grab", categories: [] } };
  const reading = readTurnRules(makeContext({ text: "make these Taxi", focus: list }));
  const reply = validateAskTurnAction(reading.action, makeContext({ text: "make these Taxi", focus: list }));
  assert.deepEqual(reply, { kind: "resolve", request: { type: "recategorise_bulk", words: "grab", categoryName: "Taxi", fromCategoryName: null, month: "2026-11" } });
  // Negative: nothing the rules can read is left to the page.
  assert.equal(readTurnRules(makeContext({ text: "how about october", focus: list })), null);
});

// ---- B29 -------------------------------------------------------------------

test("B29: a change card's entry says it is an expense, so the card signs its amount", () => {
  const reply = validateAskTurnAction(act("recategorise", { recategorise: { category: "Groceries" } }), makeContext({ text: "make it groceries", focus: { kind: "saved_entry", entry: SAVED } }));
  assert.equal(reply.change.entries[0].entryType, "expense");
  assert.equal(reply.change.entries[0].amountMinor, 700);
});

// ---- B16 -----------------------------------------------------------------

test("B16: the model's tidied line names (not the person's words) fall back to the person's own words, this month's plan", () => {
  const context = makeContext({ text: "move 50 from shoping to food in this months plan" });
  const reply = validateAskTurnAction(act("plan_change", { plan: { month: "this month", ops: [{ kind: "move", from: "Shopping", to: "Food & Drinks", amount: "50" }] } }), context);
  assert.deepEqual(reply, { kind: "plan", request: { month: "2026-11", copyFrom: null, ops: [{ kind: "move", from: "shoping", to: "food", amountMinor: 5_000 }] } });
});

test("B16: the model's month as a word the plan reader cannot find in the text still stands, read by the server", () => {
  const context = makeContext({ text: "move $50 from Shopping to Groceries in this months plan" });
  const reply = validateAskTurnAction(act("plan_change", { plan: { month: "this month", ops: [{ kind: "move", from: "Shopping", to: "Groceries", amount: "50" }] } }), context);
  assert.equal(reply.kind, "plan");
  assert.equal(reply.request.month, "2026-11");
  assert.deepEqual(reply.request.ops, [{ kind: "move", from: "shopping", to: "groceries", amountMinor: 5_000 }]);
});

test("B16 negative: nothing a plan reader can read is still the plan question", () => {
  const reply = validateAskTurnAction(act("plan_change", { plan: { ops: [{ kind: "set", line: "Holidays", amount: "900" }] } }), makeContext({ text: "sort out the plan" }));
  assert.equal(reply.kind, "clarify");
  assert.equal(reply.question, "Which plan line, how much, and for which month?");
});

test("B16: the plan reader reads \"this months plan\" without its apostrophe", () => {
  assert.deepEqual(readPlanRequest("move 50 from shoping to food in this months plan", { today: TODAY }), {
    kind: "request",
    request: { month: "2026-11", copyFrom: null, ops: [{ kind: "move", from: "shoping", to: "food", amountMinor: 5_000 }] }
  });
});

// ---- B17 / B18 ---------------------------------------------------------------

test("B17: \"how much did we spend on food this month?\" is the Food & Drinks entries, not all spending", () => {
  const context = makeContext({ text: "how much did we spend on food this month?" });
  const reply = validateAskTurnAction(act("answer_question", { question: { topic: "spending_where", month: "this month" } }), context);
  assert.equal(reply.kind, "search");
  assert.deepEqual(reply.filter.categories, ["Food & Drinks"]);
  assert.equal(reply.filter.month, "2026-11");
  assert.equal(reply.filter.viewId, "person-ethan");
  assert.equal(reply.filter.search, "");
});

test("B17: the same question read as a trip with no trip named is still the food entries", () => {
  const reply = validateAskTurnAction(act("answer_question", { question: { topic: "trip", trip: null } }), makeContext({ text: "how much did I spend on food this month" }));
  assert.equal(reply.kind, "search");
  assert.deepEqual(reply.filter.categories, ["Food & Drinks"]);
});

test("B17 negative: a question naming no category is the money question it was", () => {
  const reply = validateAskTurnAction(act("answer_question", { question: { topic: "spending_where", month: "this month" } }), makeContext({ text: "where did my money go this month?" }));
  assert.equal(reply.kind, "question");
  assert.equal(reply.text, "Where did my money go in November 2026?");
});

test("B18: \"lunch 9.90\" read as a search is a new entry draft", () => {
  const context = makeContext({ text: "lunch 9.90", history: [{ role: "user", text: "how much did we spend on food this month?" }, { role: "app", text: "Showed the matching entries." }] });
  const reply = validateAskTurnAction(act("search_entries", { search: { categories: ["Food & Drinks"] } }), context);
  assert.equal(reply.kind, "entry_draft");
  assert.equal(reply.draft.fields.amountMinor.value, 990);
  assert.equal(reply.draft.fields.description.value, "lunch");
});

test("B18 negative: an amount filter, a question and a plain search stay searches", () => {
  for (const text of ["grab over 20", "what did I pay at koufu for 12?", "show taxi 15", "grab rides october 2026"]) {
    const reply = validateAskTurnAction(act("search_entries", { search: { words: text.split(" ")[0] } }), makeContext({ text }));
    assert.equal(reply.kind, "search", text);
  }
});

// ---- B19 -------------------------------------------------------------------

test("B19: a refusal gives the reason and page of what the person asked for, whatever the model named", () => {
  const account = validateAskTurnAction(act("cannot_help", { blocked: "delete_entry" }), makeContext({ text: "add a new account for my CPF" }));
  assert.deepEqual(account, { kind: "open_page", page: "settings", params: {}, why: "Accounts are added and changed in Settings, not from Ask." });
  const person = validateAskTurnAction(act("cannot_help", { blocked: "reconcile" }), makeContext({ text: "remove serene from the household" }));
  assert.deepEqual(person, { kind: "open_page", page: "settings", params: {}, why: "The people in the household are changed in Settings, not from Ask." });
  // The rules read the same message the same way.
  assert.deepEqual(readCommandIntent("remove serene from the household"), { kind: "blocked", blocked: "people" });
  assert.deepEqual(readCommandIntent("add my mum to the household"), { kind: "blocked", blocked: "people" });
});

test("B19 negative: the model's own reason stands when the words name nothing, and an entry is still an entry", () => {
  const reply = validateAskTurnAction(act("cannot_help", { blocked: "reconcile" }), makeContext({ text: "check citi against the bank" }));
  assert.equal(reply.kind, "open_page");
  assert.equal(reply.page, "settings");
  assert.match(reply.why, /statement/);
  assert.deepEqual(readCommandIntent("delete the koufu lunch"), { kind: "blocked", blocked: "delete_entry" });
  assert.equal(readCommandIntent("household supplies 12"), null);
});

// ---- B23 -------------------------------------------------------------------

test("B23: \"netflix 15.98 subscriptions\" files under Subscriptions MO and does not say the category was left out", () => {
  const reply = validateAskTurnAction(act("draft_entry", { entry: { type: "expense", description: "netflix", amount: "15.98", category: "subscriptions" } }), makeContext({ text: "netflix 15.98 subscriptions" }));
  assert.equal(reply.kind, "entry_draft");
  assert.equal(reply.draft.fields.categoryName.value, "Subscriptions MO");
  assert.ok(!(reply.assumptions ?? []).some((line) => /left the category out/.test(line.text)), JSON.stringify(reply.assumptions));
});

test("B23 negative: a category that fits nothing and no word that finds one still says it was left out", () => {
  const reply = validateAskTurnAction(act("draft_entry", { entry: { type: "expense", description: "zorblax", amount: "4", category: "wizardry" } }), makeContext({ text: "zorblax 4 wizardry" }));
  assert.ok((reply.assumptions ?? []).some((line) => line.text === "There's no category called \"wizardry\", so I left the category out."), JSON.stringify(reply.assumptions));
});

// ---- B32 -------------------------------------------------------------------

test("B32: everyday dishes and a ramen shop's name find Food & Drinks; a word that is no dish does not", () => {
  for (const words of ["chicken rice", "TONKOTSU KING", "nasi lemak", "laksa"]) {
    assert.equal(categoryFromEverydayWords(words, CATEGORIES), "Food & Drinks", words);
  }
  assert.equal(categoryFromEverydayWords("rice cooker", CATEGORIES), undefined);
});
