import React, { act } from 'react';
import { createRoot, Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type Result<T> = Promise<{ data: T; error: { message: string } | null }>;

const h = vi.hoisted(() => ({
  auth: 'authenticated' as string,
  client: null as any,
  rows: (): any => Promise.resolve({ data: [], error: null }),
  sign: (_key: string): any => Promise.resolve({ data: { signedUrl: 'https://signed.example/v.mp4?token=t1' }, error: null }),
  eq: [] as Array<[string, unknown]>,
  from: [] as string[],
  signed: [] as string[],
  bucket: [] as string[]
}));

vi.mock('../../lib/supabase', async (orig) => {
  const real = await orig<typeof import('../../lib/supabase')>();
  return { ...real, getSupabase: () => h.client };
});
vi.mock('../../context/AuthContext', async (orig) => {
  const real = await orig<typeof import('../../context/AuthContext')>();
  return { ...real, useAuth: () => ({ status: h.auth }) };
});

import { ExerciseVideoSection, formatDuration } from './ExerciseVideoSection';
import { ExercisePostureModal } from '../posture/ExercisePostureModal';
import { resolveVideoExerciseKey } from '../../data/exerciseVideoKey';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const row = (id: string, title: string, storageKey: string, sort = 0) => ({
  id,
  content_sha256: 'a'.repeat(64),
  original_filename: `${title}.mp4`,
  title,
  exercise_key: 'barbell-squat',
  storage_key: storageKey,
  size_bytes: 1_000_000,
  duration_seconds: 42,
  width: 1280,
  height: 720,
  equipment: [],
  muscle_groups: [],
  tags: [],
  match_method: 'exact_name',
  match_confidence: 0.98,
  review_status: 'matched',
  status: 'uploaded',
  sort_order: sort
});

function makeClient() {
  const builder: any = {
    select: () => builder,
    eq: (c: string, v: unknown) => {
      h.eq.push([c, v]);
      return builder;
    },
    order: () => builder,
    limit: () => h.rows()
  };
  return {
    from: (t: string) => {
      h.from.push(t);
      return builder;
    },
    storage: {
      from: (b: string) => {
        h.bucket.push(b);
        return {
          createSignedUrl: (key: string) => {
            h.signed.push(key);
            return h.sign(key);
          }
        };
      }
    }
  };
}

let container: HTMLDivElement;
let root: Root;
const text = () => container.textContent ?? '';
const q = <T extends Element = HTMLElement>(sel: string) => container.querySelector(sel) as T | null;
const flush = async () => {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
};
const render = async (node: React.ReactNode) => {
  await act(async () => {
    root.render(node);
  });
  await flush();
};
const click = async (el: Element | null) => {
  expect(el).not.toBeNull();
  await act(async () => {
    (el as HTMLElement).click();
  });
  await flush();
};
const buttonByText = (label: string) => Array.from(container.querySelectorAll('button')).find((b) => (b.textContent ?? '').includes(label)) ?? null;

beforeEach(() => {
  h.auth = 'authenticated';
  h.client = makeClient();
  h.rows = () => Promise.resolve({ data: [], error: null });
  h.sign = () => Promise.resolve({ data: { signedUrl: 'https://signed.example/v.mp4?token=t1' }, error: null });
  h.eq = [];
  h.from = [];
  h.signed = [];
  h.bucket = [];
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
  vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {});
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

describe('exercise key resolution (no substring or fallback matching)', () => {
  it('resolves exact names and aliases to the stable catalog key', () => {
    expect(resolveVideoExerciseKey('Barbell Back Squat')).toBe('barbell-squat');
    expect(resolveVideoExerciseKey('Back Squat')).toBe('barbell-squat');
  });
  it('returns null for look-alikes, equipment conflicts, custom and empty names', () => {
    expect(resolveVideoExerciseKey('Dumbbell Squat')).toBeNull();
    expect(resolveVideoExerciseKey('Totally Custom Move')).toBeNull();
    expect(resolveVideoExerciseKey('   ')).toBeNull();
  });
  it('formats durations', () => {
    expect(formatDuration(42)).toBe('0:42');
    expect(formatDuration(125.4)).toBe('2:05');
    expect(formatDuration(null)).toBe('');
  });
});

describe('ExerciseVideoSection', () => {
  it('stays collapsed and requests nothing until opened', async () => {
    await render(<ExerciseVideoSection exerciseName="Barbell Back Squat" />);
    expect(text()).toContain('Exercise video');
    expect(h.from).toEqual([]);
    expect(h.signed).toEqual([]);
    expect(q('button[aria-expanded="false"]')).not.toBeNull();
  });

  it('queries only published rows for the resolved key and signs nothing until a video is picked', async () => {
    h.rows = () => Promise.resolve({ data: [row('v1', 'Squat Demo', 'videos/aa/a.mp4')], error: null });
    await render(<ExerciseVideoSection exerciseName="Barbell Back Squat" defaultOpen />);
    expect(h.from).toEqual(['exercise_videos']);
    expect(h.eq).toEqual(
      expect.arrayContaining([
        ['exercise_key', 'barbell-squat'],
        ['status', 'uploaded'],
        ['review_status', 'matched']
      ])
    );
    expect(text()).toContain('Squat Demo');
    expect(text()).toContain('0:42');
    expect(h.signed).toEqual([]);
    expect(q('video')).toBeNull();
  });

  it('signs one URL on selection, uses the private bucket, and renders a non-autoplaying native player', async () => {
    h.rows = () => Promise.resolve({ data: [row('v1', 'Squat Demo', 'videos/aa/a.mp4')], error: null });
    await render(<ExerciseVideoSection exerciseName="Barbell Back Squat" defaultOpen />);
    await click(buttonByText('Squat Demo'));
    expect(h.bucket).toEqual(['exercise-videos']);
    expect(h.signed).toEqual(['videos/aa/a.mp4']);
    const video = q<HTMLVideoElement>('video');
    expect(video).not.toBeNull();
    expect(video!.getAttribute('src')).toBe('https://signed.example/v.mp4?token=t1');
    expect(video!.controls).toBe(true);
    expect(video!.autoplay).toBe(false);
    expect(video!.hasAttribute('autoplay')).toBe(false);
    expect(video!.getAttribute('playsinline')).not.toBeNull();
  });

  it('lets the person choose between multiple videos and signs only the chosen one', async () => {
    h.rows = () =>
      Promise.resolve({
        data: [row('v1', 'Front View', 'videos/aa/a.mp4', 0), row('v2', 'Side View', 'videos/bb/b.mp4', 1)],
        error: null
      });
    await render(<ExerciseVideoSection exerciseName="Barbell Back Squat" defaultOpen />);
    expect(container.querySelectorAll('ul[aria-label="Available videos"] button')).toHaveLength(2);
    await click(buttonByText('Side View'));
    expect(h.signed).toEqual(['videos/bb/b.mp4']);
    await click(buttonByText('Front View'));
    expect(h.signed).toEqual(['videos/bb/b.mp4', 'videos/aa/a.mp4']);
  });

  it('shows a friendly empty state when no approved video exists', async () => {
    await render(<ExerciseVideoSection exerciseName="Barbell Back Squat" defaultOpen />);
    expect(text()).toContain('No approved video for this exercise yet');
    expect(q('video')).toBeNull();
  });

  it('shows the empty state and makes no query for an unmapped (custom) exercise', async () => {
    await render(<ExerciseVideoSection exerciseName="Totally Custom Move" defaultOpen />);
    expect(text()).toContain('No approved video for this exercise yet');
    expect(h.from).toEqual([]);
  });

  it('shows an error with retry when the catalog call fails, without leaking the raw error', async () => {
    h.rows = () => Promise.resolve({ data: null, error: { message: 'permission denied for table exercise_videos' } });
    await render(<ExerciseVideoSection exerciseName="Barbell Back Squat" defaultOpen />);
    expect(q('[role="alert"]')!.textContent).toContain("Couldn't load videos");
    expect(text()).not.toContain('permission denied');
    h.rows = () => Promise.resolve({ data: [row('v1', 'Squat Demo', 'videos/aa/a.mp4')], error: null });
    await click(buttonByText('Retry'));
    expect(text()).toContain('Squat Demo');
  });

  it('survives a rejected catalog promise', async () => {
    h.rows = () => Promise.reject(new Error('network down'));
    await render(<ExerciseVideoSection exerciseName="Barbell Back Squat" defaultOpen />);
    expect(q('[role="alert"]')!.textContent).toContain("Couldn't load videos");
  });

  it('shows unavailable when Supabase is not configured', async () => {
    h.client = null;
    await render(<ExerciseVideoSection exerciseName="Barbell Back Squat" defaultOpen />);
    expect(text()).toContain('unavailable');
  });

  it('does not query when the user is not signed in', async () => {
    h.auth = 'unauthenticated';
    await render(<ExerciseVideoSection exerciseName="Barbell Back Squat" defaultOpen />);
    expect(text()).toContain('Sign in to watch exercise videos');
    expect(h.from).toEqual([]);
  });

  it('shows a player error with retry when signing is refused (storage RLS)', async () => {
    h.rows = () => Promise.resolve({ data: [row('v1', 'Squat Demo', 'videos/aa/a.mp4')], error: null });
    h.sign = () => Promise.resolve({ data: null, error: { message: 'Object not found' } });
    await render(<ExerciseVideoSection exerciseName="Barbell Back Squat" defaultOpen />);
    await click(buttonByText('Squat Demo'));
    expect(q('[role="alert"]')!.textContent).toContain('not available');
    expect(text()).not.toContain('Object not found');
    expect(q('video')).toBeNull();
  });

  it('re-signs once on a playback failure (expired URL), then shows an error with retry', async () => {
    let n = 0;
    h.rows = () => Promise.resolve({ data: [row('v1', 'Squat Demo', 'videos/aa/a.mp4')], error: null });
    h.sign = () => Promise.resolve({ data: { signedUrl: `https://signed.example/v.mp4?token=t${++n}` }, error: null });
    await render(<ExerciseVideoSection exerciseName="Barbell Back Squat" defaultOpen />);
    await click(buttonByText('Squat Demo'));
    expect(q('video')!.getAttribute('src')).toContain('token=t1');

    await act(async () => {
      q('video')!.dispatchEvent(new Event('error'));
    });
    await flush();
    expect(h.signed).toHaveLength(2);
    expect(q('video')!.getAttribute('src')).toContain('token=t2');

    await act(async () => {
      q('video')!.dispatchEvent(new Event('error'));
    });
    await flush();
    expect(h.signed).toHaveLength(2); // no endless re-sign loop
    expect(q('[role="alert"]')!.textContent).toContain('could not be played');

    await click(buttonByText('Try again'));
    expect(h.signed).toHaveLength(3);
    expect(q('video')).not.toBeNull();
  });

  it('discards a late response after unmount and releases the media element', async () => {
    let release: (v: unknown) => void = () => {};
    h.rows = () => new Promise((r) => (release = r));
    await render(<ExerciseVideoSection exerciseName="Barbell Back Squat" defaultOpen />);
    await act(async () => root.unmount());
    root = createRoot(container);
    await act(async () => release({ data: [row('v1', 'Squat Demo', 'videos/aa/a.mp4')], error: null }));
    expect(text()).toBe('');
    expect(h.signed).toEqual([]);
  });

  it('stops and releases the video when the section unmounts', async () => {
    h.rows = () => Promise.resolve({ data: [row('v1', 'Squat Demo', 'videos/aa/a.mp4')], error: null });
    await render(<ExerciseVideoSection exerciseName="Barbell Back Squat" defaultOpen />);
    await click(buttonByText('Squat Demo'));
    const pause = vi.mocked(HTMLMediaElement.prototype.pause);
    pause.mockClear();
    await act(async () => root.unmount());
    root = createRoot(container);
    expect(pause).toHaveBeenCalled();
  });

  it('ignores a stale response after the exercise changes', async () => {
    const pending: Array<(v: unknown) => void> = [];
    h.rows = () => new Promise((r) => pending.push(r));
    await render(<ExerciseVideoSection exerciseName="Barbell Back Squat" defaultOpen />);
    await render(<ExerciseVideoSection exerciseName="Barbell Bench Press" defaultOpen />);
    expect(pending).toHaveLength(2);
    await act(async () => pending[0]({ data: [row('old', 'Old Squat Video', 'videos/aa/a.mp4')], error: null }));
    expect(text()).not.toContain('Old Squat Video');
    await act(async () => pending[1]({ data: [], error: null }));
    expect(text()).toContain('No approved video');
  });
});

describe('ExercisePostureModal integration', () => {
  it('keeps the biomechanics content and shows the video section; closing works', async () => {
    h.rows = () => Promise.resolve({ data: [row('v1', 'Squat Demo', 'videos/aa/a.mp4')], error: null });
    const onClose = vi.fn();
    await render(<ExercisePostureModal exerciseName="Barbell Back Squat" isOpen onClose={onClose} openVideoFirst />);
    expect(text()).toContain('Squat Demo');
    expect(text()).toContain('Visual Model & Angles');
    expect(text()).toContain('Form Mistakes & Fixes');
    await click(buttonByText('Close Form Guide'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('keeps the modal fully usable when the video service is down', async () => {
    h.rows = () => Promise.reject(new Error('down'));
    const onClose = vi.fn();
    await render(<ExercisePostureModal exerciseName="Barbell Back Squat" isOpen onClose={onClose} openVideoFirst />);
    expect(q('[role="alert"]')).not.toBeNull();
    await click(buttonByText('Step Checkpoints'));
    expect(text()).toContain('Step Checkpoints');
    await click(buttonByText('Close Form Guide'));
    expect(onClose).toHaveBeenCalled();
  });

  it('does not fetch videos when opened via Biomechanics (section collapsed)', async () => {
    await render(<ExercisePostureModal exerciseName="Barbell Back Squat" isOpen onClose={() => {}} />);
    expect(h.from).toEqual([]);
    expect(q('button[aria-expanded="false"]')).not.toBeNull();
  });
});
