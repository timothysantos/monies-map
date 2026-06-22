import assert from "node:assert/strict";
import test from "node:test";

import {
  compareDescriptionSimilarity,
  normalizeDescriptionForMatch
} from "../src/domain/app-repository-helpers.ts";

test("description normalization ignores statement foreign currency amount suffixes", () => {
  assert.equal(
    normalizeDescriptionForMatch("OPENAI OPENAI.COM USD 5.58"),
    normalizeDescriptionForMatch("OPENAI OPENAI.COM US")
  );
  assert.equal(compareDescriptionSimilarity("OPENAI OPENAI.COM USD 5.58", "OPENAI OPENAI.COM US"), 1);
});
