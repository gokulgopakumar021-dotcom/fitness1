import React, { act } from 'react';
import { createRoot, Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { BodyScanFlow } from './BodyScanFlow';
import { AgeEligibilityContext } from '../../context/AgeEligibilityContext';
import { DEFAULT_PROFILE } from '../../storage/db';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;
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

const render = async (status?: 'loading' | 'declared' | 'unknown' | 'unavailable', age = 30) => {
  const flow = <BodyScanFlow profile={{ ...DEFAULT_PROFILE, age }} onClose={() => {}} />;
  await act(async () => {
    root.render(status ? <AgeEligibilityContext.Provider value={{ status, declare: async () => true }}>{flow}</AgeEligibilityContext.Provider> : flow);
  });
};
const has = (id: string) => container.querySelector(`[data-testid="${id}"]`) !== null;

describe('Body Scan is closed unless the database holds this account\'s 18+ declaration', () => {
  it.each(['loading', 'unknown', 'unavailable'] as const)('status "%s": blocked, no consent step, no camera, no capture UI', async (status) => {
    await render(status);
    expect(has('bodyscan-age-unconfirmed')).toBe(true);
    expect(container.textContent).toContain('Body Scan needs your 18+ confirmation');
    expect(container.querySelector('video')).toBeNull();
    expect(container.textContent).not.toMatch(/I confirm I am 18/i);
  });

  it('is blocked with NO provider at all (the default is fail closed)', async () => {
    await render(undefined);
    expect(has('bodyscan-age-unconfirmed')).toBe(true);
  });

  it('a profile age of 99 and stored consent in localStorage do not open it', async () => {
    localStorage.setItem('ironlog_body_scan_consent', JSON.stringify({ version: 1, ageConfirmed18Plus: true, limitsAcknowledged: true, photoStorage: false, acceptedAt: '2026-10-23T00:00:00.000Z' }));
    await render('unknown', 99);
    expect(has('bodyscan-age-unconfirmed')).toBe(true);
  });

  it('once declared, the normal flow continues (consent step) and the age block is gone', async () => {
    await render('declared');
    expect(has('bodyscan-age-unconfirmed')).toBe(false);
  });
});
