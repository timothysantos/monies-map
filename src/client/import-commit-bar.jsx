import * as Popover from "@radix-ui/react-popover";
import { useState } from "react";
import "./import-review.css";
import { messages } from "./copy/en-SG";
import { importMessages } from "./copy/en-SG-imports";
import { ImportAskFirst } from "./import-batch-bar";

// The one commit control of an import preview. It stays in view at the
// bottom of the review, says what the commit will do, and asks first when
// the statement does not close or its check is out of date. While
// blockers remain (import-blockers-model.js) it says how many, with a jump
// to the first (J and K step through them, import-blocker-keys.js). On a
// phone the count opens the import progress sheet. While another file
// waits, "Skip for now" sends this one to the end of the queue. A statement
// whose rows are all in the ledger already says so in one sentence.
export function ImportCommitBar({
  previewRows,
  statementCheckpointCount = 0,
  ledgerMatchedStatement = null,
  reconciledExistingRowCount = 0,
  removedEntryCount = 0,
  reopenedEstimateCount = 0,
  statementImportSourceType = "csv",
  isCommitDisabled,
  isSubmitting,
  commitLabel,
  commitWarning,
  remainingCount = 0,
  onJumpToNext,
  onShowRemaining,
  skip,
  onCommit,
  onStartOver,
  isStatementSavedBefore = false
}) {
  const visibleRows = previewRows.filter((row) => (
    !row.isStatementMatchResolved && !(row.isCertifiedConflict && row.commitStatus === "skipped")
  ));
  const newImportCount = visibleRows.filter((row) => (
    (row.commitStatus === "included" || !row.commitStatus) && !row.reconciliationTargetTransactionId
  )).length;
  const skippedCount = visibleRows.filter((row) => row.commitStatus === "skipped").length;
  const needsReviewCount = visibleRows.filter((row) => row.commitStatus === "needs_review").length;
  const summaryItems = ledgerMatchedStatement ? [
    { text: importMessages.noRowsToImportAllInLedger(ledgerMatchedStatement.matchedCount, ledgerMatchedStatement.toCertifyCount) }
  ] : [
    newImportCount || !statementCheckpointCount ? { text: importMessages.willImportRows(newImportCount) } : null,
    reconciledExistingRowCount ? { text: importMessages.willReconcileExistingRows(reconciledExistingRowCount, statementImportSourceType) } : null,
    statementCheckpointCount ? { text: importMessages.willSaveStatementCheckpoints(statementCheckpointCount) } : null,
    skippedCount ? { text: importMessages.willSkipRows(skippedCount) } : null,
    removedEntryCount ? { text: importMessages.willRemoveEntries(removedEntryCount) } : null,
    reopenedEstimateCount ? { text: importMessages.willReopenEstimates(reopenedEstimateCount) } : null,
    needsReviewCount ? { text: importMessages.needsReviewRows(needsReviewCount), tone: "warning" } : null
  ].filter(Boolean);

  return (
    <div className="import-commit-bar" role="region" aria-label={importMessages.previewCommitSummaryLabel}>
      <p className="import-commit-bar-summary import-preview-status-row">
        {summaryItems.map((item, index) => (
          <span key={item.text} className={item.tone ? `is-${item.tone}` : undefined}>
            {index ? " · " : ""}{item.text}
          </span>
        ))}
      </p>
      {remainingCount && onJumpToNext ? (
        <span className="import-commit-bar-left">
          {onShowRemaining ? (
            <button type="button" className="subtle-action import-commit-bar-remaining" aria-haspopup="dialog" onClick={onShowRemaining}>
              {importMessages.blockerThingsLeft(remainingCount)}
            </button>
          ) : importMessages.blockerThingsLeft(remainingCount)}
          {" · "}
          <button type="button" className="subtle-action import-commit-bar-jump" title={importMessages.blockerJumpKeys} onClick={onJumpToNext}>
            {importMessages.blockerJumpNext}
          </button>
        </span>
      ) : null}
      <div className="import-commit-bar-actions">
        {onStartOver ? (
          <button
            type="button"
            className={isStatementSavedBefore ? "import-commit-button import-commit-start-over" : "subtle-action"}
            onClick={onStartOver}
            disabled={isSubmitting}
          >
            {importMessages.startOver}
          </button>
        ) : null}
        {skip ? (
          <ImportAskFirst question={skip.question} onConfirm={skip.onSkip}>
            {({ onClick }) => (
              <button type="button" className="subtle-action import-commit-bar-skip" disabled={isSubmitting} onClick={onClick}>
                {importMessages.skipForNow}
              </button>
            )}
          </ImportAskFirst>
        ) : null}
        <ImportCommitButton
          disabled={isCommitDisabled}
          isSubmitting={isSubmitting}
          onCommit={onCommit}
          label={commitLabel}
          warning={commitWarning}
          isSecondary={isStatementSavedBefore}
        />
      </div>
    </div>
  );
}

function ImportCommitButton({ disabled, isSubmitting, onCommit, label, warning, isSecondary = false }) {
  const [isWarningOpen, setIsWarningOpen] = useState(false);
  const button = (
    <button
      type="button"
      className={`import-commit-button${isSecondary ? " import-commit-secondary" : ""}`}
      disabled={disabled}
      onClick={warning ? undefined : onCommit}
    >
      {isSubmitting ? messages.common.working : label}
    </button>
  );
  if (!warning) {
    return button;
  }
  return (
    <Popover.Root open={isWarningOpen} onOpenChange={setIsWarningOpen}>
      <Popover.Trigger asChild>{button}</Popover.Trigger>
      <Popover.Portal>
        <Popover.Content className="delete-popover import-commit-warning" sideOffset={8} align="end">
          <p>{warning.message}</p>
          <div className="delete-popover-actions">
            <Popover.Close asChild>
              <button type="button" className="subtle-action">{importMessages.commitWarningCancel}</button>
            </Popover.Close>
            <button
              type="button"
              className="subtle-action"
              onClick={() => {
                setIsWarningOpen(false);
                warning.onConfirm();
              }}
            >
              {warning.confirmLabel}
            </button>
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
