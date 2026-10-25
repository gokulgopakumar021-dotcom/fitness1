import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Activity, CheckCircle2, Info, Loader2, RotateCcw, Sparkles, TriangleAlert } from 'lucide-react';
import { DailySleepLog, UserProfile, WorkoutPlan, WorkoutSession } from '../../types';
import { db } from '../../storage/db';
import { Button, Modal } from '../ui';
import { buildCoachingContext } from '../../utils/adaptiveCoach/context';
import { generateAdaptiveReview } from '../../utils/adaptiveCoach/engine';
import { applyAcceptedReview, PlanStore } from '../../utils/adaptiveCoach/apply';
import { ExplainOutcome, requestAiExplanation } from '../../utils/adaptiveCoach/client';
import { AdaptiveReview, AiExplanation, CoachingContext, PlanAdjustment } from '../../utils/adaptiveCoach/types';

export interface AdaptiveReviewDeps {
  load: () => { plans: WorkoutPlan[]; activePlanId: string | null; sessions: WorkoutSession[]; sleepLogs: DailySleepLog[] };
  store: PlanStore;
  explain: (ctx: CoachingContext, review: AdaptiveReview) => Promise<ExplainOutcome>;
}

const defaultDeps: AdaptiveReviewDeps = {
  load: () => ({
    plans: db.getPlans(),
    activePlanId: db.getActivePlanId(),
    sessions: db.getSessions(),
    sleepLogs: db.getSleepLogs()
  }),
  store: db,
  explain: (ctx, review) => requestAiExplanation(ctx, review)
};

type Phase = 'idle' | 'loading' | 'ready' | 'applied' | 'dismissed';

const AI_NOTE: Record<string, string> = {
  not_configured: 'AI explanations are not set up on this server, so you are seeing the rule-based reasoning.',
  invalid_ai_response: 'The AI explanation could not be verified, so you are seeing the rule-based reasoning.',
  timeout: 'The AI explanation timed out, so you are seeing the rule-based reasoning.',
  network: 'Could not reach the AI service, so you are seeing the rule-based reasoning.',
  service_error: 'The AI service is unavailable right now, so you are seeing the rule-based reasoning.'
};

function describeChange(a: PlanAdjustment): { before: string; after: string } {
  if (a.kind === 'reduce_sets') return { before: `${a.from} sets`, after: `${a.to} sets` };
  if (a.kind === 'increase_rest') return { before: `${a.from}s rest`, after: `${a.to}s rest` };
  return { before: a.from, after: a.to };
}

interface Props {
  open: boolean;
  onClose: () => void;
  profile: UserProfile;
  activeSession: WorkoutSession | null;
  deps?: AdaptiveReviewDeps;
}

export const AdaptiveReviewModal: React.FC<Props> = ({ open, onClose, profile, activeSession, deps = defaultDeps }) => {
  const [phase, setPhase] = useState<Phase>('idle');
  const [review, setReview] = useState<AdaptiveReview | null>(null);
  const [ai, setAi] = useState<AiExplanation | null>(null);
  const [aiNote, setAiNote] = useState<string | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [applied, setApplied] = useState<string[]>([]);
  const [applying, setApplying] = useState(false);
  const busy = useRef(false); // blocks double submits before state re-renders
  const runId = useRef(0);

  useEffect(() => {
    if (!open) {
      runId.current++;
      setPhase('idle');
      setReview(null);
      setAi(null);
      setAiNote(null);
      setError(null);
      setApplied([]);
      busy.current = false;
      setApplying(false);
    }
  }, [open]);

  const runReview = useCallback(async () => {
    const id = ++runId.current;
    setPhase('loading');
    setError(null);
    setAi(null);
    setAiNote(null);
    let ctx: CoachingContext;
    let result: AdaptiveReview;
    try {
      const data = deps.load();
      ctx = buildCoachingContext({ profile, activeSession, ...data });
      result = generateAdaptiveReview(ctx);
    } catch {
      if (id === runId.current) {
        setError('Your training data could not be read, so no review was made.');
        setPhase('idle');
      }
      return;
    }
    setReview(result);
    setSelected(result.adjustments.map((a) => a.id));
    setPhase('ready');
    if (result.status === 'ok' && (result.adjustments.length > 0 || result.notes.length > 0)) {
      const outcome = await deps.explain(ctx, result);
      if (id !== runId.current) return;
      if (outcome.kind === 'ai') setAi(outcome.explanation);
      else setAiNote(AI_NOTE[outcome.reason] ?? null);
    }
  }, [deps, profile, activeSession]);

  const accept = () => {
    if (!review || busy.current || selected.length === 0) return;
    busy.current = true;
    setApplying(true);
    setError(null);
    try {
      const result = applyAcceptedReview(review, selected, deps.store);
      if (result.ok) {
        setApplied(result.applied);
        setPhase('applied');
      } else {
        setError(result.message);
        if (result.reason === 'already_applied') setPhase('applied');
      }
    } catch {
      setError('Something went wrong and nothing was changed.');
    } finally {
      busy.current = false;
      setApplying(false);
    }
  };

  const toggle = (id: string) => setSelected((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));

  const showApply = phase === 'ready' && review?.status === 'ok' && review.adjustments.length > 0;

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title="Adaptive training review"
      description="Coach Iron checks your logged history before suggesting changes. Nothing changes until you accept."
      footer={
        showApply ? (
          <>
            <Button variant="ghost" onClick={() => setPhase('dismissed')}>Dismiss</Button>
            <Button variant="secondary" icon={<RotateCcw className="w-4 h-4" />} onClick={runReview}>Reconsider</Button>
            <Button onClick={accept} loading={applying} disabled={applying || selected.length === 0}>
              Apply {selected.length} change{selected.length === 1 ? '' : 's'}
            </Button>
          </>
        ) : undefined
      }
    >
      <div className="space-y-4">
        {error && (
          <div role="alert" className="flex gap-2 p-3 rounded-xl bg-danger/10 border border-danger/30 text-sm text-danger">
            <TriangleAlert className="w-4 h-4 mt-0.5 shrink-0" aria-hidden />
            <span>{error}</span>
          </div>
        )}

        {phase === 'idle' && (
          <div className="space-y-3">
            <p className="text-sm text-zinc-300">
              I will look at your next planned workout, your recent logged sessions, your progression data and any recovery or sleep you have logged, then suggest small changes only where the evidence supports them.
            </p>
            <Button icon={<Activity className="w-4 h-4" />} onClick={runReview}>Review my training</Button>
          </div>
        )}

        {phase === 'loading' && (
          <div role="status" className="py-10 flex flex-col items-center gap-3 text-zinc-300 text-sm">
            <Loader2 className="w-6 h-6 animate-spin text-accent" aria-hidden />
            Reviewing your training history…
          </div>
        )}

        {phase === 'dismissed' && (
          <div className="space-y-3">
            <p className="text-sm text-zinc-300">Dismissed. Your plan was not changed.</p>
            <Button variant="secondary" onClick={runReview}>Review again</Button>
          </div>
        )}

        {phase === 'applied' && (
          <div role="status" className="space-y-3">
            <div className="flex gap-2 text-sm text-success">
              <CheckCircle2 className="w-5 h-5 shrink-0" aria-hidden />
              <span className="font-semibold">Saved to your plan</span>
            </div>
            <ul className="text-sm text-zinc-200 space-y-1 list-disc pl-5">
              {applied.map((l) => <li key={l}>{l}</li>)}
            </ul>
            <p className="text-xs text-zinc-400">Only the saved plan changed. Your logged workouts and any in-progress session are untouched.</p>
            <Button variant="secondary" onClick={onClose}>Done</Button>
          </div>
        )}

        {phase === 'ready' && review && review.status !== 'ok' && (
          <div className="space-y-2">
            <h3 className="text-base font-semibold text-white">{review.headline}</h3>
            <ul className="text-sm text-zinc-300 space-y-1 list-disc pl-5">
              {review.missingInfo.map((m) => <li key={m}>{m}</li>)}
            </ul>
          </div>
        )}

        {phase === 'ready' && review?.status === 'ok' && (
          <div className="space-y-4">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <span className="text-[11px] font-semibold px-2 py-0.5 rounded bg-surface-2 border border-line text-zinc-300">
                  {ai ? 'Rule-based review · AI-explained' : 'Rule-based review'}
                </span>
                {!ai && !aiNote && (review.adjustments.length > 0 || review.notes.length > 0) && (
                  <span className="text-xs text-zinc-400 flex items-center gap-1"><Loader2 className="w-3 h-3 animate-spin" aria-hidden />Adding AI explanation…</span>
                )}
              </div>
              <h3 className="text-base font-semibold text-white">{review.headline}</h3>
              {ai?.summary && <p className="text-sm text-zinc-300 mt-1 flex gap-1.5"><Sparkles className="w-4 h-4 text-accent shrink-0 mt-0.5" aria-hidden />{ai.summary}</p>}
              {aiNote && <p className="text-xs text-zinc-400 mt-1 flex gap-1.5"><Info className="w-3.5 h-3.5 shrink-0 mt-0.5" aria-hidden />{aiNote}</p>}
            </div>

            {review.adjustments.length === 0 && (
              <p className="text-sm text-zinc-300">Your recent data does not show a reason to change this session, so no edits are proposed.</p>
            )}

            {review.adjustments.length > 0 && (
              <fieldset className="space-y-2">
                <legend className="text-xs font-semibold uppercase tracking-wide text-zinc-400 mb-1">Proposed plan changes</legend>
                {review.adjustments.map((a) => {
                  const ch = describeChange(a);
                  const checkId = `adj-${a.id}`;
                  return (
                    <div key={a.id} className="p-3 rounded-xl bg-surface-2 border border-line">
                      <div className="flex items-start gap-3">
                        <input
                          id={checkId}
                          type="checkbox"
                          className="mt-1 w-5 h-5 accent-[var(--accent)]"
                          checked={selected.includes(a.id)}
                          onChange={() => toggle(a.id)}
                          disabled={applying}
                        />
                        <label htmlFor={checkId} className="min-w-0 flex-1 cursor-pointer">
                          <span className="block text-sm font-semibold text-white">{a.exerciseName}</span>
                          <span className="block text-sm text-zinc-200 tabular">
                            {ch.before} <span aria-label="changes to">→</span> <strong>{ch.after}</strong>
                          </span>
                          <span className="block text-xs text-zinc-400 mt-1">{ai?.byAdjustmentId[a.id] ?? a.reason}</span>
                        </label>
                      </div>
                    </div>
                  );
                })}
                <p className="text-xs text-zinc-400">
                  Applies to “{review.targetDayName}” in your saved plan only. History and any in-progress workout stay as they are.
                </p>
              </fieldset>
            )}

            {review.notes.length > 0 && (
              <div className="space-y-1.5">
                <h4 className="text-xs font-semibold uppercase tracking-wide text-zinc-400">For your information (not applied)</h4>
                <ul className="text-sm text-zinc-300 space-y-1 list-disc pl-5">
                  {review.notes.map((n) => <li key={n.id}>{n.text}</li>)}
                </ul>
              </div>
            )}

            {review.evidence.length > 0 && (
              <details className="rounded-xl border border-line p-3">
                <summary className="cursor-pointer text-sm font-semibold text-zinc-200">Supporting data ({review.evidence.length})</summary>
                <ul className="mt-2 space-y-1.5 text-sm text-zinc-300">
                  {review.evidence.map((e) => (
                    <li key={e.id}><span className="font-medium text-zinc-100">{e.label}.</span> {e.detail}</li>
                  ))}
                </ul>
              </details>
            )}

            {review.caveats.length > 0 && (
              <ul className="text-xs text-zinc-400 space-y-1 list-disc pl-5">
                {review.caveats.map((c) => <li key={c}>{c}</li>)}
              </ul>
            )}

            {review.adjustments.length === 0 && (
              <Button variant="secondary" icon={<RotateCcw className="w-4 h-4" />} onClick={runReview}>Reconsider</Button>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
};
