// Card reward rules (DOMAIN.md "Card reward rule"): the presets, how an
// entry was paid, earning with caps and cycles, cashback minimums, "best
// card now", cap notices and looking back. Pure: no database, no AI.
import assert from "node:assert/strict";
import test from "node:test";

import {
  bestCardsNow,
  capNotices,
  cardsThisCycle,
  CardRewardRulesRefused,
  cycleStart,
  earnedOnCard,
  entryChannels,
  lookingBack,
  lookingBackWindow,
  nextCycleStart,
  quoteEntry,
  readCardRewardRules,
  replayEarnings
} from "../src/domain/card-rewards.ts";
import { CARD_REWARD_PRESETS, presetForAccountName, rulesFromPreset } from "../src/domain/card-reward-presets.ts";

const rules = (name, day = null) => rulesFromPreset(presetForAccountName(name), day);
let serial = 0;
const entry = (accountId, date, amountMinor, categoryName, channels = []) => ({ id: `e${String(serial += 1).padStart(4, "0")}`, accountId, date, amountMinor, categoryName, channels });

test("presets: every household card matches its preset by name; a bank account name or an unknown card matches none it should not", () => {
  const expected = {
    "UOB Privi Miles": "uob-prvi-miles",
    "UOB PRVI Miles Card": "uob-prvi-miles",
    "Citi Rewards": "citi-rewards",
    "Citi Rewards Card": "citi-rewards",
    "Citi Miles": "citi-premiermiles",
    "Citi PremierMiles": "citi-premiermiles",
    "UOB One Card": "uob-one",
    "UOB Lady's Card": "uob-ladys",
    "UOB Ladys": "uob-ladys",
    "HSBC Visa Revolution": "hsbc-revolution",
    "OCBC Infinity Cashback": "ocbc-infinity",
    "OCBC 365 Credit Card": "ocbc-365",
    "DBS Live Fresh Card": "dbs-live-fresh"
  };
  for (const [name, key] of Object.entries(expected)) {
    assert.equal(presetForAccountName(name)?.key, key, name);
  }
  assert.equal(presetForAccountName("Amex KrisFlyer"), null);
  assert.equal(presetForAccountName("Standard Chartered Smart"), null);
  // Every preset has a source and a yearly check, and passes its own reader.
  for (const preset of CARD_REWARD_PRESETS) {
    assert.match(preset.source, /\.(com|sg)/, preset.key);
    assert.match(preset.check, /[Cc]heck/, preset.key);
    const read = readCardRewardRules(rulesFromPreset(preset));
    assert.deepEqual(read, rulesFromPreset(preset), preset.key);
  }
});

test("presets: the owner's figures (Lady's 4 on Food & Drinks capped $1,000 a month, Citi Rewards and HSBC $1,000, PremierMiles 1.2/2.2, PRVI 1.4/2.4, cashback minimums)", () => {
  const ladys = rules("UOB Lady's Card");
  assert.deepEqual([ladys.unit, ladys.baseRate, ladys.bonuses[0].rate, ladys.bonuses[0].capMinor, ladys.bonuses[0].categories, ladys.bonuses[0].cycle.kind], ["miles", 0.4, 4, 100_000, ["Food & Drinks"], "calendar"]);
  const citi = rules("Citi Rewards", 18);
  assert.deepEqual([citi.bonuses[0].rate, citi.bonuses[0].capMinor, citi.bonuses[0].cycle, citi.bonuses[0].exceptCategories, citi.bonuses[0].match], [4, 100_000, { kind: "statement", day: 18 }, ["Travel"], "either"]);
  assert.deepEqual([rules("HSBC Visa Revolution").bonuses[0].capMinor, rules("HSBC Visa Revolution").bonuses[0].channels], [100_000, ["online", "contactless"]]);
  assert.deepEqual([rules("Citi Miles").baseRate, rules("Citi Miles").bonuses[0].rate, rules("Citi Miles").bonuses[0].capMinor], [1.2, 2.2, null]);
  assert.deepEqual([rules("UOB Privi Miles").baseRate, rules("UOB Privi Miles").bonuses[0].rate], [1.4, 2.4]);
  assert.deepEqual([rules("UOB One Card").unit, rules("UOB One Card").minSpendMinor, rules("UOB One Card").minCount], ["cashback", 60_000, 5]);
  assert.equal(rules("OCBC 365 Credit Card").minSpendMinor, 80_000);
  assert.deepEqual([rules("OCBC Infinity Cashback").baseRate, rules("OCBC Infinity Cashback").bonuses.length], [1.6, 0]);
  // A statement day outside 1 to 28 falls back to the 1st.
  assert.equal(rules("Citi Rewards", 31).bonuses[0].cycle.day, 1);
});

test("reading rules: tidies good input and refuses bad input with a plain reason", () => {
  const read = readCardRewardRules({
    unit: "miles", baseRate: "0.4",
    bonuses: [{ id: "x", categories: [" Food &  Drinks ", "Food & Drinks"], channels: ["online"], rate: 4, capMinor: 100000, cycle: { kind: "statement", day: 5 } }],
    excludedCategories: ["Tax"], minSpendMinor: 50000, minCount: 3
  });
  assert.deepEqual(read.bonuses[0].categories, ["Food & Drinks"]);
  assert.equal(read.baseRate, 0.4);
  // A miles card has no monthly minimum.
  assert.deepEqual([read.minSpendMinor, read.minCount], [null, null]);
  const refusals = [
    [{ unit: "points" }, /miles or cashback/],
    [{ unit: "miles", baseRate: -1 }, /between 0 and 30/],
    [{ unit: "cashback", baseRate: 25 }, /between 0% and 20%/],
    [{ unit: "miles", bonuses: [{ rate: 4, channels: ["teleport"] }] }, /online, by tap/],
    [{ unit: "miles", bonuses: [{ rate: 4, capMinor: 12.5 }] }, /whole amount/],
    [{ unit: "miles", bonuses: [{ rate: 4, cycle: { kind: "statement", day: 31 } }] }, /1 to 28/],
    [{ unit: "miles", bonuses: [{ rate: 4, cycle: { kind: "weekly" } }] }, /calendar month or each statement month/],
    [{ unit: "miles", bonuses: Array.from({ length: 7 }, () => ({ rate: 1 })) }, /at most 6/],
    [{ unit: "cashback", minCount: 0 }, /from 1 to 50/],
    [{ unit: "miles", excludedCategories: "Tax" }, /list of category names/]
  ];
  for (const [input, reason] of refusals) {
    assert.throws(() => readCardRewardRules(input), (error) => error instanceof CardRewardRulesRefused && reason.test(error.message), JSON.stringify(input));
  }
});

test("how an entry was paid: Apple Pay is a tap, another currency is foreign, AMAZE* and web shops are online, anything else unknown", () => {
  assert.deepEqual(entryChannels({ description: "KOPITIAM TAMPINES", externalReference: "shortcut:abc" }), ["contactless"]);
  assert.deepEqual(entryChannels({ description: "UNIQLO SHINJUKU", originalCurrency: "JPY" }), ["foreign"]);
  assert.deepEqual(entryChannels({ description: "AMAZE* GRAB RIDES" }), ["online"]);
  assert.deepEqual(entryChannels({ description: "WWW.SOMESHOP.SG" }), ["online"]);
  assert.deepEqual(entryChannels({ description: "NETFLIX.COM" }), ["online"]);
  assert.deepEqual(entryChannels({ description: "AMAZON JP", originalCurrency: "JPY" }), ["foreign", "online"]);
  assert.deepEqual(entryChannels({ description: "TOAST BOX", originalCurrency: "SGD", externalReference: "import:1" }), []);
  assert.deepEqual(entryChannels({ description: "TOAST BOX", currency: "SGD" }), []);
});

test("cycles: a calendar month resets on the 1st; a statement month on its day", () => {
  assert.equal(cycleStart("2026-11-10", { kind: "calendar", day: 1 }), "2026-11-01");
  assert.equal(nextCycleStart("2026-11-10", { kind: "calendar", day: 1 }), "2026-12-01");
  assert.equal(cycleStart("2026-11-10", { kind: "statement", day: 18 }), "2026-10-18");
  assert.equal(nextCycleStart("2026-11-10", { kind: "statement", day: 18 }), "2026-11-18");
  assert.equal(cycleStart("2026-01-05", { kind: "statement", day: 18 }), "2025-12-18");
  assert.equal(cycleStart("2026-11-18", { kind: "statement", day: 18 }), "2026-11-18");
});

test("earning: a capped bonus pays 4 up to the cap, then the base rate; an excluded category earns nothing; the cap resets next month", () => {
  const ladys = rules("UOB Lady's Card");
  const map = new Map([["lady", ladys]]);
  const entries = [
    entry("lady", "2026-10-02", 90_000, "Food & Drinks"),
    entry("lady", "2026-10-05", 30_000, "Food & Drinks"), // $100 at 4, $200 at 0.4
    entry("lady", "2026-10-06", 10_000, "Shopping"), // base 0.4
    entry("lady", "2026-10-07", 50_000, "Insurance"), // nothing
    entry("lady", "2026-11-01", 10_000, "Food & Drinks") // new month: 4
  ];
  const earned = replayEarnings(entries, map, (item) => item.accountId);
  assert.deepEqual(earned.map((item) => Math.round(item.earned * 100) / 100), [3600, 480, 40, 0, 400]);
  assert.deepEqual(earned[1].quote.parts, [{ bonusId: "chosen", amountMinor: 10_000, rate: 4 }, { bonusId: null, amountMinor: 20_000, rate: 0.4 }]);
  assert.equal(earned[3].quote.excluded, true);
  // One entry's quote on its own never changes the caps used.
  const usage = new Map();
  quoteEntry(ladys, "lady", usage, entries[0]);
  assert.equal(usage.size, 0);
});

test("earning: Citi Rewards pays 4 online or on shopping (not travel), on its statement month", () => {
  const citi = rules("Citi Rewards", 18);
  const map = new Map([["citi", citi]]);
  const entries = [
    entry("citi", "2026-10-20", 10_000, "Food & Drinks", ["online"]), // online: 4
    entry("citi", "2026-10-21", 10_000, "Shopping"), // shopping: 4
    entry("citi", "2026-10-22", 10_000, "Travel", ["online"]), // travel: 0.4
    entry("citi", "2026-10-23", 10_000, "Food & Drinks") // dining in a shop: 0.4
  ];
  assert.deepEqual(replayEarnings(entries, map, (item) => item.accountId).map((item) => item.earned), [400, 400, 40, 40]);
});

test("cashback: a month below the minimum pays only the base rate; a month that reaches it pays the bonus", () => {
  const ocbc = rules("OCBC 365 Credit Card");
  const map = new Map([["ocbc", ocbc]]);
  const short = [entry("ocbc", "2026-09-03", 20_000, "Food & Drinks"), entry("ocbc", "2026-09-04", 10_000, "Shopping")];
  // $300 < $800: base 0.25% on all.
  assert.deepEqual(replayEarnings(short, map, (item) => item.accountId).map((item) => item.earned), [50, 25]);
  const full = [entry("ocbc", "2026-10-03", 20_000, "Food & Drinks"), entry("ocbc", "2026-10-04", 60_000, "Shopping")];
  // $800 reached: 5% on dining ($10 = 1,000 cents), 0.25% on shopping.
  assert.deepEqual(replayEarnings(full, map, (item) => item.accountId).map((item) => item.earned), [1000, 150]);
  // UOB One also needs 5 payments.
  const one = rules("UOB One Card");
  const fewPayments = [entry("one", "2026-10-03", 70_000, "Shopping")];
  assert.deepEqual(replayEarnings(fewPayments, new Map([["one", one]]), (item) => item.accountId).map((item) => item.earned), [0]);
});

function household() {
  const tim = [
    { accountId: "ladys", name: "UOB Lady's Card", personId: "tim", rules: rules("UOB Lady's Card") },
    { accountId: "citi", name: "Citi Rewards", personId: "tim", rules: rules("Citi Rewards", 18) },
    { accountId: "hsbc", name: "HSBC Revolution", personId: "tim", rules: rules("HSBC Visa Revolution") },
    { accountId: "pm", name: "Citi PremierMiles", personId: "tim", rules: rules("Citi Miles") },
    { accountId: "infinity", name: "OCBC Infinity", personId: "tim", rules: rules("OCBC Infinity Cashback") }
  ];
  const joyce = [
    { accountId: "prvi", name: "UOB PRVI Miles", personId: "joyce", rules: rules("UOB Privi Miles") },
    { accountId: "365", name: "OCBC 365", personId: "joyce", rules: rules("OCBC 365 Credit Card") }
  ];
  return { tim, joyce, cards: [...tim, ...joyce] };
}

test("this cycle: miles per card, bonus room left and the reset day; a cashback card's minimum still to go", () => {
  const { cards } = household();
  const entries = [
    entry("citi", "2026-10-19", 70_000, "Shopping", ["online"]),
    entry("citi", "2026-11-02", 40_000, "Shopping", ["online"]), // $300 of it at 4, $100 at 0.4
    entry("citi", "2026-10-10", 50_000, "Shopping", ["online"]), // last statement month
    entry("ladys", "2026-11-03", 38_000, "Food & Drinks"),
    entry("365", "2026-11-04", 30_000, "Food & Drinks")
  ];
  const cycle = cardsThisCycle(cards, entries, "2026-11-10");
  const citi = cycle.find((card) => card.accountId === "citi");
  assert.deepEqual([citi.cycleStart, citi.resetsOn, citi.earned, citi.spendMinor, citi.ids.length], ["2026-10-18", "2026-11-18", 4040, 110_000, 2]);
  assert.deepEqual([citi.bonuses[0].eligibleMinor, citi.bonuses[0].usedMinor, citi.bonuses[0].roomMinor], [110_000, 100_000, 0]);
  const ladys = cycle.find((card) => card.accountId === "ladys");
  assert.deepEqual([ladys.earned, ladys.bonuses[0].roomMinor, ladys.resetsOn], [1520, 62_000, "2026-12-01"]);
  const ocbc = cycle.find((card) => card.accountId === "365");
  assert.deepEqual([ocbc.minimum.met, ocbc.minimum.needMinor], [false, 50_000]);
  // The figure's rule, worked out again from the card's own rows.
  assert.equal(earnedOnCard(cards[1].rules, "citi", entries.filter((item) => item.accountId === "citi" && item.date >= "2026-10-18")), citi.earned);
});

test("earned before: the same days of the cycle before, so a half-finished cycle is not set against a whole one", () => {
  const { cards } = household();
  const entries = [
    entry("citi", "2026-09-20", 10_000, "Shopping"), // in the first 23 days of the cycle before
    entry("citi", "2026-10-11", 10_000, "Shopping"), // day 24 of it: the last day counted is 11 Oct (today, 10 Nov, is 23 days into the cycle that began 18 Oct)
    entry("citi", "2026-10-12", 90_000, "Shopping"), // after the same point: left out
    entry("citi", "2026-10-19", 10_000, "Shopping"), // this cycle, not before
    entry("ladys", "2026-10-02", 20_000, "Food & Drinks"), // calendar cycle: 1 to 10 Oct
    entry("ladys", "2026-10-25", 20_000, "Food & Drinks") // after the same point of October
  ];
  const cycle = cardsThisCycle(cards, entries, "2026-11-10");
  const citi = cycle.find((card) => card.accountId === "citi");
  const quote = (accountId, list) => earnedOnCard(cards.find((card) => card.accountId === accountId).rules, accountId, list);
  const citiEntries = entries.filter((item) => item.accountId === "citi");
  assert.equal(citi.earnedBefore, quote("citi", citiEntries.filter((item) => item.date >= "2026-09-18" && item.date <= "2026-10-11")));
  assert.ok(citi.earnedBefore > 0);
  // The $900 on 12 Oct would have made it far bigger: it is not in.
  assert.ok(citi.earnedBefore < quote("citi", citiEntries.filter((item) => item.date < "2026-10-18")));
  const ladys = cycle.find((card) => card.accountId === "ladys");
  assert.equal(ladys.earnedBefore, quote("ladys", entries.filter((item) => item.accountId === "ladys" && item.date <= "2026-10-10")));
  // A card with nothing in the cycle before has 0, never null.
  assert.equal(cycle.find((card) => card.accountId === "pm").earnedBefore, 0);
});

test("cap notices: used up (with the person's own card that still has room), nearly used, and a cashback minimum to go", () => {
  const { cards } = household();
  const entries = [
    entry("citi", "2026-10-19", 120_000, "Shopping", ["online"]),
    entry("hsbc", "2026-11-02", 38_000, "Shopping", ["online"]),
    entry("ladys", "2026-11-03", 80_000, "Food & Drinks"),
    entry("365", "2026-11-04", 30_000, "Food & Drinks")
  ];
  const cycle = cardsThisCycle(cards, entries, "2026-11-10");
  const tim = capNotices("tim", cards, cycle);
  assert.deepEqual(tim.map((notice) => [notice.kind, notice.accountId]), [["used_up", "citi"], ["nearly", "ladys"]]);
  assert.deepEqual(tim[0].alternative, { accountId: "hsbc", bonusId: "online-tap", roomMinor: 62_000, rate: 4 });
  assert.equal(tim[0].resetsOn, "2026-11-18");
  assert.equal(tim[1].roomMinor, 20_000);
  // Joyce's notices name only her cards; Tim's are never offered to her.
  const joyce = capNotices("joyce", cards, cycle);
  assert.deepEqual(joyce.map((notice) => [notice.kind, notice.accountId, notice.needMinor]), [["minimum", "365", 50_000]]);
  assert.ok(joyce.every((notice) => !["citi", "hsbc", "ladys"].includes(notice.accountId)));
});

test("best card now: Lady's for dining while it has room, then the next best; only the person's own cards, miles and cashback apart", () => {
  const { cards } = household();
  const dining = Array.from({ length: 6 }, (_, index) => entry("citi", `2026-${String(8 + Math.floor(index / 2)).padStart(2, "0")}-1${index}`, 15_000, "Food & Drinks"));
  const now = bestCardsNow({ personId: "tim", cards, entries: dining, today: "2026-11-10" });
  const miles = now.find((item) => item.categoryName === "Food & Drinks" && item.unit === "miles");
  assert.deepEqual([miles.accountId, miles.rate, miles.roomMinor, miles.usualAccountId, miles.usualRate], ["ladys", 4, 100_000, "citi", 0.4]);
  const cashback = now.find((item) => item.categoryName === "Food & Drinks" && item.unit === "cashback");
  assert.deepEqual([cashback.accountId, cashback.rate], ["infinity", 1.6]);
  // Lady's used up this month: the next best miles card is PremierMiles at 1.2.
  const used = [...dining, entry("ladys", "2026-11-02", 100_000, "Food & Drinks")];
  const after = bestCardsNow({ personId: "tim", cards, entries: used, today: "2026-11-10" }).find((item) => item.categoryName === "Food & Drinks" && item.unit === "miles");
  assert.deepEqual([after.accountId, after.rate], ["pm", 1.2]);
  // Joyce is never offered Tim's Lady's Card, even for her dining.
  const joyceDining = [entry("prvi", "2026-10-05", 20_000, "Food & Drinks")];
  const joyce = bestCardsNow({ personId: "joyce", cards, entries: joyceDining, today: "2026-11-10" });
  assert.ok(joyce.length > 0);
  assert.ok(joyce.every((item) => ["prvi", "365"].includes(item.accountId)), JSON.stringify(joyce));
  // A person with no cards gets nothing.
  assert.deepEqual(bestCardsNow({ personId: "nobody", cards, entries: dining, today: "2026-11-10" }), []);
});

test("looking back: the last 3 whole months replayed on the best of the person's own cards, caps in date order, top changes", () => {
  const { cards } = household();
  assert.deepEqual(lookingBackWindow("2026-11-10"), { startDate: "2026-08-01", endDate: "2026-10-31" });
  const entries = [
    // Dining on PremierMiles (1.2) that Lady's (4, $1,000 a month) would have paid more on.
    entry("pm", "2026-08-05", 60_000, "Food & Drinks"),
    entry("pm", "2026-08-20", 60_000, "Food & Drinks"), // only $400 of it fits Lady's cap
    // Online shopping on Lady's (0.4) that Citi Rewards would have paid 4 on.
    entry("ladys", "2026-09-07", 20_000, "Shopping", ["online"]),
    // Before the window: counts toward nothing in the window's totals.
    entry("pm", "2026-07-20", 50_000, "Food & Drinks"),
    // This month: not looked back on.
    entry("pm", "2026-11-02", 50_000, "Food & Drinks"),
    // Cashback: Infinity is the only cashback card, nothing to change.
    entry("infinity", "2026-09-09", 10_000, "Shopping")
  ];
  const [miles, cashback] = lookingBack({ personId: "tim", cards, entries, today: "2026-11-10" });
  assert.equal(miles.unit, "miles");
  // Actual: $1,200 x 1.2 = 1,440 + $200 x 0.4 = 80 -> 1,520.
  // Best, in date order: the first $600 on Lady's (2,400); the second still
  // pays more there ($400 x 4 + $200 x 0.4 = 1,680 against PM's 720); the
  // shopping on Citi Rewards ($200 x 4 = 800) -> 4,880.
  assert.deepEqual([miles.earned, miles.best, miles.gain], [1520, 4880, 3360]);
  assert.deepEqual(miles.changes.map((change) => [change.categoryName, change.fromAccountId, change.toAccountId, change.spendMinor, change.gain]), [
    ["Food & Drinks", "pm", "ladys", 120_000, 2640],
    ["Shopping", "ladys", "citi", 20_000, 720]
  ]);
  assert.equal(miles.ids.length, 3);
  assert.deepEqual([cashback.unit, cashback.gain, cashback.changes], ["cashback", 0, []]);
  // Joyce's looking back never moves her spending onto Tim's cards.
  const joyce = lookingBack({ personId: "joyce", cards, entries: [entry("prvi", "2026-09-01", 50_000, "Food & Drinks")], today: "2026-11-10" });
  assert.ok(joyce.every((result) => result.changes.every((change) => ["prvi", "365"].includes(change.toAccountId))));
  assert.equal(joyce.find((result) => result.unit === "miles").gain, 0);
});

// "Suggest cards from" (owner decision, 2026-11-10): the household pools
// its miles, so by default any household card may be named for anyone's
// spending, with each card's cap shared by everyone who uses it.
test("the whole household: Joyce's dining moves to Tim's Lady's Card, caps shared per card; each person's own: never", () => {
  const { cards } = household();
  const pooled = cards.map((card) => ({ ...card, personId: "household" }));
  const joyceAccounts = new Set(["prvi", "365"]);
  const entries = [
    entry("prvi", "2026-09-03", 70_000, "Food & Drinks"), // Joyce
    entry("ladys", "2026-09-04", 50_000, "Food & Drinks") // Tim
  ];
  const [miles] = lookingBack({ personId: "household", cards: pooled, entries, today: "2026-11-10" });
  // In date order Joyce's $700 goes on Lady's (4), so Tim's $500 finds only
  // $300 of room left there: the cap is shared. Its other $200 earns more on
  // PremierMiles (1.2) than at Lady's 0.4, but the whole entry moves as one:
  // Lady's pays 1,200 + 80, PremierMiles 600, so it stays on Lady's.
  assert.deepEqual(miles.changes.map((change) => [change.fromAccountId, change.toAccountId]), [["prvi", "ladys"]]);
  assert.deepEqual([miles.earned, miles.best], [Math.floor(700 * 1.4 + 500 * 4), Math.floor(700 * 4 + 300 * 4 + 200 * 0.4)]);
  // Joyce's view in a pooling household: her spending only, any card.
  const [joyceMiles] = lookingBack({ personId: "household", cards: pooled, entries, today: "2026-11-10", spendingAccounts: joyceAccounts });
  assert.deepEqual([joyceMiles.earned, joyceMiles.best, joyceMiles.changes[0].toAccountId], [980, 2800, "ladys"]);
  const best = bestCardsNow({ personId: "household", cards: pooled, entries, today: "2026-11-10", spendingAccounts: joyceAccounts });
  assert.equal(best.find((item) => item.unit === "miles").accountId, "ladys");
  // Each person's own cards: Joyce is never offered Tim's.
  const own = lookingBack({ personId: "joyce", cards, entries, today: "2026-11-10" });
  assert.ok(own.every((item) => item.changes.every((change) => joyceAccounts.has(change.toAccountId))));
  assert.ok(bestCardsNow({ personId: "joyce", cards, entries, today: "2026-11-10" }).every((item) => joyceAccounts.has(item.accountId)));
});
