import React, { act } from 'react';
import { createRoot, Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CaptureQualityPanel } from './CaptureQualityPanel';
import { assessCaptureQuality, type CaptureQualityAssessment } from '../../utils/captureQuality';
import { makeFrontPose } from '../../utils/syntheticPose.testutil';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;
const render = async (assessment?: CaptureQualityAssessment | null) => {
  await act(async () => {
    root.render(<CaptureQualityPanel assessment={assessment} />);
  });
};
const rows = () => Array.from(container.querySelectorAll<HTMLElement>('li[data-check]'));

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

describe('CaptureQualityPanel: no inputs available (Phase 2B)', () => {
  it('says checks are not running and lists all seven as Not checked, with no pass/fail wording', async () => {
    await render();
    const t = container.textContent ?? '';
    expect(container.querySelector('[data-testid="quality-not-running"]')).toBeTruthy();
    expect((t.match(/Not checked/g) ?? []).length).toBe(7);
    expect(t).not.toMatch(/Looks OK|Problem|Could be better|No problems were found/);
  });

  it('treats null the same as undefined', async () => {
    await render(null);
    expect(container.querySelector('[data-testid="quality-not-running"]')).toBeTruthy();
  });

  it('an assessment in which NOTHING was evaluated is still shown as not running (never as a pass)', async () => {
    const empty: CaptureQualityAssessment = {
      status: 'pass',
      complete: false,
      feedback: [],
      notEvaluated: ['landmarks_visible', 'in_frame', 'centered', 'body_height_fraction', 'brightness', 'sharpness', 'stillness'],
      checks: ['landmarks_visible', 'in_frame', 'centered', 'body_height_fraction', 'brightness', 'sharpness', 'stillness'].map((id) => ({
        id: id as never,
        status: 'not_evaluated' as const,
        message: 'no input',
      })),
    };
    await render(empty);
    expect(container.querySelector('[data-testid="quality-not-running"]')).toBeTruthy();
    expect(container.textContent).not.toContain('No problems were found');
  });
});

describe('CaptureQualityPanel: when a later phase supplies real inputs', () => {
  // The numbers below are SYNTHETIC test inputs, not camera or pose-model output.
  it('shows a complete, passing assessment without a partial-result caveat', async () => {
    const a = assessCaptureQuality({ view: 'front', landmarks: makeFrontPose(), brightness: 0.5, sharpness: 200, motion: 0.002 });
    await render(a);
    expect(container.querySelector('[data-testid="quality-not-running"]')).toBeNull();
    const summary = container.querySelector('[data-testid="quality-summary"]')!.textContent!;
    expect(summary).toContain('No problems were found by the checks that ran');
    expect(summary).not.toContain('could not be run');
    expect(summary).toContain('not a guarantee');
    expect(rows()).toHaveLength(7);
    expect(rows().every((r) => r.dataset.status === 'pass')).toBe(true);
  });

  it('flags a partial result and labels unevaluated checks Not checked instead of passing them', async () => {
    const a = assessCaptureQuality({ view: 'front', landmarks: makeFrontPose(), brightness: 0.5 }); // sharpness & motion missing
    await render(a);
    const summary = container.querySelector('[data-testid="quality-summary"]')!.textContent!;
    expect(summary).toContain('2 of 7 checks could not be run');
    const byId = (id: string) => rows().find((r) => r.dataset.check === id)!;
    expect(byId('sharpness').dataset.status).toBe('not_evaluated');
    expect(byId('sharpness').textContent).toContain('Not checked');
    expect(byId('brightness').textContent).toContain('Looks OK');
  });

  it('shows a failing check in words (not colour alone) together with the advice', async () => {
    const a = assessCaptureQuality({ view: 'front', landmarks: makeFrontPose(), brightness: 0.05, sharpness: 200, motion: 0.002 });
    await render(a);
    const row = rows().find((r) => r.dataset.check === 'brightness')!;
    expect(row.dataset.status).toBe('fail');
    expect(row.textContent).toContain('Problem');
    expect(a.feedback.length).toBeGreaterThan(0);
    expect(row.textContent).toContain(a.checks.find((c) => c.id === 'brightness')!.advice!);
    expect(container.querySelector('[data-testid="quality-summary"]')!.textContent).toContain('found a problem');
  });

  it('decorative status icons are hidden from assistive technology', async () => {
    const a = assessCaptureQuality({ view: 'front', landmarks: makeFrontPose(), brightness: 0.5, sharpness: 200, motion: 0.002 });
    await render(a);
    expect(Array.from(container.querySelectorAll('svg')).every((s) => s.getAttribute('aria-hidden') === 'true')).toBe(true);
  });
});
