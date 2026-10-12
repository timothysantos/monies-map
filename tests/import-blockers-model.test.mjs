// What still stands between the file in review and a clean commit
// (src/client/import-blockers-model.js). The same list drives the
// "Before you can commit:" chips, the commit bar's "things left" and
// whether the commit button is disabled or asks first, so these tests pin
// both the chips and the commit rules the model replaced.
import assert from "node:assert/strict";
import test from "node:test";

import { buildImportBlockers } from "../src/client/import-blockers-model.js";
import { buildImportPreviewModel } from "../src/client/import-preview-model.js";

const LADYS = { id: "acct-ladys", name: "UOB Lady's Card" };
const PRVI = { id: "acct-prvi", name: "UOB PRVI Miles Card" };
const formatMoney = (minor) => `$${(minor / 100).toFixed(2)}`;

function row(overrides) {
  return {
    rowId: overrides.rowId,
    date: "2026-05-01",
    description: "Row",
    amountMinor: 1000,
    entryType: "expense",
    commitStatus: "included",
    ...overrides
  };
}

function previewModelFor({ accounts = [LADYS, PRVI], previewRows, statementCheckpoints = [], statementReconciliations = [], statementDiagnosis, sourceType = "pdf", unknownCategories = [], unknownCategoryMode = "other" }) {
  return buildImportPreviewModel({
    accounts,
    preview: { statementReconciliations, unknownCategories, overlapImports: [], ...(statementDiagnosis ? { statementDiagnosis } : {}) },
    previewRows,
    statementCheckpoints,
    statementImportMeta: { sourceType, parserKey: sourceType === "pdf" ? "uob_credit_card_pdf" : "generic_csv" },
    dismissedOverlapIds: [],
    unknownCategoryMode,
    isSubmitting: false,
    isParsingStatement: false
  });
}

function blockersFor(input, extra = {}) {
  const previewModel = previewModelFor(input);
  return buildImportBlockers({
    previewModel,
    hasPreview: true,
    sourceType: input.sourceType ?? "pdf",
    statementCheckpointCount: (input.statementCheckpoints ?? []).length,
    unknownCategoryCount: (input.unknownCategories ?? []).length,
    isPreviewDirty: false,
    isSubmitting: false,
    isParsingStatement: false,
    areTotalsVisible: true,
    formatMoney,
    ...extra
  });
}

// A two-card statement: One Card is not an account yet, Lady's Card is off
// by $12.40, one row needs a decision and one confirms an entry.
const messyStatement = {
  statementCheckpoints: [
    { detectedAccountName: "UOB One Card", accountName: "UOB One Card", checkpointMonth: "2026-05" },
    { detectedAccountName: LADYS.name, accountName: LADYS.name, accountId: LADYS.id, checkpointMonth: "2026-05" }
  ],
  statementReconciliations: [
    { accountName: "UOB One Card", status: "unknown_account", checkpointMonth: "2026-05" },
    { accountName: LADYS.name, accountId: LADYS.id, status: "mismatch", deltaMinor: -1240, checkpointMonth: "2026-05" }
  ],
  previewRows: [
    row({ rowId: "one-1", accountName: "UOB One Card", statementAccountName: "UOB One Card" }),
    row({ rowId: "one-2", accountName: "UOB One Card", statementAccountName: "UOB One Card" }),
    row({ rowId: "ladys-1", accountId: LADYS.id, accountName: LADYS.name, commitStatus: "needs_review" }),
    row({ rowId: "ladys-2", accountId: LADYS.id, accountName: LADYS.name, reconciliationTargetTransactionId: "entry-1" }),
    row({ rowId: "ladys-3", accountId: LADYS.id, accountName: LADYS.name, commitStatus: "skipped" })
  ]
};

test("a statement with an unmapped card, a card off and a row to check lists them in fixing order", () => {
  const result = blockersFor(messyStatement);

  // The unmapped One Card is named once, by "Map 1 account": no "doesn't
  // match" chip of its own while it has no account.
  assert.deepEqual(result.blockers.map(({ id, kind, effect, label, target }) => ({ id, kind, effect, label, target })), [
    { id: "account-mapping", kind: "account-mapping", effect: "disable", label: "Map 1 account", target: { kind: "account-mapping" } },
    {
      id: "statement-card:UOB Lady's Card:2026-05",
      kind: "statement-card",
      effect: "ask",
      label: "UOB Lady's Card off by $12.40",
      target: { kind: "statement-card", accountName: LADYS.name, checkpointMonth: "2026-05" }
    },
    { id: "rows-to-check", kind: "rows-to-check", effect: "disable", label: "1 row to check", target: { kind: "review-rows" } }
  ]);
  // Order numbers grow in the order the user should fix things.
  const orders = result.blockers.map((blocker) => blocker.order);
  assert.deepEqual(orders, [...orders].sort((left, right) => left - right));
  assert.equal(result.remainingCount, 3);
  assert.equal(result.isCommitDisabled, true);
  // The commit still asks about both cards, the unmapped one included.
  assert.deepEqual(result.commitQuestion, {
    kind: "statement_mismatch",
    accountNames: ["UOB One Card", LADYS.name],
    message: "UOB One Card and UOB Lady's Card don't match the statement yet. Committing now saves the statement with a difference.",
    confirmLabel: "Commit anyway"
  });
  // The confirmed row and the already-covered row are matches.
  assert.deepEqual(result.matched, { count: 2, label: "2 rows matched" });
});

test("an unmapped card gets its own chip once it is mapped, or when nothing asks to map it", () => {
  // Mapped to an account, One Card is checked like any other card.
  const mapped = blockersFor({
    accounts: [LADYS, PRVI, { id: "acct-one", name: "My One Card" }],
    statementCheckpoints: [
      { detectedAccountName: "UOB One Card", accountName: "My One Card", accountId: "acct-one", checkpointMonth: "2026-05" }
    ],
    statementReconciliations: [
      { accountName: "My One Card", accountId: "acct-one", status: "mismatch", deltaMinor: 500, checkpointMonth: "2026-05" }
    ],
    previewRows: [row({ rowId: "one-1", accountId: "acct-one", accountName: "My One Card", statementAccountName: "UOB One Card" })]
  });
  assert.deepEqual(mapped.blockers.map((blocker) => blocker.label), ["My One Card off by $5.00"]);

  // A statement saved without rows has no rows to map, so no "Map" chip:
  // the unknown card keeps its own chip, and it still blocks the commit.
  const checkpointOnly = blockersFor({
    statementCheckpoints: [{ detectedAccountName: "UOB One Card", accountName: "UOB One Card", checkpointMonth: "2026-05" }],
    statementReconciliations: [{ accountName: "UOB One Card", status: "unknown_account", checkpointMonth: "2026-05" }],
    previewRows: [row({ rowId: "one-1", accountName: "UOB One Card", statementAccountName: "UOB One Card", commitStatus: "skipped" })]
  });
  assert.deepEqual(checkpointOnly.blockers.map(({ id, effect, label }) => ({ id, effect, label })), [
    { id: "statement-card:UOB One Card:2026-05", effect: "disable", label: "UOB One Card doesn't match" }
  ]);
  assert.equal(checkpointOnly.isCommitDisabled, true);
});

test("two unmapped account names count as two accounts to map", () => {
  const result = blockersFor({
    sourceType: "csv",
    accounts: [LADYS],
    previewRows: [
      row({ rowId: "a", accountName: "Mystery Card" }),
      row({ rowId: "b", accountName: "Other Card" }),
      row({ rowId: "c", accountName: "Other Card" })
    ]
  });
  assert.deepEqual(result.blockers.map((blocker) => blocker.label), ["Map 2 accounts"]);
  assert.equal(result.isCommitDisabled, true);
  assert.equal(result.commitQuestion, null);
});

test("a clean statement has no blockers, commits without a question and shows what matched", () => {
  const result = blockersFor({
    statementCheckpoints: [{ detectedAccountName: LADYS.name, accountName: LADYS.name, accountId: LADYS.id, checkpointMonth: "2026-05" }],
    statementReconciliations: [{ accountName: LADYS.name, accountId: LADYS.id, status: "matched", deltaMinor: 0, checkpointMonth: "2026-05" }],
    previewRows: [
      row({ rowId: "a", accountId: LADYS.id, accountName: LADYS.name }),
      row({ rowId: "b", accountId: LADYS.id, accountName: LADYS.name, reconciliationTargetTransactionId: "entry-9" })
    ]
  });
  assert.deepEqual(result.blockers, []);
  assert.equal(result.remainingCount, 0);
  assert.equal(result.isCommitDisabled, false);
  assert.equal(result.commitQuestion, null);
  assert.deepEqual(result.matched, { count: 1, label: "1 row matched" });
});

test("hidden money names the card without an amount or anything that shows its sign", () => {
  const result = blockersFor(messyStatement, { areTotalsVisible: false });
  const ladys = result.blockers.find((blocker) => blocker.id === "statement-card:UOB Lady's Card:2026-05");
  assert.equal(ladys.label, "UOB Lady's Card doesn't match");
  for (const blocker of result.blockers) {
    assert.doesNotMatch(blocker.label, /\$|\d+\.\d{2}|off by|owed|credit|short|over/i, blocker.label);
  }
});

// The Oct 2026 OCBC 365 case: the Sept statement was never imported, so the
// chip says what to do instead of how far off the card is.
test("a card whose earlier statements were never imported says which to import first", () => {
  const statementDiagnosis = {
    cards: [],
    findings: [{
      id: `opening_balance_gap:${LADYS.id}`,
      kind: "opening_balance_gap",
      accountId: LADYS.id,
      effectMinor: -15241,
      confidence: "medium",
      applied: false,
      facts: [{ code: "missing_statements", months: ["2026-08", "2026-09"], lastStatementMonth: "2026-07", lastStatementEndDate: "2026-07-01", previousStatementBalanceMinor: -26434 }]
    }]
  };
  const input = {
    statementCheckpoints: [{ detectedAccountName: LADYS.name, accountName: LADYS.name, accountId: LADYS.id, checkpointMonth: "2026-10" }],
    statementReconciliations: [{ accountName: LADYS.name, accountId: LADYS.id, status: "mismatch", deltaMinor: 15241, checkpointMonth: "2026-10" }],
    statementDiagnosis,
    previewRows: [row({ rowId: "ladys-1", accountId: LADYS.id, accountName: LADYS.name })]
  };
  const shown = blockersFor(input).blockers.find((blocker) => blocker.kind === "statement-card");
  assert.equal(shown.label, "UOB Lady's Card: import Aug 2026 and Sep 2026 first");
  // It says nothing about the amount, so hidden money shows the same words.
  const hidden = blockersFor(input, { areTotalsVisible: false }).blockers.find((blocker) => blocker.kind === "statement-card");
  assert.equal(hidden.label, "UOB Lady's Card: import Aug 2026 and Sep 2026 first");

  // A gap with no missing month keeps the amount.
  const plain = blockersFor({ ...input, statementDiagnosis: { cards: [], findings: [{ ...statementDiagnosis.findings[0], facts: [] }] } });
  assert.equal(plain.blockers.find((blocker) => blocker.kind === "statement-card").label, "UOB Lady's Card off by $152.41");
});

test("a row edit the statement check has not seen asks to refresh the check first", () => {
  const result = blockersFor(messyStatement, { isPreviewDirty: true });
  const check = result.blockers.find((blocker) => blocker.kind === "statement-check");
  assert.deepEqual(
    { id: check.id, effect: check.effect, label: check.label, target: check.target },
    { id: "statement-check", effect: "ask", label: "Refresh the statement check", target: { kind: "statement-check" } }
  );
  // Refreshing comes before the card checks it would change.
  assert.deepEqual(result.blockers.map((blocker) => blocker.kind), ["account-mapping", "statement-check", "statement-card", "rows-to-check"]);
  assert.deepEqual(result.commitQuestion, {
    kind: "stale_check",
    message: "You changed rows after the statement check ran. Refresh the check before committing.",
    confirmLabel: "Refresh check"
  });
});

test("CSV columns still to map block the preview, one chip per missing or doubled field", () => {
  const result = buildImportBlockers({
    previewModel: null,
    hasPreview: false,
    sourceType: "csv",
    statementCheckpointCount: 0,
    unknownCategoryCount: 0,
    isPreviewDirty: false,
    isSubmitting: false,
    isParsingStatement: false,
    columnMapping: { readyForMapping: true, missingRequiredFields: ["date", "amount/expense/income"], duplicateMappings: ["description"] },
    areTotalsVisible: true,
    formatMoney
  });
  assert.deepEqual(result.blockers.map(({ id, effect, label, target }) => ({ id, effect, label, target })), [
    { id: "column:date", effect: "preview", label: "Map the date column", target: { kind: "column-mapping", field: "date" } },
    { id: "column:amount/expense/income", effect: "preview", label: "Map an amount column", target: { kind: "column-mapping", field: "amount/expense/income" } },
    { id: "column-duplicate:description", effect: "preview", label: "Map description to one column only", target: { kind: "column-mapping", field: "description" } }
  ]);
  assert.equal(result.isCommitDisabled, true);
  assert.equal(result.matched, null);
});

test("a CSV not yet ready for mapping, or mapped, has no column chips", () => {
  const base = {
    previewModel: null,
    hasPreview: false,
    sourceType: "csv",
    statementCheckpointCount: 0,
    unknownCategoryCount: 0,
    isPreviewDirty: false,
    isSubmitting: false,
    isParsingStatement: false,
    areTotalsVisible: true,
    formatMoney
  };
  assert.deepEqual(buildImportBlockers({ ...base, columnMapping: { readyForMapping: false, missingRequiredFields: ["date"], duplicateMappings: [] } }).blockers, []);
  assert.deepEqual(buildImportBlockers({ ...base, columnMapping: { readyForMapping: true, missingRequiredFields: [], duplicateMappings: [] } }).blockers, []);
});

test("two cards on one account, blocking categories and a statement with nothing to save each get a chip", () => {
  const duplicateCards = blockersFor({
    statementCheckpoints: [
      { detectedAccountName: "Card A", accountName: LADYS.name, accountId: LADYS.id, checkpointMonth: "2026-05" },
      { detectedAccountName: "Card B", accountName: LADYS.name, accountId: LADYS.id, checkpointMonth: "2026-05" }
    ],
    statementReconciliations: [{ accountName: LADYS.name, accountId: LADYS.id, status: "matched", deltaMinor: 0, checkpointMonth: "2026-05" }],
    previewRows: [row({ rowId: "a", accountId: LADYS.id, accountName: LADYS.name })]
  });
  assert.deepEqual(duplicateCards.blockers.map(({ id, effect, label, target }) => ({ id, effect, label, target })), [
    { id: "card-accounts", effect: "disable", label: "Give each card its own account", target: { kind: "statement-details" } }
  ]);

  const categories = blockersFor({
    sourceType: "csv",
    unknownCategoryMode: "block",
    unknownCategories: ["Pets", "Hobbies"],
    previewRows: [row({ rowId: "a", accountId: LADYS.id, accountName: LADYS.name })]
  });
  assert.deepEqual(categories.blockers.map(({ id, effect, label, target }) => ({ id, effect, label, target })), [
    { id: "unknown-categories", effect: "disable", label: "Map 2 categories", target: { kind: "unknown-categories" } }
  ]);

  const nothing = blockersFor({
    sourceType: "csv",
    previewRows: [row({ rowId: "a", accountId: LADYS.id, accountName: LADYS.name, commitStatus: "skipped", commitStatusExplicit: true })]
  });
  assert.deepEqual(nothing.blockers.map(({ id, effect, label, target }) => ({ id, effect, label, target })), [
    { id: "nothing-to-import", effect: "disable", label: "Include at least 1 row", target: { kind: "preview-rows" } }
  ]);
  assert.equal(nothing.isCommitDisabled, true);
});

test("a statement saved without rows blocks until every card matches, and names the cards", () => {
  const checkpointOnly = {
    statementCheckpoints: [{ detectedAccountName: LADYS.name, accountName: LADYS.name, accountId: LADYS.id, checkpointMonth: "2026-05" }],
    previewRows: [row({ rowId: "a", accountId: LADYS.id, accountName: LADYS.name, commitStatus: "skipped" })]
  };
  const open = blockersFor({
    ...checkpointOnly,
    statementReconciliations: [{ accountName: LADYS.name, accountId: LADYS.id, status: "mismatch", deltaMinor: 500, checkpointMonth: "2026-05" }]
  });
  assert.deepEqual(open.blockers.map(({ effect, label }) => ({ effect, label })), [{ effect: "disable", label: "UOB Lady's Card off by $5.00" }]);
  assert.equal(open.isCommitDisabled, true);

  const unchecked = blockersFor({ ...checkpointOnly, statementReconciliations: [] });
  assert.deepEqual(unchecked.blockers.map(({ id, effect, label }) => ({ id, effect, label })), [
    { id: "statement-check", effect: "disable", label: "Refresh the statement check" }
  ]);
  assert.equal(unchecked.isCommitDisabled, true);

  const matched = blockersFor({
    ...checkpointOnly,
    statementReconciliations: [{ accountName: LADYS.name, accountId: LADYS.id, status: "matched", deltaMinor: 0, checkpointMonth: "2026-05" }]
  });
  assert.deepEqual(matched.blockers, []);
  assert.equal(matched.isCommitDisabled, false);
});

test("a save or parse in flight disables the commit without adding a chip", () => {
  const clean = {
    sourceType: "csv",
    previewRows: [row({ rowId: "a", accountId: LADYS.id, accountName: LADYS.name })]
  };
  for (const busy of [{ isSubmitting: true }, { isParsingStatement: true }]) {
    const result = blockersFor(clean, busy);
    assert.equal(result.isCommitDisabled, true);
    assert.deepEqual(result.blockers, []);
  }
});

test("an OCR reconciliation diagnostic hard-blocks commit without a Commit anyway question", () => {
  const result = blockersFor({
    previewRows: [row({ rowId: "ocr-row", accountName: LADYS.name, accountId: LADYS.id })],
    statementCheckpoints: [{ accountName: LADYS.name, accountId: LADYS.id, checkpointMonth: "2026-05" }],
    statementReconciliations: [{ accountName: LADYS.name, accountId: LADYS.id, status: "matched", checkpointMonth: "2026-05" }]
  }, { hasOcrRecovery: true });

  assert.equal(result.isCommitDisabled, true);
  assert.equal(result.commitQuestion, null);
  assert.equal(result.blockers.some((blocker) => blocker.kind === "statement-ocr-recovery"), true);
});

// The rules the panel used before the blocker model, kept verbatim as the
// reference: import-preview-model.js `isCommitDisabled` and imports-panel.jsx
// `buildStatementCommitWarning`.
function legacyIsCommitDisabled({ previewRows, statementCheckpoints, statementReconciliations, unknownCategoryMode, unknownCategories, accounts, isSubmitting, isParsingStatement }) {
  const accountNameCounts = accounts.reduce((counts, account) => counts.set(account.name, (counts.get(account.name) ?? 0) + 1), new Map());
  const visiblePreviewRows = previewRows.filter((item) => !item.isStatementMatchResolved && !(item.isCertifiedConflict && item.commitStatus === "skipped"));
  const skippedPreviewRowCount = visiblePreviewRows.filter((item) => item.commitStatus === "skipped").length;
  const needsReviewPreviewRowCount = visiblePreviewRows.filter((item) => item.commitStatus === "needs_review").length;
  const commitPayloadPreviewRows = previewRows.filter((item) => item.commitStatus !== "skipped" && item.commitStatus !== "needs_review");
  const counts = new Map();
  for (const checkpoint of statementCheckpoints) {
    const key = checkpoint.accountId ?? checkpoint.accountName;
    if (key) counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const hasDuplicateCheckpointAccounts = Array.from(counts.values()).some((count) => count > 1);
  const hasCheckpointOnlyCommit = statementCheckpoints.length > 0 && commitPayloadPreviewRows.length === 0;
  const hasMatchedCheckpointOnlyCommit = hasCheckpointOnlyCommit && statementReconciliations.length > 0 && statementReconciliations.every((item) => item.status === "matched");
  const hasUnmappedAccounts = commitPayloadPreviewRows.some((item) => !item.accountId && (!item.accountName || (accountNameCounts.get(item.accountName) ?? 0) !== 1));
  const hasBlockingCategoryPolicy = unknownCategoryMode === "block" && Boolean(unknownCategories?.length);
  const hasCommitPayload = commitPayloadPreviewRows.length > 0 || statementCheckpoints.length > 0;
  void skippedPreviewRowCount;
  return isSubmitting
    || isParsingStatement
    || !hasCommitPayload
    || hasUnmappedAccounts
    || (hasCheckpointOnlyCommit && !hasMatchedCheckpointOnlyCommit)
    || hasBlockingCategoryPolicy
    || hasDuplicateCheckpointAccounts
    || needsReviewPreviewRowCount > 0;
}

function legacyCommitWarningKind({ sourceType, statementCheckpoints, isPreviewDirty, statementReconciliations }) {
  if (sourceType !== "pdf" || !statementCheckpoints.length) return null;
  if (isPreviewDirty) return "stale_check";
  return statementReconciliations.some((item) => item.status !== "matched") ? "statement_mismatch" : null;
}

test("the commit is disabled, or asks first, in exactly the cases the old rules said", () => {
  const rowVariants = [
    [],
    [row({ rowId: "ok", accountId: LADYS.id, accountName: LADYS.name })],
    [row({ rowId: "unmapped", accountName: "Mystery Card" })],
    [row({ rowId: "nameless" })],
    [row({ rowId: "by-name", accountName: LADYS.name })],
    [row({ rowId: "review", accountId: LADYS.id, accountName: LADYS.name, commitStatus: "needs_review" })],
    [row({ rowId: "skipped", accountId: LADYS.id, accountName: LADYS.name, commitStatus: "skipped" })],
    [row({ rowId: "resolved-review", accountId: LADYS.id, commitStatus: "needs_review", isStatementMatchResolved: true })],
    [row({ rowId: "conflict", accountId: LADYS.id, commitStatus: "skipped", isCertifiedConflict: true }), row({ rowId: "ok2", accountId: LADYS.id, accountName: LADYS.name })]
  ];
  const checkpointVariants = [
    [],
    [{ detectedAccountName: LADYS.name, accountName: LADYS.name, accountId: LADYS.id, checkpointMonth: "2026-05" }],
    [
      { detectedAccountName: "A", accountName: LADYS.name, accountId: LADYS.id, checkpointMonth: "2026-05" },
      { detectedAccountName: "B", accountName: LADYS.name, accountId: LADYS.id, checkpointMonth: "2026-05" }
    ]
  ];
  const reconciliationVariants = [
    [],
    [{ accountName: LADYS.name, accountId: LADYS.id, status: "matched", deltaMinor: 0, checkpointMonth: "2026-05" }],
    [{ accountName: LADYS.name, accountId: LADYS.id, status: "mismatch", deltaMinor: 125, checkpointMonth: "2026-05" }]
  ];
  // Duplicate account names make a by-name row ambiguous.
  const accountVariants = [[LADYS, PRVI], [LADYS, { id: "acct-ladys-2", name: LADYS.name }]];
  let cases = 0;
  for (const previewRows of rowVariants) {
    for (const statementCheckpoints of checkpointVariants) {
      for (const statementReconciliations of reconciliationVariants) {
        for (const accounts of accountVariants) {
          for (const sourceType of ["pdf", "csv"]) {
            for (const [unknownCategoryMode, unknownCategories] of [["other", ["Pets"]], ["block", ["Pets"]], ["block", []]]) {
              for (const isPreviewDirty of [false, true]) {
                for (const [isSubmitting, isParsingStatement] of [[false, false], [true, false], [false, true]]) {
                  const input = { previewRows, statementCheckpoints, statementReconciliations, accounts, sourceType, unknownCategoryMode, unknownCategories };
                  const previewModel = buildImportPreviewModel({
                    accounts,
                    preview: { statementReconciliations, unknownCategories, overlapImports: [] },
                    previewRows,
                    statementCheckpoints,
                    statementImportMeta: { sourceType, parserKey: "x" },
                    dismissedOverlapIds: [],
                    unknownCategoryMode,
                    isSubmitting,
                    isParsingStatement
                  });
                  const result = buildImportBlockers({
                    previewModel,
                    hasPreview: true,
                    sourceType,
                    statementCheckpointCount: statementCheckpoints.length,
                    unknownCategoryCount: unknownCategories.length,
                    isPreviewDirty,
                    isSubmitting,
                    isParsingStatement,
                    areTotalsVisible: true,
                    formatMoney
                  });
                  const label = JSON.stringify({ ...input, isPreviewDirty, isSubmitting, isParsingStatement });
                  const expectedDisabled = legacyIsCommitDisabled({ ...input, isSubmitting, isParsingStatement });
                  assert.equal(result.isCommitDisabled, expectedDisabled, label);
                  assert.equal(result.commitQuestion?.kind ?? null, legacyCommitWarningKind({ ...input, isPreviewDirty }), label);
                  // A disabled commit always says why (unless a save is in flight),
                  // and an enabled one has nothing blocking left.
                  const disablers = result.blockers.filter((blocker) => blocker.effect === "disable");
                  if (!isSubmitting && !isParsingStatement) {
                    assert.equal(disablers.length > 0, expectedDisabled, label);
                  }
                  // A question to answer before committing always has a chip.
                  if (result.commitQuestion) {
                    assert.ok(result.blockers.some((blocker) => blocker.effect === "ask" || blocker.effect === "disable"), label);
                  }
                  cases += 1;
                }
              }
            }
          }
        }
      }
    }
  }
  assert.equal(cases, 9 * 3 * 3 * 2 * 2 * 3 * 2 * 3);
});

test("the preview names what a commit saves, which picks the commit button's words", () => {
  const checkpoints = [{ detectedAccountName: LADYS.name, accountName: LADYS.name, accountId: LADYS.id, checkpointMonth: "2026-05" }];
  const kind = (previewRows, statementCheckpoints = checkpoints) => {
    const model = previewModelFor({ previewRows, statementCheckpoints });
    return { kind: model.commitKind, label: model.commitLabel };
  };
  assert.deepEqual(kind([row({ rowId: "a", accountId: LADYS.id, accountName: LADYS.name })]), { kind: "rows", label: "Commit import to ledger" });
  // Every row already covered: only the statement balance is saved.
  assert.deepEqual(kind([row({ rowId: "a", accountId: LADYS.id, accountName: LADYS.name, commitStatus: "skipped" })]), {
    kind: "covered_checkpoint",
    label: "Save statement balance"
  });
  // No rows at all: an empty statement checkpoint.
  assert.deepEqual(kind([]), { kind: "empty_checkpoint", label: "Save empty statement checkpoint" });
  // Without a checkpoint, nothing to import is still a row commit.
  assert.deepEqual(kind([], []), { kind: "rows", label: "Commit import to ledger" });
});

// Rows the ledger already has, as a statement preview marks them once the
// card balances: certified earlier (skipped) or a mid-cycle entry the commit
// certifies (included with a reconciliation target).
const MATCHED = { reconciliationMatch: { existingTransactionId: "entry-1", matchKind: "exact" }, isStatementMatchResolved: true };
const certifiedRow = (rowId) => row({ rowId, accountId: LADYS.id, accountName: LADYS.name, commitStatus: "skipped", ...MATCHED });
const midCycleRow = (rowId) => row({ rowId, accountId: LADYS.id, accountName: LADYS.name, reconciliationTargetTransactionId: `entry-${rowId}`, ...MATCHED });
const ladysCheckpoint = [{ detectedAccountName: LADYS.name, accountName: LADYS.name, accountId: LADYS.id, checkpointMonth: "2026-05" }];
const ladysMatched = [{ accountName: LADYS.name, accountId: LADYS.id, status: "matched", deltaMinor: 0, checkpointMonth: "2026-05" }];
const ladysMismatch = [{ accountName: LADYS.name, accountId: LADYS.id, status: "mismatch", deltaMinor: -1240, checkpointMonth: "2026-05" }];

test("a statement already in the ledger is never called empty", () => {
  // Every row came in earlier (an activity export certified by an earlier
  // statement), so the review hides them all. It is covered, not empty.
  const model = previewModelFor({
    previewRows: [certifiedRow("a"), certifiedRow("b"), certifiedRow("c")],
    statementCheckpoints: ladysCheckpoint,
    statementReconciliations: ladysMatched
  });
  assert.equal(model.commitKind, "covered_checkpoint");
  assert.equal(model.commitLabel, "Save statement balance");
  assert.equal(model.previousStatementImport, null);
  assert.equal(model.hasEmptyStatementCheckpointOnly, false);
  assert.equal(model.hasAlreadyCoveredCheckpointRefresh, true);
  assert.deepEqual(model.ledgerMatchedStatement, { matchedCount: 3, toCertifyCount: 0 });
  assert.equal(model.matchedPreviewRowCount, 3);
});

test("a statement whose rows all match mid-cycle entries certifies them", () => {
  const model = previewModelFor({
    previewRows: [midCycleRow("a"), midCycleRow("b"), certifiedRow("c")],
    statementCheckpoints: ladysCheckpoint,
    statementReconciliations: ladysMatched
  });
  assert.equal(model.commitKind, "certify_rows");
  assert.equal(model.commitLabel, "Certify 2 matched entries");
  assert.deepEqual(model.ledgerMatchedStatement, { matchedCount: 3, toCertifyCount: 2 });

  const one = previewModelFor({ previewRows: [midCycleRow("a")], statementCheckpoints: ladysCheckpoint, statementReconciliations: ladysMatched });
  assert.equal(one.commitLabel, "Certify 1 matched entry");
});

test("a statement with a new row, or one that does not balance, is not all matched", () => {
  const withNewRow = previewModelFor({
    previewRows: [midCycleRow("a"), row({ rowId: "new", accountId: LADYS.id, accountName: LADYS.name })],
    statementCheckpoints: ladysCheckpoint,
    statementReconciliations: ladysMatched
  });
  assert.equal(withNewRow.commitKind, "rows");
  assert.equal(withNewRow.commitLabel, "Commit import to ledger");
  assert.equal(withNewRow.ledgerMatchedStatement, null);

  const unbalanced = previewModelFor({
    previewRows: [certifiedRow("a"), certifiedRow("b")],
    statementCheckpoints: ladysCheckpoint,
    statementReconciliations: ladysMismatch
  });
  assert.equal(unbalanced.commitKind, "covered_checkpoint");
  assert.equal(unbalanced.ledgerMatchedStatement, null);

  const waitingOnReview = previewModelFor({
    previewRows: [midCycleRow("a"), row({ rowId: "review", accountId: LADYS.id, accountName: LADYS.name, commitStatus: "needs_review" })],
    statementCheckpoints: ladysCheckpoint,
    statementReconciliations: ladysMatched
  });
  assert.equal(waitingOnReview.ledgerMatchedStatement, null);

  // Mid-cycle matches without a statement checkpoint are a plain commit.
  const noCheckpoint = previewModelFor({ previewRows: [midCycleRow("a")], sourceType: "csv" });
  assert.equal(noCheckpoint.commitKind, "rows");
  assert.equal(noCheckpoint.ledgerMatchedStatement, null);
});

const earlierImport = { importId: "import-may", sourceLabel: "eStatement_UOB_Cards_12May2026", importedAt: "2026-05-14 03:00:00" };
const ladysSavedBefore = [{ ...ladysMatched[0], previousStatementImport: earlierImport }];

test("a statement saved before says so: save it again only after a question", () => {
  const input = {
    previewRows: [certifiedRow("a"), certifiedRow("b")],
    statementCheckpoints: ladysCheckpoint,
    statementReconciliations: ladysSavedBefore
  };
  const model = previewModelFor(input);
  assert.equal(model.commitKind, "saved_again");
  assert.equal(model.commitLabel, "Save it again anyway");
  assert.deepEqual(model.previousStatementImport, earlierImport);

  const result = blockersFor(input);
  assert.equal(result.isCommitDisabled, false);
  assert.deepEqual(result.blockers, []);
  assert.deepEqual(result.commitQuestion, {
    kind: "save_again",
    message: "This statement is already saved, from eStatement_UOB_Cards_12May2026 on 14 May 2026. Saving again adds a second import with no new rows.",
    confirmLabel: "Save again"
  });
});

test("a statement saved before only for some cards, or never, saves its balance without asking", () => {
  const partly = {
    previewRows: [certifiedRow("a")],
    statementCheckpoints: ladysCheckpoint,
    statementReconciliations: [...ladysSavedBefore, { accountName: PRVI.name, accountId: PRVI.id, status: "matched", deltaMinor: 0, checkpointMonth: "2026-05" }]
  };
  assert.equal(previewModelFor(partly).commitKind, "covered_checkpoint");
  assert.equal(blockersFor(partly).commitQuestion, null);

  const never = { previewRows: [certifiedRow("a")], statementCheckpoints: ladysCheckpoint, statementReconciliations: ladysMatched };
  assert.equal(blockersFor(never).commitQuestion, null);
});

test("a statement saved before that does not balance asks about the difference first", () => {
  const result = blockersFor({
    previewRows: [certifiedRow("a")],
    statementCheckpoints: ladysCheckpoint,
    statementReconciliations: [{ ...ladysMismatch[0], previousStatementImport: earlierImport }]
  });
  assert.equal(result.commitQuestion.kind, "statement_mismatch");
});
