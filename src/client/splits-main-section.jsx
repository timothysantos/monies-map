import { ChevronRight } from "lucide-react";

import { SpendingMixChart } from "./category-visuals";
import { messages } from "./copy/en-SG";
import { SplitActivityGroups } from "./splits-activity";
import { SplitMatchesList } from "./splits-matches";
import { money } from "./formatters";
import { CategoryGlyph, getIconComponent } from "./ui-components";

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
  visibleMatches,
  groupedCurrentActivity,
  archivedBatches,
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
  onEditLinkedEntry
}) {
  return (
    <>
      <section className="splits-groups-row">
        <div className="splits-group-pills">
          {groups.map((group) => {
            const Icon = getIconComponent(group.iconKey);
            return (
              <button
                key={group.id}
                type="button"
                className={`split-group-pill ${group.id === activeGroup?.id && selectedMode !== "matches" ? "is-active" : ""}`}
                onClick={() => onSelectGroup(group.id)}
              >
                <span className="split-group-pill-icon"><Icon size={18} strokeWidth={2.1} /></span>
                <span className="split-group-pill-content">
                  <strong>{group.name}</strong>
                  <span>{group.summaryText}</span>
                  <span>{group.entryCount} {messages.splits.entries}</span>
                </span>
              </button>
            );
          })}
          <button
            type="button"
            className={`split-group-pill split-matches-pill ${selectedMode === "matches" ? "is-active" : ""}`}
            onClick={() => onSelectMatches(activeGroup?.id ?? defaultGroupId)}
          >
            <span className="split-group-pill-content">
              <strong>{messages.splits.matches}</strong>
              <span>{pendingMatchCount ? messages.splits.toReview(pendingMatchCount) : messages.splits.allClear}</span>
              <span>{expenseMatchCount} expense, {settlementMatchCount} settle-up</span>
            </span>
          </button>
          <button
            type="button"
            className="split-group-pill split-group-pill-create"
            onClick={onCreateGroup}
            aria-label={messages.splits.createGroup}
          >
            <strong>{messages.splits.addGroup}</strong>
          </button>
        </div>
      </section>

      <section className="entries-summary-strip splits-summary-strip">
        <button
          type="button"
          className={`summary-chevron ${showBreakdown ? "is-open" : ""}`}
          aria-label="Toggle split donut"
          onClick={onToggleBreakdown}
        >
          <ChevronRight size={18} />
        </button>
        <div className="entries-summary-metrics">
          <span>{messages.entries.totalSpend} <strong>{money(totalExpenseMinor)}</strong></span>
          <span>{groupSummaryLabel} <strong className={groupBalanceMinor >= 0 ? "tone-positive" : "tone-negative"}>{money(Math.abs(groupBalanceMinor))}</strong></span>
        </div>
        <div className="splits-summary-actions">
          <button
            type="button"
            className="subtle-action"
            onClick={onAddExpense}
          >
            {messages.splits.addExpense}
          </button>
        </div>
      </section>

      {showBreakdown ? (
        <section className="split-donut-panel">
          {donutRows.length ? (
            <div className="entries-breakdown-panel split-breakdown-panel">
              <div className="entries-breakdown-chart">
                <SpendingMixChart
                  data={donutChart}
                  categories={categories}
                  totalLabel={messages.entries.totalSpend}
                  compact
                  height={300}
                  innerRadius={58}
                  outerRadius={96}
                />
              </div>
              <div className="entries-breakdown-list category-list">
                {donutRows.map((item) => (
                  <div key={item.key} className="category-row">
                    <div className="category-key">
                      <span className="category-icon category-icon-static" style={{ "--category-color": item.theme.color }}>
                        <CategoryGlyph iconKey={item.theme.iconKey} />
                      </span>
                      <div>
                        <strong>{item.label}</strong>
                        <p>{messages.common.triplet(money(item.valueMinor), `${item.entryCount} ${item.entryCount === 1 ? "entry" : "entries"}`, `${((item.valueMinor / Math.max(totalExpenseMinor, 1)) * 100).toFixed(1)}%`)}</p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <p className="lede compact">{messages.splits.noEntries}</p>
          )}
        </section>
      ) : null}

      {selectedMode === "matches" ? (
        <SplitMatchesList
          matches={visibleMatches}
          pendingMatchCount={pendingMatchCount}
          onDismissMatch={onDismissMatch}
          onConfirmMatch={onConfirmMatch}
        />
      ) : (
        <section className="split-list-section">
          <button
            type="button"
            data-splits-fab-trigger="true"
            className="entries-fab-trigger"
            onClick={onAddExpense}
            aria-hidden="true"
            tabIndex={-1}
          />
          <div className="split-activity-list">
            {groupedCurrentActivity.length ? (
              <SplitActivityGroups
                groups={groupedCurrentActivity}
                categories={categories}
                onEditExpense={onEditExpense}
                onEditSettlement={onEditSettlement}
                onEditLinkedEntry={onEditLinkedEntry}
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
      )}
    </>
  );
}
