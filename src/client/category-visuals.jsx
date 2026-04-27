import { lazy, Suspense, useMemo, useState } from "react";

import { CategoryEditDialog } from "./category-edit-dialog";
import { slugify } from "./category-utils";
import { getCategoryTheme } from "./category-utils";
import { messages } from "./copy/en-SG";
import { money } from "./formatters";
import { CategoryGlyph } from "./ui-components";

const LazySpendingMixRecharts = lazy(() => import("./spending-mix-recharts.jsx"));

export function SpendingMixChart({
  data,
  categories,
  totalMinor,
  totalLabel = messages.summary.totalSpend,
  compact = false,
  height = 360,
  innerRadius = 70,
  outerRadius = 120
}) {
  const total = typeof totalMinor === "number"
    ? totalMinor
    : data.reduce((sum, item) => sum + item.valueMinor, 0);
  const isNarrowViewport = typeof window !== "undefined" && window.innerWidth <= 760;
  const resolvedHeight = isNarrowViewport ? Math.min(height, compact ? 250 : 280) : height;
  const resolvedInnerRadius = isNarrowViewport ? Math.min(innerRadius, compact ? 54 : 62) : innerRadius;
  const resolvedOuterRadius = isNarrowViewport ? Math.min(outerRadius, compact ? 84 : 98) : outerRadius;
  const chartData = data.map((item, index) => ({
    ...item,
    ...getCategoryTheme(categories, item, index)
  }));

  return (
    <div className={`spending-mix-chart-shell ${compact ? "is-compact" : ""}`}>
      <Suspense fallback={<SpendingMixChartFallback total={total} totalLabel={totalLabel} compact={compact} resolvedHeight={resolvedHeight} />}>
        <LazySpendingMixRecharts
          chartData={chartData}
          total={total}
          totalLabel={totalLabel}
          compact={compact}
          isNarrowViewport={isNarrowViewport}
          resolvedHeight={resolvedHeight}
          resolvedInnerRadius={resolvedInnerRadius}
          resolvedOuterRadius={resolvedOuterRadius}
        />
      </Suspense>
    </div>
  );
}

function SpendingMixChartFallback({ total, totalLabel, compact, resolvedHeight }) {
  return (
    <div
      className={`spending-mix-chart spending-mix-chart-loading ${compact ? "is-compact" : ""}`}
      style={{ minHeight: resolvedHeight }}
      aria-hidden="true"
    >
      <span className="chart-spinner" />
      <div className={`donut-center recharts-donut-center ${compact ? "is-compact" : ""}`}>
        <span>{totalLabel}</span>
        <strong>{money(total)}</strong>
      </div>
    </div>
  );
}

export function CategoryAppearancePopover({ category, onChange }) {
  const [dialog, setDialog] = useState(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
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
        style={{ "--category-color": category.colorHex }}
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
      <CategoryEditDialog
        dialog={categoryDialog}
        isSubmitting={isSubmitting}
        onChange={setDialog}
        onClose={() => setDialog(null)}
        onSave={handleSave}
      />
    </>
  );
}
