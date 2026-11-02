import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { logClientError, logClientWarn, summarizeError } from './clientLog';

const SENSITIVE = [
  'Bearer eyJhbGciOiJIUzI1NiJ9.payload.sig',
  'user@example.com',
  'My weight is 82.4kg and I take metformin',
  'barcode 5000112637922',
  'photo_front_2026.jpg image/jpeg 4194304',
  'quota_exceeded: model gemini-x at https://internal.example/v1',
];

function sensitiveError(): Error & { code?: string } {
  const e = new Error(SENSITIVE.join(' | '), { cause: { prompt: SENSITIVE[2] } }) as Error & { code?: string };
  e.stack = `Error: ${SENSITIVE[0]}\n    at ${SENSITIVE[1]}`;
  (e as unknown as Record<string, unknown>).body = SENSITIVE[2];
  return e;
}

function printed(spy: ReturnType<typeof vi.spyOn>): string {
  return JSON.stringify(spy.mock.calls.map((c) => c.map((a) => (a instanceof Error ? { name: a.name, message: a.message, stack: a.stack } : a))));
}

describe('clientLog: production redaction', () => {
  let warn: ReturnType<typeof vi.spyOn>;
  let error: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    vi.stubEnv('DEV', false);
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    error = vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('never prints message, stack, cause or extra properties of an error', () => {
    logClientError('scope a', sensitiveError());
    logClientWarn('scope b', sensitiveError());
    const out = printed(error) + printed(warn);
    for (const s of SENSITIVE) expect(out).not.toContain(s);
    expect(out).not.toContain('metformin');
    expect(out).not.toContain('stack');
    expect(out).not.toContain('cause');
  });

  it('prints the static scope and a { name, code } summary', () => {
    const e = new DOMException('secret text', 'NotAllowedError');
    logClientError('camera failed', e);
    expect(error).toHaveBeenCalledWith('[ironlog] camera failed', { name: 'NotAllowedError' });
    const withCode = Object.assign(new Error('x'), { code: 'QuotaExceededError' });
    logClientError('write failed', withCode);
    expect(error).toHaveBeenLastCalledWith('[ironlog] write failed', { name: 'Error', code: 'QuotaExceededError' });
  });

  it('rejects names and codes that could carry data (spaces, punctuation, long strings)', () => {
    expect(summarizeError({ name: 'weight 82kg', code: 'user@example.com' })).toEqual({ name: 'Error' });
    expect(summarizeError({ name: 'A'.repeat(65) })).toEqual({ name: 'Error' });
    expect(summarizeError({ name: 'TypeError', code: 404 })).toEqual({ name: 'TypeError', code: 404 });
  });

  it('handles non-Error values: strings, null, objects with tokens never leak', () => {
    logClientError('s1', SENSITIVE[0]);
    logClientError('s2', null);
    logClientError('s3', { token: SENSITIVE[0], body: SENSITIVE[2] });
    const out = printed(error);
    expect(out).not.toContain('Bearer');
    expect(out).not.toContain('metformin');
    expect(error).toHaveBeenNthCalledWith(1, '[ironlog] s1', { name: 'NonError' });
  });

  it('a call without an error prints only the scope', () => {
    logClientError('storage: refusing to overwrite');
    expect(error).toHaveBeenCalledWith('[ironlog] storage: refusing to overwrite');
  });
});

describe('clientLog: development diagnostics', () => {
  afterEach(() => vi.restoreAllMocks());
  it('keeps the full error object in dev so local debugging is unchanged', () => {
    vi.stubEnv('DEV', true);
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const e = new Error('detail');
    logClientError('dev scope', e);
    expect(error).toHaveBeenCalledWith('[ironlog] dev scope', e);
    vi.unstubAllEnvs();
  });
});

describe('guard: no raw console.* under src/', () => {
  const root = join(__dirname, '..');
  const ALLOWED = new Set(
    ['lib/clientLog.ts', 'server/security/logger.ts', 'server/security/redisTestHarness.ts'].map((p) => p.split('/').join(sep)),
  );

  function walk(dir: string, out: string[] = []): string[] {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) {
        if (name === 'node_modules' || name === 'test') continue;
        walk(full, out);
      } else if (/\.(ts|tsx)$/.test(name) && !/\.test\.(ts|tsx)$/.test(name)) out.push(full);
    }
    return out;
  }
  const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

  it('production source goes through clientLog (or the server logger)', () => {
    const offenders = walk(root)
      .filter((f) => !ALLOWED.has(relative(root, f)))
      .filter((f) => /\bconsole\s*(\.|\[)/.test(stripComments(readFileSync(f, 'utf8'))))
      .map((f) => relative(root, f));
    expect(offenders).toEqual([]);
  });
});
