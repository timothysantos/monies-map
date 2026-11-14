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
  assert.equal(writeSummaryCards(readSummaryCards("insights,plan,changed,mix,subs,coming,investments,miles,taxreliefs,bankfees,splits,accounts")), null);
});

test("a stored order and hidden cards read back as stored", () => {
  assert.equal(ids(readSummaryCards("insights,mix,changed,subs,investments,taxreliefs,plan,-accounts")), "insights,mix,changed,subs,coming,investments,miles,taxreliefs,bankfees,splits,plan,-accounts");
  assert.equal(writeSummaryCards(readSummaryCards("mix,insights,-changed,-subs,-taxreliefs,investments,plan,accounts")), "mix,insights,-changed,-subs,coming,-taxreliefs,bankfees,splits,investments,miles,plan,accounts");
});

test("unknown ids are dropped, a card it does not name goes to its usual place, and Money insights is never hidden", () => {
  // Saved before What changed this month, Subscriptions and bills,
  // Investments over time and Tax reliefs this year existed: each comes back shown, in its usual place.
  assert.equal(ids(readSummaryCards("insights,mix,plan,-accounts")), "insights,mix,subs,coming,investments,miles,taxreliefs,bankfees,splits,plan,changed,-accounts");
  assert.equal(ids(readSummaryCards("mix,insights,subs,plan,accounts")), "mix,insights,subs,coming,investments,miles,taxreliefs,bankfees,splits,plan,changed,accounts");
  assert.equal(ids(readSummaryCards("mix,trips,plan")), "insights,mix,subs,coming,investments,miles,taxreliefs,bankfees,splits,accounts,plan,changed");
  assert.equal(ids(readSummaryCards("-insights,mix")), "insights,plan,changed,mix,subs,coming,investments,miles,taxreliefs,bankfees,splits,accounts");
  assert.equal(ids(readSummaryCards("mix,mix,plan")), "insights,mix,subs,coming,investments,miles,taxreliefs,bankfees,splits,accounts,plan,changed");
  for (const bad of ["", "Mix", "mix;plan", "x".repeat(200), 42, "<script>"]) {
    assert.equal(isSummaryCardsValue(bad), false, String(bad));
    assert.equal(ids(readSummaryCards(bad)), SUMMARY_CARD_IDS.join(","));
  }
});

test("moving a card swaps it with its neighbour; the ends do not move", () => {
  const cards = readSummaryCards(null);
  assert.equal(ids(moveSummaryCard(cards, 3, -1)), "insights,plan,mix,changed,subs,coming,investments,miles,taxreliefs,bankfees,splits,accounts");
  assert.equal(moveSummaryCard(cards, 0, -1), cards);
  assert.equal(moveSummaryCard(cards, cards.length - 1, 1), cards);
});

test("hiding every card the editor allows still fits what the server accepts", () => {
  const value = writeSummaryCards(readSummaryCards(SUMMARY_CARD_IDS.map((id) => `-${id}`).join(",")));
  assert.equal(isSummaryCardsValue(value), true, value);
  assert.ok(SUMMARY_CARD_IDS.length <= 12, "the stored pattern allows at most 12 cards");
});

import { packSummarySpans, showsAsTile, SUMMARY_CARD_LAYOUT, SUMMARY_LEAD_SPAN, summarySpanFor, summaryTileFromHash, summaryTileHash } from "../src/client/summary-card-order.js";

test("every registered card has a default span of the 12-column grid, a minimum width, and a tile or no tile", () => {
  for (const id of SUMMARY_CARD_IDS) {
    const layout = SUMMARY_CARD_LAYOUT[id];
    assert.ok([4, 6, 8, 12].includes(layout.span), `${id} span ${layout.span}`);
    assert.ok(layout.minWidth >= 240 && layout.minWidth <= 600, `${id} minWidth`);
    assert.ok(Boolean(layout.tile) !== Boolean(layout.noTile), `${id} has a tile or says noTile, not both`);
  }
  assert.deepEqual(Object.keys(SUMMARY_CARD_LAYOUT), [...SUMMARY_CARD_IDS]);
  assert.equal(SUMMARY_LEAD_SPAN, 8);
});

test("the usual order fills 12-column rows exactly on a desktop: lead 8 + insights 4, chart 8 + changed 4, Spending Mix 6 + Subscriptions 6, one block of tiles, the accounts", () => {
  // Cards that are tiles sit together as one full-width block.
  const spans = [SUMMARY_LEAD_SPAN, 4, 8, 4, 6, 6, 12, 6];
  assert.deepEqual(packSummarySpans(spans, 12), [8, 4, 8, 4, 6, 6, 12, 12]);
  assert.deepEqual(packSummarySpans(spans, 2), [2, 2, 2, 1, 1, 2, 2, 2]);
});

test("a hidden card leaves no hole: the last card of a short row grows, and nothing moves out of order", () => {
  // Changed hidden: the plan card (8) shares its row with Spending Mix (6), which cannot fit, so it takes its row alone.
  assert.deepEqual(packSummarySpans([8, 4, 8, 6, 6, 6, 6, 6, 6], 12), [8, 4, 12, 6, 6, 6, 6, 6, 6]);
  // An odd card out of the 6s takes the whole last row.
  assert.deepEqual(packSummarySpans([8, 4, 8, 4, 6, 6, 6, 6, 6], 12), [8, 4, 8, 4, 6, 6, 6, 6, 12]);
  // A 6 and a 4 in a row: the 4 grows to the end of the row.
  assert.deepEqual(packSummarySpans([6, 4, 6, 6], 12), [6, 6, 6, 6]);
  // Insights moved away from the lead: the lead takes the row.
  assert.deepEqual(packSummarySpans([8, 8, 4], 12), [12, 8, 4]);
});

test("a tablet has two columns and a phone one; two thirds and wider take the whole tablet row", () => {
  assert.equal(summarySpanFor(8, 2), 2);
  assert.equal(summarySpanFor(12, 2), 2);
  assert.equal(summarySpanFor(6, 2), 1);
  assert.equal(summarySpanFor(4, 2), 1);
  assert.equal(summarySpanFor(8, 1), 1);
  assert.deepEqual(packSummarySpans([8, 4, 8, 4, 6, 6, 6, 6, 6, 6], 2), [2, 2, 2, 1, 1, 1, 1, 1, 1, 2]);
  assert.deepEqual(packSummarySpans([8, 4, 8, 4, 6, 6, 6, 6, 6, 6], 1), Array(10).fill(1));
  // An odd one out grows to fill its tablet row.
  assert.deepEqual(packSummarySpans([8, 4, 4, 4], 2), [2, 1, 1, 2]);
});

test("a card draws as its tile where the registry says: always, or only below a desktop; a card with no tile never", () => {
  for (const id of ["coming", "investments", "miles", "taxreliefs", "bankfees", "splits"]) {
    assert.equal(showsAsTile(id, true), true, `${id} on a desktop`);
    assert.equal(showsAsTile(id, false), true, `${id} on a phone`);
  }
  assert.equal(showsAsTile("subs", true), false, "Subscriptions and bills is a big card on a desktop");
  assert.equal(showsAsTile("subs", false), true, "and a tile on a phone");
  for (const id of ["insights", "plan", "changed", "mix", "accounts"]) {
    assert.equal(showsAsTile(id, false), false, id);
  }
  assert.equal(showsAsTile("nothing", false), false);
});

test("a tile's sheet is linked by a plain hash: only a registered card with a tile, ASCII letters and hyphens", () => {
  assert.equal(summaryTileHash("subs"), "#summary-subs");
  assert.equal(summaryTileFromHash("#summary-subs"), "subs");
  assert.equal(summaryTileFromHash("#summary-coming"), "coming");
  for (const hash of ["", "#", "#summary-", "#summary-mix", "#summary-plan", "#summary-nothing", "#summary-Subs", "#summary-subs1", "#summary-subs/x", "#month-2026-05", undefined, null]) {
    assert.equal(summaryTileFromHash(hash), "", String(hash));
  }
});
