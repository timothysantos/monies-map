// A trip page's "Needs a look" list (DOMAIN.md "Trip page", "needs a look";
// trip-page.ts `tripNeedsLook`): only real doubts, each with one reason.
// Every reason has its positive case and a negative proving an ordinary,
// fine entry is not listed; a trip of 30 ordinary statement-certified
// entries lists nothing, on the real Worker and a local D1.
import assert from "node:assert/strict";
import test from "node:test";

import { createEntry, createSeededTemplate, openSeededDatabase } from "./support/d1-workspace.mjs";
import { tripNeedsLook } from "../src/domain/trip-page.ts";
import { readTripPage } from "../src/client/trip-page-api.js";
import { needsLookTarget } from "../src/client/trip-page-model.js";
import { ESTIMATE_LOOK_AFTER_DAYS, NEEDS_LOOK_MAX_ITEMS, NO_AMOUNT_LOOK_AFTER_SECONDS } from "../src/domain/trip-needs-look-config.ts";

const NOW = new Date("2026-11-22T04:00:00.000Z");
const TODAY = "2026-11-22";
const minutesAgo = (minutes) => new Date(NOW.getTime() - minutes * 60_000).toISOString();

// An ordinary, fine trip entry: an expense in a real category, from Tim's
// own card, confirmed by the bank, not on Splits.
const fine = (patch = {}) => ({
  id: "e-fine",
  date: "2026-11-10",
  description: "KAKAO T",
  name: "Taxi to the hotel",
  amountMinor: 1_780,
  categoryName: "Public Transport",
  certified: true,
  estimate: false,
  ownerId: "person-tim",
  jointAccount: false,
  onSplits: false,
  splitGroupId: null,
  ...patch
});

const look = (input) => tripNeedsLook({ entries: [], taps: [], tripSplitGroupId: null, today: TODAY, now: NOW, ...input });
const reasons = (items) => items.map((item) => [item.reason, item.id]);

test("ordinary entries list nothing", () => {
  // The same taxi firm twice on one day for different fares is two rides.
  assert.deepEqual(look({ entries: [fine(), fine({ id: "e-2", certified: false, amountMinor: 2_150 }), fine({ id: "e-3", date: "2026-11-11", amountMinor: 900 })] }), []);
});

test("1. a payment with no amount yet, once the second-tap window has passed", () => {
  const tap = { id: "tap-1", date: "2026-11-21", merchant: "Periplus Bali", personName: "Tim" };
  const items = look({ taps: [{ ...tap, receivedAt: minutesAgo(60) }] });
  assert.deepEqual(items, [{ reason: "no_amount", id: "tap-1", date: "2026-11-21", name: "Periplus Bali", personName: "Tim" }]);
  // Negative: a tap still inside the window (a second run may finish it).
  const fresh = new Date(NOW.getTime() - (NO_AMOUNT_LOOK_AFTER_SECONDS - 60) * 1000).toISOString();
  assert.deepEqual(look({ taps: [{ ...tap, receivedAt: fresh }] }), []);
  // Negative: a tap past the 7 days it is kept (it is being put away).
  assert.deepEqual(look({ taps: [{ ...tap, receivedAt: minutesAgo(8 * 24 * 60) }] }), []);
});

test("2. a foreign estimate older than the threshold with no statement for it", () => {
  const old = fine({ id: "e-old", certified: false, estimate: true, date: "2026-10-01" });
  assert.deepEqual(look({ entries: [old] }), [{ reason: "old_estimate", id: "e-old", date: "2026-10-01", name: "Taxi to the hotel", days: 52 }]);
  // Negative: a recent estimate, and an old one the statement confirmed.
  const recentDay = new Date(Date.parse(`${TODAY}T00:00:00Z`) - ESTIMATE_LOOK_AFTER_DAYS * 86_400_000).toISOString().slice(0, 10);
  assert.deepEqual(look({ entries: [fine({ id: "e-recent", certified: false, estimate: true, date: recentDay })] }), []);
  assert.deepEqual(look({ entries: [fine({ id: "e-confirmed", estimate: false, date: "2026-10-01" })] }), []);
});

test("3. Shared but not on Splits, and on Splits without the trip's group", () => {
  // No owner, from a card that is not a joint account, not on Splits.
  const shared = fine({ id: "e-shared", ownerId: null });
  assert.deepEqual(reasons(look({ entries: [shared] })), [["shared_not_on_splits", "e-shared"]]);
  // Negatives: a joint account's purchase (shared money, nobody owes), and a
  // Shared entry already on Splits.
  assert.deepEqual(look({ entries: [fine({ id: "e-joint", ownerId: null, jointAccount: true })] }), []);
  assert.deepEqual(look({ entries: [fine({ id: "e-split", ownerId: null, onSplits: true, splitGroupId: "group-bali" })] }), []);

  const noGroup = fine({ id: "e-nogroup", onSplits: true, splitGroupId: null });
  assert.deepEqual(reasons(look({ entries: [noGroup], tripSplitGroupId: "group-bali" })), [["splits_no_group", "e-nogroup"]]);
  // Negatives: the trip has no group; the entry is in a group.
  assert.deepEqual(look({ entries: [noGroup] }), []);
  assert.deepEqual(look({ entries: [fine({ id: "e-grouped", onSplits: true, splitGroupId: "group-bali" })], tripSplitGroupId: "group-bali" }), []);
});

test("4. an expense left in Other", () => {
  assert.deepEqual(reasons(look({ entries: [fine({ id: "e-other", categoryName: "Other" })] })), [["other_category", "e-other"]]);
  // Negative: any real category, and Other Income is not Other.
  assert.deepEqual(look({ entries: [fine({ categoryName: "Food & Drinks" }), fine({ id: "e-2", categoryName: "Other Income" })] }), []);
});

test("5. two entries that look like the same purchase", () => {
  const apple = fine({ id: "e-apple", description: "Cold Storage-Star Vist", name: "Cold Storage", certified: false, amountMinor: 4_210 });
  const bank = fine({ id: "e-bank", description: "COLD STORAGE-STAR VISTA", name: "COLD STORAGE-STAR VISTA", amountMinor: 4_210 });
  assert.deepEqual(look({ entries: [apple, bank] }), [
    { reason: "maybe_copy", id: "e-apple", date: "2026-11-10", name: "Cold Storage", otherId: "e-bank", otherName: "COLD STORAGE-STAR VISTA" }
  ]);
  // Negatives: another day, another amount, another shop, and two
  // purchases the bank confirmed both of (two real coffees).
  assert.deepEqual(look({ entries: [apple, { ...bank, date: "2026-11-11" }] }), []);
  assert.deepEqual(look({ entries: [apple, { ...bank, amountMinor: 4_200 }] }), []);
  assert.deepEqual(look({ entries: [apple, { ...bank, description: "GRAB* RIDE" }] }), []);
  assert.deepEqual(look({ entries: [{ ...apple, certified: true }, bank] }), []);
});

test("one line an entry, missing amounts first, at most the cap", () => {
  // Shared, in Other and an old estimate at once: one line, the first reason.
  const many = fine({ id: "e-many", ownerId: null, categoryName: "Other", certified: false, estimate: true, date: "2026-09-01" });
  const other = fine({ id: "e-other", categoryName: "Other", date: "2026-11-01" });
  const tap = { id: "tap-1", date: "2026-11-21", merchant: "Periplus", personName: "Joyce", receivedAt: minutesAgo(90) };
  assert.deepEqual(reasons(look({ entries: [other, many], taps: [tap] })), [["no_amount", "tap-1"], ["shared_not_on_splits", "e-many"], ["other_category", "e-other"]]);
  const lots = Array.from({ length: NEEDS_LOOK_MAX_ITEMS + 5 }, (_, index) => fine({ id: `e-${index}`, categoryName: "Other", amountMinor: 100 + index }));
  assert.equal(look({ entries: lots }).length, NEEDS_LOOK_MAX_ITEMS);
});

// The real read: a trip of 30 ordinary statement-certified entries lists
// nothing (and sends no list), then one of each doubt is listed once.
test("the trip page sends no list for 30 ordinary certified entries, and each real doubt once", async (t) => {
  const { api, db } = await openSeededDatabase(t, template);
  const ids = [];
  const shops = ["FAMILYMART", "OLIVE YOUNG", "KAKAO T", "PARIS BAGUETTE", "LOTTE MART", "STARBUCKS"];
  for (let index = 0; index < 30; index += 1) {
    const day = String(3 + (index % 7)).padStart(2, "0");
    ids.push(await createEntry(api, { date: `2026-04-${day}`, description: `${shops[index % shops.length]} ${index}`, categoryName: index % 2 ? "Food & Drinks" : "Shopping", amountMinor: 1_000 + index * 37 }));
  }
  await db.prepare(`UPDATE transactions SET bank_certification_status = 'statement_certified' WHERE id IN (${ids.map(() => "?").join(",")})`).bind(...ids).run();
  const saved = await api("/api/trip-events/save", { name: "Seoul trip", startDate: "2026-04-03", endDate: "2026-04-09", currency: "KRW" });
  assert.equal(saved.status, 200, JSON.stringify(saved.payload));
  const tripId = saved.payload.tripEvent.id;
  assert.equal((await api("/api/trip-events/entries/set", { entryIds: ids, tripEventId: tripId })).status, 200);
  const quiet = (await api(`/api/trip-page?trip=${tripId}`)).payload.tripPage;
  assert.equal(quiet.entryCount, 30);
  assert.equal(quiet.needsLook, undefined);

  // Now the doubts: a second copy of the first purchase (Apple Pay, not on
  // a statement), an expense in Other, and an old estimate.
  const first = (await db.prepare("SELECT transaction_date, description, amount_minor FROM transactions WHERE id = ?").bind(ids[0]).first());
  const copy = await createEntry(api, { date: first.transaction_date, description: first.description, categoryName: "Shopping", amountMinor: first.amount_minor });
  const other = await createEntry(api, { date: "2026-04-06", description: "MYSTERY SHOP", categoryName: "Other", amountMinor: 2_222 });
  const estimate = await createEntry(api, { date: "2026-04-07", description: "GWANGJANG", categoryName: "Food & Drinks", amountMinor: 3_300 });
  await db.prepare("UPDATE transactions SET original_amount_minor = 3000000, original_currency = 'KRW' WHERE id = ?").bind(estimate).run();
  assert.equal((await api("/api/trip-events/entries/set", { entryIds: [copy, other, estimate], tripEventId: tripId })).status, 200);
  const listed = (await api(`/api/trip-page?trip=${tripId}`)).payload.tripPage.needsLook;
  assert.deepEqual(listed.map((item) => item.reason).sort(), ["maybe_copy", "old_estimate", "other_category"]);
  const pair = listed.find((item) => item.reason === "maybe_copy");
  assert.deepEqual([pair.id, pair.otherId].sort(), [copy, ids[0]].sort());
  assert.equal(listed.find((item) => item.reason === "other_category").id, other);
  assert.equal(listed.find((item) => item.reason === "old_estimate").id, estimate);
});

// The page reads the list as sent, drops what it has no words for, and each
// line's one action goes to the place that already fixes it.
test("the page reads the lines and sends each action where it is fixed", () => {
  const body = {
    ok: true,
    tripPage: {
      tripEvent: { id: "trip-1", name: "Seoul trip" }, spentMinor: 100, days: [],
      firmness: { parts: [{ part: "confirmed", amountMinor: 60, entryIds: ["a"] }, { part: "waiting", amountMinor: 40 }, { part: "guess", amountMinor: 1 }], noAmountCount: 2 },
      needsLook: [
        { reason: "no_amount", id: "tap-1", date: "2026-11-21", name: "Periplus", personName: "Tim" },
        { reason: "maybe_copy", id: "e-1", date: "2026-11-10", name: "Cold Storage", otherId: "e-2", otherName: "COLD STORAGE" },
        { reason: "maybe_copy", id: "e-3", date: "2026-11-10", name: "No other" },
        { reason: "made_up", id: "e-4", date: "2026-11-10", name: "Never shown" },
        { reason: "other_category", id: "e-5", date: "2026-11-10", name: "Lawson" }
      ]
    }
  };
  const page = readTripPage(body);
  assert.deepEqual(page.firmness, { parts: [{ part: "confirmed", amountMinor: 60, entryIds: ["a"] }, { part: "waiting", amountMinor: 40 }], noAmountCount: 2 });
  assert.deepEqual(page.needsLook.map((item) => item.id), ["tap-1", "e-1", "e-5"]);
  // An older answer without the fields reads as nothing to show.
  const old = readTripPage({ ok: true, tripPage: { tripEvent: { id: "trip-1", name: "Seoul trip" }, spentMinor: 0 } });
  assert.deepEqual([old.firmness, old.needsLook], [{ parts: [], noAmountCount: 0 }, []]);

  const search = "?view=person-tim&month=2026-11&scope=direct";
  const target = (item) => {
    const { pathname, search: query } = needsLookTarget(item, { tripId: "trip-1", search });
    return [pathname, Object.fromEntries([...new URLSearchParams(query)].map(([key]) => [key, new URLSearchParams(query).getAll(key).join(",")]))];
  };
  assert.deepEqual(target(page.needsLook[0]), ["/entries", { view: "household", month: "2026-11", waiting_tap: "tap-1" }]);
  assert.deepEqual(target(page.needsLook[1]), ["/entries", { view: "household", month: "2026-11", scope: "direct_plus_shared", entries_scope: "direct_plus_shared", entry_trip: "trip-1", entry_id: "e-1,e-2" }]);
  assert.deepEqual(target(page.needsLook[2]), ["/entries", { view: "household", month: "2026-11", scope: "direct_plus_shared", entries_scope: "direct_plus_shared", entry_trip: "trip-1", editing_entry: "e-5" }]);
});

let template;
test.before(async () => {
  template = await createSeededTemplate();
});
test.after(async () => {
  await template?.dispose();
});
