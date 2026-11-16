import { zoneNumberForBpm } from '../wearables/heartRateZones';

// TypeScript definitions for Web Bluetooth API and Fitness Gadgets

export interface BluetoothDeviceInfo {
  id: string;
  name: string;
  deviceType: 'heart_rate_monitor' | 'smart_band' | 'cycling_sensor' | 'smart_scale' | 'generic';
  connected: boolean;
  /** True only for the built-in demo simulator. Simulated data must never be stored or sent to an AI provider. */
  isSimulated?: boolean;
  /** Present only when read from the device; undefined means unknown (never a guess). */
  batteryLevel?: number;
  lastHeartRate?: number;
  rssi?: number;
}

export interface HeartRateData {
  bpm: number;
  contactDetected?: boolean;
  energyExpendedJoules?: number;
  rrIntervalsMs?: number[];
  timestamp: number;
  /** Absent when no maximum heart rate is known (no age and no user value). Never a guessed zone. */
  zone?: 1 | 2 | 3 | 4 | 5;
  zoneName?: string;
}

export interface BluetoothGadgetState {
  isSupported: boolean;
  isConnecting: boolean;
  isConnected: boolean;
  device: BluetoothDeviceInfo | null;
  liveHeartRate: number | null;
  heartRateHistory: { time: number; bpm: number }[];
  /** null when bpm or maximum heart rate is unknown: show no zone rather than a guess. */
  currentZone: {
    zone: 1 | 2 | 3 | 4 | 5;
    name: string;
    description: string;
    color: string;
  } | null;
  /** Maximum heart rate used for zones, or null when unknown. */
  maxHeartRate: { bpm: number; source: 'user' | 'age_estimate' } | null;
  batteryLevel: number | null;
  isSimulated: boolean;
  activeCaloriesBurned: number;
  error: string | null;
}

export const HEART_RATE_ZONES = [
  { zone: 1 as const, minPct: 50, maxPct: 60, name: 'Zone 1: Active Recovery', description: 'Light movement, cellular recovery & warm-up', color: 'text-sky-400 bg-sky-500/10 border-sky-500/30' },
  { zone: 2 as const, minPct: 60, maxPct: 70, name: 'Zone 2: Aerobic Base', description: 'Fat oxidation & mitochondrial endurance', color: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/30' },
  { zone: 3 as const, minPct: 70, maxPct: 80, name: 'Zone 3: Hypertrophy & Tempo', description: 'Optimal gym lifting work capacity', color: 'text-lime-400 bg-lime-500/10 border-lime-500/30' },
  { zone: 4 as const, minPct: 80, maxPct: 90, name: 'Zone 4: Anaerobic Threshold', description: 'High intensity lifting sets & intervals', color: 'text-amber-400 bg-amber-500/10 border-amber-500/30' },
  { zone: 5 as const, minPct: 90, maxPct: 100, name: 'Zone 5: Maximum Peak', description: 'Max sprint & heavy 1RM exertion', color: 'text-rose-400 bg-rose-500/10 border-rose-500/30' },
];

/** Zone for a bpm against a KNOWN maximum heart rate. Returns null when either is unusable (no default age). */
export function calculateHeartRateZone(bpm: number, maxHr: number | null): (typeof HEART_RATE_ZONES)[0] | null {
  const n = zoneNumberForBpm(bpm, maxHr);
  return n === null ? null : HEART_RATE_ZONES[n - 1];
}
