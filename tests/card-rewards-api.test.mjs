// Cards and rewards through the real Worker and a real local D1 seeded with
// the demo household (Tim: UOB One, a cashback card; Joyce: UOB Lady's and
// Citi Rewards, miles cards). The first read copies the presets in, once;
// every later read writes nothing; a missing table reads as the presets;
// saves, resets and Undo go through one command; "Suggest cards from" is
// the whole household by default (owner decision, 2026-11-10).
import assert from "node:assert/strict";
import test from "node:test";

import { todayInAppTimeZone } from "../src/lib/app-calendar.ts";
import { addMonths } from "../src/domain/money-signals/format.ts";
import {
  assertSameDatabase,
  createEntry,
  createSeededTemplate,
  dumpDatabase,
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

const today = todayInAppTimeZone();
const thisMonth = today.slice(0, 7);
const monthAgo = (count) => addMonths(thisMonth, -count);

async function get(fetch, path) {
  const response = await fetch(path);
  assert.equal(response.status, 200, await response.clone().text());
  assert.match(response.headers.get("server-timing") ?? "", /^app;dur=/);
  return response.json();
}

test("the first read copies each card's usual rules in once, with one audit event; later reads write nothing", async (t) => {
  const { fetch, db } = await openSeededDatabase(t, template);
  const settings = await get(fetch, "/api/card-rewards/rules");
  assert.equal(settings.suggestFrom, "household");
  const byName = Object.fromEntries(settings.cards.map((card) => [card.name, card]));
  assert.deepEqual(Object.keys(byName).sort(), ["Citi Rewards", "UOB Lady's", "UOB One"]);
  assert.deepEqual([byName["UOB Lady's"].rules.unit, byName["UOB Lady's"].rules.bonuses[0].rate, byName["UOB Lady's"].ownerName, byName["UOB Lady's"].isUsual], ["miles", 4, "Joyce", true]);
  assert.equal(byName["UOB One"].rules.unit, "cashback");
  assert.match(byName["Citi Rewards"].usual.source, /citibank\.com\.sg/);
  const stored = await rows(db, "SELECT account_id, preset_key FROM card_reward_rules ORDER BY account_id");
  assert.deepEqual(stored.map((row) => row.preset_key).sort(), ["citi-rewards", "uob-ladys", "uob-one"]);
  const seeded = await rows(db, "SELECT detail FROM audit_events WHERE action = 'card_reward_rules_seeded'");
  assert.equal(seeded.length, 1);
  const before = await dumpDatabase(db);
  await get(fetch, "/api/card-rewards/rules");
  await get(fetch, "/api/card-rewards?view=household");
  await get(fetch, "/api/card-rewards?view=person-tim");
  assertSameDatabase(await dumpDatabase(db), before);
});

test("a missing table reads as the usual rules and writes nothing; a change is refused plainly", async (t) => {
  const { fetch, api, db } = await openSeededDatabase(t, template);
  await db.prepare("DROP TABLE card_reward_rules").run();
  const before = await dumpDatabase(db);
  const settings = await get(fetch, "/api/card-rewards/rules");
  assert.equal(settings.cards.find((card) => card.name === "UOB Lady's").rules.bonuses[0].capMinor, 100_000);
  const card = await get(fetch, "/api/card-rewards?view=household");
  assert.ok(Array.isArray(card.people));
  assertSameDatabase(await dumpDatabase(db), before);
  const ladys = settings.cards.find((item) => item.name === "UOB Lady's");
  const { status, payload } = await api("/api/card-rewards/rules", { action: "reset", accountId: ladys.accountId });
  assert.equal(status, 400);
  assert.match(payload.error, /not ready yet/);
});

test("save, reset to the usual rules and Undo: each is one command with its audit event; bad rules and other accounts are refused", async (t) => {
  const { fetch, api, db } = await openSeededDatabase(t, template);
  const settings = await get(fetch, "/api/card-rewards/rules");
  const ladys = settings.cards.find((card) => card.name === "UOB Lady's");
  const edited = { ...ladys.rules, bonuses: [{ ...ladys.rules.bonuses[0], categories: ["Shopping"], capMinor: 150_000 }] };
  const saved = await api("/api/card-rewards/rules", { action: "save", accountId: ladys.accountId, rules: edited });
  assert.equal(saved.status, 200, JSON.stringify(saved.payload));
  assert.deepEqual(saved.payload.previous.bonuses[0].categories, ["Food & Drinks"]);
  assert.deepEqual([saved.payload.current.bonuses[0].categories, saved.payload.current.bonuses[0].capMinor, saved.payload.current.presetKey], [["Shopping"], 150_000, "uob-ladys"]);
  const after = (await get(fetch, "/api/card-rewards/rules")).cards.find((card) => card.name === "UOB Lady's");
  assert.equal(after.isUsual, false);

  // Undo puts the rules back.
  const undone = await api("/api/card-rewards/rules", { action: "restore", accountId: ladys.accountId, rules: saved.payload.previous });
  assert.equal(undone.status, 200);
  assert.equal((await get(fetch, "/api/card-rewards/rules")).cards.find((card) => card.name === "UOB Lady's").isUsual, true);

  // Reset after another change.
  await api("/api/card-rewards/rules", { action: "save", accountId: ladys.accountId, rules: { ...ladys.rules, baseRate: 1 } });
  const reset = await api("/api/card-rewards/rules", { action: "reset", accountId: ladys.accountId });
  assert.equal(reset.payload.current.baseRate, 0.4);
  const events = await rows(db, "SELECT detail FROM audit_events WHERE action = 'card_reward_rules_changed' ORDER BY rowid");
  assert.equal(events.length, 4);
  assert.match(events[0].detail, /UOB Lady's changed/);
  assert.match(events[3].detail, /reset to the usual rules/);

  // Refusals: nothing written.
  const before = await dumpDatabase(db);
  const refusals = [
    [{ action: "save", accountId: ladys.accountId, rules: { ...ladys.rules, unit: "points" } }, /miles or cashback/],
    [{ action: "save", accountId: ladys.accountId, rules: { ...ladys.rules, baseRate: 99 } }, /between 0 and 30/],
    [{ action: "save", accountId: "acct-uob-savings", rules: ladys.rules }, /card was not found/],
    [{ action: "delete", accountId: ladys.accountId }, /not a change/]
  ];
  for (const [body, reason] of refusals) {
    const { status, payload } = await api("/api/card-rewards/rules", body);
    assert.equal(status, 400, JSON.stringify(body));
    assert.match(payload.error, reason);
  }
  assertSameDatabase(await dumpDatabase(db), before);
});

// Tim's dining, all on his UOB One (cashback); Joyce holds the miles cards.
async function addTimDining(api) {
  const ids = [];
  for (const back of [3, 2, 1]) {
    for (const day of ["05", "12", "19"]) {
      ids.push(await createEntry(api, { date: `${monthAgo(back)}-${day}`, description: "SONG FA BAK KUT TEH", accountName: "UOB One", categoryName: "Food & Drinks", amountMinor: 4_800, ownerName: "Tim" }));
    }
  }
  return ids;
}

test("the whole household (the default): Tim's dining can be suggested on Joyce's Lady's Card, in the household and in Tim's own view", async (t) => {
  const { fetch, api } = await openSeededDatabase(t, template);
  await addTimDining(api);
  const settings = await get(fetch, "/api/card-rewards/rules");
  const ladys = settings.cards.find((card) => card.name === "UOB Lady's").accountId;

  const household = await get(fetch, "/api/card-rewards?view=household");
  assert.equal(household.suggestFrom, "household");
  assert.equal(household.people.length, 1);
  assert.equal(household.people[0].personId, "household");
  assert.deepEqual(household.people[0].cards.map((card) => card.ownerName).sort(), ["Joyce", "Joyce", "Tim"]);
  const best = household.people[0].best.find((item) => item.categoryName === "Food & Drinks" && item.unit === "miles");
  assert.equal(best.accountId, ladys);

  // Tim's view: his spending, any household card.
  const tim = await get(fetch, "/api/card-rewards?view=person-tim");
  assert.deepEqual(tim.people.map((person) => person.personId), ["person-tim"]);
  assert.deepEqual(tim.people[0].cards.map((card) => card.name), ["UOB One"]);
  assert.equal(tim.people[0].best.find((item) => item.categoryName === "Food & Drinks" && item.unit === "miles")?.accountId, ladys);
});

test("each person's own cards: Tim is never offered Joyce's card; the setting saves with its audit event and reads back", async (t) => {
  const { fetch, api, db } = await openSeededDatabase(t, template);
  await addTimDining(api);
  const refused = await api("/api/card-rewards/suggest-from", { from: "everyone" });
  assert.equal(refused.status, 400);
  const saved = await api("/api/card-rewards/suggest-from", { from: "own" });
  assert.deepEqual([saved.status, saved.payload.previous, saved.payload.current], [200, "household", "own"]);
  assert.equal((await rows(db, "SELECT COUNT(*) AS count FROM audit_events WHERE action = 'card_rewards_suggest_from_updated'"))[0].count, 1);

  const settings = await get(fetch, "/api/card-rewards/rules");
  assert.equal(settings.suggestFrom, "own");
  const joyceCards = new Set(settings.cards.filter((card) => card.ownerName === "Joyce").map((card) => card.accountId));
  for (const path of ["/api/card-rewards?view=household", "/api/card-rewards?view=person-tim"]) {
    const answer = await get(fetch, path);
    const tim = answer.people.find((person) => person.personId === "person-tim");
    assert.ok(tim, path);
    const named = [
      ...tim.best.map((item) => item.accountId),
      ...tim.notices.flatMap((notice) => [notice.accountId, notice.alternative?.accountId].filter(Boolean)),
      ...tim.lookingBack.flatMap((item) => item.changes.map((change) => change.toAccountId))
    ];
    assert.ok(named.length > 0, path);
    assert.ok(named.every((id) => !joyceCards.has(id)), `${path}: ${named.join(", ")}`);
    // Only cashback for Tim: he holds no miles card.
    assert.ok(tim.best.every((item) => item.unit === "cashback"));
  }
  // The household view lists each person apart.
  const household = await get(fetch, "/api/card-rewards?view=household");
  assert.deepEqual(household.people.map((person) => person.personId).sort(), ["person-joyce", "person-tim"]);
});
