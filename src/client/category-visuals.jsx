import { lazy, Suspense, useMemo, useState } from "react";

import { messages } from "./copy/en-SG";
import { getCategoryTheme, slugify } from "./category-utils";
import { money, moneyWithCurrency } from "./formatters";
import { CategoryGlyph } from "./ui-components";
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
