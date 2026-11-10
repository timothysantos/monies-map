// Summary's Miles and cashback as data: the card model over the real
// server answer (Joyce's UOB Lady's and Citi Rewards, Tim's UOB One). Miles
// and cashback are totalled apart and never converted; every figure names
// the entries behind it; the pooled household is one picture and the own-cards
// setting makes one per person.
import assert from "node:assert/strict";
import test from "node:test";

import { buildCardRewardsModel } from "../src/client/card-rewards-model.js";
import { readCardRewards } from "../src/client/card-rewards-api.js";
import { cardRewardsCopy as copy, bonusWhat, formatMiles } from "../src/client/copy/card-rewards-copy.js";
import { todayInAppTimeZone } from "../src/lib/app-calendar.ts";
import { createEntry, createSeededTemplate, openSeededDatabase } from "./support/d1-workspace.mjs";

let template;
test.before(async () => {
  template = await createSeededTemplate();
});
test.after(async () => {
  await template?.dispose();
});

const thisMonth = todayInAppTimeZone().slice(0, 7);

async function modelFor(fetch, path) {
  const response = await fetch(path);
  assert.equal(response.status, 200);
  return buildCardRewardsModel(readCardRewards(await response.json()));
}

test("the household is one picture; miles and cashback are totalled apart; each total names its entries", async (t) => {
  const { fetch, api } = await openSeededDatabase(t, template);
  const lady = await createEntry(api, { date: `${thisMonth}-01`, description: "SONG FA BAK KUT TEH", accountName: "UOB Lady's", categoryName: "Food & Drinks", amountMinor: 20_000, ownerName: "Joyce" });
  const citi = await createEntry(api, { date: `${thisMonth}-01`, description: "AMAZE*SHOPEE", accountName: "Citi Rewards", categoryName: "Shopping", amountMinor: 10_000, ownerName: "Joyce" });
  const one = await createEntry(api, { date: `${thisMonth}-01`, description: "FAIRPRICE", accountName: "UOB One", categoryName: "Groceries", amountMinor: 30_000, ownerName: "Tim" });
  const model = await modelFor(fetch, "/api/card-rewards?view=household");
  assert.equal(model.pictures.length, 1);
  const [picture] = model.pictures;
  assert.equal(picture.personId, "household");
  assert.equal(picture.name, "");
  // 200 dollars at 4 miles on Food and 100 online at 4: at least 1,200 miles.
  assert.ok(picture.milesTotal.amount >= 1_200, String(picture.milesTotal.amount));
  assert.ok([lady, citi].every((id) => picture.milesTotal.ids.includes(id)));
  assert.ok(!picture.milesTotal.ids.includes(one), "cashback spending is not in the miles total");
  assert.deepEqual(picture.cashbackTotal.ids, [one]);
  assert.ok(picture.cashbackTotal.amount > 0 && picture.cashbackTotal.amount < 300);
  assert.equal(picture.cards[0].unit, "miles");
  assert.ok(picture.phoneCards.length <= 3);
});

test("each person's own cards make one picture each; no answer is no model", async (t) => {
  const { fetch, api } = await openSeededDatabase(t, template);
  const saved = await api("/api/card-rewards/suggest-from", { from: "own" });
  assert.equal(saved.status, 200);
  const model = await modelFor(fetch, "/api/card-rewards?view=household");
  assert.deepEqual(model.pictures.map((picture) => picture.personId).sort(), ["person-joyce", "person-tim"]);
  assert.equal(model.suggestFrom, "own");
  assert.equal(buildCardRewardsModel(null), null);
});

test("the words are plain: rates in miles a dollar, an estimate that defers to the statement", () => {
  assert.equal(copy.finalWord, "An estimate from your entries. Your card statement's points are the final word.");
  assert.equal(formatMiles(1234.9), "1,234");
  assert.equal(formatMiles(-5), "0");
  assert.equal(bonusWhat({ categories: ["Food & Drinks"], channels: [], match: "both" }), "Food & Drinks");
  assert.equal(bonusWhat({ categories: [], channels: ["online", "contactless"], match: "both" }), "spending online or by tap");
  assert.equal(
    copy.settings.summary({ unit: "miles", baseRate: 0.4, bonuses: [{ rate: 4, categories: ["Food & Drinks"], channels: [], match: "both", capMinor: 100_000, cycle: { kind: "calendar", day: 1 } }] }, (minor) => `$${minor / 100}`),
    "Miles · 0.4 a dollar, 4 on Food & Drinks up to $1000 a month"
  );
});
