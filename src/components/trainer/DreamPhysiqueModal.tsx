import React, { useState } from 'react';
import {
  Sparkles,
  X,
  Target,
  Flame,
  Dumbbell,
  Apple,
  CheckCircle2,
  Calendar,
  Clock,
  ArrowRight,
  TrendingUp,
  Activity,
  Layers,
  ChevronDown,
  ChevronUp,
  RotateCcw,
  ShieldCheck,
  Zap,
  Sliders,
  Scale
} from 'lucide-react';
import { UserProfile, WorkoutPlan, WorkoutDay, PlannedExercise } from '../../types';
import { db } from '../../storage/db';

interface DreamPhysique {
  archetype: string;
  title: string;
  imageUrl: string;
  description: string;
  targetBodyFat: number;
  muscleEmphasis: string[];
  gender: string;
  isAiGenerated: boolean;
}

interface GapAnalysis {
  currentStatsSummary: string;
  targetStatsSummary: string;
  bodyCompositionVerdict: string;
  estTimelineWeeks: string;
  keyFocusAreas: string[];
}

interface MealItem {
  meal: string;
  foods: string;
  calories: number;
  protein: number;
}

interface NutritionPlan {
  calorieTarget: number;
  strategy: string;
  macros: {
    proteinGrams: number;
    proteinPerKg: string;
    carbsGrams: number;
    fatsGrams: number;
    hydrationLiters: number;
  };
  nutrientTiming: string[];
  sampleMealPlan: MealItem[];
  recommendedSupplements: string[];
}

interface GeneratedWorkoutPlan {
  planName: string;
  trainingSplit: string;
  description: string;
  days: {
    dayName: string;
    exercises: {
      name: string;
      muscleGroup: string;
      equipment: string;
      workingSets: number;
      repRange: string;
      targetRir: number;
      restSeconds: number;
      notes: string;
    }[];
  }[];
}

interface TransformationBlueprint {
  gapAnalysis: GapAnalysis;
  nutritionPlan: NutritionPlan;
  workoutPlan: GeneratedWorkoutPlan;
  coachMessage: string;
}

interface DreamPhysiqueModalProps {
  isOpen: boolean;
  onClose: () => void;
  profile: UserProfile;
  onProfileUpdated?: (updated: UserProfile) => void;
  onPlanCreated?: (plan: WorkoutPlan) => void;
}

export const DreamPhysiqueModal: React.FC<DreamPhysiqueModalProps> = ({
  isOpen,
  onClose,
  profile,
  onProfileUpdated,
  onPlanCreated
}) => {
  // Wizard states
  const [step, setStep] = useState<'configure' | 'visualize' | 'analysis'>('configure');

  // Configuration options
  const [archetype, setArchetype] = useState<string>('v_taper');
  const [gender, setGender] = useState<'male' | 'female'>('male');
  const [targetBodyFat, setTargetBodyFat] = useState<number>(10);
  const [customPrompt, setCustomPrompt] = useState<string>('');
  const [selectedMuscleEmphasis, setSelectedMuscleEmphasis] = useState<string[]>([
    'Shoulders & Upper Chest',
    'V-Taper Lats',
    'Defined Core'
  ]);

  // Generation & Analysis states
  const [isGenerating, setIsGenerating] = useState<boolean>(false);
  const [isAnalyzing, setIsAnalyzing] = useState<boolean>(false);
  const [dreamPhysique, setDreamPhysique] = useState<DreamPhysique | null>(null);
  const [blueprint, setBlueprint] = useState<TransformationBlueprint | null>(null);
  const [notification, setNotification] = useState<string | null>(null);
  const [activePlanTab, setActivePlanTab] = useState<'overview' | 'diet' | 'workout'>('overview');

  if (!isOpen) return null;

  const showToast = (msg: string) => {
    setNotification(msg);
    setTimeout(() => setNotification(null), 3500);
  };

  const handleToggleMuscle = (muscle: string) => {
    setSelectedMuscleEmphasis((prev) =>
      prev.includes(muscle) ? prev.filter((m) => m !== muscle) : [...prev, muscle]
    );
  };

  // Step 1: Generate / Visualize Dream Physique
  const handleGeneratePhysique = async () => {
    setIsGenerating(true);
    try {
      const res = await fetch('/api/ai-generate-physique', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          archetype,
          gender,
          targetBodyFat,
          customPrompt,
          muscleEmphasis: selectedMuscleEmphasis
        })
      });
      const data = await res.json();
      if (data.success && data.physique) {
        setDreamPhysique(data.physique);
        setStep('visualize');
        // Automatically start Coach Iron's transformation analysis
        analyzePhysiqueWithCoach(data.physique);
      }
    } catch (err) {
      console.error(err);
      showToast('Failed to visualize physique. Please retry.');
    } finally {
      setIsGenerating(false);
    }
  };

  // Step 2: AI Coach Analyzes the Dream Body against current profile
  const analyzePhysiqueWithCoach = async (physiqueToAnalyze: DreamPhysique) => {
    setIsAnalyzing(true);
    try {
      const res = await fetch('/api/ai-physique-analysis', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          dreamPhysique: physiqueToAnalyze,
          currentProfile: profile
        })
      });
      const data = await res.json();
      if (data.success && data.blueprint) {
        setBlueprint(data.blueprint);
      }
    } catch (err) {
      console.error(err);
      showToast('Analysis error. Fallback plan generated.');
    } finally {
      setIsAnalyzing(false);
    }
  };

  // 1-Click Action: Apply target diet macros to profile & nutrition log
  const handleApplyDiet = () => {
    if (!blueprint?.nutritionPlan) return;
    const { calorieTarget, macros } = blueprint.nutritionPlan;
    const updated: UserProfile = {
      ...profile,
      dailyCalorieTarget: calorieTarget,
      dailyProteinTarget: macros.proteinGrams,
      dailyCarbsTarget: macros.carbsGrams,
      dailyFatTarget: macros.fatsGrams,
      primaryGoal: 'muscle_gain'
    };
    db.saveProfile(updated);
    onProfileUpdated?.(updated);
    showToast(`Diet target activated! Calories: ${calorieTarget} kcal, Protein: ${macros.proteinGrams}g`);
  };

  // 1-Click Action: Save customized workout plan into library
  const handleSaveWorkoutPlan = () => {
    if (!blueprint?.workoutPlan) return;
    const wp = blueprint.workoutPlan;
    const newPlanId = `plan-dream-${Date.now()}`;

    const formattedDays: WorkoutDay[] = wp.days.map((day, dIdx) => ({
      id: `day-${dIdx + 1}-${Date.now()}`,
      dayName: day.dayName,
      dayOrder: dIdx + 1,
      exercises: (day.exercises || []).map((ex, eIdx) => ({
        id: `ex-${eIdx + 1}-${Date.now()}`,
        name: ex.name,
        muscleGroup: ex.muscleGroup,
        equipment: (ex.equipment as any) || 'barbell',
        workingSets: ex.workingSets || 3,
        repRange: ex.repRange || '8-12',
        targetRir: ex.targetRir ?? 2,
        restSeconds: ex.restSeconds || 90,
        notes: ex.notes
      }))
    }));

    const newWorkoutPlan: WorkoutPlan = {
      id: newPlanId,
      name: wp.planName,
      trainingSplit: wp.trainingSplit,
      description: wp.description,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      isActive: true,
      days: formattedDays
    };

    const existingPlans = db.getPlans();
    db.savePlans([newWorkoutPlan, ...existingPlans]);
    db.setActivePlanId(newPlanId);
    onPlanCreated?.(newWorkoutPlan);
    showToast(`Workout plan "${wp.planName}" saved & activated in your Workout library!`);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5 bg-black/85 backdrop-blur-md animate-fade-in">
      <div className="bg-surface border border-line rounded-2xl w-full max-w-4xl overflow-hidden shadow-2xl flex flex-col max-h-[92vh]">
        {/* TOAST ALERT */}
        {notification && (
          <div className="absolute top-4 left-1/2 -translate-x-1/2 z-50 bg-lime-400 text-accent-ink font-extrabold text-xs px-4 py-2 rounded-xl flex items-center gap-2 animate-bounce">
            <CheckCircle2 className="w-4 h-4" />
            <span>{notification}</span>
          </div>
        )}

        {/* MODAL HEADER */}
        <div className="p-4 sm:p-5 border-b border-line flex items-center justify-between bg-canvas/70">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-lime-400/20 to-emerald-500/20 border border-lime-400/30 flex items-center justify-center text-lime-400 shadow-inner">
              <Sparkles className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-[11px] font-mono font-bold tracking-wide px-2 py-0.5 rounded bg-lime-400/15 text-lime-400 border border-lime-400/30">
                  AI Body Visualizer & Coach Blueprint
                </span>
              </div>
              <h2 className="text-base sm:text-lg font-bold text-zinc-100 flex items-center gap-2">
                Dream Physique Architect
              </h2>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {step !== 'configure' && (
              <button
                onClick={() => setStep('configure')}
                className="px-3 py-1.5 rounded-xl text-xs font-semibold text-zinc-400 hover:text-zinc-100 bg-surface-2 border border-line flex items-center gap-1.5 transition-colors"
              >
                <Sliders className="w-3.5 h-3.5" />
                <span>Adjust Vision</span>
              </button>
            )}
            <button
              onClick={onClose}
              className="p-2 rounded-xl text-zinc-400 hover:text-zinc-100 bg-surface-2 border border-line transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* CONTENT AREA */}
        <div className="p-4 sm:p-6 overflow-y-auto space-y-6 flex-1">
          {/* =========================================================================
              STEP 1: CONFIGURE DESIRED BODY
              ========================================================================= */}
          {step === 'configure' && (
            <div className="space-y-6 max-w-2xl mx-auto py-2">
              <div className="text-center space-y-2">
                <h3 className="text-xl sm:text-2xl font-bold text-zinc-100">
                  Design Your Target Dream Physique
                </h3>
                <p className="text-xs sm:text-sm text-zinc-400">
                  Select your aesthetic archetype, target body fat %, and priority muscle groups. Coach Iron will generate your target photo and compute your exact diet and training blueprint to achieve it.
                </p>
              </div>

              {/* ARCHETYPE SELECTOR CARDS */}
              <div className="space-y-2">
                <label className="text-xs font-mono text-zinc-400 font-bold block">
                  Select Physique Archetype:
                </label>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {[
                    {
                      id: 'v_taper',
                      title: 'Athletic Aesthetic V-Taper',
                      desc: 'Broad shoulders, wide lats, razor sharp abs, ~10% body fat. Proportional athletic build.',
                      gender: 'male'
                    },
                    {
                      id: 'classic_bodybuilding',
                      title: 'Classic Aesthetic Bodybuilder',
                      desc: 'Dense chest shelf, 3D deltoids, striated quadriceps, ~8-10% body fat.',
                      gender: 'male'
                    },
                    {
                      id: 'shredded_calisthenics',
                      title: 'Striated Calisthenics Athlete',
                      desc: 'Ultra-lean gymnast body composition, maximum power-to-weight, ~8% body fat.',
                      gender: 'male'
                    },
                    {
                      id: 'female_athletic_toned',
                      title: 'Sculpted Athletic Fitness',
                      desc: 'Defined shoulders, toned core, sculpted glutes and athletic quad sweep.',
                      gender: 'female'
                    }
                  ].map((arch) => (
                    <button
                      key={arch.id}
                      onClick={() => {
                        setArchetype(arch.id);
                        setGender(arch.gender as any);
                      }}
                      className={`text-left p-3.5 rounded-2xl border transition-all ${
                        archetype === arch.id
                          ? 'bg-lime-400/10 border-lime-400 ring-1 ring-lime-400/50 shadow-md'
                          : 'bg-surface-2/60 border-line hover:border-line-strong'
                      }`}
                    >
                      <div className="flex items-center justify-between mb-1">
                        <span className="font-bold text-xs sm:text-sm text-zinc-100">
                          {arch.title}
                        </span>
                        {archetype === arch.id && (
                          <CheckCircle2 className="w-4 h-4 text-lime-400" />
                        )}
                      </div>
                      <p className="text-[11px] text-zinc-400 leading-relaxed">
                        {arch.desc}
                      </p>
                    </button>
                  ))}
                </div>
              </div>

              {/* TARGET BODY FAT SLIDER */}
              <div className="p-4 bg-surface-2/60 border border-line rounded-2xl space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-zinc-200">
                    Target Body Fat Percentage:
                  </span>
                  <span className="text-sm font-mono font-bold text-lime-400 px-2 py-0.5 rounded bg-lime-400/10 border border-lime-400/30">
                    {targetBodyFat}% Body Fat
                  </span>
                </div>
                <input
                  type="range"
                  min="6"
                  max="20"
                  step="1"
                  value={targetBodyFat}
                  onChange={(e) => setTargetBodyFat(Number(e.target.value))}
                  className="w-full accent-lime-400 cursor-pointer"
                />
                <div className="flex justify-between text-[11px] font-mono text-zinc-500">
                  <span>6% (Stage Lean)</span>
                  <span>10% (Chiseled)</span>
                  <span>14% (Athletic)</span>
                  <span>20% (Bulk)</span>
                </div>
              </div>

              {/* MUSCLE EMPHASIS CHIPS */}
              <div className="space-y-2">
                <label className="text-xs font-mono text-zinc-400 font-bold block">
                  Priority Muscle Emphasis (Select up to 3):
                </label>
                <div className="flex flex-wrap gap-2">
                  {[
                    'Shoulders & Upper Chest',
                    'V-Taper Lats',
                    'Defined Core & Abs',
                    'Biceps & Triceps Peaks',
                    'Quadriceps & Hamstrings',
                    'Glutes & Posterior Chain',
                    'Dense Traps & Neck'
                  ].map((muscle) => {
                    const isSelected = selectedMuscleEmphasis.includes(muscle);
                    return (
                      <button
                        key={muscle}
                        onClick={() => handleToggleMuscle(muscle)}
                        className={`px-3 py-1.5 rounded-xl text-xs font-semibold border transition-all ${
                          isSelected
                            ? 'bg-lime-400 text-accent-ink border-lime-400 shadow-sm font-bold'
                            : 'bg-surface-2 text-zinc-400 border-line hover:border-line-strong'
                        }`}
                      >
                        {muscle}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* OPTIONAL CUSTOM VISION PROMPT */}
              <div className="space-y-1.5">
                <label className="text-xs font-mono text-zinc-400 font-bold block">
                  Custom Physique Details (Optional):
                </label>
                <input
                  type="text"
                  value={customPrompt}
                  onChange={(e) => setCustomPrompt(e.target.value)}
                  placeholder="e.g. Broad clavicles, narrow waist, aesthetic vascularity for basketball"
                  className="w-full px-4 py-2.5 bg-surface-2 border border-line rounded-xl text-xs sm:text-sm text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:border-lime-400"
                />
              </div>

              {/* CURRENT BASELINE CARD */}
              <div className="p-3.5 bg-surface-2 border border-zinc-800/90 rounded-2xl flex items-center justify-between text-xs">
                <div className="flex items-center gap-2 text-zinc-400">
                  <Scale className="w-4 h-4 text-lime-400" />
                  <span>Your Current Baseline:</span>
                  <span className="font-bold text-zinc-200">
                    {profile.currentWeightKg}{profile.preferredUnit} · {profile.trainingExperience} · {profile.trainingDaysPerWeek}d/wk
                  </span>
                </div>
                <span className="text-[11px] font-mono text-zinc-500">Coach Iron Ready</span>
              </div>

              {/* SUBMIT BUTTON */}
              <button
                onClick={handleGeneratePhysique}
                disabled={isGenerating}
                className="touch-press w-full py-4 bg-lime-400 hover:bg-lime-300 disabled:opacity-40 text-accent-ink font-extrabold text-sm rounded-2xl shadow-lime-950/40 flex items-center justify-center gap-2 transition-all"
              >
                {isGenerating ? (
                  <>
                    <Activity className="w-5 h-5 animate-spin" />
                    <span>Visualizing Dream Physique with AI...</span>
                  </>
                ) : (
                  <>
                    <Sparkles className="w-5 h-5" />
                    <span>Generate Photo & Coach Analysis</span>
                  </>
                )}
              </button>
            </div>
          )}

          {/* =========================================================================
              STEP 2: VISUALIZE PHOTO + IN-DEPTH AI COACH BLUEPRINT
              ========================================================================= */}
          {(step === 'visualize' || step === 'analysis') && dreamPhysique && (
            <div className="space-y-6">
              {/* TOP HERO: THE AI GENERATED TARGET PHOTO & AUDIT SUMMARY */}
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 bg-surface-2 border border-line rounded-2xl p-4 sm:p-6">
                {/* PHOTO CONTAINER */}
                <div className="lg:col-span-5 flex flex-col items-center">
                  <div className="relative rounded-2xl overflow-hidden border-2 border-lime-400/40 shadow-2xl w-full max-w-xs aspect-[3/4] bg-canvas">
                    <img
                      src={dreamPhysique.imageUrl}
                      alt={dreamPhysique.title}
                      referrerPolicy="no-referrer"
                      className="w-full h-full object-cover object-top"
                    />
                    <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-black/30 pointer-events-none" />
                    
                    {/* OVERLAY BADGES */}
                    <div className="absolute top-3 left-3 bg-black/70 backdrop-blur-md px-2.5 py-1 rounded-xl border border-lime-400/40 text-[11px] font-mono font-bold text-lime-400 flex items-center gap-1.5">
                      <Sparkles className="w-3 h-3" />
                      <span>Target Dream Physique</span>
                    </div>

                    <div className="absolute bottom-3 left-3 right-3 text-zinc-100">
                      <div className="text-xs font-mono font-bold text-lime-400 tracking-wide">
                        {dreamPhysique.targetBodyFat}% Target Body Fat
                      </div>
                      <div className="text-sm font-bold truncate">{dreamPhysique.title}</div>
                    </div>
                  </div>

                  <p className="text-[11px] text-zinc-400 text-center mt-3 max-w-xs leading-relaxed italic">
                    &quot;{dreamPhysique.description}&quot;
                  </p>
                </div>

                {/* COACH IRON GAP AUDIT SUMMARY */}
                <div className="lg:col-span-7 flex flex-col justify-between space-y-4">
                  <div className="space-y-3">
                    <div className="flex items-center gap-2">
                      <div className="w-8 h-8 rounded-xl bg-lime-400/15 border border-lime-400/30 flex items-center justify-center text-lime-400">
                        <Flame className="w-4 h-4 fill-lime-400" />
                      </div>
                      <div>
                        <span className="text-[11px] font-mono text-lime-400 font-bold tracking-wide">
                          Coach Iron Biomechanics Audit
                        </span>
                        <h4 className="text-lg font-extrabold text-zinc-100">
                          Physique Transformation Roadmap
                        </h4>
                      </div>
                    </div>

                    {isAnalyzing ? (
                      <div className="p-6 bg-surface-2/60 border border-line rounded-2xl flex flex-col items-center justify-center space-y-3 text-center">
                        <Activity className="w-6 h-6 text-lime-400 animate-spin" />
                        <span className="text-xs text-zinc-300 font-semibold">
                          Coach Iron is calculating metabolic requirements, macronutrient breakdown, and targeted hypertrophy split...
                        </span>
                      </div>
                    ) : blueprint?.gapAnalysis ? (
                      <div className="space-y-3">
                        <div className="grid grid-cols-2 gap-2 text-xs">
                          <div className="p-3 bg-surface-2/80 border border-line rounded-xl">
                            <span className="text-zinc-500 font-mono text-[11px] block">Current Baseline:</span>
                            <span className="font-bold text-zinc-200">
                              {blueprint.gapAnalysis.currentStatsSummary}
                            </span>
                          </div>
                          <div className="p-3 bg-surface-2/80 border border-line rounded-xl">
                            <span className="text-zinc-500 font-mono text-[11px] block">Target Goal:</span>
                            <span className="font-bold text-lime-400">
                              {blueprint.gapAnalysis.targetStatsSummary}
                            </span>
                          </div>
                        </div>

                        <div className="p-3 bg-lime-400/10 border border-lime-400/30 rounded-xl text-xs space-y-1">
                          <div className="flex items-center justify-between">
                            <span className="font-bold text-lime-400 font-mono text-[11px] ">
                              Verdict: {blueprint.gapAnalysis.bodyCompositionVerdict}
                            </span>
                            <span className="text-[11px] font-mono text-zinc-300">
                              Est. {blueprint.gapAnalysis.estTimelineWeeks}
                            </span>
                          </div>
                          <ul className="space-y-1 pt-1">
                            {blueprint.gapAnalysis.keyFocusAreas.map((area, idx) => (
                              <li key={idx} className="flex items-start gap-1.5 text-zinc-300 text-[11px]">
                                <span className="text-lime-400 font-bold">·</span>
                                <span>{area}</span>
                              </li>
                            ))}
                          </ul>
                        </div>
                      </div>
                    ) : null}
                  </div>

                  {/* 1-CLICK ACTION BUTTONS */}
                  <div className="pt-2 flex flex-col sm:flex-row gap-2.5">
                    <button
                      onClick={handleApplyDiet}
                      disabled={isAnalyzing || !blueprint?.nutritionPlan}
                      className="touch-press flex-1 py-3 px-4 bg-lime-400 hover:bg-lime-300 disabled:opacity-40 text-accent-ink font-extrabold text-xs rounded-xl shadow-md flex items-center justify-center gap-2 transition-all"
                    >
                      <Apple className="w-4 h-4" />
                      <span>Activate Target Diet in App</span>
                    </button>
                    <button
                      onClick={handleSaveWorkoutPlan}
                      disabled={isAnalyzing || !blueprint?.workoutPlan}
                      className="touch-press flex-1 py-3 px-4 bg-surface-2 hover:bg-surface-3 border border-line-strong disabled:opacity-40 text-zinc-100 font-bold text-xs rounded-xl flex items-center justify-center gap-2 transition-all"
                    >
                      <Dumbbell className="w-4 h-4 text-lime-400" />
                      <span>Save Workout Plan to Plans</span>
                    </button>
                  </div>
                </div>
              </div>

              {/* NAVIGATION TABS FOR DETAILED BLUEPRINT: DIET VS WORKOUT */}
              <div className="flex items-center gap-2 border-b border-line pb-2">
                <button
                  onClick={() => setActivePlanTab('overview')}
                  className={`px-4 py-2 rounded-xl text-xs font-bold transition-all ${
                    activePlanTab === 'overview'
                      ? 'bg-lime-400 text-accent-ink shadow-md'
                      : 'text-zinc-400 hover:text-zinc-200'
                  }`}
                >
                  Coach Iron Prescription
                </button>
                <button
                  onClick={() => setActivePlanTab('diet')}
                  className={`px-4 py-2 rounded-xl text-xs font-bold transition-all ${
                    activePlanTab === 'diet'
                      ? 'bg-lime-400 text-accent-ink shadow-md'
                      : 'text-zinc-400 hover:text-zinc-200'
                  }`}
                >
                  Daily Diet & Macros
                </button>
                <button
                  onClick={() => setActivePlanTab('workout')}
                  className={`px-4 py-2 rounded-xl text-xs font-bold transition-all ${
                    activePlanTab === 'workout'
                      ? 'bg-lime-400 text-accent-ink shadow-md'
                      : 'text-zinc-400 hover:text-zinc-200'
                  }`}
                >
                  Custom Workout Routine
                </button>
              </div>

              {/* TAB 1: OVERVIEW & COACH MESSAGE */}
              {activePlanTab === 'overview' && blueprint && (
                <div className="space-y-4 animate-fade-in">
                  <div className="p-4 bg-surface-2/60 border border-line rounded-2xl space-y-3">
                    <div className="flex items-center gap-2 text-lime-400 text-xs font-mono font-bold ">
                      <Zap className="w-4 h-4" />
                      <span>Coach Iron&apos;s Direct Guidance</span>
                    </div>
                    <p className="text-xs sm:text-sm text-zinc-200 leading-relaxed">
                      {blueprint.coachMessage}
                    </p>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div className="p-4 bg-surface-2 border border-line rounded-2xl space-y-1">
                      <span className="text-[11px] font-mono text-zinc-500 ">Daily Caloric Target</span>
                      <div className="text-2xl font-mono font-bold text-lime-400">
                        {blueprint.nutritionPlan.calorieTarget} <span className="text-xs font-normal text-zinc-400">kcal/day</span>
                      </div>
                      <p className="text-[11px] text-zinc-400">{blueprint.nutritionPlan.strategy}</p>
                    </div>

                    <div className="p-4 bg-surface-2 border border-line rounded-2xl space-y-1">
                      <span className="text-[11px] font-mono text-zinc-500 ">Daily Protein Target</span>
                      <div className="text-2xl font-mono font-bold text-lime-400">
                        {blueprint.nutritionPlan.macros.proteinGrams}g <span className="text-xs font-normal text-zinc-400">/day</span>
                      </div>
                      <p className="text-[11px] text-zinc-400">{blueprint.nutritionPlan.macros.proteinPerKg}</p>
                    </div>

                    <div className="p-4 bg-surface-2 border border-line rounded-2xl space-y-1">
                      <span className="text-[11px] font-mono text-zinc-500 ">Training Program</span>
                      <div className="text-lg font-bold text-zinc-100 truncate">
                        {blueprint.workoutPlan.planName}
                      </div>
                      <p className="text-[11px] text-zinc-400">{blueprint.workoutPlan.trainingSplit}</p>
                    </div>
                  </div>
                </div>
              )}

              {/* TAB 2: DETAILED NUTRITION & MEAL PLAN */}
              {activePlanTab === 'diet' && blueprint && (
                <div className="space-y-4 animate-fade-in">
                  {/* MACROS BREAKDOWN ROW */}
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    <div className="p-3 bg-surface-2 border border-line rounded-xl text-center">
                      <span className="text-[11px] font-mono text-zinc-500 block ">Calories</span>
                      <span className="text-xl font-mono font-bold text-zinc-100">{blueprint.nutritionPlan.calorieTarget}</span>
                    </div>
                    <div className="p-3 bg-surface-2 border border-line rounded-xl text-center">
                      <span className="text-[11px] font-mono text-emerald-400 block ">Protein</span>
                      <span className="text-xl font-mono font-bold text-emerald-400">{blueprint.nutritionPlan.macros.proteinGrams}g</span>
                    </div>
                    <div className="p-3 bg-surface-2 border border-line rounded-xl text-center">
                      <span className="text-[11px] font-mono text-amber-400 block ">Carbs</span>
                      <span className="text-xl font-mono font-bold text-amber-400">{blueprint.nutritionPlan.macros.carbsGrams}g</span>
                    </div>
                    <div className="p-3 bg-surface-2 border border-line rounded-xl text-center">
                      <span className="text-[11px] font-mono text-rose-400 block ">Fats</span>
                      <span className="text-xl font-mono font-bold text-rose-400">{blueprint.nutritionPlan.macros.fatsGrams}g</span>
                    </div>
                  </div>

                  {/* NUTRIENT TIMING PROTOCOL */}
                  <div className="p-4 bg-surface-2/60 border border-line rounded-2xl space-y-2">
                    <span className="text-xs font-mono font-bold text-lime-400 block">
                      Nutrient Timing & Partitioning Strategy:
                    </span>
                    <ul className="space-y-1.5 text-xs text-zinc-300">
                      {blueprint.nutritionPlan.nutrientTiming.map((timing, tIdx) => (
                        <li key={tIdx} className="flex items-start gap-2">
                          <CheckCircle2 className="w-3.5 h-3.5 text-lime-400 shrink-0 mt-0.5" />
                          <span>{timing}</span>
                        </li>
                      ))}
                    </ul>
                  </div>

                  {/* SAMPLE MEAL PLAN */}
                  <div className="space-y-2">
                    <span className="text-xs font-mono font-bold text-zinc-400 block">
                      Sample Daily Meal Schedule:
                    </span>
                    <div className="space-y-2">
                      {blueprint.nutritionPlan.sampleMealPlan.map((m, mIdx) => (
                        <div
                          key={mIdx}
                          className="p-3.5 bg-surface-2/70 border border-line rounded-xl flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs"
                        >
                          <div>
                            <span className="font-bold text-zinc-100 block">{m.meal}</span>
                            <span className="text-zinc-400 text-[11px]">{m.foods}</span>
                          </div>
                          <div className="flex items-center gap-3 shrink-0 font-mono text-zinc-400 text-[11px]">
                            <span>{m.calories} kcal</span>
                            <span className="text-emerald-400 font-bold">{m.protein}g protein</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* SUPPLEMENTS */}
                  <div className="p-4 bg-surface-2/40 border border-line rounded-2xl space-y-1.5 text-xs">
                    <span className="font-bold font-mono text-zinc-400 text-[11px]">
                      Recommended Supplements for Accelerated Adaptation:
                    </span>
                    <ul className="space-y-1 text-zinc-300">
                      {blueprint.nutritionPlan.recommendedSupplements.map((supp, sIdx) => (
                        <li key={sIdx} className="flex items-center gap-2">
                          <span className="w-1.5 h-1.5 rounded-full bg-lime-400" />
                          <span>{supp}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              )}

              {/* TAB 3: CUSTOM WORKOUT PROGRAM */}
              {activePlanTab === 'workout' && blueprint && (
                <div className="space-y-4 animate-fade-in">
                  <div className="p-4 bg-surface-2/60 border border-line rounded-2xl space-y-1">
                    <h4 className="font-bold text-zinc-100 text-sm">
                      {blueprint.workoutPlan.planName}
                    </h4>
                    <p className="text-xs text-zinc-400">
                      {blueprint.workoutPlan.description}
                    </p>
                  </div>

                  <div className="space-y-3">
                    {blueprint.workoutPlan.days.map((day, dIdx) => (
                      <div
                        key={dIdx}
                        className="p-4 bg-surface-2/40 border border-line rounded-2xl space-y-2.5"
                      >
                        <div className="flex items-center justify-between border-b border-line pb-2">
                          <span className="font-bold text-xs sm:text-sm text-lime-400">
                            {day.dayName}
                          </span>
                          <span className="text-[11px] font-mono text-zinc-500">
                            {day.exercises.length} Exercises
                          </span>
                        </div>

                        {day.exercises.length === 0 ? (
                          <p className="text-xs text-zinc-500 italic py-1">
                            Rest, hydration, and central nervous system recovery.
                          </p>
                        ) : (
                          <div className="space-y-2">
                            {day.exercises.map((ex, eIdx) => (
                              <div
                                key={eIdx}
                                className="p-2.5 bg-canvas/60 border border-zinc-800/60 rounded-xl flex flex-col sm:flex-row sm:items-center justify-between gap-1 text-xs"
                              >
                                <div>
                                  <span className="font-bold text-zinc-200">{ex.name}</span>
                                  {ex.notes && (
                                    <span className="text-[11px] text-zinc-500 block">
                                      {ex.notes}
                                    </span>
                                  )}
                                </div>
                                <div className="flex items-center gap-2.5 font-mono text-[11px] text-zinc-400 shrink-0">
                                  <span>{ex.workingSets} sets</span>
                                  <span>·</span>
                                  <span className="text-lime-400 font-bold">{ex.repRange} reps</span>
                                  <span>·</span>
                                  <span>{ex.restSeconds}s rest</span>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
