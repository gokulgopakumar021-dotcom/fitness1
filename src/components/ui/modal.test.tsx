import React, { act, useState } from 'react';
import { createRoot, Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Modal } from './Modal';
import { Button } from './Button';

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

describe('Modal', () => {
  it('keeps focus in the field being typed in when the parent re-renders with an inline onClose', async () => {
    const Host: React.FC = () => {
      const [open, setOpen] = useState(true);
      const [text, setText] = useState('');
      return (
        <Modal open={open} onClose={() => setOpen(false)} title="Dialog">
          <input aria-label="name" value={text} onChange={(e) => setText(e.target.value)} />
        </Modal>
      );
    };
    await act(async () => {
      root.render(<Host />);
    });
    const input = document.querySelector('input[aria-label="name"]') as HTMLInputElement;
    await act(async () => {
      input.focus();
    });
    expect(document.activeElement).toBe(input);

    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    for (const ch of ['a', 'ab', 'abc']) {
      await act(async () => {
        setter.call(input, ch);
        input.dispatchEvent(new Event('input', { bubbles: true }));
      });
      expect(document.activeElement).toBe(input);
    }
    expect(input.value).toBe('abc');
  });

  it('still closes on Escape using the latest onClose', async () => {
    const first = vi.fn();
    const second = vi.fn();
    await act(async () => {
      root.render(<Modal open onClose={first} title="T">x</Modal>);
    });
    await act(async () => {
      root.render(<Modal open onClose={second} title="T">x</Modal>);
    });
    await act(async () => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    });
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });

  it('closeLabel names the close button and sets its tooltip', async () => {
    await act(async () => {
      root.render(<Modal open onClose={() => {}} title="T" closeLabel="Close Wizard">x</Modal>);
    });
    const btn = document.querySelector('button[aria-label="Close Wizard"]') as HTMLButtonElement;
    expect(btn.title).toBe('Close Wizard');
  });

  it.each([
    ['sm', 'sm:max-w-md'],
    ['md', 'sm:max-w-lg'],
    ['lg', 'sm:max-w-2xl'],
    ['xl', 'sm:max-w-4xl'],
  ] as const)('size %s sets the panel max width', async (size, cls) => {
    await act(async () => {
      root.render(<Modal open onClose={() => {}} title="T" size={size}>x</Modal>);
    });
    expect((document.querySelector('[role="dialog"]') as HTMLElement).className).toContain(cls);
  });
});

describe('Button iconOnly', () => {
  it('renders a square 44px control without horizontal padding', async () => {
    await act(async () => {
      root.render(<Button iconOnly aria-label="x">i</Button>);
    });
    const cls = (container.querySelector('button') as HTMLButtonElement).className;
    expect(cls).toContain('h-11');
    expect(cls).toContain('w-11');
    expect(cls).not.toContain('px-4');
  });
});
