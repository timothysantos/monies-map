import { CalendarDays, ChevronRight } from "lucide-react";
import { categoryPickOptions } from "./category-pick-options";
import { useState } from "react";

import { entryAmountTone } from "../domain/money-tone";
import { messages } from "./copy/en-SG";
import { importMessages } from "./copy/en-SG-imports";
import { GrowingTextarea, PickerRow } from "./detail-field-rows";
import { EntryMobileSheet } from "./entry-mobile-sheet";
import { selectAllOnFocus } from "./focus-utils";
import { isInferredAmountRow, useInferredAmountKeys } from "./import-inferred-amounts";
import {
  buildAccountChange,
  canPromoteExistingRowMatch,
  DuplicateMatchPopover,
  formatDuplicateMatch,
  formatDuplicateMatchKind,
  isAutoMatchedExistingRowMatch,
  RestoreRowDialog
} from "./import-preview-row-helpers";
import { moniesClient } from "./monies-client-service";
import { moneyToneClass } from "./money-tone-class";
import { FALLBACK_THEME } from "./ui-options";
import { BottomActions, DetailRow, DetailRows, LeadCard, MetaChip } from "./ui-components";
import { ChipDateField } from "./ui/lead-support-detail";
import "./import-preview-row-list.css";

const { format: formatService } = moniesClient;

// Preview rows on a phone (design.md, "Imports"): the table's eleven fields do
// not fit, so each row is one flat 56 px line (description, date and category,
// the amount in its money tone) and a tap opens the row sheet, which edits the
// same row through the same handlers the table uses. Lists stay flat; only the
// sheet is Lead · Support · Detail.
export function PreviewRowList({
  rows,
  categories,
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
  areTotalsVisible = true,
  isSkippedTable = false
}) {
  const [openRowId, setOpenRowId] = useState(null);
  const [restoreTarget, setRestoreTarget] = useState(null);
  const openRow = rows.find((row) => row.rowId === openRowId) ?? null;

  return (
    <div className="import-row-list-wrap">
      {isSkippedTable ? null : <p className="import-row-list-hint">{importMessages.previewRowsTapHint}</p>}
      <ul className="import-row-list" aria-label={importMessages.previewRows}>
        {rows.map((row) => {
          const signedMinor = getSignedMinor(row);
          const duplicateMatch = row.reconciliationMatches?.[0] ?? row.reconciliationMatch;
          const needsReview = row.commitStatus === "needs_review";
          return (
            <li key={row.rowId}>
              <button
                type="button"
                className={`import-row-item${needsReview || duplicateMatch ? " is-flagged" : ""}`}
                data-commit-status={row.commitStatus}
                aria-haspopup="dialog"
                onClick={() => setOpenRowId(row.rowId)}
              >
                <span className="import-row-main">
                  <strong>{row.description || messages.common.emptyValue}</strong>
                  <small>{describeRowLine(row)}</small>
                </span>
                <span className={`import-row-amount ${moneyToneClass(entryAmountTone(row.entryType, signedMinor))}`}>
                  {formatService.money(signedMinor)}
                  <ChevronRight size={16} aria-hidden="true" />
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      {openRow ? (
        <PreviewRowSheet
          row={openRow}
          categories={categories}
          accounts={accounts}
          accountOptions={accountOptions}
          categorySelectOptions={categorySelectOptions}
          people={people}
          knownAccountNames={knownAccountNames}
          statementImportSourceType={statementImportSourceType}
          isSkipped={isSkippedTable}
          areTotalsVisible={areTotalsVisible}
          onUpdatePreviewRow={onUpdatePreviewRow}
          onUpdatePreviewRowAccount={onUpdatePreviewRowAccount}
          onUpdatePreviewRowCommitStatus={onUpdatePreviewRowCommitStatus}
          onPromotePreviewRowReconciliationTarget={onPromotePreviewRowReconciliationTarget}
          getPreviewAccountOwnerPatch={getPreviewAccountOwnerPatch}
          onRequestRestore={setRestoreTarget}
          onClose={() => setOpenRowId(null)}
        />
      ) : null}
      <RestoreRowDialog
        target={restoreTarget}
        onClose={() => setRestoreTarget(null)}
        onConfirm={(row) => {
          onUpdatePreviewRowCommitStatus(row.rowId, "included");
          setOpenRowId(null);
        }}
      />
    </div>
  );
}

function getSignedMinor(row) {
  return row.entryType === "expense" || row.transferDirection === "out" ? -row.amountMinor : row.amountMinor;
}

function describeRowLine(row) {
  const parts = [
    formatService.formatDateOnly(row.date),
    row.categoryName || null,
    row.entryType && row.entryType !== "expense" ? row.entryType.charAt(0).toUpperCase() + row.entryType.slice(1) : null
  ].filter(Boolean);
  return parts.join(" · ");
}

// The sign before the lead amount, as the Entries edit card shows it.
const ENTRY_SIGNS = { expense: "\u2212", income: "+" };

const ENTRY_TYPE_OPTIONS = [
  { value: "expense", label: "Expense" },
  { value: "income", label: "Income" },
  { value: "transfer", label: "Transfer" }
];

// One row, edited: the Lead (what it is, its amount), the Support chips
// (type, date, whose it is, what needs a look) and the Detail rows for the
// rest. Every change applies at once, as in the table; Done only closes.
function PreviewRowSheet({
  row,
  categories,
  accounts,
  accountOptions,
  categorySelectOptions,
  people,
  knownAccountNames,
  statementImportSourceType,
  isSkipped,
  areTotalsVisible,
  onUpdatePreviewRow,
  onUpdatePreviewRowAccount,
  onUpdatePreviewRowCommitStatus,
  onPromotePreviewRowReconciliationTarget,
  getPreviewAccountOwnerPatch,
  onRequestRestore,
  onClose
}) {
  const inferredAmountKeys = useInferredAmountKeys();
  // "No category yet" stays pinned above the searchable list.
  const noCategory = { value: "", label: messages.entries.allCategories };
  const category = categories.find((item) => item.name === row.categoryName);
  const theme = { ...FALLBACK_THEME, ...(category ? { colorHex: category.colorHex, iconKey: category.iconKey } : {}) };
  const duplicateMatch = row.reconciliationMatches?.[0] ?? row.reconciliationMatch;
  const canPromoteExistingRow = canPromoteExistingRowMatch(row, duplicateMatch);
  const isAutoMatchedExistingRow = isAutoMatchedExistingRowMatch(row, duplicateMatch);
  const showReviewDetails = Boolean(duplicateMatch || row.commitStatus === "needs_review" || row.commitStatusReason);
  const signedMinor = getSignedMinor(row);
  const typeLabel = ENTRY_TYPE_OPTIONS.find((option) => option.value === row.entryType)?.label ?? row.entryType;
  const accountValue = row.accountId ?? row.accountName ?? "";
  const accountLabel = accountOptions.find((account) => account.value === accountValue)?.label ?? row.accountName;
  const ownerLabel = row.ownerName ?? "";

  function restore() {
    if (duplicateMatch?.matchKind === "exact") {
      onRequestRestore(row);
      return;
    }
    onUpdatePreviewRowCommitStatus(row.rowId, "included");
    onClose();
  }

  return (
    <EntryMobileSheet
      className="import-row-sheet"
      title={importMessages.editRowTitle}
      description={row.description || messages.common.emptyValue}
      saveLabel={importMessages.editRowDone}
      // Every change applies to the preview at once, as in the table, so there
      // is no draft to lose: a swipe down simply closes the sheet.
      isDirty={false}
      onClose={onClose}
      onSave={onClose}
      footerContent={(
        <BottomActions
          className="is-sheet-bar"
          destructive={isAutoMatchedExistingRow ? null : isSkipped ? (
            <button type="button" className="lsd-quiet" onClick={restore}>{importMessages.restorePreviewRow}</button>
          ) : (
            <button
              type="button"
              className="lsd-quiet is-danger"
              onClick={() => {
                onUpdatePreviewRowCommitStatus(row.rowId, "skipped");
                onClose();
              }}
            >
              {importMessages.skipPreviewRow}
            </button>
          )}
          primaryLabel={importMessages.editRowDone}
          onPrimary={onClose}
        />
      )}
    >
      <div className="import-row-sheet-body">
        <LeadCard
          className="import-row-lead"
          category={{ colorHex: theme.colorHex, iconKey: theme.iconKey }}
          title={(
            <GrowingTextarea
              className="lsd-title lsd-title-input"
              aria-label={importMessages.table.description}
              value={row.description ?? ""}
              readOnly={isSkipped}
              singleLine
              onChange={(description) => onUpdatePreviewRow(row.rowId, { description })}
            />
          )}
          subtitle={row.categoryName}
          amount={(
            <>
              {areTotalsVisible && ENTRY_SIGNS[row.entryType] ? <span className="import-row-sign" aria-hidden="true">{ENTRY_SIGNS[row.entryType]}</span> : null}
              <input
              className={`import-amount-input${areTotalsVisible ? "" : " is-screened"}`}
              aria-label={importMessages.table.amount}
              inputMode="decimal"
              value={formatService.formatMinorInput(row.amountMinor)}
              disabled={isSkipped}
              onMouseDown={selectAllOnFocus}
              onFocus={selectAllOnFocus}
              onChange={(event) => onUpdatePreviewRow(row.rowId, {
                amountMinor: formatService.parseMoneyInput(event.target.value, row.amountMinor)
              })}
              />
            </>
          )}
          tone={entryAmountTone(row.entryType, signedMinor)}
          editable={!isSkipped}
          chips={[
            <MetaChip key="type">{typeLabel}</MetaChip>,
            <MetaChip
              key="date"
              icon={CalendarDays}
              control={isSkipped ? null : (
                <ChipDateField
                  value={row.date}
                  label={messages.common.changeChip(importMessages.table.date, formatService.formatDateOnly(row.date))}
                  onValueChange={(date) => onUpdatePreviewRow(row.rowId, { date })}
                />
              )}
            >
              {formatService.formatDateOnly(row.date)}
            </MetaChip>,
            ownerLabel ? <MetaChip key="owner" person={ownerLabel}>{ownerLabel}</MetaChip> : null,
            row.commitStatus === "needs_review" ? <MetaChip key="review" tone="butter">{importMessages.needsReview}</MetaChip> : null,
            isInferredAmountRow(row, inferredAmountKeys) ? <MetaChip key="inferred" tone="sky">{importMessages.statementInferredAmount}</MetaChip> : null
          ].filter(Boolean).slice(0, 4)}
        />

        {showReviewDetails ? (
          <div className="import-row-review">
            <div className="duplicate-row-badges">
              {duplicateMatch ? (
                <span className={`pill duplicate-row-pill ${duplicateMatch.matchKind === "near" ? "warning" : ""}`}>
                  {formatDuplicateMatchKind(duplicateMatch.matchKind)}
                </span>
              ) : null}
              {isAutoMatchedExistingRow ? <span className="pill success">{importMessages.matchedExistingPreviewRow}</span> : null}
            </div>
            {duplicateMatch ? (
              <div className="duplicate-row-detail-line">
                <small className="duplicate-row-detail">{importMessages.duplicateRowDetail(formatDuplicateMatch(duplicateMatch))}</small>
                <DuplicateMatchPopover row={row} match={duplicateMatch} statementImportSourceType={statementImportSourceType} />
              </div>
            ) : null}
            {row.commitStatusReason ? <small className="duplicate-row-detail muted">{row.commitStatusReason}</small> : null}
            {row.commitStatus === "needs_review" ? (
              <div className="import-row-review-actions">
                {canPromoteExistingRow ? (
                  <button
                    type="button"
                    className="subtle-action"
                    onClick={() => onPromotePreviewRowReconciliationTarget(row.rowId, duplicateMatch.existingTransactionId)}
                  >
                    {importMessages.promoteExistingPreviewRow}
                  </button>
                ) : null}
                <button type="button" className="subtle-action" onClick={() => onUpdatePreviewRowCommitStatus(row.rowId, "included")}>
                  {canPromoteExistingRow ? importMessages.importAsNewPreviewRow : importMessages.importPreviewRow}
                </button>
              </div>
            ) : null}
          </div>
        ) : null}

        <DetailRows label={importMessages.editRowTitle}>
          <DetailRow label={importMessages.rowFieldType} value={typeLabel}>
            <select
              className="lsd-row-native"
              aria-label={importMessages.rowFieldType}
              value={row.entryType}
              disabled={isSkipped}
              onChange={(event) => onUpdatePreviewRow(row.rowId, { entryType: event.target.value })}
            >
              {ENTRY_TYPE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </DetailRow>
          <PickerRow
            isSheet
            rowKey="category"
            label={importMessages.rowFieldCategory}
            valueLabel={row.categoryName || importMessages.rowFieldChooseCategory}
            value={row.categoryName ?? ""}
            options={[noCategory, ...categoryPickOptions(categorySelectOptions)]}
            categoryPick={{ description: row.description, pinned: [noCategory] }}
            onValueChange={(categoryName) => onUpdatePreviewRow(row.rowId, { categoryName: categoryName || undefined })}
            disabled={isSkipped}
          />
          <DetailRow label={importMessages.rowFieldAccount} value={accountLabel} emptyLabel={importMessages.chooseAccount}>
            <select
              className="lsd-row-native"
              aria-label={importMessages.rowFieldAccount}
              value={accountValue}
              disabled={isSkipped}
              onChange={(event) => onUpdatePreviewRowAccount(row.rowId, buildAccountChange({ row, nextValue: event.target.value, accounts, getPreviewAccountOwnerPatch }))}
            >
              <option value="">{messages.entries.allWallets}</option>
              {row.accountName && !row.accountId && !knownAccountNames.has(row.accountName) ? (
                <option value={row.accountName}>{row.accountName}</option>
              ) : null}
              {accountOptions.map((account) => <option key={account.id} value={account.value}>{account.label}</option>)}
            </select>
          </DetailRow>
          <DetailRow label={importMessages.rowFieldOwner} value={ownerLabel}>
            <select
              className="lsd-row-native"
              aria-label={importMessages.rowFieldOwner}
              value={row.ownerName ?? ""}
              disabled={isSkipped}
              onChange={(event) => onUpdatePreviewRow(row.rowId, { ownershipType: "direct", ownerName: event.target.value, splitBasisPoints: 10000 })}
            >
              {people.map((person) => <option key={person.id} value={person.name}>{person.name}</option>)}
            </select>
          </DetailRow>
          <DetailRow label={importMessages.rowFieldNote}>
            <GrowingTextarea
              className=""
              aria-label={importMessages.rowFieldNote}
              placeholder={importMessages.rowFieldNoteEmpty}
              value={row.note ?? ""}
              readOnly={isSkipped}
              singleLine
              onChange={(note) => onUpdatePreviewRow(row.rowId, { note })}
            />
          </DetailRow>
        </DetailRows>
      </div>
    </EntryMobileSheet>
  );
}
