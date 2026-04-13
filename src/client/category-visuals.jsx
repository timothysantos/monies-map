import * as Popover from "@radix-ui/react-popover";
import { Cell, Pie, PieChart, ResponsiveContainer } from "recharts";

import { getCategoryTheme } from "./category-utils";
import { messages } from "./copy/en-SG";
import { money } from "./formatters";
import { CategoryGlyph, getIconComponent } from "./ui-components";
import { COLOR_OPTIONS, ICON_OPTIONS } from "./ui-options";

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
      <div className={`spending-mix-chart ${compact ? "is-compact" : ""}`}>
        <ResponsiveContainer width="100%" height={resolvedHeight}>
          <PieChart>
            <Pie
              data={chartData}
              dataKey="valueMinor"
              nameKey="label"
              cx="50%"
              cy="50%"
              innerRadius={resolvedInnerRadius}
              outerRadius={resolvedOuterRadius}
              paddingAngle={0}
              isAnimationActive={false}
              labelLine={false}
              label={(props) => renderPieCallout(props, total, { compact: isNarrowViewport })}
            >
              {chartData.map((entry) => (
                <Cell key={entry.key} fill={entry.color} />
              ))}
            </Pie>
          </PieChart>
        </ResponsiveContainer>
        <div className={`donut-center recharts-donut-center ${compact ? "is-compact" : ""}`}>
          <span>{totalLabel}</span>
          <strong>{money(total)}</strong>
        </div>
      </div>
    </div>
  );
}

function renderPieCallout(props, total, options = {}) {
  const { cx, cy, midAngle, outerRadius, percent, payload } = props;
  const { compact = false } = options;
  if (!percent) {
    return null;
  }

  if (compact && percent < 0.03) {
    return null;
  }

  const radians = (Math.PI / 180) * -midAngle;
  const stemOffset = compact ? 4 : 6;
  const midOffset = compact ? 10 : 22;
  const badgeOffset = compact ? 20 : 46;
  const textOffset = compact ? 18 : 34;
  const badgeSize = compact ? 28 : 44;
  const iconSize = compact ? 12 : 18;
  const fontSize = compact ? 10 : 15;
  const sx = cx + Math.cos(radians) * (outerRadius + stemOffset);
  const sy = cy + Math.sin(radians) * (outerRadius + stemOffset);
  const mx = cx + Math.cos(radians) * (outerRadius + midOffset);
  const my = cy + Math.sin(radians) * (outerRadius + midOffset);
  const bx = cx + Math.cos(radians) * (outerRadius + badgeOffset);
  const by = cy + Math.sin(radians) * (outerRadius + badgeOffset);
  const isRight = Math.cos(radians) >= 0;
  const tx = bx + (isRight ? textOffset : -textOffset);
  const percentage = ((payload.valueMinor / total) * 100).toFixed(1);
  const Icon = getIconComponent(payload.iconKey);

  return (
    <g>
      <path d={`M${sx},${sy} L${mx},${my} L${bx},${by}`} stroke={payload.color} strokeWidth="3" fill="none" strokeLinecap="round" opacity="0.82" />
      <foreignObject x={bx - (badgeSize / 2)} y={by - (badgeSize / 2)} width={badgeSize} height={badgeSize}>
        <div className="donut-callout-badge" style={{ "--category-color": payload.color, "--callout-size": `${badgeSize}px` }}>
          <Icon size={iconSize} strokeWidth={2.2} />
        </div>
      </foreignObject>
      <text x={tx} y={by + 1} textAnchor={isRight ? "start" : "end"} dominantBaseline="middle" fill={payload.color} fontSize={fontSize} fontWeight="700">
        {percentage}%
      </text>
    </g>
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
