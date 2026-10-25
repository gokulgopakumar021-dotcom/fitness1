import React from 'react';
import { CircleAlert, CircleCheck, LoaderCircle, RotateCcw, TriangleAlert } from 'lucide-react';
import type { ScanView } from '../../types/bodyScan';
import { CAPTURE_GUIDANCE } from './captureGuidance';
import { CHECK_LABELS, CaptureQualityPanel } from './CaptureQualityPanel';
import type { DetectionState } from './usePoseDetection';

const focusRing = 'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-lime-400';
const secondaryBtn = `touch-press inline-flex items-center justify-center gap-2 px-3 py-2 bg-zinc-900 border border-zinc-800 hover:border-zinc-700 text-zinc-200 rounded-xl text-xs font-semibold ${focusRing}`;

interface PoseDetectionPanelProps {
  view: ScanView;
  /** Undefined until a photo has been accepted for this view. */
  state: DetectionState | undefined;
  /** Re-runs the analysis on the photo already held in memory. Never touches the camera. */
  onRetry: () => void;
}

/**
 * Shows what on-device pose detection found for ONE view's photo.
 *
 * Wording rules: this reports whether body landmarks were found and whether the
 * framing looks usable. It never says anything is measured, scored or saved, and
 * it always names the quality checks that were not run (lighting, sharpness,
 * holding still) instead of implying they passed.
 */
export const PoseDetectionPanel: React.FC<PoseDetectionPanelProps> = ({ view, state, onRetry }) => {
  if (!state) return null;
  const label = CAPTURE_GUIDANCE[view].label.toLowerCase();

  if (state.phase === 'loading_model' || state.phase === 'detecting') {
    return (
      <div role="status" className="flex items-start gap-2 rounded-lg border border-zinc-800 bg-black/30 p-3 text-xs text-zinc-300">
        <LoaderCircle className="mt-0.5 h-4 w-4 shrink-0 motion-safe:animate-spin text-lime-400" aria-hidden="true" />
        <span>
          {state.phase === 'loading_model'
            ? 'Preparing on-device pose detection… The first time, this downloads the pose model to this browser.'
            : `Looking for body landmarks in your ${label} photo on this device…`}
          <span className="block text-zinc-500">The photo is not uploaded.</span>
        </span>
      </div>
    );
  }

  if (state.phase === 'error') {
    return (
      <div role="alert" className="space-y-2 rounded-lg border border-rose-500/30 bg-rose-500/10 p-3 text-xs text-rose-100">
        <p className="flex items-start gap-2">
          <CircleAlert className="mt-0.5 h-4 w-4 shrink-0 text-rose-400" aria-hidden="true" />
          <span>{state.message}</span>
        </p>
        {state.retryable ? (
          <>
            <p className="text-rose-200/80">Your photo is still here, so you can try again without turning the camera on.</p>
            <button type="button" onClick={onRetry} className={secondaryBtn}>
              <RotateCcw className="h-4 w-4" aria-hidden="true" />
              {`Try ${label} analysis again`}
            </button>
          </>
        ) : (
          <p className="text-rose-200/80">You can keep or discard this photo, but it cannot be analysed in this browser.</p>
        )}
      </div>
    );
  }

  const { outcome } = state;
  const tone =
    outcome.status === 'usable'
      ? { box: 'border-lime-400/30 bg-lime-400/5 text-zinc-100', icon: <CircleCheck className="mt-0.5 h-4 w-4 shrink-0 text-lime-400" aria-hidden="true" /> }
      : outcome.status === 'partial'
        ? { box: 'border-amber-500/30 bg-amber-500/10 text-amber-100', icon: <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" aria-hidden="true" /> }
        : { box: 'border-rose-500/30 bg-rose-500/10 text-rose-100', icon: <CircleAlert className="mt-0.5 h-4 w-4 shrink-0 text-rose-400" aria-hidden="true" /> };

  const notChecked = (outcome.assessment?.checks ?? []).filter((c) => c.status === 'not_evaluated').map((c) => CHECK_LABELS[c.id]);

  return (
    <div role="status" className={`space-y-2 rounded-lg border p-3 text-xs ${tone.box}`} data-testid={`pose-result-${view}`} data-status={outcome.status}>
      <p className="flex items-start gap-2 font-semibold">
        {tone.icon}
        <span>{outcome.headline}</span>
      </p>

      {outcome.required && (
        <p className="text-zinc-300">
          {`${outcome.required.reliable} of ${outcome.required.total} required body points were clearly visible in this ${label} photo.`}
        </p>
      )}

      {outcome.details.length > 0 && (
        <ul className="list-disc space-y-0.5 pl-5 text-zinc-300">
          {outcome.details.map((d) => (
            <li key={d}>{d}</li>
          ))}
        </ul>
      )}

      {outcome.status !== 'usable' && outcome.advice.length > 0 && (
        <ul className="list-disc space-y-0.5 pl-5 text-zinc-200">
          {outcome.advice.map((a) => (
            <li key={a}>{a}</li>
          ))}
        </ul>
      )}

      {notChecked.length > 0 && (
        <p className="text-zinc-400">{`Not checked in this version: ${notChecked.join(', ').toLowerCase()}.`}</p>
      )}

      <p className="text-zinc-500">
        Pose detection only finds body landmarks in this photo. It does not measure or assess your body, and nothing is saved.
      </p>

      {outcome.assessment && (
        <details open={outcome.status !== 'usable'} className="rounded-lg">
          <summary className={`cursor-pointer text-zinc-300 ${focusRing}`}>Photo quality checks</summary>
          <div className="pt-2">
            <CaptureQualityPanel assessment={outcome.assessment} headingId={`pose-quality-heading-${view}`} />
          </div>
        </details>
      )}

      {outcome.failureReason === 'malformed_result' && (
        <button type="button" onClick={onRetry} className={secondaryBtn}>
          <RotateCcw className="h-4 w-4" aria-hidden="true" />
          {`Try ${label} analysis again`}
        </button>
      )}
    </div>
  );
};
