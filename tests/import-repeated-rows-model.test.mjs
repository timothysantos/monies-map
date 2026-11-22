import assert from "node:assert/strict";
import test from "node:test";

import { findRepeatedPreviewRows } from "../src/client/import-repeated-rows-model.js";
import { importMessages } from "../src/client/copy/en-SG-imports.js";

const row = (rowId, overrides = {}) => ({
  rowId,
  accountId: "acct-privi",
  date: "2026-10-25",
  description: "GRAB MAKATI",
  amountMinor: 306,
  entryType: "expense",
  commitStatus: "included",
  ...overrides
});

test("rows that are the same in every way are grouped, with how many could be copies", () => {
  const result = findRepeatedPreviewRows([
    row("a"), row("b"), row("c", { description: " grab makati " }),
    row("d", { amountMinor: 900 }), row("e", { amountMinor: 900 }),
    row("f", { description: "KOPITIAM" })
  ]);
  assert.equal(result.extraRowCount, 3);
  assert.deepEqual(result.groups.map((group) => group.rowIds), [["a", "b", "c"], ["d", "e"]]);
  assert.equal(result.moreGroupCount, 0);
});

test("negative: a different account, day, amount or direction is not a repeat, and skipped rows do not count", () => {
  const result = findRepeatedPreviewRows([
    row("a"),
    row("b", { accountId: "acct-one" }),
    row("c", { date: "2026-10-26" }),
    row("d", { amountMinor: 307 }),
    row("e", { entryType: "income" }),
    row("f", { commitStatus: "skipped" })
  ]);
  assert.deepEqual(result, { extraRowCount: 0, groups: [], moreGroupCount: 0 });
});

test("only the first three groups are listed; the rest are counted", () => {
  const rows = [1, 2, 3, 4, 5].flatMap((n) => [row(`x${n}`, { amountMinor: n }), row(`y${n}`, { amountMinor: n })]);
  const result = findRepeatedPreviewRows(rows);
  assert.equal(result.extraRowCount, 5);
  assert.equal(result.groups.length, 3);
  assert.equal(result.moreGroupCount, 2);
});

test("the note says nothing was dropped and what to do, in plain words", () => {
  assert.equal(
    importMessages.repeatedRowsNote(1),
    "1 row in this file looks the same as another row in it. Banks do list two identical payments on one day, so both are kept. If one is a copy, skip it in Edit rows."
  );
  assert.match(importMessages.repeatedRowsNote(3), /^3 rows in this file look the same as another row in it\./);
  assert.equal(importMessages.repeatedRowsGroup("GRAB MAKATI", "25 Oct 2026", "$3.06", 2), "GRAB MAKATI on 25 Oct 2026 ($3.06), 2 times");
});
