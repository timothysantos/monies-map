import { Fragment, useEffect, useRef, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import * as Popover from "@radix-ui/react-popover";
import { messages } from "./copy/en-SG";
import { importMessages } from "./copy/en-SG-imports";
import { EmptyState } from "./ui-states";
import { selectAllOnFocus } from "./focus-utils";
import { moniesClient } from "./monies-client-service";
import { useMoneyPrivacy } from "./money-privacy";
import { moneyToneClass } from "./money-tone-class";
import { entryAmountTone } from "../domain/money-tone";
import { isInferredAmountRow, useInferredAmountKeys } from "./import-inferred-amounts";

const {
  accounts: accountService,
  categories: categoryService,
  format: formatService
} = moniesClient;

// Preview rows are edited here, while ImportsPanel owns the canonical payload
// and ImportCommitBar the commit.
export function ImportPreviewRowsTable({
  previewRows,
  accounts,
  categories,
  people,
  knownAccountNames,
  statementImportSourceType = "csv",
  hasAlreadyCoveredCheckpointRefresh = false,
  hasEmptyStatementCheckpointOnly = false,
  ledgerMatchedStatement = null,
  jumpToSkippedRowsRequestKey = 0,
  onUpdatePreviewRow,
  onUpdatePreviewRowAccount,
  onUpdatePreviewRowCommitStatus,
  onPromotePreviewRowReconciliationTarget,
  getPreviewAccountOwnerPatch
}) {
  const { areTotalsVisible } = useMoneyPrivacy();
  const accountOptions = accountService.getSelectOptions(accounts, { valueKey: "id" });
  const categorySelectOptions = categoryService.listForSelect(categories);
  const visibleRows = previewRows.filter((row) => (
    !row.isStatementMatchResolved && !(row.isCertifiedConflict && row.commitStatus === "skipped")
  ));
  const activeRows = visibleRows.filter((row) => row.commitStatus !== "skipped");
  const skippedRows = visibleRows.filter((row) => row.commitStatus === "skipped");
  const skippedRowsRef = useRef(null);

  useEffect(() => {
    if (!jumpToSkippedRowsRequestKey || !skippedRows.length || !skippedRowsRef.current) {
      return;
    }

    skippedRowsRef.current.open = true;
    skippedRowsRef.current.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [jumpToSkippedRowsRequestKey, skippedRows.length]);

  return (
    <>
      {activeRows.length ? (
        <PreviewRowsTable
          rows={activeRows}
          accounts={accounts}
          accountOptions={accountOptions}
          categorySelectOptions={categorySelectOptions}
          people={people}
          knownAccountNames={knownAccountNames}
          statementImportSourceType={statementImportSourceType}
          onUpdatePreviewRow={onUpdatePreviewRow}
          onUpdatePreviewRowAccount={onUpdatePreviewRowAccount}
          onUpdatePreviewRowCommitStatus={onUpdatePreviewRowCommitStatus}
          onPromotePreviewRowReconciliationTarget={onPromotePreviewRowReconciliationTarget}
          getPreviewAccountOwnerPatch={getPreviewAccountOwnerPatch}
          areTotalsVisible={areTotalsVisible}
        />
      ) : (
        <EmptyState>
          {ledgerMatchedStatement
            ? importMessages.noRowsToImportAllInLedger(ledgerMatchedStatement.matchedCount, ledgerMatchedStatement.toCertifyCount)
            : hasAlreadyCoveredCheckpointRefresh
            ? importMessages.noRowsToImportCoveredStatement
            : hasEmptyStatementCheckpointOnly
              ? importMessages.noRowsToImportEmptyStatement
              : importMessages.noRowsToImport}
        </EmptyState>
      )}
      {skippedRows.length ? (
        <details ref={skippedRowsRef} className="import-skipped-rows" id="import-skipped-rows">
          <summary>{importMessages.skippedRowsTitle(skippedRows.length)}</summary>
          <PreviewRowsTable
            rows={skippedRows}
          accounts={accounts}
          accountOptions={accountOptions}
          categorySelectOptions={categorySelectOptions}
          people={people}
          knownAccountNames={knownAccountNames}
          statementImportSourceType={statementImportSourceType}
            onUpdatePreviewRow={onUpdatePreviewRow}
            onUpdatePreviewRowAccount={onUpdatePreviewRowAccount}
            onUpdatePreviewRowCommitStatus={onUpdatePreviewRowCommitStatus}
            onPromotePreviewRowReconciliationTarget={onPromotePreviewRowReconciliationTarget}
            getPreviewAccountOwnerPatch={getPreviewAccountOwnerPatch}
            areTotalsVisible={areTotalsVisible}
            isSkippedTable
          />
        </details>
      ) : null}
    </>
  );
}

function PreviewRowsTable({
  rows,
  accounts,
  accountOptions,
  categorySelectOptions,
  people,
  knownAccountNames,
  statementImportSourceType,
  onUpdatePreviewRow,
  onUpdatePreviewRowAccount,
  onUpdatePreviewRowCommitStatus,
  onPromotePreviewRowReconciliationTarget,
  getPreviewAccountOwnerPatch,
  areTotalsVisible,
  isSkippedTable = false
}) {
  const [restoreTarget, setRestoreTarget] = useState(null);
  const inferredAmountKeys = useInferredAmountKeys();
  return (
    <div className="table-wrap import-table-wrap">
      <table className="summary-table import-preview-table">
        <thead>
          <tr>
            <th>{importMessages.table.row}</th>
            <th>{importMessages.table.actions}</th>
            <th>{importMessages.table.date}</th>
            <th>{importMessages.table.description}</th>
            <th>{importMessages.table.amount}</th>
            <th>{importMessages.table.type}</th>
            <th>{importMessages.table.account}</th>
            <th>{importMessages.table.category}</th>
            <th>{importMessages.table.owner}</th>
            <th>{importMessages.table.split}</th>
            <th>{importMessages.table.note}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const duplicateMatch = row.reconciliationMatches?.[0] ?? row.reconciliationMatch;
            const canPromoteExistingRow = canPromoteExistingRowMatch(row, duplicateMatch);
            const isAutoMatchedExistingRow = isAutoMatchedExistingRowMatch(row, duplicateMatch);
            const showReviewDetails = Boolean(duplicateMatch || row.commitStatus === "needs_review" || row.commitStatusReason);
            return (
              <Fragment key={row.rowId}>
                <tr className={duplicateMatch ? "import-preview-row-duplicate" : ""} data-commit-status={row.commitStatus}>
                  <td>{row.rowIndex}</td>
                  <td>
                    <div className="import-row-actions">
                      {row.commitStatus === "needs_review" && canPromoteExistingRow ? (
                        <button
                          type="button"
                          className="subtle-action"
                          onClick={() => onPromotePreviewRowReconciliationTarget(row.rowId, duplicateMatch.existingTransactionId)}
                        >
                          {importMessages.promoteExistingPreviewRow}
                        </button>
                      ) : null}
                      {row.commitStatus === "needs_review" ? (
                        <button type="button" className="subtle-action" onClick={() => onUpdatePreviewRowCommitStatus(row.rowId, "included")}>
                          {canPromoteExistingRow ? importMessages.importAsNewPreviewRow : importMessages.importPreviewRow}
                        </button>
                      ) : null}
                      {isAutoMatchedExistingRow ? (
                        <span className="pill success">{importMessages.matchedExistingPreviewRow}</span>
                      ) : isSkippedTable ? (
                        <button
                          type="button"
                          className="subtle-action"
                          onClick={() => {
                            if (duplicateMatch?.matchKind === "exact") {
                              setRestoreTarget(row);
                              return;
                            }
                            onUpdatePreviewRowCommitStatus(row.rowId, "included");
                          }}
                        >
                          {importMessages.restorePreviewRow}
                        </button>
                      ) : (
                        <button type="button" className="subtle-action" onClick={() => onUpdatePreviewRowCommitStatus(row.rowId, "skipped")}>
                          {importMessages.skipPreviewRow}
                        </button>
                      )}
                    </div>
                  </td>
                  <td>
                    <input className="table-edit-input" type="date" value={row.date} onChange={(event) => onUpdatePreviewRow(row.rowId, { date: event.target.value })} disabled={isSkippedTable} />
                  </td>
                  <td>
                    <input className="table-edit-input import-description-input" value={row.description} onChange={(event) => onUpdatePreviewRow(row.rowId, { description: event.target.value })} disabled={isSkippedTable} />
                  </td>
                  <td className={moneyToneClass(entryAmountTone(row.entryType, row.entryType === "expense" || row.transferDirection === "out" ? -row.amountMinor : row.amountMinor))}>
                    <input
                      className={`table-edit-input import-amount-input${areTotalsVisible ? "" : " is-screened"}`}
                      value={formatService.formatMinorInput(row.amountMinor)}
                      onMouseDown={selectAllOnFocus}
                      onFocus={selectAllOnFocus}
                      onChange={(event) => onUpdatePreviewRow(row.rowId, {
                        amountMinor: formatService.parseMoneyInput(event.target.value, row.amountMinor)
                      })}
                      disabled={isSkippedTable}
                    />
                    {isInferredAmountRow(row, inferredAmountKeys) ? (
                      <span className="import-inferred-amount-note" title={importMessages.statementInferredAmountHint}>
                        {importMessages.statementInferredAmount}
                      </span>
                    ) : null}
                  </td>
                  <td>
                    <select className="table-edit-input" value={row.entryType} onChange={(event) => onUpdatePreviewRow(row.rowId, { entryType: event.target.value })} disabled={isSkippedTable}>
                      <option value="expense">Expense</option>
                      <option value="income">Income</option>
                      <option value="transfer">Transfer</option>
                    </select>
                  </td>
                  <td>
                    <select
                      className="table-edit-input"
                      value={row.accountId ?? row.accountName ?? ""}
                      onChange={(event) => {
                        const nextAccountId = event.target.value || undefined;
                        const nextAccount = accounts.find((account) => account.id === nextAccountId);
                        const nextAccountName = nextAccount?.name ?? (!nextAccountId ? undefined : row.accountName);
                        onUpdatePreviewRowAccount(row.rowId, {
                          accountId: nextAccount?.id,
                          accountName: nextAccountName,
                          ...getPreviewAccountOwnerPatch(nextAccountName, row, nextAccount?.id)
                        });
                      }}
                      disabled={isSkippedTable}
                    >
                      <option value="">{messages.entries.allWallets}</option>
                      {row.accountName && !row.accountId && !knownAccountNames.has(row.accountName) ? (
                        <option value={row.accountName}>{row.accountName}</option>
                      ) : null}
                      {accountOptions.map((account) => (
                        <option key={account.id} value={account.value}>{account.label}</option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <select className="table-edit-input" value={row.categoryName ?? ""} onChange={(event) => onUpdatePreviewRow(row.rowId, { categoryName: event.target.value || undefined })} disabled={isSkippedTable}>
                      <option value="">{messages.entries.allCategories}</option>
                      {categorySelectOptions.map((category) => (
                        <option key={category.id} value={category.name}>{category.name}</option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <select
                      className="table-edit-input"
                      value={row.ownerName ?? ""}
                      onChange={(event) => {
                        const nextOwner = event.target.value;
                        onUpdatePreviewRow(row.rowId, { ownershipType: "direct", ownerName: nextOwner, splitBasisPoints: 10000 });
                      }}
                      disabled={isSkippedTable}
                    >
                      {people.map((person) => (
                        <option key={person.id} value={person.name}>{person.name}</option>
                      ))}
                    </select>
                  </td>
                  <td>
                    {messages.common.emptyValue}
                  </td>
                  <td>
                    <input className="table-edit-input" value={row.note ?? ""} onChange={(event) => onUpdatePreviewRow(row.rowId, { note: event.target.value })} disabled={isSkippedTable} />
                  </td>
                </tr>
                {showReviewDetails ? (
                  <tr className="import-preview-row-detail">
                    <td colSpan={11}>
                      <div className="duplicate-row-detail-panel">
                        <div className="duplicate-row-badges">
                          {duplicateMatch ? (
                            <span className={`pill duplicate-row-pill ${duplicateMatch.matchKind === "near" ? "warning" : ""}`}>
                              {formatDuplicateMatchKind(duplicateMatch.matchKind)}
                            </span>
                          ) : null}
                          {row.commitStatus === "needs_review" ? (
                            <span className="pill warning duplicate-row-pill">{importMessages.needsReview}</span>
                          ) : null}
                        </div>
                        <div className="duplicate-row-copy">
                          {duplicateMatch ? (
                            <div className="duplicate-row-detail-line">
                              <small className="duplicate-row-detail">
                                {importMessages.duplicateRowDetail(formatDuplicateMatch(duplicateMatch))}
                              </small>
                              <DuplicateMatchPopover row={row} match={duplicateMatch} statementImportSourceType={statementImportSourceType} />
                            </div>
                          ) : null}
                          {row.commitStatusReason ? (
                            <small className="duplicate-row-detail muted">{row.commitStatusReason}</small>
                          ) : null}
                        </div>
                      </div>
                    </td>
                  </tr>
                ) : null}
              </Fragment>
            );
          })}
        </tbody>
      </table>
      <Dialog.Root open={Boolean(restoreTarget)} onOpenChange={(open) => { if (!open) setRestoreTarget(null); }}>
        <Dialog.Portal>
          <Dialog.Overlay className="note-dialog-overlay" />
          <Dialog.Content className="note-dialog-content settings-account-dialog">
            <div className="note-dialog-head">
              <div>
                <Dialog.Title>{importMessages.restorePreviewRow}</Dialog.Title>
                <Dialog.Description>{importMessages.restoreExactCoveredRowConfirm}</Dialog.Description>
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
    </div>
  );
}

function formatDuplicateMatch(match) {
  return messages.common.triplet(
    formatImportPreviewDate(match.date),
    match.accountName ?? messages.common.emptyValue,
    formatService.formatMinorInput(match.amountMinor)
  );
}

function formatImportPreviewDate(value) {
  const [year, month, day] = String(value ?? "").split("-");
  if (year && month && day) {
    return `${day}/${month}/${year}`;
  }
  return formatService.formatDateOnly(value);
}

export function DuplicateMatchPopover({ row, match, statementImportSourceType = "csv" }) {
  const ledgerHref = match.existingTransactionId ? buildDuplicateLedgerEntryHref(match) : "";
  const incomingCertificationLabel = getIncomingBankCertificationLabel(statementImportSourceType);
  const ledgerCertificationLabel = getExistingBankCertificationLabel(match);
  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <button type="button" className="duplicate-row-link">
          {importMessages.viewLedgerMatch}
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content className="duplicate-match-popover" sideOffset={8} align="center">
          <div className="duplicate-match-head">
            <strong>{importMessages.duplicateMatchPopoverTitle}</strong>
            <span>{importMessages.duplicateMatchPopoverDetail}</span>
          </div>
          <div className="duplicate-match-flow">
            <DuplicateMatchCard
              label={importMessages.duplicateMatchIncomingLabel}
              date={row.date}
              eventDate={getIncomingEventDate(row)}
              postedDate={row.date}
              description={row.description}
              comparisonDescription={match.description}
              accountName={row.accountName}
              amountMinor={row.amountMinor}
              bankCertificationLabel={incomingCertificationLabel}
            />
            <span className="duplicate-match-arrow" aria-hidden="true">{"->"}</span>
            <DuplicateMatchCard
              label={importMessages.duplicateMatchLedgerLabel}
              date={match.date}
              eventDate={match.date}
              postedDate={match.postedDate}
              description={match.description}
              comparisonDescription={row.description}
              accountName={match.accountName}
              amountMinor={match.amountMinor}
              bankCertificationLabel={ledgerCertificationLabel}
            />
          </div>
          {ledgerHref ? (
            <a className="duplicate-match-open-link" href={ledgerHref} target="_blank" rel="noreferrer">
              {importMessages.openLedgerEntry}
            </a>
          ) : null}
          <Popover.Arrow className="category-popover-arrow" />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

function DuplicateMatchCard({ label, date, eventDate, postedDate, description, comparisonDescription, accountName, amountMinor, bankCertificationLabel }) {
  return (
    <div className="duplicate-match-card">
      <span>{label}</span>
      <strong>{renderHighlightedDescription(description, comparisonDescription)}</strong>
      <p>{messages.common.triplet(date, accountName ?? messages.common.emptyValue, formatService.formatMinorInput(amountMinor))}</p>
      <dl className="duplicate-match-dates">
        <div>
          <dt>{importMessages.duplicateMatchTransactionDate}</dt>
          <dd>{formatOptionalMatchDate(eventDate)}</dd>
        </div>
        <div>
          <dt>{importMessages.duplicateMatchPostedDate}</dt>
          <dd>{formatOptionalMatchDate(postedDate)}</dd>
        </div>
      </dl>
      <small>{importMessages.bankCertificationStatusLine(bankCertificationLabel)}</small>
    </div>
  );
}

function getIncomingEventDate(row) {
  return normalizeMatchDate(
    row.rawRow?.transactionDate
      ?? row.rawRow?.["transaction date"]
      ?? extractTransactionDateHint(row.note)
      ?? extractTransactionDateHint(row.rawRow?.note)
      ?? extractTransactionDateHint(row.rawRow?.notes)
      ?? extractTransactionDateHint(row.rawRow?.remarks)
  );
}

function extractTransactionDateHint(value) {
  if (typeof value !== "string") {
    return undefined;
  }

  const match = value.match(/\b(?:txn|transaction)\s+date\s*:\s*([0-9]{4}-[0-9]{2}-[0-9]{2})\b/i);
  return match?.[1];
}

function normalizeMatchDate(value) {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }

  return trimmed;
}

function formatOptionalMatchDate(value) {
  const normalized = normalizeMatchDate(value);
  return normalized ? formatImportPreviewDate(normalized) : importMessages.duplicateMatchDateUnavailable;
}

function getIncomingBankCertificationLabel(sourceType) {
  if (sourceType === "pdf") {
    return importMessages.bankCertificationStatusIncomingStatement;
  }

  if (sourceType === "manual") {
    return "Manual provisional";
  }

  return "Import provisional";
}

function getExistingBankCertificationLabel(match) {
  if (match.existingBankCertificationStatus === "statement_certified") {
    return "Statement certified";
  }

  return match.existingSourceType === "manual" ? "Manual provisional" : "Import provisional";
}

function buildDuplicateLedgerEntryHref(match) {
  const params = new URLSearchParams({
    view: "household",
    month: match.date.slice(0, 7),
    editing_entry: match.existingTransactionId
  });
  if (match.existingAccountId) {
    params.set("entry_wallet", match.existingAccountId);
  } else if (match.accountName) {
    params.set("entry_wallet", match.accountName);
  }
  return `/entries?${params.toString()}`;
}

function canPromoteExistingRowMatch(row, match) {
  return Boolean(
    row.commitStatus === "needs_review"
    && match?.existingTransactionId
    && match?.existingSourceType === "manual"
    && match?.existingBankCertificationStatus === "provisional"
    && (row.reconciliationMatchCount ?? row.reconciliationMatches?.length ?? 0) === 1
  );
}

function isAutoMatchedExistingRowMatch(row, match) {
  return Boolean(
    row.commitStatus === "included"
    && row.reconciliationTargetTransactionId
    && match?.existingTransactionId === row.reconciliationTargetTransactionId
    && match?.existingSourceType === "manual"
    && match?.existingBankCertificationStatus === "provisional"
    && (row.reconciliationMatchCount ?? row.reconciliationMatches?.length ?? 0) === 1
  );
}

function renderHighlightedDescription(description, otherDescription) {
  const text = description || messages.common.emptyValue;
  const otherTokenSet = buildNormalizedHighlightTokenSet(otherDescription ?? "");
  if (!otherTokenSet.size) {
    return text;
  }

  const parts = text.split(/([A-Za-z0-9]+)/g);
  return parts.map((part, index) => {
    if (!part) {
      return null;
    }

    const normalizedTokens = normalizeTextForHighlight(part);
    const isShared = normalizedTokens.some((token) => otherTokenSet.has(token));
    return isShared
      ? <mark key={`${part}-${index}`} className="duplicate-match-highlight">{part}</mark>
      : <Fragment key={`${part}-${index}`}>{part}</Fragment>;
  });
}

function buildNormalizedHighlightTokenSet(value) {
  return new Set(normalizeTextForHighlight(value));
}

function normalizeTextForHighlight(value) {
  return value
    .toLowerCase()
    .replace(/\bcs\s+fresh\b/g, "cold storage")
    .replace(/\bcoldstorage\b/g, "cold storage")
    .replace(/\bcs\b/g, "cold storage")
    .replace(/\b(singapore|sg|applepay|apple\s+pay)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

function formatDuplicateMatchKind(matchKind) {
  if (matchKind === "exact") {
    return importMessages.duplicateMatchKindExact;
  }

  if (matchKind === "probable") {
    return importMessages.duplicateMatchKindProbable;
  }

  return importMessages.duplicateMatchKindNear;
}

