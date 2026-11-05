import React, { act } from 'react';
import { createRoot, Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
import { db } from '../../storage/db';
import { getClaimState } from '../../storage/legacyData';
import { setStorageScope } from '../../storage/storageScope';
import { LegacyDataClaim } from './LegacyDataClaim';

const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
let container: HTMLDivElement;
let root: Root;
const render = async (el: React.ReactElement) => { await act(async () => root.render(el)); };
const text = () => document.body.textContent ?? '';
const click = async (label: string) => {
  const b = [...document.body.querySelectorAll('button')].find((x) => x.textContent?.trim() === label);
  if (!b) throw new Error(`no button "${label}"`);
  await act(async () => { b.click(); });
};
beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  localStorage.clear();
  setStorageScope(A);
  localStorage.setItem('ironlog_plans_v1', JSON.stringify([{ id: 'lp1', name: 'Old plan', trainingSplit: 'x', createdAt: '2026-09-01T00:00:00.000Z', updatedAt: '2026-09-01T00:00:00.000Z', isActive: false, days: [] }]));
  localStorage.setItem('ironlog_sessions_v1', JSON.stringify([
    { id: 'ls1', dayName: 'D', date: '2026-09-02', startTime: '2026-09-02T08:00:00.000Z', status: 'completed', exercises: [] },
    { id: 'ls2', dayName: 'D', date: '2026-09-03', startTime: '2026-09-03T08:00:00.000Z', status: 'completed', exercises: [] }
  ]));
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); });

describe('LegacyDataClaim prompt', () => {
  it('shows how many plans and workouts will be imported BEFORE anything happens, and imports nothing on its own', async () => {
    await render(<LegacyDataClaim open onClose={() => {}} />);
    expect(text()).toMatch(/1 workout plan/);
    expect(text()).toMatch(/2 logged workouts/);
    expect(db.getSessions()).toEqual([]);
  });
  it('"Import into my account" imports, confirms, and calls onClaimed', async () => {
    const onClaimed = vi.fn();
    await render(<LegacyDataClaim open onClose={() => {}} onClaimed={onClaimed} />);
    await click('Import into my account');
    expect(db.getSessions().map((s) => s.id).sort()).toEqual(['ls1', 'ls2']);
    expect(text()).toMatch(/Imported 1 plan and 2 workouts/);
    expect(onClaimed).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem('ironlog_sessions_v1')).toContain('ls1'); // legacy untouched
  });
  it('"Not now" imports nothing, closes, and is remembered', async () => {
    const onClose = vi.fn();
    await render(<LegacyDataClaim open onClose={onClose} />);
    await click('Not now');
    expect(onClose).toHaveBeenCalled();
    expect(db.getSessions()).toEqual([]);
    expect(getClaimState()?.status).toBe('dismissed');
  });
});
