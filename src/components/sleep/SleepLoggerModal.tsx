import React, { useId, useState } from 'react';
import { DailySleepLog } from '../../types';
import { db } from '../../storage/db';
import { Button, Input, Modal } from '../ui';

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
  const formId = useId();
  const hoursId = useId();
  const qualityId = useId();
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

  // Hooks above run unconditionally; Modal renders nothing while closed.

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
    if (val >= 75) return { label: 'Optimal Sleep', color: 'text-success' };
    if (val >= 60) return { label: 'Adequate Recovery', color: 'text-warning' };
    return { label: 'Deficit / Fragmented', color: 'text-danger' };
  };

  const qualInfo = getQualityLabel(quality);

  return (
    <Modal
      open={isOpen}
      onClose={onClose}
      title="Log Nightly Rest & Recovery"
      description="Circadian Engine · Sleep Architecture"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form={formId}>
            Save Sleep Entry
          </Button>
        </>
      }
    >
      <form id={formId} onSubmit={handleSave} className="space-y-4">
        <Input
          label="Sleep Night Date"
          type="date"
          mono
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
        />

        <div className="rounded-control border border-line bg-surface-2 p-4 space-y-3">
          <div className="flex items-center justify-between gap-3">
            <label htmlFor={hoursId} className="text-xs font-medium text-zinc-300">
              Duration (Hours)
            </label>
            <span className="text-2xl font-bold font-mono tabular text-white">
              {hoursSlept} <span className="text-xs text-zinc-500">hrs</span>
            </span>
          </div>
          <input
            id={hoursId}
            type="range"
            min="4.0"
            max="11.0"
            step="0.1"
            value={hoursSlept}
            onChange={(e) => setSleepHours(parseFloat(e.target.value))}
            className="w-full accent-accent cursor-pointer"
          />
          <div className="flex items-center gap-2 pt-1">
            {[6.5, 7.0, 7.5, 8.0, 8.5].map((preset) => (
              <button
                key={preset}
                type="button"
                onClick={() => setSleepHours(preset)}
                aria-pressed={hoursSlept === preset}
                className={`flex-1 h-11 text-xs font-mono font-semibold rounded-control transition-colors ${
                  hoursSlept === preset
                    ? 'bg-accent text-accent-ink font-bold'
                    : 'bg-surface-3 text-zinc-300 hover:text-white'
                }`}
              >
                {preset}h
              </button>
            ))}
          </div>
        </div>

        <div className="rounded-control border border-line bg-surface-2 p-4 space-y-3">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <label htmlFor={qualityId} className="text-xs font-medium text-zinc-300">
              Perceived Rest Quality
            </label>
            <div className="text-right">
              <span className="text-base font-bold font-mono tabular text-white mr-2">{quality}%</span>
              <span className={`text-xs font-semibold ${qualInfo.color}`}>{qualInfo.label}</span>
            </div>
          </div>
          <input
            id={qualityId}
            type="range"
            min="20"
            max="100"
            step="5"
            value={quality}
            onChange={(e) => setQuality(parseInt(e.target.value, 10))}
            className="w-full accent-accent cursor-pointer"
          />
        </div>

        <div className="grid grid-cols-1 min-[420px]:grid-cols-2 gap-3">
          <Input
            label="Resting Heart Rate (BPM)"
            type="number"
            inputMode="numeric"
            mono
            placeholder="e.g. 52"
            value={restingHeartRate}
            onChange={(e) => setRestingHeartRate(e.target.value)}
          />
          <Input
            label="HRV (ms rMSSD)"
            type="number"
            inputMode="numeric"
            mono
            placeholder="e.g. 68"
            value={hrvMs}
            onChange={(e) => setHrvMs(e.target.value)}
          />
        </div>

        <Input
          label="Sleep Notes & Factors"
          type="text"
          placeholder="e.g. Magnesium taken, dark room, uninterrupted"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />
      </form>
    </Modal>
  );
};
