import * as Dialog from "@radix-ui/react-dialog";
import * as Popover from "@radix-ui/react-popover";
import { useRef, useState } from "react";
import { Info } from "lucide-react";
import { DuplicateMatchPopover } from "./import-preview-rows-table";
import { messages } from "./copy/en-SG";
import { moniesClient } from "./monies-client-service";
import { DeleteRowButton } from "./ui-components";

const {
  accounts: accountService,
  format: formatService
} = moniesClient;

// Preview review surfaces the import guardrails while ImportsPanel keeps
// ownership of the mutable draft. The order below mirrors how a human usually
// reviews a risky import:
// 1. Can the app map statement accounts?
// 2. Are categories or overlaps blocking us?
// 3. Do statement balances reconcile?
// 4. Are any rows protected because of statement-certified history?
export function ImportPreviewReview({
  preview,
  previewRows,
  accounts,
  accountMappingAccountNames,
  knownAccountNames,
  detectedPreviewAccountNames,
  unknownPreviewAccountNames,
  unknownCategoryMode,
  showStatementAccountMapping,
  visibleOverlapImports,
  previewReconciliationRowCount,
  certifiedConflictRows,
  reconciledExistingRowCount,
  statementImportSourceType,
  skippedPreviewRowCount,
  needsReviewPreviewRowCount,
  statementReconciliations,
  hasStatementReconciliationMismatch,
  statementCheckpoints,
  viewId,
  hasDuplicateCheckpointAccounts,
  duplicateCheckpointAccounts,
  isSubmitting,
  canJumpToSkippedRows = false,
  onRemapPreviewAccount,
  onCreateStatementAccount,
  onDismissOverlap,
  onUpdatePreviewRowCommitStatus,
  onJumpToSkippedRows,
  onRefreshStatementReconciliation,
  onDeleteDiagnosticLedgerRow,
  onDeleteDiagnosticLedgerRows,
  onUpdateStatementCheckpoint
}) {
  if (!preview) {
    return null;
  }

  return (
    <>
      {/* Statement imports can discover account names that do not yet map cleanly into app accounts. */}
      {showStatementAccountMapping ? (
        <StatementAccountMapping
          accounts={accounts}
          accountMappingAccountNames={accountMappingAccountNames}
          knownAccountNames={knownAccountNames}
          detectedPreviewAccountNames={detectedPreviewAccountNames}
          unknownPreviewAccountNames={unknownPreviewAccountNames}
          previewRows={previewRows}
          statementCheckpoints={statementCheckpoints}
          onRemapPreviewAccount={onRemapPreviewAccount}
          onCreateStatementAccount={onCreateStatementAccount}
        />
      ) : null}

      {/* Unknown categories are informational unless policy says they block commit. */}
      {preview.unknownCategories?.length ? (
        <UnknownCategories
          categoryNames={preview.unknownCategories}
          unknownCategoryMode={unknownCategoryMode}
        />
      ) : null}

      {/* These pills give a fast count of what the larger preview table will contain. */}
      <PreviewGuardrailPills
        preview={preview}
        previewReconciliationRowCount={previewReconciliationRowCount}
        skippedPreviewRowCount={skippedPreviewRowCount}
        needsReviewPreviewRowCount={needsReviewPreviewRowCount}
        visibleOverlapImports={visibleOverlapImports}
        reconciledExistingRowCount={reconciledExistingRowCount}
        statementImportSourceType={statementImportSourceType}
      />

      {/* The exception register is the short list of why this preview needs attention. */}
      {preview.exceptionSummary?.length ? (
        <ExceptionRegister exceptions={preview.exceptionSummary} />
      ) : null}

      {/* Overlap imports explain why some rows may already be covered by previous work. */}
      {visibleOverlapImports.length ? (
        <OverlapImports
          imports={visibleOverlapImports}
          skippedPreviewRowCount={skippedPreviewRowCount}
          needsReviewPreviewRowCount={needsReviewPreviewRowCount}
          hasStatementReconciliationMismatch={hasStatementReconciliationMismatch}
          hasStatementReconciliations={statementReconciliations.length > 0}
          statementReconciliations={statementReconciliations}
          canJumpToSkippedRows={canJumpToSkippedRows}
          onDismissOverlap={onDismissOverlap}
          onJumpToSkippedRows={onJumpToSkippedRows}
        />
      ) : null}

      {/* Statement balance checks only appear when the source provided checkpoints. */}
      {statementReconciliations.length ? (
        <StatementBalanceCheck
          reconciliations={statementReconciliations}
          hasMismatch={hasStatementReconciliationMismatch}
          viewId={viewId}
          isSubmitting={isSubmitting}
          onRefreshStatementReconciliation={onRefreshStatementReconciliation}
          onDeleteDiagnosticLedgerRow={onDeleteDiagnosticLedgerRow}
          onDeleteDiagnosticLedgerRows={onDeleteDiagnosticLedgerRows}
        />
      ) : null}

      {/* Certified conflicts are the rows we should least casually overwrite. */}
      {certifiedConflictRows.length ? (
        <CertifiedConflictRows
          rows={certifiedConflictRows}
          onUpdatePreviewRowCommitStatus={onUpdatePreviewRowCommitStatus}
        />
      ) : null}

      {/* Draft checkpoints remain editable until commit. */}
      {statementCheckpoints.length ? (
        <StatementCheckpointDrafts
          accounts={accounts}
          knownAccountNames={knownAccountNames}
          statementCheckpoints={statementCheckpoints}
          hasDuplicateCheckpointAccounts={hasDuplicateCheckpointAccounts}
          duplicateCheckpointAccounts={duplicateCheckpointAccounts}
          onUpdateStatementCheckpoint={onUpdateStatementCheckpoint}
        />
      ) : null}

      {previewReconciliationRowCount ? (
        <div className="import-warning import-warning-attention">
          <strong>{messages.imports.reconciliationMatchesTitle}</strong>
          <p className="lede compact">{messages.imports.reconciliationMatchesDetail}</p>
        </div>
      ) : null}
    </>
  );
}

function CertifiedConflictRows({ rows, onUpdatePreviewRowCommitStatus }) {
  const [restoreTarget, setRestoreTarget] = useState(null);
  return (
    <>
      <div className="import-warning import-warning-attention">
        <strong>{messages.imports.certifiedConflictTitle(rows.length)}</strong>
        <p className="lede compact">{messages.imports.certifiedConflictDetail}</p>
        <div className="stack">
          {rows.map((row) => {
            const match = row.reconciliationMatch;
            return (
              <div key={row.rowId} className="import-card import-card-compact">
                <div className="import-history-main">
                  <strong>{messages.imports.certifiedConflictRow(
                    formatService.formatDateOnly(row.date),
                    row.description,
                    formatService.formatMinorInput(row.amountMinor)
                  )}</strong>
                  <span className="import-history-inline">
                    {messages.common.triplet(
                      row.accountName ?? messages.common.emptyValue,
                      row.entryType,
                      formatService.formatMinorInput(row.amountMinor)
                    )}
                  </span>
                  <p className="lede compact">{row.commitStatusReason}</p>
                  {match ? (
                    <div className="duplicate-row-detail-line">
                      <small className="duplicate-row-detail">
                        {messages.imports.duplicateRowDetail(formatDuplicateMatch(match))}
                      </small>
                      <DuplicateMatchPopover row={row} match={match} statementImportSourceType="pdf" />
                    </div>
                  ) : null}
                  <div className="import-row-actions">
                    <button
                      type="button"
                      className="subtle-action"
                      onClick={() => {
                        if (match?.matchKind === "exact") {
                          setRestoreTarget(row);
                          return;
                        }
                        onUpdatePreviewRowCommitStatus(row.rowId, "included");
                      }}
                    >
                      {messages.imports.restorePreviewRow}
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <Dialog.Root open={Boolean(restoreTarget)} onOpenChange={(open) => { if (!open) setRestoreTarget(null); }}>
        <Dialog.Portal>
          <Dialog.Overlay className="note-dialog-overlay" />
          <Dialog.Content className="note-dialog-content settings-account-dialog">
            <div className="note-dialog-head">
              <div>
                <Dialog.Title>{messages.imports.restorePreviewRow}</Dialog.Title>
                <Dialog.Description>{messages.imports.restoreExactCoveredRowConfirm}</Dialog.Description>
              </div>
              <Dialog.Close className="dialog-close-button" aria-label="Close confirmation dialog">×</Dialog.Close>
            </div>
            <div className="note-dialog-actions">
              <Dialog.Close className="subtle-action">Cancel</Dialog.Close>
              <button
                type="button"
                className="dialog-primary"
                onClick={() => {
                  if (restoreTarget) {
                    onUpdatePreviewRowCommitStatus(restoreTarget.rowId, "included");
                  }
                  setRestoreTarget(null);
                }}
              >
                Restore row
              </button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </>
  );
}

function ExceptionRegister({ exceptions }) {
  return (
    <div className="import-warning import-warning-review">
      <strong>{messages.imports.exceptionRegisterTitle}</strong>
      <p className="lede compact">{messages.imports.exceptionRegisterDetail}</p>
      <div className="pill-row dense">
        {exceptions.map((item) => (
          <span
            key={item.kind}
            className={`pill ${item.tone === "blocking" ? "warning" : item.tone === "review" ? "neutral" : ""}`}
          >
            {messages.imports.exceptionKinds[item.kind](item.count)}
          </span>
        ))}
      </div>
    </div>
  );
}

function StatementAccountMapping({
  accounts,
  accountMappingAccountNames,
  knownAccountNames,
  detectedPreviewAccountNames,
  unknownPreviewAccountNames,
  previewRows,
  statementCheckpoints,
  onRemapPreviewAccount,
  onCreateStatementAccount
}) {
  // Account names in statements are not reliable foreign keys. We treat the
  // detected label as a hint, then let the user anchor it to a concrete account.
  const accountOptions = accountService.getSelectOptions(accounts, { valueKey: "id" });
  const accountOptionsByName = accounts.reduce((optionsByName, account) => {
    const current = optionsByName.get(account.name) ?? [];
    current.push(account);
    optionsByName.set(account.name, current);
    return optionsByName;
  }, new Map());
  const checkpointByDetectedName = statementCheckpoints.reduce((checkpointsByName, checkpoint) => {
    checkpointsByName.set(checkpoint.detectedAccountName ?? checkpoint.accountName, checkpoint);
    return checkpointsByName;
  }, new Map());

  function selectedAccountValue(accountName) {
    const checkpoint = checkpointByDetectedName.get(accountName);
    if (checkpoint?.accountId) {
      return checkpoint.accountId;
    }

    const mappedRowAccountIds = new Set(
      previewRows
        .filter((row) => getPreviewRowStatementAccountName(row) === accountName && row.accountId)
        .map((row) => row.accountId)
    );
    if (mappedRowAccountIds.size === 1) {
      return Array.from(mappedRowAccountIds)[0];
    }

    const accountMatches = accountOptionsByName.get(checkpoint?.accountName ?? accountName) ?? [];
    return accountMatches.length === 1 ? accountMatches[0].id : "";
  }

  return (
    <div className="import-warning import-warning-action">
      <strong>{unknownPreviewAccountNames.length ? messages.imports.unknownAccounts : messages.imports.accountMappingTitle}</strong>
      <p className="lede compact">{messages.imports.accountMappingDetail}</p>
      <div className="statement-account-map-grid">
        {accountMappingAccountNames.map((accountName) => (
          <div key={accountName} className="statement-account-map-row">
            <label className="entries-filter">
              <span className="entries-filter-label">{messages.imports.detectedAccount(accountName)}</span>
              <select
                className="table-edit-input"
                value={selectedAccountValue(accountName)}
                onChange={(event) => onRemapPreviewAccount(accountName, event.target.value)}
              >
                <option value="">{messages.imports.chooseAccount}</option>
                {accountOptions.map((account) => (
                  <option key={account.id} value={account.value}>{account.label}</option>
                ))}
              </select>
            </label>
            <button type="button" className="subtle-action" onClick={() => onCreateStatementAccount(accountName)}>
              {messages.imports.createDetectedAccount}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

function getPreviewRowStatementAccountName(row) {
  return row.statementAccountName ?? row.rawRow?.statementAccountName ?? row.rawRow?.statementAccount ?? row.rawRow?.account ?? row.accountName;
}

function formatDuplicateMatch(match) {
  return messages.common.triplet(
    formatService.formatDateOnly(match.date),
    match.accountName ?? messages.common.emptyValue,
    formatService.formatMinorInput(match.amountMinor)
  );
}

function UnknownCategories({ categoryNames, unknownCategoryMode }) {
  return (
    <div className="import-warning import-warning-attention">
      <strong>{messages.imports.unknownCategories}</strong>
      <div className="pill-row dense">
        {categoryNames.map((categoryName) => (
          <span key={categoryName} className="pill warning">{categoryName}</span>
        ))}
      </div>
      <p className="lede compact">
        {unknownCategoryMode === "other" ? messages.imports.categoryFallbackHelp : messages.imports.categoryFallbackBlocked}
      </p>
    </div>
  );
}

function PreviewGuardrailPills({
  preview,
  previewReconciliationRowCount,
  reconciledExistingRowCount,
  statementImportSourceType,
  skippedPreviewRowCount,
  needsReviewPreviewRowCount,
  visibleOverlapImports
}) {
  return (
    <div className="import-summary-strip" aria-label={messages.imports.previewGuardrailsLabel}>
      {preview.startDate && preview.endDate ? (
        <span className="import-summary-item">{messages.imports.previewCoverage(
          formatService.formatDateOnly(preview.startDate),
          formatService.formatDateOnly(preview.endDate)
        )}</span>
      ) : null}
      {previewReconciliationRowCount ? (
        <span className="import-summary-item is-warning">{messages.imports.reconciliationCandidates(previewReconciliationRowCount)}</span>
      ) : null}
      {reconciledExistingRowCount ? (
        <span className="import-summary-item is-success">
          {messages.imports.reconciledExistingRows(reconciledExistingRowCount, statementImportSourceType)}
        </span>
      ) : null}
      {skippedPreviewRowCount ? (
        <span className="import-summary-item">{messages.imports.willSkipRows(skippedPreviewRowCount)}</span>
      ) : null}
      {needsReviewPreviewRowCount ? (
        <span className="import-summary-item is-warning">{messages.imports.needsReviewRows(needsReviewPreviewRowCount)}</span>
      ) : null}
      {visibleOverlapImports.length ? (
        <span className="import-summary-item is-warning">{messages.imports.overlappingImports(visibleOverlapImports.length)}</span>
      ) : null}
    </div>
  );
}

function OverlapImports({
  imports,
  skippedPreviewRowCount,
  needsReviewPreviewRowCount,
  hasStatementReconciliationMismatch,
  hasStatementReconciliations,
  statementReconciliations,
  canJumpToSkippedRows = false,
  onJumpToSkippedRows,
  onDismissOverlap
}) {
  const overlapMismatchHint = getOverlapMismatchHint(imports, statementReconciliations);

  return (
    <div className="import-warning import-warning-overlap">
      <div className="import-warning-title-row">
        <strong>{messages.imports.previewOverlapTitle}</strong>
        <OverlapScopeInfo />
      </div>
      <p className="lede compact">{messages.imports.previewOverlapDetail}</p>
      <div className="import-overlap-guidance">
        <strong>{messages.imports.previewOverlapActionTitle}</strong>
        <ol>
          {messages.imports.previewOverlapActions({
            skippedPreviewRowCount,
            needsReviewPreviewRowCount,
            hasStatementReconciliationMismatch,
            hasStatementReconciliations
          }).map((action) => (
            <li key={action}>{action}</li>
          ))}
        </ol>
        {overlapMismatchHint ? (
          <p className="import-overlap-mismatch-hint">{overlapMismatchHint}</p>
        ) : null}
      </div>
      <div className="stack">
        {imports.map((item) => (
          <div key={item.id} className="import-card import-card-compact">
            <div className="import-history-main">
              <strong>{item.sourceLabel}</strong>
              <span className="import-history-inline">
                {messages.common.triplet(
                  item.importedAt ? formatService.formatDate(item.importedAt) : messages.common.emptyValue,
                  messages.imports.transactionCount(item.transactionCount),
                  item.sourceType ? item.sourceType.toUpperCase() : messages.common.emptyValue
                )}
              </span>
              {item.startDate && item.endDate ? (
                <span className="import-history-inline">{messages.imports.importCoverage(
                  formatService.formatDateOnly(item.startDate),
                  formatService.formatDateOnly(item.endDate)
                )}</span>
              ) : null}
              {item.accountNames.length ? <span className="import-history-inline">{item.accountNames.join(", ")}</span> : null}
              {item.overlapEntries?.length ? (
                <>
                  {canJumpToSkippedRows && onJumpToSkippedRows ? (
                    <button
                      type="button"
                      className="subtle-action import-overlap-entry-title-button"
                      onClick={onJumpToSkippedRows}
                    >
                      {messages.imports.previewOverlapEntriesLabel}
                    </button>
                  ) : (
                    <span className="import-history-inline import-overlap-entry-title">{messages.imports.previewOverlapEntriesLabel}</span>
                  )}
                  <div className="import-overlap-entry-list" aria-label={messages.imports.previewOverlapEntriesLabel}>
                    {item.overlapEntries.map((entry) => (
                      <div key={entry.id} className="import-overlap-entry-row">
                        <span className="import-overlap-entry-date">{formatService.formatDateOnly(entry.date)}</span>
                        <span className="import-overlap-entry-description">{entry.description}</span>
                        <span className="import-overlap-entry-account">{entry.accountName}</span>
                        <strong className="import-overlap-entry-amount">{formatOverlapEntryAmount(entry)}</strong>
                      </div>
                    ))}
                  </div>
                </>
              ) : null}
            </div>
            <div className="import-meta import-meta-compact">
              <button type="button" className="subtle-action" onClick={() => onDismissOverlap(item.id)}>
                {messages.imports.dismissOverlap}
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function getOverlapMismatchHint(imports, statementReconciliations) {
  const mismatch = statementReconciliations.find((item) => item.status === "mismatch" && item.deltaMinor);
  if (!mismatch) {
    return "";
  }

  const overlapLedgerDeltaMinor = imports
    .flatMap((item) => item.overlapEntries ?? [])
    .reduce((total, entry) => total + getOverlapEntrySignedMinor(entry), 0);

  if (Math.abs(overlapLedgerDeltaMinor) !== Math.abs(mismatch.deltaMinor)) {
    return "";
  }

  return messages.imports.previewOverlapMismatchExplained(formatService.money(Math.abs(mismatch.deltaMinor)));
}

function getOverlapEntrySignedMinor(entry) {
  return entry.entryType === "income" || (entry.entryType === "transfer" && entry.transferDirection === "in")
    ? Number(entry.amountMinor)
    : -Number(entry.amountMinor);
}

function OverlapScopeInfo() {
  const [open, setOpen] = useState(false);
  const closeTimeoutRef = useRef();

  function openPopover() {
    window.clearTimeout(closeTimeoutRef.current);
    setOpen(true);
  }

  function closePopoverSoon() {
    window.clearTimeout(closeTimeoutRef.current);
    closeTimeoutRef.current = window.setTimeout(() => setOpen(false), 120);
  }

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button
          type="button"
          className="info-icon-button"
          aria-label={messages.imports.previewOverlapScopeAriaLabel}
          onMouseEnter={openPopover}
          onMouseLeave={closePopoverSoon}
          onFocus={openPopover}
          onBlur={closePopoverSoon}
        >
          <Info size={15} aria-hidden="true" />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          className="import-overlap-scope-popover"
          sideOffset={8}
          align="start"
          onOpenAutoFocus={(event) => event.preventDefault()}
          onCloseAutoFocus={(event) => event.preventDefault()}
          onMouseEnter={openPopover}
          onMouseLeave={closePopoverSoon}
        >
          <div className="category-popover-head">
            <strong>{messages.imports.previewOverlapScopeTitle}</strong>
            <span>{messages.imports.previewOverlapScopeDetail}</span>
          </div>
          <ul>
            {messages.imports.previewOverlapScopeItems.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
          <Popover.Arrow className="category-popover-arrow" />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

function formatOverlapEntryAmount(entry) {
  if (entry.entryType === "transfer" && entry.transferDirection) {
    return `${entry.transferDirection === "in" ? "Transfer in" : "Transfer out"} ${formatService.money(Math.abs(entry.amountMinor))}`;
  }

  return formatService.money(entry.amountMinor);
}

function StatementBalanceCheck({
  reconciliations,
  hasMismatch,
  viewId,
  isSubmitting,
  onRefreshStatementReconciliation,
  onDeleteDiagnosticLedgerRow,
  onDeleteDiagnosticLedgerRows
}) {
  return (
    <div className={`import-warning ${hasMismatch ? "import-warning-attention" : "import-warning-reconciled"}`}>
      <div className="import-warning-head">
        <div>
          <strong>{messages.imports.statementReconciliationTitle}</strong>
          <p className="lede compact">
            {hasMismatch
              ? messages.imports.statementReconciliationMismatchDetail
              : messages.imports.statementReconciliationMatchedDetail}
          </p>
        </div>
        <button type="button" className="subtle-action" onClick={onRefreshStatementReconciliation} disabled={isSubmitting}>
          {messages.imports.statementReconciliationRefresh}
        </button>
      </div>
      <div className="stack">
        {reconciliations.map((item) => (
          <div key={`${item.accountName}-${item.checkpointMonth}`} className="import-card import-card-compact statement-reconciliation-row">
            <div className="import-history-main">
              <strong>{messages.imports.statementReconciliationAccount(
                item.accountName,
                formatService.formatMonthLabel(item.checkpointMonth)
              )}</strong>
              {item.statementStartDate && item.statementEndDate ? (
                <span className="import-history-inline">{messages.imports.importCoverage(
                  formatService.formatDateOnly(item.statementStartDate),
                  formatService.formatDateOnly(item.statementEndDate)
                )}</span>
              ) : null}
              <span className="import-history-inline">{formatService.formatStatementReconciliationLine(item)}</span>
            </div>
            <div className="import-meta import-meta-compact">
              <span className={`pill ${item.status === "matched" ? "success" : "warning"}`}>
                {messages.imports.statementReconciliationStatus[item.status]}
              </span>
              {item.deltaMinor != null && item.deltaMinor !== 0 ? (
                <p>{messages.imports.statementReconciliationDelta(formatService.money(Math.abs(item.deltaMinor)))}</p>
              ) : null}
            </div>
            {item.supersededLedgerRows?.length ? (
              <div className="import-overlap-entry-list" aria-label={messages.imports.statementReconciliationSupersededRowsTitle}>
                <strong>{messages.imports.statementReconciliationSupersededRowsTitle}</strong>
                {item.supersededLedgerRows.map((row) => (
                  <div key={row.transactionId} className="import-overlap-entry-row">
                    <span className="import-overlap-entry-date">{formatService.formatDateOnly(row.postedDate ?? row.date)}</span>
                    <span className="import-overlap-entry-description">{row.description}</span>
                    <span className="import-overlap-entry-account">{row.accountName}</span>
                    <strong className="import-overlap-entry-amount">{formatService.money(Math.abs(row.signedAmountMinor))}</strong>
                  </div>
                ))}
              </div>
            ) : null}
            {item.reconciliationBreakdown ? (
              <StatementReconciliationBreakdown
                reconciliation={item}
                breakdown={item.reconciliationBreakdown}
                accountKind={item.accountKind}
                viewId={viewId}
                onDeleteDiagnosticLedgerRow={onDeleteDiagnosticLedgerRow}
                onDeleteDiagnosticLedgerRows={onDeleteDiagnosticLedgerRows}
              />
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
}

function StatementReconciliationBreakdown({
  reconciliation,
  breakdown,
  accountKind,
  viewId,
  onDeleteDiagnosticLedgerRow,
  onDeleteDiagnosticLedgerRows
}) {
  const showExistingRows = breakdown.periodExistingLedgerRows?.length > 0;
  const showSkippedRows = breakdown.skippedStatementRows?.length > 0;
  const showMatchedRows = breakdown.matchedStatementRows?.length > 0;
  const resultDeltaMinor = Math.abs(breakdown.deltaMinor ?? 0);
  const statementStartLabel = reconciliation.statementStartDate
    ? formatService.formatDateOnly(reconciliation.statementStartDate)
    : "the statement start date";
  const statementEndLabel = reconciliation.statementEndDate
    ? formatService.formatDateOnly(reconciliation.statementEndDate)
    : "the statement end date";
  const existingRowsExplainMismatch = resultDeltaMinor > 0
    && Math.abs(breakdown.statementPeriodExistingRowsMinor ?? 0) === resultDeltaMinor;
  const skippedRowsExplainMismatch = resultDeltaMinor > 0
    && Math.abs(breakdown.skippedStatementRowsMinor ?? 0) === resultDeltaMinor;
  const isMatched = reconciliation.status === "matched" || resultDeltaMinor === 0;

  return (
    <div className="statement-reconciliation-breakdown">
      <strong>
        {isMatched
          ? messages.imports.statementReconciliationMatchedBreakdownTitle
          : messages.imports.statementReconciliationBreakdownTitle}
      </strong>
      <p className="lede compact">
        {isMatched
          ? messages.imports.statementReconciliationMatchedAuthority
          : messages.imports.statementReconciliationAuthority}
      </p>
      <div className={`statement-reconciliation-result ${isMatched ? "is-matched" : ""}`}>
        {isMatched
          ? messages.imports.statementReconciliationMatchedResult({
            projectedBalance: formatStatementBalanceForAccount(breakdown.projectedLedgerBalanceMinor, accountKind),
            statementBalance: formatStatementBalanceForAccount(breakdown.statementBalanceMinor, accountKind)
          })
          : messages.imports.statementReconciliationResult({
            projectedBalance: formatStatementBalanceForAccount(breakdown.projectedLedgerBalanceMinor, accountKind),
            statementBalance: formatStatementBalanceForAccount(breakdown.statementBalanceMinor, accountKind),
            delta: formatService.money(resultDeltaMinor)
          })}
      </div>
      <div className="statement-reconciliation-movement-grid">
        <StatementReconciliationMovement
          label={messages.imports.statementReconciliationMovementLabels.priorBalance}
          value={formatStatementBalanceForAccount(breakdown.priorLedgerBalanceMinor, accountKind)}
          detail="ledger balance before the statement start date"
          explanation={messages.imports.statementReconciliationMovementHelp.priorBalance({
            startDate: statementStartLabel,
            endDate: statementEndLabel,
            value: formatStatementBalanceForAccount(breakdown.priorLedgerBalanceMinor, accountKind)
          })}
        />
        <StatementReconciliationMovement
          label={messages.imports.statementReconciliationMovementLabels.existingRows}
          value={formatMovementForAccount(breakdown.statementPeriodExistingRowsMinor, accountKind)}
          detail="ledger-only rows already inside the PDF period"
          isProblem={Boolean(breakdown.statementPeriodExistingRowsMinor)}
          explanation={messages.imports.statementReconciliationMovementHelp.existingRows({
            startDate: statementStartLabel,
            endDate: statementEndLabel,
            value: formatMovementForAccount(breakdown.statementPeriodExistingRowsMinor, accountKind)
          })}
        />
        <StatementReconciliationMovement
          label={messages.imports.statementReconciliationMovementLabels.includedRows}
          value={formatMovementForAccount(breakdown.includedStatementRowsMinor, accountKind)}
          detail="net movement from rows in this PDF preview"
          explanation={messages.imports.statementReconciliationMovementHelp.includedRows({
            startDate: statementStartLabel,
            endDate: statementEndLabel,
            value: formatMovementForAccount(breakdown.includedStatementRowsMinor, accountKind)
          })}
        />
        <StatementReconciliationMovement
          label={messages.imports.statementReconciliationMovementLabels.supersededAdjustment}
          value={formatMovementForAccount(-breakdown.supersededLedgerRowsMinor, accountKind)}
          detail="provisional ledger rows removed because the PDF does not contain them"
          explanation={messages.imports.statementReconciliationMovementHelp.supersededAdjustment({
            startDate: statementStartLabel,
            endDate: statementEndLabel,
            value: formatMovementForAccount(-breakdown.supersededLedgerRowsMinor, accountKind)
          })}
        />
        <StatementReconciliationMovement
          label={messages.imports.statementReconciliationMovementLabels.projectedBalance}
          value={formatStatementBalanceForAccount(breakdown.projectedLedgerBalanceMinor, accountKind)}
          detail="what the ledger would show after this preview"
          explanation={messages.imports.statementReconciliationMovementHelp.projectedBalance({
            startDate: statementStartLabel,
            endDate: statementEndLabel,
            value: formatStatementBalanceForAccount(breakdown.projectedLedgerBalanceMinor, accountKind)
          })}
        />
      </div>
      {breakdown.suspectedCauses?.length ? (
        <div className="statement-reconciliation-causes">
          <strong>{messages.imports.statementReconciliationCausesTitle}</strong>
          <ul>
            {breakdown.suspectedCauses.map((cause) => <li key={cause}>{cause}</li>)}
          </ul>
        </div>
      ) : null}
      {showSkippedRows ? (
        <StatementReconciliationDiagnosticRows
          title={messages.imports.statementReconciliationSkippedRowsTitle}
          detail={messages.imports.statementReconciliationSkippedRowsDetail}
          summary={(summaryInput) => messages.imports.statementReconciliationSkippedRowsSummary(summaryInput)}
          actionDetail={skippedRowsExplainMismatch
            ? messages.imports.statementReconciliationSkippedRowsExactAction(formatService.money(resultDeltaMinor))
            : null}
          rows={breakdown.skippedStatementRows}
          totalRowCount={breakdown.skippedStatementRowCount}
          totalAmountMinor={breakdown.skippedStatementRowsMinor}
          viewId={viewId}
        />
      ) : null}
      {showExistingRows ? (
        <StatementReconciliationDiagnosticRows
          title={messages.imports.statementReconciliationExistingRowsTitle}
          detail={messages.imports.statementReconciliationExistingRowsDetail}
          summary={(summaryInput) => messages.imports.statementReconciliationExistingRowsSummary(summaryInput)}
          actionDetail={existingRowsExplainMismatch
            ? messages.imports.statementReconciliationExistingRowsExactAction(formatService.money(resultDeltaMinor))
            : null}
          rows={breakdown.periodExistingLedgerRows}
          totalRowCount={breakdown.periodExistingLedgerRowCount}
          totalAmountMinor={breakdown.statementPeriodExistingRowsMinor}
          viewId={viewId}
          accountId={reconciliation.accountId}
          onDeleteDiagnosticLedgerRow={onDeleteDiagnosticLedgerRow}
          onDeleteDiagnosticLedgerRows={onDeleteDiagnosticLedgerRows}
        />
      ) : null}
      {showMatchedRows ? (
        <StatementReconciliationDiagnosticRows
          title={messages.imports.statementReconciliationMatchedRowsTitle}
          detail={messages.imports.statementReconciliationMatchedRowsDetail}
          summary={(summaryInput) => messages.imports.statementReconciliationMatchedRowsSummary({
            ...summaryInput,
            isMatched
          })}
          collapsedSummary={(summaryInput) => messages.imports.statementReconciliationMatchedRowsCollapsedSummary(summaryInput)}
          collapsedByDefault={isMatched}
          rows={breakdown.matchedStatementRows}
          totalRowCount={breakdown.matchedStatementRowCount}
          totalAmountMinor={breakdown.matchedStatementRowsMinor}
          viewId={viewId}
        />
      ) : null}
    </div>
  );
}

function StatementReconciliationMovement({ label, value, detail, explanation, isProblem = false }) {
  return (
    <div className={`statement-reconciliation-movement ${isProblem ? "is-problem" : ""}`}>
      <span className="statement-reconciliation-movement-label">
        {label}
        {explanation ? <HoverExplanation content={explanation} label={`Explain ${label}`} /> : null}
      </span>
      <strong>{value}</strong>
      <small>{detail}</small>
    </div>
  );
}

function HoverExplanation({ content, label }) {
  const [open, setOpen] = useState(false);
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button
          type="button"
          className="statement-reconciliation-help-trigger"
          aria-label={label}
          onMouseEnter={() => setOpen(true)}
          onMouseLeave={() => setOpen(false)}
          onFocus={() => setOpen(true)}
          onBlur={() => setOpen(false)}
        >
          <Info size={14} aria-hidden="true" />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          className="statement-reconciliation-help-popover"
          sideOffset={8}
          align="start"
          onOpenAutoFocus={(event) => event.preventDefault()}
          onCloseAutoFocus={(event) => event.preventDefault()}
          onMouseEnter={() => setOpen(true)}
          onMouseLeave={() => setOpen(false)}
        >
          <p>{content}</p>
          <Popover.Arrow className="category-popover-arrow" />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

function StatementReconciliationDiagnosticRows({
  title,
  detail,
  summary,
  collapsedSummary,
  collapsedByDefault = false,
  actionDetail,
  rows,
  totalRowCount,
  totalAmountMinor,
  viewId,
  accountId,
  onDeleteDiagnosticLedgerRow,
  onDeleteDiagnosticLedgerRows
}) {
  const rowCount = totalRowCount ?? rows.length;
  const ledgerRows = rows.filter((row) => row.source === "ledger" && row.id);
  const formattedTotalAmount = formatSignedDiagnosticAmount(totalAmountMinor ?? sumDiagnosticRows(rows));
  const canBulkDeleteLedgerRows = ledgerRows.length > 1 && typeof onDeleteDiagnosticLedgerRows === "function";
  const summaryInput = {
    shown: rows.length,
    total: rowCount,
    amount: formattedTotalAmount
  };
  const summaryText = summary
    ? summary(summaryInput)
    : messages.imports.statementReconciliationExistingRowsSummary(summaryInput);
  const content = (
    <>
      {detail ? <p className="lede compact">{detail}</p> : null}
      <p className="lede compact">{summaryText}</p>
      {actionDetail ? <p className="lede compact statement-reconciliation-action">{actionDetail}</p> : null}
      {rows.map((row) => (
        <div key={row.id} className="import-overlap-entry-row statement-reconciliation-diagnostic-row">
          <span className="import-overlap-entry-date statement-reconciliation-date-cell">
            <span>{formatService.formatDateOnly(row.date)}</span>
            <small>{getDiagnosticRowDateDetail(row)}</small>
          </span>
          <span className="import-overlap-entry-description">{row.description}</span>
          <span className="import-overlap-entry-account">{row.status || row.accountName}</span>
          <strong className="import-overlap-entry-amount">{formatSignedDiagnosticAmount(row.signedAmountMinor)}</strong>
          {row.source === "ledger" ? (
            <span className="statement-reconciliation-row-actions">
              <a
                className="settings-text-link statement-reconciliation-entry-link"
                href={buildDiagnosticEntryHref({ row, viewId, accountId })}
                target="_blank"
                rel="noopener noreferrer"
              >
                {messages.imports.openDiagnosticEntry}
              </a>
              {onDeleteDiagnosticLedgerRow ? (
                <DeleteRowButton
                  label={row.description}
                  triggerLabel={messages.imports.deleteDiagnosticEntry}
                  confirmLabel={messages.imports.deleteDiagnosticEntry}
                  buttonClassName="statement-reconciliation-delete-button"
                  prompt={messages.imports.deleteDiagnosticEntryConfirm({
                    date: formatService.formatDateOnly(row.date),
                    description: row.description,
                    amount: formatSignedDiagnosticAmount(row.signedAmountMinor)
                  })}
                  onConfirm={() => onDeleteDiagnosticLedgerRow(row)}
                >
                  {messages.imports.deleteDiagnosticEntry}
                </DeleteRowButton>
              ) : null}
            </span>
          ) : null}
        </div>
      ))}
    </>
  );

  if (collapsedByDefault) {
    const collapsedText = collapsedSummary ? collapsedSummary(summaryInput) : summaryText;
    return (
      <details className="import-overlap-entry-list statement-reconciliation-diagnostic-details" aria-label={title}>
        <summary className="statement-reconciliation-list-summary">
          <span>
            <strong>{title}</strong>
            <small>{collapsedText}</small>
          </span>
        </summary>
        {content}
      </details>
    );
  }

  return (
    <div className="import-overlap-entry-list" aria-label={title}>
      <div className="statement-reconciliation-list-head">
        <strong>{title}</strong>
        {canBulkDeleteLedgerRows ? (
          <DeleteRowButton
            label={messages.imports.deleteDiagnosticEntriesLabel(ledgerRows.length)}
            triggerLabel={messages.imports.deleteDiagnosticEntriesLabel(ledgerRows.length)}
            confirmLabel={messages.imports.deleteDiagnosticEntries}
            buttonClassName="statement-reconciliation-delete-all-button"
            prompt={messages.imports.deleteDiagnosticEntriesConfirm({
              count: ledgerRows.length,
              amount: formattedTotalAmount
            })}
            onConfirm={() => onDeleteDiagnosticLedgerRows(ledgerRows)}
          >
            {messages.imports.deleteDiagnosticEntries}
          </DeleteRowButton>
        ) : null}
      </div>
      {content}
    </div>
  );
}

function getDiagnosticRowDateDetail(row) {
  if (row.source === "statement") {
    if (row.eventDate && row.eventDate !== row.date) {
      return messages.imports.statementReconciliationStatementDualDateDetail({
        postedDate: formatService.formatDateOnly(row.date),
        eventDate: formatService.formatDateOnly(row.eventDate)
      });
    }
    return messages.imports.statementReconciliationStatementDateDetail;
  }

  if (row.postedDate && row.postedDate !== row.date) {
    return messages.imports.statementReconciliationLedgerDualDateDetail({
      transactionDate: formatService.formatDateOnly(row.date),
      postedDate: formatService.formatDateOnly(row.postedDate)
    });
  }
  return messages.imports.statementReconciliationLedgerDateDetail;
}

function sumDiagnosticRows(rows = []) {
  return rows.reduce((total, row) => total + (row.signedAmountMinor ?? 0), 0);
}

function formatSignedDiagnosticAmount(valueMinor) {
  if (!valueMinor) {
    return formatService.money(0);
  }
  const prefix = valueMinor > 0 ? "+" : "-";
  return `${prefix}${formatService.money(Math.abs(valueMinor))}`;
}

function formatStatementBalanceForAccount(valueMinor, accountKind) {
  if (accountKind !== "credit_card") {
    return formatSignedDiagnosticAmount(valueMinor);
  }
  if (valueMinor < 0) {
    return `owed ${formatService.money(Math.abs(valueMinor))}`;
  }
  if (valueMinor > 0) {
    return `credit ${formatService.money(valueMinor)}`;
  }
  return formatService.money(0);
}

function formatMovementForAccount(valueMinor, accountKind) {
  if (!valueMinor) {
    return formatService.money(0);
  }

  if (accountKind === "credit_card") {
    return valueMinor < 0
      ? `adds ${formatService.money(Math.abs(valueMinor))} owed`
      : `reduces owed by ${formatService.money(valueMinor)}`;
  }

  return valueMinor < 0
    ? `reduces balance by ${formatService.money(Math.abs(valueMinor))}`
    : `adds ${formatService.money(valueMinor)}`;
}

function buildDiagnosticEntryHref({ row, viewId, accountId }) {
  const params = new URLSearchParams({
    view: viewId || "household",
    month: row.date.slice(0, 7)
  });
  if (row.id) {
    params.append("entry_id", row.id);
  }
  const wallet = row.accountId ?? accountId;
  if (wallet) {
    params.set("entry_wallet", wallet);
  }
  return `/entries?${params.toString()}`;
}

function StatementCheckpointDrafts({
  accounts,
  knownAccountNames,
  statementCheckpoints,
  hasDuplicateCheckpointAccounts,
  duplicateCheckpointAccounts,
  onUpdateStatementCheckpoint
}) {
  const accountOptions = accountService.getSelectOptions(accounts, { valueKey: "id" });

  return (
    <div className="import-warning import-warning-review">
      <strong>{messages.imports.statementCheckpointsTitle(statementCheckpoints.length)}</strong>
      <p className="lede compact">{messages.imports.statementCheckpointsDetail(statementCheckpoints.length)}</p>
      {hasDuplicateCheckpointAccounts ? (
        <p className="form-error">{messages.imports.duplicateCheckpointAccounts(duplicateCheckpointAccounts.join(", "))}</p>
      ) : null}
      <div className="statement-checkpoint-grid">
        {statementCheckpoints.map((checkpoint, index) => (
          <div key={`${checkpoint.accountName}-${index}`} className="statement-checkpoint-row">
            <label className="entries-filter">
              <span className="entries-filter-label">{messages.imports.statementCheckpointAccount}</span>
              <select
                className="table-edit-input"
                value={checkpoint.accountId ?? accounts.find((account) => account.name === checkpoint.accountName)?.id ?? checkpoint.accountName}
                onChange={(event) => {
                  const nextAccount = accounts.find((account) => account.id === event.target.value);
                  onUpdateStatementCheckpoint(index, {
                    accountId: nextAccount?.id,
                    accountName: nextAccount?.name ?? event.target.value
                  });
                }}
              >
                {checkpoint.accountName && !knownAccountNames.has(checkpoint.accountName) ? (
                  <option value={checkpoint.accountName}>{checkpoint.accountName}</option>
                ) : null}
                {accountOptions.map((account) => (
                  <option key={account.id} value={account.value}>{account.label}</option>
                ))}
              </select>
            </label>
            <label className="entries-filter">
              <span className="entries-filter-label">{messages.imports.statementCheckpointMonth}</span>
              <input className="table-edit-input" type="month" value={checkpoint.checkpointMonth} onChange={(event) => onUpdateStatementCheckpoint(index, { checkpointMonth: event.target.value })} />
            </label>
            <label className="entries-filter">
              <span className="entries-filter-label">{messages.imports.statementCheckpointStart}</span>
              <input className="table-edit-input" type="date" value={checkpoint.statementStartDate ?? ""} onChange={(event) => onUpdateStatementCheckpoint(index, { statementStartDate: event.target.value })} />
            </label>
            <label className="entries-filter">
              <span className="entries-filter-label">{messages.imports.statementCheckpointEnd}</span>
              <input className="table-edit-input" type="date" value={checkpoint.statementEndDate ?? ""} onChange={(event) => onUpdateStatementCheckpoint(index, { statementEndDate: event.target.value })} />
            </label>
            <label className="entries-filter">
              <span className="entries-filter-label">{messages.imports.statementCheckpointBalance}</span>
              <input
                className="table-edit-input"
                value={formatService.formatMinorInput(checkpoint.statementBalanceMinor)}
                onChange={(event) => onUpdateStatementCheckpoint(index, {
                  statementBalanceMinor: formatService.parseMoneyInput(event.target.value, checkpoint.statementBalanceMinor)
                })}
              />
            </label>
            <label className="entries-filter">
              <span className="entries-filter-label">{messages.imports.statementCheckpointNote}</span>
              <input className="table-edit-input" value={checkpoint.note ?? ""} onChange={(event) => onUpdateStatementCheckpoint(index, { note: event.target.value })} />
            </label>
          </div>
        ))}
      </div>
    </div>
  );
}
