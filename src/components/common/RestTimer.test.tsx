import React, { act } from 'react';
import { createRoot, Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RestTimer } from './RestTimer';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;
const onClose = vi.fn();
const onFinished = vi.fn();

const render = async (props: Partial<React.ComponentProps<typeof RestTimer>> = {}) => {
  await act(async () => {
    root.render(<RestTimer isOpen initialSeconds={90} onClose={onClose} onFinished={onFinished} {...props} />);
  });
};
const tick = async (ms: number) => {
  await act(async () => {
    vi.advanceTimersByTime(ms);
  });
};
const clock = () => container.querySelector('[role="timer"]')!.textContent;
const btn = (label: string) =>
  Array.from(container.querySelectorAll('button')).find((b) => (b.textContent ?? '').trim() === label || b.getAttribute('aria-label') === label)!;
const click = async (el: Element) => {
  await act(async () => (el as HTMLElement).click());
};

beforeEach(() => {
  vi.useFakeTimers();
  onClose.mockReset();
  onFinished.mockReset();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.useRealTimers();
});

describe('RestTimer', () => {
  it('renders nothing when closed', async () => {
    await render({ isOpen: false });
    expect(container.innerHTML).toBe('');
  });

  it('starts running from the initial seconds and counts down once per second', async () => {
    await render();
    expect(clock()).toBe('01:30');
    await tick(3000);
    expect(clock()).toBe('01:27');
  });

  it('pauses and resumes', async () => {
    await render();
    await tick(2000);
    await click(btn('Pause'));
    expect(container.textContent).toContain('Paused');
    await tick(5000);
    expect(clock()).toBe('01:28'); // frozen
    await click(btn('Resume'));
    await tick(1000);
    expect(clock()).toBe('01:27');
  });

  it('adds and subtracts 15 seconds, never below zero', async () => {
    await render({ initialSeconds: 20 });
    await click(btn('Add 15 seconds'));
    expect(clock()).toBe('00:35');
    await click(btn('Subtract 15 seconds'));
    await click(btn('Subtract 15 seconds'));
    await click(btn('Subtract 15 seconds'));
    expect(clock()).toBe('00:00');
  });

  it('reset restarts from the interval and resumes running', async () => {
    await render();
    await click(btn('Pause'));
    await tick(1000);
    await click(btn('Reset timer'));
    expect(clock()).toBe('01:30');
    await tick(1000);
    expect(clock()).toBe('01:29');
  });

  it('presets change the interval and restart', async () => {
    await render();
    await click(btn('120s'));
    expect(clock()).toBe('02:00');
    expect(btn('120s').getAttribute('aria-pressed')).toBe('true');
    expect(btn('60s').getAttribute('aria-pressed')).toBe('false');
  });

  it('shows an announced completion state and calls onFinished once at zero', async () => {
    await render({ initialSeconds: 3 });
    await tick(3000);
    expect(clock()).toBe('00:00');
    expect(onFinished).toHaveBeenCalledTimes(1);
    const status = container.querySelector('[role="status"]')!;
    expect(status.getAttribute('aria-live')).toBe('polite');
    expect(status.textContent).toContain('Rest finished');
    // Skip becomes Done once finished
    expect(btn('Done')).toBeTruthy();
    await tick(5000);
    expect(onFinished).toHaveBeenCalledTimes(1);
  });

  it('Skip and Close both dismiss the timer', async () => {
    await render();
    await click(btn('Skip'));
    await click(btn('Close Timer'));
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('restarts when reopened with new initial seconds (workout integration)', async () => {
    await render({ initialSeconds: 60 });
    await tick(5000);
    await render({ initialSeconds: 120 });
    expect(clock()).toBe('02:00');
  });

  it('exposes progress for assistive tech', async () => {
    await render({ initialSeconds: 10 });
    await tick(5000);
    const bar = container.querySelector('[role="progressbar"]')!;
    expect(bar.getAttribute('aria-label')).toBe('Rest progress');
    expect(bar.getAttribute('aria-valuenow')).toBe('50');
  });
});
