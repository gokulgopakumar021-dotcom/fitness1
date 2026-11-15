import { hasWearableAiConsent } from './consent';

export interface TrainerBluetoothContext { isConnected: boolean; deviceName?: string; bpm?: number }

/**
 * What the AI personal-trainer request may say about a wearable. Without consent, or for simulated/absent readings,
 * the AI is told nothing (not even the device name). Never fabricates a bpm.
 */
export function buildTrainerBluetoothContext(
  s: { isConnected: boolean; isSimulated: boolean; deviceName?: string | null; bpm: number | null },
  consentCheck: () => boolean = () => hasWearableAiConsent('live_heart_rate'),
): TrainerBluetoothContext {
  if (!s.isConnected || s.isSimulated || !consentCheck()) return { isConnected: false };
  const out: TrainerBluetoothContext = { isConnected: true };
  if (s.deviceName) out.deviceName = s.deviceName;
  if (typeof s.bpm === 'number' && Number.isFinite(s.bpm) && s.bpm > 0) out.bpm = s.bpm;
  return out;
}
