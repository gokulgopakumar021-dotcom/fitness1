export interface SecurityConfig {
  production: boolean;
  supabaseUrl?: string;
  supabaseKey?: string;
  requireVerifiedEmail: boolean;
  trustProxy: number | boolean;
  corsOrigins: string[];
  rateIpPerMin: number;
  rateUserPerMin: number;
  authFailMax: number;
  authFailWindowMs: number;
  quotaOverrides: Record<string, number>;
  quotaStore: 'memory' | 'supabase';
  /** Backend for per-IP / per-user / per-endpoint rate limits. Production defaults to `redis` (shared across instances). */
  rateStore: 'memory' | 'redis';
  /** Never logged verbatim: may contain credentials. Use redactRedisUrl() for logs. */
  redisUrl?: string;
  /** What happens when the shared rate store is unavailable. `closed` (default) = 503; `degraded` = per-instance counting, announced via X-RateLimit-Mode. */
  rateFailurePolicy: 'closed' | 'degraded';
  /** Startup-blocking configuration errors (see validateSecurityConfig). loadSecurityConfig itself never throws. */
  problems: string[];
  /** Non-blocking warnings, logged at startup. */
  warnings: string[];
}

type Env = Record<string, string | undefined>;

function int(raw: string | undefined, fallback: number, min = 1): number {
  const n = raw === undefined || raw.trim() === '' ? NaN : Number(raw);
  return Number.isInteger(n) && n >= min ? n : fallback;
}

function bool(raw: string | undefined): boolean {
  return ['1', 'true', 'yes', 'on'].includes((raw ?? '').trim().toLowerCase());
}

function normaliseOrigin(raw: string): string | null {
  try {
    const u = new URL(raw.trim());
    if (!['http:', 'https:', 'capacitor:', 'ionic:'].includes(u.protocol)) return null;
    return u.origin === 'null' ? `${u.protocol}//${u.host}` : u.origin;
  } catch {
    return null;
  }
}

/** Origins that Capacitor's WebViews use by default. Opt-in only: see docs/security/mobile-origins.md. */
export const CAPACITOR_ORIGINS = ['capacitor://localhost', 'https://localhost', 'http://localhost'];
const DEV_ORIGINS = ['http://localhost:3000', 'http://127.0.0.1:3000', 'http://localhost:5173', 'http://localhost:8080'];

export function loadSecurityConfig(env: Env = process.env): SecurityConfig {
  const production = env.NODE_ENV === 'production';

  const origins = new Set<string>();
  const add = (raw?: string) => {
    const o = raw ? normaliseOrigin(raw) : null;
    if (o) origins.add(o);
  };
  (env.CORS_ALLOWED_ORIGINS ?? '').split(',').forEach(add);
  add(env.APP_URL); // ignored automatically while it is still the .env.example placeholder
  add(env.VITE_SITE_URL);
  if (bool(env.CORS_ALLOW_CAPACITOR)) CAPACITOR_ORIGINS.forEach(add);
  if (!production) DEV_ORIGINS.forEach(add);

  let quotaOverrides: Record<string, number> = {};
  if (env.AI_QUOTA_OVERRIDES) {
    try {
      const parsed = JSON.parse(env.AI_QUOTA_OVERRIDES) as Record<string, unknown>;
      for (const [k, v] of Object.entries(parsed)) {
        if (typeof v === 'number' && Number.isInteger(v) && v >= 0) quotaOverrides[k] = v;
      }
    } catch {
      quotaOverrides = {}; // malformed override must never disable limits; defaults apply
    }
  }

  const proxy = (env.TRUST_PROXY ?? '').trim().toLowerCase();
  const trustProxy: number | boolean = proxy === '' || proxy === 'false' ? false : /^\d+$/.test(proxy) ? Number(proxy) : false;

  const problems: string[] = [];
  const warnings: string[] = [];

  const rawStore = (env.RATE_LIMIT_STORE ?? '').trim().toLowerCase();
  let rateStore: 'memory' | 'redis';
  if (rawStore === '') {
    // Production must opt OUT of the shared store explicitly; there is no silent default to per-process counters.
    rateStore = production ? 'redis' : 'memory';
  } else if (rawStore === 'memory' || rawStore === 'redis') {
    rateStore = rawStore;
  } else {
    problems.push('RATE_LIMIT_STORE must be "memory" or "redis".');
    rateStore = production ? 'redis' : 'memory';
  }

  const rawPolicy = (env.RATE_LIMIT_FAILURE_POLICY ?? '').trim().toLowerCase();
  let rateFailurePolicy: 'closed' | 'degraded' = 'closed';
  if (rawPolicy === 'degraded') rateFailurePolicy = 'degraded';
  else if (rawPolicy !== '' && rawPolicy !== 'closed') problems.push('RATE_LIMIT_FAILURE_POLICY must be "closed" or "degraded".');

  const redisUrl = (env.REDIS_URL ?? '').trim() || undefined;
  if (rateStore === 'redis') {
    if (!redisUrl) problems.push('REDIS_URL is required when RATE_LIMIT_STORE=redis (the production default).');
    else if (!/^rediss?:\/\//i.test(redisUrl)) problems.push('REDIS_URL must start with redis:// or rediss://.');
    else if (production && /^redis:\/\//i.test(redisUrl) && !/^redis:\/\/([^@/]*@)?(localhost|127\.0\.0\.1|\[::1\])([:/]|$)/i.test(redisUrl)) {
      warnings.push('REDIS_URL uses unencrypted redis:// to a non-local host; prefer rediss:// (TLS).');
    }
  } else {
    if (redisUrl) warnings.push('REDIS_URL is set but RATE_LIMIT_STORE=memory; Redis will not be used.');
    if (rateFailurePolicy === 'degraded') warnings.push('RATE_LIMIT_FAILURE_POLICY=degraded has no effect with RATE_LIMIT_STORE=memory.');
    if (production) warnings.push('Production is using the per-process memory rate store: limits are not shared between instances and reset on restart.');
  }

  return {
    production,
    rateStore,
    redisUrl,
    rateFailurePolicy,
    problems,
    warnings,
    supabaseUrl: (env.SUPABASE_URL || env.VITE_SUPABASE_URL || '').trim() || undefined,
    supabaseKey:
      (env.SUPABASE_PUBLISHABLE_KEY || env.SUPABASE_ANON_KEY || env.VITE_SUPABASE_PUBLISHABLE_KEY || env.VITE_SUPABASE_ANON_KEY || '').trim() || undefined,
    requireVerifiedEmail: bool(env.AUTH_REQUIRE_VERIFIED_EMAIL),
    trustProxy,
    corsOrigins: [...origins],
    rateIpPerMin: int(env.RATE_LIMIT_IP_PER_MIN, 300),
    rateUserPerMin: int(env.RATE_LIMIT_USER_PER_MIN, 120),
    authFailMax: int(env.AUTH_FAIL_MAX, 30),
    authFailWindowMs: int(env.AUTH_FAIL_WINDOW_SEC, 900) * 1000,
    quotaOverrides,
    quotaStore: (env.QUOTA_STORE ?? 'memory').toLowerCase() === 'supabase' ? 'supabase' : 'memory'
  };
}
