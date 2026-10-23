import React, { useState } from 'react';
import { ShieldCheck, Camera, Lock, Info } from 'lucide-react';
import { BodyScanConsent } from '../../types/bodyScan';
import { acceptBodyScanConsent } from '../../storage/bodyScanConsent';
import { BODY_SCAN_MIN_AGE } from '../../utils/bodyScanEligibility';

interface ConsentStepProps {
  onAccepted: (consent: BodyScanConsent) => void;
}

export const ConsentStep: React.FC<ConsentStepProps> = ({ onAccepted }) => {
  const [ageConfirmed, setAgeConfirmed] = useState(false);
  const [limitsAcknowledged, setLimitsAcknowledged] = useState(false);
  const [photoStorage, setPhotoStorage] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canContinue = ageConfirmed && limitsAcknowledged;

  const handleContinue = () => {
    try {
      onAccepted(
        acceptBodyScanConsent({
          ageConfirmed18Plus: ageConfirmed,
          limitsAcknowledged,
          photoStorage,
        })
      );
    } catch {
      setError('Could not save your choices on this device. Please try again.');
    }
  };

  return (
    <div className="bg-[#0d1117] border border-zinc-800 rounded-2xl p-5 lg:p-7 shadow-xl space-y-5">
      <div>
        <div className="flex items-center gap-2 text-lime-400 text-xs font-mono font-semibold uppercase tracking-wider mb-1">
          <ShieldCheck className="w-4 h-4" aria-hidden="true" />
          <span>Before you start</span>
        </div>
        <h2 className="text-xl font-bold text-zinc-100">Body Scan &amp; your privacy</h2>
        <p className="text-xs text-zinc-400 mt-1">
          Body Scan helps you track posture and proportions over time with guided front and side photos.
        </p>
      </div>

      <ul className="space-y-3 text-xs text-zinc-300">
        <li className="flex gap-3">
          <Camera className="w-4 h-4 text-lime-400 shrink-0 mt-0.5" aria-hidden="true" />
          <span>
            <strong className="text-zinc-100">Camera access.</strong> Your browser will ask for permission when you
            start a scan. The camera is used only to take your body photos and is switched off when you leave the scan.
          </span>
        </li>
        <li className="flex gap-3">
          <Lock className="w-4 h-4 text-lime-400 shrink-0 mt-0.5" aria-hidden="true" />
          <span>
            <strong className="text-zinc-100">Stays on your device.</strong> Body Scan is built to analyse photos on
            your device. It does not upload photos to Iron Log servers, AI services or analytics.
          </span>
        </li>
        <li className="flex gap-3">
          <Info className="w-4 h-4 text-lime-400 shrink-0 mt-0.5" aria-hidden="true" />
          <span>
            <strong className="text-zinc-100">What it cannot do.</strong> Photos cannot tell you your body-fat
            percentage, muscle mass, weight or circumferences, and cannot predict how you will look in future. Those
            stay manual entries. Anything estimated from a photo is approximate and labelled as such.
          </span>
        </li>
      </ul>

      <div className="space-y-3 pt-4 border-t border-zinc-800/80">
        <label className="flex items-start gap-3 text-xs text-zinc-200 cursor-pointer">
          <input
            type="checkbox"
            checked={ageConfirmed}
            onChange={(e) => setAgeConfirmed(e.target.checked)}
            className="mt-0.5 w-4 h-4 accent-lime-400"
          />
          <span>I am {BODY_SCAN_MIN_AGE} years old or older. (Required)</span>
        </label>

        <label className="flex items-start gap-3 text-xs text-zinc-200 cursor-pointer">
          <input
            type="checkbox"
            checked={limitsAcknowledged}
            onChange={(e) => setLimitsAcknowledged(e.target.checked)}
            className="mt-0.5 w-4 h-4 accent-lime-400"
          />
          <span>I understand how Body Scan works and what it cannot measure. (Required)</span>
        </label>

        <label className="flex items-start gap-3 text-xs text-zinc-200 cursor-pointer">
          <input
            type="checkbox"
            checked={photoStorage}
            onChange={(e) => setPhotoStorage(e.target.checked)}
            className="mt-0.5 w-4 h-4 accent-lime-400"
          />
          <span>
            Save my photos on this device so I can compare them later.{' '}
            <span className="text-zinc-500">
              (Optional, off by default. Without this, only measurements are kept. You can change this or delete
              photos at any time.)
            </span>
          </span>
        </label>
      </div>

      {error && (
        <p role="alert" className="text-xs text-rose-400">
          {error}
        </p>
      )}

      <button
        type="button"
        onClick={handleContinue}
        disabled={!canContinue}
        className="touch-press w-full sm:w-auto px-5 py-2.5 bg-lime-400 hover:bg-lime-300 disabled:bg-zinc-800 disabled:text-zinc-500 disabled:cursor-not-allowed text-black font-bold text-sm rounded-xl transition-colors"
      >
        Continue
      </button>
    </div>
  );
};
