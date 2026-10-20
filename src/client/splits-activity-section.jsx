import "./splits-activity-list.css";
import { ChevronDown, Receipt, SearchX } from "lucide-react";

import { messages } from "./copy/en-SG";
import { todayInAppTimeZone } from "./app-dates";
import { useMoneyPrivacy } from "./money-privacy";
import { EmptyState } from "./ui-states";
import { SplitActivityGroups } from "./splits-activity";
import { settledSectionHeading } from "./splits-settled-sections";

function draftIsIn(groups, draft) {
  return Boolean(draft) && groups.some((group) => group.items.some((item) => item.kind === draft.kind && item.id === draft.id));
}

// What one settlement covered, collapsed at the end of the list. Its rows are
// drawn only while it is open (a settlement can cover hundreds of them).
function SplitSettledSection({ section, isOpen, onToggle, children }) {
  const { areTotalsVisible } = useMoneyPrivacy();
  const bodyId = `split-settled-${section.checkpointId}`;
  return (
    <section className={`split-settled-section ${isOpen ? "is-open" : ""}`} data-settlement-section={section.checkpointId}>
      <button
        type="button"
        className="split-settled-section-toggle"
        aria-expanded={isOpen}
        aria-controls={bodyId}
        onClick={() => onToggle?.(section.checkpointId)}
      >
        <span>{settledSectionHeading(section, { today: todayInAppTimeZone(), areTotalsVisible })}</span>
        <ChevronDown size={16} aria-hidden="true" className="split-settled-section-chevron" />
      </button>
      {isOpen ? <div id={bodyId} className="split-settled-section-body">{children}</div> : null}
    </section>
  );
}

export function SplitsActivitySection({
  groupedCurrentActivity,
  settledSections = [],
  openSettlementIds = [],
  onToggleSettlement,
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
  onClearSearch = undefined,
  activeGroupId = "",
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
  const hasSettled = settledSections.length > 0;
  // Each list gets the inline card only when the record is in it, so a
  // click inside one list's card never counts as "outside" for another.
  const draftSection = settledSections.find((section) => draftIsIn(section.groups, inlineSplitDraft));
  const renderGroups = (groups, draft) => (
    <SplitActivityGroups
      groups={groups}
      categories={categories}
      groupOptions={groupOptions}
      people={people}
      categoryOptions={categoryOptions}
      editingDraft={draft}
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
  );
  return (
    <section className="split-list-section" id="splits-activity">
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
        {groupedCurrentActivity.length ? renderGroups(groupedCurrentActivity, draftSection ? null : inlineSplitDraft) : null}
        {settledSections.map((section) => (
          <SplitSettledSection
            key={section.checkpointId}
            section={section}
            // A search opens every section it found something in; so does a
            // settled record whose card is open in place.
            isOpen={Boolean(searchQuery) || openSettlementIds.includes(section.checkpointId) || draftSection === section}
            onToggle={onToggleSettlement}
          >
            {renderGroups(section.groups, draftSection === section ? inlineSplitDraft : null)}
          </SplitSettledSection>
        ))}
        {!groupedCurrentActivity.length && !hasSettled && searchQuery ? (
          <EmptyState
            icon={<SearchX />}
            title={messages.splits.noSearchResults}
            action={onClearSearch ? { label: messages.splits.clearSearch, onClick: onClearSearch } : null}
          >
            {messages.splits.noSearchResultsDetail}
          </EmptyState>
        ) : null}
        {!groupedCurrentActivity.length && !hasSettled && !searchQuery && !archivedBatches.length ? (
          <EmptyState
            icon={<Receipt />}
            title={messages.splits.noEntries}
            action={readOnly ? null : { label: messages.splits.addExpense, onClick: onAddExpense }}
          >
            {messages.splits.noEntriesDetail}
          </EmptyState>
        ) : null}
      </div>
    </section>
  );
}
