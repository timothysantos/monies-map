// The check-in's visit memory lives only in localStorage, and storage can
// be missing, blocked, full or hold junk. Every case falls back to a first
// visit instead of failing.
import assert from "node:assert/strict";
import test from "node:test";

import { checkInMemoryKey, readVisitMemory, writeVisitMemory } from "../src/client/checkin-visit-memory.js";
import { composeCheckIn, emptyVisitMemory, recordVisit } from "../src/domain/money-signals/checkin.ts";

function memoryStorage() {
  const values = new Map();
  return {
    values,
    getItem: (key) => (values.has(key) ? values.get(key) : null),
    setItem: (key, value) => values.set(key, String(value))
  };
}

const throwing = {
  getItem() { throw new Error("SecurityError"); },
  setItem() { throw new Error("QuotaExceededError"); }
};

test("the memory key is per page and view, plus the group on Splits", () => {
  assert.equal(checkInMemoryKey("summary", "household"), "summary:household");
  assert.equal(checkInMemoryKey("month", "person-serene"), "month:person-serene");
  assert.equal(checkInMemoryKey("splits", "person-ethan", "split-group-japan-trip"), "splits:person-ethan:split-group-japan-trip");
});

test("a visit written to storage is read back for the next visit", () => {
  const storage = memoryStorage();
  const signals = [{ key: "plan-left", kind: "going_well", weight: 1, numbers: { primaryMinor: 1 }, phrasings: [{ fact: "A", think: "" }, { fact: "B", think: "" }, { fact: "C", think: "" }] }];
  const nowMs = Date.parse("2026-08-03T09:00:00+08:00");
  const view = composeCheckIn({ signals, memory: readVisitMemory("month:person-serene", storage), nowMs, today: "2026-08-03", seed: "s", contextKey: "2026-08", calmLine: "calm" });
  assert.equal(writeVisitMemory("month:person-serene", recordVisit(emptyVisitMemory(), view, signals, { nowMs, today: "2026-08-03", contextKey: "2026-08" }), storage), true);
  assert.deepEqual([...storage.values.keys()], ["monies-map:checkin:v1:month:person-serene"]);
  const read = readVisitMemory("month:person-serene", storage);
  assert.equal(read.lastVisitAt, nowMs);
  assert.equal(read.signals["plan-left"].shownAt, nowMs);
  // Nothing identifies the visit beyond the page's own signal keys.
  assert.doesNotMatch(storage.values.get("monies-map:checkin:v1:month:person-serene"), /http|token|@/);
});

test("missing, throwing or corrupt storage reads as a first visit and never throws", () => {
  assert.deepEqual(readVisitMemory("summary:household", null), emptyVisitMemory());
  assert.deepEqual(readVisitMemory("summary:household", throwing), emptyVisitMemory());
  assert.equal(writeVisitMemory("summary:household", emptyVisitMemory(), throwing), false);
  assert.equal(writeVisitMemory("summary:household", emptyVisitMemory(), null), true);
  const corrupt = memoryStorage();
  corrupt.setItem("monies-map:checkin:v1:summary:household", "{not json");
  assert.deepEqual(readVisitMemory("summary:household", corrupt), emptyVisitMemory());
  corrupt.setItem("monies-map:checkin:v1:summary:household", JSON.stringify({ v: 1, signals: { x: "junk" }, trivia: "junk" }));
  assert.deepEqual(readVisitMemory("summary:household", corrupt).signals, {});
});
