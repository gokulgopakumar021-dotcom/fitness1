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

  return {
    production,
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
