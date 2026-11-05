// Builds the Vercel Function (api/index.js) from src/server/serverless/entry.ts with esbuild (Stage 3.7, option B2).
//
//   node scripts/bundle-api.mjs          write api/index.js
//   node scripts/bundle-api.mjs --check  fail if api/index.js is stale or the bundle breaks a rule below
//
// Why a bundle: the server dependency graph uses extensionless relative imports (58 of them in 18 files), which Node's
// ESM loader rejects. Bundling resolves them at build time with zero source edits. Why npm packages stay external: Vercel
// traces and ships them from node_modules, and bundling them would only inflate and obscure the file.
// The comparison ignores CRLF vs LF (Git on Windows may check the file out with CRLF; .gitattributes also pins it to LF).
// The output is deterministic (no minification, no timestamps, no absolute paths, no source map) so a stale bundle is
// detectable by byte comparison. Nothing from the environment is inlined (no `define`).
import { build } from 'esbuild';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const ENTRY = 'src/server/serverless/entry.ts';
export const OUTFILE = 'api/index.js';

// Runtime packages the function may import. Anything else (vite, dotenv, tsx, test tooling) is a build failure.
export const ALLOWED_EXTERNALS = ['express', 'helmet', 'redis', '@supabase/supabase-js', '@google/genai'];
export const FORBIDDEN_INPUTS = [/^server\.ts$/, /node_modules\/vite\//, /node_modules\/dotenv\//, /\.test\.tsx?$/, /^src\/components\//, /^src\/views\//];

const BANNER = '// GENERATED FILE. Do not edit. Source: src/server/serverless/entry.ts. Rebuild: npm run build:api\n';

export async function buildApiBundle() {
  const result = await build({
    absWorkingDir: ROOT,
    entryPoints: [ENTRY],
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node22',
    packages: 'external',
    minify: false,
    sourcemap: false,
    legalComments: 'none',
    banner: { js: BANNER.trimEnd() },
    metafile: true,
    write: false,
    logLevel: 'silent',
    outfile: OUTFILE,
  });
  return { code: result.outputFiles[0].text, metafile: result.metafile };
}

export function externalImports(code) {
  const found = new Set();
  for (const m of code.matchAll(/^import\s[^;]*?from\s+["']([^"']+)["'];?$/gm)) found.add(m[1]);
  for (const m of code.matchAll(/^import\s+["']([^"']+)["'];?$/gm)) found.add(m[1]);
  return [...found].sort();
}

const pkgName = (spec) => (spec.startsWith('@') ? spec.split('/').slice(0, 2).join('/') : spec.split('/')[0]);

/** Returns a list of problems; empty means the bundle satisfies the Stage 3.7 rules. */
export function inspectBundle({ code, metafile }) {
  const problems = [];
  const inputs = Object.keys(metafile.inputs);
  for (const input of inputs) {
    if (FORBIDDEN_INPUTS.some((re) => re.test(input))) problems.push(`forbidden source in bundle: ${input}`);
  }
  for (const spec of externalImports(code)) {
    if (spec.startsWith('node:')) continue;
    if (!ALLOWED_EXTERNALS.includes(pkgName(spec))) problems.push(`unexpected external import: ${spec}`);
  }
  const rules = [
    [/\.listen\s*\(/, 'calls .listen()'],
    [/process\.(exit|on|once)\s*\(/, 'process exit or signal handler'],
    [/setInterval\s*\(/, 'setInterval (background timer)'],
    [/express\.static|sendFile\s*\(/, 'serves static files'],
    [/\brequire\s*\(/, 'require() call (ESM bundle must not need it)'],
    [new RegExp(['__vercel', '_spike'].join('')), 'Stage 1 diagnostic endpoint'],
    [/\/(home|Users|tmp|mnt)\/[^\s"']+\/(fitness1|src)\//, 'absolute build path'],
    [/eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/, 'JWT-looking string'],
    [/\bsk-[A-Za-z0-9]{20,}|AIza[0-9A-Za-z_-]{30,}|rediss?:\/\/[^\s"'`$]*:[^\s"'`$@]+@/, 'credential-looking string'],
  ];
  for (const [re, label] of rules) if (re.test(code)) problems.push(label);
  if (!/^export\s*\{[^}]*\bas default\b[^}]*\};?$/m.test(code) && !/^export default\b/m.test(code)) problems.push('no default export');
  return problems;
}

async function main() {
  const check = process.argv.includes('--check');
  const built = await buildApiBundle();
  const problems = inspectBundle(built);
  const out = path.join(ROOT, OUTFILE);
  if (check) {
    if (!existsSync(out)) problems.push(`${OUTFILE} is missing (run: npm run build:api)`);
    else if (readFileSync(out, 'utf8').replace(/\r\n/g, '\n') !== built.code) problems.push(`${OUTFILE} is stale (run: npm run build:api)`);
  }
  if (problems.length) {
    for (const p of problems) console.error(`api bundle: ${p}`);
    process.exit(1);
  }
  if (!check) writeFileSync(out, built.code);
  const bytes = Buffer.byteLength(built.code);
  const sources = Object.keys(built.metafile.inputs).length;
  console.log(`api bundle ${check ? 'OK' : 'written'}: ${OUTFILE} ${bytes} bytes, ${sources} source files, externals: ${externalImports(built.code).join(', ')}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error('api bundle: build failed:', err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
