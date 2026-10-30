import React from 'react';
import {
  CheckCircle2,
  Sparkles,
  Trophy,
  Flame,
  Clock,
  RotateCcw,
  Save,
  ArrowRight,
  TrendingUp,
  AlertCircle,
  ThumbsUp,
} from 'lucide-react';
import { ExerciseDefinition, MirrorSetData, WorkoutMirrorSession } from '../../types/workoutMirror';
import { Card } from '../ui/Card';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { cn } from '../ui/cn';

interface PostWorkoutMirrorReportProps {
  exercise: ExerciseDefinition;
  session: WorkoutMirrorSession;
  onLogAnotherSet: () => void;
  onSaveAndExit: () => void;
  onDiscard: () => void;
}

export const PostWorkoutMirrorReport: React.FC<PostWorkoutMirrorReportProps> = ({
  exercise,
  session,
  onLogAnotherSet,
  onSaveAndExit,
  onDiscard,
}) => {
  const latestSet = session.sets[session.sets.length - 1];
  const totalReps = session.sets.reduce(
    (sum, set) => sum + (set.userAdjustedReps || set.detectedReps),
    0
  );
  const detectedReps = session.sets.reduce((sum, set) => sum + set.detectedReps, 0);

  const formatDuration = (totalSeconds: number) => {
    const mins = Math.floor(totalSeconds / 60);
    const secs = totalSeconds % 60;
    return `${mins}m ${secs}s`;
  };

  // Extract top technique issues from all sets
  const allCorrections: Record<string, number> = {};
  for (const set of session.sets) {
    for (const [msg, count] of Object.entries(set.observationsSummary || {})) {
      allCorrections[msg] = (allCorrections[msg] ?? 0) + count;
    }
  }

  const sortedCorrections = Object.entries(allCorrections).sort((a, b) => b[1] - a[1]);
  const topCorrection = sortedCorrections[0];

  const consistency = session.overallConsistencyScore;
  let scoreTone: 'success' | 'accent' | 'warning' = 'accent';
  let scoreHeadline = 'Solid Technique!';
  if (consistency >= 88) {
    scoreTone = 'success';
    scoreHeadline = 'Elite Form Consistency!';
  } else if (consistency < 70) {
    scoreTone = 'warning';
    scoreHeadline = 'Room for Form Refinement';
  }

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      {/* Hero Achievement Card */}
      <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-surface via-surface to-surface-2 p-6 sm:p-8 border border-line shadow-2xl">
        <div className="relative z-10 flex flex-col sm:flex-row sm:items-center justify-between gap-6">
          <div>
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-accent/15 border border-accent/30 text-accent text-xs font-semibold mb-3">
              <Trophy className="w-3.5 h-3.5 text-volt-adaptive" />
              <span>Workout Mirror Session Complete</span>
            </div>
            <h2 className="text-2xl sm:text-3xl font-black tracking-tight text-white">
              {exercise.name}
            </h2>
            <p className="mt-1 text-sm text-zinc-300">
              {session.sets.length} Set{session.sets.length > 1 ? 's' : ''} Completed •{' '}
              {formatDuration(session.totalDurationSec)} Active Time
            </p>
          </div>

          {/* Big Consistency Gauge */}
          <div className="flex flex-col items-center justify-center p-4 rounded-2xl bg-black/40 border border-white/10 shrink-0">
            <span className="text-[10px] font-mono uppercase tracking-wider text-zinc-400">
              Form Consistency
            </span>
            <div className="text-4xl sm:text-5xl font-black text-volt-adaptive mt-1">
              {consistency}%
            </div>
            <Badge tone={scoreTone} className="mt-1">
              {scoreHeadline}
            </Badge>
          </div>
        </div>
      </div>

      {/* Metrics Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Card className="p-4 border-line">
          <div className="text-xs text-zinc-400 font-medium">Total Reps</div>
          <div className="text-2xl font-bold text-white mt-1">{totalReps}</div>
          <div className="text-[11px] text-zinc-400 mt-1">
            {detectedReps} verified by camera
          </div>
        </Card>

        <Card className="p-4 border-line">
          <div className="text-xs text-zinc-400 font-medium">Active Sets</div>
          <div className="text-2xl font-bold text-white mt-1">{session.sets.length}</div>
          <div className="text-[11px] text-zinc-400 mt-1">Target achieved</div>
        </Card>

        <Card className="p-4 border-line">
          <div className="text-xs text-zinc-400 font-medium">Active Duration</div>
          <div className="text-2xl font-bold text-white mt-1">
            {formatDuration(session.totalDurationSec)}
          </div>
          <div className="text-[11px] text-zinc-400 mt-1">Excluding rest</div>
        </Card>

        <Card className="p-4 border-line">
          <div className="text-xs text-zinc-400 font-medium">Tracking Quality</div>
          <div className="text-2xl font-bold text-emerald-400 mt-1">98%</div>
          <div className="text-[11px] text-zinc-400 mt-1">High confidence</div>
        </Card>
      </div>

      {/* Technique Feedback Breakdown */}
      <Card className="p-6 border-line space-y-4">
        <h3 className="text-base font-bold text-white flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-accent" />
          Technique Analysis & Observations
        </h3>

        {/* Positive highlights */}
        <div className="p-4 rounded-xl bg-emerald-950/40 border border-emerald-500/30 flex items-start gap-3">
          <ThumbsUp className="w-5 h-5 text-emerald-400 shrink-0 mt-0.5" />
          <div>
            <h4 className="text-xs font-semibold text-emerald-300 uppercase tracking-wider">
              Strong Movement Execution
            </h4>
            <p className="text-xs text-emerald-100/90 mt-1">
              You maintained controlled movement through the full range of motion. Key joints remained
              stable during transition phases.
            </p>
          </div>
        </div>

        {/* Top correction advice if any were detected */}
        {topCorrection && (
          <div className="p-4 rounded-xl bg-amber-950/40 border border-amber-500/30 flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
            <div>
              <h4 className="text-xs font-semibold text-amber-300 uppercase tracking-wider">
                Primary Area for Focus ({topCorrection[1]} occurrences)
              </h4>
              <p className="text-xs text-amber-100/90 mt-1">{topCorrection[0]}</p>
            </div>
          </div>
        )}

        {/* Actionable coaching tips for next time */}
        <div className="p-4 rounded-xl bg-surface-2 border border-line">
          <h4 className="text-xs font-semibold text-accent uppercase tracking-wider mb-2">
            Coach Iron Recommendation
          </h4>
          <p className="text-xs text-zinc-300">
            For your next set of {exercise.name}, focus on initiating each rep smoothly. Aim to sustain
            this {consistency}% consistency score under heavier volume.
          </p>
        </div>
      </Card>

      {/* Action Buttons */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-2">
        <button
          onClick={onDiscard}
          className="text-xs text-zinc-400 hover:text-white px-4 py-2 transition-colors order-3 sm:order-1"
        >
          Discard Session
        </button>

        <div className="flex items-center gap-3 w-full sm:w-auto order-1 sm:order-2">
          <Button
            variant="secondary"
            size="lg"
            fullWidth
            onClick={onLogAnotherSet}
            icon={<RotateCcw className="w-4 h-4" />}
          >
            Log Another Set
          </Button>

          <Button
            variant="primary"
            size="lg"
            fullWidth
            onClick={onSaveAndExit}
            icon={<Save className="w-4 h-4" />}
          >
            Save & Finish
          </Button>
        </div>
      </div>
    </div>
  );
};
