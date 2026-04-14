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
  const ownerLabel = entry.ownershipType === "shared" ? "Shared" : entry.ownerName ?? messages.common.emptyValue;
  const splitPercent = getVisibleSplitPercent(entry, viewId);
  const category = getCategory(categories, entry);
  const transferLabel = entry.entryType === "transfer"
    ? entry.transferDirection === "in" ? "Transfer in" : "Transfer out"
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

  return (
    <div className={`entry-row ${isEditing ? "is-editing" : ""}`} id={entry.id}>
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

      {isEditing ? (
        <div className="entry-inline-editor">
          <EntryEditorFields
            entry={entry}
            categories={categories}
            categoryOptions={categoryOptions}
            accountOptions={accountOptions}
            ownerOptions={ownerOptions}
            splitPercentValue={entry.ownershipType === "shared" ? splitPercent : null}
            lockTransferCategory
            onChange={(patch) => onUpdateEntry(entry.id, patch)}
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
