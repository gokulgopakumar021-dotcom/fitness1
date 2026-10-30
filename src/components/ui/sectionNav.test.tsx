import React, { act } from 'react';
import { createRoot, Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SectionNav } from './SectionNav';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

const items = [
  { id: 'a', label: 'Alpha' },
  { id: 'b', label: 'Beta', icon: <svg data-testid="icon" /> }
];

describe('SectionNav', () => {
  it('marks the active item, names the landmark, and reports selection', async () => {
    const onChange = vi.fn();
    await act(async () => root.render(<SectionNav items={items} value="a" onChange={onChange} ariaLabel="Sections" />));
    const nav = container.querySelector('nav[aria-label="Sections"]');
    expect(nav).not.toBeNull();
    const buttons = Array.from(container.querySelectorAll('button'));
    expect(buttons.map((b) => b.getAttribute('aria-current'))).toEqual(['true', null]);
    await act(async () => buttons[1].click());
    expect(onChange).toHaveBeenCalledWith('b');
  });

  it('keeps icons out of the accessible name and scrolls the active item into view when supported', async () => {
    const scroll = vi.fn();
    (HTMLElement.prototype as unknown as { scrollIntoView: unknown }).scrollIntoView = scroll;
    await act(async () => root.render(<SectionNav items={items} value="b" onChange={() => {}} ariaLabel="Sections" />));
    expect(container.querySelector('[data-testid="icon"]')?.parentElement?.getAttribute('aria-hidden')).toBe('true');
    expect(scroll).toHaveBeenCalled();
    delete (HTMLElement.prototype as unknown as { scrollIntoView?: unknown }).scrollIntoView;
  });
});
