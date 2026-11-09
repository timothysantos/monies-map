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
  openSeededDatabase
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
});

test("a person view counts their own charges at their share, in the scope", async (t) => {
  const { api, fetch } = await openSeededDatabase(t, template);
  const ids = await addCharges(api);
  const tim = await getCharges(fetch, `view=${TIM}&scope=direct_plus_shared`);
  assert.equal(tim.viewId, TIM);
  assert.deepEqual(tim.series.map((series) => series.key), ["SP DIGITAL PTE LTD|monthly", "SINGTEL MOBILE|monthly"]);
  const sp = tim.series[0];
  assert.deepEqual(sp.year, { amountMinor: 5930 + 7143 + 4900 + 6555, ids: ids.sp });
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
