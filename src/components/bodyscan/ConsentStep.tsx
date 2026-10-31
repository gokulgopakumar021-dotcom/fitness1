import React, { useState } from 'react';
import { ShieldCheck, Camera, Lock, Info } from 'lucide-react';
import { BodyScanConsent } from '../../types/bodyScan';
import { acceptBodyScanConsent } from '../../storage/bodyScanConsent';
import { BODY_SCAN_MIN_AGE } from '../../utils/bodyScanEligibility';
import { Button, Card } from '../ui';

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
    <Card className="space-y-5">
      <div>
        <div className="flex items-center gap-2 text-accent text-xs font-semibold mb-1">
          <ShieldCheck className="w-4 h-4" aria-hidden="true" />
          <span>Before you start</span>
        </div>
        <h2 className="text-base font-semibold text-white">Body Scan &amp; your privacy</h2>
        <p className="text-sm text-zinc-400 mt-1">
          Body Scan helps you track posture and proportions over time with guided front and side photos.
        </p>
      </div>

      <ul className="space-y-3 text-sm text-zinc-300">
        <li className="flex gap-3">
          <Camera className="w-4 h-4 text-accent shrink-0 mt-0.5" aria-hidden="true" />
          <span>
            <strong className="text-zinc-100">Camera access.</strong> Your browser will ask for permission when you
            start a scan. The camera is used only to take your body photos and is switched off when you leave the scan.
          </span>
        </li>
        <li className="flex gap-3">
          <Lock className="w-4 h-4 text-accent shrink-0 mt-0.5" aria-hidden="true" />
          <span>
            <strong className="text-zinc-100">Stays on your device.</strong> Body Scan is built to analyse photos on
            your device. It does not upload photos to IronLog AI servers, AI services or analytics.
          </span>
        </li>
        <li className="flex gap-3">
          <Info className="w-4 h-4 text-accent shrink-0 mt-0.5" aria-hidden="true" />
          <span>
            <strong className="text-zinc-100">What it cannot do.</strong> Photos cannot tell you your body-fat
            percentage, muscle mass, weight or circumferences, and cannot predict how you will look in future. Those
            stay manual entries. Anything estimated from a photo is approximate and labelled as such.
          </span>
        </li>
      </ul>

      <div className="space-y-3 pt-4 border-t border-line">
        <label className="flex items-start gap-3 py-1.5 text-sm text-zinc-200 cursor-pointer">
          <input
            type="checkbox"
            checked={ageConfirmed}
            onChange={(e) => setAgeConfirmed(e.target.checked)}
            className="mt-0.5 w-5 h-5 shrink-0 accent-accent"
          />
          <span>I am {BODY_SCAN_MIN_AGE} years old or older. (Required)</span>
        </label>

        <label className="flex items-start gap-3 py-1.5 text-sm text-zinc-200 cursor-pointer">
          <input
            type="checkbox"
            checked={limitsAcknowledged}
            onChange={(e) => setLimitsAcknowledged(e.target.checked)}
            className="mt-0.5 w-5 h-5 shrink-0 accent-accent"
          />
          <span>I understand how Body Scan works and what it cannot measure. (Required)</span>
        </label>

        <label className="flex items-start gap-3 py-1.5 text-sm text-zinc-200 cursor-pointer">
          <input
            type="checkbox"
            checked={photoStorage}
            onChange={(e) => setPhotoStorage(e.target.checked)}
            className="mt-0.5 w-5 h-5 shrink-0 accent-accent"
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
        <p role="alert" className="text-xs text-danger">
          {error}
        </p>
      )}

      <Button onClick={handleContinue} disabled={!canContinue} className="w-full sm:w-auto">
        Continue
      </Button>
    </Card>
  );
};
