import React, { useState } from 'react';
import {
  calculateBarbellPlates,
  generateWarmupRamp,
  PlateDefinition,
  PlateResult,
  WarmupStep
} from '../../utils/plateCalculator';
import { PreferredUnit } from '../../types';

interface PlateCalculatorModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialWeight?: number;
  initialUnit?: PreferredUnit;
  exerciseName?: string;
}

export const PlateCalculatorModal: React.FC<PlateCalculatorModalProps> = ({
  isOpen,
  onClose,
  initialWeight = 100,
  initialUnit = 'kg',
  exerciseName
}) => {
  const [unit, setUnit] = useState<PreferredUnit>(initialUnit);
  const [targetWeight, setTargetWeight] = useState<number>(initialWeight);
  const [barWeight, setBarWeight] = useState<number>(initialUnit === 'kg' ? 20 : 45);
  const [activeTab, setActiveTab] = useState<'calculator' | 'warmup'>('calculator');

  if (!isOpen) return null;

  const result: PlateResult = calculateBarbellPlates(targetWeight, barWeight, unit);
  const warmupSteps: WarmupStep[] = generateWarmupRamp(targetWeight, barWeight, unit, 8);

  const handleAdjustWeight = (delta: number) => {
    setTargetWeight((prev) => Math.max(barWeight, Number((prev + delta).toFixed(1))));
  };

  const handleBarChange = (weight: number) => {
    setBarWeight(weight);
    if (targetWeight < weight) {
      setTargetWeight(weight);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-fadeIn">
      <div className="reshape-card w-full max-w-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-[var(--border-card)] bg-[var(--bg-subtle)]">
          <div>
            <div className="text-[11px] font-mono tracking-wide text-[var(--text-muted)] flex items-center gap-1.5">
              <span>Barbell Sleeve Engine</span>
              {exerciseName && (
                <>
                  <span aria-hidden="true">·</span>
                  <span className="text-[var(--text-secondary)] font-medium">{exerciseName}</span>
                </>
              )}
            </div>
            <h2 className="text-xl font-bold tracking-tight text-[var(--text-primary)]">
              Plate Math & Warm-Up Ramp
            </h2>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-lg text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--chip-bg)] transition-colors"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Tab Toggle */}
        <div className="flex border-b border-[var(--border-card)] px-5 pt-3 gap-4 bg-[var(--bg-surface)]">
          <button
            onClick={() => setActiveTab('calculator')}
            className={`pb-3 text-xs font-semibold tracking-wide transition-all border-b-2 ${
              activeTab === 'calculator'
                ? 'border-accent text-volt-adaptive'
                : 'border-transparent text-[var(--text-muted)] hover:text-[var(--text-primary)]'
            }`}
          >
            Visual Plate Sleeve
          </button>
          <button
            onClick={() => setActiveTab('warmup')}
            className={`pb-3 text-xs font-semibold tracking-wide transition-all border-b-2 ${
              activeTab === 'warmup'
                ? 'border-accent text-volt-adaptive'
                : 'border-transparent text-[var(--text-muted)] hover:text-[var(--text-primary)]'
            }`}
          >
            4-Stage Warm-Up Protocol
          </button>
        </div>

        {/* Scrollable Body */}
        <div className="p-6 overflow-y-auto space-y-6 flex-1">
          {/* Target Weight Controls */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="reshape-card-subtle p-4">
              <label className="text-[11px] font-mono tracking-wide text-[var(--text-muted)] block mb-1">
                Target Working Load ({unit})
              </label>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  step={unit === 'kg' ? 2.5 : 5}
                  min={barWeight}
                  value={targetWeight}
                  onChange={(e) => setTargetWeight(Math.max(barWeight, parseFloat(e.target.value) || barWeight))}
                  className="w-full text-2xl font-bold font-mono bg-transparent border-b border-[var(--border-card)] text-[var(--text-primary)] focus:outline-none focus:border-accent py-1"
                />
                <span className="text-sm font-bold text-[var(--text-muted)]">{unit}</span>
              </div>

              {/* Quick Stepper Buttons */}
              <div className="flex items-center gap-1.5 mt-3">
                {[-10, -2.5, 2.5, 10].map((delta) => (
                  <button
                    key={delta}
                    type="button"
                    onClick={() => handleAdjustWeight(delta)}
                    className="flex-1 py-1 text-xs font-mono font-semibold rounded bg-[var(--chip-bg)] hover:bg-[var(--chip-hover)] text-[var(--text-secondary)] transition-colors"
                  >
                    {delta > 0 ? `+${delta}` : delta}
                  </button>
                ))}
              </div>
            </div>

            {/* Barbell Weight & Unit Selectors */}
            <div className="reshape-card-subtle p-4 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-mono tracking-wide text-[var(--text-muted)]">
                  Weight Unit
                </span>
                <div className="flex items-center bg-[var(--chip-bg)] rounded-md p-0.5">
                  <button
                    type="button"
                    onClick={() => {
                      setUnit('kg');
                      setBarWeight(20);
                    }}
                    className={`px-3 py-1 text-xs font-semibold rounded ${
                      unit === 'kg' ? 'bg-accent text-accent-ink font-bold' : 'text-[var(--text-muted)]'
                    }`}
                  >
                    KG
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setUnit('lbs');
                      setBarWeight(45);
                    }}
                    className={`px-3 py-1 text-xs font-semibold rounded ${
                      unit === 'lbs' ? 'bg-accent text-accent-ink font-bold' : 'text-[var(--text-muted)]'
                    }`}
                  >
                    LBS
                  </button>
                </div>
              </div>

              <div className="flex items-center justify-between pt-1 border-t border-[var(--border-card)]">
                <span className="text-[11px] font-mono tracking-wide text-[var(--text-muted)]">
                  Bar Type
                </span>
                <select
                  value={barWeight}
                  onChange={(e) => handleBarChange(parseFloat(e.target.value))}
                  className="text-xs font-mono font-semibold bg-[var(--chip-bg)] text-[var(--text-primary)] border border-[var(--border-card)] rounded px-2 py-1 focus:outline-none"
                >
                  {unit === 'kg' ? (
                    <>
                      <option value={20}>Standard Olympic (20 kg)</option>
                      <option value={15}>Women's Olympic (15 kg)</option>
                      <option value={10}>Technique Bar (10 kg)</option>
                    </>
                  ) : (
                    <>
                      <option value={45}>Standard Olympic (45 lbs)</option>
                      <option value={35}>Women's Olympic (35 lbs)</option>
                      <option value={25}>Light / Trap Bar (25 lbs)</option>
                    </>
                  )}
                </select>
              </div>
            </div>
          </div>

          {activeTab === 'calculator' && (
            <div className="space-y-6">
              {/* Visual Barbell Graphic */}
              <div className="reshape-card-subtle p-6 flex flex-col items-center justify-center relative overflow-hidden min-h-[190px]">
                <div className="text-[11px] font-mono tracking-wide text-[var(--text-muted)] mb-4">
                  Visual Barbell Collar (Each Side: {result.perSideWeight} {unit})
                </div>

                {/* Barbell Sleeve Rendering */}
                <div className="w-full max-w-lg flex items-center justify-center py-4">
                  {/* Left Collar Stop */}
                  <div className="w-4 h-24 bg-zinc-600 rounded-l-sm border-r-2 border-line shadow-md"></div>
                  
                  {/* Steel Shaft Sleeve */}
                  <div className="relative flex items-center h-12 bg-gradient-to-b from-zinc-300 via-zinc-400 to-zinc-500 min-w-[240px] px-2 rounded-r-md border border-zinc-500 shadow-inner">
                    {/* Render Plates stacked from inside out */}
                    <div className="flex items-center gap-1">
                      {result.platesPerSide.length === 0 ? (
                        <span className="text-xs font-mono text-zinc-700 italic pl-4">Empty Bar ({barWeight} {unit})</span>
                      ) : (
                        result.platesPerSide.flatMap((plate, pIdx) =>
                          Array.from({ length: plate.count }).map((_, cIdx) => {
                            const heightPx = Math.max(34, Math.round(92 * plate.diameterPercent));
                            return (
                              <div
                                key={`${pIdx}-${cIdx}`}
                                style={{
                                  backgroundColor: plate.color,
                                  color: plate.textColor || '#ffffff',
                                  height: `${heightPx}px`
                                }}
                                className="w-6 rounded-[2px] shadow-lg flex flex-col items-center justify-center text-[11px] font-bold font-mono border border-black/40 transition-transform hover:scale-105 select-none"
                                title={`${plate.weight} ${unit}`}
                              >
                                <span className="rotate-90 origin-center whitespace-nowrap text-[11px] drop-shadow-sm">
                                  {plate.weight}
                                </span>
                              </div>
                            );
                          })
                        )
                      )}
                    </div>
                  </div>

                  {/* Outer Collar Lock */}
                  <div className="w-3 h-16 bg-zinc-700 border-l border-zinc-900 rounded-r-sm"></div>
                </div>

                {/* Achieved vs Target Status */}
                <div className="flex items-center gap-4 text-xs font-mono mt-3">
                  <span className="text-[var(--text-secondary)]">
                    Total Loaded: <strong className="text-[var(--text-primary)]">{result.achievedTotalWeight} {unit}</strong>
                  </span>
                  {result.difference !== 0 && (
                    <span className="text-amber-400">
                      (Δ {result.difference > 0 ? `-${result.difference}` : `+${Math.abs(result.difference)}`} {unit})
                    </span>
                  )}
                </div>
              </div>

              {/* Plate Inventory Breakdown List */}
              <div className="reshape-card-subtle p-4">
                <h3 className="text-xs font-semibold text-[var(--text-primary)] tracking-wide mb-3">
                  Plates to Load Per Side
                </h3>
                {result.platesPerSide.length === 0 ? (
                  <p className="text-xs text-[var(--text-muted)] italic">
                    Load no additional plates. Lift the bare barbell.
                  </p>
                ) : (
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                    {result.platesPerSide.map((p, idx) => (
                      <div
                        key={idx}
                        className="p-2.5 rounded-lg border border-[var(--border-card)] bg-[var(--bg-canvas)] flex items-center gap-2.5"
                      >
                        <div
                          style={{ backgroundColor: p.color }}
                          className="w-3.5 h-7 rounded-sm border border-black/30"
                        />
                        <div>
                          <div className="text-xs font-mono font-bold text-[var(--text-primary)]">
                            {p.count} × {p.weight} {unit}
                          </div>
                          <div className="text-[11px] text-[var(--text-muted)]">
                            = {p.count * p.weight} {unit}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {activeTab === 'warmup' && (
            <div className="space-y-4">
              <div className="text-xs text-[var(--text-secondary)] leading-relaxed">
                Evidence-based progression to elevate core muscle temperature, activate motor units, and groove biomechanical form without generating premature systemic fatigue.
              </div>

              <div className="space-y-3">
                {warmupSteps.map((step) => (
                  <div
                    key={step.stepNumber}
                    className="reshape-card-subtle p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                  >
                    <div className="space-y-1">
                      <div className="flex items-center gap-2 text-xs">
                        <span className="font-mono font-bold text-volt-adaptive">
                          Step {step.stepNumber}
                        </span>
                        <span className="text-[var(--text-muted)]">·</span>
                        <span className="font-semibold text-[var(--text-primary)]">
                          {step.label} ({step.percentage}%)
                        </span>
                      </div>
                      <p className="text-[11px] text-[var(--text-muted)]">{step.description}</p>
                    </div>

                    <div className="flex items-center gap-4">
                      <div className="text-right">
                        <div className="text-base font-bold font-mono text-[var(--text-primary)]">
                          {step.actualWeight} {unit} × {step.reps} reps
                        </div>
                        <div className="text-[11px] font-mono text-[var(--text-muted)]">
                          {step.platesPerSide.length === 0
                            ? 'Empty Bar'
                            : `Side: ${step.platesPerSide.map((p) => `${p.count}×${p.weight}`).join(', ')}`}
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-[var(--border-card)] bg-[var(--bg-subtle)] flex items-center justify-between">
          <span className="text-[11px] text-[var(--text-muted)]">
            Exact mathematical collar distribution
          </span>
          <button
            onClick={onClose}
            className="px-5 py-2 rounded-lg bg-accent hover:bg-accent-hover text-accent-ink font-bold text-xs tracking-wide transition-colors"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
};
