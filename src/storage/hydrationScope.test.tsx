/**
 * IL-03: the hydration / water-unit preferences are per account.
 *
 * Drives the REAL components and storage helpers under two account scopes and checks that
 *   - account A's settings never appear for account B (and vice versa),
 *   - the unscoped (legacy) values are neither read by a signed-in account nor deleted or migrated,
 *   - account erase / Reset All Data remove the four keys for the active scope only.
 */
import 'fake-indexeddb/auto';
import React, { act } from 'react';
import { createRoot, Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HydrationPacingAlert } from '../components/nutrition/HydrationPacingAlert';
import { WaterIntakeLogger } from '../components/nutrition/WaterIntakeLogger';
import {
  DEFAULT_SMART_ALERTS_CONFIG,
  SMART_ALERTS_STORAGE_KEY,
  getStoredSmartAlertsConfig,
  saveStoredSmartAlertsConfig
} from '../components/nutrition/SmartAlertsConfigModal';
import { db, DEFAULT_PROFILE } from './db';
import { eraseAccountLocalData, resetAllAppData } from './resetAll';
import { setStorageScope } from './storageScope';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

const PACING = 'ironlog_hydration_pacing_reminders_v1';
const LAST_ALERT = 'ironlog_last_hydration_alert_ts_v1';
const SMART = SMART_ALERTS_STORAGE_KEY; // 'ironlog_smart_hydration_alerts_v1'
const UNIT = 'ironlog_water_unit';
const FOUR = [PACING, LAST_ALERT, SMART, UNIT];

const at = (base: string, scope: string) => `${base}::u:${scope}`;
const today = () => new Date().toISOString().split('T')[0];

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  localStorage.clear();
  setStorageScope(null);
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.useRealTimers();
  localStorage.clear();
  setStorageScope(null);
});

/** Mounts a fresh tree under `scope`, like AuthGate remounting the private tree when the account changes. */
async function mount(scope: string | null, node: React.ReactElement): Promise<void> {
  await act(async () => root.unmount());
  setStorageScope(scope);
  root = createRoot(container);
  await act(async () => root.render(node));
}

const logger = () => (
  <WaterIntakeLogger waterMl={0} onUpdateWater={() => {}} profile={{ ...DEFAULT_PROFILE }} selectedDate={today()} />
);
const pacing = () => (
  <HydrationPacingAlert
    currentWaterMl={0}
    goalMl={3000}
    goalOz={101}
    unit="oz"
    selectedDate={today()}
    onQuickAddWater={() => {}}
  />
);

const unitButton = (label: string): HTMLButtonElement => {
  const group = container.querySelector('[role="group"][aria-label="Display unit"]')!;
  return Array.from(group.querySelectorAll('button')).find((b) => b.textContent === label) as HTMLButtonElement;
};

async function setWakeHour(hour: number): Promise<void> {
  const gear = container.querySelector('button[title*="notification settings"]') as HTMLButtonElement;
  await act(async () => gear.click());
  const selects = Array.from(container.querySelectorAll('select')) as HTMLSelectElement[];
  const wake = selects.find((s) => Array.from(s.options).some((o) => o.text === '9:00 AM'))!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!.call(wake, String(hour));
    wake.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

describe('IL-03: water unit is per account', () => {
  it("account A's unit choice is stored under A's scope and is not shown to account B", async () => {
    await mount(A, logger());
    expect(unitButton('fl oz').getAttribute('aria-pressed')).toBe('true');
    await act(async () => unitButton('ml').click());
    expect(localStorage.getItem(at(UNIT, A))).toBe('ml');
    expect(localStorage.getItem(UNIT)).toBeNull(); // nothing written under the bare name

    await mount(B, logger());
    expect(unitButton('ml').getAttribute('aria-pressed')).toBe('false');
    expect(unitButton('fl oz').getAttribute('aria-pressed')).toBe('true');
    expect(localStorage.getItem(at(UNIT, B))).toBeNull();

    await mount(A, logger());
    expect(unitButton('ml').getAttribute('aria-pressed')).toBe('true');
  });
});

describe('IL-03: hydration pacing reminders are per account', () => {
  it("account A's wake hour is not shown to account B", async () => {
    await mount(A, pacing());
    expect(container.textContent).toContain('7:00 (Wake)');
    await setWakeHour(9);
    expect(container.textContent).toContain('9:00 (Wake)');
    expect(JSON.parse(localStorage.getItem(at(PACING, A))!).wakeHour).toBe(9);
    expect(localStorage.getItem(PACING)).toBeNull();

    await mount(B, pacing());
    expect(container.textContent).toContain('7:00 (Wake)');
    expect(container.textContent).not.toContain('9:00 (Wake)');
    expect(localStorage.getItem(at(PACING, B))).toBeNull();

    await mount(A, pacing());
    expect(container.textContent).toContain('9:00 (Wake)');
  });

  it('the "last alert" timestamp is written under the active scope, never the bare name', async () => {
    // 14:00 local, outside the default 22:00-07:00 quiet hours and inside wake hours; 0 ml logged => behind pace.
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] });
    vi.setSystemTime(new Date(2026, 10, 3, 14, 0, 0));
    // The background checker only runs when reminders are switched on (default: off), so seed A's own setting.
    localStorage.setItem(at(PACING, A), JSON.stringify({ enabled: true }));
    await mount(A, pacing());
    await act(async () => { vi.advanceTimersByTime(5 * 60 * 1000 + 1000); });
    expect(localStorage.getItem(at(LAST_ALERT, A))).not.toBeNull();
    expect(localStorage.getItem(LAST_ALERT)).toBeNull();
    expect(localStorage.getItem(at(LAST_ALERT, B))).toBeNull();
  });
});

describe('IL-03: smart hydration alert config is per account', () => {
  it("account A's config is invisible to account B", () => {
    setStorageScope(A);
    saveStoredSmartAlertsConfig({ ...DEFAULT_SMART_ALERTS_CONFIG, activityLevel: 'heavy', quietHoursStart: '23:30' });
    expect(localStorage.getItem(SMART)).toBeNull();
    expect(getStoredSmartAlertsConfig().activityLevel).toBe('heavy');

    setStorageScope(B);
    expect(getStoredSmartAlertsConfig()).toEqual(DEFAULT_SMART_ALERTS_CONFIG);
    setStorageScope(A);
    expect(getStoredSmartAlertsConfig().quietHoursStart).toBe('23:30');
  });
});

describe('IL-03: existing unscoped (legacy) values are left alone, not read, not migrated, not deleted', () => {
  it('a signed-in account does not inherit them and does not delete them', async () => {
    localStorage.setItem(UNIT, 'ml');
    localStorage.setItem(PACING, JSON.stringify({ wakeHour: 9 }));
    localStorage.setItem(LAST_ALERT, '123');
    localStorage.setItem(SMART, JSON.stringify({ ...DEFAULT_SMART_ALERTS_CONFIG, activityLevel: 'heavy' }));

    await mount(A, logger());
    expect(unitButton('fl oz').getAttribute('aria-pressed')).toBe('true'); // legacy 'ml' ignored
    await mount(A, pacing());
    expect(container.textContent).toContain('7:00 (Wake)');
    setStorageScope(A);
    expect(getStoredSmartAlertsConfig()).toEqual(DEFAULT_SMART_ALERTS_CONFIG);

    expect(localStorage.getItem(UNIT)).toBe('ml'); // untouched
    expect(localStorage.getItem(LAST_ALERT)).toBe('123');
    expect(JSON.parse(localStorage.getItem(PACING)!).wakeHour).toBe(9);
    expect(FOUR.every((k) => localStorage.getItem(at(k, A)) === null)).toBe(true); // nothing copied across
  });
});

describe('IL-03: erase and reset remove the four keys for the active scope only', () => {
  const seed = (scope: string | null) => {
    const k = (base: string) => (scope ? at(base, scope) : base);
    localStorage.setItem(k(UNIT), 'ml');
    localStorage.setItem(k(PACING), JSON.stringify({ wakeHour: 9 }));
    localStorage.setItem(k(LAST_ALERT), '123');
    localStorage.setItem(k(SMART), JSON.stringify(DEFAULT_SMART_ALERTS_CONFIG));
  };
  const present = (scope: string | null) =>
    FOUR.filter((base) => localStorage.getItem(scope ? at(base, scope) : base) !== null);

  it('eraseAccountLocalData (account delete) clears A, keeps B and legacy', async () => {
    seed(null); seed(A); seed(B);
    setStorageScope(A);
    await eraseAccountLocalData();
    expect(present(A)).toEqual([]);
    expect(present(B)).toEqual(FOUR);
    expect(present(null)).toEqual(FOUR);
  });

  it('Reset All Data clears A, keeps B and legacy', async () => {
    seed(null); seed(A); seed(B);
    setStorageScope(A);
    await resetAllAppData();
    expect(present(A)).toEqual([]);
    expect(present(B)).toEqual(FOUR);
    expect(present(null)).toEqual(FOUR);
  });

  it('with no account signed in, Reset All Data clears the legacy values (previous behaviour kept)', async () => {
    seed(null); seed(A);
    setStorageScope(null);
    await resetAllAppData();
    expect(present(null)).toEqual([]);
    expect(present(A)).toEqual(FOUR);
    expect(db.getProfile()).toBeTruthy();
  });
});
