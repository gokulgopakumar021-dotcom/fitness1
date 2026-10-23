import React, { useCallback, useEffect, useState } from 'react';
import { Trash2, ShieldCheck } from 'lucide-react';
import { BodyScanConsent, BodyScanStorageSummary } from '../../types/bodyScan';
import { setPhotoStorageConsent } from '../../storage/bodyScanConsent';
import {
  deleteAllPhotos,
  deleteAllScans,
  eraseAllBodyScanData,
  getStorageSummary,
} from '../../storage/bodyScanStore';

type PendingAction = 'photos' | 'history' | 'withdraw' | null;

interface PrivacyControlsProps {
  consent: BodyScanConsent;
  onConsentChange: (consent: BodyScanConsent | null) => void;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const ACTIONS: Record<Exclude<PendingAction, null>, { label: string; confirm: string }> = {
  photos: {
    label: 'Delete all saved photos',
    confirm: 'Permanently delete every saved body photo? Your scan records and measurements are kept.',
  },
  history: {
    label: 'Delete all scan history',
    confirm: 'Permanently delete all scan records, measurements, pose data and photos? This cannot be undone.',
  },
  withdraw: {
    label: 'Withdraw consent and delete all Body Scan data',
    confirm:
      'Permanently delete all Body Scan data and withdraw your consent? You will need to give consent again to use Body Scan.',
  },
};

export const PrivacyControls: React.FC<PrivacyControlsProps> = ({ consent, onConsentChange }) => {
  const [summary, setSummary] = useState<BodyScanStorageSummary | null>(null);
  const [summaryError, setSummaryError] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingAction>(null);
  const [offerDeletePhotos, setOfferDeletePhotos] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setSummary(await getStorageSummary());
      setSummaryError(null);
    } catch {
      setSummary(null);
      setSummaryError('Stored Body Scan data could not be read in this browser.');
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const run = async (work: () => Promise<void>, doneMessage: string) => {
    setBusy(true);
    setError(null);
    setStatus(null);
    try {
      await work();
      setStatus(doneMessage);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong. Nothing was reported as deleted.');
    } finally {
      setBusy(false);
      setPending(null);
      await refresh();
    }
  };

  const handleTogglePhotoStorage = (enabled: boolean) => {
    setError(null);
    setStatus(null);
    try {
      onConsentChange(setPhotoStorageConsent(enabled));
      setOfferDeletePhotos(!enabled && (summary?.photoCount ?? 0) > 0);
    } catch {
      setError('Could not save this choice on this device.');
    }
  };

  const handleConfirm = () => {
    if (pending === 'photos') {
      void run(deleteAllPhotos, 'All saved photos were deleted.');
    } else if (pending === 'history') {
      void run(deleteAllScans, 'All scan history and photos were deleted.');
    } else if (pending === 'withdraw') {
      void run(async () => {
        await eraseAllBodyScanData();
        onConsentChange(null);
      }, 'All Body Scan data was deleted and consent withdrawn.');
    }
  };

  return (
    <section
      aria-labelledby="bodyscan-privacy-heading"
      className="bg-[#0d1117] border border-zinc-800 rounded-2xl p-5 lg:p-7 shadow-xl space-y-5"
    >
      <div className="flex items-center gap-2 text-lime-400 text-xs font-mono font-semibold uppercase tracking-wider">
        <ShieldCheck className="w-4 h-4" aria-hidden="true" />
        <h2 id="bodyscan-privacy-heading">Privacy &amp; data</h2>
      </div>

      <div className="grid grid-cols-3 gap-3" aria-live="polite">
        {[
          ['Scans', summary ? String(summary.scanCount) : '—'],
          ['Photos', summary ? String(summary.photoCount) : '—'],
          ['Photo size', summary ? formatBytes(summary.photoBytes) : '—'],
        ].map(([label, value]) => (
          <div key={label} className="p-3 bg-zinc-900/70 border border-zinc-800/80 rounded-xl">
            <div className="text-[10px] font-mono text-zinc-500 uppercase tracking-wider">{label}</div>
            <div className="text-lg font-mono font-extrabold text-zinc-100">{value}</div>
          </div>
        ))}
      </div>
      {summaryError && (
        <p role="alert" className="text-xs text-amber-400">
          {summaryError}
        </p>
      )}

      <label className="flex items-start gap-3 text-xs text-zinc-200 cursor-pointer">
        <input
          type="checkbox"
          checked={consent.photoStorage}
          onChange={(e) => handleTogglePhotoStorage(e.target.checked)}
          disabled={busy}
          className="mt-0.5 w-4 h-4 accent-lime-400"
        />
        <span>
          Save my photos on this device
          <span className="block text-zinc-500">
            Off by default. When off, new scans keep measurements only. Data is stored in this browser and is
            not included in backups or exports.
          </span>
        </span>
      </label>

      {offerDeletePhotos && !pending && (
        <div className="p-3 bg-zinc-900/70 border border-zinc-800 rounded-xl text-xs text-zinc-300 space-y-2">
          <p>
            Photo saving is now off. {summary?.photoCount} photo{summary?.photoCount === 1 ? '' : 's'} already saved
            remain on this device until you delete them.
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => {
                setOfferDeletePhotos(false);
                setPending('photos');
              }}
              className="px-3 py-1.5 bg-rose-600 hover:bg-rose-500 text-white font-bold rounded-lg text-xs"
            >
              Delete saved photos
            </button>
            <button
              type="button"
              onClick={() => setOfferDeletePhotos(false)}
              className="px-3 py-1.5 bg-zinc-800 text-zinc-300 rounded-lg text-xs"
            >
              Keep them
            </button>
          </div>
        </div>
      )}

      <div className="space-y-2 pt-4 border-t border-zinc-800/80">
        {(Object.keys(ACTIONS) as Exclude<PendingAction, null>[]).map((key) => (
          <button
            key={key}
            type="button"
            onClick={() => {
              setStatus(null);
              setError(null);
              setPending(key);
            }}
            disabled={busy}
            className="w-full sm:w-auto flex items-center gap-2 px-4 py-2 bg-rose-950/40 border border-rose-900/60 text-rose-400 hover:bg-rose-900/40 disabled:opacity-50 font-semibold rounded-xl text-xs transition-colors"
          >
            <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
            {ACTIONS[key].label}
          </button>
        ))}
      </div>

      {pending && (
        <div role="alertdialog" aria-label="Confirm deletion" className="p-4 bg-[#12161c] border border-rose-900/60 rounded-xl space-y-3">
          <p className="text-xs text-zinc-300 leading-relaxed">{ACTIONS[pending].confirm}</p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setPending(null)}
              disabled={busy}
              className="px-3 py-1.5 bg-zinc-800 text-zinc-300 rounded-lg text-xs"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleConfirm}
              disabled={busy}
              className="px-4 py-1.5 bg-rose-600 hover:bg-rose-500 disabled:opacity-60 text-white font-bold rounded-lg text-xs"
            >
              {busy ? 'Deleting…' : 'Yes, delete'}
            </button>
          </div>
        </div>
      )}

      {error && (
        <p role="alert" className="text-xs text-rose-400">
          {error}
        </p>
      )}
      {status && (
        <p role="status" className="text-xs text-lime-400">
          {status}
        </p>
      )}
    </section>
  );
};
