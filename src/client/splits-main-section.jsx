import { Users } from "lucide-react";
import { splitsMessages } from "./copy/en-SG-splits";
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
  wholeGroupDonutChart,
  wholeGroupDonutRows,
  categories,
  groupOptions,
  people,
  categoryOptions,
  visibleMatches,
  groupedCurrentActivity,
  settledSections = [],
  openSettlementIds = [],
  onToggleSettlement,
  settledLoading = null,
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
        title={splitsMessages.noGroups}
        action={readOnly ? null : { label: splitsMessages.createGroup, onClick: onCreateGroup }}
      >
        {splitsMessages.noGroupsDetail}
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
        wholeGroupDonutChart={wholeGroupDonutChart}
        wholeGroupDonutRows={wholeGroupDonutRows}
        isHousehold={viewId === "household"}
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
                <strong>{splitsMessages.matchInboxTitle(pendingMatchCount)}</strong>
                <p>{splitsMessages.matchInboxDetail}</p>
              </div>
              <button type="button" className="dialog-primary" onClick={onOpenMatches}>
                {splitsMessages.reviewMatches}
              </button>
            </section>
          ) : null}
          <SplitsActivitySection
            groupedCurrentActivity={groupedCurrentActivity}
            settledSections={settledSections}
            openSettlementIds={openSettlementIds}
            onToggleSettlement={onToggleSettlement}
            settledLoading={settledLoading}
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
