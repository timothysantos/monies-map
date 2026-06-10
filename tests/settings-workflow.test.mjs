import assert from "node:assert/strict";
import test from "node:test";

import {
  buildCheckpointHistoryYears,
  buildCreateAccountDialog,
  buildCreateCategoryRuleDialog,
  buildEditAccountDialog,
  buildReconciliationDialog,
  buildSafeSettingsPage,
  buildStatementComparePanel,
  buildSuggestionCategoryRuleDialog,
  filterCheckpointHistoryByYear,
  getVisibleSettingsAccounts
} from "../src/client/settings-workflow.js";

test("buildSafeSettingsPage supplies empty collections for the settings route", () => {
  const result = buildSafeSettingsPage(null);

  assert.deepEqual(result.categoryMatchRules, []);
  assert.deepEqual(result.categoryMatchRuleSuggestions, []);
  assert.deepEqual(result.unresolvedTransfers, []);
  assert.deepEqual(result.reconciliationExceptions, []);
  assert.deepEqual(result.recentAuditEvents, []);
  assert.equal(result.demo.emptyState, false);
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
