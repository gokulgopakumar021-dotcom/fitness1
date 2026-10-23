import 'fake-indexeddb/auto';
import React, { act } from 'react';
import { createRoot, Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { BodyScanFlow } from './BodyScanFlow';
import { DEFAULT_PROFILE } from '../../storage/db';
import { getBodyScanConsent } from '../../storage/bodyScanConsent';
import { UserProfile } from '../../types';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

const render = async (profile: UserProfile) => {
  await act(async () => {
    root.render(<BodyScanFlow profile={profile} onClose={() => {}} />);
  });
};
const click = async (el: Element) => {
  await act(async () => {
    (el as HTMLElement).click();
  });
};
const byText = (tag: string, text: string) =>
  Array.from(container.querySelectorAll(tag)).find((e) => e.textContent?.includes(text)) as HTMLElement;

beforeEach(() => {
  localStorage.clear();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

describe('BodyScanFlow', () => {
  it('blocks users whose profile age is under 18 and shows no consent form', async () => {
    await render({ ...DEFAULT_PROFILE, age: 16 });
    expect(container.textContent).toContain('Body Scan is for adults');
    expect(container.querySelector('input[type="checkbox"]')).toBeNull();
  });

  it('requires both confirmations before Continue is enabled; photo storage defaults to off', async () => {
    await render({ ...DEFAULT_PROFILE, age: 30 });
    const boxes = container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]');
    expect(boxes).toHaveLength(3);
    expect(boxes[2].checked).toBe(false); // photo storage opt-in
    const cont = byText('button', 'Continue') as HTMLButtonElement;
    expect(cont.disabled).toBe(true);
    await click(boxes[0]);
    expect(cont.disabled).toBe(true);
    await click(boxes[1]);
    expect(cont.disabled).toBe(false);
  });

  it('records consent with photo storage off, then shows privacy controls', async () => {
    await render({ ...DEFAULT_PROFILE, age: 30 });
    const boxes = container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]');
    await click(boxes[0]);
    await click(boxes[1]);
    await click(byText('button', 'Continue'));
    expect(getBodyScanConsent()).toMatchObject({ ageConfirmed18Plus: true, photoStorage: false });
    expect(container.textContent).toContain('Privacy & data');
    expect(container.textContent).toContain('Camera capture and pose analysis are not');
    expect(byText('button', 'Withdraw consent and delete all Body Scan data')).toBeTruthy();
  });
});
