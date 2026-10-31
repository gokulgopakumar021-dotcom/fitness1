import React, { useState, useMemo } from 'react';
import {
  Camera,
  Search,
  Sparkles,
  Info,
  ChevronRight,
  Flame,
  CheckCircle2,
  AlertTriangle,
  RotateCcw,
  Target,
} from 'lucide-react';
import { EXERCISE_CATALOG, ALL_EXERCISE_IDS } from '../../services/workoutMirror/exerciseCatalog';
import { ExerciseCategory, ExerciseDefinition, WorkoutMirrorExerciseId } from '../../types/workoutMirror';
import { Card } from '../ui/Card';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { BrandEmblem } from '../ui/BrandLogo';
import { Modal } from '../ui/Modal';
import { cn } from '../ui/cn';

interface ExerciseSelectorProps {
  onSelectExercise: (exercise: ExerciseDefinition) => void;
}

const CATEGORIES: { id: 'all' | ExerciseCategory; label: string }[] = [
  { id: 'all', label: 'All Exercises' },
  { id: 'bodyweight', label: 'Bodyweight' },
  { id: 'strength', label: 'Strength' },
  { id: 'core', label: 'Core' },
  { id: 'cardio', label: 'Cardio' },
];

export const ExerciseSelector: React.FC<ExerciseSelectorProps> = ({ onSelectExercise }) => {
  const [selectedCategory, setSelectedCategory] = useState<'all' | ExerciseCategory>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [detailExercise, setDetailExercise] = useState<ExerciseDefinition | null>(null);

  const exercises = useMemo(() => {
    return ALL_EXERCISE_IDS.map((id) => EXERCISE_CATALOG[id]).filter((ex) => {
      if (selectedCategory !== 'all' && ex.category !== selectedCategory) {
        return false;
      }
      if (searchQuery.trim()) {
        const query = searchQuery.toLowerCase();
        const matchesName = ex.name.toLowerCase().includes(query);
        const matchesMuscles = ex.primaryMuscles.some((m) => m.toLowerCase().includes(query));
        return matchesName || matchesMuscles;
      }
      return true;
    });
  }, [selectedCategory, searchQuery]);

  return (
    <div className="space-y-6">
      {/* Header Banner */}
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-surface via-surface to-surface-2 p-6 sm:p-8 border border-line">
        <div className="relative z-10 max-w-2xl">
          <BrandEmblem className="h-9 mb-3" />
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-accent/10 border border-accent/25 text-accent text-xs font-semibold mb-3">
            <Sparkles className="w-3.5 h-3.5 text-volt-adaptive" />
            <span>On-Device Computer Vision</span>
          </div>
          <h2 className="text-2xl sm:text-3xl font-bold tracking-tight text-zinc-100">
            AI Workout Mirror
          </h2>
          <p className="mt-2 text-sm sm:text-base text-zinc-300">
            Real-time skeletal movement tracking, repetition counting, and immediate technique coaching.
            100% on-device inference: no video or photos leave your device.
          </p>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="flex flex-col sm:flex-row gap-3 items-stretch sm:items-center justify-between">
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 sm:pb-0 scrollbar-none">
          {CATEGORIES.map((cat) => (
            <button
              key={cat.id}
              onClick={() => setSelectedCategory(cat.id)}
              className={cn(
                'px-3.5 py-1.5 rounded-full text-xs font-semibold transition-all whitespace-nowrap',
                selectedCategory === cat.id
                  ? 'bg-accent text-accent-ink shadow-sm'
                  : 'bg-surface-2 text-zinc-300 hover:text-white border border-line hover:border-zinc-700'
              )}
            >
              {cat.label}
            </button>
          ))}
        </div>

        <div className="relative sm:w-64">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-400" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search exercises..."
            className="w-full pl-9 pr-3 py-2 bg-surface-2 border border-line rounded-xl text-xs text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-accent"
          />
        </div>
      </div>

      {/* Exercises Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {exercises.map((exercise) => (
          <Card
            key={exercise.id}
            interactive
            className="flex flex-col justify-between p-5 border-line hover:border-accent/40 transition-all group"
          >
            <div>
              <div className="flex items-start justify-between gap-3 mb-2">
                <div>
                  <h3 className="font-semibold text-lg text-zinc-100 group-hover:text-volt-adaptive transition-colors">
                    {exercise.name}
                  </h3>
                  <div className="flex items-center gap-2 mt-1">
                    <Badge tone={exercise.difficulty === 'beginner' ? 'success' : 'warning'}>
                      {exercise.difficulty}
                    </Badge>
                    <span className="text-xs text-zinc-400">
                      {exercise.isStaticHold
                        ? `Target: ${exercise.defaultTargetDurationSec}s hold`
                        : `Target: ${exercise.defaultTargetReps} reps`}
                    </span>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => setDetailExercise(exercise)}
                  className="p-2 rounded-lg bg-surface-2 hover:bg-surface-3 text-zinc-400 hover:text-zinc-200 transition-colors"
                  title="View technique guide"
                  aria-label={`View technique guide for ${exercise.name}`}
                >
                  <Info className="w-4 h-4" />
                </button>
              </div>

              {/* Muscles */}
              <div className="flex flex-wrap gap-1.5 my-3">
                {exercise.primaryMuscles.map((muscle) => (
                  <span
                    key={muscle}
                    className="px-2 py-0.5 rounded-md bg-surface-2 text-[11px] font-medium text-zinc-300"
                  >
                    {muscle}
                  </span>
                ))}
              </div>

              {/* Camera Angle Guidance badge */}
              <div className="p-2.5 rounded-lg bg-surface-2/60 border border-line text-xs text-zinc-300 flex items-start gap-2 mb-4">
                <Camera className="w-3.5 h-3.5 text-accent shrink-0 mt-0.5" />
                <span>
                  <strong className="text-zinc-200">Camera Angle:</strong>{' '}
                  {exercise.recommendedCameraAngle === 'side'
                    ? 'Side Profile'
                    : exercise.recommendedCameraAngle === 'diagonal_45'
                    ? '45° Diagonal Angle'
                    : 'Direct Front View'}
                </span>
              </div>
            </div>

            <div className="flex items-center gap-2 pt-2 border-t border-line/60">
              <Button
                variant="primary"
                fullWidth
                size="md"
                onClick={() => onSelectExercise(exercise)}
                icon={<Camera className="w-4 h-4" />}
              >
                Launch Mirror
              </Button>
            </div>
          </Card>
        ))}

        {exercises.length === 0 && (
          <div className="col-span-full text-center py-12 bg-surface rounded-2xl border border-line">
            <Target className="w-10 h-10 text-zinc-500 mx-auto mb-3" />
            <h4 className="text-zinc-300 font-semibold">No exercises found</h4>
            <p className="text-xs text-zinc-500 mt-1">Try selecting another filter or clearing search.</p>
          </div>
        )}
      </div>

      {/* Technique & Analysis Detail Modal */}
      {detailExercise && (
        <Modal
          open={true}
          onClose={() => setDetailExercise(null)}
          title={detailExercise.name}
          description="Technique checkpoints and supported AI form analysis"
        >
          <div className="space-y-4 max-h-[70vh] overflow-y-auto pr-1">
            {/* Instructions */}
            <div>
              <h4 className="text-xs font-semibold uppercase tracking-wider text-accent mb-2">
                Execution Steps
              </h4>
              <ul className="space-y-1.5 text-xs text-zinc-300">
                {detailExercise.instructions.map((step, idx) => (
                  <li key={idx} className="flex items-start gap-2">
                    <span className="w-4 h-4 rounded-full bg-surface-2 text-zinc-400 flex items-center justify-center text-[10px] shrink-0 mt-0.5">
                      {idx + 1}
                    </span>
                    <span>{step}</span>
                  </li>
                ))}
              </ul>
            </div>

            {/* Technique Points */}
            <div>
              <h4 className="text-xs font-semibold uppercase tracking-wider text-emerald-400 mb-2">
                Key Form Checkpoints
              </h4>
              <ul className="space-y-1.5 text-xs text-zinc-300">
                {detailExercise.techniquePoints.map((pt, idx) => (
                  <li key={idx} className="flex items-start gap-2">
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0 mt-0.5" />
                    <span>{pt}</span>
                  </li>
                ))}
              </ul>
            </div>

            {/* Supported Checks */}
            <div>
              <h4 className="text-xs font-semibold uppercase tracking-wider text-sky-400 mb-2">
                AI Vision Checks Performed
              </h4>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                {detailExercise.supportedChecks.map((check, idx) => (
                  <div
                    key={idx}
                    className="p-2 rounded-lg bg-surface-2 text-xs text-zinc-300 flex items-center gap-2"
                  >
                    <span className="w-1.5 h-1.5 rounded-full bg-sky-400" />
                    <span>{check}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Camera Setup Advice */}
            <div className="p-3 rounded-xl bg-accent/10 border border-accent/20">
              <h4 className="text-xs font-semibold text-accent flex items-center gap-1.5 mb-1">
                <Camera className="w-3.5 h-3.5" />
                Camera Positioning Recommendation
              </h4>
              <p className="text-xs text-zinc-300">{detailExercise.cameraAngleExplanation}</p>
            </div>

            {/* Limitations Notice */}
            <div className="p-3 rounded-xl bg-surface-2 border border-line text-xs text-zinc-400 flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 text-warning shrink-0 mt-0.5" />
              <div>
                <strong className="text-zinc-300">Technical Note:</strong>
                <p className="mt-0.5">
                  Single-camera pose tracking provides posture feedback and movement counting. It does not
                  measure internal muscle tension or diagnose orthopedic conditions.
                </p>
              </div>
            </div>

            <Button
              variant="primary"
              fullWidth
              size="lg"
              onClick={() => {
                const ex = detailExercise;
                setDetailExercise(null);
                onSelectExercise(ex);
              }}
            >
              Start Workout Mirror
            </Button>
          </div>
        </Modal>
      )}
    </div>
  );
};
