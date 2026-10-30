import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it } from 'vitest';
import { LineChart } from './Charts';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const ticks = async (props: Partial<React.ComponentProps<typeof LineChart>>) => {
  const el = document.createElement('div');
  document.body.appendChild(el);
  const root = createRoot(el);
  const data = [
    { date: '2026-10-01', value: 80.1 },
    { date: '2026-10-02', value: 80.3 },
    { date: '2026-10-03', value: 80.2 }
  ];
  await act(async () => root.render(<LineChart data={data} unit="kg" {...props} />));
  const out = Array.from(el.querySelectorAll('text')).map((t) => t.textContent ?? '');
  await act(async () => root.unmount());
  el.remove();
  return out;
};

describe('LineChart y-axis options', () => {
  it('keeps whole-number labels by default (unchanged for other screens)', async () => {
    const labels = await ticks({});
    expect(labels.some((l) => /^\d+$/.test(l))).toBe(true);
  });
  it('widens a tiny range and labels ticks with decimals so they are not repeated', async () => {
    const labels = (await ticks({ minYSpan: 4, yTickDecimals: 1 })).filter((l) => /^\d+\.\d$/.test(l));
    expect(labels).toHaveLength(4);
    expect(new Set(labels).size).toBe(4);
    const span = Number(labels[labels.length - 1]) - Number(labels[0]);
    expect(Math.abs(span)).toBeGreaterThanOrEqual(4);
  });
});
