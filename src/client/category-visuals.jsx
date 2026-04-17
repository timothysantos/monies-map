import { lazy, Suspense } from "react";
import * as Popover from "@radix-ui/react-popover";

import { getCategoryTheme } from "./category-utils";
import { messages } from "./copy/en-SG";
import { money } from "./formatters";
import { CategoryGlyph } from "./ui-components";
import { COLOR_OPTIONS, ICON_OPTIONS } from "./ui-options";

const LazySpendingMixRecharts = lazy(() => import("./spending-mix-recharts.jsx"));

export function SpendingMixChart({
  data,
  categories,
  totalLabel = messages.summary.totalSpend,
  compact = false,
  height = 360,
  innerRadius = 70,
  outerRadius = 120
}) {
  const total = data.reduce((sum, item) => sum + item.valueMinor, 0);
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
  if (!category) {
    return <span className="category-icon category-icon-static" />;
  }

  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <button
          type="button"
          className="category-icon category-icon-button"
          style={{ "--category-color": category.colorHex }}
          aria-label={`Edit ${category.name} icon and color`}
        >
          <CategoryGlyph iconKey={category.iconKey} />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content className="category-popover" sideOffset={10} align="start">
          <div className="category-popover-head">
            <strong>{category.name}</strong>
            <span>Icon and color</span>
          </div>

          <div className="category-popover-section">
            <label className="category-popover-label" htmlFor={`category-name-${category.id}`}>Name</label>
            <input
              id={`category-name-${category.id}`}
              className="category-name-input"
              type="text"
              value={category.name}
              onChange={(event) => onChange(category.id, { name: event.target.value })}
            />
          </div>

          <div className="category-popover-section">
            <span className="category-popover-label">Icon</span>
            <div className="icon-grid">
              {ICON_OPTIONS.map((option) => (
                <button
                  key={option.key}
                  type="button"
                  className={`icon-choice ${category.iconKey === option.key ? "is-active" : ""}`}
                  onClick={() => onChange(category.id, { iconKey: option.key })}
                  aria-label={option.label}
                  title={option.label}
                >
                  <option.Icon size={16} strokeWidth={2.2} />
                </button>
              ))}
            </div>
          </div>

          <div className="category-popover-section">
            <span className="category-popover-label">Color</span>
            <div className="color-grid">
              {COLOR_OPTIONS.map((color) => (
                <button
                  key={color}
                  type="button"
                  className={`color-choice ${category.colorHex === color ? "is-active" : ""}`}
                  style={{ "--swatch-color": color }}
                  onClick={() => onChange(category.id, { colorHex: color })}
                  aria-label={color}
                  title={color}
                />
              ))}
            </div>
          </div>
          <Popover.Arrow className="category-popover-arrow" />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
