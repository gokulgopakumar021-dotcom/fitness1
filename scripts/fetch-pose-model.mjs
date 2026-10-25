#!/usr/bin/env node
/**
 * Downloads the MediaPipe Pose Landmarker model into public/models/ so the app can
 * serve it from its own origin. Run once on a machine with normal internet access:
 *
 *   npm run fetch:pose-model
 *   npm run fetch:pose-model -- --expect <sha256>     # verify against a recorded hash
 *
 * This is a developer tool. The app itself never downloads from this URL; at
 * runtime it only fetches /models/pose_landmarker_full.task from its own origin.
 * See docs/body-scan-pose-model.md for provenance, licence and what to record.
 */
import { createHash } from 'node:crypto';
import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const VARIANT = 'pose_landmarker_full';
const SOURCE = `https://storage.googleapis.com/mediapipe-models/pose_landmarker/${VARIANT}/float16/latest/${VARIANT}.task`;
const MIN_BYTES = 100_000; // keep in sync with MIN_MODEL_BYTES in src/services/poseLandmarker.ts

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dest = join(root, 'public', 'models', `${VARIANT}.task`);
const argIndex = process.argv.indexOf('--expect');
const expected = argIndex > -1 ? process.argv[argIndex + 1]?.toLowerCase() : undefined;

let res;
try {
  res = await fetch(SOURCE, { redirect: 'follow' });
} catch (err) {
  console.error(`Could not reach ${SOURCE}`);
  console.error(`(${err?.cause?.code ?? err?.message ?? 'network error'}). Check your internet connection or proxy settings.`);
  process.exit(1);
}
if (!res.ok) {
  console.error(`Download failed: HTTP ${res.status} from ${SOURCE}`);
  process.exit(1);
}
const bytes = new Uint8Array(await res.arrayBuffer());
if (bytes.length < MIN_BYTES || bytes[0] === 0x3c /* '<' = a web page */) {
  console.error('Downloaded file does not look like a model bundle; refusing to write it.');
  process.exit(1);
}
const sha256 = createHash('sha256').update(bytes).digest('hex');
if (expected && expected !== sha256) {
  console.error(`SHA-256 mismatch.\n  expected ${expected}\n  actual   ${sha256}\nNothing was written.`);
  process.exit(1);
}

await mkdir(dirname(dest), { recursive: true });
const tmp = `${dest}.part`;
await writeFile(tmp, bytes);
await rm(dest, { force: true });
await rename(tmp, dest);

console.log(`Wrote ${dest}`);
console.log(`  source : ${SOURCE}`);
console.log(`  bytes  : ${bytes.length}`);
console.log(`  sha256 : ${sha256}`);
console.log('Record the bytes and sha256 in docs/body-scan-pose-model.md before committing the file.');
