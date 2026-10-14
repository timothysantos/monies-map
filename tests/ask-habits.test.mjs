// Ask habits (DOMAIN.md "Ask Habit"): the pure rules. Keys never carry a
// number, confidence counts consistent confirmations since the last
// override, and the safe-set gate refuses every case the owner's decision
// excludes (setting off, not a safe action, bulk, imported, certified, old,
// not an expense, low confidence).
import assert from "node:assert/strict";
import test from "node:test";

import {
  ASK_SAFE_ACTIONS,
  autoApplyRefusal,
  canonicalHabitValue,
  confirmHabit,
  firstPersonBasisPoints,
  habitAliasKey,
  habitConfidence,
  habitMerchantKey,
  overrideHabit,
  payerShareBasisPoints
} from "../src/domain/ask-habits.ts";

test("a merchant key drops phone, card and reference numbers and keeps the shop", () => {
  assert.equal(habitMerchantKey("STARBUCKS PAYNOW 91234567"), "starbucks paynow");
  assert.equal(habitMerchantKey("Cold Storage  Orchard #4821"), "cold storage orchard");
  assert.equal(habitMerchantKey("7-Eleven"), "7 eleven");
  assert.doesNotMatch(habitMerchantKey("GRAB*1234567890 SG"), /\d{4}/);
});

test("a description with no usable shop name makes no key", () => {
  assert.equal(habitMerchantKey("91234567"), "");
  assert.equal(habitMerchantKey("  "), "");
  assert.equal(habitMerchantKey(null), "");
  assert.equal(habitMerchantKey("12"), "");
});

test("an alias is one short word of letters; numbers and phrases are refused", () => {
  assert.equal(habitAliasKey(" J "), "j");
  assert.equal(habitAliasKey("Jojo"), "jojo");
  assert.equal(habitAliasKey("my wife"), "");
  assert.equal(habitAliasKey("9123"), "");
  assert.equal(habitAliasKey("a".repeat(40)), "");
});

test("confirmations count, a different value overrides and starts again at one", () => {
  const valueA = canonicalHabitValue("category", { categoryName: "Food & Drinks" });
  const valueB = canonicalHabitValue("category", { categoryName: "Groceries" });
  let counters = confirmHabit(null, valueA);
  assert.deepEqual(counters, { timesConfirmed: 1, timesOverridden: 0 });
  counters = confirmHabit({ valueJson: valueA, counters }, valueA);
  counters = confirmHabit({ valueJson: valueA, counters }, valueA);
  assert.deepEqual(counters, { timesConfirmed: 3, timesOverridden: 0 });
  counters = confirmHabit({ valueJson: valueA, counters }, valueB);
  assert.deepEqual(counters, { timesConfirmed: 1, timesOverridden: 1 });
});

test("an override resets confidence to nothing and is counted", () => {
  assert.deepEqual(overrideHabit({ timesConfirmed: 7, timesOverridden: 1 }), { timesConfirmed: 0, timesOverridden: 2 });
});

test("confidence: 3 consistent confirmations is high, 2 only suggests, fewer is none, and a year idle is none", () => {
  const today = "2026-10-14";
  assert.equal(habitConfidence({ timesConfirmed: 3, lastUsed: "2026-10-01" }, today), "high");
  assert.equal(habitConfidence({ timesConfirmed: 9, lastUsed: "2026-10-01" }, today), "high");
  assert.equal(habitConfidence({ timesConfirmed: 2, lastUsed: "2026-10-01" }, today), "suggest");
  assert.equal(habitConfidence({ timesConfirmed: 1, lastUsed: "2026-10-01" }, today), "none");
  assert.equal(habitConfidence({ timesConfirmed: 0, lastUsed: "2026-10-01" }, today), "none");
  assert.equal(habitConfidence({ timesConfirmed: 5, lastUsed: "2025-10-01" }, today), "none");
  assert.equal(habitConfidence({ timesConfirmed: 5, lastUsed: "garbage" }, today), "none");
});

test("a habit overridden after many confirmations is not high again until 3 new ones", () => {
  const today = "2026-10-14";
  let counters = { timesConfirmed: 8, timesOverridden: 0 };
  counters = overrideHabit(counters);
  assert.equal(habitConfidence({ ...counters, lastUsed: today }, today), "none");
  counters = { ...counters, timesConfirmed: 2 };
  assert.equal(habitConfidence({ ...counters, lastUsed: today }, today), "suggest");
  counters = { ...counters, timesConfirmed: 3 };
  assert.equal(habitConfidence({ ...counters, lastUsed: today }, today), "high");
});

test("split shares convert between the payer's view and the first person's view", () => {
  assert.equal(firstPersonBasisPoints(7000, true), 7000);
  assert.equal(firstPersonBasisPoints(7000, false), 3000);
  assert.equal(payerShareBasisPoints(3000, false), 7000);
  assert.equal(payerShareBasisPoints(5000, true), 5000);
});

const NOW = new Date("2026-10-14T10:00:00Z");
const freshEntry = { importId: null, bankCertificationStatus: "provisional", createdAt: "2026-10-14 09:30:00", entryType: "expense" };
const allowed = { settingOn: true, action: "set_category", entryCount: 1, entry: freshEntry, confidence: "high", now: NOW };

test("the safe set is exactly category, note and add to splits", () => {
  assert.deepEqual([...ASK_SAFE_ACTIONS], ["set_category", "add_note", "add_to_splits"]);
});

test("a new, provisional, hand-made entry with a high-confidence habit may be handled by Ask", () => {
  assert.equal(autoApplyRefusal(allowed), null);
  assert.equal(autoApplyRefusal({ ...allowed, action: "add_to_splits" }), null);
  assert.equal(autoApplyRefusal({ ...allowed, action: "add_note", confidence: "none" }), null, "a note comes from the person's own words, not a habit");
});

test("every excluded case is refused with its reason", () => {
  const refuse = (change) => autoApplyRefusal({ ...allowed, ...change });
  assert.equal(refuse({ settingOn: false }), "setting_off");
  assert.equal(refuse({ action: "settle_up" }), "not_safe_action");
  assert.equal(refuse({ action: "delete_entry" }), "not_safe_action");
  assert.equal(refuse({ action: "link_transfer" }), "not_safe_action");
  assert.equal(refuse({ action: "update_amount" }), "not_safe_action");
  assert.equal(refuse({ entryCount: 2 }), "bulk");
  assert.equal(refuse({ entryCount: 0 }), "bulk");
  assert.equal(refuse({ entry: { ...freshEntry, importId: "import-1" } }), "imported");
  assert.equal(refuse({ entry: { ...freshEntry, bankCertificationStatus: "statement_certified" } }), "certified");
  assert.equal(refuse({ entry: { ...freshEntry, createdAt: "2026-10-14 08:30:00" } }), "not_new");
  assert.equal(refuse({ entry: { ...freshEntry, createdAt: "2026-09-01 08:30:00" } }), "not_new");
  assert.equal(refuse({ entry: { ...freshEntry, createdAt: "not a time" } }), "not_new");
  assert.equal(refuse({ entry: { ...freshEntry, entryType: "income" } }), "not_expense");
  assert.equal(refuse({ confidence: "suggest" }), "low_confidence");
  assert.equal(refuse({ confidence: "none" }), "low_confidence");
});

test("the setting wins over everything else, and an entry from the future is not new", () => {
  assert.equal(autoApplyRefusal({ ...allowed, settingOn: false, action: "settle_up", entryCount: 9 }), "setting_off");
  assert.equal(autoApplyRefusal({ ...allowed, entry: { ...freshEntry, createdAt: "2026-10-14 12:00:00" } }), "not_new");
});
