import React, { useState, useEffect, useMemo } from 'react';
import {
  Sparkles,
  Dumbbell,
  Activity,
  Layers,
  Clock,
  ArrowRight,
  CheckCircle2,
  AlertTriangle,
  RotateCcw,
  Zap,
  ShieldCheck,
  ChevronRight,
  Flame,
  Plus,
  Trash2,
  RefreshCw,
  X,
  Sliders,
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

  const getRecoveryBadgeColor = (status: string) => {
    switch (status) {
      case 'fresh':
        return 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30';
      case 'recovered':
        return 'bg-lime-500/15 text-lime-400 border-lime-500/30';
      case 'recovering':
        return 'bg-amber-500/15 text-amber-400 border-amber-500/30';
      case 'fatigued':
        return 'bg-rose-500/15 text-rose-400 border-rose-500/30';
      default:
        return 'bg-zinc-800 text-zinc-300 border-zinc-700';
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5 bg-black/80 backdrop-blur-md overflow-y-auto animate-fade-in"
      role="dialog"
      aria-modal="true"
      aria-labelledby="ai-routine-builder-title"
    >
      <div className="relative w-full max-w-4xl bg-[var(--bg-surface)] border border-line rounded-2xl shadow-2xl overflow-hidden my-auto max-h-[92vh] flex flex-col text-[var(--text-primary)]">
        {/* Header */}
        <div className="px-5 py-4 border-b border-line bg-surface-2 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-accent/15 border border-accent/40 flex items-center justify-center text-accent shadow-sm">
              <Sparkles className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 id="ai-routine-builder-title" className="text-base sm:text-lg font-black tracking-tight text-zinc-100 font-mono">
                  AI ROUTINE BUILDER
                </h2>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-accent/20 text-accent border border-accent/30 font-bold uppercase tracking-wider">
                  HEATMAP ADAPTIVE
                </span>
              </div>
              <p className="text-xs text-zinc-400 mt-0.5">
                Generates evidence-based exercise routines based on logged muscle fatigue and equipment availability.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close dialog"
            className="p-2 text-zinc-400 hover:text-zinc-100 rounded-xl hover:bg-surface-3 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Scrollable Body */}
        <div className="flex-1 overflow-y-auto p-5 sm:p-6 space-y-6">
          {/* SECTION 1: MUSCLE FATIGUE HEATMAP SNAPSHOT */}
          <section className="bg-surface-2/60 border border-line rounded-2xl p-4 sm:p-5 space-y-3">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-2 border-b border-line/60">
              <div className="flex items-center gap-2">
                <Activity className="w-4 h-4 text-accent" />
                <h3 className="text-xs font-mono font-bold tracking-wider uppercase text-zinc-200">
                  Logged Muscle Fatigue Heatmap
                </h3>
              </div>
              <span className="text-[11px] font-mono text-zinc-400">
                Ground-Truth 7-Day Completed Sessions
              </span>
            </div>

            {/* Muscle status chips */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 pt-1">
              {heatmapReports.map((report) => (
                <div
                  key={report.regionId}
                  className="p-2.5 rounded-xl border border-line bg-surface/70 flex flex-col justify-between"
                >
                  <div className="flex items-center justify-between gap-1 mb-1.5">
                    <span className="text-xs font-medium text-zinc-200 truncate">{report.label}</span>
                    <span
                      className={`text-[9px] font-mono font-bold px-1.5 py-0.5 rounded border uppercase ${getRecoveryBadgeColor(
                        report.recoveryStatus
                      )}`}
                    >
                      {report.recoveryStatus}
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-[11px] font-mono text-zinc-400">
                    <span>{report.setsPast7Days} sets (7d)</span>
                    <span>{report.daysSinceLastTrained !== null ? `${report.daysSinceLastTrained}d ago` : 'Fresh'}</span>
                  </div>
                </div>
              ))}
            </div>

            {/* Recommended Split Callout */}
            <div className="mt-2 p-3 rounded-xl bg-accent/10 border border-accent/30 flex items-start gap-2.5">
              <Zap className="w-4 h-4 text-accent shrink-0 mt-0.5" />
              <div className="text-xs text-zinc-200 leading-relaxed">
                <span className="font-bold font-mono text-accent uppercase">AI Recommendation: </span>
                {recommendedSplitInfo.rationale}
              </div>
            </div>
          </section>

          {/* SECTION 2: EQUIPMENT AVAILABILITY CONFIGURATION */}
          <section className="bg-surface-2/60 border border-line rounded-2xl p-4 sm:p-5 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-2 border-b border-line/60">
              <div className="flex items-center gap-2">
                <Dumbbell className="w-4 h-4 text-accent" />
                <h3 className="text-xs font-mono font-bold tracking-wider uppercase text-zinc-200">
                  Equipment Availability
                </h3>
              </div>
              {recentDetectedEquipment.length > 0 && (
                <span className="text-[11px] font-mono text-zinc-400">
                  Detected in recent logs: {recentDetectedEquipment.join(', ')}
                </span>
              )}
            </div>

            {/* Presets */}
            <div>
              <label className="block text-[11px] font-mono text-zinc-400 uppercase tracking-wider mb-2">
                Quick Equipment Setup Presets
              </label>
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-2">
                {EQUIPMENT_PRESETS.map((preset) => (
                  <button
                    key={preset.id}
                    type="button"
                    onClick={() => handleApplyPreset(preset.id)}
                    className={`p-2.5 rounded-xl border text-left transition-all flex flex-col justify-between ${
                      activePreset === preset.id
                        ? 'bg-accent/15 border-accent text-zinc-100 ring-1 ring-accent'
                        : 'bg-surface/50 border-line text-zinc-300 hover:border-zinc-500'
                    }`}
                  >
                    <span className="text-xs font-bold leading-tight">{preset.label}</span>
                    <span className="text-[10px] text-zinc-400 mt-1 line-clamp-1">{preset.description}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Granular Toggles */}
            <div>
              <label className="block text-[11px] font-mono text-zinc-400 uppercase tracking-wider mb-2">
                Gear Included in Routine
              </label>
              <div className="flex flex-wrap gap-2">
                {ALL_EQUIPMENT.map((item) => {
                  const isChecked = selectedEquipment.includes(item.type);
                  return (
                    <button
                      key={item.type}
                      type="button"
                      onClick={() => handleToggleEquipment(item.type)}
                      className={`px-3 py-1.5 rounded-xl text-xs font-mono border transition-all flex items-center gap-1.5 ${
                        isChecked
                          ? 'bg-accent/20 border-accent text-accent font-bold'
                          : 'bg-surface/60 border-line text-zinc-400 hover:text-zinc-200'
                      }`}
                    >
                      {isChecked ? <Check className="w-3.5 h-3.5" /> : <div className="w-3.5 h-3.5" />}
                      <span>{item.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Specific constraints */}
            <div>
              <label htmlFor="equipment-notes-input" className="block text-[11px] font-mono text-zinc-400 uppercase tracking-wider mb-1.5">
                Specific Limitations or Occupied Gear (Optional)
              </label>
              <input
                id="equipment-notes-input"
                type="text"
                value={equipmentNotes}
                onChange={(e) => setEquipmentNotes(e.target.value)}
                placeholder="e.g. Squat rack is occupied today, dumbbells only up to 25kg, shoulder impingement on flat bench"
                className="w-full px-3.5 py-2.5 rounded-xl bg-surface border border-line text-xs text-zinc-200 placeholder:text-zinc-500 focus:outline-none focus:border-accent font-sans"
              />
            </div>
          </section>

          {/* SECTION 3: WORKOUT TARGETS & GENERATION CONTROLS */}
          <section className="bg-surface-2/60 border border-line rounded-2xl p-4 sm:p-5 space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {/* Split selection */}
              <div>
                <label htmlFor="routine-focus-select" className="block text-[11px] font-mono text-zinc-400 uppercase tracking-wider mb-1.5">
                  Routine Focus
                </label>
                <select
                  id="routine-focus-select"
                  value={splitFocus}
                  onChange={(e) => setSplitFocus(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl bg-surface border border-line text-xs text-zinc-200 focus:outline-none focus:border-accent font-sans"
                >
                  {SPLIT_OPTIONS.map((opt) => (
                    <option key={opt.id} value={opt.id}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>

              {/* Target Duration */}
              <div>
                <label htmlFor="duration-target-select" className="block text-[11px] font-mono text-zinc-400 uppercase tracking-wider mb-1.5">
                  Session Duration
                </label>
                <select
                  id="duration-target-select"
                  value={durationMinutes}
                  onChange={(e) => setDurationMinutes(Number(e.target.value))}
                  className="w-full px-3 py-2 rounded-xl bg-surface border border-line text-xs text-zinc-200 focus:outline-none focus:border-accent font-sans"
                >
                  <option value={35}>Quick Protocol (~35 min • 4 exercises)</option>
                  <option value={55}>Standard Hypertrophy (~55 min • 5-6 exercises)</option>
                  <option value={75}>High-Volume Overload (~75 min • 7-8 exercises)</option>
                </select>
              </div>

              {/* Experience */}
              <div>
                <label htmlFor="experience-level-select" className="block text-[11px] font-mono text-zinc-400 uppercase tracking-wider mb-1.5">
                  Training Experience
                </label>
                <select
                  id="experience-level-select"
                  value={experienceLevel}
                  onChange={(e) => setExperienceLevel(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl bg-surface border border-line text-xs text-zinc-200 focus:outline-none focus:border-accent font-sans"
                >
                  <option value="beginner">Beginner (1-2 RIR buffer)</option>
                  <option value="intermediate">Intermediate (Standard double progression)</option>
                  <option value="advanced">Advanced (High threshold tension)</option>
                </select>
              </div>
            </div>

            {/* Generate Button */}
            <div className="pt-2 flex flex-col sm:flex-row items-center justify-between gap-3 border-t border-line/60">
              <div className="text-xs text-zinc-400 flex items-center gap-2">
                <ShieldCheck className="w-4 h-4 text-emerald-400" />
                <span>Respects fatigue thresholds &amp; strictly avoids unlisted gear.</span>
              </div>

              <button
                type="button"
                onClick={handleGenerateRoutine}
                disabled={isGenerating}
                className="w-full sm:w-auto px-6 py-3 rounded-xl bg-accent text-zinc-950 font-mono font-bold text-xs hover:brightness-110 active:scale-95 transition-all shadow-lg flex items-center justify-center gap-2 disabled:opacity-50"
              >
                {isGenerating ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin text-zinc-950" />
                    <span>{generationStep || 'Building Routine with AI...'}</span>
                  </>
                ) : (
                  <>
                    <Sparkles className="w-4 h-4 text-zinc-950" />
                    <span>Generate AI Adaptive Routine</span>
                    <ArrowRight className="w-4 h-4" />
                  </>
                )}
              </button>
            </div>
          </section>

          {/* SECTION 4: GENERATED ROUTINE REVIEW & ACTIONS */}
          {generatedRoutine && (
            <section className="bg-surface-2 border border-accent/40 rounded-2xl p-5 sm:p-6 space-y-5 animate-fade-in shadow-xl">
              {/* Routine Header */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-line">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-accent/20 text-accent font-bold uppercase">
                      {generatedRoutine.isOfflineFallback ? 'Adaptive Engine' : 'Gemini 3.8 Flash'}
                    </span>
                    <span className="text-xs font-mono text-zinc-400">
                      ~{generatedRoutine.durationMinutes} min • {generatedRoutine.exercises.length} exercises
                    </span>
                  </div>
                  <h3 className="text-lg sm:text-xl font-bold font-mono text-zinc-100 mt-1">
                    {generatedRoutine.routineName}
                  </h3>
                </div>

                {/* Targeted vs Rested Tags */}
                <div className="flex flex-wrap items-center gap-1.5">
                  <div className="text-[11px] font-mono text-zinc-400 flex items-center gap-1">
                    <span className="w-2 h-2 rounded-full bg-emerald-400 inline-block" />
                    <span>Target: {generatedRoutine.targetedMuscles.slice(0, 3).join(', ')}</span>
                  </div>
                  {generatedRoutine.restedMuscles.length > 0 && (
                    <div className="text-[11px] font-mono text-zinc-400 flex items-center gap-1 ml-2">
                      <span className="w-2 h-2 rounded-full bg-rose-400 inline-block" />
                      <span>Rested: {generatedRoutine.restedMuscles.slice(0, 2).join(', ')}</span>
                    </div>
                  )}
                </div>
              </div>

              {/* Rationale callout */}
              <div className="p-3.5 rounded-xl bg-surface border border-line text-xs text-zinc-300 leading-relaxed flex items-start gap-2.5">
                <Info className="w-4 h-4 text-accent shrink-0 mt-0.5" />
                <div>
                  <span className="font-bold text-zinc-100 font-mono uppercase block mb-0.5">
                    Biomechanical Periodization Rationale
                  </span>
                  {generatedRoutine.summaryRationale}
                </div>
              </div>

              {/* Exercise Cards */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h4 className="text-xs font-mono font-bold tracking-wider uppercase text-zinc-300">
                    Prescribed Exercise Protocol
                  </h4>
                  <span className="text-[11px] font-mono text-zinc-400">
                    Click Substitute to replace if station is busy
                  </span>
                </div>

                {generatedRoutine.exercises.map((exercise, index) => (
                  <div
                    key={exercise.id}
                    className="p-4 rounded-xl bg-surface border border-line hover:border-zinc-500 transition-colors space-y-3"
                  >
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                      <div className="flex items-center gap-2.5">
                        <span className="w-6 h-6 rounded-lg bg-surface-2 border border-line flex items-center justify-center font-mono text-xs font-bold text-accent">
                          {index + 1}
                        </span>
                        <div>
                          <h5 className="text-sm font-bold text-zinc-100">{exercise.name}</h5>
                          <div className="flex items-center gap-2 text-[11px] font-mono text-zinc-400 mt-0.5">
                            <span className="text-accent">{exercise.muscleGroup}</span>
                            <span>•</span>
                            <span className="capitalize">{exercise.equipment}</span>
                            {exercise.tempo && (
                              <>
                                <span>•</span>
                                <span>Tempo: {exercise.tempo}</span>
                              </>
                            )}
                          </div>
                        </div>
                      </div>

                      {/* Sets & Reps Prescription Controls */}
                      <div className="flex items-center gap-3">
                        <div className="flex items-center gap-1.5 bg-surface-2 px-2.5 py-1 rounded-lg border border-line text-xs font-mono">
                          <button
                            type="button"
                            onClick={() => handleAdjustSets(index, -1)}
                            className="text-zinc-400 hover:text-zinc-100 px-1 font-bold"
                            title="Decrease sets"
                          >
                            -
                          </button>
                          <span className="text-zinc-100 font-bold">{exercise.workingSets} sets</span>
                          <button
                            type="button"
                            onClick={() => handleAdjustSets(index, 1)}
                            className="text-zinc-400 hover:text-zinc-100 px-1 font-bold"
                            title="Increase sets"
                          >
                            +
                          </button>
                        </div>

                        <div className="px-2.5 py-1 rounded-lg bg-surface-2 border border-line text-xs font-mono text-zinc-300">
                          {exercise.repRange} reps
                        </div>

                        <div className="px-2.5 py-1 rounded-lg bg-surface-2 border border-line text-xs font-mono text-zinc-300">
                          {exercise.targetRir} RIR
                        </div>

                        <div className="px-2.5 py-1 rounded-lg bg-surface-2 border border-line text-xs font-mono text-zinc-300 flex items-center gap-1">
                          <Clock className="w-3 h-3 text-zinc-400" />
                          <span>{exercise.restSeconds}s</span>
                        </div>

                        <button
                          type="button"
                          onClick={() => handleRemoveExercise(index)}
                          className="p-1.5 text-zinc-400 hover:text-rose-400 rounded-lg hover:bg-surface-2"
                          title="Remove exercise"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>

                    {/* Fatigue Rationale Callout */}
                    <div className="text-[11px] font-sans text-zinc-300 bg-surface-2/60 border border-line/60 rounded-lg p-2.5 flex items-start gap-2">
                      <Flame className="w-3.5 h-3.5 text-volt-adaptive shrink-0 mt-0.5" />
                      <span>{exercise.fatigueRationale}</span>
                    </div>

                    {/* Substitute Selector */}
                    {exercise.substitutes && exercise.substitutes.length > 0 && (
                      <div className="pt-1 flex items-center justify-between border-t border-line/40 text-[11px]">
                        <span className="text-zinc-400 font-mono">Busy station? Available alternatives:</span>
                        <div className="flex items-center gap-1.5">
                          {exercise.substitutes.map((sub, sIdx) => (
                            <button
                              key={sIdx}
                              type="button"
                              onClick={() => handleSubstituteExercise(index, sub)}
                              className="px-2 py-0.5 rounded bg-surface-2 hover:bg-surface-3 text-zinc-300 hover:text-accent border border-line transition-colors text-[10px] font-mono flex items-center gap-1"
                              title={sub.reason}
                            >
                              <RotateCcw className="w-2.5 h-2.5" />
                              <span>{sub.name}</span>
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>

              {/* Execution Actions */}
              <div className="pt-4 border-t border-line flex flex-col sm:flex-row items-center justify-between gap-3">
                <button
                  type="button"
                  onClick={handleGenerateRoutine}
                  className="w-full sm:w-auto px-4 py-2.5 rounded-xl border border-line bg-surface text-zinc-300 hover:text-accent hover:border-zinc-400 text-xs font-mono font-bold flex items-center justify-center gap-2"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  <span>Re-architect</span>
                </button>

                <div className="flex items-center gap-2.5 w-full sm:w-auto">
                  <button
                    type="button"
                    onClick={handleSaveToPlans}
                    className={`w-full sm:w-auto px-5 py-2.5 rounded-xl border text-xs font-mono font-bold transition-all flex items-center justify-center gap-1.5 ${
                      isSaved
                        ? 'bg-emerald-500/20 border-emerald-500/40 text-emerald-400'
                        : 'bg-surface-2 border-line text-zinc-200 hover:border-zinc-400'
                    }`}
                  >
                    {isSaved ? <CheckCircle2 className="w-4 h-4" /> : <Plus className="w-4 h-4" />}
                    <span>{isSaved ? 'Saved to My Plans' : 'Save to My Plans'}</span>
                  </button>

                  <button
                    type="button"
                    onClick={handleStartActiveSession}
                    className="w-full sm:w-auto px-6 py-2.5 rounded-xl bg-accent text-zinc-950 font-mono font-extrabold text-xs hover:brightness-110 active:scale-95 transition-all shadow-[0_0_20px_rgba(206,255,0,0.25)] flex items-center justify-center gap-2"
                  >
                    <Flame className="w-4 h-4 text-zinc-950" />
                    <span>Start Workout Now</span>
                    <ArrowRight className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </section>
          )}
        </div>
      </div>
    </div>
  );
};
