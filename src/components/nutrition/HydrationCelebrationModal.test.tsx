import React, { act } from 'react';
import { createRoot, Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HydrationCelebrationModal, HydrationCelebrationModalProps } from './HydrationCelebrationModal';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

const baseProps: HydrationCelebrationModalProps = {
  isOpen: true,
  onClose: () => {},
  waterMl: 2500,
  goalMl: 2500,
  goalOz: 85,
  unit: 'ml',
  streakCount: 3,
};

// jsdom has no Web Audio. The component returns early from its effect when AudioContext is
// missing (which also skips the auto-close timer), so tests stub a minimal one.
class FakeAudioContext {
  currentTime = 0;
  destination = {};
  createOscillator() {
    return {
      type: 'sine',
      frequency: { setValueAtTime() {} },
      connect() {},
      start() {},
      stop() {},
    };
  }
  createGain() {
    return {
      gain: { setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {} },
      connect() {},
    };
  }
}

const render = async (props: Partial<HydrationCelebrationModalProps> = {}) => {
  await act(async () => {
    root.render(<HydrationCelebrationModal {...baseProps} {...props} />);
  });
};

beforeEach(() => {
  (window as unknown as { AudioContext: unknown }).AudioContext = FakeAudioContext;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  vi.useRealTimers();
  await act(async () => root.unmount());
  container.remove();
  delete (window as unknown as { AudioContext?: unknown }).AudioContext;
});

describe('HydrationCelebrationModal (on ui/Modal)', () => {
  it('renders nothing when closed', async () => {
    await render({ isOpen: false });
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  it('is an accessible modal dialog named by its visible heading', async () => {
    await render();
    const dialog = document.querySelector('[role="dialog"]') as HTMLElement;
    expect(dialog).toBeTruthy();
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    const labelId = dialog.getAttribute('aria-labelledby') as string;
    expect(document.getElementById(labelId)?.textContent).toBe('Daily Target Crushed!');
  });

  it('shows the logged amount, goal and percentage in ml', async () => {
    await render({ waterMl: 2750, goalMl: 2500 });
    const text = document.body.textContent ?? '';
    expect(text).toContain('2,750 ml');
    expect(text).toContain('2,500 ml');
    expect(text).toContain('GOAL COMPLETED (110%)');
  });

  it('shows fl oz values when the unit is oz', async () => {
    await render({ unit: 'oz', waterMl: 2000, goalOz: 85 });
    const text = document.body.textContent ?? '';
    expect(text).toContain('68 fl oz');
    expect(text).toContain('85 fl oz');
  });

  it('shows the streak count, or the first-day label when there is no streak', async () => {
    await render({ streakCount: 5 });
    expect(document.body.textContent).toContain('5 Day Streak!');
    await render({ streakCount: 0 });
    expect(document.body.textContent).toContain('1st Day Hit!');
  });

  it('closes from the X button, the Continue button, Escape and the backdrop', async () => {
    const onClose = vi.fn();
    await render({ onClose });

    await act(async () => {
      (document.querySelector('button[aria-label="Close"]') as HTMLButtonElement).click();
    });
    expect(onClose).toHaveBeenCalledTimes(1);

    const cont = Array.from(document.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('Continue Training')
    ) as HTMLButtonElement;
    await act(async () => cont.click());
    expect(onClose).toHaveBeenCalledTimes(2);

    await act(async () => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    });
    expect(onClose).toHaveBeenCalledTimes(3);

    await act(async () => {
      (document.querySelector('[aria-hidden="true"].bg-overlay') as HTMLElement).click();
    });
    expect(onClose).toHaveBeenCalledTimes(4);
  });

  it('auto-closes after 6 seconds, and not earlier', async () => {
    vi.useFakeTimers();
    const onClose = vi.fn();
    await render({ onClose });
    await act(async () => {
      vi.advanceTimersByTime(5900);
    });
    expect(onClose).not.toHaveBeenCalled();
    await act(async () => {
      vi.advanceTimersByTime(200);
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('does not start the auto-close timer while closed', async () => {
    vi.useFakeTimers();
    const onClose = vi.fn();
    await render({ isOpen: false, onClose });
    await act(async () => {
      vi.advanceTimersByTime(10000);
    });
    expect(onClose).not.toHaveBeenCalled();
  });

  it('uses theme tokens only: no hard-coded palette colours or hex values in the dialog', async () => {
    await render();
    const html = (document.querySelector('[role="dialog"]') as HTMLElement).innerHTML;
    expect(html).not.toMatch(/(emerald|amber|sky|rose)-\d{3}/);
    expect(html).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
  });
});
