import { Fragment, useEffect, useRef, useState } from "react";
import { ResponsiveSelect } from "./responsive-select";
import { categoryPickOptions } from "./category-pick-options";
import { messages } from "./copy/en-SG";
import { importMessages } from "./copy/en-SG-imports";
import { EmptyState } from "./ui-states";
import { selectAllOnFocus } from "./focus-utils";
import { moniesClient } from "./monies-client-service";
import { useMoneyPrivacy } from "./money-privacy";
import { moneyToneClass } from "./money-tone-class";
import { entryAmountTone } from "../domain/money-tone";
import { isInferredAmountRow, useInferredAmountKeys } from "./import-inferred-amounts";
import { PreviewRowList } from "./import-preview-row-list";
import {
  buildAccountChange,
  canPromoteExistingRowMatch,
  DuplicateMatchPopover,
  formatDuplicateMatch,
  formatDuplicateMatchKind,
  isAutoMatchedExistingRowMatch,
  RestoreRowDialog
} from "./import-preview-row-helpers";

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
  getPreviewAccountOwnerPatch,
  isPhoneLayout = false
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
        <RowsView
          isPhoneLayout={isPhoneLayout}
          categories={categories}
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
          <RowsView
            isPhoneLayout={isPhoneLayout}
            categories={categories}
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

// A phone gets flat rows that open a row sheet (import-preview-row-list.jsx);
// every other width keeps the editable table. Both edit the same rows
// through the same handlers.
/** @param {any} props */
function RowsView(props) {
  const { isPhoneLayout, categories, ...tableProps } = props;
  if (isPhoneLayout) {
    return <PreviewRowList categories={categories} {...tableProps} />;
  }
  return <PreviewRowsTable {...tableProps} />;
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
  // "No category yet" stays pinned above the searchable list.
  const noCategory = { value: "", label: messages.entries.allCategories };
  const categoryChoices = [noCategory, ...categoryPickOptions(categorySelectOptions)];
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
                        onUpdatePreviewRowAccount(row.rowId, buildAccountChange({ row, nextValue: event.target.value, accounts, getPreviewAccountOwnerPatch }));
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
                    <ResponsiveSelect
                      className="table-edit-input"
                      title={messages.entries.category}
                      value={row.categoryName ?? ""}
                      options={categoryChoices}
                      categoryPick={{ description: row.description, pinned: [noCategory] }}
                      onValueChange={(categoryName) => onUpdatePreviewRow(row.rowId, { categoryName: categoryName || undefined })}
                      disabled={isSkippedTable}
                    />
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
      <RestoreRowDialog
        target={restoreTarget}
        onClose={() => setRestoreTarget(null)}
        onConfirm={(row) => onUpdatePreviewRowCommitStatus(row.rowId, "included")}
      />
    </div>
  );
}
