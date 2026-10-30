import React, { useCallback, useEffect, useState } from 'react';
import { Trash2, ShieldCheck } from 'lucide-react';
import { BodyScanConsent, BodyScanStorageSummary } from '../../types/bodyScan';
import { Button, Card } from '../ui';
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
  /** Drops temporary photos held in memory by the capture screen. Called whenever the person confirms a deletion. */
  onDiscardTemporaryPhotos: () => void;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const ACTIONS: Record<Exclude<PendingAction, null>, { label: string; confirm: string }> = {
  photos: {
    label: 'Delete all saved photos',
    confirm:
      'Permanently delete every saved body photo? Any temporary photos taken in this tab are discarded too. Your scan records and measurements are kept.',
  },
  history: {
    label: 'Delete all scan history',
    confirm:
      'Permanently delete all scan records, measurements, pose data and photos, including any temporary photos taken in this tab? This cannot be undone.',
  },
  withdraw: {
    label: 'Withdraw consent and delete all Body Scan data',
    confirm:
      'Permanently delete all Body Scan data and withdraw your consent? You will need to give consent again to use Body Scan.',
  },
};

export const PrivacyControls: React.FC<PrivacyControlsProps> = ({ consent, onConsentChange, onDiscardTemporaryPhotos }) => {
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
    // Temporary photos exist only in this tab's memory, so discarding them cannot fail. Do it first so that a
    // deletion the person asked for never leaves a photo on screen, even if clearing stored data then errors.
    if (pending) onDiscardTemporaryPhotos();
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
    <Card as="section" aria-labelledby="bodyscan-privacy-heading" className="space-y-5">
      <div className="flex items-center gap-2 text-accent">
        <ShieldCheck className="w-4 h-4" aria-hidden="true" />
        <h2 id="bodyscan-privacy-heading" className="text-base font-semibold text-white">Privacy &amp; data</h2>
      </div>

      <div className="grid grid-cols-3 gap-3" aria-live="polite">
        {[
          ['Scans', summary ? String(summary.scanCount) : '—'],
          ['Photos', summary ? String(summary.photoCount) : '—'],
          ['Photo size', summary ? formatBytes(summary.photoBytes) : '—'],
        ].map(([label, value]) => (
          <div key={label} className="p-3 bg-surface-2 border border-line rounded-control">
            <div className="text-label text-zinc-500">{label}</div>
            <div className="text-lg font-bold text-white tabular">{value}</div>
          </div>
        ))}
      </div>
      {summaryError && (
        <p role="alert" className="text-xs text-warning">
          {summaryError}
        </p>
      )}

      <label className="flex items-start gap-3 text-sm text-zinc-200 cursor-pointer py-1.5">
        <input
          type="checkbox"
          checked={consent.photoStorage}
          onChange={(e) => handleTogglePhotoStorage(e.target.checked)}
          disabled={busy}
          className="mt-0.5 w-5 h-5 shrink-0 accent-accent"
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
        <div className="p-3 bg-surface-2 border border-line rounded-control text-xs text-zinc-300 space-y-2">
          <p>
            Photo saving is now off. {summary?.photoCount} photo{summary?.photoCount === 1 ? '' : 's'} already saved
            remain on this device until you delete them.
          </p>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="danger"
              onClick={() => {
                setOfferDeletePhotos(false);
                setPending('photos');
              }}
            >
              Delete saved photos
            </Button>
            <Button size="sm" variant="secondary" onClick={() => setOfferDeletePhotos(false)}>
              Keep them
            </Button>
          </div>
        </div>
      )}

      <div className="space-y-2 pt-4 border-t border-line">
        {(Object.keys(ACTIONS) as Exclude<PendingAction, null>[]).map((key) => (
          <Button
            key={key}
            variant="danger"
            size="sm"
            icon={<Trash2 className="w-3.5 h-3.5" aria-hidden="true" />}
            onClick={() => {
              setStatus(null);
              setError(null);
              setPending(key);
            }}
            disabled={busy}
            className="w-full sm:w-auto"
          >
            {ACTIONS[key].label}
          </Button>
        ))}
      </div>

      {pending && (
        <div role="alertdialog" aria-label="Confirm deletion" className="p-4 bg-surface-2 border border-danger/30 rounded-control space-y-3">
          <p className="text-xs text-zinc-300 leading-relaxed">{ACTIONS[pending].confirm}</p>
          <div className="flex gap-2">
            <Button size="sm" variant="secondary" onClick={() => setPending(null)} disabled={busy}>
              Cancel
            </Button>
            <Button size="sm" variant="danger" onClick={handleConfirm} disabled={busy}>
              {busy ? 'Deleting…' : 'Yes, delete'}
            </Button>
          </div>
        </div>
      )}

      {error && (
        <p role="alert" className="text-xs text-danger">
          {error}
        </p>
      )}
      {status && (
        <p role="status" className="text-xs text-accent">
          {status}
        </p>
      )}
    </Card>
  );
};
