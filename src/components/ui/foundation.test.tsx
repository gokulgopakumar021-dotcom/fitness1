import React, { act } from 'react';
import { createRoot, Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Input, Select, Textarea } from './Input';
import { ErrorState } from './ErrorState';
import { LoadingState } from './LoadingState';
import { Card } from './Card';
import { LineChart } from '../common/Charts';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;
const render = async (node: React.ReactNode) => {
  await act(async () => {
    root.render(node);
  });
};

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

describe('form controls', () => {
  it('associates the label with the input', async () => {
    await render(<Input label="Weight" defaultValue="80" />);
    const input = container.querySelector('input')!;
    const label = container.querySelector('label')!;
    expect(label.htmlFor).toBe(input.id);
    expect(input.id).not.toBe('');
  });

  it('shows the hint and wires aria-describedby', async () => {
    await render(<Input label="Reps" hint="Per set" />);
    const input = container.querySelector('input')!;
    expect(container.textContent).toContain('Per set');
    expect(input.getAttribute('aria-describedby')).toBe(`${input.id}-msg`);
    expect(input.hasAttribute('aria-invalid')).toBe(false);
  });

  it('error replaces the hint, is announced, and marks the control invalid', async () => {
    await render(<Input label="Reps" hint="Per set" error="Enter a number" />);
    const input = container.querySelector('input')!;
    expect(container.textContent).not.toContain('Per set');
    expect(container.querySelector('[role="alert"]')?.textContent).toBe('Enter a number');
    expect(input.getAttribute('aria-invalid')).toBe('true');
  });

  it('forwards native props and honours a caller-supplied id', async () => {
    const onChange = vi.fn();
    await render(<Input id="kg" label="Kg" type="number" inputMode="decimal" onChange={onChange} />);
    const input = container.querySelector('input')!;
    expect(input.id).toBe('kg');
    expect(input.type).toBe('number');
    expect(input.getAttribute('inputmode')).toBe('decimal');
  });

  it('Select and Textarea render labelled controls', async () => {
    await render(
      <>
        <Select label="Sex" defaultValue="m">
          <option value="m">Male</option>
          <option value="f">Female</option>
        </Select>
        <Textarea label="Notes" rows={4} />
      </>
    );
    expect(container.querySelector('select')?.id).toBeTruthy();
    expect(container.querySelector('textarea')?.getAttribute('rows')).toBe('4');
    expect(container.querySelectorAll('label')).toHaveLength(2);
  });
});

describe('state blocks', () => {
  it('ErrorState is an alert and renders its action', async () => {
    const onRetry = vi.fn();
    await render(<ErrorState description="Check your connection" action={<button onClick={onRetry}>Retry</button>} />);
    const alert = container.querySelector('[role="alert"]')!;
    expect(alert.textContent).toContain('Something went wrong');
    expect(alert.textContent).toContain('Check your connection');
    await act(async () => container.querySelector('button')!.click());
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('LoadingState is a polite status region', async () => {
    await render(<LoadingState label="Fetching sets" />);
    const status = container.querySelector('[role="status"]')!;
    expect(status.getAttribute('aria-live')).toBe('polite');
    expect(status.textContent).toBe('Fetching sets');
  });
});

describe('Card', () => {
  it('uses the shared card radius token and only becomes tappable when interactive', async () => {
    await render(
      <>
        <Card data-testid="plain">a</Card>
        <Card data-testid="tap" interactive>b</Card>
      </>
    );
    const plain = container.querySelector('[data-testid="plain"]')!;
    const tap = container.querySelector('[data-testid="tap"]')!;
    expect(plain.className).toContain('rounded-card');
    expect(plain.className).not.toContain('cursor-pointer');
    expect(tap.className).toContain('cursor-pointer');
  });
});

describe('LineChart theming', () => {
  const data = [
    { date: '2026-10-01', value: 80 },
    { date: '2026-10-02', value: 81 },
    { date: '2026-10-03', value: 80.5 },
  ];

  it('uses theme tokens, not hard-coded hex, by default', async () => {
    await render(<LineChart data={data} />);
    expect(container.innerHTML).toContain('var(--chart-1)');
    expect(container.innerHTML).not.toMatch(/#[0-9a-fA-F]{6}/);
  });

  it('gives each chart its own gradient id', async () => {
    await render(
      <>
        <LineChart data={data} />
        <LineChart data={data} />
      </>
    );
    const ids = Array.from(container.querySelectorAll('linearGradient')).map((g) => g.id);
    expect(ids).toHaveLength(2);
    expect(new Set(ids).size).toBe(2);
  });
});
