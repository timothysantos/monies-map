// Trip and event suggestions (DOMAIN.md "Trip or Event", "Suggestions";
// design 2d) through the real Worker on a local D1, from a near-real week in
// Seoul (tests/fixtures/trip-events/seoul-trip.json): a won card activity
// export, Apple Pay estimates the Shortcut saved in won, standing orders at
// home, and a Seoul trip split group with cash and linked expenses.
//
// The review list groups the trip's likely entries (paid in won, ticked; on
// its split group, ticked; the rest of its days in dollars, not ticked) with
// home bills never ticked; "Booked before you went?" searches before the
// first day; the read is bounded and works without the tables (off).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { createEntry, createSeededTemplate, openSeededDatabase, rows } from "./support/d1-workspace.mjs";
import { enableShortcut, postWalletPurchase, saveRate } from "./support/foreign-wallet.mjs";
import { parseCitibankActivityCsv } from "../src/lib/statement-import.ts";
import {
  buildTripEventSuggestions,
  foreignCurrencyOf,
  isHomeBill,
  monthsBefore,
  readSearchWords,
  tripEventDefaultsFromEntries
} from "../src/domain/trip-event-suggestions.ts";

const FIXTURE = JSON.parse(readFileSync(new URL("./fixtures/trip-events/seoul-trip.json", import.meta.url), "utf8"));
const CSV = readFileSync(new URL("./fixtures/citibank-activity/ACCT_349_07_10_2026-seoul-sanitized.csv", import.meta.url), "utf8");
const CITI = "Citi Rewards";

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

// The whole Seoul week, saved the way the app saves it.
export async function seedSeoulWeek(t) {
  const workspace = await openSeededDatabase(t, template);
  const { db, api, fetch: fetchWorker } = workspace;
  const [citi] = await rows(db, "SELECT id FROM accounts WHERE account_name = ?", CITI);
  await enableShortcut(db, { foreignCurrencyAccountId: citi.id });
  await saveRate(db, { quote: "KRW", quotePerBase: FIXTURE.krwPerSgd, rateDate: "2026-10-08" });

  const parsed = parseCitibankActivityCsv(CSV, "ACCT_349_07_10_2026.csv", { accountName: CITI, accountKind: "credit_card", institution: "Citibank" });
  const preview = await ok(api, "/api/imports/preview", {
    sourceLabel: parsed.sourceLabel, sourceType: "csv", parserKey: parsed.parserKey, rows: parsed.rows,
    ownershipType: "direct", ownerName: "Tim", statementCheckpoints: []
  });
  await ok(api, "/api/imports/commit", {
    sourceLabel: parsed.sourceLabel, sourceType: "csv", parserKey: parsed.parserKey,
    rows: preview.preview.previewRows.filter((row) => row.commitStatus === "included"),
    noLongerListedEntries: []
  });

  const ids = {};
  for (const purchase of FIXTURE.applePay) {
    const { status, payload } = await postWalletPurchase(fetchWorker, purchase);
    assert.equal(status, 200, JSON.stringify(payload));
    ids[purchase.description] = payload.entryId;
  }
  for (const order of FIXTURE.standingOrders) {
    ids[order.description] = await createEntry(api, { ...order, ownerName: "Tim" });
  }
  const cardRows = await rows(db, "SELECT id, description FROM transactions WHERE account_id = ? AND import_id IS NOT NULL", citi.id);
  const cardRow = (start) => cardRows.find((row) => row.description.startsWith(start));
  // The card's rows by their shop: the parser keeps the bank line, with
  // its spaces closed up ("LOTTE HOTEL SEOUL SEOUL KOR KRW 1,260,000 ...").
  for (const row of cardRows) ids[shopOf(row.description)] = row.id;

  const { groupId } = await ok(api, "/api/splits/groups/create", { name: FIXTURE.splitGroup.name, currency: FIXTURE.splitGroup.currency });
  for (const cash of FIXTURE.splitGroup.cash) {
    await ok(api, "/api/splits/expenses/create", { groupId, categoryName: "Food & Drinks", currency: "KRW", paymentMethod: "cash", ...cash });
  }
  for (const linked of FIXTURE.splitGroup.linkedToCardRows) {
    const { cardRowStartsWith, ...expense } = linked;
    const created = await ok(api, "/api/splits/expenses/create", {
      groupId, categoryName: "Travel", currency: "KRW", paymentMethod: "card", paymentStatus: "awaiting_statement", ...expense
    });
    const splitExpenseId = created.splitExpenseId ?? created.id ?? created.expenseId;
    await ok(api, "/api/splits/matches/link-expense", { splitExpenseId, transactionId: cardRow(cardRowStartsWith).id });
  }
  return { ...workspace, ids, groupId, citiId: citi.id };
}

// "LOTTE HOTEL SEOUL SEOUL KOR KRW 1,260,000 ₩1,260,000" → "LOTTE HOTEL SEOUL".
function shopOf(description) {
  return description.replace(/\s+\S+\s+(KOR|SGP)\b.*$/, "");
}

const shape = (group) => ({
  key: group.key,
  entries: group.entries.map((entry) => [entry.date, shopOf(entry.description), entry.amountMinor, entry.foreignAmountMinor ?? null, entry.ticked, Boolean(entry.homeBill)])
});

test("the rules: home bills by category, a bank line's won, the defaults from picked rows, search words and the window", () => {
  assert.deepEqual(["Bills", "Loans", "insurance", "Rent", "Subscriptions MO", "Groceries", "Travel", null].map(isHomeBill), [true, true, true, true, true, false, false, false]);
  assert.equal(foreignCurrencyOf({ description: "LOTTE HOTEL SEOUL       SEOUL        KOR KRW 1,260,000 ₩1,260,000" }), "KRW");
  assert.equal(foreignCurrencyOf({ description: "Paris Baguette", originalCurrency: "KRW" }), "KRW");
  // "PTE 5" is not a currency, and the home currency is not abroad.
  assert.equal(foreignCurrencyOf({ description: "SP DIGITAL PTE 5 LTD SGD 142.85" }), null);
  assert.deepEqual(tripEventDefaultsFromEntries([
    { date: "2026-10-05", description: "ADER ERROR SEONGSU KOR KRW 168,000" },
    { date: "2026-10-03", description: "LOTTE HOTEL SEOUL KOR KRW 1,260,000" },
    { date: "2026-10-06", description: "NTUC FairPrice Online Singapore SGP" }
  ]), { startDate: "2026-10-03", endDate: "2026-10-06", currency: "KRW" });
  assert.deepEqual(tripEventDefaultsFromEntries([{ date: "2026-05-04", description: "Birthday cake" }]), { startDate: "2026-05-04", endDate: "2026-05-04", currency: null });
  assert.deepEqual(readSearchWords("  Klook  a 100%_ fees x y z w v u"), ["klook", "100", "fees"]);
  assert.equal(monthsBefore("2026-10-03", 12), "2025-10-03");
  assert.equal(monthsBefore("2026-03-31", 1), "2026-02-28");
  // A trip with no dates and no split group suggests nothing.
  assert.deepEqual(buildTripEventSuggestions({ tripEventId: "t", startDate: null, endDate: null, currency: "KRW", splitGroupId: null, inDates: [], onSplits: [] }).groups, []);
});

test("a week in Seoul: paid in won and on the trip's splits are ticked, dollars and home bills are not", async (t) => {
  const { api, ids, groupId } = await seedSeoulWeek(t);
  const seoul = (await ok(api, "/api/trip-events/save", { ...FIXTURE.trip, splitGroupId: groupId })).tripEvent;
  // One entry already on this trip, one on another trip: neither is listed.
  await ok(api, "/api/trip-events/entries/set", { entryIds: [ids["AREX AIRPORT RAILROAD"]], tripEventId: seoul.id });
  const mum = (await ok(api, "/api/trip-events/save", { name: "Mum's 70th" })).tripEvent;
  await ok(api, "/api/trip-events/entries/set", { entryIds: [ids["NTUC FairPrice Online"]], tripEventId: mum.id });

  const result = await ok(api, `/api/trip-events/suggestions?tripEventId=${seoul.id}`);
  assert.deepEqual({ ...result, groups: undefined }, {
    ok: true, available: true, tripEventId: seoul.id, startDate: "2026-10-03", endDate: "2026-10-09", currency: "KRW",
    splitGroupName: "Seoul trip", groups: undefined, homeBillCount: 2, truncated: false
  });
  assert.deepEqual(result.groups.map(shape), [
    {
      key: "currency",
      entries: [
        ["2026-10-03", "LOTTE HOTEL SEOUL", 119820, 126000000, true, false],
        ["2026-10-04", "GWANGJANG MARKET", 3680, 3800000, true, false],
        ["2026-10-04", "OLIVE YOUNG MYEONGDONG", 13750, 14200000, true, false],
        ["2026-10-05", "ADER ERROR SEONGSU", 16270, 16800000, true, false],
        ["2026-10-05", "TOSOKCHON SAMGYETANG", 4260, 4400000, true, false],
        ["2026-10-06", "KAKAO T TAXI", 1812, 1870000, true, false],
        ["2026-10-07", "STARFIELD LIBRARY CAFE", 1531, 1580000, true, false],
        // The Shortcut's estimates: the won kept, the SGD at 1,032 won.
        ["2026-10-08", "Hongdae Dakgalbi", 5039, 5200000, true, false],
        ["2026-10-08", "Paris Baguette Hongdae", 969, 1000000, true, false],
        ["2026-10-09", "Incheon Airport Duty Free", 8333, 8600000, true, false]
      ]
    },
    // Booked before the trip, but on its split group.
    { key: "splits", entries: [["2026-09-28", "INTERPARK TICKET", 10640, 11000000, true, false]] },
    {
      key: "dollars",
      entries: [
        ["2026-10-03", "CHANGI AIRPORT T3 KOPI", 860, null, false, false],
        ["2026-10-04", "SP DIGITAL PTE LTD GIRO", 14285, null, false, true],
        ["2026-10-05", "HDB HOUSING LOAN GIRO", 62000, null, false, true]
      ]
    }
  ]);
  // Each entry carries who paid and the wallet, for its line.
  const hotel = result.groups[0].entries[0];
  assert.deepEqual({ who: hotel.who, accountName: hotel.accountName, categoryName: typeof hotel.categoryName, foreignCurrency: hotel.foreignCurrency }, { who: "Joyce", accountName: CITI, categoryName: "string", foreignCurrency: "KRW" });
});

test("the New sheet's draft reads the same list before the trip exists, and a trip with no currency ticks only its splits", async (t) => {
  const { api, groupId } = await seedSeoulWeek(t);
  const draft = await ok(api, `/api/trip-events/suggestions?start=2026-10-03&end=2026-10-09&currency=KRW&splitGroupId=${groupId}`);
  assert.equal(draft.tripEventId, null);
  assert.deepEqual(draft.groups.map((group) => [group.key, group.entries.length, group.entries.filter((entry) => entry.ticked).length]), [
    ["currency", 11, 11], ["splits", 1, 1], ["dollars", 4, 0]
  ]);
  const noCurrency = await ok(api, `/api/trip-events/suggestions?start=2026-10-03&end=2026-10-09&splitGroupId=${groupId}`);
  assert.deepEqual(noCurrency.groups.map((group) => [group.key, group.entries.length, group.entries.filter((entry) => entry.ticked).length]), [
    ["splits", 2, 2], ["dollars", 14, 0]
  ]);
  // Only a split group: its linked entries, wherever their dates.
  const onlyGroup = await ok(api, `/api/trip-events/suggestions?splitGroupId=${groupId}`);
  assert.deepEqual(onlyGroup.groups.map(shape).map((group) => [group.key, group.entries.map((entry) => entry[1])]), [["splits", ["INTERPARK TICKET", "LOTTE HOTEL SEOUL"]]]);
  // A draft's fields are read with the save's rules.
  const refused = await api("/api/trip-events/suggestions?start=2026-10-09&end=2026-10-03");
  assert.equal(refused.status, 400);
  assert.match(refused.payload.error, /last day can't be before the first/);
  assert.equal((await api("/api/trip-events/suggestions?tripEventId=trip-nowhere")).status, 400);
});

test("adding the ticked ones puts them on in one change, marked as a suggestion, with Undo", async (t) => {
  const { api, db, groupId } = await seedSeoulWeek(t);
  const seoul = (await ok(api, "/api/trip-events/save", { ...FIXTURE.trip, splitGroupId: groupId })).tripEvent;
  const result = await ok(api, `/api/trip-events/suggestions?tripEventId=${seoul.id}`);
  const ticked = result.groups.flatMap((group) => group.entries).filter((entry) => entry.ticked).map((entry) => entry.id);
  assert.equal(ticked.length, 12);
  const added = await ok(api, "/api/trip-events/entries/set", { entryIds: ticked, tripEventId: seoul.id, addedBy: "suggestion" });
  assert.equal(added.changed, 12);
  assert.deepEqual(await rows(db, "SELECT added_by, COUNT(*) AS n FROM trip_event_entries GROUP BY added_by"), [{ added_by: "suggestion", n: 12 }]);
  // Listed again, only the unticked dollars are left.
  const after = await ok(api, `/api/trip-events/suggestions?tripEventId=${seoul.id}`);
  assert.deepEqual(after.groups.map((group) => [group.key, group.entries.length]), [["dollars", 4]]);
  await ok(api, "/api/trip-events/undo", { undoId: added.undoId });
  assert.deepEqual(await rows(db, "SELECT COUNT(*) AS n FROM trip_event_entries"), [{ n: 0 }]);
  // Ask's own words are not a page's to claim.
  await ok(api, "/api/trip-events/entries/set", { entryIds: [ticked[0]], tripEventId: seoul.id, addedBy: "ask_auto" });
  assert.deepEqual(await rows(db, "SELECT added_by FROM trip_event_entries"), [{ added_by: "person" }]);
});

test("Booked before you went: words, before the first day only, up to 12 months back, not on a trip", async (t) => {
  const { api, groupId } = await seedSeoulWeek(t);
  const seoul = (await ok(api, "/api/trip-events/save", { ...FIXTURE.trip, splitGroupId: groupId })).tripEvent;
  await createEntry(api, { date: "2025-09-20", description: "KLOOK TRAVEL old booking", categoryName: "Travel", amountMinor: 5_000 });
  await createEntry(api, { date: "2026-08-14", description: "SQ flights to Seoul (Klook bundle)", categoryName: "Travel", amountMinor: 128_640 });
  const search = (q) => ok(api, `/api/trip-events/search?tripEventId=${seoul.id}&q=${encodeURIComponent(q)}`);

  const klook = await search("klook");
  assert.deepEqual({ before: klook.before, since: klook.since }, { before: "2026-10-03", since: "2025-10-03" });
  assert.deepEqual(klook.group.entries.map((entry) => [entry.date, entry.description, entry.ticked]), [
    ["2026-09-28", "AMAZE* KLOOK TRAVEL", false],
    ["2026-08-14", "SQ flights to Seoul (Klook bundle)", false]
  ]);
  // Every word must match.
  assert.deepEqual((await search("klook flights")).group.entries.map((entry) => entry.date), ["2026-08-14"]);
  // The trip's own days are skipped: the hotel is in them.
  assert.deepEqual((await search("lotte")).group.entries, []);
  // Too short to search.
  assert.deepEqual((await search("k")).group.entries, []);
  const unknown = await api("/api/trip-events/search?tripEventId=trip-nowhere&q=klook");
  assert.equal(unknown.status, 400);
});

test("the read is bounded: a busy week lists 400 entries and says there were more", async (t) => {
  const { api, db } = await seedSeoulWeek(t);
  const [account] = await rows(db, "SELECT id FROM accounts WHERE account_name = 'UOB One'");
  await db.prepare(`
    WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < 420)
    INSERT INTO transactions (id, household_id, account_id, transaction_date, description, amount_minor, entry_type, category_id)
    SELECT 'busy-' || i, 'household-1', ?, '2026-10-06', 'Busy shop ' || i, 100 + i, 'expense', 'cat-food-drinks' FROM n
  `).bind(account.id).run();
  const busy = (await ok(api, "/api/trip-events/save", { name: "Busy week", startDate: "2026-10-06", endDate: "2026-10-06" })).tripEvent;
  const result = await ok(api, `/api/trip-events/suggestions?tripEventId=${busy.id}`);
  assert.equal(result.truncated, true);
  assert.equal(result.groups.reduce((count, group) => count + group.entries.length, 0), 400);
});

test("without the tables the suggestions are off and say so, and the split groups list still reads", async (t) => {
  const { api, db } = await seedSeoulWeek(t);
  await db.prepare("DROP TABLE trip_event_entries").run();
  await db.prepare("DROP TABLE trip_events").run();
  assert.deepEqual(await ok(api, "/api/trip-events/suggestions?start=2026-10-03&end=2026-10-09&currency=KRW"), {
    ok: true, available: false, tripEventId: null, groups: [], homeBillCount: 0, truncated: false
  });
  const list = await ok(api, "/api/trip-events?with=split-groups");
  assert.equal(list.available, false);
  assert.deepEqual(list.splitGroups.map((group) => [group.name, group.currency]).find(([name]) => name === "Seoul trip"), ["Seoul trip", "KRW"]);
});

test("a New sheet from picked rows gets their first and last day and the won they were paid in", async (t) => {
  const { api, ids } = await seedSeoulWeek(t);
  const defaults = await ok(api, "/api/trip-events/new-defaults", {
    entryIds: [ids["GWANGJANG MARKET"], ids["Paris Baguette Hongdae"], ids["CHANGI AIRPORT T3 KOPI"]]
  });
  assert.deepEqual(defaults, { ok: true, startDate: "2026-10-03", endDate: "2026-10-08", currency: "KRW" });
  assert.deepEqual(await ok(api, "/api/trip-events/new-defaults", { entryIds: [] }), { ok: true, startDate: null, endDate: null, currency: null });
  // Another household's entry (or none) gives nothing.
  assert.deepEqual(await ok(api, "/api/trip-events/new-defaults", { entryIds: ["txn-nowhere"] }), { ok: true, startDate: null, endDate: null, currency: null });
});

test("the split groups list for the New sheet: newest activity first, with its currency", async (t) => {
  const { api } = await seedSeoulWeek(t);
  const list = await ok(api, "/api/trip-events?with=split-groups");
  assert.deepEqual(list.splitGroups[0], { id: list.splitGroups[0].id, name: "Seoul trip", currency: "KRW", lastUsedOn: "2026-10-06" });
  assert.equal("splitGroups" in (await ok(api, "/api/trip-events")), false);
});

test("the trip view names the split group's cash in won, which is not in Entries", async (t) => {
  const { api, groupId } = await seedSeoulWeek(t);
  const seoul = (await ok(api, "/api/trip-events/save", { ...FIXTURE.trip, splitGroupId: groupId })).tripEvent;
  // No entries on it yet: the cash still shows.
  let page = await ok(api, `/api/entries-page?view=household&month=2026-10&trip=${seoul.id}`);
  assert.deepEqual({ splitCash: page.tripView.tripEvent.splitCash, splitGroupName: page.tripView.tripEvent.splitGroupName }, {
    splitCash: [{ currency: "KRW", amountMinor: 9_600_000 }], splitGroupName: "Seoul trip"
  });
  const result = await ok(api, `/api/trip-events/suggestions?tripEventId=${seoul.id}`);
  await ok(api, "/api/trip-events/entries/set", { entryIds: result.groups[0].entries.map((entry) => entry.id), tripEventId: seoul.id, addedBy: "suggestion" });
  page = await ok(api, `/api/entries-page?view=household&month=2026-10&trip=${seoul.id}`);
  assert.deepEqual(page.tripView.tripEvent.splitCash, [{ currency: "KRW", amountMinor: 9_600_000 }]);
  // A trip with no split group has no cash line.
  const bali = (await ok(api, "/api/trip-events/save", { name: "Bali trip" })).tripEvent;
  page = await ok(api, `/api/entries-page?view=household&month=2026-10&trip=${bali.id}`);
  assert.equal("splitCash" in page.tripView.tripEvent, false);
});
