import 'fake-indexeddb/auto';
import React, { act } from 'react';
import { createRoot, Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BodyScanFlow } from './BodyScanFlow';
import { DEFAULT_PROFILE } from '../../storage/db';
import { getBodyScanConsent } from '../../storage/bodyScanConsent';
import { listScans, getStorageSummary } from '../../storage/bodyScanStore';
import { installFakeCamera, type FakeCamera } from '../../services/fakeMedia.testutil';
import { UserProfile } from '../../types';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;
let cam: FakeCamera;

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
  cam = installFakeCamera();
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
  (URL as unknown as Record<string, unknown>).createObjectURL = vi.fn(() => 'blob:fake');
  (URL as unknown as Record<string, unknown>).revokeObjectURL = vi.fn();
  localStorage.clear();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  cam.uninstall();
  delete (URL as unknown as Record<string, unknown>).createObjectURL;
  delete (URL as unknown as Record<string, unknown>).revokeObjectURL;
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
    expect(container.textContent).toContain('Photo capture is available as a preview');
    expect(container.textContent).toContain('does not complete a scan');
    expect(byText('button', 'Withdraw consent and delete all Body Scan data')).toBeTruthy();
  });
});

const flush = () =>
  act(async () => {
    await new Promise<void>((r) => setTimeout(r, 0));
  });

/** Gets through the consent screen the way a user does. */
const giveConsent = async () => {
  await render({ ...DEFAULT_PROFILE, age: 30 });
  const boxes = container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]');
  await click(boxes[0]);
  await click(boxes[1]);
  await click(byText('button', 'Continue'));
};

describe('BodyScanFlow: camera capture (Phase 2B)', () => {
  it('does not touch the camera at any point before the person explicitly turns it on', async () => {
    await render({ ...DEFAULT_PROFILE, age: 30 }); // consent screen
    expect(cam.getUserMedia).not.toHaveBeenCalled();
    await giveConsent();
    expect(byText('button', 'Take front photo')).toBeTruthy();
    expect(byText('button', 'Take side photo')).toBeTruthy();
    expect(cam.getUserMedia).not.toHaveBeenCalled();
    await click(byText('button', 'Take front photo'));
    expect(container.textContent).toContain('How to take your front photo');
    expect(cam.getUserMedia).not.toHaveBeenCalled(); // still off until "Turn on camera"
    await click(byText('button', 'Turn on camera'));
    expect(cam.getUserMedia).toHaveBeenCalledTimes(1);
  });

  it('offers no capture to users who are under 18 or have not consented', async () => {
    await render({ ...DEFAULT_PROFILE, age: 16 });
    expect(byText('button', 'Take front photo')).toBeUndefined();
    await act(async () => root.unmount());
    root = createRoot(container);
    await render({ ...DEFAULT_PROFILE, age: 30 }); // consent not yet given
    expect(byText('button', 'Take front photo')).toBeUndefined();
    expect(byText('button', 'Turn on camera')).toBeUndefined();
  });

  it('leaving Body Scan while the camera is on releases the camera', async () => {
    await giveConsent();
    await click(byText('button', 'Take front photo'));
    await click(byText('button', 'Turn on camera'));
    await flush();
    expect(cam.streams[0].allStopped).toBe(false);
    await act(async () => root.unmount());
    expect(cam.streams[0].allStopped).toBe(true);
    root = createRoot(container);
  });

  it('Cancel releases the camera and returns to the photo list', async () => {
    await giveConsent();
    await click(byText('button', 'Take side photo'));
    await click(byText('button', 'Turn on camera'));
    await flush();
    await click(container.querySelector('button[aria-label^="Cancel"]')!);
    expect(cam.streams[0].allStopped).toBe(true);
    expect(byText('button', 'Take front photo')).toBeTruthy();
    expect(container.textContent).toContain('Not taken');
  });

  it('a captured photo is kept only in memory, is not a "scan", and nothing is persisted', async () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(
      (() => ({ drawImage: vi.fn() })) as unknown as HTMLCanvasElement['getContext']
    );
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(function (this: HTMLCanvasElement, cb: BlobCallback) {
      cb(new Blob(['jpeg'], { type: 'image/jpeg' }));
    });
    await giveConsent();
    const storageKeysBefore = Object.keys(localStorage).sort(); // only the consent record at this point
    // Consent to photo storage is deliberately NOT given here: photos must be discarded regardless in this phase.
    await click(byText('button', 'Take front photo'));
    await click(byText('button', 'Turn on camera'));
    await flush();
    const v = container.querySelector('video')!;
    Object.defineProperty(v, 'videoWidth', { configurable: true, value: 720 });
    Object.defineProperty(v, 'videoHeight', { configurable: true, value: 1280 });
    Object.defineProperty(v, 'readyState', { configurable: true, value: 4 });
    await act(async () => {
      v.dispatchEvent(new Event('loadeddata'));
    });
    await click(byText('button', 'Take photo'));
    await flush();
    await click(byText('button', 'Use this photo'));

    expect(container.textContent).toContain('Taken (temporary)');
    expect(container.textContent).toContain('Retake front photo');
    expect(container.textContent).not.toMatch(/scan (is )?complete|successfully|analysis complete/i);
    expect(container.textContent).toContain('does not complete a scan');
    expect(cam.streams[0].allStopped).toBe(true);

    expect(await listScans()).toEqual([]);
    expect(await getStorageSummary()).toMatchObject({ scanCount: 0, photoCount: 0 });
    expect(Object.keys(localStorage).sort()).toEqual(storageKeysBefore); // capture added no localStorage entries

    await click(byText('button', 'Discard these photos'));
    expect(container.textContent).not.toContain('Taken (temporary)');
  });
});

describe('BodyScanFlow: photo-storage opt-in does not enable persistence in Phase 2B', () => {
  it('even with "Save my photos" consented, a captured photo is not written to IndexedDB', async () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(
      (() => ({ drawImage: vi.fn() })) as unknown as HTMLCanvasElement['getContext']
    );
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(function (this: HTMLCanvasElement, cb: BlobCallback) {
      cb(new Blob(['jpeg'], { type: 'image/jpeg' }));
    });
    await render({ ...DEFAULT_PROFILE, age: 30 });
    const boxes = container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]');
    await click(boxes[0]);
    await click(boxes[1]);
    await click(boxes[2]); // opt in to photo storage
    await click(byText('button', 'Continue'));
    expect(getBodyScanConsent()).toMatchObject({ photoStorage: true });

    await click(byText('button', 'Take front photo'));
    await click(byText('button', 'Turn on camera'));
    await flush();
    const v = container.querySelector('video')!;
    Object.defineProperty(v, 'videoWidth', { configurable: true, value: 640 });
    Object.defineProperty(v, 'videoHeight', { configurable: true, value: 480 });
    Object.defineProperty(v, 'readyState', { configurable: true, value: 4 });
    await act(async () => {
      v.dispatchEvent(new Event('loadeddata'));
    });
    await click(byText('button', 'Take photo'));
    await flush();
    await click(byText('button', 'Use this photo'));

    expect(container.textContent).toContain('Taken (temporary)');
    expect(container.textContent).toContain('not saved or uploaded, even if you allowed photo storage');
    expect(await getStorageSummary()).toMatchObject({ scanCount: 0, photoCount: 0, photoBytes: 0 });
    expect(await listScans()).toEqual([]);
  });
});

describe('BodyScanFlow: deletion controls also clear temporary photos held in memory', () => {
  const takeAndAcceptFront = async () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(
      (() => ({ drawImage: vi.fn() })) as unknown as HTMLCanvasElement['getContext']
    );
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(function (this: HTMLCanvasElement, cb: BlobCallback) {
      cb(new Blob(['jpeg'], { type: 'image/jpeg' }));
    });
    await giveConsent();
    await click(byText('button', 'Take front photo'));
    await click(byText('button', 'Turn on camera'));
    await flush();
    const v = container.querySelector('video')!;
    Object.defineProperty(v, 'videoWidth', { configurable: true, value: 720 });
    Object.defineProperty(v, 'videoHeight', { configurable: true, value: 1280 });
    Object.defineProperty(v, 'readyState', { configurable: true, value: 4 });
    await act(async () => {
      v.dispatchEvent(new Event('loadeddata'));
    });
    await click(byText('button', 'Take photo'));
    await flush();
    await click(byText('button', 'Use this photo'));
    expect(container.textContent).toContain('Taken (temporary)');
  };

  for (const label of ['Delete all scan history', 'Delete all saved photos', 'Withdraw consent and delete all Body Scan data']) {
    it(`"${label}" leaves no temporary photo behind and revokes its preview URL`, async () => {
      await takeAndAcceptFront();
      await click(byText('button', label));
      await click(byText('button', 'Yes, delete'));
      await flush();
      expect(container.textContent).not.toContain('Taken (temporary)');
      expect(container.querySelector('img[alt^="Temporary"]')).toBeNull();
      expect(URL.revokeObjectURL).toHaveBeenCalled();
    });
  }

  it('cancelling the confirmation keeps the temporary photo', async () => {
    await takeAndAcceptFront();
    await click(byText('button', 'Delete all scan history'));
    await click(byText('button', 'Cancel'));
    expect(container.textContent).toContain('Taken (temporary)');
  });
});
