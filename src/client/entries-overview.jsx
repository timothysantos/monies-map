import { ChevronDown, ChevronRight, RefreshCw } from "lucide-react";

import { SpendingMixChart } from "./category-visuals";
import { messages } from "./copy/en-SG";
import { moniesClient } from "./monies-client-service";
import { CategoryGlyph, FilterMultiSelect, FilterSelect } from "./ui-components";

const { categories: categoryService, entries: entryService, format: formatService } = moniesClient;

// The strip shows the same filtered dataset in four different accounting views:
// spend, income, net, and total outflow.
export function EntriesTotalsStrip({
  showExpenseBreakdown,
  entryTotals,
  entryOutflowMinor,
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
        <strong className={entryService.getAmountToneClass(-entryTotals.grossSpendMinor)}>{formatService.money(entryTotals.grossSpendMinor)}</strong>
        {entryTotals.grossSpendMinor !== entryTotals.spendMinor ? (
          <span className="entries-totals-secondary">({formatService.money(entryTotals.spendMinor)})</span>
        ) : null}
      </span>
      <span className="entries-totals-item">
        <span className="entries-totals-label">{messages.entries.totalIncome}</span>
        <strong className={entryService.getAmountToneClass(entryTotals.incomeMinor)}>{formatService.money(entryTotals.incomeMinor)}</strong>
      </span>
      <span className="entries-totals-item">
        <span className="entries-totals-label">{messages.entries.totalDifference}</span>
        <strong className={entryService.getAmountToneClass(entryNetMinor)}>{formatService.money(entryNetMinor)}</strong>
      </span>
      <span className="entries-totals-item">
        <span className="entries-totals-label">{messages.entries.totalOutflow}</span>
        <strong className={entryService.getAmountToneClass(-entryOutflowMinor)}>{formatService.money(entryOutflowMinor)}</strong>
      </span>
      <div className="entries-totals-spacer" />
      <button type="button" className="subtle-action is-primary entries-add-inline" onClick={onAddEntry}>
        {messages.entries.addEntry}
      </button>
    </section>
  );
}

export function EntriesBreakdownPanel({ expenseBreakdown, categories }) {
  return (
    <section className="entries-breakdown-panel">
      <div className="entries-breakdown-chart">
        {expenseBreakdown.length ? (
          <SpendingMixChart
            data={expenseBreakdown}
            categories={categories}
            totalLabel={messages.entries.totalSpend}
            compact
            height={300}
            innerRadius={58}
            outerRadius={96}
          />
        ) : (
          <p className="lede compact">{messages.entries.noSpendBreakdown}</p>
        )}
      </div>
      <div className="entries-breakdown-list category-list">
        {expenseBreakdown.map((item, index) => {
          const theme = categoryService.getTheme(categories, item, index);
          return (
            <div key={item.key} className="category-row">
              <div className="category-key">
                <span className="category-icon category-icon-static" style={{ "--category-color": theme.color }}>
                  <CategoryGlyph iconKey={theme.iconKey} />
                </span>
                <div>
                  <strong>{item.label}</strong>
                  <p>{formatService.money(item.valueMinor)} • {item.entryCount} {item.entryCount === 1 ? "entry" : "entries"}</p>
                </div>
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
  hideToggle = false,
  hideRefresh = false,
  onToggleMobileFilters,
  onChangeFilter,
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
        <FilterSelect
          label={messages.entries.category}
          value={entryFilters.category}
          options={entryCategoryOptions}
          emptyLabel={messages.entries.allCategories}
          onChange={(value) => onChangeFilter("category", value)}
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
