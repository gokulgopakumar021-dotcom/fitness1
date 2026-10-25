import React, { useState, useEffect } from 'react';
import {
  TrendingUp,
  CheckCircle2,
  XCircle,
  Edit3,
  AlertCircle,
  HelpCircle,
  Award,
  Zap,
  ArrowUpRight,
  ShieldAlert,
  Sliders,
  History,
  FileSpreadsheet,
  Check,
  RotateCcw,
  Layers,
  ChevronRight,
  Sparkles,
  Eye
} from 'lucide-react';
import { ExercisePostureModal } from '../posture/ExercisePostureModal';
import {
  EquipmentType,
  PlannedExercise,
  ProgressiveOverloadRecommendation,
  ProgressionStrategy,
  TrainingPhase,
  UserProfile,
  WorkoutPlan,
  WorkoutSession
} from '../../types';
import { db } from '../../storage/db';
import { LineChart, BarChart } from '../common/Charts';
import {
  extractExerciseHistory,
  generateProgressionRecommendation,
  OverloadAnalyticsConfig
} from '../../utils/progressionEngine';
import { calculateEpley1RM } from '../../utils/calculations';

interface ProgressionViewProps {
  profile: UserProfile;
  initialPlanId?: string;
}

export const ProgressionView: React.FC<ProgressionViewProps> = ({
  profile,
  initialPlanId
}) => {
  const [plans, setPlans] = useState<WorkoutPlan[]>([]);
  const [selectedPlanId, setSelectedPlanId] = useState<string>('all');
  const [sessions, setSessions] = useState<WorkoutSession[]>([]);
  const [exerciseList, setExerciseList] = useState<string[]>([]);
  const [selectedExercise, setSelectedExercise] = useState<string>('');
  const [timeRange, setTimeRange] = useState<'30d' | '90d' | 'all'>('90d');

  // View Mode: 'deep_dive' (exercise chart & recommendation) vs 'plan_matrix' (all exercises in plan)
  const [viewMode, setViewMode] = useState<'deep_dive' | 'plan_matrix'>('deep_dive');

  // Recommendation state
  const [currentRec, setCurrentRec] = useState<ProgressiveOverloadRecommendation | null>(null);
  const [savedRecommendations, setSavedRecommendations] = useState<
    ProgressiveOverloadRecommendation[]
  >([]);

  // Plan-specific overload adjustments modal/drawer
  const [isAdjustingPlanRules, setIsAdjustingPlanRules] = useState<boolean>(false);
  const [ruleRepRange, setRuleRepRange] = useState<string>('8-12');
  const [ruleSets, setRuleSets] = useState<number>(3);
  const [ruleRir, setRuleRir] = useState<number>(2);
  const [ruleStrategy, setRuleStrategy] = useState<ProgressionStrategy>('double_progression');
  const [ruleIncrement, setRuleIncrement] = useState<number>(2.5);
  const [rulePhase, setRulePhase] = useState<TrainingPhase>(profile.trainingPhase || 'hypertrophy');
  const [rulesSavedNotice, setRulesSavedNotice] = useState<boolean>(false);
  const [applyToAllExercisesInPlan, setApplyToAllExercisesInPlan] = useState<boolean>(false);

  // AI Plan Overload Tuning State
  const [isAiTuningModalOpen, setIsAiTuningModalOpen] = useState<boolean>(false);
  const [aiTuningLoading, setAiTuningLoading] = useState<boolean>(false);
  const [aiTuningData, setAiTuningData] = useState<any>(null);
  const [aiTuningError, setAiTuningError] = useState<string | null>(null);

  // Inline matrix exercise edit state
  const [editingMatrixExercise, setEditingMatrixExercise] = useState<string | null>(null);

  // User modify decision modal
  const [isModifyingDecision, setIsModifyingDecision] = useState<boolean>(false);
  const [modifiedWeight, setModifiedWeight] = useState<number>(0);
  const [modifiedReps, setModifiedReps] = useState<string>('');
  const [postureModalExercise, setPostureModalExercise] = useState<string | null>(null);

  // Load plans & initial state
  useEffect(() => {
    const loadedPlans = db.getPlans();
    setPlans(loadedPlans);

    const activeId = initialPlanId || db.getActivePlanId() || (loadedPlans.length > 0 ? loadedPlans[0].id : 'all');
    setSelectedPlanId(activeId);
    if (initialPlanId) {
      setIsAdjustingPlanRules(true);
    }

    const all = db.getSessions();
    setSessions(all);
    setSavedRecommendations(db.getRecommendations());
  }, [initialPlanId]);

  // Update exercise list whenever selectedPlanId or plans change
  useEffect(() => {
    const all = sessions;
    const names = new Set<string>();

    if (selectedPlanId && selectedPlanId !== 'all') {
      const plan = plans.find((p) => p.id === selectedPlanId);
      if (plan) {
        plan.days.forEach((d) => {
          d.exercises.forEach((e) => {
            if (e.name) names.add(e.name.trim());
          });
        });
      }
    } else {
      // All exercises across sessions and plans
      all.filter((s) => s.status === 'completed').forEach((s) => {
        s.exercises.forEach((e) => {
          if (e.name) names.add(e.name.trim());
        });
      });
      plans.forEach((p) => {
        p.days.forEach((d) => {
          d.exercises.forEach((e) => {
            if (e.name) names.add(e.name.trim());
          });
        });
      });
    }

    const sortedNames = Array.from(names).sort();
    setExerciseList(sortedNames);

    if (sortedNames.length > 0) {
      if (!selectedExercise || !sortedNames.includes(selectedExercise)) {
        setSelectedExercise(sortedNames[0]);
      }
    } else {
      setSelectedExercise('');
    }
  }, [selectedPlanId, plans, sessions]);

  // Get currently selected plan
  const selectedPlan = plans.find((p) => p.id === selectedPlanId);

  // Find the PlannedExercise definition in selectedPlan if available
  const getPlannedExerciseInPlan = (exName: string): PlannedExercise | null => {
    if (!selectedPlan) return null;
    const norm = exName.trim().toLowerCase();
    for (const d of selectedPlan.days) {
      const found = d.exercises.find((e) => e.name.trim().toLowerCase() === norm);
      if (found) return found;
    }
    return null;
  };

  const currentPlannedEx = selectedExercise ? getPlannedExerciseInPlan(selectedExercise) : null;

  // Sync rule state whenever exercise or plan changes
  useEffect(() => {
    if (currentPlannedEx) {
      setRuleRepRange(currentPlannedEx.repRange || '8-12');
      setRuleSets(currentPlannedEx.workingSets || 3);
      setRuleRir(currentPlannedEx.targetRir ?? 2);
      setRuleStrategy(currentPlannedEx.progressionStrategy || selectedPlan?.defaultStrategy || 'double_progression');
      setRuleIncrement(currentPlannedEx.customIncrement || (currentPlannedEx.equipment === 'dumbbell' ? profile.minDumbbellIncrement : profile.minBarbellIncrement) || 2.5);
      setRulePhase(selectedPlan?.progressionPhase || profile.trainingPhase || 'hypertrophy');
    } else {
      setRuleRepRange('8-12');
      setRuleSets(3);
      setRuleRir(2);
      setRuleStrategy('double_progression');
      setRuleIncrement(2.5);
      setRulePhase(profile.trainingPhase || 'hypertrophy');
    }
  }, [selectedExercise, selectedPlanId, currentPlannedEx]);

  // Compute recommendation based on plan configurations
  useEffect(() => {
    if (!selectedExercise) {
      setCurrentRec(null);
      return;
    }

    const history = extractExerciseHistory(sessions, selectedExercise);
    const equipment: EquipmentType = currentPlannedEx?.equipment || history?.equipment || 'barbell';

    const planConfig: OverloadAnalyticsConfig = {
      planId: selectedPlan?.id,
      planName: selectedPlan?.name || 'All Plans',
      prescribedRepRange: ruleRepRange,
      prescribedSets: ruleSets,
      prescribedRir: ruleRir,
      progressionStrategy: ruleStrategy,
      customIncrement: ruleIncrement,
      trainingPhase: rulePhase
    };

    const rec = generateProgressionRecommendation(
      history,
      profile,
      selectedExercise,
      equipment,
      ruleRepRange,
      ruleRir,
      planConfig
    );

    setCurrentRec(rec);
    setModifiedWeight(rec.recommendedWeight);
    setModifiedReps(rec.recommendedRepTarget);
  }, [
    selectedExercise,
    sessions,
    profile,
    selectedPlan,
    ruleRepRange,
    ruleSets,
    ruleRir,
    ruleStrategy,
    ruleIncrement,
    rulePhase
  ]);

  // Save adjusted overload rules directly to the Workout Plan
  const handleSaveRulesToPlan = () => {
    if (!selectedPlan) return;

    let updatedDays;
    if (applyToAllExercisesInPlan) {
      // Bulk update all exercises in this plan
      updatedDays = selectedPlan.days.map((d) => ({
        ...d,
        exercises: d.exercises.map((e) => ({
          ...e,
          repRange: ruleRepRange,
          workingSets: ruleSets,
          targetRir: ruleRir,
          progressionStrategy: ruleStrategy,
          customIncrement: ruleIncrement
        }))
      }));
    } else {
      if (!selectedExercise) return;
      const norm = selectedExercise.trim().toLowerCase();
      updatedDays = selectedPlan.days.map((d) => ({
        ...d,
        exercises: d.exercises.map((e) => {
          if (e.name.trim().toLowerCase() === norm) {
            return {
              ...e,
              repRange: ruleRepRange,
              workingSets: ruleSets,
              targetRir: ruleRir,
              progressionStrategy: ruleStrategy,
              customIncrement: ruleIncrement
            };
          }
          return e;
        })
      }));
    }

    const updatedPlan: WorkoutPlan = {
      ...selectedPlan,
      defaultStrategy: ruleStrategy,
      progressionPhase: rulePhase,
      days: updatedDays,
      updatedAt: new Date().toISOString()
    };

    const updatedPlans = plans.map((p) => (p.id === updatedPlan.id ? updatedPlan : p));
    db.savePlans(updatedPlans);
    setPlans(updatedPlans);
    setRulesSavedNotice(true);
    setTimeout(() => setRulesSavedNotice(false), 2500);
  };

  // AI Progressive Overload Plan Optimizer
  const handleRunAiPlanOverloadTuning = async () => {
    if (!selectedPlan || selectedPlanId === 'all') return;
    setIsAiTuningModalOpen(true);
    setAiTuningLoading(true);
    setAiTuningError(null);
    setAiTuningData(null);

    try {
      const res = await fetch('/api/ai-plan-overload-tuning', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          plan: selectedPlan,
          profile,
          historySummary: `Completed sessions logged: ${sessions.length}. Active unit: ${profile.preferredUnit}. Primary goal: ${profile.primaryGoal}.`
        })
      });
      const data = await res.json();
      if (data.success && data.calibrations) {
        setAiTuningData(data.calibrations);
      } else {
        setAiTuningError(data.error || 'Failed to calibrate plan overload rules.');
      }
    } catch (err: any) {
      setAiTuningError(err?.message || 'Network error requesting AI overload analysis.');
    } finally {
      setAiTuningLoading(false);
    }
  };

  const handleApplyAiCalibrations = () => {
    if (!selectedPlan || !aiTuningData) return;
    const calibrations = aiTuningData.exerciseCalibrations || [];
    const calibMap = new Map<string, any>();
    calibrations.forEach((c: any) => {
      if (c.exerciseName) {
        calibMap.set(c.exerciseName.toLowerCase().trim(), c);
      }
    });

    const updatedDays = selectedPlan.days.map((d) => ({
      ...d,
      exercises: d.exercises.map((e) => {
        const cal = calibMap.get(e.name.toLowerCase().trim());
        if (cal) {
          return {
            ...e,
            repRange: cal.recommendedRepRange || e.repRange,
            workingSets: cal.recommendedWorkingSets || e.workingSets,
            targetRir: cal.recommendedRir ?? e.targetRir,
            progressionStrategy: cal.recommendedStrategy || e.progressionStrategy || 'double_progression',
            customIncrement: cal.recommendedIncrement || e.customIncrement
          };
        }
        return e;
      })
    }));

    const updatedPlan: WorkoutPlan = {
      ...selectedPlan,
      progressionPhase: aiTuningData.recommendedPhase || selectedPlan.progressionPhase || 'hypertrophy',
      days: updatedDays,
      updatedAt: new Date().toISOString()
    };

    const updatedPlans = plans.map((p) => (p.id === updatedPlan.id ? updatedPlan : p));
    db.savePlans(updatedPlans);
    setPlans(updatedPlans);
    setIsAiTuningModalOpen(false);
    setRulesSavedNotice(true);
    setTimeout(() => setRulesSavedNotice(false), 3000);
  };

  const handleUpdateSingleMatrixExercise = (
    exName: string,
    updates: Partial<PlannedExercise>
  ) => {
    if (!selectedPlan) return;
    const norm = exName.trim().toLowerCase();
    const updatedDays = selectedPlan.days.map((d) => ({
      ...d,
      exercises: d.exercises.map((e) => {
        if (e.name.trim().toLowerCase() === norm) {
          return { ...e, ...updates };
        }
        return e;
      })
    }));

    const updatedPlan: WorkoutPlan = {
      ...selectedPlan,
      days: updatedDays,
      updatedAt: new Date().toISOString()
    };

    const updatedPlans = plans.map((p) => (p.id === updatedPlan.id ? updatedPlan : p));
    db.savePlans(updatedPlans);
    setPlans(updatedPlans);
    setEditingMatrixExercise(null);
  };

  const history = selectedExercise ? extractExerciseHistory(sessions, selectedExercise) : null;

  // Filter history based on timeRange
  const now = new Date();
  const filteredSessions = (history?.sessions || []).filter((s) => {
    if (timeRange === 'all') return true;
    const sessionDate = new Date(s.date);
    const diffDays = (now.getTime() - sessionDate.getTime()) / (1000 * 3600 * 24);
    if (timeRange === '30d') return diffDays <= 30;
    if (timeRange === '90d') return diffDays <= 90;
    return true;
  });

  // Prepare chart data
  const loadChartData = filteredSessions.map((s) => ({
    date: s.date,
    value: s.topWeight,
    label: `${s.topWeight} ${profile.preferredUnit}`
  }));

  const repChartData = filteredSessions.map((s) => {
    const totalReps = s.workingSets.reduce((acc, curr) => acc + curr.reps, 0);
    return {
      date: s.date,
      value: totalReps,
      label: `${totalReps} reps`
    };
  });

  const volumeChartData = filteredSessions.map((s) => ({
    label: s.date.slice(5),
    value: s.totalVolume
  }));

  let personalRecordWeight = 0;
  let bestEstimated1RM = 0;
  let maxVolumeSession = 0;

  if (history) {
    history.sessions.forEach((s) => {
      if (s.topWeight > personalRecordWeight) personalRecordWeight = s.topWeight;
      if (s.estimated1RM > bestEstimated1RM) bestEstimated1RM = s.estimated1RM;
      if (s.totalVolume > maxVolumeSession) maxVolumeSession = s.totalVolume;
    });
  }

  const handleAcceptRec = () => {
    if (!currentRec) return;
    const updated = {
      ...currentRec,
      userAction: 'accepted' as const,
      chosenWeight: currentRec.recommendedWeight,
      chosenRepTarget: currentRec.recommendedRepTarget
    };
    saveRecDecision(updated);
  };

  const handleModifyRec = () => {
    if (!currentRec) return;
    const updated = {
      ...currentRec,
      userAction: 'modified' as const,
      chosenWeight: Number(modifiedWeight),
      chosenRepTarget: modifiedReps
    };
    saveRecDecision(updated);
    setIsModifyingDecision(false);
  };

  const handleRejectRec = () => {
    if (!currentRec) return;
    const updated = {
      ...currentRec,
      userAction: 'rejected' as const,
      chosenWeight: currentRec.currentWeight,
      chosenRepTarget: currentRec.currentRepsSummary
    };
    saveRecDecision(updated);
  };

  const saveRecDecision = (rec: ProgressiveOverloadRecommendation) => {
    setCurrentRec(rec);
    const existing = db.getRecommendations().filter((r) => r.id !== rec.id);
    const newList = [rec, ...existing];
    db.saveRecommendations(newList);
    setSavedRecommendations(newList);
  };

  const latestSession = history && history.sessions.length > 0 ? history.sessions[history.sessions.length - 1] : null;
  const prevSession = history && history.sessions.length > 1 ? history.sessions[history.sessions.length - 2] : null;

  return (
    <div className="space-y-6 max-w-5xl mx-auto pb-16">
      {/* TOP HEADER COMMAND CARD */}
      <div className="reshape-card p-6 lg:p-7 overflow-hidden">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-5 border-b border-line">
          <div>
            <div className="flex items-center gap-2 text-accent text-xs font-mono font-bold tracking-wide mb-1.5">
              <TrendingUp className="w-4 h-4" />
              <span>Double Progression Engine &middot; Real-Time</span>
            </div>
            <h1 className="text-2xl lg:text-3xl font-nrc font-bold text-white tracking-tight">
              Progressive Overload Analytics
            </h1>
            <p className="text-xs text-zinc-400 mt-1 font-sans">
              Calibrated progression rules, rep ceilings, and automated load increments tailored to your active routines.
            </p>
          </div>

          {/* Toggle between Deep Dive and Plan Matrix */}
          <div className="flex items-center gap-1 p-1 bg-black/60 border border-white/10 rounded-xl self-start md:self-auto text-xs">
            <button
              onClick={() => setViewMode('deep_dive')}
              className={`px-3.5 py-2 rounded-lg font-bold transition-all ${
                viewMode === 'deep_dive'
                  ? 'bg-white/10 text-accent shadow-sm'
                  : 'text-zinc-400 hover:text-white'
              }`}
            >
              Single Exercise Analysis
            </button>
            <button
              onClick={() => setViewMode('plan_matrix')}
              className={`px-3.5 py-2 rounded-lg font-bold transition-all flex items-center gap-1.5 ${
                viewMode === 'plan_matrix'
                  ? 'bg-white/10 text-accent shadow-sm'
                  : 'text-zinc-400 hover:text-white'
              }`}
            >
              <Layers className="w-3.5 h-3.5" />
              <span>Plan Overload Matrix</span>
            </button>
          </div>
        </div>

        {/* WORKOUT PLAN SELECTOR */}
        <div className="mt-5 grid grid-cols-1 sm:grid-cols-12 gap-3 items-end">
          <div className="sm:col-span-6 md:col-span-5">
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-[11px] font-mono text-zinc-400 tracking-wide font-bold">
                Source Workout Plan
              </label>
              {selectedPlan?.isUploaded && (
                <span className="text-[11px] font-mono text-amber-400 font-bold tracking-wide">
                  &bull; UPLOADED PLAN
                </span>
              )}
            </div>
            <select
              value={selectedPlanId}
              onChange={(e) => setSelectedPlanId(e.target.value)}
              className="w-full px-3.5 py-2.5 bg-surface-2 border border-white/10 rounded-xl text-white text-xs font-bold focus:outline-none focus:border-accent transition-colors"
            >
              <option value="all">All Available Exercises (Global)</option>
              {plans.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} {p.isActive ? '(Active)' : ''}
                </option>
              ))}
            </select>
          </div>

          {viewMode === 'deep_dive' && (
            <div className="sm:col-span-6 md:col-span-4">
              <label className="block text-[11px] font-mono text-zinc-400 tracking-wide font-bold mb-1.5">
                Exercise in this Plan
              </label>
              <select
                value={selectedExercise}
                onChange={(e) => setSelectedExercise(e.target.value)}
                className="w-full px-3.5 py-2.5 bg-surface-2 border border-white/10 rounded-xl text-white text-xs font-semibold focus:outline-none focus:border-accent transition-colors"
              >
                {exerciseList.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div className="sm:col-span-12 md:col-span-3 flex flex-wrap items-center justify-end gap-2">
            {selectedExercise && (
              <button
                onClick={() => setPostureModalExercise(selectedExercise)}
                className="min-h-[44px] py-2.5 px-3 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 transition-all border bg-info/10 hover:bg-info/20 border-info/30 text-info"
                title="Preview posture, joint angles, and biomechanical checkpoints for this exercise"
              >
                <Eye className="w-3.5 h-3.5 text-info" />
                <span>Form &amp; Biomechanics</span>
              </button>
            )}

            {selectedPlan && selectedPlanId !== 'all' && (
              <button
                onClick={handleRunAiPlanOverloadTuning}
                className="min-h-[44px] py-2.5 px-3 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 transition-all border bg-accent/10 hover:bg-accent/20 border-accent/30 text-accent"
                title="Use Gemini AI to analyze this uploaded plan and optimize overload targets"
              >
                <Sparkles className="w-3.5 h-3.5 text-accent" />
                <span>AI Optimizer</span>
              </button>
            )}

            <button
              onClick={() => setIsAdjustingPlanRules(!isAdjustingPlanRules)}
              className={`min-h-[44px] py-2.5 px-3.5 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 transition-all border ${
                isAdjustingPlanRules
                  ? 'bg-accent/15 border-accent text-accent'
                  : 'bg-white/[0.04] border-white/10 hover:border-white/20 text-zinc-300'
              }`}
            >
              <Sliders className="w-3.5 h-3.5 text-accent" />
              <span>{isAdjustingPlanRules ? 'Close Rules' : 'Adjust Rules'}</span>
            </button>
          </div>
        </div>
      </div>

      {/* ADJUST OVERLOAD RULES FOR THIS WORKOUT PLAN CARD */}
      {isAdjustingPlanRules && (
        <div className="bg-surface border border-accent/40 rounded-2xl p-5 lg:p-6 shadow-2xl space-y-4 animate-in fade-in duration-200">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-3 border-b border-line">
            <div>
              <div className="flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-accent" />
                <h3 className="font-extrabold text-white text-base">
                  Adjust Overload Analytics Configuration
                </h3>
              </div>
              <p className="text-xs text-zinc-400 mt-0.5">
                Modifying parameters for{' '}
                <strong className="text-white">
                  {selectedExercise || 'selected plan exercises'}
                </strong>{' '}
                in <strong className="text-accent">{selectedPlan?.name || 'routine'}</strong>.
              </p>
            </div>

            {rulesSavedNotice && (
              <span className="text-xs font-mono text-accent font-bold flex items-center gap-1 animate-pulse">
                <Check className="w-3.5 h-3.5" />
                <span>Saved to Plan!</span>
              </span>
            )}
          </div>

          {/* Overload Strategy Presets */}
          <div className="flex flex-wrap items-center gap-1.5 pb-2">
            <span className="text-[11px] font-mono text-zinc-400 font-bold mr-1">
              Presets:
            </span>
            <button
              type="button"
              onClick={() => {
                setRuleRepRange('8-12');
                setRuleSets(3);
                setRuleRir(2);
                setRuleStrategy('double_progression');
                setRuleIncrement(2.5);
                setRulePhase('hypertrophy');
              }}
              className="px-2.5 py-1.5 bg-white/[0.05] hover:bg-white/[0.1] border border-white/10 rounded-lg text-xs font-medium text-zinc-200 transition-colors"
            >
              Hypertrophy (8-12 reps, +2.5kg)
            </button>
            <button
              type="button"
              onClick={() => {
                setRuleRepRange('5-8');
                setRuleSets(4);
                setRuleRir(2);
                setRuleStrategy('double_progression');
                setRuleIncrement(2.5);
                setRulePhase('strength');
              }}
              className="px-2.5 py-1.5 bg-white/[0.05] hover:bg-white/[0.1] border border-white/10 rounded-lg text-xs font-medium text-zinc-200 transition-colors"
            >
              Strength (5-8 reps, +2.5kg)
            </button>
            <button
              type="button"
              onClick={() => {
                setRuleRepRange('10-15');
                setRuleSets(3);
                setRuleRir(1);
                setRuleStrategy('double_progression');
                setRuleIncrement(1.25);
                setRulePhase('hypertrophy');
              }}
              className="px-2.5 py-1.5 bg-white/[0.05] hover:bg-white/[0.1] border border-white/10 rounded-lg text-xs font-medium text-zinc-200 transition-colors"
            >
              High-Rep Pump (10-15 reps, +1.25kg)
            </button>
            <button
              type="button"
              onClick={() => {
                setRuleRepRange('8-10');
                setRuleSets(2);
                setRuleRir(3);
                setRuleStrategy('linear_load');
                setRuleIncrement(2.5);
                setRulePhase('deload');
              }}
              className="px-2.5 py-1.5 bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/30 rounded-lg text-xs font-medium text-amber-300 transition-colors"
            >
              Deload Phase (-25% load)
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4 text-xs">
            {/* Prescribed Rep Range */}
            <div>
              <label className="block text-zinc-400 mb-1.5 font-mono text-[11px] font-bold">
                Target Rep Range
              </label>
              <input
                type="text"
                value={ruleRepRange}
                onChange={(e) => setRuleRepRange(e.target.value)}
                placeholder="e.g. 8-12, 6-8, 5x5, 10-15"
                className="w-full px-3 py-2 bg-surface-2 border border-white/10 rounded-xl text-white font-mono font-bold focus:outline-none focus:border-accent"
              />
              <div className="flex gap-1 mt-1.5">
                {['6-8', '8-12', '10-15', '5'].map((r) => (
                  <button
                    key={r}
                    type="button"
                    onClick={() => setRuleRepRange(r)}
                    className="px-2 py-0.5 bg-white/[0.06] hover:bg-white/[0.12] text-zinc-300 rounded text-[11px] font-mono"
                  >
                    {r}
                  </button>
                ))}
              </div>
            </div>

            {/* Target Working Sets */}
            <div>
              <label className="block text-zinc-400 mb-1.5 font-mono text-[11px] font-bold">
                Prescribed Working Sets
              </label>
              <input
                type="number"
                min="1"
                max="10"
                value={ruleSets}
                onChange={(e) => setRuleSets(parseInt(e.target.value, 10) || 3)}
                className="w-full px-3 py-2 bg-surface-2 border border-white/10 rounded-xl text-white font-mono font-bold focus:outline-none focus:border-accent"
              />
            </div>

            {/* Target RIR */}
            <div>
              <label className="block text-zinc-400 mb-1.5 font-mono text-[11px] font-bold">
                Target RIR (Effort Level)
              </label>
              <select
                value={ruleRir}
                onChange={(e) => setRuleRir(parseInt(e.target.value, 10))}
                className="w-full px-3 py-2 bg-surface-2 border border-white/10 rounded-xl text-white focus:outline-none focus:border-accent"
              >
                <option value="0">0 RIR (Rep Out to Failure)</option>
                <option value="1">1 RIR (1 Rep in Reserve)</option>
                <option value="2">2 RIR (Standard Hypertrophy)</option>
                <option value="3">3 RIR (Conservative / Technical)</option>
              </select>
            </div>

            {/* Progression Strategy */}
            <div>
              <label className="block text-zinc-400 mb-1.5 font-mono text-[11px] font-bold">
                Progression Strategy
              </label>
              <select
                value={ruleStrategy}
                onChange={(e) => setRuleStrategy(e.target.value as ProgressionStrategy)}
                className="w-full px-3 py-2 bg-surface-2 border border-white/10 rounded-xl text-white focus:outline-none focus:border-accent"
              >
                <option value="double_progression">Standard Double Progression (All Sets Top of Range)</option>
                <option value="top_set_only">Top-Set Progression (Lead Set Hits Top)</option>
                <option value="consecutive_sessions">Dual-Session Consolidation (2 Sessions at Top)</option>
                <option value="linear_load">Linear Micro-Load (Weekly Increment)</option>
                <option value="rep_accumulation">Rep Accumulation Focus</option>
              </select>
            </div>

            {/* Custom Load Increment */}
            <div>
              <label className="block text-zinc-400 mb-1.5 font-mono text-[11px] font-bold">
                Load Increase Jump ({profile.preferredUnit})
              </label>
              <input
                type="number"
                step="0.5"
                value={ruleIncrement}
                onChange={(e) => setRuleIncrement(parseFloat(e.target.value) || 2.5)}
                className="w-full px-3 py-2 bg-surface-2 border border-white/10 rounded-xl text-white font-mono font-bold focus:outline-none focus:border-accent"
              />
              <div className="flex gap-1 mt-1.5">
                {[1.25, 2.0, 2.5, 5.0].map((inc) => (
                  <button
                    key={inc}
                    type="button"
                    onClick={() => setRuleIncrement(inc)}
                    className="px-2 py-0.5 bg-white/[0.06] hover:bg-white/[0.12] text-zinc-300 rounded text-[11px] font-mono"
                  >
                    +{inc}
                  </button>
                ))}
              </div>
            </div>

            {/* Training Phase */}
            <div>
              <label className="block text-zinc-400 mb-1.5 font-mono text-[11px] font-bold">
                Plan Training Phase
              </label>
              <select
                value={rulePhase}
                onChange={(e) => setRulePhase(e.target.value as TrainingPhase)}
                className="w-full px-3 py-2 bg-surface-2 border border-white/10 rounded-xl text-white focus:outline-none focus:border-accent capitalize"
              >
                <option value="hypertrophy">Hypertrophy (Progressive Overload)</option>
                <option value="strength">Strength (Lower reps, Higher load)</option>
                <option value="adaptation">Adaptation (Conservative volume)</option>
                <option value="re_entry">Re-Entry (Recovery focused)</option>
                <option value="deload">Deload (-25% load dissipation)</option>
              </select>
            </div>
          </div>

          <div className="pt-3 border-t border-line flex flex-wrap items-center justify-between gap-3 text-xs">
            {selectedPlan && (
              <label className="flex items-center gap-2 cursor-pointer text-zinc-200 font-semibold select-none bg-black/40 px-3 py-2 rounded-xl border border-line">
                <input
                  type="checkbox"
                  checked={applyToAllExercisesInPlan}
                  onChange={(e) => setApplyToAllExercisesInPlan(e.target.checked)}
                  className="w-4 h-4 rounded text-accent accent-accent cursor-pointer"
                />
                <span>
                  Apply this overload configuration to ALL {exerciseList.length} exercises in &quot;{selectedPlan.name}&quot;
                </span>
              </label>
            )}
            <div className="flex items-center gap-2 ml-auto">
              <button
                onClick={() => setIsAdjustingPlanRules(false)}
                className="min-h-[44px] px-3.5 py-2 bg-white/[0.06] hover:bg-white/[0.1] text-zinc-300 rounded-xl font-medium transition-colors"
              >
                Dismiss
              </button>
              {selectedPlan && (
                <button
                  onClick={handleSaveRulesToPlan}
                  className="min-h-[44px] px-5 py-2 bg-accent hover:bg-accent-hover text-accent-ink font-extrabold rounded-xl shadow-lg transition-transform active:scale-[0.98]"
                >
                  {applyToAllExercisesInPlan
                    ? `Save to Entire ${selectedPlan.name}`
                    : `Save for ${selectedExercise || 'Exercise'}`}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* VIEW MODE 1: PLAN OVERLOAD MATRIX (ALL EXERCISES IN PLAN AT A GLANCE) */}
      {/* ========================================================================= */}
      {viewMode === 'plan_matrix' && (
        <div className="bg-surface border border-line rounded-2xl p-5 lg:p-6 shadow-2xl space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-3 border-b border-line">
            <div>
              <h3 className="font-extrabold text-white text-base tracking-tight">
                Overload Status Matrix &middot; {selectedPlan?.name || 'All Plans'}
              </h3>
              <p className="text-xs text-zinc-400 mt-0.5">
                Overview of progressive overload compliance across every exercise prescribed in this plan.
              </p>
            </div>
          </div>

          {exerciseList.length === 0 ? (
            <div className="py-12 text-center text-zinc-500 text-xs">
              No exercises found for this plan. Select an uploaded plan or add exercises in Plans &amp; Uploads.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs font-mono">
                <thead>
                  <tr className="border-b border-line text-zinc-400 text-[11px] tracking-wide">
                    <th className="py-3 px-3 font-bold">Exercise</th>
                    <th className="py-3 px-3 font-bold">Prescribed Target</th>
                    <th className="py-3 px-3 font-bold">Latest Working Load</th>
                    <th className="py-3 px-3 font-bold">Overload Status</th>
                    <th className="py-3 px-3 font-bold">Next Prescription</th>
                    <th className="py-3 px-2 text-right"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/[0.04] text-zinc-300">
                  {exerciseList.map((exName) => {
                    const exHistory = extractExerciseHistory(sessions, exName);
                    const pEx = getPlannedExerciseInPlan(exName);
                    const pConfig: OverloadAnalyticsConfig = {
                      planId: selectedPlan?.id,
                      planName: selectedPlan?.name,
                      prescribedRepRange: pEx?.repRange || '8-12',
                      prescribedSets: pEx?.workingSets || 3,
                      prescribedRir: pEx?.targetRir ?? 2,
                      progressionStrategy: pEx?.progressionStrategy || selectedPlan?.defaultStrategy || 'double_progression',
                      customIncrement: pEx?.customIncrement || 2.5,
                      trainingPhase: selectedPlan?.progressionPhase || profile.trainingPhase
                    };

                    const rec = generateProgressionRecommendation(
                      exHistory,
                      profile,
                      exName,
                      pEx?.equipment || 'barbell',
                      pEx?.repRange || '8-12',
                      pEx?.targetRir ?? 2,
                      pConfig
                    );

                    const isReadyToAdvance = rec.ruleApplied === 'A_TOP_REPS_ACHIEVED';
                    const isDecline = rec.ruleApplied === 'C_REPS_DECLINED' || rec.ruleApplied === 'D_MULTI_SESSION_DECLINE';

                    return (
                      <tr key={exName} className="hover:bg-white/[0.02] transition-colors">
                        <td className="py-3.5 px-3 font-bold text-white font-sans">
                          {exName}
                        </td>
                        <td className="py-3.5 px-3 text-zinc-400">
                          {pEx ? `${pEx.workingSets} sets × ${pEx.repRange} reps` : '8-12 reps'}
                        </td>
                        <td className="py-3.5 px-3">
                          {rec.currentWeight > 0 ? (
                            <span className="font-bold text-zinc-100">
                              {rec.currentWeight} {profile.preferredUnit}
                            </span>
                          ) : (
                            <span className="text-zinc-600">—</span>
                          )}
                        </td>
                        <td className="py-3.5 px-3">
                          <span
                            className={`font-mono text-[11px] font-bold tracking-wide ${
                              isReadyToAdvance
                                ? 'text-accent'
                                : isDecline
                                ? 'text-amber-400'
                                : rec.flags.isProvisional
                                ? 'text-zinc-500'
                                : 'text-info'
                            }`}
                          >
                            &bull;{' '}
                            {isReadyToAdvance
                              ? 'Ready to Advance'
                              : isDecline
                              ? 'Repeat Load'
                              : rec.flags.isProvisional
                              ? 'Baseline Needed'
                              : 'Accumulating Reps'}
                          </span>
                        </td>
                        <td className="py-3.5 px-3 font-bold text-accent">
                          {rec.recommendedWeight} {profile.preferredUnit} ({rec.recommendedRepTarget})
                        </td>
                        <td className="py-3.5 px-2 text-right">
                          <div className="flex items-center justify-end gap-1.5">
                            <button
                              onClick={() => {
                                setSelectedExercise(exName);
                                setIsAdjustingPlanRules(true);
                              }}
                              className="px-2.5 py-1.5 bg-white/[0.05] hover:bg-white/[0.1] text-accent border border-white/10 text-[11px] font-bold rounded-lg transition-colors flex items-center gap-1"
                              title={`Adjust overload rules for ${exName}`}
                            >
                              <Sliders className="w-3 h-3" />
                              <span>Tune</span>
                            </button>
                            <button
                              onClick={() => {
                                setSelectedExercise(exName);
                                setViewMode('deep_dive');
                              }}
                              className="px-3 py-1.5 bg-white/[0.08] hover:bg-white/[0.14] text-white text-xs font-semibold rounded-lg transition-colors"
                            >
                              Analyze &rarr;
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ========================================================================= */}
      {/* VIEW MODE 2: SINGLE EXERCISE DEEP DIVE (ANALYTICS & RECOMMENDATION) */}
      {/* ========================================================================= */}
      {viewMode === 'deep_dive' && (
        <>
          {/* NEXT-SESSION RECOMMENDATION CARD */}
          {currentRec && (
            <div className="bg-surface border border-accent/40 rounded-2xl p-5 lg:p-7 shadow-2xl relative overflow-hidden">

              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-line">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-accent animate-pulse" />
                    <span className="text-xs font-mono font-bold text-accent tracking-wide">
                      Next Session Prescription &middot; {currentRec.ruleTitle}
                    </span>
                  </div>
                  <h2 className="text-xl lg:text-2xl font-extrabold text-white mt-1.5 tracking-tight">
                    {currentRec.exerciseName}
                  </h2>
                  <div className="text-[11px] font-mono text-zinc-400 mt-1 flex flex-wrap items-center gap-2">
                    <span>Plan: <strong className="text-white">{selectedPlan?.name || 'All Plans'}</strong></span>
                    <span>&middot;</span>
                    <span>Target: <strong className="text-white">{ruleRepRange} reps</strong></span>
                    <span>&middot;</span>
                    <span>Strategy: <strong className="text-white capitalize">{ruleStrategy.replace('_', ' ')}</strong></span>
                  </div>
                </div>

                {/* Target Weight & Rep Highlight */}
                <div className="flex items-center gap-5 bg-black/60 border border-white/10 px-5 py-3 rounded-2xl">
                  <div>
                    <span className="text-[11px] font-mono text-zinc-400 block tracking-wide font-bold">Prescribed Load</span>
                    <span className="text-2xl font-mono font-bold text-accent tracking-tight">
                      {currentRec.recommendedWeight} <span className="text-xs text-zinc-400 font-sans font-normal">{profile.preferredUnit}</span>
                    </span>
                  </div>
                  <div className="h-10 w-px bg-white/10" />
                  <div>
                    <span className="text-[11px] font-mono text-zinc-400 block tracking-wide font-bold">Target Reps</span>
                    <span className="text-base font-mono font-bold text-white">
                      {currentRec.recommendedRepTarget}
                    </span>
                  </div>
                </div>
              </div>

              {/* Explanation Text */}
              <div className="py-4 text-xs text-zinc-300 leading-relaxed">
                <p className="bg-black/40 p-4 rounded-xl border border-line font-medium leading-relaxed">
                  {currentRec.explanation}
                </p>
              </div>

              {/* Warnings & Recovery Flags */}
              {currentRec.flags.recoveryAlert && (
                <div className="p-3.5 bg-amber-500/10 border border-amber-500/30 rounded-xl flex items-center gap-2.5 text-xs text-amber-300 mb-4">
                  <ShieldAlert className="w-4 h-4 text-amber-400 shrink-0" />
                  <span>
                    Recovery notice: Fatigue accumulation detected across multiple sessions in {selectedPlan?.name || 'routine'}. Prioritize sleep &amp; nutrition.
                  </span>
                </div>
              )}

              {/* User Decision Actions */}
              <div className="pt-3 border-t border-line flex flex-wrap items-center justify-between gap-3 text-xs">
                <div className="flex items-center gap-2 font-mono text-[11px]">
                  <span className="text-zinc-500 tracking-wide font-bold">Your Status:</span>
                  <span
                    className={`font-bold tracking-wide ${
                      currentRec.userAction === 'accepted'
                        ? 'text-accent'
                        : currentRec.userAction === 'rejected'
                        ? 'text-rose-400'
                        : currentRec.userAction === 'modified'
                        ? 'text-info'
                        : 'text-zinc-400'
                    }`}
                  >
                    &bull; {currentRec.userAction}
                    {currentRec.chosenWeight !== undefined && ` (${currentRec.chosenWeight} ${profile.preferredUnit})`}
                  </span>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    onClick={handleRejectRec}
                    className="min-h-[44px] px-3.5 py-2 bg-white/[0.04] hover:bg-rose-500/10 border border-white/10 hover:border-rose-500/30 text-zinc-400 hover:text-rose-400 rounded-xl font-bold transition-colors"
                  >
                    Reject Load
                  </button>
                  <button
                    onClick={() => setIsModifyingDecision(true)}
                    className="min-h-[44px] px-3.5 py-2 bg-white/[0.05] hover:bg-white/[0.1] border border-white/10 text-zinc-200 rounded-xl font-bold transition-colors flex items-center gap-1.5"
                  >
                    <Edit3 className="w-3.5 h-3.5 text-info" />
                    <span>Modify Target</span>
                  </button>
                  <button
                    onClick={handleAcceptRec}
                    className="min-h-[44px] touch-press px-5 py-2 bg-accent hover:bg-accent-hover text-accent-ink rounded-xl font-extrabold transition-all shadow-lg flex items-center gap-1.5 active:scale-[0.98]"
                  >
                    <CheckCircle2 className="w-4 h-4 stroke-[2.5]" />
                    <span>Accept Prescription</span>
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Modify Decision Modal */}
          {isModifyingDecision && (
            <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-4">
              <div className="bg-surface border border-line rounded-2xl p-6 max-w-sm w-full shadow-2xl space-y-4">
                <h3 className="font-extrabold text-white text-base">Modify Prescribed Load</h3>
                <p className="text-xs text-zinc-400">
                  Override the target weight and reps for your next session.
                </p>
                <div className="space-y-3 text-xs">
                  <div>
                    <label className="block text-zinc-400 mb-1 font-mono text-[11px] font-bold">
                      Target Weight ({profile.preferredUnit})
                    </label>
                    <input
                      type="number"
                      step="0.5"
                      value={modifiedWeight}
                      onChange={(e) => setModifiedWeight(parseFloat(e.target.value) || 0)}
                      className="w-full px-3.5 py-2 bg-surface-2 border border-white/10 rounded-xl text-white font-mono font-bold focus:outline-none focus:border-accent"
                    />
                  </div>
                  <div>
                    <label className="block text-zinc-400 mb-1 font-mono text-[11px] font-bold">
                      Target Reps
                    </label>
                    <input
                      type="text"
                      value={modifiedReps}
                      onChange={(e) => setModifiedReps(e.target.value)}
                      placeholder="e.g. 8-10 reps"
                      className="w-full px-3.5 py-2 bg-surface-2 border border-white/10 rounded-xl text-white font-mono focus:outline-none focus:border-accent"
                    />
                  </div>
                </div>
                <div className="flex items-center justify-end gap-2 pt-2">
                  <button
                    onClick={() => setIsModifyingDecision(false)}
                    className="min-h-[44px] px-3.5 py-2 bg-white/[0.06] hover:bg-white/[0.1] text-zinc-300 rounded-xl text-xs font-semibold"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleModifyRec}
                    className="min-h-[44px] px-5 py-2 bg-accent hover:bg-accent-hover text-accent-ink font-extrabold rounded-xl text-xs shadow-lg"
                  >
                    Save Target
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Performance Summary Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3">
            <div className="p-4 bg-surface border border-line rounded-2xl space-y-1">
              <div className="flex items-center justify-between text-zinc-400 text-[11px] font-mono font-bold">
                <span>ALL-TIME PR</span>
                <Award className="w-3.5 h-3.5 text-amber-400" />
              </div>
              <div className="text-2xl font-mono font-bold text-white">
                {personalRecordWeight} <span className="text-xs text-zinc-400 font-sans font-normal">{profile.preferredUnit}</span>
              </div>
              <div className="text-[11px] text-zinc-500 font-mono">Heaviest completed load</div>
            </div>

            <div className="p-4 bg-surface border border-line rounded-2xl space-y-1">
              <div className="flex items-center justify-between text-zinc-400 text-[11px] font-mono font-bold">
                <span>ESTIMATED 1RM</span>
                <Zap className="w-3.5 h-3.5 text-info" />
              </div>
              <div className="text-2xl font-mono font-bold text-info">
                {bestEstimated1RM} <span className="text-xs text-zinc-400 font-sans font-normal">{profile.preferredUnit}</span>
              </div>
              <div className="text-[11px] text-zinc-500 font-mono">Epley formula estimate</div>
            </div>

            <div className="p-4 bg-surface border border-line rounded-2xl space-y-1">
              <div className="flex items-center justify-between text-zinc-400 text-[11px] font-mono font-bold">
                <span>LAST SESSION</span>
                <History className="w-3.5 h-3.5 text-zinc-400" />
              </div>
              <div className="text-xl font-mono font-bold text-zinc-100">
                {latestSession ? `${latestSession.topWeight} ${profile.preferredUnit}` : 'None'}
              </div>
              <div className="text-[11px] text-zinc-500 font-mono">
                {latestSession ? `[${latestSession.workingSets.map((s) => s.reps).join(', ')}] reps` : 'No logs'}
              </div>
            </div>

            <div className="p-4 bg-surface border border-line rounded-2xl space-y-1">
              <div className="flex items-center justify-between text-zinc-400 text-[11px] font-mono font-bold">
                <span>PEAK VOLUME</span>
                <TrendingUp className="w-3.5 h-3.5 text-accent" />
              </div>
              <div className="text-2xl font-mono font-bold text-white">
                {maxVolumeSession.toLocaleString()} <span className="text-xs text-zinc-400 font-sans font-normal">{profile.preferredUnit}</span>
              </div>
              <div className="text-[11px] text-zinc-500 font-mono">Single-session working volume</div>
            </div>
          </div>

          {/* CHARTS: Load Progression, Repetitions & Volume */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            <div className="bg-surface border border-line rounded-2xl p-5 shadow-2xl">
              <LineChart
                data={loadChartData}
                title="Weight Load Progression"
                unit={profile.preferredUnit}
                accentColor="#CEFF00"
                emptyMessage={`No history recorded for ${selectedExercise}`}
              />
            </div>

            <div className="bg-surface border border-line rounded-2xl p-5 shadow-2xl">
              <LineChart
                data={repChartData}
                title="Total Working Repetitions"
                unit="reps"
                accentColor="#00E5FF"
                emptyMessage={`No repetition history recorded`}
              />
            </div>
          </div>

          <div className="bg-surface border border-line rounded-2xl p-5 shadow-2xl">
            <BarChart
              data={volumeChartData}
              title="Session Working-Set Volume (Weight × Reps)"
              unit={profile.preferredUnit}
            />
          </div>
        </>
      )}

      {/* AI PLAN OVERLOAD OPTIMIZER MODAL */}
      {isAiTuningModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-4 animate-in fade-in duration-200">
          <div className="bg-surface border border-line rounded-2xl p-6 max-w-2xl w-full shadow-2xl space-y-4 max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between pb-3 border-b border-line">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-xl bg-accent/10 border border-accent/30 flex items-center justify-center text-accent">
                  <Sparkles className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="font-extrabold text-base sm:text-lg text-white">
                    AI Overload Analytics Calibrator
                  </h3>
                  <p className="text-xs text-zinc-400">
                    Optimizing progression rules for &quot;{selectedPlan?.name}&quot;
                  </p>
                </div>
              </div>
              <button
                onClick={() => setIsAiTuningModalOpen(false)}
                className="text-zinc-400 hover:text-white p-1.5 rounded-lg text-xs"
              >
                &times; Close
              </button>
            </div>

            <div className="flex-1 overflow-y-auto space-y-4 pr-1">
              {aiTuningLoading && (
                <div className="py-12 flex flex-col items-center justify-center space-y-3 text-center">
                  <RotateCcw className="w-7 h-7 text-accent animate-spin" />
                  <div className="font-bold text-white text-sm">
                    Calibrating Optimal Overload Targets...
                  </div>
                  <p className="text-xs text-zinc-400 max-w-sm">
                    Analyzing biomechanics, muscle recruitment curves, compound vs accessory fatigue, and micro-increment jumps for this routine.
                  </p>
                </div>
              )}

              {aiTuningError && (
                <div className="p-4 bg-rose-500/10 border border-rose-500/30 rounded-xl text-xs text-rose-300 space-y-2">
                  <div className="flex items-center gap-2 font-bold text-rose-200">
                    <ShieldAlert className="w-4 h-4" />
                    <span>AI Calibration Notice</span>
                  </div>
                  <p>{aiTuningError}</p>
                  <button
                    onClick={handleRunAiPlanOverloadTuning}
                    className="min-h-[44px] px-4 py-2 bg-rose-600 hover:bg-rose-500 text-white font-bold rounded-xl mt-2"
                  >
                    Retry Analysis
                  </button>
                </div>
              )}

              {aiTuningData && (
                <div className="space-y-4 text-xs">
                  {/* Strategy Summary Card */}
                  <div className="p-4 bg-black/40 border border-line rounded-xl space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] font-mono text-zinc-400 font-bold tracking-wide">
                        Plan Progression Framework
                      </span>
                      <span className="font-mono font-bold text-accent text-[11px] tracking-wide">
                        &bull; Phase: {aiTuningData.recommendedPhase}
                      </span>
                    </div>
                    <p className="text-zinc-200 leading-relaxed font-sans text-xs">
                      {aiTuningData.planStrategySummary}
                    </p>
                  </div>

                  {/* Calibrated Movements */}
                  <div className="space-y-2">
                    <h4 className="font-mono text-zinc-400 tracking-wide text-[11px] font-bold">
                      Calibrated Movement Overload Rules ({aiTuningData.exerciseCalibrations?.length || 0})
                    </h4>
                    <div className="divide-y divide-white/[0.06] border border-line rounded-xl bg-black/40 overflow-hidden">
                      {(aiTuningData.exerciseCalibrations || []).map((cal: any, idx: number) => (
                        <div key={idx} className="p-3.5 space-y-1.5">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <span className="font-bold text-white text-sm">
                              {cal.exerciseName}
                            </span>
                            <div className="flex items-center gap-2 font-mono text-[11px]">
                              <span className="text-accent font-bold">
                                {cal.recommendedWorkingSets} sets &times; {cal.recommendedRepRange} reps
                              </span>
                              <span className="text-zinc-500">&middot;</span>
                              <span className="text-info font-bold">
                                +{cal.recommendedIncrement} {profile.preferredUnit} jump
                              </span>
                              <span className="text-zinc-500">&middot;</span>
                              <span className="text-zinc-400">
                                {cal.recommendedStrategy === 'double_progression' ? 'Double Overload' : cal.recommendedStrategy}
                              </span>
                            </div>
                          </div>
                          {cal.rationale && (
                            <p className="text-[11px] text-zinc-400 leading-normal">
                              &ldquo;{cal.rationale}&rdquo;
                            </p>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>

            <div className="pt-3 border-t border-line flex items-center justify-between gap-2">
              <button
                onClick={() => setIsAiTuningModalOpen(false)}
                className="min-h-[44px] px-4 py-2 bg-white/[0.06] hover:bg-white/[0.1] text-zinc-300 rounded-xl text-xs font-semibold"
              >
                Cancel
              </button>

              {aiTuningData && (
                <button
                  onClick={handleApplyAiCalibrations}
                  className="min-h-[44px] touch-press px-5 py-2 bg-accent hover:bg-accent-hover text-accent-ink rounded-xl text-xs font-extrabold shadow-lg flex items-center gap-2 active:scale-[0.98]"
                >
                  <Check className="w-4 h-4 stroke-[3]" />
                  <span>Apply All AI Overload Calibrations</span>
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Posture & Form Preview Modal */}
      {postureModalExercise && (
        <ExercisePostureModal
          exerciseName={postureModalExercise}
          isOpen={Boolean(postureModalExercise)}
          onClose={() => setPostureModalExercise(null)}
          profile={profile}
        />
      )}
    </div>
  );
};
