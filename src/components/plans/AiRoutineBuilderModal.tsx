import React, { useState, useEffect, useMemo } from 'react';
import {
  Sparkles,
  Clock,
  CheckCircle2,
  RotateCcw,
  Zap,
  ShieldCheck,
  Flame,
  Plus,
  Minus,
  Trash2,
  Check,
  Info
} from 'lucide-react';
import {
  EquipmentType,
  UserProfile,
  WorkoutPlan,
  WorkoutSession
} from '../../types';
import { db } from '../../storage/db';
import { Badge, Button, Card, Input, Modal, SectionHeading, Select } from '../ui';
import {
  AiGeneratedRoutine,
  AiRoutineExercise,
  convertAiRoutineToActiveSession,
  convertAiRoutineToWorkoutPlan,
  extractRecentEquipment,
  generateOfflineAdaptiveRoutine,
  MuscleRegionFatigueReport,
  recommendOptimalSplitFromHeatmap,
  summarizeMuscleHeatmapForAi
} from '../../utils/aiRoutineEngine';

export interface AiRoutineBuilderModalProps {
  isOpen: boolean;
  onClose: () => void;
  profile: UserProfile;
  sessions: WorkoutSession[];
  isDemoMode?: boolean;
  initialSplitFocus?: string;
  onStartWorkout: (session: WorkoutSession) => void;
  onPlanSaved?: (plan: WorkoutPlan) => void;
}

const EQUIPMENT_PRESETS: {
  id: string;
  label: string;
  description: string;
  equipment: EquipmentType[];
}[] = [
  {
    id: 'commercial',
    label: 'Commercial Gym',
    description: 'Full facility with barbells, dumbbells, cables & selectorized machines',
    equipment: ['barbell', 'dumbbell', 'cable', 'machine', 'bodyweight']
  },
  {
    id: 'home_barbell',
    label: 'Home Gym (Free Weights)',
    description: 'Squat rack, barbell, bench & dumbbells',
    equipment: ['barbell', 'dumbbell', 'bodyweight']
  },
  {
    id: 'dumbbells_only',
    label: 'Dumbbells & Bench',
    description: 'Adjustable dumbbells, bench & bodyweight',
    equipment: ['dumbbell', 'bodyweight']
  },
  {
    id: 'calisthenics',
    label: 'Bodyweight Only',
    description: 'Pull-up bar, dip station & calisthenics floor',
    equipment: ['bodyweight']
  },
  {
    id: 'hotel',
    label: 'Hotel / Minimal Gear',
    description: 'Light dumbbells and bodyweight',
    equipment: ['dumbbell', 'bodyweight']
  }
];

const ALL_EQUIPMENT: { type: EquipmentType; label: string }[] = [
  { type: 'barbell', label: 'Barbell & Plates' },
  { type: 'dumbbell', label: 'Dumbbells' },
  { type: 'cable', label: 'Cable Stations' },
  { type: 'machine', label: 'Selectorized Machines' },
  { type: 'bodyweight', label: 'Bodyweight / Pull-Up Bar' },
  { type: 'other', label: 'Specialty / Other' }
];

const SPLIT_OPTIONS = [
  { id: 'auto', label: '⚡ Auto (Optimal for Fresh Muscles)' },
  { id: 'Push (Chest, Shoulders & Triceps)', label: 'Push (Chest, Delts & Triceps)' },
  { id: 'Pull (Back, Lats & Biceps)', label: 'Pull (Back, Lats & Biceps)' },
  { id: 'Legs & Lower Body (Quads & Posterior Chain)', label: 'Legs (Quads & Posterior Chain)' },
  { id: 'Upper Body (Push & Pull)', label: 'Upper Body Compound' },
  { id: 'Lower Body (Quads & Posterior Chain)', label: 'Lower Body Compound' },
  { id: 'Full Body (Adaptive Recovery Focus)', label: 'Full Body (Adaptive)' }
];

export const AiRoutineBuilderModal: React.FC<AiRoutineBuilderModalProps> = ({
  isOpen,
  onClose,
  profile,
  sessions,
  isDemoMode = false,
  initialSplitFocus,
  onStartWorkout,
  onPlanSaved
}) => {
  // Muscle heatmap report
  const heatmapReports = useMemo<MuscleRegionFatigueReport[]>(() => {
    return summarizeMuscleHeatmapForAi(sessions, new Date(), isDemoMode);
  }, [sessions, isDemoMode]);

  const recommendedSplitInfo = useMemo(() => {
    return recommendOptimalSplitFromHeatmap(heatmapReports);
  }, [heatmapReports]);

  // Detected recent equipment from completed workout sessions
  const recentDetectedEquipment = useMemo<EquipmentType[]>(() => {
    return extractRecentEquipment(sessions);
  }, [sessions]);

  // Form states
  const [selectedEquipment, setSelectedEquipment] = useState<EquipmentType[]>(() => {
    return recentDetectedEquipment.length > 0
      ? recentDetectedEquipment
      : ['barbell', 'dumbbell', 'cable', 'machine', 'bodyweight'];
  });

  const [activePreset, setActivePreset] = useState<string>('commercial');
  const [splitFocus, setSplitFocus] = useState<string>(initialSplitFocus || 'auto');
  const [durationMinutes, setDurationMinutes] = useState<number>(55);
  const [equipmentNotes, setEquipmentNotes] = useState<string>('');
  const [experienceLevel, setExperienceLevel] = useState<string>(profile.trainingExperience || 'intermediate');

  // Generation state
  const [isGenerating, setIsGenerating] = useState<boolean>(false);
  const [generationStep, setGenerationStep] = useState<string>('');
  const [generationError, setGenerationError] = useState<string | null>(null);

  // Result state
  const [generatedRoutine, setGeneratedRoutine] = useState<AiGeneratedRoutine | null>(null);
  const [activeSubstituteIndex, setActiveSubstituteIndex] = useState<number | null>(null);
  const [isSaved, setIsSaved] = useState<boolean>(false);

  // Synchronize initial split focus if prop changes
  useEffect(() => {
    if (initialSplitFocus) {
      setSplitFocus(initialSplitFocus);
    }
  }, [initialSplitFocus]);

  if (!isOpen) return null;

  const handleApplyPreset = (presetId: string) => {
    const preset = EQUIPMENT_PRESETS.find((p) => p.id === presetId);
    if (preset) {
      setActivePreset(preset.id);
      setSelectedEquipment([...preset.equipment]);
    }
  };

  const handleToggleEquipment = (eq: EquipmentType) => {
    setActivePreset('custom');
    setSelectedEquipment((prev) => {
      if (prev.includes(eq)) {
        if (prev.length <= 1) return prev; // Keep at least one
        return prev.filter((item) => item !== eq);
      } else {
        return [...prev, eq];
      }
    });
  };

  const handleGenerateRoutine = async () => {
    setIsGenerating(true);
    setGenerationError(null);
    setIsSaved(false);

    try {
      setGenerationStep('Analyzing logged muscle fatigue heatmap & recovery status...');
      await new Promise((r) => setTimeout(r, 400));

      setGenerationStep('Cross-referencing available equipment and biomechanics...');
      await new Promise((r) => setTimeout(r, 400));

      setGenerationStep('Consulting Gemini 3.8 Flash for overload prescriptions...');

      const payload = {
        muscleRecoveryData: heatmapReports,
        availableEquipment: selectedEquipment,
        recentEquipmentUsed: recentDetectedEquipment,
        equipmentNotes: equipmentNotes.trim() || undefined,
        trainingSplitFocus: splitFocus === 'auto' ? recommendedSplitInfo.recommendedSplit : splitFocus,
        sessionDurationMinutes: durationMinutes,
        targetExerciseCount: durationMinutes <= 40 ? 4 : durationMinutes <= 60 ? 5 : 7,
        experienceLevel,
        primaryGoal: profile.primaryGoal,
        injuriesOrDeload: undefined
      };

      const response = await fetch('/api/generate-ai-routine', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        throw new Error(`API responded with status ${response.status}`);
      }

      const data = await response.json();
      if (data.success && data.routine) {
        setGeneratedRoutine(data.routine);
      } else {
        throw new Error(data.error || 'Failed to generate routine');
      }
    } catch (err: any) {
      console.warn('Gemini routine generation fallback activated:', err);
      // Deterministic evidence-based fallback matching the exact same heatmap and equipment
      const fallback = generateOfflineAdaptiveRoutine(
        heatmapReports,
        selectedEquipment,
        splitFocus === 'auto' ? recommendedSplitInfo.recommendedSplit : splitFocus,
        durationMinutes
      );
      setGeneratedRoutine(fallback);
    } finally {
      setIsGenerating(false);
      setGenerationStep('');
    }
  };

  const handleSubstituteExercise = (exerciseIndex: number, sub: { name: string; equipment: EquipmentType; reason: string }) => {
    if (!generatedRoutine) return;
    const updatedExercises = [...generatedRoutine.exercises];
    const current = updatedExercises[exerciseIndex];

    updatedExercises[exerciseIndex] = {
      ...current,
      name: sub.name,
      equipment: sub.equipment,
      notes: `${current.notes ? `${current.notes} • ` : ''}Substituted: ${sub.reason}`,
      fatigueRationale: `Swapped with ${sub.name} (${sub.equipment}) to accommodate gym station availability while maintaining target muscle stimulus.`
    };

    setGeneratedRoutine({
      ...generatedRoutine,
      exercises: updatedExercises
    });
    setActiveSubstituteIndex(null);
  };

  const handleAdjustSets = (index: number, delta: number) => {
    if (!generatedRoutine) return;
    const updated = [...generatedRoutine.exercises];
    const target = updated[index];
    const newSets = Math.max(1, Math.min(8, target.workingSets + delta));
    updated[index] = { ...target, workingSets: newSets };
    setGeneratedRoutine({ ...generatedRoutine, exercises: updated });
  };

  const handleRemoveExercise = (index: number) => {
    if (!generatedRoutine || generatedRoutine.exercises.length <= 1) return;
    const updated = generatedRoutine.exercises.filter((_, i) => i !== index);
    setGeneratedRoutine({ ...generatedRoutine, exercises: updated });
  };

  const handleStartActiveSession = () => {
    if (!generatedRoutine) return;
    const activeSession = convertAiRoutineToActiveSession(generatedRoutine);
    db.saveActiveSession(activeSession);
    onStartWorkout(activeSession);
    onClose();
  };

  const handleSaveToPlans = () => {
    if (!generatedRoutine) return;
    const newPlan = convertAiRoutineToWorkoutPlan(generatedRoutine, profile);
    const existing = db.getPlans();
    db.savePlans([newPlan, ...existing]);
    setIsSaved(true);
    if (onPlanSaved) {
      onPlanSaved(newPlan);
    }
  };

  const recoveryTone = (status: string): 'success' | 'accent' | 'warning' | 'danger' | 'neutral' => {
    switch (status) {
      case 'fresh':
        return 'success';
      case 'recovered':
        return 'accent';
      case 'recovering':
        return 'warning';
      case 'fatigued':
        return 'danger';
      default:
        return 'neutral';
    }
  };

  const chipBase =
    'min-h-11 rounded-control border text-left transition-colors touch-press focus:outline-none focus-visible:border-accent';
  const chipOn = 'bg-accent/10 border-accent text-white';
  const chipOff = 'bg-surface border-line text-zinc-300 hover:border-line-strong';

  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title="AI routine builder"
      description="Generates evidence-based exercise routines based on logged muscle fatigue and equipment availability."
    >
      <div className="space-y-4 sm:space-y-5">
        {/* SECTION 1: MUSCLE FATIGUE HEATMAP SNAPSHOT */}
        <Card as="section" aria-label="Muscle fatigue heatmap" pad="sm" className="space-y-3 sm:p-4">
          <SectionHeading
            level={3}
            title="Logged muscle fatigue heatmap"
            description="Ground-truth 7-day completed sessions"
            className="mb-0"
          />

          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {heatmapReports.map((report) => (
              <div key={report.regionId} className="p-2.5 rounded-control border border-line bg-surface-2 space-y-1.5 min-w-0">
                <div className="flex items-center justify-between gap-1">
                  <span className="text-xs font-medium text-white truncate">{report.label}</span>
                  <Badge tone={recoveryTone(report.recoveryStatus)} className="capitalize shrink-0">
                    {report.recoveryStatus}
                  </Badge>
                </div>
                <div className="flex items-center justify-between gap-1 text-label text-zinc-400 tabular">
                  <span>{report.setsPast7Days} sets (7d)</span>
                  <span>{report.daysSinceLastTrained !== null ? `${report.daysSinceLastTrained}d ago` : 'Fresh'}</span>
                </div>
              </div>
            ))}
          </div>

          <div className="p-3 rounded-control bg-accent/10 border border-accent/30 flex items-start gap-2.5">
            <Zap className="w-4 h-4 text-accent shrink-0 mt-0.5" aria-hidden />
            <p className="text-xs text-zinc-200 leading-relaxed">
              <span className="font-semibold text-accent">AI recommendation: </span>
              {recommendedSplitInfo.rationale}
            </p>
          </div>
        </Card>

        {/* SECTION 2: EQUIPMENT AVAILABILITY CONFIGURATION */}
        <Card as="section" aria-label="Equipment availability" pad="sm" className="space-y-4 sm:p-4">
          <SectionHeading
            level={3}
            title="Equipment availability"
            description={
              recentDetectedEquipment.length > 0
                ? `Detected in recent logs: ${recentDetectedEquipment.join(', ')}`
                : undefined
            }
            className="mb-0"
          />

          <div>
            <p className="text-xs font-medium text-zinc-300 mb-2">Quick equipment setup presets</p>
            <div className="grid grid-cols-1 min-[420px]:grid-cols-2 sm:grid-cols-3 gap-2">
              {EQUIPMENT_PRESETS.map((preset) => (
                <button
                  key={preset.id}
                  type="button"
                  aria-pressed={activePreset === preset.id}
                  onClick={() => handleApplyPreset(preset.id)}
                  className={`${chipBase} p-2.5 flex flex-col justify-between ${activePreset === preset.id ? chipOn : chipOff}`}
                >
                  <span className="text-xs font-semibold leading-tight">{preset.label}</span>
                  <span className="text-label text-zinc-400 mt-1 line-clamp-2">{preset.description}</span>
                </button>
              ))}
            </div>
          </div>

          <div>
            <p className="text-xs font-medium text-zinc-300 mb-2">Gear included in routine</p>
            <div className="flex flex-wrap gap-2">
              {ALL_EQUIPMENT.map((item) => {
                const isChecked = selectedEquipment.includes(item.type);
                return (
                  <button
                    key={item.type}
                    type="button"
                    aria-pressed={isChecked}
                    onClick={() => handleToggleEquipment(item.type)}
                    className={`${chipBase} px-3 text-xs font-medium inline-flex items-center gap-1.5 ${isChecked ? chipOn : chipOff}`}
                  >
                    {isChecked ? <Check className="w-3.5 h-3.5 text-accent" aria-hidden /> : <span className="w-3.5 h-3.5" aria-hidden />}
                    <span>{item.label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <Input
            id="equipment-notes-input"
            label="Specific limitations or occupied gear (optional)"
            value={equipmentNotes}
            onChange={(e) => setEquipmentNotes(e.target.value)}
            placeholder="e.g. Squat rack is occupied today, dumbbells only up to 25kg, shoulder impingement on flat bench"
          />
        </Card>

        {/* SECTION 3: WORKOUT TARGETS & GENERATION CONTROLS */}
        <Card as="section" aria-label="Workout targets" pad="sm" className="space-y-4 sm:p-4">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <Select
              id="routine-focus-select"
              label="Routine focus"
              value={splitFocus}
              onChange={(e) => setSplitFocus(e.target.value)}
            >
              {SPLIT_OPTIONS.map((opt) => (
                <option key={opt.id} value={opt.id}>
                  {opt.label}
                </option>
              ))}
            </Select>

            <Select
              id="duration-target-select"
              label="Session duration"
              value={durationMinutes}
              onChange={(e) => setDurationMinutes(Number(e.target.value))}
            >
              <option value={35}>Quick Protocol (~35 min • 4 exercises)</option>
              <option value={55}>Standard Hypertrophy (~55 min • 5-6 exercises)</option>
              <option value={75}>High-Volume Overload (~75 min • 7-8 exercises)</option>
            </Select>

            <Select
              id="experience-level-select"
              label="Training experience"
              value={experienceLevel}
              onChange={(e) => setExperienceLevel(e.target.value)}
            >
              <option value="beginner">Beginner (1-2 RIR buffer)</option>
              <option value="intermediate">Intermediate (Standard double progression)</option>
              <option value="advanced">Advanced (High threshold tension)</option>
            </Select>
          </div>

          <div className="pt-3 border-t border-line flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <p className="text-xs text-zinc-400 flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-success shrink-0" aria-hidden />
              <span>Respects fatigue thresholds &amp; strictly avoids unlisted gear.</span>
            </p>
            <Button
              onClick={handleGenerateRoutine}
              loading={isGenerating}
              icon={!isGenerating ? <Sparkles className="w-4 h-4" /> : undefined}
              className="w-full sm:w-auto"
            >
              {isGenerating ? 'Building routine…' : 'Generate adaptive routine'}
            </Button>
          </div>
          {isGenerating && generationStep && (
            <p role="status" aria-live="polite" className="text-xs text-zinc-400">
              {generationStep}
            </p>
          )}
        </Card>

        {/* SECTION 4: GENERATED ROUTINE REVIEW & ACTIONS */}
        {generatedRoutine && (
          <Card tone="accent" as="section" aria-label="Generated routine" className="space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3 pb-4 border-b border-line">
              <div className="min-w-0">
                <div className="flex items-center flex-wrap gap-2">
                  <Badge tone="accent">{generatedRoutine.isOfflineFallback ? 'Adaptive Engine' : 'Gemini 3.8 Flash'}</Badge>
                  <span className="text-xs text-zinc-400 tabular">
                    ~{generatedRoutine.durationMinutes} min • {generatedRoutine.exercises.length} exercises
                  </span>
                </div>
                <h3 className="text-lg font-semibold text-white tracking-tight mt-1.5 break-words">
                  {generatedRoutine.routineName}
                </h3>
              </div>

              <div className="space-y-1 text-xs text-zinc-400 sm:text-right">
                <p className="flex items-center gap-1.5 sm:justify-end">
                  <span className="w-2 h-2 rounded-full bg-success inline-block" aria-hidden />
                  <span>Target: {generatedRoutine.targetedMuscles.slice(0, 3).join(', ')}</span>
                </p>
                {generatedRoutine.restedMuscles.length > 0 && (
                  <p className="flex items-center gap-1.5 sm:justify-end">
                    <span className="w-2 h-2 rounded-full bg-danger inline-block" aria-hidden />
                    <span>Rested: {generatedRoutine.restedMuscles.slice(0, 2).join(', ')}</span>
                  </p>
                )}
              </div>
            </div>

            <div className="p-3 rounded-control bg-surface-2 border border-line flex items-start gap-2.5">
              <Info className="w-4 h-4 text-accent shrink-0 mt-0.5" aria-hidden />
              <div className="text-xs text-zinc-300 leading-relaxed">
                <p className="font-semibold text-white mb-0.5">Biomechanical periodization rationale</p>
                {generatedRoutine.summaryRationale}
              </div>
            </div>

            <div className="space-y-3">
              <SectionHeading
                level={3}
                title="Prescribed exercises"
                description="Use a substitute if a station is busy."
                className="mb-0"
              />

              {generatedRoutine.exercises.map((exercise, index) => (
                <div key={exercise.id} className="p-3 sm:p-4 rounded-control bg-surface border border-line space-y-3">
                  <div className="flex items-start gap-2.5">
                    <span
                      className="w-7 h-7 shrink-0 rounded-full bg-surface-2 border border-line flex items-center justify-center text-xs font-semibold text-zinc-300 tabular"
                      aria-label={`Exercise ${index + 1}`}
                    >
                      {index + 1}
                    </span>
                    <div className="min-w-0">
                      <h4 className="text-sm font-semibold text-white break-words">{exercise.name}</h4>
                      <p className="text-xs text-zinc-400 mt-0.5">
                        <span className="text-accent">{exercise.muscleGroup}</span>
                        {' · '}
                        <span className="capitalize">{exercise.equipment}</span>
                        {exercise.tempo && ` · Tempo ${exercise.tempo}`}
                      </p>
                    </div>
                  </div>

                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <Badge className="tabular">{exercise.repRange} reps</Badge>
                      <Badge className="tabular">{exercise.targetRir} RIR</Badge>
                      <Badge className="tabular" icon={<Clock className="w-3 h-3" aria-hidden />}>
                        {exercise.restSeconds}s
                      </Badge>
                    </div>

                    <div className="flex items-center gap-1.5">
                      <div className="flex items-center rounded-control border border-line-strong bg-surface-2">
                        <Button
                          variant="ghost"
                          size="md"
                          iconOnly
                          icon={<Minus className="w-4 h-4" />}
                          aria-label={`Decrease sets for ${exercise.name}`}
                          title="Decrease sets"
                          disabled={exercise.workingSets <= 1}
                          onClick={() => handleAdjustSets(index, -1)}
                        />
                        <span className="min-w-[4.5rem] text-center text-sm font-semibold text-white tabular" aria-live="polite">
                          {exercise.workingSets} sets
                        </span>
                        <Button
                          variant="ghost"
                          size="md"
                          iconOnly
                          icon={<Plus className="w-4 h-4" />}
                          aria-label={`Increase sets for ${exercise.name}`}
                          title="Increase sets"
                          disabled={exercise.workingSets >= 8}
                          onClick={() => handleAdjustSets(index, 1)}
                        />
                      </div>
                      <Button
                        variant="ghost"
                        iconOnly
                        icon={<Trash2 className="w-4 h-4" />}
                        aria-label={`Remove ${exercise.name}`}
                        title="Remove exercise"
                        disabled={generatedRoutine.exercises.length <= 1}
                        onClick={() => handleRemoveExercise(index)}
                      />
                    </div>
                  </div>

                  <div className="text-xs text-zinc-300 bg-surface-2 border border-line rounded-control p-2.5 flex items-start gap-2">
                    <Flame className="w-3.5 h-3.5 text-volt-adaptive shrink-0 mt-0.5" aria-hidden />
                    <span>{exercise.fatigueRationale}</span>
                  </div>

                  {exercise.substitutes && exercise.substitutes.length > 0 && (
                    <div className="pt-3 border-t border-line space-y-2">
                      <p className="text-xs text-zinc-400">Busy station? Available alternatives:</p>
                      <div className="flex flex-wrap gap-2">
                        {exercise.substitutes.map((sub, sIdx) => (
                          <Button
                            key={sIdx}
                            variant="secondary"
                            size="sm"
                            icon={<RotateCcw className="w-3.5 h-3.5" />}
                            title={sub.reason}
                            onClick={() => handleSubstituteExercise(index, sub)}
                          >
                            {sub.name}
                          </Button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>

            <div className="pt-4 border-t border-line flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <Button variant="secondary" icon={<RotateCcw className="w-4 h-4" />} onClick={handleGenerateRoutine} loading={isGenerating}>
                Re-architect
              </Button>

              <div className="flex flex-col sm:flex-row gap-2">
                <Button
                  variant="secondary"
                  icon={isSaved ? <CheckCircle2 className="w-4 h-4 text-success" /> : <Plus className="w-4 h-4" />}
                  onClick={handleSaveToPlans}
                >
                  {isSaved ? 'Saved to my plans' : 'Save to my plans'}
                </Button>
                <Button icon={<Flame className="w-4 h-4" />} onClick={handleStartActiveSession}>
                  Start workout now
                </Button>
              </div>
            </div>
          </Card>
        )}
      </div>
    </Modal>
  );
};
