import { messages } from "./copy/en-SG";
import { SplitsActivitySection } from "./splits-activity-section";
import { SplitsBreakdownSection } from "./splits-breakdown-section";
import { SplitMatchesList } from "./splits-matches";

// Main split content is presentation-only; SplitsPanel keeps URL state and API handlers.
export function SplitsMainSection({
  activeGroup,
  selectedMode,
  pendingMatchCount,
  showBreakdown,
  lead,
  donutRows,
  donutChart,
  categories,
  groupOptions,
  people,
  categoryOptions,
  visibleMatches,
  groupedCurrentActivity,
  archivedBatches,
  searchQuery = "",
  inlineSplitDraft,
  inlineSplitError,
  inlineSettlementLock = null,
  inlineReadOnly = false,
  isUndoingSettlementLock = false,
  onUndoSettlementLock,
  isSubmitting,
  hasInlineSplitChanges,
  onOpenMatches,
  onOpenHistory,
  onBackToGroup,
  onToggleBreakdown,
  onAddExpense,
  searchControl,
  leadControls,
  onDismissMatch,
  onConfirmMatch,
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
  isRefreshingDerived = false,
  readOnly = false,
  settlementStatus = null
}) {
  return (
    <>
      <SplitsBreakdownSection
        showBreakdown={showBreakdown}
        currency={activeGroup?.currency ?? "SGD"}
        lead={lead}
        activeGroup={activeGroup}
        donutRows={donutRows}
        donutChart={donutChart}
        categories={categories}
        onToggleBreakdown={onToggleBreakdown}
        onAddExpense={onAddExpense}
        searchControl={searchControl}
        leadControls={leadControls}
        onOpenHistory={onOpenHistory}
        readOnly={readOnly}
        isRefreshingDerived={isRefreshingDerived}
      />

      {settlementStatus}

      {/* "matches" is a review mode; "entries" is the normal activity timeline. */}
      {selectedMode === "matches" ? (
        <SplitMatchesList
          matches={visibleMatches}
          pendingMatchCount={pendingMatchCount}
          onBackToGroup={onBackToGroup}
          onDismissMatch={onDismissMatch}
          onConfirmMatch={onConfirmMatch}
        />
      ) : (
        <>
          {pendingMatchCount ? (
            <section className="split-match-inbox-callout">
              <div>
                <strong>{messages.splits.matchInboxTitle(pendingMatchCount)}</strong>
                <p>{messages.splits.matchInboxDetail}</p>
              </div>
              <button type="button" className="dialog-primary" onClick={onOpenMatches}>
                {messages.splits.reviewMatches}
              </button>
            </section>
          ) : null}
          <SplitsActivitySection
            groupedCurrentActivity={groupedCurrentActivity}
            archivedBatches={archivedBatches}
            searchQuery={searchQuery}
            categories={categories}
            groupOptions={groupOptions}
            people={people}
            categoryOptions={categoryOptions}
            inlineSplitDraft={inlineSplitDraft}
            inlineSplitError={inlineSplitError}
            inlineSettlementLock={inlineSettlementLock}
            inlineReadOnly={inlineReadOnly}
            isUndoingSettlementLock={isUndoingSettlementLock}
            onUndoSettlementLock={onUndoSettlementLock}
            isSubmitting={isSubmitting}
            hasInlineSplitChanges={hasInlineSplitChanges}
            onAddExpense={onAddExpense}
            activeGroupId={activeGroup?.id ?? ""}
            onOpenArchive={onOpenArchive}
            onEditExpense={onEditExpense}
            onEditSettlement={onEditSettlement}
            onChangeInlineSplitDraft={onChangeInlineSplitDraft}
            onCancelInlineSplit={onCancelInlineSplit}
            onSaveInlineSplit={onSaveInlineSplit}
            onRequestDeleteSplit={onRequestDeleteSplit}
            onViewLinkedEntry={onViewLinkedEntry}
            onRefreshActivity={onRefreshActivity}
            viewId={viewId}
            readOnly={readOnly}
            archiveControl={
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
            }
          />
        </>
      )}
    </>
  );
}
