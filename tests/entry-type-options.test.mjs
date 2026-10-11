// The entry editor's type choices: a statement-certified entry may only be
// refiled within the direction its statement certified.
import assert from "node:assert/strict";
import test from "node:test";

import {
  getBankFactsLockMessage,
  getEntryTypeOptions,
  getTransferDirectionForTypeSwitch
} from "../src/client/entry-type-options.js";

const values = (options) => options.map((option) => option.value);

test("an unlocked entry offers every type", () => {
  assert.deepEqual(getEntryTypeOptions({ entryType: "income" }), [
    { value: "expense", label: "Expense" },
    { value: "income", label: "Income" },
    { value: "transfer", label: "Transfer" }
  ]);
});

test("a locked money-in entry offers only Income and Transfer", () => {
  assert.deepEqual(values(getEntryTypeOptions({ entryType: "income" }, { bankFactsLocked: true })), ["income", "transfer"]);
  assert.deepEqual(values(getEntryTypeOptions({ entryType: "transfer", transferDirection: "in" }, { bankFactsLocked: true })), ["income", "transfer"]);
});

test("a locked money-out entry offers only Expense and Transfer", () => {
  assert.deepEqual(values(getEntryTypeOptions({ entryType: "expense" }, { bankFactsLocked: true })), ["expense", "transfer"]);
  assert.deepEqual(values(getEntryTypeOptions({ entryType: "transfer", transferDirection: "out" }, { bankFactsLocked: true })), ["expense", "transfer"]);
});

test("switching a locked entry to Transfer keeps its money direction", () => {
  assert.equal(getTransferDirectionForTypeSwitch({ entryType: "income" }, { bankFactsLocked: true }), "in");
  assert.equal(getTransferDirectionForTypeSwitch({ entryType: "expense" }, { bankFactsLocked: true }), "out");
});

test("switching an unlocked entry to Transfer keeps the old default", () => {
  // Unchanged behaviour: an unlocked entry without a direction starts as out.
  assert.equal(getTransferDirectionForTypeSwitch({ entryType: "income" }), "out");
  assert.equal(getTransferDirectionForTypeSwitch({ entryType: "transfer", transferDirection: "in" }), "in");
});

test("the lock message names the type choice for the entry's direction", () => {
  assert.equal(
    getBankFactsLockMessage({ entryType: "transfer", transferDirection: "in" }),
    "This row is statement certified. Description, date, posted date, wallet and amount are locked to the saved statement. Type can switch between Income and Transfer in, and you can change the note, category, owner or splits."
  );
  assert.match(getBankFactsLockMessage({ entryType: "expense" }), /Type can switch between Expense and Transfer out,/);
  assert.doesNotMatch(getBankFactsLockMessage({ entryType: "expense" }), /Income/);
});
