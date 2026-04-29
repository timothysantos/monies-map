import { Cell, Pie, PieChart, ResponsiveContainer } from "recharts";

import { moniesClient } from "./monies-client-service";
import { getIconComponent } from "./ui-components";

const { format: formatService } = moniesClient;

export default function SpendingMixRecharts({
  chartData,
  total,
  totalLabel,
  compact,
  isNarrowViewport,
  resolvedHeight,
  resolvedInnerRadius,
  resolvedOuterRadius
}) {
  return (
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
        <strong>{formatService.money(total)}</strong>
      </div>
    </div>
  );
}

function renderPieCallout(props, total, options = {}) {
  const { cx, cy, midAngle, outerRadius, percent, payload } = props;
  const { compact = false } = options;
  if (!percent || !payload || !total) {
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
