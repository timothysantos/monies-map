// The one list of Summary card titles and subtitles (design.md "Summary card
// titles"): every registered card has both, a title is a short name in
// sentence case (no "The", no time word), and the live subtitles read their
// months and year from the data.
import assert from "node:assert/strict";
import test from "node:test";

import { SUMMARY_CARD_IDS } from "../src/client/summary-card-order.js";
import { cardSubtitle, cardTitle, MONTH_CARD_TITLES, SUMMARY_CARD_TITLES } from "../src/client/copy/summary-card-titles.js";
import { findRetiredNames } from "../src/domain/retired-names.ts";

const CONTEXT = { first: "2025-12", last: "2026-11", month: "2026-11", baseMonth: "2026-10", year: 2026 };

test("every registered Summary card, and the Simple form of the plan card, has a title and a subtitle", () => {
  for (const id of [...SUMMARY_CARD_IDS, "planSimple"]) {
    assert.ok(SUMMARY_CARD_TITLES[id], `${id} is in the list`);
    assert.ok(cardTitle(id).length > 0, `${id} has a title`);
    assert.ok(cardSubtitle(id, CONTEXT).length > 0, `${id} has a subtitle`);
    // With no live words (the Arrange cards list) it still reads.
    assert.ok(cardSubtitle(id).length > 0, `${id} has a subtitle without data`);
  }
  assert.deepEqual(Object.keys(SUMMARY_CARD_TITLES).sort(), [...SUMMARY_CARD_IDS, "planSimple"].sort(), "nothing in the list is unregistered");
});

test("a title is a short name: no 'The', no period word at the end, sentence case, no retired name", () => {
  for (const [id, { title }] of Object.entries(SUMMARY_CARD_TITLES)) {
    assert.ok(!/^the\b/i.test(title), `${id}: "${title}" starts with The`);
    assert.ok(!/\b(this|year|month|shown)$/i.test(title), `${id}: "${title}" ends with a period word`);
    assert.ok(!/\bby month\b/i.test(title), `${id}: the period belongs in the subtitle`);
    const words = title.split(" ").slice(1);
    assert.ok(words.every((word) => word === word.toLowerCase()), `${id}: "${title}" is not sentence case`);
    assert.deepEqual(findRetiredNames(title), [], `${id}: "${title}" is a retired name`);
  }
});

test("the owner's list, title and subtitle, word for word", () => {
  assert.deepEqual(
    Object.entries(SUMMARY_CARD_TITLES).map(([id, { title }]) => [id, title, cardSubtitle(id, CONTEXT)]),
    [
      ["insights", "Money insights", "Needs a look, and went well"],
      ["plan", "Plan vs actual", "By month, Dec 2025 to Nov 2026"],
      ["planSimple", "Earned vs spent", "By month, Dec 2025 to Nov 2026"],
      ["changed", "What changed", "November so far, against the same days of October"],
      ["mix", "Spending mix", "By category, Dec 2025 to Nov 2026"],
      ["subs", "Subscriptions and bills", "A month"],
      ["coming", "Coming up", "Next 30 days"],
      ["investments", "Investments", "On the latest statements"],
      ["miles", "Miles and cashback", "This month, estimate"],
      ["taxreliefs", "Tax reliefs", "For 2026"],
      ["bankfees", "Bank fees", "This year"],
      ["splits", "Splits", "Who owes whom right now"],
      ["accounts", "Accounts", "Balances on the latest statements"]
    ]
  );
});

test("live subtitles follow their data: one month reads once, Coming up counts its days, a missing year does not print undefined", () => {
  assert.equal(cardSubtitle("plan", { first: "2026-11", last: "2026-11" }), "By month, Nov 2026");
  assert.equal(cardSubtitle("coming", { days: 10 }), "Next 10 days");
  assert.equal(cardSubtitle("taxreliefs", {}), "For this year");
  assert.equal(cardSubtitle("changed", { month: "2026-03", baseMonth: "2026-02" }), "March so far, against the same days of February");
  for (const id of SUMMARY_CARD_IDS) assert.ok(!/undefined|NaN/.test(cardSubtitle(id)), id);
});

test("the old names are gone: Intent vs Outcome is retired, and its replacement is not", () => {
  assert.equal(findRetiredNames("Intent vs Outcome").length, 1);
  assert.deepEqual(findRetiredNames("Plan vs actual"), []);
});

test("the Month page's own cards wear the same head from the same list: short names, a basis line, the month when given", () => {
  assert.deepEqual(
    Object.keys(MONTH_CARD_TITLES).map((id) => [id, cardTitle(id), cardSubtitle(id, { month: "2025-10" }), cardSubtitle(id)]),
    [
      ["moneyIn", "Money in", "By source, Oct 2025", "By source"],
      ["monthNote", "Monthly note", "Why the month looked like this", "Why the month looked like this"]
    ]
  );
  for (const [id, { title }] of Object.entries(MONTH_CARD_TITLES)) {
    assert.ok(!SUMMARY_CARD_TITLES[id], `${id} is not also a Summary card`);
    assert.deepEqual(findRetiredNames(title), [], `${id}: "${title}" is a retired name`);
    assert.ok(title.split(" ").slice(1).every((word) => word === word.toLowerCase()), `${id}: "${title}" is not sentence case`);
  }
  // The Month's Spending mix reads Summary's entry with one month.
  assert.equal(cardSubtitle("mix", { first: "2025-10", last: "2025-10" }), "By category, Oct 2025");
});
