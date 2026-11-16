import { getSupabase } from '../lib/supabase';

export interface SavedDevice { id: string; deviceKey: string; displayName: string | null; manufacturer: string; model: string | null; method: string; lastSeenAt: string | null }

/** Reads the signed-in account's remembered devices (row level security limits this to the caller's own rows). */
export async function listSavedDevices(): Promise<{ ok: true; devices: SavedDevice[] } | { ok: false }> {
  const sb = getSupabase();
  if (!sb) return { ok: false };
  try {
    const { data, error } = await sb.from('wearable_devices').select('id,device_key,display_name,manufacturer,model,ingestion_method,last_seen_at').order('last_seen_at', { ascending: false, nullsFirst: false });
    if (error || !data) return { ok: false };
    return { ok: true, devices: data.map((d) => ({ id: d.id as string, deviceKey: d.device_key as string, displayName: (d.display_name as string | null) ?? null, manufacturer: d.manufacturer as string, model: (d.model as string | null) ?? null, method: d.ingestion_method as string, lastSeenAt: (d.last_seen_at as string | null) ?? null })) };
  } catch { return { ok: false }; }
}

/** Deletes the device AND every reading saved from it (the database cascades). Disconnecting does not do this. */
export async function removeSavedDevice(id: string): Promise<boolean> {
  const sb = getSupabase();
  if (!sb) return false;
  try { const { error } = await sb.from('wearable_devices').delete().eq('id', id); return !error; } catch { return false; }
}
