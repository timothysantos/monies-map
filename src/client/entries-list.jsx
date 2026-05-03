import { useEffect, useMemo, useRef, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { Check, X } from "lucide-react";

import { CategoryAppearancePopover } from "./category-visuals";
import { messages } from "./copy/en-SG";
import { EntryEditorFields, EntryTransferTools } from "./entry-editor";
import { moniesClient } from "./monies-client-service";

const {
  categories: categoryService,
  entries: entryService,
  format: formatService
} = moniesClient;

const NON_GROUP_SPLIT_VALUE = "__split_group_none__";

function scrollInlineEditorIntoView(element) {
  if (window.matchMedia("(max-width: 760px)").matches) {
    element.scrollIntoView({ block: "start", behavior: "smooth" });
    return;
  }

  const rect = element.getBoundingClientRect();
  const targetTop = window.scrollY + rect.top - ((window.innerHeight - rect.height) / 2) - 48;
  window.scrollTo({ top: Math.max(0, targetTop), behavior: "smooth" });
}

// This renderer is intentionally "dumb": it receives already-grouped entries
// and mostly maps them into row UI.
export function EntriesDateGroups({
  groupedEntries,
  allEntries,
  categories,
  categoryOptions,
  accountOptions,
  ownerOptions,
  splitGroups = [],
  viewId,
  editingEntryId,
  addingToSplitsEntryId,
  savingEntryId,
  deletingEntryId,
  createdSplitAction = null,
  deletingCreatedSplitId = "",
  transferDialogEntryId,
  transferSettlementDrafts,
  linkingTransferEntryId,
  settlingTransferEntryId,
  refreshingTransferCandidatesEntryId,
  transferCandidateErrors,
  onBeginEntryEdit,
  onCategoryAppearanceChange,
  onUpdateEntry,
  onUpdateEntrySplit,
  onSaveEntryCategory,
  onEnsureTransferSettlementDraft,
  onTransferDialogEntryChange,
  onUpdateTransferSettlementDraft,
  onRefreshTransferCandidates,
  getTransferCandidatesForEntry,
  onLinkTransferCandidate,
  onSettleTransfer,
  onAddEntryToSplits,
  onViewCreatedSplit,
  onDeleteCreatedSplit,
  onDeleteEntry,
  onFinishEntryEdit,
  onCancelEntryEdit,
  hasEditingChanges = false,
  renderInlineEditor = true
}) {
  const [splitPickerEntry, setSplitPickerEntry] = useState(null);
  const splitGroupOptions = useMemo(
    () => splitGroups.map((group) => ({
      value: group.id === "split-group-none" ? NON_GROUP_SPLIT_VALUE : group.id,
      label: group.name
    })),
    [splitGroups]
  );
  const singleSplitGroupValue = splitGroupOptions.length === 1
    ? splitGroupOptions[0].value
    : null;

  async function handleAddEntryToSplits(entry, splitGroupId) {
    await onAddEntryToSplits(entry, splitGroupId === NON_GROUP_SPLIT_VALUE ? null : splitGroupId);
    setSplitPickerEntry(null);
  }

  function openSplitPicker(entry) {
    if (singleSplitGroupValue) {
      void handleAddEntryToSplits(entry, singleSplitGroupValue);
      return;
    }

    setSplitPickerEntry(entry);
  }

  useEffect(() => {
    if (!renderInlineEditor || !editingEntryId) {
      return undefined;
    }

    function handlePointerDown(event) {
      const target = event.target;
      const openEditor = document.getElementById(editingEntryId);

      if (!(target instanceof Element) || !openEditor) {
        return;
      }

      if (openEditor.contains(target)) {
        return;
      }

      // Dialogs and popovers are portalled outside the row; clicks inside them
      // should still count as part of the current edit flow.
      if (
        target.closest("[role='dialog']") ||
        target.closest("[data-radix-popper-content-wrapper]") ||
        target.closest(".note-dialog-content")
      ) {
        return;
      }

      onCancelEntryEdit();
    }

    document.addEventListener("pointerdown", handlePointerDown, true);
    return () => document.removeEventListener("pointerdown", handlePointerDown, true);
  }, [editingEntryId, onCancelEntryEdit, renderInlineEditor]);

  return (
    <div className="entries-date-groups">
      {groupedEntries.map((group) => (
        <section key={group.date} className="entries-date-group">
          <div className="entries-date-head">
            <strong>{formatService.formatDateOnly(group.date)}</strong>
            <span>{messages.entries.dateNet}: {formatService.money(group.netMinor)}</span>
          </div>

          <div className="entries-rows">
            {group.entries.map((entry) => (
              <EntryRow
                key={entry.id}
                entry={entry}
                allEntries={allEntries}
                categories={categories}
                categoryOptions={categoryOptions}
                accountOptions={accountOptions}
                ownerOptions={ownerOptions}
                viewId={viewId}
                isEditing={editingEntryId === entry.id}
                addingToSplitsEntryId={addingToSplitsEntryId}
                savingEntryId={savingEntryId}
                deletingEntryId={deletingEntryId}
                createdSplitAction={createdSplitAction}
                deletingCreatedSplitId={deletingCreatedSplitId}
                transferDialogEntryId={transferDialogEntryId}
                transferSettlementDrafts={transferSettlementDrafts}
                linkingTransferEntryId={linkingTransferEntryId}
                settlingTransferEntryId={settlingTransferEntryId}
                refreshingTransferCandidatesEntryId={refreshingTransferCandidatesEntryId}
                transferCandidateErrors={transferCandidateErrors}
                onBeginEntryEdit={onBeginEntryEdit}
                onCategoryAppearanceChange={onCategoryAppearanceChange}
                onUpdateEntry={onUpdateEntry}
                onUpdateEntrySplit={onUpdateEntrySplit}
                onSaveEntryCategory={onSaveEntryCategory}
                onEnsureTransferSettlementDraft={onEnsureTransferSettlementDraft}
                onTransferDialogEntryChange={onTransferDialogEntryChange}
                onUpdateTransferSettlementDraft={onUpdateTransferSettlementDraft}
                onRefreshTransferCandidates={onRefreshTransferCandidates}
                getTransferCandidatesForEntry={getTransferCandidatesForEntry}
                onLinkTransferCandidate={onLinkTransferCandidate}
                onSettleTransfer={onSettleTransfer}
                onOpenSplitPicker={openSplitPicker}
                onViewCreatedSplit={onViewCreatedSplit}
                onDeleteCreatedSplit={onDeleteCreatedSplit}
                onDeleteEntry={onDeleteEntry}
                onFinishEntryEdit={onFinishEntryEdit}
                onCancelEntryEdit={onCancelEntryEdit}
                hasEditingChanges={hasEditingChanges}
                renderInlineEditor={renderInlineEditor}
              />
            ))}
          </div>
        </section>
      ))}
      <EntrySplitGroupPickerDialog
        entry={splitPickerEntry}
        splitGroupOptions={splitGroupOptions}
        isSubmitting={Boolean(splitPickerEntry && addingToSplitsEntryId === splitPickerEntry.id)}
        onClose={() => setSplitPickerEntry(null)}
        onSelectGroup={(splitGroupId) => splitPickerEntry ? handleAddEntryToSplits(splitPickerEntry, splitGroupId) : undefined}
      />
    </div>
  );
}

function EntrySplitGroupPickerDialog({ entry, splitGroupOptions, isSubmitting, onClose, onSelectGroup }) {
  const selectRef = useRef(null);
  const [selectedGroupId, setSelectedGroupId] = useState("");

  useEffect(() => {
    if (!entry) {
      setSelectedGroupId("");
    }
  }, [entry]);

  return (
    <Dialog.Root open={Boolean(entry)} onOpenChange={(open) => { if (!open) onClose(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="note-dialog-overlay" />
        <Dialog.Content
          className="note-dialog-content entry-split-picker-dialog"
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            window.requestAnimationFrame(() => selectRef.current?.focus());
          }}
        >
          <div className="note-dialog-head">
            <div>
              <Dialog.Title>Add to splits</Dialog.Title>
              <Dialog.Description>
                Choose the split group for this entry.
              </Dialog.Description>
            </div>
            <button type="button" className="icon-button" aria-label="Close split group picker" onClick={onClose}>
              <X size={18} />
            </button>
          </div>
          <label className="entry-split-picker-field">
            <span>Split group</span>
            <select
              ref={selectRef}
              value={selectedGroupId}
              disabled={isSubmitting}
              onChange={(event) => {
                const nextValue = event.target.value;
                setSelectedGroupId(nextValue);
                void onSelectGroup(nextValue);
              }}
            >
              <option value="" disabled>Choose split group</option>
              {splitGroupOptions.map((group) => (
                <option key={group.value || "split-group-none"} value={group.value}>
                  {group.label}
                </option>
              ))}
            </select>
          </label>
          {isSubmitting ? <p className="entry-split-picker-status">Adding entry to splits...</p> : null}
          <div className="note-dialog-actions">
            <button type="button" className="subtle-cancel" disabled={isSubmitting} onClick={onClose}>
              Cancel
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function EntryRow({
  entry,
  allEntries,
  categories,
  categoryOptions,
  accountOptions,
  ownerOptions,
  viewId,
  isEditing,
  addingToSplitsEntryId,
  savingEntryId,
  deletingEntryId,
  createdSplitAction,
  deletingCreatedSplitId,
  transferDialogEntryId,
  transferSettlementDrafts,
  linkingTransferEntryId,
  settlingTransferEntryId,
  refreshingTransferCandidatesEntryId,
  transferCandidateErrors,
  onBeginEntryEdit,
  onCategoryAppearanceChange,
  onUpdateEntry,
  onUpdateEntrySplit,
  onSaveEntryCategory,
  onEnsureTransferSettlementDraft,
  onTransferDialogEntryChange,
  onUpdateTransferSettlementDraft,
  onRefreshTransferCandidates,
  getTransferCandidatesForEntry,
  onLinkTransferCandidate,
  onSettleTransfer,
  onOpenSplitPicker,
  onViewCreatedSplit,
  onDeleteCreatedSplit,
  onDeleteEntry,
  onFinishEntryEdit,
  onCancelEntryEdit,
  hasEditingChanges = false,
  renderInlineEditor = true
}) {
  const inlineEditorRef = useRef(null);
  const category = categoryService.get(categories, entry);
  const transferCandidates = entry.entryType === "transfer"
    ? getTransferCandidatesForEntry(entry)
    : [];
  const bankState = getEntryBankState(entry);
  const display = buildEntryRowDisplay(entry, viewId);
  const linkedSplitExpenseId = createdSplitAction && createdSplitAction.entryId === entry.id
    ? createdSplitAction.splitExpenseId
    : entry.linkedSplitExpenseId;
  const isSavingEntry = savingEntryId === entry.id;
  const isDeletingEntry = deletingEntryId === entry.id;
  const isAddingToSplits = addingToSplitsEntryId === entry.id;

  useEffect(() => {
    if (!renderInlineEditor || !isEditing) {
      return undefined;
    }

    const frame = window.requestAnimationFrame(() => {
      if (inlineEditorRef.current) {
        scrollInlineEditorIntoView(inlineEditorRef.current);
      }
    });

    return () => window.cancelAnimationFrame(frame);
  }, [isEditing, renderInlineEditor]);

  return (
    <div className={`entry-row ${isEditing ? "is-editing" : ""} ${renderInlineEditor && isEditing ? "is-inline-editing" : ""}`} id={entry.id}>
      {!isEditing || !renderInlineEditor ? (
        <div
          className={`entry-row-main ${entry.isPendingDerived ? "is-pending" : ""}`}
          role="button"
          tabIndex={0}
          onClick={(event) => {
            if (shouldIgnoreRowEditClick(event.target, event.currentTarget)) {
              return;
            }
            onBeginEntryEdit(entry);
          }}
          onKeyDown={(event) => {
            if (event.key !== "Enter" && event.key !== " ") {
              return;
            }
            event.preventDefault();
            onBeginEntryEdit(entry);
          }}
        >
          <div className="entry-row-category">
            <CategoryAppearancePopover
              category={category}
              onChange={onCategoryAppearanceChange}
            />
            <strong>{category?.name ?? entry.categoryName}</strong>
          </div>
          <div className="entry-row-description">
            <div className="entry-row-category-label">
              <strong>{category?.name ?? entry.categoryName}</strong>
            </div>
            <strong>{entry.description}</strong>
            <p>{entry.note || messages.common.emptyValue}</p>
          </div>
          <div className="entry-row-transfer">
            <strong>{display.transferDetail}</strong>
            <p>{display.accountDetail || messages.common.emptyValue}</p>
          </div>
          <div className="entry-row-right">
            <div className="entry-row-amount">
              <strong className={entryService.getAmountToneClass(display.signedAmountMinor)}>{formatService.money(display.signedAmountMinor)}</strong>
              {display.hasWeightedTotal ? <p>({formatService.money(display.signedTotalAmountMinor)} total)</p> : null}
            </div>
            <div className="entry-pills">
              {entry.isPendingDerived ? <span className="entry-chip entry-chip-pending">Updating</span> : null}
              {display.transferLabel ? <span className="entry-chip entry-chip-transfer">{display.transferLabel}</span> : null}
              <span
                className={`entry-chip entry-chip-bank-state ${bankState.className} entry-status-dot`}
                aria-label={bankState.label}
                title={bankState.label}
              />
              <span className={`entry-chip ${entry.ownershipType === "shared" ? "entry-chip-shared" : "entry-chip-owner"}`}>{display.ownerLabel}</span>
              {entry.ownershipType === "shared" && display.splitPercent != null ? (
                <span className="entry-chip entry-chip-split">{display.splitPercent}%</span>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}

      {renderInlineEditor && isEditing ? (
        <div ref={inlineEditorRef} className="entry-inline-editor">
          <EntryEditorFields
            entry={entry}
            categories={categories}
            categoryOptions={categoryOptions}
            accountOptions={accountOptions}
            ownerOptions={ownerOptions}
            splitPercentValue={entry.ownershipType === "shared" ? display.splitPercent : null}
            lockTransferCategory
            onChange={(patch) => onUpdateEntry(entry.id, patch)}
            onQuickSaveCategory={(categoryName) => onSaveEntryCategory(entry.id, categoryName)}
            onCategoryAppearanceChange={onCategoryAppearanceChange}
            onOwnerChange={(nextValue) => {
              if (nextValue === "Shared") {
                onUpdateEntry(entry.id, { ownershipType: "shared", ownerName: undefined });
              } else {
                onUpdateEntry(entry.id, { ownershipType: "direct", ownerName: nextValue });
              }
            }}
            onSplitPercentChange={(percentage) => onUpdateEntrySplit(entry.id, percentage)}
            transferTools={(
              <EntryTransferTools
                entry={entry}
                categoryOptions={categoryOptions}
                transferCandidates={transferCandidates}
                transferDialogEntryId={transferDialogEntryId}
                transferSettlementDrafts={transferSettlementDrafts}
                linkingTransferEntryId={linkingTransferEntryId}
                settlingTransferEntryId={settlingTransferEntryId}
                refreshingTransferCandidatesEntryId={refreshingTransferCandidatesEntryId}
                transferCandidatesError={transferCandidateErrors[entry.id] ?? ""}
                onEnsureSettlementDraft={onEnsureTransferSettlementDraft}
                onTransferDialogEntryChange={onTransferDialogEntryChange}
                onSettlementDraftChange={onUpdateTransferSettlementDraft}
                onRefreshCandidates={onRefreshTransferCandidates}
                onLinkCandidate={onLinkTransferCandidate}
                onSettleTransfer={onSettleTransfer}
              />
            )}
          />
          <div className="entry-inline-status-legend" aria-label="Entry status legend">
            <span className="entry-inline-status-item">
              <span className="entry-inline-status-label">Status:</span>
              <span className={`entry-chip entry-chip-bank-state ${bankState.className} entry-status-dot`} aria-hidden="true" />
              <span className="entry-inline-status-separator">-</span>
              <span>{bankState.label}</span>
            </span>
          </div>
          <div className="entry-inline-actions">
            {linkedSplitExpenseId ? (
              <>
                <button
                  type="button"
                  className="subtle-action"
                  onClick={() => onViewCreatedSplit?.(entry.id, linkedSplitExpenseId)}
                >
                  View split
                </button>
                <button
                  type="button"
                  className="subtle-action"
                  disabled={deletingCreatedSplitId === linkedSplitExpenseId}
                  onClick={() => void onDeleteCreatedSplit?.(entry.id, linkedSplitExpenseId)}
                >
                  {deletingCreatedSplitId === linkedSplitExpenseId ? messages.common.working : "Delete split"}
                </button>
                <button
                  type="button"
                  className="subtle-action"
                  disabled={isDeletingEntry}
                  onClick={() => void onDeleteEntry?.(entry)}
                >
                  {isDeletingEntry ? messages.common.working : "Delete entry"}
                </button>
                <span className="entry-inline-actions-divider" aria-hidden="true">|</span>
              </>
            ) : entry.entryType === "expense" ? (
              <>
                <button
                  type="button"
                  className="subtle-action"
                  disabled={isAddingToSplits || isSavingEntry || isDeletingEntry}
                  onClick={() => onOpenSplitPicker(entry)}
                >
                  {isAddingToSplits || isSavingEntry ? messages.common.working : messages.entries.addToSplits}
                </button>
                <button
                  type="button"
                  className="subtle-action"
                  disabled={isDeletingEntry}
                  onClick={() => void onDeleteEntry?.(entry)}
                >
                  {isDeletingEntry ? messages.common.working : "Delete entry"}
                </button>
              </>
            ) : null}
            {!linkedSplitExpenseId && entry.entryType !== "expense" ? (
              <button
                type="button"
                className="subtle-action"
                disabled={isDeletingEntry}
                onClick={() => void onDeleteEntry?.(entry)}
              >
                {isDeletingEntry ? messages.common.working : "Delete entry"}
              </button>
            ) : null}
            <button
              type="button"
              className="inline-action-button inline-save-action"
              aria-label="Done editing entry"
              disabled={!hasEditingChanges || isSavingEntry || isDeletingEntry}
              onClick={onFinishEntryEdit}
            >
              {isSavingEntry ? <span className="app-spinner" aria-hidden="true" /> : <Check size={16} />}
              <span className="desktop-action-label">{isSavingEntry ? messages.common.saving : "Save"}</span>
            </button>
            <button
              type="button"
              className="inline-action-button inline-cancel-action"
              aria-label="Cancel editing entry"
              disabled={isSavingEntry || isDeletingEntry || isAddingToSplits}
              onClick={onCancelEntryEdit}
            >
              <X size={16} />
              <span className="desktop-action-label">Cancel</span>
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function buildEntryRowDisplay(entry, viewId) {
  const splitPercent = entryService.getVisibleSplitPercent(entry, viewId);
  const signedAmountMinor = entryService.getSignedAmountMinor(entry);
  const signedTotalAmountMinor = entryService.getSignedTotalAmountMinor(entry);

  return {
    ownerLabel: entry.ownershipType === "shared" ? "Shared" : entry.ownerName ?? messages.common.emptyValue,
    splitPercent,
    transferLabel: entry.entryType === "transfer"
      ? `${entry.linkedTransfer ? "Matched transfer" : "Transfer"} ${entry.transferDirection === "in" ? "in" : "out"}`
      : null,
    transferDetail: entry.linkedTransfer
      ? `${entry.transferDirection === "out" ? "To" : "From"} ${entry.linkedTransfer.accountName}`
      : entry.accountName,
    accountDetail: [
      entry.linkedTransfer ? entry.accountName : null,
      entry.accountOwnerLabel
    ].filter(Boolean).join(" - "),
    signedAmountMinor,
    signedTotalAmountMinor,
    hasWeightedTotal: signedTotalAmountMinor != null && signedTotalAmountMinor !== signedAmountMinor
  };
}

function shouldIgnoreRowEditClick(target, currentTarget) {
  if (!(target instanceof Element) || !(currentTarget instanceof Element)) {
    return false;
  }

  const interactiveAncestor = target.closest(
    "button, a, input, select, textarea, [role='button'], [role='link']"
  );
  return Boolean(interactiveAncestor && interactiveAncestor !== currentTarget);
}

// Bank state tells the user how "final" the row is:
// - statement certified: locked to a confirmed bank statement
// - import provisional: imported but not yet certified by a statement
// - manual provisional: typed by hand and still waiting for bank confirmation
function getEntryBankState(entry) {
  if (entry.bankCertificationStatus === "statement_certified") {
    return {
      label: entry.bankCertificationLabel ?? "Statement certified",
      title: entry.statementCertifiedAt
        ? `Bank facts certified ${formatService.formatDateOnly(entry.statementCertifiedAt.slice(0, 10))}`
        : "Bank facts are locked by a saved statement.",
      className: "is-statement-certified"
    };
  }

  if (entry.bankCertificationStatus === "import_provisional") {
    return {
      label: entry.bankCertificationLabel ?? "Import provisional",
      title: entry.importedSourceLabel
        ? `Imported from ${entry.importedSourceLabel}; final statement can still certify it.`
        : "Imported working row; final statement can still certify it.",
      className: "is-import-provisional"
    };
  }

  return {
    label: entry.bankCertificationLabel ?? "Manual provisional",
    title: "Manual row; a later bank import or statement should match or certify it.",
    className: "is-manual-provisional"
  };
}
