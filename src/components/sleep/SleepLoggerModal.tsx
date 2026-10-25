import React, { useState } from 'react';
import { DailySleepLog } from '../../types';
import { db } from '../../storage/db';

interface SleepLoggerModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSaved: (log: DailySleepLog) => void;
  defaultDate?: string;
}

export const SleepLoggerModal: React.FC<SleepLoggerModalProps> = ({
  isOpen,
  onClose,
  onSaved,
  defaultDate
}) => {
  const todayStr = defaultDate || new Date().toISOString().split('T')[0];
  const existing = db.getSleepLogForDate(todayStr);

  const [date, setDate] = useState<string>(todayStr);
  const [hoursSlept, setSleepHours] = useState<number>(existing?.hoursSlept || 7.5);
  const [quality, setQuality] = useState<number>(existing?.quality || 85);
  const [restingHeartRate, setRestingHeartRate] = useState<string>(
    existing?.restingHeartRate ? String(existing.restingHeartRate) : '54'
  );
  const [hrvMs, setHrvMs] = useState<string>(existing?.hrvMs ? String(existing.hrvMs) : '68');
  const [notes, setNotes] = useState<string>(existing?.notes || '');

  if (!isOpen) return null;

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();

    const log: DailySleepLog = {
      id: existing?.id || `sleep-${date}-${Date.now()}`,
      date,
      hoursSlept: Number(hoursSlept),
      quality: Number(quality),
      restingHeartRate: restingHeartRate ? parseInt(restingHeartRate, 10) : undefined,
      hrvMs: hrvMs ? parseInt(hrvMs, 10) : undefined,
      notes: notes.trim() || undefined
    };

    db.saveSleepLog(log);
    onSaved(log);
    onClose();
  };

  const getQualityLabel = (val: number) => {
    if (val >= 90) return { label: 'Peak Restoration', color: 'text-volt-adaptive' };
    if (val >= 75) return { label: 'Optimal Sleep', color: 'text-emerald-400' };
    if (val >= 60) return { label: 'Adequate Recovery', color: 'text-amber-400' };
    return { label: 'Deficit / Fragmented', color: 'text-rose-400' };
  };

  const qualInfo = getQualityLabel(quality);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-fadeIn">
      <div className="reshape-card w-full max-w-lg overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-[var(--border-card)] bg-[var(--bg-subtle)]">
          <div>
            <div className="text-[11px] font-mono tracking-wide text-[var(--text-muted)] flex items-center gap-1.5">
              <span>Circadian Engine</span>
              <span aria-hidden="true">·</span>
              <span className="text-volt-adaptive font-semibold">Sleep Architecture</span>
            </div>
            <h3 className="text-xl font-bold tracking-tight text-[var(--text-primary)]">
              Log Nightly Rest & Recovery
            </h3>
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

        {/* Form Body */}
        <form onSubmit={handleSave} className="p-6 space-y-5">
          {/* Date Selector */}
          <div>
            <label className="text-[11px] font-mono tracking-wide text-[var(--text-muted)] block mb-1">
              Sleep Night Date
            </label>
            <input
              type="date"
              value={date}
              onChange={(e) => {
                const newDate = e.target.value;
                setDate(newDate);
                const ex = db.getSleepLogForDate(newDate);
                if (ex) {
                  setSleepHours(ex.hoursSlept);
                  setQuality(ex.quality);
                  setRestingHeartRate(ex.restingHeartRate ? String(ex.restingHeartRate) : '');
                  setHrvMs(ex.hrvMs ? String(ex.hrvMs) : '');
                  setNotes(ex.notes || '');
                }
              }}
              className="w-full text-sm font-mono bg-[var(--chip-bg)] text-[var(--text-primary)] border border-[var(--border-card)] rounded-lg px-3 py-2 focus:outline-none focus:border-accent"
            />
          </div>

          {/* Hours Slept */}
          <div className="reshape-card-subtle p-4 space-y-3">
            <div className="flex items-center justify-between">
              <label className="text-[11px] font-mono tracking-wide text-[var(--text-muted)]">
                Duration (Hours)
              </label>
              <span className="text-2xl font-bold font-mono text-[var(--text-primary)]">
                {hoursSlept} <span className="text-xs text-[var(--text-muted)]">hrs</span>
              </span>
            </div>

            <input
              type="range"
              min="4.0"
              max="11.0"
              step="0.1"
              value={hoursSlept}
              onChange={(e) => setSleepHours(parseFloat(e.target.value))}
              className="w-full accent-accent cursor-pointer"
            />

            {/* Quick preset buttons */}
            <div className="flex items-center gap-2 pt-1">
              {[6.5, 7.0, 7.5, 8.0, 8.5].map((preset) => (
                <button
                  key={preset}
                  type="button"
                  onClick={() => setSleepHours(preset)}
                  className={`flex-1 py-1 text-xs font-mono font-semibold rounded transition-colors ${
                    hoursSlept === preset
                      ? 'bg-accent text-accent-ink font-bold'
                      : 'bg-[var(--chip-bg)] text-[var(--text-secondary)] hover:bg-[var(--chip-hover)]'
                  }`}
                >
                  {preset}h
                </button>
              ))}
            </div>
          </div>

          {/* Quality Slider */}
          <div className="reshape-card-subtle p-4 space-y-3">
            <div className="flex items-center justify-between">
              <label className="text-[11px] font-mono tracking-wide text-[var(--text-muted)]">
                Perceived Rest Quality
              </label>
              <div className="text-right">
                <span className="text-base font-bold font-mono text-[var(--text-primary)] mr-2">
                  {quality}%
                </span>
                <span className={`text-xs font-semibold ${qualInfo.color}`}>
                  {qualInfo.label}
                </span>
              </div>
            </div>

            <input
              type="range"
              min="20"
              max="100"
              step="5"
              value={quality}
              onChange={(e) => setQuality(parseInt(e.target.value, 10))}
              className="w-full accent-accent cursor-pointer"
            />
          </div>

          {/* Biometrics: RHR & HRV */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[11px] font-mono tracking-wide text-[var(--text-muted)] block mb-1">
                Resting Heart Rate (BPM)
              </label>
              <input
                type="number"
                placeholder="e.g. 52"
                value={restingHeartRate}
                onChange={(e) => setRestingHeartRate(e.target.value)}
                className="w-full text-sm font-mono bg-[var(--chip-bg)] text-[var(--text-primary)] border border-[var(--border-card)] rounded-lg px-3 py-2 focus:outline-none focus:border-accent"
              />
            </div>

            <div>
              <label className="text-[11px] font-mono tracking-wide text-[var(--text-muted)] block mb-1">
                HRV (ms rMSSD)
              </label>
              <input
                type="number"
                placeholder="e.g. 68"
                value={hrvMs}
                onChange={(e) => setHrvMs(e.target.value)}
                className="w-full text-sm font-mono bg-[var(--chip-bg)] text-[var(--text-primary)] border border-[var(--border-card)] rounded-lg px-3 py-2 focus:outline-none focus:border-accent"
              />
            </div>
          </div>

          {/* Notes */}
          <div>
            <label className="text-[11px] font-mono tracking-wide text-[var(--text-muted)] block mb-1">
              Sleep Notes & Factors
            </label>
            <input
              type="text"
              placeholder="e.g. Magnesium taken, dark room, uninterrupted"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="w-full text-sm bg-[var(--chip-bg)] text-[var(--text-primary)] border border-[var(--border-card)] rounded-lg px-3 py-2 focus:outline-none focus:border-accent"
            />
          </div>

          {/* Footer Submit */}
          <div className="pt-2 flex items-center justify-end gap-3">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-xs font-semibold text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-6 py-2.5 rounded-lg bg-accent hover:bg-accent-hover text-accent-ink font-bold text-xs tracking-wide transition-colors shadow-sm"
            >
              Save Sleep Entry
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
