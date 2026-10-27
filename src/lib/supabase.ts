import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/**
 * Supabase browser client.
 *
 * Only the project URL and a *publishable* (or legacy `anon`) key belong here — both are designed to ship in
 * frontend code. Never put a secret / service_role key or the database password in any VITE_* variable:
 * Vite inlines them into the public bundle.
 */
const url = (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.trim();
const key = (
  (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined) ||
  (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined) // legacy name, kept for compatibility
)?.trim();

/** Rejects anything that looks like a secret/service-role key so a mistake fails loudly instead of leaking. */
export function looksLikeSecretKey(value: string): boolean {
  if (value.startsWith('sb_secret_')) return true;
  const parts = value.split('.');
  if (parts.length !== 3) return false;
  try {
    const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));
    return payload?.role === 'service_role';
  } catch {
    return false;
  }
}

export type SupabaseConfigStatus =
  | { ok: true }
  | { ok: false; reason: 'missing' | 'secret_key' | 'bad_url'; message: string };

export function getSupabaseConfigStatus(): SupabaseConfigStatus {
  if (!url || !key) {
    return {
      ok: false,
      reason: 'missing',
      message: 'Supabase is not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY (see .env.example), then restart the dev server.'
    };
  }
  try {
    const u = new URL(url);
    if (u.protocol !== 'https:' && u.hostname !== 'localhost' && u.hostname !== '127.0.0.1') throw new Error('protocol');
  } catch {
    return { ok: false, reason: 'bad_url', message: 'VITE_SUPABASE_URL is not a valid https URL.' };
  }
  if (looksLikeSecretKey(key)) {
    return {
      ok: false,
      reason: 'secret_key',
      message: 'The configured Supabase key is a secret/service-role key. Use the publishable key instead — secret keys must never be used in the browser.'
    };
  }
  return { ok: true };
}

let client: SupabaseClient | null = null;

/** Lazily created singleton; null when configuration is missing/invalid (the UI shows a setup screen). */
export function getSupabase(): SupabaseClient | null {
  if (client) return client;
  if (!getSupabaseConfigStatus().ok) return null;
  client = createClient(url!, key!, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true, // handles the email-verification / password-recovery callback
      flowType: 'pkce'
    }
  });
  return client;
}

/**
 * Where Supabase email links send the user back to. Set VITE_SITE_URL to the deployed origin in production;
 * it falls back to the current origin. The value must also be in the Supabase "Redirect URLs" allow-list.
 */
export function getAuthRedirectUrl(): string {
  const configured = (import.meta.env.VITE_SITE_URL as string | undefined)?.trim();
  const base = configured || (typeof window !== 'undefined' ? window.location.origin : '');
  return base.replace(/\/+$/, '') + '/';
}
