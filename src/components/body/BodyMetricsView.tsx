import React, { useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, Info, Minus, Pencil, Plus, Scan, Trash2, TrendingUp } from 'lucide-react';
import { BodyMetricEntry, UserProfile } from '../../types';
import { db } from '../../storage/db';
import { calculateBMI, calculateWeeklyAverageWeight, getBMICategory } from '../../utils/calculations';
import {
  BodyMetricKey,
  BodyRange,
  METRIC_LABEL,
  MIN_POINTS_FOR_TREND,
  MeasurementDraft,
  MeasurementErrors,
  MetricPoint,
  describeAge,
  filterPointsByRange,
  formatEntryDate,
  fromDisplayWeight,
  latestComparison,
  metricSeries,
  toDisplayWeight,
  validateMeasurementDraft
} from '../../utils/bodyPresentation';
import { formatDelta } from '../../utils/progressionPresentation';
import { LineChart } from '../common/Charts';
import { BodyScanFlow } from '../bodyscan/BodyScanFlow';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Input,
  Modal,
  PageHeader,
  SectionHeading,
  SegmentedControl
} from '../ui';

interface BodyMetricsProps {
  profile: UserProfile;
  onProfileUpdated: (p: UserProfile) => void;
}

const todayKey = () => new Date().toISOString().split('T')[0];
const HISTORY_PAGE = 20;

/** Direction is icon + signed text + screen-reader words, never colour alone. */
const DeltaChip: React.FC<{ value: number; unit: string; since: string }> = ({ value, unit, since }) => {
  const rounded = Number(value.toFixed(1));
  const Icon = rounded > 0 ? ArrowUp : rounded < 0 ? ArrowDown : Minus;
  const word = rounded > 0 ? 'up' : rounded < 0 ? 'down' : 'unchanged';
  return (
    <span className="inline-flex items-center gap-1 text-xs font-semibold text-zinc-300 tabular">
      <Icon className="w-3.5 h-3.5" aria-hidden />
      <span>
        {formatDelta(value)}
        {unit ? ` ${unit}` : ''}
      </span>
      <span className="text-zinc-500 font-normal">since {since}</span>
      <span className="sr-only">({word} compared with the previous entry)</span>
    </span>
  );
};

interface MeasurementCardProps {
  label: string;
  point: MetricPoint | null;
  delta: number | null;
  previousDate: string | null;
  unit: string;
  value: (stored: number) => number;
  deltaValue: (stored: number) => number;
  footer?: React.ReactNode;
  emphasis?: boolean;
  emptyHint?: string;
}

const MeasurementCard: React.FC<MeasurementCardProps> = ({
  label,
  point,
  delta,
  previousDate,
  unit,
  value,
  deltaValue,
  footer,
  emphasis,
  emptyHint
}) => (
  <Card tone={emphasis ? 'accent' : 'default'} className="flex flex-col gap-2" aria-label={label}>
    <p className="text-xs font-medium text-zinc-400">{label}</p>
    {point ? (
      <>
        <p className="flex items-baseline gap-1.5">
          <span className="text-2xl sm:text-3xl font-bold tracking-tight text-white tabular">{value(point.value)}</span>
          <span className="text-xs font-medium text-zinc-500">{unit}</span>
        </p>
        <p className="text-xs text-zinc-400">
          Logged {formatEntryDate(point.date)} <span className="text-zinc-500">({describeAge(point.date)})</span>
        </p>
        {delta !== null && previousDate ? (
          <DeltaChip value={deltaValue(delta)} unit={unit} since={formatEntryDate(previousDate)} />
        ) : (
          <p className="text-xs text-zinc-500">One entry so far. Change appears after a second one.</p>
        )}
      </>
    ) : (
      <p className="text-sm text-zinc-500">{emptyHint ?? 'Not logged yet'}</p>
    )}
    {footer}
  </Card>
);

const emptyDraft = (date: string, weight: string): MeasurementDraft => ({ date, weight, waist: '', bodyFat: '', notes: '' });

export const BodyMetricsView: React.FC<BodyMetricsProps> = ({ profile, onProfileUpdated }) => {
  const unit = profile.preferredUnit || 'kg';
  const [metrics, setMetrics] = useState<BodyMetricEntry[]>(() => db.getBodyMetrics());
  const [showBodyScan, setShowBodyScan] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  // Trends
  const [metricKey, setMetricKey] = useState<BodyMetricKey>('weight');
  const [range, setRange] = useState<BodyRange>('all');
  const [historyLimit, setHistoryLimit] = useState(HISTORY_PAGE);

  // Log / edit form
  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<MeasurementDraft>(emptyDraft(todayKey(), ''));
  const [errors, setErrors] = useState<MeasurementErrors>({});
  const [saveError, setSaveError] = useState<string | null>(null);

  // Delete confirmation
  const [pendingDelete, setPendingDelete] = useState<BodyMetricEntry | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // Height & goal
  const [heightInput, setHeightInput] = useState(profile.heightCm ? String(profile.heightCm) : '');
  const [goalInput, setGoalInput] = useState(
    profile.goalWeightKg ? String(toDisplayWeight(profile.goalWeightKg, unit)) : ''
  );
  const [targetsError, setTargetsError] = useState<{ height?: string; goal?: string }>({});
  const [targetsSaveError, setTargetsSaveError] = useState<string | null>(null);

  const weightSeries = useMemo(() => metricSeries(metrics, 'weight'), [metrics]);
  const waistSeries = useMemo(() => metricSeries(metrics, 'waist'), [metrics]);
  const bodyFatSeries = useMemo(() => metricSeries(metrics, 'bodyFat'), [metrics]);
  const seriesByKey: Record<BodyMetricKey, MetricPoint[]> = {
    weight: weightSeries,
    waist: waistSeries,
    bodyFat: bodyFatSeries
  };

  const weightCmp = latestComparison(weightSeries);
  const waistCmp = latestComparison(waistSeries);
  const bodyFatCmp = latestComparison(bodyFatSeries);
  const lastEntry = metrics.length > 0 ? metrics[metrics.length - 1] : null;

  // 7-day average ending on the latest entry, so it always includes the latest weigh-in
  // and never silently averages old records under a "7-day" label.
  const weeklyAvg =
    weightSeries.length >= 2 && weightCmp
      ? calculateWeeklyAverageWeight(
          weightSeries.map((p) => ({ date: p.date, weightKg: p.value })),
          weightCmp.latest.date
        )
      : null;

  const bmi = calculateBMI(profile.currentWeightKg, profile.heightCm);
  const bmiInfo = getBMICategory(bmi);

  /* ----------------------------- form handlers ----------------------------- */

  const openLog = () => {
    const base = weightCmp ? weightCmp.latest.value : profile.currentWeightKg;
    setEditingId(null);
    setDraft(emptyDraft(todayKey(), base > 0 ? String(toDisplayWeight(base, unit)) : ''));
    setErrors({});
    setSaveError(null);
    setNotice(null);
    setFormOpen(true);
  };

  const openEdit = (entry: BodyMetricEntry) => {
    setEditingId(entry.id);
    setDraft({
      date: entry.date,
      weight: String(toDisplayWeight(entry.weightKg, unit)),
      waist: entry.waistCm !== undefined ? String(entry.waistCm) : '',
      bodyFat: entry.bodyFatPercentage !== undefined ? String(entry.bodyFatPercentage) : '',
      notes: entry.notes ?? ''
    });
    setErrors({});
    setSaveError(null);
    setNotice(null);
    setFormOpen(true);
  };

  const closeForm = () => {
    setFormOpen(false);
    setSaveError(null);
  };

  const setField = (key: keyof MeasurementDraft) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setDraft((d) => ({ ...d, [key]: e.target.value }));

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    const found = validateMeasurementDraft(draft);
    setErrors(found);
    if (Object.keys(found).length > 0) return;

    const weightKg = fromDisplayWeight(Number(draft.weight), unit);
    const entry: BodyMetricEntry = {
      id: editingId ?? `bm-${Date.now()}`,
      date: draft.date,
      weightKg,
      waistCm: draft.waist.trim() ? Number(draft.waist) : undefined,
      bodyFatPercentage: draft.bodyFat.trim() ? Number(draft.bodyFat) : undefined,
      bmi: calculateBMI(weightKg, profile.heightCm),
      notes: draft.notes.trim() || undefined
    };

    // "Saved" is only ever said after the store reports that the write succeeded.
    if (!db.addOrUpdateBodyMetric(entry)) {
      setSaveError('Could not save this entry in the browser. Nothing was recorded. Please try again.');
      return;
    }
    const updatedList = db.getBodyMetrics();
    setMetrics(updatedList);

    // Keep the profile's current weight in step, but only when this is the newest entry. Logging or editing
    // an older date must not overwrite the weight (and BMI) of a more recent weigh-in.
    const newest = updatedList[updatedList.length - 1];
    if (newest && newest.date === entry.date) {
      const updatedProfile = { ...profile, currentWeightKg: weightKg };
      if (db.saveProfile(updatedProfile)) onProfileUpdated(updatedProfile);
    }

    setFormOpen(false);
    setNotice(`Saved entry for ${formatEntryDate(entry.date)}.`);
  };

  const confirmDelete = () => {
    if (!pendingDelete) return;
    db.deleteBodyMetric(pendingDelete.id);
    const list = db.getBodyMetrics();
    if (list.some((m) => m.id === pendingDelete.id)) {
      setDeleteError('Could not delete this entry. It is still in your history.');
      return;
    }
    setMetrics(list);
    setNotice(`Deleted entry for ${formatEntryDate(pendingDelete.date)}.`);
    setPendingDelete(null);
    setDeleteError(null);
  };

  const handleSaveTargets = (e: React.FormEvent) => {
    e.preventDefault();
    const height = Number(heightInput);
    const goalDisplay = Number(goalInput);
    const found: { height?: string; goal?: string } = {};
    if (!heightInput.trim() || !Number.isFinite(height) || height <= 0) found.height = 'Enter a height greater than 0.';
    if (!goalInput.trim() || !Number.isFinite(goalDisplay) || goalDisplay <= 0) found.goal = 'Enter a goal weight greater than 0.';
    setTargetsError(found);
    setTargetsSaveError(null);
    if (found.height || found.goal) return;

    // An untouched goal keeps its exact stored kg value instead of a rounded round-trip through lbs.
    const goalUnchanged = goalDisplay === toDisplayWeight(profile.goalWeightKg, unit);
    const updatedProfile = {
      ...profile,
      heightCm: height,
      goalWeightKg: goalUnchanged ? profile.goalWeightKg : fromDisplayWeight(goalDisplay, unit)
    };
    if (!db.saveProfile(updatedProfile)) {
      setTargetsSaveError('Could not save your height and goal in the browser. Nothing was changed.');
      return;
    }
    onProfileUpdated(updatedProfile);
    setNotice('Height and goal weight saved.');
  };

  if (showBodyScan) {
    return <BodyScanFlow profile={profile} onClose={() => setShowBodyScan(false)} />;
  }

  /* ------------------------------- trend data ------------------------------ */

  const availableKeys = (Object.keys(seriesByKey) as BodyMetricKey[]).filter((k) => seriesByKey[k].length > 0);
  const activeKey = availableKeys.includes(metricKey) ? metricKey : availableKeys[0] ?? 'weight';
  const activeSeries = seriesByKey[activeKey];
  const unitLabel = activeKey === 'weight' ? unit : activeKey === 'waist' ? 'cm' : '%';
  const displayValue = (v: number) => (activeKey === 'weight' ? toDisplayWeight(v, unit) : v);

  // Rolling average is computed over the full history, then the range is applied, so a short range
  // does not change what the average at a given date means.
  const rolling = activeKey === 'weight'
    ? weightSeries.map((p, i) =>
        calculateWeeklyAverageWeight(
          weightSeries.slice(0, i + 1).map((q) => ({ date: q.date, weightKg: q.value })),
          p.date
        )
      )
    : [];
  const visible = filterPointsByRange(
    activeSeries.map((p, i) => ({ ...p, avg: rolling[i] ?? undefined })),
    range
  );
  const chartData = visible.map((p) => ({
    date: p.date,
    value: displayValue(p.value),
    secondaryValue: p.avg !== undefined ? toDisplayWeight(p.avg, unit) : undefined,
    label: `${displayValue(p.value)} ${unitLabel}`
  }));
  const showChart = visible.length >= MIN_POINTS_FOR_TREND;
  const first = visible[0];
  const last = visible[visible.length - 1];
  const spanDelta = first && last && visible.length > 1 ? displayValue(last.value) - displayValue(first.value) : null;

  const historyRows = metrics.slice().reverse();

  /* ---------------------------------- view --------------------------------- */

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      <PageHeader
        title="Body Metrics"
        description={
          lastEntry
            ? `Last entry ${formatEntryDate(lastEntry.date)} (${describeAge(lastEntry.date)}).`
            : 'Log weight, waist and body fat to see how they change over time.'
        }
        actions={
          <>
            <Button variant="secondary" icon={<Scan className="w-4 h-4" aria-hidden />} onClick={() => setShowBodyScan(true)}>
              Body Scan
            </Button>
            <Button icon={<Plus className="w-4 h-4" aria-hidden />} onClick={openLog}>
              Log measurement
            </Button>
          </>
        }
      />

      {notice && (
        <p role="status" className="text-sm text-zinc-200 bg-surface-2 border border-line rounded-control px-4 py-3">
          {notice}
        </p>
      )}

      {/* Current measurements */}
      <section aria-label="Current measurements" className="grid grid-cols-1 min-[420px]:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">
        <MeasurementCard
          label="Weight"
          emphasis
          point={weightCmp?.latest ?? null}
          delta={weightCmp?.delta ?? null}
          previousDate={weightCmp?.previous?.date ?? null}
          unit={unit}
          value={(v) => toDisplayWeight(v, unit)}
          deltaValue={(v) => toDisplayWeight(v, unit)}
          emptyHint={
            profile.currentWeightKg > 0
              ? `${toDisplayWeight(profile.currentWeightKg, unit)} ${unit} from your profile. No weigh-in logged yet.`
              : 'No weigh-in logged yet'
          }
          footer={
            profile.goalWeightKg > 0 ? (
              <p className="text-xs text-zinc-500 tabular">
                Goal {toDisplayWeight(profile.goalWeightKg, unit)} {unit}
                {weightCmp
                  ? ` · ${Math.abs(toDisplayWeight(weightCmp.latest.value - profile.goalWeightKg, unit)).toFixed(1)} ${unit} ${
                      weightCmp.latest.value > profile.goalWeightKg ? 'above' : weightCmp.latest.value < profile.goalWeightKg ? 'below' : 'at'
                    } goal`
                  : ''}
              </p>
            ) : null
          }
        />

        {weeklyAvg !== null && weightCmp && (
          <Card className="flex flex-col gap-2" aria-label="7-day average weight">
            <p className="text-xs font-medium text-zinc-400">7-day average</p>
            <p className="flex items-baseline gap-1.5">
              <span className="text-2xl sm:text-3xl font-bold tracking-tight text-white tabular">{toDisplayWeight(weeklyAvg, unit)}</span>
              <span className="text-xs font-medium text-zinc-500">{unit}</span>
            </p>
            <p className="text-xs text-zinc-400">Weigh-ins in the 7 days to {formatEntryDate(weightCmp.latest.date)}</p>
          </Card>
        )}

        {waistSeries.length > 0 && (
          <MeasurementCard
            label="Waist"
            point={waistCmp?.latest ?? null}
            delta={waistCmp?.delta ?? null}
            previousDate={waistCmp?.previous?.date ?? null}
            unit="cm"
            value={(v) => v}
            deltaValue={(v) => v}
          />
        )}

        {bodyFatSeries.length > 0 && (
          <MeasurementCard
            label="Body fat"
            point={bodyFatCmp?.latest ?? null}
            delta={bodyFatCmp?.delta ?? null}
            previousDate={bodyFatCmp?.previous?.date ?? null}
            unit="%"
            value={(v) => v}
            deltaValue={(v) => v}
            footer={<p className="text-xs text-zinc-500">Entered by you. Not measured by Iron Log.</p>}
          />
        )}

        <Card className="flex flex-col gap-2" aria-label="Body mass index">
          <p className="text-xs font-medium text-zinc-400">BMI (screening)</p>
          {bmi > 0 ? (
            <>
              <p className="text-2xl sm:text-3xl font-bold tracking-tight text-white tabular">{bmi}</p>
              <div>
                <Badge tone="neutral">{bmiInfo.category}</Badge>
              </div>
            </>
          ) : (
            <p className="text-sm text-zinc-500">Add your height and a weight to see BMI.</p>
          )}
          <details className="text-xs text-zinc-400">
            <summary className="inline-flex items-center gap-1.5 cursor-pointer text-zinc-300 rounded-control focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent">
              <Info className="w-3.5 h-3.5" aria-hidden />
              About BMI
            </summary>
            <p className="mt-2 leading-relaxed">
              BMI = weight (kg) ÷ height (m)². It is a broad screening number. Muscle is denser than fat, so strength-trained
              people can score high at a lean body-fat level. Iron Log never estimates body fat from BMI.
            </p>
          </details>
        </Card>
      </section>

      {metrics.length === 0 ? (
        <EmptyState
          icon={<TrendingUp className="w-5 h-5" />}
          title="No measurements yet"
          description="Log your first weight, with waist and body fat if you track them. Trends and history appear here as entries build up."
          action={
            <Button icon={<Plus className="w-4 h-4" aria-hidden />} onClick={openLog}>
              Log your first measurement
            </Button>
          }
        />
      ) : (
        <>
          {/* Trends */}
          <Card as="section" aria-label="Trends" className="space-y-4">
            <SectionHeading
              title="Trends"
              description="Only dates with a recorded entry are plotted."
            />
            <div className="flex flex-wrap items-center gap-2">
              {availableKeys.length > 1 && (
                <SegmentedControl
                  ariaLabel="Measurement"
                  value={activeKey}
                  onChange={setMetricKey}
                  options={availableKeys.map((k) => ({ value: k, label: METRIC_LABEL[k] }))}
                />
              )}
              <SegmentedControl
                ariaLabel="Time range"
                value={range}
                onChange={setRange}
                options={[
                  { value: '30d', label: '30 days' },
                  { value: '90d', label: '90 days' },
                  { value: 'all', label: 'All time' }
                ]}
              />
            </div>

            {showChart ? (
              <>
                <LineChart
                  responsive
                  data={chartData}
                  title={`${METRIC_LABEL[activeKey]} (${unitLabel})`}
                  unit={unitLabel}
                  minYSpan={activeKey === 'weight' && unit === 'lbs' ? 8 : 4}
                  yTickDecimals={1}
                  targetLine={activeKey === 'weight' && profile.goalWeightKg > 0 ? toDisplayWeight(profile.goalWeightKg, unit) : undefined}
                  targetLabel={`Goal ${toDisplayWeight(profile.goalWeightKg, unit)} ${unit}`}
                  secondaryLineName={activeKey === 'weight' ? '7-day average' : undefined}
                />
                <p className="text-xs text-zinc-400 tabular">
                  {visible.length} entries from {formatEntryDate(first.date)} to {formatEntryDate(last.date)}
                  {spanDelta !== null && `: ${formatDelta(spanDelta)} ${unitLabel} overall`}.
                  {activeKey === 'weight' && ' The dashed line is the 7-day average.'} Full values are in the history below.
                </p>
              </>
            ) : activeSeries.length >= MIN_POINTS_FOR_TREND ? (
              <EmptyState
                title="Not enough entries in this range"
                description={`Only ${visible.length} ${METRIC_LABEL[activeKey].toLowerCase()} ${visible.length === 1 ? 'entry falls' : 'entries fall'} in this range.`}
                action={
                  <Button variant="secondary" size="sm" onClick={() => setRange('all')}>
                    Show all time
                  </Button>
                }
              />
            ) : (
              <div className="rounded-control border border-line bg-surface-2 p-4 space-y-2">
                <p className="text-sm text-zinc-300">
                  {activeSeries.length === 1 ? '1 entry so far.' : `${activeSeries.length} entries so far.`} Log at least{' '}
                  {MIN_POINTS_FOR_TREND} {METRIC_LABEL[activeKey].toLowerCase()} entries to see a trend line.
                </p>
                <ul className="text-sm text-zinc-300 tabular space-y-1">
                  {activeSeries.map((p) => (
                    <li key={p.id}>
                      {formatEntryDate(p.date)}: <span className="font-semibold text-white">{displayValue(p.value)} {unitLabel}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </Card>

          {/* History */}
          <Card as="section" aria-label="History" className="space-y-3">
            <SectionHeading title="History" description={`${metrics.length} ${metrics.length === 1 ? 'entry' : 'entries'}, newest first.`} />
            <ul className="divide-y divide-line">
              {historyRows.slice(0, historyLimit).map((entry) => (
                <li key={entry.id} className="py-3 flex items-start justify-between gap-3">
                  <div className="min-w-0 space-y-1">
                    <p className="text-sm font-semibold text-white">
                      {formatEntryDate(entry.date)}
                      {entry.isDemo && (
                        <Badge tone="warning" className="ml-2 align-middle">
                          Demo
                        </Badge>
                      )}
                    </p>
                    <p className="text-sm text-zinc-300 tabular">
                      {toDisplayWeight(entry.weightKg, unit)} {unit}
                      {entry.waistCm !== undefined && <span className="text-zinc-400"> · Waist {entry.waistCm} cm</span>}
                      {entry.bodyFatPercentage !== undefined && <span className="text-zinc-400"> · Body fat {entry.bodyFatPercentage}%</span>}
                    </p>
                    {entry.notes && <p className="text-xs text-zinc-500 break-words">{entry.notes}</p>}
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <Button
                      variant="ghost"
                      size="sm"
                      iconOnly
                      aria-label={`Edit entry for ${formatEntryDate(entry.date)}`}
                      onClick={() => openEdit(entry)}
                      icon={<Pencil className="w-4 h-4" aria-hidden />}
                    />
                    <Button
                      variant="ghost"
                      size="sm"
                      iconOnly
                      aria-label={`Delete entry for ${formatEntryDate(entry.date)}`}
                      onClick={() => {
                        setDeleteError(null);
                        setPendingDelete(entry);
                      }}
                      icon={<Trash2 className="w-4 h-4" aria-hidden />}
                    />
                  </div>
                </li>
              ))}
            </ul>
            {historyRows.length > historyLimit && (
              <Button variant="secondary" size="sm" onClick={() => setHistoryLimit((n) => n + HISTORY_PAGE)}>
                Show more ({historyRows.length - historyLimit} older)
              </Button>
            )}
          </Card>
        </>
      )}

      {/* Height and goal */}
      <Card as="section" aria-label="Height and goal weight">
        <form onSubmit={handleSaveTargets} className="space-y-4" noValidate>
          <SectionHeading title="Height and goal weight" description="Used for BMI and the goal marker on your weight trend." />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-w-xl">
            <Input
              label="Height (cm)"
              type="number"
              inputMode="decimal"
              mono
              value={heightInput}
              error={targetsError.height}
              onChange={(e) => setHeightInput(e.target.value)}
            />
            <Input
              label={`Goal weight (${unit})`}
              type="number"
              inputMode="decimal"
              step="0.1"
              mono
              value={goalInput}
              error={targetsError.goal}
              onChange={(e) => setGoalInput(e.target.value)}
            />
          </div>
          {targetsSaveError && (
            <p role="alert" className="text-xs text-danger">
              {targetsSaveError}
            </p>
          )}
          <Button type="submit" variant="secondary">
            Save height and goal
          </Button>
        </form>
      </Card>

      {/* Log / edit modal */}
      <Modal
        open={formOpen}
        onClose={closeForm}
        title={editingId ? 'Edit measurement' : 'Log measurement'}
        description={
          editingId
            ? 'Updates the entry for this date. Leaving an optional field blank keeps its saved value.'
            : 'Weight is required. Waist, body fat and notes are optional. Logging a date that already has an entry updates it.'
        }
        size="sm"
        closeLabel="Cancel"
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={closeForm}>
              Cancel
            </Button>
            <Button type="submit" form="body-log-form">
              {editingId ? 'Save changes' : 'Save entry'}
            </Button>
          </div>
        }
      >
        <form id="body-log-form" onSubmit={handleSave} className="space-y-4" noValidate>
          <Input
            label="Date"
            type="date"
            mono
            value={draft.date}
            onChange={setField('date')}
            error={errors.date}
            disabled={editingId !== null}
            hint={editingId ? 'The date identifies the entry, so it cannot be changed here.' : undefined}
          />
          <Input
            label={`Weight (${unit})`}
            type="number"
            inputMode="decimal"
            step="0.1"
            mono
            value={draft.weight}
            onChange={setField('weight')}
            error={errors.weight}
          />
          <Input
            label="Waist (cm), optional"
            type="number"
            inputMode="decimal"
            step="0.5"
            mono
            placeholder="e.g. 81.5"
            value={draft.waist}
            onChange={setField('waist')}
            error={errors.waist}
          />
          <Input
            label="Body fat (%), optional"
            type="number"
            inputMode="decimal"
            step="0.1"
            mono
            placeholder="e.g. 14.5"
            value={draft.bodyFat}
            onChange={setField('bodyFat')}
            error={errors.bodyFat}
            hint="Your own estimate or a scale or caliper reading."
          />
          <Input label="Notes, optional" type="text" placeholder="e.g. Post rest day" value={draft.notes} onChange={setField('notes')} />
          {saveError && (
            <p role="alert" className="text-xs text-danger">
              {saveError}
            </p>
          )}
        </form>
      </Modal>

      {/* Delete confirmation */}
      <Modal
        open={pendingDelete !== null}
        onClose={() => setPendingDelete(null)}
        title="Delete this entry?"
        description={
          pendingDelete
            ? `The entry for ${formatEntryDate(pendingDelete.date)} (${toDisplayWeight(pendingDelete.weightKg, unit)} ${unit}) will be removed from your history. This cannot be undone.`
            : undefined
        }
        size="sm"
        closeLabel="Cancel"
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setPendingDelete(null)}>
              Cancel
            </Button>
            <Button variant="danger" onClick={confirmDelete}>
              Delete entry
            </Button>
          </div>
        }
      >
        {deleteError && (
          <p role="alert" className="text-xs text-danger">
            {deleteError}
          </p>
        )}
      </Modal>
    </div>
  );
};
