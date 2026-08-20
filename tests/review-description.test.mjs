import assert from "node:assert/strict";
import test from "node:test";

import { truncateReviewDescription } from "../src/domain/review-description.ts";

test("review descriptions stay bounded for utility page DTOs", () => {
  const description = `${"Statement disclosure text ".repeat(40)}merchant`;
  const result = truncateReviewDescription(description, 80);

  assert.equal(result.length <= 83, true);
  assert.equal(result.endsWith("..."), true);
});

test("review descriptions preserve short text exactly", () => {
  assert.equal(
    truncateReviewDescription("PAYMENT BY INTERNET", 80),
    "PAYMENT BY INTERNET"
  );
});
