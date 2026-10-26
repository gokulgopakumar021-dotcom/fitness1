import React, { useState } from 'react';
import {
  Sparkles,
  Calculator,
  ArrowRight,
  ArrowLeft,
  Check,
  Flame,
  Scale,
  TrendingDown,
  TrendingUp,
  Activity,
  Heart,
  Info,
  ChevronRight,
  Sliders,
  X,
  Target,
  Percent,
  Zap,
  ShieldCheck
} from 'lucide-react';
import { BodyMetricEntry, DailyNutritionLog, PrimaryGoal, UserProfile } from '../../types';
import { db } from '../../storage/db';
import {
  ActivityLevel,
  ACTIVITY_MULTIPLIERS,
  calculateDetailedTDEE,
  calculateWizardMacroPlan,
  DeficitOrSurplusPace,
  DetailedTDEEResult,
  NutritionGoal,
  WizardMacroPlan
} from '../../utils/tdeeEngine';
import { kgToLbs, lbsToKg } from '../../utils/calculations';

export interface NutritionGoalWizardProps {
  isOpen: boolean;
  onClose: () => void;
  profile: UserProfile;
  currentLog?: DailyNutritionLog;
  onTargetsUpdated: (updatedProfile: UserProfile, updatedLog?: DailyNutritionLog) => void;
}

export const NutritionGoalWizard: React.FC<NutritionGoalWizardProps> = ({
  isOpen,
  onClose,
  profile,
  currentLog,
  onTargetsUpdated
}) => {
  const unit = profile.preferredUnit || 'kg';
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);

  // Initialize latest body fat from profile or latest body metric entry
  const initialBodyFat = () => {
    if (typeof profile.bodyFatPercentage === 'number' && profile.bodyFatPercentage > 0) {
      return profile.bodyFatPercentage;
    }
    const metrics = db.getBodyMetrics();
    if (metrics.length > 0) {
      const latest = [...metrics].reverse().find((m) => typeof m.bodyFatPercentage === 'number' && m.bodyFatPercentage > 0);
      if (latest?.bodyFatPercentage) return latest.bodyFatPercentage;
    }
    return undefined;
  };

  // Step 1: Goal & Pace
  const initialGoal: NutritionGoal =
    profile.primaryGoal === 'fat_loss'
      ? 'cut'
      : profile.primaryGoal === 'muscle_gain'
      ? 'bulk'
      : 'maintain';
  const [goal, setGoal] = useState<NutritionGoal>(initialGoal);
  const [pace, setPace] = useState<DeficitOrSurplusPace>('moderate');
  const [customCalorieOffset, setCustomCalorieOffset] = useState<number | undefined>(undefined);

  // Step 2: Physical Metrics, Activity & Body Fat %
  const [weight, setWeight] = useState<number>(() => {
    return unit === 'lbs' ? kgToLbs(profile.currentWeightKg || 78) : (profile.currentWeightKg || 78);
  });
  const [heightCm, setHeightCm] = useState<number>(profile.heightCm || 178);
  const [age, setAge] = useState<number>(profile.age || 26);
  const [sex, setSex] = useState<'male' | 'female' | 'other' | 'unspecified'>(profile.sex || 'male');
  const [activityLevel, setActivityLevel] = useState<ActivityLevel>('moderate');
  const [bodyFat, setBodyFat] = useState<number | undefined>(initialBodyFat());

  // Step 3 & 4: Macro Distribution
  const [proteinRatio, setProteinRatio] = useState<number>(goal === 'cut' ? 2.2 : goal === 'bulk' ? 2.0 : 1.9);
  const [fatPercent, setFatPercent] = useState<number>(25);
  const [isSavedSuccess, setIsSavedSuccess] = useState<boolean>(false);

  if (!isOpen) return null;

  // Convert weight to kg for physiological calculations
  const weightKg = unit === 'lbs' ? lbsToKg(weight) : weight;

  // Calculate detailed TDEE using Katch-McArdle (if body fat % provided) or Mifflin-St Jeor
  const tdeeResult: DetailedTDEEResult = calculateDetailedTDEE({
    weightKg,
    heightCm,
    age,
    sex,
    activityLevel,
    bodyFatPercentage: bodyFat
  });

  // Calculate macro plan
  const plan: WizardMacroPlan = calculateWizardMacroPlan({
    dailyTdee: tdeeResult.dailyTdee,
    weightKg,
    goal,
    pace,
    customCalorieAdjustment: customCalorieOffset,
    proteinRatioGramsPerKg: proteinRatio,
    fatPercentOfCalories: fatPercent,
    bodyFatPercentage: bodyFat
  });

  // Apply changes to database and parent
  const handleApplyPlan = () => {
    // Map goal to PrimaryGoal
    const mappedGoal: PrimaryGoal =
      goal === 'cut' ? 'fat_loss' : goal === 'bulk' ? 'muscle_gain' : 'maintenance';

    const updatedProfile: UserProfile = {
      ...profile,
      currentWeightKg: Number(weightKg.toFixed(1)),
      heightCm,
      age,
      sex,
      primaryGoal: mappedGoal,
      bodyFatPercentage: bodyFat,
      dailyCalorieTarget: plan.targetCalories,
      dailyProteinTarget: plan.proteinGrams,
      dailyCarbsTarget: plan.carbsGrams,
      dailyFatTarget: plan.fatGrams
    };

    // 1. Save updated UserProfile to database
    db.saveProfile(updatedProfile);

    // 2. Save current day's log target if passed
    let updatedLog: DailyNutritionLog | undefined = undefined;
    if (currentLog) {
      updatedLog = {
        ...currentLog,
        targetCalories: plan.targetCalories,
        targetProtein: plan.proteinGrams,
        targetCarbs: plan.carbsGrams,
        targetFat: plan.fatGrams
      };
      db.saveNutritionLogForDate(updatedLog);
    }

    // 3. Record or update latest body metric in database with weight and body fat %
    const todayStr = new Date().toISOString().split('T')[0];
    const bmiVal = Number((weightKg / Math.pow(heightCm / 100, 2)).toFixed(1));
    const metricEntry: BodyMetricEntry = {
      id: `metric_${Date.now()}`,
      date: todayStr,
      weightKg: Number(weightKg.toFixed(1)),
      bodyFatPercentage: bodyFat,
      bmi: bmiVal,
      notes: `Updated via Nutrition Goal Wizard (${goal.toUpperCase()})`
    };
    db.addOrUpdateBodyMetric(metricEntry);

    // 4. Notify parent state
    setIsSavedSuccess(true);
    setTimeout(() => {
      onTargetsUpdated(updatedProfile, updatedLog);
      onClose();
    }, 600);
  };

  const bodyFatPresets = [
    { label: '8–11%', sub: 'Competition / Shredded', value: 10 },
    { label: '12–15%', sub: 'Athletic / Visible Abs', value: 14 },
    { label: '16–20%', sub: 'Lean & Defined', value: 18 },
    { label: '21–25%', sub: 'Healthy / Moderate', value: 23 },
    { label: '26%+', sub: 'Higher Mass', value: 27 }
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5 bg-black/80 backdrop-blur-md animate-fadeIn">
      <div className="reshape-card w-full max-w-3xl overflow-hidden flex flex-col max-h-[92vh] border border-[var(--border-card)] shadow-2xl">
        {/* Header */}
        <div className="p-4 sm:p-5 border-b border-[var(--border-card)] bg-[var(--bg-subtle)] flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-accent text-accent-ink flex items-center justify-center font-bold">
              <Calculator className="w-5 h-5" />
            </div>
            <div>
              <div className="text-[10px] font-mono tracking-wider uppercase text-[var(--text-muted)] flex items-center gap-1.5">
                <span>Precision Nutrition Engine</span>
                <span aria-hidden="true">·</span>
                <span className="text-volt-adaptive font-semibold">Goal &amp; TDEE Wizard</span>
              </div>
              <h2 className="text-lg sm:text-xl font-bold tracking-tight text-[var(--text-primary)]">
                {step === 1 && '1. Set Your Goal & Trajectory'}
                {step === 2 && '2. Weight, Activity & Body Fat %'}
                {step === 3 && '3. TDEE Estimate & Caloric Budget'}
                {step === 4 && '4. Macronutrient Targets & Database Commit'}
              </h2>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-2 rounded-xl text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--chip-bg)] transition-colors"
            title="Close Wizard"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Wizard Step Indicator Bar */}
        <div className="grid grid-cols-4 border-b border-[var(--border-card)] bg-[var(--bg-card)]">
          {[
            { num: 1, label: 'Goal' },
            { num: 2, label: 'Composition' },
            { num: 3, label: 'TDEE' },
            { num: 4, label: 'Macros & Save' }
          ].map((s) => (
            <button
              key={s.num}
              type="button"
              onClick={() => setStep(s.num as any)}
              className={`py-2.5 px-1 border-b-2 transition-all flex flex-col sm:flex-row items-center justify-center gap-1 text-[11px] ${
                step === s.num
                  ? 'border-[#CEFF00] text-volt-adaptive font-bold'
                  : step > s.num
                  ? 'border-emerald-500/50 text-[var(--text-secondary)]'
                  : 'border-transparent text-[var(--text-muted)] opacity-60'
              }`}
            >
              <span
                className={`w-4 h-4 rounded-full flex items-center justify-center text-[10px] ${
                  step === s.num
                    ? 'bg-[#CEFF00] text-black font-bold'
                    : step > s.num
                    ? 'bg-emerald-500 text-black'
                    : 'bg-[var(--chip-bg)] text-[var(--text-muted)]'
                }`}
              >
                {step > s.num ? '✓' : s.num}
              </span>
              <span className="truncate">{s.label}</span>
            </button>
          ))}
        </div>

        {/* Scrollable Content Area */}
        <div className="p-5 sm:p-6 overflow-y-auto space-y-6 flex-1">
          {/* STEP 1: Setting Goal (Cut / Maintain / Bulk) & Pace */}
          {step === 1 && (
            <div className="space-y-6">
              <div className="text-xs text-[var(--text-secondary)] leading-relaxed">
                Choose your primary physical objective. The engine calculates your daily caloric budget and weekly surplus or deficit according to metabolic physics (~7,700 kcal/kg tissue balance).
              </div>

              {/* Goal Cards */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                {[
                  {
                    id: 'cut' as NutritionGoal,
                    title: 'Cut (Fat Loss)',
                    badge: 'Caloric Deficit',
                    desc: 'Prescribes a targeted energy deficit to oxidize body fat while holding high protein to preserve skeletal muscle mass.',
                    icon: TrendingDown,
                    activeClass: 'border-[#CEFF00] bg-[#CEFF00]/10 text-[var(--text-primary)]'
                  },
                  {
                    id: 'maintain' as NutritionGoal,
                    title: 'Maintain (Equilibrium)',
                    badge: 'Energy Balance',
                    desc: 'Matches exact daily expenditure for stable scale weight, athletic power, rapid recovery, and body recomposition.',
                    icon: Scale,
                    activeClass: 'border-[#CEFF00] bg-[#CEFF00]/10 text-[var(--text-primary)]'
                  },
                  {
                    id: 'bulk' as NutritionGoal,
                    title: 'Bulk (Hypertrophy)',
                    badge: 'Caloric Surplus',
                    desc: 'Prescribes an optimal surplus to fuel progressive overload, glycogen saturation, and myofibrillar muscle hypertrophy.',
                    icon: TrendingUp,
                    activeClass: 'border-[#CEFF00] bg-[#CEFF00]/10 text-[var(--text-primary)]'
                  }
                ].map((g) => {
                  const Icon = g.icon;
                  const isSel = goal === g.id;
                  return (
                    <button
                      key={g.id}
                      type="button"
                      onClick={() => {
                        setGoal(g.id);
                        setCustomCalorieOffset(undefined);
                      }}
                      className={`text-left p-4 rounded-2xl border transition-all ${
                        isSel
                          ? g.activeClass + ' shadow-md'
                          : 'bg-[var(--chip-bg)] border-[var(--border-card)] text-[var(--text-secondary)] hover:border-[var(--text-muted)]'
                      }`}
                    >
                      <div className="flex items-center justify-between mb-2">
                        <div
                          className={`p-2 rounded-xl bg-[var(--bg-canvas)] border border-[var(--border-card)] ${
                            isSel ? 'text-volt-adaptive' : 'text-[var(--text-muted)]'
                          }`}
                        >
                          <Icon className="w-5 h-5" />
                        </div>
                        <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-[var(--bg-subtle)] border border-[var(--border-card)] text-[var(--text-muted)]">
                          {g.badge}
                        </span>
                      </div>
                      <h4 className="text-sm font-bold text-[var(--text-primary)]">{g.title}</h4>
                      <p className="text-xs text-[var(--text-muted)] leading-relaxed mt-1">{g.desc}</p>
                    </button>
                  );
                })}
              </div>

              {/* Deficit / Surplus Rate Selector (if Cut or Bulk) */}
              {goal !== 'maintain' && (
                <div className="space-y-3 reshape-card-subtle p-4">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wider">
                      {goal === 'cut' ? 'Fat Loss Deficit Intensity' : 'Muscle Gain Surplus Rate'}
                    </span>
                    <span className="text-xs font-mono text-volt-adaptive font-bold">
                      {pace.toUpperCase()}
                    </span>
                  </div>

                  <div className="grid grid-cols-3 gap-2">
                    {[
                      {
                        id: 'conservative' as DeficitOrSurplusPace,
                        label: goal === 'cut' ? 'Conservative (-300 kcal)' : 'Lean Bulk (+250 kcal)',
                        rate: goal === 'cut' ? '~0.25 kg/wk' : '~0.2 kg/wk'
                      },
                      {
                        id: 'moderate' as DeficitOrSurplusPace,
                        label: goal === 'cut' ? 'Moderate (-500 kcal)' : 'Standard (+400 kcal)',
                        rate: goal === 'cut' ? '~0.45 kg/wk' : '~0.36 kg/wk'
                      },
                      {
                        id: 'aggressive' as DeficitOrSurplusPace,
                        label: goal === 'cut' ? 'Aggressive (-750 kcal)' : 'Power Bulk (+600 kcal)',
                        rate: goal === 'cut' ? '~0.7 kg/wk' : '~0.55 kg/wk'
                      }
                    ].map((p) => (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => {
                          setPace(p.id);
                          setCustomCalorieOffset(undefined);
                        }}
                        className={`p-3 rounded-xl border text-center transition-all ${
                          pace === p.id && customCalorieOffset === undefined
                            ? 'bg-[#CEFF00] text-black font-bold border-transparent'
                            : 'bg-[var(--chip-bg)] text-[var(--text-secondary)] border-[var(--border-card)]'
                        }`}
                      >
                        <div className="text-xs font-mono font-semibold">{p.label}</div>
                        <div className="text-[10px] opacity-80 mt-0.5">{p.rate}</div>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* STEP 2: Physical Metrics, Activity Level & Body Fat % */}
          {step === 2 && (
            <div className="space-y-6">
              <div className="text-xs text-[var(--text-secondary)] leading-relaxed">
                Provide your current scale weight, activity level, and body fat percentage. When body fat % is provided, we calculate your Lean Body Mass (LBM) and utilize the elite <strong className="text-[var(--text-primary)]">Katch-McArdle equation</strong>. Otherwise, the validated <strong className="text-[var(--text-primary)]">Mifflin-St Jeor formula</strong> is applied.
              </div>

              {/* Physical Stats Form */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="reshape-card-subtle p-3.5 space-y-1">
                  <label className="text-[10px] font-mono uppercase text-[var(--text-muted)] block">
                    Weight ({unit})
                  </label>
                  <input
                    type="number"
                    step="0.5"
                    min="30"
                    max="300"
                    value={weight}
                    onChange={(e) => setWeight(parseFloat(e.target.value) || 0)}
                    className="w-full text-lg font-mono font-bold bg-transparent text-[var(--text-primary)] border-b border-[var(--border-card)] focus:border-[#CEFF00] outline-none"
                  />
                </div>

                <div className="reshape-card-subtle p-3.5 space-y-1">
                  <label className="text-[10px] font-mono uppercase text-[var(--text-muted)] block">
                    Height (cm)
                  </label>
                  <input
                    type="number"
                    min="100"
                    max="230"
                    value={heightCm}
                    onChange={(e) => setHeightCm(parseInt(e.target.value, 10) || 178)}
                    className="w-full text-lg font-mono font-bold bg-transparent text-[var(--text-primary)] border-b border-[var(--border-card)] focus:border-[#CEFF00] outline-none"
                  />
                </div>

                <div className="reshape-card-subtle p-3.5 space-y-1">
                  <label className="text-[10px] font-mono uppercase text-[var(--text-muted)] block">
                    Age (years)
                  </label>
                  <input
                    type="number"
                    min="14"
                    max="99"
                    value={age}
                    onChange={(e) => setAge(parseInt(e.target.value, 10) || 25)}
                    className="w-full text-lg font-mono font-bold bg-transparent text-[var(--text-primary)] border-b border-[var(--border-card)] focus:border-[#CEFF00] outline-none"
                  />
                </div>

                <div className="reshape-card-subtle p-3.5 space-y-1">
                  <label className="text-[10px] font-mono uppercase text-[var(--text-muted)] block">
                    Biological Sex
                  </label>
                  <select
                    value={sex}
                    onChange={(e) => setSex(e.target.value as any)}
                    className="w-full text-sm font-semibold bg-transparent text-[var(--text-primary)] border-b border-[var(--border-card)] focus:border-[#CEFF00] outline-none pt-1"
                  >
                    <option value="male" className="bg-zinc-900 text-white">Male</option>
                    <option value="female" className="bg-zinc-900 text-white">Female</option>
                    <option value="other" className="bg-zinc-900 text-white">Other</option>
                  </select>
                </div>
              </div>

              {/* Body Fat Percentage Input & Lean Mass Breakdown */}
              <div className="reshape-card-subtle p-4 space-y-3 border border-[var(--border-card)]">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <div>
                    <label className="text-xs font-bold text-[var(--text-primary)] uppercase tracking-wider flex items-center gap-1.5">
                      <Percent className="w-3.5 h-3.5 text-volt-adaptive" />
                      <span>Body Fat Percentage (%)</span>
                    </label>
                    <span className="text-[11px] text-[var(--text-muted)]">
                      Enables Lean Body Mass (LBM) calculation and Katch-McArdle metabolic precision.
                    </span>
                  </div>

                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      step="0.5"
                      min="3"
                      max="55"
                      placeholder="e.g. 15"
                      value={bodyFat !== undefined ? bodyFat : ''}
                      onChange={(e) => {
                        const val = parseFloat(e.target.value);
                        setBodyFat(isNaN(val) ? undefined : val);
                      }}
                      className="w-24 text-right px-3 py-1.5 rounded-xl bg-[var(--bg-canvas)] border border-[var(--border-card)] font-mono font-bold text-base text-[var(--text-primary)] focus:border-[#CEFF00] outline-none"
                    />
                    <span className="text-sm font-mono font-bold text-[var(--text-secondary)]">%</span>
                  </div>
                </div>

                {/* Body Fat Presets */}
                <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 pt-1">
                  {bodyFatPresets.map((b) => (
                    <button
                      key={b.value}
                      type="button"
                      onClick={() => setBodyFat(b.value)}
                      className={`p-2 rounded-xl text-left border transition-all ${
                        bodyFat === b.value
                          ? 'bg-[#CEFF00]/15 border-[#CEFF00] text-[var(--text-primary)]'
                          : 'bg-[var(--chip-bg)] border-[var(--border-card)] text-[var(--text-muted)] hover:border-[var(--text-secondary)]'
                      }`}
                    >
                      <div className="text-xs font-mono font-bold text-[var(--text-primary)]">{b.label}</div>
                      <div className="text-[10px] text-[var(--text-muted)] truncate">{b.sub}</div>
                    </button>
                  ))}
                </div>

                {/* Live Lean Body Mass & Formula Notice */}
                <div className="pt-2 border-t border-[var(--border-card)] flex flex-wrap items-center justify-between gap-2 text-xs font-mono">
                  {tdeeResult.leanBodyMassKg ? (
                    <div className="flex items-center gap-2 text-emerald-400">
                      <ShieldCheck className="w-4 h-4" />
                      <span>
                        Lean Mass: <strong>{tdeeResult.leanBodyMassKg} kg</strong> · Fat Mass: <strong>{(weightKg - tdeeResult.leanBodyMassKg).toFixed(1)} kg</strong>
                      </span>
                    </div>
                  ) : (
                    <div className="flex items-center gap-1.5 text-[var(--text-muted)]">
                      <Info className="w-3.5 h-3.5" />
                      <span>Body fat % omitted. Applying standard Mifflin-St Jeor formula.</span>
                    </div>
                  )}

                  <span className="px-2 py-0.5 rounded bg-[var(--bg-canvas)] border border-[var(--border-card)] text-[10px] text-volt-adaptive font-semibold uppercase">
                    {tdeeResult.formulaUsed === 'katch_mcardle' ? 'Katch-McArdle Formula' : 'Mifflin-St Jeor Formula'}
                  </span>
                </div>
              </div>

              {/* Activity Level Selector */}
              <div className="space-y-2">
                <label className="text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wider block">
                  Weekly Training &amp; Daily Movement Level
                </label>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
                  {(Object.keys(ACTIVITY_MULTIPLIERS) as ActivityLevel[]).map((lvl) => {
                    const item = ACTIVITY_MULTIPLIERS[lvl];
                    const isSel = activityLevel === lvl;
                    return (
                      <button
                        key={lvl}
                        type="button"
                        onClick={() => setActivityLevel(lvl)}
                        className={`text-left p-3.5 rounded-xl border transition-all ${
                          isSel
                            ? 'bg-[#CEFF00]/10 border-[#CEFF00] text-[var(--text-primary)] shadow-sm'
                            : 'bg-[var(--chip-bg)] border-[var(--border-card)] text-[var(--text-secondary)] hover:border-[var(--text-muted)]'
                        }`}
                      >
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-xs font-bold font-mono text-[var(--text-primary)]">
                            {item.label}
                          </span>
                          <span className="text-[10px] font-mono text-volt-adaptive font-bold">
                            ×{item.multiplier}
                          </span>
                        </div>
                        <p className="text-[11px] text-[var(--text-muted)] leading-relaxed">
                          {item.desc}
                        </p>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          {/* STEP 3: TDEE Estimate & Caloric Budget */}
          {step === 3 && (
            <div className="space-y-6">
              <div className="text-xs text-[var(--text-secondary)] leading-relaxed">
                Here is your calculated Total Daily Energy Expenditure (TDEE) and target caloric budget for your chosen goal ({goal.toUpperCase()}).
              </div>

              {/* TDEE Summary Metric Cards */}
              <div className="reshape-card-subtle p-5 grid grid-cols-1 sm:grid-cols-3 gap-4 text-center items-center">
                <div className="space-y-1">
                  <span className="text-[10px] font-mono uppercase text-[var(--text-muted)]">
                    Basal Metabolic Rate (BMR)
                  </span>
                  <div className="text-2xl font-bold font-mono text-[var(--text-primary)]">
                    {tdeeResult.bmr} <span className="text-xs font-normal text-[var(--text-muted)]">kcal</span>
                  </div>
                  <p className="text-[10px] text-[var(--text-muted)]">
                    {tdeeResult.formulaUsed === 'katch_mcardle' ? 'Katch-McArdle (LBM)' : 'Mifflin-St Jeor'}
                  </p>
                </div>

                <div className="space-y-1 sm:border-x border-[var(--border-card)] sm:px-4">
                  <span className="text-[10px] font-mono uppercase text-volt-adaptive font-bold">
                    Daily Maintenance TDEE
                  </span>
                  <div className="text-3xl font-extrabold font-mono text-volt-adaptive">
                    {tdeeResult.dailyTdee} <span className="text-xs font-normal text-[var(--text-muted)]">kcal/day</span>
                  </div>
                  <p className="text-[10px] text-[var(--text-muted)]">Burned with {tdeeResult.activityLabel}</p>
                </div>

                <div className="space-y-1">
                  <span className="text-[10px] font-mono uppercase text-sky-400 font-bold">
                    Total Weekly Expenditure
                  </span>
                  <div className="text-2xl font-bold font-mono text-sky-400">
                    {tdeeResult.weeklyTdee.toLocaleString()} <span className="text-xs font-normal text-[var(--text-muted)]">kcal/wk</span>
                  </div>
                  <p className="text-[10px] text-[var(--text-muted)]">Cumulative 7-day caloric expenditure</p>
                </div>
              </div>

              {/* Weekly Calorie & Weight Balance Dashboard */}
              <div className="reshape-card-subtle p-5 space-y-4">
                <div className="flex items-center justify-between border-b border-[var(--border-card)] pb-3">
                  <span className="text-xs font-mono uppercase tracking-wider text-[var(--text-muted)]">
                    Target Caloric Intake &amp; Weight Projection
                  </span>
                  <span className="text-xs font-mono font-bold text-volt-adaptive">
                    Energy Balance Trajectory
                  </span>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-center">
                  <div className="p-3 rounded-xl bg-[var(--bg-canvas)] border border-[var(--border-card)]">
                    <span className="text-[10px] font-mono uppercase text-[var(--text-muted)] block">Daily Calorie Target</span>
                    <span className="text-xl font-bold font-mono text-[var(--text-primary)] mt-1 block">
                      {plan.targetCalories} <span className="text-xs text-[var(--text-muted)]">kcal</span>
                    </span>
                  </div>

                  <div className="p-3 rounded-xl bg-[var(--bg-canvas)] border border-[var(--border-card)]">
                    <span className="text-[10px] font-mono uppercase text-[var(--text-muted)] block">Weekly Caloric Budget</span>
                    <span className="text-xl font-bold font-mono text-[var(--text-primary)] mt-1 block">
                      {plan.weeklyTargetCalories.toLocaleString()} <span className="text-xs text-[var(--text-muted)]">kcal</span>
                    </span>
                  </div>

                  <div className="p-3 rounded-xl bg-[var(--bg-canvas)] border border-[var(--border-card)]">
                    <span className="text-[10px] font-mono uppercase text-[var(--text-muted)] block">Net Weekly Imbalance</span>
                    <span
                      className={`text-xl font-bold font-mono mt-1 block ${
                        plan.weeklyDeficitOrSurplus < 0
                          ? 'text-amber-400'
                          : plan.weeklyDeficitOrSurplus > 0
                          ? 'text-sky-400'
                          : 'text-volt-adaptive'
                      }`}
                    >
                      {plan.weeklyDeficitOrSurplus > 0
                        ? `+${plan.weeklyDeficitOrSurplus.toLocaleString()}`
                        : plan.weeklyDeficitOrSurplus.toLocaleString()}{' '}
                      kcal
                    </span>
                  </div>

                  <div className="p-3 rounded-xl bg-[var(--bg-canvas)] border border-[var(--border-card)]">
                    <span className="text-[10px] font-mono uppercase text-[var(--text-muted)] block">Est. Scale Weight / Wk</span>
                    <span className="text-xl font-bold font-mono text-volt-adaptive mt-1 block">
                      {plan.estimatedWeeklyWeightChangeKg > 0
                        ? `+${plan.estimatedWeeklyWeightChangeKg}`
                        : plan.estimatedWeeklyWeightChangeKg}{' '}
                      kg
                    </span>
                  </div>
                </div>

                <p className="text-xs font-mono text-[var(--text-secondary)] leading-relaxed pt-1">
                  💡 {plan.rationale}
                </p>
              </div>
            </div>
          )}

          {/* STEP 4: Macronutrient Targets & Database Update */}
          {step === 4 && (
            <div className="space-y-6">
              <div className="text-xs text-[var(--text-secondary)] leading-relaxed">
                Fine-tune your protein and fat targets. Carbohydrates automatically adjust to absorb the exact remainder of your daily {plan.targetCalories} kcal budget. Review and save to update your database.
              </div>

              {/* Protein Slider & Presets */}
              <div className="reshape-card-subtle p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <label className="text-xs font-bold text-[var(--text-primary)] uppercase tracking-wider block">
                      Protein Intake Target
                    </label>
                    <span className="text-[11px] text-[var(--text-muted)] font-mono">
                      {proteinRatio}g per kg bodyweight ({Math.round(weightKg * proteinRatio)}g / day)
                    </span>
                  </div>
                  <div className="text-right">
                    <span className="text-xl font-bold font-mono text-volt-adaptive">
                      {plan.proteinGrams}g
                    </span>
                    <span className="text-[11px] font-mono text-[var(--text-muted)] ml-2">
                      ({plan.proteinPercent}% · {plan.proteinGrams * 4} kcal)
                    </span>
                  </div>
                </div>

                <input
                  type="range"
                  min="1.6"
                  max="2.8"
                  step="0.1"
                  value={proteinRatio}
                  onChange={(e) => setProteinRatio(parseFloat(e.target.value))}
                  className="w-full accent-[#CEFF00] cursor-pointer"
                />

                <div className="flex items-center gap-2 pt-1">
                  {[
                    { label: 'Standard (1.8g/kg)', val: 1.8 },
                    { label: 'Hypertrophy (2.2g/kg)', val: 2.2 },
                    { label: 'High Satiety (2.5g/kg)', val: 2.5 }
                  ].map((preset) => (
                    <button
                      key={preset.val}
                      type="button"
                      onClick={() => setProteinRatio(preset.val)}
                      className={`flex-1 py-1 text-xs font-mono font-semibold rounded-lg transition-colors ${
                        proteinRatio === preset.val
                          ? 'bg-[#CEFF00] text-black font-bold'
                          : 'bg-[var(--chip-bg)] text-[var(--text-secondary)] hover:bg-[var(--chip-hover)]'
                      }`}
                    >
                      {preset.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Fat Ratio Slider */}
              <div className="reshape-card-subtle p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <label className="text-xs font-bold text-[var(--text-primary)] uppercase tracking-wider block">
                      Healthy Fats Allocation
                    </label>
                    <span className="text-[11px] text-[var(--text-muted)] font-mono">
                      {fatPercent}% of daily calories (endocrine &amp; hormonal support)
                    </span>
                  </div>
                  <div className="text-right">
                    <span className="text-xl font-bold font-mono text-amber-400">
                      {plan.fatGrams}g
                    </span>
                    <span className="text-[11px] font-mono text-[var(--text-muted)] ml-2">
                      ({plan.fatPercent}% · {plan.fatGrams * 9} kcal)
                    </span>
                  </div>
                </div>

                <input
                  type="range"
                  min="18"
                  max="35"
                  step="1"
                  value={fatPercent}
                  onChange={(e) => setFatPercent(parseInt(e.target.value, 10))}
                  className="w-full accent-amber-400 cursor-pointer"
                />

                <div className="flex items-center gap-2 pt-1">
                  {[
                    { label: 'Low Fat (20%)', val: 20 },
                    { label: 'Balanced (25%)', val: 25 },
                    { label: 'Higher Fat (30%)', val: 30 }
                  ].map((preset) => (
                    <button
                      key={preset.val}
                      type="button"
                      onClick={() => setFatPercent(preset.val)}
                      className={`flex-1 py-1 text-xs font-mono font-semibold rounded-lg transition-colors ${
                        fatPercent === preset.val
                          ? 'bg-amber-400 text-black font-bold'
                          : 'bg-[var(--chip-bg)] text-[var(--text-secondary)] hover:bg-[var(--chip-hover)]'
                      }`}
                    >
                      {preset.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Carbohydrates Dynamic Remainder */}
              <div className="reshape-card-subtle p-4 flex items-center justify-between">
                <div>
                  <label className="text-xs font-bold text-[var(--text-primary)] uppercase tracking-wider block">
                    Carbohydrates (Dynamic Energy Remainder)
                  </label>
                  <span className="text-[11px] text-[var(--text-muted)] font-mono">
                    Powers muscular glycogen stores and workout intensity
                  </span>
                </div>
                <div className="text-right">
                  <span className="text-xl font-bold font-mono text-sky-400">
                    {plan.carbsGrams}g
                  </span>
                  <span className="text-[11px] font-mono text-[var(--text-muted)] ml-2">
                    ({plan.carbsPercent}% · {plan.carbsGrams * 4} kcal)
                  </span>
                </div>
              </div>

              {/* Visual Macro Split Breakdown Bar */}
              <div className="space-y-2">
                <div className="flex items-center justify-between text-xs font-mono text-[var(--text-secondary)]">
                  <span>Macro Ratio Split</span>
                  <span>{plan.proteinPercent}% Pro · {plan.carbsPercent}% Carb · {plan.fatPercent}% Fat</span>
                </div>
                <div className="w-full h-4 rounded-full overflow-hidden flex border border-[var(--border-card)]">
                  <div
                    style={{ width: `${plan.proteinPercent}%` }}
                    className="bg-[#CEFF00] h-full"
                    title={`Protein: ${plan.proteinPercent}%`}
                  />
                  <div
                    style={{ width: `${plan.carbsPercent}%` }}
                    className="bg-sky-400 h-full"
                    title={`Carbs: ${plan.carbsPercent}%`}
                  />
                  <div
                    style={{ width: `${plan.fatPercent}%` }}
                    className="bg-amber-400 h-full"
                    title={`Fat: ${plan.fatPercent}%`}
                  />
                </div>
              </div>

              {/* Comparison Card: Current vs Proposed */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {/* Current */}
                <div className="reshape-card-subtle p-4 space-y-3 opacity-80">
                  <div className="text-[10px] font-mono uppercase tracking-wider text-[var(--text-muted)]">
                    Current Targets In Database
                  </div>
                  <div className="text-2xl font-bold font-mono text-[var(--text-secondary)]">
                    {profile.dailyCalorieTarget || 2600} <span className="text-xs text-[var(--text-muted)] font-normal">kcal</span>
                  </div>
                  <div className="grid grid-cols-3 gap-2 text-center text-xs font-mono pt-2 border-t border-[var(--border-card)]">
                    <div>
                      <span className="text-[10px] text-[var(--text-muted)] block">PRO</span>
                      <span className="font-bold text-[var(--text-secondary)]">{profile.dailyProteinTarget || 165}g</span>
                    </div>
                    <div>
                      <span className="text-[10px] text-[var(--text-muted)] block">CARB</span>
                      <span className="font-bold text-[var(--text-secondary)]">{profile.dailyCarbsTarget || 300}g</span>
                    </div>
                    <div>
                      <span className="text-[10px] text-[var(--text-muted)] block">FAT</span>
                      <span className="font-bold text-[var(--text-secondary)]">{profile.dailyFatTarget || 65}g</span>
                    </div>
                  </div>
                </div>

                {/* Proposed New Targets */}
                <div className="reshape-card-subtle p-4 space-y-3 border-2 border-[#CEFF00]">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-mono uppercase tracking-wider text-volt-adaptive font-bold">
                      New Calibrated Targets
                    </span>
                    <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-[#CEFF00] text-black uppercase">
                      {goal}
                    </span>
                  </div>
                  <div className="text-3xl font-extrabold font-mono text-[var(--text-primary)]">
                    {plan.targetCalories} <span className="text-xs text-volt-adaptive font-normal">kcal / day</span>
                  </div>
                  <div className="grid grid-cols-3 gap-2 text-center text-xs font-mono pt-2 border-t border-[var(--border-card)]">
                    <div className="p-1 rounded bg-[var(--bg-canvas)]">
                      <span className="text-[10px] text-volt-adaptive font-bold block">PRO</span>
                      <span className="font-bold text-[var(--text-primary)]">{plan.proteinGrams}g</span>
                    </div>
                    <div className="p-1 rounded bg-[var(--bg-canvas)]">
                      <span className="text-[10px] text-sky-400 font-bold block">CARB</span>
                      <span className="font-bold text-[var(--text-primary)]">{plan.carbsGrams}g</span>
                    </div>
                    <div className="p-1 rounded bg-[var(--bg-canvas)]">
                      <span className="text-[10px] text-amber-400 font-bold block">FAT</span>
                      <span className="font-bold text-[var(--text-primary)]">{plan.fatGrams}g</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer Navigation Buttons */}
        <div className="p-4 sm:p-5 border-t border-[var(--border-card)] bg-[var(--bg-subtle)] flex items-center justify-between">
          <div>
            {step > 1 ? (
              <button
                type="button"
                onClick={() => setStep((s) => (s - 1) as any)}
                className="flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--chip-bg)] transition-colors"
              >
                <ArrowLeft className="w-4 h-4" />
                <span>Previous</span>
              </button>
            ) : (
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 rounded-xl text-xs font-semibold text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
              >
                Cancel
              </button>
            )}
          </div>

          <div>
            {step < 4 ? (
              <button
                type="button"
                onClick={() => setStep((s) => (s + 1) as any)}
                className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-[#CEFF00] hover:bg-[#b8e600] text-black font-bold text-xs uppercase tracking-wider transition-colors shadow-sm"
              >
                <span>Continue</span>
                <ArrowRight className="w-4 h-4" />
              </button>
            ) : (
              <button
                type="button"
                disabled={isSavedSuccess}
                onClick={handleApplyPlan}
                className="flex items-center gap-2 px-6 py-2.5 rounded-xl bg-[#CEFF00] hover:bg-[#b8e600] text-black font-bold text-xs uppercase tracking-wider transition-colors shadow-md shadow-[#CEFF00]/20 disabled:opacity-80"
              >
                <Check className="w-4 h-4 stroke-[3]" />
                <span>{isSavedSuccess ? 'Targets Saved!' : 'Update Daily Targets in Database'}</span>
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
