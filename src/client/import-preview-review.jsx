import * as Popover from "@radix-ui/react-popover";
import { useRef, useState } from "react";
import { CalendarDays, Info } from "lucide-react";
import { DuplicateMatchPopover } from "./import-preview-row-helpers";
import { RestorePreviewRowDialog } from "./import-restore-row-dialog";
import { DateRow } from "./detail-field-rows";
import { SheetDialog } from "./sheet-dialog";
import { DetailRow, DetailRows, LeadCard } from "./ui-components";
import { AddRow } from "./settings-add-row";
import { DeleteRowButton } from "./delete-row-button";
import { useIsMobileLayout } from "./use-viewport";
import { messages } from "./copy/en-SG";
import { importMessages } from "./copy/en-SG-imports";
import { entryTypeLabel } from "./enum-labels";
import { moniesClient } from "./monies-client-service";
import { StatementFixSuggestions } from "./statement-fix-suggestions";
import { addDaysToIsoDate } from "./app-dates";
import { InlineError } from "./ui-states";
import { moneyToneClass } from "./money-tone-class";
import { useMoneyPrivacy } from "./money-privacy";
import { entryAmountTone } from "../domain/money-tone";
import { isInferredAmountRow, useInferredAmountKeys } from "./import-inferred-amounts";
import { getMissingStatementMonths, isLedgerMatchedPreviewRow } from "./import-preview-model";
import { getPersonColourVars } from "./person-colour";
import { StatementBankCharges } from "./statement-bank-charges";
import { describePaymentDue, summarizeStatementCharges } from "./statement-charges-model";
import "./import-review.css";

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
  onSetDiagnosticLedgerPostDate,
  onUpdateStatementCheckpoint,
  dismissedStatementFindingIds = [],
  onApplyStatementFixes,
  onUndoStatementFixes,
  onDismissStatementFindings,
  needsStatementAccountMapping = false,
  statementImportMeta,
  isEditingRows = false,
  onToggleEditRows,
  moreChecks = null,
  isAutomaticStatementFixes = false,
  autoAppliedStatementFixCount = 0,
  onAutomaticStatementFixesChange,
  keepsNoLongerListedEntries = false,
  onKeepsNoLongerListedEntriesChange,
  onLinkUnlistedEstimate
}) {
  if (!preview) {
    return null;
  }

  // An official statement is reviewed card by card: the statement header,
  // one section per card with its outcome and fixes, and the rest behind
  // disclosures. Activity files and pasted CSV keep the row-first review.
  if (statementImportSourceType === "pdf" && statementReconciliations.length) {
    return (
      <StatementReview
        preview={preview}
        previewRows={previewRows}
        accounts={accounts}
        statementReconciliations={statementReconciliations}
        parserKey={statementImportMeta?.parserKey}
        viewId={viewId}
        isSubmitting={isSubmitting}
        needsStatementAccountMapping={needsStatementAccountMapping}
        isEditingRows={isEditingRows}
        onToggleEditRows={onToggleEditRows}
        isAutomaticStatementFixes={isAutomaticStatementFixes}
        autoAppliedStatementFixCount={autoAppliedStatementFixCount}
        onAutomaticStatementFixesChange={onAutomaticStatementFixesChange}
        dismissedFindingIds={dismissedStatementFindingIds}
        onApplyStatementFixes={onApplyStatementFixes}
        onUndoStatementFixes={onUndoStatementFixes}
        onDismissStatementFindings={onDismissStatementFindings}
        onDeleteDiagnosticLedgerRow={onDeleteDiagnosticLedgerRow}
        onDeleteDiagnosticLedgerRows={onDeleteDiagnosticLedgerRows}
        onSetDiagnosticLedgerPostDate={onSetDiagnosticLedgerPostDate}
        onRefreshStatementReconciliation={onRefreshStatementReconciliation}
        accountMapping={showStatementAccountMapping ? (
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
        unknownCategories={preview.unknownCategories?.length ? (
          <UnknownCategories categoryNames={preview.unknownCategories} unknownCategoryMode={unknownCategoryMode} />
        ) : null}
        certifiedConflicts={certifiedConflictRows.length ? (
          <CertifiedConflictRows rows={certifiedConflictRows} onUpdatePreviewRowCommitStatus={onUpdatePreviewRowCommitStatus} />
        ) : null}
        statementDetails={(
          <StatementCheckpointDrafts
            accounts={accounts}
            knownAccountNames={knownAccountNames}
            statementCheckpoints={statementCheckpoints}
            hasDuplicateCheckpointAccounts={hasDuplicateCheckpointAccounts}
            duplicateCheckpointAccounts={duplicateCheckpointAccounts}
            onUpdateStatementCheckpoint={onUpdateStatementCheckpoint}
          />
        )}
        hasDuplicateCheckpointAccounts={hasDuplicateCheckpointAccounts}
        moreChecks={(
          <>
            <PreviewGuardrailPills
              preview={preview}
              previewReconciliationRowCount={previewReconciliationRowCount}
              skippedPreviewRowCount={skippedPreviewRowCount}
              needsReviewPreviewRowCount={needsReviewPreviewRowCount}
              visibleOverlapImports={visibleOverlapImports}
              reconciledExistingRowCount={reconciledExistingRowCount}
              statementImportSourceType={statementImportSourceType}
            />
            {preview.exceptionSummary?.length ? <ExceptionRegister exceptions={preview.exceptionSummary} /> : null}
            {visibleOverlapImports.length ? (
              <OverlapImports
                imports={visibleOverlapImports}
                skippedPreviewRowCount={skippedPreviewRowCount}
                needsReviewPreviewRowCount={needsReviewPreviewRowCount}
                hasStatementReconciliationMismatch={hasStatementReconciliationMismatch}
                hasStatementReconciliations
                statementReconciliations={statementReconciliations}
                canJumpToSkippedRows={canJumpToSkippedRows}
                onDismissOverlap={onDismissOverlap}
                onJumpToSkippedRows={onJumpToSkippedRows}
              />
            ) : null}
            {moreChecks}
          </>
        )}
      />
    );
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

      {/* An investment statement: what it says the account was worth, and which bank payments its contributions pair with. */}
      {preview.investmentValues?.length ? (
        <InvestmentStatementValues values={preview.investmentValues} previewRows={previewRows} />
      ) : null}

      {/* Unknown categories are informational unless policy says they block commit. */}
      {preview.unknownCategories?.length ? (
        <UnknownCategories
          categoryNames={preview.unknownCategories}
          unknownCategoryMode={unknownCategoryMode}
        />
      ) : null}

      {/* These pills give a fast count of what the larger preview table will contain.
          The file card above them already gives the dates it covers. */}
      <PreviewGuardrailPills
        showCoverage={false}
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

      {/* Entries an earlier export created that this one no longer lists. */}
      {preview.noLongerListedEntries?.length ? (
        <NoLongerListedEntries
          entries={preview.noLongerListedEntries}
          isKept={keepsNoLongerListedEntries}
          isSubmitting={isSubmitting}
          onKeptChange={onKeepsNoLongerListedEntriesChange}
        />
      ) : null}

      {/* Estimates whose bank row this file no longer lists: link the final charge or put them back. */}
      {(preview.unlistedEstimates ?? []).map((estimate) => (
        <UnlistedEstimate
          key={estimate.transactionId}
          estimate={estimate}
          linkedRowId={previewRows.find((row) => row.reconciliationTargetTransactionId === estimate.transactionId)?.rowId ?? null}
          isSubmitting={isSubmitting}
          onLink={(rowId) => onLinkUnlistedEstimate?.(estimate, rowId)}
        />
      ))}

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
          diagnosis={preview.statementDiagnosis}
          accounts={accounts}
          dismissedFindingIds={dismissedStatementFindingIds}
          onApplyStatementFixes={onApplyStatementFixes}
          onUndoStatementFixes={onUndoStatementFixes}
          onDismissStatementFindings={onDismissStatementFindings}
          hasMismatch={hasStatementReconciliationMismatch}
          viewId={viewId}
          isSubmitting={isSubmitting}
          onRefreshStatementReconciliation={onRefreshStatementReconciliation}
          onDeleteDiagnosticLedgerRow={onDeleteDiagnosticLedgerRow}
          onDeleteDiagnosticLedgerRows={onDeleteDiagnosticLedgerRows}
          onSetDiagnosticLedgerPostDate={onSetDiagnosticLedgerPostDate}
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
          <strong>{importMessages.reconciliationMatchesTitle}</strong>
          <p className="lede compact">{importMessages.reconciliationMatchesDetail}</p>
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
        <strong>{importMessages.certifiedConflictTitle(rows.length)}</strong>
        <p className="lede compact">{importMessages.certifiedConflictDetail}</p>
        <div className="stack">
          {rows.map((row) => {
            const match = row.reconciliationMatch;
            return (
              <div key={row.rowId} className="import-card import-card-compact">
                <div className="import-history-main">
                  <strong>{importMessages.certifiedConflictRow(
                    formatService.formatDateOnly(row.date),
                    row.description,
                    formatService.formatMinorInput(row.amountMinor)
                  )}</strong>
                  <span className="import-history-inline">
                    {messages.common.triplet(
                      row.accountName ?? messages.common.emptyValue,
                      entryTypeLabel(row.entryType),
                      formatService.formatMinorInput(row.amountMinor)
                    )}
                  </span>
                  <p className="lede compact">{row.commitStatusReason}</p>
                  {match ? (
                    <div className="duplicate-row-detail-line">
                      <small className="duplicate-row-detail">
                        {importMessages.duplicateRowDetail(formatDuplicateMatch(match))}
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
                      {importMessages.restorePreviewRow}
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <RestorePreviewRowDialog
        row={restoreTarget}
        onClose={() => setRestoreTarget(null)}
        onRestore={(row) => onUpdatePreviewRowCommitStatus(row.rowId, "included")}
      />
    </>
  );
}

// The bank's export lists every charge over its dates, so an earlier
// export's entry it no longer lists was dropped by the bank (a released
// pending hold). One choice for all of them: removed by default, kept on
// request; rolling the import back brings removed ones back.
function NoLongerListedEntries({ entries, isKept, isSubmitting, onKeptChange }) {
  const accountNames = Array.from(new Set(entries.map((entry) => entry.accountName)));
  return (
    <div className="import-warning">
      <strong>{importMessages.noLongerListedTitle(entries.length, accountNames.join(", "))}</strong>
      <p className="lede compact">{isKept ? importMessages.noLongerListedKeptDetail(entries.length) : importMessages.noLongerListedDetail(entries.length)}</p>
      <div className="import-overlap-entry-list" aria-label={importMessages.noLongerListedListLabel}>
        {entries.map((entry) => (
          <div key={entry.transactionId} className="import-overlap-entry-row">
            <span className="import-overlap-entry-date">{formatService.formatDateOnly(entry.date)}</span>
            <span className="import-overlap-entry-description">{entry.description}</span>
            <span className="import-overlap-entry-account">{entry.accountName}</span>
            <strong className="import-overlap-entry-amount">{formatService.money(entry.amountMinor)}</strong>
          </div>
        ))}
      </div>
      <label className="import-keep-entries">
        <input
          type="checkbox"
          checked={isKept}
          disabled={isSubmitting}
          onChange={(event) => onKeptChange?.(event.target.checked)}
        />
        <span>{importMessages.noLongerListedKeep(entries.length)}</span>
      </label>
    </div>
  );
}

// A foreign currency estimate an earlier export matched to a row this file
// no longer lists (usually a hold). Its final charge prints another foreign
// amount, so it never pairs by itself: the user picks it, or the estimate
// goes back to its own saved amount (the default).
function UnlistedEstimate({ estimate, linkedRowId, isSubmitting, onLink }) {
  const restoredAmount = formatService.money(estimate.restoredAmountMinor);
  const name = `unlisted-estimate-${estimate.transactionId}`;
  return (
    <div className="import-warning">
      <strong>{importMessages.unlistedEstimateTitle(estimate.originalAmount, estimate.walletDescription, estimate.accountName)}</strong>
      <p className="lede compact">{importMessages.unlistedEstimateDetail(restoredAmount, estimate.candidates.length > 0)}</p>
      {estimate.candidates.length ? (
        <div className="import-estimate-choices" role="radiogroup" aria-label={importMessages.unlistedEstimateTitle(estimate.originalAmount, estimate.walletDescription, estimate.accountName)}>
          {estimate.candidates.map((candidate) => (
            <label key={candidate.rowId} className="import-keep-entries">
              <input type="radio" name={name} checked={linkedRowId === candidate.rowId} disabled={isSubmitting} onChange={() => onLink(candidate.rowId)} />
              <span>{importMessages.unlistedEstimateSamePurchase(formatService.formatDateOnly(candidate.date), candidate.description, formatService.money(candidate.amountMinor))}</span>
            </label>
          ))}
          <label className="import-keep-entries">
            <input type="radio" name={name} checked={!linkedRowId} disabled={isSubmitting} onChange={() => onLink(null)} />
            <span>{importMessages.unlistedEstimateNotInFile(restoredAmount)}</span>
          </label>
        </div>
      ) : null}
    </div>
  );
}

function ExceptionRegister({ exceptions }) {
  return (
    <div className="import-warning import-warning-review">
      <strong>{importMessages.exceptionRegisterTitle}</strong>
      <p className="lede compact">{importMessages.exceptionRegisterDetail}</p>
      <div className="pill-row dense">
        {exceptions.map((item) => (
          <span
            key={item.kind}
            className={`pill ${item.tone === "blocking" ? "warning" : item.tone === "review" ? "neutral" : ""}`}
          >
            {importMessages.exceptionKinds[item.kind](item.count)}
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

  // Lead · Support · Detail: one Account row per detected account that opens
  // its own picker (a native select laid over the row), and "Create account"
  // as the row that ends the group. The title and its one-line reason stay,
  // quietly, so the person knows why the row asks for a choice.
  return (
    <div className="import-account-map" data-import-target="account-mapping">
      <div className="import-account-map-copy">
        <strong className={unknownPreviewAccountNames.length ? "is-action" : undefined}>
          {unknownPreviewAccountNames.length ? importMessages.unknownAccounts : importMessages.accountMappingTitle}
        </strong>
        <p>{importMessages.accountMappingDetail}</p>
      </div>
      <div className="statement-account-map-grid">
        {accountMappingAccountNames.map((accountName) => {
          const selectedValue = selectedAccountValue(accountName);
          const selectedOption = accountOptions.find((account) => account.value === selectedValue);
          return (
            <DetailRows key={accountName} className="statement-account-map-row">
              <DetailRow
                label={importMessages.detectedAccount(accountName)}
                value={selectedOption?.label}
                emptyLabel={importMessages.chooseAccount}
                state={selectedOption ? undefined : "action"}
              >
                <select
                  className="lsd-row-native"
                  aria-label={importMessages.detectedAccount(accountName)}
                  value={selectedValue}
                  onChange={(event) => onRemapPreviewAccount(accountName, event.target.value)}
                >
                  <option value="">{importMessages.chooseAccount}</option>
                  {accountOptions.map((account) => (
                    <option key={account.id} value={account.value}>{account.label}</option>
                  ))}
                </select>
              </DetailRow>
              <AddRow onClick={() => onCreateStatementAccount(accountName)}>{importMessages.createDetectedAccount}</AddRow>
            </DetailRows>
          );
        })}
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
    <div className="import-warning import-warning-attention" data-import-target="unknown-categories">
      <strong>{importMessages.unknownCategories}</strong>
      <div className="pill-row dense">
        {categoryNames.map((categoryName) => (
          <span key={categoryName} className="pill warning">{categoryName}</span>
        ))}
      </div>
      <p className="lede compact">
        {unknownCategoryMode === "other" ? importMessages.categoryFallbackHelp : importMessages.categoryFallbackBlocked}
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
  visibleOverlapImports,
  showCoverage = true
}) {
  const coverageShown = showCoverage && Boolean(preview.startDate && preview.endDate);
  // Nothing to say (the file card already gives the dates): no empty strip.
  if (!coverageShown && !previewReconciliationRowCount && !reconciledExistingRowCount && !skippedPreviewRowCount && !needsReviewPreviewRowCount && !visibleOverlapImports.length) {
    return null;
  }
  return (
    <div className="import-summary-strip" aria-label={importMessages.previewGuardrailsLabel}>
      {coverageShown ? (
        <span className="import-summary-item">{importMessages.previewCoverage(
          formatService.formatDateOnly(preview.startDate),
          formatService.formatDateOnly(preview.endDate)
        )}</span>
      ) : null}
      {previewReconciliationRowCount ? (
        <span className="import-summary-item is-warning">{importMessages.reconciliationCandidates(previewReconciliationRowCount)}</span>
      ) : null}
      {reconciledExistingRowCount ? (
        <span className="import-summary-item is-success">
          {importMessages.reconciledExistingRows(reconciledExistingRowCount, statementImportSourceType)}
        </span>
      ) : null}
      {skippedPreviewRowCount ? (
        <span className="import-summary-item">{importMessages.willSkipRows(skippedPreviewRowCount)}</span>
      ) : null}
      {needsReviewPreviewRowCount ? (
        <span className="import-summary-item is-warning">{importMessages.needsReviewRows(needsReviewPreviewRowCount)}</span>
      ) : null}
      {visibleOverlapImports.length ? (
        <span className="import-summary-item is-warning">{importMessages.overlappingImports(visibleOverlapImports.length)}</span>
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
        <strong>{importMessages.previewOverlapTitle}</strong>
        <OverlapScopeInfo />
      </div>
      <p className="lede compact">{importMessages.previewOverlapDetail}</p>
      <div className="import-overlap-guidance">
        <strong>{importMessages.previewOverlapActionTitle}</strong>
        <ol>
          {importMessages.previewOverlapActions({
            skippedPreviewRowCount,
            needsReviewPreviewRowCount,
            hasStatementReconciliationMismatch,
            hasStatementReconciliations
          }).map((action) => (
            <li key={action}>{action}</li>
          ))}
        </ol>
        {overlapMismatchHint ? (
          <p className="import-overlap-mismatch-hint money-short money-emphasis">{overlapMismatchHint}</p>
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
                  importMessages.transactionCount(item.transactionCount),
                  item.sourceType ? item.sourceType.toUpperCase() : messages.common.emptyValue
                )}
              </span>
              {item.startDate && item.endDate ? (
                <span className="import-history-inline">{importMessages.importCoverage(
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
                      {importMessages.previewOverlapEntriesLabel}
                    </button>
                  ) : (
                    <span className="import-history-inline import-overlap-entry-title">{importMessages.previewOverlapEntriesLabel}</span>
                  )}
                  <div className="import-overlap-entry-list" aria-label={importMessages.previewOverlapEntriesLabel}>
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
                {importMessages.dismissOverlap}
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

  return importMessages.previewOverlapMismatchExplained(formatService.money(Math.abs(mismatch.deltaMinor)));
}

function getOverlapEntrySignedMinor(entry) {
  return entry.entryType === "income" || (entry.entryType === "transfer" && entry.transferDirection === "in")
    ? Number(entry.amountMinor)
    : -Number(entry.amountMinor);
}

function OverlapScopeInfo() {
  const [open, setOpen] = useState(false);
  const closeTimeoutRef = useRef(undefined);

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
          aria-label={importMessages.previewOverlapScopeAriaLabel}
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
            <strong>{importMessages.previewOverlapScopeTitle}</strong>
            <span>{importMessages.previewOverlapScopeDetail}</span>
          </div>
          <ul>
            {importMessages.previewOverlapScopeItems.map((item) => (
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
  diagnosis,
  accounts,
  dismissedFindingIds,
  onApplyStatementFixes,
  onUndoStatementFixes,
  onDismissStatementFindings,
  hasMismatch,
  viewId,
  isSubmitting,
  onRefreshStatementReconciliation,
  onDeleteDiagnosticLedgerRow,
  onDeleteDiagnosticLedgerRows,
  onSetDiagnosticLedgerPostDate
}) {
  return (
    <div className={`import-warning ${hasMismatch ? "import-warning-attention" : "import-warning-reconciled"}`}>
      <div className="import-warning-head">
        <div>
          <strong>{importMessages.statementReconciliationTitle}</strong>
          <p className="lede compact">
            {hasMismatch
              ? importMessages.statementReconciliationMismatchDetail
              : importMessages.statementReconciliationMatchedDetail}
          </p>
        </div>
        <button type="button" className="subtle-action" onClick={onRefreshStatementReconciliation} disabled={isSubmitting}>
          {importMessages.statementReconciliationRefresh}
        </button>
      </div>
      {diagnosis?.rejectedFixes?.map((item) => (
        <p key={`${item.fix.kind}-${item.fix.entryId}`} className="lede compact statement-fix-rejected">
          {importMessages.statementFixRejected(item.reason)}
        </p>
      ))}
      <div className="stack">
        {reconciliations.map((item) => (
          <div key={`${item.accountName}-${item.checkpointMonth}`} className="import-card statement-reconciliation-row">
            <div className="statement-reconciliation-card-head">
              <div className="statement-reconciliation-card-title">
                <strong>{importMessages.statementReconciliationAccount(
                  item.accountName,
                  formatService.formatMonthLabel(item.checkpointMonth)
                )}</strong>
                {item.statementStartDate && item.statementEndDate ? (
                  <span className="import-history-inline">{importMessages.importCoverage(
                    formatService.formatDateOnly(item.statementStartDate),
                    formatService.formatDateOnly(item.statementEndDate)
                  )}</span>
                ) : null}
                <span className="import-history-inline">{formatService.formatStatementReconciliationLine(item)}</span>
              </div>
              <div className="statement-reconciliation-card-meta">
                <span className={`pill ${item.status === "matched" ? "success" : "warning"}`}>
                  {importMessages.statementReconciliationStatus[item.status]}
                </span>
                {item.deltaMinor != null && item.deltaMinor !== 0 ? (
                  <p>{importMessages.statementReconciliationDelta(formatService.money(Math.abs(item.deltaMinor)))}</p>
                ) : null}
              </div>
            </div>
            {item.accountId ? (
              <StatementFixSuggestions
                accountId={item.accountId}
                statementEndDate={item.statementEndDate}
                diagnosis={diagnosis}
                accounts={accounts}
                dismissedFindingIds={dismissedFindingIds}
                isSubmitting={isSubmitting}
                onApplyStatementFixes={onApplyStatementFixes}
                onUndoStatementFixes={onUndoStatementFixes}
                onDismissStatementFindings={onDismissStatementFindings}
              />
            ) : null}
            {item.supersededLedgerRows?.length ? (
              <div className="import-overlap-entry-list" aria-label={importMessages.statementReconciliationSupersededRowsTitle}>
                <strong>{importMessages.statementReconciliationSupersededRowsTitle}</strong>
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
                onSetDiagnosticLedgerPostDate={onSetDiagnosticLedgerPostDate}
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
  onDeleteDiagnosticLedgerRows,
  onSetDiagnosticLedgerPostDate
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
          ? importMessages.statementReconciliationMatchedBreakdownTitle
          : importMessages.statementReconciliationBreakdownTitle}
      </strong>
      <p className="lede compact">
        {isMatched
          ? importMessages.statementReconciliationMatchedAuthority
          : importMessages.statementReconciliationAuthority}
      </p>
      {!isMatched ? (
        <div className="statement-reconciliation-quick-fix">
          <strong>{importMessages.statementReconciliationQuickFixTitle}</strong>
          <p className="lede compact">
            {existingRowsExplainMismatch
              ? importMessages.statementReconciliationQuickFixIntroExact(formatService.money(resultDeltaMinor))
              : importMessages.statementReconciliationQuickFixIntroGeneric}
          </p>
          <ol>
            <li>{existingRowsExplainMismatch
              ? importMessages.statementReconciliationQuickFixStep1Exact
              : importMessages.statementReconciliationQuickFixStep1Generic}</li>
            <li>{importMessages.statementReconciliationQuickFixStep2}</li>
            <li>{importMessages.statementReconciliationQuickFixStep3}</li>
          </ol>
        </div>
      ) : null}
      <div className={`statement-reconciliation-result ${moneyToneClass(isMatched ? "in" : "short", "emphasis")}`}>
        {isMatched
          ? importMessages.statementReconciliationMatchedResult({
            projectedBalance: formatStatementBalanceForAccount(breakdown.projectedLedgerBalanceMinor, accountKind),
            statementBalance: formatStatementBalanceForAccount(breakdown.statementBalanceMinor, accountKind)
          })
          : importMessages.statementReconciliationResult({
            projectedBalance: formatStatementBalanceForAccount(breakdown.projectedLedgerBalanceMinor, accountKind),
            statementBalance: formatStatementBalanceForAccount(breakdown.statementBalanceMinor, accountKind),
            delta: formatService.money(resultDeltaMinor)
          })}
      </div>
      <div className="statement-reconciliation-movement-grid">
        <StatementReconciliationMovement
          label={importMessages.statementReconciliationMovementLabels.priorBalance}
          value={formatStatementBalanceForAccount(breakdown.priorLedgerBalanceMinor, accountKind)}
          detail="ledger balance before the statement start date"
          explanation={importMessages.statementReconciliationMovementHelp.priorBalance({
            startDate: statementStartLabel,
            endDate: statementEndLabel,
            value: formatStatementBalanceForAccount(breakdown.priorLedgerBalanceMinor, accountKind)
          })}
        />
        <StatementReconciliationMovement
          label={importMessages.statementReconciliationMovementLabels.existingRows}
          value={formatMovementForAccount(breakdown.statementPeriodExistingRowsMinor, accountKind)}
          detail="ledger-only rows already inside the PDF period"
          isProblem={Boolean(breakdown.statementPeriodExistingRowsMinor)}
          explanation={importMessages.statementReconciliationMovementHelp.existingRows({
            startDate: statementStartLabel,
            endDate: statementEndLabel,
            value: formatMovementForAccount(breakdown.statementPeriodExistingRowsMinor, accountKind)
          })}
        />
        <StatementReconciliationMovement
          label={importMessages.statementReconciliationMovementLabels.includedRows}
          value={formatMovementForAccount(breakdown.includedStatementRowsMinor, accountKind)}
          detail="net movement from rows in this PDF preview"
          explanation={importMessages.statementReconciliationMovementHelp.includedRows({
            startDate: statementStartLabel,
            endDate: statementEndLabel,
            value: formatMovementForAccount(breakdown.includedStatementRowsMinor, accountKind)
          })}
        />
        <StatementReconciliationMovement
          label={importMessages.statementReconciliationMovementLabels.supersededAdjustment}
          value={formatMovementForAccount(-breakdown.supersededLedgerRowsMinor, accountKind)}
          detail="provisional ledger rows removed because the PDF does not contain them"
          explanation={importMessages.statementReconciliationMovementHelp.supersededAdjustment({
            startDate: statementStartLabel,
            endDate: statementEndLabel,
            value: formatMovementForAccount(-breakdown.supersededLedgerRowsMinor, accountKind)
          })}
        />
        <StatementReconciliationMovement
          label={importMessages.statementReconciliationMovementLabels.projectedBalance}
          value={formatStatementBalanceForAccount(breakdown.projectedLedgerBalanceMinor, accountKind)}
          detail="what the ledger would show after this preview"
          explanation={importMessages.statementReconciliationMovementHelp.projectedBalance({
            startDate: statementStartLabel,
            endDate: statementEndLabel,
            value: formatStatementBalanceForAccount(breakdown.projectedLedgerBalanceMinor, accountKind)
          })}
        />
      </div>
      {breakdown.suspectedCauses?.length ? (
        <div className="statement-reconciliation-causes">
          <strong>{importMessages.statementReconciliationCausesTitle}</strong>
          <ul>
            {breakdown.suspectedCauses.map((cause) => <li key={cause}>{cause}</li>)}
          </ul>
        </div>
      ) : null}
      {showSkippedRows ? (
        <StatementReconciliationDiagnosticRows
          title={importMessages.statementReconciliationSkippedRowsTitle}
          detail={importMessages.statementReconciliationSkippedRowsDetail}
          summary={(summaryInput) => importMessages.statementReconciliationSkippedRowsSummary(summaryInput)}
          actionDetail={skippedRowsExplainMismatch
            ? importMessages.statementReconciliationSkippedRowsExactAction(formatService.money(resultDeltaMinor))
            : null}
          rows={breakdown.skippedStatementRows}
          totalRowCount={breakdown.skippedStatementRowCount}
          totalAmountMinor={breakdown.skippedStatementRowsMinor}
          viewId={viewId}
        />
      ) : null}
      {showExistingRows ? (
        <StatementReconciliationDiagnosticRows
          title={importMessages.statementReconciliationExistingRowsTitle}
          detail={importMessages.statementReconciliationExistingRowsDetail}
          summary={(summaryInput) => importMessages.statementReconciliationExistingRowsSummary(summaryInput)}
          actionDetail={existingRowsExplainMismatch
            ? importMessages.statementReconciliationExistingRowsExactAction(formatService.money(resultDeltaMinor))
            : null}
          rows={breakdown.periodExistingLedgerRows}
          totalRowCount={breakdown.periodExistingLedgerRowCount}
          totalAmountMinor={breakdown.statementPeriodExistingRowsMinor}
          viewId={viewId}
          accountId={reconciliation.accountId}
          statementEndDate={reconciliation.statementEndDate}
          onDeleteDiagnosticLedgerRow={onDeleteDiagnosticLedgerRow}
          onDeleteDiagnosticLedgerRows={onDeleteDiagnosticLedgerRows}
          onSetDiagnosticLedgerPostDate={onSetDiagnosticLedgerPostDate}
        />
      ) : null}
      {showMatchedRows ? (
        <StatementReconciliationDiagnosticRows
          title={importMessages.statementReconciliationMatchedRowsTitle}
          detail={importMessages.statementReconciliationMatchedRowsDetail}
          summary={(summaryInput) => importMessages.statementReconciliationMatchedRowsSummary({
            ...summaryInput,
            isMatched
          })}
          collapsedSummary={(summaryInput) => importMessages.statementReconciliationMatchedRowsCollapsedSummary(summaryInput)}
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
    <div className={`statement-reconciliation-movement ${isProblem ? moneyToneClass("short", "soft") : ""}`}>
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
  collapsedSummary = undefined,
  collapsedByDefault = false,
  actionDetail = undefined,
  rows,
  totalRowCount,
  totalAmountMinor,
  viewId,
  accountId = undefined,
  statementEndDate = undefined,
  onDeleteDiagnosticLedgerRow = undefined,
  onDeleteDiagnosticLedgerRows = undefined,
  onSetDiagnosticLedgerPostDate = undefined
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
    : importMessages.statementReconciliationExistingRowsSummary(summaryInput);
  const content = (
    <>
      {detail ? <p className="lede compact">{detail}</p> : null}
      <p className="lede compact">{summaryText}</p>
      {actionDetail ? <p className="lede compact statement-reconciliation-action">{actionDetail}</p> : null}
      {rows.map((row) => (
        <div key={row.id} className="import-overlap-entry-row statement-reconciliation-diagnostic-row">
          <span className="import-overlap-entry-date statement-reconciliation-date-cell">
            <span>{formatService.formatDateOnly(row.date)}</span>
            <small>{getDiagnosticRowDateDetail(row, statementEndDate)}</small>
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
                {importMessages.openDiagnosticEntry}
              </a>
              {onSetDiagnosticLedgerPostDate ? (
                <SetPostedDateButton
                  row={row}
                  statementEndDate={statementEndDate}
                  onSetPostDate={onSetDiagnosticLedgerPostDate}
                />
              ) : null}
              {onDeleteDiagnosticLedgerRow ? (
                <DeleteRowButton
                  label={row.description}
                  triggerLabel={importMessages.deleteDiagnosticEntry}
                  confirmLabel={importMessages.deleteDiagnosticEntry}
                  buttonClassName="statement-reconciliation-delete-button"
                  prompt={importMessages.deleteDiagnosticEntryConfirm({
                    date: formatService.formatDateOnly(row.date),
                    description: row.description,
                    amount: formatSignedDiagnosticAmount(row.signedAmountMinor)
                  })}
                  onConfirm={() => onDeleteDiagnosticLedgerRow(row)}
                >
                  {importMessages.deleteDiagnosticEntry}
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
            label={importMessages.deleteDiagnosticEntriesLabel(ledgerRows.length)}
            triggerLabel={importMessages.deleteDiagnosticEntriesLabel(ledgerRows.length)}
            confirmLabel={importMessages.deleteDiagnosticEntries}
            buttonClassName="statement-reconciliation-delete-all-button"
            prompt={importMessages.deleteDiagnosticEntriesConfirm({
              count: ledgerRows.length,
              amount: formattedTotalAmount
            })}
            onConfirm={() => onDeleteDiagnosticLedgerRows(ledgerRows)}
          >
            {importMessages.deleteDiagnosticEntries}
          </DeleteRowButton>
        ) : null}
      </div>
      {content}
    </div>
  );
}

function SetPostedDateButton({ row, statementEndDate, onSetPostDate }) {
  const fallbackDate = row.postedDate ?? row.date;
  const deferDate = getNextIsoDate(statementEndDate);
  const statementEndLabel = statementEndDate
    ? formatService.formatDateOnly(statementEndDate)
    : "the statement end date";
  const deferDateLabel = deferDate
    ? formatService.formatDateOnly(deferDate)
    : "the first day after this statement";

  return (
    <>
      <PostedDateDialog
        row={row}
        initialDate={fallbackDate}
        statementEndLabel={statementEndLabel}
        onSetPostDate={onSetPostDate}
      />
      {deferDate ? (
        <ConfirmLedgerActionButton
          label={row.description}
          triggerLabel={importMessages.deferDiagnosticEntry}
          confirmLabel={importMessages.deferDiagnosticEntryConfirm}
          buttonClassName="statement-reconciliation-post-date-button"
          prompt={importMessages.deferDiagnosticEntryDetail({
            statementEndDate: statementEndLabel,
            deferDate: deferDateLabel
          })}
          onConfirm={() => onSetPostDate(row, deferDate, {
            mode: "defer",
            label: deferDateLabel
          })}
        >
          {importMessages.deferDiagnosticEntry}
        </ConfirmLedgerActionButton>
      ) : null}
    </>
  );
}

function ConfirmLedgerActionButton({
  label,
  onConfirm,
  triggerLabel,
  confirmLabel,
  prompt,
  buttonClassName = "",
  children
}) {
  const [open, setOpen] = useState(false);
  const [isWorking, setIsWorking] = useState(false);
  const [error, setError] = useState("");

  async function handleConfirm() {
    setIsWorking(true);
    setError("");
    try {
      await onConfirm?.();
      setOpen(false);
    } catch (confirmError) {
      setError(confirmError instanceof Error ? confirmError.message : "The action could not finish.");
    } finally {
      setIsWorking(false);
    }
  }

  return (
    <Popover.Root
      open={open}
      onOpenChange={(nextOpen) => {
        if (isWorking) {
          return;
        }
        setOpen(nextOpen);
        if (!nextOpen) {
          setError("");
        }
      }}
    >
      <Popover.Trigger asChild>
        <button
          type="button"
          className={buttonClassName}
          aria-label={triggerLabel ?? label}
          disabled={isWorking}
          onClick={(event) => event.stopPropagation()}
        >
          {children ?? triggerLabel ?? label}
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          className="statement-reconciliation-confirm-popover"
          sideOffset={8}
          align="end"
          onClick={(event) => event.stopPropagation()}
        >
          <strong>{triggerLabel ?? label}</strong>
          <p>{prompt}</p>
          <InlineError message={error} />
          <div className="delete-popover-actions">
            <Popover.Close asChild>
              <button type="button" className="subtle-action" disabled={isWorking}>
                Cancel
              </button>
            </Popover.Close>
            <button
              type="button"
              className="dialog-primary"
              disabled={isWorking}
              onClick={() => void handleConfirm()}
            >
              {isWorking ? messages.common.working : confirmLabel}
            </button>
          </div>
          <Popover.Arrow className="category-popover-arrow" />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

function PostedDateDialog({ row, initialDate, statementEndLabel, onSetPostDate }) {
  const [open, setOpen] = useState(false);
  const [postDate, setPostDate] = useState(initialDate);
  const [isWorking, setIsWorking] = useState(false);
  const [error, setError] = useState("");
  const isSheet = useIsMobileLayout();

  async function handleSubmit() {
    if (!postDate) {
      setError("Choose a posted date.");
      return;
    }
    setIsWorking(true);
    setError("");
    try {
      await onSetPostDate(row, postDate, {
        mode: "exact",
        label: formatService.formatDateOnly(postDate)
      });
      setOpen(false);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Posted date could not be saved.");
    } finally {
      setIsWorking(false);
    }
  }

  return (
    <>
      <button
        type="button"
        className="statement-reconciliation-post-date-button"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => {
          setPostDate(initialDate);
          setError("");
          setOpen(true);
        }}
      >
        {importMessages.setDiagnosticPostDate}
      </button>
      {open ? (
        <SheetDialog
          className="statement-reconciliation-post-date-dialog"
          title={importMessages.setDiagnosticPostDateTitle}
          description={importMessages.setDiagnosticPostDateDetail({ statementEndDate: statementEndLabel })}
          descriptionHidden
          closeLabel="Close"
          lead={(
            <LeadCard
              className="sheet-dialog-lead"
              category={{ icon: CalendarDays }}
              title={row.description}
              subtitle={formatService.formatDateOnly(initialDate)}
            >
              <p className="lsd-note">{importMessages.setDiagnosticPostDateDetail({ statementEndDate: statementEndLabel })}</p>
            </LeadCard>
          )}
          errorMessage={error}
          primaryLabel={importMessages.setDiagnosticPostDateConfirm}
          primaryDisabled={isWorking}
          isSubmitting={isWorking}
          isDirty={postDate !== initialDate}
          onSubmit={handleSubmit}
          onClose={() => setOpen(false)}
        >
          <DetailRows label={importMessages.setDiagnosticPostDateTitle}>
            <DateRow
              isSheet={isSheet}
              rowKey="post-date"
              label={importMessages.setDiagnosticPostDateField}
              value={postDate}
              valueLabel={postDate ? formatService.formatDateOnly(postDate) : ""}
              onValueChange={setPostDate}
            />
          </DetailRows>
        </SheetDialog>
      ) : null}
    </>
  );
}

function getDiagnosticRowDateDetail(row, statementEndDate) {
  if (row.source === "statement") {
    if (row.eventDate && row.eventDate !== row.date) {
      return importMessages.statementReconciliationStatementDualDateDetail({
        postedDate: formatService.formatDateOnly(row.date),
        eventDate: formatService.formatDateOnly(row.eventDate)
      });
    }
    return importMessages.statementReconciliationStatementDateDetail;
  }

  if (row.postedDate && statementEndDate && row.postedDate > statementEndDate) {
    return importMessages.statementReconciliationLedgerPostedAfterCutoffDetail({
      transactionDate: formatService.formatDateOnly(row.date),
      postedDate: formatService.formatDateOnly(row.postedDate),
      statementEndDate: formatService.formatDateOnly(statementEndDate)
    });
  }

  if (row.postedDate && row.postedDate !== row.date) {
    return importMessages.statementReconciliationLedgerDualDateDetail({
      transactionDate: formatService.formatDateOnly(row.date),
      postedDate: formatService.formatDateOnly(row.postedDate)
    });
  }
  return importMessages.statementReconciliationLedgerDateDetail;
}

function getNextIsoDate(date) {
  return date ? addDaysToIsoDate(date, 1) : "";
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

// What an investment statement will save: the worth it states for its date
// (a statement figure, not a balance and never checked against entries) and,
// for each contribution or withdrawal, the bank payment it is the same money
// as. Money follows the privacy setting (money() hides it).
function InvestmentStatementValues({ values, previewRows }) {
  const movements = previewRows.filter((row) => row.entryType === "transfer" && row.commitStatus !== "skipped");
  return (
    <div className="import-warning import-warning-review" data-import-target="investment-statement">
      <strong>{importMessages.investmentStatementTitle}</strong>
      {values.map((value) => (
        <p key={`${value.detectedAccountName}-${value.checkpointMonth}`} className="lede compact">
          {importMessages.investmentStatementWorth(value.accountName, formatService.money(value.totalAssetsMinor), formatService.formatDateOnly(value.asOfDate))}
          {value.replaces ? ` ${importMessages.investmentStatementReplaces(formatService.money(value.replaces.totalAssetsMinor), formatService.formatDateOnly(value.replaces.asOfDate))}` : ""}
          {value.startsAfter ? ` ${importMessages.investmentStatementStartsAfter(formatService.money(value.startsAfter.openingMinor), formatService.money(value.startsAfter.earlierValueMinor), formatService.formatDateOnly(value.startsAfter.earlierAsOfDate))}` : ""}
        </p>
      ))}
      {movements.map((row) => (
        <p key={row.rowId} className="lede compact">
          {row.transferMatch
            ? importMessages.investmentStatementPaired(formatService.money(row.amountMinor), formatService.formatDateOnly(row.date), row.transferMatch.accountName, formatService.formatDateOnly(row.transferMatch.date), row.transferDirection)
            : importMessages.investmentStatementUnpaired(formatService.money(row.amountMinor), formatService.formatDateOnly(row.date), row.transferDirection)}
        </p>
      ))}
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
  // An investment statement's value has its own card above: it is not an
  // editable balance. The rest keep their index in the full list.
  const editable = statementCheckpoints.map((checkpoint, index) => ({ checkpoint, index })).filter(({ checkpoint }) => !checkpoint.investmentValue);
  if (!editable.length) {
    return null;
  }

  return (
    <div className="import-warning import-warning-review" data-import-target="statement-details">
      <strong>{importMessages.statementCheckpointsTitle(editable.length)}</strong>
      <p className="lede compact">{importMessages.statementCheckpointsDetail(editable.length)}</p>
      {hasDuplicateCheckpointAccounts ? (
        <p className="form-error">{importMessages.duplicateCheckpointAccounts(duplicateCheckpointAccounts.join(", "))}</p>
      ) : null}
      <div className="statement-checkpoint-grid">
        {editable.map(({ checkpoint, index }) => (
          <div key={`${checkpoint.accountName}-${index}`} className="statement-checkpoint-row">
            <label className="entries-filter">
              <span className="entries-filter-label">{importMessages.statementCheckpointAccount}</span>
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
              <span className="entries-filter-label">{importMessages.statementCheckpointMonth}</span>
              <input className="table-edit-input" type="month" value={checkpoint.checkpointMonth} onChange={(event) => onUpdateStatementCheckpoint(index, { checkpointMonth: event.target.value })} />
            </label>
            <label className="entries-filter">
              <span className="entries-filter-label">{importMessages.statementCheckpointStart}</span>
              <input className="table-edit-input" type="date" value={checkpoint.statementStartDate ?? ""} onChange={(event) => onUpdateStatementCheckpoint(index, { statementStartDate: event.target.value })} />
            </label>
            <label className="entries-filter">
              <span className="entries-filter-label">{importMessages.statementCheckpointEnd}</span>
              <input className="table-edit-input" type="date" value={checkpoint.statementEndDate ?? ""} onChange={(event) => onUpdateStatementCheckpoint(index, { statementEndDate: event.target.value })} />
            </label>
            <label className="entries-filter">
              <span className="entries-filter-label">{importMessages.statementCheckpointBalance}</span>
              <input
                className="table-edit-input"
                value={formatService.formatMinorInput(checkpoint.statementBalanceMinor)}
                onChange={(event) => onUpdateStatementCheckpoint(index, {
                  statementBalanceMinor: formatService.parseMoneyInput(event.target.value, checkpoint.statementBalanceMinor)
                })}
              />
            </label>
            <label className="entries-filter">
              <span className="entries-filter-label">{importMessages.statementCheckpointNote}</span>
              <input className="table-edit-input" value={checkpoint.note ?? ""} onChange={(event) => onUpdateStatementCheckpoint(index, { note: event.target.value })} />
            </label>
          </div>
        ))}
      </div>
    </div>
  );
}

const STATEMENT_CARD_ROW_LIMIT = 5;

// The statement's own name: bank and kind from the parser, month from the
// checkpoints ("UOB card statement · May 2026").
export function buildStatementTitle({ parserKey, statementReconciliations, sourceLabel }) {
  const bank = [["uob", "UOB"], ["citibank", "Citibank"], ["ocbc", "OCBC"], ["hsbc", "HSBC"]]
    .find(([prefix]) => parserKey?.startsWith(prefix))?.[1];
  const month = statementReconciliations[0]?.checkpointMonth;
  if (!bank || !month) {
    return sourceLabel;
  }
  const kind = /card/.test(parserKey) || statementReconciliations.every((item) => item.accountKind === "credit_card")
    ? importMessages.statementKindCard
    : importMessages.statementKindAccount;
  return importMessages.statementTitle(bank, kind, formatService.formatMonthLabel(month));
}

// A card's outcome, read from the diagnosis after the fixes it suggests.
// `tone` picks the pastel: mint resolved, sky a fix waiting for the user,
// butter partly explained, lavender found but not fixable here, rose not
// explained.
export function getStatementCardStatus({ reconciliation, diagnosis }) {
  const labels = importMessages.statementCardStatus;
  if (reconciliation.status === "unknown_account") {
    return { key: "unknown_account", tone: "warning", label: labels.unknown_account };
  }
  if (reconciliation.status === "identity_unconfirmed") {
    return { key: "identity_unconfirmed", tone: "pill-lavender", label: labels.identity_unconfirmed };
  }
  if (reconciliation.status === "missing_prior_statement") {
    return { key: "missing_prior_statement", tone: "pill-lavender", label: labels.missing_prior_statement };
  }
  const card = diagnosis?.cards?.find((item) => item.accountId === reconciliation.accountId);
  const openFixCount = (diagnosis?.findings ?? []).filter((finding) => (
    finding.fix && !finding.applied && finding.confidence !== "low"
    && (finding.accountId === reconciliation.accountId || finding.relatedAccountId === reconciliation.accountId)
  )).length;
  if (openFixCount && (card?.projectedDeltaMinor ?? 1) === 0) {
    return { key: "fix_ready", tone: "pill-sky", label: labels.fix_ready, openFixCount };
  }
  if ((reconciliation.deltaMinor ?? 0) === 0) {
    return { key: "resolved", tone: "success", label: labels.resolved };
  }
  // A statement or more was never imported between the last saved one and
  // this one: importing them is the fix, so say that rather than "review".
  if (reconciliation.accountId && getMissingStatementMonths(diagnosis, reconciliation.accountId).length) {
    return { key: "missing_statements", tone: "pill-lavender", label: labels.missing_prior_statement };
  }
  const outcome = card?.outcome ?? "still_mismatched";
  if (outcome === "partially_resolved") {
    return { key: outcome, tone: "pill-butter", label: labels.partially_resolved, openFixCount };
  }
  if (outcome === "needs_manual_review") {
    return { key: outcome, tone: "pill-lavender", label: labels.needs_manual_review };
  }
  return { key: "still_mismatched", tone: "warning", label: labels.still_mismatched };
}

function StatementReview({
  preview,
  previewRows,
  accounts,
  statementReconciliations,
  parserKey,
  viewId,
  isSubmitting,
  needsStatementAccountMapping,
  isEditingRows,
  onToggleEditRows,
  isAutomaticStatementFixes,
  autoAppliedStatementFixCount,
  onAutomaticStatementFixesChange,
  dismissedFindingIds,
  onApplyStatementFixes,
  onUndoStatementFixes,
  onDismissStatementFindings,
  onDeleteDiagnosticLedgerRow,
  onDeleteDiagnosticLedgerRows,
  onSetDiagnosticLedgerPostDate,
  onRefreshStatementReconciliation,
  accountMapping,
  unknownCategories,
  certifiedConflicts,
  statementDetails,
  hasDuplicateCheckpointAccounts,
  moreChecks
}) {
  // Once a card had to be mapped, the mapping stays open for this review so
  // it does not vanish under the user's hand when the last card is mapped.
  const [isMappingOpen, setIsMappingOpen] = useState(needsStatementAccountMapping);
  const [isDetailsOpen, setIsDetailsOpen] = useState(false);
  const diagnosis = preview.statementDiagnosis;
  const statuses = statementReconciliations.map((reconciliation) => getStatementCardStatus({ reconciliation, diagnosis }));
  const fixReadyCount = statuses.filter((status) => status.key === "fix_ready").length;
  const openFixEntryCount = new Set((diagnosis?.findings ?? [])
    .filter((finding) => finding.fix && !finding.applied && finding.confidence !== "low" && !dismissedFindingIds.includes(finding.id))
    .map((finding) => finding.fix.entryId)).size;
  const openCount = statuses.filter((status) => status.key !== "resolved").length;
  const startDate = statementReconciliations.map((item) => item.statementStartDate).filter(Boolean).sort()[0];
  const endDate = statementReconciliations.map((item) => item.statementEndDate).filter(Boolean).sort().at(-1);
  const overall = openCount === 0
    ? { tone: "success", label: importMessages.statementAllBalance(statementReconciliations.length) }
    : fixReadyCount === openCount
      ? { tone: "pill-sky", label: importMessages.statementFixesReady(openFixEntryCount) }
      : { tone: "warning", label: importMessages.statementCardsNeedYou(openCount) };

  return (
    <section className="statement-review" aria-label={importMessages.statementReconciliationTitle}>
      <div className="statement-review-head">
        <div className="statement-review-title">
          <h3>{buildStatementTitle({ parserKey, statementReconciliations, sourceLabel: preview.sourceLabel })}</h3>
          <span className="lede compact">{importMessages.statementReviewSubline({
            endDate: endDate ? formatService.formatDateOnly(endDate) : "",
            startDate: startDate ? formatService.formatDateOnly(startDate) : "",
            cardCount: statementReconciliations.length,
            rowCount: previewRows.length
          })}</span>
        </div>
        <div className="statement-review-actions">
          <span className={`pill ${overall.tone}`}>{overall.label}</span>
          <button type="button" className="subtle-action" data-import-target="statement-check" onClick={onRefreshStatementReconciliation} disabled={isSubmitting}>
            {importMessages.statementReconciliationRefresh}
          </button>
          {!needsStatementAccountMapping && accountMapping ? (
            <button type="button" className="subtle-action" aria-expanded={isMappingOpen} onClick={() => setIsMappingOpen((current) => !current)}>
              {importMessages.statementChangeAccounts}
            </button>
          ) : null}
          <button type="button" className="subtle-action" aria-expanded={isDetailsOpen || hasDuplicateCheckpointAccounts} onClick={() => setIsDetailsOpen((current) => !current)}>
            {importMessages.statementEditDetails}
          </button>
          <button type="button" className="subtle-action" aria-pressed={isEditingRows} onClick={onToggleEditRows}>
            {isEditingRows ? importMessages.statementHideRowEditor : importMessages.statementEditRows}
          </button>
        </div>
      </div>
      {needsStatementAccountMapping || isMappingOpen ? accountMapping : null}
      {unknownCategories}
      {isDetailsOpen || hasDuplicateCheckpointAccounts ? statementDetails : null}
      {diagnosis?.rejectedFixes?.map((item) => (
        <p key={`${item.fix.kind}-${item.fix.entryId}`} className="lede compact statement-fix-rejected">
          {importMessages.statementFixRejected(item.reason)}
        </p>
      ))}
      {certifiedConflicts}
      {autoAppliedStatementFixCount && isAutomaticStatementFixes ? (
        <div className="statement-auto-applied">
          <span>{importMessages.statementAutoApplied(autoAppliedStatementFixCount)}</span>
          <button type="button" className="subtle-action" onClick={() => onAutomaticStatementFixesChange(false)}>
            {importMessages.statementAskFirst}
          </button>
        </div>
      ) : null}
      <div className="stack">
        {statementReconciliations.map((reconciliation, index) => (
          <StatementCardSection
            key={`${reconciliation.accountName}-${reconciliation.checkpointMonth}`}
            reconciliation={reconciliation}
            status={statuses[index]}
            diagnosis={diagnosis}
            accounts={accounts}
            rows={previewRows.filter((row) => row.accountId
              ? row.accountId === reconciliation.accountId
              : (row.statementAccountName ?? row.accountName) === reconciliation.accountName)}
            viewId={viewId}
            isSubmitting={isSubmitting}
            dismissedFindingIds={dismissedFindingIds}
            onApplyStatementFixes={onApplyStatementFixes}
            onUndoStatementFixes={onUndoStatementFixes}
            onDismissStatementFindings={onDismissStatementFindings}
            isAutomaticStatementFixes={isAutomaticStatementFixes}
            onAutomaticStatementFixesChange={onAutomaticStatementFixesChange}
            onDeleteDiagnosticLedgerRow={onDeleteDiagnosticLedgerRow}
            onDeleteDiagnosticLedgerRows={onDeleteDiagnosticLedgerRows}
            onSetDiagnosticLedgerPostDate={onSetDiagnosticLedgerPostDate}
          />
        ))}
      </div>
      <details className="statement-more-checks">
        <summary>{importMessages.statementMoreChecks}</summary>
        <div className="stack">{moreChecks}</div>
      </details>
    </section>
  );
}

function StatementCardSection({
  reconciliation,
  status,
  diagnosis,
  accounts,
  rows,
  viewId,
  isSubmitting,
  dismissedFindingIds,
  onApplyStatementFixes,
  onUndoStatementFixes,
  onDismissStatementFindings,
  isAutomaticStatementFixes,
  onAutomaticStatementFixesChange,
  onDeleteDiagnosticLedgerRow,
  onDeleteDiagnosticLedgerRows,
  onSetDiagnosticLedgerPostDate
}) {
  const card = diagnosis?.cards?.find((item) => item.accountId === reconciliation.accountId);
  const hasCardFixes = (diagnosis?.findings ?? []).some((finding) => (
    finding.fix
    && (finding.accountId === reconciliation.accountId || finding.relatedAccountId === reconciliation.accountId)
    && !dismissedFindingIds.includes(finding.id)
  ));
  const [manualOpen, setManualOpen] = useState(null);
  // A card that balances only because the scan took an amount from the total
  // opens too: that amount needs checking against the PDF.
  const inferredAmountKeys = useInferredAmountKeys();
  const hasInferredAmount = rows.some((row) => isInferredAmountRow(row, inferredAmountKeys));
  // A card whose statement has bank charges or notices opens too, so a late
  // charge on a statement that balances is still seen.
  const hasBankCharges = summarizeStatementCharges(rows, reconciliation.notices).hasAnything;
  const isOpen = manualOpen ?? (status.key !== "resolved" || hasCardFixes || hasInferredAmount || hasBankCharges);
  const deltaMinor = reconciliation.deltaMinor ?? 0;
  const projectedDeltaMinor = card?.projectedDeltaMinor ?? deltaMinor;
  const addedCount = rows.filter((row) => row.commitStatus !== "skipped" && row.commitStatus !== "needs_review" && !row.reconciliationTargetTransactionId).length;
  // Every row the ledger already has, whether this commit certifies it or an
  // earlier statement did.
  const confirmedCount = rows.filter(isLedgerMatchedPreviewRow).length;
  const previousImport = reconciliation.previousStatementImport;
  // Whose account the statement goes to, in that person's colour, so a
  // card with the same name for two people can't be mixed up.
  const paymentDue = describePaymentDue(reconciliation);
  const owner = reconciliation.accountId
    ? accounts.find((account) => account.id === reconciliation.accountId)?.ownerLabel
    : undefined;

  return (
    <article
      className={`import-card statement-reconciliation-row statement-card ${isOpen ? "is-open" : "is-collapsed"}`}
      aria-label={reconciliation.accountName}
      data-import-target="statement-card"
      data-account-name={reconciliation.accountName}
    >
      <div className="statement-reconciliation-card-head statement-card-head">
        <div className="statement-card-title">
          <span className={`pill ${status.tone}`}>{status.label}</span>
          <div className="statement-reconciliation-card-title">
            <strong>
              {owner ? (
                <span className="statement-card-owner" style={getPersonColourVars(owner)}>{owner}</span>
              ) : null}
              {importMessages.statementReconciliationAccount(
                reconciliation.accountName,
                formatService.formatMonthLabel(reconciliation.checkpointMonth)
              )}
              {reconciliation.accountLast4 ? ` • ${importMessages.statementCardEnding(reconciliation.accountLast4)}` : ""}
            </strong>
            <span className="import-history-inline">
              {formatService.formatStatementReconciliationLine(reconciliation)}
              {deltaMinor !== 0
                ? ` • ${importMessages.statementCardDifference(
                  formatService.money(Math.abs(deltaMinor)),
                  projectedDeltaMinor !== deltaMinor ? formatService.money(Math.abs(projectedDeltaMinor)) : ""
                )}`
                : ""}
            </span>
            <span className="import-history-inline">{importMessages.statementCardCounts(addedCount, confirmedCount)}</span>
            {paymentDue ? (
              <span className="import-history-inline statement-card-payment-due">
                {paymentDue.isDueNow
                  ? importMessages.statementPaymentDueNow(formatService.money(paymentDue.owedMinor))
                  : importMessages.statementPaymentDue(
                    formatService.money(paymentDue.owedMinor),
                    formatService.formatDateOnly(paymentDue.dueDate),
                    paymentDue.minimumMinor ? formatService.money(paymentDue.minimumMinor) : ""
                  )}
              </span>
            ) : null}
            {previousImport ? (
              <span className="import-history-inline statement-card-previous-import">
                {importMessages.statementAlreadyImported(formatService.formatDateOnly(previousImport.importedAt), previousImport.sourceLabel)}
              </span>
            ) : null}
          </div>
        </div>
        <button type="button" className="subtle-action" aria-expanded={isOpen} onClick={() => setManualOpen(!isOpen)}>
          {isOpen ? importMessages.statementCardHide : importMessages.statementCardShow}
        </button>
      </div>
      {isOpen ? (
        <div className="statement-card-body">
          <StatementBankCharges rows={rows} notices={reconciliation.notices} />
          {reconciliation.accountId ? (
            <StatementFixSuggestions
              accountId={reconciliation.accountId}
              statementEndDate={reconciliation.statementEndDate}
              diagnosis={diagnosis}
              accounts={accounts}
              dismissedFindingIds={dismissedFindingIds}
              isSubmitting={isSubmitting}
              onApplyStatementFixes={onApplyStatementFixes}
              onUndoStatementFixes={onUndoStatementFixes}
              onDismissStatementFindings={onDismissStatementFindings}
              isAutomaticStatementFixes={isAutomaticStatementFixes}
              onAutomaticStatementFixesChange={onAutomaticStatementFixesChange}
            />
          ) : null}
          {reconciliation.supersededLedgerRows?.length ? (
            <div className="import-overlap-entry-list" aria-label={importMessages.statementReconciliationSupersededRowsTitle}>
              <strong>{importMessages.statementReconciliationSupersededRowsTitle}</strong>
              {reconciliation.supersededLedgerRows.map((row) => (
                <div key={row.transactionId} className="import-overlap-entry-row">
                  <span className="import-overlap-entry-date">{formatService.formatDateOnly(row.postedDate ?? row.date)}</span>
                  <span className="import-overlap-entry-description">{row.description}</span>
                  <span className="import-overlap-entry-account">{row.accountName}</span>
                  <strong className="import-overlap-entry-amount">{formatService.money(Math.abs(row.signedAmountMinor))}</strong>
                </div>
              ))}
            </div>
          ) : null}
          <StatementCardRows rows={rows} />
          {reconciliation.reconciliationBreakdown && deltaMinor !== 0 ? (
            <details className="statement-card-breakdown">
              <summary>{importMessages.statementHowItAddsUp}</summary>
              <StatementReconciliationBreakdown
                reconciliation={reconciliation}
                breakdown={reconciliation.reconciliationBreakdown}
                accountKind={reconciliation.accountKind}
                viewId={viewId}
                onDeleteDiagnosticLedgerRow={onDeleteDiagnosticLedgerRow}
                onDeleteDiagnosticLedgerRows={onDeleteDiagnosticLedgerRows}
                onSetDiagnosticLedgerPostDate={onSetDiagnosticLedgerPostDate}
              />
            </details>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}

// The card's statement rows, read-only: what each will do on commit. Rows
// that need the user come first; the full editor is one button away.
function StatementCardRows({ rows }) {
  const { areTotalsVisible } = useMoneyPrivacy();
  const inferredAmountKeys = useInferredAmountKeys();
  const [isShowingAll, setIsShowingAll] = useState(false);
  if (!rows.length) {
    return null;
  }
  const order = (row) => row.commitStatus === "needs_review" ? 0 : row.commitStatus === "skipped" && row.commitStatusExplicit ? 1 : 2;
  const sorted = [...rows].sort((left, right) => order(left) - order(right) || left.date.localeCompare(right.date));
  const visible = isShowingAll ? sorted : sorted.slice(0, STATEMENT_CARD_ROW_LIMIT);
  // Closed unless a row needs the user: the card header already counts them.
  // An amount taken from the statement total also needs checking against the PDF.
  const needsAttention = rows.some((row) => (
    row.commitStatus === "needs_review"
    || (row.commitStatus === "skipped" && row.commitStatusExplicit)
    || isInferredAmountRow(row, inferredAmountKeys)
  ));
  return (
    <details className="statement-card-rows" open={needsAttention}>
      <summary>{importMessages.statementCardRowsTitle(rows.length)}</summary>
      <ul>
        {visible.map((row) => {
          const chip = getStatementRowChip(row);
          const signedMinor = row.entryType === "income" || row.transferDirection === "in" ? row.amountMinor : -row.amountMinor;
          return (
            <li key={row.rowId} className="statement-card-row">
              <span className="statement-card-row-date">{formatService.formatDateOnly(row.date)}</span>
              <span className="statement-card-row-description">{row.description}</span>
              <span className={`statement-card-row-chips${isInferredAmountRow(row, inferredAmountKeys) ? " has-mark" : ""}`}>
                <span className={`pill ${chip.tone}`}>{chip.label}</span>
                {isInferredAmountRow(row, inferredAmountKeys) ? (
                  <span className="pill pill-lavender statement-inferred-amount" title={importMessages.statementInferredAmountHint}>
                    {importMessages.statementInferredAmount}
                  </span>
                ) : null}
              </span>
              <strong className={`statement-card-row-amount ${areTotalsVisible ? moneyToneClass(entryAmountTone(row.entryType, signedMinor)) : ""}`}>
                {formatService.money(row.amountMinor)}
              </strong>
            </li>
          );
        })}
      </ul>
      {sorted.length > STATEMENT_CARD_ROW_LIMIT ? (
        <button type="button" className="subtle-action" aria-expanded={isShowingAll} onClick={() => setIsShowingAll((current) => !current)}>
          {isShowingAll ? importMessages.statementCardFewerRows : importMessages.statementCardMoreRows(sorted.length - STATEMENT_CARD_ROW_LIMIT)}
        </button>
      ) : null}
    </details>
  );
}

function getStatementRowChip(row) {
  const chips = importMessages.statementRowChip;
  if (row.commitStatus === "needs_review") {
    return { tone: "pill-lavender", label: chips.needsReview };
  }
  if (row.commitStatus === "skipped") {
    return row.commitStatusExplicit
      ? { tone: "pill-butter", label: chips.leftOut }
      : { tone: "pill-neutral", label: chips.alreadyCovered };
  }
  if (row.reconciliationTargetTransactionId) {
    return { tone: "success", label: chips.confirms(row.reconciliationMatch?.description) };
  }
  return { tone: "pill-sky", label: chips.added };
}
