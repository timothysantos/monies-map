// U9 (UI audit): a value stored as a code (credit_card, a category slug, a hex
// colour, an entry type) reaches the screen as a human label from one label
// map, never as the code.
import assert from "node:assert/strict";
import { register } from "node:module";
import test from "node:test";

import * as React from "react";

register("data:text/javascript," + encodeURIComponent(
  "export async function load(url, context, next) { return url.endsWith('.css') ? { format: 'module', source: '', shortCircuit: true } : next(url, context); }"
));
globalThis.React = React;

const {
  ACCOUNT_KIND_LABELS,
  ENTRY_TYPE_LABELS,
  SPLIT_HISTORY_ACTION_LABELS,
  accountKindLabel,
  entryTypeLabel,
  humanizeEnum,
  splitHistoryActionLabel
} = await import("../src/client/enum-labels.js");
const { ACCOUNT_KIND_OPTIONS, ICON_OPTIONS } = await import("../src/client/ui-options.jsx");
const { categoryRowDetail } = await import("../src/client/category-utils.js");
const { getEntryTypeOptions } = await import("../src/client/entry-type-options.js");

test("account kinds read as words and agree with the Add account picker", () => {
  assert.equal(accountKindLabel("credit_card"), "Credit card");
  assert.equal(accountKindLabel("bank"), "Bank");
  assert.equal(accountKindLabel("loan"), "Loan");
  assert.equal(accountKindLabel("cash"), "Cash");
  assert.equal(accountKindLabel("investment"), "Investment");
  // One map feeds the picker and the account rows.
  assert.deepEqual(
    ACCOUNT_KIND_OPTIONS.map((option) => [option.value, option.label]),
    Object.entries(ACCOUNT_KIND_LABELS)
  );
});

test("entry types and split history actions use their label maps", () => {
  assert.deepEqual(ENTRY_TYPE_LABELS, { expense: "Expense", income: "Income", transfer: "Transfer" });
  assert.equal(entryTypeLabel("transfer"), "Transfer");
  assert.deepEqual(
    getEntryTypeOptions({ entryType: "expense" }).map((option) => option.label),
    ["Expense", "Income", "Transfer"]
  );
  assert.deepEqual(SPLIT_HISTORY_ACTION_LABELS, { created: "Created", updated: "Updated", deleted: "Deleted", restored: "Restored" });
  assert.equal(splitHistoryActionLabel("restored"), "Restored");
});

test("a code with no label is spelled out as words, never shown raw", () => {
  assert.equal(humanizeEnum("future_kind"), "Future kind");
  assert.equal(humanizeEnum("planned-item"), "Planned item");
  assert.equal(accountKindLabel("money_market"), "Money market");
  assert.equal(entryTypeLabel("refund_pending"), "Refund pending");
  for (const value of ["credit_card", "money_market", "a_b_c"]) {
    assert.doesNotMatch(accountKindLabel(value), /_/);
  }
  assert.equal(accountKindLabel(""), "");
  assert.equal(accountKindLabel(null), "");
  assert.equal(entryTypeLabel(undefined), "");
});

test("a category row shows its icon's label, never the slug, icon key or hex", () => {
  const food = { name: "Dining out", slug: "dining-out", iconKey: "utensils", colorHex: "#BF7D51" };
  const detail = categoryRowDetail(food);
  assert.equal(detail, "Icon: Food");
  assert.doesNotMatch(detail, /dining-out|utensils|#|BF7D51/);
  // The icon label is the one the picker uses.
  assert.equal(`Icon: ${ICON_OPTIONS.find((option) => option.key === "utensils").label}`, detail);
});

test("a category row says nothing when the icon label repeats its name or the icon is unknown", () => {
  assert.equal(categoryRowDetail({ name: "Groceries", slug: "groceries", iconKey: "shopping-cart", colorHex: "#27725F" }), "");
  assert.equal(categoryRowDetail({ name: "groceries", slug: "g", iconKey: "shopping-cart", colorHex: "#27725F" }), "");
  assert.equal(categoryRowDetail({ name: "Mystery", slug: "mystery", iconKey: "not-an-icon", colorHex: "#27725F" }), "");
  assert.equal(categoryRowDetail({ name: "Mystery", slug: "mystery" }), "");
});
