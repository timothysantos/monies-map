import { useMemo, useState } from "react";
import { Eye, EyeOff } from "lucide-react";

import { mixShareText, SpendingMixChart, SpendingMixList } from "./category-visuals";
import { messages } from "./copy/en-SG";
import { spendingMixCopy as mixCopy } from "./copy/spending-mix-copy";
import { EmptyState } from "./ui-states";
import {
  getDonutItemId,
  getVisibleDonutData,
  sumDonutValueMinor,
  toggleHiddenDonutItemIds
} from "./donut-visibility";
import { moniesClient } from "./monies-client-service";
import { DetailRow, DetailRows, LeadCard } from "./ui-components";
import { PrivateMoney } from "./money-privacy";
import { moneyToneClass } from "./money-tone-class";
import { paletteColour } from "./palette-colour";
import { rowMotionProps } from "./row-motion";
import { useIsMobileLayout } from "./use-viewport";

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
  breakdownSummary = [],
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
            // Folded, it says the top three shares ("Travel 39% · Other
            // 21% · Church 9%"); without spending the empty node keeps the
            // row's chevron.
            value={<TopShares parts={breakdownSummary} />}
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

// The Entries page's spending by category (design.md "Entries top"): the
// Spending Mix treatment made compact (docs/audits/entries-donut-compact/).
// A donut whose bigger slices carry "Name 32.1%" where there is room and
// tiny ones none (donut-label-layout.js; never a bare share, no icon
// bubbles), every slice an openable figure whose View entries narrows this
// list to the category; and Spending Mix's lean ranked list beside it on a
// wide panel (under it on a phone): the top five (three on a phone), then
// "Show all N". A row is one 44 px line: a colour dot, the name, the
// entries count (wide only), the amount and the share. Its tap filters the
// list to the category, or back (the old "Filter", `aria-pressed`, the
// existing multi-category filter); the eye at its end hides or shows its
// slice (the old "Shown", `aria-pressed`, named for the category). The
// figures are the list's own reading (getExpenseBreakdown over the
// filtered, view-read entries), so a transfer with a purpose counts as the
// list counts it. Shares are of all the panel's spending, so hiding a slice
// does not move them; hidden money keeps the shares and hides the amounts.
const DONUT_SIZE = {
  phone: { height: 260, innerRadius: 62, outerRadius: 96 },
  wide: { height: 300, innerRadius: 72, outerRadius: 108 }
};

export function EntriesBreakdownPanel({
  expenseBreakdown,
  categories,
  selectedCategoryNames = [],
  onChangeCategories
}) {
  const [hiddenCategoryIds, setHiddenCategoryIds] = useState(() => new Set());
  const isMobileLayout = useIsMobileLayout();
  const visibleBreakdown = useMemo(
    () => getVisibleDonutData(expenseBreakdown, hiddenCategoryIds),
    [expenseBreakdown, hiddenCategoryIds]
  );
  const visibleTotalMinor = sumDonutValueMinor(visibleBreakdown);
  const totalMinor = sumDonutValueMinor(expenseBreakdown);
  const hiddenCount = expenseBreakdown.filter((item) => hiddenCategoryIds.has(getDonutItemId(item))).length;
  const selected = Array.isArray(selectedCategoryNames) ? selectedCategoryNames : [];

  function toggleCategoryVisibility(item) {
    setHiddenCategoryIds((current) => toggleHiddenDonutItemIds(current, getDonutItemId(item)));
  }

  function toggleCategoryFilter(categoryName) {
    const next = selected.includes(categoryName)
      ? selected.filter((item) => item !== categoryName)
      : [...selected, categoryName];
    onChangeCategories?.(next);
  }

  return (
    <section className="entries-mix-panel" aria-label={messages.entries.totals.spendingByCategory}>
      {expenseBreakdown.length ? (
        <div className="summary-mix entries-mix">
          <div className="summary-mix-chart">
            <SpendingMixChart
              data={visibleBreakdown}
              categories={categories}
              totalMinor={visibleTotalMinor}
              totalLabel={messages.entries.totalSpend}
              callouts={false}
              sliceLabels
              shareTotalMinor={totalMinor}
              fullSize
              {...DONUT_SIZE[isMobileLayout ? "phone" : "wide"]}
            />
            {hiddenCount ? (
              <button type="button" className="subtle-action donut-reset-action" onClick={() => setHiddenCategoryIds(new Set())}>
                {messages.common.resetHiddenCategories(hiddenCount)}
              </button>
            ) : null}
          </div>
          <SpendingMixList
            label={messages.entries.totals.spendingByCategory}
            items={expenseBreakdown}
            topCount={isMobileLayout ? 3 : 5}
            renderRow={(item, index) => {
              const theme = categoryService.getTheme(categories, item, index);
              const categoryName = item.categoryName ?? item.label;
              const isHidden = hiddenCategoryIds.has(getDonutItemId(item));
              const isFiltered = selected.includes(categoryName);
              const colour = paletteColour(theme.color);
              return (
                <div
                  key={item.key}
                  data-fig-row={item.label}
                  className={`summary-mix-row entries-mix-row motion-row ${isHidden ? "is-hidden-from-donut" : ""}`}
                  {...rowMotionProps({ name: categoryName, iconKey: theme.iconKey, color: theme.color }, { "--bar-color": colour })}
                >
                  <span className="category-icon category-icon-static" aria-hidden="true" style={{ "--category-color": colour }} />
                  <button
                    type="button"
                    className="summary-mix-main"
                    aria-pressed={isFiltered}
                    onClick={() => toggleCategoryFilter(categoryName)}
                  >
                    <strong className="summary-mix-name">{item.label}</strong>
                    {isFiltered ? <span className="summary-mix-state">{messages.entries.filtered}</span> : null}
                    {isHidden ? <span className="summary-mix-state">{messages.common.hiddenFromChart}</span> : null}
                    <span className="summary-mix-count">{mixCopy.sliceEntries(item.entryCount)}</span>
                    <span className="summary-mix-amount"><PrivateMoney>{formatService.money(item.valueMinor)}</PrivateMoney></span>
                    <span className="summary-mix-percent">{mixShareText(item.valueMinor, totalMinor)}</span>
                  </button>
                  <button
                    type="button"
                    className="summary-mix-eye"
                    aria-label={mixCopy.showInChart(item.label)}
                    aria-pressed={!isHidden}
                    onClick={() => toggleCategoryVisibility(item)}
                  >
                    {isHidden ? <EyeOff size={17} aria-hidden="true" /> : <Eye size={17} aria-hidden="true" />}
                  </button>
                </div>
              );
            }}
          />
        </div>
      ) : (
        <EmptyState compact title={messages.entries.noSpendBreakdown}>{messages.entries.noSpendBreakdownDetail}</EmptyState>
      )}
    </section>
  );
}

// Whether the breakdown is open: folded by default (the list of entries is
// the page's job), and the person's choice kept on the device like
// Spending Mix's "Hide list" (read and written in try/catch; blocked
// storage keeps it for the visit).
const BREAKDOWN_KEY = "monies-map:entries-breakdown";

function readBreakdownShown() {
  try {
    return window.localStorage.getItem(BREAKDOWN_KEY) === "shown";
  } catch {
    return false;
  }
}

export function useEntriesBreakdownShown() {
  const [shown, setShown] = useState(readBreakdownShown);
  const toggle = () => setShown((current) => {
    try {
      window.localStorage.setItem(BREAKDOWN_KEY, current ? "hidden" : "shown");
    } catch {
      // Blocked storage: the choice lasts for the visit.
    }
    return !current;
  });
  return [shown, toggle];
}

// The folded row's value, piece by piece: the three biggest categories and
// their whole shares of the list's spending ("Travel 39%", "Other 21%",
// "Church 9%"). Shares only, so it stays when money is hidden.
export function describeTopShares(expenseBreakdown, count = 3) {
  const totalMinor = sumDonutValueMinor(expenseBreakdown);
  if (!totalMinor) {
    return [];
  }
  return expenseBreakdown
    .slice(0, count)
    .map((item) => `${item.label} ${Math.round((item.valueMinor / totalMinor) * 100)}%`);
}

// The shares as whole pieces on one line: a piece that does not fit drops
// out whole (the line wraps into a one-line box), so no name is cut in half.
const NBSP = String.fromCharCode(160);

function TopShares({ parts }) {
  return (
    <span className="lsd-row-text entries-breakdown-shares">
      {parts.map((part, index) => (
        // A no-break space keeps the dot with the name after it.
        <span key={part}>{index ? `${NBSP}·${NBSP}${part}` : part}</span>
      ))}
    </span>
  );
}

