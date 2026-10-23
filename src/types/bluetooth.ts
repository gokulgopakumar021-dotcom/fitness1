// TypeScript definitions for Web Bluetooth API and Fitness Gadgets

export interface BluetoothDeviceInfo {
  id: string;
  name: string;
  deviceType: 'heart_rate_monitor' | 'smart_band' | 'cycling_sensor' | 'smart_scale' | 'generic';
  connected: boolean;
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
  zone: 1 | 2 | 3 | 4 | 5;
  zoneName: string;
}

export interface BluetoothGadgetState {
  isSupported: boolean;
  isConnecting: boolean;
  isConnected: boolean;
  device: BluetoothDeviceInfo | null;
  liveHeartRate: number | null;
  heartRateHistory: { time: number; bpm: number }[];
  currentZone: {
    zone: 1 | 2 | 3 | 4 | 5;
    name: string;
    description: string;
    color: string;
  };
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

export function calculateHeartRateZone(bpm: number, age: number = 25): (typeof HEART_RATE_ZONES)[0] {
  const maxHR = 220 - age;
  const pct = (bpm / maxHR) * 100;
  if (pct < 60) return HEART_RATE_ZONES[0];
  if (pct < 70) return HEART_RATE_ZONES[1];
  if (pct < 80) return HEART_RATE_ZONES[2];
  if (pct < 90) return HEART_RATE_ZONES[3];
  return HEART_RATE_ZONES[4];
}
