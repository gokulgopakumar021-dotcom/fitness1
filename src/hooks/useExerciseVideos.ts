import { useCallback, useEffect, useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { useAuth } from '../context/AuthContext';
import { getSupabase } from '../lib/supabase';
import { VideoCatalogService } from '../services/videoCatalogService';
import { resolveVideoExerciseKey } from '../data/exerciseVideoKey';
import type { ExerciseVideo } from '../types/video';

export type ExerciseVideosState =
  | { status: 'idle' }
  | { status: 'signed_out' }
  | { status: 'unavailable' }
  | { status: 'no_mapping' }
  | { status: 'loading' }
  | { status: 'ready'; videos: ExerciseVideo[] }
  | { status: 'empty' }
  | { status: 'error' };

let cached: { client: SupabaseClient; service: VideoCatalogService } | null = null;

/** The Stage 2 service bound to the existing signed-in Supabase client. Null when Supabase is not configured. */
export function getVideoCatalogService(): VideoCatalogService | null {
  const client = getSupabase();
  if (!client) return null;
  if (cached?.client !== client) cached = { client, service: new VideoCatalogService(client) };
  return cached.service;
}

/**
 * Loads the published videos for one exercise, only while `enabled`. It never throws into the UI and never
 * touches workout state: every failure becomes a state the video section renders. Results from a superseded
 * request (exercise changed, section closed, component unmounted) are discarded.
 */
export function useExerciseVideos(exerciseName: string, enabled: boolean): { state: ExerciseVideosState; retry: () => void } {
  const { status: authStatus } = useAuth();
  const [state, setState] = useState<ExerciseVideosState>({ status: 'idle' });
  const [attempt, setAttempt] = useState(0);
  const retry = useCallback(() => setAttempt((n) => n + 1), []);

  useEffect(() => {
    if (!enabled) return;
    if (authStatus !== 'authenticated') {
      setState({ status: 'signed_out' });
      return;
    }
    const key = resolveVideoExerciseKey(exerciseName);
    if (!key) {
      setState({ status: 'no_mapping' });
      return;
    }
    const service = getVideoCatalogService();
    if (!service) {
      setState({ status: 'unavailable' });
      return;
    }

    let cancelled = false;
    setState({ status: 'loading' });
    service
      .getVideosForExercise(key)
      .then((result) => {
        if (cancelled) return;
        if (!result.ok) setState({ status: 'error' });
        else setState(result.data.length ? { status: 'ready', videos: result.data } : { status: 'empty' });
      })
      .catch(() => {
        if (!cancelled) setState({ status: 'error' });
      });
    return () => {
      cancelled = true;
    };
  }, [enabled, authStatus, exerciseName, attempt]);

  return { state, retry };
}
