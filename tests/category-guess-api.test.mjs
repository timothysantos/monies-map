// The client's best-guess request (category-guess-api.js): it asks once with a
// trimmed description and fails soft, so the list is plain when anything goes
// wrong (AGENTS.md: the normal workflow never depends on a guess).
import assert from "node:assert/strict";
import test from "node:test";

import { CATEGORY_GUESS_ENDPOINT, requestCategoryGuess } from "../src/client/category-guess-api.js";

const answer = (body, ok = true) => async () => ({ ok, json: async () => body });

test("it posts the trimmed description and returns the category name", async () => {
  let seen;
  const fetchImpl = async (url, init) => {
    seen = { url, init };
    return { ok: true, json: async () => ({ ok: true, guess: { categoryName: "Groceries", source: "rule" } }) };
  };
  assert.equal(await requestCategoryGuess("  Ntuc Fairprice  ", { fetchImpl }), "Groceries");
  assert.equal(seen.url, CATEGORY_GUESS_ENDPOINT);
  assert.equal(seen.init.method, "POST");
  assert.deepEqual(JSON.parse(seen.init.body), { description: "Ntuc Fairprice" });
});

test("no guess, a refusal, a bad body, a network failure and an empty or oversized description all give null", async () => {
  assert.equal(await requestCategoryGuess("Shop", { fetchImpl: answer({ ok: true, guess: null }) }), null);
  assert.equal(await requestCategoryGuess("Shop", { fetchImpl: answer({ ok: false, error: "x" }, false) }), null);
  assert.equal(await requestCategoryGuess("Shop", { fetchImpl: answer({ ok: true, guess: { categoryName: 5 } }) }), null);
  assert.equal(await requestCategoryGuess("Shop", { fetchImpl: async () => { throw new Error("offline"); } }), null);
  let called = false;
  const spy = async () => { called = true; return { ok: true, json: async () => ({}) }; };
  assert.equal(await requestCategoryGuess("   ", { fetchImpl: spy }), null);
  assert.equal(await requestCategoryGuess("x".repeat(241), { fetchImpl: spy }), null);
  assert.equal(called, false, "nothing is sent for an empty or oversized description");
});
