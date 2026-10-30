import React, { useState } from 'react';
import { Camera, CircleCheck, CircleDashed, Info, Trash2 } from 'lucide-react';
import type { NewScanPhoto, ScanView } from '../../types/bodyScan';
import { createPoseEngine, type PoseEngine } from '../../services/poseLandmarker';
import { CAPTURE_GUIDANCE } from './captureGuidance';
import { CameraCapture } from './CameraCapture';
import { PoseDetectionPanel } from './PoseDetectionPanel';
import { Button, Card } from '../ui';
import { useObjectUrl } from './useObjectUrl';
import { usePoseDetection, type DetectionState } from './usePoseDetection';

const VIEWS: ScanView[] = ['front', 'side'];

const PhotoThumb: React.FC<{ photo: NewScanPhoto }> = ({ photo }) => {
  const url = useObjectUrl(photo.blob);
  if (!url) return null;
  return (
    <img
      src={url}
      alt={`Temporary ${photo.view} photo`}
      className="h-24 w-auto rounded-lg border border-line bg-black object-contain"
    />
  );
};

type SessionSummary = 'analysing' | 'all_usable' | 'needs_attention';

/**
 * What the footer says once both photos exist. Pose results are ADVISORY in this
 * version: nothing is measured, scored or saved from them, so a failed or partial
 * result never blocks the person from keeping, retaking or discarding photos.
 * The footer must still not read as "all good" when a photo failed or has not
 * been analysed successfully.
 */
export function summariseSession(states: Array<DetectionState | undefined>): SessionSummary {
  if (states.some((s) => !s || s.phase === 'loading_model' || s.phase === 'detecting')) return 'analysing';
  return states.every((s) => s?.phase === 'done' && s.outcome.status === 'usable') ? 'all_usable' : 'needs_attention';
}

const SUMMARY_COPY: Record<SessionSummary, string> = {
  analysing: 'Both temporary photos are taken. They are being checked for body landmarks on this device.',
  all_usable:
    'Both temporary photos show a usable pose. In this version they are only checked for body landmarks on this device; nothing is measured, scored or saved.',
  needs_attention:
    'Both temporary photos are taken, but at least one could not be checked or needs another look (see the results above). You can retake any photo. These results are advisory: nothing is measured, scored or saved in this version.',
};

interface CaptureSessionProps {
  /** Test seam: creates the pose engine. Production uses the real on-device engine. */
  createEngine?: () => PoseEngine;
}

/**
 * Capture flow: front photo, then side photo. Phase 2C adds on-device pose
 * detection for each accepted photo.
 *
 * Photos and detected landmarks live only in this component's React state. They
 * are not written to IndexedDB, localStorage or any server, and are dropped when
 * the person discards them or leaves the Body Scan screen. Each view is analysed
 * on its own; taking both photos does NOT complete a scan: nothing is measured,
 * scored or saved yet.
 */
export const CaptureSession: React.FC<CaptureSessionProps> = ({ createEngine = createPoseEngine }) => {
  const [active, setActive] = useState<ScanView | null>(null);
  const [photos, setPhotos] = useState<Partial<Record<ScanView, NewScanPhoto>>>({});
  const detection = usePoseDetection(createEngine);

  if (active) {
    return (
      <CameraCapture
        key={active}
        view={active}
        onCaptured={(photo) => {
          const view = active;
          setPhotos((prev) => ({ ...prev, [view]: photo }));
          setActive(null);
          detection.run(view, photo.blob); // on-device only; replaces any earlier analysis for this view
        }}
        onCancel={() => setActive(null)}
      />
    );
  }

  const taken = VIEWS.filter((v) => photos[v]).length;
  const summary = summariseSession(VIEWS.map((v) => detection.states[v]));

  return (
    <Card as="section" aria-labelledby="capture-session-heading" className="space-y-5">
      <div>
        <div className="flex items-center gap-2 text-accent text-xs font-semibold mb-1">
          <Camera className="w-4 h-4" aria-hidden="true" />
          <span>Guided photos (preview)</span>
        </div>
        <h2 id="capture-session-heading" className="text-base font-semibold text-white">
          Take your front and side photos
        </h2>
      </div>

      <p className="flex items-start gap-2 text-sm leading-relaxed text-zinc-400">
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-accent" aria-hidden="true" />
        <span>
          Photo capture is available as a preview. After you accept a photo, Iron Log looks for body landmarks in it on this
          device only. Measurements and saving are not available yet, so taking these photos does not complete a scan. Photos
          and detected landmarks are kept only in this tab and are not saved or uploaded, even if you allowed photo storage.
        </span>
      </p>

      <ul className="grid gap-3 sm:grid-cols-2">
        {VIEWS.map((view) => {
          const g = CAPTURE_GUIDANCE[view];
          const photo = photos[view];
          const state = detection.states[view];
          const needsRetake = state?.phase === 'error' || (state?.phase === 'done' && state.outcome.status !== 'usable');
          return (
            <li key={view} className="rounded-control border border-line bg-surface-2 p-4 space-y-3">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 text-sm font-semibold text-zinc-100">
                  {photo ? (
                    <CircleCheck className="h-4 w-4 text-accent" aria-hidden="true" />
                  ) : (
                    <CircleDashed className="h-4 w-4 text-zinc-500" aria-hidden="true" />
                  )}
                  {g.title}
                </div>
                <span className="text-label text-zinc-500">{photo ? 'Taken (temporary)' : 'Not taken'}</span>
              </div>
              {photo && <PhotoThumb photo={photo} />}
              {photo && <PoseDetectionPanel view={view} state={state} onRetry={() => detection.run(view, photo.blob)} />}
              <Button
                variant={photo && !needsRetake ? 'secondary' : 'primary'}
                onClick={() => setActive(view)}
                className="w-full sm:w-auto"
              >
                {photo ? `Retake ${g.label.toLowerCase()} photo` : `Take ${g.label.toLowerCase()} photo`}
              </Button>
            </li>
          );
        })}
      </ul>

      {taken === 2 && (
        <p role="status" className="text-xs text-zinc-300" data-testid="session-summary" data-summary={summary}>
          {SUMMARY_COPY[summary]}
        </p>
      )}

      {taken > 0 && (
        <Button
          variant="secondary"
          icon={<Trash2 className="h-4 w-4" aria-hidden="true" />}
          onClick={() => {
            detection.clearAll(); // cancels any analysis in flight and forgets its landmarks
            setPhotos({});
          }}
        >
          Discard these photos
        </Button>
      )}
    </Card>
  );
};
