import React from 'react';
import { AlertTriangle, Check, CloudOff, Loader2, RefreshCw } from 'lucide-react';
import { Badge, Button } from '../ui';
import { useSync } from '../../sync/SyncProvider';
import { describeSync, formatLastSync, type SyncView } from './syncPresentation';

const ICONS: Record<SyncView, React.ReactNode> = {
  synced: <Check className="w-3 h-3" aria-hidden />,
  syncing: <Loader2 className="w-3 h-3 animate-spin" aria-hidden />,
  pending: <RefreshCw className="w-3 h-3" aria-hidden />,
  checking: <Loader2 className="w-3 h-3 animate-spin" aria-hidden />,
  offline: <CloudOff className="w-3 h-3" aria-hidden />,
  error: <AlertTriangle className="w-3 h-3" aria-hidden />
};

/**
 * Compact sync indicator for the app header. Renders nothing when cloud sync is off (signed out / not configured),
 * i.e. the app is local-only. Reads sync state from useSync(); it never talks to Supabase.
 */
export const SyncStatusBadge: React.FC = () => {
  const { enabled, state, retry } = useSync();
  if (!enabled || !state) return null;
  const p = describeSync(state);
  const last = formatLastSync(state.lastSyncAt);
  const title = last && p.view !== 'syncing' ? `${p.detail} Last synced ${last}.` : p.detail;
  return (
    <div className="flex items-center gap-1 shrink-0">
      <span role="status" aria-live="polite" aria-atomic="true" data-sync-view={p.view}>
        <Badge tone={p.tone} icon={ICONS[p.view]} title={title} aria-label={title} className="h-7">
          <span className="hidden sm:inline">{p.label}</span>
          <span className="sr-only sm:hidden">{p.label}</span>
        </Badge>
      </span>
      {p.view === 'error' && (
        <Button type="button" variant="ghost" size="sm" iconOnly aria-label="Retry sync" title="Retry sync" onClick={retry} icon={<RefreshCw className="w-4 h-4" aria-hidden />} />
      )}
    </div>
  );
};
