import { messages } from "./copy/en-SG";
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
  isSubmitting,
  hasInlineSplitChanges,
  onAddExpense,
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
        {!groupedCurrentActivity.length && searchQuery ? <p className="lede compact">{messages.splits.noSearchResults}</p> : null}
        {!groupedCurrentActivity.length && !searchQuery && !archivedBatches.length ? <p className="lede compact">{messages.splits.noEntries}</p> : null}
      </div>
    </section>
  );
}
