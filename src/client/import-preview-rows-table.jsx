import { Fragment } from "react";
import * as Popover from "@radix-ui/react-popover";
import { getAccountSelectOptions } from "./account-display";
import { getCategoriesForSelect } from "./category-utils";
import { messages } from "./copy/en-SG";
import { getAmountToneClass } from "./entry-helpers";
import { formatDateOnly, formatMinorInput, parseMoneyInput } from "./formatters";

// Preview rows are edited here, while ImportsPanel owns the canonical payload and commit callback.
export function ImportPreviewRowsTable({
  previewRows,
  accounts,
  categories,
  people,
  knownAccountNames,
  statementCheckpointCount = 0,
  statementCertificationRowCount = 0,
  hasAlreadyCoveredCheckpointRefresh = false,
  hasEmptyStatementCheckpointOnly = false,
  isCommitDisabled,
  isSubmitting,
  commitLabel,
  onCommit,
  onUpdatePreviewRow,
  onUpdatePreviewRowCommitStatus,
  getPreviewAccountOwnerPatch
}) {
  const accountOptions = getAccountSelectOptions(accounts, { valueKey: "id" });
  const categorySelectOptions = getCategoriesForSelect(categories);
  const visibleRows = previewRows.filter((row) => !row.isStatementMatchResolved);
  const activeRows = visibleRows.filter((row) => row.commitStatus !== "skipped");
  const skippedRows = visibleRows.filter((row) => row.commitStatus === "skipped");
  const includedCount = visibleRows.filter((row) => row.commitStatus === "included" || !row.commitStatus).length;
  const newImportCount = includedCount - statementCertificationRowCount;
  const needsReviewCount = visibleRows.filter((row) => row.commitStatus === "needs_review").length;
  const hasPreviewRows = visibleRows.length > 0 || statementCheckpointCount > 0;

  return (
    <>
      <div className="import-summary-strip import-preview-status-row" aria-label={messages.imports.previewCommitSummaryLabel}>
        {newImportCount || !statementCheckpointCount ? (
          <span className="import-summary-item is-success">{messages.imports.willImportRows(newImportCount)}</span>
        ) : null}
        {statementCertificationRowCount ? (
          <span className="import-summary-item is-success">{messages.imports.willCertifyRows(statementCertificationRowCount)}</span>
        ) : null}
        {statementCheckpointCount ? (
          <span className="import-summary-item is-success">{messages.imports.willSaveStatementCheckpoints(statementCheckpointCount)}</span>
        ) : null}
        {skippedRows.length ? <span className="import-summary-item">{messages.imports.willSkipRows(skippedRows.length)}</span> : null}
        {needsReviewCount ? <span className="import-summary-item is-warning">{messages.imports.needsReviewRows(needsReviewCount)}</span> : null}
      </div>
      <ImportCommitButton disabled={isCommitDisabled} isSubmitting={isSubmitting} onCommit={onCommit} label={commitLabel} />
      {activeRows.length ? (
        <PreviewRowsTable
          rows={activeRows}
          accounts={accounts}
          accountOptions={accountOptions}
          categorySelectOptions={categorySelectOptions}
          people={people}
          knownAccountNames={knownAccountNames}
          onUpdatePreviewRow={onUpdatePreviewRow}
          onUpdatePreviewRowCommitStatus={onUpdatePreviewRowCommitStatus}
          getPreviewAccountOwnerPatch={getPreviewAccountOwnerPatch}
        />
      ) : (
        <p className="lede compact">
          {hasAlreadyCoveredCheckpointRefresh
            ? messages.imports.noRowsToImportCoveredStatement
            : hasEmptyStatementCheckpointOnly
              ? messages.imports.noRowsToImportEmptyStatement
              : messages.imports.noRowsToImport}
        </p>
      )}
      {skippedRows.length ? (
        <details className="import-skipped-rows">
          <summary>{messages.imports.skippedRowsTitle(skippedRows.length)}</summary>
          <PreviewRowsTable
            rows={skippedRows}
            accounts={accounts}
            accountOptions={accountOptions}
            categorySelectOptions={categorySelectOptions}
            people={people}
            knownAccountNames={knownAccountNames}
            onUpdatePreviewRow={onUpdatePreviewRow}
            onUpdatePreviewRowCommitStatus={onUpdatePreviewRowCommitStatus}
            getPreviewAccountOwnerPatch={getPreviewAccountOwnerPatch}
            isSkippedTable
          />
        </details>
      ) : null}
      {hasPreviewRows ? (
        <ImportCommitButton disabled={isCommitDisabled} isSubmitting={isSubmitting} onCommit={onCommit} label={commitLabel} isBottom />
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
  onUpdatePreviewRow,
  onUpdatePreviewRowCommitStatus,
  getPreviewAccountOwnerPatch,
  isSkippedTable = false
}) {
  return (
    <div className="table-wrap import-table-wrap">
      <table className="summary-table import-preview-table">
        <thead>
          <tr>
            <th>{messages.imports.table.row}</th>
            <th>{messages.imports.table.actions}</th>
            <th>{messages.imports.table.date}</th>
            <th>{messages.imports.table.description}</th>
            <th>{messages.imports.table.amount}</th>
            <th>{messages.imports.table.type}</th>
            <th>{messages.imports.table.account}</th>
            <th>{messages.imports.table.category}</th>
            <th>{messages.imports.table.owner}</th>
            <th>{messages.imports.table.split}</th>
            <th>{messages.imports.table.note}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const duplicateMatch = row.duplicateMatches?.[0] ?? row.comparisonMatch;
            const showReviewDetails = Boolean(duplicateMatch || row.commitStatus === "needs_review" || row.commitStatusReason);
            return (
              <Fragment key={row.rowId}>
                <tr className={duplicateMatch ? "import-preview-row-duplicate" : ""}>
                  <td>{row.rowIndex}</td>
                  <td>
                    <div className="import-row-actions">
                      {row.commitStatus === "needs_review" ? (
                        <button type="button" className="subtle-action" onClick={() => onUpdatePreviewRowCommitStatus(row.rowId, "included")}>
                          {messages.imports.importPreviewRow}
                        </button>
                      ) : null}
                      {isSkippedTable ? (
                        <button
                          type="button"
                          className="subtle-action"
                          onClick={() => {
                            if (
                              duplicateMatch?.matchKind === "exact"
                              && !window.confirm(messages.imports.restoreExactCoveredRowConfirm)
                            ) {
                              return;
                            }
                            onUpdatePreviewRowCommitStatus(row.rowId, "included");
                          }}
                        >
                          {messages.imports.restorePreviewRow}
                        </button>
                      ) : (
                        <button type="button" className="subtle-action" onClick={() => onUpdatePreviewRowCommitStatus(row.rowId, "skipped")}>
                          {messages.imports.skipPreviewRow}
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
                  <td className={getAmountToneClass(row.entryType === "expense" || row.transferDirection === "out" ? -row.amountMinor : row.amountMinor)}>
                    <input
                      className="table-edit-input import-amount-input"
                      value={formatMinorInput(row.amountMinor)}
                      onChange={(event) => onUpdatePreviewRow(row.rowId, { amountMinor: parseMoneyInput(event.target.value, row.amountMinor) })}
                      disabled={isSkippedTable}
                    />
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
                        onUpdatePreviewRow(row.rowId, {
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
                      value={row.ownershipType === "shared" ? "Shared" : (row.ownerName ?? "")}
                      onChange={(event) => {
                        const nextOwner = event.target.value;
                        if (nextOwner === "Shared") {
                          onUpdatePreviewRow(row.rowId, { ownershipType: "shared", ownerName: undefined, splitBasisPoints: 5000 });
                          return;
                        }
                        onUpdatePreviewRow(row.rowId, { ownershipType: "direct", ownerName: nextOwner, splitBasisPoints: 10000 });
                      }}
                      disabled={isSkippedTable}
                    >
                      {people.map((person) => (
                        <option key={person.id} value={person.name}>{person.name}</option>
                      ))}
                      <option value="Shared">{messages.entries.shared}</option>
                    </select>
                  </td>
                  <td>
                    {row.ownershipType === "shared" ? (
                      <input
                        className="table-edit-input import-split-input"
                        type="number"
                        min="0"
                        max="100"
                        value={Math.round((row.splitBasisPoints ?? 5000) / 100)}
                        onChange={(event) => onUpdatePreviewRow(row.rowId, { splitBasisPoints: Math.round(Number(event.target.value || "50") * 100) })}
                        disabled={isSkippedTable}
                      />
                    ) : (
                      messages.common.emptyValue
                    )}
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
                            <span className="pill warning duplicate-row-pill">{messages.imports.needsReview}</span>
                          ) : null}
                        </div>
                        <div className="duplicate-row-copy">
                          {duplicateMatch ? (
                            <div className="duplicate-row-detail-line">
                              <small className="duplicate-row-detail">
                                {messages.imports.duplicateRowDetail(formatDuplicateMatch(duplicateMatch))}
                              </small>
                              <DuplicateMatchPopover row={row} match={duplicateMatch} />
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
    </div>
  );
}

function formatDuplicateMatch(match) {
  return messages.common.triplet(formatImportPreviewDate(match.date), match.accountName ?? messages.common.emptyValue, formatMinorInput(match.amountMinor));
}

function formatImportPreviewDate(value) {
  const [year, month, day] = String(value ?? "").split("-");
  if (year && month && day) {
    return `${day}/${month}/${year}`;
  }
  return formatDateOnly(value);
}

function DuplicateMatchPopover({ row, match }) {
  const ledgerHref = match.existingTransactionId ? buildDuplicateLedgerEntryHref(match) : "";
  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <button type="button" className="duplicate-row-link">
          {messages.imports.viewLedgerMatch}
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content className="duplicate-match-popover" sideOffset={8} align="center">
          <div className="duplicate-match-head">
            <strong>{messages.imports.duplicateMatchPopoverTitle}</strong>
            <span>{messages.imports.duplicateMatchPopoverDetail}</span>
          </div>
          <div className="duplicate-match-flow">
            <DuplicateMatchCard
              label={messages.imports.duplicateMatchIncomingLabel}
              date={row.date}
              description={row.description}
              accountName={row.accountName}
              amountMinor={row.amountMinor}
            />
            <span className="duplicate-match-arrow" aria-hidden="true">{"->"}</span>
            <DuplicateMatchCard
              label={messages.imports.duplicateMatchLedgerLabel}
              date={match.date}
              description={match.description}
              accountName={match.accountName}
              amountMinor={match.amountMinor}
            />
          </div>
          {ledgerHref ? (
            <a className="duplicate-match-open-link" href={ledgerHref} target="_blank" rel="noreferrer">
              {messages.imports.openLedgerEntry}
            </a>
          ) : null}
          <Popover.Arrow className="category-popover-arrow" />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

function DuplicateMatchCard({ label, date, description, accountName, amountMinor }) {
  return (
    <div className="duplicate-match-card">
      <span>{label}</span>
      <strong>{description || messages.common.emptyValue}</strong>
      <p>{messages.common.triplet(date, accountName ?? messages.common.emptyValue, formatMinorInput(amountMinor))}</p>
    </div>
  );
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

function formatDuplicateMatchKind(matchKind) {
  if (matchKind === "exact") {
    return messages.imports.duplicateMatchKindExact;
  }

  if (matchKind === "probable") {
    return messages.imports.duplicateMatchKindProbable;
  }

  return messages.imports.duplicateMatchKindNear;
}

function ImportCommitButton({ disabled, isSubmitting, onCommit, label, isBottom = false }) {
  return (
    <div className={`import-actions import-actions-end ${isBottom ? "import-actions-bottom" : ""}`}>
      <button
        type="button"
        className="import-commit-button"
        disabled={disabled}
        onClick={onCommit}
      >
        {isSubmitting ? messages.common.working : label}
      </button>
    </div>
  );
}
