// The trip page (DOMAIN.md "Trip or Event", "Trip page"; GET /api/trip-page):
// one trip's Spent, its days, categories, who paid, the biggest entries and
// what is still owed on Splits, read on the real Worker and a local D1. The
// figures' equality with Entries is proved in tests/openable-figures.test.mjs.
import assert from "node:assert/strict";
import test from "node:test";

import { createEntry, createSeededTemplate, openSeededDatabase } from "./support/d1-workspace.mjs";
import { tripPageFigures } from "../src/domain/money-figures.ts";
import { isOpenForeignEstimate, noteFirstLine, tripEntryName, tripStillOwed } from "../src/domain/trip-page.ts";

const TIM = "person-tim";
const JOYCE = "person-joyce";

let template;
test.before(async () => {
  template = await createSeededTemplate();
});
test.after(async () => {
  await template?.dispose();
});

async function get(api, path) {
  const response = await api(path);
  assert.equal(response.status, 200, JSON.stringify(response.payload).slice(0, 300));
  return response.payload;
}

// Seoul trip, 3 to 9 April 2026: flights booked in March (with a two-line
// note), a hotel on Splits half each, Joyce's dinner, a taxi still an
// estimate in won, a shop, a coffee, a refund, and a transfer that counts
// nothing. A grocery run the same week is not on the trip.
async function seedSeoul(api, db) {
  const ids = {
    flights: await createEntry(api, { date: "2026-03-14", description: "SINGAPORE AIRLINES", note: "Flights to Seoul for two\nBooked in the March sale", categoryName: "Travel", amountMinor: 128_640 }),
    hotel: await createEntry(api, { date: "2026-04-03", description: "LOTTE HOTEL SEOUL", categoryName: "Travel", amountMinor: 119_820 }),
    dinner: await createEntry(api, { date: "2026-04-04", description: "GWANGJANG MARKET", categoryName: "Food & Drinks", accountName: "Citi Rewards", ownerName: "Joyce", amountMinor: 3_680 }),
    taxi: await createEntry(api, { date: "2026-04-05", description: "KAKAO T", note: "\n  Taxi to Myeongdong  \r\nlate", categoryName: "Public Transport", amountMinor: 1_780 }),
    shop: await createEntry(api, { date: "2026-04-05", description: "OLIVE YOUNG", categoryName: "Shopping", amountMinor: 2_500 }),
    refund: await createEntry(api, { date: "2026-04-06", description: "GWANGJANG REFUND", categoryName: "Food & Drinks", entryType: "income", amountMinor: 500 }),
    transfer: await createEntry(api, { date: "2026-04-07", description: "To Joyce", categoryName: "Transfer", entryType: "transfer", transferDirection: "out", amountMinor: 50_000 }),
    coffee: await createEntry(api, { date: "2026-04-08", description: "FRITZ COFFEE", categoryName: "Food & Drinks", amountMinor: 600 })
  };
  await createEntry(api, { date: "2026-04-05", description: "Home groceries", categoryName: "Groceries", amountMinor: 4_321 });
  // The taxi was paid in won through Apple Pay: still an estimate.
  await db.prepare("UPDATE transactions SET original_amount_minor = 2300000, original_currency = 'KRW' WHERE id = ?").bind(ids.taxi).run();
  const split = await api("/api/splits/expenses/from-entry", { entryId: ids.hotel, splitGroupId: null, splitBasisPoints: 5000 });
  assert.equal(split.status, 200, JSON.stringify(split.payload));
  const saved = await api("/api/trip-events/save", { name: "Seoul trip", startDate: "2026-04-03", endDate: "2026-04-09", currency: "KRW" });
  assert.equal(saved.status, 200, JSON.stringify(saved.payload));
  const tripEvent = saved.payload.tripEvent;
  const set = await api("/api/trip-events/entries/set", { entryIds: Object.values(ids), tripEventId: tripEvent.id });
  assert.equal(set.status, 200, JSON.stringify(set.payload));
  return { tripEvent, ids };
}

test("the trip page: Spent, days, categories, who paid, the biggest five and what is still owed", async (t) => {
  const { api, db } = await openSeededDatabase(t, template);
  const { tripEvent, ids } = await seedSeoul(api, db);
  const { tripPage: page } = await get(api, `/api/trip-page?trip=${tripEvent.id}`);

  assert.deepEqual(page.tripEvent, { id: tripEvent.id, name: "Seoul trip", iconKey: "plane", startDate: "2026-04-03", endDate: "2026-04-09", currency: "KRW" });
  assert.equal(page.firstDate, "2026-03-14");
  assert.equal(page.lastDate, "2026-04-08");
  // Eight entries on it; the transfer counts nothing.
  assert.equal(page.entryCount, 8);
  assert.equal(page.spentMinor, 128_640 + 119_820 + 3_680 + 1_780 + 2_500 + 600 - 500);
  assert.equal(page.estimateCount, 1);
  assert.deepEqual(page.days.map(({ day, amountMinor, entryIds }) => [day, amountMinor, [...entryIds].sort()]), [
    ["2026-03-14", 128_640, [ids.flights]],
    ["2026-04-03", 119_820, [ids.hotel]],
    ["2026-04-04", 3_680, [ids.dinner]],
    ["2026-04-05", 4_280, [ids.taxi, ids.shop].sort()],
    ["2026-04-06", -500, [ids.refund]],
    ["2026-04-08", 600, [ids.coffee]]
  ]);
  assert.deepEqual(page.categories.map(({ categoryName, amountMinor, entryCount }) => [categoryName, amountMinor, entryCount]), [
    ["Travel", 248_460, 2],
    ["Food & Drinks", 3_780, 3],
    ["Shopping", 2_500, 1],
    ["Public Transport", 1_780, 1]
  ]);
  assert.ok(page.categories.every((row) => typeof row.categoryId === "string"), "each category carries its id for its colour");
  assert.deepEqual(page.payers.map(({ personId, name, amountMinor, entryIds }) => [personId, name, amountMinor, entryIds.length]), [
    [TIM, "Tim", 128_640 + 119_820 + 1_780 + 2_500 + 600 - 500, 6],
    [JOYCE, "Joyce", 3_680, 1]
  ]);
  // Every slice adds up to Spent.
  for (const list of [page.days, page.categories, page.payers]) {
    assert.equal(list.reduce((sum, row) => sum + row.amountMinor, 0), page.spentMinor);
  }
  // The five biggest expenses, the note's first line as the name, the taxi
  // still an estimate in won; the coffee is sixth.
  assert.deepEqual(page.biggest.map((entry) => [entry.name, entry.amountMinor, entry.payerName, entry.categoryName]), [
    ["Flights to Seoul for two", 128_640, "Tim", "Travel"],
    ["LOTTE HOTEL SEOUL", 119_820, "Tim", "Travel"],
    ["GWANGJANG MARKET", 3_680, "Joyce", "Food & Drinks"],
    ["OLIVE YOUNG", 2_500, "Tim", "Shopping"],
    ["Taxi to Myeongdong", 1_780, "Tim", "Public Transport"]
  ]);
  assert.deepEqual(page.biggest[4].estimate, { amountMinor: 2_300_000, currency: "KRW" });
  assert.equal(page.biggest.filter((entry) => entry.estimate).length, 1);
  // The hotel is on Splits half each, paid by Tim: Joyce owes Tim half.
  assert.equal(page.owed.onSplitsCount, 1);
  assert.deepEqual(page.owed.debts, [{ fromPersonId: JOYCE, fromName: "Joyce", toPersonId: TIM, toName: "Tim", amountMinor: 59_910 }]);
  assert.equal(typeof page.owed.splitGroupId, "string");

  // A day the page opens: its entries in order, the payback as money in.
  const { tripDay } = await get(api, `/api/trip-page?trip=${tripEvent.id}&day=2026-04-05`);
  assert.deepEqual(tripDay.entries.map((entry) => [entry.name, entry.amountMinor, entry.entryType, Boolean(entry.estimate)]).sort(), [
    ["OLIVE YOUNG", 2_500, "expense", false],
    ["Taxi to Myeongdong", 1_780, "expense", true]
  ]);
  const refundDay = await get(api, `/api/trip-page?trip=${tripEvent.id}&day=2026-04-06`);
  assert.deepEqual(refundDay.tripDay.entries.map((entry) => [entry.name, entry.amountMinor, entry.entryType]), [["GWANGJANG REFUND", 500, "income"]]);
  // The transfer's day lists nothing: a transfer is not spending.
  const transferDay = await get(api, `/api/trip-page?trip=${tripEvent.id}&day=2026-04-07`);
  assert.deepEqual(transferDay.tripDay.entries, []);

  // Once the hotel's split is settled (its batch closed) nobody owes
  // anything, and the card still knows the trip is on Splits.
  const batch = await db.prepare("SELECT split_batch_id FROM split_expenses WHERE linked_transaction_id = ?").bind(ids.hotel).first();
  if (batch?.split_batch_id) {
    await db.prepare("UPDATE split_batches SET closed_on = '2026-04-20' WHERE id = ?").bind(batch.split_batch_id).run();
  } else {
    await db.prepare("INSERT INTO split_batches (id, household_id, split_group_id, batch_name, opened_on, closed_on) SELECT 'batch-test-closed', household_id, split_group_id, 'Seoul', '2026-04-01', '2026-04-20' FROM split_expenses WHERE linked_transaction_id = ?").bind(ids.hotel).run();
    await db.prepare("UPDATE split_expenses SET split_batch_id = 'batch-test-closed' WHERE linked_transaction_id = ?").bind(ids.hotel).run();
  }
  const settled = await get(api, `/api/trip-page?trip=${tripEvent.id}`);
  assert.equal(settled.tripPage.owed.onSplitsCount, 1);
  assert.deepEqual(settled.tripPage.owed.debts, []);
});

test("the trip page refuses what is not this household's trip, and an empty trip reads as nothing spent", async (t) => {
  const { api, db } = await openSeededDatabase(t, template);
  // An unknown trip, a missing id and a bad day are gone, not guessed.
  assert.equal((await get(api, "/api/trip-page?trip=trip-nowhere")).tripPage, null);
  assert.equal((await get(api, "/api/trip-page")).tripPage, null);
  const { tripEvent, ids } = await seedSeoul(api, db);
  assert.equal((await get(api, `/api/trip-page?trip=${tripEvent.id}&day=2026-02-30`)).tripDay, null);
  assert.equal((await get(api, `/api/trip-page?trip=${tripEvent.id}&day=yesterday`)).tripDay, null);
  // Another household's trip, even one linked to this household's entries,
  // is never read: nothing of it shows.
  await db.prepare("INSERT INTO households (id, name) SELECT 'household-other', 'Other' WHERE NOT EXISTS (SELECT 1 FROM households WHERE id = 'household-other')").run().catch(() => {});
  await db.prepare("INSERT INTO trip_events (id, household_id, name, icon_key) VALUES ('trip-other', 'household-other', 'Their trip', 'plane')").run();
  const loose = await createEntry(api, { date: "2026-04-05", description: "Not ours to show", categoryName: "Shopping", amountMinor: 9_900 });
  await db.prepare("INSERT INTO trip_event_entries (transaction_id, trip_event_id, household_id) VALUES (?, 'trip-other', 'household-other')").bind(loose).run();
  assert.equal((await get(api, "/api/trip-page?trip=trip-other")).tripPage, null);
  assert.deepEqual((await get(api, "/api/trip-page?trip=trip-other&day=2026-04-05")).tripDay.entries, []);
  // Ours is unchanged by it.
  assert.equal((await get(api, `/api/trip-page?trip=${tripEvent.id}`)).tripPage.spentMinor, 256_520);
  assert.ok(!(await get(api, `/api/trip-page?trip=${tripEvent.id}`)).tripPage.days.some((day) => day.entryIds.includes(loose)));
  // An empty trip: nothing spent, no days, no Splits card.
  const empty = await api("/api/trip-events/save", { name: "Mum's 70th" });
  assert.equal(empty.status, 200);
  const { tripPage } = await get(api, `/api/trip-page?trip=${empty.payload.tripEvent.id}`);
  assert.equal(tripPage.tripEvent.name, "Mum's 70th");
  assert.equal(tripPage.tripEvent.iconKey, "cake");
  assert.equal(tripPage.entryCount, 0);
  assert.equal(tripPage.spentMinor, 0);
  assert.deepEqual([tripPage.days, tripPage.categories, tripPage.payers, tripPage.biggest], [[], [], [], []]);
  assert.equal(tripPage.firstDate, undefined);
  assert.equal(tripPage.owed, undefined);
  assert.ok(ids.hotel);
  // Only GET.
  const posted = await api("/api/trip-page?trip=x", {});
  assert.equal(posted.status, 405);
});

test("tripPageFigures reads SQL groups by the Entries Spent rule", () => {
  const figures = tripPageFigures([
    { day: "2026-04-03", categoryName: "Travel", entryType: "expense", payerId: TIM, amountMinor: 10_000, entryIds: ["a", "b"] },
    { day: "2026-04-03", categoryName: "Travel", entryType: "income", payerId: TIM, amountMinor: 1_500, entryIds: ["c"] },
    // Money in that is not a payback (Salary, Other) and transfers count nothing.
    { day: "2026-04-04", categoryName: "Salary", entryType: "income", payerId: TIM, amountMinor: 500_000, entryIds: ["d"] },
    { day: "2026-04-04", categoryName: "Other", entryType: "income", payerId: TIM, amountMinor: 700, entryIds: ["e"] },
    { day: "2026-04-04", categoryName: "Transfer", entryType: "transfer", payerId: TIM, amountMinor: 9_000, entryIds: ["f"] },
    { day: "2026-04-05", categoryName: "Shopping", entryType: "expense", payerId: null, amountMinor: 2_000, entryIds: ["g"] },
    { day: "2026-04-05", categoryName: "Food & Drinks", entryType: "income", payerId: JOYCE, amountMinor: 300, entryIds: ["h"] }
  ]);
  assert.equal(figures.spentMinor, 10_000 - 1_500 + 2_000 - 300);
  assert.deepEqual(figures.byDay, [
    { day: "2026-04-03", amountMinor: 8_500, entryIds: ["a", "b", "c"] },
    { day: "2026-04-05", amountMinor: 1_700, entryIds: ["g", "h"] }
  ]);
  assert.deepEqual(figures.byCategory, [
    { categoryName: "Travel", amountMinor: 8_500, entryCount: 3 },
    { categoryName: "Shopping", amountMinor: 2_000, entryCount: 1 },
    { categoryName: "Food & Drinks", amountMinor: -300, entryCount: 1 }
  ]);
  assert.deepEqual(figures.byPayer, [
    { payerId: TIM, amountMinor: 8_500, entryIds: ["a", "b", "c"] },
    { payerId: null, amountMinor: 2_000, entryIds: ["g"] },
    { payerId: JOYCE, amountMinor: -300, entryIds: ["h"] }
  ]);
  assert.deepEqual(tripPageFigures([]), { spentMinor: 0, byDay: [], byCategory: [], byPayer: [] });
});

test("a readable name, an open estimate and what is still owed between two people", () => {
  assert.equal(noteFirstLine("Dinner at Gwangjang\nwith Mina"), "Dinner at Gwangjang");
  assert.equal(noteFirstLine("\r\n   \r\n  Hotel deposit  \r\nsecond"), "Hotel deposit");
  assert.equal(noteFirstLine(""), "");
  assert.equal(noteFirstLine(null), "");
  assert.equal(noteFirstLine("x".repeat(120)).length, 80);
  assert.ok(noteFirstLine("x".repeat(120)).endsWith("…"));
  assert.equal(tripEntryName({ description: " GRAB*TRIP ", note: "  " }), "GRAB*TRIP");
  assert.equal(tripEntryName({ description: "GRAB*TRIP", note: "Taxi to the airport\nreceipt lost" }), "Taxi to the airport");

  const open = { original_amount_minor: 2_300_000, original_currency: "KRW", currency: "SGD", bank_certification_status: "provisional" };
  assert.equal(isOpenForeignEstimate(open), true);
  assert.equal(isOpenForeignEstimate({ ...open, bank_certification_status: "statement_certified" }), false, "a statement confirmed it");
  assert.equal(isOpenForeignEstimate({ ...open, original_currency: "SGD" }), false, "paid in the account's own money");
  assert.equal(isOpenForeignEstimate({ ...open, original_amount_minor: null }), false);

  const share = (payerId, personId, amountMinor, settled = false) => ({
    transactionId: `${payerId}-${personId}-${amountMinor}`, payerId, payerName: payerId === TIM ? "Tim" : "Joyce",
    personId, personName: personId === TIM ? "Tim" : "Joyce", amountMinor, settled
  });
  // Tim paid a hotel (Joyce's half 600) and Joyce a dinner (Tim's half 200):
  // they cancel to Joyce owes Tim 400. The payer's own share and a settled
  // split owe nothing.
  assert.deepEqual(tripStillOwed([
    share(TIM, TIM, 600), share(TIM, JOYCE, 600),
    share(JOYCE, JOYCE, 200), share(JOYCE, TIM, 200),
    share(TIM, JOYCE, 9_999, true)
  ]), [{ fromPersonId: JOYCE, fromName: "Joyce", toPersonId: TIM, toName: "Tim", amountMinor: 400 }]);
  assert.deepEqual(tripStillOwed([share(JOYCE, TIM, 1_250)]), [{ fromPersonId: TIM, fromName: "Tim", toPersonId: JOYCE, toName: "Joyce", amountMinor: 1_250 }]);
  // Even halves cancel out to nothing owed.
  assert.deepEqual(tripStillOwed([share(TIM, JOYCE, 500), share(JOYCE, TIM, 500)]), []);
  assert.deepEqual(tripStillOwed([]), []);
});
