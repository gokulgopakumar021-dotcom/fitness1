import React, { act } from 'react';
import { createRoot, Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FloatingTrainerWidget } from './FloatingTrainerWidget';
import { DEFAULT_PROFILE } from '../../storage/db';
import { UserProfile, WorkoutSession } from '../../types';
import { BluetoothGadgetProvider } from '../../context/BluetoothGadgetContext';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

const mockProfile: UserProfile = {
  ...DEFAULT_PROFILE,
  name: 'Marcus Vance'
};

const renderWidget = async (overrides: Partial<React.ComponentProps<typeof FloatingTrainerWidget>> = {}) => {
  const props = {
    currentTab: 'home' as const,
    onNavigate: vi.fn(),
    activeSession: null,
    profile: mockProfile,
    ...overrides
  };

  await act(async () => {
    root.render(
      <BluetoothGadgetProvider profile={props.profile}>
        <FloatingTrainerWidget {...props} />
      </BluetoothGadgetProvider>
    );
  });

  return props;
};

describe('FloatingTrainerWidget Component', () => {
  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
  });

  it('does not render when on the trainer tab', async () => {
    await renderWidget({ currentTab: 'trainer' });
    expect(container.textContent).toBe('');
  });

  it('renders floating Ask Coach button on other tabs', async () => {
    await renderWidget({ currentTab: 'home' });
    expect(container.textContent).toContain('Ask Coach');
  });

  it('opens quick assist drawer when floating button is clicked', async () => {
    await renderWidget({ currentTab: 'home' });

    const openBtn = container.querySelector('button[aria-label="Ask Coach Iron"]');
    expect(openBtn).toBeDefined();

    await act(async () => {
      openBtn?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(container.textContent).toContain('Coach Iron · Quick Assist');
    expect(container.textContent).toContain('Form check cue');
    expect(container.textContent).toContain('Should I increase weight?');
    expect(container.textContent).toContain('Full View →');
  });

  it('navigates to trainer tab when Full View is clicked', async () => {
    const onNavigate = vi.fn();
    await renderWidget({ currentTab: 'home', onNavigate });

    const openBtn = container.querySelector('button[aria-label="Ask Coach Iron"]');
    await act(async () => {
      openBtn?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    const fullViewBtn = Array.from(container.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('Full View')
    );
    expect(fullViewBtn).toBeDefined();

    await act(async () => {
      fullViewBtn?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(onNavigate).toHaveBeenCalledWith('trainer');
  });

  it('closes quick assist drawer when close button is clicked', async () => {
    await renderWidget({ currentTab: 'home' });

    const openBtn = container.querySelector('button[aria-label="Ask Coach Iron"]');
    await act(async () => {
      openBtn?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(container.textContent).toContain('Coach Iron · Quick Assist');

    const closeBtn = container.querySelector('button[aria-label="Close quick assist"]');
    expect(closeBtn).toBeDefined();

    await act(async () => {
      closeBtn?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(container.textContent).not.toContain('Coach Iron · Quick Assist');
    expect(container.textContent).toContain('Ask Coach');
  });
});
