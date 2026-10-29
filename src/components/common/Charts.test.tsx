import React, { act } from 'react';
import { createRoot, Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { BarChart, LineChart } from './Charts';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;
const render = async (node: React.ReactNode) => {
  await act(async () => {
    root.render(node);
  });
};

const points = [
  { date: '2026-10-01', value: 60 },
  { date: '2026-10-08', value: 62.5 },
  { date: '2026-10-15', value: 65 }
];

describe('shared charts', () => {
  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });
  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it('LineChart keeps the fixed 600-unit viewBox unless `responsive` is set', async () => {
    await render(<LineChart data={points} title="Load" unit="kg" />);
    expect(container.querySelector('svg')!.getAttribute('viewBox')).toBe('0 0 600 200');
  });

  it('LineChart exposes a text summary for assistive tech', async () => {
    await render(<LineChart data={points} title="Load" unit="kg" />);
    expect(container.querySelector('svg')!.getAttribute('aria-label')).toBe('Load: 3 points, latest 65 kg');
  });

  it('LineChart shows a point value on tap and hides it on a second tap', async () => {
    await render(<LineChart data={points} title="Load" unit="kg" />);
    const target = container.querySelector('[data-chart-point="1"]')!;
    await act(async () => {
      target.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(container.textContent).toContain('2026-10-08:');
    expect(container.textContent).toContain('62.5 kg');
    await act(async () => {
      target.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(container.textContent).not.toContain('2026-10-08:');
  });

  it('BarChart shows every label by default and thins them when maxLabels is set', async () => {
    const bars = Array.from({ length: 12 }, (_, i) => ({ label: `L${i}`, value: 100 + i }));
    await render(<BarChart data={bars} title="Volume" unit="kg" />);
    const labelsAll = Array.from(container.querySelectorAll('[role="listitem"] > span')).map((s) => s.textContent);
    expect(labelsAll.filter(Boolean).length).toBe(12);

    await render(<BarChart data={bars} title="Volume" unit="kg" maxLabels={6} />);
    const labelsThin = Array.from(container.querySelectorAll('[role="listitem"] > span')).map((s) => s.textContent);
    expect(labelsThin.filter(Boolean).length).toBeLessThan(12);
    expect(labelsThin[labelsThin.length - 1]).toBe('L11'); // last label always kept
    expect(container.querySelectorAll('[role="listitem"]').length).toBe(12); // no bars removed
  });

  it('BarChart bars are keyboard focusable and describe their value', async () => {
    await render(<BarChart data={[{ label: '10-01', value: 1440 }]} unit="kg" />);
    const bar = container.querySelector('[role="listitem"]')!;
    expect(bar.getAttribute('tabindex')).toBe('0');
    expect(bar.getAttribute('aria-label')).toBe('10-01: 1440 kg');
  });

  it('BarChart bar track takes the column height (flex-1, min-h-0) so bars have a height to fill', async () => {
    await render(<BarChart data={[{ label: 'a', value: 50 }]} />);
    const track = container.querySelector('[role="listitem"]')!.children[1] as HTMLElement;
    expect(track.className).toContain('flex-1');
    expect(track.className).toContain('min-h-0');
  });
});
