// "Is that more than usual?" (src/domain/ask-usual.ts): the usual level is
// the middle of the 6 months before, every number comes from the entries,
// and the words say what made the difference.
import assert from "node:assert/strict";
import test from "node:test";

import { buildUsualCard, buildUsualFacts, buildUsualPromptFacts, buildUsualWording, medianOf } from "../src/domain/ask-usual.ts";
import { validateAiWording } from "../src/domain/ask-answer-wording.ts";
import { assertSameDatabase, createEntry, createSeededTemplate, dumpDatabase, openSeededDatabase } from "./support/d1-workspace.mjs";

const money = (minor) => `${minor < 0 ? "-" : ""}$${(Math.abs(minor) / 100).toLocaleString("en-SG", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const TRACKED = ["2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09", "2026-10"];
let counter = 0;
const entry = (date, description, amountMinor, categoryName = "Taxi", entryType = "expense") => ({ id: `u${(counter += 1)}`, date, description, categoryName, entryType, amountMinor });

// Grab: April to September at $98.20, $105.80, $110.40, $113.60, $124.50 and
// $131.60 (10 rides each), then October at $186.40 with 3 airport rides.
function grabEntries() {
  const list = [];
  const months = [["2026-04", 9_820], ["2026-05", 10_580], ["2026-06", 11_040], ["2026-07", 11_360], ["2026-08", 12_450], ["2026-09", 13_160]];
  for (const [month, total] of months) {
    for (let ride = 0; ride < 10; ride += 1) {
      list.push(entry(`${month}-${String(ride + 2).padStart(2, "0")}`, "GRAB*TRIP", ride === 9 ? total - 9 * Math.floor(total / 10) : Math.floor(total / 10)));
    }
  }
  // October: 14 ordinary rides and 3 to and from the airport.
  const october = [...Array(14).fill(651), 3_860, 2_940, 2_710];
  october.forEach((amount, index) => list.push(entry(`2026-10-${String(index + 2).padStart(2, "0")}`, "GRAB*TRIP", amount)));
  return list;
}

test("the median of an even count is the mean of the middle two", () => {
  assert.equal(medianOf([9_820, 10_580, 11_040, 11_360, 12_450, 13_160]), 11_200);
  assert.equal(medianOf([3, 1, 2]), 2);
  assert.equal(medianOf([]), 0);
});

test("a shop: its usual month, the verdict, and the largest charges above its usual charge", () => {
  const facts = buildUsualFacts({ subject: { kind: "shop", key: "GRAB TRIP", name: "Grab" }, label: "Grab", month: "2026-10", viewId: "household", scope: "direct_plus_shared", entries: grabEntries(), trackedMonths: TRACKED });
  assert.equal(facts.amountMinor, 14 * 651 + 3_860 + 2_940 + 2_710);
  assert.equal(facts.usualMinor, 11_200);
  assert.equal(facts.verdict, "more");
  assert.equal(facts.diffMinor, facts.amountMinor - 11_200);
  assert.deepEqual(facts.drivers.map((driver) => [driver.date, driver.amountMinor]), [["2026-10-16", 3_860], ["2026-10-17", 2_940], ["2026-10-18", 2_710]]);
  assert.equal(facts.entryCount, 17);
  assert.equal(facts.usualEntryCount, 10);
  const wording = buildUsualWording(facts, money);
  assert.equal(wording, "Grab came to $186.24 in October. Your usual month is $112.00, the middle of the last 6 months, so October was $74.24 more than usual. The largest 3 charges were $95.10 together. Words used: \u201cUsual\u201d is the middle amount of the last 6 months: half the months were higher and half lower, so one odd month barely moves it.");
  // Every sum in the wording is one of the facts' own.
  assert.equal(validateAiWording(wording.replace(/ Words used: .*$/, ""), { promptFacts: buildUsualPromptFacts(facts, money), knownNames: ["Grab"] }) !== null, true);
  const card = buildUsualCard(facts, money);
  assert.equal(card.title, "Grab in October");
  assert.deepEqual(card.support, [{ label: "Usual", amountMinor: 11_200, currency: "SGD" }, { label: "September", amountMinor: 13_160, currency: "SGD" }]);
  assert.equal(card.links[0].filter.search, "Grab");
});

test("a category counts a month with nothing as $0; a shop leaves it out; within 15% or $20 is about usual", () => {
  const entries = [
    entry("2026-05-03", "NTUC FAIRPRICE", 40_000, "Groceries"),
    entry("2026-07-03", "NTUC FAIRPRICE", 42_000, "Groceries"),
    entry("2026-09-03", "NTUC FAIRPRICE", 44_000, "Groceries"),
    entry("2026-10-03", "NTUC FAIRPRICE", 30_000, "Groceries")
  ];
  const category = buildUsualFacts({ subject: { kind: "category", name: "Groceries" }, label: "Groceries", month: "2026-10", viewId: "household", scope: "direct_plus_shared", entries, trackedMonths: TRACKED });
  // Apr 0, May 400, Jun 0, Jul 420, Aug 0, Sep 440: the middle is 200.
  assert.equal(category.usualMinor, 20_000);
  assert.equal(category.verdict, "more");
  const shop = buildUsualFacts({ subject: { kind: "shop", key: "NTUC FAIRPRICE", name: "Ntuc Fairprice" }, label: "NTUC Fairprice", month: "2026-10", viewId: "household", scope: "direct_plus_shared", entries, trackedMonths: TRACKED });
  assert.equal(shop.regular, true);
  assert.equal(shop.usualMinor, 42_000);
  assert.equal(shop.verdict, "less");
  const near = buildUsualFacts({ subject: { kind: "shop", key: "NTUC FAIRPRICE", name: "x" }, label: "x", month: "2026-10", viewId: "household", scope: "direct_plus_shared", entries: [...entries.slice(0, 3), entry("2026-10-04", "NTUC FAIRPRICE", 40_500, "Groceries")], trackedMonths: TRACKED });
  assert.equal(near.verdict, "about");
});

test("not a regular: a shop seen in fewer than 3 of the 6 months compares the size of a visit", () => {
  const entries = [entry("2026-06-10", "BURNT ENDS", 32_000, "Food & Drinks"), entry("2026-10-12", "BURNT ENDS", 41_000, "Food & Drinks")];
  const facts = buildUsualFacts({ subject: { kind: "shop", key: "BURNT ENDS", name: "Burnt Ends" }, label: "Burnt Ends", month: "2026-10", viewId: "household", scope: "direct_plus_shared", entries, trackedMonths: TRACKED });
  assert.equal(facts.regular, false);
  assert.equal(facts.usualMinor, 32_000);
  assert.equal(facts.verdict, "more");
  assert.match(buildUsualWording(facts, money), /^Burnt Ends isn't a regular: it shows up in fewer than 3 of the last 6 months\. In October it came to \$410\.00 over 1 charge, against a usual charge of \$320\.00\. Words used: /);
});

test("a month's spending names the categories that rose most against their own usual, and a new one", () => {
  const entries = [];
  for (const month of ["2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09"]) {
    entries.push(entry(`${month}-05`, "NTUC", 50_000, "Groceries"), entry(`${month}-06`, "GRAB", 10_000, "Taxi"));
  }
  entries.push(entry("2026-10-05", "NTUC", 52_000, "Groceries"), entry("2026-10-06", "GRAB", 30_000, "Taxi"), entry("2026-10-07", "COURTS", 80_000, "Home"));
  const facts = buildUsualFacts({ subject: { kind: "spending" }, label: "Spending", month: "2026-10", viewId: "household", scope: "direct_plus_shared", entries, trackedMonths: TRACKED });
  assert.equal(facts.usualMinor, 60_000);
  assert.deepEqual(facts.drivers.map((driver) => [driver.label, driver.amountMinor, driver.isNew ?? false]), [["Home", 80_000, true], ["Taxi", 30_000, false], ["Groceries", 52_000, false]]);
  assert.match(buildUsualWording(facts, money), /Most of the rise came from Home \(new this month\), Taxi and Groceries\. Words used: /);
});

test("only the months the household tracks count; with none before, it says so", () => {
  const facts = buildUsualFacts({ subject: { kind: "spending" }, label: "Spending", month: "2026-10", viewId: "household", scope: "direct_plus_shared", entries: [entry("2026-10-01", "A", 100)], trackedMonths: ["2026-10"] });
  assert.deepEqual(facts.history, []);
  assert.equal(buildUsualWording(facts, money), "Spending came to $1.00 in October. There are no months before it to compare with yet.");
});

// The answer route on the real Worker: a shop's month against its usual
// month, with exact figures from the entries; a shop nobody paid is not
// answered (Ask asks back), and reading changes nothing.
let template;
test.before(async () => {
  template = await createSeededTemplate();
});
test.after(async () => {
  await template?.dispose();
});

test("the answer route: Grab in May against its usual month, exact figures; an unknown shop is not answered", async (t) => {
  const { db, api } = await openSeededDatabase(t, template);
  const months = [["2025-11", 9_820], ["2025-12", 10_580], ["2026-01", 11_040], ["2026-02", 11_360], ["2026-03", 12_450], ["2026-04", 13_160], ["2026-05", 18_640]];
  for (const [month, amountMinor] of months) {
    await createEntry(api, { date: `${month}-12`, description: "GRAB*TRIP 4821", accountName: "UOB One", categoryName: "Taxi", amountMinor });
  }
  const before = await dumpDatabase(db);
  const ask = async (text) => {
    const { status, payload } = await api("/api/ai-assist/answer", { text, viewId: "household", month: "2026-05", scope: "direct_plus_shared" });
    assert.equal(status, 200, JSON.stringify(payload));
    return payload;
  };
  const answer = await ask("is grab more than usual in May?");
  assert.equal(answer.supported, true);
  assert.equal(answer.intent, "usual");
  assert.equal(answer.answer.title, "Grab Trip in May");
  assert.equal(answer.answer.lead.amountMinor, 18_640);
  assert.deepEqual(answer.answer.support, [{ label: "Usual", amountMinor: 11_200, currency: "SGD" }, { label: "April", amountMinor: 13_160, currency: "SGD" }]);
  assert.equal(answer.wording.source, "template");
  assert.match(answer.wording.text, /^Grab Trip came to \$186\.40 in May\. Your usual month is \$112\.00, the middle of the last 6 months, so May was \$74\.40 more than usual\./);
  const unknown = await ask("is Zzz more than usual in May?");
  assert.deepEqual(unknown, { ok: true, supported: false });
  assertSameDatabase(await dumpDatabase(db), before);
});
