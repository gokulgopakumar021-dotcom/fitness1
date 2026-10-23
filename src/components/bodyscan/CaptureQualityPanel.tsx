import React from 'react';
import { CircleAlert, CircleCheck, CircleDashed, TriangleAlert } from 'lucide-react';
import type { CaptureQualityAssessment, QualityCheckId, QualityCheckStatus } from '../../utils/captureQuality';

/**
 * Presents a CaptureQualityAssessment (Phase 2A) honestly.
 *
 * In Phase 2B nothing computes brightness, sharpness, stillness or landmarks, so
 * the camera screen passes NO assessment and this panel says the checks are not
 * running. It never shows a pass, a fail or a score for a check that did not
 * run. When a later phase supplies real inputs it simply passes the assessment.
 */

const CHECK_LABELS: Record<QualityCheckId, string> = {
  landmarks_visible: 'Body landmarks visible',
  in_frame: 'Whole body in frame',
  centered: 'Centred in frame',
  body_height_fraction: 'Distance from camera',
  brightness: 'Lighting',
  sharpness: 'Sharpness',
  stillness: 'Holding still',
};

/** Fixed order so the "not running" list does not depend on any computed result. */
const ALL_CHECKS: QualityCheckId[] = [
  'landmarks_visible',
  'in_frame',
  'centered',
  'body_height_fraction',
  'brightness',
  'sharpness',
  'stillness',
];

const STATUS_TEXT: Record<QualityCheckStatus, string> = {
  pass: 'Looks OK',
  warning: 'Could be better',
  fail: 'Problem',
  not_evaluated: 'Not checked',
};

const StatusIcon: React.FC<{ status: QualityCheckStatus }> = ({ status }) => {
  const cls = 'w-4 h-4 shrink-0 mt-0.5';
  if (status === 'pass') return <CircleCheck className={`${cls} text-lime-400`} aria-hidden="true" />;
  if (status === 'warning') return <TriangleAlert className={`${cls} text-amber-400`} aria-hidden="true" />;
  if (status === 'fail') return <CircleAlert className={`${cls} text-rose-400`} aria-hidden="true" />;
  return <CircleDashed className={`${cls} text-zinc-500`} aria-hidden="true" />;
};

interface CaptureQualityPanelProps {
  /** Real result from the capture pipeline. Omit (or pass null) when no checks are running. */
  assessment?: CaptureQualityAssessment | null;
}

export const CaptureQualityPanel: React.FC<CaptureQualityPanelProps> = ({ assessment }) => {
  const anyEvaluated = !!assessment && assessment.checks.some((c) => c.status !== 'not_evaluated');

  return (
    <section aria-labelledby="capture-quality-heading" className="rounded-xl border border-zinc-800 bg-zinc-950/60 p-4 space-y-3">
      <h3 id="capture-quality-heading" className="text-xs font-mono font-semibold uppercase tracking-wider text-zinc-300">
        Photo quality checks
      </h3>

      {!anyEvaluated && (
        <>
          <p className="text-xs text-zinc-400 leading-relaxed" data-testid="quality-not-running">
            Automatic quality checks are <strong className="text-zinc-200">not running</strong> in this version. Nothing is
            measuring your lighting, sharpness, framing or movement, so judge the preview yourself using the guidance
            above.
          </p>
          <ul className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1.5">
            {ALL_CHECKS.map((id) => (
              <li key={id} className="flex items-start gap-2 text-xs text-zinc-500">
                <StatusIcon status="not_evaluated" />
                <span>
                  {CHECK_LABELS[id]}: <span className="text-zinc-400">{STATUS_TEXT.not_evaluated}</span>
                </span>
              </li>
            ))}
          </ul>
        </>
      )}

      {anyEvaluated && assessment && (
        <>
          <p className="text-xs text-zinc-300 leading-relaxed" data-testid="quality-summary">
            {assessment.status === 'fail' && 'One or more checks found a problem. '}
            {assessment.status === 'warning' && 'Some checks suggest improvements. '}
            {assessment.status === 'pass' && 'No problems were found by the checks that ran. '}
            {!assessment.complete &&
              `${assessment.notEvaluated.length} of ${assessment.checks.length} checks could not be run, so this is a partial result. `}
            These are rough guides, not a guarantee of a good photo.
          </p>
          <ul className="space-y-2">
            {assessment.checks.map((c) => (
              <li key={c.id} className="flex items-start gap-2 text-xs" data-check={c.id} data-status={c.status}>
                <StatusIcon status={c.status} />
                <span className="text-zinc-300">
                  <span className="font-semibold text-zinc-100">{CHECK_LABELS[c.id]}</span>
                  {': '}
                  <span className="text-zinc-400">{STATUS_TEXT[c.status]}</span>
                  {c.status !== 'not_evaluated' && c.message ? <span className="text-zinc-400">{`. ${c.message}`}</span> : null}
                  {c.advice ? <span className="block text-zinc-500">{c.advice}</span> : null}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
};
