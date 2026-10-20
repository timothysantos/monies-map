import "./spending-mix-list.css";
import { lazy, Suspense, useMemo, useState } from "react";
import { ChevronDown } from "lucide-react";

import { messages } from "./copy/en-SG";
import { spendingMixCopy as mixCopy } from "./copy/spending-mix-copy";
import { getCategoryTheme, slugify } from "./category-utils";
import { money, moneyWithCurrency } from "./formatters";
import { CategoryGlyph, DetailRows } from "./ui-components";
import { PrivateMoney } from "./money-privacy";
import { useRouteWorkBusy } from "./use-route-work-status";
import { useIsMobileLayout } from "./use-viewport";
import { paletteColour } from "./palette-colour";

const LazySpendingMixRecharts = lazy(() => import("./spending-mix-recharts.jsx"));
// The category edit dialog loads when it is first opened, so the first
// screen (Summary's Spending Mix) does not carry it or the Settings copy it
// shows.
const LazyCategoryEditDialog = lazy(() => import("./category-edit-dialog.jsx").then((module) => ({ default: module.CategoryEditDialog })));
export function SpendingMixChart({
  data,
  categories,
  totalMinor,
  totalLabel = messages.summary.totalSpend,
  compact = false,
  height = 360,
  innerRadius = 70,
  outerRadius = 120,
  // A Splits chart passes its split currency; other charts are SGD.
  currency = "",
  // Percent labels and category badges around the ring. Spending Mix turns
  // them off: its ranked list beside the donut carries them, and they
  // collided with each other when many categories had small slices.
  callouts = true,
  // Spending Mix's own labels instead: "Name 32.1%" beside the slices with
  // room for one, none on small slices (donut-label-layout.js). Shares are
  // of shareTotalMinor, all spending, so hiding a slice does not move them.
  sliceLabels = false,
  shareTotalMinor = undefined,
  // Spending Mix: each slice is an openable figure, and `sliceFacts` adds a
  // category's plan and merchants to its menu (spending-mix-recharts.jsx).
  sliceFacts = undefined,
  // Spending Mix sizes its own donut for a phone; others are clamped there.
  fullSize = false
}) {
  const total = typeof totalMinor === "number"
    ? totalMinor
    : data.reduce((sum, item) => sum + item.valueMinor, 0);
  const isNarrowViewport = useIsMobileLayout();
  const clamp = isNarrowViewport && !fullSize;
  const resolvedHeight = clamp ? Math.min(height, compact ? 250 : 280) : height;
  const resolvedInnerRadius = clamp ? Math.min(innerRadius, compact ? 54 : 62) : innerRadius;
  const resolvedOuterRadius = clamp ? Math.min(outerRadius, compact ? 84 : 98) : outerRadius;
  const chartData = data.map((item, index) => ({
    ...item,
    ...getCategoryTheme(categories, item, index)
  }));

  return (
    <div className={`spending-mix-chart-shell ${compact ? "is-compact" : ""}`}>
      <Suspense fallback={<SpendingMixChartFallback total={total} totalLabel={totalLabel} compact={compact} resolvedHeight={resolvedHeight} currency={currency} />}>
        <LazySpendingMixRecharts
          chartData={chartData}
          total={total}
          currency={currency}
          totalLabel={totalLabel}
          compact={compact}
          callouts={callouts}
          sliceLabels={sliceLabels}
          sliceFacts={sliceFacts}
          shareTotalMinor={shareTotalMinor}
          isNarrowViewport={isNarrowViewport}
          resolvedHeight={resolvedHeight}
          resolvedInnerRadius={resolvedInnerRadius}
          resolvedOuterRadius={resolvedOuterRadius}
        />
      </Suspense>
    </div>
  );
}

function SpendingMixChartFallback({ total, totalLabel, compact, resolvedHeight, currency = "" }) {
  return (
    <div
      className={`spending-mix-chart spending-mix-chart-loading ${compact ? "is-compact" : ""}`}
      style={{ minHeight: resolvedHeight }}
      aria-hidden="true"
    >
      <span className="chart-spinner" />
      <div className={`donut-center recharts-donut-center ${compact ? "is-compact" : ""}`}>
        <span>{totalLabel}</span>
        <strong><PrivateMoney>{currency ? moneyWithCurrency(total, currency) : money(total)}</PrivateMoney></strong>
      </div>
    </div>
  );
}

export function CategoryAppearancePopover({ category, onChange }) {
  const [dialog, setDialog] = useState(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  useRouteWorkBusy(Boolean(dialog) || isSubmitting);
  const categoryDialog = useMemo(() => {
    if (!dialog || !category || dialog.categoryId !== category.id) {
      return dialog;
    }
    return {
      ...dialog,
      name: dialog.name,
      slug: dialog.slug,
      iconKey: dialog.iconKey,
      colorHex: dialog.colorHex
    };
  }, [category, dialog]);

  if (!category) {
    return <span className="category-icon category-icon-static" />;
  }

  async function handleSave() {
    if (!categoryDialog) {
      return;
    }

    setIsSubmitting(true);
    try {
      await onChange(category.id, {
        name: categoryDialog.name.trim(),
        slug: (categoryDialog.slug || slugify(categoryDialog.name)).trim(),
        iconKey: categoryDialog.iconKey,
        colorHex: categoryDialog.colorHex
      });
      setDialog(null);
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <>
      <button
        type="button"
        className="category-icon category-icon-button"
        style={{ "--category-color": paletteColour(category.colorHex) }}
        aria-label={`Edit ${category.name}`}
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          setDialog({
            mode: "edit",
            categoryId: category.id,
            name: category.name,
            slug: category.slug ?? slugify(category.name),
            iconKey: category.iconKey,
            colorHex: category.colorHex
          });
        }}
      >
        <CategoryGlyph iconKey={category.iconKey} />
      </button>
      {/* Mounted only while open: long lists render one of these per row. */}
      {categoryDialog ? (
        <Suspense fallback={null}>
          <LazyCategoryEditDialog
            dialog={categoryDialog}
            isSubmitting={isSubmitting}
            onChange={setDialog}
            onClose={() => setDialog(null)}
            onSave={handleSave}
          />
        </Suspense>
      ) : null}
    </>
  );
}

// Spending Mix's lean ranked list (design.md "Summary body"), shared by
// Summary's and Month's Spending Mix (spending-mix-section.jsx) and the
// Entries page's spending by category (entries-overview.jsx): one 44 px
// line per category in one DetailRows group, biggest first, the top
// `topCount` (five on a desktop, three on a phone), then a last row "Show
// all N" / "Show fewer" (`aria-expanded`). Each page draws its own rows
// (`renderRow`): their taps differ; the look is spending-mix-list.css.
/**
 * @param {{ label: string, items: any[], topCount: number, renderRow: (item: any, index: number) => any, className?: string }} props
 */
export function SpendingMixList({ label, items, topCount, renderRow, className = "" }) {
  const [showAll, setShowAll] = useState(false);
  const listed = showAll ? items : items.slice(0, topCount);
  return (
    <DetailRows className={["summary-mix-list", className].filter(Boolean).join(" ")} label={label}>
      {listed.map((item, index) => renderRow(item, index))}
      {items.length > topCount ? (
        <button type="button" className="lsd-row summary-mix-more" aria-expanded={showAll} onClick={() => setShowAll((current) => !current)}>
          {showAll ? mixCopy.showFewer : mixCopy.showAll(items.length)}
          {/* One chevron, turned up while the whole list shows. */}
          <ChevronDown size={16} aria-hidden="true" className={showAll ? "summary-mix-more-up" : undefined} />
        </button>
      ) : null}
    </DetailRows>
  );
}

// A category's share of all spending, to one decimal ("38.8%"): the list's
// and the slice labels' wording.
export function mixShareText(valueMinor, totalMinor) {
  return `${(totalMinor ? (valueMinor / totalMinor) * 100 : 0).toFixed(1)}%`;
}
