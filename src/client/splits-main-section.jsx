import { createPortal } from "react-dom";
import { messages } from "./copy/en-SG";
import { SplitsActivitySection } from "./splits-activity-section";
import { SplitsBreakdownSection } from "./splits-breakdown-section";
import { SplitsGroupsNav } from "./splits-groups-nav";
import { SplitMatchesList } from "./splits-matches";

// Main split content is presentation-only; SplitsPanel keeps URL state and API handlers.
export function SplitsMainSection({
  groups,
  activeGroup,
  selectedMode,
  pendingMatchCount,
  showBreakdown,
  totalExpenseMinor,
  groupBalanceMinor,
  groupSummaryLabel,
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
  isSubmitting,
  hasInlineSplitChanges,
  onSelectGroup,
  onOpenMatches,
  onOpenHistory,
  onBackToGroup,
  onCreateGroup,
  onToggleBreakdown,
  onAddExpense,
  searchControl,
  summaryToolbar,
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
  // The group nav is rendered twice on desktop:
  // - inline inside the normal document flow
  // - as a floating portal when no inline editor is open
  //
  // That keeps group switching nearby without covering the inline edit card.
  const groupsNav = (
    <SplitsGroupsNav
      groups={groups}
      activeGroup={activeGroup}
      selectedMode={selectedMode}
      onSelectGroup={onSelectGroup}
      onCreateGroup={onCreateGroup}
      readOnly={readOnly}
    />
  );
  const floatingGroupsNav = typeof document === "undefined"
    ? null
    : inlineSplitDraft
      ? null
      : createPortal(
        <SplitsGroupsNav
          groups={groups}
          activeGroup={activeGroup}
          selectedMode={selectedMode}
          onSelectGroup={onSelectGroup}
          onCreateGroup={onCreateGroup}
          readOnly={readOnly}
          floating
        />,
        document.body
      );

  return (
    <>
      {groupsNav}
      {floatingGroupsNav}

      <SplitsBreakdownSection
        showBreakdown={showBreakdown}
        totalExpenseMinor={totalExpenseMinor}
        groupBalanceMinor={groupBalanceMinor}
        groupSummaryLabel={groupSummaryLabel}
        donutRows={donutRows}
        donutChart={donutChart}
        categories={categories}
        onToggleBreakdown={onToggleBreakdown}
        onAddExpense={onAddExpense}
        searchControl={searchControl}
        summaryToolbar={summaryToolbar}
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
            isSubmitting={isSubmitting}
            hasInlineSplitChanges={hasInlineSplitChanges}
            onAddExpense={onAddExpense}
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
