import { Link2 } from "lucide-react";
import { memo } from "react";

import { messages } from "./copy/en-SG";
import { moniesClient } from "./monies-client-service";
import { useMoneyPrivacy } from "./money-privacy";
import { SheetDialog } from "./sheet-dialog";
import { EmptyState } from "./ui-states";
import { DetailRow, DetailRows, LeadCard, MetaChip } from "./ui/lead-support-detail";

const { format: formatService } = moniesClient;

const FILTERS = [
  ["filterLinkedOnly", "Linked"],
  ["filterSameCategoryOnly", "Same category"],
  ["filterSameAccountOnly", "Same account"],
  ["filterCurrentMonthOnly", "This month only"]
];

// "Match planned item": link exact ledger entries to a planned item. The lead
// is the planned item (its category bubble, name, planned amount) with what is
// already linked as a chip; the filters narrow the list, the list holds the
// checkboxes, and Save matches is the primary action. On a phone, and on a
// portrait tablet (`asSheet`), it is the shared bottom sheet.
export function MonthPlanLinkDialog({
  asSheet,
  planLinkDialog,
  row,
  category,
  allCandidates,
  candidates,
  selectedIds,
  isSaving = false,
  isDirty = false,
  errorMessage = "",
  onClose,
  onToggleFilter,
  onDescriptionFilterChange,
  onToggleEntry,
  onSave
}) {
  const label = row?.label ?? "this planned item";
  const hasPlan = typeof row?.plannedMinor === "number";
  return (
    <SheetDialog
      wide
      asSheet={asSheet}
      // Only the wide dialog carries the legacy dialog class: the tests that
      // tell a dialog from a sheet look for it.
      className={asSheet ? "planned-link-body" : "planned-link-body planned-link-dialog"}
      title="Match planned item"
      description={`Link exact ledger entries to ${label}. Budget buckets still use category totals.`}
      descriptionHidden
      closeLabel="Close planned item matching"
      lead={(
        <LeadCard
          className="sheet-dialog-lead"
          category={category}
          title={label}
          subtitle={row?.categoryName || null}
          amount={hasPlan ? formatService.money(row.plannedMinor) : null}
          tone="plan"
          amountCaption={hasPlan ? "planned" : null}
          chips={(
            <>
              {row?.accountName ? <MetaChip>{row.accountName}</MetaChip> : null}
              <MetaChip icon={Link2}>{`${selectedIds.size} linked`}</MetaChip>
            </>
          )}
        >
          <p className="lsd-note">Budget buckets still use category totals.</p>
        </LeadCard>
      )}
      errorMessage={errorMessage}
      primaryLabel={isSaving ? messages.common.saving : "Save matches"}
      primaryDisabled={isSaving}
      quietLabel={messages.month.cancelEdit}
      isSubmitting={isSaving}
      isDirty={isDirty}
      onSubmit={onSave}
      onClose={onClose}
    >
      <div className="planned-link-filter-panel">
        <div className="planned-link-filter-chips" aria-label="Match filters">
          {FILTERS.map(([key, filterLabel]) => (
            <button
              key={key}
              type="button"
              className={`planned-link-filter-chip ${planLinkDialog?.[key] ? "is-active" : ""}`}
              aria-pressed={Boolean(planLinkDialog?.[key])}
              onClick={() => onToggleFilter(key)}
            >
              {filterLabel}
            </button>
          ))}
        </div>
        <p className="planned-link-filter-summary">
          Showing {candidates.length} of {allCandidates.length} candidate entries.
        </p>
        <DetailRows>
          <DetailRow label="Description filter">
            <input
              type="text"
              placeholder="Filter descriptions in this list"
              value={planLinkDialog?.descriptionFilter ?? ""}
              enterKeyHint="next"
              onChange={(event) => onDescriptionFilterChange(event.target.value)}
            />
          </DetailRow>
        </DetailRows>
      </div>
      {candidates.length ? (
        <div className="planned-link-list">
          {candidates.map((entry) => (
            <MemoizedPlanLinkCandidateRow
              key={entry.id}
              entry={entry}
              checked={selectedIds.has(entry.id)}
              onToggleEntry={onToggleEntry}
            />
          ))}
        </div>
      ) : (
        <EmptyState>{messages.month.planLinkNoCandidates}</EmptyState>
      )}
    </SheetDialog>
  );
}

// Memoized: a checkbox or filter change re-renders only the rows it changes.
// It subscribes to money privacy because the shared formatter reads it.
function PlanLinkCandidateRow({ entry, checked, onToggleEntry }) {
  useMoneyPrivacy();
  return (
    <label className="planned-link-row">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onToggleEntry(entry.id, event.target.checked)}
      />
      <span className="planned-link-row-main">
        <strong>{entry.description}</strong>
        <small>{formatService.formatDateOnly(entry.date)} • {entry.accountName} • {entry.categoryName}</small>
        {entry.matchReasons?.length ? <em>{entry.matchReasons.slice(0, 3).join(" · ")}</em> : null}
      </span>
      <span>{formatService.money(entry.amountMinor)}</span>
    </label>
  );
}

const MemoizedPlanLinkCandidateRow = memo(PlanLinkCandidateRow);
