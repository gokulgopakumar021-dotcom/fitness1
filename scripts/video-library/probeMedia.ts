import type { Measurement } from './probeAnalysis';
import type { ProbeRecord } from './probe';

/**
 * Catalog media fields (duration, width, height) derived from a probe record. Pure, no I/O.
 *
 * This only READS probe output. It never decides whether a video may be uploaded: that is probeGate.ts alone.
 * Every field falls back to null when the value is missing or would violate the table constraints
 * (duration >= 0, width/height > 0), so a malformed record can never make an insert fail.
 */
export interface CatalogMedia {
  duration_seconds: number | null;
  width: number | null;
  height: number | null;
}

export const NO_MEDIA: CatalogMedia = { duration_seconds: null, width: null, height: null };

const positiveInt = (n: unknown): number | null =>
  typeof n === 'number' && Number.isFinite(n) && n > 0 ? Math.round(n) : null;

export function mediaFromMeasurement(m: Measurement | null | undefined): CatalogMedia {
  if (!m) return NO_MEDIA;
  const d = m.durationSeconds;
  // numeric(8,2): two decimals, non-negative.
  const duration = typeof d === 'number' && Number.isFinite(d) && d >= 0 ? Math.round(d * 100) / 100 : null;
  let width = positiveInt(m.video?.width);
  let height = positiveInt(m.video?.height);
  // Phone videos can store landscape pixels with a 90/270 degree display rotation. The catalog records the size
  // as displayed, which is what an aspect-ratio box needs.
  const rot = m.video?.rotation;
  if (typeof rot === 'number' && Math.abs(Math.round(rot)) % 180 === 90) [width, height] = [height, width];
  return { duration_seconds: duration, width, height };
}

/** Only a record that actually probed successfully contributes media. Anything else yields all-null. */
export function mediaFromProbeRecord(p: ProbeRecord | undefined): CatalogMedia {
  return p && p.status === 'probed' ? mediaFromMeasurement(p.measurement) : NO_MEDIA;
}
