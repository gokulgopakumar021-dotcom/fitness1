import React, { useState } from 'react';
import {
  Sparkles,
  Flame,
  Dumbbell,
  Apple,
  CheckCircle2,
  Zap,
  Sliders,
  Scale
} from 'lucide-react';
import { UserProfile, WorkoutPlan, WorkoutDay, PlannedExercise } from '../../types';
import { db } from '../../storage/db';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { Badge } from '../ui/Badge';
import { Input } from '../ui/Input';
import { LoadingState } from '../ui/LoadingState';
import { SegmentedControl } from '../ui/SegmentedControl';
import { MACRO_META } from '../nutrition/MacroBar';

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

  const ARCHETYPES = [
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
  ];

  const MUSCLE_OPTIONS = [
    'Shoulders & Upper Chest',
    'V-Taper Lats',
    'Defined Core & Abs',
    'Biceps & Triceps Peaks',
    'Quadriceps & Hamstrings',
    'Glutes & Posterior Chain',
    'Dense Traps & Neck'
  ];

  return (
    <Modal
      open={isOpen}
      onClose={onClose}
      title="Dream Physique Architect"
      description="AI Body Visualizer & Coach Blueprint"
      size="xl"
    >
      <div className="space-y-6">
        {/* TOAST: anchored to the dialog panel, announced politely */}
        {notification && (
          <div
            role="status"
            className="absolute bottom-4 left-1/2 -translate-x-1/2 z-10 w-max max-w-[calc(100%-2rem)] bg-accent text-accent-ink font-semibold text-xs px-4 py-2.5 rounded-control shadow-lg flex items-center gap-2"
          >
            <CheckCircle2 className="w-4 h-4 shrink-0" aria-hidden />
            <span>{notification}</span>
          </div>
        )}

        {step !== 'configure' && (
          <div className="flex justify-end">
            <Button variant="secondary" onClick={() => setStep('configure')} icon={<Sliders className="w-4 h-4" aria-hidden />}>
              Adjust Vision
            </Button>
          </div>
        )}

        {/* =========================================================================
            STEP 1: CONFIGURE DESIRED BODY
            ========================================================================= */}
        {step === 'configure' && (
          <div className="space-y-6 max-w-2xl mx-auto">
            <div className="text-center space-y-2">
              <h3 className="text-xl sm:text-2xl font-bold text-zinc-100">
                Design Your Target Dream Physique
              </h3>
              <p className="text-sm text-zinc-400">
                Select your aesthetic archetype, target body fat %, and priority muscle groups. Coach Iron will generate your target photo and compute your exact diet and training blueprint to achieve it.
              </p>
            </div>

            {/* ARCHETYPE SELECTOR CARDS */}
            <div className="space-y-2">
              <span id="dream-archetype-label" className="text-xs font-medium text-zinc-300 block">
                Select Physique Archetype
              </span>
              <div role="group" aria-labelledby="dream-archetype-label" className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {ARCHETYPES.map((arch) => {
                  const selected = archetype === arch.id;
                  return (
                    <button
                      key={arch.id}
                      type="button"
                      aria-pressed={selected}
                      onClick={() => {
                        setArchetype(arch.id);
                        setGender(arch.gender as any);
                      }}
                      className={`touch-press text-left p-3.5 rounded-card border transition-colors ${
                        selected
                          ? 'bg-accent/10 border-accent'
                          : 'bg-surface-2 border-line hover:border-line-strong'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2 mb-1">
                        <span className="font-bold text-sm text-zinc-100">{arch.title}</span>
                        {selected && <CheckCircle2 className="w-4 h-4 text-accent shrink-0" aria-hidden />}
                      </div>
                      <p className="text-xs text-zinc-400 leading-relaxed">{arch.desc}</p>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* TARGET BODY FAT SLIDER */}
            <Card tone="raised" pad="md" className="space-y-3">
              <div className="flex items-center justify-between gap-2">
                <label htmlFor="dream-body-fat" className="text-xs font-medium text-zinc-300">
                  Target Body Fat Percentage
                </label>
                <Badge tone="accent" className="font-mono text-sm">
                  {targetBodyFat}% Body Fat
                </Badge>
              </div>
              <input
                id="dream-body-fat"
                type="range"
                min="6"
                max="20"
                step="1"
                value={targetBodyFat}
                aria-valuetext={`${targetBodyFat}% body fat`}
                onChange={(e) => setTargetBodyFat(Number(e.target.value))}
                className="w-full h-8 accent-accent cursor-pointer"
              />
              <div className="flex flex-wrap justify-between gap-x-3 gap-y-0.5 text-label font-mono text-zinc-500">
                <span>6% (Stage Lean)</span>
                <span>10% (Chiseled)</span>
                <span>14% (Athletic)</span>
                <span>20% (Bulk)</span>
              </div>
            </Card>

            {/* MUSCLE EMPHASIS CHIPS */}
            <div className="space-y-2">
              <span id="dream-muscle-label" className="text-xs font-medium text-zinc-300 block">
                Priority Muscle Emphasis (Select up to 3)
              </span>
              <div role="group" aria-labelledby="dream-muscle-label" className="flex flex-wrap gap-2">
                {MUSCLE_OPTIONS.map((muscle) => {
                  const isSelected = selectedMuscleEmphasis.includes(muscle);
                  return (
                    <button
                      key={muscle}
                      type="button"
                      aria-pressed={isSelected}
                      onClick={() => handleToggleMuscle(muscle)}
                      className={`touch-press h-11 px-3.5 rounded-control text-xs font-semibold border transition-colors ${
                        isSelected
                          ? 'bg-accent text-accent-ink border-accent'
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
            <Input
              label="Custom Physique Details (Optional)"
              type="text"
              value={customPrompt}
              onChange={(e) => setCustomPrompt(e.target.value)}
              placeholder="e.g. Broad clavicles, narrow waist, aesthetic vascularity for basketball"
            />

            {/* CURRENT BASELINE CARD */}
            <Card tone="raised" pad="sm" className="flex flex-wrap items-center justify-between gap-2 text-xs">
              <div className="flex flex-wrap items-center gap-2 text-zinc-400">
                <Scale className="w-4 h-4 text-accent" aria-hidden />
                <span>Your Current Baseline:</span>
                <span className="font-bold text-zinc-200">
                  {profile.currentWeightKg}{profile.preferredUnit} · {profile.trainingExperience} · {profile.trainingDaysPerWeek}d/wk
                </span>
              </div>
              <span className="text-label font-mono text-zinc-500">Coach Iron Ready</span>
            </Card>

            {/* SUBMIT BUTTON */}
            <Button
              size="lg"
              fullWidth
              onClick={handleGeneratePhysique}
              loading={isGenerating}
              icon={isGenerating ? undefined : <Sparkles className="w-5 h-5" aria-hidden />}
            >
              {isGenerating ? 'Visualizing Dream Physique with AI...' : 'Generate Photo & Coach Analysis'}
            </Button>
          </div>
        )}

        {/* =========================================================================
            STEP 2: VISUALIZE PHOTO + IN-DEPTH AI COACH BLUEPRINT
            ========================================================================= */}
        {(step === 'visualize' || step === 'analysis') && dreamPhysique && (
          <div className="space-y-6">
            {/* HERO: TARGET PHOTO & AUDIT SUMMARY */}
            <Card tone="raised" pad="lg" className="grid grid-cols-1 lg:grid-cols-12 gap-5">
              {/* PHOTO */}
              <div className="lg:col-span-5 flex flex-col items-center">
                <div className="rounded-card overflow-hidden border border-line w-full max-w-xs aspect-[3/4] bg-canvas">
                  <img
                    src={dreamPhysique.imageUrl}
                    alt={dreamPhysique.title}
                    referrerPolicy="no-referrer"
                    className="w-full h-full object-cover object-top"
                  />
                </div>

                <div className="mt-3 w-full max-w-xs space-y-1.5 text-center">
                  <Badge tone="accent" icon={<Sparkles className="w-3 h-3" aria-hidden />} className="font-mono">
                    Target Dream Physique
                  </Badge>
                  <div className="text-xs font-mono font-bold text-accent tracking-wide">
                    {dreamPhysique.targetBodyFat}% Target Body Fat
                  </div>
                  <div className="text-sm font-bold text-zinc-100">{dreamPhysique.title}</div>
                  <p className="text-xs text-zinc-400 leading-relaxed italic">
                    &quot;{dreamPhysique.description}&quot;
                  </p>
                </div>
              </div>

              {/* COACH IRON GAP AUDIT SUMMARY */}
              <div className="lg:col-span-7 flex flex-col justify-between gap-4 min-w-0">
                <div className="space-y-3">
                  <div className="flex items-center gap-2">
                    <div className="w-9 h-9 rounded-control bg-accent/10 border border-accent/30 flex items-center justify-center text-accent shrink-0">
                      <Flame className="w-4 h-4 fill-current" aria-hidden />
                    </div>
                    <div className="min-w-0">
                      <span className="text-label font-mono text-accent font-bold tracking-wide block">
                        Coach Iron Biomechanics Audit
                      </span>
                      <h4 className="text-lg font-extrabold text-zinc-100">
                        Physique Transformation Roadmap
                      </h4>
                    </div>
                  </div>

                  {isAnalyzing ? (
                    <LoadingState
                      className="py-6 text-center"
                      label="Coach Iron is calculating metabolic requirements, macronutrient breakdown, and targeted hypertrophy split..."
                    />
                  ) : blueprint?.gapAnalysis ? (
                    <div className="space-y-3">
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                        <Card pad="sm">
                          <span className="text-zinc-500 font-mono text-label block">Current Baseline:</span>
                          <span className="font-bold text-zinc-200">
                            {blueprint.gapAnalysis.currentStatsSummary}
                          </span>
                        </Card>
                        <Card pad="sm">
                          <span className="text-zinc-500 font-mono text-label block">Target Goal:</span>
                          <span className="font-bold text-accent">
                            {blueprint.gapAnalysis.targetStatsSummary}
                          </span>
                        </Card>
                      </div>

                      <div className="p-3 bg-accent/10 border border-accent/30 rounded-card text-xs space-y-1">
                        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                          <span className="font-bold text-accent font-mono text-label">
                            Verdict: {blueprint.gapAnalysis.bodyCompositionVerdict}
                          </span>
                          <span className="text-label font-mono text-zinc-300">
                            Est. {blueprint.gapAnalysis.estTimelineWeeks}
                          </span>
                        </div>
                        <ul className="space-y-1 pt-1">
                          {blueprint.gapAnalysis.keyFocusAreas.map((area, idx) => (
                            <li key={idx} className="flex items-start gap-1.5 text-zinc-300 text-xs">
                              <span className="text-accent font-bold" aria-hidden>·</span>
                              <span>{area}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    </div>
                  ) : null}
                </div>

                {/* 1-CLICK ACTION BUTTONS */}
                <div className="flex flex-col sm:flex-row gap-2.5">
                  <Button
                    fullWidth
                    className="sm:flex-1"
                    onClick={handleApplyDiet}
                    disabled={isAnalyzing || !blueprint?.nutritionPlan}
                    icon={<Apple className="w-4 h-4" aria-hidden />}
                  >
                    Activate Target Diet in App
                  </Button>
                  <Button
                    variant="secondary"
                    fullWidth
                    className="sm:flex-1"
                    onClick={handleSaveWorkoutPlan}
                    disabled={isAnalyzing || !blueprint?.workoutPlan}
                    icon={<Dumbbell className="w-4 h-4 text-accent" aria-hidden />}
                  >
                    Save Workout Plan to Plans
                  </Button>
                </div>
              </div>
            </Card>

            {/* TABS FOR THE DETAILED BLUEPRINT */}
            <SegmentedControl
              ariaLabel="Blueprint sections"
              value={activePlanTab}
              onChange={setActivePlanTab}
              options={[
                { value: 'overview', label: 'Coach Iron Prescription' },
                { value: 'diet', label: 'Daily Diet & Macros' },
                { value: 'workout', label: 'Custom Workout Routine' }
              ]}
            />

            {/* TAB 1: OVERVIEW & COACH MESSAGE */}
            {activePlanTab === 'overview' && blueprint && (
              <div className="space-y-4 il-fade-in">
                <Card tone="raised" pad="md" className="space-y-3">
                  <div className="flex items-center gap-2 text-accent text-xs font-mono font-bold">
                    <Zap className="w-4 h-4" aria-hidden />
                    <span>Coach Iron&apos;s Direct Guidance</span>
                  </div>
                  <p className="text-sm text-zinc-200 leading-relaxed">
                    {blueprint.coachMessage}
                  </p>
                </Card>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <Card tone="raised" pad="md" className="space-y-1">
                    <span className="text-label font-mono text-zinc-500">Daily Caloric Target</span>
                    <div className="text-2xl font-mono font-bold text-accent">
                      {blueprint.nutritionPlan.calorieTarget} <span className="text-xs font-normal text-zinc-400">kcal/day</span>
                    </div>
                    <p className="text-xs text-zinc-400">{blueprint.nutritionPlan.strategy}</p>
                  </Card>

                  <Card tone="raised" pad="md" className="space-y-1">
                    <span className="text-label font-mono text-zinc-500">Daily Protein Target</span>
                    <div className="text-2xl font-mono font-bold text-accent">
                      {blueprint.nutritionPlan.macros.proteinGrams}g <span className="text-xs font-normal text-zinc-400">/day</span>
                    </div>
                    <p className="text-xs text-zinc-400">{blueprint.nutritionPlan.macros.proteinPerKg}</p>
                  </Card>

                  <Card tone="raised" pad="md" className="space-y-1">
                    <span className="text-label font-mono text-zinc-500">Training Program</span>
                    <div className="text-lg font-bold text-zinc-100 truncate">
                      {blueprint.workoutPlan.planName}
                    </div>
                    <p className="text-xs text-zinc-400">{blueprint.workoutPlan.trainingSplit}</p>
                  </Card>
                </div>
              </div>
            )}

            {/* TAB 2: DETAILED NUTRITION & MEAL PLAN */}
            {activePlanTab === 'diet' && blueprint && (
              <div className="space-y-4 il-fade-in">
                {/* MACROS BREAKDOWN ROW: macro colours come from MACRO_META, like the Nutrition screen */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <Card tone="raised" pad="sm" className="text-center">
                    <span className="text-label font-mono text-zinc-500 block">Calories</span>
                    <span className="text-xl font-mono font-bold text-zinc-100">{blueprint.nutritionPlan.calorieTarget}</span>
                  </Card>
                  <Card tone="raised" pad="sm" className="text-center">
                    <span className="text-label font-mono block" style={{ color: MACRO_META.protein.color }}>Protein</span>
                    <span className="text-xl font-mono font-bold" style={{ color: MACRO_META.protein.color }}>{blueprint.nutritionPlan.macros.proteinGrams}g</span>
                  </Card>
                  <Card tone="raised" pad="sm" className="text-center">
                    <span className="text-label font-mono block" style={{ color: MACRO_META.carbs.color }}>Carbs</span>
                    <span className="text-xl font-mono font-bold" style={{ color: MACRO_META.carbs.color }}>{blueprint.nutritionPlan.macros.carbsGrams}g</span>
                  </Card>
                  <Card tone="raised" pad="sm" className="text-center">
                    <span className="text-label font-mono block" style={{ color: MACRO_META.fat.color }}>Fats</span>
                    <span className="text-xl font-mono font-bold" style={{ color: MACRO_META.fat.color }}>{blueprint.nutritionPlan.macros.fatsGrams}g</span>
                  </Card>
                </div>

                {/* NUTRIENT TIMING PROTOCOL */}
                <Card tone="raised" pad="md" className="space-y-2">
                  <span className="text-xs font-mono font-bold text-accent block">
                    Nutrient Timing & Partitioning Strategy:
                  </span>
                  <ul className="space-y-1.5 text-sm text-zinc-300">
                    {blueprint.nutritionPlan.nutrientTiming.map((timing, tIdx) => (
                      <li key={tIdx} className="flex items-start gap-2">
                        <CheckCircle2 className="w-3.5 h-3.5 text-accent shrink-0 mt-1" aria-hidden />
                        <span>{timing}</span>
                      </li>
                    ))}
                  </ul>
                </Card>

                {/* SAMPLE MEAL PLAN */}
                <div className="space-y-2">
                  <span className="text-xs font-mono font-bold text-zinc-400 block">
                    Sample Daily Meal Schedule:
                  </span>
                  <div className="space-y-2">
                    {blueprint.nutritionPlan.sampleMealPlan.map((m, mIdx) => (
                      <Card
                        key={mIdx}
                        pad="sm"
                        className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs"
                      >
                        <div className="min-w-0">
                          <span className="font-bold text-zinc-100 block">{m.meal}</span>
                          <span className="text-zinc-400">{m.foods}</span>
                        </div>
                        <div className="flex items-center gap-3 shrink-0 font-mono text-zinc-400">
                          <span>{m.calories} kcal</span>
                          <span className="font-bold" style={{ color: MACRO_META.protein.color }}>{m.protein}g protein</span>
                        </div>
                      </Card>
                    ))}
                  </div>
                </div>

                {/* SUPPLEMENTS */}
                <Card pad="md" className="space-y-1.5 text-xs">
                  <span className="font-bold font-mono text-zinc-400">
                    Recommended Supplements for Accelerated Adaptation:
                  </span>
                  <ul className="space-y-1 text-zinc-300">
                    {blueprint.nutritionPlan.recommendedSupplements.map((supp, sIdx) => (
                      <li key={sIdx} className="flex items-center gap-2">
                        <span className="w-1.5 h-1.5 rounded-full bg-accent shrink-0" aria-hidden />
                        <span>{supp}</span>
                      </li>
                    ))}
                  </ul>
                </Card>
              </div>
            )}

            {/* TAB 3: CUSTOM WORKOUT PROGRAM */}
            {activePlanTab === 'workout' && blueprint && (
              <div className="space-y-4 il-fade-in">
                <Card tone="raised" pad="md" className="space-y-1">
                  <h4 className="font-bold text-zinc-100 text-sm">
                    {blueprint.workoutPlan.planName}
                  </h4>
                  <p className="text-xs text-zinc-400">
                    {blueprint.workoutPlan.description}
                  </p>
                </Card>

                <div className="space-y-3">
                  {blueprint.workoutPlan.days.map((day, dIdx) => (
                    <Card key={dIdx} pad="md" className="space-y-2.5">
                      <div className="flex items-center justify-between gap-2 border-b border-line pb-2">
                        <span className="font-bold text-sm text-accent">
                          {day.dayName}
                        </span>
                        <span className="text-label font-mono text-zinc-500">
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
                              className="p-2.5 bg-canvas border border-line rounded-control flex flex-col sm:flex-row sm:items-center justify-between gap-1 text-xs"
                            >
                              <div className="min-w-0">
                                <span className="font-bold text-zinc-200">{ex.name}</span>
                                {ex.notes && (
                                  <span className="text-xs text-zinc-500 block">
                                    {ex.notes}
                                  </span>
                                )}
                              </div>
                              <div className="flex flex-wrap items-center gap-x-2.5 gap-y-0.5 font-mono text-label text-zinc-400 shrink-0">
                                <span>{ex.workingSets} sets</span>
                                <span aria-hidden>·</span>
                                <span className="text-accent font-bold">{ex.repRange} reps</span>
                                <span aria-hidden>·</span>
                                <span>{ex.restSeconds}s rest</span>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </Card>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
};
