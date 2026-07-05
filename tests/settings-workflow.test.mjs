import assert from "node:assert/strict";
import test from "node:test";

import {
  buildCheckpointHistoryYears,
  buildCreateAccountDialog,
  buildCreateCategoryRuleDialog,
  buildEditAccountDialog,
  buildReconciliationDialog,
  buildSafeSettingsPage,
  buildShortcutSettingsDraft,
  buildStatementComparePanel,
  buildSuggestionCategoryRuleDialog,
  filterCheckpointHistoryByYear,
  findDuplicateCategoryMatchRules,
  getVisibleSettingsAccounts,
  reorderShortcutAccountPriorityIds
} from "../src/client/settings-workflow.js";

test("buildSafeSettingsPage supplies empty collections for the settings route", () => {
  const result = buildSafeSettingsPage(null);

  assert.deepEqual(result.categoryMatchRules, []);
  assert.deepEqual(result.categoryMatchRuleSuggestions, []);
  assert.deepEqual(result.unresolvedTransfers, []);
  assert.deepEqual(result.reconciliationExceptions, []);
  assert.deepEqual(result.recentAuditEvents, []);
  assert.deepEqual(result.shortcutSettings.defaultAccountPriorityIds, []);
  assert.equal(result.shortcutSettings.defaultParams, "");
  assert.equal(result.demo.emptyState, false);
});

test("shortcut settings draft keeps active saved priority then appends active accounts", () => {
  const accounts = [
    { id: "card", isActive: true },
    { id: "bank", isActive: true },
    { id: "old", isActive: false },
    { id: "cash", isActive: true }
  ];

  assert.deepEqual(
    buildShortcutSettingsDraft({
      apiKey: "mm_test",
      defaultParams: "category=Transport",
      defaultAccountPriorityIds: ["bank", "old"]
    }, accounts),
    {
      apiKey: "mm_test",
      defaultParams: "category=Transport",
      defaultAccountPriorityIds: ["bank", "card", "cash"]
    }
  );
});

test("shortcut account reorder moves one account without losing ids", () => {
  assert.deepEqual(reorderShortcutAccountPriorityIds(["card", "bank", "cash"], 0, 2), ["bank", "cash", "card"]);
  assert.deepEqual(reorderShortcutAccountPriorityIds(["card", "bank"], 1, 1), ["card", "bank"]);
  assert.deepEqual(reorderShortcutAccountPriorityIds(["card", "bank"], -1, 1), ["card", "bank"]);
});

test("duplicate category match rules surface same-category overlaps", () => {
  const issues = findDuplicateCategoryMatchRules([
    { id: "broad", pattern: "MA MUM SINGAPORE", categoryId: "food", categoryName: "Food & Drinks", priority: 100, isActive: true },
    { id: "specific", pattern: "MA MUM SINGAPORE SG", categoryId: "food", categoryName: "Food & Drinks", priority: 50, isActive: true },
    { id: "other", pattern: "BUS MRT", categoryId: "transport", categoryName: "Transport", priority: 100, isActive: true }
  ]);

  assert.equal(issues.length, 1);
  assert.equal(issues[0].kind, "overlap");
  assert.deepEqual(issues[0].rules.map((rule) => rule.id), ["specific", "broad"]);
});

test("duplicate category match rules surface cross-category conflicts first", () => {
  const issues = findDuplicateCategoryMatchRules([
    { id: "food", pattern: "MA MUM", categoryId: "food", categoryName: "Food & Drinks", priority: 100, isActive: true },
    { id: "other", pattern: "MA-MUM", categoryId: "other", categoryName: "Other", priority: 100, isActive: true },
    { id: "coffee", pattern: "Coffee Bean", categoryId: "food", categoryName: "Food & Drinks", priority: 100, isActive: true },
    { id: "coffee-short", pattern: "Coffee Bean SG", categoryId: "food", categoryName: "Food & Drinks", priority: 110, isActive: true }
  ]);

  assert.equal(issues.length, 2);
  assert.equal(issues[0].kind, "conflict");
  assert.deepEqual(issues[0].rules.map((rule) => rule.id), ["food", "other"]);
  assert.equal(issues[1].kind, "overlap");
});

test("duplicate category match rules ignore inactive and unrelated rules", () => {
  assert.deepEqual(
    findDuplicateCategoryMatchRules([
      { id: "active", pattern: "MA MUM SINGAPORE", categoryId: "food", categoryName: "Food & Drinks", priority: 100, isActive: true },
      { id: "inactive", pattern: "MA MUM", categoryId: "food", categoryName: "Food & Drinks", priority: 50, isActive: false },
      { id: "unrelated", pattern: "BUS MRT", categoryId: "transport", categoryName: "Transport", priority: 100, isActive: true }
    ]),
    []
  );
});

test("getVisibleSettingsAccounts filters person views and keeps active accounts first", () => {
  const accounts = [
    { id: "archived", institution: "Zeta", name: "Archive", isActive: false, isJoint: false, ownerPersonId: "tim" },
    { id: "joint", institution: "Alpha", name: "Joint", isActive: true, isJoint: true, ownerPersonId: null },
    { id: "mine", institution: "Beta", name: "Wallet", isActive: true, isJoint: false, ownerPersonId: "tim" },
    { id: "other", institution: "Gamma", name: "Other", isActive: true, isJoint: false, ownerPersonId: "bea" }
  ];

  assert.deepEqual(
    getVisibleSettingsAccounts(accounts, "tim").map((account) => account.id),
    ["joint", "mine", "archived"]
  );
});

test("dialog builders keep settings draft defaults explicit", () => {
  assert.deepEqual(buildCreateAccountDialog(), {
    mode: "create",
    accountId: "",
    name: "",
    institution: "",
    kind: "bank",
    currency: "SGD",
    openingBalance: "0.00",
    ownerPersonId: "",
    isJoint: false
  });

  assert.deepEqual(
    buildEditAccountDialog({
      id: "acct-1",
      name: "Cash",
      institution: "DBS",
      kind: "cash",
      currency: "SGD",
      openingBalanceMinor: 1250,
      ownerPersonId: "tim",
      isJoint: false
    }, (value) => `formatted:${value}`),
    {
      mode: "edit",
      accountId: "acct-1",
      name: "Cash",
      institution: "DBS",
      kind: "cash",
      currency: "SGD",
      openingBalance: "formatted:1250",
      ownerPersonId: "tim",
      isJoint: false
    }
  );
});

test("category-rule dialog defaults prefer Other when it exists", () => {
  assert.deepEqual(
    buildCreateCategoryRuleDialog([
      { id: "groceries", name: "Groceries" },
      { id: "other", name: "Other" }
    ]),
    {
      mode: "create",
      ruleId: "",
      sourceSuggestionId: "",
      pattern: "",
      categoryId: "other",
      priority: 100,
      isActive: true,
      note: ""
    }
  );
});

test("reconciliation selectors keep history filtering deterministic", () => {
  const history = [
    { month: "2026-05" },
    { month: "2025-12" },
    { month: "2026-03" }
  ];

  assert.deepEqual(buildCheckpointHistoryYears(history), ["2026", "2025"]);
  assert.deepEqual(filterCheckpointHistoryByYear(history, "2026"), [
    { month: "2026-05" },
    { month: "2026-03" }
  ]);
});

test("statement compare helpers preserve account/checkpoint identity", () => {
  assert.equal(buildStatementComparePanel({ id: "acct-1", name: "Cash" }, null), null);
  assert.deepEqual(
    buildStatementComparePanel(
      { id: "acct-1", name: "Cash" },
      { month: "2026-05", statementStartDate: "2026-05-01", statementEndDate: "2026-05-31", deltaMinor: -500 }
    ),
    {
      accountId: "acct-1",
      accountName: "Cash",
      checkpointMonth: "2026-05",
      statementStartDate: "2026-05-01",
      statementEndDate: "2026-05-31",
      deltaMinor: -500
    }
  );
});

test("suggestion dialogs keep the note builder outside the panel", () => {
  assert.deepEqual(
    buildSuggestionCategoryRuleDialog(
      { id: "s1", pattern: "NTUC", categoryId: "groceries", sourceCount: 3 },
      (count) => `used ${count} times`
    ),
    {
      mode: "create",
      ruleId: "",
      sourceSuggestionId: "s1",
      pattern: "NTUC",
      categoryId: "groceries",
      priority: 100,
      isActive: true,
      note: "used 3 times"
    }
  );
});

test("reconciliation dialog builder keeps checkpoint defaults explicit", () => {
  assert.deepEqual(
    buildReconciliationDialog(
      {
        id: "acct-1",
        name: "Main",
        kind: "bank",
        latestCheckpointMonth: "2026-05",
        latestCheckpointStartDate: "2026-05-01",
        latestCheckpointEndDate: "2026-05-31",
        latestCheckpointBalanceMinor: 12345,
        latestCheckpointNote: "checked",
        checkpointHistory: [{ month: "2026-05" }]
      },
      (value, kind) => `${kind}:${value}`
    ),
    {
      accountId: "acct-1",
      accountName: "Main",
      accountKind: "bank",
      checkpointMonth: "2026-05",
      statementStartDate: "2026-05-01",
      statementEndDate: "2026-05-31",
      statementBalance: "bank:12345",
      note: "checked",
      history: [{ month: "2026-05" }]
    }
  );
});
