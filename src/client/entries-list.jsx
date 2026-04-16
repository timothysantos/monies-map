import { useEffect, useRef } from "react";
import { Check, X } from "lucide-react";

import { CategoryAppearancePopover } from "./category-visuals";
import { getCategory } from "./category-utils";
import { messages } from "./copy/en-SG";
import { EntryEditorFields, EntryTransferTools } from "./entry-editor";
import {
  getAmountToneClass,
  getSignedAmountMinor,
  getSignedTotalAmountMinor,
  getTransferMatchCandidates,
  getVisibleSplitPercent
} from "./entry-helpers";
import { formatDateOnly, money } from "./formatters";

function scrollInlineEditorIntoView(element) {
  if (window.matchMedia("(max-width: 760px)").matches) {
    element.scrollIntoView({ block: "start", behavior: "smooth" });
    return;
  }

  const rect = element.getBoundingClientRect();
  const targetTop = window.scrollY + rect.top - ((window.innerHeight - rect.height) / 2) - 48;
  window.scrollTo({ top: Math.max(0, targetTop), behavior: "smooth" });
}

export function EntriesDateGroups({
  groupedEntries,
  allEntries,
  categories,
  categoryOptions,
  accountOptions,
  ownerOptions,
  viewId,
  editingEntryId,
  addingToSplitsEntryId,
  transferDialogEntryId,
  transferSettlementDrafts,
  linkingTransferEntryId,
  settlingTransferEntryId,
  onBeginEntryEdit,
  onCategoryAppearanceChange,
  onUpdateEntry,
  onUpdateEntrySplit,
  onEnsureTransferSettlementDraft,
  onTransferDialogEntryChange,
  onUpdateTransferSettlementDraft,
  onLinkTransferCandidate,
  onSettleTransfer,
  onAddEntryToSplits,
  onFinishEntryEdit,
  onCancelEntryEdit
}) {
  useEffect(() => {
    if (!editingEntryId) {
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
  }, [editingEntryId, onCancelEntryEdit]);

  return (
    <div className="entries-date-groups">
      {groupedEntries.map((group) => (
        <section key={group.date} className="entries-date-group">
          <div className="entries-date-head">
            <strong>{formatDateOnly(group.date)}</strong>
            <span>{messages.entries.dateNet}: {money(group.netMinor)}</span>
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
                transferDialogEntryId={transferDialogEntryId}
                transferSettlementDrafts={transferSettlementDrafts}
                linkingTransferEntryId={linkingTransferEntryId}
                settlingTransferEntryId={settlingTransferEntryId}
                onBeginEntryEdit={onBeginEntryEdit}
                onCategoryAppearanceChange={onCategoryAppearanceChange}
                onUpdateEntry={onUpdateEntry}
                onUpdateEntrySplit={onUpdateEntrySplit}
                onEnsureTransferSettlementDraft={onEnsureTransferSettlementDraft}
                onTransferDialogEntryChange={onTransferDialogEntryChange}
                onUpdateTransferSettlementDraft={onUpdateTransferSettlementDraft}
                onLinkTransferCandidate={onLinkTransferCandidate}
                onSettleTransfer={onSettleTransfer}
                onAddEntryToSplits={onAddEntryToSplits}
                onFinishEntryEdit={onFinishEntryEdit}
                onCancelEntryEdit={onCancelEntryEdit}
              />
            ))}
          </div>
        </section>
      ))}
    </div>
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
  transferDialogEntryId,
  transferSettlementDrafts,
  linkingTransferEntryId,
  settlingTransferEntryId,
  onBeginEntryEdit,
  onCategoryAppearanceChange,
  onUpdateEntry,
  onUpdateEntrySplit,
  onEnsureTransferSettlementDraft,
  onTransferDialogEntryChange,
  onUpdateTransferSettlementDraft,
  onLinkTransferCandidate,
  onSettleTransfer,
  onAddEntryToSplits,
  onFinishEntryEdit,
  onCancelEntryEdit
}) {
  const inlineEditorRef = useRef(null);
  const ownerLabel = entry.ownershipType === "shared" ? "Shared" : entry.ownerName ?? messages.common.emptyValue;
  const splitPercent = getVisibleSplitPercent(entry, viewId);
  const category = getCategory(categories, entry);
  const transferLabel = entry.entryType === "transfer"
    ? `${entry.linkedTransfer ? "Matched transfer" : "Transfer"} ${entry.transferDirection === "in" ? "in" : "out"}`
    : null;
  const transferDetail = entry.linkedTransfer
    ? `${entry.transferDirection === "out" ? "To" : "From"} ${entry.linkedTransfer.accountName}`
    : entry.accountName;
  const signedAmountMinor = getSignedAmountMinor(entry);
  const signedTotalAmountMinor = getSignedTotalAmountMinor(entry);
  const hasWeightedTotal = signedTotalAmountMinor != null && signedTotalAmountMinor !== signedAmountMinor;
  const transferCandidates = entry.entryType === "transfer"
    ? getTransferMatchCandidates(entry, allEntries)
    : [];

  useEffect(() => {
    if (!isEditing) {
      return undefined;
    }

    const frame = window.requestAnimationFrame(() => {
      if (inlineEditorRef.current) {
        scrollInlineEditorIntoView(inlineEditorRef.current);
      }
    });

    return () => window.cancelAnimationFrame(frame);
  }, [isEditing]);

  return (
    <div className={`entry-row ${isEditing ? "is-editing" : ""}`} id={entry.id}>
      {!isEditing ? (
        <button type="button" className="entry-row-main" onClick={() => onBeginEntryEdit(entry)}>
          <div className="entry-row-category">
            <CategoryAppearancePopover
              category={category}
              onChange={onCategoryAppearanceChange}
            />
            <strong>{category?.name ?? entry.categoryName}</strong>
          </div>
          <div className="entry-row-description">
            <strong>{entry.description}</strong>
            <p>{entry.note || messages.common.emptyValue}</p>
          </div>
          <div className="entry-row-transfer">
            <strong>{transferDetail}</strong>
            <p>{entry.accountName}</p>
          </div>
          <div className="entry-row-right">
            <div className="entry-row-amount">
              <strong className={getAmountToneClass(signedAmountMinor)}>{money(signedAmountMinor)}</strong>
              {hasWeightedTotal ? <p>({money(signedTotalAmountMinor)} total)</p> : null}
            </div>
            <div className="entry-pills">
              {transferLabel ? <span className="entry-chip entry-chip-transfer">{transferLabel}</span> : null}
              <span className={`entry-chip ${entry.ownershipType === "shared" ? "entry-chip-shared" : "entry-chip-owner"}`}>{ownerLabel}</span>
              {entry.ownershipType === "shared" && splitPercent != null ? (
                <span className="entry-chip entry-chip-split">{splitPercent}%</span>
              ) : null}
            </div>
          </div>
        </button>
      ) : null}

      {isEditing ? (
        <div ref={inlineEditorRef} className="entry-inline-editor">
          <EntryEditorFields
            entry={entry}
            categories={categories}
            categoryOptions={categoryOptions}
            accountOptions={accountOptions}
            ownerOptions={ownerOptions}
            splitPercentValue={entry.ownershipType === "shared" ? splitPercent : null}
            lockTransferCategory
            onChange={(patch) => onUpdateEntry(entry.id, patch)}
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
                onEnsureSettlementDraft={onEnsureTransferSettlementDraft}
                onTransferDialogEntryChange={onTransferDialogEntryChange}
                onSettlementDraftChange={onUpdateTransferSettlementDraft}
                onLinkCandidate={onLinkTransferCandidate}
                onSettleTransfer={onSettleTransfer}
              />
            )}
          />
          <div className="entry-inline-actions">
            {entry.entryType === "expense" ? (
              <button
                type="button"
                className="subtle-action"
                disabled={addingToSplitsEntryId === entry.id}
                onClick={() => void onAddEntryToSplits(entry)}
              >
                {messages.entries.addToSplits}
              </button>
            ) : null}
            <button type="button" className="icon-action" aria-label="Done editing entry" onClick={onFinishEntryEdit}>
              <Check size={16} />
            </button>
            <button type="button" className="icon-action subtle-cancel" aria-label="Cancel editing entry" onClick={onCancelEntryEdit}>
              <X size={16} />
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
