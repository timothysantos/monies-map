import { useMemo, useState } from "react";
import { ChevronDown, ChevronRight, RefreshCw, Search, X } from "lucide-react";

import { SpendingMixChart } from "./category-visuals";
import { messages } from "./copy/en-SG";
import {
  getDonutItemId,
  getVisibleDonutData,
  sumDonutValueMinor,
  toggleHiddenDonutItemIds
} from "./donut-visibility";
import { moniesClient } from "./monies-client-service";
import { CategoryGlyph, FilterMultiSelect, FilterSelect } from "./ui-components";
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

// The filter bar is URL-state driven by the panel; this component only renders
// controls so the URL synchronization stays in one place.
export function EntriesFilterStack({
  showMobileFilters,
  activeEntryFilterCount,
  entryFilters,
  wallets,
  entryCategoryOptions,
  searchSuggestions = [],
  hideToggle = false,
  hideRefresh = false,
  onToggleMobileFilters,
  onChangeFilter,
  onChangeSearch,
  onResetFilters,
  onRefresh,
  onDone
}) {
  const isOpen = hideToggle ? true : showMobileFilters;

  return (
    <section className={`entries-filter-stack ${isOpen ? "is-open" : ""}`}>
      {!hideToggle ? (
        <button type="button" className="entries-filter-toggle" onClick={onToggleMobileFilters}>
          <span>{activeEntryFilterCount ? `Filters · ${activeEntryFilterCount}` : "Filters"}</span>
          <span>{isOpen ? "Hide" : "Show"}</span>
        </button>
      ) : null}
      <section className="entries-filter-bar">
        {!hideRefresh ? (
          <button
            type="button"
            className="icon-action entries-filter-refresh"
            onClick={() => void onRefresh?.()}
            aria-label={messages.common.refresh}
            title={messages.common.refresh}
          >
            <RefreshCw size={18} />
          </button>
        ) : null}
        <SearchFilterInput
          label={messages.common.search}
          value={entryFilters.search}
          placeholder={messages.entries.searchPlaceholder}
          suggestions={searchSuggestions}
          listId="entries-search-suggestions"
          onChange={(value) => onChangeSearch?.(value) ?? onChangeFilter("search", value)}
        />
        <FilterMultiSelect
          label={messages.entries.wallet}
          values={entryFilters.wallets}
          options={wallets}
          emptyLabel={messages.entries.allWallets}
          selectionLabel={(selectedOptions) => {
            if (selectedOptions.length === 1) {
              return selectedOptions[0].label;
            }
            return `${selectedOptions.length} wallets`;
          }}
          onChange={(values) => onChangeFilter("wallet", values)}
        />
        <FilterMultiSelect
          label={messages.entries.category}
          values={entryFilters.categories}
          options={entryCategoryOptions}
          emptyLabel={messages.entries.allCategories}
          selectionLabel={(selectedOptions) => {
            if (selectedOptions.length === 1) {
              return selectedOptions[0].label;
            }
            return `${selectedOptions.length} categories`;
          }}
          onChange={(values) => onChangeFilter("category", values)}
        />
        <FilterSelect
          label={messages.entries.type}
          value={entryFilters.type}
          options={["expense", "income", "transfer"]}
          emptyLabel={messages.entries.allTypes}
          onChange={(value) => onChangeFilter("type", value)}
        />
        <div className="entries-filter-reset">
          <button type="button" className="subtle-action" onClick={onResetFilters}>
            {messages.entries.resetFilters}
          </button>
          <button
            type="button"
            className="subtle-action entries-filter-hide"
            onClick={onDone ?? onToggleMobileFilters}
          >
            {onDone ? "Done" : "Hide"}
          </button>
        </div>
      </section>
    </section>
  );
}

export function SearchFilterInput({
  label,
  value = "",
  placeholder = "Search",
  suggestions = [],
  listId,
  className = "",
  onChange
}) {
  return (
    <label className={`entries-filter search-filter ${className}`.trim()}>
      <span className="entries-filter-label">{label}</span>
      <span className="search-filter-control">
        <Search size={16} aria-hidden="true" />
        <input
          className="table-edit-input search-filter-input"
          value={value ?? ""}
          placeholder={placeholder}
          enterKeyHint="search"
          autoComplete="off"
          list={listId}
          onChange={(event) => onChange(event.target.value)}
        />
        {value ? (
          <button
            type="button"
            className="search-filter-clear"
            aria-label={`Clear ${label.toLowerCase()}`}
            onClick={() => onChange("")}
          >
            <X size={15} />
          </button>
        ) : null}
      </span>
      {listId ? (
        <datalist id={listId}>
          {suggestions.map((suggestion) => (
            <option key={suggestion} value={suggestion} />
          ))}
        </datalist>
      ) : null}
    </label>
  );
}
