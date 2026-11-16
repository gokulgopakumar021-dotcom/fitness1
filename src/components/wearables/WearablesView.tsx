import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { Badge, Button, Card, Modal, PageHeader } from '../ui';
import { useBluetoothGadget } from '../../context/BluetoothGadgetContext';
import { detectWearableCapabilities, readCapabilityEnv } from '../../wearables/capabilities';
import { deriveDeviceState } from '../../wearables/deviceState';
import { listSavedDevices, removeSavedDevice, type SavedDevice } from '../../wearables/savedDevices';
import { SYNC_MESSAGES } from '../../wearables/syncStatus';
import { useSyncStatus } from '../../wearables/syncStore';
import { useWearableConsent } from '../../wearables/useWearableConsent';
import { AddDevicePanel } from './AddDevicePanel';
import { ConsentPanel } from './ConsentPanel';
import { ConsentHistoryPanel } from './ConsentHistoryPanel';
import { DeviceList, type DeviceRow } from './DeviceList';

export const WearablesView: React.FC = () => {
  const bt = useBluetoothGadget();
  const consent = useWearableConsent();
  const sync = useSyncStatus();
  const capabilities = useMemo(() => detectWearableCapabilities(readCapabilityEnv()), []);
  const [saved, setSaved] = useState<SavedDevice[] | null>(null);
  const [savedFailed, setSavedFailed] = useState(false);
  const [removing, setRemoving] = useState<DeviceRow | null>(null);
  const [removeBusy, setRemoveBusy] = useState(false);
  const [removeError, setRemoveError] = useState<string | null>(null);

  const loadSaved = useCallback(async () => {
    const r = await listSavedDevices();
    if (r.ok) { setSaved(r.devices); setSavedFailed(false); } else { setSavedFailed(true); }
  }, []);
  useEffect(() => { void loadSaved(); }, [loadSaved]);

  const workoutSyncOn = consent.categories.has('workout_health_sync');

  const rows: DeviceRow[] = useMemo(() => {
    const out: DeviceRow[] = [];
    const liveKey = bt.isConnected && bt.device ? bt.device.id : null;
    if (bt.isConnected && bt.device) {
      const match = saved?.find((s) => s.deviceKey === bt.device!.id) ?? null;
      out.push({
        key: `live:${bt.device.id}`, name: bt.device.name, manufacturer: match?.manufacturer ?? 'Unknown', model: match?.model ?? null, method: 'direct_ble',
        state: bt.isSimulated ? 'connected' : deriveDeviceState({ live: true, directBluetooth: capabilities.directBluetooth, sync: sync.state, workoutSyncConsent: workoutSyncOn }),
        simulated: bt.isSimulated, live: true, lastSync: bt.isSimulated ? null : (sync.lastSuccessAt ?? match?.lastSeenAt ?? null), lastError: bt.error,
        syncState: bt.isSimulated ? null : sync.state, savedId: match?.id ?? null, workoutSyncOn
      });
    }
    for (const s of saved ?? []) {
      if (s.deviceKey === liveKey) continue;
      out.push({
        key: `saved:${s.id}`, name: s.displayName ?? 'Heart-rate device', manufacturer: s.manufacturer, model: s.model, method: s.method,
        state: deriveDeviceState({ live: false, directBluetooth: capabilities.directBluetooth, sync: 'never', workoutSyncConsent: workoutSyncOn }),
        simulated: false, live: false, lastSync: s.lastSeenAt, lastError: null, syncState: null, savedId: s.id, workoutSyncOn
      });
    }
    return out;
  }, [bt.isConnected, bt.isSimulated, bt.device, bt.error, saved, capabilities.directBluetooth, sync.state, sync.lastSuccessAt, workoutSyncOn]);

  const confirmRemove = async () => {
    if (!removing?.savedId) return;
    setRemoveBusy(true); setRemoveError(null);
    if (removing.live) bt.disconnect();
    const ok = await removeSavedDevice(removing.savedId);
    setRemoveBusy(false);
    if (ok) { setRemoving(null); void loadSaved(); } else setRemoveError('Could not remove the device. Nothing was deleted; try again.');
  };

  return (
    <div className="space-y-5 pb-24">
      <PageHeader
        eyebrow="Wearables" title="Your devices"
        description="Connect a heart-rate device, choose what Iron Log may save, and decide what Coach Iron may see."
        actions={<Button size="sm" variant="secondary" onClick={() => void loadSaved()} icon={<RefreshCw className="w-4 h-4" aria-hidden />}>Refresh</Button>}
      />

      <Card tone="default" role="status" aria-live="polite">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-semibold text-white">Synchronization</span>
          <Badge tone={sync.state === 'synced' ? 'success' : sync.state === 'syncing' ? 'info' : sync.state === 'never' ? 'neutral' : sync.state === 'partial' ? 'warning' : 'danger'}>{sync.state.replace('_', ' ')}</Badge>
        </div>
        <p className="text-sm text-zinc-300 mt-1">{SYNC_MESSAGES[sync.state]}</p>
        <p className="text-xs text-zinc-500 mt-1">
          {sync.lastSuccessAt ? `Last confirmed by the server: ${new Date(sync.lastSuccessAt).toLocaleString()}. ` : ''}
          {sync.pending ? `${sync.pending} reading(s) waiting to send. ` : ''}
          Syncing only happens while Iron Log is open during a workout; there is no background sync in the browser.
        </p>
      </Card>

      {savedFailed && <p role="alert" className="text-sm text-warning">Saved devices could not be loaded right now.</p>}
      <DeviceList rows={rows} onDisconnect={bt.disconnect} onRemove={(r) => { setRemoveError(null); setRemoving(r); }} />
      <AddDevicePanel capabilities={capabilities} connecting={bt.isConnecting} connected={bt.isConnected && !bt.isSimulated} onConnect={() => void bt.connectRealDevice()} />
      <ConsentPanel consent={consent} />
      <ConsentHistoryPanel />

      <Modal
        open={removing !== null} onClose={() => setRemoving(null)} title="Remove device and saved readings?" size="sm"
        footer={<div className="flex gap-2 justify-end"><Button variant="secondary" onClick={() => setRemoving(null)}>Cancel</Button><Button variant="danger" loading={removeBusy} onClick={() => void confirmRemove()}>Delete device and readings</Button></div>}
      >
        <p className="text-sm text-zinc-300">This permanently deletes “{removing?.name}” and every heart-rate reading saved from it in your account. It cannot be undone. To stop live readings without deleting anything, use Disconnect instead.</p>
        {removeError && <p role="alert" className="text-sm text-danger mt-2">{removeError}</p>}
      </Modal>
    </div>
  );
};
