import React, { useState } from 'react';
import { Loader2, PlayCircle, RefreshCw, Search, SearchX, Video, VideoOff, X } from 'lucide-react';
import { useVideoLibrary } from '../../hooks/useVideoLibrary';
import { VideoPlayer, formatDuration } from './ExerciseVideoSection';
import { EmptyState, Modal, PageHeader } from '../ui';
import type { ExerciseVideo } from '../../types/video';

/**
 * Video Library screen: search published videos by title, tap one to watch.
 *
 * - One page of results at a time (never the whole catalog); "Show more" fetches the next page.
 * - A playback URL is signed only for the video the person opens, inside VideoPlayer (shared with the posture
 *   modal). Signed URLs live in that component's state only and the <video> is released when the dialog closes.
 * - Every failure renders as a message on this screen; nothing here touches workout state.
 */

const tagsOf = (v: ExerciseVideo) => [...v.equipment, ...v.muscleGroups].slice(0, 4);

const ResultRow: React.FC<{ video: ExerciseVideo; onOpen: (v: ExerciseVideo) => void }> = ({ video, onOpen }) => {
  const duration = formatDuration(video.durationSeconds);
  const tags = tagsOf(video);
  return (
    <li>
      <button
        type="button"
        onClick={() => onOpen(video)}
        className="w-full min-h-[56px] px-3.5 py-2.5 rounded-xl bg-surface-2 border border-line hover:border-line-strong active:bg-surface-3 text-left flex items-center gap-3 transition-colors"
      >
        <PlayCircle className="w-6 h-6 shrink-0 text-sky-400" aria-hidden="true" />
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold text-zinc-100 break-words">{video.title}</span>
          {tags.length > 0 && (
            <span className="mt-1 flex flex-wrap gap-1">
              {tags.map((t) => (
                <span key={t} className="px-1.5 py-0.5 rounded-md bg-canvas border border-line text-[11px] text-zinc-400">
                  {t}
                </span>
              ))}
            </span>
          )}
        </span>
        {duration && <span className="font-mono text-xs text-zinc-400 shrink-0">{duration}</span>}
      </button>
    </li>
  );
};

export const VideoLibraryView: React.FC = () => {
  const { input, setInput, state, loadingMore, loadMoreError, loadMore, submit, retry } = useVideoLibrary();
  const [selected, setSelected] = useState<ExerciseVideo | null>(null);

  return (
    <div className="max-w-2xl mx-auto w-full min-w-0">
      <PageHeader title="Video Library" description="Search exercise videos by name and tap one to watch." />

      <form
        role="search"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
          (document.activeElement as HTMLElement | null)?.blur?.();
        }}
        className="relative mb-4"
      >
        <Search className="w-5 h-5 text-zinc-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" aria-hidden="true" />
        {/* text-base (16px) stops iOS Safari from zooming the page when the field is focused. */}
        <input
          type="search"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Search exercises, e.g. bench press"
          aria-label="Search exercise videos"
          enterKeyHint="search"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          maxLength={100}
          className="w-full h-12 pl-11 pr-12 rounded-xl bg-surface-2 border border-line-strong text-base text-white placeholder:text-zinc-500 outline-none focus:border-accent [&::-webkit-search-cancel-button]:hidden"
        />
        {input && (
          <button
            type="button"
            onClick={() => setInput('')}
            aria-label="Clear search"
            className="absolute right-1 top-1/2 -translate-y-1/2 w-11 h-11 flex items-center justify-center rounded-xl text-zinc-400 hover:text-white"
          >
            <X className="w-5 h-5" aria-hidden="true" />
          </button>
        )}
      </form>

      {state.status === 'loading' && (
        <div role="status" className="flex items-center justify-center gap-2 py-10 text-sm text-zinc-400">
          <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
          <span>Loading videos…</span>
        </div>
      )}

      {state.status === 'signed_out' && (
        <EmptyState icon={<Video className="w-5 h-5" />} title="Sign in to watch videos" description="The video library is available to signed-in accounts." />
      )}

      {state.status === 'unavailable' && (
        <EmptyState icon={<VideoOff className="w-5 h-5" />} title="Video library unavailable" description="Videos can't be reached right now. The rest of the app is not affected." />
      )}

      {state.status === 'empty_library' && (
        <EmptyState icon={<Video className="w-5 h-5" />} title="No videos yet" description="Videos will appear here once they are published." />
      )}

      {state.status === 'no_results' && (
        <div role="status">
          <EmptyState icon={<SearchX className="w-5 h-5" />} title="No videos found" description="Try a shorter name or a different spelling." />
        </div>
      )}

      {state.status === 'error' && (
        <div role="alert" className="flex flex-col items-center gap-3 py-8 px-4 text-center rounded-2xl border border-rose-500/30">
          <VideoOff className="w-5 h-5 text-rose-400" aria-hidden="true" />
          <p className="text-sm text-zinc-300">Couldn&apos;t load videos. Check your connection and try again.</p>
          <button
            type="button"
            onClick={retry}
            className="min-h-11 px-4 bg-surface-3 hover:bg-zinc-700 text-zinc-100 rounded-xl text-sm font-semibold flex items-center gap-1.5"
          >
            <RefreshCw className="w-4 h-4" aria-hidden="true" />
            <span>Retry</span>
          </button>
        </div>
      )}

      {state.status === 'ready' && (
        <>
          <ul className="space-y-2" aria-label="Videos">
            {state.items.map((v) => (
              <ResultRow key={v.id} video={v} onOpen={setSelected} />
            ))}
          </ul>

          {loadMoreError && (
            <p role="alert" className="mt-3 text-center text-xs text-zinc-300">
              Couldn&apos;t load more videos.
            </p>
          )}
          {state.nextCursor && (
            <button
              type="button"
              onClick={loadMore}
              disabled={loadingMore}
              className="mt-3 w-full min-h-12 rounded-xl bg-surface-2 border border-line-strong hover:bg-surface-3 text-sm font-semibold text-zinc-100 flex items-center justify-center gap-2 disabled:opacity-60"
            >
              {loadingMore ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> : null}
              <span>{loadingMore ? 'Loading…' : loadMoreError ? 'Try again' : 'Show more'}</span>
            </button>
          )}
        </>
      )}

      {/* Mounted only while a video is open, so closing it unmounts the player and releases the media element. */}
      <Modal open={selected !== null} onClose={() => setSelected(null)} title={selected?.title ?? 'Video'} size="md">
        {selected && (
          <div className="pb-[env(safe-area-inset-bottom)]">
            <VideoPlayer key={selected.id} video={selected} />
          </div>
        )}
      </Modal>
    </div>
  );
};
