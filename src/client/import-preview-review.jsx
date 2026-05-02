import * as Popover from "@radix-ui/react-popover";
import { useRef, useState } from "react";
import { Info } from "lucide-react";
import { DuplicateMatchPopover } from "./import-preview-rows-table";
import { messages } from "./copy/en-SG";
import { moniesClient } from "./monies-client-service";

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
  hasDuplicateCheckpointAccounts,
  duplicateCheckpointAccounts,
  isSubmitting,
  canJumpToSkippedRows = false,
  onRemapPreviewAccount,
  onCreateStatementAccount,
  onDismissOverlap,
  onJumpToSkippedRows,
  onRefreshStatementReconciliation,
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
          isSubmitting={isSubmitting}
          onRefreshStatementReconciliation={onRefreshStatementReconciliation}
        />
      ) : null}

      {/* Certified conflicts are the rows we should least casually overwrite. */}
      {certifiedConflictRows.length ? (
        <CertifiedConflictRows rows={certifiedConflictRows} />
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

function CertifiedConflictRows({ rows }) {
  return (
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
              </div>
            </div>
          );
        })}
      </div>
    </div>
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

function StatementBalanceCheck({ reconciliations, hasMismatch, isSubmitting, onRefreshStatementReconciliation }) {
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
          </div>
        ))}
      </div>
    </div>
  );
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
