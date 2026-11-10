// The What changed card's client edge: the answer reader keeps only what it
// understands (and refuses what it does not), the words are plain and carry
// no retired name, and a failed read is never kept as an answer.
import assert from "node:assert/strict";
import test from "node:test";

import { summaryChangedCopy as copy } from "../src/client/copy/summary-changed-copy.js";
import { readSummaryChanged, requestSummaryChanged, summaryChangedEndpoint } from "../src/client/summary-changed-api.js";
import { findRetiredNames } from "../src/domain/retired-names.ts";
import { findAppJargon } from "../src/domain/money-signals/tone.ts";

const row = (extra = {}) => ({ category: "Food", direction: "up", diffMinor: 24_000, amountMinor: 61_000, ids: ["a", "b"], baseMinor: 37_000, baseIds: ["c"], moreThanUsual: true, shops: [{ name: "Koufu", diffMinor: 9_000, amountMinor: 12_000, ids: ["a"] }], ...extra });
const body = (rows) => ({ viewId: "household", scope: "direct_plus_shared", changed: { month: "2026-11", baseMonth: "2026-10", day: 10, rows } });

test("the reader keeps a well-formed answer and drops rows and shops it cannot read", () => {
  const answer = readSummaryChanged(body([row(), row({ category: "Home", diffMinor: "lots" }), row({ category: "Taxi", direction: "sideways" }), row({ category: "Gifts", ids: "a b", shops: [{ name: "X" }, row().shops[0]] })]));
  assert.deepEqual(answer.changed.rows.map((item) => item.category), ["Food"]);
  assert.equal(answer.changed.rows[0].shops.length, 1);
  assert.equal(answer.changed.rows[0].moreThanUsual, true);
  assert.deepEqual(readSummaryChanged({ changed: null }), { changed: null });
});

test("a body that is not an answer is refused, so a failed read leaves no answer", async () => {
  for (const bad of [null, "x", {}, { changed: "yes" }, { changed: { month: "2026-11" } }]) {
    assert.equal(readSummaryChanged(bad), null);
  }
  await assert.rejects(requestSummaryChanged("household", "direct_plus_shared", { fetchImpl: async () => ({ ok: false, status: 500 }) }), /failed \(500\)/);
  await assert.rejects(requestSummaryChanged("household", "direct_plus_shared", { fetchImpl: async () => ({ ok: true, json: async () => ({ nope: 1 }) }) }), /unreadable/);
  const good = await requestSummaryChanged("person-tim", "direct", { fetchImpl: async (url) => ({ ok: true, json: async () => ({ ...body([row()]), url }) }) });
  assert.equal(good.changed.rows.length, 1);
});

test("the request names the view, and the scope only for a person", () => {
  assert.equal(summaryChangedEndpoint("household", "direct"), "/api/summary-changed?view=household");
  assert.equal(summaryChangedEndpoint("person-tim", "direct"), "/api/summary-changed?view=person-tim&scope=direct");
});

test("the words are plain, name no retired term and never forecast or say safe to spend", () => {
  const words = [
    copy.title, copy.intro("2026-11", "2026-10"), copy.quiet, copy.up, copy.down, copy.moreThanUsual, copy.soFar, copy.lastMonth,
    copy.shopsBehind, copy.openRow("Food"), copy.showAll(7)
  ];
  assert.equal(copy.intro("2026-11", "2026-10"), "November so far, against the same days of October.");
  for (const text of words) {
    assert.deepEqual(findRetiredNames(text), [], text);
    assert.deepEqual(findAppJargon(text), [], text);
    assert.doesNotMatch(text, /safe to spend|will |forecast|predict|on track|expect/i, text);
  }
});
