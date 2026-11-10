// Trips and events in Ask (docs/flows/ask-flow.md "Trips and events";
// src/domain/ask-trip-events.ts), through the real Worker on a local D1
// seeded with the demo household and a stubbed AI provider:
//
// - set_trip_event: the model names the trip as written and which entries as
//   said; the turn reads the household's rows and answers with a change card
//   (every entry before and after), writing nothing. Its Save is posted as the
//   page posts it, through POST /api/trip-events/entries/set with addedBy
//   "ask", and its Undo puts every entry back.
// - the validator's negatives: an unknown name asks back with the nearest
//   trips and "Make", two holidays ask which, an entry outside the household
//   is no focus, more than 200 is refused, an entry on another trip shows as
//   a before and after row, over ten needs the person's confirmed count.
// - the rules with AI off read the same messages into the same card.
// - "how much was the Seoul trip?": the reply names the trip; the page's
//   answer is the Entries trip view's Spent to the cent.
import assert from "node:assert/strict";
import test from "node:test";

import worker from "../src/index.ts";
import { todayInAppTimeZone } from "../src/lib/app-calendar.ts";
import { readTripEventRules } from "../src/domain/ask-trip-events.ts";
import { buildTripAnswer, tripAnswerPageParams } from "../src/client/ask-trip-answer.js";
import { buildEntriesFilterSearch, readEntriesFilterParams } from "../src/client/entry-filter-params.js";
import { getEntryDerivedData, getInvestmentAccountIds } from "../src/client/entry-filtering.js";
import { projectEntriesForView } from "../src/client/entry-row-projection.js";
import { buildTripEventLeadModel } from "../src/client/trip-event-lead-model.js";
import { figureCopy } from "../src/client/copy/figure-copy.js";
import { readAskTurnResponse, runChangeSteps } from "../src/client/ask-turn-api.js";
import { assertSameDatabase, createEntry, createSeededTemplate, dumpDatabase, openSeededDatabase, rows } from "./support/d1-workspace.mjs";

let template;
test.before(async () => {
  template = await createSeededTemplate();
});
test.after(async () => {
  await template?.dispose();
});

const TODAY = todayInAppTimeZone();
const THIS_MONTH = TODAY.slice(0, 7);
const TIM = "person-tim";
const day = (delta) => new Date(Date.parse(`${TODAY}T00:00:00Z`) + delta * 86_400_000).toISOString().slice(0, 10);

function stubAi(reply) {
  const calls = [];
  return {
    calls,
    async run(model, input) {
      calls.push({ model, input });
      return { choices: [{ message: { role: "assistant", content: JSON.stringify(reply) } }] };
    }
  };
}

async function post(db, body, { model = null, ai = true } = {}) {
  const stub = stubAi(model);
  const env = { DB: db, ...template.config.vars, AI: stub, AI_ASSIST_ENABLED: ai ? "true" : "false" };
  const response = await worker.fetch(new Request("http://127.0.0.1/api/ask/turn", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ viewId: TIM, scope: "direct_plus_shared", month: THIS_MONTH, page: "ask", ...body })
  }), env);
  assert.equal(response.status, 200);
  return { payload: await response.json(), calls: stub.calls };
}

async function turn(db, body, model) {
  const { payload, calls } = await post(db, body, { model });
  assert.equal(payload.mode, "ai", JSON.stringify(payload));
  return { reply: payload.reply, prompt: calls[0]?.input.messages.at(-1).content ?? "" };
}

const tripAction = (tripEvent) => ({ action: "set_trip_event", trip_event: { name: null, off: null, make: null, words: null, currency: null, when: null, from: null, to: null, ...tripEvent } });

// Posts a card's steps exactly as the page does (runChangeSteps), through the Worker.
function pageFetch(db) {
  return async (path, init) => worker.fetch(new Request(`http://127.0.0.1${path}`, { ...init, headers: { ...init.headers, origin: "http://127.0.0.1" } }), { DB: db, ...template.config.vars });
}

async function assertOnlyAllowanceChanged(db, before) {
  const after = await dumpDatabase(db);
  assertSameDatabase({ ...after, ai_assist_daily_usage: before.ai_assist_daily_usage }, before);
}

async function tripOf(db, entryId) {
  const [row] = await rows(db, "SELECT trip_events.name AS name, trip_event_entries.added_by AS addedBy FROM trip_event_entries JOIN trip_events ON trip_events.id = trip_event_entries.trip_event_id WHERE trip_event_entries.transaction_id = ?", entryId);
  return row ? { name: row.name, addedBy: row.addedBy } : null;
}

async function makeTrip(api, name, extra = {}) {
  const saved = await api("/api/trip-events/save", { name, ...extra });
  assert.equal(saved.status, 200, JSON.stringify(saved.payload));
  return saved.payload.tripEvent;
}

// Seoul trip (with dates around today), Bali holiday and Penang holiday, and
// three Seoul entries this month that Ask showed as a list ("seoul").
async function seed(api) {
  const seoul = await makeTrip(api, "Seoul trip", { startDate: day(-6), endDate: day(-2) });
  const bali = await makeTrip(api, "Bali holiday");
  const penang = await makeTrip(api, "Penang holiday");
  const hotel = await createEntry(api, { date: day(-6), description: "LOTTE HOTEL SEOUL", categoryName: "Travel", amountMinor: 119_820 });
  const market = await createEntry(api, { date: day(-5), description: "SEOUL GWANGJANG MARKET", categoryName: "Food & Drinks", amountMinor: 3_680 });
  const olive = await createEntry(api, { date: day(-4), description: "OLIVE YOUNG SEOUL", categoryName: "Shopping", amountMinor: 5_400 });
  return { seoul, bali, penang, hotel, market, olive };
}

const seoulList = { kind: "entry_list", list: { month: THIS_MONTH, search: "seoul", categories: [] } };

test("put these on Seoul trip: a card lists every entry before and after; Save goes through the trip command as Ask's; Undo puts them back", async (t) => {
  const { db, api } = await openSeededDatabase(t, template);
  const trips = await seed(api);
  // One of them is already on another trip: shown, never moved silently.
  await api("/api/trip-events/entries/set", { entryIds: [trips.olive], tripEventId: trips.bali.id });
  const before = await dumpDatabase(db);
  const { reply, prompt } = await turn(db, { text: "put these on Seoul trip", focus: seoulList }, tripAction({ name: "Seoul trip" }));
  await assertOnlyAllowanceChanged(db, before);
  // The prompt names the trips, never an amount.
  assert.match(prompt, /Trips and events: .*Seoul trip/);
  assert.doesNotMatch(prompt, /1198|119820|1,198/);

  assert.equal(reply.kind, "change", JSON.stringify(reply));
  const { change } = reply;
  assert.equal(change.type, "trip_event");
  assert.equal(change.title, "Seoul trip");
  assert.equal(change.count, 3);
  assert.equal(change.confirmCount, null);
  assert.deepEqual(change.rows, [
    { field: "trip", before: "", after: "Seoul trip" },
    { field: "trip", before: "Bali holiday", after: "Seoul trip" }
  ]);
  assert.deepEqual(change.entries.map((entry) => [entry.description, entry.trip]), [
    ["LOTTE HOTEL SEOUL", { before: "", after: "Seoul trip" }],
    ["SEOUL GWANGJANG MARKET", { before: "", after: "Seoul trip" }],
    ["OLIVE YOUNG SEOUL", { before: "Bali holiday", after: "Seoul trip" }]
  ]);
  assert.deepEqual(change.save, [{
    path: "/api/trip-events/entries/set",
    body: { changes: [trips.hotel, trips.market, trips.olive].map((entryId) => ({ entryId, tripEventId: trips.seoul.id })), addedBy: "ask" }
  }]);
  assert.deepEqual(change.undo, [{ path: "/api/trip-events/undo", body: {}, fromResult: { key: "undoId", as: "undoId" } }]);

  // The page keeps the card and saves it with its own code.
  const read = readAskTurnResponse({ ok: true, mode: "ai", action: "set_trip_event", reply });
  assert.equal(read.reply.kind, "change");
  const saved = await runChangeSteps(read.reply.change.save, { fetchImpl: pageFetch(db) });
  assert.equal(saved.ok, true, saved.error);
  for (const id of [trips.hotel, trips.market, trips.olive]) assert.deepEqual(await tripOf(db, id), { name: "Seoul trip", addedBy: "ask" });
  const undone = await runChangeSteps(read.reply.change.undo, { result: saved.result, fetchImpl: pageFetch(db) });
  assert.equal(undone.ok, true, undone.error);
  assert.equal(await tripOf(db, trips.hotel), null);
  assert.equal((await tripOf(db, trips.olive))?.name, "Bali holiday");
});

test("which entries as said: the hotel, the Olive Young one, paid in won, and the entry in focus; a typo still finds the trip", async (t) => {
  const { db, api } = await openSeededDatabase(t, template);
  const trips = await seed(api);
  await db.prepare("UPDATE transactions SET original_currency = 'KRW', original_amount_minor = 450000 WHERE id = ?").bind(trips.market).run();

  const hotel = await turn(db, { text: "add the hotel to the seol trip" }, tripAction({ name: "seol trip", words: "hotel" }));
  assert.equal(hotel.reply.change.title, "Seoul trip");
  assert.deepEqual(hotel.reply.change.entries.map((entry) => entry.entryId), [trips.hotel]);

  const olive = await turn(db, { text: "put the Olive Young one on Seoul trip" }, tripAction({ name: "Seoul trip", words: "Olive Young" }));
  assert.deepEqual(olive.reply.change.entries.map((entry) => entry.entryId), [trips.olive]);

  const won = await turn(db, { text: "move everything paid in won to Seoul trip" }, tripAction({ name: "Seoul trip", currency: "won" }));
  assert.deepEqual(won.reply.change.entries.map((entry) => entry.entryId), [trips.market]);

  const focus = await turn(db, { text: "put it on Seoul trip", focus: { kind: "saved_entry", entryId: trips.olive } }, tripAction({ name: "Seoul trip" }));
  assert.deepEqual(focus.reply.change.entries.map((entry) => entry.entryId), [trips.olive]);
  assert.equal(focus.reply.change.count, 1);
});

test("negatives: an unknown name, two holidays, no entries, an entry outside the household, already on it", async (t) => {
  const { db, api } = await openSeededDatabase(t, template);
  const trips = await seed(api);
  const before = await dumpDatabase(db);

  // A name that is none of the household's: the nearest trips, and making it.
  const unknown = await turn(db, { text: "put these on Jeju weekend", focus: seoulList }, tripAction({ name: "Jeju weekend" }));
  assert.equal(unknown.reply.kind, "clarify");
  assert.match(unknown.reply.question, /no trip or event called "Jeju weekend"/);
  assert.equal(unknown.reply.options.length, 4);
  assert.equal(unknown.reply.options.at(-1), "Make \"Jeju weekend\"");
  assert.ok(unknown.reply.options.slice(0, 3).every((option) => /^Put them on (Seoul trip|Bali holiday|Penang holiday)$/.test(option)), unknown.reply.options.join(" | "));
  assert.equal("error" in unknown.reply, false, "the page never sees why");

  // Two holidays would save differently: the person chooses.
  const holiday = await turn(db, { text: "put it on the holiday", focus: seoulList }, tripAction({ name: "the holiday" }));
  assert.equal(holiday.reply.kind, "clarify");
  assert.deepEqual(holiday.reply.options.sort(), ["Put them on Bali holiday", "Put them on Penang holiday"]);

  // No entries in focus and none said.
  const which = await turn(db, { text: "put it on Seoul trip" }, tripAction({ name: "Seoul trip" }));
  assert.equal(which.reply.kind, "clarify");
  assert.match(which.reply.question, /Which entries\?/);

  // An entry from outside the household is no focus at all.
  const outside = await turn(db, { text: "put it on Seoul trip", focus: { kind: "saved_entry", entryId: "txn-other-household" } }, tripAction({ name: "Seoul trip" }));
  assert.equal(outside.reply.kind, "clarify");

  // Words the person never wrote are not searched.
  const invented = await turn(db, { text: "put the hotel on Seoul trip" }, tripAction({ name: "Seoul trip", words: "Marriott" }));
  assert.equal(invented.reply.kind, "clarify");
  await assertOnlyAllowanceChanged(db, before);

  // Already on it: nothing to change.
  await api("/api/trip-events/entries/set", { entryIds: [trips.hotel], tripEventId: trips.seoul.id });
  const already = await turn(db, { text: "put it on Seoul trip", focus: { kind: "saved_entry", entryId: trips.hotel } }, tripAction({ name: "Seoul trip" }));
  assert.deepEqual(already.reply, { kind: "note", text: "It's already on Seoul trip." });
});

test("more than ten needs \"Yes, put all N\" (the command checks the count); more than 200 is refused", async (t) => {
  const { db, api } = await openSeededDatabase(t, template);
  const trips = await seed(api);
  for (let index = 0; index < 9; index += 1) {
    await createEntry(api, { date: day(-5), description: `SEOUL CAFE ${index}`, categoryName: "Food & Drinks", amountMinor: 500 + index });
  }
  const { reply } = await turn(db, { text: "put all of these on Seoul trip", focus: seoulList }, tripAction({ name: "Seoul trip" }));
  assert.equal(reply.change.count, 12);
  assert.equal(reply.change.confirmCount, 12);
  assert.equal(reply.change.entries.length, 8, "the first rows, and the count");
  // Saved without the person's count: refused, nothing written.
  const refused = await api("/api/trip-events/entries/set", reply.change.save[0].body);
  assert.equal(refused.status, 400);
  assert.match(refused.payload.error, /Confirm all 12/);
  assert.equal(await tripOf(db, trips.hotel), null);
  const saved = await runChangeSteps(reply.change.save, { confirmedCount: 12, fetchImpl: pageFetch(db) });
  assert.equal(saved.ok, true, saved.error);
  assert.equal(saved.result.changed, 12);

  // Over 200: refused before any card.
  const statements = [];
  for (let index = 0; index < 201; index += 1) {
    statements.push(db.prepare("INSERT INTO transactions (id, household_id, account_id, transaction_date, description, amount_minor, currency, entry_type) SELECT ?, household_id, account_id, ?, ?, 100, 'SGD', 'expense' FROM transactions WHERE id = ?").bind(`txn-bulk-${index}`, day(-3), `BUSAN STALL ${index}`, trips.hotel));
  }
  await db.batch(statements);
  const many = await turn(db, { text: "put the busan ones on Seoul trip" }, tripAction({ name: "Seoul trip", words: "busan" }));
  assert.deepEqual(many.reply, { kind: "note", text: "That's 201 entries, more than Ask puts on a trip at once (200). Choose them on Entries instead." });
});

test("making one: Make \"Jeju weekend\" with the list puts them on a new trip dated by the entries; with nothing in focus it makes the trip only; Undo takes either back", async (t) => {
  const { db, api } = await openSeededDatabase(t, template);
  const trips = await seed(api);
  const { reply } = await turn(db, { text: "Make \"Jeju weekend\"", focus: seoulList, history: [{ role: "user", text: "put these on Jeju weekend" }] }, tripAction({ name: "Jeju weekend", make: true }));
  assert.equal(reply.change.type, "trip_event");
  assert.deepEqual(reply.change.save[0].body.newTripEvent, { name: "Jeju weekend", startDate: day(-6), endDate: day(-4) });
  assert.ok(reply.change.save[0].body.changes.every((change) => change.tripEventId === "new"));
  const saved = await runChangeSteps(reply.change.save, { fetchImpl: pageFetch(db) });
  assert.equal(saved.ok, true, saved.error);
  assert.equal((await tripOf(db, trips.hotel))?.name, "Jeju weekend");
  await runChangeSteps(reply.change.undo, { result: saved.result, fetchImpl: pageFetch(db) });
  assert.equal(await tripOf(db, trips.hotel), null);
  assert.deepEqual(await rows(db, "SELECT name FROM trip_events WHERE name = 'Jeju weekend'"), []);

  const only = await turn(db, { text: "new trip Tokyo autumn 3 to 9 Nov" }, tripAction({ name: "Tokyo autumn", make: true, from: "3 Nov", to: "9 Nov" }));
  assert.equal(only.reply.change.type, "trip_event_create");
  assert.equal(only.reply.change.save[0].path, "/api/trip-events/save");
  const made = await runChangeSteps(only.reply.change.save, { fetchImpl: pageFetch(db) });
  assert.equal(made.ok, true, made.error);
  assert.equal((await rows(db, "SELECT name FROM trip_events WHERE name = 'Tokyo autumn'")).length, 1);
  const back = await runChangeSteps(only.reply.change.undo, { result: made.result, fetchImpl: pageFetch(db) });
  assert.equal(back.ok, true, back.error);
  assert.deepEqual(await rows(db, "SELECT name FROM trip_events WHERE name = 'Tokyo autumn'"), []);
});

test("take these off the trip: only entries on one, shown going to none", async (t) => {
  const { db, api } = await openSeededDatabase(t, template);
  const trips = await seed(api);
  await api("/api/trip-events/entries/set", { entryIds: [trips.hotel, trips.market], tripEventId: trips.seoul.id });
  const { reply } = await turn(db, { text: "take these off the trip", focus: seoulList }, tripAction({ off: true }));
  assert.equal(reply.change.count, 2);
  assert.deepEqual(reply.change.rows, [{ field: "trip", before: "Seoul trip", after: "" }]);
  assert.ok(reply.change.save[0].body.changes.every((change) => change.tripEventId === null));
  const saved = await runChangeSteps(reply.change.save, { fetchImpl: pageFetch(db) });
  assert.equal(saved.ok, true, saved.error);
  assert.equal(await tripOf(db, trips.hotel), null);
});

test("AI off: the rules read the same messages into the same card or question; other messages stay the page's", async (t) => {
  const { db, api } = await openSeededDatabase(t, template);
  const trips = await seed(api);
  const off = (body) => post(db, body, { ai: false }).then(({ payload }) => payload);

  const put = await off({ text: "put these on Seoul trip", focus: seoulList });
  assert.equal(put.mode, "rules");
  assert.equal(put.action, "set_trip_event");
  assert.equal(put.reply.kind, "change");
  assert.deepEqual(put.reply.change.entries.map((entry) => entry.entryId), [trips.hotel, trips.market, trips.olive]);
  const read = readAskTurnResponse(put);
  assert.equal(read.reply.kind, "change", "the page shows a rules card");

  const typo = await off({ text: "add the hotel to the seol trip" });
  assert.deepEqual(typo.reply.change.entries.map((entry) => entry.entryId), [trips.hotel]);

  const holiday = await off({ text: "put these on the holiday", focus: seoulList });
  assert.equal(holiday.reply.kind, "clarify");
  assert.equal(holiday.reply.options.length, 2);

  const make = await off({ text: "new trip Jeju weekend 3-5 May" });
  assert.equal(make.reply.change.type, "trip_event_create");
  assert.equal(make.reply.change.save[0].body.name, "Jeju weekend");

  const money = await off({ text: figureCopy.questions.trip("Seoul trip") });
  assert.deepEqual(money.reply, { kind: "trip_answer", tripEventId: trips.seoul.id, name: "Seoul trip", viewId: TIM, scope: "direct_plus_shared", month: THIS_MONTH });

  // Not a trip message: the page's own readers, with no reply.
  for (const text of ["make it Transport", "add coffee 5 to citi", "how much did I spend on groceries?", "lunch 12"]) {
    const answer = await off({ text });
    assert.equal(answer.mode, "rules");
    assert.equal(answer.reply, undefined, text);
  }
});

test("the rules reader: what it reads, and what it leaves alone", () => {
  const trips = [{ id: "t1", name: "Seoul trip" }, { id: "t2", name: "Bali holiday" }, { id: "t3", name: "Mum's 70th" }];
  const read = (text) => readTripEventRules(text, trips, { categoryNames: ["Groceries", "Travel"] });
  assert.deepEqual(read("put the Olive Young one on Seoul trip").trip_event, { name: "Seoul trip", words: "olive young", currency: null, when: null });
  assert.deepEqual(read("move everything paid in won to Seoul trip").trip_event, { name: "Seoul trip", words: null, currency: "won", when: null });
  assert.deepEqual(read("put last week's on Seoul trip").trip_event, { name: "Seoul trip", words: null, currency: null, when: "last week" });
  assert.deepEqual(read("take it off Seoul trip").trip_event, { name: "Seoul trip", off: true, words: null, currency: null, when: null });
  assert.deepEqual(read("new trip Jeju weekend 3-5 May").trip_event, { name: "Jeju weekend", make: true, from: "3 May", to: "5 May" });
  assert.deepEqual(read("How much did we spend on Mum's 70th?").question, { topic: "trip", trip: "Mum's 70th" });
  for (const text of ["make it Transport", "add lunch to citi", "add coffee 5 to Seoul trip", "how much was my grab trip", "how much did I spend on groceries?", "put it in Groceries"]) {
    assert.equal(read(text), null, text);
  }
});

// The trip view's Spent, as Entries shows it for the answer's own link.
async function tripViewSpent(api, filter, accounts) {
  const params = buildEntriesFilterSearch(filter);
  const page = (await api(`/api/entries-page?view=${params.get("view")}&month=${params.get("month")}&trip=${params.get("entry_trip")}`)).payload;
  const { selectedScope, entryFilters } = readEntriesFilterParams(params);
  const derived = getEntryDerivedData({ entries: page.monthPage.entries, entryFilters, selectedScope, viewId: page.viewId, pinnedEntryIds: [], investmentAccountIds: getInvestmentAccountIds(accounts) });
  const lead = buildTripEventLeadModel({
    tripEvent: page.tripView.tripEvent,
    aggregateEntries: projectEntriesForView(derived.filteredEntries, page.viewId).aggregateEntries,
    pageEntries: page.monthPage.entries,
    entryFilters,
    viewId: page.viewId
  });
  assert.equal(lead.spentMinor, derived.entryTotals.spendMinor);
  return lead.spentMinor;
}

test("how much was the Seoul trip: the answer is the Entries trip view's Spent to the cent, in each view and scope, and opens that view", async (t) => {
  const { db, api } = await openSeededDatabase(t, template);
  const trips = await seed(api);
  // A shared hotel on Splits half each, Joyce's own dinner, a refund, and a booking last month.
  await api("/api/splits/expenses/from-entry", { entryId: trips.hotel, splitGroupId: null, splitBasisPoints: 5000 });
  const dinner = await createEntry(api, { date: day(-5), description: "Joyce dinner Seoul", accountName: "Citi Rewards", ownerName: "Joyce", categoryName: "Food & Drinks", amountMinor: 4_210 });
  const refund = await createEntry(api, { date: day(-3), description: "Refund Olive Young", categoryName: "Shopping", entryType: "income", amountMinor: 900 });
  const flights = await createEntry(api, { date: day(-40), description: "SQ flights", categoryName: "Travel", amountMinor: 128_640 });
  await api("/api/trip-events/entries/set", { entryIds: [trips.hotel, trips.market, trips.olive, dinner, refund, flights], tripEventId: trips.seoul.id });
  const { accounts } = (await api("/api/reference-data")).payload;
  const people = [{ id: TIM, name: "Tim" }, { id: "person-joyce", name: "Joyce" }];

  const views = [
    { viewId: "household", scope: "direct_plus_shared" },
    { viewId: TIM, scope: "direct_plus_shared" },
    { viewId: TIM, scope: "direct" },
    { viewId: "person-joyce", scope: "direct_plus_shared" }
  ];
  const spent = [];
  for (const view of views) {
    const { reply } = await turn(db, { text: "How much did we spend on Seoul trip?", viewId: view.viewId, scope: view.scope }, { action: "answer_question", question: { topic: "trip", trip: "Seoul trip" } });
    assert.equal(reply.kind, "trip_answer", JSON.stringify(reply));
    const page = (await api(`/api/entries-page?${tripAnswerPageParams(reply).toString()}`)).payload;
    const built = buildTripAnswer({ reply, page, accounts, people });
    const link = built.answer.links[0];
    assert.equal(link.label, "Open in Entries");
    assert.equal(buildEntriesFilterSearch(link.filter).get("entry_trip"), trips.seoul.id);
    const shown = await tripViewSpent(api, link.filter, accounts);
    assert.equal(built.answer.lead.amountMinor, shown, `${view.viewId}/${view.scope}`);
    spent.push(built.answer.lead.amountMinor);
  }
  // Household: everything less the refund; Tim: his own and half the hotel; Joyce: her dinner and half the hotel.
  assert.deepEqual(spent, [
    119_820 + 3_680 + 5_400 + 4_210 - 900 + 128_640,
    59_910 + 3_680 + 5_400 - 900 + 128_640,
    3_680 + 5_400 - 900 + 128_640,
    59_910 + 4_210
  ]);

  // A name the household has none of: asked back with the nearest trips.
  const unknown = await turn(db, { text: "how much was the Tokyo trip?" }, { action: "answer_question", question: { topic: "trip", trip: "Tokyo trip" } });
  assert.equal(unknown.reply.kind, "clarify");
  assert.ok(unknown.reply.options.every((option) => /^How much was /.test(option)), unknown.reply.options.join(" | "));
});
