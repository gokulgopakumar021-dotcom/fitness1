import React, { useState } from 'react';
import {
  Settings,
  User,
  Shield,
  Download,
  Upload,
  RotateCcw,
  Sliders,
  CheckCircle2,
  AlertTriangle,
  Play,
  FileSpreadsheet,
  Trash2,
  Check,
  LogOut
} from 'lucide-react';
import {
  PreferredUnit,
  PrimaryGoal,
  TrainingExperience,
  TrainingPhase,
  UserProfile
} from '../../types';
import { db } from '../../storage/db';
import { runAllAutomatedTests, TestResult } from '../../utils/testSuite';
import { resetAllAppData } from '../../storage/resetAll';
import { useAuth } from '../../context/AuthContext';

interface SettingsProps {
  profile: UserProfile;
  onProfileUpdated: (p: UserProfile) => void;
  isDemoMode: boolean;
  onLoadDemoData: () => void;
  onClearDemoData: () => void;
}

export const SettingsView: React.FC<SettingsProps> = ({
  profile,
  onProfileUpdated,
  isDemoMode,
  onLoadDemoData,
  onClearDemoData
}) => {
  const { user, signOut } = useAuth();
  const [signingOut, setSigningOut] = useState(false);
  const [signOutError, setSignOutError] = useState<string | null>(null);
  const [formData, setFormData] = useState<UserProfile>({ ...profile });
  const [saveSuccess, setSaveSuccess] = useState<boolean>(false);

  // Backup & Import
  const [importStatus, setImportStatus] = useState<string | null>(null);
  const [importError, setImportError] = useState<string | null>(null);

  // Reset confirmation
  const [showResetModal, setShowResetModal] = useState<boolean>(false);
  const [isResetting, setIsResetting] = useState<boolean>(false);
  const [resetError, setResetError] = useState<string | null>(null);

  // Automated Tests Runner state
  const [testResults, setTestResults] = useState<TestResult[] | null>(null);

  const handleSignOut = async () => {
    if (signingOut) return;
    setSigningOut(true);
    setSignOutError(null);
    const r = await signOut();
    // On success AuthGate unmounts this view, so only the failure path needs to reset state.
    if (!r.ok) {
      setSignOutError(r.error ?? 'Could not sign out.');
      setSigningOut(false);
    }
  };

  const handleSaveProfile = (e: React.FormEvent) => {
    e.preventDefault();
    db.saveProfile(formData);
    onProfileUpdated(formData);
    setSaveSuccess(true);
    setTimeout(() => setSaveSuccess(false), 2500);
  };

  const handleExportJSON = () => {
    const jsonStr = db.exportFullBackupJSON();
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `ironlog-backup-${new Date().toISOString().split('T')[0]}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleExportWorkoutsCSV = () => {
    const csvStr = db.exportWorkoutsCSV();
    const blob = new Blob([csvStr], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `ironlog-workouts-${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleExportNutritionCSV = () => {
    const csvStr = db.exportNutritionCSV();
    const blob = new Blob([csvStr], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `ironlog-nutrition-${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleExportMetricsCSV = () => {
    const csvStr = db.exportBodyMetricsCSV();
    const blob = new Blob([csvStr], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `ironlog-bodymetrics-${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleImportJSON = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImportStatus(null);
    setImportError(null);

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const content = event.target?.result as string;
        const result = db.importBackupJSON(content);
        if (result.success) {
          setImportStatus('Backup restored successfully! Updating data...');
          const newProfile = db.getProfile();
          setFormData(newProfile);
          onProfileUpdated(newProfile);
        } else {
          setImportError(result.message);
        }
      } catch (err: any) {
        setImportError(`Import error: ${err.message}`);
      }
    };
    reader.readAsText(file);
  };

  const handleResetEverything = async () => {
    setIsResetting(true);
    setResetError(null);
    try {
      // Also erases Body Scan data (IndexedDB), which localStorage.clear() cannot reach.
      await resetAllAppData();
    } catch (e) {
      setResetError(
        `${e instanceof Error ? e.message : 'Body Scan data could not be deleted.'} Nothing was reset.`
      );
      setIsResetting(false);
      return;
    }
    const cleanProfile = db.getProfile();
    setFormData(cleanProfile);
    onProfileUpdated(cleanProfile);
    setIsResetting(false);
    setShowResetModal(false);
  };

  const handleRunTests = () => {
    const results = runAllAutomatedTests();
    setTestResults(results);
  };

  return (
    <div className="space-y-6 max-w-4xl mx-auto pb-16">
      {/* Settings Top Card */}
      <div className="bg-surface-2 border border-line rounded-2xl p-5 lg:p-7">
        <div className="flex items-center gap-2 text-lime-400 text-xs font-mono font-semibold tracking-wide mb-1">
          <Settings className="w-4 h-4" />
          <span>System &amp; Athlete Preferences</span>
        </div>
        <h1 className="text-xl lg:text-2xl font-bold text-zinc-100">
          Settings &amp; Calibration
        </h1>
        <p className="text-xs text-zinc-400 mt-1">
          Configure profile biometrics, progression rule thresholds, data backups, and automated tests.
        </p>
      </div>

      {/* ACCOUNT */}
      {user && (
        <section aria-labelledby="account-heading" className="bg-surface-2 border border-line rounded-2xl p-5 lg:p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="min-w-0">
            <h3 id="account-heading" className="font-bold text-zinc-100 text-base flex items-center gap-2">
              <Shield className="w-4 h-4 text-lime-400" aria-hidden />
              <span>Account</span>
            </h3>
            <p className="text-xs text-zinc-400 mt-1 truncate">Signed in as {user.email}</p>
            <p className="text-xs text-zinc-500 mt-0.5">Signing out keeps your data on this device.</p>
            {signOutError && <p role="alert" className="text-xs text-danger mt-1">{signOutError}</p>}
          </div>
          <button
            type="button"
            onClick={handleSignOut}
            disabled={signingOut}
            className="inline-flex items-center justify-center gap-2 h-11 px-4 rounded-xl border border-line-strong text-sm font-medium text-zinc-100 hover:bg-surface-3 disabled:opacity-50"
          >
            <LogOut className="w-4 h-4" aria-hidden />
            {signingOut ? 'Signing out…' : 'Sign out'}
          </button>
        </section>
      )}

      {/* ATHLETE PROFILE FORM */}
      <form
        onSubmit={handleSaveProfile}
        className="bg-surface-2 border border-line rounded-2xl p-5 lg:p-6 space-y-5"
      >
        <div className="flex items-center justify-between pb-3 border-b border-line">
          <div className="flex items-center gap-2">
            <User className="w-4 h-4 text-lime-400" />
            <h3 className="font-bold text-zinc-100 text-base">Athlete Profile &amp; Biometrics</h3>
          </div>
          {saveSuccess && (
            <span className="text-xs font-mono text-lime-400 flex items-center gap-1 font-semibold animate-pulse">
              <Check className="w-3.5 h-3.5" />
              <span>Saved!</span>
            </span>
          )}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4 text-xs">
          <div>
            <label className="block text-zinc-400 mb-1">Athlete Name / Nickname</label>
            <input
              type="text"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              placeholder="e.g. Alex"
              className="w-full px-3 py-2 bg-surface-2 border border-line-strong rounded-xl text-zinc-100 font-bold focus:outline-none focus:border-lime-400"
            />
          </div>

          <div>
            <label className="block text-zinc-400 mb-1">Age</label>
            <input
              type="number"
              value={formData.age}
              onChange={(e) => setFormData({ ...formData, age: parseInt(e.target.value, 10) || 0 })}
              className="w-full px-3 py-2 bg-surface-2 border border-line-strong rounded-xl text-zinc-100 font-mono"
            />
          </div>

          <div>
            <label className="block text-zinc-400 mb-1">Sex (optional)</label>
            <select
              value={formData.sex}
              onChange={(e) => setFormData({ ...formData, sex: e.target.value as any })}
              className="w-full px-3 py-2 bg-surface-2 border border-line-strong rounded-xl text-zinc-200"
            >
              <option value="male">Male</option>
              <option value="female">Female</option>
              <option value="other">Other</option>
              <option value="unspecified">Unspecified</option>
            </select>
          </div>

          <div>
            <label className="block text-zinc-400 mb-1">Height (cm)</label>
            <input
              type="number"
              value={formData.heightCm}
              onChange={(e) => setFormData({ ...formData, heightCm: parseFloat(e.target.value) || 0 })}
              className="w-full px-3 py-2 bg-surface-2 border border-line-strong rounded-xl text-zinc-100 font-mono"
            />
          </div>

          <div>
            <label className="block text-zinc-400 mb-1">Current Body Weight (kg)</label>
            <input
              type="number"
              step="0.1"
              value={formData.currentWeightKg}
              onChange={(e) =>
                setFormData({ ...formData, currentWeightKg: parseFloat(e.target.value) || 0 })
              }
              className="w-full px-3 py-2 bg-surface-2 border border-line-strong rounded-xl text-zinc-100 font-mono font-bold"
            />
          </div>

          <div>
            <label className="block text-zinc-400 mb-1">Goal Weight (kg)</label>
            <input
              type="number"
              step="0.1"
              value={formData.goalWeightKg}
              onChange={(e) =>
                setFormData({ ...formData, goalWeightKg: parseFloat(e.target.value) || 0 })
              }
              className="w-full px-3 py-2 bg-surface-2 border border-line-strong rounded-xl text-zinc-100 font-mono font-bold"
            />
          </div>

          <div>
            <label className="block text-zinc-400 mb-1">Primary Fitness Goal</label>
            <select
              value={formData.primaryGoal}
              onChange={(e) => setFormData({ ...formData, primaryGoal: e.target.value as PrimaryGoal })}
              className="w-full px-3 py-2 bg-surface-2 border border-line-strong rounded-xl text-zinc-200"
            >
              <option value="muscle_gain">Muscle Gain (Hypertrophy)</option>
              <option value="fat_loss">Fat Loss (Deficit)</option>
              <option value="recomposition">Body Recomposition</option>
              <option value="maintenance">Maintenance &amp; Strength</option>
            </select>
          </div>

          <div>
            <label className="block text-zinc-400 mb-1">Training Experience</label>
            <select
              value={formData.trainingExperience}
              onChange={(e) =>
                setFormData({ ...formData, trainingExperience: e.target.value as TrainingExperience })
              }
              className="w-full px-3 py-2 bg-surface-2 border border-line-strong rounded-xl text-zinc-200"
            >
              <option value="beginner">Beginner (&lt; 1 year)</option>
              <option value="intermediate">Intermediate (1-4 years)</option>
              <option value="advanced">Advanced (4+ years)</option>
            </select>
          </div>

          <div>
            <label className="block text-zinc-400 mb-1">Training Days Per Week</label>
            <input
              type="number"
              min="1"
              max="7"
              value={formData.trainingDaysPerWeek}
              onChange={(e) =>
                setFormData({ ...formData, trainingDaysPerWeek: parseInt(e.target.value, 10) || 4 })
              }
              className="w-full px-3 py-2 bg-surface-2 border border-line-strong rounded-xl text-zinc-100 font-mono"
            />
          </div>

          <div>
            <label className="block text-zinc-400 mb-1">Preferred Unit</label>
            <select
              value={formData.preferredUnit}
              onChange={(e) =>
                setFormData({ ...formData, preferredUnit: e.target.value as PreferredUnit })
              }
              className="w-full px-3 py-2 bg-surface-2 border border-line-strong rounded-xl text-zinc-200 font-mono"
            >
              <option value="kg">Kilograms (kg)</option>
              <option value="lbs">Pounds (lbs)</option>
            </select>
          </div>

          <div>
            <label className="block text-zinc-400 mb-1">Preferred Training Time</label>
            <input
              type="text"
              value={formData.preferredTrainingTime || ''}
              onChange={(e) => setFormData({ ...formData, preferredTrainingTime: e.target.value })}
              placeholder="e.g. 06:30 AM or 17:30 PM"
              className="w-full px-3 py-2 bg-surface-2 border border-line-strong rounded-xl text-zinc-100"
            />
          </div>

          <div>
            <label className="block text-zinc-400 mb-1">Target Transformation Date</label>
            <input
              type="date"
              value={formData.targetDate || ''}
              onChange={(e) => setFormData({ ...formData, targetDate: e.target.value })}
              className="w-full px-3 py-2 bg-surface-2 border border-line-strong rounded-xl text-zinc-100 font-mono"
            />
          </div>
        </div>

        {/* NUTRITION TARGETS */}
        <div className="pt-4 border-t border-line">
          <h4 className="text-xs font-semibold text-zinc-300 tracking-wide mb-3">
            Daily Calorie &amp; Macronutrient Targets
          </h4>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
            <div>
              <label className="block text-zinc-400 mb-1">Calories (kcal)</label>
              <input
                type="number"
                value={formData.dailyCalorieTarget}
                onChange={(e) =>
                  setFormData({ ...formData, dailyCalorieTarget: parseInt(e.target.value, 10) || 0 })
                }
                className="w-full px-3 py-2 bg-surface-2 border border-line-strong rounded-xl text-zinc-100 font-mono font-bold"
              />
            </div>
            <div>
              <label className="block text-lime-400 mb-1">Protein (g)</label>
              <input
                type="number"
                value={formData.dailyProteinTarget}
                onChange={(e) =>
                  setFormData({ ...formData, dailyProteinTarget: parseInt(e.target.value, 10) || 0 })
                }
                className="w-full px-3 py-2 bg-surface-2 border border-line-strong rounded-xl text-zinc-100 font-mono font-bold"
              />
            </div>
            <div>
              <label className="block text-sky-400 mb-1">Carbs (g)</label>
              <input
                type="number"
                value={formData.dailyCarbsTarget}
                onChange={(e) =>
                  setFormData({ ...formData, dailyCarbsTarget: parseInt(e.target.value, 10) || 0 })
                }
                className="w-full px-3 py-2 bg-surface-2 border border-line-strong rounded-xl text-zinc-100 font-mono font-bold"
              />
            </div>
            <div>
              <label className="block text-amber-400 mb-1">Fat (g)</label>
              <input
                type="number"
                value={formData.dailyFatTarget}
                onChange={(e) =>
                  setFormData({ ...formData, dailyFatTarget: parseInt(e.target.value, 10) || 0 })
                }
                className="w-full px-3 py-2 bg-surface-2 border border-line-strong rounded-xl text-zinc-100 font-mono font-bold"
              />
            </div>
          </div>
        </div>

        {/* PROGRESSION ENGINE CALIBRATION RULES */}
        <div className="pt-4 border-t border-line">
          <div className="flex items-center gap-2 mb-3">
            <Sliders className="w-4 h-4 text-lime-400" />
            <h4 className="text-xs font-semibold text-zinc-300 tracking-wide">
              Progression Engine Rules &amp; Minimum Increments
            </h4>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3 text-xs">
            <div>
              <label className="block text-zinc-400 mb-1">Training Phase</label>
              <select
                value={formData.trainingPhase}
                onChange={(e) =>
                  setFormData({ ...formData, trainingPhase: e.target.value as TrainingPhase })
                }
                className="w-full px-3 py-2 bg-surface-2 border border-line-strong rounded-xl text-zinc-200 capitalize"
              >
                <option value="hypertrophy">Hypertrophy (Progressive)</option>
                <option value="strength">Strength (Lower reps)</option>
                <option value="adaptation">Adaptation (Conservative)</option>
                <option value="re_entry">Re-Entry (Recovery)</option>
                <option value="deload">Deload (-25% load)</option>
              </select>
            </div>

            <div>
              <label className="block text-zinc-400 mb-1">Barbell Min Jump ({formData.preferredUnit})</label>
              <input
                type="number"
                step="0.5"
                value={formData.minBarbellIncrement}
                onChange={(e) =>
                  setFormData({ ...formData, minBarbellIncrement: parseFloat(e.target.value) || 2.5 })
                }
                className="w-full px-3 py-2 bg-surface-2 border border-line-strong rounded-xl text-zinc-100 font-mono"
              />
            </div>

            <div>
              <label className="block text-zinc-400 mb-1">Dumbbell Min Jump ({formData.preferredUnit})</label>
              <input
                type="number"
                step="0.5"
                value={formData.minDumbbellIncrement}
                onChange={(e) =>
                  setFormData({ ...formData, minDumbbellIncrement: parseFloat(e.target.value) || 2.0 })
                }
                className="w-full px-3 py-2 bg-surface-2 border border-line-strong rounded-xl text-zinc-100 font-mono"
              />
            </div>

            <div>
              <label className="block text-zinc-400 mb-1">Machine Min Jump ({formData.preferredUnit})</label>
              <input
                type="number"
                step="0.5"
                value={formData.minMachineIncrement}
                onChange={(e) =>
                  setFormData({ ...formData, minMachineIncrement: parseFloat(e.target.value) || 2.5 })
                }
                className="w-full px-3 py-2 bg-surface-2 border border-line-strong rounded-xl text-zinc-100 font-mono"
              />
            </div>
          </div>
        </div>

        <div className="pt-3 flex justify-end">
          <button
            type="submit"
            className="touch-press px-6 py-2.5 bg-lime-400 hover:bg-lime-300 text-accent-ink font-bold text-xs rounded-xl shadow-md transition-colors"
          >
            Save All Preferences
          </button>
        </div>
      </form>

      {/* AUTOMATED CALCULATION & PROGRESSION ENGINE TESTS */}
      <div className="bg-surface-2 border border-line rounded-2xl p-5 lg:p-6 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-line">
          <div>
            <div className="flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-lime-400" />
              <h3 className="font-bold text-zinc-100 text-base">
                Automated Verification Test Suite
              </h3>
            </div>
            <p className="text-xs text-zinc-400 mt-0.5">
              Validates double progression logic, Epley 1RM math, BMI formula, and working-set volume.
            </p>
          </div>

          <button
            onClick={handleRunTests}
            className="touch-press px-4 py-2 bg-surface-3 hover:bg-zinc-700 text-lime-400 font-semibold text-xs rounded-xl flex items-center gap-1.5 transition-colors shrink-0"
          >
            <Play className="w-3.5 h-3.5 fill-lime-400" />
            <span>Run Automated Tests</span>
          </button>
        </div>

        {testResults && (
          <div className="space-y-2 pt-1 font-mono text-xs">
            {testResults.map((t, idx) => (
              <div
                key={idx}
                className={`p-3 rounded-xl border flex flex-col sm:flex-row sm:items-center justify-between gap-2 ${
                  t.passed
                    ? 'bg-lime-950/20 border-lime-500/30 text-lime-300'
                    : 'bg-rose-950/20 border-rose-500/30 text-rose-300'
                }`}
              >
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-bold">{t.name}</span>
                    <span
                      className={`text-[11px] font-bold px-1.5 py-0.5 rounded ${
                        t.passed ? 'bg-lime-400/20 text-lime-400' : 'bg-rose-500/20 text-rose-400'
                      }`}
                    >
                      {t.passed ? 'PASSED' : 'FAILED'}
                    </span>
                  </div>
                  {t.details && <p className="text-[11px] text-zinc-400 mt-0.5">{t.details}</p>}
                </div>
                <div className="text-[11px] text-zinc-400 sm:text-right shrink-0">
                  <div>Expected: {t.expected}</div>
                  <div className="text-zinc-200">Result: {t.actual}</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* DATA BACKUP & EXPORTS */}
      <div className="bg-surface-2 border border-line rounded-2xl p-5 lg:p-6 space-y-4">
        <h3 className="font-bold text-zinc-100 text-base pb-3 border-b border-line">
          Data Export, Backup &amp; Portability
        </h3>

        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3 text-xs">
          <button
            onClick={handleExportJSON}
            className="p-3 bg-surface-2 border border-line hover:border-line-strong rounded-xl text-left transition-colors space-y-1"
          >
            <Download className="w-4 h-4 text-lime-400" />
            <div className="font-bold text-zinc-200">Full JSON Backup</div>
            <p className="text-[11px] text-zinc-500">All sessions, nutrition, and plans</p>
          </button>

          <button
            onClick={handleExportWorkoutsCSV}
            className="p-3 bg-surface-2 border border-line hover:border-line-strong rounded-xl text-left transition-colors space-y-1"
          >
            <FileSpreadsheet className="w-4 h-4 text-sky-400" />
            <div className="font-bold text-zinc-200">Workouts (CSV)</div>
            <p className="text-[11px] text-zinc-500">Individual sets, weights, and reps</p>
          </button>

          <button
            onClick={handleExportNutritionCSV}
            className="p-3 bg-surface-2 border border-line hover:border-line-strong rounded-xl text-left transition-colors space-y-1"
          >
            <FileSpreadsheet className="w-4 h-4 text-amber-400" />
            <div className="font-bold text-zinc-200">Nutrition (CSV)</div>
            <p className="text-[11px] text-zinc-500">Daily food entries and macros</p>
          </button>

          <button
            onClick={handleExportMetricsCSV}
            className="p-3 bg-surface-2 border border-line hover:border-line-strong rounded-xl text-left transition-colors space-y-1"
          >
            <FileSpreadsheet className="w-4 h-4 text-lime-400" />
            <div className="font-bold text-zinc-200">Body Metrics (CSV)</div>
            <p className="text-[11px] text-zinc-500">Weight, waist, and BMI records</p>
          </button>
        </div>

        {/* RESTORE JSON BACKUP */}
        <div className="pt-4 border-t border-line">
          <label className="block text-xs font-semibold text-zinc-300 tracking-wide mb-2">
            Restore Backup from JSON
          </label>
          <div className="flex items-center gap-3">
            <label className="touch-press px-4 py-2 bg-surface-3 hover:bg-zinc-700 text-zinc-200 text-xs font-semibold rounded-xl cursor-pointer transition-colors flex items-center gap-2">
              <Upload className="w-3.5 h-3.5" />
              <span>Select Backup File</span>
              <input
                type="file"
                accept=".json"
                onChange={handleImportJSON}
                className="hidden"
              />
            </label>
            {importStatus && <span className="text-xs text-lime-400 font-mono">{importStatus}</span>}
            {importError && <span className="text-xs text-rose-400 font-mono">{importError}</span>}
          </div>
        </div>
      </div>

      {/* DEMO MODE & SYSTEM RESET */}
      <div className="bg-surface-2 border border-line rounded-2xl p-5 lg:p-6 space-y-4">
        <h3 className="font-bold text-zinc-100 text-base pb-3 border-b border-line">
          Demo Dataset &amp; Data Maintenance
        </h3>

        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
          <div>
            <div className="font-bold text-zinc-200">Demo Data Simulator</div>
            <p className="text-zinc-500 text-[11px]">
              Preview the progressive overload engine and reports using labeled sample workouts.
            </p>
          </div>

          {isDemoMode ? (
            <button
              onClick={onClearDemoData}
              className="px-4 py-2 bg-amber-500/20 border border-amber-500/40 text-amber-300 font-bold rounded-xl text-xs hover:bg-amber-500/30 transition-colors"
            >
              Clear Demo Data
            </button>
          ) : (
            <button
              onClick={onLoadDemoData}
              className="px-4 py-2 bg-surface-3 hover:bg-zinc-700 text-zinc-200 font-semibold rounded-xl text-xs transition-colors"
            >
              Load Demo Dataset
            </button>
          )}
        </div>

        <div className="pt-4 border-t border-line flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
          <div>
            <div className="font-bold text-rose-400">Clear All Stored App Data</div>
            <p className="text-zinc-500 text-[11px]">
              Irreversibly erase all training logs, body weight metrics, plans, and profile data.
            </p>
          </div>

          <button
            onClick={() => setShowResetModal(true)}
            className="px-4 py-2 bg-rose-950/40 border border-rose-900/60 text-rose-400 hover:bg-rose-900/40 font-semibold rounded-xl text-xs transition-colors"
          >
            Reset All Data
          </button>
        </div>
      </div>

      {/* Reset Confirmation Modal */}
      {showResetModal && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-surface-2 border border-line rounded-2xl p-6 max-w-sm w-full shadow-2xl space-y-4">
            <div className="flex items-center gap-3 text-rose-500">
              <AlertTriangle className="w-6 h-6" />
              <h3 className="font-bold text-zinc-100 text-base">Reset Entire Database?</h3>
            </div>
            <p className="text-xs text-zinc-400 leading-relaxed">
              This will permanently delete all your logged workouts, body weight history, nutrition records, custom routines, and any Body Scan records, photos and consent saved on this device.
            </p>
            {resetError && (
              <p role="alert" className="text-xs text-rose-400">
                {resetError}
              </p>
            )}
            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                onClick={() => {
                  setResetError(null);
                  setShowResetModal(false);
                }}
                disabled={isResetting}
                className="px-3 py-1.5 bg-surface-3 text-zinc-300 rounded-lg text-xs"
              >
                Cancel
              </button>
              <button
                onClick={handleResetEverything}
                disabled={isResetting}
                className="px-4 py-1.5 bg-rose-600 hover:bg-rose-500 disabled:opacity-60 text-white font-bold rounded-lg text-xs"
              >
                {isResetting ? 'Deleting…' : 'Yes, Delete All'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
