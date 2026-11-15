/** Pure parser for the Bluetooth SIG Heart Rate Measurement characteristic (0x2A37). No I/O, no clock. */

export interface ParsedHeartRate {
  bpm: number;
  /** undefined when the sensor does not report contact support (bits 1-2 = 0 or 1). */
  contactDetected?: boolean;
  energyExpendedJoules?: number;
  rrIntervalsMs: number[];
}

export type HeartRateParseResult =
  | { ok: true; value: ParsedHeartRate }
  | { ok: false; reason: 'empty' | 'truncated' | 'no_reading' };

export function parseHeartRateMeasurement(view: DataView | null | undefined): HeartRateParseResult {
  if (!view || view.byteLength === 0) return { ok: false, reason: 'empty' };
  const flags = view.getUint8(0);
  const is16Bit = (flags & 0x01) !== 0;
  const need = 1 + (is16Bit ? 2 : 1);
  if (view.byteLength < need) return { ok: false, reason: 'truncated' };

  let offset = 1;
  let bpm: number;
  if (is16Bit) { bpm = view.getUint16(offset, true); offset += 2; } else { bpm = view.getUint8(offset); offset += 1; }

  // Contact field: 0/1 = not supported, 2 = supported but not detected, 3 = supported and detected.
  const contactField = (flags >> 1) & 0x03;
  const contactDetected = contactField >= 2 ? contactField === 3 : undefined;

  let energyExpendedJoules: number | undefined;
  if ((flags & 0x08) !== 0) {
    if (view.byteLength < offset + 2) return { ok: false, reason: 'truncated' };
    energyExpendedJoules = view.getUint16(offset, true);
    offset += 2;
  }

  const rrIntervalsMs: number[] = [];
  if ((flags & 0x10) !== 0) {
    while (offset + 1 < view.byteLength) {
      rrIntervalsMs.push(Math.round((view.getUint16(offset, true) / 1024) * 1000));
      offset += 2;
    }
  }

  // A zero reading (typically contact lost) is a missing measurement, not a heart rate of 0.
  if (bpm === 0) return { ok: false, reason: 'no_reading' };
  return { ok: true, value: { bpm, contactDetected, energyExpendedJoules, rrIntervalsMs } };
}

/** Battery Level (0x2A19) is one UINT8 percentage; anything else is unknown, never a guess. */
export function parseBatteryLevel(view: DataView | null | undefined): number | null {
  if (!view || view.byteLength < 1) return null;
  const v = view.getUint8(0);
  return v >= 0 && v <= 100 ? v : null;
}
