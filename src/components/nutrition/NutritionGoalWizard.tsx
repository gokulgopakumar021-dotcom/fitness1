import React, { useEffect, useRef, useState } from 'react';
import { ArrowRight, ArrowLeft, Check, Scale, TrendingDown, TrendingUp, Info, ShieldCheck } from 'lucide-react';
import { BodyMetricEntry, DailyNutritionLog, PrimaryGoal, UserProfile } from '../../types';
import { db } from '../../storage/db';
import {
  ActivityLevel,
  ACTIVITY_MULTIPLIERS,
  computeNutritionPlan,
  DeficitOrSurplusPace,
  INPUT_BOUNDS,
  NutritionGoal,
  parseNumericInput,
  SUPPORTED_SEXES
} from '../../utils/tdeeEngine';
import { commitNutritionTargets, getCurrentDayKey } from '../../storage/nutritionTargetCommit';
import { kgToLbs, lbsToKg } from '../../utils/calculations';
import { Badge, Button, Card, Input, Modal, Select } from '../ui';
import { MACRO_META } from './MacroBar';

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
  // Numeric fields are held as text so an empty or malformed field can never silently become 0.
  const [weightInput, setWeightInput] = useState<string>(() =>
    profile.currentWeightKg > 0
      ? String(unit === 'lbs' ? kgToLbs(profile.currentWeightKg) : profile.currentWeightKg)
      : ''
  );
  const [heightInput, setHeightInput] = useState<string>(() =>
    profile.heightCm > 0 ? String(profile.heightCm) : ''
  );
  const [ageInput, setAgeInput] = useState<string>(() => (profile.age > 0 ? String(profile.age) : ''));
  // A supported stored value is shown as-is. A missing or unsupported stored value becomes '' (the "Select"
  // placeholder) in this local state only: it fails validation and is never displayed as, or silently
  // converted to, 'male'. The stored profile is not touched unless the user saves a valid plan.
  const [sex, setSex] = useState<string>(() =>
    (SUPPORTED_SEXES as readonly string[]).includes(profile.sex) ? profile.sex : ''
  );
  const [activityLevel, setActivityLevel] = useState<ActivityLevel>('moderate');
  const [bodyFatInput, setBodyFatInput] = useState<string>(() => {
    const bf = initialBodyFat();
    return bf === undefined ? '' : String(bf);
  });

  // Step 3 & 4: Macro Distribution
  const [proteinRatio, setProteinRatio] = useState<number>(goal === 'cut' ? 2.2 : goal === 'bulk' ? 2.0 : 1.9);
  const [fatPercent, setFatPercent] = useState<number>(25);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved'>('idle');
  const [saveError, setSaveError] = useState<string | null>(null);
  const [confirmedPlanKey, setConfirmedPlanKey] = useState<string>('');
  const savingRef = useRef<boolean>(false);

  // Each time the wizard opens, clear save state from any previous session.
  useEffect(() => {
    if (isOpen) {
      savingRef.current = false;
      setSaveStatus('idle');
      setSaveError(null);
      setConfirmedPlanKey('');
    }
  }, [isOpen]);

  if (!isOpen) return null;

  // Parse text inputs. Empty or malformed text is NaN (invalid), never 0 or a default.
  const weightDisplay = parseNumericInput(weightInput);
  const weightKg = unit === 'lbs' ? lbsToKg(weightDisplay) : weightDisplay;
  const heightCm = parseNumericInput(heightInput);
  const age = parseNumericInput(ageInput);
  // Blank body fat = not provided (Mifflin-St Jeor fallback); malformed text stays NaN and is flagged.
  const bodyFat: number | undefined = bodyFatInput.trim() === '' ? undefined : parseNumericInput(bodyFatInput);

  // Validated calculation: invalid inputs produce errors and no plan.
  const computed = computeNutritionPlan(
    {
      weightKg,
      heightCm,
      age,
      sex,
      activityLevel,
      bodyFatPercentage: bodyFat,
      proteinRatioGramsPerKg: proteinRatio,
      fatPercentOfCalories: fatPercent,
      goal,
      pace,
      customCalorieAdjustment: customCalorieOffset
    },
    { weightUnit: unit }
  );
  const tdeeResult = computed.ok ? computed.tdee : undefined;
  const plan = computed.ok ? computed.plan : undefined;
  const inputErrors = computed.ok ? {} : computed.errors;
  const planKey = plan
    ? `${plan.targetCalories}|${plan.proteinGrams}|${plan.carbsGrams}|${plan.fatGrams}|${plan.requestedCalorieDelta}`
    : '';
  const needsConfirmation = !!plan?.constrained && confirmedPlanKey !== planKey;

  const dayKey = getCurrentDayKey();
  const viewingPastDate = !!currentLog && currentLog.date !== dayKey;
  const weightMinDisplay = unit === 'lbs' ? Math.ceil(kgToLbs(INPUT_BOUNDS.weightKg.min)) : INPUT_BOUNDS.weightKg.min;
  const weightMaxDisplay = unit === 'lbs' ? Math.floor(kgToLbs(INPUT_BOUNDS.weightKg.max)) : INPUT_BOUNDS.weightKg.max;

  // Apply changes to storage and parent. Success is reported only after every required write succeeded.
  const handleApplyPlan = () => {
    if (savingRef.current || saveStatus !== 'idle') return; // block duplicate submissions
    if (!computed.ok) {
      setStep(2);
      return;
    }
    const p = computed.plan;
    if (p.constrained && confirmedPlanKey !== planKey) {
      setSaveError('Please confirm that you understand these targets differ from what was requested.');
      return;
    }

    savingRef.current = true;
    setSaveStatus('saving');
    setSaveError(null);

    const mappedGoal: PrimaryGoal =
      goal === 'cut' ? 'fat_loss' : goal === 'bulk' ? 'muscle_gain' : 'maintenance';

    const updatedProfile: UserProfile = {
      ...profile,
      currentWeightKg: Number(weightKg.toFixed(1)),
      heightCm,
      age,
      sex: sex as UserProfile['sex'], // validated by computeNutritionPlan (computed.ok) before reaching here
      primaryGoal: mappedGoal,
      // A blank body-fat field never erases a stored value
      bodyFatPercentage: bodyFat !== undefined ? bodyFat : profile.bodyFatPercentage,
      dailyCalorieTarget: p.targetCalories,
      dailyProteinTarget: p.proteinGrams,
      dailyCarbsTarget: p.carbsGrams,
      dailyFatTarget: p.fatGrams
    };

    const existingToday = db.getBodyMetrics().find((m) => m.date === dayKey);
    const metricEntry: BodyMetricEntry = {
      id: `metric_${Date.now()}`,
      date: dayKey,
      weightKg: Number(weightKg.toFixed(1)),
      ...(bodyFat !== undefined ? { bodyFatPercentage: bodyFat } : {}),
      bmi: Number((weightKg / Math.pow(heightCm / 100, 2)).toFixed(1)),
      // Do not replace notes the user already wrote on today's entry
      ...(existingToday?.notes ? {} : { notes: `Updated via Nutrition Goal Wizard (${goal.toUpperCase()})` })
    };

    const result = commitNutritionTargets(db, {
      profile: updatedProfile,
      viewedLog: currentLog,
      targets: {
        calories: p.targetCalories,
        protein: p.proteinGrams,
        carbs: p.carbsGrams,
        fat: p.fatGrams
      },
      metric: metricEntry,
      dayKey
    });

    // Only today's log is ever handed back for the view to adopt
    const logForParent = result.viewingPastDate ? undefined : result.todayLog;

    if (result.ok) {
      setSaveStatus('saved');
      onTargetsUpdated(result.profile, logForParent);
      onClose();
      return;
    }

    // Failure: stay open and allow retry. If the profile did persist, keep the parent mirroring storage.
    savingRef.current = false;
    setSaveStatus('idle');
    setSaveError(result.message ?? 'Your targets could not be saved. Please try again.');
    if (result.persisted.profile) {
      onTargetsUpdated(result.profile, logForParent);
    }
  };

  const bodyFatPresets = [
    { label: '8–11%', sub: 'Competition / Shredded', value: 10 },
    { label: '12–15%', sub: 'Athletic / Visible Abs', value: 14 },
    { label: '16–20%', sub: 'Lean & Defined', value: 18 },
    { label: '21–25%', sub: 'Healthy / Moderate', value: 23 },
    { label: '26%+', sub: 'Higher Mass', value: 27 }
  ];

  const stepTitles: Record<1 | 2 | 3 | 4, string> = {
    1: '1. Set Your Goal & Trajectory',
    2: '2. Weight, Activity & Body Fat %',
    3: '3. TDEE Estimate & Caloric Budget',
    4: '4. Macronutrient Targets & Database Commit'
  };
  const stepLabels = [
    { num: 1, label: 'Goal' },
    { num: 2, label: 'Composition' },
    { num: 3, label: 'TDEE' },
    { num: 4, label: 'Macros & Save' }
  ];
  const goalCards: Array<{
    id: NutritionGoal;
    title: string;
    badge: string;
    desc: string;
    icon: React.ComponentType<{ className?: string }>;
  }> = [
    {
      id: 'cut',
      title: 'Cut (Fat Loss)',
      badge: 'Caloric Deficit',
      desc: 'Prescribes a targeted energy deficit to oxidize body fat while holding high protein to preserve skeletal muscle mass.',
      icon: TrendingDown
    },
    {
      id: 'maintain',
      title: 'Maintain (Equilibrium)',
      badge: 'Energy Balance',
      desc: 'Matches exact daily expenditure for stable scale weight, athletic power, rapid recovery, and body recomposition.',
      icon: Scale
    },
    {
      id: 'bulk',
      title: 'Bulk (Hypertrophy)',
      badge: 'Caloric Surplus',
      desc: 'Prescribes an optimal surplus to fuel progressive overload, glycogen saturation, and myofibrillar muscle hypertrophy.',
      icon: TrendingUp
    }
  ];

  const selectableClass = (selected: boolean) =>
    `text-left rounded-control border transition-colors ${
      selected ? 'border-accent bg-accent/10' : 'border-line bg-surface-2 hover:border-line-strong'
    }`;
  const fieldErrors = [inputErrors.activityLevel, inputErrors.calculation].filter(Boolean) as string[];

  return (
    <Modal
      open={isOpen}
      onClose={onClose}
      closeLabel="Close Wizard"
      size="lg"
      title={stepTitles[step]}
      description="Goal & TDEE Wizard"
      footer={
        <div className="flex w-full items-center justify-between gap-2">
          {step > 1 ? (
            <Button variant="ghost" onClick={() => setStep((s) => (s - 1) as 1 | 2 | 3 | 4)} icon={<ArrowLeft className="w-4 h-4" aria-hidden />}>
              Previous
            </Button>
          ) : (
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
          )}

          {step < 4 ? (
            <Button disabled={step === 2 && !computed.ok} onClick={() => setStep((s) => (s + 1) as 1 | 2 | 3 | 4)}>
              <span>Continue</span>
              <ArrowRight className="w-4 h-4" aria-hidden />
            </Button>
          ) : (
            <Button
              disabled={saveStatus !== 'idle' || !plan || needsConfirmation}
              loading={saveStatus === 'saving'}
              onClick={handleApplyPlan}
              icon={saveStatus === 'saving' ? undefined : <Check className="w-4 h-4" aria-hidden />}
            >
              <span>
                {saveStatus === 'saved' ? 'Targets Saved!' : saveStatus === 'saving' ? 'Saving…' : 'Update Daily Targets in Database'}
              </span>
            </Button>
          )}
        </div>
      }
    >
      <div className="space-y-5">
        {/* Step indicator */}
        <nav aria-label="Wizard steps" className="grid grid-cols-4 gap-1 border-b border-line -mx-5 px-5">
          {stepLabels.map((s) => {
            const isCurrent = step === s.num;
            const isDone = step > s.num;
            return (
              <button
                key={s.num}
                type="button"
                aria-current={isCurrent ? 'step' : undefined}
                onClick={() => setStep(s.num >= 3 && !computed.ok ? 2 : (s.num as 1 | 2 | 3 | 4))}
                className={`min-h-11 py-2 px-1 border-b-2 -mb-px transition-colors flex flex-col sm:flex-row items-center justify-center gap-1 text-label ${
                  isCurrent
                    ? 'border-accent text-accent font-semibold'
                    : isDone
                    ? 'border-success/50 text-zinc-300'
                    : 'border-transparent text-zinc-500 hover:text-zinc-300'
                }`}
              >
                <span
                  aria-hidden
                  className={`w-4 h-4 rounded-full flex items-center justify-center text-[10px] font-semibold ${
                    isCurrent ? 'bg-accent text-accent-ink' : isDone ? 'bg-success text-accent-ink' : 'bg-surface-3 text-zinc-400'
                  }`}
                >
                  {isDone ? '✓' : s.num}
                </span>
                <span className="truncate">{s.label}</span>
              </button>
            );
          })}
        </nav>

        {/* STEP 1: Goal (Cut / Maintain / Bulk) & pace */}
        {step === 1 && (
          <div className="space-y-5">
            <p className="text-sm text-zinc-400 leading-relaxed">
              Choose your primary objective. The engine calculates your daily calorie budget and weekly surplus or deficit using a ~7,700 kcal/kg tissue balance.
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3" role="group" aria-label="Goal">
              {goalCards.map((g) => {
                const Icon = g.icon;
                const isSel = goal === g.id;
                return (
                  <button
                    key={g.id}
                    type="button"
                    aria-pressed={isSel}
                    onClick={() => {
                      setGoal(g.id);
                      setCustomCalorieOffset(undefined);
                    }}
                    className={`${selectableClass(isSel)} p-4`}
                  >
                    <div className="flex items-center justify-between gap-2 mb-2">
                      <span className={`p-2 rounded-control bg-canvas border border-line ${isSel ? 'text-accent' : 'text-zinc-500'}`}>
                        <Icon className="w-5 h-5" />
                      </span>
                      <Badge tone={isSel ? 'accent' : 'neutral'}>{g.badge}</Badge>
                    </div>
                    <h3 className="text-sm font-semibold text-white">{g.title}</h3>
                    <p className="text-xs text-zinc-400 leading-relaxed mt-1">{g.desc}</p>
                  </button>
                );
              })}
            </div>

            {goal !== 'maintain' && (
              <Card tone="raised" pad="md" className="space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="text-xs font-semibold text-zinc-300">
                    {goal === 'cut' ? 'Fat loss deficit intensity' : 'Muscle gain surplus rate'}
                  </h3>
                  <span className="text-label font-mono font-semibold text-accent uppercase">{pace}</span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2" role="group" aria-label="Pace">
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
                  ].map((p) => {
                    const isSel = pace === p.id && customCalorieOffset === undefined;
                    return (
                      <button
                        key={p.id}
                        type="button"
                        aria-pressed={isSel}
                        onClick={() => {
                          setPace(p.id);
                          setCustomCalorieOffset(undefined);
                        }}
                        className={`${selectableClass(isSel)} p-3 min-h-11 text-center`}
                      >
                        <div className="text-xs font-mono font-semibold text-white">{p.label}</div>
                        <div className="text-label text-zinc-500 mt-0.5">{p.rate}</div>
                      </button>
                    );
                  })}
                </div>
              </Card>
            )}
          </div>
        )}

        {/* STEP 2: Body metrics, body fat & activity */}
        {step === 2 && (
          <div className="space-y-5">
            <p className="text-sm text-zinc-400 leading-relaxed">
              Provide your current weight, height, age and activity level. When body fat % is provided, your Lean Body Mass is used with the{' '}
              <strong className="text-zinc-200">Katch-McArdle equation</strong>. Otherwise the{' '}
              <strong className="text-zinc-200">Mifflin-St Jeor formula</strong> is applied.
            </p>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <Input
                label={`Weight (${unit})`}
                type="number"
                inputMode="decimal"
                mono
                step="0.5"
                min={weightMinDisplay}
                max={weightMaxDisplay}
                value={weightInput}
                error={inputErrors.weight}
                onChange={(e) => setWeightInput(e.target.value)}
              />
              <Input
                label="Height (cm)"
                type="number"
                inputMode="decimal"
                mono
                min={INPUT_BOUNDS.heightCm.min}
                max={INPUT_BOUNDS.heightCm.max}
                value={heightInput}
                error={inputErrors.height}
                onChange={(e) => setHeightInput(e.target.value)}
              />
              <Input
                label="Age (years)"
                type="number"
                inputMode="numeric"
                mono
                min={INPUT_BOUNDS.age.min}
                max={INPUT_BOUNDS.age.max}
                step="1"
                value={ageInput}
                error={inputErrors.age}
                onChange={(e) => setAgeInput(e.target.value)}
              />
              <Select
                label="Biological sex"
                aria-label="Biological Sex"
                value={sex}
                error={inputErrors.sex}
                onChange={(e) => setSex(e.target.value)}
              >
                {!(SUPPORTED_SEXES as readonly string[]).includes(sex) && (
                  <option value="" disabled>
                    Select…
                  </option>
                )}
                <option value="male">Male</option>
                <option value="female">Female</option>
                <option value="other">Other (neutral estimate)</option>
                <option value="unspecified">Unspecified (neutral estimate)</option>
              </Select>
            </div>

            {fieldErrors.length > 0 && (
              <div role="alert" className="text-xs text-danger space-y-1">
                {fieldErrors.map((msg) => (
                  <p key={msg}>{msg}</p>
                ))}
              </div>
            )}

            {/* Body fat */}
            <Card tone="raised" pad="md" className="space-y-3">
              <Input
                label="Body fat percentage (%)"
                hint="Optional. Enables the Lean Body Mass calculation and the Katch-McArdle equation."
                type="number"
                inputMode="decimal"
                mono
                step="0.5"
                min={INPUT_BOUNDS.bodyFatPercentage.min}
                max={INPUT_BOUNDS.bodyFatPercentage.max}
                placeholder="e.g. 15"
                value={bodyFatInput}
                error={inputErrors.bodyFat}
                onChange={(e) => setBodyFatInput(e.target.value)}
              />

              <div className="grid grid-cols-2 sm:grid-cols-5 gap-2" role="group" aria-label="Body fat presets">
                {bodyFatPresets.map((b) => (
                  <button
                    key={b.value}
                    type="button"
                    aria-pressed={bodyFat === b.value}
                    onClick={() => setBodyFatInput(String(b.value))}
                    className={`${selectableClass(bodyFat === b.value)} p-2.5 min-h-11`}
                  >
                    <div className="text-xs font-mono font-semibold text-white">{b.label}</div>
                    <div className="text-label text-zinc-500 truncate">{b.sub}</div>
                  </button>
                ))}
              </div>

              <div className="pt-3 border-t border-line flex flex-wrap items-center justify-between gap-2 text-xs font-mono">
                {tdeeResult?.leanBodyMassKg ? (
                  <div className="flex items-center gap-2 text-success">
                    <ShieldCheck className="w-4 h-4 shrink-0" aria-hidden />
                    <span>
                      Lean Mass: <strong>{tdeeResult.leanBodyMassKg} kg</strong> · Fat Mass:{' '}
                      <strong>{(weightKg - (tdeeResult?.leanBodyMassKg ?? 0)).toFixed(1)} kg</strong>
                    </span>
                  </div>
                ) : (
                  <div className="flex items-center gap-1.5 text-zinc-500">
                    <Info className="w-3.5 h-3.5 shrink-0" aria-hidden />
                    <span>Body fat % omitted. Applying standard Mifflin-St Jeor formula.</span>
                  </div>
                )}
                <Badge tone="neutral">
                  {!tdeeResult ? 'Check inputs' : tdeeResult.formulaUsed === 'katch_mcardle' ? 'Katch-McArdle Formula' : 'Mifflin-St Jeor Formula'}
                </Badge>
              </div>
            </Card>

            {/* Activity */}
            <div className="space-y-2">
              <h3 className="text-xs font-medium text-zinc-300">Weekly training &amp; daily movement level</h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5" role="group" aria-label="Activity level">
                {(Object.keys(ACTIVITY_MULTIPLIERS) as ActivityLevel[]).map((lvl) => {
                  const item = ACTIVITY_MULTIPLIERS[lvl];
                  const isSel = activityLevel === lvl;
                  return (
                    <button
                      key={lvl}
                      type="button"
                      aria-pressed={isSel}
                      onClick={() => setActivityLevel(lvl)}
                      className={`${selectableClass(isSel)} p-3.5`}
                    >
                      <div className="flex items-center justify-between gap-2 mb-1">
                        <span className="text-xs font-semibold text-white">{item.label}</span>
                        <span className="text-label font-mono font-semibold text-accent">×{item.multiplier}</span>
                      </div>
                      <p className="text-label text-zinc-400 leading-relaxed">{item.desc}</p>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {(step === 3 || step === 4) && !plan && (
          <div role="alert" className="text-sm text-danger">
            Some inputs in step 2 are missing or out of range, so no targets can be calculated yet. Go back and correct them.
          </div>
        )}

        {/* STEP 3: TDEE estimate & calorie budget */}
        {step === 3 && plan && tdeeResult && (
          <div className="space-y-5">
            <p className="text-sm text-zinc-400 leading-relaxed">
              Your calculated Total Daily Energy Expenditure (TDEE) and target calorie budget for your chosen goal ({goal.toUpperCase()}).
            </p>

            <Card tone="raised" pad="md" className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-center">
              <div className="space-y-1">
                <p className="text-label text-zinc-500">Basal Metabolic Rate (BMR)</p>
                <p className="text-2xl font-bold font-mono text-white tabular-nums">
                  {tdeeResult.bmr} <span className="text-xs font-normal text-zinc-500">kcal</span>
                </p>
                <p className="text-label text-zinc-500">
                  {tdeeResult.formulaUsed === 'katch_mcardle' ? 'Katch-McArdle (LBM)' : 'Mifflin-St Jeor'}
                </p>
              </div>
              <div className="space-y-1 sm:border-x border-line sm:px-4">
                <p className="text-label font-semibold text-accent">Daily Maintenance TDEE</p>
                <p className="text-3xl font-bold font-mono text-accent tabular-nums">
                  {tdeeResult.dailyTdee} <span className="text-xs font-normal text-zinc-500">kcal/day</span>
                </p>
                <p className="text-label text-zinc-500">Burned with {tdeeResult.activityLabel}</p>
              </div>
              <div className="space-y-1">
                <p className="text-label text-zinc-500">Total Weekly Expenditure</p>
                <p className="text-2xl font-bold font-mono text-white tabular-nums">
                  {tdeeResult.weeklyTdee.toLocaleString()} <span className="text-xs font-normal text-zinc-500">kcal/wk</span>
                </p>
                <p className="text-label text-zinc-500">Cumulative 7-day expenditure</p>
              </div>
            </Card>

            <Card tone="raised" pad="md" className="space-y-4">
              <h3 className="text-xs font-semibold text-zinc-300">Target intake &amp; weight projection</h3>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-center">
                <div className="p-3 rounded-control bg-canvas border border-line">
                  <p className="text-label text-zinc-500">Daily Calorie Target</p>
                  <p className="text-xl font-bold font-mono text-white tabular-nums mt-1">
                    {plan.targetCalories} <span className="text-xs text-zinc-500">kcal</span>
                  </p>
                </div>
                <div className="p-3 rounded-control bg-canvas border border-line">
                  <p className="text-label text-zinc-500">Weekly Calorie Budget</p>
                  <p className="text-xl font-bold font-mono text-white tabular-nums mt-1">
                    {plan.weeklyTargetCalories.toLocaleString()} <span className="text-xs text-zinc-500">kcal</span>
                  </p>
                </div>
                <div className="p-3 rounded-control bg-canvas border border-line">
                  <p className="text-label text-zinc-500">Net Weekly Imbalance</p>
                  <p
                    className={`text-xl font-bold font-mono tabular-nums mt-1 ${
                      plan.weeklyDeficitOrSurplus < 0 ? 'text-warning' : plan.weeklyDeficitOrSurplus > 0 ? 'text-info' : 'text-accent'
                    }`}
                  >
                    {plan.weeklyDeficitOrSurplus > 0
                      ? `+${plan.weeklyDeficitOrSurplus.toLocaleString()}`
                      : plan.weeklyDeficitOrSurplus.toLocaleString()}{' '}
                    kcal
                  </p>
                </div>
                <div className="p-3 rounded-control bg-canvas border border-line">
                  <p className="text-label text-zinc-500">Est. Scale Weight / Wk</p>
                  <p className="text-xl font-bold font-mono text-white tabular-nums mt-1">
                    {plan.estimatedWeeklyWeightChangeKg > 0 ? `+${plan.estimatedWeeklyWeightChangeKg}` : plan.estimatedWeeklyWeightChangeKg} kg
                  </p>
                </div>
              </div>

              <p className="text-xs text-zinc-300 leading-relaxed">{plan.rationale}</p>
              <p className="text-label text-zinc-500 leading-relaxed">
                TDEE and scale-weight figures are estimates from population equations and a fixed 7,700 kcal/kg approximation; they are not a precise prediction for you.
              </p>
              {plan.warnings.length > 0 && (
                <div role="alert" className="text-xs text-warning space-y-1.5 border border-warning/30 bg-warning/5 rounded-control p-3">
                  {plan.warnings.map((w) => (
                    <p key={w}>{w}</p>
                  ))}
                </div>
              )}
            </Card>
          </div>
        )}

        {/* STEP 4: Macro targets & save */}
        {step === 4 && plan && (
          <div className="space-y-5">
            <p className="text-sm text-zinc-400 leading-relaxed">
              Fine-tune your protein and fat targets. Carbohydrates automatically adjust to absorb the exact remainder of your daily {plan.targetCalories} kcal budget. Review and save to update your database.
            </p>

            <div role="note" className="text-xs text-zinc-400 leading-relaxed border border-line rounded-control p-3">
              Saving updates your profile targets and today&apos;s ({dayKey}) diary targets.
              {viewingPastDate && currentLog ? ` The diary for ${currentLog.date}, which you are viewing, will not be changed.` : ''}
            </div>

            {plan.warnings.length > 0 && (
              <div role="alert" className="text-xs text-warning space-y-1.5 border border-warning/30 bg-warning/5 rounded-control p-3">
                {plan.warnings.map((w) => (
                  <p key={w}>{w}</p>
                ))}
              </div>
            )}

            {plan.constrained && (
              <label className="flex items-start gap-3 text-xs text-zinc-200 cursor-pointer min-h-11">
                <input
                  type="checkbox"
                  checked={confirmedPlanKey === planKey}
                  onChange={(e) => setConfirmedPlanKey(e.target.checked ? planKey : '')}
                  className="mt-0.5 w-5 h-5 accent-accent shrink-0"
                />
                <span>
                  I understand these targets differ from the requested pace or do not fully add up, and I want to save them as shown.
                </span>
              </label>
            )}

            {saveError && (
              <div role="alert" className="text-xs text-danger border border-danger/30 bg-danger/5 rounded-control p-3">
                {saveError}
              </div>
            )}

            {/* Protein */}
            <Card tone="raised" pad="md" className="space-y-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <label htmlFor="wizard-protein-ratio" className="text-xs font-semibold text-zinc-200 block">
                    Protein intake target
                  </label>
                  <span className="text-label text-zinc-500 font-mono">
                    {proteinRatio}g per kg bodyweight ({Math.round(weightKg * proteinRatio)}g / day)
                  </span>
                </div>
                <div className="text-right shrink-0">
                  <span className="text-xl font-bold font-mono tabular-nums" style={{ color: MACRO_META.protein.color }}>
                    {plan.proteinGrams}g
                  </span>
                  <span className="block text-label font-mono text-zinc-500">
                    {plan.proteinPercent}% · {plan.proteinGrams * 4} kcal
                  </span>
                </div>
              </div>
              <input
                id="wizard-protein-ratio"
                type="range"
                min="1.6"
                max="2.8"
                step="0.1"
                value={proteinRatio}
                onChange={(e) => setProteinRatio(parseFloat(e.target.value))}
                className="w-full h-8 accent-accent cursor-pointer"
              />
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2" role="group" aria-label="Protein presets">
                {[
                  { label: 'Standard (1.8g/kg)', val: 1.8 },
                  { label: 'Hypertrophy (2.2g/kg)', val: 2.2 },
                  { label: 'High Satiety (2.5g/kg)', val: 2.5 }
                ].map((preset) => (
                  <Button
                    key={preset.val}
                    variant={proteinRatio === preset.val ? 'primary' : 'secondary'}
                    aria-pressed={proteinRatio === preset.val}
                    onClick={() => setProteinRatio(preset.val)}
                  >
                    {preset.label}
                  </Button>
                ))}
              </div>
            </Card>

            {/* Fat */}
            <Card tone="raised" pad="md" className="space-y-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <label htmlFor="wizard-fat-percent" className="text-xs font-semibold text-zinc-200 block">
                    Fat allocation
                  </label>
                  <span className="text-label text-zinc-500 font-mono">{fatPercent}% of daily calories</span>
                </div>
                <div className="text-right shrink-0">
                  <span className="text-xl font-bold font-mono tabular-nums" style={{ color: MACRO_META.fat.color }}>
                    {plan.fatGrams}g
                  </span>
                  <span className="block text-label font-mono text-zinc-500">
                    {plan.fatPercent}% · {plan.fatGrams * 9} kcal
                  </span>
                </div>
              </div>
              <input
                id="wizard-fat-percent"
                type="range"
                min="18"
                max="35"
                step="1"
                value={fatPercent}
                onChange={(e) => setFatPercent(parseInt(e.target.value, 10))}
                className="w-full h-8 accent-chart-4 cursor-pointer"
              />
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2" role="group" aria-label="Fat presets">
                {[
                  { label: 'Low Fat (20%)', val: 20 },
                  { label: 'Balanced (25%)', val: 25 },
                  { label: 'Higher Fat (30%)', val: 30 }
                ].map((preset) => (
                  <Button
                    key={preset.val}
                    variant={fatPercent === preset.val ? 'primary' : 'secondary'}
                    aria-pressed={fatPercent === preset.val}
                    onClick={() => setFatPercent(preset.val)}
                  >
                    {preset.label}
                  </Button>
                ))}
              </div>
            </Card>

            {/* Carbs (remainder) */}
            <Card tone="raised" pad="md" className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-xs font-semibold text-zinc-200">Carbohydrates (remainder)</p>
                <span className="text-label text-zinc-500 font-mono">Fills the rest of your calorie budget</span>
              </div>
              <div className="text-right shrink-0">
                <span className="text-xl font-bold font-mono tabular-nums" style={{ color: MACRO_META.carbs.color }}>
                  {plan.carbsGrams}g
                </span>
                <span className="block text-label font-mono text-zinc-500">
                  {plan.carbsPercent}% · {plan.carbsGrams * 4} kcal
                </span>
              </div>
            </Card>

            {/* Split bar */}
            <div className="space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-x-3 text-xs font-mono text-zinc-400">
                <span>Macro ratio split</span>
                <span className="tabular-nums">
                  {plan.proteinPercent}% Pro · {plan.carbsPercent}% Carb · {plan.fatPercent}% Fat
                </span>
              </div>
              <div className="w-full h-3 rounded-full overflow-hidden flex bg-surface-3">
                <div style={{ width: `${plan.proteinPercent}%`, backgroundColor: MACRO_META.protein.color }} className="h-full" title={`Protein: ${plan.proteinPercent}%`} />
                <div style={{ width: `${plan.carbsPercent}%`, backgroundColor: MACRO_META.carbs.color }} className="h-full" title={`Carbs: ${plan.carbsPercent}%`} />
                <div style={{ width: `${plan.fatPercent}%`, backgroundColor: MACRO_META.fat.color }} className="h-full" title={`Fat: ${plan.fatPercent}%`} />
              </div>
            </div>

            {/* Current vs proposed */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Card tone="raised" pad="md" className="space-y-3">
                <p className="text-label text-zinc-500">Current targets in database</p>
                <p className="text-2xl font-bold font-mono text-zinc-300 tabular-nums">
                  {profile.dailyCalorieTarget || 2600} <span className="text-xs text-zinc-500 font-normal">kcal</span>
                </p>
                <div className="grid grid-cols-3 gap-2 text-center text-xs font-mono pt-2 border-t border-line">
                  <div>
                    <span className="text-label text-zinc-500 block">PRO</span>
                    <span className="font-semibold text-zinc-300">{profile.dailyProteinTarget || 165}g</span>
                  </div>
                  <div>
                    <span className="text-label text-zinc-500 block">CARB</span>
                    <span className="font-semibold text-zinc-300">{profile.dailyCarbsTarget || 300}g</span>
                  </div>
                  <div>
                    <span className="text-label text-zinc-500 block">FAT</span>
                    <span className="font-semibold text-zinc-300">{profile.dailyFatTarget || 65}g</span>
                  </div>
                </div>
              </Card>

              <Card tone="accent" pad="md" className="space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-label font-semibold text-accent">New calibrated targets</p>
                  <Badge tone="accent" className="uppercase">
                    {goal}
                  </Badge>
                </div>
                <p className="text-3xl font-bold font-mono text-white tabular-nums">
                  {plan.targetCalories} <span className="text-xs text-accent font-normal">kcal / day</span>
                </p>
                <div className="grid grid-cols-3 gap-2 text-center text-xs font-mono pt-2 border-t border-line">
                  <div className="p-1 rounded-lg bg-canvas">
                    <span className="text-label font-semibold block" style={{ color: MACRO_META.protein.color }}>PRO</span>
                    <span className="font-semibold text-white">{plan.proteinGrams}g</span>
                  </div>
                  <div className="p-1 rounded-lg bg-canvas">
                    <span className="text-label font-semibold block" style={{ color: MACRO_META.carbs.color }}>CARB</span>
                    <span className="font-semibold text-white">{plan.carbsGrams}g</span>
                  </div>
                  <div className="p-1 rounded-lg bg-canvas">
                    <span className="text-label font-semibold block" style={{ color: MACRO_META.fat.color }}>FAT</span>
                    <span className="font-semibold text-white">{plan.fatGrams}g</span>
                  </div>
                </div>
              </Card>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
};
