import { useMemo, useState } from "react";

import { SpendingMixChart } from "./category-visuals";
import { messages } from "./copy/en-SG";
import { EmptyState } from "./ui-states";
import {
  getDonutItemId,
  getVisibleDonutData,
  sumDonutValueMinor,
  toggleHiddenDonutItemIds
} from "./donut-visibility";
import { moniesClient } from "./monies-client-service";
import { CategoryGlyph } from "./ui-components";
import { PrivateMoney } from "./money-privacy";
import { SplitsLeadCard } from "./splits-lead-card";
import { paletteColour } from "./palette-colour";

const { format: formatService } = moniesClient;

export function SplitsBreakdownSection({
  showBreakdown,
  // The active group's currency: its balance and spend are in that currency.
  currency = "SGD",
  lead,
  activeGroup,
  donutRows,
  donutChart,
  categories,
  onToggleBreakdown,
  onAddExpense,
  searchControl = null,
  leadControls,
  onOpenHistory,
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
      {lead ? <SplitsLeadCard
        lead={lead}
        iconKey={activeGroup?.iconKey}
        currency={currency}
        readOnly={readOnly}
        showBreakdown={showBreakdown}
        onToggleBreakdown={onToggleBreakdown}
        onOpenHistory={onOpenHistory}
        onAddExpense={onAddExpense}
        {...leadControls}
      /> : null}
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
                  currency={currency}
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
                      <span className="category-icon category-icon-static" style={{ "--category-color": paletteColour(item.theme.color) }}>
                        <CategoryGlyph iconKey={item.theme.iconKey} />
                      </span>
                      <div>
                        <strong>{item.label}</strong>
                        <p><PrivateMoney>{formatService.moneyWithCurrency(item.valueMinor, currency)}</PrivateMoney> • {item.entryCount} {item.entryCount === 1 ? "entry" : "entries"} • {hiddenCategoryIds.has(getDonutItemId(item)) ? messages.common.hiddenFromChart : messages.common.shownInChart}</p>
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <EmptyState>{messages.splits.noEntries}</EmptyState>
          )}
        </section>
      ) : null}
      {searchControl}
    </>
  );
}
