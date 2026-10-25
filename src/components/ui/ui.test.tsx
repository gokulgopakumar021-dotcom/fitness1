import React, { act } from 'react';
import { createRoot, Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ProgressBar } from './ProgressBar';
import { Modal } from './Modal';
import { Button } from './Button';
import { SegmentedControl } from './SegmentedControl';
import { NAV_GROUPS, NAV_ITEMS } from '../layout/Navbar';

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
  document.body.style.overflow = '';
});

describe('ProgressBar', () => {
  it('exposes progressbar semantics and clamps the visual width', async () => {
    await render(<ProgressBar value={250} max={100} label="Calories" />);
    const bar = container.querySelector('[role="progressbar"]') as HTMLElement;
    expect(bar.getAttribute('aria-valuenow')).toBe('100');
    expect(bar.getAttribute('aria-label')).toBe('Calories');
    expect((bar.firstElementChild as HTMLElement).style.width).toBe('100%');
  });

  it('never renders a negative width or divides by zero', async () => {
    await render(<ProgressBar value={-5} max={0} />);
    const bar = container.querySelector('[role="progressbar"]') as HTMLElement;
    expect((bar.firstElementChild as HTMLElement).style.width).toBe('0%');
  });
});

describe('Modal', () => {
  it('renders nothing when closed', async () => {
    await render(<Modal open={false} onClose={() => {}} title="T">x</Modal>);
    expect(container.querySelector('[role="dialog"]')).toBeNull();
  });

  it('is an accessible dialog, locks scroll, and closes on Escape', async () => {
    const onClose = vi.fn();
    await render(<Modal open onClose={onClose} title="Settings sheet">body</Modal>);
    const dialog = document.querySelector('[role="dialog"]') as HTMLElement;
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(document.getElementById(dialog.getAttribute('aria-labelledby')!)?.textContent).toBe('Settings sheet');
    expect(document.body.style.overflow).toBe('hidden');
    await act(async () => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('restores body scroll when closed', async () => {
    await render(<Modal open onClose={() => {}} title="T">x</Modal>);
    await render(<Modal open={false} onClose={() => {}} title="T">x</Modal>);
    expect(document.body.style.overflow).toBe('');
  });
});

describe('Button', () => {
  it('defaults to type=button and is disabled + busy while loading', async () => {
    const onClick = vi.fn();
    await render(<Button loading onClick={onClick}>Save</Button>);
    const btn = container.querySelector('button') as HTMLButtonElement;
    expect(btn.type).toBe('button');
    expect(btn.disabled).toBe(true);
    expect(btn.getAttribute('aria-busy')).toBe('true');
    btn.click();
    expect(onClick).not.toHaveBeenCalled();
  });
});

describe('SegmentedControl', () => {
  it('marks the active option and reports changes', async () => {
    const onChange = vi.fn();
    await render(
      <SegmentedControl
        ariaLabel="Period"
        value="7d"
        onChange={onChange}
        options={[{ value: '7d', label: '7 days' }, { value: '30d', label: '30 days' }]}
      />
    );
    const [a, b] = Array.from(container.querySelectorAll('button'));
    expect(a.getAttribute('aria-pressed')).toBe('true');
    expect(b.getAttribute('aria-pressed')).toBe('false');
    await act(async () => b.click());
    expect(onChange).toHaveBeenCalledWith('30d');
  });
});

describe('navigation structure', () => {
  it('lists every tab exactly once in the desktop groups', () => {
    const grouped = NAV_GROUPS.flatMap((g) => g.items).sort();
    const all = NAV_ITEMS.map((i) => i.id).sort();
    expect(grouped).toEqual(all);
    expect(new Set(grouped).size).toBe(grouped.length);
  });
});
