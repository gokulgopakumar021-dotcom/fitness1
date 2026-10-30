import React, { act } from 'react';
import { createRoot, Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AiRoutineBuilderModal } from './AiRoutineBuilderModal';
import { db, DEFAULT_PROFILE } from '../../storage/db';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

const renderModal = async (props: Partial<React.ComponentProps<typeof AiRoutineBuilderModal>> = {}) => {
  await act(async () => {
    root.render(
      <AiRoutineBuilderModal
        isOpen
        onClose={() => {}}
        profile={DEFAULT_PROFILE}
        sessions={[]}
        onStartWorkout={() => {}}
        {...props}
      />
    );
  });
};
const byText = (text: string) => {
  const el = Array.from(document.querySelectorAll('button')).find((b) => b.textContent?.trim().includes(text));
  if (!el) throw new Error(`No button containing "${text}"`);
  return el as HTMLButtonElement;
};
const click = async (el: HTMLElement) => {
  await act(async () => {
    el.click();
  });
};
const generate = async () => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
  await act(async () => {
    byText('Generate adaptive routine').click();
    await new Promise((r) => setTimeout(r, 1000));
  });
};

beforeEach(() => {
  localStorage.clear();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe('AiRoutineBuilderModal', () => {
  it('renders nothing when closed and an accessible dialog when open', async () => {
    await renderModal({ isOpen: false });
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    await renderModal();
    const dialog = document.querySelector('[role="dialog"]');
    expect(dialog?.textContent).toContain('AI routine builder');
    expect(dialog?.getAttribute('aria-modal')).toBe('true');
  });

  it('closes on Escape and via the close button', async () => {
    const onClose = vi.fn();
    await renderModal({ onClose });
    await act(async () => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    });
    await click(document.querySelector('button[aria-label="Close"]') as HTMLElement);
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('keeps at least one gear type selected and marks selection with aria-pressed', async () => {
    await renderModal();
    await click(byText('Bodyweight Only'));
    const pressed = () =>
      Array.from(document.querySelectorAll('button[aria-pressed="true"]')).map((b) => b.textContent?.trim());
    expect(pressed().some((t) => t?.startsWith('Bodyweight Only'))).toBe(true);
    // bodyweight is the only selected gear: toggling it off must be ignored
    await click(byText('Bodyweight / Pull-Up Bar'));
    expect(document.querySelectorAll('button[aria-pressed="true"]').length).toBeGreaterThan(0);
    expect(byText('Bodyweight / Pull-Up Bar').getAttribute('aria-pressed')).toBe('true');
  });

  it('generates an offline routine when the API fails, and edits sets within limits', async () => {
    await renderModal();
    await generate();
    const dialog = document.querySelector('[role="dialog"]')!;
    expect(dialog.textContent).toContain('Adaptive Engine');
    const firstName = dialog.querySelector('h4')!.textContent!;
    const dec = document.querySelector(`button[aria-label="Decrease sets for ${firstName}"]`) as HTMLButtonElement;
    const inc = document.querySelector(`button[aria-label="Increase sets for ${firstName}"]`) as HTMLButtonElement;
    const before = Number(dec.parentElement!.textContent!.match(/(\d+) sets/)![1]);
    await click(inc);
    expect(Number(dec.parentElement!.textContent!.match(/(\d+) sets/)![1])).toBe(Math.min(8, before + 1));
    for (let i = 0; i < 10; i++) await click(dec);
    expect(dec.parentElement!.textContent).toContain('1 sets');
    expect(dec.disabled).toBe(true);
  });

  it('removes exercises but never the last one', async () => {
    await renderModal();
    await generate();
    const count = () => document.querySelectorAll('[role="dialog"] h4').length;
    expect(count()).toBeGreaterThan(1);
    while (count() > 1) {
      const btn = document.querySelector('button[aria-label^="Remove "]') as HTMLButtonElement;
      await click(btn);
    }
    expect(count()).toBe(1);
    expect((document.querySelector('button[aria-label^="Remove "]') as HTMLButtonElement).disabled).toBe(true);
  });

  it('saves the routine to plans and reports it', async () => {
    const onPlanSaved = vi.fn();
    await renderModal({ onPlanSaved });
    await generate();
    const before = db.getPlans().length;
    await click(byText('Save to my plans'));
    expect(db.getPlans().length).toBe(before + 1);
    expect(onPlanSaved).toHaveBeenCalledTimes(1);
    expect(document.body.textContent).toContain('Saved to my plans');
  });

  it('starts the workout: saves the active session, notifies the parent and closes', async () => {
    const onStartWorkout = vi.fn();
    const onClose = vi.fn();
    await renderModal({ onStartWorkout, onClose });
    await generate();
    await click(byText('Start workout now'));
    expect(onStartWorkout).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(db.getActiveSession()).toBeTruthy();
  });
});
