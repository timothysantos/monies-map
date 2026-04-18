import { createPortal } from "react-dom";
import { SplitsActivitySection } from "./splits-activity-section";
import { SplitsBreakdownSection } from "./splits-breakdown-section";
import { SplitsGroupsNav } from "./splits-groups-nav";
import { SplitMatchesList } from "./splits-matches";

// Main split content is presentation-only; SplitsPanel keeps URL state and API handlers.
export function SplitsMainSection({
  groups,
  activeGroup,
  defaultGroupId,
  selectedMode,
  pendingMatchCount,
  expenseMatchCount,
  settlementMatchCount,
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
  inlineSplitDraft,
  inlineSplitError,
  isSubmitting,
  onSelectGroup,
  onSelectMatches,
  onCreateGroup,
  onToggleBreakdown,
  onAddExpense,
  onDismissMatch,
  onConfirmMatch,
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
  const groupsNav = (
    <SplitsGroupsNav
      groups={groups}
      activeGroup={activeGroup}
      defaultGroupId={defaultGroupId}
      selectedMode={selectedMode}
      pendingMatchCount={pendingMatchCount}
      expenseMatchCount={expenseMatchCount}
      settlementMatchCount={settlementMatchCount}
      onSelectGroup={onSelectGroup}
      onSelectMatches={onSelectMatches}
      onCreateGroup={onCreateGroup}
      readOnly={readOnly}
    />
  );
  const floatingGroupsNav = typeof document === "undefined"
    ? null
    : createPortal(
        <SplitsGroupsNav
          groups={groups}
          activeGroup={activeGroup}
          defaultGroupId={defaultGroupId}
          selectedMode={selectedMode}
          pendingMatchCount={pendingMatchCount}
          expenseMatchCount={expenseMatchCount}
          settlementMatchCount={settlementMatchCount}
          onSelectGroup={onSelectGroup}
          onSelectMatches={onSelectMatches}
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
        readOnly={readOnly}
      />

      {selectedMode === "matches" ? (
        <SplitMatchesList
          matches={visibleMatches}
          pendingMatchCount={pendingMatchCount}
          onDismissMatch={onDismissMatch}
          onConfirmMatch={onConfirmMatch}
        />
      ) : (
        <SplitsActivitySection
          groupedCurrentActivity={groupedCurrentActivity}
          archivedBatches={archivedBatches}
          categories={categories}
          groupOptions={groupOptions}
          people={people}
          categoryOptions={categoryOptions}
          inlineSplitDraft={inlineSplitDraft}
          inlineSplitError={inlineSplitError}
          isSubmitting={isSubmitting}
          onAddExpense={onAddExpense}
          onOpenArchive={onOpenArchive}
          onEditExpense={onEditExpense}
          onEditSettlement={onEditSettlement}
          onChangeInlineSplitDraft={onChangeInlineSplitDraft}
          onCancelInlineSplit={onCancelInlineSplit}
          onSaveInlineSplit={onSaveInlineSplit}
          onRequestDeleteSplit={onRequestDeleteSplit}
          onEditLinkedEntry={onEditLinkedEntry}
          readOnly={readOnly}
        />
      )}
    </>
  );
}
