// Added by: an entry's source is derived on the server from its external
// reference, so a page learns "Apple Pay shortcut" or "Ask" without ever
// receiving the reference (a Shortcut request id or an Ask card id).
import assert from "node:assert/strict";
import test from "node:test";

import { entryAddedByFromReference } from "../src/domain/entry-source.ts";

test("a Shortcut reference is the Apple Pay shortcut", () => {
  assert.equal(entryAddedByFromReference("shortcut:3F2A-77"), "apple_pay_shortcut");
});

test("an Ask card reference is Ask", () => {
  assert.equal(entryAddedByFromReference("ask:card-1760000000-ab12"), "ask");
});

test("no reference has no source", () => {
  assert.equal(entryAddedByFromReference(null), null);
  assert.equal(entryAddedByFromReference(undefined), null);
  assert.equal(entryAddedByFromReference(""), null);
});

test("any other reference, a bare prefix or a different case has no source", () => {
  assert.equal(entryAddedByFromReference("import:batch-9"), null);
  assert.equal(entryAddedByFromReference("Shortcut:3F2A"), null);
  assert.equal(entryAddedByFromReference("ASK:card"), null);
  assert.equal(entryAddedByFromReference("shortcut:"), null);
  assert.equal(entryAddedByFromReference("ask:"), null);
  assert.equal(entryAddedByFromReference("myshortcut:1"), null);
});
