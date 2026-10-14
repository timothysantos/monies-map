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
import { CategoryGlyph, DetailRow, DetailRows, LeadCard } from "./ui-components";
import { PrivateMoney } from "./money-privacy";
import { moneyToneClass } from "./money-tone-class";
import { paletteColour } from "./palette-colour";

const { categories: categoryService, format: formatService } = moniesClient;

// The Entries top (design.md, "Entries top"; Lead · Support · Detail): what
// was spent this month as the lead in plain ink, then Income, Difference,
// Transfers and Outflow as four pills (a tint only where the money has a
// direction), and Detail rows for the category breakdown and, on a phone,
// the filters (which live in the View and scope sheet). `model` is
// buildEntriesTotalsModel's shape: the same filtered figures the old
// sideways strip showed, which clipped at 390 and 1024 px. The lead and
// every pill are openable figures (design.md "Openable figures",
// figure-menu.js): View entries narrows this list to the rows behind the
// figure (entry_figure), and the figure stays the same.
export function EntriesTotals({
  model,
  showExpenseBreakdown,
  onToggleExpenseBreakdown,
  filtersValue = "",
  onOpenFilters = undefined
}) {
  const copy = messages.entries.totals;
  const shareAside = model.spent.shareMinor === null ? null : (
    <>{copy.shareAside(model.personLabel)} <PrivateMoney>{formatService.money(model.spent.shareMinor)}</PrivateMoney></>
  );
  return (
    <section className="entries-totals" aria-label={messages.entries.totalsLabel}>
      <div className="entries-totals-main">
        <LeadCard
          className="entries-totals-lead"
          eyebrow={model.eyebrow}
          amount={<span {...openFigure(model.figure || "expenses")}><PrivateMoney>{formatService.money(model.spent.amountMinor)}</PrivateMoney></span>}
          tone={model.spent.tone}
          amountAside={shareAside}
        />
        <DetailRows label={messages.entries.totalsLabel} className="entries-totals-rows">
          <DetailRow
            label={copy.spendingByCategory}
            // No value to show; the empty node keeps the row's chevron.
            value={<span className="lsd-row-text" />}
            data-row="breakdown"
            aria-expanded={showExpenseBreakdown}
            onClick={onToggleExpenseBreakdown}
          />
          {onOpenFilters ? (
            <DetailRow
              label={copy.filters}
              value={filtersValue}
              data-row="filters"
              aria-haspopup="dialog"
              onClick={onOpenFilters}
            />
          ) : null}
        </DetailRows>
      </div>
      <div className="entries-totals-pills">
        {model.pills.map((pill) => (
          <div key={pill.key} className={`entries-totals-pill ${moneyToneClass(pill.tone, "soft")}`} data-pill={pill.key} {...openFigure(PILL_FIGURES[pill.key])}>
            <span className="entries-totals-label">{PILL_LABELS[pill.key]}</span>
            <strong><PrivateMoney>{formatService.money(pill.amountMinor)}</PrivateMoney></strong>
            {pill.shareMinor === null ? null : (
              <small className="entries-totals-secondary">
                {copy.pillShare(model.personLabel)} <PrivateMoney>{formatService.money(pill.shareMinor)}</PrivateMoney>
              </small>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}

// The money figure each pill is (src/domain/money-figures.ts).
const PILL_FIGURES = { income: "earned", difference: "difference", transfers: "transfers", outflow: "outflow" };
const openFigure = (fig) => ({ "data-fig": fig, role: "button", tabIndex: 0 });

const PILL_LABELS = {
  income: messages.entries.totalIncome,
  difference: messages.entries.totalDifference,
  transfers: messages.entries.totalTransfersOut,
  outflow: messages.entries.totalOutflow
};

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
          <EmptyState compact title={messages.entries.noSpendBreakdown}>{messages.entries.noSpendBreakdownDetail}</EmptyState>
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
                <span className="category-icon category-icon-static" style={{ "--category-color": paletteColour(theme.color) }}>
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
