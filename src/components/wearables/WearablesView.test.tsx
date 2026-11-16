import React, { act } from 'react';
import { createRoot, Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const h = vi.hoisted(() => ({
  bt: { isConnected: false, isSimulated: false, isConnecting: false, isSupported: true, device: null as null | { id: string; name: string; isSimulated?: boolean }, liveHeartRate: null as number | null, error: null as string | null, connectRealDevice: vi.fn(), disconnect: vi.fn() },
  env: { hasWebBluetooth: false, userAgent: 'Mozilla/5.0 (Macintosh)', isSecureContext: true } as Record<string, unknown>,
  server: { categories: [] as string[], stale: false, down: false, calls: [] as { method: string; body?: unknown }[], events: [] as { category: string; action: string; version: number; at: string }[] },
  saved: [] as Record<string, unknown>[],
  deleted: [] as string[],
  deleteFails: false
}));
vi.mock('../../context/BluetoothGadgetContext', () => ({ useBluetoothGadget: () => h.bt }));
vi.mock('../../wearables/capabilities', async (orig) => ({ ...(await orig<typeof import('../../wearables/capabilities')>()), readCapabilityEnv: () => h.env }));
vi.mock('../../lib/supabase', () => ({
  getSupabase: () => ({
    from: () => ({
      select: () => ({ order: async () => ({ data: h.saved, error: null }) }),
      delete: () => ({ eq: async (_c: string, id: string) => { if (h.deleteFails) return { error: { message: 'x' } }; h.deleted.push(id); return { error: null }; } })
    })
  })
}));
vi.mock('../../lib/apiFetch', () => ({
  apiFetch: vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    h.server.calls.push({ method, body });
    if (h.server.down) return new Response('{}', { status: 503 });
    if (url === '/api/wearables/ingest') return new Response(JSON.stringify({ success: true, summary: { received: 1, accepted: 1, duplicate: 0, rejected: 0, unsupported: 0, invalid: 0 }, syncedAt: '2026-11-16T10:00:00.000Z' }), { status: 200 });
    if (url === '/api/wearables/consent-history') return new Response(JSON.stringify({ success: true, events: [...h.server.events].reverse(), truncated: false }), { status: 200 });
    if (method === 'PUT') {
      const prev = h.server.categories; const next = body.categories as string[];
      for (const c of next) if (!prev.includes(c)) h.server.events.push({ category: c, action: 'granted', version: 1, at: `2026-11-16T10:0${h.server.events.length}:00.000Z` });
      for (const c of prev) if (!next.includes(c)) h.server.events.push({ category: c, action: 'revoked', version: 1, at: `2026-11-16T10:0${h.server.events.length}:00.000Z` });
      h.server.categories = next;
    }
    return new Response(JSON.stringify({ success: true, categories: h.server.categories, stale: h.server.stale }), { status: 200 });
  })
}));

import { WearablesView } from './WearablesView';
import { WearableSyncController } from './WearableSyncController';
import { publishSyncStatus, resetSyncStatus } from '../../wearables/syncStore';
import { revokeWearableAiConsent } from '../../wearables/consent';

let container: HTMLDivElement;
let root: Root;
const text = () => container.textContent ?? '';
const sw = (name: RegExp) => [...container.querySelectorAll<HTMLButtonElement>('[role="switch"]')].find((b) => name.test(b.getAttribute('aria-label') ?? ''))!;
const click = async (el: Element) => { await act(async () => { el.dispatchEvent(new MouseEvent('click', { bubbles: true })); }); };
const btn = (re: RegExp, scope: ParentNode = document) => [...scope.querySelectorAll('button')].find((b) => re.test(b.textContent ?? '') || re.test(b.getAttribute('aria-label') ?? ''))!;
const render = async () => { await act(async () => root.render(<WearablesView />)); await act(async () => {}); };

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  Object.assign(h.bt, { isConnected: false, isSimulated: false, isConnecting: false, device: null, liveHeartRate: null, error: null });
  h.bt.connectRealDevice.mockReset(); h.bt.disconnect.mockReset();
  h.env = { hasWebBluetooth: false, userAgent: 'Mozilla/5.0 (Macintosh)', isSecureContext: true };
  Object.assign(h.server, { categories: [], stale: false, down: false, calls: [], events: [] });
  h.saved = []; h.deleted = []; h.deleteFails = false;
  resetSyncStatus(); revokeWearableAiConsent(); localStorage.clear();
});
afterEach(() => { act(() => root.unmount()); container.remove(); document.body.innerHTML = ''; });

describe('Wearables dashboard', () => {
  it('shows a polished empty state that promises no brand, and honest routes', async () => {
    await render();
    expect(text()).toContain('No wearable connected');
    expect(text()).toMatch(/no brand is guaranteed/i);
    expect(text()).toContain('Direct Bluetooth');
    expect(text()).toMatch(/Official manufacturer cloud API[\s\S]*Not configured/);
    expect(text()).toMatch(/Third-party aggregator[\s\S]*separate approval/);
    expect(text()).toMatch(/Manual data import[\s\S]*Not implemented/);
    expect(text()).not.toMatch(/verified compatible|works with every/i);
  });
  it('unsupported browser: no working connect button and an honest explanation', async () => {
    await render();
    expect(text()).toContain('Unavailable here');
    expect(btn(/Choose a heart-rate device/)).toBeUndefined();
  });
  it('iPhone: says Web Bluetooth is not available and that installing the PWA does not change it', async () => {
    h.env = { hasWebBluetooth: false, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Safari', platform: 'iPhone', maxTouchPoints: 5, isSecureContext: true };
    await render();
    expect(text()).toMatch(/do not support Web Bluetooth/);
    expect(text()).toMatch(/Home Screen does not change that/);
    expect(btn(/Choose a heart-rate device/)).toBeUndefined();
  });
  it('supported browser: offers the real connect action and states the limits', async () => {
    h.env = { hasWebBluetooth: true, userAgent: 'Mozilla/5.0 (Linux; Android 14) Chrome/130', platform: 'Linux armv81', maxTouchPoints: 5, isSecureContext: true };
    await render();
    await click(btn(/Choose a heart-rate device/));
    expect(h.bt.connectRealDevice).toHaveBeenCalledTimes(1);
    expect(text()).toMatch(/standard Bluetooth Heart Rate service/);
    expect(text()).toMatch(/No specific device has been verified/);
  });
  it('real connected device: labelled real, unverified, never "verified", and asks for permission before saving', async () => {
    Object.assign(h.bt, { isConnected: true, device: { id: 'k1', name: 'Polar H10' } });
    await render();
    expect(text()).toContain('Polar H10');
    expect(text()).toContain('Real hardware');
    expect(text()).toContain('Permission required');
    await click(btn(/Details for Polar H10/));
    expect(text()).toMatch(/Unverified/);
    expect(text()).toMatch(/No device has a hardware test record/);
    expect(text()).not.toMatch(/\bVerified\b(?! )/);
  });
  it('simulated device is clearly marked and never saved', async () => {
    Object.assign(h.bt, { isConnected: true, isSimulated: true, device: { id: 'sim', name: 'Demo Strap', isSimulated: true } });
    await render();
    expect(text()).toContain('Simulated demo');
    expect(text()).toContain('Never (demo data is not saved)');
    expect(text()).not.toContain('Real hardware');
  });
  it.each([
    ['syncing', 'Syncing'], ['failed', 'Sync failed'], ['provider_unavailable', 'Sync failed'], ['auth_expired', 'Sign-in expired'], ['synced', 'Connected']
  ])('sync state %s shows "%s" on a connected device with saving allowed', async (state, label) => {
    h.server.categories = ['workout_health_sync'];
    Object.assign(h.bt, { isConnected: true, device: { id: 'k1', name: 'Polar H10' } });
    await render();
    await act(async () => publishSyncStatus({ state: state as never, lastSuccessAt: state === 'synced' ? '2026-11-16T10:00:00.000Z' : null, lastAttemptAt: null, pending: 2, summary: null }));
    const badges = [...container.querySelectorAll('li span')].map((s) => s.textContent);
    expect(badges).toContain(label);
    if (state === 'syncing') expect(text()).toMatch(/Synchronizing/);
    if (state === 'failed') expect(text()).toMatch(/failed\. Unsent readings are kept/);
    if (state === 'synced') expect(text()).toMatch(/Last confirmed by the server/);
  });
  it('a remembered device is shown as disconnected; removing needs confirmation and is not the same as disconnecting', async () => {
    h.saved = [{ id: 'dev-9', device_key: 'k9', display_name: 'Old Strap', manufacturer: 'Polar', model: 'H10', ingestion_method: 'direct_ble', last_seen_at: '2026-11-10T10:00:00.000Z' }];
    h.env = { hasWebBluetooth: true, userAgent: 'Chrome', isSecureContext: true };
    await render();
    expect(text()).toContain('Old Strap');
    expect(text()).toContain('Disconnected');
    expect(text()).toMatch(/Removing deletes this device and all readings saved from it/);
    await click(btn(/Remove device and saved readings/));
    expect(h.deleted).toEqual([]);
    expect(document.body.textContent).toMatch(/permanently deletes/);
    await click(btn(/Delete device and readings/));
    expect(h.deleted).toEqual(['dev-9']);
  });
  it('a failed removal says nothing was deleted', async () => {
    h.saved = [{ id: 'dev-9', device_key: 'k9', display_name: 'Old Strap', manufacturer: 'Polar', model: null, ingestion_method: 'direct_ble', last_seen_at: null }];
    h.deleteFails = true;
    await render();
    await click(btn(/Remove device and saved readings/));
    await click(btn(/Delete device and readings/));
    expect(document.body.textContent).toMatch(/Nothing was deleted/);
  });
  it('disconnect only stops the connection', async () => {
    Object.assign(h.bt, { isConnected: true, device: { id: 'k1', name: 'Polar H10' } });
    await render();
    expect(text()).toMatch(/does not delete anything already saved/);
    await click(btn(/^Disconnect/));
    expect(h.bt.disconnect).toHaveBeenCalledTimes(1);
    expect(h.deleted).toEqual([]);
  });
});

describe('Consent management UI', () => {
  it('everything is OFF by default, nothing is pre-checked, and categories nothing reads yet cannot be switched on', async () => {
    await render();
    const switches = [...container.querySelectorAll<HTMLButtonElement>('[role="switch"]')];
    expect(switches).toHaveLength(5);
    expect(switches.every((s) => s.getAttribute('aria-checked') === 'false')).toBe(true);
    expect(sw(/heart-rate history/i).disabled).toBe(false);
    expect(sw(/recovery metrics/i).disabled).toBe(true);
    expect(sw(/activity metrics/i).disabled).toBe(true);
    expect(sw(/live heart rate/i).disabled).toBe(false);
  });
  it('connecting a device never grants consent', async () => {
    Object.assign(h.bt, { isConnected: true, device: { id: 'k1', name: 'Polar H10' } });
    await render();
    expect(h.server.calls.filter((c) => c.method === 'PUT')).toHaveLength(0);
    expect(sw(/live heart rate/i).getAttribute('aria-checked')).toBe('false');
  });
  it('explains what, why, how, external AI provider and revocation BEFORE granting; cancel changes nothing', async () => {
    await render();
    await click(sw(/live heart rate/i));
    const d = document.body.textContent ?? '';
    for (const s of ['What is shared', 'Why it is needed', 'How it is used', 'Sent to an external AI provider?', 'How to turn it off']) expect(d).toContain(s);
    expect(d).toMatch(/Google Gemini/);
    expect(d).toMatch(/has not yet verified how that provider retains or uses/);
    expect(d).not.toMatch(/never (stored|retained)|deleted immediately|not used for training/i);
    expect(h.server.calls.filter((c) => c.method === 'PUT')).toHaveLength(0);
    await click(btn(/^Cancel$/));
    expect(h.server.calls.filter((c) => c.method === 'PUT')).toHaveLength(0);
    expect(sw(/live heart rate/i).getAttribute('aria-checked')).toBe('false');
  });
  it('grants per category through the server and only then shows it on', async () => {
    await render();
    await click(sw(/live heart rate/i));
    await click(btn(/^Turn on$/));
    expect(h.server.calls.filter((c) => c.method === 'PUT').map((c) => c.body)).toEqual([{ categories: ['live_heart_rate'] }]);
    expect(sw(/live heart rate/i).getAttribute('aria-checked')).toBe('true');
    expect(sw(/Save workout heart-rate/i).getAttribute('aria-checked')).toBe('false');
  });
  it('heart-rate history: explains what, why, how, the external AI provider and revocation BEFORE granting; says the client sends nothing and Gemini terms are unverified', async () => {
    await render();
    await click(sw(/heart-rate history/i));
    const d = document.body.textContent ?? '';
    for (const s of ['What is shared', 'Why it is needed', 'How it is used', 'Sent to an external AI provider?', 'How to turn it off']) expect(d).toContain(s);
    expect(d).toMatch(/5 most recent workouts in the last 30 days/);
    expect(d).toMatch(/Not the individual readings/);
    expect(d).toMatch(/Google Gemini/);
    expect(d).toMatch(/has not yet verified how that provider retains or uses/);
    expect(d).toMatch(/very next message: Coach Iron receives no heart-rate history/);
    expect(d).not.toMatch(/never (stored|retained)|deleted immediately|not used for training/i);
    expect(h.server.calls.filter((c) => c.method === 'PUT')).toHaveLength(0);
    await click(btn(/^Cancel$/));
    expect(sw(/heart-rate history/i).getAttribute('aria-checked')).toBe('false');
  });
  it('heart-rate history is granted alone (it does not turn on live sharing or saving) and revoked alone', async () => {
    await render();
    await click(sw(/heart-rate history/i));
    await click(btn(/^Turn on$/));
    expect(h.server.calls.filter((c) => c.method === 'PUT').map((c) => c.body)).toEqual([{ categories: ['historical_heart_rate'] }]);
    expect(sw(/heart-rate history/i).getAttribute('aria-checked')).toBe('true');
    expect(sw(/live heart rate/i).getAttribute('aria-checked')).toBe('false');
    expect(sw(/Save workout heart-rate/i).getAttribute('aria-checked')).toBe('false');
    await click(sw(/heart-rate history/i));
    expect(h.server.calls.filter((c) => c.method === 'PUT').at(-1)?.body).toEqual({ categories: [] });
    expect(sw(/heart-rate history/i).getAttribute('aria-checked')).toBe('false');
    expect(text()).toMatch(/Coach Iron receives no heart-rate history/);
  });
  it('workout saving is a separate switch and says it is not shared with Coach Iron', async () => {
    await render();
    await click(sw(/Save workout heart-rate/i));
    expect(document.body.textContent).toMatch(/Stored in your Iron Log account only/);
    await click(btn(/^Turn on$/));
    expect(h.server.categories).toEqual(['workout_health_sync']);
  });
  it('revocation saves an updated set, explains the effect and shows OFF', async () => {
    h.server.categories = ['live_heart_rate', 'workout_health_sync'];
    await render();
    expect(sw(/live heart rate/i).getAttribute('aria-checked')).toBe('true');
    await click(sw(/live heart rate/i));
    expect(h.server.calls.filter((c) => c.method === 'PUT').map((c) => c.body)).toEqual([{ categories: ['workout_health_sync'] }]);
    expect(sw(/live heart rate/i).getAttribute('aria-checked')).toBe('false');
    expect(sw(/Save workout heart-rate/i).getAttribute('aria-checked')).toBe('true');
    expect(text()).toMatch(/very next message/);
  });
  it('does not change anything when the server cannot be reached', async () => {
    await render();
    await click(sw(/live heart rate/i));
    h.server.down = true;
    await click(btn(/^Turn on$/));
    expect(sw(/live heart rate/i).getAttribute('aria-checked')).toBe('false');
    expect(document.body.textContent).toMatch(/nothing was changed/);
  });
  it('when consent cannot be verified, the switches are disabled and it says sharing is treated as off', async () => {
    h.server.down = true;
    await render();
    expect(text()).toMatch(/could not be verified right now/);
    expect(sw(/live heart rate/i).disabled).toBe(true);
  });
  it('tells the user when an older consent no longer applies', async () => {
    h.server.stale = true;
    await render();
    expect(text()).toMatch(/older version of this consent and no longer apply/);
    expect(sw(/live heart rate/i).getAttribute('aria-checked')).toBe('false');
  });
});

describe('Consent history on the dashboard', () => {
  it('is on the dashboard, loads nothing until opened, and the server is the only source of what it shows', async () => {
    await render();
    expect(text()).toContain('Consent history');
    expect(h.server.calls.some((c) => c.method === 'POST' && c.body !== undefined)).toBe(false);
    await click(btn(/Show history/));
    expect(text()).toMatch(/No changes yet/);
  });
  it('shows a grant and then a revoke made through the consent switches, newest first, and keeps the grant after revoking', async () => {
    await render();
    await click(btn(/Show history/));
    await click(sw(/Save workout heart-rate readings/));
    await click(btn(/Turn on/));
    let items = [...container.querySelectorAll('#wearable-consent-history li')].map((li) => li.textContent ?? '');
    expect(items).toHaveLength(1);
    expect(items[0]).toContain('Saving workout heart rate');
    expect(items[0]).toContain('Turned on');
    await click(sw(/Save workout heart-rate readings/));
    items = [...container.querySelectorAll('#wearable-consent-history li')].map((li) => li.textContent ?? '');
    expect(items).toHaveLength(2);
    expect(items[0]).toContain('Turned off');
    expect(items[1]).toContain('Turned on');
  });
  it('says so plainly when the server cannot answer, and shows no events', async () => {
    h.server.down = true;
    await render();
    await click(btn(/Show history/));
    expect(text()).toMatch(/temporarily unavailable/);
    expect(container.querySelectorAll('#wearable-consent-history li')).toHaveLength(0);
  });
});

describe('WearableSyncController', () => {
  const run = async (consent: string[]) => {
    h.server.categories = consent;
    await act(async () => root.render(<WearableSyncController activeSessionId="sess-1" />));
    await act(async () => {});
    await act(async () => { Object.assign(h.bt, { liveHeartRate: 141 }); root.render(<WearableSyncController activeSessionId="sess-1" />); });
    await act(async () => root.unmount());
    root = createRoot(container);
  };
  const ingests = () => h.server.calls.filter((c) => c.method === 'POST');
  it('never records or sends simulated readings, even with consent', async () => {
    Object.assign(h.bt, { isConnected: true, isSimulated: true, device: { id: 'sim', name: 'Demo', isSimulated: true } });
    await run(['workout_health_sync']);
    expect(ingests()).toHaveLength(0);
  });
  it('records nothing without workout_health_sync consent', async () => {
    Object.assign(h.bt, { isConnected: true, device: { id: 'k1', name: 'Polar H10' } });
    await run(['live_heart_rate']);
    expect(ingests()).toHaveLength(0);
  });
  it('sends real readings for the active workout once consent is confirmed by the server', async () => {
    Object.assign(h.bt, { isConnected: true, device: { id: 'k1', name: 'Polar H10' } });
    await run(['workout_health_sync']);
    expect(ingests()).toHaveLength(1);
    expect(ingests()[0].body).toMatchObject({ workoutSessionId: 'sess-1', samples: [{ metric: 'heart_rate', value: 141, origin: 'live' }] });
  });
  it('does nothing with no active workout', async () => {
    Object.assign(h.bt, { isConnected: true, device: { id: 'k1', name: 'Polar H10' } });
    h.server.categories = ['workout_health_sync'];
    await act(async () => root.render(<WearableSyncController activeSessionId={null} />));
    await act(async () => { Object.assign(h.bt, { liveHeartRate: 141 }); root.render(<WearableSyncController activeSessionId={null} />); });
    await act(async () => root.unmount());
    root = createRoot(container);
    expect(ingests()).toHaveLength(0);
  });
});
