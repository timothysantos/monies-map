import { messages } from "./copy/en-SG";
import { SplitActivityGroups } from "./splits-activity";

export function SplitsActivitySection({
  groupedCurrentActivity,
  archivedBatches,
  categories,
  groupOptions,
  people,
  categoryOptions,
  inlineSplitDraft,
  inlineSplitError,
  isSubmitting,
  onAddExpense,
  onOpenArchive,
  onEditExpense,
  onEditSettlement,
  onChangeInlineSplitDraft,
  onCancelInlineSplit,
  onSaveInlineSplit,
  onRequestDeleteSplit,
  onEditLinkedEntry,
  readOnly = false
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
            onChangeEditingDraft={onChangeInlineSplitDraft}
            onCancelEditing={onCancelInlineSplit}
            onSaveEditing={onSaveInlineSplit}
            onRequestDelete={onRequestDeleteSplit}
            onEditExpense={onEditExpense}
            onEditSettlement={onEditSettlement}
            onEditLinkedEntry={onEditLinkedEntry}
            readOnly={readOnly}
          />
        ) : null}
        {!groupedCurrentActivity.length && !archivedBatches.length ? <p className="lede compact">{messages.splits.noEntries}</p> : null}
        <button
          type="button"
          className={`split-archive-trigger ${archivedBatches.length ? "" : "is-empty"}`}
          onClick={archivedBatches.length ? onOpenArchive : undefined}
          disabled={!archivedBatches.length}
        >
          <span>Archived batches</span>
          <small>
            {archivedBatches.length
              ? `${archivedBatches.length} settled ${archivedBatches.length === 1 ? "batch" : "batches"}`
              : "No settled batches yet"}
          </small>
        </button>
      </div>
    </section>
  );
}
