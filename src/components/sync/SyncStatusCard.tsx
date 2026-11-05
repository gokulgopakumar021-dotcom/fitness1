import React, { useMemo, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { Badge, Button } from '../ui';
import { useAuth } from '../../context/AuthContext';
import { useSync } from '../../sync/SyncProvider';
import { deviceStorage } from '../../sync/deviceStorage';
import { loadConflicts } from '../../sync/syncMeta';
import type { ConflictArchiveEntry } from '../../sync/types';
import { SettingRow, SettingRows, SettingsCard } from '../settings/SettingsParts';
import { describeSync, formatLastSync } from './syncPresentation';

const KIND_LABEL: Record<string, string> = { plans: 'Workout plan', sessions: 'Logged workout' };
const SHOWN = 20;

const entryTitle = (e: ConflictArchiveEntry): string => {
  const d = e.data;
  const name = d && (typeof d.name === 'string' ? d.name : typeof d.dayName === 'string' ? d.dayName : null);
  return name || e.id;
};

/** Settings > Privacy & data: sync status, last confirmed sync, manual retry and the kept-versions (conflict) list. */
export const SyncStatusCard: React.FC = () => {
  const { enabled, state, retry } = useSync();
  const { user } = useAuth();
  const [showConflicts, setShowConflicts] = useState(false);
  const userId = user?.id ?? null;
  // Re-read the local archive whenever a sync cycle changes state (a conflict resolution bumps dataVersion).
  const version = state?.dataVersion ?? 0;
  const conflicts = useMemo(
    () => (enabled && userId ? loadConflicts(deviceStorage, userId) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [enabled, userId, version, state?.lastSyncAt]
  );

  if (!enabled || !state) {
    return (
      <SettingsCard title="Cloud sync" description="Sync your workouts across devices.">
        <div className="flex items-center gap-2">
          <Badge tone="neutral">Local only</Badge>
          <p className="text-label text-zinc-500">Your workouts are saved on this device only. Sign in to sync them across devices.</p>
        </div>
      </SettingsCard>
    );
  }

  const p = describeSync(state);
  const last = formatLastSync(state.lastSyncAt);
  const shown = [...conflicts].reverse().slice(0, SHOWN);

  return (
    <SettingsCard title="Cloud sync" description="Your workouts and plans sync to your account so every device shows the same data.">
      <SettingRows>
        <SettingRow label="Status" description={p.detail}>
          <div className="flex items-center gap-2" role="status" aria-live="polite" aria-atomic="true" data-sync-view={p.view}>
            <Badge tone={p.tone}>{p.label}</Badge>
            {p.canRetry && (
              <Button type="button" variant="secondary" size="sm" icon={<RefreshCw className="w-4 h-4" aria-hidden />} onClick={retry}>
                Retry now
              </Button>
            )}
          </div>
        </SettingRow>
        <SettingRow label="Last successful sync" description="Shown only after your account confirmed the save.">
          <span className="text-sm text-zinc-200 tabular">{last ?? 'Not yet'}</span>
        </SettingRow>
        {conflicts.length > 0 && (
          <SettingRow
            label="Kept versions"
            description="When two devices edited the same item, the newer edit won. The other version is kept here so nothing is lost."
          >
            <Button type="button" variant="secondary" size="sm" aria-expanded={showConflicts} onClick={() => setShowConflicts((v) => !v)}>
              {showConflicts ? 'Hide' : `View ${conflicts.length}`}
            </Button>
          </SettingRow>
        )}
      </SettingRows>
      {state.lastError && p.view === 'error' && (
        <p role="alert" className="text-xs text-danger">{state.lastError}</p>
      )}
      {showConflicts && conflicts.length > 0 && (
        <ul className="space-y-2" aria-label="Kept versions from sync conflicts">
          {shown.map((e, i) => (
            <li key={`${e.kind}-${e.id}-${e.at}-${i}`} className="rounded-control border border-line bg-surface-2 p-3 space-y-1">
              <div className="flex items-start justify-between gap-2">
                <span className="text-sm font-medium text-zinc-100 min-w-0 break-words">{entryTitle(e)}</span>
                <Badge tone="neutral">{KIND_LABEL[e.kind] ?? e.kind}</Badge>
              </div>
              <p className="text-label text-zinc-400 break-words">{e.reason}</p>
              <p className="text-label text-zinc-500 tabular">{new Date(e.at).toLocaleString()}</p>
            </li>
          ))}
          {conflicts.length > SHOWN && <li className="text-label text-zinc-500">Showing the newest {SHOWN} of {conflicts.length}.</li>}
        </ul>
      )}
    </SettingsCard>
  );
};
