import React, { act } from 'react';
import { createRoot, Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DynamicWarmupModal } from './DynamicWarmupModal';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

const routine = {
  routineName: 'Test RAMP',
  totalDurationSeconds: 300,
  targetMuscles: ['Chest', 'Triceps'],
  coachTip: 'Stay smooth.',
  phases: [
    { phase: 'Raise', name: 'Jumping Jacks', durationSeconds: 3, purpose: 'Raise heart rate.', cues: ['Bounce'], musclesTargeted: ['Full Body'] },
    { phase: 'Activate', name: 'Band Pull-Aparts', durationSeconds: 2, purpose: 'Fire the cuff.', cues: ['Squeeze'], musclesTargeted: ['Shoulders'] },
  ],
};

const okResponse = (body: unknown) => ({ json: async () => body });
let fetchMock: ReturnType<typeof vi.fn>;

const mountModal = async (props: Partial<React.ComponentProps<typeof DynamicWarmupModal>> = {}) => {
  await act(async () => {
    root.render(<DynamicWarmupModal isOpen onClose={() => {}} muscleGroups={['Chest']} exercises={['Bench Press']} workoutName="Push Day" {...props} />);
  });
};
const text = () => document.body.textContent ?? '';
const byText = (label: string) =>
  Array.from(document.querySelectorAll('button')).find((b) => b.textContent?.includes(label)) as HTMLButtonElement;
const byLabel = (label: string) => document.querySelector(`button[aria-label="${label}"]`) as HTMLButtonElement;
const click = async (el: HTMLElement) => {
  await act(async () => el.click());
};

beforeEach(() => {
  vi.useFakeTimers();
  fetchMock = vi.fn(async () => okResponse({ success: true, routine }));
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

describe('DynamicWarmupModal (on ui/Modal)', () => {
  it('renders nothing and does not fetch while closed', async () => {
    await mountModal({ isOpen: false });
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('is an accessible modal dialog named by its heading', async () => {
    await mountModal();
    const dialog = document.querySelector('[role="dialog"]') as HTMLElement;
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(document.getElementById(dialog.getAttribute('aria-labelledby') as string)?.textContent).toBe('Dynamic Warm-up Generator');
  });

  it('requests a routine for the given muscles, exercises and workout, then shows the first drill', async () => {
    await mountModal();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/ai-warmup-generator');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({
      muscleGroups: ['Chest'],
      exercises: ['Bench Press'],
      workoutName: 'Push Day',
      intensity: 'High Hypertrophy',
    });
    expect(text()).toContain('Jumping Jacks');
    expect(text()).toContain('Drill 1 of 2');
    expect(text()).toContain('Start Exercise (3s)');
    expect(text()).toContain('Stay smooth.');
  });

  it('shows a loading state while the routine is being generated', async () => {
    fetchMock.mockImplementation(() => new Promise(() => {}));
    await mountModal({ muscleGroups: ['Chest', 'Back'] });
    expect(document.querySelector('[role="status"]')?.textContent).toContain('Generating 5-Minute RAMP Sequence');
    expect(text()).toContain('Chest, Back');
  });

  it('shows the error in an alert and recovers through Retry Generation', async () => {
    fetchMock.mockImplementationOnce(async () => okResponse({ success: false, error: 'Model unavailable' }));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await mountModal();
    expect(document.querySelector('[role="alert"]')?.textContent).toContain('Model unavailable');
    await click(byText('Retry Generation'));
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(document.querySelector('[role="alert"]')).toBeNull();
    expect(text()).toContain('Jumping Jacks');
  });

  it('counts down once per second only while playing, and Pause stops it', async () => {
    await mountModal();
    await act(async () => {
      vi.advanceTimersByTime(3000);
    });
    expect(text()).toContain('3s'); // not started: nothing moves

    await click(byText('Start Exercise'));
    await act(async () => {
      vi.advanceTimersByTime(1000);
    });
    expect(document.querySelector('[role="timer"]')?.getAttribute('aria-label')).toBe('2 seconds remaining');

    await click(byText('Pause Timer'));
    await act(async () => {
      vi.advanceTimersByTime(5000);
    });
    expect(document.querySelector('[role="timer"]')?.getAttribute('aria-label')).toBe('2 seconds remaining');
  });

  it('advances to the next drill when the timer runs out, then completes and reports completion once', async () => {
    const onWarmupCompleted = vi.fn();
    await mountModal({ onWarmupCompleted });
    await click(byText('Start Exercise'));
    await act(async () => {
      vi.advanceTimersByTime(3000);
    });
    expect(text()).toContain('Band Pull-Aparts');
    expect(text()).toContain('Drill 2 of 2');
    expect(onWarmupCompleted).not.toHaveBeenCalled();

    await act(async () => {
      vi.advanceTimersByTime(2000);
    });
    expect(text()).toContain('Body Primed & Ready to Lift!');
    expect(onWarmupCompleted).toHaveBeenCalledTimes(1);
  });

  it('Previous is disabled on the first drill; Next/Finish and Restart behave as before', async () => {
    const onWarmupCompleted = vi.fn();
    await mountModal({ onWarmupCompleted });
    expect(byText('Previous').disabled).toBe(true);

    await click(byText('Next'));
    expect(text()).toContain('Drill 2 of 2');
    expect(byText('Previous').disabled).toBe(false);
    expect(byText('Finish')).toBeTruthy();

    await click(byText('Finish'));
    expect(text()).toContain('Body Primed & Ready to Lift!');
    expect(onWarmupCompleted).toHaveBeenCalledTimes(1);

    await click(byText('Restart Warm-up'));
    expect(text()).toContain('Drill 1 of 2');
    expect(text()).toContain('Start Exercise (3s)');
  });

  it('jumps to a drill from the phase tiles and marks it as the current step', async () => {
    await mountModal();
    const tile = byLabel('Drill 2: Activate');
    await click(tile);
    expect(text()).toContain('Band Pull-Aparts');
    expect(tile.getAttribute('aria-current')).toBe('step');
    expect(byLabel('Drill 1: Raise').getAttribute('aria-current')).toBeNull();
  });

  it('toggles the audio beeps control with a descriptive label', async () => {
    await mountModal();
    expect(byLabel('Mute Audio Beeps')).toBeTruthy();
    await click(byLabel('Mute Audio Beeps'));
    expect(byLabel('Enable Audio Beeps')).toBeTruthy();
  });

  it('closes from the X, Escape, and Enter Workout Session', async () => {
    const onClose = vi.fn();
    await mountModal({ onClose });
    await click(byLabel('Close'));
    expect(onClose).toHaveBeenCalledTimes(1);
    await act(async () => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    });
    expect(onClose).toHaveBeenCalledTimes(2);

    await click(byText('Next'));
    await click(byText('Finish'));
    await click(byText('Enter Workout Session'));
    expect(onClose).toHaveBeenCalledTimes(3);
  });

  it('pauses the timer and reloads the routine when it is closed and reopened', async () => {
    await mountModal();
    await click(byText('Start Exercise'));
    await mountModal({ isOpen: false });
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    await act(async () => {
      vi.advanceTimersByTime(3000);
    });
    await mountModal({ isOpen: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(text()).toContain('Start Exercise (3s)'); // fresh routine, not running
  });

  it('uses theme tokens only: no hard-coded palette colours or hex values', async () => {
    await mountModal();
    const check = () => {
      const html = (document.querySelector('[role="dialog"]') as HTMLElement).innerHTML;
      expect(html).not.toMatch(/(lime|amber|sky|emerald|fuchsia|rose)-\d{3}/);
      expect(html).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    };
    check();
    await click(byText('Next'));
    await click(byText('Finish'));
    check();
  });
});
