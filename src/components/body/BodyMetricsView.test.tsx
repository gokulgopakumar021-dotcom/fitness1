import React, { act } from 'react';
import { createRoot, Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BodyMetricsView } from './BodyMetricsView';
import { db, DEFAULT_PROFILE } from '../../storage/db';
import { BodyMetricEntry, UserProfile } from '../../types';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

const profile: UserProfile = {
  ...DEFAULT_PROFILE,
  currentWeightKg: 80,
  goalWeightKg: 78,
  heightCm: 180,
  preferredUnit: 'kg'
};

const entry = (date: string, weightKg: number, extra: Partial<BodyMetricEntry> = {}): BodyMetricEntry => ({
  id: `bm-${date}`,
  date,
  weightKg,
  bmi: 24.7,
  ...extra
});

const render = async (p: UserProfile = profile, onProfileUpdated: (p: UserProfile) => void = () => {}) => {
  await act(async () => {
    root.render(<BodyMetricsView profile={p} onProfileUpdated={onProfileUpdated} />);
  });
};
const text = () => document.body.textContent ?? '';
const byText = (tag: string, t: string) =>
  Array.from(document.body.querySelectorAll(tag)).find((e) => e.textContent?.includes(t)) as HTMLElement | undefined;
const click = async (el: Element | undefined | null) => {
  expect(el).toBeTruthy();
  await act(async () => {
    (el as HTMLElement).click();
  });
};
const setInput = async (el: HTMLInputElement, value: string) => {
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    setter.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
};
const field = (label: string) => document.querySelector<HTMLInputElement>(`input[id]:not([disabled])`) && 
  (Array.from(document.querySelectorAll('label')).find((l) => l.textContent?.startsWith(label)) &&
    document.getElementById(Array.from(document.querySelectorAll('label')).find((l) => l.textContent?.startsWith(label))!.htmlFor) as HTMLInputElement);
const submitForm = async () => {
  await act(async () => {
    document.getElementById('body-log-form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  });
};

beforeEach(() => {
  localStorage.clear();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

describe('BodyMetricsView', () => {
  it('shows an honest empty state with a working first-entry action and no invented history', async () => {
    await render();
    expect(text()).toContain('No measurements yet');
    expect(text()).not.toContain('History');
    expect(document.querySelector('svg[role="img"]')).toBeNull();
    await click(byText('button', 'Log your first measurement'));
    expect(document.querySelector('[role="dialog"]')).toBeTruthy();
  });

  it('does not invent a weight when the profile has none', async () => {
    await render({ ...profile, currentWeightKg: 0 });
    await click(byText('button', 'Log measurement'));
    expect(field('Weight')!.value).toBe('');
  });

  it('shows the latest value, its date and the change since the previous entry', async () => {
    db.saveBodyMetrics([entry('2026-10-01', 81), entry('2026-10-05', 80.2, { waistCm: 82 })]);
    await render();
    const card = document.querySelector('[aria-label="Weight"]')!;
    expect(card.textContent).toContain('80.2');
    expect(card.textContent).toContain('5 Oct 2026');
    expect(card.textContent).toContain('−0.8');
    expect(card.textContent).toContain('since 1 Oct 2026');
    // waist has only one record: no change is shown
    const waist = document.querySelector('[aria-label="Waist"]')!;
    expect(waist.textContent).toContain('82');
    expect(waist.textContent).toContain('One entry so far');
    expect(document.querySelector('[aria-label="Body fat"]')).toBeNull();
  });

  it('shows weights in pounds for lbs users while storage stays in kg', async () => {
    db.saveBodyMetrics([entry('2026-10-05', 80)]);
    await render({ ...profile, preferredUnit: 'lbs', goalWeightKg: 78 });
    expect(document.querySelector('[aria-label="Weight"]')!.textContent).toContain('176.4');
    expect(db.getBodyMetrics()[0].weightKg).toBe(80);
  });

  it('explains that more entries are needed instead of drawing a chart for two records', async () => {
    db.saveBodyMetrics([entry('2026-10-01', 81), entry('2026-10-05', 80.2)]);
    await render();
    expect(text()).toContain('Log at least 3 weight entries to see a trend line');
    expect(document.querySelector('svg[role="img"]')).toBeNull();
  });

  it('draws a chart from real records once there are three', async () => {
    db.saveBodyMetrics([entry('2026-10-01', 81), entry('2026-10-03', 80.6), entry('2026-10-05', 80.2)]);
    await render();
    expect(document.querySelector('svg[role="img"]')).toBeTruthy();
    expect(text()).toContain('3 entries from 1 Oct 2026 to 5 Oct 2026');
  });

  it('lists history newest first', async () => {
    db.saveBodyMetrics([entry('2026-10-01', 81), entry('2026-10-05', 80.2)]);
    await render();
    const rows = Array.from(document.querySelectorAll('section[aria-label="History"] li')).map((li) => li.textContent);
    expect(rows[0]).toContain('5 Oct 2026');
    expect(rows[1]).toContain('1 Oct 2026');
  });

  it('validates before saving and keeps the dialog open', async () => {
    await render();
    await click(byText('button', 'Log your first measurement'));
    await setInput(field('Weight')!, '');
    await submitForm();
    expect(text()).toContain('Enter a weight greater than 0.');
    expect(db.getBodyMetrics()).toHaveLength(0);
    expect(document.querySelector('[role="dialog"]')).toBeTruthy();
  });

  it('saves through the existing store, then confirms', async () => {
    const onProfile = vi.fn();
    await render(profile, onProfile);
    await click(byText('button', 'Log your first measurement'));
    await setInput(field('Date')!, '2026-10-10');
    await setInput(field('Weight')!, '79.4');
    await setInput(field('Waist')!, '81.5');
    await submitForm();
    const saved = db.getBodyMetrics();
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({ date: '2026-10-10', weightKg: 79.4, waistCm: 81.5 });
    expect(text()).toContain('Saved entry for 10 Oct 2026.');
    expect(onProfile).toHaveBeenCalledWith(expect.objectContaining({ currentWeightKg: 79.4 }));
  });

  it('stores lbs input as kg', async () => {
    await render({ ...profile, preferredUnit: 'lbs' });
    await click(byText('button', 'Log your first measurement'));
    await setInput(field('Date')!, '2026-10-10');
    await setInput(field('Weight')!, '176.4');
    await submitForm();
    expect(db.getBodyMetrics()[0].weightKg).toBe(80);
  });

  it('never says saved when the store reports a failed write', async () => {
    vi.spyOn(db, 'addOrUpdateBodyMetric').mockReturnValue(false);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await render();
    await click(byText('button', 'Log your first measurement'));
    await setInput(field('Weight')!, '79.4');
    await submitForm();
    expect(text()).toContain('Nothing was recorded');
    expect(text()).not.toContain('Saved entry');
    expect(document.querySelector('[role="dialog"]')).toBeTruthy();
  });

  it('does not overwrite the profile weight when an older date is logged', async () => {
    db.saveBodyMetrics([entry('2026-10-05', 80)]);
    const onProfile = vi.fn();
    await render(profile, onProfile);
    await click(byText('button', 'Log measurement'));
    await setInput(field('Date')!, '2026-09-20');
    await setInput(field('Weight')!, '85');
    await submitForm();
    expect(db.getBodyMetrics()).toHaveLength(2);
    expect(onProfile).not.toHaveBeenCalled();
  });

  it('edits an entry in place under the existing one-per-date rule', async () => {
    db.saveBodyMetrics([entry('2026-10-05', 80)]);
    await render();
    await click(document.querySelector('button[aria-label="Edit entry for 5 Oct 2026"]'));
    expect(field('Date')!.disabled).toBe(true);
    await setInput(field('Weight')!, '79.5');
    await submitForm();
    const list = db.getBodyMetrics();
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ id: 'bm-2026-10-05', weightKg: 79.5 });
  });

  it('asks before deleting, and cancel keeps the entry', async () => {
    db.saveBodyMetrics([entry('2026-10-05', 80)]);
    await render();
    await click(document.querySelector('button[aria-label="Delete entry for 5 Oct 2026"]'));
    expect(text()).toContain('Delete this entry?');
    await click(byText('button', 'Cancel'));
    expect(db.getBodyMetrics()).toHaveLength(1);
    await click(document.querySelector('button[aria-label="Delete entry for 5 Oct 2026"]'));
    await click(byText('button', 'Delete entry'));
    expect(db.getBodyMetrics()).toHaveLength(0);
    expect(text()).toContain('No measurements yet');
  });

  it('opens Body Scan from the header', async () => {
    await render();
    await click(byText('button', 'Body Scan'));
    expect(text()).toContain('Back to Body Metrics');
    await click(byText('button', 'Back to Body Metrics'));
    expect(text()).toContain('Log measurement');
  });

  it('validates and saves height and goal weight', async () => {
    const onProfile = vi.fn();
    await render(profile, onProfile);
    await setInput(field('Height')!, '0');
    await act(async () => {
      byText('button', 'Save height and goal')!.click();
    });
    expect(text()).toContain('Enter a height greater than 0.');
    expect(onProfile).not.toHaveBeenCalled();
    await setInput(field('Height')!, '182');
    await act(async () => {
      byText('button', 'Save height and goal')!.click();
    });
    expect(onProfile).toHaveBeenCalledWith(expect.objectContaining({ heightCm: 182, goalWeightKg: 78 }));
  });
});
