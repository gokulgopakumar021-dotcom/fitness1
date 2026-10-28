import { existsSync } from 'node:fs';
import path from 'node:path';
import type { ManifestRecord } from '../../src/types/video';
import { evaluateMeasurement, FLAG_SEVERITY, type Flag, type FlagCode } from './probeAnalysis';
import { readProbeSidecar, type ProbeRecord } from './probe';

/**
 * Safety gate between the probe sidecar (<workdir>/probe.jsonl) and ingest. A video may only be uploaded and
 * published when a SUCCESSFUL probe result exists for exactly its bytes. A valid MP4 header proves nothing about
 * playability, so the container check done at inventory time is not enough on its own.
 *
 * Fail closed: a missing sidecar, a missing/skipped/unreadable/failed record, a record that does not describe this
 * file, a malformed measurement, or any blocking (error-severity) flag all reject the video. Warnings (for example a
 * non-H.264 codec) never block: they are advisory, and the gate requires nothing the probe does not guarantee
 * (audio is optional; no particular codec is required).
 *
 * Integrity: the sidecar is keyed by SHA-256 and the probe re-hashed the extracted bytes against the manifest before
 * measuring them; ingest re-hashes again before uploading. Matching hash and size therefore ties the result to the
 * exact file being ingested. A result recorded for an older version of the file has a different hash and is never
 * found.
 */

export type GateCode =
  | 'sidecar_missing'
  | 'no_probe_result'
  | 'probe_not_successful'
  | 'probe_result_mismatch'
  | 'probe_result_invalid'
  | 'blocking_probe_flag';

export interface GateDecision { ok: boolean; code?: GateCode; reason?: string }

export interface ProbeGate {
  sidecarPath: string;
  sidecarExists: boolean;
  /** Lines in the sidecar that could not be read (they can never make a video pass). */
  skippedLines: number;
  /** Latest record per hash. */
  byHash: Map<string, ProbeRecord>;
}

export class ProbeGateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProbeGateError';
  }
}

export function probeInstructions(workDir: string): string {
  return [
    'Run the media probe for exactly the videos you want to ingest, then try again:',
    `  npm run video:probe -- --zip <archive.zip> --sample-file <sample.txt> --workdir ${workDir}`,
    'It needs ffprobe (part of ffmpeg) on PATH: check `ffprobe -version` in the same terminal. Without ffprobe the probe',
    'step is skipped and writes nothing, which ingest treats as "not probed". Fix any video listed in',
    `${path.join(workDir, 'probe-flags.csv')} as an error, re-run the probe, then re-run ingest.`
  ].join('\n');
}

export function loadProbeGate(workDir: string): ProbeGate {
  const sidecarPath = path.join(workDir, 'probe.jsonl');
  const sidecarExists = existsSync(sidecarPath);
  const { records, skipped } = readProbeSidecar(sidecarPath);
  const byHash = new Map<string, ProbeRecord>();
  for (const r of records) byHash.set(r.sha256, r); // later lines win, like the probe's own merge
  return { sidecarPath, sidecarExists, skippedLines: skipped, byHash };
}

const reject = (code: GateCode, reason: string): GateDecision => ({ ok: false, code, reason });

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isBlocking = (f: unknown): boolean =>
  isObj(f) && (f.severity === 'error' || FLAG_SEVERITY[f.code as FlagCode] === 'error');

/** Minimal shape check, so a hand-edited or truncated record cannot reach the evaluator and pass by accident. */
function measurementShapeOk(m: unknown): boolean {
  if (!isObj(m)) return false;
  if (!(m.durationSeconds === null || typeof m.durationSeconds === 'number')) return false;
  if (!(m.video === null || isObj(m.video))) return false;
  if (typeof m.videoStreamCount !== 'number' || typeof m.audioStreamCount !== 'number') return false;
  if (!(m.audio === null || isObj(m.audio))) return false;
  return true;
}

export function evaluateProbeGate(rec: ManifestRecord, gate: ProbeGate): GateDecision {
  if (!gate.sidecarExists) {
    return reject('sidecar_missing', `no probe results exist (${gate.sidecarPath} not found)`);
  }
  const p = gate.byHash.get(rec.sha256 ?? '');
  if (!p) return reject('no_probe_result', 'no probe result for this exact file (its SHA-256 is not in probe.jsonl; the probe may be missing, skipped or from an older version of the file)');
  if (p.sha256 !== rec.sha256 || p.sizeBytes !== rec.sizeBytes) {
    return reject('probe_result_mismatch', `probe result does not match this file (recorded size ${String(p.sizeBytes)}, manifest size ${String(rec.sizeBytes)})`);
  }
  if (p.status !== 'probed') {
    return reject('probe_not_successful', `probe status is "${p.status}"${p.detail ? `: ${p.detail}` : ''}`);
  }
  if (typeof p.probedAt !== 'string' || !p.probedAt || !measurementShapeOk(p.measurement)) {
    return reject('probe_result_invalid', 'probe result is incomplete or malformed');
  }
  let flags: Flag[];
  try { flags = [...(Array.isArray(p.flags) ? p.flags : []), ...evaluateMeasurement(p.measurement!)]; }
  catch { return reject('probe_result_invalid', 'probe measurement could not be evaluated'); }
  // Recomputed from the measurement as well as read from the record, so an edited flag list cannot hide a problem.
  const blocking = flags.filter(isBlocking) as Flag[];
  if (blocking.length) {
    const codes = [...new Set(blocking.map((f) => f.code))].join(', ');
    return reject('blocking_probe_flag', `probe reported blocking problem(s): ${codes}`);
  }
  return { ok: true };
}
