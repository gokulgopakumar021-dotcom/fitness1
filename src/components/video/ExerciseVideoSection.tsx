import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronDown, Loader2, PlayCircle, RefreshCw, Video, VideoOff } from 'lucide-react';
import { getVideoCatalogService, useExerciseVideos } from '../../hooks/useExerciseVideos';
import type { ExerciseVideo } from '../../types/video';

/**
 * Exercise video section for the posture modal.
 *
 * - Metadata (one small query) is requested only once the section is open.
 * - A playback URL is signed for ONE video, only after the person picks it. Signed URLs live in component state
 *   only; they are never stored.
 * - Nothing here touches workout state. Every failure renders as a message inside this section.
 */

export function formatDuration(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds) || seconds < 0) return '';
  const total = Math.round(seconds);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

type PlayerPhase = { kind: 'signing' } | { kind: 'ready'; url: string } | { kind: 'error'; message: string };

const PLAYER_ERROR = 'This video could not be played. Check your connection and try again.';

const VideoPlayer: React.FC<{ video: ExerciseVideo }> = ({ video }) => {
  const [phase, setPhase] = useState<PlayerPhase>({ kind: 'signing' });
  const [attempt, setAttempt] = useState(0);
  // A failed load most often means the signed URL expired, so the first failure re-signs once automatically.
  const autoResignedRef = useRef(false);

  useEffect(() => {
    autoResignedRef.current = false;
  }, [video.id]);

  useEffect(() => {
    const service = getVideoCatalogService();
    if (!service) {
      setPhase({ kind: 'error', message: 'Video playback is unavailable right now.' });
      return;
    }
    let cancelled = false;
    setPhase({ kind: 'signing' });
    service
      .getPlaybackUrl(video.storageKey)
      .then((result) => {
        if (cancelled) return;
        setPhase(result.ok ? { kind: 'ready', url: result.data } : { kind: 'error', message: 'This video is not available right now.' });
      })
      .catch(() => {
        if (!cancelled) setPhase({ kind: 'error', message: PLAYER_ERROR });
      });
    return () => {
      cancelled = true;
    };
  }, [video.id, video.storageKey, attempt]);

  // Stable callback ref: when the <video> element unmounts, stop it and release the network connection.
  const attachVideo = useCallback((el: HTMLVideoElement | null) => {
    if (!el) return;
    return () => {
      try {
        el.pause();
        el.removeAttribute('src');
        el.load();
      } catch {
        /* element already torn down */
      }
    };
  }, []);

  const onVideoError = () => {
    if (!autoResignedRef.current) {
      autoResignedRef.current = true;
      setAttempt((n) => n + 1);
      return;
    }
    setPhase({ kind: 'error', message: PLAYER_ERROR });
  };

  const retry = () => {
    autoResignedRef.current = false;
    setAttempt((n) => n + 1);
  };

  if (phase.kind === 'signing') {
    return (
      <div role="status" className="flex items-center justify-center gap-2 aspect-video w-full rounded-xl bg-canvas border border-line text-xs text-zinc-400">
        <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
        <span>Preparing video…</span>
      </div>
    );
  }

  if (phase.kind === 'error') {
    return (
      <div role="alert" className="flex flex-col items-center justify-center gap-2 aspect-video w-full rounded-xl bg-canvas border border-rose-500/30 p-4 text-center">
        <VideoOff className="w-5 h-5 text-rose-400" aria-hidden="true" />
        <p className="text-xs text-zinc-300">{phase.message}</p>
        <button
          type="button"
          onClick={retry}
          className="px-3 py-1.5 bg-surface-3 hover:bg-zinc-700 text-zinc-100 rounded-lg text-xs font-semibold flex items-center gap-1"
        >
          <RefreshCw className="w-3.5 h-3.5" aria-hidden="true" />
          <span>Try again</span>
        </button>
      </div>
    );
  }

  // No autoPlay: playback always starts from the person's own tap. playsInline keeps iOS from forcing fullscreen.
  return (
    <video
      key={phase.url}
      ref={attachVideo}
      src={phase.url}
      controls
      playsInline
      preload="metadata"
      onError={onVideoError}
      aria-label={video.title}
      className="w-full max-h-[60vh] rounded-xl bg-black"
    />
  );
};

interface ExerciseVideoSectionProps {
  exerciseName: string;
  /** Open on mount (the Watch video button). Otherwise the section stays collapsed and requests nothing. */
  defaultOpen?: boolean;
}

export const ExerciseVideoSection: React.FC<ExerciseVideoSectionProps> = ({ exerciseName, defaultOpen = false }) => {
  const [open, setOpen] = useState<boolean>(defaultOpen);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const { state, retry } = useExerciseVideos(exerciseName, open);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setSelectedId(null);
  }, [exerciseName]);

  useEffect(() => {
    if (defaultOpen) rootRef.current?.scrollIntoView?.({ block: 'nearest' });
  }, [defaultOpen]);

  const selected = state.status === 'ready' ? state.videos.find((v) => v.id === selectedId) ?? null : null;

  const message = (text: string, role: 'status' | 'alert' = 'status') => (
    <p role={role} className="text-xs text-zinc-400 leading-relaxed">
      {text}
    </p>
  );

  return (
    <div ref={rootRef} className="bg-surface-2/60 border border-line rounded-xl">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-controls="exercise-video-panel"
        className="w-full px-3.5 py-2.5 flex items-center justify-between gap-2 text-left"
      >
        <span className="flex items-center gap-2 text-xs font-bold text-zinc-100">
          <Video className="w-4 h-4 text-sky-400" aria-hidden="true" />
          <span>Exercise video</span>
        </span>
        <ChevronDown className={`w-4 h-4 text-zinc-400 transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden="true" />
      </button>

      {open && (
        <div id="exercise-video-panel" className="px-3.5 pb-3.5 space-y-3">
          {state.status === 'loading' && (
            <div role="status" className="flex items-center gap-2 text-xs text-zinc-400">
              <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
              <span>Loading videos…</span>
            </div>
          )}

          {(state.status === 'empty' || state.status === 'no_mapping') &&
            message('No approved video for this exercise yet. Your workout is not affected.')}

          {state.status === 'signed_out' && message('Sign in to watch exercise videos.')}

          {state.status === 'unavailable' && message('Exercise videos are unavailable right now. Your workout is not affected.')}

          {state.status === 'error' && (
            <div role="alert" className="flex flex-wrap items-center gap-2 text-xs text-zinc-300">
              <span>Couldn&apos;t load videos. Your workout is not affected.</span>
              <button
                type="button"
                onClick={retry}
                className="px-2.5 py-1 bg-surface-3 hover:bg-zinc-700 text-zinc-100 rounded-lg font-semibold flex items-center gap-1"
              >
                <RefreshCw className="w-3.5 h-3.5" aria-hidden="true" />
                <span>Retry</span>
              </button>
            </div>
          )}

          {state.status === 'ready' && (
            <>
              <ul className="space-y-1.5" aria-label="Available videos">
                {state.videos.map((v) => {
                  const isSelected = v.id === selectedId;
                  const duration = formatDuration(v.durationSeconds);
                  return (
                    <li key={v.id}>
                      <button
                        type="button"
                        onClick={() => setSelectedId(v.id)}
                        aria-pressed={isSelected}
                        className={`w-full px-3 py-2 rounded-lg border text-left text-xs flex items-center justify-between gap-2 transition-colors ${
                          isSelected ? 'bg-surface-3 border-lime-400/50 text-lime-300' : 'bg-canvas border-line text-zinc-200 hover:bg-surface-3'
                        }`}
                      >
                        <span className="flex items-center gap-2 min-w-0">
                          <PlayCircle className="w-4 h-4 shrink-0" aria-hidden="true" />
                          <span className="truncate font-semibold">{v.title}</span>
                        </span>
                        {duration && <span className="font-mono text-[11px] text-zinc-400 shrink-0">{duration}</span>}
                      </button>
                    </li>
                  );
                })}
              </ul>
              {selected && <VideoPlayer key={selected.id} video={selected} />}
            </>
          )}
        </div>
      )}
    </div>
  );
};
