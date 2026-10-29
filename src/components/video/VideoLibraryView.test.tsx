import React, { act } from 'react';
import { createRoot, Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

interface Rec {
  text: string | null;
  or: string | null;
  limit: number;
  eq: Array<[string, unknown]>;
  contains: Array<[string, unknown]>;
}

const h = vi.hoisted(() => ({
  auth: 'authenticated' as string,
  client: null as any,
  searches: [] as any[],
  respond: (_rec: any): any => Promise.resolve({ data: [], error: null }),
  sign: (_key: string): any => Promise.resolve({ data: { signedUrl: 'https://signed.example/v.mp4?token=t1' }, error: null }),
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

import { VideoLibraryView } from './VideoLibraryView';
import { LIBRARY_PAGE_SIZE, SEARCH_DEBOUNCE_MS } from '../../hooks/useVideoLibrary';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const uid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const row = (n: number, title = `Video ${n}`, over: Record<string, unknown> = {}) => ({
  id: uid(n),
  content_sha256: n.toString(16).padStart(64, '0'),
  original_filename: `${title}.mp4`,
  title,
  exercise_key: null,
  storage_key: `videos/aa/${n}.mp4`,
  size_bytes: 1_000_000,
  duration_seconds: 42,
  width: 1280,
  height: 720,
  equipment: [],
  muscle_groups: [],
  tags: [],
  match_method: 'none',
  match_confidence: 0,
  review_status: 'unmatched',
  status: 'uploaded',
  sort_order: 0,
  ...over
});
const ok = (data: unknown[]) => Promise.resolve({ data, error: null });

function makeClient() {
  return {
    from: () => {
      const rec: Rec = { text: null, or: null, limit: 0, eq: [], contains: [] };
      const b: any = {
        select: () => b,
        eq: (c: string, v: unknown) => (rec.eq.push([c, v]), b),
        textSearch: (_c: string, q: string) => ((rec.text = q), b),
        contains: (c: string, v: unknown) => (rec.contains.push([c, v]), b),
        or: (f: string) => ((rec.or = f), b),
        order: () => b,
        limit: (n: number) => {
          rec.limit = n;
          h.searches.push(rec);
          return h.respond(rec);
        }
      };
      return b;
    },
    storage: {
      from: (bucket: string) => {
        h.bucket.push(bucket);
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
const buttonByText = (label: string) => Array.from(container.querySelectorAll('button')).find((b) => (b.textContent ?? '').includes(label)) ?? null;
const input = () => q<HTMLInputElement>('input[type="search"]')!;

/** Lets pending promises settle and advances the debounce clock. */
const tick = async (ms = 0) => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
};
const render = async (node: React.ReactNode) => {
  await act(async () => root.render(node));
  await tick();
};
const type = async (value: string) => {
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    setter.call(input(), value);
    input().dispatchEvent(new Event('input', { bubbles: true }));
  });
};
const click = async (el: Element | null) => {
  expect(el).not.toBeNull();
  await act(async () => (el as HTMLElement).click());
  await tick();
};

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  h.auth = 'authenticated';
  h.client = makeClient();
  h.searches = [];
  h.respond = () => ok([]);
  h.sign = () => Promise.resolve({ data: { signedUrl: 'https://signed.example/v.mp4?token=t1' }, error: null });
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
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('Video Library: loading and listing', () => {
  it('shows a loading state, then the first page of the whole library for an empty query', async () => {
    let release: (v: unknown) => void = () => {};
    h.respond = () => new Promise((r) => (release = r));
    await render(<VideoLibraryView />);
    expect(q('[role="status"]')!.textContent).toContain('Loading videos');
    await act(async () => release({ data: [row(1, 'Barbell Row'), row(2, 'Bench Press')], error: null }));
    expect(text()).toContain('Barbell Row');
    expect(text()).toContain('Bench Press');
    expect(h.searches).toHaveLength(1);
    expect(h.searches[0].text).toBeNull();
    expect(h.searches[0].limit).toBe(LIBRARY_PAGE_SIZE + 1);
    expect(h.searches[0].eq).toEqual(expect.arrayContaining([['status', 'uploaded'], ['published', true]]));
    expect(h.signed).toEqual([]); // listing never signs anything
  });

  it('shows title, duration, and equipment or muscle tags only when the data has them', async () => {
    h.respond = () => ok([row(1, 'Barbell Row', { equipment: ['barbell'], muscle_groups: ['back'] }), row(2, 'Plain Video', { duration_seconds: null })]);
    await render(<VideoLibraryView />);
    const items = Array.from(container.querySelectorAll('ul[aria-label="Videos"] li'));
    expect(items).toHaveLength(2);
    expect(items[0].textContent).toContain('Barbell Row');
    expect(items[0].textContent).toContain('0:42');
    expect(items[0].textContent).toContain('barbell');
    expect(items[0].textContent).toContain('back');
    expect(items[1].textContent).toBe('Plain Video'); // no duration, no tag chips
  });

  it('shows an empty-library message when nothing is published', async () => {
    await render(<VideoLibraryView />);
    expect(text()).toContain('No videos yet');
    expect(text()).not.toContain('No videos found');
  });

  it('uses 16px text in the search field (no iOS zoom) and plays inline', async () => {
    await render(<VideoLibraryView />);
    expect(input().className).toContain('text-base');
    expect(input().getAttribute('enterkeyhint')).toBe('search');
    expect(input().getAttribute('aria-label')).toBe('Search exercise videos');
  });
});

describe('Video Library: body-area folders', () => {
  const folderGroup = () => q('[role="group"][aria-label="Body area folders"]')!;
  const folderBtn = (label: string) => Array.from(folderGroup().querySelectorAll('button')).find((b) => b.textContent === label) ?? null;

  it('shows All plus one folder per body area, with All selected and the whole library listed', async () => {
    h.respond = () => ok([row(1, 'Barbell Row')]);
    await render(<VideoLibraryView />);
    const labels = Array.from(folderGroup().querySelectorAll('button')).map((b) => b.textContent);
    expect(labels).toEqual(['All', 'Chest', 'Back', 'Shoulders', 'Arms', 'Legs', 'Core', 'Cardio', 'Stretching']);
    expect(folderBtn('All')!.getAttribute('aria-pressed')).toBe('true');
    expect(h.searches[0].contains).toEqual([]);
  });

  it('opening a folder filters by that muscle group and marks it selected', async () => {
    await render(<VideoLibraryView />);
    h.respond = () => ok([row(2, 'Dumbbell Fly', { muscle_groups: ['chest'] })]);
    await click(folderBtn('Chest'));
    expect(h.searches).toHaveLength(2);
    expect(h.searches[1].contains).toEqual([['muscle_groups', ['chest']]]);
    expect(folderBtn('Chest')!.getAttribute('aria-pressed')).toBe('true');
    expect(folderBtn('All')!.getAttribute('aria-pressed')).toBe('false');
    expect(text()).toContain('Dumbbell Fly');
  });

  it('search text stays inside the open folder, and paging keeps the folder filter', async () => {
    const page1 = Array.from({ length: LIBRARY_PAGE_SIZE + 1 }, (_, i) => row(i + 1, `Leg ${String(i).padStart(2, '0')}`, { muscle_groups: ['legs'] }));
    h.respond = () => ok(page1);
    await render(<VideoLibraryView />);
    await click(folderBtn('Legs'));
    await click(buttonByText('Show more'));
    const last = h.searches[h.searches.length - 1];
    expect(last.contains).toEqual([['muscle_groups', ['legs']]]);
    expect(last.or).not.toBeNull(); // keyset cursor
    await type('squat');
    await tick(SEARCH_DEBOUNCE_MS);
    const typed = h.searches[h.searches.length - 1];
    expect(typed.text).not.toBeNull();
    expect(typed.contains).toEqual([['muscle_groups', ['legs']]]);
  });

  it('tapping the open folder again, or All, returns to the whole library', async () => {
    await render(<VideoLibraryView />);
    await click(folderBtn('Back'));
    await click(folderBtn('Back'));
    expect(h.searches[h.searches.length - 1].contains).toEqual([]);
    await click(folderBtn('Core'));
    await click(folderBtn('All'));
    expect(h.searches[h.searches.length - 1].contains).toEqual([]);
    expect(folderBtn('All')!.getAttribute('aria-pressed')).toBe('true');
  });

  it('an empty folder says so, and does not use the empty-library message', async () => {
    await render(<VideoLibraryView />);
    await click(folderBtn('Cardio'));
    expect(text()).toContain('No videos in Cardio yet.');
    expect(text()).not.toContain('No videos yet');
  });
});

describe('Video Library: debounced search', () => {
  it('does not search on every keystroke: one query after the pause, with prefix matching', async () => {
    await render(<VideoLibraryView />);
    expect(h.searches).toHaveLength(1);
    await type('b');
    await tick(100);
    await type('be');
    await tick(100);
    await type('ben');
    await tick(SEARCH_DEBOUNCE_MS - 1);
    expect(h.searches).toHaveLength(1); // still waiting
    await tick(1);
    expect(h.searches).toHaveLength(2);
    expect(h.searches[1].text).toBe('ben:*');
  });

  it('searches immediately when the keyboard Search key is pressed', async () => {
    await render(<VideoLibraryView />);
    await type('squat');
    await act(async () => {
      q<HTMLFormElement>('form[role="search"]')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });
    await tick();
    expect(h.searches).toHaveLength(2);
    expect(h.searches[1].text).toBe('squat:*');
    await tick(SEARCH_DEBOUNCE_MS * 2);
    expect(h.searches).toHaveLength(2); // the pending debounce did not fire a duplicate request
  });

  it('renders the matching results', async () => {
    await render(<VideoLibraryView />);
    h.respond = () => ok([row(7, 'Bench Press')]);
    await type('bench');
    await tick(SEARCH_DEBOUNCE_MS);
    expect(text()).toContain('Bench Press');
  });

  it('shows a clear no-results message for a query that matches nothing', async () => {
    await render(<VideoLibraryView />);
    await type('zzzz');
    await tick(SEARCH_DEBOUNCE_MS);
    expect(text()).toContain('No videos found');
    expect(text()).not.toContain('No videos yet');
  });

  it('never sends user punctuation to the backend', async () => {
    await render(<VideoLibraryView />);
    await type(`bench),title.eq.x,"'*%\\`);
    await tick(SEARCH_DEBOUNCE_MS);
    expect(h.searches[1].text).toBe('bench:* & title:* & eq:* & x:*');
    expect(h.searches[1].or).toBeNull();
  });

  it('clearing the box returns to the full library immediately', async () => {
    h.respond = (rec: Rec) => ok(rec.text ? [row(7, 'Bench Press')] : [row(1, 'Barbell Row'), row(7, 'Bench Press')]);
    await render(<VideoLibraryView />);
    await type('bench');
    await tick(SEARCH_DEBOUNCE_MS);
    expect(text()).not.toContain('Barbell Row');
    await click(q('button[aria-label="Clear search"]'));
    expect(h.searches.at(-1).text).toBeNull();
    expect(text()).toContain('Barbell Row');
  });

  it('ignores a stale response that arrives after a newer query, whatever order they resolve in', async () => {
    const pending: Array<{ rec: Rec; resolve: (v: unknown) => void }> = [];
    h.respond = (rec: Rec) => new Promise((resolve) => pending.push({ rec, resolve }));
    await render(<VideoLibraryView />); // request 0 (empty query)
    await type('ab');
    await tick(SEARCH_DEBOUNCE_MS); // request 1
    await type('abc');
    await tick(SEARCH_DEBOUNCE_MS); // request 2
    expect(pending.map((p) => p.rec.text)).toEqual([null, 'ab:*', 'abc:*']);
    await act(async () => pending[2].resolve({ data: [row(3, 'Newest Result')], error: null }));
    await act(async () => pending[1].resolve({ data: [row(2, 'Stale Result')], error: null }));
    await act(async () => pending[0].resolve({ data: [row(1, 'Older Result')], error: null }));
    expect(text()).toContain('Newest Result');
    expect(text()).not.toContain('Stale Result');
    expect(text()).not.toContain('Older Result');
  });

  it('discards a response that lands after the screen unmounts', async () => {
    let release: (v: unknown) => void = () => {};
    h.respond = () => new Promise((r) => (release = r));
    await render(<VideoLibraryView />);
    await act(async () => root.unmount());
    root = createRoot(container);
    await act(async () => release({ data: [row(1)], error: null }));
    expect(text()).toBe('');
  });
});

describe('Video Library: pagination', () => {
  const page1 = () => Array.from({ length: LIBRARY_PAGE_SIZE + 1 }, (_, i) => row(i + 1));

  it('loads one page, then the next page with a keyset cursor, appending without duplicates', async () => {
    h.respond = (rec: Rec) => (rec.or ? ok([row(LIBRARY_PAGE_SIZE, `Video ${LIBRARY_PAGE_SIZE}`), row(LIBRARY_PAGE_SIZE + 1), row(99, 'Last Video')]) : ok(page1()));
    await render(<VideoLibraryView />);
    expect(container.querySelectorAll('ul[aria-label="Videos"] li')).toHaveLength(LIBRARY_PAGE_SIZE);
    expect(text()).not.toContain('Video 25'); // the extra row only signals that another page exists
    await click(buttonByText('Show more'));
    const second = h.searches[1];
    expect(second.or).toContain(`id.gt.${uid(LIBRARY_PAGE_SIZE)}`);
    expect(container.querySelectorAll('ul[aria-label="Videos"] li')).toHaveLength(LIBRARY_PAGE_SIZE + 2); // 24 + Video 25 + Last Video, no duplicate of 24
    expect(text()).toContain('Last Video');
    expect(buttonByText('Show more')).toBeNull(); // last page: no more button
  });

  it('keeps the loaded results and offers a retry when a later page fails', async () => {
    h.respond = (rec: Rec) => (rec.or ? Promise.resolve({ data: null, error: { message: 'boom' } }) : ok(page1()));
    await render(<VideoLibraryView />);
    await click(buttonByText('Show more'));
    expect(container.querySelectorAll('ul[aria-label="Videos"] li')).toHaveLength(LIBRARY_PAGE_SIZE);
    expect(text()).toContain("Couldn't load more videos");
    expect(text()).not.toContain('boom');
    h.respond = () => ok([row(99, 'Recovered')]);
    await click(buttonByText('Try again'));
    expect(text()).toContain('Recovered');
  });

  it('drops a next-page response that returns after the query changed', async () => {
    let releaseMore: (v: unknown) => void = () => {};
    h.respond = (rec: Rec) => {
      if (rec.or) return new Promise((r) => (releaseMore = r));
      return ok(rec.text ? [row(500, 'Fresh Search Result')] : page1());
    };
    await render(<VideoLibraryView />);
    await click(buttonByText('Show more'));
    await type('fresh');
    await tick(SEARCH_DEBOUNCE_MS);
    expect(text()).toContain('Fresh Search Result');
    await act(async () => releaseMore({ data: [row(900, 'Old Page Two')], error: null }));
    expect(text()).not.toContain('Old Page Two');
    expect(text()).toContain('Fresh Search Result');
  });
});

describe('Video Library: failures', () => {
  it('shows an error with a retry that works, without leaking the raw error', async () => {
    h.respond = () => Promise.resolve({ data: null, error: { message: 'permission denied for table exercise_videos' } });
    await render(<VideoLibraryView />);
    expect(q('[role="alert"]')!.textContent).toContain("Couldn't load videos");
    expect(text()).not.toContain('permission denied');
    h.respond = () => ok([row(1, 'Back Again')]);
    await click(buttonByText('Retry'));
    expect(text()).toContain('Back Again');
    expect(q('[role="alert"]')).toBeNull();
  });

  it('survives a rejected request', async () => {
    h.respond = () => Promise.reject(new Error('network down'));
    await render(<VideoLibraryView />);
    expect(q('[role="alert"]')!.textContent).toContain("Couldn't load videos");
  });

  it('asks an unauthenticated user to sign in and makes no request', async () => {
    h.auth = 'unauthenticated';
    await render(<VideoLibraryView />);
    expect(text()).toContain('Sign in to watch videos');
    expect(h.searches).toEqual([]);
  });

  it('shows unavailable when Supabase is not configured', async () => {
    h.client = null;
    await render(<VideoLibraryView />);
    expect(text()).toContain('Video library unavailable');
    expect(h.searches).toEqual([]);
  });
});

describe('Video Library: playback', () => {
  beforeEach(() => {
    h.respond = () => ok([row(1, 'Barbell Row'), row(2, 'Bench Press')]);
  });

  it('signs exactly one URL, only for the opened video, in the private bucket, and renders an inline non-autoplaying player', async () => {
    await render(<VideoLibraryView />);
    expect(h.signed).toEqual([]);
    await click(buttonByText('Bench Press'));
    expect(h.bucket).toEqual(['exercise-videos']);
    expect(h.signed).toEqual(['videos/aa/2.mp4']);
    const dialog = q('[role="dialog"]')!;
    expect(dialog.textContent).toContain('Bench Press');
    const video = q<HTMLVideoElement>('video')!;
    expect(video.getAttribute('src')).toBe('https://signed.example/v.mp4?token=t1');
    expect(video.getAttribute('playsinline')).not.toBeNull();
    expect(video.controls).toBe(true);
    expect(video.hasAttribute('autoplay')).toBe(false);
    await tick(10_000);
    expect(h.signed).toHaveLength(1); // no extra signing in the background
  });

  it('releases the player when the dialog is closed, and keeps the list and search intact', async () => {
    await render(<VideoLibraryView />);
    await click(buttonByText('Bench Press'));
    const pause = vi.mocked(HTMLMediaElement.prototype.pause);
    const load = vi.mocked(HTMLMediaElement.prototype.load);
    pause.mockClear();
    load.mockClear();
    await click(q('button[aria-label="Close"]'));
    expect(pause).toHaveBeenCalled();
    expect(load).toHaveBeenCalled();
    expect(q('video')).toBeNull();
    expect(q('[role="dialog"]')).toBeNull();
    expect(text()).toContain('Barbell Row');
    expect(h.searches).toHaveLength(1); // closing does not refetch
  });

  it('releases the player when the screen unmounts while a video is open', async () => {
    await render(<VideoLibraryView />);
    await click(buttonByText('Bench Press'));
    const pause = vi.mocked(HTMLMediaElement.prototype.pause);
    pause.mockClear();
    await act(async () => root.unmount());
    root = createRoot(container);
    expect(pause).toHaveBeenCalled();
  });

  it('signs a fresh URL each time a video is opened and stores none', async () => {
    let n = 0;
    h.sign = () => Promise.resolve({ data: { signedUrl: `https://signed.example/v.mp4?token=t${++n}` }, error: null });
    await render(<VideoLibraryView />);
    await click(buttonByText('Bench Press'));
    await click(q('button[aria-label="Close"]'));
    await click(buttonByText('Bench Press'));
    expect(h.signed).toEqual(['videos/aa/2.mp4', 'videos/aa/2.mp4']);
    expect(q('video')!.getAttribute('src')).toContain('token=t2');
    expect(JSON.stringify(Object.entries(localStorage))).not.toContain('signed.example');
  });

  it('shows a player error with retry when signing is refused, and the rest of the screen keeps working', async () => {
    h.sign = () => Promise.resolve({ data: null, error: { message: 'Object not found' } });
    await render(<VideoLibraryView />);
    await click(buttonByText('Bench Press'));
    expect(q('[role="dialog"] [role="alert"]')!.textContent).toContain('not available');
    expect(text()).not.toContain('Object not found');
    expect(q('video')).toBeNull();
    await click(q('button[aria-label="Close"]'));
    expect(text()).toContain('Barbell Row');
    await type('row');
    await tick(SEARCH_DEBOUNCE_MS);
    expect(h.searches).toHaveLength(2);
  });

  it('survives a rejected signing request', async () => {
    h.sign = () => Promise.reject(new Error('network down'));
    await render(<VideoLibraryView />);
    await click(buttonByText('Bench Press'));
    expect(q('[role="dialog"] [role="alert"]')).not.toBeNull();
    expect(text()).toContain('Barbell Row');
  });
});
