import React, { useState } from 'react';

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
  accentColor?: string; // e.g. '#a3e635' (lime)
  targetLine?: number;
  targetLabel?: string;
  secondaryLineName?: string;
  height?: number;
  emptyMessage?: string;
}

export const LineChart: React.FC<LineChartProps> = ({
  data,
  title,
  unit = '',
  accentColor = '#a3e635',
  targetLine,
  targetLabel,
  secondaryLineName,
  height = 200,
  emptyMessage = 'No session data recorded in this period'
}) => {
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);

  if (!data || data.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-[var(--text-muted)] reshape-card-subtle">
        <p className="text-xs uppercase tracking-wider">{emptyMessage}</p>
      </div>
    );
  }

  // Padding
  const padding = { top: 20, right: 24, bottom: 30, left: 45 };
  const width = 600; // viewBox relative width
  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;

  // Determine min and max
  const values = data.map((d) => d.value);
  if (targetLine !== undefined) values.push(targetLine);
  data.forEach((d) => {
    if (d.secondaryValue !== undefined) values.push(d.secondaryValue);
  });

  const rawMin = Math.min(...values);
  const rawMax = Math.max(...values);
  const spread = rawMax - rawMin || 10;
  const yMin = Math.max(0, Math.floor(rawMin - spread * 0.1));
  const yMax = Math.ceil(rawMax + spread * 0.1);

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
          <span className="text-xs font-mono font-bold text-[var(--text-secondary)] uppercase tracking-wider">{title}</span>
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

      <div className="relative w-full overflow-hidden">
        <svg
          viewBox={`0 0 ${width} ${height}`}
          className="w-full h-auto overflow-visible select-none"
        >
          <defs>
            <linearGradient id="chartGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={accentColor} stopOpacity="0.25" />
              <stop offset="100%" stopColor={accentColor} stopOpacity="0.0" />
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
                  className="fill-[var(--text-muted)] text-[10px] font-mono"
                >
                  {tickVal.toFixed(0)}
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
                stroke="#f59e0b"
                strokeDasharray="4 4"
                strokeWidth="1.5"
              />
              <text
                x={width - padding.right}
                y={getY(targetLine) - 5}
                textAnchor="end"
                className="fill-amber-400 text-[9px] font-mono font-medium"
              >
                {targetLabel || `Goal: ${targetLine} ${unit}`}
              </text>
            </g>
          )}

          {/* Area fill */}
          {data.length > 1 && (
            <polygon points={areaPoints} fill="url(#chartGradient)" />
          )}

          {/* Secondary Line (e.g. 7-day average) */}
          {hasSecondary && (
            <polyline
              fill="none"
              stroke="#38bdf8"
              strokeWidth="2"
              strokeDasharray="3 2"
              points={secondaryPoints}
            />
          )}

          {/* Primary Trend Line */}
          {data.length > 1 ? (
            <polyline
              fill="none"
              stroke={accentColor}
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
              fill={accentColor}
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
                  fill={isHovered ? '#ffffff' : accentColor}
                  stroke="#12161b"
                  strokeWidth="2"
                  className="cursor-pointer transition-all duration-150"
                  onMouseEnter={() => setHoverIndex(idx)}
                  onMouseLeave={() => setHoverIndex(null)}
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
                className="fill-zinc-500 text-[10px] font-mono"
              >
                {data[0].date.slice(5)}
              </text>
              {data.length > 2 && (
                <text
                  x={getX(Math.floor(data.length / 2))}
                  y={height - 8}
                  textAnchor="middle"
                  className="fill-zinc-500 text-[10px] font-mono"
                >
                  {data[Math.floor(data.length / 2)].date.slice(5)}
                </text>
              )}
              {data.length > 1 && (
                <text
                  x={getX(data.length - 1)}
                  y={height - 8}
                  textAnchor="end"
                  className="fill-zinc-500 text-[10px] font-mono"
                >
                  {data[data.length - 1].date.slice(5)}
                </text>
              )}
            </>
          )}
        </svg>
      </div>

      {hasSecondary && (
        <div className="flex items-center justify-end gap-4 mt-1 text-[11px] text-zinc-400">
          <div className="flex items-center gap-1.5">
            <span className="w-2.5 h-0.5 bg-lime-400 rounded-full" />
            <span>Daily Log</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-2.5 h-0.5 bg-sky-400 border-dashed border-b border-sky-400" />
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
}

export const BarChart: React.FC<BarChartProps> = ({
  data,
  title,
  unit = '',
  target,
  height = 180
}) => {
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
          <span className="text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wider">{title}</span>
        </div>
      )}

      <div className="flex items-end gap-2 pt-6 pb-2" style={{ height: `${height}px` }}>
        {data.map((item, idx) => {
          const heightPercent = Math.min(100, Math.max(5, (item.value / maxVal) * 100));
          return (
            <div key={idx} className="flex-1 flex flex-col items-center h-full justify-end group">
              {/* Tooltip value */}
              <div className="opacity-0 group-hover:opacity-100 transition-opacity text-[10px] font-mono text-[var(--text-primary)] mb-1 whitespace-nowrap">
                {item.value} {unit}
              </div>

              {/* Bar */}
              <div className="w-full max-w-[36px] bg-[var(--chip-bg)] rounded-t-sm relative transition-all overflow-hidden flex items-end">
                <div
                  className="w-full bg-[#CEFF00] group-hover:brightness-110 transition-all rounded-t-sm"
                  style={{ height: `${heightPercent}%` }}
                />
              </div>

              {/* Label */}
              <span className="text-[10px] font-mono text-[var(--text-muted)] mt-2 truncate w-full text-center">
                {item.label}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
};
