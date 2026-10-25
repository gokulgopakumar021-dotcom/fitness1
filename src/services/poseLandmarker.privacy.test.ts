import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Privacy guards for Phase 2C. These read real files (package.json, the installed
 * MediaPipe bundle, the Body Scan sources) so a later change that adds telemetry,
 * a network call, storage or a console log fails here instead of shipping.
 */

const ROOT = process.cwd();
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

/** Versions whose JavaScript bundle and WASM were audited for network endpoints. See docs/body-scan-pose-model.md. */
const AUDITED_VERSIONS = ['0.10.35'];

describe('MediaPipe dependency is pinned to an audited, endpoint-free version', () => {
  it('package.json pins an exact audited version (no ^, ~, range, tag or nightly)', () => {
    const pkg = JSON.parse(read('package.json')) as { dependencies: Record<string, string> };
    const range = pkg.dependencies['@mediapipe/tasks-vision'];
    expect(range).toBeDefined();
    expect(range).toMatch(/^\d+\.\d+\.\d+$/);
    expect(AUDITED_VERSIONS).toContain(range);
  });

  it('the installed package is that exact version', () => {
    const installed = JSON.parse(read('node_modules/@mediapipe/tasks-vision/package.json')) as { version: string; license: string };
    expect(AUDITED_VERSIONS).toContain(installed.version);
    expect(installed.license).toBe('Apache-2.0');
  });

  it('package-lock.json (the repo lockfile) resolves MediaPipe to the same exact version', () => {
    const pinned = (JSON.parse(read('package.json')) as { dependencies: Record<string, string> }).dependencies['@mediapipe/tasks-vision'];
    const lock = JSON.parse(read('package-lock.json')) as {
      packages: Record<string, { version?: string; dependencies?: Record<string, string> }>;
    };
    expect(lock.packages['node_modules/@mediapipe/tasks-vision']?.version).toBe(pinned);
    expect(lock.packages['']?.dependencies?.['@mediapipe/tasks-vision']).toBe(pinned); // exact in the root entry too, not a range
  });

  it('the installed JavaScript bundle contains no URL, logging endpoint or beacon', () => {
    const bundle = read('node_modules/@mediapipe/tasks-vision/vision_bundle.mjs');
    const urls = [...bundle.matchAll(/https?:\/\/[A-Za-z0-9._~:/?#@!$&%+,;=-]+/g)].map((m) => m[0]);
    // Allowed: protobuf type URLs ("type.googleapis.com/<proto name>") are identifiers, not requests.
    const real = urls.filter((u) => !/^https?:\/\/type\.googleapis\.com\//.test(u));
    expect(real).toEqual([]);
    expect(bundle).not.toContain('odml.pa.googleapis.com');
    expect(bundle).not.toMatch(/sendBeacon|XMLHttpRequest|WebSocket|EventSource/);
  });

  it('the WASM loader scripts make no calls to external hosts', () => {
    for (const f of ['vision_wasm_internal.js', 'vision_wasm_nosimd_internal.js']) {
      const src = read(`node_modules/@mediapipe/tasks-vision/wasm/${f}`);
      expect(src, f).not.toMatch(/odml\.pa\.googleapis|clearcut|play\.google|sendBeacon/);
    }
  });
});

/** Production Body Scan files introduced or changed in Phase 2C. */
const PHASE_2C_SOURCES = [
  'src/services/poseLandmarker.ts',
  'src/utils/poseResultAdapter.ts',
  'src/utils/poseDetectionAssessment.ts',
  'src/components/bodyscan/usePoseDetection.ts',
  'src/components/bodyscan/PoseDetectionPanel.tsx',
  'src/components/bodyscan/CaptureSession.tsx',
];

const stripComments = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

describe('Phase 2C source code never persists, logs or transmits photos or landmarks', () => {
  for (const file of PHASE_2C_SOURCES) {
    it(`${file}: no storage, logging, beacon, socket or data-URL encoding`, () => {
      const code = stripComments(read(file));
      expect(code).not.toMatch(/\blocalStorage\b|\bsessionStorage\b|\bindexedDB\b|\bcaches\b\.|document\.cookie/);
      expect(code).not.toMatch(/\bconsole\.(log|info|warn|error|debug|trace)\b/);
      expect(code).not.toMatch(/sendBeacon|XMLHttpRequest|WebSocket|EventSource|FileReader|toDataURL|navigator\.share/);
      expect(code).not.toMatch(/bodyScanStore|savePhoto|addPhoto|putPhoto/); // no route into the photo store
    });
  }

  it('the only network call in the pose code is the same-origin model GET', () => {
    const calls: string[] = [];
    for (const file of PHASE_2C_SOURCES) {
      const code = stripComments(read(file));
      for (const m of code.matchAll(/\bfetch\s*\(/g)) calls.push(`${file}@${m.index}`);
    }
    expect(calls).toHaveLength(1);
    expect(calls[0].startsWith('src/services/poseLandmarker.ts')).toBe(true);
    const engine = stripComments(read('src/services/poseLandmarker.ts'));
    expect(engine).toContain("credentials: 'same-origin'"); // no cookies / no cross-site
    expect(engine).not.toMatch(/method:\s*['"](POST|PUT|PATCH)/i);
    expect(engine).not.toMatch(/\bbody\s*:/);
  });

  it('the model URL is built only from this app’s base path and a fixed file name', () => {
    const engine = stripComments(read('src/services/poseLandmarker.ts'));
    expect(engine).not.toMatch(/https?:\/\//); // no absolute URL anywhere in the engine
    expect(engine).toMatch(/BASE_URL\}models\/\$\{POSE_MODEL_FILE\}/);
  });

  it('nothing outside the engine imports MediaPipe, and the engine only imports it lazily', () => {
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(join(ROOT, dir))) {
        const rel = `${dir}/${name}`;
        if (statSync(join(ROOT, rel)).isDirectory()) walk(rel);
        else if (/\.(ts|tsx)$/.test(name) && !/\.test\./.test(name) && rel !== 'src/services/poseLandmarker.ts') {
          if (/@mediapipe\//.test(read(rel))) offenders.push(rel);
        }
      }
    };
    walk('src');
    expect(offenders).toEqual([]);
    const engine = stripComments(read('src/services/poseLandmarker.ts'));
    expect(engine).not.toMatch(/^\s*import[^(\n]*from\s+['"]@mediapipe/m); // no static import: stays out of the initial bundle
    expect(engine).toMatch(/await import\('@mediapipe\/tasks-vision'\)/);
  });

  it('test-only fakes are never imported by production code', () => {
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(join(ROOT, dir))) {
        const rel = `${dir}/${name}`;
        if (statSync(join(ROOT, rel)).isDirectory()) walk(rel);
        else if (/\.(ts|tsx)$/.test(name) && !/\.test\.|\.testutil\./.test(name)) {
          if (/\.testutil['"]/.test(read(rel))) offenders.push(rel);
        }
      }
    };
    walk('src');
    expect(offenders).toEqual([]);
  });
});

describe('model placement', () => {
  it('public/models holds only the model bundle and its placeholder (never photos or landmark data)', () => {
    const allowed = /^(\.gitkeep|pose_landmarker_(lite|full|heavy)\.task(\.sha256)?)$/;
    for (const name of readdirSync(join(ROOT, 'public/models'))) expect(name).toMatch(allowed);
  });

  it('no other Phase 2C file ships a binary model, image or landmark dump in src/', () => {
    const bad: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(join(ROOT, dir))) {
        const rel = `${dir}/${name}`;
        if (statSync(join(ROOT, rel)).isDirectory()) walk(rel);
        else if (/\.(task|tflite|onnx|pb|bin)$/.test(name)) bad.push(rel);
      }
    };
    walk('src');
    expect(bad).toEqual([]);
  });
});
