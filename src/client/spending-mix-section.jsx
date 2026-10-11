import { useMemo, useState } from "react";
import { ChevronRight } from "lucide-react";

import {
  CategoryAppearancePopover,
  SpendingMixChart
} from "./category-visuals";
import { messages } from "./copy/en-SG";
import {
  getDonutItemId,
  getVisibleDonutData,
  sumDonutValueMinor,
  toggleHiddenDonutItemIds
} from "./donut-visibility";
import { moniesClient } from "./monies-client-service";
import { PrivateMoney } from "./money-privacy";
import { EmptyState } from "./ui-states";

const {
  categories: categoryService,
  format: formatService
} = moniesClient;

// Spending Mix: spending by category as a donut and one card per category.
// It follows the Summary tab's month choice: Summary (All months) passes the
// range's share, the Month page the picked month's (month-spending-mix.js).
// A card's main button hides or shows its slice; its arrow opens Entries for
// the category (the page decides the month and scope of that drilldown).
// Without spending it shows the empty state the Entries breakdown uses.
export function SpendingMixSection({
  donutData,
  categories,
  onCategoryAppearanceChange,
  onOpenEntriesForCategory,
  className = ""
}) {
  const [hiddenCategoryIds, setHiddenCategoryIds] = useState(() => new Set());
  const visibleDonutData = useMemo(
    () => getVisibleDonutData(donutData, hiddenCategoryIds),
    [donutData, hiddenCategoryIds]
  );
  const visibleTotalMinor = sumDonutValueMinor(visibleDonutData);
  // Hidden categories stay hidden across months and ranges; the reset counts
  // only the ones this data has, so a month without them shows no reset.
  const hiddenCount = donutData.filter((item) => hiddenCategoryIds.has(getDonutItemId(item))).length;

  function toggleCategoryVisibility(item) {
    setHiddenCategoryIds((current) => toggleHiddenDonutItemIds(current, getDonutItemId(item)));
  }

  return (
    <section className={["chart-card", className].filter(Boolean).join(" ")}>
      <div className="chart-head">
        <h3>{messages.summary.spendingMix}</h3>
      </div>
      {donutData.length ? (
        <div className="summary-mix">
          <div className="summary-mix-main">
            <SpendingMixChart
              data={visibleDonutData}
              categories={categories}
              totalMinor={visibleTotalMinor}
            />
            {hiddenCount ? (
              <button type="button" className="subtle-action donut-reset-action" onClick={() => setHiddenCategoryIds(new Set())}>
                {messages.common.resetHiddenCategories(hiddenCount)}
              </button>
            ) : null}

            <div className="share-list">
              {donutData.map((item) => {
                const category = categoryService.get(categories, item);
                const categoryName = category?.name ?? item.label;
                const isHidden = hiddenCategoryIds.has(getDonutItemId(item));
                return (
                  <div key={item.key} className={`share-row chart-toggle-row ${isHidden ? "is-hidden-from-donut" : ""}`}>
                    <div className="category-key">
                      <CategoryAppearancePopover
                        category={category}
                        onChange={onCategoryAppearanceChange}
                      />
                      <button
                        type="button"
                        className="share-row-button"
                        aria-pressed={!isHidden}
                        onClick={() => toggleCategoryVisibility(item)}
                      >
                        <strong>{categoryName}</strong>
                        <p><PrivateMoney>{formatService.money(item.valueMinor)}</PrivateMoney></p>
                        <span className="share-row-meta">
                          {messages.common.triplet(formatTransactionCount(item.entryCount), isHidden ? messages.common.hiddenFromChart : messages.common.shownInChart)}
                        </span>
                      </button>
                      <button
                        type="button"
                        className="icon-action share-row-secondary-action"
                        aria-label={messages.common.viewEntriesFor(categoryName)}
                        title={messages.common.viewEntries}
                        onClick={() => onOpenEntriesForCategory(categoryName)}
                      >
                        <ChevronRight size={18} />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      ) : (
        <EmptyState>{messages.entries.noSpendBreakdown}</EmptyState>
      )}
    </section>
  );
}

function formatTransactionCount(entryCount) {
  return entryCount === 1 ? "1 transaction" : `${entryCount ?? 0} transactions`;
}
