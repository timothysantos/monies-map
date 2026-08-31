import { useMemo, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";

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
import { PrivateMoney } from "./money-privacy";

const { categories: categoryService, entries: entryService, format: formatService } = moniesClient;

// The strip shows the same filtered dataset in four different accounting views:
// spend, income, net, and total outflow.
export function EntriesTotalsStrip({
  showExpenseBreakdown,
  entryTotals,
  entryOutflowMinor,
  entryGrossOutflowMinor,
  entryNetMinor,
  onToggleExpenseBreakdown,
  onAddEntry
}) {
  return (
    <section className="entries-totals-strip" aria-label={messages.entries.totalsLabel}>
      <button
        type="button"
        className={`entries-breakdown-toggle ${showExpenseBreakdown ? "is-open" : ""}`}
        onClick={onToggleExpenseBreakdown}
        aria-expanded={showExpenseBreakdown}
        aria-label={showExpenseBreakdown ? "Hide expense breakdown" : "Show expense breakdown"}
      >
        {showExpenseBreakdown ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
      </button>
      <span className="entries-totals-item">
        <span className="entries-totals-label">{messages.entries.totalSpend}</span>
        <strong className={entryService.getAmountToneClass(-entryTotals.grossSpendMinor)}><PrivateMoney>{formatService.money(entryTotals.grossSpendMinor)}</PrivateMoney></strong>
        {entryTotals.grossSpendMinor !== entryTotals.spendMinor ? (
          <span className="entries-totals-secondary">(<PrivateMoney>{formatService.money(entryTotals.spendMinor)}</PrivateMoney>)</span>
        ) : null}
      </span>
      <span className="entries-totals-item">
        <span className="entries-totals-label">{messages.entries.totalIncome}</span>
        <strong className={entryService.getAmountToneClass(entryTotals.incomeMinor)}><PrivateMoney>{formatService.money(entryTotals.incomeMinor)}</PrivateMoney></strong>
      </span>
      <span className="entries-totals-item">
        <span className="entries-totals-label">{messages.entries.totalDifference}</span>
        <strong className={entryService.getAmountToneClass(entryNetMinor)}><PrivateMoney>{formatService.money(entryNetMinor)}</PrivateMoney></strong>
      </span>
      <span className="entries-totals-item">
        <span className="entries-totals-label">{messages.entries.totalTransfersOut}</span>
        <strong className={entryService.getAmountToneClass(-entryTotals.grossTransferOutMinor)}><PrivateMoney>{formatService.money(entryTotals.grossTransferOutMinor)}</PrivateMoney></strong>
        {entryTotals.grossTransferOutMinor !== entryTotals.transferOutMinor ? (
          <span className="entries-totals-secondary">(<PrivateMoney>{formatService.money(entryTotals.transferOutMinor)}</PrivateMoney>)</span>
        ) : null}
      </span>
      <span className="entries-totals-item">
        <span className="entries-totals-label">{messages.entries.totalOutflow}</span>
        <strong className={entryService.getAmountToneClass(-entryGrossOutflowMinor)}><PrivateMoney>{formatService.money(entryGrossOutflowMinor)}</PrivateMoney></strong>
        {entryGrossOutflowMinor !== entryOutflowMinor ? (
          <span className="entries-totals-secondary">(<PrivateMoney>{formatService.money(entryOutflowMinor)}</PrivateMoney>)</span>
        ) : null}
      </span>
      <div className="entries-totals-spacer" />
      <button type="button" className="subtle-action is-primary entries-add-inline" onClick={onAddEntry}>
        {messages.entries.addEntry}
      </button>
    </section>
  );
}

export function EntriesBreakdownPanel({
  expenseBreakdown,
  categories,
  selectedCategoryNames = [],
  onChangeCategories
}) {
  const [hiddenCategoryIds, setHiddenCategoryIds] = useState(() => new Set());
  const visibleBreakdown = useMemo(
    () => getVisibleDonutData(expenseBreakdown, hiddenCategoryIds),
    [expenseBreakdown, hiddenCategoryIds]
  );
  const visibleTotalMinor = sumDonutValueMinor(visibleBreakdown);

  function toggleCategoryVisibility(item) {
    setHiddenCategoryIds((current) => toggleHiddenDonutItemIds(current, getDonutItemId(item)));
  }

  function toggleCategoryFilter(categoryName) {
    const selected = Array.isArray(selectedCategoryNames) ? selectedCategoryNames : [];
    const next = selected.includes(categoryName)
      ? selected.filter((item) => item !== categoryName)
      : [...selected, categoryName];
    onChangeCategories?.(next);
  }

  return (
    <section className="entries-breakdown-panel">
      <div className="entries-breakdown-chart">
        {expenseBreakdown.length ? (
          <>
            <SpendingMixChart
              data={visibleBreakdown}
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
          </>
        ) : (
          <p className="lede compact">{messages.entries.noSpendBreakdown}</p>
        )}
      </div>
      <div className="entries-breakdown-list category-list">
        {expenseBreakdown.map((item, index) => {
          const theme = categoryService.getTheme(categories, item, index);
          const itemId = getDonutItemId(item);
          const isHidden = hiddenCategoryIds.has(itemId);
          const categoryName = item.categoryName ?? item.label;
          const isFiltered = selectedCategoryNames.includes(categoryName);
          return (
            <div key={item.key} className={`category-row category-toggle-row ${isHidden ? "is-hidden-from-donut" : ""}`}>
              <div className="category-key">
                <span className="category-icon category-icon-static" style={{ "--category-color": theme.color }}>
                  <CategoryGlyph iconKey={theme.iconKey} />
                </span>
                <div>
                  <strong>{item.label}</strong>
                  <p><PrivateMoney>{formatService.money(item.valueMinor)}</PrivateMoney> • {item.entryCount} {item.entryCount === 1 ? "entry" : "entries"}</p>
                </div>
              </div>
              <div className="category-toggle-actions">
                <button
                  type="button"
                  className={`subtle-action chart-toggle-action ${isHidden ? "" : "is-active"}`}
                  aria-pressed={!isHidden}
                  onClick={() => toggleCategoryVisibility(item)}
                >
                  {isHidden ? messages.common.hiddenFromChart : messages.common.shownInChart}
                </button>
                <button
                  type="button"
                  className={`subtle-action filter-toggle-action ${isFiltered ? "is-active" : ""}`}
                  aria-pressed={isFiltered}
                  onClick={() => toggleCategoryFilter(categoryName)}
                >
                  {isFiltered ? messages.entries.filtered : messages.entries.filter}
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
