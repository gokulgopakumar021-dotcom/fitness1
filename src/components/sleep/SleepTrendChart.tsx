import React, { useState } from 'react';
import { DailySleepLog, WorkoutSession } from '../../types';
import { analyzeSleepPerformanceCorrelation } from '../../utils/sleepAnalytics';
import { SleepLoggerModal } from './SleepLoggerModal';

interface SleepTrendChartProps {
  sleepLogs: DailySleepLog[];
  sessions: WorkoutSession[];
  onSleepLogsUpdated: () => void;
}

export const SleepTrendChart: React.FC<SleepTrendChartProps> = ({
  sleepLogs,
  sessions,
  onSleepLogsUpdated
}) => {
  const [isLogModalOpen, setIsLogModalOpen] = useState(false);
  const [activeTooltipIdx, setActiveTooltipIdx] = useState<number | null>(null);

  const analysis = analyzeSleepPerformanceCorrelation(sleepLogs, sessions);
  const data = analysis.pairedData.slice(-14); // show last 14 days

  const maxSleepHours = Math.max(10, ...data.map((d) => d.sleepHours));
  const maxVolume = Math.max(1000, ...data.map((d) => d.workoutVolume));

  return (
    <div className="reshape-card p-5 lg:p-6 space-y-6">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-[var(--border-card)] pb-4">
        <div>
          <div className="text-[10px] font-mono tracking-wider uppercase text-[var(--text-muted)] flex items-center gap-1.5">
            <span>Recovery Biomarkers</span>
            <span aria-hidden="true">·</span>
            <span className="text-volt-adaptive font-semibold">Sleep Architecture & Performance</span>
          </div>
          <h3 className="text-lg font-bold tracking-tight text-[var(--text-primary)]">
            Rest & Training Correlation Trend
          </h3>
        </div>

        <button
          onClick={() => setIsLogModalOpen(true)}
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[var(--chip-bg)] hover:bg-[var(--chip-hover)] text-xs font-semibold text-[var(--text-primary)] border border-[var(--border-card)] transition-colors self-start sm:self-auto"
        >
          <svg className="w-4 h-4 text-volt-adaptive" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          <span>Log Last Night's Sleep</span>
        </button>
      </div>

      {/* Scientific Correlation Highlight Callout */}
      <div className="reshape-card-subtle p-4 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-[#CEFF00]/10 border border-[#CEFF00]/30 flex items-center justify-center shrink-0">
            <svg className="w-5 h-5 text-volt-adaptive" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
            </svg>
          </div>
          <div>
            <div className="text-[10px] font-mono uppercase tracking-wider text-[var(--text-muted)]">
              Readiness & Output Finding
            </div>
            <p className="text-xs font-semibold text-[var(--text-primary)] leading-relaxed">
              {analysis.readinessCorrelationComment}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-4 shrink-0 text-xs font-mono">
          <div className="text-right">
            <div className="text-[10px] text-[var(--text-muted)] uppercase">Avg Duration</div>
            <div className="text-sm font-bold text-[var(--text-primary)]">
              {analysis.averageSleepHours} hrs
            </div>
          </div>
          <div className="h-7 w-[1px] bg-[var(--border-card)]"></div>
          <div className="text-right">
            <div className="text-[10px] text-[var(--text-muted)] uppercase">Quality Score</div>
            <div className="text-sm font-bold text-volt-adaptive">
              {analysis.averageSleepQuality}%
            </div>
          </div>
        </div>
      </div>

      {/* Dual Correlation Chart */}
      <div className="space-y-3">
        <div className="flex items-center justify-between text-[11px] font-mono text-[var(--text-muted)]">
          <div className="flex items-center gap-3">
            <span className="flex items-center gap-1.5">
              <span className="w-3 h-3 rounded-sm bg-[#CEFF00]"></span> Sleep Duration (Hours)
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full bg-cyan-400"></span> Workout Volume (Tonnage)
            </span>
          </div>
          <span>Hover bar to inspect details</span>
        </div>

        {data.length === 0 ? (
          <div className="flex items-center justify-center py-12 text-xs text-[var(--text-muted)] reshape-card-subtle">
            No sleep logs recorded yet. Tap "Log Last Night's Sleep" to begin tracking.
          </div>
        ) : (
          <div className="relative pt-6 pb-2 min-h-[220px]">
            {/* 8-Hour Benchmark Reference Line */}
            <div
              className="absolute left-0 right-0 border-b border-dashed border-zinc-600/60 z-0 flex items-center justify-end pr-2"
              style={{ bottom: `${(8.0 / maxSleepHours) * 160 + 28}px` }}
            >
              <span className="text-[9px] font-mono text-zinc-500 bg-[var(--bg-canvas)] px-1 rounded">
                8.0h Target
              </span>
            </div>

            {/* Bars & Markers Container */}
            <div className="flex items-end gap-2 h-44 w-full">
              {data.map((item, idx) => {
                const heightPercent = Math.min(100, Math.max(10, (item.sleepHours / maxSleepHours) * 100));
                const volumeHeightPercent = item.hasWorkout && maxVolume > 0
                  ? Math.min(95, Math.max(15, (item.workoutVolume / maxVolume) * 100))
                  : null;

                const dateFormatted = item.date.slice(5); // MM-DD
                const isHovered = activeTooltipIdx === idx;

                return (
                  <div
                    key={idx}
                    className="flex-1 flex flex-col items-center h-full justify-end relative group cursor-pointer"
                    onMouseEnter={() => setActiveTooltipIdx(idx)}
                    onMouseLeave={() => setActiveTooltipIdx(null)}
                  >
                    {/* Tooltip Popup */}
                    {isHovered && (
                      <div className="absolute bottom-full mb-3 z-30 p-2.5 rounded-lg bg-zinc-900 border border-zinc-700 shadow-2xl text-[10px] font-mono text-zinc-200 pointer-events-none min-w-[140px] whitespace-nowrap">
                        <div className="font-bold text-white border-b border-zinc-700 pb-1 mb-1">
                          {item.date}
                        </div>
                        <div>Sleep: <strong className="text-[#CEFF00]">{item.sleepHours}h</strong> ({item.sleepQuality}%)</div>
                        {item.restingHeartRate && <div>RHR: {item.restingHeartRate} bpm</div>}
                        {item.hasWorkout ? (
                          <div className="text-cyan-400 mt-1 border-t border-zinc-800 pt-1">
                            Workout: {item.workoutVolume} kg vol · RPE {item.averageRpe}
                          </div>
                        ) : (
                          <div className="text-zinc-500 mt-1">Rest Day (No lifting)</div>
                        )}
                      </div>
                    )}

                    {/* Workout Volume Marker Point */}
                    {volumeHeightPercent !== null && (
                      <div
                        className="absolute w-2.5 h-2.5 rounded-full bg-cyan-400 border-2 border-black z-10 shadow-sm"
                        style={{ bottom: `${volumeHeightPercent}%` }}
                        title={`Workout volume: ${item.workoutVolume} kg`}
                      />
                    )}

                    {/* Sleep Duration Bar */}
                    <div className="w-full max-w-[28px] bg-[var(--chip-bg)] rounded-t-sm relative transition-all overflow-hidden flex items-end">
                      <div
                        className={`w-full transition-all rounded-t-sm ${
                          item.sleepHours >= 7.5
                            ? 'bg-[#CEFF00] group-hover:brightness-110'
                            : 'bg-amber-400/80 group-hover:bg-amber-400'
                        }`}
                        style={{ height: `${heightPercent}%` }}
                      />
                    </div>

                    {/* Date Label */}
                    <span className="text-[9px] font-mono text-[var(--text-muted)] mt-2">
                      {dateFormatted}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* Sleep Logger Modal */}
      <SleepLoggerModal
        isOpen={isLogModalOpen}
        onClose={() => setIsLogModalOpen(false)}
        onSaved={() => {
          onSleepLogsUpdated();
        }}
      />
    </div>
  );
};
