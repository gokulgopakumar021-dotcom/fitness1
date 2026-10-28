import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { ManifestRecord } from '../../src/types/video';
import { parseManifest } from '../../src/utils/videoLibrary/manifest';
import type { ProbeRecord } from './probe';
import { evaluateMeasurement, parseFfprobeJson, type Measurement } from './probeAnalysis';

/** A clean H.264 / yuv420p / AAC measurement. */
export const goodMeasurement = (): Measurement => parseFfprobeJson(JSON.stringify({
  format: { format_name: 'mov,mp4,m4a,3gp,3g2,mj2', duration: '2.5', tags: { major_brand: 'isom' } },
  streams: [
    { codec_type: 'video', codec_name: 'h264', profile: 'High', pix_fmt: 'yuv420p', width: 1280, height: 720, disposition: { attached_pic: 0 } },
    { codec_type: 'audio', codec_name: 'aac', sample_rate: '44100', channels: 2 }
  ]
}));

/** A successful probe record for a manifest record. `overrides` makes it skipped, failed, stale, flagged, etc. */
export function probeRecordFor(rec: ManifestRecord, overrides: Partial<ProbeRecord> = {}): ProbeRecord {
  const measurement = goodMeasurement();
  return {
    version: 1,
    sha256: rec.sha256!,
    entryName: rec.entryName,
    originalFilename: rec.originalFilename,
    reviewStatus: rec.match?.reviewStatus ?? 'unmatched',
    sizeBytes: rec.sizeBytes,
    probedAt: '2026-10-27T10:00:00.000Z',
    status: 'probed',
    measurement,
    flags: evaluateMeasurement(measurement),
    ...overrides
  };
}

export const writeProbeJsonl = (workDir: string, records: ProbeRecord[]) => {
  mkdirSync(workDir, { recursive: true });
  writeFileSync(path.join(workDir, 'probe.jsonl'), records.map((r) => JSON.stringify(r)).join('\n') + '\n');
};

export const readManifestOk = (workDir: string): ManifestRecord[] =>
  parseManifest(readFileSync(path.join(workDir, 'manifest.jsonl'), 'utf8')).records.filter((r) => r.status === 'ok' && r.sha256);

/** Writes a successful probe record for every ok video in the manifest (what a clean `video:probe` run would leave). */
export function writeCleanProbeSidecar(workDir: string) {
  writeProbeJsonl(workDir, readManifestOk(workDir).map((r) => probeRecordFor(r)));
}
