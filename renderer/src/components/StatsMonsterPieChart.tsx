import { memo, useMemo, useState } from "react";

const PIE_VIEWBOX_SIZE = 260;
const PIE_CENTER = PIE_VIEWBOX_SIZE / 2;
const PIE_RADIUS = 88;
const PIE_RING_WIDTH = 38;
const PIE_CIRCUMFERENCE = 2 * Math.PI * PIE_RADIUS;

export type StatsMonsterPieChartDatum = {
  monsterName: string;
  value: number;
  color?: string;
};

type StatsMonsterPieChartProps = {
  data: StatsMonsterPieChartDatum[];
  metricLabel: string;
  formatNumber: (value: number) => string;
};

function hashText(value: string): number {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 33 + value.charCodeAt(index)) >>> 0;
  }
  return hash;
}

function getDefaultMonsterSliceColor(monsterName: string): string {
  const hue = hashText(monsterName) % 360;
  return `hsl(${hue} 68% 57%)`;
}

function formatPercent(value: number, total: number): string {
  if (total <= 0 || value <= 0) {
    return "0%";
  }
  const percent = (value / total) * 100;
  const rounded = Math.round(percent * 10) / 10;
  return `${rounded.toLocaleString(undefined, {
    minimumFractionDigits: rounded % 1 === 0 ? 0 : 1,
    maximumFractionDigits: 1,
  })}%`;
}

export const StatsMonsterPieChart = memo(function StatsMonsterPieChart({
  data,
  metricLabel,
  formatNumber,
}: StatsMonsterPieChartProps) {
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);

  const normalizedData = useMemo(
    () =>
      data.map((entry) => ({
        ...entry,
        color: entry.color || getDefaultMonsterSliceColor(entry.monsterName),
      })),
    [data]
  );
  const totalValue = useMemo(
    () => normalizedData.reduce((sum, entry) => sum + Math.max(0, entry.value), 0),
    [normalizedData]
  );
  const segments = useMemo(() => {
    let cumulativeLength = 0;
    return normalizedData.map((entry) => {
      const normalizedValue = Math.max(0, entry.value);
      const arcLength = totalValue > 0 ? (normalizedValue / totalValue) * PIE_CIRCUMFERENCE : 0;
      const segment = {
        ...entry,
        arcLength,
        dashOffset: -cumulativeLength,
      };
      cumulativeLength += arcLength;
      return segment;
    });
  }, [normalizedData, totalValue]);

  const selectedIndex = hoveredIndex !== null ? hoveredIndex : 0;
  const selectedEntry = segments[selectedIndex] ?? null;

  return (
    <div className="stats-monster-pie-layout">
      <div className="stats-monster-pie-canvas-wrap">
        <svg
          className="stats-monster-pie-svg"
          viewBox={`0 0 ${PIE_VIEWBOX_SIZE} ${PIE_VIEWBOX_SIZE}`}
          role="img"
          aria-label={`Monster ${metricLabel} distribution pie chart`}
        >
          <circle
            cx={PIE_CENTER}
            cy={PIE_CENTER}
            r={PIE_RADIUS}
            fill="none"
            stroke="#1c2a3a"
            strokeWidth={PIE_RING_WIDTH}
          />
          <g transform={`rotate(-90 ${PIE_CENTER} ${PIE_CENTER})`}>
            {segments.map((entry, index) => (
              <circle
                key={`${entry.monsterName}:${index}`}
                cx={PIE_CENTER}
                cy={PIE_CENTER}
                r={PIE_RADIUS}
                fill="none"
                stroke={entry.color}
                strokeWidth={hoveredIndex === index ? PIE_RING_WIDTH + 4 : PIE_RING_WIDTH}
                strokeDasharray={`${entry.arcLength} ${Math.max(0, PIE_CIRCUMFERENCE - entry.arcLength)}`}
                strokeDashoffset={entry.dashOffset}
                className="stats-monster-pie-segment"
                onMouseEnter={() => setHoveredIndex(index)}
                onMouseLeave={() => setHoveredIndex(null)}
              />
            ))}
          </g>
          <circle cx={PIE_CENTER} cy={PIE_CENTER} r={PIE_RADIUS - PIE_RING_WIDTH / 2 - 2} fill="#0e1621" />
          <text x={PIE_CENTER} y={PIE_CENTER - 14} className="stats-monster-pie-center-label">
            {metricLabel}
          </text>
          <text x={PIE_CENTER} y={PIE_CENTER + 12} className="stats-monster-pie-center-value">
            {selectedEntry ? formatNumber(selectedEntry.value) : "0"}
          </text>
          <text x={PIE_CENTER} y={PIE_CENTER + 32} className="stats-monster-pie-center-subtitle">
            {selectedEntry ? selectedEntry.monsterName : "No data"}
          </text>
        </svg>
      </div>
      <div className="stats-monster-pie-legend" aria-label={`${metricLabel} pie chart legend`}>
        {segments.map((entry, index) => {
          const share = formatPercent(entry.value, totalValue);
          const isActive = index === selectedIndex;
          return (
            <button
              key={`legend:${entry.monsterName}:${index}`}
              type="button"
              className={`stats-monster-pie-legend-row${isActive ? " is-active" : ""}`}
              onMouseEnter={() => setHoveredIndex(index)}
              onMouseLeave={() => setHoveredIndex(null)}
              onFocus={() => setHoveredIndex(index)}
              onBlur={() => setHoveredIndex(null)}
            >
              <span className="stats-monster-pie-legend-swatch" style={{ backgroundColor: entry.color }} aria-hidden="true" />
              <span className="stats-monster-pie-legend-name">{entry.monsterName}</span>
              <span className="stats-monster-pie-legend-share">{share}</span>
              <span className="stats-monster-pie-legend-value">{formatNumber(entry.value)}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
});
