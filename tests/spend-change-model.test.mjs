import assert from "node:assert/strict";
import test from "node:test";

import { buildSpendChangeNote } from "../src/client/spend-change-model.js";

const change = (currentMinor, previousMinor, extra = {}) => ({ months: 6, currentMinor, previousMinor, partial: false, ...extra });

test("spending down is a mint arrow down, spending up is a rose arrow up, to a whole percent", () => {
  assert.deepEqual(buildSpendChangeNote(change(940_000, 1_000_000)), { arrow: "▼", percent: 6, tone: "mint", months: 6, partial: false });
  assert.deepEqual(buildSpendChangeNote(change(1_120_000, 1_000_000)), { arrow: "▲", percent: 12, tone: "rose", months: 6, partial: false });
});

test("the note says when the month in progress was left out", () => {
  assert.equal(buildSpendChangeNote(change(940_000, 1_000_000, { partial: true })).partial, true);
});

test("no note without history, with money hidden, with no whole-percent move, or on a tiny base", () => {
  assert.equal(buildSpendChangeNote(undefined), null);
  assert.equal(buildSpendChangeNote(change(940_000, 1_000_000), { hidden: true }), null);
  assert.equal(buildSpendChangeNote(change(1_002_000, 1_000_000)), null);
  assert.equal(buildSpendChangeNote(change(9_000, 5_000)), null);
  assert.equal(buildSpendChangeNote(change(10_000, 0)), null);
});
