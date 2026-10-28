import type { SupabaseClient } from '@supabase/supabase-js';
import type { ExerciseVideo, VideoMatchMethod, VideoProcessingStatus, VideoReviewStatus } from '../types/video';

/**
 * Browser-side catalog access. Uses the signed-in user's session only (publishable key); RLS limits it to
 * published rows. It queries Postgres per exercise or per search page: it never loads the whole catalog and
 * never touches video bytes. Playback URLs are signed on demand for one video at a time.
 */

export const BUCKET = 'exercise-videos';
/** Signed URLs live one hour. An expired URL surfaces as a playback error, and the player re-signs on retry. */
export const SIGNED_URL_TTL_SECONDS = 3600;
export const MAX_PAGE_SIZE = 50;

const COLUMNS =
  'id, content_sha256, original_filename, title, exercise_key, storage_key, size_bytes, duration_seconds, width, height, equipment, muscle_groups, tags, match_method, match_confidence, review_status, status, sort_order';

interface Row {
  id: string;
  content_sha256: string;
  original_filename: string;
  title: string;
  exercise_key: string | null;
  storage_key: string;
  size_bytes: number | string;
  duration_seconds: number | string | null;
  width: number | null;
  height: number | null;
  equipment: string[] | null;
  muscle_groups: string[] | null;
  tags: string[] | null;
  match_method: string;
  match_confidence: number | string;
  review_status: string;
  status: string;
  sort_order: number;
}

export function rowToVideo(r: Row): ExerciseVideo {
  return {
    id: r.id,
    contentSha256: r.content_sha256,
    originalFilename: r.original_filename,
    title: r.title,
    exerciseKey: r.exercise_key,
    storageKey: r.storage_key,
    sizeBytes: Number(r.size_bytes),
    durationSeconds: r.duration_seconds === null ? null : Number(r.duration_seconds),
    width: r.width,
    height: r.height,
    equipment: r.equipment ?? [],
    muscleGroups: r.muscle_groups ?? [],
    tags: r.tags ?? [],
    matchMethod: r.match_method as VideoMatchMethod,
    matchConfidence: Number(r.match_confidence),
    reviewStatus: r.review_status as VideoReviewStatus,
    status: r.status as VideoProcessingStatus,
    sortOrder: r.sort_order
  };
}

const MAX_SEARCH_CHARS = 100;
const MAX_SEARCH_WORDS = 8;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Turns what the person typed into a Postgres prefix tsquery ('bench pre' -> 'bench:* & pre:*').
 * Only letters and digits survive (any script), so tsquery operators, quotes, commas, parentheses, wildcards and
 * backslashes in the input can never reach the query. Returns null when nothing searchable remains.
 * Matching is case-insensitive (the 'simple' config lower-cases) and every typed word must prefix-match a word.
 */
export function buildPrefixTsQuery(text: string | undefined | null): string | null {
  const words = (text ?? '')
    .slice(0, MAX_SEARCH_CHARS)
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean)
    .slice(0, MAX_SEARCH_WORDS);
  return words.length ? words.map((w) => `${w}:*`).join(' & ') : null;
}

/** Escapes a value for use inside a double-quoted PostgREST filter value: backslash first, then the quote. */
export function quoteFilterValue(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

export type VideoSearchCursor = { title: string; id: string };

export type CatalogResult<T> = { ok: true; data: T } | { ok: false; error: string };

export class VideoCatalogService {
  constructor(private readonly client: SupabaseClient) {}

  /** Published videos for one exercise key, in display order. Empty array when none exist. */
  async getVideosForExercise(exerciseKey: string, limit = 10): Promise<CatalogResult<ExerciseVideo[]>> {
    if (!exerciseKey) return { ok: true, data: [] };
    const { data, error } = await this.client
      .from('exercise_videos')
      .select(COLUMNS)
      .eq('exercise_key', exerciseKey)
      .eq('status', 'uploaded')
      .eq('review_status', 'matched')
      .eq('published', true)
      .order('sort_order', { ascending: true })
      .order('id', { ascending: true })
      .limit(Math.min(Math.max(limit, 1), MAX_PAGE_SIZE));
    if (error) return { ok: false, error: error.message };
    return { ok: true, data: ((data ?? []) as Row[]).map(rowToVideo) };
  }

  /**
   * One page of the video library, ordered by (title, id). Keyset pagination: the cursor is the last row's title
   * and id. Visible rows are every uploaded + published video, whether or not it is mapped to an exercise key.
   * An empty or unsearchable `text` browses the whole library page by page. Words are prefix-matched,
   * case-insensitively, against the video title (and original filename).
   */
  async search(params: {
    text?: string;
    equipment?: string;
    muscleGroup?: string;
    tag?: string;
    limit?: number;
    cursor?: VideoSearchCursor | null;
  }): Promise<CatalogResult<{ items: ExerciseVideo[]; nextCursor: VideoSearchCursor | null }>> {
    if (params.cursor && !UUID_RE.test(params.cursor.id)) return { ok: false, error: 'Invalid page cursor.' };
    const requested = Number.isFinite(params.limit) ? Math.floor(params.limit as number) : 24;
    const limit = Math.min(Math.max(requested, 1), MAX_PAGE_SIZE);
    let q = this.client
      .from('exercise_videos')
      .select(COLUMNS)
      .eq('status', 'uploaded')
      .eq('published', true);
    const tsquery = buildPrefixTsQuery(params.text);
    if (tsquery) q = q.textSearch('search_vector', tsquery, { config: 'simple' });
    if (params.equipment) q = q.contains('equipment', [params.equipment]);
    if (params.muscleGroup) q = q.contains('muscle_groups', [params.muscleGroup]);
    if (params.tag) q = q.contains('tags', [params.tag]);
    if (params.cursor) {
      // Keyset: rows strictly after (title, id). The title is quoted and escaped for the PostgREST filter grammar;
      // the id was validated as a UUID above.
      const t = quoteFilterValue(params.cursor.title);
      q = q.or(`title.gt.${t},and(title.eq.${t},id.gt.${params.cursor.id})`);
    }
    const { data, error } = await q.order('title', { ascending: true }).order('id', { ascending: true }).limit(limit + 1);
    if (error) return { ok: false, error: error.message };
    const rows = ((data ?? []) as Row[]).map(rowToVideo);
    const items = rows.slice(0, limit);
    const last = items[items.length - 1];
    return { ok: true, data: { items, nextCursor: rows.length > limit && last ? { title: last.title, id: last.id } : null } };
  }

  /** Signs ONE object on demand. Storage RLS refuses objects that are not published catalog rows. */
  async getPlaybackUrl(storageKey: string): Promise<CatalogResult<string>> {
    const { data, error } = await this.client.storage.from(BUCKET).createSignedUrl(storageKey, SIGNED_URL_TTL_SECONDS);
    if (error || !data?.signedUrl) return { ok: false, error: error?.message ?? 'Could not create a playback link.' };
    return { ok: true, data: data.signedUrl };
  }
}
