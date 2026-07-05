import assert from "node:assert/strict";
import test from "node:test";

import {
  isCategoryMatchSuggestionCoveredByRule
} from "../src/domain/app-repository-category-match-rules.ts";

function suggestion(overrides = {}) {
  return {
    pattern: "MA MUM SINGAPORE",
    categoryName: "Food & Drinks",
    sampleDescriptions: ["MA MUM SINGAPORE"],
    ...overrides
  };
}

function rule(overrides = {}) {
  return {
    id: "rule-1",
    pattern: "MA MUM SINGAPORE SG",
    categoryId: "cat-food",
    categoryName: "Food & Drinks",
    priority: 100,
    isActive: true,
    ...overrides
  };
}

test("category suggestion is covered when an active same-category rule has a longer overlapping pattern", () => {
  assert.equal(
    isCategoryMatchSuggestionCoveredByRule(suggestion(), [rule()]),
    true
  );
});

test("category suggestion is covered when an active same-category rule matches a sample description", () => {
  assert.equal(
    isCategoryMatchSuggestionCoveredByRule(
      suggestion({
        pattern: "MA MUM",
        sampleDescriptions: ["CARD MA MUM SINGAPORE SG AUTH"]
      }),
      [rule()]
    ),
    true
  );
});

test("category suggestion is not covered by inactive or wrong-category rules", () => {
  assert.equal(
    isCategoryMatchSuggestionCoveredByRule(suggestion(), [
      rule({ isActive: false }),
      rule({ categoryName: "Shopping" })
    ]),
    false
  );
});

test("category suggestion keeps genuinely new merchant text visible", () => {
  assert.equal(
    isCategoryMatchSuggestionCoveredByRule(
      suggestion({
        pattern: "NEW CAFE",
        sampleDescriptions: ["NEW CAFE SG"]
      }),
      [rule()]
    ),
    false
  );
});
