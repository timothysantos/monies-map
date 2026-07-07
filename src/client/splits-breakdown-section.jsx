import { ChevronRight } from "lucide-react";
import { useMemo, useState } from "react";

import { SpendingMixChart } from "./category-visuals";
import { messages } from "./copy/en-SG";
import {
  getDonutItemId,
  getVisibleDonutData,
  sumDonutValueMinor,
  toggleHiddenDonutItemIds
} from "./donut-visibility";
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
  const [hiddenCategoryIds, setHiddenCategoryIds] = useState(() => new Set());
  const visibleDonutChart = useMemo(
    () => getVisibleDonutData(donutChart, hiddenCategoryIds),
    [donutChart, hiddenCategoryIds]
  );
  const visibleTotalMinor = sumDonutValueMinor(visibleDonutChart);

  function toggleCategoryVisibility(item) {
    setHiddenCategoryIds((current) => toggleHiddenDonutItemIds(current, getDonutItemId(item)));
  }

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
                  data={visibleDonutChart}
                  categories={categories}
                  totalMinor={visibleTotalMinor}
                  totalLabel={messages.entries.totalSpend}
                  compact
                  height={300}
                  innerRadius={58}
                  outerRadius={96}
                />
                {hiddenCategoryIds.size ? (
                  <button type="button" className="subtle-action donut-reset-action" onClick={() => setHiddenCategoryIds(new Set())}>
                    {messages.common.resetHiddenCategories(hiddenCategoryIds.size)}
                  </button>
                ) : null}
              </div>
              <div className="entries-breakdown-list category-list">
                {donutRows.map((item) => (
                  <button
                    key={item.key}
                    type="button"
                    className={`category-row category-row-button ${hiddenCategoryIds.has(getDonutItemId(item)) ? "is-hidden-from-donut" : ""}`}
                    aria-pressed={!hiddenCategoryIds.has(getDonutItemId(item))}
                    onClick={() => toggleCategoryVisibility(item)}
                  >
                    <div className="category-key">
                      <span className="category-icon category-icon-static" style={{ "--category-color": item.theme.color }}>
                        <CategoryGlyph iconKey={item.theme.iconKey} />
                      </span>
                      <div>
                        <strong>{item.label}</strong>
                        <p>{messages.common.triplet(formatService.money(item.valueMinor), `${item.entryCount} ${item.entryCount === 1 ? "entry" : "entries"}`, hiddenCategoryIds.has(getDonutItemId(item)) ? messages.common.hiddenFromChart : messages.common.shownInChart)}</p>
                      </div>
                    </div>
                  </button>
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
