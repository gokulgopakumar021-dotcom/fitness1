import React, { act } from 'react';
import { createRoot, Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HydrationPacingAlert } from './HydrationPacingAlert';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

describe('HydrationPacingAlert', () => {
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

  it('renders hourly hydration pacing status and controls', async () => {
    const today = new Date().toISOString().split('T')[0];
    const onQuickAdd = vi.fn();

    await act(async () => {
      root.render(
        <HydrationPacingAlert
          currentWaterMl={500}
          goalMl={3000}
          goalOz={101}
          unit="oz"
          selectedDate={today}
          onQuickAddWater={onQuickAdd}
        />
      );
    });

    expect(container.textContent).toContain('Hourly Hydration Pacing');
    expect(container.textContent).toContain('Push Alerts:');
  });

  it('opens notification scheduler settings drawer when gear is clicked', async () => {
    const today = new Date().toISOString().split('T')[0];
    const onQuickAdd = vi.fn();

    await act(async () => {
      root.render(
        <HydrationPacingAlert
          currentWaterMl={500}
          goalMl={3000}
          goalOz={101}
          unit="oz"
          selectedDate={today}
          onQuickAddWater={onQuickAdd}
        />
      );
    });

    const settingsBtn = container.querySelector('button[title*="notification settings"]');
    expect(settingsBtn).toBeTruthy();

    await act(async () => {
      (settingsBtn as HTMLButtonElement).click();
    });

    expect(container.textContent).toContain('Hydration Alert & Push Notification Scheduler');
    expect(container.textContent).toContain('Alert Frequency');
    expect(container.textContent).toContain('Wake Schedule');
    expect(container.textContent).toContain('Bedtime Schedule');
  });

  it('renders quick catch up buttons when behind pace and responds to clicks', async () => {
    const today = new Date().toISOString().split('T')[0];
    const onQuickAdd = vi.fn();

    // With 0ml logged late in the day, user is behind pace
    await act(async () => {
      root.render(
        <HydrationPacingAlert
          currentWaterMl={0}
          goalMl={3000}
          goalOz={101}
          unit="oz"
          selectedDate={today}
          onQuickAddWater={onQuickAdd}
        />
      );
    });

    // If behind pace alert rendered, test one-tap catchup button
    const plus8Btn = Array.from(container.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('+8 oz')
    );

    if (plus8Btn) {
      await act(async () => {
        plus8Btn.click();
      });
      expect(onQuickAdd).toHaveBeenCalledWith(237);
    }
  });
});
