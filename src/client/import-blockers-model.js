import { importMessages } from "./copy/en-SG-imports";
import { formatDateOnly, formatMonthLabel } from "./formatters";
import { getMissingStatementMonths } from "./import-preview-model";

// What stands between the file in review and a clean commit, in the order
// the user should fix it. This is the one place the commit rules live: the
// "Before you can commit:" chips, the commit bar's "things left", whether
// the commit button is disabled and whether it asks first all read it.
//
// A blocker is { id, kind, effect, label, target, order }:
// - id: stable across re-renders of the same preview (a card keeps its id)
// - kind: what it is (see BLOCKER_ORDER)
// - effect: "disable" (the commit is off until it is fixed), "ask" (the
//   commit asks first) or "preview" (a CSV column still to map; there is
//   no preview to commit yet)
// - label: the chip's words (copy/en-SG.js)
// - target: where the fix is ({ kind, ...detail }); import-jump.js scrolls
//   to it and focuses it
// - order: smaller first; account mapping before card checks before rows
const BLOCKER_ORDER = {
  "column-mapping": 10,
  "account-mapping": 20,
  "card-accounts": 30,
  "unknown-categories": 40,
  "statement-check": 50,
  "statement-ocr-recovery": 55,
  "statement-card": 60,
  "rows-to-check": 70,
  "nothing-to-import": 80
};

/**
 * @param {object} input
 * @param {object | null} input.previewModel buildImportPreviewModel's facts
 *   (null without a preview)
 * @param {boolean} input.hasPreview
 * @param {string} input.sourceType "pdf" for an official statement
 * @param {number} input.statementCheckpointCount
 * @param {number} input.unknownCategoryCount
 * @param {boolean} input.isPreviewDirty rows changed since the check ran
 * @param {boolean} input.isSubmitting
 * @param {boolean} input.isParsingStatement
 * @param {boolean} [input.hasOcrRecovery]
 * @param {{ readyForMapping: boolean, missingRequiredFields: string[], duplicateMappings: string[] }} [input.columnMapping]
 * @param {boolean} input.areTotalsVisible money privacy: hidden shows no amounts
 * @param {(minor: number) => string} input.formatMoney
 */
export function buildImportBlockers({
  previewModel,
  hasPreview,
  sourceType,
  statementCheckpointCount,
  unknownCategoryCount,
  isPreviewDirty,
  isSubmitting,
  isParsingStatement,
  hasOcrRecovery = false,
  columnMapping = { readyForMapping: false, missingRequiredFields: [], duplicateMappings: [] },
  areTotalsVisible,
  formatMoney
}) {
  if (!hasPreview || !previewModel) {
    const blockers = buildColumnBlockers(columnMapping);
    return { blockers, remainingCount: blockers.length, isCommitDisabled: true, commitQuestion: null, matched: null };
  }

  // An investment statement saves what the account was worth: no balance to
  // check, so no card to match and no check to refresh.
  const isStatement = sourceType === "pdf" && statementCheckpointCount > 0 && !previewModel.isInvestmentStatement;
  const reconciliations = previewModel.statementReconciliations ?? [];
  const openCards = reconciliations.filter((item) => item.status !== "matched");
  // A statement saved without rows needs every card to match first; a
  // statement with rows asks before saving a difference.
  const isCheckpointOnlyOpen = previewModel.hasCheckpointOnlyCommit && !previewModel.hasMatchedCheckpointOnlyCommit && !previewModel.isInvestmentStatement;
  const cardEffect = isCheckpointOnlyOpen ? "disable" : isStatement ? "ask" : null;
  const blockers = [];

  const isMappingAsked = previewModel.hasUnmappedAccounts;
  if (isMappingAsked) {
    blockers.push(blocker("account-mapping", {
      label: importMessages.blockerMapAccounts(Math.max(1, previewModel.unmappedCommitAccountNames?.length ?? 1)),
      target: { kind: "account-mapping" }
    }));
  }
  if (previewModel.hasDuplicateCheckpointAccounts) {
    blockers.push(blocker("card-accounts", {
      label: importMessages.blockerCardAccounts,
      target: { kind: "statement-details" }
    }));
  }
  if (previewModel.hasBlockingCategoryPolicy) {
    blockers.push(blocker("unknown-categories", {
      label: importMessages.blockerUnknownCategories(unknownCategoryCount),
      target: { kind: "unknown-categories" }
    }));
  }
  const isStale = isStatement && isPreviewDirty;
  const isUnchecked = isCheckpointOnlyOpen && !openCards.length;
  if (isStale || isUnchecked) {
    blockers.push(blocker("statement-check", {
      effect: isUnchecked ? "disable" : "ask",
      label: importMessages.blockerRefreshCheck,
      target: { kind: "statement-check" }
    }));
  }
  if (hasOcrRecovery) {
    blockers.push(blocker("statement-ocr-recovery", {
      label: importMessages.blockerOcrRecovery,
      target: { kind: "statement-ocr-recovery" },
      order: BLOCKER_ORDER["statement-ocr-recovery"]
    }));
  }
  if (cardEffect) {
    // A card with no account yet is named once, by the "Map" chip; its own
    // chip comes back once it is mapped. The commit question still counts it.
    const unmappedNames = new Set(previewModel.unmappedCommitAccountNames ?? []);
    const isNamedByMapping = (card) => isMappingAsked && (card.status === "unknown_account" || unmappedNames.has(card.accountName));
    openCards.filter((card) => !isNamedByMapping(card)).forEach((card, index) => {
      blockers.push(blocker("statement-card", {
        id: `statement-card:${card.accountName}:${card.checkpointMonth ?? ""}`,
        effect: cardEffect,
        order: BLOCKER_ORDER["statement-card"] + index / 100,
        label: describeCardLabel(card, {
          areTotalsVisible,
          formatMoney,
          missingMonths: card.accountId ? getMissingStatementMonths(previewModel.statementDiagnosis, card.accountId) : []
        }),
        target: { kind: "statement-card", accountName: card.accountName, checkpointMonth: card.checkpointMonth }
      }));
    });
  }
  if (previewModel.needsReviewPreviewRowCount > 0) {
    blockers.push(blocker("rows-to-check", {
      label: importMessages.blockerRowsToCheck(previewModel.needsReviewPreviewRowCount),
      target: { kind: "review-rows" }
    }));
  } else if (!previewModel.hasCommitPayload) {
    // Rows to check also leave nothing to commit; that chip says it better.
    blockers.push(blocker("nothing-to-import", {
      label: importMessages.blockerNothingToImport,
      target: { kind: "preview-rows" }
    }));
  }
  blockers.sort((left, right) => left.order - right.order);

  const matchedCount = previewModel.matchedPreviewRowCount ?? 0;
  return {
    blockers,
    remainingCount: blockers.length,
    isCommitDisabled: isSubmitting || isParsingStatement || blockers.some((item) => item.effect === "disable"),
    commitQuestion: hasOcrRecovery ? null : buildCommitQuestion({ isStatement, isPreviewDirty, openCards, previewModel }),
    matched: matchedCount ? { count: matchedCount, label: importMessages.blockerRowsMatched(matchedCount) } : null
  };
}

function blocker(kind, { id = kind, effect = "disable", order = BLOCKER_ORDER[kind], label, target }) {
  return { id, kind, effect, label, target, order };
}

function buildColumnBlockers({ readyForMapping, missingRequiredFields = [], duplicateMappings = [] }) {
  if (!readyForMapping) {
    return [];
  }
  return [
    ...missingRequiredFields.map((field) => ({ id: `column:${field}`, label: importMessages.blockerMapColumn(field), field })),
    ...duplicateMappings.map((field) => ({ id: `column-duplicate:${field}`, label: importMessages.blockerDuplicateColumn(field), field }))
  ].map(({ id, label, field }, index) => ({
    id,
    kind: "column-mapping",
    effect: "preview",
    label,
    target: { kind: "column-mapping", field },
    order: BLOCKER_ORDER["column-mapping"] + index / 100
  }));
}

// "UOB Lady's Card off by $12.40". Hidden money names the card only: no
// amount and no word that gives away which way it is off. A card whose
// earlier statements were never imported says which to import first
// ("OCBC 365 Credit Card: import Sept 2026 first"), with or without money.
function describeCardLabel(card, { areTotalsVisible, formatMoney, missingMonths = [] }) {
  if (missingMonths.length) {
    return importMessages.blockerCardImportFirst(card.accountName, missingMonths.map(formatMonthLabel).join(" and "));
  }
  const deltaMinor = Number(card.deltaMinor ?? 0);
  return areTotalsVisible && deltaMinor !== 0
    ? importMessages.blockerCardOff(card.accountName, formatMoney(Math.abs(deltaMinor)))
    : importMessages.blockerCardNoMatch(card.accountName);
}

// Committing a statement that does not close, whose check is out of date
// after a row edit, or that was saved before, asks first. The panel adds
// what each answer does.
function buildCommitQuestion({ isStatement, isPreviewDirty, openCards, previewModel }) {
  if (!isStatement) {
    return null;
  }
  if (isPreviewDirty) {
    return {
      kind: "stale_check",
      message: importMessages.commitStatementStaleWarning,
      confirmLabel: importMessages.statementReconciliationRefresh
    };
  }
  if (!openCards.length) {
    // A card that does not close asks about that first.
    const previous = previewModel.commitKind === "saved_again" ? previewModel.previousStatementImport : null;
    return previous
      ? {
        kind: "save_again",
        message: importMessages.commitSaveAgainWarning(previous.sourceLabel, formatDateOnly(previous.importedAt)),
        confirmLabel: importMessages.commitSaveAgain
      }
      : null;
  }
  const accountNames = openCards.map((item) => item.accountName);
  return {
    kind: "statement_mismatch",
    accountNames,
    message: importMessages.commitStatementMismatchWarning(joinNames(accountNames)),
    confirmLabel: importMessages.commitAnyway
  };
}

function joinNames(names) {
  return names.length <= 1 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
}
