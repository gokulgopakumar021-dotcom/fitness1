// @vitest-environment node
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import express from 'express';
import { describe, expect, it } from 'vitest';
import { normalizeRewrittenUrl, RESERVED_REWRITE_PARAM } from './normalizeUrl';
import { LEGAL_ROUTE_LIST } from '../../legal/routes';
import { BILLING_ENDPOINTS, ENDPOINTS } from '../security/endpoints';

const R = RESERVED_REWRITE_PARAM;
const n = normalizeRewrittenUrl;

describe('normalizeRewrittenUrl: reserved parameter removal', () => {
  it('leaves a URL with no query string untouched (same string)', () => {
    for (const u of ['/api/health', '/api', '/api/', '/api/nutrition/barcode/012345678905']) expect(n(u)).toBe(u);
  });

  it('leaves a URL without the reserved key untouched (same string)', () => {
    const u = '/api/health?a=1&b=2';
    expect(n(u)).toBe(u);
  });

  it('removes one injected reserved parameter and drops the "?" when nothing remains', () => {
    expect(n(`/api/health?${R}=health`)).toBe('/api/health');
    expect(n(`/api/nutrition/barcode/012345678905?${R}=nutrition%2Fbarcode%2F012345678905`)).toBe('/api/nutrition/barcode/012345678905');
  });

  it('removes repeated reserved parameters', () => {
    expect(n(`/api/x?${R}=a&${R}=b%2Fc&${R}=`)).toBe('/api/x');
    expect(n(`/api/x?${R}=a&keep=1&${R}=b`)).toBe('/api/x?keep=1');
  });

  it('removes a reserved key sent WITHOUT a value, or with an empty value', () => {
    expect(n(`/api/x?${R}`)).toBe('/api/x');
    expect(n(`/api/x?${R}=`)).toBe('/api/x');
  });

  it('removes a client-supplied reserved key as well (it has no legitimate use)', () => {
    expect(n(`/api/x?a=1&${R}=client-value`)).toBe('/api/x?a=1');
    expect(n(`/api/x?${R}=client&${R}=vercel%2Fpath&a=1`)).toBe('/api/x?a=1');
  });

  it('cannot be bypassed by percent-encoding or "+" in the key', () => {
    const encoded = R.replace(/_/g, '%5F');
    expect(n(`/api/x?${encoded}=evil&a=1`)).toBe('/api/x?a=1');
    expect(n(`/api/x?${R.replace('i', '%69')}=evil`)).toBe('/api/x');
    // A key that merely CONTAINS the reserved name is a different key and stays.
    expect(n(`/api/x?x${R}=1&${R}x=2`)).toBe(`/api/x?x${R}=1&${R}x=2`);
  });

  it('keeps a key with a malformed escape (it cannot equal the reserved name)', () => {
    expect(n(`/api/x?%E0%A4%A=1&${R}=v`)).toBe('/api/x?%E0%A4%A=1');
  });
});

describe('normalizeRewrittenUrl: legitimate parameters are preserved', () => {
  it('never removes a legitimate client `path` parameter (single)', () => {
    expect(n('/api/x?path=client')).toBe('/api/x?path=client');
    expect(n(`/api/x?path=client&${R}=x`)).toBe('/api/x?path=client');
  });

  it('never removes repeated `path` parameters', () => {
    expect(n(`/api/x?path=a&path=b&${R}=v`)).toBe('/api/x?path=a&path=b');
  });

  it('mixed `path` and reserved parameters in any order', () => {
    expect(n(`/api/x?${R}=v&path=a&${R}=w&path=b`)).toBe('/api/x?path=a&path=b');
    expect(n(`/api/x?path=a&${R}=v&path=b`)).toBe('/api/x?path=a&path=b');
  });

  it('preserves repeated ordinary parameters, their order and their duplicates', () => {
    expect(n(`/api/x?tag=a&tag=b&${R}=v&tag=a&z=1`)).toBe('/api/x?tag=a&tag=b&tag=a&z=1');
    expect(n('/api/x?tag=a&tag=b&tag=a')).toBe('/api/x?tag=a&tag=b&tag=a');
  });

  it('preserves raw encoding exactly (no decode / re-encode of unrelated values)', () => {
    const q = 'a=%2F%3D%26&b=hello+world&c=%20x%20&d[]=1&d[]=2&e=%E2%9C%93&f=%zz&g=a=b=c';
    expect(n(`/api/x?${R}=v&${q}`)).toBe(`/api/x?${q}`);
    expect(n(`/api/x?${q}&${R}=v`)).toBe(`/api/x?${q}`);
    expect(n(`/api/x?${q}`)).toBe(`/api/x?${q}`);
  });

  it('preserves empty segments and flag-style parameters it does not remove', () => {
    expect(n(`/api/x?a&&b=&c=1&${R}=v`)).toBe('/api/x?a&&b=&c=1');
  });

  it('keeps the query-string exactly when the reserved key is last, first or in the middle', () => {
    expect(n(`/api/x?a=1&b=2&${R}=v`)).toBe('/api/x?a=1&b=2');
    expect(n(`/api/x?${R}=v&a=1&b=2`)).toBe('/api/x?a=1&b=2');
    expect(n(`/api/x?a=1&${R}=v&b=2`)).toBe('/api/x?a=1&b=2');
  });
});

describe('normalizeRewrittenUrl: paths are never modified', () => {
  it('handles the exact /api path', () => {
    expect(n(`/api?${R}=`)).toBe('/api');
    expect(n(`/api?${R}=&a=1`)).toBe('/api?a=1');
    expect(n('/api')).toBe('/api');
  });

  it('handles nested API paths', () => {
    expect(n(`/api/adaptive-coach/explain?${R}=adaptive-coach%2Fexplain`)).toBe('/api/adaptive-coach/explain');
    expect(n(`/api/a/b/c/d?${R}=a%2Fb%2Fc%2Fd&x=1`)).toBe('/api/a/b/c/d?x=1');
  });

  it('does not decode or alter encoded characters in the path (barcode with %2F, %20, unicode)', () => {
    for (const p of ['/api/nutrition/barcode/12%2F34', '/api/nutrition/barcode/ab%20cd', '/api/nutrition/barcode/%E2%9C%93', '/api/x/%2e%2e/y']) {
      expect(n(`${p}?${R}=v`)).toBe(p);
      expect(n(`${p}?q=1&${R}=v`)).toBe(`${p}?q=1`);
    }
  });

  it('a "?" or the reserved name inside the PATH is not treated as a parameter', () => {
    expect(n(`/api/${R}=1`)).toBe(`/api/${R}=1`);
    expect(n(`/api/x%3F${R}=1`)).toBe(`/api/x%3F${R}=1`);
  });

  it('is idempotent', () => {
    for (const u of [`/api/x?${R}=a&path=b&${R}=c`, '/api/x?a=1', `/api?${R}=`, '/api/x']) expect(n(n(u))).toBe(n(u));
  });
});

describe('through a real Express request (what Express sees after normalisation)', () => {
  async function probe(rawUrl: string) {
    const app = express();
    app.all('*', (req, res) => res.json({ url: req.url, originalUrl: req.originalUrl, path: req.path, query: req.query, method: req.method, body: req.body ?? null }));
    const server = http.createServer((req, res) => {
      req.url = normalizeRewrittenUrl(req.url ?? '/');
      app(req, res);
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const { port } = server.address() as AddressInfo;
    try {
      // Raw socket write so the request line is sent exactly as given (fetch would re-encode).
      const net = await import('node:net');
      return await new Promise<{ status: number; json: any }>((resolve, reject) => {
        const sock = net.connect(port, '127.0.0.1', () => sock.write(`GET ${rawUrl} HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n`));
        let buf = '';
        sock.on('data', (d) => (buf += d));
        sock.on('error', reject);
        sock.on('close', () => {
          const [head, ...rest] = buf.split('\r\n\r\n');
          const body = rest.join('\r\n\r\n').replace(/^[0-9a-f]+\r\n/i, '').replace(/\r\n0\r\n\r\n$/, '');
          resolve({ status: Number(head.split(' ')[1]), json: JSON.parse(body.slice(body.indexOf('{'))) });
        });
      });
    } finally {
      server.closeAllConnections?.();
      await new Promise<void>((r) => server.close(() => r()));
    }
  }

  it('injected reserved parameter: req.url, req.originalUrl and req.query are clean', async () => {
    const { json } = await probe(`/api/health?${R}=health`);
    expect(json.url).toBe('/api/health');
    expect(json.originalUrl).toBe('/api/health');
    expect(json.query).toEqual({});
    expect(JSON.stringify(json)).not.toContain(R);
  });

  it('client `path` stays a plain string; it is not turned into an array by the injected value', async () => {
    const { json } = await probe(`/api/x?path=client&${R}=x%2Fy`);
    expect(json.query).toEqual({ path: 'client' });
    expect(json.originalUrl).toBe('/api/x?path=client');
  });

  it('repeated client `path` stays an array of exactly the client values', async () => {
    const { json } = await probe(`/api/x?path=a&${R}=v&path=b`);
    expect(json.query).toEqual({ path: ['a', 'b'] });
  });

  it('barcode path with an encoded slash reaches Express unmodified', async () => {
    const { json } = await probe(`/api/nutrition/barcode/12%2F34?${R}=nutrition%2Fbarcode%2F12%2F34&lang=en`);
    expect(json.path).toBe('/api/nutrition/barcode/12%2F34');
    expect(json.query).toEqual({ lang: 'en' });
  });

  it('exact /api path and nested paths', async () => {
    expect((await probe(`/api?${R}=`)).json).toMatchObject({ url: '/api', path: '/api', query: {} });
    expect((await probe(`/api/adaptive-coach/explain?${R}=adaptive-coach%2Fexplain`)).json).toMatchObject({ path: '/api/adaptive-coach/explain', query: {} });
  });

  it('method is untouched', async () => {
    expect((await probe(`/api/x?${R}=v`)).json.method).toBe('GET');
  });
});

describe('vercel.json is consistent with the reserved parameter', () => {
  const ROOT = path.resolve(import.meta.dirname, '../../..');
  const cfg = JSON.parse(readFileSync(path.join(ROOT, 'vercel.json'), 'utf8'));

  // Stage 3: the five public legal pages (Stage 2B) are served by exact-path rewrites to the SPA entry. The ORIGINAL intent of these
  // two tests is kept: exactly one rewrite for the API, with the reserved parameter, and no broad / SPA-fallback rewrite.
  const LEGAL_PATHS = ['/privacy', '/terms', '/refund-policy', '/cancellation-policy', '/contact'];
  const [apiRewrite, ...legalRewrites] = cfg.rewrites as Array<{ source: string; destination: string }>;

  it('the single API rewrite names exactly the reserved parameter, targets /api, and is FIRST so it always wins', () => {
    expect(apiRewrite).toEqual({ source: `/api/:${R}*`, destination: '/api' });
    expect(cfg.rewrites.filter((r: { source: string }) => r.source.startsWith('/api'))).toHaveLength(1);
  });

  it('every other rewrite is exactly one of the five legal pages, mapped to /index.html, in a fixed order', () => {
    expect(legalRewrites).toEqual(LEGAL_PATHS.map((source) => ({ source, destination: '/index.html' })));
  });

  it('the legal rewrites match the app route table (src/legal/routes.ts), so they cannot drift apart', () => {
    expect(LEGAL_ROUTE_LIST.map((r) => r.path)).toEqual(LEGAL_PATHS);
  });

  it('no broad rewrite / SPA fallback and no framework, build or output override was added', () => {
    // Legal sources must be plain literals: no parameter, wildcard, group, regex or optional segment.
    for (const r of legalRewrites) expect(r.source, r.source).toMatch(/^\/[a-z]+(?:-[a-z]+)*$/);
    // The ONLY wildcard anywhere is the API rewrite's own named parameter.
    expect(cfg.rewrites.filter((r: { source: string }) => /[*()?+:]/.test(r.source)).map((r: { source: string }) => r.source)).toEqual([apiRewrite.source]);
    expect(cfg.rewrites.some((r: { source: string }) => r.source === '/' || r.source === '/(.*)' || r.source === '/:path*')).toBe(false);
    expect(cfg.framework).toBeUndefined();
    expect(cfg.buildCommand).toBeUndefined();
    expect(cfg.outputDirectory).toBeUndefined();
    expect(JSON.stringify(cfg)).not.toMatch(/:path\*/);
  });

  it('a legal rewrite can never capture or shadow an API route (sources are exact literals and none starts with /api)', () => {
    const apiPaths = [...Object.keys(ENDPOINTS), ...Object.keys(BILLING_ENDPOINTS)].map((k) => `/api${k.split(' ')[1].replace(/:[A-Za-z]+/g, 'x')}`);
    expect(apiPaths.length).toBeGreaterThan(10);
    for (const r of legalRewrites) {
      expect(r.source.startsWith('/api'), r.source).toBe(false);
      expect(apiPaths, r.source).not.toContain(r.source);
      // an exact-literal source cannot match any API path, nor /api/<legal path>
      expect(`/api${r.source}`).not.toBe(r.source);
    }
    // /api itself, /api/x and /api/privacy are claimed by the API rewrite (first), never by a legal one.
    expect(apiRewrite.source.startsWith('/api')).toBe(true);
  });

  it('the legal rewrites point at a real SPA entry file', () => {
    for (const r of legalRewrites) expect(existsSync(path.join(ROOT, r.destination.replace(/^\//, ''))), r.destination).toBe(true);
  });
});

describe('tripwire: production backend code does not read the query string or request URL', () => {
  const ROOT = path.resolve(import.meta.dirname, '../../..');
  function walk(dir: string, out: string[] = []): string[] {
    for (const name of readdirSync(dir)) {
      const full = path.join(dir, name);
      if (statSync(full).isDirectory()) walk(full, out);
      else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(full);
    }
    return out;
  }
  // Backend = everything under src/server plus the adaptive-coach helpers the routes import, plus the entry points.
  const files = [...walk(path.join(ROOT, 'src/server')), ...walk(path.join(ROOT, 'src/utils/adaptiveCoach')), path.join(ROOT, 'server.ts')];
  // The normaliser itself, and the handler line that writes the NORMALISED url back (the only legitimate req.url access).
  const ALLOWED = new Set([path.join(ROOT, 'src/server/serverless/normalizeUrl.ts'), path.join(ROOT, 'src/server/serverless/handler.ts')]);
  const READER = /\breq\.(query|url|originalUrl|baseUrl)\b|\.originalUrl\b|\bsearchParams\b|\bURLSearchParams\b|\bquerystring\b|\breq\.params\b(?!\.barcode)/;

  it('scans a non-trivial set of backend files', () => {
    expect(files.length).toBeGreaterThan(20);
  });

  it('has no req.query / req.url / req.originalUrl reader outside the normaliser (a new one must be written against the normalised URL and added here deliberately)', () => {
    const offenders: string[] = [];
    for (const f of files) {
      if (ALLOWED.has(f)) continue;
      const src = readFileSync(f, 'utf8').split('\n');
      src.forEach((line, i) => {
        if (/^\s*(\/\/|\*|\/\*)/.test(line)) return;
        if (READER.test(line)) offenders.push(`${path.relative(ROOT, f)}:${i + 1}: ${line.trim()}`);
      });
    }
    expect(offenders).toEqual([]);
  });
});
