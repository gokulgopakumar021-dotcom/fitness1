import React, { act } from 'react';
import { createRoot, Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Input, Select } from './Input';
import { Button } from './Button';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;
const render = async (node: React.ReactNode) => {
  await act(async () => root.render(node));
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

describe('additive density options (workout set rows)', () => {
  it('Input default is unchanged; compact keeps the 44px height with tight padding and centered text', async () => {
    await render(
      <>
        <Input aria-label="a" />
        <Input aria-label="b" compact />
      </>
    );
    const [a, b] = Array.from(container.querySelectorAll('input'));
    expect(a.className).toContain('h-11');
    expect(a.className).toContain('px-3');
    expect(a.className).not.toContain('text-center');
    expect(b.className).toContain('h-11');
    expect(b.className).toContain('px-1');
    expect(b.className).toContain('text-center');
    expect(b.className).not.toContain('px-3');
  });

  it('Select default is unchanged; compact is available', async () => {
    await render(
      <>
        <Select aria-label="a" />
        <Select aria-label="b" compact />
      </>
    );
    const [a, b] = Array.from(container.querySelectorAll('select'));
    expect(a.className).toContain('px-3');
    expect(b.className).toContain('px-1');
    expect(b.className).toContain('h-11');
  });

  it('Button iconOnly is a 44px square at md; existing sizes are unchanged', async () => {
    await render(
      <>
        <Button iconOnly aria-label="i" />
        <Button size="sm">s</Button>
        <Button>m</Button>
        <Button size="lg">l</Button>
      </>
    );
    const [i, s, m, l] = Array.from(container.querySelectorAll('button'));
    expect(i.className).toContain('h-11');
    expect(i.className).toContain('w-11');
    expect(s.className).toContain('h-9');
    expect(m.className).toContain('h-11');
    expect(l.className).toContain('h-12');
  });
});
