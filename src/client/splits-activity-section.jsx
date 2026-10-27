import "./splits-activity-list.css";
import { ChevronDown, Receipt, SearchX } from "lucide-react";

import { messages } from "./copy/en-SG";
import { splitsMessages } from "./copy/en-SG-splits";
import { todayInAppTimeZone } from "./app-dates";
import { useMoneyPrivacy } from "./money-privacy";
import { EmptyState, InlineError } from "./ui-states";
import { SplitActivityGroups } from "./splits-activity";
import { settledSectionHeading } from "./splits-settled-sections";

function draftIsIn(groups, draft) {
  return Boolean(draft) && groups.some((group) => group.items.some((item) => item.kind === draft.kind && item.id === draft.id));
}

// While settled rows load: the spinner and the app's own "Loading...".
function SettledRowsLoading() {
  return (
    <div className="split-settled-section-status" role="status" aria-busy="true">
      <span className="app-spinner" aria-hidden="true" />
      <span>{messages.common.loading}</span>
    </div>
  );
}

// Settled rows that could not load, with the app's own Try again.
function SettledRowsFailed({ onRetry }) {
  return (
    <InlineError
      className="split-settled-section-status"
      message={messages.common.loadFailedUnreachable}
      retryLabel={messages.common.screenCrashRetry}
      onRetry={onRetry}
    />
  );
}

// What one settlement covered, collapsed at the end of the list. The page
// holds only its heading's numbers: its rows load when it opens (a
// settlement can cover hundreds of them) and are drawn only while it is open.
function SplitSettledSection({ section, isOpen, onToggle, onPrefetch, onRetry, children }) {
  const { areTotalsVisible } = useMoneyPrivacy();
  const bodyId = `split-settled-${section.checkpointId}`;
  const prefetch = onPrefetch ? () => onPrefetch(section.checkpointId) : undefined;
  let body = children;
  if (section.status === "error") {
    body = <SettledRowsFailed onRetry={() => onRetry?.(section.checkpointId)} />;
  } else if (section.status !== "ready") {
    body = <SettledRowsLoading />;
  }
  return (
    <section className={`split-settled-section ${isOpen ? "is-open" : ""}`} data-settlement-section={section.checkpointId}>
      <button
        type="button"
        className="split-settled-section-toggle"
        aria-expanded={isOpen}
        aria-controls={bodyId}
        onClick={() => onToggle?.(section.checkpointId)}
        onPointerEnter={prefetch}
        onFocus={prefetch}
      >
        <span>{settledSectionHeading(section, { today: todayInAppTimeZone(), areTotalsVisible })}</span>
        <ChevronDown size={16} aria-hidden="true" className="split-settled-section-chevron" />
      </button>
      {isOpen ? <div id={bodyId} className="split-settled-section-body" aria-busy={section.status === "ready" ? undefined : true}>{body}</div> : null}
    </section>
  );
}

export function SplitsActivitySection({
  groupedCurrentActivity,
  settledSections = [],
  openSettlementIds = [],
  onToggleSettlement,
  settledLoading = null,
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
  onUndoCorrection = undefined,
  undoingCorrectionId = "",
  viewId,
  readOnly = false,
  archiveControl = null
}) {
  const hasSettled = settledSections.length > 0;
  // A search also looks inside the settled sections on the server; until it
  // answers, "nothing found" would be premature.
  const settledSearchStatus = searchQuery ? settledLoading?.searchStatus ?? "off" : "off";
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
      onUndoCorrection={onUndoCorrection}
      undoingCorrectionId={undoingCorrectionId}
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
            onPrefetch={settledLoading?.onPrefetch}
            onRetry={settledLoading?.onRetry}
          >
            {renderGroups(section.groups, draftSection === section ? inlineSplitDraft : null)}
          </SplitSettledSection>
        ))}
        {settledSearchStatus === "loading" && !hasSettled ? <SettledRowsLoading /> : null}
        {settledSearchStatus === "error" ? <SettledRowsFailed onRetry={settledLoading?.onRetrySearch} /> : null}
        {!groupedCurrentActivity.length && !hasSettled && searchQuery && settledSearchStatus !== "loading" && settledSearchStatus !== "error" ? (
          <EmptyState
            icon={<SearchX />}
            title={splitsMessages.noSearchResults}
            action={onClearSearch ? { label: splitsMessages.clearSearch, onClick: onClearSearch } : null}
          >
            {splitsMessages.noSearchResultsDetail}
          </EmptyState>
        ) : null}
        {!groupedCurrentActivity.length && !hasSettled && !searchQuery && !archivedBatches.length ? (
          <EmptyState
            icon={<Receipt />}
            title={splitsMessages.noEntries}
            action={readOnly ? null : { label: splitsMessages.addExpense, onClick: onAddExpense }}
          >
            {splitsMessages.noEntriesDetail}
          </EmptyState>
        ) : null}
      </div>
    </section>
  );
}
