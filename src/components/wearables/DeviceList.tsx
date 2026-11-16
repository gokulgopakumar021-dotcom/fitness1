import React, { useState } from 'react';
import { Bluetooth, ChevronDown, Trash2, Unplug, Watch } from 'lucide-react';
import { Badge, Button, Card, EmptyState } from '../ui';
import { DEVICE_STATE_LABEL, DEVICE_STATE_TONE, type DeviceUiState } from '../../wearables/deviceState';
import { SYNC_MESSAGES, type SyncState } from '../../wearables/syncStatus';

export interface DeviceRow {
  key: string;
  name: string;
  manufacturer: string;
  model: string | null;
  method: string;
  state: DeviceUiState;
  simulated: boolean;
  live: boolean;
  lastSync: string | null;
  lastError: string | null;
  syncState: SyncState | null;
  savedId: string | null;
  workoutSyncOn: boolean;
}

const fmt = (iso: string | null) => (iso ? new Date(iso).toLocaleString() : 'Never');
const METHOD_LABEL: Record<string, string> = { direct_ble: 'Direct Bluetooth (this browser)', manual_import: 'Manual import' };

interface Props { rows: DeviceRow[]; onDisconnect: () => void; onRemove: (row: DeviceRow) => void; onAdd?: () => void }

export const DeviceList: React.FC<Props> = ({ rows, onDisconnect, onRemove }) => {
  const [open, setOpen] = useState<string | null>(null);
  if (rows.length === 0) {
    return (
      <Card>
        <EmptyState
          icon={<Watch className="w-6 h-6" aria-hidden />}
          title="No wearable connected"
          description="Connect a heart-rate device to see your live heart rate while you train and, if you choose, keep a record of it with each workout. Compatibility depends on your browser and on the device; no brand is guaranteed to work."
        />
      </Card>
    );
  }
  return (
    <ul className="space-y-3" aria-label="Devices">
      {rows.map((r) => (
        <li key={r.key}>
          <Card>
            <div className="flex items-start gap-3">
              <Bluetooth className="w-5 h-5 text-info mt-0.5 shrink-0" aria-hidden />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-white flex items-center gap-2 flex-wrap">
                  <span className="truncate">{r.name}</span>
                  <Badge tone={DEVICE_STATE_TONE[r.state]}>{DEVICE_STATE_LABEL[r.state]}</Badge>
                  <Badge tone={r.simulated ? 'warning' : 'neutral'}>{r.simulated ? 'Simulated demo' : 'Real hardware'}</Badge>
                </p>
                <p className="text-xs text-zinc-400 mt-0.5">{r.manufacturer}{r.model ? ` · ${r.model}` : ''} · {METHOD_LABEL[r.method] ?? r.method}</p>
                <p className="text-xs text-zinc-400">Last synchronized: {r.simulated ? 'Never (demo data is not saved)' : fmt(r.lastSync)}</p>
                {r.lastError && <p role="alert" className="text-xs text-danger mt-1">{r.lastError}</p>}
                {r.syncState && r.syncState !== 'never' && r.live && <p className="text-xs text-zinc-300 mt-1">{SYNC_MESSAGES[r.syncState]}</p>}
              </div>
              <button type="button" className="p-2 -m-2 text-zinc-400 hover:text-white" aria-expanded={open === r.key} aria-label={`Details for ${r.name}`} onClick={() => setOpen(open === r.key ? null : r.key)}>
                <ChevronDown className={`w-4 h-4 transition-transform ${open === r.key ? 'rotate-180' : ''}`} aria-hidden />
              </button>
            </div>

            {open === r.key && (
              <dl className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2 text-xs border-t border-line pt-3">
                <div><dt className="text-zinc-500">Supported metrics</dt><dd className="text-zinc-200">Heart rate (standard Heart Rate service){r.live ? '; battery if reported' : ''}</dd></div>
                <div><dt className="text-zinc-500">Source type</dt><dd className="text-zinc-200">{r.simulated ? 'Built-in demo simulator' : 'Physical device over Bluetooth'}</dd></div>
                <div><dt className="text-zinc-500">Data quality</dt><dd className="text-zinc-200">{r.simulated ? 'Not real data' : 'Unverified: Iron Log has not tested this device against a reference'}</dd></div>
                <div><dt className="text-zinc-500">Permission to save readings</dt><dd className="text-zinc-200">{r.simulated ? 'Never saved' : r.workoutSyncOn ? 'Allowed (workout heart-rate sync is on)' : 'Not allowed: turn on workout heart-rate sync in Privacy & consent'}</dd></div>
                <div><dt className="text-zinc-500">Compatibility</dt><dd className="text-zinc-200">Not verified. No device has a hardware test record.</dd></div>
              </dl>
            )}

            <div className="mt-3 flex flex-wrap gap-2 items-center">
              {r.live && <Button size="sm" variant="secondary" onClick={onDisconnect} icon={<Unplug className="w-4 h-4" aria-hidden />}>Disconnect</Button>}
              {r.savedId && <Button size="sm" variant="danger" onClick={() => onRemove(r)} icon={<Trash2 className="w-4 h-4" aria-hidden />}>Remove device and saved readings</Button>}
              <p className="text-xs text-zinc-500 basis-full">{r.live ? 'Disconnecting stops live readings. It does not delete anything already saved.' : ''}{r.savedId ? ' Removing deletes this device and all readings saved from it.' : ''}</p>
            </div>
          </Card>
        </li>
      ))}
    </ul>
  );
};
