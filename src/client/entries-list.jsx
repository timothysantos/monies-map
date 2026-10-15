import { memo, useEffect, useMemo, useRef, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { Nfc, RefreshCw, Sparkles, X } from "lucide-react";

import { CategoryAppearancePopover } from "./category-visuals";
import { messages } from "./copy/en-SG";
import { EntryTransferTools } from "./entry-editor";
import { EntryEditCard, EntrySplitsRow, EntryTransferMatchRow } from "./entry-edit-card";
import { EntryCategoryQuickPick } from "./entry-category-quick-pick";
import { BottomActions } from "./ui/lead-support-detail";
import { buildEntryRowDisplay, getEntryOwnerCue } from "./entry-row-display";
import { addedByGlyph } from "./entry-source";
import { moniesClient } from "./monies-client-service";
import { PAGE_FLAG, pageFlagRef } from "./page-flags";
import { PrivateMoney, TotalsVisibilityToggle, useMoneyPrivacy } from "./money-privacy";
import { useRouteWorkBusy } from "./use-route-work-status";
import { useStableHandler } from "./use-stable-handler";
import { isMobileLayout } from "./use-viewport";
import { SettlementLockNotice } from "./settlement-lock-notice";
import { moneyToneClass } from "./money-tone-class";
import { flowTone } from "../domain/money-tone";
import { trackStuckDateRow } from "./stuck-date-row";

const {
  categories: categoryService,
  entries: entryService,
  format: formatService
} = moniesClient;

const NON_GROUP_SPLIT_VALUE = "__split_group_none__";

function scrollInlineEditorIntoView(element) {
  if (isMobileLayout()) {
    element.scrollIntoView({ block: "start", behavior: "smooth" });
    return;
  }

  const rect = element.getBoundingClientRect();
  const targetTop = window.scrollY + rect.top - ((window.innerHeight - rect.height) / 2) - 48;
  window.scrollTo({ top: Math.max(0, targetTop), behavior: longJumpOr(targetTop, "smooth") });
}

function scrollMobileEntryRowIntoView(element) {
  const rect = element.getBoundingClientRect();
  const targetTop = window.scrollY + rect.top - 82;
  window.scrollTo({ top: Math.max(0, targetTop), behavior: longJumpOr(targetTop, "auto") });
}

// Off-screen rows use an estimated height until they render
// (content-visibility). A long smooth scroll renders rows on the way and
// ends off target, so a jump of more than two screens (a deep link to a row
// far down the month) is instant; the retries then correct it.
function longJumpOr(targetTop, behavior) {
  return Math.abs(targetTop - window.scrollY) > window.innerHeight * 2 ? "instant" : behavior;
}

// This renderer is intentionally "dumb": it receives already-grouped entries
// and mostly maps them into row UI.
//
// Rows are memoized. A closed row receives only its entry, display inputs
// and two stable handlers, so a filter, draft or editor change elsewhere
// does not re-render it. Everything the inline editor needs travels in one
// `editor` bundle given only to the open row.
export function EntriesDateGroups({
  groupedEntries,
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
  onChangeEntryCategory,
  onCategoryAppearanceChange,
  onUpdateEntry,
  onUpdateEntryAmount,
  onUpdateEntrySplit,
  onEnsureTransferSettlementDraft,
  onTransferDialogEntryChange,
  onUpdateTransferSettlementDraft,
  onRefreshTransferCandidates,
  getTransferCandidatesForEntry,
  onLinkTransferCandidate,
  onSettleTransfer,
  onAddEntryToSplits,
  onRefreshSplitGroups,
  onViewCreatedSplit,
  onDeleteCreatedSplit,
  onDeleteEntry,
  onFinishEntryEdit,
  onCancelEntryEdit,
  onRefreshEntries,
  entrySubmitError = "",
  entrySettlementLock = null,
  isUndoingEntrySettlementLock = false,
  onUndoEntrySettlementLock = undefined,
  hasEditingChanges = false,
  renderInlineEditor = true
}) {
  const splitGroupOptions = useMemo(
    () => splitGroups.map((group) => ({
      value: group.id === "split-group-none" ? NON_GROUP_SPLIT_VALUE : group.id,
      label: group.name
    })),
    [splitGroups]
  );
  const [splitPickerEntry, setSplitPickerEntry] = useState(null);
  const [splitPickerOptions, setSplitPickerOptions] = useState(splitGroupOptions);
  const splitPickerRefreshIdRef = useRef(0);
  const [refreshingDate, setRefreshingDate] = useState("");
  useRouteWorkBusy(Boolean(splitPickerEntry) || refreshingDate !== "");

  async function handleAddEntryToSplits(entry, splitGroupId) {
    await onAddEntryToSplits(entry, splitGroupId === NON_GROUP_SPLIT_VALUE ? null : splitGroupId);
    setSplitPickerEntry(null);
    setSplitPickerOptions(splitGroupOptions);
  }

  async function openSplitPicker(entry) {
    const currentSingleSplitGroupValue = splitGroupOptions.length === 1
      ? splitGroupOptions[0].value
      : null;
    const refreshId = splitPickerRefreshIdRef.current + 1;
    splitPickerRefreshIdRef.current = refreshId;

    if (!currentSingleSplitGroupValue) {
      setSplitPickerOptions(splitGroupOptions);
      setSplitPickerEntry(entry);
    }

    const latestGroups = await onRefreshSplitGroups?.() ?? splitGroups;
    if (splitPickerRefreshIdRef.current !== refreshId) {
      return;
    }

    const latestOptions = latestGroups.map((group) => ({
      value: group.id === "split-group-none" ? NON_GROUP_SPLIT_VALUE : group.id,
      label: group.name
    }));
    const latestSingleSplitGroupValue = latestOptions.length === 1
      ? latestOptions[0].value
      : null;

    if (currentSingleSplitGroupValue && latestSingleSplitGroupValue) {
      await handleAddEntryToSplits(entry, latestSingleSplitGroupValue);
      return;
    }

    setSplitPickerOptions(latestOptions);
    setSplitPickerEntry(entry);
  }

  useEffect(() => {
    if (!splitPickerEntry) {
      setSplitPickerOptions(splitGroupOptions);
    }
  }, [splitGroupOptions, splitPickerEntry]);

  useEffect(() => {
    if (!renderInlineEditor || !editingEntryId) {
      return undefined;
    }

    function handleOutsideInteraction(event) {
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

    document.addEventListener("pointerdown", handleOutsideInteraction, true);
    document.addEventListener("click", handleOutsideInteraction, true);
    return () => {
      document.removeEventListener("pointerdown", handleOutsideInteraction, true);
      document.removeEventListener("click", handleOutsideInteraction, true);
    };
  }, [editingEntryId, onCancelEntryEdit, renderInlineEditor]);

  async function refreshDateGroup(date) {
    if (!onRefreshEntries || refreshingDate) {
      return;
    }

    setRefreshingDate(date);
    try {
      await onRefreshEntries();
    } finally {
      setRefreshingDate("");
    }
  }

  const beginEntryEdit = useStableHandler(onBeginEntryEdit);
  const changeEntryCategory = useStableHandler(onChangeEntryCategory);
  const changeCategoryAppearance = useStableHandler(onCategoryAppearanceChange);

  // Only the open inline editor reads these, so they are built for that one
  // row per render instead of being passed to every row.
  function buildEditor(entry) {
    return {
      categoryOptions,
      accountOptions,
      ownerOptions,
      isSavingEntry: savingEntryId === entry.id,
      isDeletingEntry: deletingEntryId === entry.id,
      isAddingToSplits: addingToSplitsEntryId === entry.id,
      deletingCreatedSplitId,
      transferCandidates: entry.entryType === "transfer" ? getTransferCandidatesForEntry(entry) : [],
      transferDialogEntryId,
      transferSettlementDrafts,
      linkingTransferEntryId,
      settlingTransferEntryId,
      refreshingTransferCandidatesEntryId,
      transferCandidatesError: transferCandidateErrors[entry.id] ?? "",
      entrySubmitError,
      entrySettlementLock,
      isUndoingEntrySettlementLock,
      onUndoEntrySettlementLock,
      hasEditingChanges,
      onUpdateEntry,
      onUpdateEntryAmount,
      onUpdateEntrySplit,
      onEnsureTransferSettlementDraft,
      onTransferDialogEntryChange,
      onUpdateTransferSettlementDraft,
      onRefreshTransferCandidates,
      onLinkTransferCandidate,
      onSettleTransfer,
      onOpenSplitPicker: openSplitPicker,
      onViewCreatedSplit,
      onDeleteCreatedSplit,
      onDeleteEntry,
      onFinishEntryEdit,
      onCancelEntryEdit
    };
  }

  return (
    <div className="entries-date-groups">
      {groupedEntries.map((group) => (
        <section key={group.date} className="entries-date-group">
          <div className="entries-date-head" ref={trackStuckDateRow}>
            <strong>{formatService.formatDateOnly(group.date)}</strong>
            <div className="entries-date-actions">
              <span>{messages.entries.dateNet}: <PrivateMoney className={moneyToneClass(flowTone(group.netMinor))}>{formatService.money(group.netMinor)}</PrivateMoney></span>
              {onRefreshEntries ? (
                <button
                  type="button"
                  className="entries-date-refresh-button"
                  aria-label={`Refresh rows for ${formatService.formatDateOnly(group.date)}`}
                  title={`Refresh rows for ${formatService.formatDateOnly(group.date)}`}
                  disabled={Boolean(refreshingDate)}
                  onClick={() => void refreshDateGroup(group.date)}
                >
                  <RefreshCw size={15} className={refreshingDate === group.date ? "is-spinning" : ""} />
                </button>
              ) : null}
            </div>
          </div>

          <div className="entries-rows">
            {group.entries.map((entry) => {
              const isEditing = editingEntryId === entry.id;
              return (
                <MemoizedEntryRow
                  key={entry.id}
                  entry={entry}
                  categories={categories}
                  viewId={viewId}
                  isEditing={isEditing}
                  renderInlineEditor={renderInlineEditor}
                  createdSplitExpenseId={createdSplitAction?.entryId === entry.id ? createdSplitAction.splitExpenseId : undefined}
                  onBeginEntryEdit={beginEntryEdit}
                  onChangeEntryCategory={changeEntryCategory}
                  onCategoryAppearanceChange={changeCategoryAppearance}
                  editor={isEditing && renderInlineEditor ? buildEditor(entry) : null}
                />
              );
            })}
          </div>
        </section>
      ))}
      <EntrySplitGroupPickerDialog
        entry={splitPickerEntry}
        splitGroupOptions={splitPickerOptions}
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
  categories,
  viewId,
  isEditing,
  renderInlineEditor,
  createdSplitExpenseId,
  onBeginEntryEdit,
  onChangeEntryCategory,
  onCategoryAppearanceChange,
  editor
}) {
  const rowRef = useRef(null);
  // The category label opens the shared category list. It mounts after the
  // first use and stays, so closing returns focus to the label.
  const categoryLabelRef = useRef(null);
  const [categoryPickState, setCategoryPickState] = useState({ mounted: false, open: false });
  const inlineEditorRef = useRef(null);
  const category = categoryService.get(categories, entry);
  // A split just created from this row shows as linked before the page
  // refresh brings the saved link.
  const linkedSplitExpenseId = createdSplitExpenseId ?? entry.linkedSplitExpenseId;
  const bankState = getEntryBankState(entry);
  const isLinkedToSplits = Boolean(linkedSplitExpenseId);
  const display = buildEntryRowDisplay(entry, viewId, isLinkedToSplits);
  const ownerCue = getEntryOwnerCue(entry, isLinkedToSplits);

  useEffect(() => {
    if (!isEditing) {
      return undefined;
    }

    let frame = 0;
    let timeout = 0;
    let attempts = 0;
    let cancelled = false;
    const scrollWhenReady = () => {
      if (cancelled) {
        return;
      }

      attempts += 1;
      if (renderInlineEditor && inlineEditorRef.current) {
        scrollInlineEditorIntoView(inlineEditorRef.current);
      } else if (isMobileLayout() && rowRef.current) {
        scrollMobileEntryRowIntoView(rowRef.current);
      }

      if (attempts < 4) {
        timeout = window.setTimeout(scrollWhenReady, 120);
      }
    };

    frame = window.requestAnimationFrame(scrollWhenReady);

    return () => {
      cancelled = true;
      window.cancelAnimationFrame(frame);
      window.clearTimeout(timeout);
    };
  }, [isEditing, renderInlineEditor]);

  return (
    <div ref={rowRef} className={`entry-row ${isEditing ? "is-editing" : ""} ${renderInlineEditor && isEditing ? "is-inline-editing" : ""}`} id={entry.id}>
      {!isEditing || !renderInlineEditor ? (
        <div
          className={`entry-row-main has-owner-cue ${entry.isPendingDerived ? "is-pending" : ""}`}
          style={ownerCue.style}
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
              {entry.entryType === "transfer" ? (
                <strong>{category?.name ?? entry.categoryName}</strong>
              ) : (
                <button
                  ref={categoryLabelRef}
                  type="button"
                  className="entry-row-category-button"
                  aria-haspopup="dialog"
                  aria-expanded={categoryPickState.open}
                  aria-label={`${messages.entries.editCategory}: ${category?.name ?? entry.categoryName}`}
                  onClick={() => setCategoryPickState({ mounted: true, open: true })}
                >
                  <strong>{category?.name ?? entry.categoryName}</strong>
                </button>
              )}
            </div>
            <strong>{entry.description}</strong>
            {entry.note ? <p>{entry.note}</p> : null}
          </div>
          <div className="entry-row-transfer">
            <strong>{display.transferDetail}</strong>
            {display.accountDetail ? <p>{display.accountDetail}</p> : null}
          </div>
          <div className="entry-row-right">
            <MemoizedEntryRowAmount
              primarySignedAmountMinor={display.primarySignedAmountMinor}
              amountTone={display.amountTone}
              secondarySignedAmountMinor={display.secondarySignedAmountMinor}
              addedBy={entry.addedBy}
            />
            <div className="entry-pills">
              {entry.isPendingDerived ? <span className="entry-chip entry-chip-pending">Updating</span> : null}
              {display.transferLabel ? (
                <span className={`entry-chip entry-chip-transfer${display.isTransferMatched ? " is-matched" : ""}`}>{display.transferLabel}</span>
              ) : null}
              <span
                className={`entry-chip entry-chip-bank-state ${bankState.className} entry-status-dot`}
                aria-label={bankState.label}
                title={bankState.label}
              />
              <span
                className={`entry-chip ${display.ownerChipClassName}`}
                title={display.ownerTitle}
                aria-label={display.ownerTitle}
              >
                {isLinkedToSplits ? (
                  <>
                    <span className="entry-chip-linked-split-base">On splits</span>
                    {display.linkedSplitGroupName ? (
                      <span
                        className="entry-chip-linked-split-group"
                        style={display.linkedSplitGroupStyle}
                      >
                        {display.linkedSplitGroupName}
                      </span>
                    ) : null}
                  </>
                ) : display.ownerLabel}
              </span>
              {isLinkedToSplits && display.splitPercent != null ? (
                <span className="entry-chip entry-chip-split">{display.splitPercent}%</span>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}

      {categoryPickState.mounted ? (
        <EntryCategoryQuickPick
          entry={entry}
          categories={categories}
          open={categoryPickState.open}
          onOpenChange={(open) => setCategoryPickState((current) => ({ ...current, open }))}
          anchorRef={categoryLabelRef}
          onChange={onChangeEntryCategory}
        />
      ) : null}

      {editor ? (
        <div ref={pageFlagRef(PAGE_FLAG.entryInlineEditor, inlineEditorRef)} className="entry-inline-editor">
          <EntryInlineEditorFields
            entry={entry}
            categories={categories}
            bankState={bankState}
            linkedSplitExpenseId={linkedSplitExpenseId}
            onCategoryAppearanceChange={onCategoryAppearanceChange}
            editor={editor}
          />
        </div>
      ) : null}
    </div>
  );
}

// Declared apart from memo() so the client type-check infers its props.
const MemoizedEntryRow = memo(EntryRow);

// The shared money formatter reads the privacy setting while rendering, so
// the amount subscribes to it. A privacy toggle then redraws only amounts,
// not whole memoized rows.
// An entry an in-app tool saved carries a small muted glyph before its
// amount (Apple Pay's contactless mark, Ask's sparkle), in the amount's
// line so the row keeps its height; it says nothing about the money, so
// hidden money leaves it as it is.
const SOURCE_GLYPH_ICONS = { "apple-pay": Nfc, ask: Sparkles };

function EntryRowAmount({ primarySignedAmountMinor, secondarySignedAmountMinor, amountTone, addedBy = undefined }) {
  useMoneyPrivacy();
  const glyph = addedByGlyph(addedBy);
  const GlyphIcon = glyph ? SOURCE_GLYPH_ICONS[glyph.kind] : null;
  return (
    <div className="entry-row-amount">
      <strong className={moneyToneClass(amountTone)}>
        {GlyphIcon ? (
          <span className={`entry-row-source is-${glyph.kind}`} role="img" aria-label={glyph.label} title={glyph.label}>
            <GlyphIcon size={12} strokeWidth={2.2} aria-hidden="true" />
          </span>
        ) : null}
        {formatService.money(primarySignedAmountMinor)}
      </strong>
      {secondarySignedAmountMinor != null ? <p>({formatService.money(secondarySignedAmountMinor)})</p> : null}
    </div>
  );
}

const MemoizedEntryRowAmount = memo(EntryRowAmount);

function EntryInlineEditorFields({ entry, categories, bankState, linkedSplitExpenseId, onCategoryAppearanceChange, editor }) {
  const {
    categoryOptions,
    accountOptions,
    ownerOptions,
    isSavingEntry,
    isDeletingEntry,
    isAddingToSplits,
    deletingCreatedSplitId,
    transferCandidates,
    transferDialogEntryId,
    transferSettlementDrafts,
    linkingTransferEntryId,
    settlingTransferEntryId,
    refreshingTransferCandidatesEntryId,
    transferCandidatesError,
    entrySubmitError,
    entrySettlementLock,
    isUndoingEntrySettlementLock,
    onUndoEntrySettlementLock,
    hasEditingChanges,
    onUpdateEntry,
    onUpdateEntryAmount,
    onEnsureTransferSettlementDraft,
    onTransferDialogEntryChange,
    onUpdateTransferSettlementDraft,
    onRefreshTransferCandidates,
    onLinkTransferCandidate,
    onSettleTransfer,
    onOpenSplitPicker,
    onViewCreatedSplit,
    onDeleteCreatedSplit,
    onDeleteEntry,
    onFinishEntryEdit,
    onCancelEntryEdit
  } = editor;
  const editableAmountMinor = entryService.getTotalAmountMinor(entry);
  const deleteEntryButton = (
    <button
      type="button"
      className="lsd-quiet is-danger"
      disabled={isDeletingEntry}
      onClick={() => void onDeleteEntry?.(entry)}
    >
      {isDeletingEntry ? messages.common.working : messages.entries.editCard.deleteEntry}
    </button>
  );

  return (
    <>
      <EntryEditCard
        layout="inline"
        entry={entry}
        categories={categories}
        categoryOptions={categoryOptions}
        accountOptions={accountOptions}
        ownerOptions={ownerOptions}
        amountMinorValue={editableAmountMinor}
        amountInputValue={entry.amountInput}
        bankFactsLocked={entry.bankCertificationStatus === "statement_certified"}
        bankState={bankState}
        onChange={(patch) => onUpdateEntry(entry.id, patch)}
        onAmountChange={(patch) => onUpdateEntryAmount(entry.id, patch)}
        onCategoryAppearanceChange={onCategoryAppearanceChange}
        onCategoryQuickSave={onFinishEntryEdit}
        isCategoryQuickSaving={isSavingEntry}
        onOwnerChange={(nextValue) => {
          if (nextValue === "Shared") {
            onUpdateEntry(entry.id, { ownershipType: "shared", ownerName: undefined });
          } else {
            onUpdateEntry(entry.id, { ownershipType: "direct", ownerName: nextValue });
          }
        }}
        amountAction={<TotalsVisibilityToggle className="totals-visibility-toggle--form" />}
        splitsRow={linkedSplitExpenseId || entry.entryType === "expense" ? (
          <EntrySplitsRow
            isLinked={Boolean(linkedSplitExpenseId)}
            isWorking={!linkedSplitExpenseId && (isAddingToSplits || isSavingEntry)}
            onViewSplit={() => onViewCreatedSplit?.(entry.id, linkedSplitExpenseId)}
            onAddToSplits={() => void onOpenSplitPicker(entry)}
          />
        ) : null}
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
            transferCandidatesError={transferCandidatesError}
            onEnsureSettlementDraft={onEnsureTransferSettlementDraft}
            onTransferDialogEntryChange={onTransferDialogEntryChange}
            onSettlementDraftChange={onUpdateTransferSettlementDraft}
            onRefreshCandidates={onRefreshTransferCandidates}
            onLinkCandidate={onLinkTransferCandidate}
            onSettleTransfer={onSettleTransfer}
            showLabel={false}
            trigger={<EntryTransferMatchRow />}
          />
        )}
      />
      {entrySettlementLock
        ? <SettlementLockNotice lock={entrySettlementLock} isUndoing={isUndoingEntrySettlementLock} onUndo={onUndoEntrySettlementLock} />
        : entrySubmitError ? <p className="form-error" role="alert">{entrySubmitError}</p> : null}
      <BottomActions
        className="entry-inline-actions entry-edit-inline-actions"
        destructive={(
          <>
            {deleteEntryButton}
            {linkedSplitExpenseId ? (
              <button
                type="button"
                className="lsd-quiet is-danger"
                disabled={deletingCreatedSplitId === linkedSplitExpenseId}
                onClick={() => void onDeleteCreatedSplit?.(entry.id, linkedSplitExpenseId)}
              >
                {deletingCreatedSplitId === linkedSplitExpenseId ? messages.common.working : messages.entries.editCard.deleteSplit}
              </button>
            ) : null}
          </>
        )}
        secondary={(
          <button
            type="button"
            className="lsd-quiet inline-cancel-action"
            aria-label="Cancel editing entry"
            disabled={isSavingEntry || isDeletingEntry || isAddingToSplits}
            onClick={onCancelEntryEdit}
          >
            {messages.entries.cancelEdit}
          </button>
        )}
        primary={(
          <button
            type="button"
            className="lsd-primary inline-save-action"
            aria-label="Done editing entry"
            disabled={!hasEditingChanges || isSavingEntry || isDeletingEntry}
            onClick={onFinishEntryEdit}
          >
            {isSavingEntry ? <span className="app-spinner" aria-hidden="true" /> : null}
            {isSavingEntry ? messages.common.saving : "Save"}
          </button>
        )}
      />
    </>
  );
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
