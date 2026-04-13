import { memo, type MouseEvent as ReactMouseEvent, useMemo, useRef, useState } from "react";

const CHART_HEIGHT = 248;
const CHART_MIN_WIDTH = 620;
const CHART_MIN_SLOT_WIDTH = 24;
const CHART_MARGIN_TOP = 12;
const CHART_MARGIN_RIGHT = 16;
const CHART_MARGIN_BOTTOM = 44;
const CHART_MARGIN_LEFT = 48;
const TOOLTIP_EDGE_PADDING = 8;
const TOOLTIP_CURSOR_GAP_RIGHT = 6;
const TOOLTIP_CURSOR_GAP_LEFT = 3;
const TOOLTIP_CURSOR_GAP_VERTICAL = 6;
const TREND_TOOLTIP_WIDTH_ESTIMATE = 310;
const TREND_TOOLTIP_HEIGHT_ESTIMATE = 180;
const HEATMAP_CELL_WIDTH = 16;
const HEATMAP_CELL_HEIGHT = 18;
const HEATMAP_MARGIN_TOP = 26;
const HEATMAP_MARGIN_RIGHT = 12;
const HEATMAP_MARGIN_BOTTOM = 12;
const HEATMAP_MARGIN_LEFT = 72;
const DAYS_OF_WEEK = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export type StatsTrendSeries = {
  key: string;
  label: string;
  color: string;
  values: number[];
};

type StatsTrendLineChartProps = {
  ariaLabel: string;
  buckets: string[];
  series: StatsTrendSeries[];
  formatNumber: (value: number) => string;
  formatBucketAxisLabel: (bucketKey: string) => string;
  formatBucketTooltipLabel: (bucketKey: string) => string;
};

type ChartTooltipState = {
  bucketIndex: number;
  x: number;
  y: number;
};

function getTooltipPosition(
  container: HTMLDivElement,
  clientX: number,
  clientY: number,
  tooltipWidthEstimate: number,
  tooltipHeightEstimate: number
): { x: number; y: number } {
  const bounds = container.getBoundingClientRect();
  const pointerX = clientX - bounds.left;
  const pointerY = clientY - bounds.top;
  const scrollContainer = container.parentElement;
  const containerVisibleLeft = (scrollContainer ? scrollContainer.scrollLeft : 0) + TOOLTIP_EDGE_PADDING;
  const containerVisibleRight =
    (scrollContainer ? scrollContainer.scrollLeft + scrollContainer.clientWidth : bounds.width) -
    TOOLTIP_EDGE_PADDING;
  const containerVisibleTop = (scrollContainer ? scrollContainer.scrollTop : 0) + TOOLTIP_EDGE_PADDING;
  const containerVisibleBottom =
    (scrollContainer ? scrollContainer.scrollTop + scrollContainer.clientHeight : bounds.height) -
    TOOLTIP_EDGE_PADDING;
  const viewportVisibleLeft = TOOLTIP_EDGE_PADDING - bounds.left;
  const viewportVisibleRight = window.innerWidth - TOOLTIP_EDGE_PADDING - bounds.left;
  const viewportVisibleTop = TOOLTIP_EDGE_PADDING - bounds.top;
  const viewportVisibleBottom = window.innerHeight - TOOLTIP_EDGE_PADDING - bounds.top;
  const visibleLeft = Math.max(containerVisibleLeft, viewportVisibleLeft);
  const visibleRight = Math.min(containerVisibleRight, viewportVisibleRight);
  const visibleTop = Math.max(containerVisibleTop, viewportVisibleTop);
  const visibleBottom = Math.min(containerVisibleBottom, viewportVisibleBottom);
  const safeVisibleRight = Math.max(visibleLeft, visibleRight);
  const safeVisibleBottom = Math.max(visibleTop, visibleBottom);
  const availableRight = safeVisibleRight - pointerX - TOOLTIP_CURSOR_GAP_RIGHT;
  const availableLeft = pointerX - visibleLeft - TOOLTIP_CURSOR_GAP_LEFT;
  const availableBottom = safeVisibleBottom - pointerY - TOOLTIP_CURSOR_GAP_VERTICAL;
  const availableTop = pointerY - visibleTop - TOOLTIP_CURSOR_GAP_VERTICAL;
  const shouldLeanLeft = availableRight < tooltipWidthEstimate && availableLeft > availableRight;
  const shouldLeanUp = availableBottom < tooltipHeightEstimate && availableTop > availableBottom;
  const proposedLeft = shouldLeanLeft
    ? pointerX - TOOLTIP_CURSOR_GAP_LEFT - tooltipWidthEstimate
    : pointerX + TOOLTIP_CURSOR_GAP_RIGHT;
  const proposedTop = shouldLeanUp
    ? pointerY - TOOLTIP_CURSOR_GAP_VERTICAL - tooltipHeightEstimate
    : pointerY + TOOLTIP_CURSOR_GAP_VERTICAL;
  const maxLeft = Math.max(visibleLeft, safeVisibleRight - tooltipWidthEstimate);
  const maxTop = Math.max(visibleTop, safeVisibleBottom - tooltipHeightEstimate);

  return {
    x: Math.min(Math.max(visibleLeft, proposedLeft), maxLeft),
    y: Math.min(Math.max(visibleTop, proposedTop), maxTop),
  };
}

function getLinePath(
  values: number[],
  maxValue: number,
  chartLeft: number,
  chartTop: number,
  chartHeight: number,
  slotWidth: number
): string {
  if (values.length === 0) {
    return "";
  }
  let path = "";
  for (let index = 0; index < values.length; index += 1) {
    const x = chartLeft + index * slotWidth + slotWidth / 2;
    const value = values[index] ?? 0;
    const ratio = maxValue > 0 ? value / maxValue : 0;
    const y = chartTop + chartHeight - ratio * chartHeight;
    path += `${index === 0 ? "M" : "L"} ${x} ${y} `;
  }
  return path.trim();
}

function getHeatmapCellColor(value: number, maxValue: number): string {
  if (value <= 0 || maxValue <= 0) {
    return "#132030";
  }
  const ratio = Math.max(0, Math.min(1, value / maxValue));
  const hue = 205 - ratio * 72;
  const saturation = 62 + ratio * 10;
  const lightness = 22 + ratio * 28;
  return `hsl(${hue} ${saturation}% ${lightness}%)`;
}

export const StatsTrendLineChart = memo(function StatsTrendLineChart({
  ariaLabel,
  buckets,
  series,
  formatNumber,
  formatBucketAxisLabel,
  formatBucketTooltipLabel,
}: StatsTrendLineChartProps) {
  const [tooltip, setTooltip] = useState<ChartTooltipState | null>(null);
  const chartWrapRef = useRef<HTMLDivElement | null>(null);
  const bucketCount = buckets.length;
  const maxValue = useMemo(
    () =>
      Math.max(
        1,
        ...series.flatMap((entry) => entry.values.map((value) => Math.max(0, value)))
      ),
    [series]
  );
  const dynamicInnerWidth = Math.max(CHART_MIN_WIDTH, bucketCount * CHART_MIN_SLOT_WIDTH);
  const svgWidth = dynamicInnerWidth + CHART_MARGIN_LEFT + CHART_MARGIN_RIGHT;
  const svgHeight = CHART_HEIGHT + CHART_MARGIN_TOP + CHART_MARGIN_BOTTOM;
  const slotWidth = bucketCount > 0 ? dynamicInnerWidth / bucketCount : CHART_MIN_SLOT_WIDTH;
  const yTickCount = 4;
  const xLabelStep = Math.max(1, Math.ceil(bucketCount / 10));

  const tooltipRows = useMemo(() => {
    if (!tooltip) {
      return [];
    }
    return series
      .map((entry) => ({
        label: entry.label,
        value: entry.values[tooltip.bucketIndex] ?? 0,
        color: entry.color,
      }))
      .sort((left, right) => right.value - left.value || left.label.localeCompare(right.label));
  }, [series, tooltip]);

  const handleBucketMove = (event: ReactMouseEvent<SVGRectElement>, bucketIndex: number) => {
    if (!chartWrapRef.current) {
      return;
    }
    const tooltipPosition = getTooltipPosition(
      chartWrapRef.current,
      event.clientX,
      event.clientY,
      TREND_TOOLTIP_WIDTH_ESTIMATE,
      TREND_TOOLTIP_HEIGHT_ESTIMATE
    );
    setTooltip({
      bucketIndex,
      ...tooltipPosition,
    });
  };

  return (
    <div className="stats-trend-chart-wrap">
      <div className="stats-trend-chart-legend">
        {series.map((entry) => (
          <span key={entry.key} className="stats-trend-chart-legend-item">
            <span
              className="stats-trend-chart-legend-swatch"
              style={{ backgroundColor: entry.color }}
              aria-hidden="true"
            />
            <span>{entry.label}</span>
          </span>
        ))}
      </div>
      <div className="stats-trend-chart-scroll">
        <div className="stats-trend-chart-canvas" ref={chartWrapRef}>
          <svg
            className="stats-trend-chart-svg"
            viewBox={`0 0 ${svgWidth} ${svgHeight}`}
            role="img"
            aria-label={ariaLabel}
          >
            <g>
              {Array.from({ length: yTickCount + 1 }).map((_, tickIndex) => {
                const ratio = tickIndex / yTickCount;
                const y = CHART_MARGIN_TOP + CHART_HEIGHT - ratio * CHART_HEIGHT;
                const tickValue = Math.round(maxValue * ratio);
                return (
                  <g key={`y-grid-${tickIndex}`}>
                    <line
                      x1={CHART_MARGIN_LEFT}
                      x2={CHART_MARGIN_LEFT + dynamicInnerWidth}
                      y1={y}
                      y2={y}
                      className="stats-trend-chart-grid-line"
                    />
                    <text x={CHART_MARGIN_LEFT - 8} y={y + 4} className="stats-trend-chart-axis-label">
                      {formatNumber(tickValue)}
                    </text>
                  </g>
                );
              })}
            </g>
            <g>
              {series.map((entry) => (
                <path
                  key={entry.key}
                  d={getLinePath(
                    entry.values,
                    maxValue,
                    CHART_MARGIN_LEFT,
                    CHART_MARGIN_TOP,
                    CHART_HEIGHT,
                    slotWidth
                  )}
                  className="stats-trend-chart-line"
                  style={{ stroke: entry.color }}
                />
              ))}
              {series.map((entry) =>
                entry.values.map((value, bucketIndex) => {
                  if (tooltip?.bucketIndex !== bucketIndex) {
                    return null;
                  }
                  const x = CHART_MARGIN_LEFT + bucketIndex * slotWidth + slotWidth / 2;
                  const y = CHART_MARGIN_TOP + CHART_HEIGHT - (Math.max(0, value) / maxValue) * CHART_HEIGHT;
                  return (
                    <circle
                      key={`${entry.key}:${bucketIndex}`}
                      cx={x}
                      cy={y}
                      r={3.4}
                      className="stats-trend-chart-dot"
                      style={{ fill: entry.color }}
                    />
                  );
                })
              )}
            </g>
            <g>
              {buckets.map((bucket, bucketIndex) => {
                const slotLeft = CHART_MARGIN_LEFT + bucketIndex * slotWidth;
                return (
                  <g key={`bucket:${bucket}:${bucketIndex}`}>
                    {(bucketIndex % xLabelStep === 0 || bucketIndex === buckets.length - 1) && (
                      <text
                        x={slotLeft + slotWidth / 2}
                        y={CHART_MARGIN_TOP + CHART_HEIGHT + 18}
                        className="stats-trend-chart-axis-label stats-trend-chart-axis-label-x"
                      >
                        {formatBucketAxisLabel(bucket)}
                      </text>
                    )}
                    <rect
                      x={slotLeft}
                      y={CHART_MARGIN_TOP}
                      width={slotWidth}
                      height={CHART_HEIGHT}
                      fill="transparent"
                      onMouseEnter={(event) => handleBucketMove(event, bucketIndex)}
                      onMouseMove={(event) => handleBucketMove(event, bucketIndex)}
                      onMouseLeave={() => setTooltip(null)}
                    />
                  </g>
                );
              })}
            </g>
          </svg>
          {tooltip ? (
            <div
              className="stats-trend-chart-tooltip"
              style={{ left: tooltip.x, top: tooltip.y }}
            >
              <p className="stats-trend-chart-tooltip-title">
                {formatBucketTooltipLabel(buckets[tooltip.bucketIndex] ?? "")}
              </p>
              <div className="stats-trend-chart-tooltip-rows">
                {tooltipRows.map((entry) => (
                  <p key={`${entry.label}:${tooltip.bucketIndex}`} className="stats-trend-chart-tooltip-row">
                    <span
                      className="stats-trend-chart-tooltip-swatch"
                      style={{ backgroundColor: entry.color }}
                      aria-hidden="true"
                    />
                    <span>{entry.label}</span>
                    <span>{formatNumber(entry.value)}</span>
                  </p>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
});

type StatsStackedTrendChartProps = {
  ariaLabel: string;
  buckets: string[];
  series: StatsTrendSeries[];
  formatNumber: (value: number) => string;
  formatBucketAxisLabel: (bucketKey: string) => string;
  formatBucketTooltipLabel: (bucketKey: string) => string;
};

export const StatsStackedTrendChart = memo(function StatsStackedTrendChart({
  ariaLabel,
  buckets,
  series,
  formatNumber,
  formatBucketAxisLabel,
  formatBucketTooltipLabel,
}: StatsStackedTrendChartProps) {
  const [tooltip, setTooltip] = useState<ChartTooltipState | null>(null);
  const chartWrapRef = useRef<HTMLDivElement | null>(null);
  const bucketCount = buckets.length;
  const totalsPerBucket = useMemo(
    () =>
      buckets.map((_, bucketIndex) =>
        series.reduce((sum, entry) => sum + Math.max(0, entry.values[bucketIndex] ?? 0), 0)
      ),
    [buckets, series]
  );
  const maxTotal = useMemo(() => Math.max(1, ...totalsPerBucket), [totalsPerBucket]);
  const dynamicInnerWidth = Math.max(CHART_MIN_WIDTH, bucketCount * CHART_MIN_SLOT_WIDTH);
  const svgWidth = dynamicInnerWidth + CHART_MARGIN_LEFT + CHART_MARGIN_RIGHT;
  const svgHeight = CHART_HEIGHT + CHART_MARGIN_TOP + CHART_MARGIN_BOTTOM;
  const slotWidth = bucketCount > 0 ? dynamicInnerWidth / bucketCount : CHART_MIN_SLOT_WIDTH;
  const barWidth = Math.max(2, slotWidth - 3);
  const yTickCount = 4;
  const xLabelStep = Math.max(1, Math.ceil(bucketCount / 10));

  const tooltipRows = useMemo(() => {
    if (!tooltip) {
      return [];
    }
    return series
      .map((entry) => ({
        label: entry.label,
        value: entry.values[tooltip.bucketIndex] ?? 0,
        color: entry.color,
      }))
      .filter((entry) => entry.value > 0)
      .sort((left, right) => right.value - left.value || left.label.localeCompare(right.label));
  }, [series, tooltip]);

  const handleBucketMove = (event: ReactMouseEvent<SVGRectElement>, bucketIndex: number) => {
    if (!chartWrapRef.current) {
      return;
    }
    const tooltipPosition = getTooltipPosition(
      chartWrapRef.current,
      event.clientX,
      event.clientY,
      TREND_TOOLTIP_WIDTH_ESTIMATE,
      TREND_TOOLTIP_HEIGHT_ESTIMATE
    );
    setTooltip({
      bucketIndex,
      ...tooltipPosition,
    });
  };

  return (
    <div className="stats-trend-chart-wrap">
      <div className="stats-trend-chart-legend">
        {series.map((entry) => (
          <span key={entry.key} className="stats-trend-chart-legend-item">
            <span
              className="stats-trend-chart-legend-swatch"
              style={{ backgroundColor: entry.color }}
              aria-hidden="true"
            />
            <span>{entry.label}</span>
          </span>
        ))}
      </div>
      <div className="stats-trend-chart-scroll">
        <div className="stats-trend-chart-canvas" ref={chartWrapRef}>
          <svg
            className="stats-trend-chart-svg"
            viewBox={`0 0 ${svgWidth} ${svgHeight}`}
            role="img"
            aria-label={ariaLabel}
          >
            <g>
              {Array.from({ length: yTickCount + 1 }).map((_, tickIndex) => {
                const ratio = tickIndex / yTickCount;
                const y = CHART_MARGIN_TOP + CHART_HEIGHT - ratio * CHART_HEIGHT;
                const tickValue = Math.round(maxTotal * ratio);
                return (
                  <g key={`stack-y-grid-${tickIndex}`}>
                    <line
                      x1={CHART_MARGIN_LEFT}
                      x2={CHART_MARGIN_LEFT + dynamicInnerWidth}
                      y1={y}
                      y2={y}
                      className="stats-trend-chart-grid-line"
                    />
                    <text x={CHART_MARGIN_LEFT - 8} y={y + 4} className="stats-trend-chart-axis-label">
                      {formatNumber(tickValue)}
                    </text>
                  </g>
                );
              })}
            </g>
            <g>
              {buckets.map((bucket, bucketIndex) => {
                const slotLeft = CHART_MARGIN_LEFT + bucketIndex * slotWidth;
                const barLeft = slotLeft + (slotWidth - barWidth) / 2;
                let stackedHeight = 0;
                return (
                  <g key={`stack:${bucket}:${bucketIndex}`}>
                    {series.map((entry) => {
                      const value = Math.max(0, entry.values[bucketIndex] ?? 0);
                      if (value <= 0) {
                        return null;
                      }
                      const segmentHeight = (value / maxTotal) * CHART_HEIGHT;
                      const y = CHART_MARGIN_TOP + CHART_HEIGHT - stackedHeight - segmentHeight;
                      stackedHeight += segmentHeight;
                      return (
                        <rect
                          key={`${entry.key}:${bucketIndex}`}
                          x={barLeft}
                          y={y}
                          width={barWidth}
                          height={segmentHeight}
                          fill={entry.color}
                          rx={1}
                        />
                      );
                    })}
                    {(bucketIndex % xLabelStep === 0 || bucketIndex === buckets.length - 1) && (
                      <text
                        x={slotLeft + slotWidth / 2}
                        y={CHART_MARGIN_TOP + CHART_HEIGHT + 18}
                        className="stats-trend-chart-axis-label stats-trend-chart-axis-label-x"
                      >
                        {formatBucketAxisLabel(bucket)}
                      </text>
                    )}
                    <rect
                      x={slotLeft}
                      y={CHART_MARGIN_TOP}
                      width={slotWidth}
                      height={CHART_HEIGHT}
                      fill="transparent"
                      onMouseEnter={(event) => handleBucketMove(event, bucketIndex)}
                      onMouseMove={(event) => handleBucketMove(event, bucketIndex)}
                      onMouseLeave={() => setTooltip(null)}
                    />
                  </g>
                );
              })}
            </g>
          </svg>
          {tooltip ? (
            <div
              className="stats-trend-chart-tooltip"
              style={{ left: tooltip.x, top: tooltip.y }}
            >
              <p className="stats-trend-chart-tooltip-title">
                {formatBucketTooltipLabel(buckets[tooltip.bucketIndex] ?? "")}
              </p>
              <p className="stats-trend-chart-tooltip-subtitle">
                Total: {formatNumber(totalsPerBucket[tooltip.bucketIndex] ?? 0)}
              </p>
              <div className="stats-trend-chart-tooltip-rows">
                {tooltipRows.length > 0 ? (
                  tooltipRows.map((entry) => (
                    <p key={`${entry.label}:${tooltip.bucketIndex}`} className="stats-trend-chart-tooltip-row">
                      <span
                        className="stats-trend-chart-tooltip-swatch"
                        style={{ backgroundColor: entry.color }}
                        aria-hidden="true"
                      />
                      <span>{entry.label}</span>
                      <span>{formatNumber(entry.value)}</span>
                    </p>
                  ))
                ) : (
                  <p className="stats-trend-chart-tooltip-empty">No activity</p>
                )}
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
});

type HeatmapCell = {
  dayOfWeek: number;
  hourOfDay: number;
  trackedCount: number;
};

type StatsHourOfWeekHeatmapProps = {
  ariaLabel: string;
  cells: HeatmapCell[];
  formatNumber: (value: number) => string;
};

type HeatmapTooltipState = {
  dayOfWeek: number;
  hourOfDay: number;
  x: number;
  y: number;
};

export const StatsHourOfWeekHeatmap = memo(function StatsHourOfWeekHeatmap({
  ariaLabel,
  cells,
  formatNumber,
}: StatsHourOfWeekHeatmapProps) {
  const [tooltip, setTooltip] = useState<HeatmapTooltipState | null>(null);
  const heatmapWrapRef = useRef<HTMLDivElement | null>(null);

  const valuesByCell = useMemo(() => {
    const next = new Map<string, number>();
    for (const cell of cells) {
      if (cell.dayOfWeek < 0 || cell.dayOfWeek > 6 || cell.hourOfDay < 0 || cell.hourOfDay > 23) {
        continue;
      }
      next.set(`${cell.dayOfWeek}:${cell.hourOfDay}`, Math.max(0, cell.trackedCount));
    }
    return next;
  }, [cells]);
  const maxValue = useMemo(() => {
    let nextMax = 0;
    for (const value of valuesByCell.values()) {
      if (value > nextMax) {
        nextMax = value;
      }
    }
    return Math.max(1, nextMax);
  }, [valuesByCell]);

  const heatmapWidth = HEATMAP_MARGIN_LEFT + 24 * HEATMAP_CELL_WIDTH + HEATMAP_MARGIN_RIGHT;
  const heatmapHeight = HEATMAP_MARGIN_TOP + 7 * HEATMAP_CELL_HEIGHT + HEATMAP_MARGIN_BOTTOM;

  const tooltipValue =
    tooltip !== null ? valuesByCell.get(`${tooltip.dayOfWeek}:${tooltip.hourOfDay}`) ?? 0 : 0;

  const handleCellMove = (event: ReactMouseEvent<SVGRectElement>, dayOfWeek: number, hourOfDay: number) => {
    if (!heatmapWrapRef.current) {
      return;
    }
    const tooltipPosition = getTooltipPosition(
      heatmapWrapRef.current,
      event.clientX,
      event.clientY,
      TREND_TOOLTIP_WIDTH_ESTIMATE,
      TREND_TOOLTIP_HEIGHT_ESTIMATE
    );
    setTooltip({
      dayOfWeek,
      hourOfDay,
      ...tooltipPosition,
    });
  };

  return (
    <div className="stats-heatmap-wrap">
      <div className="stats-heatmap-canvas" ref={heatmapWrapRef}>
        <svg
          className="stats-heatmap-svg"
          viewBox={`0 0 ${heatmapWidth} ${heatmapHeight}`}
          role="img"
          aria-label={ariaLabel}
        >
          <g>
            {Array.from({ length: 24 }).map((_, hourOfDay) => {
              if (hourOfDay % 3 !== 0) {
                return null;
              }
              const x = HEATMAP_MARGIN_LEFT + hourOfDay * HEATMAP_CELL_WIDTH + HEATMAP_CELL_WIDTH / 2;
              return (
                <text key={`hour-label:${hourOfDay}`} x={x} y={16} className="stats-heatmap-axis-label">
                  {hourOfDay}
                </text>
              );
            })}
          </g>
          <g>
            {DAYS_OF_WEEK.map((dayLabel, dayOfWeek) => {
              const y = HEATMAP_MARGIN_TOP + dayOfWeek * HEATMAP_CELL_HEIGHT + HEATMAP_CELL_HEIGHT / 2 + 4;
              return (
                <text
                  key={`day-label:${dayLabel}`}
                  x={HEATMAP_MARGIN_LEFT - 8}
                  y={y}
                  className="stats-heatmap-axis-label stats-heatmap-axis-label-day"
                >
                  {dayLabel}
                </text>
              );
            })}
          </g>
          <g>
            {Array.from({ length: 7 }).map((_, dayOfWeek) =>
              Array.from({ length: 24 }).map((_, hourOfDay) => {
                const value = valuesByCell.get(`${dayOfWeek}:${hourOfDay}`) ?? 0;
                const x = HEATMAP_MARGIN_LEFT + hourOfDay * HEATMAP_CELL_WIDTH;
                const y = HEATMAP_MARGIN_TOP + dayOfWeek * HEATMAP_CELL_HEIGHT;
                return (
                  <rect
                    key={`cell:${dayOfWeek}:${hourOfDay}`}
                    x={x}
                    y={y}
                    width={HEATMAP_CELL_WIDTH - 1}
                    height={HEATMAP_CELL_HEIGHT - 1}
                    rx={2}
                    fill={getHeatmapCellColor(value, maxValue)}
                    onMouseEnter={(event) => handleCellMove(event, dayOfWeek, hourOfDay)}
                    onMouseMove={(event) => handleCellMove(event, dayOfWeek, hourOfDay)}
                    onMouseLeave={() => setTooltip(null)}
                  />
                );
              })
            )}
          </g>
        </svg>
        {tooltip ? (
          <div
            className="stats-trend-chart-tooltip"
            style={{ left: tooltip.x, top: tooltip.y }}
          >
            <p className="stats-trend-chart-tooltip-title">
              {DAYS_OF_WEEK[tooltip.dayOfWeek]} {String(tooltip.hourOfDay).padStart(2, "0")}:00
            </p>
            <p className="stats-trend-chart-tooltip-subtitle">Tracked: {formatNumber(tooltipValue)}</p>
          </div>
        ) : null}
      </div>
      <div className="stats-heatmap-legend">
        <span>Low</span>
        <div className="stats-heatmap-legend-bar" aria-hidden="true" />
        <span>High</span>
      </div>
    </div>
  );
});
