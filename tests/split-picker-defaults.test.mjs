import test from "node:test";
import assert from "node:assert/strict";

import { getQuickSplitGroup } from "../src/client/split-picker-defaults.js";

const groups = [
  { id: "split-group-none", name: "Non-group expenses" },
  { id: "okaeri", name: "Okaeri", isDefault: true },
  { id: "joyce", name: "Joyce" }
];

test("quick split uses the last real group when it still exists", () => {
  assert.deepEqual(getQuickSplitGroup(groups, "joyce"), groups[2]);
});

test("quick split falls back to the default real group", () => {
  assert.deepEqual(getQuickSplitGroup(groups, "missing"), groups[1]);
});

test("quick split stays unavailable when there are no real groups", () => {
  assert.equal(getQuickSplitGroup([{ id: "split-group-none", name: "Non-group expenses" }]), null);
});
