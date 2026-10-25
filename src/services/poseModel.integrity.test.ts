import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// Keeps the pinned model record honest: the fetch script, the docs and (when present) the committed file must agree.
const root = process.cwd();
const script = readFileSync(join(root, 'scripts/fetch-pose-model.mjs'), 'utf8');
const doc = readFileSync(join(root, 'docs/body-scan-pose-model.md'), 'utf8');
const modelPath = join(root, 'public/models/pose_landmarker_full.task');

const pinnedHash = /EXPECTED_SHA256 = '([0-9a-f]{64})'/.exec(script)?.[1];
const pinnedBytes = Number(/EXPECTED_BYTES = (\d+)/.exec(script)?.[1]);

describe('pose model pin', () => {
  it('the fetch script pins a full SHA-256 and a byte size', () => {
    expect(pinnedHash).toMatch(/^[0-9a-f]{64}$/);
    expect(pinnedBytes).toBeGreaterThan(100_000);
  });

  it('the docs record the same hash and size as the script', () => {
    expect(doc).toContain(pinnedHash!);
    expect(doc).toContain(String(pinnedBytes));
  });

  it('the script refuses any download whose hash differs from the pin (no unverified write path)', () => {
    expect(script).toMatch(/if \(expected !== sha256\)/);
    expect(script).not.toMatch(/if \(expected && expected !== sha256\)/);
  });

  it('licence text and attribution ship with the repo', () => {
    expect(existsSync(join(root, 'licenses/Apache-2.0.txt'))).toBe(true);
    const notices = readFileSync(join(root, 'THIRD_PARTY_NOTICES.md'), 'utf8');
    expect(notices).toContain('MediaPipe Pose Landmarker (BlazePose GHUM 3D), Google, Apache-2.0');
  });

  // Runs wherever the binary has been added. Absent file = skipped, so this proves nothing in a checkout without it.
  it.skipIf(!existsSync(modelPath))('the committed model file matches the pinned size and SHA-256', () => {
    expect(statSync(modelPath).size).toBe(pinnedBytes);
    expect(createHash('sha256').update(readFileSync(modelPath)).digest('hex')).toBe(pinnedHash);
  });
});
