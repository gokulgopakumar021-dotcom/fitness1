import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Heart } from 'lucide-react';
import { Badge, Button } from '../ui';
import { fetchWorkoutHeartRate, type WorkoutHrResult } from '../../wearables/workoutHrClient';
import type { SessionConfirmation, WorkoutHrSummary } from '../../wearables/workoutHrSummary';

/**
 * Stored wearable heart rate for ONE past workout, shown inside workout history. Read-only: it never changes the workout, its
 * volume or any other statistic. Loaded only when the person opens it (no background requests, nothing for sessions without it).
 * Shows only what the server returned; it never estimates calories, zones or missing values.
 */
const CONFIRMATION: Record<SessionConfirmation, { tone: 'success' | 'neutral'; label: string; hint: string }> = {
  verified: { tone: 'success', label: 'Matched to this workout', hint: 'Iron Log confirmed this workout was saved to your account and the readings fall inside it.' },
  mixed: { tone: 'neutral', label: 'Partly matched', hint: 'Some readings were confirmed inside this workout; others arrived before the workout was saved to your account and could not be confirmed.' },
  unverified: { tone: 'neutral', label: 'Not confirmed', hint: 'These readings were labelled with this workout when recorded, but the workout had not been saved to your account yet, so Iron Log could not confirm the match.' }
};

const MESSAGES: Record<'none' | 'unauthenticated' | 'rate_limited' | 'unavailable' | 'failed', string> = {
  none: 'No wearable heart rate was stored for this workout.',
  unauthenticated: 'Sign in again to see stored heart rate.',
  rate_limited: 'Too many requests. Try again in a minute.',
  unavailable: 'Stored heart rate is temporarily unavailable. Nothing was changed.',
  failed: 'Heart rate could not be loaded.'
};

const time = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

const Sparkline: React.FC<{ summary: WorkoutHrSummary }> = ({ summary }) => {
  const pts = summary.series;
  if (pts.length < 2) return null;
  const W = 240; const H = 48; const pad = 3;
  const lo = Math.min(...pts.map((p) => p.bpm)); const hi = Math.max(...pts.map((p) => p.bpm));
  const t0 = Date.parse(pts[0].t); const span = Math.max(1, Date.parse(pts[pts.length - 1].t) - t0);
  const x = (t: string) => pad + ((Date.parse(t) - t0) / span) * (W - pad * 2);
  const y = (b: number) => (hi === lo ? H / 2 : H - pad - ((b - lo) / (hi - lo)) * (H - pad * 2));
  const d = pts.map((p) => `${x(p.t).toFixed(1)},${y(p.bpm).toFixed(1)}`).join(' ');
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-12 text-accent" role="img"
      aria-label={`Heart rate over the workout, ${lo} to ${hi} beats per minute, averaged for display`} preserveAspectRatio="none">
      <polyline points={d} fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
};

interface Props {
  sessionId: string;
  /** Injectable for tests. */
  fetcher?: (sessionId: string, signal?: AbortSignal) => Promise<WorkoutHrResult>;
}

export const WorkoutHeartRate: React.FC<Props> = ({ sessionId, fetcher = fetchWorkoutHeartRate }) => {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<WorkoutHrResult | null>(null);
  const ctl = useRef<AbortController | null>(null);

  const load = useCallback(async () => {
    ctl.current?.abort();
    const c = new AbortController();
    ctl.current = c;
    setLoading(true);
    const r = await fetcher(sessionId, c.signal);
    if (c.signal.aborted) return;
    setResult(r);
    setLoading(false);
  }, [fetcher, sessionId]);

  useEffect(() => () => ctl.current?.abort(), []);

  const toggle = () => {
    if (open) { ctl.current?.abort(); setOpen(false); setLoading(false); return; }
    setOpen(true);
    // A successful read is kept while the panel is closed and reopened; a failure is retried.
    if (!result || result.kind !== 'ok') void load();
  };

  const panelId = `hr-${sessionId}`;
  return (
    <div>
      <Button variant="ghost" size="sm" onClick={toggle} aria-expanded={open} aria-controls={panelId} icon={<Heart className="w-4 h-4" aria-hidden />}>
        {open ? 'Hide heart rate' : 'Heart rate'}
      </Button>
      {open && (
        <div id={panelId} className="mt-2 rounded-control bg-surface-2 border border-line p-3 space-y-2" aria-live="polite">
          {loading && <p className="text-xs text-zinc-400">Loading heart rate…</p>}
          {!loading && result && result.kind !== 'ok' && (
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs text-zinc-400">{MESSAGES[result.kind]}</p>
              {result.kind !== 'none' && result.kind !== 'unauthenticated' && <Button variant="secondary" size="sm" onClick={() => void load()}>Retry</Button>}
            </div>
          )}
          {!loading && result?.kind === 'ok' && (() => {
            const s = result.summary; const c = CONFIRMATION[s.session];
            return (
              <>
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <Badge tone={c.tone}>{c.label}</Badge>
                  <span className="text-label font-mono text-zinc-500">{time(s.firstAt)}–{time(s.lastAt)}</span>
                </div>
                <dl className="grid grid-cols-4 gap-2 text-center font-mono tabular">
                  {([['Min', s.minBpm], ['Avg', s.avgBpm], ['Max', s.maxBpm]] as const).map(([k, v]) => (
                    <div key={k}><dt className="text-label text-zinc-500">{k}</dt><dd className="text-sm font-semibold text-white">{v}<span className="text-zinc-500 text-label ml-0.5">bpm</span></dd></div>
                  ))}
                  <div><dt className="text-label text-zinc-500">Readings</dt><dd className="text-sm font-semibold text-white">{s.sampleCount}</dd></div>
                </dl>
                <Sparkline summary={s} />
                <p className="text-label text-zinc-500">{c.hint}</p>
                {s.truncated && <p className="text-label text-warning">This workout has more readings than were loaded; figures describe the readings loaded.</p>}
                <p className="text-label text-zinc-500">Reported by your wearable and stored with this workout. Chart values are averaged for display. Not a medical measurement.</p>
              </>
            );
          })()}
        </div>
      )}
    </div>
  );
};
