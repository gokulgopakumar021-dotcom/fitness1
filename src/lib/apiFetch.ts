import { getSupabase } from './supabase';
import { announceBillingRefusal } from './billingGate';

/**
 * Authenticated fetch for Iron Log AI's own backend (`/api/*`). Every internal API call goes through this wrapper so the
 * Supabase access token is attached in one place.
 *
 * - Only same-API-origin requests get a token: a relative `/api/...` path, or an absolute URL whose origin equals the
 *   configured API origin (`VITE_API_BASE_URL`, needed when the Capacitor app talks to a remote API). Anything else is
 *   passed straight to fetch untouched, so tokens never leave for third-party domains.
 * - The session comes from Supabase (`getSession` refreshes an expired access token). With no session the request is
 *   still sent, without a token, and the server answers 401 authoritatively; the signed-out UI cannot reach these calls.
 * - On a 401 it refreshes the session once and retries once (only when the body is replayable).
 * - Request bodies, other headers, signals and the Response are passed through unchanged.
 * - A 402 `subscription_required` / 503 `billing_unavailable` from the entitlement gate is announced app-wide (see billingGate.ts).
 */
export interface ApiFetchOptions {
  /** Defaults to the global fetch, read at call time so tests can stub it. */
  fetchImpl?: typeof fetch;
}

function apiBase(): string {
  return ((import.meta.env.VITE_API_BASE_URL as string | undefined) ?? '').trim().replace(/\/+$/, '');
}

/** Resolves the request URL, or null when it is not an Iron Log AI API request (no token will be attached). */
export function resolveApiUrl(input: string): string | null {
  const base = apiBase();
  if (input.startsWith('/api/') || input === '/api') return base ? `${base}${input}` : input;
  if (base) {
    try {
      if (new URL(input).origin === new URL(base).origin && new URL(input).pathname.startsWith('/api/')) return input;
    } catch {
      /* not an absolute URL */
    }
  }
  return null;
}

async function currentAccessToken(refresh = false): Promise<string | null> {
  const supabase = getSupabase();
  if (!supabase) return null;
  try {
    if (refresh) {
      const { data, error } = await supabase.auth.refreshSession();
      return error ? null : (data.session?.access_token ?? null);
    }
    const { data } = await supabase.auth.getSession();
    return data.session?.access_token ?? null;
  } catch {
    return null;
  }
}

const replayable = (body: RequestInit['body']) => body == null || typeof body === 'string' || body instanceof URLSearchParams;

export async function apiFetch(input: string, init: RequestInit = {}, options: ApiFetchOptions = {}): Promise<Response> {
  const doFetch = options.fetchImpl ?? ((...args: Parameters<typeof fetch>) => globalThis.fetch(...args));
  const url = resolveApiUrl(input);
  if (!url) return doFetch(input, init);

  const send = async (token: string | null) => {
    const headers = new Headers(init.headers);
    if (token) headers.set('Authorization', `Bearer ${token}`);
    else headers.delete('Authorization');
    return doFetch(url, { ...init, headers });
  };

  const first = await send(await currentAccessToken());
  let result = first;
  if (first.status === 401 && replayable(init.body) && !init.signal?.aborted) {
    const refreshed = await currentAccessToken(true);
    if (refreshed) result = await send(refreshed);
  }
  // 402 subscription_required / 503 billing_unavailable from the server's entitlement gate: announce once for the whole app.
  // The Response is returned unchanged, so every caller keeps its own handling and offline fallback.
  announceBillingRefusal(url, result);
  return result;
}
