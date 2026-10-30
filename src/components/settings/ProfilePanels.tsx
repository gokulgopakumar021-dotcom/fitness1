import React from 'react';
import { Input, SegmentedControl, Select } from '../ui';
import type { HeightUnit, PreferredUnit, PrimaryGoal, TrainingExperience, TrainingPhase, UserProfile } from '../../types';
import type { ProfileErrors } from '../../utils/profileValidation';
import { HeightField } from './HeightField';
import { SettingRow, SettingRows, SettingsCard } from './SettingsParts';
import { EXPERIENCE_OPTIONS, GOAL_OPTIONS, PHASE_OPTIONS, SEX_OPTIONS } from './profileOptions';

export interface FormPanelProps {
  form: UserProfile;
  errors: ProfileErrors;
  setField: <K extends keyof UserProfile>(key: K, value: UserProfile[K]) => void;
}

// Parsing is unchanged from the original form: an unparseable entry falls back to the same default as before.
const toInt = (v: string, fallback: number) => parseInt(v, 10) || fallback;
const toFloat = (v: string, fallback: number) => parseFloat(v) || fallback;

export const ProfilePanel: React.FC<FormPanelProps> = ({ form, errors, setField }) => (
  <SettingsCard title="Personal information" description="Used for your calorie, body and progress calculations.">
    <div className="grid grid-cols-2 gap-x-3 gap-y-4 sm:gap-x-4">
      <Input
        wrapperClassName="col-span-2"
        label="Name"
        value={form.name}
        placeholder="e.g. Alex"
        autoComplete="nickname"
        error={errors.name}
        onChange={(e) => setField('name', e.target.value)}
      />
      <Input
        label="Age"
        type="number"
        inputMode="numeric"
        mono
        value={form.age}
        error={errors.age}
        onChange={(e) => setField('age', toInt(e.target.value, 0))}
      />
      <Select
        label="Sex (optional)"
        value={form.sex}
        onChange={(e) => setField('sex', e.target.value as UserProfile['sex'])}
      >
        {SEX_OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </Select>
      <div className="col-span-2 sm:col-span-1 min-w-0">
        <HeightField valueCm={form.heightCm} unit={form.heightUnit} error={errors.heightCm} onChange={(cm) => setField('heightCm', cm)} />
      </div>
      <Input
        label="Current body weight (kg)"
        type="number"
        inputMode="decimal"
        step="0.1"
        mono
        value={form.currentWeightKg}
        error={errors.currentWeightKg}
        onChange={(e) => setField('currentWeightKg', toFloat(e.target.value, 0))}
      />
      <Input
        label="Goal weight (kg)"
        type="number"
        inputMode="decimal"
        step="0.1"
        mono
        value={form.goalWeightKg}
        error={errors.goalWeightKg}
        onChange={(e) => setField('goalWeightKg', toFloat(e.target.value, 0))}
      />
    </div>
  </SettingsCard>
);

export const TrainingPanel: React.FC<FormPanelProps> = ({ form, errors, setField }) => (
  <>
    <SettingsCard title="Goal & schedule" description="What you are training for and how often.">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Select
          label="Primary fitness goal"
          value={form.primaryGoal}
          onChange={(e) => setField('primaryGoal', e.target.value as PrimaryGoal)}
        >
          {GOAL_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </Select>
        <Select
          label="Training experience"
          value={form.trainingExperience}
          onChange={(e) => setField('trainingExperience', e.target.value as TrainingExperience)}
        >
          {EXPERIENCE_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </Select>
        <Input
          label="Training days per week"
          type="number"
          inputMode="numeric"
          mono
          min={1}
          max={7}
          value={form.trainingDaysPerWeek}
          error={errors.trainingDaysPerWeek}
          onChange={(e) => setField('trainingDaysPerWeek', toInt(e.target.value, 4))}
        />
        <Input
          label="Preferred training time"
          value={form.preferredTrainingTime || ''}
          placeholder="e.g. 06:30 AM or 17:30"
          onChange={(e) => setField('preferredTrainingTime', e.target.value)}
        />
        <Input
          wrapperClassName="sm:col-span-2 sm:max-w-[50%]"
          label="Target transformation date"
          type="date"
          mono
          value={form.targetDate || ''}
          onChange={(e) => setField('targetDate', e.target.value)}
        />
      </div>
    </SettingsCard>

    <SettingsCard
      title="Progression engine"
      description="The training phase and the smallest weight jump the progression engine will suggest."
    >
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Select
          wrapperClassName="sm:col-span-3"
          label="Training phase"
          value={form.trainingPhase}
          onChange={(e) => setField('trainingPhase', e.target.value as TrainingPhase)}
        >
          {PHASE_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </Select>
        <Input
          label={`Barbell min jump (${form.preferredUnit})`}
          type="number"
          inputMode="decimal"
          step="0.5"
          mono
          value={form.minBarbellIncrement}
          error={errors.minBarbellIncrement}
          onChange={(e) => setField('minBarbellIncrement', toFloat(e.target.value, 2.5))}
        />
        <Input
          label={`Dumbbell min jump (${form.preferredUnit})`}
          type="number"
          inputMode="decimal"
          step="0.5"
          mono
          value={form.minDumbbellIncrement}
          error={errors.minDumbbellIncrement}
          onChange={(e) => setField('minDumbbellIncrement', toFloat(e.target.value, 2.0))}
        />
        <Input
          label={`Machine min jump (${form.preferredUnit})`}
          type="number"
          inputMode="decimal"
          step="0.5"
          mono
          value={form.minMachineIncrement}
          error={errors.minMachineIncrement}
          onChange={(e) => setField('minMachineIncrement', toFloat(e.target.value, 2.5))}
        />
      </div>
    </SettingsCard>

    <SettingsCard title="Daily targets" description="Calories and macronutrients for your nutrition goals.">
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Input
          label="Calories (kcal)"
          type="number"
          inputMode="numeric"
          mono
          value={form.dailyCalorieTarget}
          error={errors.dailyCalorieTarget}
          onChange={(e) => setField('dailyCalorieTarget', toInt(e.target.value, 0))}
        />
        <Input
          label="Protein (g)"
          type="number"
          inputMode="numeric"
          mono
          value={form.dailyProteinTarget}
          error={errors.dailyProteinTarget}
          onChange={(e) => setField('dailyProteinTarget', toInt(e.target.value, 0))}
        />
        <Input
          label="Carbs (g)"
          type="number"
          inputMode="numeric"
          mono
          value={form.dailyCarbsTarget}
          error={errors.dailyCarbsTarget}
          onChange={(e) => setField('dailyCarbsTarget', toInt(e.target.value, 0))}
        />
        <Input
          label="Fat (g)"
          type="number"
          inputMode="numeric"
          mono
          value={form.dailyFatTarget}
          error={errors.dailyFatTarget}
          onChange={(e) => setField('dailyFatTarget', toInt(e.target.value, 0))}
        />
      </div>
    </SettingsCard>
  </>
);

export const UnitsPanel: React.FC<FormPanelProps> = ({ form, setField }) => (
  <SettingsCard title="Measurement units" description="Choose how weights and height are entered and shown.">
    <SettingRows>
      <SettingRow label="Weight unit" description="Used for weights across workouts, progression and body screens.">
        <SegmentedControl<PreferredUnit>
          ariaLabel="Weight unit"
          value={form.preferredUnit}
          onChange={(v) => setField('preferredUnit', v)}
          options={[
            { value: 'kg', label: 'Kilograms (kg)' },
            { value: 'lbs', label: 'Pounds (lbs)' }
          ]}
        />
      </SettingRow>
      <SettingRow label="Height unit" description="How height is entered and shown in your profile. It is always stored in centimetres.">
        <SegmentedControl<HeightUnit>
          ariaLabel="Height unit"
          value={form.heightUnit ?? 'cm'}
          onChange={(v) => setField('heightUnit', v)}
          options={[
            { value: 'cm', label: 'Centimetres' },
            { value: 'ft_in', label: 'Feet & inches' }
          ]}
        />
      </SettingRow>
    </SettingRows>
    <p className="text-label text-zinc-500 border-t border-line pt-3">
      Current and goal body weight are always entered in kg. Changes here are saved with the other profile settings.
    </p>
  </SettingsCard>
);
