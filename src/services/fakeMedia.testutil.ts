/**
 * Test-only fakes for the browser camera APIs (jsdom has none).
 *
 * These let tests verify lifecycle behaviour: which tracks were stopped, in
 * what order, and what was requested from getUserMedia. They say NOTHING about
 * how real browsers or devices behave; that still needs manual testing.
 */

import { vi } from 'vitest';

type Handler = (e: Event) => void;

export class FakeTrack {
  stopped = false;
  private handlers = new Map<string, Set<Handler>>();
  stop = vi.fn(() => {
    this.stopped = true; // like real tracks, stop() does not fire 'ended'
  });
  constructor(
    readonly kind: 'video' | 'audio' = 'video',
    private settings: MediaTrackSettings = {}
  ) {}
  getSettings = () => this.settings;
  addEventListener = (type: string, fn: Handler) => {
    if (!this.handlers.has(type)) this.handlers.set(type, new Set());
    this.handlers.get(type)!.add(fn);
  };
  removeEventListener = (type: string, fn: Handler) => {
    this.handlers.get(type)?.delete(fn);
  };
  listenerCount(type: string): number {
    return this.handlers.get(type)?.size ?? 0;
  }
  /** Simulates the browser/OS ending the track (revoked permission, unplugged, taken by another app). */
  emitEnded(): void {
    this.stopped = true;
    for (const h of Array.from(this.handlers.get('ended') ?? [])) h(new Event('ended'));
  }
}

export class FakeStream {
  constructor(readonly tracks: FakeTrack[]) {}
  getTracks = () => this.tracks;
  getVideoTracks = () => this.tracks.filter((t) => t.kind === 'video');
  getAudioTracks = () => this.tracks.filter((t) => t.kind === 'audio');
  /** True when every track has been stopped. */
  get allStopped(): boolean {
    return this.tracks.every((t) => t.stopped);
  }
  asMediaStream(): MediaStream {
    return this as unknown as MediaStream;
  }
}

export const domError = (name: string, message = name): DOMException => new DOMException(message, name);

export interface FakeDevice {
  deviceId: string;
  label?: string;
}

class FakePermissionStatus {
  private handlers = new Set<Handler>();
  constructor(public state: PermissionState) {}
  addEventListener = (_type: string, fn: Handler) => void this.handlers.add(fn);
  removeEventListener = (_type: string, fn: Handler) => void this.handlers.delete(fn);
  get listenerCount(): number {
    return this.handlers.size;
  }
  change(state: PermissionState): void {
    this.state = state;
    for (const h of Array.from(this.handlers)) h(new Event('change'));
  }
}

export interface Deferred {
  resolve: (stream?: FakeStream) => void;
  reject: (err: unknown) => void;
}

export interface FakeCamera {
  getUserMedia: ReturnType<typeof vi.fn>;
  /** Every stream handed out, in order. */
  streams: FakeStream[];
  permission: FakePermissionStatus;
  /** Makes the NEXT getUserMedia call wait until the test resolves or rejects it (simulates an open permission prompt). */
  deferNext(): Deferred;
  /** Makes the NEXT getUserMedia call reject. */
  failNext(err: unknown): void;
  uninstall(): void;
}

export interface FakeCameraOptions {
  devices?: FakeDevice[];
  facingMode?: 'user' | 'environment';
  permissionState?: PermissionState;
  /** Simulate browsers where permissions.query({name:'camera'}) throws (e.g. Safari). */
  permissionsApiThrows?: boolean;
}

/** Installs fake navigator.mediaDevices / navigator.permissions. Call uninstall() in afterEach. */
export function installFakeCamera(options: FakeCameraOptions = {}): FakeCamera {
  const devices = options.devices ?? [{ deviceId: 'cam-1', label: 'Front camera' }];
  const permission = new FakePermissionStatus(options.permissionState ?? 'prompt');
  const streams: FakeStream[] = [];
  const queue: Array<() => Promise<FakeStream>> = [];

  const makeStream = (constraints?: MediaStreamConstraints): FakeStream => {
    const exact = (constraints?.video as MediaTrackConstraints | undefined)?.deviceId as ConstrainDOMStringParameters | undefined;
    const deviceId = (exact?.exact as string | undefined) ?? devices[0]?.deviceId ?? 'cam-1';
    const s = new FakeStream([new FakeTrack('video', { deviceId, facingMode: options.facingMode })]);
    streams.push(s);
    return s;
  };

  const getUserMedia = vi.fn(async (constraints?: MediaStreamConstraints) => {
    const next = queue.shift();
    return (next ? await next() : makeStream(constraints)).asMediaStream();
  });

  const original = {
    mediaDevices: Object.getOwnPropertyDescriptor(navigator, 'mediaDevices'),
    permissions: Object.getOwnPropertyDescriptor(navigator, 'permissions'),
  };
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: {
      getUserMedia,
      enumerateDevices: vi.fn(async () => devices.map((d) => ({ kind: 'videoinput', deviceId: d.deviceId, label: d.label ?? '' }))),
    },
  });
  Object.defineProperty(navigator, 'permissions', {
    configurable: true,
    value: {
      query: vi.fn(async () => {
        if (options.permissionsApiThrows) throw new TypeError('camera is not a valid permission name');
        return permission;
      }),
    },
  });

  return {
    getUserMedia,
    streams,
    permission,
    deferNext() {
      // Bound when getUserMedia is actually called (synchronously inside start()), so call after starting.
      const d: Deferred = {
        resolve: () => {
          throw new Error('getUserMedia has not been called yet');
        },
        reject: () => {
          throw new Error('getUserMedia has not been called yet');
        },
      };
      queue.push(
        () =>
          new Promise<FakeStream>((res, rej) => {
            d.resolve = (s) => res(s ?? makeStream());
            d.reject = rej;
          })
      );
      return d;
    },
    failNext(err: unknown) {
      queue.push(async () => {
        throw err;
      });
    },
    uninstall() {
      for (const key of ['mediaDevices', 'permissions'] as const) {
        const d = original[key];
        if (d) Object.defineProperty(navigator, key, d);
        else delete (navigator as unknown as Record<string, unknown>)[key];
      }
    },
  };
}

/** Removes mediaDevices entirely (unsupported browser). Pair with the uninstall of installFakeCamera, or call restore(). */
export function removeMediaDevices(): () => void {
  const original = Object.getOwnPropertyDescriptor(navigator, 'mediaDevices');
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: undefined });
  return () => {
    if (original) Object.defineProperty(navigator, 'mediaDevices', original);
    else delete (navigator as unknown as Record<string, unknown>).mediaDevices;
  };
}

export function setSecureContext(value: boolean): () => void {
  const original = Object.getOwnPropertyDescriptor(window, 'isSecureContext');
  Object.defineProperty(window, 'isSecureContext', { configurable: true, value });
  return () => {
    if (original) Object.defineProperty(window, 'isSecureContext', original);
    else delete (window as unknown as Record<string, unknown>).isSecureContext;
  };
}
