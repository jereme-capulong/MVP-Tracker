import { memo, type MouseEvent as ReactMouseEvent, useMemo, useRef, useState } from "react";

const CHART_HEIGHT = 280;
const CHART_MIN_WIDTH = 640;
const CHART_MIN_BAR_WIDTH = 20;
const CHART_MARGIN_TOP = 12;
const CHART_MARGIN_RIGHT = 16;
const CHART_MARGIN_BOTTOM = 44;
const CHART_MARGIN_LEFT = 46;
const TOOLTIP_EDGE_PADDING = 8;
const TOOLTIP_CURSOR_GAP_RIGHT = 6;
const TOOLTIP_CURSOR_GAP_LEFT = 3;
const TOOLTIP_CURSOR_GAP_VERTICAL = 6;
const DISTRIBUTION_TOOLTIP_WIDTH_ESTIMATE = 300;
const DISTRIBUTION_TOOLTIP_HEIGHT_ESTIMATE = 200;

export type StatsDistributionSeries = {
  personId: string | null;
  personName: string;
  values: number[];
  total: number;
};

export type StatsDistributionData = {
  days: string[];
  series: StatsDistributionSeries[];
  totalsPerDay: number[];
};

type StatsDistributionChartProps = {
  data: StatsDistributionData;
  formatNumber: (value: number) => string;
  formatBucketAxisLabel: (bucketKey: string) => string;
  formatBucketTooltipLabel: (bucketKey: string) => string;
};

function hashText(value: string): number {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }
  return hash;
}

function getSeriesColor(personId: string | null, personName: string): string {
  const seed = personId ?? personName;
  const hue = hashText(seed) % 360;
  return `hsl(${hue} 64% 56%)`;
}

type DistributionTooltipState = {
  dayIndex: number;
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

export const StatsDistributionChart = memo(function StatsDistributionChart({
  data,
  formatNumber,
  formatBucketAxisLabel,
  formatBucketTooltipLabel,
}: StatsDistributionChartProps) {
  const [tooltip, setTooltip] = useState<DistributionTooltipState | null>(null);
  const chartWrapRef = useRef<HTMLDivElement | null>(null);

  const seriesWithColor = useMemo(
    () =>
      data.series.map((entry) => ({
        ...entry,
        color: getSeriesColor(entry.personId, entry.personName),
      })),
    [data.series]
  );

  const dayCount = data.days.length;
  const maxTotal = useMemo(() => Math.max(1, ...data.totalsPerDay), [data.totalsPerDay]);
  const dynamicInnerWidth = Math.max(CHART_MIN_WIDTH, dayCount * CHART_MIN_BAR_WIDTH);
  const svgWidth = dynamicInnerWidth + CHART_MARGIN_LEFT + CHART_MARGIN_RIGHT;
  const svgHeight = CHART_HEIGHT + CHART_MARGIN_TOP + CHART_MARGIN_BOTTOM;
  const barSlotWidth = dayCount > 0 ? dynamicInnerWidth / dayCount : 0;
  const barWidth = Math.max(1, barSlotWidth - 3);
  const yTickCount = 4;
  const xLabelStep = Math.max(1, Math.ceil(dayCount / 10));

  const tooltipEntries = useMemo(() => {
    if (!tooltip) {
      return [];
    }
    const next = seriesWithColor
      .map((entry) => ({
        personName: entry.personName,
        value: entry.values[tooltip.dayIndex] ?? 0,
        color: entry.color,
      }))
      .filter((entry) => entry.value > 0)
      .sort((left, right) => right.value - left.value || left.personName.localeCompare(right.personName));
    return next;
  }, [seriesWithColor, tooltip]);

  const handleBarMove = (event: ReactMouseEvent<SVGGElement>, dayIndex: number) => {
    if (!chartWrapRef.current) {
      return;
    }
    const tooltipPosition = getTooltipPosition(
      chartWrapRef.current,
      event.clientX,
      event.clientY,
      DISTRIBUTION_TOOLTIP_WIDTH_ESTIMATE,
      DISTRIBUTION_TOOLTIP_HEIGHT_ESTIMATE
    );
    setTooltip({
      dayIndex,
      ...tooltipPosition,
    });
  };

  const handleBarLeave = () => {
    setTooltip(null);
  };

  return (
    <div className="stats-distribution-chart-wrap">
      <div className="stats-distribution-legend" aria-label="Contribution legend">
        {seriesWithColor.map((entry) => (
          <div className="stats-distribution-legend-item" key={`${entry.personId ?? "unknown"}:${entry.personName}`}>
            <span className="stats-distribution-legend-color" style={{ backgroundColor: entry.color }} aria-hidden="true" />
            <span className="stats-distribution-legend-name">{entry.personName}</span>
            <span className="stats-distribution-legend-total">{formatNumber(entry.total)}</span>
          </div>
        ))}
      </div>
      <div className="stats-distribution-chart-scroll">
        <div className="stats-distribution-chart-canvas" ref={chartWrapRef}>
          <svg
            className="stats-distribution-chart-svg"
            viewBox={`0 0 ${svgWidth} ${svgHeight}`}
            role="img"
            aria-label="Stacked daily contribution chart"
          >
            <g>
              {Array.from({ length: yTickCount + 1 }).map((_, tickIndex) => {
                const ratio = tickIndex / yTickCount;
                const y =
                  CHART_MARGIN_TOP + CHART_HEIGHT - Math.round(ratio * CHART_HEIGHT);
                const tickValue = Math.round(maxTotal * ratio);
                return (
                  <g key={`y-tick-${tickIndex}`}>
                    <line
                      x1={CHART_MARGIN_LEFT}
                      x2={CHART_MARGIN_LEFT + dynamicInnerWidth}
                      y1={y}
                      y2={y}
                      className="stats-distribution-grid-line"
                    />
                    <text x={CHART_MARGIN_LEFT - 8} y={y + 4} className="stats-distribution-axis-label">
                      {formatNumber(tickValue)}
                    </text>
                  </g>
                );
              })}
            </g>
            <g>
              {data.days.map((dayKey, dayIndex) => {
                const slotLeft = CHART_MARGIN_LEFT + dayIndex * barSlotWidth;
                const barLeft = slotLeft + (barSlotWidth - barWidth) / 2;
                let stackedHeight = 0;
                const renderedSegments = seriesWithColor.map((entry) => {
                  const value = entry.values[dayIndex] ?? 0;
                  if (value <= 0) {
                    return null;
                  }
                  const segmentHeight = (value / maxTotal) * CHART_HEIGHT;
                  const y =
                    CHART_MARGIN_TOP + CHART_HEIGHT - stackedHeight - segmentHeight;
                  stackedHeight += segmentHeight;
                  return (
                    <rect
                      key={`${entry.personId ?? "unknown"}:${dayIndex}`}
                      x={barLeft}
                      y={y}
                      width={barWidth}
                      height={segmentHeight}
                      fill={entry.color}
                      rx={1}
                    />
                  );
                });

                return (
                  <g
                    key={dayKey}
                    onMouseEnter={(event) => handleBarMove(event, dayIndex)}
                    onMouseMove={(event) => handleBarMove(event, dayIndex)}
                    onMouseLeave={handleBarLeave}
                  >
                    {renderedSegments}
                    {dayIndex % xLabelStep === 0 || dayIndex === data.days.length - 1 ? (
                      <text
                        x={slotLeft + barSlotWidth / 2}
                        y={CHART_MARGIN_TOP + CHART_HEIGHT + 18}
                        className="stats-distribution-axis-label stats-distribution-axis-label-x"
                      >
                        {formatBucketAxisLabel(dayKey)}
                      </text>
                    ) : null}
                  </g>
                );
              })}
            </g>
          </svg>
          {tooltip ? (
            <div
              className="stats-distribution-tooltip"
              style={{
                left: tooltip.x,
                top: tooltip.y,
              }}
            >
              <p className="stats-distribution-tooltip-day">
                {formatBucketTooltipLabel(data.days[tooltip.dayIndex] ?? "")}
              </p>
              <p className="stats-distribution-tooltip-total">
                Total: {formatNumber(data.totalsPerDay[tooltip.dayIndex] ?? 0)}
              </p>
              <div className="stats-distribution-tooltip-series">
                {tooltipEntries.length > 0 ? (
                  tooltipEntries.map((entry, entryIndex) => (
                    <p
                      key={`${entry.personName}:${tooltip?.dayIndex}:${entryIndex}`}
                      className="stats-distribution-tooltip-series-row"
                    >
                      <span className="stats-distribution-tooltip-swatch" style={{ backgroundColor: entry.color }} aria-hidden="true" />
                      <span className="stats-distribution-tooltip-name">{entry.personName}</span>
                      <span>{formatNumber(entry.value)}</span>
                    </p>
                  ))
                ) : (
                  <p className="stats-distribution-tooltip-empty">No contributions</p>
                )}
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
});
