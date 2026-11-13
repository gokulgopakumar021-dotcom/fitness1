import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { createClient } from '@supabase/supabase-js';
import { getAccessToken } from './auth';
import { resolvePolicy } from './endpoints';
import { sendError } from './errors';
import { logger } from './logger';
import type { SecurityConfig } from './config';

/**
 * Server-side 18+ eligibility gate (Stage 2D / Stage 2).
 *
 * The decision comes ONLY from the database (public.get_my_age_eligibility(), which reads the caller's own row in
 * public.age_declarations). Nothing the browser sends is consulted: not localStorage, sessionStorage, the profile age,
 * a header, a query string or the request body. The lookup uses the caller's OWN verified access token with the
 * publishable key (the same pattern as the daily AI quota), so no service-role key is involved.
 *
 * A declaration is a SELF-DECLARATION. It is not verified identity or verified age.
 *
 *   off    : nothing is checked and no database call is made (default, so deploying this code before the migration is applied
 *            cannot lock anyone out; the production value must be set explicitly, see docs/legal/AGE_ELIGIBILITY_DESIGN.md)
 *   shadow : looks up and logs would-be denials, blocks nothing, never fails a request
 *   on     : 403 age_confirmation_required when there is no declaration; 503 age_eligibility_unavailable (fail CLOSED) when it
 *            cannot be determined
 *
 * Runs after authentication, per-user and per-endpoint rate limits, and BEFORE the body is parsed, so a refused request costs
 * no parsing, no Gemini call, no billing call and no AI quota. /api/health is never gated. Routes flagged `ageExempt`
 * (account deletion and subscription cancellation) stay reachable so an age-unknown user can always leave and stop paying.
 */
export type AgeEnforcementMode = 'off' | 'shadow' | 'on';

export function loadAgeEnforcement(env: Record<string, string | undefined> = process.env): { mode: AgeEnforcementMode; invalid: boolean } {
  const raw = (env.AGE_ENFORCEMENT ?? '').trim().toLowerCase();
  if (raw === '' || raw === 'off') return { mode: 'off', invalid: false };
  if (raw === 'shadow' || raw === 'on') return { mode: raw, invalid: false };
  // A typo must never lock every user out, so an unrecognised value leaves the gate OFF. It is reported loudly by createAgeGate.
  return { mode: 'off', invalid: true };
}

export class AgeStoreUnavailableError extends Error {
  constructor(public readonly reason: string) {
    super(`age eligibility store unavailable: ${reason}`);
    this.name = 'AgeStoreUnavailableError';
  }
}

export interface AgeStore {
  /** true only when the database says this user has a declaration. Throws AgeStoreUnavailableError if it cannot tell. */
  isDeclaredAdult(userId: string, accessToken: string | undefined): Promise<boolean>;
}

export class SupabaseAgeStore implements AgeStore {
  private readonly timeoutMs: number;
  constructor(private readonly cfg: Pick<SecurityConfig, 'supabaseUrl' | 'supabaseKey'>, opts: { timeoutMs?: number } = {}) {
    this.timeoutMs = opts.timeoutMs ?? 3_000;
  }
  async isDeclaredAdult(_userId: string, accessToken: string | undefined): Promise<boolean> {
    if (!this.cfg.supabaseUrl || !this.cfg.supabaseKey) throw new AgeStoreUnavailableError('not_configured');
    if (!accessToken) throw new AgeStoreUnavailableError('no_token');
    let data: unknown;
    try {
      const client = createClient(this.cfg.supabaseUrl, this.cfg.supabaseKey, {
        auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
        global: { headers: { Authorization: `Bearer ${accessToken}` } }
      });
      const res = await client.rpc('get_my_age_eligibility').abortSignal(AbortSignal.timeout(this.timeoutMs));
      if (res.error) {
        const name = (res.error as { name?: string }).name ?? '';
        if (name === 'AbortError' || name === 'TimeoutError' || /abort/i.test(res.error.message ?? '')) throw new AgeStoreUnavailableError('timeout');
        const code = String(res.error.code ?? '');
        throw new AgeStoreUnavailableError(/^[A-Za-z0-9_]{1,12}$/.test(code) ? `rpc_${code}` : 'rpc_error');
      }
      data = res.data;
    } catch (err) {
      if (err instanceof AgeStoreUnavailableError) throw err;
      const name = (err as { name?: string } | null)?.name ?? '';
      throw new AgeStoreUnavailableError(name === 'AbortError' || name === 'TimeoutError' ? 'timeout' : 'transport');
    }
    // Strict: anything other than the two documented answers is "cannot tell", never "eligible".
    if (data === 'declared') return true;
    if (data === 'unknown') return false;
    throw new AgeStoreUnavailableError('bad_shape');
  }
}

/** Only POSITIVE answers are cached, briefly. A negative answer is always re-checked so a fresh declaration takes effect at once. */
export class PositiveAgeCache {
  private readonly hits = new Map<string, number>();
  constructor(private readonly ttlMs: number, private readonly maxEntries: number, private readonly now: () => number) {}
  has(userId: string): boolean {
    const exp = this.hits.get(userId);
    if (exp === undefined) return false;
    if (exp <= this.now()) {
      this.hits.delete(userId);
      return false;
    }
    return true;
  }
  add(userId: string): void {
    if (this.hits.size >= this.maxEntries) {
      const oldest = this.hits.keys().next().value;
      if (oldest !== undefined) this.hits.delete(oldest);
    }
    this.hits.set(userId, this.now() + this.ttlMs);
  }
}

export interface AgeGateOptions {
  mode: AgeEnforcementMode;
  store: AgeStore;
  now?: () => number;
  cacheTtlMs?: number;
}

export function createAgeGate(opts: AgeGateOptions): RequestHandler {
  const now = opts.now ?? Date.now;
  const cache = new PositiveAgeCache(opts.cacheTtlMs ?? 5 * 60_000, 5_000, now);
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (opts.mode === 'off') return next();
      const policy = resolvePolicy(req.method, req.path);
      // Health (no policy) and exempt routes pass. A missing user cannot happen after auth, and is left to the other layers.
      if (!policy || policy.ageExempt || !req.user) return next();
      const userId = req.user.id;
      if (cache.has(userId)) return next();

      let declared: boolean | undefined;
      try {
        declared = await opts.store.isDeclaredAdult(userId, getAccessToken(req));
      } catch (err) {
        logger.error('age_eligibility_check_failed', {
          requestId: req.requestId,
          bucket: policy.bucket,
          reason: err instanceof AgeStoreUnavailableError ? err.reason : 'unexpected'
        });
        declared = undefined;
      }

      if (opts.mode === 'shadow') {
        if (declared === undefined) logger.warn('age_shadow_unavailable', { requestId: req.requestId, bucket: policy.bucket });
        else if (!declared) logger.warn('age_shadow_would_deny', { requestId: req.requestId, userId, bucket: policy.bucket });
        else cache.add(userId);
        return next();
      }

      if (declared === undefined) {
        return sendError(req, res, 503, 'age_eligibility_unavailable', 'Your eligibility could not be checked. Please try again shortly.', { 'Retry-After': '5' });
      }
      if (!declared) {
        return sendError(req, res, 403, 'age_confirmation_required', 'Please confirm that you are 18 years of age or older to continue.');
      }
      cache.add(userId);
      next();
    } catch (err) {
      next(err);
    }
  };
}
