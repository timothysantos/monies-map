// GET /api/repeating-charges through the real Worker and a real local D1
// seeded with the demo household: Summary's "Subscriptions and bills" for
// each view and scope. The route only reads (the database is identical
// before and after). Dates are relative to the household's today.
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

const TIM = "person-tim";
const today = todayInAppTimeZone();
const thisMonth = today.slice(0, 7);
const focusMonth = addMonths(thisMonth, -1);
const monthAgo = (count) => addMonths(thisMonth, -count);

async function getCharges(fetch, query) {
  const response = await fetch(`/api/repeating-charges?${query}`);
  assert.equal(response.status, 200, await response.clone().text());
  assert.match(response.headers.get("server-timing") ?? "", /^app;dur=/);
  return response.json();
}

// Netflix on Joyce's card for a year; Singtel on Tim's card, up from $38.90
// to $42.90 last month; SP Group shared half and half from the joint
// account, changing each month; a grocer twice a month.
async function addCharges(api) {
  const ids = { netflix: [], singtel: [], sp: [] };
  for (let back = 12; back >= 1; back -= 1) {
    ids.netflix.push(await createEntry(api, {
      date: `${monthAgo(back)}-14`, description: "NETFLIX.COM 866-579-7172", accountName: "Citi Rewards",
      categoryName: "Subscriptions MO", amountMinor: 1998, ownerName: "Joyce"
    }));
  }
  for (let back = 5; back >= 1; back -= 1) {
    ids.singtel.push(await createEntry(api, {
      date: `${monthAgo(back)}-22`, description: "SINGTEL MOBILE 81234567", accountName: "UOB One",
      categoryName: "Bills", amountMinor: back === 1 ? 4290 : 3890, ownerName: "Tim"
    }));
  }
  for (const [back, amountMinor] of [[4, 11860], [3, 14286], [2, 9800], [1, 13110]]) {
    const { status, payload } = await api("/api/entries/create", {
      date: `${monthAgo(back)}-18`, description: "SP DIGITAL PTE LTD", accountName: "Household Float",
      categoryName: "Bills", entryType: "expense", amountMinor, ownershipType: "shared", ownerName: "Tim", splitBasisPoints: 5000
    });
    assert.equal(status, 200, JSON.stringify(payload));
    ids.sp.push(payload.entryId);
  }
  for (let back = 4; back >= 1; back -= 1) {
    for (const day of ["03", "17"]) {
      await createEntry(api, { date: `${monthAgo(back)}-${day}`, description: "NTUC FAIRPRICE TAMPINES", amountMinor: 8650 });
    }
  }
  return ids;
}

test("the route answers only GET", async (t) => {
  const { fetch } = await openSeededDatabase(t, template);
  const post = await fetch("/api/repeating-charges", { method: "POST", body: "{}" });
  assert.equal(post.status, 405);
  assert.equal(post.headers.get("allow"), "GET");
});

test("the household's repeating charges, with exact figures, and reading changes nothing", async (t) => {
  const { db, api, fetch } = await openSeededDatabase(t, template);
  const ids = await addCharges(api);
  await getCharges(fetch, "view=household");
  const before = await dumpDatabase(db);
  const household = await getCharges(fetch, "view=household");
  assertSameDatabase(await dumpDatabase(db), before);

  assert.equal(household.viewId, "household");
  assert.equal(household.focusMonth, focusMonth);
  assert.equal(household.yearStartMonth, addMonths(focusMonth, -11));
  assert.deepEqual(household.series.map((series) => series.key), ["SP DIGITAL PTE LTD|monthly", "NETFLIX COM|monthly", "SINGTEL MOBILE|monthly"]);
  const [sp, netflix, singtel] = household.series;
  assert.deepEqual(netflix, {
    key: "NETFLIX COM|monthly",
    name: "Netflix",
    period: "monthly",
    kind: "fixed",
    status: "active",
    category: "Subscriptions MO",
    account: "Citi Rewards • Joyce",
    usualDay: 14,
    nextDate: `${thisMonth}-14`,
    runLength: 12,
    latest: { date: `${focusMonth}-14`, amountMinor: 1998, ids: [ids.netflix[11]] },
    lowMinor: 1998,
    highMinor: 1998,
    focus: { amountMinor: 1998, ids: [ids.netflix[11]] },
    year: { amountMinor: 12 * 1998, ids: ids.netflix }
  });
  assert.equal(sp.kind, "varies");
  assert.equal(sp.account, "Household Float • Shared");
  assert.deepEqual(sp.year, { amountMinor: 11860 + 14286 + 9800 + 13110, ids: ids.sp });
  assert.deepEqual([sp.lowMinor, sp.highMinor], [9800, 14286]);
  assert.deepEqual(singtel.wentUp, { fromMinor: 3890, fromDate: `${monthAgo(2)}-22`, fromIds: [ids.singtel[3]], toMinor: 4290, date: `${focusMonth}-22`, toIds: [ids.singtel[4]] });
  assert.equal(singtel.year.amountMinor, 4 * 3890 + 4290);
  assert.deepEqual(household.mightRepeat, []);
  assert.deepEqual(household.takenOff, []);
  // The month before the focus month, for Subscriptions' change note: Netflix $19.98,
  // Singtel $38.90 and SP Group $98.00, all charged two months ago.
  assert.equal(household.focusBeforeMinor, 1998 + 3890 + 9800);
});

test("a person view counts their own charges at their share, in the scope", async (t) => {
  const { api, fetch } = await openSeededDatabase(t, template);
  const ids = await addCharges(api);
  const tim = await getCharges(fetch, `view=${TIM}&scope=direct_plus_shared`);
  assert.equal(tim.viewId, TIM);
  assert.deepEqual(tim.series.map((series) => series.key), ["SP DIGITAL PTE LTD|monthly", "SINGTEL MOBILE|monthly"]);
  const sp = tim.series[0];
  assert.deepEqual(sp.year, { amountMinor: 5930 + 7143 + 4900 + 6555, ids: ids.sp });
  // The month before, at Tim's own amounts: Singtel and his half of SP Group.
  assert.equal(tim.focusBeforeMinor, 3890 + 4900);
  const direct = await getCharges(fetch, `view=${TIM}&scope=direct`);
  assert.deepEqual(direct.series.map((series) => series.key), ["SINGTEL MOBILE|monthly"]);
  const shared = await getCharges(fetch, `view=${TIM}&scope=shared`);
  assert.deepEqual(shared.series.map((series) => series.key), ["SP DIGITAL PTE LTD|monthly"]);
  // An unknown view reads as the household, and the household has one scope.
  const unknown = await getCharges(fetch, "view=nobody&scope=direct");
  assert.equal(unknown.viewId, "household");
  assert.equal(unknown.scope, "direct_plus_shared");
  assert.equal(unknown.series.length, 3);
});

// The household's choices (owner decision D3): keep, take off, show again,
// rename and restore (Undo), through POST /api/repeating-charges/choice.
async function choose(api, body) {
  return api("/api/repeating-charges/choice", body);
}

test("keep, take off, show again, rename and Undo change the list for the whole household, with an audit event", async (t) => {
  const { db, api, fetch } = await openSeededDatabase(t, template);
  await addCharges(api);
  // Disney+ twice in a row: it might repeat, and is not counted.
  for (const back of [2, 1]) {
    await createEntry(api, { date: `${monthAgo(back)}-20`, description: "DISNEY PLUS", accountName: "Citi Rewards", categoryName: "Subscriptions MO", amountMinor: 1198, ownerName: "Joyce" });
  }
  const before = await getCharges(fetch, "view=household");
  assert.deepEqual(before.mightRepeat.map((series) => series.key), ["DISNEY PLUS|monthly"]);

  const kept = await choose(api, { seriesKey: "DISNEY PLUS|monthly", action: "keep" });
  assert.equal(kept.status, 200, JSON.stringify(kept.payload));
  assert.deepEqual(kept.payload, { ok: true, seriesKey: "DISNEY PLUS|monthly", previous: { choice: null, displayName: null }, current: { choice: "kept", displayName: null } });
  const afterKeep = await getCharges(fetch, `view=${TIM}`);
  // Joyce's charge: not in Tim's view, but the choice is the household's.
  assert.equal(afterKeep.series.some((series) => series.key === "DISNEY PLUS|monthly"), false);
  const household = await getCharges(fetch, "view=household");
  const disney = household.series.find((series) => series.key === "DISNEY PLUS|monthly");
  assert.equal(disney.kept, true);
  assert.deepEqual(household.mightRepeat, []);

  const renamed = await choose(api, { seriesKey: "DISNEY PLUS|monthly", action: "rename", displayName: "  Disney+  " });
  assert.deepEqual(renamed.payload.current, { choice: "kept", displayName: "Disney+" });
  const named = (await getCharges(fetch, "view=household")).series.find((series) => series.key === "DISNEY PLUS|monthly");
  assert.equal(named.name, "Disney+");
  assert.equal(named.payee, "Disney Plus");

  // Not a subscription or bill: off the list, never counted, and the price
  // change reminder for Singtel goes quiet.
  const reminderKeys = async () => (await (await fetch("/api/reminders?view=household")).json()).reminders.map((reminder) => reminder.kind);
  assert.ok((await reminderKeys()).includes("price_change"));
  const off = await choose(api, { seriesKey: "SINGTEL MOBILE|monthly", action: "take_off" });
  assert.deepEqual(off.payload.current, { choice: "not_repeating", displayName: null });
  const afterOff = await getCharges(fetch, "view=household");
  assert.equal(afterOff.series.some((series) => series.key === "SINGTEL MOBILE|monthly"), false);
  assert.deepEqual(afterOff.takenOff.map((series) => [series.key, series.status]), [["SINGTEL MOBILE|monthly", "taken_off"]]);
  assert.equal((await reminderKeys()).includes("price_change"), false);

  // Undo (restore the previous state), then show again.
  const undone = await choose(api, { seriesKey: "SINGTEL MOBILE|monthly", action: "restore", choice: off.payload.previous.choice, displayName: off.payload.previous.displayName });
  assert.deepEqual(undone.payload.current, { choice: null, displayName: null });
  assert.ok((await getCharges(fetch, "view=household")).series.some((series) => series.key === "SINGTEL MOBILE|monthly"));
  assert.ok((await reminderKeys()).includes("price_change"));
  const again = await choose(api, { seriesKey: "DISNEY PLUS|monthly", action: "show_again" });
  assert.deepEqual(again.payload.current, { choice: null, displayName: "Disney+" });

  const audit = await rows(db, "SELECT entity_id, action FROM audit_events WHERE action = 'repeating_charge_chosen' ORDER BY rowid");
  assert.deepEqual(audit.map((row) => row.entity_id), ["DISNEY PLUS|monthly", "DISNEY PLUS|monthly", "SINGTEL MOBILE|monthly", "SINGTEL MOBILE|monthly", "DISNEY PLUS|monthly"]);
});

test("a choice is refused for a bad key, an unknown action or a name over 40 characters, and changes nothing", async (t) => {
  const { db, api, fetch } = await openSeededDatabase(t, template);
  const before = await dumpDatabase(db);
  for (const body of [
    { seriesKey: "netflix|monthly", action: "keep" },
    { seriesKey: "NETFLIX COM|weekly", action: "keep" },
    { seriesKey: "NETFLIX COM", action: "keep" },
    { seriesKey: "NETFLIX COM|monthly", action: "delete" },
    { seriesKey: "NETFLIX COM|monthly", action: "rename", displayName: "N".repeat(41) },
    { seriesKey: "NETFLIX COM|monthly", action: "restore", choice: "maybe" }
  ]) {
    const { status, payload } = await choose(api, body);
    assert.equal(status, 400, JSON.stringify(body));
    assert.equal(payload.ok, false);
  }
  const get = await fetch("/api/repeating-charges/choice");
  assert.equal(get.status, 405);
  assertSameDatabase(await dumpDatabase(db), before);
});
