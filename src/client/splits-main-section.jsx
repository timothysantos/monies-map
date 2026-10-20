import { Users } from "lucide-react";
import { messages } from "./copy/en-SG";
import { EmptyState } from "./ui-states";
import { SplitsActivitySection } from "./splits-activity-section";
import { SplitsBreakdownSection } from "./splits-breakdown-section";
import { SplitMatchesList } from "./splits-matches";
import { archiveTriggerSummary } from "./splits-settled-sections";

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
  settledSections = [],
  openSettlementIds = [],
  onToggleSettlement,
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
  onClearSearch,
  groupCount,
  onCreateGroup,
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
  // Not even the shared group exists: one card says so and offers the way out.
  if (groupCount === 0) {
    return (
      <EmptyState
        icon={<Users />}
        title={messages.splits.noGroups}
        action={readOnly ? null : { label: messages.splits.createGroup, onClick: onCreateGroup }}
      >
        {messages.splits.noGroupsDetail}
      </EmptyState>
    );
  }

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
            settledSections={settledSections}
            openSettlementIds={openSettlementIds}
            onToggleSettlement={onToggleSettlement}
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
            onClearSearch={onClearSearch}
            activeGroupId={activeGroup?.id ?? ""}
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
                className={`split-archive-trigger ${archivedBatches.length || settledSections.length ? "" : "is-empty"}`}
                onClick={archivedBatches.length || settledSections.length ? onOpenArchive : undefined}
                disabled={!archivedBatches.length && !settledSections.length}
              >
                <span>Archived batches</span>
                <small>{archiveTriggerSummary(archivedBatches.length, settledSections.length)}</small>
              </button>
            }
          />
        </>
      )}
    </>
  );
}
