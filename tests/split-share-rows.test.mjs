// The Splits create expense card shows each person's share as a row
// ("Tim's share 25% · $21.60") and a shares chip ("25 / 75"), and a share
// row opens a small editor whose percent and amount stay linked. The rows
// are read from the draft the existing share calculation keeps
// (split-share-state.js through updateSplitExpenseDraft), so the shares the
// card shows and saves are the ones the old form showed and saved.
import assert from "node:assert/strict";
import test from "node:test";

import { updateSplitExpenseDraft } from "../src/client/split-editing.js";
import { buildSplitShareState } from "../src/client/split-share-state.js";
import { buildSplitShareRows, formatShareRatio } from "../src/client/split-share-rows.js";

const people = [{ id: "person-tim", name: "Tim" }, { id: "person-joyce", name: "Joyce" }];

function newDraft(patch = {}) {
  return {
    kind: "expense",
    currency: "SGD",
    sharePersonName: "Tim",
    amountMinor: 0,
    ...buildSplitShareState({ totalAmountMinor: 0, splitBasisPoints: 5000, splitValueMode: "percent" }),
    ...patch
  };
}

// The edits the share editor makes, in the order a person types them: the
// same calls and arguments the old form's fields made.
function typeTotal(draft, text) {
  return updateSplitExpenseDraft(draft, { amountInput: text, amountMinor: Math.round(Number(text) * 100) });
}
function typePercent(draft, text) {
  const typed = updateSplitExpenseDraft(draft, { splitPercentInput: text, splitBasisPoints: Math.round(Number(text || 0) * 100) }, "percent");
  return updateSplitExpenseDraft(typed, { splitPercentInput: String(Number(typed.splitBasisPoints ?? 5000) / 100) }, "percent", { commit: true });
}
function typeShareAmount(draft, text) {
  const typed = updateSplitExpenseDraft(draft, { splitAmountInput: text, splitAmountMinor: Math.round(Number(text) * 100) }, "amount");
  return updateSplitExpenseDraft(typed, { splitAmountInput: (Number(typed.splitAmountMinor ?? 0) / 100).toFixed(2) }, "amount", { commit: true });
}

const sum = (rows) => rows.reduce((total, row) => total + row.amountMinor, 0);

test("an even split of a yen total shows two equal shares that add up to the total", () => {
  const draft = typeTotal(newDraft({ currency: "JPY" }), "12000");
  const rows = buildSplitShareRows(draft, people);

  assert.deepEqual(rows, [
    { personName: "Tim", basisPoints: 5000, percentLabel: "50%", amountMinor: 600_000, isPrimary: true },
    { personName: "Joyce", basisPoints: 5000, percentLabel: "50%", amountMinor: 600_000, isPrimary: false }
  ]);
  assert.equal(sum(rows), draft.amountMinor);
  assert.equal(formatShareRatio(rows), "50 / 50");
  // What is saved is what the old form saved for 50%.
  assert.deepEqual({ splitBasisPoints: draft.splitBasisPoints, splitAmountMinor: draft.splitAmountMinor }, { splitBasisPoints: 5000, splitAmountMinor: 600_000 });
});

test("an uneven split typed as a percent keeps the amount in step, and the other share is the rest", () => {
  const draft = typePercent(typeTotal(newDraft(), "86.40"), "25");
  const rows = buildSplitShareRows(draft, people);

  assert.equal(draft.splitAmountInput, "21.60");
  assert.deepEqual(rows.map((row) => [row.personName, row.percentLabel, row.amountMinor]), [["Tim", "25%", 2160], ["Joyce", "75%", 6480]]);
  assert.equal(sum(rows), 8640);
  assert.equal(formatShareRatio(rows), "25 / 75");
  assert.deepEqual({ splitBasisPoints: draft.splitBasisPoints, splitAmountMinor: draft.splitAmountMinor }, { splitBasisPoints: 2500, splitAmountMinor: 2160 });
});

test("a share typed as an amount moves the percent, as the old exact amount field did", () => {
  const draft = typeShareAmount(typeTotal(newDraft(), "86.40"), "30");
  const rows = buildSplitShareRows(draft, people);

  assert.equal(draft.splitValueMode, "amount");
  assert.equal(draft.splitPercentInput, "34.72");
  assert.deepEqual(rows.map((row) => [row.percentLabel, row.amountMinor]), [["34.72%", 3000], ["65.28%", 5640]]);
  assert.equal(sum(rows), 8640);
});

test("an odd cent goes to the second person on an even split and the shares still add up", () => {
  const draft = typeTotal(newDraft(), "10.01");
  const rows = buildSplitShareRows(draft, people);
  assert.deepEqual(rows.map((row) => row.amountMinor), [500, 501]);
  assert.equal(sum(rows), 1001);
});

test("a share larger than the total is held at the total, so the shares can never add up to more", () => {
  const draft = typeShareAmount(typeTotal(newDraft(), "20"), "35");
  const rows = buildSplitShareRows(draft, people);
  assert.deepEqual(rows.map((row) => [row.percentLabel, row.amountMinor]), [["100%", 2000], ["0%", 0]]);
  assert.equal(sum(rows), 2000);

  const overPercent = typePercent(typeTotal(newDraft(), "20"), "140");
  assert.deepEqual(buildSplitShareRows(overPercent, people).map((row) => row.amountMinor), [2000, 0]);
});

test("before a total is typed the rows keep the chosen percent with nothing owed", () => {
  const rows = buildSplitShareRows(typePercent(newDraft(), "40"), people);
  assert.deepEqual(rows.map((row) => [row.percentLabel, row.amountMinor]), [["40%", 0], ["60%", 0]]);
  assert.equal(formatShareRatio(rows), "40 / 60");
});

test("the share person leads even when they are not first in the household", () => {
  const draft = typeTotal(newDraft({ sharePersonName: "Joyce" }), "50");
  assert.deepEqual(buildSplitShareRows(draft, people).map((row) => row.personName), ["Joyce", "Tim"]);
});

test("one person, or no draft, has no share rows", () => {
  assert.deepEqual(buildSplitShareRows(typeTotal(newDraft(), "12"), [people[0]]), []);
  assert.deepEqual(buildSplitShareRows(null, people), []);
  assert.equal(formatShareRatio([]), "");
});
