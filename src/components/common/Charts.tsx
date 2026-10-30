import React, { useEffect, useId, useRef, useState } from 'react';

interface DataPoint {
  date: string;
  value: number;
  label?: string;
  secondaryValue?: number;
}

interface LineChartProps {
  data: DataPoint[];
  title?: string;
  unit?: string;
  /** Any CSS colour. Defaults to the theme-aware series-1 token. */
  accentColor?: string;
  targetLine?: number;
  targetLabel?: string;
  secondaryLineName?: string;
  height?: number;
  emptyMessage?: string;
  /**
   * Draw at the container's real pixel width (re-measured on resize) instead of a fixed 600-unit
   * viewBox, so axis labels keep their true size on narrow screens. Off by default.
   */
  responsive?: boolean;
  /**
   * Smallest y-axis range (in `unit`s) the chart will draw. When the data spans less, the axis is widened
   * around it so a 0.3 change does not fill the whole plot. Off by default (axis fits the data).
   */
  minYSpan?: number;
  /** Decimals on y-axis labels. Defaults to 0; use 1 for small ranges so labels do not repeat. */
  yTickDecimals?: number;
}

export const LineChart: React.FC<LineChartProps> = ({
  data,
  title,
  unit = '',
  accentColor = 'var(--chart-1)',
  targetLine,
  targetLabel,
  secondaryLineName,
  height = 200,
  emptyMessage = 'No session data recorded in this period',
  responsive = false,
  minYSpan,
  yTickDecimals = 0
}) => {
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const [measuredWidth, setMeasuredWidth] = useState<number | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const hasData = Boolean(data && data.length > 0);

  useEffect(() => {
    if (!responsive || !hasData) return;
    const el = wrapRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const measure = () => {
      const w = Math.round(el.getBoundingClientRect().width);
      if (w > 0) setMeasuredWidth(w);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [responsive, hasData]);
  // Unique per chart so several LineCharts on one page don't share (and recolor) one gradient
  const gradientId = `chartGradient-${useId().replace(/:/g, '')}`;

  if (!data || data.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-[var(--text-muted)] reshape-card-subtle">
        <p className="text-xs tracking-wide">{emptyMessage}</p>
      </div>
    );
  }

  // Padding
  const padding = { top: 20, right: 24, bottom: 30, left: 45 };
  const width = responsive && measuredWidth ? Math.max(280, measuredWidth) : 600; // viewBox width
  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;

  // Determine min and max
  const values = data.map((d) => d.value);
  if (targetLine !== undefined) values.push(targetLine);
  data.forEach((d) => {
    if (d.secondaryValue !== undefined) values.push(d.secondaryValue);
  });

  let rawMin = Math.min(...values);
  let rawMax = Math.max(...values);
  if (minYSpan !== undefined && rawMax - rawMin < minYSpan) {
    const pad = (minYSpan - (rawMax - rawMin)) / 2;
    rawMin -= pad;
    rawMax += pad;
  }
  const spread = rawMax - rawMin || 10;
  // With decimal labels the axis bounds are not snapped to whole numbers, so labels stay true to the data.
  const snap = yTickDecimals > 0 ? { lo: (v: number) => v, hi: (v: number) => v } : { lo: Math.floor, hi: Math.ceil };
  const yMin = Math.max(0, snap.lo(rawMin - spread * 0.1));
  const yMax = snap.hi(rawMax + spread * 0.1);

  // Scaling functions
  const getX = (index: number) => {
    if (data.length <= 1) return padding.left + plotWidth / 2;
    return padding.left + (index / (data.length - 1)) * plotWidth;
  };

  const getY = (val: number) => {
    if (yMax === yMin) return padding.top + plotHeight / 2;
    return padding.top + plotHeight - ((val - yMin) / (yMax - yMin)) * plotHeight;
  };

  // Build SVG path
  const points = data.map((d, i) => `${getX(i)},${getY(d.value)}`).join(' ');
  const areaPoints = [
    `${getX(0)},${padding.top + plotHeight}`,
    ...data.map((d, i) => `${getX(i)},${getY(d.value)}`),
    `${getX(data.length - 1)},${padding.top + plotHeight}`
  ].join(' ');

  // Secondary line points if available
  const hasSecondary = data.some((d) => d.secondaryValue !== undefined);
  const secondaryPoints = hasSecondary
    ? data
        .filter((d) => d.secondaryValue !== undefined)
        .map((d, i) => `${getX(i)},${getY(d.secondaryValue!)}`)
        .join(' ')
    : '';

  // 4 horizontal grid lines
  const gridTicks = [yMin, yMin + (yMax - yMin) * 0.33, yMin + (yMax - yMin) * 0.66, yMax];

  return (
    <div className="w-full">
      {title && (
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-mono font-bold text-[var(--text-secondary)] tracking-wide">{title}</span>
          {hoverIndex !== null && data[hoverIndex] && (
            <div className="text-xs font-mono text-[var(--text-primary)]">
              <span className="text-[var(--text-muted)] mr-1.5">{data[hoverIndex].date}:</span>
              <span className="font-bold text-volt-adaptive">
                {data[hoverIndex].value} {unit}
              </span>
              {data[hoverIndex].secondaryValue !== undefined && (
                <span className="text-sky-500 ml-2">
                  (avg: {data[hoverIndex].secondaryValue} {unit})
                </span>
              )}
            </div>
          )}
        </div>
      )}

      <div ref={wrapRef} className="relative w-full overflow-hidden">
        <svg
          viewBox={`0 0 ${width} ${height}`}
          className="w-full h-auto overflow-visible select-none"
          role="img"
          aria-label={`${title ?? 'Chart'}: ${data.length} point${data.length === 1 ? '' : 's'}, latest ${data[data.length - 1].value} ${unit}`.trim()}
        >
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" style={{ stopColor: accentColor }} stopOpacity="0.25" />
              <stop offset="100%" style={{ stopColor: accentColor }} stopOpacity="0.0" />
            </linearGradient>
          </defs>

          {/* Grid lines */}
          {gridTicks.map((tickVal, idx) => {
            const y = getY(tickVal);
            return (
              <g key={idx}>
                <line
                  x1={padding.left}
                  y1={y}
                  x2={width - padding.right}
                  y2={y}
                  stroke="currentColor"
                  className="text-[var(--border-card)]"
                  strokeDasharray="3 3"
                  strokeWidth="1"
                />
                <text
                  x={padding.left - 8}
                  y={y + 3}
                  textAnchor="end"
                  className="fill-[var(--text-muted)] text-label font-mono"
                >
                  {tickVal.toFixed(yTickDecimals)}
                </text>
              </g>
            );
          })}

          {/* Target Reference Line if provided */}
          {targetLine !== undefined && (
            <g>
              <line
                x1={padding.left}
                y1={getY(targetLine)}
                x2={width - padding.right}
                y2={getY(targetLine)}
                style={{ stroke: 'var(--warning)' }}
                strokeDasharray="4 4"
                strokeWidth="1.5"
              />
              <text
                x={width - padding.right}
                y={getY(targetLine) - 5}
                textAnchor="end"
                className="fill-amber-400 text-label font-mono font-medium"
              >
                {targetLabel || `Goal: ${targetLine} ${unit}`}
              </text>
            </g>
          )}

          {/* Area fill */}
          {data.length > 1 && (
            <polygon points={areaPoints} fill={`url(#${gradientId})`} />
          )}

          {/* Secondary Line (e.g. 7-day average) */}
          {hasSecondary && (
            <polyline
              fill="none"
              style={{ stroke: 'var(--chart-2)' }}
              strokeWidth="2"
              strokeDasharray="3 2"
              points={secondaryPoints}
            />
          )}

          {/* Primary Trend Line */}
          {data.length > 1 ? (
            <polyline
              fill="none"
              style={{ stroke: accentColor }}
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              points={points}
            />
          ) : (
            <circle
              cx={getX(0)}
              cy={getY(data[0].value)}
              r="5"
              style={{ fill: accentColor }}
            />
          )}

          {/* Data Points */}
          {data.map((d, idx) => {
            const cx = getX(idx);
            const cy = getY(d.value);
            const isHovered = hoverIndex === idx;
            return (
              <g key={idx}>
                <circle
                  cx={cx}
                  cy={cy}
                  r={isHovered ? 5.5 : 3.5}
                  style={{ fill: isHovered ? 'var(--text-primary)' : accentColor, stroke: 'var(--chart-ring)' }}
                  strokeWidth="2"
                  className="transition-all duration-150 motion-reduce:transition-none"
                  pointerEvents="none"
                />
                {/* Larger invisible target: hover on desktop, tap on touch screens */}
                <circle
                  cx={cx}
                  cy={cy}
                  r={14}
                  fill="transparent"
                  className="cursor-pointer"
                  data-chart-point={idx}
                  onMouseEnter={() => setHoverIndex(idx)}
                  onMouseLeave={() => setHoverIndex(null)}
                  onClick={() => setHoverIndex((cur) => (cur === idx ? null : idx))}
                />
              </g>
            );
          })}

          {/* X Axis Date Labels */}
          {data.length > 0 && (
            <>
              <text
                x={getX(0)}
                y={height - 8}
                textAnchor="start"
                className="fill-zinc-500 text-label font-mono"
              >
                {data[0].date.slice(5)}
              </text>
              {data.length > 2 && (
                <text
                  x={getX(Math.floor(data.length / 2))}
                  y={height - 8}
                  textAnchor="middle"
                  className="fill-zinc-500 text-label font-mono"
                >
                  {data[Math.floor(data.length / 2)].date.slice(5)}
                </text>
              )}
              {data.length > 1 && (
                <text
                  x={getX(data.length - 1)}
                  y={height - 8}
                  textAnchor="end"
                  className="fill-zinc-500 text-label font-mono"
                >
                  {data[data.length - 1].date.slice(5)}
                </text>
              )}
            </>
          )}
        </svg>
      </div>

      {hasSecondary && (
        <div className="flex items-center justify-end gap-4 mt-1 text-label text-zinc-400">
          <div className="flex items-center gap-1.5">
            <span className="w-2.5 h-0.5 rounded-full" style={{ backgroundColor: accentColor }} />
            <span>Daily Log</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-2.5 h-0.5 border-dashed border-b border-chart-2" />
            <span>{secondaryLineName || '7-Day Rolling Avg'}</span>
          </div>
        </div>
      )}
    </div>
  );
};

interface BarChartProps {
  data: { label: string; value: number; secondary?: number }[];
  title?: string;
  unit?: string;
  target?: number;
  height?: number;
  /** Show at most about this many x labels (evenly thinned) so dense charts stay legible. Default: show all. */
  maxLabels?: number;
}

export const BarChart: React.FC<BarChartProps> = ({
  data,
  title,
  unit = '',
  target,
  height = 180,
  maxLabels
}) => {
  const [selected, setSelected] = useState<number | null>(null);
  if (!data || data.length === 0) {
    return (
      <div className="flex items-center justify-center py-10 text-[var(--text-muted)] reshape-card-subtle">
        <p className="text-xs">No volume data to display</p>
      </div>
    );
  }

  const values = data.map((d) => d.value);
  if (target) values.push(target);
  const maxVal = Math.max(...values, 100);

  return (
    <div className="w-full">
      {title && (
        <div className="flex items-center justify-between mb-3">
          <span className="text-xs font-semibold text-[var(--text-secondary)] tracking-wide">{title}</span>
        </div>
      )}

      <div className="flex items-end gap-1.5 sm:gap-2 pt-6 pb-2" style={{ height: `${height}px` }} role="list" aria-label={title}>
        {data.map((item, idx) => {
          const heightPercent = Math.min(100, Math.max(5, (item.value / maxVal) * 100));
          const labelStep = maxLabels && data.length > maxLabels ? Math.ceil(data.length / maxLabels) : 1;
          const showLabel = idx % labelStep === 0 || idx === data.length - 1;
          const isSelected = selected === idx;
          return (
            <div
              key={idx}
              role="listitem"
              tabIndex={0}
              aria-label={`${item.label}: ${item.value} ${unit}`.trim()}
              onClick={() => setSelected((cur) => (cur === idx ? null : idx))}
              onBlur={() => setSelected((cur) => (cur === idx ? null : cur))}
              className="flex-1 min-w-0 flex flex-col items-center h-full justify-end group cursor-pointer rounded-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
            >
              {/* Tooltip value: hover, keyboard focus or tap */}
              <div
                className={`${isSelected ? 'opacity-100' : 'opacity-0'} group-hover:opacity-100 group-focus-visible:opacity-100 transition-opacity motion-reduce:transition-none text-label font-mono text-[var(--text-primary)] mb-1 whitespace-nowrap`}
              >
                {item.value} {unit}
              </div>

              {/* Bar */}
              <div className="w-full max-w-[36px] flex-1 min-h-0 bg-[var(--chip-bg)] rounded-t-sm relative transition-all motion-reduce:transition-none overflow-hidden flex items-end">
                <div
                  className="w-full bg-accent group-hover:brightness-110 transition-all motion-reduce:transition-none rounded-t-sm"
                  style={{ height: `${heightPercent}%` }}
                />
              </div>

              {/* Label */}
              <span className="text-label font-mono text-[var(--text-muted)] mt-2 truncate w-full text-center h-4">
                {showLabel ? item.label : ''}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
};
