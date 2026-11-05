import React, { useRef, useState } from 'react';
import { CheckCircle2, Download, Upload, XCircle } from 'lucide-react';
import { Badge, Button, Modal } from '../ui';
import type { UserProfile } from '../../types';
import { db } from '../../storage/db';
import { resetAllAppData } from '../../storage/resetAll';
import { runAllAutomatedTests, TestResult } from '../../utils/testSuite';
import { DataControls } from './DataControls';
import { LegacyDataClaim } from './LegacyDataClaim';
import { getClaimState, readLegacyWorkoutData } from '../../storage/legacyData';
import { SettingRow, SettingRows, SettingsCard } from './SettingsParts';

interface DataPanelProps {
  isDemoMode: boolean;
  onLoadDemoData: () => void;
  onClearDemoData: () => void;
  /** Called with the stored profile after a backup restore or a full reset, so the form and the app pick it up. */
  onProfileReplaced: (profile: UserProfile) => void;
}

const today = () => new Date().toISOString().split('T')[0];

const download = (content: string, type: string, filename: string) => {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
};

const EXPORTS: { id: string; label: string; detail: string; run: () => void }[] = [
  {
    id: 'json',
    label: 'Full JSON backup',
    detail: 'All sessions, nutrition and plans. Use this to restore later.',
    run: () => download(db.exportFullBackupJSON(), 'application/json', `ironlog-backup-${today()}.json`)
  },
  {
    id: 'workouts',
    label: 'Workouts (CSV)',
    detail: 'Individual sets, weights and reps.',
    run: () => download(db.exportWorkoutsCSV(), 'text/csv', `ironlog-workouts-${today()}.csv`)
  },
  {
    id: 'nutrition',
    label: 'Nutrition (CSV)',
    detail: 'Daily food entries and macros.',
    run: () => download(db.exportNutritionCSV(), 'text/csv', `ironlog-nutrition-${today()}.csv`)
  },
  {
    id: 'metrics',
    label: 'Body metrics (CSV)',
    detail: 'Weight, waist and BMI records.',
    run: () => download(db.exportBodyMetricsCSV(), 'text/csv', `ironlog-bodymetrics-${today()}.csv`)
  }
];

/** Export, restore, targeted deletion, demo data, full reset and the verification suite. */
export const DataPanel: React.FC<DataPanelProps> = ({ isDemoMode, onLoadDemoData, onClearDemoData, onProfileReplaced }) => {
  const fileRef = useRef<HTMLInputElement>(null);
  const [importStatus, setImportStatus] = useState<string | null>(null);
  const [importError, setImportError] = useState<string | null>(null);

  const [showReset, setShowReset] = useState(false);
  const [isResetting, setIsResetting] = useState(false);
  const [resetError, setResetError] = useState<string | null>(null);

  const [testResults, setTestResults] = useState<TestResult[] | null>(null);

  const [replaceContent, setReplaceContent] = useState<string | null>(null);
  const [isReplacing, setIsReplacing] = useState(false);
  const replaceRef = useRef<HTMLInputElement>(null);
  const [resetNote, setResetNote] = useState<string | null>(null);
  const [claimOpen, setClaimOpen] = useState(false);
  const [, setClaimVersion] = useState(0);
  const legacyNow = readLegacyWorkoutData();
  const legacyCount = legacyNow.plans.length + legacyNow.sessions.length;
  const legacyClaimed = getClaimState()?.status === 'claimed';

  const handleImportJSON = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setImportStatus(null);
    setImportError(null);

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const content = event.target?.result as string;
        const result = db.importBackupJSON(content); // merges by record id; never deletes
        if (result.success) {
          setImportStatus(result.message);
          onProfileReplaced(db.getProfile());
        } else {
          setImportError(result.message);
        }
      } catch (err: any) {
        setImportError(`Import error: ${err.message}`);
      }
    };
    reader.readAsText(file);
  };

  const handlePickReplaceFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setImportStatus(null);
    setImportError(null);
    const reader = new FileReader();
    reader.onload = (event) => {
      const content = String(event.target?.result ?? '');
      try {
        const parsed = JSON.parse(content);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('not an object');
        setReplaceContent(content);
      } catch {
        setImportError('That file is not a valid backup. Nothing was changed.');
      }
    };
    reader.readAsText(file);
  };

  const confirmReplace = () => {
    if (replaceContent === null) return;
    setIsReplacing(true);
    // Backup protection: the current data is downloaded BEFORE anything is replaced.
    download(db.exportFullBackupJSON(), 'application/json', `ironlog-pre-restore-backup-${today()}.json`);
    const result = db.importBackupJSON(replaceContent, { mode: 'replace' });
    setIsReplacing(false);
    setReplaceContent(null);
    if (result.success) {
      setImportStatus(result.message);
      onProfileReplaced(db.getProfile());
    } else {
      setImportError(result.message);
    }
  };

  const closeReset = () => {
    if (isResetting) return;
    setResetError(null);
    setShowReset(false);
  };

  const handleReset = async () => {
    setIsResetting(true);
    setResetError(null);
    try {
      // Also erases Body Scan data (IndexedDB), which localStorage.clear() cannot reach.
      const pre = await resetAllAppData();
      if (pre && pre.cloudEnabled) {
        setResetNote(
          pre.cloudChecked
            ? 'Your workout data was also removed from your account.'
            : 'Your workout data was removed here. The cloud deletion is queued and finishes when this device is back online.'
        );
      }
    } catch (e) {
      setResetError(`${e instanceof Error ? e.message : 'Body Scan data could not be deleted.'} Nothing was reset.`);
      setIsResetting(false);
      return;
    }
    onProfileReplaced(db.getProfile());
    setIsResetting(false);
    setShowReset(false);
  };

  return (
    <>
      <SettingsCard title="Export & backup" description="Your data lives on this device. Download a copy any time.">
        <SettingRows>
          {EXPORTS.map((x) => (
            <SettingRow key={x.id} label={x.label} description={x.detail}>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                icon={<Download className="w-4 h-4" aria-hidden />}
                onClick={x.run}
                aria-label={`Export ${x.label}`}
              >
                Export
              </Button>
            </SettingRow>
          ))}
          <SettingRow label="Restore from JSON backup" description="Merges a backup file into your data: missing workouts and plans are added and nothing you already have is deleted.">
            <div className="flex flex-col items-start sm:items-end gap-1.5">
              <Button
                type="button"
                variant="secondary"
                size="sm"
                icon={<Upload className="w-4 h-4" aria-hidden />}
                onClick={() => fileRef.current?.click()}
              >
                Select backup file
              </Button>
              <input ref={fileRef} type="file" accept=".json" onChange={handleImportJSON} className="hidden" aria-label="Choose backup file" />
            </div>
          </SettingRow>
          <SettingRow label="Replace everything from a backup" description="Destructive: makes your workout data match a backup exactly. Anything not in the backup is deleted here and in your account. A backup of your current data downloads first.">
            <div className="flex flex-col items-start sm:items-end gap-1.5">
              <Button type="button" variant="danger" size="sm" icon={<Upload className="w-4 h-4" aria-hidden />} onClick={() => replaceRef.current?.click()}>
                Replace from backup…
              </Button>
              <input ref={replaceRef} type="file" accept=".json" onChange={handlePickReplaceFile} className="hidden" aria-label="Choose backup file to replace data with" />
            </div>
          </SettingRow>
          {legacyCount > 0 && !legacyClaimed && (
            <SettingRow label="Workouts from before you signed in" description={`${legacyNow.plans.length} plan${legacyNow.plans.length === 1 ? '' : 's'} and ${legacyNow.sessions.length} logged workout${legacyNow.sessions.length === 1 ? '' : 's'} were found on this device. Import them into your account if you want them.`}>
              <Button type="button" variant="secondary" size="sm" onClick={() => setClaimOpen(true)}>Review & import…</Button>
            </SettingRow>
          )}
        </SettingRows>
        {importStatus && (
          <p role="status" className="text-xs text-accent">
            {importStatus}
          </p>
        )}
        {importError && (
          <p role="alert" className="text-xs text-danger">
            {importError}
          </p>
        )}
      </SettingsCard>

      <DataControls />

      <LegacyDataClaim
        open={claimOpen}
        onClose={() => { setClaimOpen(false); setClaimVersion((v) => v + 1); }}
        onClaimed={() => { setClaimVersion((v) => v + 1); onProfileReplaced(db.getProfile()); }}
      />

      <SettingsCard title="Demo dataset" description="Preview the progressive overload engine and reports using labeled sample workouts.">
        <SettingRows>
          <SettingRow
            label="Demo data simulator"
            description={isDemoMode ? 'Demo data is loaded. Clear it to go back to your own data.' : 'Adds clearly labeled sample data you can remove again.'}
          >
            {isDemoMode ? (
              <Button type="button" variant="secondary" size="sm" onClick={onClearDemoData}>
                Clear demo data
              </Button>
            ) : (
              <Button type="button" variant="secondary" size="sm" onClick={onLoadDemoData}>
                Load demo dataset
              </Button>
            )}
          </SettingRow>
        </SettingRows>
      </SettingsCard>

      <SettingsCard danger title="Reset all data" description="Irreversibly erase all training logs, body weight metrics, plans and profile data on this device. Synced workout data is deleted from your account too.">
        <Button type="button" variant="danger" onClick={() => { setResetNote(null); setShowReset(true); }}>
          Reset All Data
        </Button>
        {resetNote && (
          <p role="status" className="text-xs text-accent">
            {resetNote}
          </p>
        )}
      </SettingsCard>

      <SettingsCard
        title="Verification tests"
        description="Checks double progression logic, Epley 1RM math, the BMI formula and working-set volume."
        action={
          <Button type="button" variant="secondary" size="sm" onClick={() => setTestResults(runAllAutomatedTests())}>
            Run tests
          </Button>
        }
      >
        {testResults ? (
          <ul className="space-y-2">
            {testResults.map((t, idx) => (
              <li key={idx} className="rounded-control border border-line bg-surface-2 p-3 space-y-1.5">
                <div className="flex items-start justify-between gap-2">
                  <span className="text-sm font-medium text-zinc-100 min-w-0">{t.name}</span>
                  <Badge
                    tone={t.passed ? 'success' : 'danger'}
                    icon={t.passed ? <CheckCircle2 className="w-3 h-3" aria-hidden /> : <XCircle className="w-3 h-3" aria-hidden />}
                  >
                    {t.passed ? 'Passed' : 'Failed'}
                  </Badge>
                </div>
                {t.details && <p className="text-label text-zinc-400">{t.details}</p>}
                <p className="text-label font-mono text-zinc-400 break-words">
                  Expected: {t.expected} · Result: <span className="text-zinc-200">{t.actual}</span>
                </p>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-xs text-zinc-500">No results yet.</p>
        )}
      </SettingsCard>

      <Modal
        open={showReset}
        onClose={closeReset}
        title="Reset Entire Database?"
        size="sm"
        footer={
          <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 w-full">
            <Button type="button" variant="ghost" onClick={closeReset} disabled={isResetting}>
              Cancel
            </Button>
            <Button type="button" variant="danger" onClick={handleReset} loading={isResetting}>
              {isResetting ? 'Deleting…' : 'Yes, Delete All'}
            </Button>
          </div>
        }
      >
        <div className="space-y-3">
          <p className="text-sm text-zinc-300 leading-relaxed">
            This will permanently delete all your logged workouts, body weight history, nutrition records, custom routines, and any Body Scan records, photos and consent saved on this device.
          </p>
          <p className="text-sm text-zinc-300 leading-relaxed">
            Workout plans and sessions synced to your account are deleted there too, and will not come back on your other devices.
          </p>
          {resetError && (
            <p role="alert" className="text-xs text-danger">
              {resetError}
            </p>
          )}
        </div>
      </Modal>

      <Modal
        open={replaceContent !== null}
        onClose={() => { if (!isReplacing) setReplaceContent(null); }}
        title="Replace your data with this backup?"
        size="sm"
        footer={
          <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 w-full">
            <Button type="button" variant="ghost" onClick={() => setReplaceContent(null)} disabled={isReplacing}>Cancel</Button>
            <Button type="button" variant="danger" onClick={confirmReplace} loading={isReplacing}>Download backup &amp; replace</Button>
          </div>
        }
      >
        <p className="text-sm text-zinc-300 leading-relaxed">
          Workouts and plans that are not in this backup will be deleted on this device and in your account. A backup of your current data is downloaded first so you can undo this.
        </p>
      </Modal>
    </>
  );
};
