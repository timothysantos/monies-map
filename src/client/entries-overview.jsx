import { ChevronDown, ChevronRight, RefreshCw } from "lucide-react";

import { SpendingMixChart } from "./category-visuals";
import { getCategoryTheme } from "./category-utils";
import { messages } from "./copy/en-SG";
import { getAmountToneClass } from "./entry-helpers";
import { money } from "./formatters";
import { CategoryGlyph, FilterSelect } from "./ui-components";

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
        <strong className={getAmountToneClass(-entryTotals.spendMinor)}>{money(entryTotals.spendMinor)}</strong>
      </span>
      <span className="entries-totals-item">
        <span className="entries-totals-label">{messages.entries.totalIncome}</span>
        <strong className={getAmountToneClass(entryTotals.incomeMinor)}>{money(entryTotals.incomeMinor)}</strong>
      </span>
      <span className="entries-totals-item">
        <span className="entries-totals-label">{messages.entries.totalDifference}</span>
        <strong className={getAmountToneClass(entryNetMinor)}>{money(entryNetMinor)}</strong>
      </span>
      <span className="entries-totals-item">
        <span className="entries-totals-label">{messages.entries.totalOutflow}</span>
        <strong className={getAmountToneClass(-entryOutflowMinor)}>{money(entryOutflowMinor)}</strong>
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
          const theme = getCategoryTheme(categories, item, index);
          return (
            <div key={item.key} className="category-row">
              <div className="category-key">
                <span className="category-icon category-icon-static" style={{ "--category-color": theme.color }}>
                  <CategoryGlyph iconKey={theme.iconKey} />
                </span>
                <div>
                  <strong>{item.label}</strong>
                  <p>{money(item.valueMinor)} • {item.entryCount} {item.entryCount === 1 ? "entry" : "entries"}</p>
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
  peopleFilterOptions,
  onToggleMobileFilters,
  onChangeFilter,
  onResetFilters,
  onRefresh
}) {
  return (
    <section className={`entries-filter-stack ${showMobileFilters ? "is-open" : ""}`}>
      <button type="button" className="entries-filter-toggle" onClick={onToggleMobileFilters}>
        <span>{activeEntryFilterCount ? `Filters · ${activeEntryFilterCount}` : "Filters"}</span>
        <span>{showMobileFilters ? "Hide" : "Show"}</span>
      </button>
      <section className="entries-filter-bar">
        <button
          type="button"
          className="icon-action entries-filter-refresh"
          onClick={() => void onRefresh?.()}
          aria-label={messages.common.refresh}
          title={messages.common.refresh}
        >
          <RefreshCw size={18} />
        </button>
        <FilterSelect
          label={messages.entries.wallet}
          value={entryFilters.wallet}
          options={wallets}
          emptyLabel={messages.entries.allWallets}
          onChange={(value) => onChangeFilter("wallet", value)}
        />
        <FilterSelect
          label={messages.entries.category}
          value={entryFilters.category}
          options={entryCategoryOptions}
          emptyLabel={messages.entries.allCategories}
          onChange={(value) => onChangeFilter("category", value)}
        />
        <FilterSelect
          label={messages.entries.person}
          value={entryFilters.person}
          options={peopleFilterOptions}
          emptyLabel={messages.entries.allPeople}
          onChange={(value) => onChangeFilter("person", value)}
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
        </div>
      </section>
    </section>
  );
}
