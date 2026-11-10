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
  assert.equal(writeSummaryCards(readSummaryCards("insights,changed,subs,investments,taxreliefs,mix,plan,accounts")), null);
});

test("a stored order and hidden cards read back as stored", () => {
  assert.equal(ids(readSummaryCards("insights,mix,changed,subs,investments,taxreliefs,plan,-accounts")), "insights,mix,changed,subs,investments,taxreliefs,plan,-accounts");
  assert.equal(writeSummaryCards(readSummaryCards("mix,insights,-changed,-subs,-taxreliefs,investments,plan,accounts")), "mix,insights,-changed,-subs,-taxreliefs,investments,plan,accounts");
});

test("unknown ids are dropped, a card it does not name goes to its usual place, and Money insights is never hidden", () => {
  // Saved before What changed this month, Subscriptions and bills,
  // Investments over time and Tax reliefs this year existed: each comes back shown, in its usual place.
  assert.equal(ids(readSummaryCards("insights,mix,plan,-accounts")), "insights,changed,subs,investments,taxreliefs,mix,plan,-accounts");
  assert.equal(ids(readSummaryCards("mix,insights,subs,plan,accounts")), "mix,insights,changed,subs,investments,taxreliefs,plan,accounts");
  assert.equal(ids(readSummaryCards("mix,trips,plan")), "insights,changed,subs,investments,taxreliefs,mix,plan,accounts");
  assert.equal(ids(readSummaryCards("-insights,mix")), "insights,changed,subs,investments,taxreliefs,mix,plan,accounts");
  assert.equal(ids(readSummaryCards("mix,mix,plan")), "insights,changed,subs,investments,taxreliefs,mix,plan,accounts");
  for (const bad of ["", "Mix", "mix;plan", "x".repeat(200), 42, "<script>"]) {
    assert.equal(isSummaryCardsValue(bad), false, String(bad));
    assert.equal(ids(readSummaryCards(bad)), SUMMARY_CARD_IDS.join(","));
  }
});

test("moving a card swaps it with its neighbour; the ends do not move", () => {
  const cards = readSummaryCards(null);
  assert.equal(ids(moveSummaryCard(cards, 3, -1)), "insights,changed,investments,subs,taxreliefs,mix,plan,accounts");
  assert.equal(moveSummaryCard(cards, 0, -1), cards);
  assert.equal(moveSummaryCard(cards, cards.length - 1, 1), cards);
});

test("hiding every card the editor allows still fits what the server accepts", () => {
  const value = writeSummaryCards(readSummaryCards(SUMMARY_CARD_IDS.map((id) => `-${id}`).join(",")));
  assert.equal(isSummaryCardsValue(value), true, value);
  assert.ok(SUMMARY_CARD_IDS.length <= 12, "the stored pattern allows at most 12 cards");
});
