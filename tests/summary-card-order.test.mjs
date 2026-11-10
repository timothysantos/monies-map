// Arrange Summary (src/client/summary-card-order.js): reading is forgiving,
// Money insights is never hidden, a card added later goes to its usual
// place, and the usual order is stored as nothing (Reset).
import assert from "node:assert/strict";
import test from "node:test";

import { isSummaryCardsValue, moveSummaryCard, readSummaryCards, SUMMARY_CARD_IDS, writeSummaryCards } from "../src/client/summary-card-order.js";

const ids = (cards) => cards.map((card) => `${card.hidden ? "-" : ""}${card.id}`).join(",");

test("the usual order, and back to nothing when nothing changed", () => {
  assert.equal(ids(readSummaryCards(null)), SUMMARY_CARD_IDS.join(","));
  assert.equal(writeSummaryCards(readSummaryCards(null)), null);
  assert.equal(writeSummaryCards(readSummaryCards("insights,subs,mix,plan,accounts")), null);
});

test("a stored order and hidden cards read back as stored", () => {
  assert.equal(ids(readSummaryCards("insights,mix,subs,plan,-accounts")), "insights,mix,subs,plan,-accounts");
  assert.equal(writeSummaryCards(readSummaryCards("mix,insights,-subs,plan,accounts")), "mix,insights,-subs,plan,accounts");
});

test("unknown ids are dropped, a card it does not name goes to its usual place, and Money insights is never hidden", () => {
  // Saved before Subscriptions and bills existed: it comes back after insights.
  assert.equal(ids(readSummaryCards("insights,mix,plan,-accounts")), "insights,subs,mix,plan,-accounts");
  assert.equal(ids(readSummaryCards("mix,trips,plan")), "insights,subs,mix,plan,accounts");
  assert.equal(ids(readSummaryCards("-insights,mix")), "insights,subs,mix,plan,accounts");
  assert.equal(ids(readSummaryCards("mix,mix,plan")), "insights,subs,mix,plan,accounts");
  for (const bad of ["", "Mix", "mix;plan", "x".repeat(200), 42, "<script>"]) {
    assert.equal(isSummaryCardsValue(bad), false, String(bad));
    assert.equal(ids(readSummaryCards(bad)), SUMMARY_CARD_IDS.join(","));
  }
});

test("moving a card swaps it with its neighbour; the ends do not move", () => {
  const cards = readSummaryCards(null);
  assert.equal(ids(moveSummaryCard(cards, 2, -1)), "insights,mix,subs,plan,accounts");
  assert.equal(moveSummaryCard(cards, 0, -1), cards);
  assert.equal(moveSummaryCard(cards, 4, 1), cards);
});
