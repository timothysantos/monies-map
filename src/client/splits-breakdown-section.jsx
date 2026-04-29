import { ChevronRight } from "lucide-react";

import { SpendingMixChart } from "./category-visuals";
import { messages } from "./copy/en-SG";
import { moniesClient } from "./monies-client-service";
import { CategoryGlyph } from "./ui-components";

const { format: formatService } = moniesClient;

export function SplitsBreakdownSection({
  showBreakdown,
  totalExpenseMinor,
  groupBalanceMinor,
  groupSummaryLabel,
  donutRows,
  donutChart,
  categories,
  onToggleBreakdown,
  onAddExpense,
  summaryToolbar = null,
  isRefreshingDerived = false,
  readOnly = false
}) {
  return (
    <>
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
          {!readOnly ? (
            <span>{groupSummaryLabel} <strong className={groupBalanceMinor >= 0 ? "tone-positive" : "tone-negative"}>{formatService.money(Math.abs(groupBalanceMinor))}</strong></span>
          ) : null}
          <span>{messages.entries.totalSpend} <strong>{formatService.money(totalExpenseMinor)}</strong></span>
        </div>
        {summaryToolbar}
        {!readOnly ? (
          <div className="splits-summary-actions">
            <button
              type="button"
              className="subtle-action"
              onClick={onAddExpense}
            >
              {messages.splits.addExpense}
            </button>
          </div>
        ) : null}
      </section>
      {isRefreshingDerived ? (
        <div className="split-derived-refreshing" role="status" aria-live="polite">
          <span className="app-spinner" aria-hidden="true" />
          <span>Group balances and shared totals are updating.</span>
        </div>
      ) : null}

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
                        <p>{messages.common.triplet(formatService.money(item.valueMinor), `${item.entryCount} ${item.entryCount === 1 ? "entry" : "entries"}`, `${((item.valueMinor / Math.max(totalExpenseMinor, 1)) * 100).toFixed(1)}%`)}</p>
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
    </>
  );
}
