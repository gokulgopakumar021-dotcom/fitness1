import React, { act } from 'react';
import { createRoot, Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ExercisePostureModal } from './ExercisePostureModal';
import { DEFAULT_PROFILE } from '../../storage/db';

// The video section has its own tests (ExerciseVideoSection.test.tsx). Here it is a probe that
// shows which props the dialog passes it.
vi.mock('../video/ExerciseVideoSection', () => ({
  ExerciseVideoSection: ({ exerciseName, defaultOpen }: { exerciseName: string; defaultOpen?: boolean }) => (
    <div data-testid="video" data-name={exerciseName} data-open={String(Boolean(defaultOpen))} />
  ),
}));

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;
let fetchMock: ReturnType<typeof vi.fn>;

const SQUAT = 'Barbell Back Squat';
const NO_GUIDE = 'Face Pull';

const mountModal = async (props: Partial<React.ComponentProps<typeof ExercisePostureModal>> = {}) => {
  await act(async () => {
    root.render(<ExercisePostureModal exerciseName={SQUAT} isOpen onClose={() => {}} profile={DEFAULT_PROFILE} {...props} />);
  });
};
const text = () => document.body.textContent ?? '';
const byText = (label: string) =>
  Array.from(document.querySelectorAll('button')).find((b) => b.textContent?.includes(label)) as HTMLButtonElement;
const click = async (el: HTMLElement) => {
  await act(async () => el.click());
};
const typeInto = async (el: HTMLInputElement, value: string) => {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
};

beforeEach(() => {
  fetchMock = vi.fn(async () => ({ json: async () => ({ success: true, cues: 'Drive knees out.' }) }));
  vi.stubGlobal('fetch', fetchMock);
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('ExercisePostureModal (on ui/Modal) - full guide', () => {
  it('renders nothing while closed or when there is no exercise name', async () => {
    await mountModal({ isOpen: false });
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    await mountModal({ exerciseName: '' });
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  it('is an accessible modal dialog named by the exercise, with category, target muscles and a labelled Close', async () => {
    await mountModal();
    const dialog = document.querySelector('[role="dialog"]') as HTMLElement;
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(document.getElementById(dialog.getAttribute('aria-labelledby') as string)?.textContent).toBe(SQUAT);
    expect(text()).toContain('Biomechanics & Posture Guide · squat');
    expect(text()).toContain('Target: Quadriceps');
    expect(document.querySelector('button[aria-label="Close"]')).toBeTruthy();
  });

  it('passes the workout exercise name and the open-first flag to the video section', async () => {
    await mountModal({ openVideoFirst: true });
    const probe = document.querySelector('[data-testid="video"]') as HTMLElement;
    expect(probe.dataset.name).toBe(SQUAT);
    expect(probe.dataset.open).toBe('true');
    await mountModal({ openVideoFirst: false });
    expect((document.querySelector('[data-testid="video"]') as HTMLElement).dataset.open).toBe('false');
  });

  it('switches between all five tabs and marks the active one', async () => {
    await mountModal();
    expect(byText('Visual Model & Angles').getAttribute('aria-pressed')).toBe('true');
    expect(text()).toContain('Knee Flexion');
    expect(text()).toContain('110° to 125°');
    expect(text()).toContain('Setup Protocol:');
    expect(document.querySelector('svg')).toBeTruthy();

    await click(byText('Step Checkpoints'));
    expect(byText('Step Checkpoints').getAttribute('aria-pressed')).toBe('true');
    expect(byText('Visual Model & Angles').getAttribute('aria-pressed')).toBe('false');
    expect(text()).toContain('Rooted foot arch and scapular tightness');
    expect(document.querySelector('svg[viewBox="0 0 300 240"]')).toBeNull();

    await click(byText('Form Mistakes & Fixes'));
    expect(text()).toContain('Knee Valgus');
    expect(text()).toContain('Corrective Cue:');

    await click(byText('Tempo & Breathing'));
    expect(text()).toContain('3-1-1-0');
    expect(text()).toContain('Joint Mobility Screening:');

    await click(byText('AI Form Coach'));
    expect(text()).toContain('Personalized AI Form Analysis for Barbell Back Squat');
  });

  it('labels each mistake with its risk level', async () => {
    await mountModal();
    await click(byText('Form Mistakes & Fixes'));
    expect(text()).toContain('high risk');
    expect(text()).toContain('moderate risk');
  });

  it('asks the AI coach with the typed question and the profile, then shows the answer', async () => {
    await mountModal({ profile: { ...DEFAULT_PROFILE, trainingExperience: 'advanced', primaryGoal: 'recomposition' } });
    await click(byText('AI Form Coach'));
    await typeInto(document.querySelector('input[aria-label="Your question for Coach Iron"]') as HTMLInputElement, 'My knees cave');
    await click(byText('Ask Coach'));

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/ai-form-analyzer');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({
      exerciseName: SQUAT,
      userQuestion: 'My knees cave',
      experience: 'advanced',
      goal: 'recomposition',
    });
    expect(text()).toContain('Drive knees out.');
    expect(text()).toContain('Coach Iron Biomechanical Feedback:');
  });

  it('a suggested question fills the box and asks immediately; the button is busy while waiting', async () => {
    let release!: (v: unknown) => void;
    fetchMock.mockImplementationOnce(() => new Promise((r) => (release = r)));
    await mountModal();
    await click(byText('AI Form Coach'));
    await click(byText('Where should I feel the stretch?'));

    expect((document.querySelector('input[aria-label="Your question for Coach Iron"]') as HTMLInputElement).value).toBe('Where should I feel the stretch?');
    expect(JSON.parse((fetchMock.mock.calls[0] as [string, RequestInit])[1].body as string).userQuestion).toBe('Where should I feel the stretch?');
    const busy = byText('Analyzing...');
    expect(busy.disabled).toBe(true);
    expect(busy.getAttribute('aria-busy')).toBe('true');

    await act(async () => release({ json: async () => ({ success: true, cues: 'Feel it in the quads.' }) }));
    expect(text()).toContain('Feel it in the quads.');
    expect(byText('Ask Coach').disabled).toBe(false);
  });

  it('shows the server error text, or a built-in cue when the request fails', async () => {
    fetchMock.mockImplementationOnce(async () => ({ json: async () => ({ success: false, error: 'Coach is busy.' }) }));
    await mountModal();
    await click(byText('AI Form Coach'));
    await click(byText('Ask Coach'));
    expect(text()).toContain('Coach is busy.');

    fetchMock.mockImplementationOnce(async () => {
      throw new Error('offline');
    });
    await click(byText('Ask Coach'));
    expect(text()).toContain('Elite Biomechanical Cue for Barbell Back Squat');
  });

  it('closes from the X, the footer button and Escape', async () => {
    const onClose = vi.fn();
    await mountModal({ onClose });
    await click(document.querySelector('button[aria-label="Close"]') as HTMLElement);
    await click(byText('Close Form Guide'));
    await act(async () => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    });
    expect(onClose).toHaveBeenCalledTimes(3);
  });

  it('only runs the movement-loop timer while the dialog is open', async () => {
    vi.useFakeTimers();
    const spy = vi.spyOn(globalThis, 'setInterval');
    await mountModal({ isOpen: false });
    expect(spy.mock.calls.filter((c) => c[1] === 100)).toHaveLength(0);
    await mountModal({ isOpen: true });
    expect(spy.mock.calls.filter((c) => c[1] === 100)).toHaveLength(1);
  });

  it('keeps the movement loop controls working', async () => {
    await mountModal();
    expect(text()).toContain('Pause');
    await click(byText('Pause'));
    expect(text()).toContain('Play Loop');
    await click(byText('View Depth'));
    expect(text()).toContain('Phase: Bottom / Max Contraction');
    await click(byText('View Setup'));
    expect(text()).toContain('Phase: Setup / Starting Alignment');
  });

  it('uses theme tokens only: no hard-coded palette colours or hex values in the dialog, diagram included', async () => {
    await mountModal();
    const check = () => {
      const html = (document.querySelector('[role="dialog"]') as HTMLElement).innerHTML;
      expect(html).not.toMatch(/(lime|amber|sky|emerald|rose|fuchsia)-\d{3}/);
      expect(html).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
      expect(html).not.toMatch(/rgba?\(/);
    };
    check(); // visual tab: diagram, legend, grid overlay
    for (const tab of ['Step Checkpoints', 'Form Mistakes & Fixes', 'Tempo & Breathing', 'AI Form Coach']) {
      await click(byText(tab));
      check();
    }
    await click(byText('Ask Coach'));
    check();
  });

  it('draws the diagram with theme variables and gives it an accessible name for each position', async () => {
    await mountModal();
    const svg = document.querySelector('svg[viewBox="0 0 300 240"]') as SVGElement;
    expect(svg.getAttribute('role')).toBe('img');
    expect(svg.getAttribute('aria-label')).toContain('Barbell Back Squat movement diagram');
    const used = new Set(Array.from(svg.querySelectorAll('[stroke],[fill]')).flatMap((n) => [n.getAttribute('stroke'), n.getAttribute('fill')]).filter(Boolean));
    for (const v of ['var(--chart-1)', 'var(--chart-2)', 'var(--chart-5)', 'var(--warning)', 'var(--danger)', 'var(--chart-axis)', 'var(--text-primary)']) {
      expect(used.has(v)).toBe(true);
    }
    // legend swatches use the same tokens as the strokes they explain
    const legend = Array.from(document.querySelectorAll('span.rounded-full')).map((n) => n.className).join(' ');
    for (const c of ['bg-chart-1', 'bg-chart-2', 'bg-warning', 'bg-danger']) expect(legend).toContain(c);

    await click(byText('View Depth'));
    expect(svg.getAttribute('aria-label')).toContain('bottom position');
    await click(byText('View Setup'));
    expect(svg.getAttribute('aria-label')).toContain('setup position');
  });
});

describe('ExercisePostureModal (on ui/Modal) - no verified guide', () => {
  it('names the dialog by the exercise, shows the message in a status region and no guide tabs', async () => {
    await mountModal({ exerciseName: NO_GUIDE, openVideoFirst: true });
    const dialog = document.querySelector('[role="dialog"]') as HTMLElement;
    expect(document.getElementById(dialog.getAttribute('aria-labelledby') as string)?.textContent).toBe(NO_GUIDE);
    expect(document.querySelector('[role="status"]')?.textContent).toContain('No form guide available for this exercise.');
    expect(text()).not.toContain('Visual Model & Angles');
    expect(text()).not.toContain(SQUAT);
    const probe = document.querySelector('[data-testid="video"]') as HTMLElement;
    expect(probe.dataset.name).toBe(NO_GUIDE);
    expect(probe.dataset.open).toBe('true');
  });

  it('closes from the X, the footer button and Escape', async () => {
    const onClose = vi.fn();
    await mountModal({ exerciseName: NO_GUIDE, onClose });
    await click(document.querySelector('button[aria-label="Close"]') as HTMLElement);
    await click(byText('Close Form Guide'));
    await act(async () => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    });
    expect(onClose).toHaveBeenCalledTimes(3);
  });

  it('does not start the movement-loop timer for an exercise without a guide that is closed', async () => {
    vi.useFakeTimers();
    const spy = vi.spyOn(globalThis, 'setInterval');
    await mountModal({ exerciseName: NO_GUIDE, isOpen: false });
    expect(spy.mock.calls.filter((c) => c[1] === 100)).toHaveLength(0);
  });

  it('uses theme tokens only', async () => {
    await mountModal({ exerciseName: NO_GUIDE });
    const html = (document.querySelector('[role="dialog"]') as HTMLElement).innerHTML;
    expect(html).not.toMatch(/(lime|amber|sky|emerald|rose|fuchsia)-\d{3}/);
    expect(html).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
  });
});
