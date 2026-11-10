// Two small ways onto a trip (DOMAIN.md "Trip or Event"), through the real
// Worker on a local D1:
//
// - The dashed "Seoul trip?" chip (design 2f, owner decision 4 = A): the
//   Entries page names a suggested trip only on an Apple Pay or Shortcut
//   entry on no trip, dated in a trip that is on today and has a currency,
//   when the entry was paid in that currency or its wallet's last 3 other
//   entries are on the trip. Nothing joins the trip until the tap.
// - Following a linked split group (owner decision 3 = A): adding an entry
//   to a split group a trip is linked to puts the entry on that trip too,
//   with its own Undo, unless it is on a trip already. If the trip part
//   can't run, the split is still saved.
import assert from "node:assert/strict";
import test from "node:test";

import { createEntry, createSeededTemplate, openSeededDatabase, rows } from "./support/d1-workspace.mjs";
import { enableShortcut, postWalletPurchase, saveRate } from "./support/foreign-wallet.mjs";
import { todayInAppTimeZone } from "../src/lib/app-calendar.ts";
import { suggestTripEventsForNewEntries } from "../src/domain/trip-event-suggestions.ts";

let template;
test.before(async () => {
  template = await createSeededTemplate();
});
test.after(async () => {
  await template?.dispose();
});

async function ok(api, path, body) {
  const response = await api(path, body);
  assert.equal(response.status, 200, `${path}: ${JSON.stringify(response.payload)}`);
  return response.payload;
}

function shiftDay(iso, days) {
  const date = new Date(`${iso}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

const linkOf = async (db, entryId) => (await rows(db, "SELECT trip_event_id FROM trip_event_entries WHERE transaction_id = ?", entryId))[0]?.trip_event_id ?? null;

// The Entries page rows from 10 days ago to today (two months when the
// window crosses one).
async function pageRows(api) {
  const today = todayInAppTimeZone();
  const from = shiftDay(today, -10).slice(0, 7);
  const month = today.slice(0, 7);
  const page = await ok(api, `/api/entries-page?view=household&month=${month}${from < month ? `&from=${from}` : ""}`);
  return { page, byId: new Map(page.monthPage.entries.map((entry) => [entry.id, entry])) };
}

test("the chip rule: paid in the trip's currency, or the wallet's last 3 others on the trip; only in an active trip with a currency", () => {
  const today = "2026-10-07";
  const seoul = { id: "seoul", name: "Seoul trip", iconKey: "plane", startDate: "2026-10-03", endDate: "2026-10-09", currency: "KRW" };
  const history = new Map([
    ["amaze", [{ id: "new-dollar", tripEventId: null }, { id: "a", tripEventId: "seoul" }, { id: "b", tripEventId: "seoul" }, { id: "c", tripEventId: "seoul" }]],
    ["uob", [{ id: "x", tripEventId: "seoul" }, { id: "y", tripEventId: "seoul" }, { id: "z", tripEventId: null }]]
  ]);
  const candidates = [
    { id: "won", date: "2026-10-07", accountId: "uob", originalCurrency: "KRW" },
    { id: "new-dollar", date: "2026-10-07", accountId: "amaze", originalCurrency: null },
    { id: "dollar-no-history", date: "2026-10-07", accountId: "uob", originalCurrency: null },
    { id: "yen", date: "2026-10-06", accountId: "uob", originalCurrency: "JPY" },
    { id: "before", date: "2026-10-01", accountId: "uob", originalCurrency: "KRW" },
    { id: "tomorrow", date: "2026-10-08", accountId: "uob", originalCurrency: "KRW" }
  ];
  const suggest = (trips, day = today) => Object.fromEntries(suggestTripEventsForNewEntries({ today: day, trips, candidates, walletHistory: history }));
  assert.deepEqual(suggest([seoul]), { won: "seoul", "new-dollar": "seoul" });
  // No currency (or the home currency): nothing.
  assert.deepEqual(suggest([{ ...seoul, currency: "" }]), {});
  assert.deepEqual(suggest([{ ...seoul, currency: "SGD" }]), {});
  // Today after the trip: nothing, even for entries in its dates.
  assert.deepEqual(suggest([seoul], "2026-10-10"), {});
});

test("the Entries page offers the dashed chip only on the Shortcut's entries that fit, and the tap puts it on as a suggestion", async (t) => {
  const { api, db, fetch: fetchWorker } = await openSeededDatabase(t, template);
  const today = todayInAppTimeZone();
  const [citi] = await rows(db, "SELECT id FROM accounts WHERE account_name = 'Citi Rewards'");
  await enableShortcut(db, { foreignCurrencyAccountId: citi.id });
  await saveRate(db, { quote: "KRW", quotePerBase: 1032 });
  const seoul = (await ok(api, "/api/trip-events/save", { name: "Seoul trip", startDate: shiftDay(today, -3), endDate: shiftDay(today, 3), currency: "KRW" })).tripEvent;
  let request = 0;
  const applePay = async (body) => {
    request += 1;
    const { status, payload } = await postWalletPurchase(fetchWorker, { requestId: `chip-request-${request}`, ...body });
    assert.equal(status, 200, JSON.stringify(payload));
    return payload.entryId;
  };

  const won = await applePay({ amount: "KRW 10,000", description: "Paris Baguette Hongdae", date: today });
  const wonBefore = await applePay({ amount: "KRW 22,000", description: "AREX before the trip", date: shiftDay(today, -6) });
  const dollarNoHistory = await applePay({ amount: "SGD 8.60", description: "Changi kopi", accountName: "Citi Rewards", date: today });
  const handMade = await createEntry(api, { date: today, description: "Gwangjang Market (hand-made)", accountName: "Citi Rewards", categoryName: "Food & Drinks", amountMinor: 3_680 });
  const alreadyOn = await applePay({ amount: "KRW 38,000", description: "Olive Young", date: today });
  await ok(api, "/api/trip-events/entries/set", { entryIds: [alreadyOn], tripEventId: seoul.id });
  // UOB One's last 3 entries are on the trip; a dollar Apple Pay entry on it follows.
  const uobDays = [shiftDay(today, -2), shiftDay(today, -1), shiftDay(today, -1)];
  const uobOnTrip = [];
  for (const [index, date] of uobDays.entries()) {
    uobOnTrip.push(await createEntry(api, { date, description: `Seoul by UOB ${index + 1}`, amountMinor: 1_000 + index }));
  }
  await ok(api, "/api/trip-events/entries/set", { entryIds: uobOnTrip, tripEventId: seoul.id });
  const dollarWalletOnTrip = await applePay({ amount: "SGD 12.40", description: "Kakao T", accountName: "UOB One", date: today });

  const { page, byId } = await pageRows(api);
  const suggested = (id) => byId.get(id)?.suggestedTripEventId ?? null;
  assert.equal(suggested(won), seoul.id);
  assert.equal(suggested(dollarWalletOnTrip), seoul.id);
  assert.equal(suggested(wonBefore), null, "dated before the trip");
  assert.equal(suggested(dollarNoHistory), null, "a dollar entry whose wallet's entries are not on the trip");
  assert.equal(suggested(handMade), null, "a hand-made entry");
  assert.equal(suggested(alreadyOn), null, "already on a trip");
  assert.equal(byId.get(alreadyOn).tripEventId, seoul.id);
  assert.deepEqual(page.tripEvents[seoul.id], { name: "Seoul trip", iconKey: "plane" });
  // Only the two rows carry the field.
  assert.deepEqual(page.monthPage.entries.filter((entry) => "suggestedTripEventId" in entry).map((entry) => entry.id).sort(), [won, dollarWalletOnTrip].sort());
  // Nothing joined the trip by itself.
  assert.equal(await linkOf(db, won), null);

  // The tap: one entry, as a suggestion, with Undo.
  const tapped = await ok(api, "/api/trip-events/entries/set", { entryIds: [won], tripEventId: seoul.id, addedBy: "suggestion" });
  assert.deepEqual(await rows(db, "SELECT trip_event_id, added_by FROM trip_event_entries WHERE transaction_id = ?", won), [{ trip_event_id: seoul.id, added_by: "suggestion" }]);
  const after = await pageRows(api);
  assert.equal(after.byId.get(won).tripEventId, seoul.id);
  assert.equal("suggestedTripEventId" in after.byId.get(won), false);
  await ok(api, "/api/trip-events/undo", { undoId: tapped.undoId });
  assert.equal(await linkOf(db, won), null);
});

test("no chip when the trip has no currency, is put away, or is not on today", async (t) => {
  const { api, db, fetch: fetchWorker } = await openSeededDatabase(t, template);
  const today = todayInAppTimeZone();
  const [citi] = await rows(db, "SELECT id FROM accounts WHERE account_name = 'Citi Rewards'");
  await enableShortcut(db, { foreignCurrencyAccountId: citi.id });
  await saveRate(db, { quote: "KRW", quotePerBase: 1032 });
  const { payload } = await postWalletPurchase(fetchWorker, { requestId: "chip-none-1", amount: "KRW 10,000", description: "Paris Baguette", date: today });
  const won = payload.entryId;
  const trip = (await ok(api, "/api/trip-events/save", { name: "Seoul trip", startDate: shiftDay(today, -3), endDate: shiftDay(today, 3) })).tripEvent;
  assert.equal((await pageRows(api)).byId.get(won).suggestedTripEventId, undefined, "no currency");
  await ok(api, "/api/trip-events/save", { tripEventId: trip.id, name: "Seoul trip", startDate: shiftDay(today, -3), endDate: shiftDay(today, 3), currency: "KRW" });
  assert.equal((await pageRows(api)).byId.get(won).suggestedTripEventId, trip.id, "with the currency");
  await ok(api, "/api/trip-events/put-away", { tripEventId: trip.id, putAway: true });
  assert.equal((await pageRows(api)).byId.get(won).suggestedTripEventId, undefined, "put away");
  await ok(api, "/api/trip-events/put-away", { tripEventId: trip.id, putAway: false });
  await ok(api, "/api/trip-events/save", { tripEventId: trip.id, name: "Seoul trip", startDate: shiftDay(today, -3), endDate: shiftDay(today, -1), currency: "KRW" });
  assert.equal((await pageRows(api)).byId.get(won).suggestedTripEventId, undefined, "over before today");
  // Without the tables, the page still loads and has no chips.
  await db.prepare("DROP TABLE trip_event_entries").run();
  await db.prepare("DROP TABLE trip_events").run();
  const { page, byId } = await pageRows(api);
  assert.ok(byId.has(won));
  assert.equal("tripEvents" in page, false);
});

test("adding an entry to a linked split group puts it on the trip too, with its own Undo; nothing else moves", async (t) => {
  const { api, db } = await openSeededDatabase(t, template);
  const { groupId: seoulGroup } = await ok(api, "/api/splits/groups/create", { name: "Seoul trip", currency: "SGD" });
  const { groupId: homeGroup } = await ok(api, "/api/splits/groups/create", { name: "Home", currency: "SGD" });
  const seoul = (await ok(api, "/api/trip-events/save", { name: "Seoul trip", startDate: "2026-10-03", endDate: "2026-10-09", currency: "KRW", splitGroupId: seoulGroup })).tripEvent;
  const mum = (await ok(api, "/api/trip-events/save", { name: "Mum's 70th" })).tripEvent;
  const hotel = await createEntry(api, { date: "2026-10-03", description: "Lotte Hotel Seoul", categoryName: "Travel", amountMinor: 119_820 });
  const fibre = await createEntry(api, { date: "2026-10-04", description: "MyRepublic fibre", categoryName: "Bills", amountMinor: 4_599 });
  const cake = await createEntry(api, { date: "2026-10-05", description: "Birthday cake", categoryName: "Groceries", amountMinor: 6_500 });
  await ok(api, "/api/trip-events/entries/set", { entryIds: [cake], tripEventId: mum.id });

  // Linked group: the entry goes on the trip, and the answer says so.
  const linked = await ok(api, "/api/splits/expenses/from-entry", { entryId: hotel, splitGroupId: seoulGroup, splitBasisPoints: 5000 });
  assert.ok(linked.splitExpenseId);
  assert.deepEqual({ ...linked.tripEventFollow, undoId: typeof linked.tripEventFollow.undoId }, {
    undoId: "string",
    tripEvent: { id: seoul.id, name: "Seoul trip", iconKey: "plane" },
    changes: [{ entryId: hotel, from: null, to: seoul.id }]
  });
  assert.deepEqual(await rows(db, "SELECT trip_event_id, added_by FROM trip_event_entries WHERE transaction_id = ?", hotel), [{ trip_event_id: seoul.id, added_by: "person" }]);

  // Unlinked group: no trip.
  const unlinked = await ok(api, "/api/splits/expenses/from-entry", { entryId: fibre, splitGroupId: homeGroup });
  assert.equal("tripEventFollow" in unlinked, false);
  assert.equal(await linkOf(db, fibre), null);

  // Already on another trip: it stays there.
  const other = await ok(api, "/api/splits/expenses/from-entry", { entryId: cake, splitGroupId: seoulGroup });
  assert.ok(other.splitExpenseId);
  assert.equal("tripEventFollow" in other, false);
  assert.equal(await linkOf(db, cake), mum.id);

  // Undo takes the trip off and leaves the split.
  await ok(api, "/api/trip-events/undo", { undoId: linked.tripEventFollow.undoId });
  assert.equal(await linkOf(db, hotel), null);
  assert.deepEqual(await rows(db, "SELECT COUNT(*) AS n FROM split_expenses WHERE linked_transaction_id = ? AND deleted_at IS NULL", hotel), [{ n: 1 }]);
});

test("a put-away trip is not followed, and without the tables the split is still saved", async (t) => {
  const { api, db } = await openSeededDatabase(t, template);
  const { groupId } = await ok(api, "/api/splits/groups/create", { name: "Bali trip", currency: "SGD" });
  const bali = (await ok(api, "/api/trip-events/save", { name: "Bali trip", splitGroupId: groupId })).tripEvent;
  await ok(api, "/api/trip-events/put-away", { tripEventId: bali.id, putAway: true });
  const villa = await createEntry(api, { date: "2026-06-12", description: "Ubud villa", categoryName: "Travel", amountMinor: 52_480 });
  const putAway = await ok(api, "/api/splits/expenses/from-entry", { entryId: villa, splitGroupId: groupId });
  assert.equal("tripEventFollow" in putAway, false);
  assert.equal(await linkOf(db, villa), null);

  await db.prepare("DROP TABLE trip_event_entries").run();
  await db.prepare("DROP TABLE trip_events").run();
  const warung = await createEntry(api, { date: "2026-06-13", description: "Warung Made", categoryName: "Food & Drinks", amountMinor: 3_860 });
  const saved = await ok(api, "/api/splits/expenses/from-entry", { entryId: warung, splitGroupId: groupId });
  assert.ok(saved.splitExpenseId);
  assert.equal("tripEventFollow" in saved, false);
  assert.deepEqual(await rows(db, "SELECT COUNT(*) AS n FROM split_expenses WHERE linked_transaction_id = ?", warung), [{ n: 1 }]);
});
