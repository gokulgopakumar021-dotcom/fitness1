import type { SyncState } from './syncStatus';

export type DeviceUiState = 'connected' | 'disconnected' | 'syncing' | 'sync_failed' | 'auth_expired' | 'permission_required' | 'unsupported_browser' | 'not_configured';

export const DEVICE_STATE_LABEL: Record<DeviceUiState, string> = {
  connected: 'Connected', disconnected: 'Disconnected', syncing: 'Syncing', sync_failed: 'Sync failed',
  auth_expired: 'Sign-in expired', permission_required: 'Permission required', unsupported_browser: 'Unsupported browser', not_configured: 'Not configured'
};
export const DEVICE_STATE_TONE: Record<DeviceUiState, 'success' | 'neutral' | 'info' | 'danger' | 'warning'> = {
  connected: 'success', disconnected: 'neutral', syncing: 'info', sync_failed: 'danger', auth_expired: 'warning',
  permission_required: 'warning', unsupported_browser: 'neutral', not_configured: 'neutral'
};

export interface DeviceStateInput {
  /** True for the device currently connected over Bluetooth in this tab. */
  live: boolean;
  directBluetooth: boolean;
  sync: SyncState;
  workoutSyncConsent: boolean;
}

/** A remembered device that is not connected right now is "disconnected" (or the browser cannot reconnect it at all). */
export function deriveDeviceState(i: DeviceStateInput): DeviceUiState {
  if (!i.live) return i.directBluetooth ? 'disconnected' : 'unsupported_browser';
  if (i.sync === 'auth_expired') return 'auth_expired';
  if (!i.workoutSyncConsent || i.sync === 'permission_revoked') return 'permission_required';
  if (i.sync === 'syncing') return 'syncing';
  if (i.sync === 'failed' || i.sync === 'provider_unavailable') return 'sync_failed';
  return 'connected';
}
