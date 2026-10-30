import React, { useState } from 'react';
import { Button, Card, Modal, SectionHeading } from '../ui';
import { db } from '../../storage/db';
import { eraseAllBodyScanData } from '../../storage/bodyScanStore';
import { clearBodyScanConsent } from '../../storage/bodyScanConsent';

interface Category {
  id: 'workouts' | 'nutrition' | 'metrics' | 'sleep' | 'bodyscan';
  label: string;
  detail: string;
  count: () => string;
  erase: () => Promise<void> | void;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

const CATEGORIES: Category[] = [
  {
    id: 'workouts',
    label: 'Workout history',
    detail: 'All logged sessions. Your plans are kept.',
    count: () => plural(db.getSessions().length, 'session'),
    erase: () => {
      db.saveSessions([]);
    }
  },
  {
    id: 'nutrition',
    label: 'Nutrition logs',
    detail: 'Daily food and water logs. Custom foods are kept.',
    count: () => plural(db.getNutritionLogs().length, 'day'),
    erase: () => {
      if (!db.saveNutritionLogs([])) throw new Error('Nutrition logs could not be deleted.');
    }
  },
  {
    id: 'metrics',
    label: 'Body measurements',
    detail: 'Weight, waist and body-fat entries.',
    count: () => plural(db.getBodyMetrics().length, 'entry', 'entries'),
    erase: () => {
      if (!db.saveBodyMetrics([])) throw new Error('Body measurements could not be deleted.');
    }
  },
  {
    id: 'sleep',
    label: 'Sleep logs',
    detail: 'All logged nights.',
    count: () => plural(db.getSleepLogs().length, 'night'),
    erase: () => {
      db.saveSleepLogs([]);
    }
  },
  {
    id: 'bodyscan',
    label: 'Body Scan data',
    detail: 'Scans, measurements and photos, and your Body Scan consent.',
    count: () => 'Stored in this browser',
    erase: async () => {
      await eraseAllBodyScanData();
      clearBodyScanConsent();
    }
  }
];

/** Delete one category of on-device data without resetting everything. Every deletion is confirmed. */
export const DataControls: React.FC = () => {
  const [pending, setPending] = useState<Category | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  // bump to re-read counts after a deletion
  const [, setVersion] = useState(0);

  const close = () => {
    if (busy) return;
    setPending(null);
    setError(null);
  };

  const confirm = async () => {
    if (!pending) return;
    setBusy(true);
    setError(null);
    try {
      await pending.erase();
      setDone(`${pending.label} deleted.`);
      setPending(null);
      setVersion((v) => v + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not delete that data. Nothing was changed.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card as="section" aria-labelledby="data-controls-heading" className="space-y-3">
      <SectionHeading
        level={3}
        title="Delete specific data"
        description="Remove one kind of data stored on this device. To remove everything, use Reset All Data below."
      />
      <span id="data-controls-heading" className="sr-only">
        Delete specific data
      </span>
      <ul className="divide-y divide-line">
        {CATEGORIES.map((c) => (
          <li key={c.id} className="flex items-center justify-between gap-3 py-3 first:pt-0 last:pb-0">
            <div className="min-w-0">
              <div className="text-sm font-medium text-zinc-100">{c.label}</div>
              <div className="text-label text-zinc-500">
                {c.count()} · {c.detail}
              </div>
            </div>
            <Button type="button" variant="danger" size="sm" className="shrink-0" onClick={() => { setDone(null); setPending(c); }}>
              Delete…
            </Button>
          </li>
        ))}
      </ul>
      {done && (
        <p role="status" className="text-xs text-accent">
          {done}
        </p>
      )}

      <Modal
        open={pending !== null}
        onClose={close}
        title={pending ? `Delete ${pending.label.toLowerCase()}?` : 'Delete data?'}
        description="This cannot be undone. Export a backup first if you might want this data again."
        size="sm"
        footer={
          <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2">
            <Button type="button" variant="ghost" onClick={close} disabled={busy}>
              Cancel
            </Button>
            <Button type="button" variant="danger" onClick={confirm} loading={busy}>
              Delete permanently
            </Button>
          </div>
        }
      >
        <div className="space-y-2">
          <p className="text-sm text-zinc-300">{pending?.detail}</p>
          {error && (
            <p role="alert" className="text-xs text-danger">
              {error}
            </p>
          )}
        </div>
      </Modal>
    </Card>
  );
};
