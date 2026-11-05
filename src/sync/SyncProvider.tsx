import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { getSupabase } from '../lib/supabase';
import { deviceStorage } from './deviceStorage';
import { createSupabaseRemote } from './remoteAdapter';
import { createSyncController, type SyncController, type SyncState } from './syncController';
import { createSyncEngine } from './syncEngine';
import { getDeviceId } from './syncMeta';
import { onLocalWorkoutChange } from './syncNotify';
import { setActiveSync } from './syncRuntime';

export interface SyncContextValue {
  /** false when cloud sync is not available (signed out, or Supabase not configured): the app works locally only. */
  enabled: boolean;
  state: SyncState | null;
  retry: () => void;
}

const DISABLED: SyncContextValue = { enabled: false, state: null, retry: () => {} };
const SyncContext = createContext<SyncContextValue>(DISABLED);

export const useSync = (): SyncContextValue => useContext(SyncContext);

/**
 * Starts cloud sync for the signed-in account. Mounted only inside AuthGate, i.e. after storage is scoped to the
 * user; AuthGate remounts the whole tree when the account changes, so a controller never outlives its account.
 * Everything here uses the signed-in user's own Supabase client (their JWT); row-level security does the isolation.
 */
export const SyncProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { status, user } = useAuth();
  const userId = status === 'authenticated' && user ? user.id : null;
  const [controller, setController] = useState<SyncController | null>(null);
  const [state, setState] = useState<SyncState | null>(null);

  useEffect(() => {
    const client = userId ? getSupabase() : null;
    if (!userId || !client) {
      setController(null);
      setState(null);
      return;
    }
    const engine = createSyncEngine({
      userId,
      storage: deviceStorage,
      remote: createSupabaseRemote(client),
      deviceId: getDeviceId(deviceStorage)
    });
    const c = createSyncController({ engine });
    setController(c);
    setState(c.getState());
    setActiveSync(c);
    const unsubscribe = c.subscribe(setState);
    const unlisten = onLocalWorkoutChange(() => c.requestSync());
    c.start();
    return () => {
      unlisten();
      unsubscribe();
      c.stop();
      setActiveSync(null);
      setController(null);
      setState(null);
    };
  }, [userId]);

  const value = useMemo<SyncContextValue>(
    () => (controller ? { enabled: true, state, retry: () => { void controller.retryNow(); } } : DISABLED),
    [controller, state]
  );
  return <SyncContext.Provider value={value}>{children}</SyncContext.Provider>;
};
