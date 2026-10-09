import assert from "node:assert/strict";
import test from "node:test";

import { attemptParse, chooseImageStatementParse } from "../src/client/import-ocr-passes.js";

const ADDS_UP_FIRST = { parsed: { rows: ["first"] } };
const ADDS_UP_BOTH = { parsed: { rows: ["both"] } };
const REVIEW_FIRST = { parsed: { rows: ["first"], reconciliation: { candidates: [] } } };
const REVIEW_BOTH = { parsed: { rows: ["both"], reconciliation: { candidates: [] } } };

test("a two-pass reading that adds up wins", () => {
  assert.equal(chooseImageStatementParse(REVIEW_FIRST, ADDS_UP_BOTH), ADDS_UP_BOTH.parsed);
  assert.equal(chooseImageStatementParse(ADDS_UP_FIRST, ADDS_UP_BOTH), ADDS_UP_BOTH.parsed);
});

test("a first pass that adds up beats a two-pass reading that needs review", () => {
  assert.equal(chooseImageStatementParse(ADDS_UP_FIRST, REVIEW_BOTH), ADDS_UP_FIRST.parsed);
  assert.equal(chooseImageStatementParse(ADDS_UP_FIRST, { error: new Error("two-pass failed") }), ADDS_UP_FIRST.parsed);
});

test("when neither adds up, the two-pass reading goes to review", () => {
  assert.equal(chooseImageStatementParse(REVIEW_FIRST, REVIEW_BOTH), REVIEW_BOTH.parsed);
  assert.equal(chooseImageStatementParse(REVIEW_FIRST, { error: new Error("two-pass failed") }), REVIEW_FIRST.parsed);
});

test("when nothing parses, the two-pass error is reported", () => {
  const firstError = new Error("first");
  const bothError = new Error("both");
  assert.throws(() => chooseImageStatementParse({ error: firstError }, { error: bothError }), (error) => error === bothError);
  assert.deepEqual(attemptParse(() => { throw firstError; }, "x"), { error: firstError });
  assert.deepEqual(attemptParse((text) => ({ text }), "x"), { parsed: { text: "x" } });
});
