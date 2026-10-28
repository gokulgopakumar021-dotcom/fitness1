import React, { act } from 'react';
import { createRoot, Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  SmartAlertsConfigModal,
  DEFAULT_SMART_ALERTS_CONFIG,
  SmartAlertsConfig
} from './SmartAlertsConfigModal';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

describe('SmartAlertsConfigModal', () => {
  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    localStorage.clear();
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
  });

  it('renders time zone selector, activity levels, and quiet hours inputs', async () => {
    const onSave = vi.fn();
    const onClose = vi.fn();

    await act(async () => {
      root.render(
        <SmartAlertsConfigModal
          isOpen={true}
          onClose={onClose}
          config={DEFAULT_SMART_ALERTS_CONFIG}
          onSaveConfig={onSave}
        />
      );
    });

    expect(container.textContent).toContain('Smart Alerts Configuration');
    expect(container.textContent).toContain('1. Time Zone Configuration');
    expect(container.textContent).toContain('2. Daily Activity Level & Pacing Cadence');
    expect(container.textContent).toContain('3. Custom Quiet Hours (Suppress All Alerts)');
    expect(container.textContent).toContain('4. Specific Notification Types');
    expect(container.textContent).toContain('Hourly Pacing Lag Alert');
    expect(container.textContent).toContain('Midday Progress Check-In');
    expect(container.textContent).toContain('Pre-Workout Hydration Primer');
  });

  it('allows changing activity level and saving', async () => {
    const onSave = vi.fn();
    const onClose = vi.fn();

    await act(async () => {
      root.render(
        <SmartAlertsConfigModal
          isOpen={true}
          onClose={onClose}
          config={DEFAULT_SMART_ALERTS_CONFIG}
          onSaveConfig={onSave}
        />
      );
    });

    const heavyBtn = Array.from(container.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('Heavy Lift')
    );
    expect(heavyBtn).toBeTruthy();

    await act(async () => {
      heavyBtn?.click();
    });

    const saveBtn = Array.from(container.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('Save Smart Alerts')
    );
    expect(saveBtn).toBeTruthy();

    await act(async () => {
      saveBtn?.click();
    });

    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        activityLevel: 'heavy'
      })
    );
    expect(onClose).toHaveBeenCalled();
  });
});
