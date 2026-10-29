import React, { useState, useEffect } from 'react';
import {
  TrendingUp,
  CheckCircle2,
  XCircle,
  Edit3,
  HelpCircle,
  Award,
  Zap,
  ArrowUpRight,
  ArrowUp,
  ArrowDown,
  Minus,
  ShieldAlert,
  Sliders,
  History,
  Check,
  RotateCcw,
  Layers,
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
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorState,
  Input,
  LoadingState,
  MetricCard,
  Modal,
  PageHeader,
  SectionHeading,
  SegmentedControl,
  Select
} from '../ui';
import {
  TimeRange,
  compareSessions,
  filterSessionsByRange,
  formatDelta,
  totalWorkingReps,
  weightPrHistory
} from '../../utils/progressionPresentation';

/** Signed change with an arrow icon and screen-reader text, so direction never relies on colour alone. */
const DeltaChip: React.FC<{ value: number; suffix?: string }> = ({ value, suffix = '' }) => {
  const rounded = Number(value.toFixed(1));
  const Icon = rounded > 0 ? ArrowUp : rounded < 0 ? ArrowDown : Minus;
  const word = rounded > 0 ? 'up' : rounded < 0 ? 'down' : 'unchanged';
  return (
    <span
      className={`inline-flex items-center gap-1 text-xs font-semibold tabular ${
        rounded > 0 ? 'text-success' : rounded < 0 ? 'text-warning' : 'text-zinc-400'
      }`}
    >
      <Icon className="w-3.5 h-3.5" aria-hidden />
      <span>
        {formatDelta(value)}
        {suffix}
      </span>
      <span className="sr-only">({word} vs previous session)</span>
    </span>
  );
};

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
  const [loaded, setLoaded] = useState<boolean>(false);
  const [timeRange, setTimeRange] = useState<TimeRange>('90d');

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
    setLoaded(true);
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

  // Filter history based on timeRange (same rule as before, now in a tested helper)
  const filteredSessions = filterSessionsByRange(history?.sessions || [], timeRange);

  // Prepare chart data
  const loadChartData = filteredSessions.map((s) => ({
    date: s.date,
    value: s.topWeight,
    label: `${s.topWeight} ${profile.preferredUnit}`
  }));

  const repChartData = filteredSessions.map((s) => {
    const totalReps = totalWorkingReps(s);
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

  const unit = profile.preferredUnit;
  const rangeOptions: { value: TimeRange; label: string }[] = [
    { value: '30d', label: '30 days' },
    { value: '90d', label: '90 days' },
    { value: 'all', label: 'All time' }
  ];
  const rangeText = timeRange === 'all' ? 'all time' : timeRange === '30d' ? 'the last 30 days' : 'the last 90 days';
  const comparison = latestSession && prevSession ? compareSessions(latestSession, prevSession) : null;
  const prList = history ? weightPrHistory(history.sessions) : [];
  const recentPrs = [...prList].reverse().slice(0, 5);

  const overloadStatus = (rec: ProgressiveOverloadRecommendation) => {
    if (rec.ruleApplied === 'A_TOP_REPS_ACHIEVED') {
      return { label: 'Ready to advance', tone: 'accent' as const, icon: <ArrowUpRight className="w-3 h-3" aria-hidden /> };
    }
    if (rec.ruleApplied === 'C_REPS_DECLINED' || rec.ruleApplied === 'D_MULTI_SESSION_DECLINE') {
      return { label: 'Repeat load', tone: 'warning' as const, icon: <RotateCcw className="w-3 h-3" aria-hidden /> };
    }
    if (rec.flags.isProvisional) {
      return { label: 'Baseline needed', tone: 'neutral' as const, icon: <HelpCircle className="w-3 h-3" aria-hidden /> };
    }
    return { label: 'Accumulating reps', tone: 'info' as const, icon: <TrendingUp className="w-3 h-3" aria-hidden /> };
  };

  const matrixRows =
    viewMode === 'plan_matrix'
      ? exerciseList.map((exName) => {
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
          const hs = exHistory?.sessions ?? [];
          const lastChange = hs.length > 1 ? compareSessions(hs[hs.length - 1], hs[hs.length - 2]).topWeight : null;
          return { exName, pEx, rec, lastChange };
        })
      : [];

  const MATRIX_COLS =
    'md:grid-cols-[minmax(0,2fr)_minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,1.4fr)_minmax(0,1.4fr)_auto]';

  return (
    <div className="space-y-6 max-w-5xl mx-auto pb-16">
      <PageHeader
        eyebrow="Overload engine"
        title="Progression"
        description="See whether you are getting stronger, which lifts are moving, and what to load next session."
        actions={
          <SegmentedControl<'deep_dive' | 'plan_matrix'>
            ariaLabel="Progression view"
            value={viewMode}
            onChange={setViewMode}
            options={[
              { value: 'deep_dive', label: 'Single exercise' },
              { value: 'plan_matrix', label: 'Plan matrix' }
            ]}
          />
        }
        className="mb-0 sm:mb-0"
      />

      {/* FILTERS & ACTIONS */}
      <Card as="section" aria-label="Progression filters">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
          <Select
            label="Source workout plan"
            hint={selectedPlan?.isUploaded ? 'Uploaded plan' : undefined}
            value={selectedPlanId}
            onChange={(e) => setSelectedPlanId(e.target.value)}
          >
            <option value="all">All available exercises (global)</option>
            {plans.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} {p.isActive ? '(Active)' : ''}
              </option>
            ))}
          </Select>

          {viewMode === 'deep_dive' && (
            <Select
              label="Exercise"
              value={selectedExercise}
              onChange={(e) => setSelectedExercise(e.target.value)}
              disabled={exerciseList.length === 0}
            >
              {exerciseList.length === 0 && <option value="">No exercises available</option>}
              {exerciseList.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </Select>
          )}
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          {selectedExercise && (
            <Button
              variant="secondary"
              icon={<Eye className="w-4 h-4 text-info" aria-hidden />}
              onClick={() => setPostureModalExercise(selectedExercise)}
              title="Preview posture, joint angles, and biomechanical checkpoints for this exercise"
            >
              Form &amp; biomechanics
            </Button>
          )}
          {selectedPlan && selectedPlanId !== 'all' && (
            <Button
              variant="secondary"
              icon={<Sparkles className="w-4 h-4 text-accent" aria-hidden />}
              onClick={handleRunAiPlanOverloadTuning}
              title="Use Gemini AI to analyze this uploaded plan and optimize overload targets"
            >
              AI optimizer
            </Button>
          )}
          <Button
            variant={isAdjustingPlanRules ? 'primary' : 'secondary'}
            icon={<Sliders className="w-4 h-4" aria-hidden />}
            aria-expanded={isAdjustingPlanRules}
            onClick={() => setIsAdjustingPlanRules(!isAdjustingPlanRules)}
          >
            {isAdjustingPlanRules ? 'Close rules' : 'Adjust rules'}
          </Button>
        </div>
      </Card>

      {/* ADJUST OVERLOAD RULES */}
      {isAdjustingPlanRules && (
        <Card as="section" tone="accent" aria-label="Overload rules" className="space-y-5">
          <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-2">
            <SectionHeading
              level={3}
              className="mb-0"
              title="Adjust overload rules"
              description={`Editing ${selectedExercise || 'the selected plan exercises'} in ${selectedPlan?.name || 'your routine'}.`}
            />
            {rulesSavedNotice && (
              <Badge tone="success" icon={<Check className="w-3 h-3" aria-hidden />} role="status">
                Saved to plan
              </Badge>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-medium text-zinc-400 mr-1">Presets</span>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => {
                setRuleRepRange('8-12');
                setRuleSets(3);
                setRuleRir(2);
                setRuleStrategy('double_progression');
                setRuleIncrement(2.5);
                setRulePhase('hypertrophy');
              }}
            >
              Hypertrophy (8-12 reps, +2.5kg)
            </Button>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => {
                setRuleRepRange('5-8');
                setRuleSets(4);
                setRuleRir(2);
                setRuleStrategy('double_progression');
                setRuleIncrement(2.5);
                setRulePhase('strength');
              }}
            >
              Strength (5-8 reps, +2.5kg)
            </Button>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => {
                setRuleRepRange('10-15');
                setRuleSets(3);
                setRuleRir(1);
                setRuleStrategy('double_progression');
                setRuleIncrement(1.25);
                setRulePhase('hypertrophy');
              }}
            >
              High-Rep Pump (10-15 reps, +1.25kg)
            </Button>
            <Button
              size="sm"
              variant="secondary"
              className="text-warning"
              onClick={() => {
                setRuleRepRange('8-10');
                setRuleSets(2);
                setRuleRir(3);
                setRuleStrategy('linear_load');
                setRuleIncrement(2.5);
                setRulePhase('deload');
              }}
            >
              Deload Phase (-25% load)
            </Button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
            <div>
              <Input
                label="Target rep range"
                mono
                type="text"
                value={ruleRepRange}
                onChange={(e) => setRuleRepRange(e.target.value)}
                placeholder="e.g. 8-12, 6-8, 5x5, 10-15"
              />
              <div className="flex flex-wrap gap-1.5 mt-2">
                {['6-8', '8-12', '10-15', '5'].map((r) => (
                  <Button
                    key={r}
                    size="sm"
                    variant="ghost"
                    className="font-mono border border-line"
                    aria-label={`Set rep range to ${r}`}
                    onClick={() => setRuleRepRange(r)}
                  >
                    {r}
                  </Button>
                ))}
              </div>
            </div>

            <Input
              label="Prescribed working sets"
              mono
              type="number"
              min="1"
              max="10"
              value={ruleSets}
              onChange={(e) => setRuleSets(parseInt(e.target.value, 10) || 3)}
            />

            <Select
              label="Target RIR (effort level)"
              value={ruleRir}
              onChange={(e) => setRuleRir(parseInt(e.target.value, 10))}
            >
              <option value="0">0 RIR (Rep Out to Failure)</option>
              <option value="1">1 RIR (1 Rep in Reserve)</option>
              <option value="2">2 RIR (Standard Hypertrophy)</option>
              <option value="3">3 RIR (Conservative / Technical)</option>
            </Select>

            <Select
              label="Progression strategy"
              value={ruleStrategy}
              onChange={(e) => setRuleStrategy(e.target.value as ProgressionStrategy)}
            >
              <option value="double_progression">Standard Double Progression (All Sets Top of Range)</option>
              <option value="top_set_only">Top-Set Progression (Lead Set Hits Top)</option>
              <option value="consecutive_sessions">Dual-Session Consolidation (2 Sessions at Top)</option>
              <option value="linear_load">Linear Micro-Load (Weekly Increment)</option>
              <option value="rep_accumulation">Rep Accumulation Focus</option>
            </Select>

            <div>
              <Input
                label={`Load increase jump (${unit})`}
                mono
                type="number"
                step="0.5"
                value={ruleIncrement}
                onChange={(e) => setRuleIncrement(parseFloat(e.target.value) || 2.5)}
              />
              <div className="flex flex-wrap gap-1.5 mt-2">
                {[1.25, 2.0, 2.5, 5.0].map((inc) => (
                  <Button
                    key={inc}
                    size="sm"
                    variant="ghost"
                    className="font-mono border border-line"
                    aria-label={`Set load increase to ${inc}`}
                    onClick={() => setRuleIncrement(inc)}
                  >
                    +{inc}
                  </Button>
                ))}
              </div>
            </div>

            <Select
              label="Plan training phase"
              value={rulePhase}
              onChange={(e) => setRulePhase(e.target.value as TrainingPhase)}
            >
              <option value="hypertrophy">Hypertrophy (Progressive Overload)</option>
              <option value="strength">Strength (Lower reps, Higher load)</option>
              <option value="adaptation">Adaptation (Conservative volume)</option>
              <option value="re_entry">Re-Entry (Recovery focused)</option>
              <option value="deload">Deload (-25% load dissipation)</option>
            </Select>
          </div>

          <div className="pt-4 border-t border-line flex flex-wrap items-center justify-between gap-3">
            {selectedPlan && (
              <label className="flex items-start gap-2.5 min-h-[44px] cursor-pointer text-sm text-zinc-200 select-none">
                <input
                  type="checkbox"
                  checked={applyToAllExercisesInPlan}
                  onChange={(e) => setApplyToAllExercisesInPlan(e.target.checked)}
                  className="mt-1 w-4 h-4 accent-accent cursor-pointer"
                />
                <span>
                  Apply this configuration to all {exerciseList.length} exercises in &quot;{selectedPlan.name}&quot;
                </span>
              </label>
            )}
            <div className="flex items-center gap-2 ml-auto">
              <Button variant="ghost" onClick={() => setIsAdjustingPlanRules(false)}>
                Dismiss
              </Button>
              {selectedPlan && (
                <Button onClick={handleSaveRulesToPlan}>
                  {applyToAllExercisesInPlan
                    ? `Save to entire ${selectedPlan.name}`
                    : `Save for ${selectedExercise || 'exercise'}`}
                </Button>
              )}
            </div>
          </div>
        </Card>
      )}

      {!loaded && <LoadingState label="Loading your training history…" />}

      {/* ===== PLAN OVERLOAD MATRIX ===== */}
      {loaded && viewMode === 'plan_matrix' && (
        <Card as="section" aria-label="Plan overload matrix">
          <SectionHeading
            title={`Overload status · ${selectedPlan?.name || 'All plans'}`}
            description="Where every exercise in this plan stands, and what to load next."
          />

          {exerciseList.length === 0 ? (
            <EmptyState
              icon={<Layers className="w-5 h-5" />}
              title="No exercises found for this plan"
              description="Select an uploaded plan or add exercises in Plans & Uploads."
            />
          ) : (
            <div role="table" aria-label="Overload status by exercise" className="space-y-2">
              <div
                role="row"
                className={`hidden md:grid ${MATRIX_COLS} gap-x-4 px-4 text-label font-medium text-zinc-400`}
              >
                <span role="columnheader">Exercise</span>
                <span role="columnheader">Prescribed target</span>
                <span role="columnheader">Latest load</span>
                <span role="columnheader">Status</span>
                <span role="columnheader">Next prescription</span>
                <span role="columnheader" className="sr-only">
                  Actions
                </span>
              </div>

              {matrixRows.map(({ exName, pEx, rec, lastChange }) => {
                const status = overloadStatus(rec);
                return (
                  <Card
                    key={exName}
                    role="row"
                    tone="raised"
                    pad="sm"
                    className={`grid grid-cols-1 ${MATRIX_COLS} gap-x-4 gap-y-2 items-center md:px-4`}
                  >
                    <div role="cell" className="min-w-0">
                      <p className="text-sm font-semibold text-white truncate">{exName}</p>
                      {lastChange !== null && (
                        <div className="mt-0.5 flex items-center gap-1.5 text-label text-zinc-500">
                          <span>Last change</span>
                          <DeltaChip value={lastChange} suffix={` ${unit}`} />
                        </div>
                      )}
                    </div>
                    <div role="cell" className="text-xs text-zinc-300">
                      <span className="md:hidden text-zinc-500">Target: </span>
                      {pEx ? `${pEx.workingSets} sets × ${pEx.repRange} reps` : '8-12 reps'}
                    </div>
                    <div role="cell" className="text-sm font-semibold text-zinc-100 tabular">
                      <span className="md:hidden text-xs font-normal text-zinc-500">Latest: </span>
                      {rec.currentWeight > 0 ? (
                        `${rec.currentWeight} ${unit}`
                      ) : (
                        <span className="text-zinc-500">—</span>
                      )}
                    </div>
                    <div role="cell">
                      <Badge tone={status.tone} icon={status.icon}>
                        {status.label}
                      </Badge>
                    </div>
                    <div role="cell" className="text-sm font-semibold text-accent tabular">
                      <span className="md:hidden text-xs font-normal text-zinc-500">Next: </span>
                      {rec.recommendedWeight} {unit} ({rec.recommendedRepTarget})
                    </div>
                    <div role="cell" className="flex items-center gap-2 md:justify-end">
                      <Button
                        size="sm"
                        variant="secondary"
                        icon={<Sliders className="w-3.5 h-3.5" aria-hidden />}
                        aria-label={`Adjust overload rules for ${exName}`}
                        onClick={() => {
                          setSelectedExercise(exName);
                          setIsAdjustingPlanRules(true);
                        }}
                      >
                        Tune
                      </Button>
                      <Button
                        size="sm"
                        variant="secondary"
                        aria-label={`Analyze ${exName}`}
                        onClick={() => {
                          setSelectedExercise(exName);
                          setViewMode('deep_dive');
                        }}
                      >
                        Analyze →
                      </Button>
                    </div>
                  </Card>
                );
              })}
            </div>
          )}
        </Card>
      )}

      {/* ===== SINGLE EXERCISE ===== */}
      {loaded && viewMode === 'deep_dive' && (
        <>
          {exerciseList.length === 0 && (
            <EmptyState
              icon={<TrendingUp className="w-5 h-5" />}
              title="No exercises to track yet"
              description="Add a workout plan or complete a session and your progression will show up here."
            />
          )}

          {/* NEXT-SESSION PRESCRIPTION */}
          {currentRec && (
            <Card as="section" tone="accent" pad="lg" aria-label="Next session prescription" className="space-y-4">
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div className="min-w-0">
                  <Badge tone="accent">Next session · {currentRec.ruleTitle}</Badge>
                  <h2 className="text-xl sm:text-2xl font-bold text-white mt-2 tracking-tight break-words">
                    {currentRec.exerciseName}
                  </h2>
                  <p className="text-xs text-zinc-400 mt-1">
                    Plan: <span className="text-zinc-100 font-medium">{selectedPlan?.name || 'All plans'}</span>
                    {' · '}Target: <span className="text-zinc-100 font-medium">{ruleRepRange} reps</span>
                    {' · '}Strategy:{' '}
                    <span className="text-zinc-100 font-medium capitalize">{ruleStrategy.replace(/_/g, ' ')}</span>
                  </p>
                </div>

                <div className="flex items-center gap-5 bg-surface-2 border border-line rounded-control px-5 py-3 self-start md:self-auto">
                  <div>
                    <p className="text-label text-zinc-400">Prescribed load</p>
                    <p className="text-2xl font-bold text-accent tabular">
                      {currentRec.recommendedWeight}{' '}
                      <span className="text-xs font-normal text-zinc-400">{unit}</span>
                    </p>
                  </div>
                  <div className="h-10 w-px bg-line" aria-hidden />
                  <div>
                    <p className="text-label text-zinc-400">Target reps</p>
                    <p className="text-base font-bold text-white tabular">{currentRec.recommendedRepTarget}</p>
                  </div>
                </div>
              </div>

              <p className="text-sm text-zinc-300 leading-relaxed bg-surface-2 border border-line rounded-control p-4">
                {currentRec.explanation}
              </p>

              {currentRec.flags.recoveryAlert && (
                <div
                  role="note"
                  className="p-3.5 bg-warning/10 border border-warning/30 rounded-control flex items-start gap-2.5 text-xs text-zinc-200"
                >
                  <ShieldAlert className="w-4 h-4 text-warning shrink-0 mt-0.5" aria-hidden />
                  <span>
                    <strong className="text-warning">Recovery notice:</strong> fatigue accumulation detected across
                    multiple sessions in {selectedPlan?.name || 'your routine'}. Prioritize sleep &amp; nutrition.
                  </span>
                </div>
              )}

              <div className="pt-4 border-t border-line flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2 text-xs">
                  <span className="text-zinc-400">Your status</span>
                  <Badge
                    tone={
                      currentRec.userAction === 'accepted'
                        ? 'accent'
                        : currentRec.userAction === 'rejected'
                        ? 'danger'
                        : currentRec.userAction === 'modified'
                        ? 'info'
                        : 'neutral'
                    }
                    icon={
                      currentRec.userAction === 'accepted' ? (
                        <Check className="w-3 h-3" aria-hidden />
                      ) : currentRec.userAction === 'rejected' ? (
                        <XCircle className="w-3 h-3" aria-hidden />
                      ) : currentRec.userAction === 'modified' ? (
                        <Edit3 className="w-3 h-3" aria-hidden />
                      ) : undefined
                    }
                    className="capitalize"
                  >
                    {currentRec.userAction}
                    {currentRec.chosenWeight !== undefined && ` (${currentRec.chosenWeight} ${unit})`}
                  </Badge>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <Button variant="danger" onClick={handleRejectRec}>
                    Reject load
                  </Button>
                  <Button
                    variant="secondary"
                    icon={<Edit3 className="w-4 h-4 text-info" aria-hidden />}
                    onClick={() => setIsModifyingDecision(true)}
                  >
                    Modify target
                  </Button>
                  <Button
                    icon={<CheckCircle2 className="w-4 h-4" aria-hidden />}
                    onClick={handleAcceptRec}
                  >
                    Accept prescription
                  </Button>
                </div>
              </div>
            </Card>
          )}

          {selectedExercise && !history && (
            <EmptyState
              icon={<History className="w-5 h-5" />}
              title={`No completed sets logged for ${selectedExercise}`}
              description="Finish a workout that includes this exercise and its strength history, records and trends will appear here."
            />
          )}

          {history && (
            <>
              {/* HEADLINE METRICS (all-time) */}
              <section aria-label="Headline metrics" className="grid grid-cols-1 min-[420px]:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
                <MetricCard
                  label="All-time PR"
                  value={personalRecordWeight}
                  unit={unit}
                  hint="Heaviest completed load"
                  icon={<Award className="w-4 h-4" />}
                />
                <MetricCard
                  label="Estimated 1RM"
                  value={bestEstimated1RM}
                  unit={unit}
                  hint="Best Epley estimate"
                  icon={<Zap className="w-4 h-4" />}
                />
                <MetricCard
                  label="Last session"
                  value={latestSession ? latestSession.topWeight : '—'}
                  unit={latestSession ? unit : undefined}
                  hint={latestSession ? `Reps: ${latestSession.workingSets.map((s) => s.reps).join(', ')}` : 'No logs'}
                  icon={<History className="w-4 h-4" />}
                />
                <MetricCard
                  label="Peak volume"
                  value={maxVolumeSession.toLocaleString()}
                  unit={unit}
                  hint="Best single-session working volume"
                  icon={<TrendingUp className="w-4 h-4" />}
                />
              </section>

              {/* LAST SESSION VS PREVIOUS */}
              <Card as="section" aria-label="Last session compared with previous">
                <SectionHeading
                  title="Last session vs previous"
                  description={
                    latestSession && prevSession
                      ? `${latestSession.date} compared with ${prevSession.date}`
                      : 'Needs at least two logged sessions'
                  }
                />
                {comparison && latestSession ? (
                  <dl className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    {[
                      { k: 'Top weight', v: `${latestSession.topWeight} ${unit}`, d: comparison.topWeight, s: ` ${unit}` },
                      { k: 'Estimated 1RM', v: `${latestSession.estimated1RM} ${unit}`, d: comparison.estimated1RM, s: ` ${unit}` },
                      { k: 'Working volume', v: `${latestSession.totalVolume.toLocaleString()} ${unit}`, d: comparison.totalVolume, s: ` ${unit}` },
                      { k: 'Total reps', v: `${totalWorkingReps(latestSession)}`, d: comparison.totalReps, s: ' reps' }
                    ].map((m) => (
                      <div key={m.k} className="bg-surface-2 border border-line rounded-control p-3 min-w-0">
                        <dt className="text-label text-zinc-400">{m.k}</dt>
                        <dd className="text-base font-bold text-white tabular mt-0.5 truncate">{m.v}</dd>
                        <dd className="mt-1">
                          <DeltaChip value={m.d} suffix={m.s} />
                        </dd>
                      </div>
                    ))}
                  </dl>
                ) : (
                  <p className="text-sm text-zinc-400">
                    Log this exercise in one more workout to see how your latest session compares.
                  </p>
                )}
              </Card>

              {/* TRENDS */}
              <section aria-label="Trends" className="space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3">
                  <SectionHeading
                    className="mb-0"
                    title="Trends"
                    description={`${selectedExercise} · ${rangeText}`}
                  />
                  <SegmentedControl<TimeRange>
                    ariaLabel="Date range"
                    value={timeRange}
                    onChange={setTimeRange}
                    options={rangeOptions}
                  />
                </div>

                {filteredSessions.length === 0 ? (
                  <EmptyState
                    icon={<History className="w-5 h-5" />}
                    title={`No sessions in ${rangeText}`}
                    description="Your earlier history is still saved. Widen the date range to see it."
                    action={
                      timeRange !== 'all' ? (
                        <Button variant="secondary" onClick={() => setTimeRange('all')}>
                          Show all time
                        </Button>
                      ) : undefined
                    }
                  />
                ) : (
                  <>
                    {filteredSessions.length === 1 && (
                      <p role="status" className="text-xs text-zinc-400">
                        Only one session in this range. A trend line needs at least two.
                      </p>
                    )}
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 sm:gap-4">
                      <Card>
                        <LineChart
                          responsive
                          data={loadChartData}
                          title="Weight load progression"
                          unit={unit}
                          accentColor="var(--chart-1)"
                          emptyMessage={`No history recorded for ${selectedExercise}`}
                        />
                      </Card>
                      <Card>
                        <LineChart
                          responsive
                          data={repChartData}
                          title="Total working repetitions"
                          unit="reps"
                          accentColor="var(--chart-2)"
                          emptyMessage="No repetition history recorded"
                        />
                      </Card>
                    </div>
                    <Card>
                      <BarChart
                        data={volumeChartData}
                        title="Session working-set volume (weight × reps)"
                        unit={unit}
                        maxLabels={8}
                      />
                    </Card>
                  </>
                )}
              </section>

              {/* PR HISTORY */}
              <Card as="section" aria-label="Weight record history">
                <SectionHeading
                  title="Weight record history"
                  description="Sessions where your top working weight beat every earlier session"
                />
                {recentPrs.length === 0 ? (
                  <p className="text-sm text-zinc-400">No weight records yet. Log a working set with a weight to start the list.</p>
                ) : (
                  <ul className="divide-y divide-line">
                    {recentPrs.map((pr) => (
                      <li key={pr.date} className="py-2.5 flex items-center justify-between gap-3">
                        <div className="flex items-center gap-2 min-w-0">
                          <Award className="w-4 h-4 text-warning shrink-0" aria-hidden />
                          <span className="text-sm font-semibold text-white tabular">
                            {pr.weight} {unit}
                          </span>
                        </div>
                        <div className="text-xs text-zinc-400 text-right">
                          <span className="tabular">{pr.date}</span>
                          <span className="block text-label text-zinc-500">
                            {pr.previousBest > 0
                              ? `${formatDelta(pr.weight - pr.previousBest)} ${unit} over previous best`
                              : 'First logged session'}
                          </span>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
            </>
          )}
        </>
      )}

      {/* MODIFY PRESCRIPTION */}
      <Modal
        open={isModifyingDecision}
        onClose={() => setIsModifyingDecision(false)}
        title="Modify prescribed load"
        description="Override the target weight and reps for your next session."
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setIsModifyingDecision(false)}>
              Cancel
            </Button>
            <Button onClick={handleModifyRec}>Save target</Button>
          </>
        }
      >
        <div className="space-y-4">
          <Input
            label={`Target weight (${unit})`}
            mono
            type="number"
            step="0.5"
            value={modifiedWeight}
            onChange={(e) => setModifiedWeight(parseFloat(e.target.value) || 0)}
          />
          <Input
            label="Target reps"
            mono
            type="text"
            value={modifiedReps}
            onChange={(e) => setModifiedReps(e.target.value)}
            placeholder="e.g. 8-10 reps"
          />
        </div>
      </Modal>

      {/* AI PLAN OVERLOAD OPTIMIZER */}
      <Modal
        open={isAiTuningModalOpen}
        onClose={() => setIsAiTuningModalOpen(false)}
        title="AI overload calibrator"
        description={`Optimizing progression rules for "${selectedPlan?.name ?? ''}"`}
        size="lg"
        footer={
          <>
            <Button variant="ghost" onClick={() => setIsAiTuningModalOpen(false)}>
              Cancel
            </Button>
            {aiTuningData && (
              <Button icon={<Check className="w-4 h-4" aria-hidden />} onClick={handleApplyAiCalibrations}>
                Apply all AI overload calibrations
              </Button>
            )}
          </>
        }
      >
        <div className="space-y-4">
          {aiTuningLoading && <LoadingState label="Calibrating optimal overload targets…" />}

          {aiTuningError && (
            <ErrorState
              title="AI calibration notice"
              description={aiTuningError}
              action={
                <Button variant="secondary" onClick={handleRunAiPlanOverloadTuning}>
                  Retry analysis
                </Button>
              }
            />
          )}

          {aiTuningData && (
            <div className="space-y-4">
              <Card tone="raised" pad="sm" className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-medium text-zinc-400">Plan progression framework</span>
                  <Badge tone="accent" className="capitalize">
                    Phase: {aiTuningData.recommendedPhase}
                  </Badge>
                </div>
                <p className="text-sm text-zinc-200 leading-relaxed">{aiTuningData.planStrategySummary}</p>
              </Card>

              <div className="space-y-2">
                <h3 className="text-xs font-medium text-zinc-400">
                  Calibrated movement overload rules ({aiTuningData.exerciseCalibrations?.length || 0})
                </h3>
                <ul className="divide-y divide-line border border-line rounded-control bg-surface-2 overflow-hidden">
                  {(aiTuningData.exerciseCalibrations || []).map((cal: any, idx: number) => (
                    <li key={idx} className="p-3.5 space-y-1.5">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="font-semibold text-white text-sm">{cal.exerciseName}</span>
                        <span className="text-xs text-zinc-300 tabular">
                          {cal.recommendedWorkingSets} sets × {cal.recommendedRepRange} reps
                          {' · '}+{cal.recommendedIncrement} {unit} jump
                          {' · '}
                          {cal.recommendedStrategy === 'double_progression' ? 'Double overload' : cal.recommendedStrategy}
                        </span>
                      </div>
                      {cal.rationale && (
                        <p className="text-xs text-zinc-400 leading-normal">&ldquo;{cal.rationale}&rdquo;</p>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          )}
        </div>
      </Modal>

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
