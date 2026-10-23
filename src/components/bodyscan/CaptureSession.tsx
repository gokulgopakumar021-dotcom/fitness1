import React, { useState } from 'react';
import { Camera, CircleCheck, CircleDashed, Info, Trash2 } from 'lucide-react';
import type { NewScanPhoto, ScanView } from '../../types/bodyScan';
import { CAPTURE_GUIDANCE } from './captureGuidance';
import { CameraCapture } from './CameraCapture';
import { useObjectUrl } from './useObjectUrl';

const focusRing = 'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-lime-400';
const VIEWS: ScanView[] = ['front', 'side'];

const PhotoThumb: React.FC<{ photo: NewScanPhoto }> = ({ photo }) => {
  const url = useObjectUrl(photo.blob);
  if (!url) return null;
  return (
    <img
      src={url}
      alt={`Temporary ${photo.view} photo`}
      className="h-24 w-auto rounded-lg border border-zinc-800 bg-black object-contain"
    />
  );
};

/**
 * Phase 2B capture flow: front photo, then side photo.
 *
 * Photos live only in this component's React state. They are not written to
 * IndexedDB, localStorage or any server, and are dropped when the person
 * discards them or leaves the Body Scan screen. Taking both photos does NOT
 * complete a scan: there is no pose analysis or measurement yet.
 */
export const CaptureSession: React.FC = () => {
  const [active, setActive] = useState<ScanView | null>(null);
  const [photos, setPhotos] = useState<Partial<Record<ScanView, NewScanPhoto>>>({});

  if (active) {
    return (
      <CameraCapture
        key={active}
        view={active}
        onCaptured={(photo) => {
          setPhotos((prev) => ({ ...prev, [active]: photo }));
          setActive(null);
        }}
        onCancel={() => setActive(null)}
      />
    );
  }

  const taken = VIEWS.filter((v) => photos[v]).length;

  return (
    <section aria-labelledby="capture-session-heading" className="bg-[#0d1117] border border-zinc-800 rounded-2xl p-5 lg:p-7 shadow-xl space-y-5">
      <div>
        <div className="flex items-center gap-2 text-lime-400 text-xs font-mono font-semibold uppercase tracking-wider mb-1">
          <Camera className="w-4 h-4" aria-hidden="true" />
          <span>Guided photos (preview)</span>
        </div>
        <h2 id="capture-session-heading" className="text-xl font-bold text-zinc-100">
          Take your front and side photos
        </h2>
      </div>

      <p className="flex items-start gap-2 text-xs leading-relaxed text-zinc-400">
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-lime-400" aria-hidden="true" />
        <span>
          Photo capture is available as a preview. Pose analysis, measurements and saving are not available yet, so taking
          these photos does not complete a scan. Photos are kept only in this tab and are not saved or uploaded, even if you
          allowed photo storage.
        </span>
      </p>

      <ul className="grid gap-3 sm:grid-cols-2">
        {VIEWS.map((view) => {
          const g = CAPTURE_GUIDANCE[view];
          const photo = photos[view];
          return (
            <li key={view} className="rounded-xl border border-zinc-800 bg-zinc-950/60 p-4 space-y-3">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 text-sm font-semibold text-zinc-100">
                  {photo ? (
                    <CircleCheck className="h-4 w-4 text-lime-400" aria-hidden="true" />
                  ) : (
                    <CircleDashed className="h-4 w-4 text-zinc-500" aria-hidden="true" />
                  )}
                  {g.title}
                </div>
                <span className="text-[11px] text-zinc-500">{photo ? 'Taken (temporary)' : 'Not taken'}</span>
              </div>
              {photo && <PhotoThumb photo={photo} />}
              <button
                type="button"
                onClick={() => setActive(view)}
                className={`touch-press w-full sm:w-auto px-4 py-2.5 rounded-xl text-xs font-bold transition-colors ${focusRing} ${
                  photo
                    ? 'bg-zinc-900 border border-zinc-800 hover:border-zinc-700 text-zinc-200'
                    : 'bg-lime-400 hover:bg-lime-300 text-black'
                }`}
              >
                {photo ? `Retake ${g.label.toLowerCase()} photo` : `Take ${g.label.toLowerCase()} photo`}
              </button>
            </li>
          );
        })}
      </ul>

      {taken === 2 && (
        <p role="status" className="text-xs text-zinc-300">
          Both temporary photos are ready. Nothing further happens with them in this version.
        </p>
      )}

      {taken > 0 && (
        <button
          type="button"
          onClick={() => setPhotos({})}
          className={`touch-press inline-flex items-center gap-2 px-3 py-2 bg-zinc-900 border border-zinc-800 hover:border-rose-500/50 text-zinc-300 rounded-xl text-xs font-semibold ${focusRing}`}
        >
          <Trash2 className="h-4 w-4" aria-hidden="true" />
          Discard these photos
        </button>
      )}
    </section>
  );
};
