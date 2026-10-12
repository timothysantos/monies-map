import "./summary-body.css";
import { useMemo, useState } from "react";
import { ChevronDown, ChevronRight, ChevronUp } from "lucide-react";

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
import { getCategory, getCategoryTheme } from "./category-utils";
import { paletteColour } from "./palette-colour";
import { money } from "./formatters";
import { PrivateMoney } from "./money-privacy";
import { EmptyState } from "./ui-states";
import { DetailRows } from "./ui-components";
import { useIsMobileLayout } from "./use-viewport";

// Spending Mix: spending by category as a donut with no labels on it and a
// ranked list of the categories (design.md, "Summary body"): the 44 px
// bubble (edits the category), the name, amount and share, a thin bar, and
// an arrow that opens Entries for the category. The top five show; "Show all
// N" lists the rest. It follows the Summary tab's month choice: Summary (All
// months) passes the range's share, the Month page the picked month's
// (month-spending-mix.js). A row's main tap hides or shows its slice. Without
// spending it shows the empty state the Entries breakdown uses.
const TOP_COUNT = 5;
// With no labels around it the ring needs no margin, so the phone one is small.
const DONUT_SIZE = {
  phone: { height: 216, innerRadius: 60, outerRadius: 92 },
  wide: { height: 300, innerRadius: 82, outerRadius: 128 }
};
const mixCopy = messages.summary.mixList;

export function SpendingMixSection({
  donutData,
  categories,
  onCategoryAppearanceChange,
  onOpenEntriesForCategory,
  className = ""
}) {
  const [hiddenCategoryIds, setHiddenCategoryIds] = useState(() => new Set());
  const [showAll, setShowAll] = useState(false);
  const isMobileLayout = useIsMobileLayout();
  const visibleDonutData = useMemo(
    () => getVisibleDonutData(donutData, hiddenCategoryIds),
    [donutData, hiddenCategoryIds]
  );
  const visibleTotalMinor = sumDonutValueMinor(visibleDonutData);
  // Shares are of all spending, so they do not move when a slice is hidden.
  const totalMinor = sumDonutValueMinor(donutData);
  // Hidden categories stay hidden across months and ranges; the reset counts
  // only the ones this data has, so a month without them shows no reset.
  const hiddenCount = donutData.filter((item) => hiddenCategoryIds.has(getDonutItemId(item))).length;
  const listedData = showAll ? donutData : donutData.slice(0, TOP_COUNT);

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
          <div className="summary-mix-chart">
            <SpendingMixChart
              data={visibleDonutData}
              categories={categories}
              totalMinor={visibleTotalMinor}
              callouts={false}
              {...(isMobileLayout ? DONUT_SIZE.phone : DONUT_SIZE.wide)}
            />
            {hiddenCount ? (
              <button type="button" className="subtle-action donut-reset-action" onClick={() => setHiddenCategoryIds(new Set())}>
                {messages.common.resetHiddenCategories(hiddenCount)}
              </button>
            ) : null}
          </div>

          <DetailRows className="summary-mix-list" label={messages.summary.spendingMix}>
            {listedData.map((item, index) => {
              const category = getCategory(categories, item);
              const categoryName = category?.name ?? item.label;
              const isHidden = hiddenCategoryIds.has(getDonutItemId(item));
              const share = totalMinor ? (item.valueMinor / totalMinor) * 100 : 0;
              return (
                <div
                  key={item.key}
                  className={`summary-mix-row ${isHidden ? "is-hidden-from-donut" : ""}`}
                  style={{ "--bar-color": paletteColour(getCategoryTheme(categories, item, index).color) }}
                >
                  <CategoryAppearancePopover category={category} onChange={onCategoryAppearanceChange} />
                  <button
                    type="button"
                    className="summary-mix-main"
                    aria-pressed={!isHidden}
                    onClick={() => toggleCategoryVisibility(item)}
                  >
                    <span className="summary-mix-head">
                      <strong className="summary-mix-name">{categoryName}</strong>
                      <span className="summary-mix-amount"><PrivateMoney>{money(item.valueMinor)}</PrivateMoney></span>
                    </span>
                    <span className="summary-mix-meter">
                      <span className="summary-mix-bar"><span className="summary-mix-bar-fill" style={{ width: `${share.toFixed(1)}%` }} /></span>
                      <span className="summary-mix-percent">{share.toFixed(1)}%</span>
                      {isHidden ? <span className="summary-mix-state">{messages.common.hiddenFromChart}</span> : null}
                    </span>
                  </button>
                  <button
                    type="button"
                    className="summary-mix-arrow"
                    aria-label={messages.common.viewEntriesFor(categoryName)}
                    title={messages.common.viewEntries}
                    onClick={() => onOpenEntriesForCategory(categoryName)}
                  >
                    <ChevronRight size={18} />
                  </button>
                </div>
              );
            })}
            {donutData.length > TOP_COUNT ? (
              <button type="button" className="lsd-row summary-mix-more" aria-expanded={showAll} onClick={() => setShowAll((current) => !current)}>
                {showAll ? mixCopy.showFewer : mixCopy.showAll(donutData.length)}
                {showAll ? <ChevronUp size={16} aria-hidden="true" /> : <ChevronDown size={16} aria-hidden="true" />}
              </button>
            ) : null}
          </DetailRows>
        </div>
      ) : (
        <EmptyState>{messages.entries.noSpendBreakdown}</EmptyState>
      )}
    </section>
  );
}
