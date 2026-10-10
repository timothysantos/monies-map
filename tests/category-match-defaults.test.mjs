// The default category rules every household starts with, and the parser's
// own first guess (inferCategory). A rule should catch the merchant it names
// and nothing else, and no two defaults should do the same job.
import assert from "node:assert/strict";
import test from "node:test";

import {
  defaultCategoryMatchRules,
  deprecatedDefaultCategoryMatchRuleIds
} from "../src/domain/category-match-defaults.ts";
import { matchCategoryRule } from "../src/domain/app-repository-category-match-rules.ts";
import { findDuplicateCategoryMatchRules } from "../src/client/settings-workflow.js";
import { inferCategory } from "../src/lib/statement-import/shared.ts";

const rules = defaultCategoryMatchRules
  .map((rule) => ({ ...rule, categoryId: rule.categoryName, isActive: true }))
  .sort((left, right) => left.priority - right.priority || left.pattern.localeCompare(right.pattern));

function categoryFor(description) {
  return matchCategoryRule(description, rules);
}

test("no two default rules duplicate or overlap each other", () => {
  const issues = findDuplicateCategoryMatchRules(rules)
    .map((issue) => `${issue.kind}: ${issue.rules.map((rule) => rule.pattern).join(" / ")}`);
  // The Wise transfer rule names a PayNow row, so it shares PAYNOW-FAST with
  // the PayNow memo rules; its higher priority decides, which is intended.
  assert.deepEqual(issues, [
    "conflict: PAYNOW-FAST WISE ASIA-PACIFIC / PAYNOW-FAST, LUNCH",
    "conflict: PAYNOW-FAST WISE ASIA-PACIFIC / PAYNOW-FAST, WESTERN"
  ]);
});

test("each default rule id and pattern is unique, and retired ids are not reused", () => {
  const ids = defaultCategoryMatchRules.map((rule) => rule.id);
  const patterns = defaultCategoryMatchRules.map((rule) => rule.pattern.toUpperCase());
  assert.equal(new Set(ids).size, ids.length);
  assert.equal(new Set(patterns).size, patterns.length);
  assert.deepEqual(ids.filter((id) => deprecatedDefaultCategoryMatchRuleIds.includes(id)), []);
});

test("overlapping defaults are retired: TEA EXPLORER, LATE CHARGES, YOUTUBEPREMIUM and the broad MA LA", () => {
  for (const id of ["catrule-tea-explorer", "catrule-late-charges", "catrule-youtube-premium", "catrule-ma-la"]) {
    assert.ok(deprecatedDefaultCategoryMatchRuleIds.includes(id), id);
  }
  assert.equal(categoryFor("TEA EXPLORER PTE LTD SINGAPORE"), "Food & Drinks");
  assert.equal(categoryFor("GOOGLE*YOUTUBEPREMIUM"), "Subscriptions MO");
  assert.equal(categoryFor("LATE CHARGES"), "Fees");
});

test("mala shops match by name, and MA LA no longer catches a lab", () => {
  assert.equal(categoryFor("SHOPBACK GONG YUAN MA LA SINGAPORE"), "Food & Drinks");
  assert.equal(categoryFor("CHUAN TAIZI MALATANG SINGAPORE 078"), "Food & Drinks");
  assert.equal(categoryFor("MALAYSIA BOLEH GREAT WORLSINGAPORE"), "Food & Drinks");
  assert.equal(categoryFor("MA LAB PRIVATE LIMITED SINGAPORE"), undefined);
});

test("bank charges sort before shops: a late charge and its reversal are Fees", () => {
  const lateCharge = rules.find((rule) => rule.pattern === "LATE CHARGE");
  assert.equal(lateCharge?.categoryName, "Fees");
  assert.ok(lateCharge.priority <= 15, "fee rules run before merchant rules");
  assert.equal(categoryFor("LATE CHARGE"), "Fees");
  assert.equal(categoryFor("CR LATE CHARGE"), "Fees");
});

test("frequent merchants that used to land in Other have a default rule", () => {
  const expected = [
    ["CHAGEE Singapore", "Food & Drinks"],
    ["DELIVEROO SINGAPORE", "Food & Drinks"],
    ["BREADTALK - VIVOCITY SINGAPORE", "Food & Drinks"],
    ["GOKOKU JAPANESE BAKERY SINGAPORE", "Food & Drinks"],
    ["GetGo Singapore", "Taxi"],
    ["PELAGO SINGAPORE", "Travel"],
    ["GOMO MOBILE PLAN SINGAPORE", "Bills"],
    ["GOMO BY SINGTEL SINGAPORE SG", "Bills"],
    ["CURSOR,AIPOWEREDIDECURSOR.COMUS", "Subscriptions MO"],
    ["CAPCUT SINGAPORE", "Subscriptions MO"]
  ];
  assert.deepEqual(expected.map(([description]) => [description, categoryFor(description)]), expected);
});

test("a short or partial merchant word does not match an unrelated shop", () => {
  assert.equal(categoryFor("GOMOKU RAMEN"), undefined);
  assert.equal(categoryFor("CURSORY DESIGN STUDIO"), undefined);
});

test("inferCategory: The Daily Cut is food, mobile plans are Bills, OCBC's service charge is a fee", () => {
  assert.equal(inferCategory("THE DAILY CUT SINGAPORE", false), "Other");
  assert.equal(inferCategory("DAILY CUT SALON", false), "Beauty");
  assert.equal(inferCategory("STARHUB LTD SINGAPORE", false), "Bills");
  assert.equal(inferCategory("VIVIFI SINGAPORE", false), "Bills");
  assert.equal(inferCategory("SERVICE CHARGE", false), "Fees");
  assert.equal(inferCategory("CONDO SERVICE CHARGE MCST 1234", false), "Other");
});
