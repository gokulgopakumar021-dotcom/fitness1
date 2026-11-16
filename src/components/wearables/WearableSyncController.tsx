import { useEffect, useRef, useState } from 'react';
import { useBluetoothGadget } from '../../context/BluetoothGadgetContext';
import { HrRecorder } from '../../wearables/hrRecorder';
import { sendIngest } from '../../wearables/ingestClient';
import { loadServerConsent, WEARABLE_CONSENT_EVENT } from '../../wearables/consentClient';
import { createScopedOutbox } from '../../wearables/outboxStore';
import { publishSyncStatus, resetSyncStatus } from '../../wearables/syncStore';

const FLUSH_MS = 30_000;

/**
 * Renders nothing. While a REAL device is connected, a workout is active and the server confirms workout_health_sync consent,
 * it records heart-rate readings for that workout and sends them in batches. Unsent readings survive a reload in an account-scoped outbox and are restored only after consent is confirmed. No background sync exists: this runs only while the app is open.
 */
export function WearableSyncController({ activeSessionId }: { activeSessionId: string | null }) {
  const { isConnected, isSimulated, liveHeartRate, device } = useBluetoothGadget();
  const [canSync, setCanSync] = useState(false);
  const rec = useRef<HrRecorder | null>(null);
  if (!rec.current) rec.current = new HrRecorder({ send: sendIngest, onStatus: publishSyncStatus, store: createScopedOutbox() });

  useEffect(() => {
    let alive = true;
    const check = async () => {
      const r = await loadServerConsent();
      if (!alive) return;
      const ok = r.status === 'ok' && r.categories.includes('workout_health_sync');
      setCanSync(ok);
      if (ok) { rec.current!.reset(); rec.current!.restore(); } else rec.current!.discardAll();
    };
    void check();
    window.addEventListener(WEARABLE_CONSENT_EVENT, check);
    return () => { alive = false; window.removeEventListener(WEARABLE_CONSENT_EVENT, check); };
  }, []);

  useEffect(() => {
    if (canSync && isConnected && !isSimulated && device && !device.isSimulated && activeSessionId && liveHeartRate) {
      rec.current!.offer(activeSessionId, liveHeartRate, { key: device.id, name: device.name });
    }
  }, [canSync, isConnected, isSimulated, device, activeSessionId, liveHeartRate]);

  useEffect(() => {
    const id = window.setInterval(() => void rec.current!.flush(), FLUSH_MS);
    const onHide = () => { if (document.visibilityState === 'hidden') void rec.current!.flush(); };
    document.addEventListener('visibilitychange', onHide);
    return () => { window.clearInterval(id); document.removeEventListener('visibilitychange', onHide); void rec.current!.flush().finally(() => resetSyncStatus()); };
  }, []);

  useEffect(() => { if (!isConnected || !activeSessionId) void rec.current!.flush(); }, [isConnected, activeSessionId]);
  return null;
}
