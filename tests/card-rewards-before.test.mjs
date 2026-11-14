// Card rewards answer: each card carries what it earned over the same days of
// the cycle before (`earnedBefore`), the figure the Miles and cashback change
// note compares with (card-rewards.ts, summary-tiles-model.js).
import assert from "node:assert/strict";
import test from "node:test";

import { createSeededTemplate, openSeededDatabase } from "./support/d1-workspace.mjs";

let template;
test.before(async () => {
  template = await createSeededTemplate();
});
test.after(async () => {
  await template?.dispose();
});

const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Singapore" });
const firstOfLastMonth = () => {
  const [year, month] = today.split("-").map(Number);
  const at = new Date(Date.UTC(year, month - 2, 1));
  return `${at.getUTCFullYear()}-${String(at.getUTCMonth() + 1).padStart(2, "0")}-01`;
};

test("the card rewards answer carries earnedBefore for every card; spending on the first day of the month before counts", async (t) => {
  const app = await openSeededDatabase(t, template);
  const dining = (date, amountMinor) => app.api("/api/entries/create", {
    date, description: "SONG FA BAK KUT TEH", accountName: "UOB Lady's", categoryName: "Food & Drinks",
    entryType: "expense", ownershipType: "direct", ownerName: "Joyce", amountMinor
  });
  assert.equal((await dining(today, 38_000)).status, 200);
  assert.equal((await dining(firstOfLastMonth(), 19_000)).status, 200);
  const { status, payload } = await app.api("/api/card-rewards?view=household");
  assert.equal(status, 200);
  const cards = payload.people.flatMap((person) => person.cards);
  assert.ok(cards.length > 0);
  for (const card of cards) {
    assert.ok(Number.isInteger(card.earnedBefore) && card.earnedBefore >= 0, `${card.name} has earnedBefore`);
  }
  const ladys = cards.find((card) => card.name.includes("Lady"));
  assert.ok(ladys.earned > 0, "this month's dining earned miles");
  assert.ok(ladys.earnedBefore > 0, "last month's dining is inside the same days of that month");
  assert.ok(ladys.earnedBefore < ladys.earned, "half the spending earned about half");
  // A card with nothing in the cycle before reads 0, not missing.
  assert.ok(cards.some((card) => card.earnedBefore === 0));
});
