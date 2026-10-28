import React, { act } from 'react';
import { createRoot, Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HydrationHistoryChart } from './HydrationHistoryChart';
import { db, DEFAULT_PROFILE } from '../../storage/db';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

// Mock recharts ResponsiveContainer so it renders dimensions in jsdom
vi.mock('recharts', async () => {
  const original = await vi.importActual<any>('recharts');
  return {
    ...original,
    ResponsiveContainer: ({ children }: { children: React.ReactNode }) => (
      <div style={{ width: 500, height: 300 }}>{children}</div>
    )
  };
});

describe('HydrationHistoryChart', () => {
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

  it('renders 7-day hydration history header and metrics', async () => {
    const today = '2026-10-28';

    await act(async () => {
      root.render(
        <HydrationHistoryChart
          selectedDate={today}
          currentWaterMl={2500}
          goalMl={3000}
          goalOz={101}
          unit="oz"
        />
      );
    });

    expect(container.textContent).toContain('Last 7 Days Hydration History');
    expect(container.textContent).toContain('7-Day Daily Avg');
    expect(container.textContent).toContain('Goal Hit Rate');
    expect(container.textContent).toContain('Profile Target Line');
  });

  it('switches units to ml properly and renders profile-based target line', async () => {
    const today = '2026-10-28';

    await act(async () => {
      root.render(
        <HydrationHistoryChart
          selectedDate={today}
          currentWaterMl={3200}
          goalMl={3000}
          goalOz={101}
          unit="ml"
          profile={{
            ...DEFAULT_PROFILE,
            currentWeightKg: 85,
            trainingDaysPerWeek: 5
          }}
        />
      );
    });

    expect(container.textContent).toContain('Milliliters (ml)');
    expect(container.textContent).toContain('Profile Target Line: 3000 ml');
    expect(container.textContent).toContain('85 kg · 5 sessions/wk');
  });
});
