import React, { useState, useEffect } from 'react';
import {
  Activity,
  Plus,
  Trash2,
  Calendar,
  AlertCircle,
  TrendingDown,
  TrendingUp,
  Target,
  Ruler,
  Info,
  Scan
} from 'lucide-react';
import { BodyMetricEntry, UserProfile } from '../../types';
import { db } from '../../storage/db';
import {
  calculateBMI,
  calculateWeeklyAverageWeight,
  formatWeight,
  getBMICategory
} from '../../utils/calculations';
import { LineChart } from '../common/Charts';
import { BodyScanFlow } from '../bodyscan/BodyScanFlow';

interface BodyMetricsProps {
  profile: UserProfile;
  onProfileUpdated: (p: UserProfile) => void;
}

export const BodyMetricsView: React.FC<BodyMetricsProps> = ({
  profile,
  onProfileUpdated
}) => {
  const [metrics, setMetrics] = useState<BodyMetricEntry[]>([]);
  const [showBodyScan, setShowBodyScan] = useState<boolean>(false);

  // Log new weight modal
  const [isLogModalOpen, setIsLogModalOpen] = useState<boolean>(false);
  const [logDate, setLogDate] = useState<string>(
    new Date().toISOString().split('T')[0]
  );
  const [logWeight, setLogWeight] = useState<number>(profile.currentWeightKg || 78.5);
  const [logWaist, setLogWaist] = useState<string>('');
  const [logBodyFat, setLogBodyFat] = useState<string>('');
  const [logNotes, setLogNotes] = useState<string>('');

  // Editable height & goal weight
  const [editingHeight, setEditingHeight] = useState<number>(profile.heightCm || 178);
  const [editingGoal, setEditingGoal] = useState<number>(profile.goalWeightKg || 82);

  useEffect(() => {
    setMetrics(db.getBodyMetrics());
  }, []);

  const currentBMI = calculateBMI(profile.currentWeightKg, profile.heightCm);
  const bmiInfo = getBMICategory(currentBMI);
  const weeklyAvgWeight = calculateWeeklyAverageWeight(metrics);

  // Goal weight progress
  const weightDifference = profile.currentWeightKg - profile.goalWeightKg;
  const isGainGoal = profile.goalWeightKg > profile.currentWeightKg;

  // Add / Save new metric entry
  const handleSaveMetric = () => {
    if (!logWeight || logWeight <= 0) return;

    const calculatedBmi = calculateBMI(logWeight, profile.heightCm);
    const newEntry: BodyMetricEntry = {
      id: `bm-${Date.now()}`,
      date: logDate,
      weightKg: Number(logWeight.toFixed(2)),
      waistCm: logWaist ? parseFloat(logWaist) : undefined,
      bodyFatPercentage: logBodyFat ? parseFloat(logBodyFat) : undefined,
      bmi: calculatedBmi,
      notes: logNotes.trim() || undefined
    };

    db.addOrUpdateBodyMetric(newEntry);
    const updatedList = db.getBodyMetrics();
    setMetrics(updatedList);

    // Also update current profile weight if logging today
    const updatedProfile = {
      ...profile,
      currentWeightKg: Number(logWeight.toFixed(2))
    };
    db.saveProfile(updatedProfile);
    onProfileUpdated(updatedProfile);

    setIsLogModalOpen(false);
    setLogNotes('');
  };

  const handleDeleteMetric = (id: string) => {
    db.deleteBodyMetric(id);
    setMetrics(db.getBodyMetrics());
  };

  // Update profile height and goal weight
  const handleUpdateHeightAndGoal = () => {
    const updatedProfile = {
      ...profile,
      heightCm: Number(editingHeight),
      goalWeightKg: Number(editingGoal)
    };
    db.saveProfile(updatedProfile);
    onProfileUpdated(updatedProfile);
  };

  // Prepare chart data with 7-day rolling average
  const chartData = metrics.map((m, idx) => {
    const rollingAvg = calculateWeeklyAverageWeight(metrics.slice(0, idx + 1), m.date);
    return {
      date: m.date,
      value: m.weightKg,
      secondaryValue: rollingAvg || undefined,
      label: `${m.weightKg} kg`
    };
  });

  const waistChartData = metrics
    .filter((m) => m.waistCm !== undefined)
    .map((m) => ({
      date: m.date,
      value: m.waistCm!,
      label: `${m.waistCm} cm`
    }));

  if (showBodyScan) {
    return <BodyScanFlow profile={profile} onClose={() => setShowBodyScan(false)} />;
  }

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      {/* Top Header Card */}
      <div className="bg-[#0d1117] border border-zinc-800 rounded-2xl p-5 lg:p-7 shadow-xl">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-5 border-b border-zinc-800/80">
          <div>
            <div className="flex items-center gap-2 text-lime-400 text-xs font-mono font-semibold uppercase tracking-wider mb-1">
              <Activity className="w-4 h-4" />
              <span>Physique &amp; Body Composition</span>
            </div>
            <h1 className="text-xl lg:text-2xl font-bold text-zinc-100">
              Body Metrics &amp; BMI Tracker
            </h1>
            <p className="text-xs text-zinc-400 mt-1">
              Smoothed rolling weekly averages to filter out transient hydration and glycogen fluctuations.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => setShowBodyScan(true)}
              className="touch-press px-4 py-2.5 bg-zinc-900 border border-zinc-700 hover:border-lime-400/60 text-zinc-100 font-bold text-xs sm:text-sm rounded-xl flex items-center gap-2 transition-colors"
            >
              <Scan className="w-4 h-4" aria-hidden="true" />
              <span>Body Scan</span>
            </button>
            <button
              onClick={() => {
                setLogWeight(profile.currentWeightKg);
                setIsLogModalOpen(true);
              }}
              className="touch-press px-5 py-2.5 bg-lime-400 hover:bg-lime-300 text-black font-bold text-xs sm:text-sm rounded-xl shadow-md flex items-center gap-2 transition-colors"
            >
              <Plus className="w-4 h-4 stroke-[3]" />
              <span>Log Daily Weight</span>
            </button>
          </div>
        </div>

        {/* Primary Metrics Grid */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-6">
          {/* Current Weight */}
          <div className="p-4 bg-zinc-900/70 border border-zinc-800/80 rounded-xl space-y-1">
            <span className="text-[10px] font-mono text-zinc-500 uppercase tracking-wider">Current Weight</span>
            <div className="text-2xl font-mono font-extrabold text-zinc-100">
              {profile.currentWeightKg}{' '}
              <span className="text-xs text-zinc-500 font-normal">{profile.preferredUnit}</span>
            </div>
            <div className="text-[11px] text-zinc-400 font-mono">
              Target: {profile.goalWeightKg} {profile.preferredUnit}
            </div>
          </div>

          {/* 7-Day Rolling Average */}
          <div className="p-4 bg-zinc-900/70 border border-zinc-800/80 rounded-xl space-y-1">
            <span className="text-[10px] font-mono text-sky-400 uppercase tracking-wider font-semibold">
              7-Day Rolling Avg
            </span>
            <div className="text-2xl font-mono font-extrabold text-sky-400">
              {weeklyAvgWeight ? `${weeklyAvgWeight}` : '—'}{' '}
              <span className="text-xs text-zinc-500 font-normal">{profile.preferredUnit}</span>
            </div>
            <div className="text-[11px] text-zinc-400 font-mono">
              True physiological baseline
            </div>
          </div>

          {/* Body Mass Index (BMI) */}
          <div className="p-4 bg-zinc-900/70 border border-zinc-800/80 rounded-xl space-y-1">
            <span className="text-[10px] font-mono text-zinc-500 uppercase tracking-wider">Screening BMI</span>
            <div className="text-2xl font-mono font-extrabold text-lime-400">
              {currentBMI}
            </div>
            <div className={`text-[11px] font-semibold ${bmiInfo.color}`}>
              {bmiInfo.category}
            </div>
          </div>

          {/* Goal Progress Delta */}
          <div className="p-4 bg-zinc-900/70 border border-zinc-800/80 rounded-xl space-y-1">
            <span className="text-[10px] font-mono text-zinc-500 uppercase tracking-wider">Goal Delta</span>
            <div className="text-2xl font-mono font-extrabold text-zinc-200">
              {Math.abs(weightDifference).toFixed(1)}{' '}
              <span className="text-xs text-zinc-500 font-normal">{profile.preferredUnit}</span>
            </div>
            <div className="text-[11px] text-zinc-400 font-mono">
              {weightDifference === 0
                ? 'Goal achieved!'
                : isGainGoal
                ? 'Surplus needed to reach goal'
                : 'Deficit needed to reach goal'}
            </div>
          </div>
        </div>

        {/* Scientific BMI Screening Context Notice */}
        <div className="mt-5 p-4 bg-zinc-900/40 border border-zinc-800 rounded-xl text-xs text-zinc-400 space-y-1.5 leading-relaxed">
          <div className="flex items-center gap-2 text-zinc-200 font-bold">
            <Info className="w-4 h-4 text-sky-400 shrink-0" />
            <span>Scientific Assessment &amp; Anti-Bias Notice on BMI</span>
          </div>
          <p>
            Formula: <code className="text-zinc-200 font-mono">BMI = weight (kg) / (height (m))²</code>.
            BMI is strictly a broad demographic screening tool. Because muscle tissue is significantly denser than adipose tissue, strength-trained athletes routinely register higher BMI values despite lean body fat percentages.
            IRON LOG never infers body-fat percentage from BMI.
          </p>
        </div>
      </div>

      {/* Height and Goal Weight Inline Settings */}
      <div className="bg-[#0d1117] border border-zinc-800 rounded-2xl p-5 shadow-xl">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-400 mb-3">
          Height &amp; Target Setup
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
          <div>
            <label className="block text-zinc-400 mb-1">Height (cm)</label>
            <input
              type="number"
              value={editingHeight}
              onChange={(e) => setEditingHeight(parseFloat(e.target.value) || 0)}
              className="w-full px-3 py-2 bg-zinc-900 border border-zinc-700 rounded-xl text-zinc-100 font-mono font-bold"
            />
          </div>
          <div>
            <label className="block text-zinc-400 mb-1">Goal Weight ({profile.preferredUnit})</label>
            <input
              type="number"
              step="0.5"
              value={editingGoal}
              onChange={(e) => setEditingGoal(parseFloat(e.target.value) || 0)}
              className="w-full px-3 py-2 bg-zinc-900 border border-zinc-700 rounded-xl text-zinc-100 font-mono font-bold"
            />
          </div>
          <div className="flex items-end">
            <button
              onClick={handleUpdateHeightAndGoal}
              className="w-full px-4 py-2.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 font-semibold rounded-xl transition-colors"
            >
              Update Profile Targets
            </button>
          </div>
        </div>
      </div>

      {/* WEIGHT TREND CHART */}
      <div className="bg-[#0d1117] border border-zinc-800 rounded-2xl p-5 shadow-xl space-y-4">
        <LineChart
          data={chartData}
          title="Body Weight Progression vs Goal"
          unit={profile.preferredUnit}
          targetLine={profile.goalWeightKg}
          targetLabel={`Goal: ${profile.goalWeightKg} ${profile.preferredUnit}`}
          secondaryLineName="7-Day Rolling Average"
          accentColor="#a3e635"
          emptyMessage="No body weight records logged yet. Tap 'Log Daily Weight' to begin tracking."
        />
      </div>

      {/* WAIST MEASUREMENT CHART IF DATA EXISTS */}
      {waistChartData.length > 0 && (
        <div className="bg-[#0d1117] border border-zinc-800 rounded-2xl p-5 shadow-xl space-y-4">
          <LineChart
            data={waistChartData}
            title="Waist Circumference Trend"
            unit="cm"
            accentColor="#f59e0b"
          />
        </div>
      )}

      {/* WEIGHT LOG HISTORY TABLE */}
      <div className="bg-[#0d1117] border border-zinc-800 rounded-2xl p-5 shadow-xl space-y-3">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
          Recorded Body Weight Entries ({metrics.length})
        </h3>

        {metrics.length === 0 ? (
          <div className="py-6 text-center text-zinc-500 text-xs">
            No entries recorded. Log your daily morning weight to build your baseline trend.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs font-mono">
              <thead>
                <tr className="border-b border-zinc-800 text-zinc-500 text-[11px] uppercase tracking-wider">
                  <th className="py-2 px-3">Date</th>
                  <th className="py-2 px-3">Weight ({profile.preferredUnit})</th>
                  <th className="py-2 px-3">Waist (cm)</th>
                  <th className="py-2 px-3">BMI</th>
                  <th className="py-2 px-3">Notes</th>
                  <th className="py-2 px-2 text-right"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800/60 text-zinc-300">
                {metrics
                  .slice()
                  .reverse()
                  .map((entry) => (
                    <tr key={entry.id} className="hover:bg-zinc-850/40">
                      <td className="py-2.5 px-3 font-bold text-zinc-200">
                        {entry.date}
                        {entry.isDemo && (
                          <span className="ml-2 text-[10px] text-amber-400 bg-amber-400/10 px-1 py-0.2 rounded">
                            DEMO
                          </span>
                        )}
                      </td>
                      <td className="py-2.5 px-3 text-lime-400 font-bold">{entry.weightKg}</td>
                      <td className="py-2.5 px-3 text-zinc-400">
                        {entry.waistCm ? `${entry.waistCm} cm` : '—'}
                      </td>
                      <td className="py-2.5 px-3 text-zinc-400">{entry.bmi}</td>
                      <td className="py-2.5 px-3 text-zinc-500 font-sans truncate max-w-[150px]">
                        {entry.notes || '—'}
                      </td>
                      <td className="py-2.5 px-2 text-right">
                        <button
                          onClick={() => handleDeleteMetric(entry.id)}
                          className="p-1 text-zinc-600 hover:text-rose-400 transition-colors"
                          title="Delete entry"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* LOG MODAL */}
      {isLogModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-[#12161c] border border-zinc-800 rounded-2xl p-6 max-w-sm w-full shadow-2xl space-y-4">
            <h3 className="font-bold text-zinc-100 text-base">Log Morning Weight</h3>
            <div className="space-y-3 text-xs">
              <div>
                <label className="block text-zinc-400 mb-1">Date</label>
                <input
                  type="date"
                  value={logDate}
                  onChange={(e) => setLogDate(e.target.value)}
                  className="w-full px-3 py-2 bg-zinc-900 border border-zinc-700 rounded-lg text-zinc-100 font-mono"
                />
              </div>

              <div>
                <label className="block text-zinc-400 mb-1">
                  Weight ({profile.preferredUnit})
                </label>
                <input
                  type="number"
                  step="0.1"
                  value={logWeight || ''}
                  onChange={(e) => setLogWeight(parseFloat(e.target.value) || 0)}
                  className="w-full px-3 py-2 bg-zinc-900 border border-zinc-700 rounded-lg text-zinc-100 font-bold font-mono text-base focus:outline-none focus:border-lime-400"
                />
              </div>

              <div>
                <label className="block text-zinc-400 mb-1">Waist Measurement (cm, optional)</label>
                <input
                  type="number"
                  step="0.5"
                  value={logWaist}
                  onChange={(e) => setLogWaist(e.target.value)}
                  placeholder="e.g. 81.5"
                  className="w-full px-3 py-2 bg-zinc-900 border border-zinc-700 rounded-lg text-zinc-100 font-mono"
                />
              </div>

              <div>
                <label className="block text-zinc-400 mb-1">Body Fat % (optional estimate)</label>
                <input
                  type="number"
                  step="0.1"
                  value={logBodyFat}
                  onChange={(e) => setLogBodyFat(e.target.value)}
                  placeholder="e.g. 14.5"
                  className="w-full px-3 py-2 bg-zinc-900 border border-zinc-700 rounded-lg text-zinc-100 font-mono"
                />
              </div>

              <div>
                <label className="block text-zinc-400 mb-1">Notes (optional)</label>
                <input
                  type="text"
                  value={logNotes}
                  onChange={(e) => setLogNotes(e.target.value)}
                  placeholder="e.g. Post rest day, low sodium"
                  className="w-full px-3 py-2 bg-zinc-900 border border-zinc-700 rounded-lg text-zinc-100"
                />
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                onClick={() => setIsLogModalOpen(false)}
                className="px-3 py-2 bg-zinc-800 text-zinc-300 rounded-lg text-xs"
              >
                Cancel
              </button>
              <button
                onClick={handleSaveMetric}
                className="px-4 py-2 bg-lime-400 text-black font-bold rounded-lg text-xs"
              >
                Save Record
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
