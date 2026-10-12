import "./splits-activity-list.css";
import { messages } from "./copy/en-SG";
import { EmptyState } from "./ui-states";
import { SplitActivityGroups } from "./splits-activity";

export function SplitsActivitySection({
  groupedCurrentActivity,
  archivedBatches,
  categories,
  groupOptions,
  people,
  categoryOptions,
  searchQuery = "",
  inlineSplitDraft,
  inlineSplitError,
  inlineSettlementLock = null,
  inlineReadOnly = false,
  isUndoingSettlementLock = false,
  onUndoSettlementLock,
  isSubmitting,
  hasInlineSplitChanges,
  onAddExpense,
  activeGroupId = "",
  onOpenArchive,
  onEditExpense,
  onEditSettlement,
  onChangeInlineSplitDraft,
  onCancelInlineSplit,
  onSaveInlineSplit,
  onRequestDeleteSplit,
  onViewLinkedEntry,
  onRefreshActivity,
  viewId,
  readOnly = false,
  archiveControl = null
}) {
  return (
    <section className="split-list-section">
      {!readOnly ? (
        <button
          type="button"
          data-splits-fab-trigger="true"
          data-split-group={activeGroupId}
          className="entries-fab-trigger"
          onClick={onAddExpense}
          aria-hidden="true"
          tabIndex={-1}
        />
      ) : null}
      <div className="split-activity-list">
        {archiveControl}
        {groupedCurrentActivity.length ? (
          <SplitActivityGroups
            groups={groupedCurrentActivity}
            categories={categories}
            groupOptions={groupOptions}
            people={people}
            categoryOptions={categoryOptions}
            editingDraft={inlineSplitDraft}
            inlineFormError={inlineSplitError}
            inlineSettlementLock={inlineSettlementLock}
            inlineReadOnly={inlineReadOnly}
            isUndoingSettlementLock={isUndoingSettlementLock}
            onUndoSettlementLock={onUndoSettlementLock}
            isSubmitting={isSubmitting}
            hasEditingChanges={hasInlineSplitChanges}
            onChangeEditingDraft={onChangeInlineSplitDraft}
            onCancelEditing={onCancelInlineSplit}
            onSaveEditing={onSaveInlineSplit}
            onRequestDelete={onRequestDeleteSplit}
            onEditExpense={onEditExpense}
            onEditSettlement={onEditSettlement}
            onViewLinkedEntry={onViewLinkedEntry}
            onRefreshActivity={onRefreshActivity}
            viewId={viewId}
            readOnly={readOnly}
          />
        ) : null}
        {!groupedCurrentActivity.length && searchQuery ? <EmptyState>{messages.splits.noSearchResults}</EmptyState> : null}
        {!groupedCurrentActivity.length && !searchQuery && !archivedBatches.length ? <EmptyState>{messages.splits.noEntries}</EmptyState> : null}
      </div>
    </section>
  );
}
