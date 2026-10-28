import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { getVideoCatalogService } from './useExerciseVideos';
import type { VideoSearchCursor } from '../services/videoCatalogService';
import type { ExerciseVideo } from '../types/video';

/** Wait this long after the last keystroke before querying. Pressing Enter searches immediately. */
export const SEARCH_DEBOUNCE_MS = 300;
/** Rows per page. The service additionally clamps to MAX_PAGE_SIZE. */
export const LIBRARY_PAGE_SIZE = 24;

export type VideoLibraryState =
  | { status: 'signed_out' }
  | { status: 'unavailable' }
  | { status: 'loading' }
  | { status: 'error' }
  /** Nothing is published at all (empty query, no rows). */
  | { status: 'empty_library' }
  /** A typed query matched nothing. */
  | { status: 'no_results' }
  | { status: 'ready'; items: ExerciseVideo[]; nextCursor: VideoSearchCursor | null };

/**
 * Debounced, paginated search over the published video library. One page at a time; the whole catalog is never
 * loaded. Every request carries a generation number: a response that belongs to a superseded query, a retry, or an
 * unmounted screen is discarded, so a slow earlier request can never overwrite newer results.
 */
export function useVideoLibrary() {
  const { status: authStatus } = useAuth();
  const [input, setInput] = useState('');
  const [query, setQuery] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<VideoLibraryState>({ status: 'loading' });
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadMoreError, setLoadMoreError] = useState(false);
  const generation = useRef(0);

  // Debounce: the effective query follows the input after a pause. Clearing the box applies immediately.
  useEffect(() => {
    if (input.trim() === '') {
      setQuery('');
      return;
    }
    const t = setTimeout(() => setQuery(input), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [input]);

  // First page for the current query.
  useEffect(() => {
    const gen = ++generation.current;
    setLoadingMore(false);
    setLoadMoreError(false);
    if (authStatus !== 'authenticated') {
      setState({ status: 'signed_out' });
      return;
    }
    const service = getVideoCatalogService();
    if (!service) {
      setState({ status: 'unavailable' });
      return;
    }
    setState({ status: 'loading' });
    service
      .search({ text: query, limit: LIBRARY_PAGE_SIZE })
      .then((result) => {
        if (gen !== generation.current) return;
        if (!result.ok) setState({ status: 'error' });
        else if (result.data.items.length === 0) setState({ status: query.trim() ? 'no_results' : 'empty_library' });
        else setState({ status: 'ready', items: result.data.items, nextCursor: result.data.nextCursor });
      })
      .catch(() => {
        if (gen === generation.current) setState({ status: 'error' });
      });
    return () => {
      // Invalidate on query change, retry or unmount.
      generation.current++;
    };
  }, [authStatus, query, attempt]);

  const loadMore = useCallback(() => {
    if (state.status !== 'ready' || !state.nextCursor || loadingMore) return;
    const service = getVideoCatalogService();
    if (!service) return;
    const gen = generation.current;
    const cursor = state.nextCursor;
    setLoadingMore(true);
    setLoadMoreError(false);
    service
      .search({ text: query, limit: LIBRARY_PAGE_SIZE, cursor })
      .then((result) => {
        if (gen !== generation.current) return;
        setLoadingMore(false);
        if (!result.ok) {
          setLoadMoreError(true);
          return;
        }
        setState((prev) => {
          if (prev.status !== 'ready') return prev;
          const seen = new Set(prev.items.map((v) => v.id));
          return { status: 'ready', items: [...prev.items, ...result.data.items.filter((v) => !seen.has(v.id))], nextCursor: result.data.nextCursor };
        });
      })
      .catch(() => {
        if (gen !== generation.current) return;
        setLoadingMore(false);
        setLoadMoreError(true);
      });
  }, [state, query, loadingMore]);

  /** Search now, skipping the debounce (keyboard "Search" key). */
  const submit = useCallback(() => setQuery(input.trim() === '' ? '' : input), [input]);
  const retry = useCallback(() => setAttempt((n) => n + 1), []);

  return { input, setInput, query, state, loadingMore, loadMoreError, loadMore, submit, retry };
}
