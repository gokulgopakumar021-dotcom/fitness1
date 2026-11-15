/** Detects what direct Bluetooth can honestly do in this browser. Environment is injected so it is testable. */

export interface CapabilityEnv {
  userAgent: string;
  platform?: string;
  maxTouchPoints?: number;
  hasWebBluetooth: boolean;
  isSecureContext: boolean;
  isStandalonePwa?: boolean;
}

export type DevicePlatform = 'ios' | 'android' | 'desktop' | 'other';
export type DirectBluetoothReason =
  | 'available'
  | 'insecure_context'
  | 'ios_no_web_bluetooth'
  | 'browser_unsupported'
  | 'no_environment';

export interface WearableCapabilities {
  platform: DevicePlatform;
  directBluetooth: boolean;
  reason: DirectBluetoothReason;
  /** User-facing explanation. Never promises background sync or support for a specific watch. */
  message: string;
  backgroundSync: false;
}

export function detectPlatform(env: Pick<CapabilityEnv, 'userAgent' | 'platform' | 'maxTouchPoints'>): DevicePlatform {
  const ua = env.userAgent || '';
  if (/iPhone|iPad|iPod/i.test(ua)) return 'ios';
  // iPadOS 13+ reports as a Mac but is touch-capable.
  if ((env.platform === 'MacIntel' || /Macintosh/.test(ua)) && (env.maxTouchPoints ?? 0) > 1) return 'ios';
  if (/Android/i.test(ua)) return 'android';
  if (/Windows|Macintosh|Linux|CrOS/i.test(ua)) return 'desktop';
  return 'other';
}

export function detectWearableCapabilities(env: CapabilityEnv | null): WearableCapabilities {
  if (!env) {
    return { platform: 'other', directBluetooth: false, reason: 'no_environment', backgroundSync: false,
      message: 'Browser details are unavailable, so direct Bluetooth cannot be offered.' };
  }
  const platform = detectPlatform(env);
  if (!env.isSecureContext) {
    return { platform, directBluetooth: false, reason: 'insecure_context', backgroundSync: false,
      message: 'Bluetooth needs a secure (HTTPS) connection.' };
  }
  // Presence of the API is the only trustworthy signal: a few third-party iOS browsers do ship Web Bluetooth.
  if (env.hasWebBluetooth) {
    return { platform, directBluetooth: true, reason: 'available', backgroundSync: false,
      message: 'Direct Bluetooth is available in this browser. It works only for devices that expose the standard Heart Rate service, and only while this page is open.' };
  }
  if (platform === 'ios') {
    return { platform, directBluetooth: false, reason: 'ios_no_web_bluetooth', backgroundSync: false,
      message: 'Safari and Chrome on iPhone do not support Web Bluetooth, and installing Iron Log to the Home Screen does not change that. Direct Bluetooth is unavailable here. A few third-party iOS browsers add Web Bluetooth, but Iron Log has not tested any of them.' };
  }
  return { platform, directBluetooth: false, reason: 'browser_unsupported', backgroundSync: false,
    message: 'This browser does not support Web Bluetooth. Chrome or Edge on Android or desktop can.' };
}

export function readCapabilityEnv(): CapabilityEnv | null {
  if (typeof navigator === 'undefined' || typeof window === 'undefined') return null;
  return {
    userAgent: navigator.userAgent,
    platform: navigator.platform,
    maxTouchPoints: navigator.maxTouchPoints,
    hasWebBluetooth: typeof (navigator as unknown as { bluetooth?: unknown }).bluetooth !== 'undefined',
    isSecureContext: window.isSecureContext,
    isStandalonePwa: window.matchMedia?.('(display-mode: standalone)')?.matches ?? false,
  };
}
