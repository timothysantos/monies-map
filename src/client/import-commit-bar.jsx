import * as Popover from "@radix-ui/react-popover";
import { useState } from "react";
import "./import-review.css";
import { messages } from "./copy/en-SG";

// The one commit control of an import preview. It stays in view at the
// bottom of the review, says what the commit will do, and asks first when
// the statement does not close or its check is out of date.
export function ImportCommitBar({
  previewRows,
  statementCheckpointCount = 0,
  reconciledExistingRowCount = 0,
  statementImportSourceType = "csv",
  isCommitDisabled,
  isSubmitting,
  commitLabel,
  commitWarning,
  onCommit,
  onStartOver
}) {
  const visibleRows = previewRows.filter((row) => (
    !row.isStatementMatchResolved && !(row.isCertifiedConflict && row.commitStatus === "skipped")
  ));
  const newImportCount = visibleRows.filter((row) => (
    (row.commitStatus === "included" || !row.commitStatus) && !row.reconciliationTargetTransactionId
  )).length;
  const skippedCount = visibleRows.filter((row) => row.commitStatus === "skipped").length;
  const needsReviewCount = visibleRows.filter((row) => row.commitStatus === "needs_review").length;
  const summaryItems = [
    newImportCount || !statementCheckpointCount ? { text: messages.imports.willImportRows(newImportCount) } : null,
    reconciledExistingRowCount ? { text: messages.imports.willReconcileExistingRows(reconciledExistingRowCount, statementImportSourceType) } : null,
    statementCheckpointCount ? { text: messages.imports.willSaveStatementCheckpoints(statementCheckpointCount) } : null,
    skippedCount ? { text: messages.imports.willSkipRows(skippedCount) } : null,
    needsReviewCount ? { text: messages.imports.needsReviewRows(needsReviewCount), tone: "warning" } : null
  ].filter(Boolean);

  return (
    <div className="import-commit-bar" role="region" aria-label={messages.imports.previewCommitSummaryLabel}>
      <p className="import-commit-bar-summary import-preview-status-row">
        {summaryItems.map((item, index) => (
          <span key={item.text} className={item.tone ? `is-${item.tone}` : undefined}>
            {index ? " · " : ""}{item.text}
          </span>
        ))}
      </p>
      <div className="import-commit-bar-actions">
        {onStartOver ? (
          <button type="button" className="subtle-action" onClick={onStartOver} disabled={isSubmitting}>
            {messages.imports.startOver}
          </button>
        ) : null}
        <ImportCommitButton
          disabled={isCommitDisabled}
          isSubmitting={isSubmitting}
          onCommit={onCommit}
          label={commitLabel}
          warning={commitWarning}
        />
      </div>
    </div>
  );
}

function ImportCommitButton({ disabled, isSubmitting, onCommit, label, warning }) {
  const [isWarningOpen, setIsWarningOpen] = useState(false);
  const button = (
    <button
      type="button"
      className="import-commit-button"
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
              <button type="button" className="subtle-action">{messages.imports.commitWarningCancel}</button>
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
