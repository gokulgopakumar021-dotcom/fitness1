import http from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Express } from 'express';
import type { TokenVerifier } from './auth';
import { loadSecurityConfig, type SecurityConfig } from './config';

export const b64url = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');

/** Fake 3-part JWT. Claims drive the mock verifier; nothing here is a real credential. */
export function fakeToken(claims: Record<string, unknown> = {}, nowMs = Date.now()): string {
  return `${b64url({ alg: 'HS256', typ: 'JWT' })}.${b64url({ sub: 'user-a', exp: Math.floor(nowMs / 1000) + 3600, ...claims })}.fakesig`;
}

export const mockVerifier: TokenVerifier = async (token) => {
  let c: Record<string, unknown>;
  try {
    c = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'));
  } catch {
    return { ok: false, reason: 'invalid' };
  }
  if (c.down) return { ok: false, reason: 'unavailable' };
  if (c.bad) return { ok: false, reason: 'invalid' };
  return { ok: true, user: { id: String(c.sub), email: typeof c.email === 'string' ? c.email : undefined, emailVerified: c.verified !== false } };
};

export function testConfig(over: Partial<SecurityConfig> = {}): SecurityConfig {
  return { ...loadSecurityConfig({ NODE_ENV: 'test' }), supabaseUrl: 'https://abc.supabase.co', ...over };
}

export async function listen(app: Express) {
  const server = http.createServer(app);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address() as AddressInfo;
  return {
    base: `http://127.0.0.1:${port}`,
    close: () =>
      new Promise<void>((r) => {
        server.closeAllConnections?.();
        server.close(() => r());
      })
  };
}

/** A complete, non-secret Supabase setup so production-shaped configs satisfy the QUOTA_STORE=supabase default. Nothing connects to it. */
export const QUOTA_ENV = { SUPABASE_URL: 'https://abc.supabase.co', SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test_not_real' };
