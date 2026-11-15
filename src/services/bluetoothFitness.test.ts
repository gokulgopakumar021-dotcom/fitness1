// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../lib/clientLog', () => ({ logClientError: vi.fn() }));

const dv = (...b: number[]) => new DataView(new Uint8Array(b).buffer);
type Listener = (e: any) => void;

function char(value?: DataView, opts: { failRead?: boolean } = {}) {
  const ls: Record<string, Listener[]> = {};
  return {
    value,
    readValue: async () => { if (opts.failRead) throw new Error('read failed'); return value; },
    startNotifications: async () => undefined,
    addEventListener: (t: string, l: Listener) => { (ls[t] ||= []).push(l); },
    emit: (v: DataView) => (ls['characteristicvaluechanged'] || []).forEach((l) => l({ target: { value: v } })),
  };
}
function fakeDevice(o: { hr?: boolean; battery?: DataView | 'missing'; connectError?: string } = {}) {
  const hr = char();
  const bat = char(o.battery && o.battery !== 'missing' ? o.battery : undefined);
  const ls: Record<string, Listener[]> = {};
  const gatt = {
    connected: true,
    disconnect: vi.fn(() => { gatt.connected = false; }),
    connect: async () => {
      if (o.connectError) throw Object.assign(new Error('x'), { name: o.connectError });
      return {
        getPrimaryService: async (n: string) => {
          if (n === 'heart_rate') { if (o.hr === false) throw Object.assign(new Error('no svc'), { name: 'NotFoundError' }); return { getCharacteristic: async () => hr }; }
          if (n === 'battery_service') { if (o.battery === 'missing' || o.battery === undefined) throw Object.assign(new Error('no svc'), { name: 'NotFoundError' }); return { getCharacteristic: async () => bat }; }
          throw new Error('unexpected ' + n);
        },
      };
    },
  };
  return { id: 'dev-1', name: 'Test Strap', gatt, addEventListener: (t: string, l: Listener) => { (ls[t] ||= []).push(l); }, hr, bat, drop: () => (ls['gattserverdisconnected'] || []).forEach((l) => l({})) };
}
function env(nav: Record<string, unknown>) {
  vi.stubGlobal('window', { isSecureContext: true, matchMedia: () => ({ matches: false }) });
  vi.stubGlobal('navigator', { userAgent: 'Mozilla/5.0 (Linux; Android 14) Chrome/130', platform: 'Linux armv8l', maxTouchPoints: 5, ...nav });
}
async function load() { vi.resetModules(); return (await import('./bluetoothFitness')).bluetoothFitness; }

describe('bluetoothFitness service', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

  it('unsupported browser (no Web Bluetooth): isSupported false and connect gives the honest message', async () => {
    env({});
    const s = await load();
    expect(s.isSupported()).toBe(false);
    await expect(s.requestAndConnectDevice()).rejects.toThrow(/Web Bluetooth/);
  });
  it('iPhone: explains Safari/Home Screen limitation instead of a generic failure', async () => {
    env({ userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Safari/604.1', platform: 'iPhone' });
    const s = await load();
    await expect(s.requestAndConnectDevice()).rejects.toThrow(/Home Screen/);
  });
  it('missing navigator/window (SSR) is unsupported, not a crash', async () => {
    vi.stubGlobal('navigator', undefined); vi.stubGlobal('window', undefined);
    const s = await load();
    expect(s.isSupported()).toBe(false);
  });
  it('device not found / cancelled', async () => {
    env({ bluetooth: { requestDevice: async () => { throw Object.assign(new Error('c'), { name: 'NotFoundError' }); } } });
    const s = await load();
    const errs: string[] = []; s.onError((e) => errs.push(e));
    await expect(s.requestAndConnectDevice()).rejects.toThrow(/cancelled|no compatible/i);
    expect(errs).toHaveLength(1);
  });
  it('connection failure is reported and leaves the service disconnected', async () => {
    const d = fakeDevice({ connectError: 'NetworkError' });
    env({ bluetooth: { requestDevice: async () => d } });
    const s = await load();
    await expect(s.requestAndConnectDevice()).rejects.toThrow(/Could not connect/);
    expect(!!s.isConnected()).toBe(false);
  });
  it('missing heart-rate service: clear error, GATT disconnected, never reports connected', async () => {
    const d = fakeDevice({ hr: false });
    env({ bluetooth: { requestDevice: async () => d } });
    const s = await load();
    await expect(s.requestAndConnectDevice()).rejects.toThrow(/does not expose the standard Bluetooth Heart Rate service/);
    expect(d.gatt.disconnect).toHaveBeenCalled();
  });
  it('missing battery service: connects, battery is UNKNOWN (undefined), never 95', async () => {
    const d = fakeDevice({ battery: 'missing' });
    env({ bluetooth: { requestDevice: async () => d } });
    const s = await load();
    const info = await s.requestAndConnectDevice();
    expect(info.connected).toBe(true);
    expect(info.isSimulated).toBe(false);
    expect(info.batteryLevel).toBeUndefined();
  });
  it('real battery value is reported as read; out-of-range is unknown', async () => {
    env({ bluetooth: { requestDevice: async () => fakeDevice({ battery: dv(57) }) } });
    expect((await (await load()).requestAndConnectDevice()).batteryLevel).toBe(57);
    env({ bluetooth: { requestDevice: async () => fakeDevice({ battery: dv(250) }) } });
    expect((await (await load()).requestAndConnectDevice()).batteryLevel).toBeUndefined();
  });
  it('malformed and zero heart-rate packets are dropped; valid ones are delivered', async () => {
    const d = fakeDevice({ battery: 'missing' });
    env({ bluetooth: { requestDevice: async () => d } });
    const s = await load();
    const got: number[] = []; s.onHeartRate((x) => got.push(x.bpm));
    await s.requestAndConnectDevice();
    d.hr.emit(dv()); d.hr.emit(dv(0x01, 70)); d.hr.emit(dv(0x00, 0)); d.hr.emit(dv(0x00, 66));
    expect(got).toEqual([66]);
  });
  it('device-initiated disconnect notifies listeners and clears state', async () => {
    const d = fakeDevice({ battery: 'missing' });
    env({ bluetooth: { requestDevice: async () => d } });
    const s = await load();
    const cb = vi.fn(); s.onDisconnect(cb);
    await s.requestAndConnectDevice();
    d.gatt.connected = false; d.drop();
    expect(cb).toHaveBeenCalled();
    expect(!!s.isConnected()).toBe(false);
  });
  it('simulator is labelled simulated and reports no fabricated battery', async () => {
    env({});
    const s = await load();
    const batt = vi.fn(); s.onBattery(batt);
    const info = s.startSimulation();
    vi.advanceTimersByTime(2000);
    expect(info.isSimulated).toBe(true);
    expect(info.batteryLevel).toBeUndefined();
    expect(batt).not.toHaveBeenCalled();
    s.disconnect();
  });
});
