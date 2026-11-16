import React, { act } from 'react';
import { createRoot, Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConsentHistoryPanel } from './ConsentHistoryPanel';
import { WEARABLE_CONSENT_EVENT } from '../../wearables/consentClient';
import type { ConsentHistoryResult } from '../../wearables/consentHistoryClient';
import type { ConsentEvent } from '../../wearables/consentHistory';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;
const text = () => container.textContent ?? '';
const btn = (re: RegExp) => [...container.querySelectorAll('button')].find((b) => re.test(b.textContent ?? ''));
const click = async (el: Element | undefined) => { await act(async () => { el!.dispatchEvent(new MouseEvent('click', { bubbles: true })); }); };
const ev = (category: ConsentEvent['category'], action: ConsentEvent['action'], at: string, version = 1): ConsentEvent => ({ category, action, version, at });
const mount = async (fetcher: (s?: AbortSignal) => Promise<ConsentHistoryResult>) => { await act(async () => root.render(<ConsentHistoryPanel fetcher={fetcher} />)); };

beforeEach(() => { container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container); });
afterEach(() => { act(() => root.unmount()); container.remove(); document.body.innerHTML = ''; });

describe('ConsentHistoryPanel', () => {
  it('makes no request until it is opened, and says the record is read-only', async () => {
    const f = vi.fn(async () => ({ kind: 'ok', events: [], truncated: false }) as ConsentHistoryResult);
    await mount(f);
    expect(f).not.toHaveBeenCalled();
    expect(text()).toMatch(/read-only/i);
    expect(text()).toMatch(/cannot be edited or deleted/i);
  });
  it('lists each change with its permission, on/off, version and time, in the order the server sent', async () => {
    const f = vi.fn(async () => ({ kind: 'ok', truncated: false, events: [
      ev('live_heart_rate', 'revoked', '2026-11-16T11:00:00.000Z'),
      ev('live_heart_rate', 'granted', '2026-11-16T10:00:00.000Z'),
      ev('workout_health_sync', 'granted', '2026-11-15T09:00:00.000Z')
    ] }) as ConsentHistoryResult);
    await mount(f);
    await click(btn(/Show history/));
    const items = [...container.querySelectorAll('li')];
    expect(items).toHaveLength(3);
    expect(items[0].textContent).toContain('Live heart rate with Coach Iron');
    expect(items[0].textContent).toContain('Turned off');
    expect(items[1].textContent).toContain('Turned on');
    expect(items[2].textContent).toContain('Saving workout heart rate');
    expect(items[0].textContent).toContain('consent v1');
    expect(items[0].textContent).not.toContain('older version');
  });
  it('marks an event recorded under another consent version', async () => {
    await mount(async () => ({ kind: 'ok', truncated: false, events: [ev('live_heart_rate', 'granted', '2026-11-16T10:00:00.000Z', 2)] }));
    await click(btn(/Show history/));
    expect(text()).toContain('consent v2');
    expect(text()).toContain('(older version)');
  });
  it('offers no edit, delete or export control', async () => {
    await mount(async () => ({ kind: 'ok', truncated: false, events: [ev('live_heart_rate', 'granted', '2026-11-16T10:00:00.000Z')] }));
    await click(btn(/Show history/));
    const labels = [...container.querySelectorAll('button')].map((b) => b.textContent ?? '');
    expect(labels.filter((l) => /edit|delete|remove|clear|export|download/i.test(l))).toEqual([]);
  });
  it('shows an honest empty state', async () => {
    await mount(async () => ({ kind: 'ok', events: [], truncated: false }));
    await click(btn(/Show history/));
    expect(text()).toMatch(/No changes yet/);
    expect(text()).toMatch(/off until you turn it on/);
  });
  it('says when older changes are not shown', async () => {
    await mount(async () => ({ kind: 'ok', truncated: true, events: [ev('live_heart_rate', 'granted', '2026-11-16T10:00:00.000Z')] }));
    await click(btn(/Show history/));
    expect(text()).toMatch(/only the 100 most recent/i);
  });
  it.each([
    ['unavailable', /temporarily unavailable\. Nothing was changed/, true],
    ['failed', /could not be loaded/, true],
    ['rate_limited', /Too many requests/, true],
    ['unauthenticated', /Sign in again/, false]
  ] as const)('%s: shows a safe message, no invented events, and %s a retry', async (kind, re, retry) => {
    await mount(async () => ({ kind }));
    await click(btn(/Show history/));
    expect(text()).toMatch(re);
    expect(container.querySelectorAll('li')).toHaveLength(0);
    expect(!!btn(/Retry/)).toBe(retry);
  });
  it('retry loads again', async () => {
    const f = vi.fn<(s?: AbortSignal) => Promise<ConsentHistoryResult>>()
      .mockResolvedValueOnce({ kind: 'unavailable' })
      .mockResolvedValueOnce({ kind: 'ok', truncated: false, events: [ev('live_heart_rate', 'granted', '2026-11-16T10:00:00.000Z')] });
    await mount(f);
    await click(btn(/Show history/));
    await click(btn(/Retry/));
    expect(f).toHaveBeenCalledTimes(2);
    expect(container.querySelectorAll('li')).toHaveLength(1);
  });
  it('refreshes while open after a consent change on this screen, and not while closed', async () => {
    const f = vi.fn(async () => ({ kind: 'ok', events: [], truncated: false }) as ConsentHistoryResult);
    await mount(f);
    await act(async () => { window.dispatchEvent(new Event(WEARABLE_CONSENT_EVENT)); });
    expect(f).not.toHaveBeenCalled();
    await click(btn(/Show history/));
    expect(f).toHaveBeenCalledTimes(1);
    await act(async () => { window.dispatchEvent(new Event(WEARABLE_CONSENT_EVENT)); });
    expect(f).toHaveBeenCalledTimes(2);
    await click(btn(/Hide/));
    await act(async () => { window.dispatchEvent(new Event(WEARABLE_CONSENT_EVENT)); });
    expect(f).toHaveBeenCalledTimes(2);
  });
  it('closing aborts an in-flight read and leaves no stale result behind', async () => {
    let signal: AbortSignal | undefined;
    let resolve!: (r: ConsentHistoryResult) => void;
    await mount((s) => { signal = s; return new Promise<ConsentHistoryResult>((r) => { resolve = r; }); });
    await click(btn(/Show history/));
    expect(text()).toMatch(/Loading consent history/);
    await click(btn(/Hide/));
    expect(signal?.aborted).toBe(true);
    await act(async () => { resolve({ kind: 'ok', truncated: false, events: [ev('live_heart_rate', 'granted', '2026-11-16T10:00:00.000Z')] }); });
    expect(container.querySelectorAll('li')).toHaveLength(0);
  });
  it('unmounting (e.g. account switch / sign-out) removes everything it showed', async () => {
    await mount(async () => ({ kind: 'ok', truncated: false, events: [ev('live_heart_rate', 'granted', '2026-11-16T10:00:00.000Z')] }));
    await click(btn(/Show history/));
    expect(container.querySelectorAll('li')).toHaveLength(1);
    await act(async () => root.render(<div />));
    expect(text()).not.toContain('Live heart rate');
  });
});
