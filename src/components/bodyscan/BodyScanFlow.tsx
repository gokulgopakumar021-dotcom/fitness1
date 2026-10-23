import React, { useState } from 'react';
import { ArrowLeft, Scan } from 'lucide-react';
import { BodyScanConsent } from '../../types/bodyScan';
import { UserProfile } from '../../types';
import { getBodyScanConsent } from '../../storage/bodyScanConsent';
import { BODY_SCAN_MIN_AGE, getBodyScanGate } from '../../utils/bodyScanEligibility';
import { CaptureSession } from './CaptureSession';
import { ConsentStep } from './ConsentStep';
import { PrivacyControls } from './PrivacyControls';

interface BodyScanFlowProps {
  profile: UserProfile;
  onClose: () => void;
}

/** Body Scan sub-flow, rendered inside the Body tab (no separate nav tab). */
export const BodyScanFlow: React.FC<BodyScanFlowProps> = ({ profile, onClose }) => {
  const [consent, setConsent] = useState<BodyScanConsent | null>(() => getBodyScanConsent());
  // Bumping this remounts CaptureSession, which drops every temporary in-memory photo and revokes its preview URL.
  const [photoSessionId, setPhotoSessionId] = useState(0);
  const gate = getBodyScanGate(profile.age, consent);

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={onClose}
          className="touch-press flex items-center gap-2 px-3 py-2 bg-zinc-900 border border-zinc-800 hover:border-zinc-700 text-zinc-300 rounded-xl text-xs font-semibold"
        >
          <ArrowLeft className="w-4 h-4" aria-hidden="true" />
          Back to Body Metrics
        </button>
        <div className="flex items-center gap-2 text-lime-400 text-xs font-mono font-semibold uppercase tracking-wider">
          <Scan className="w-4 h-4" aria-hidden="true" />
          <span>Body Scan</span>
        </div>
      </div>

      {gate.status === 'blocked_underage' && (
        <div role="alert" className="bg-[#0d1117] border border-zinc-800 rounded-2xl p-5 lg:p-7 space-y-2">
          <h2 className="text-lg font-bold text-zinc-100">Body Scan is for adults</h2>
          <p className="text-xs text-zinc-400 leading-relaxed">
            Body Scan is available to users aged {BODY_SCAN_MIN_AGE} and over. Your profile age is below{' '}
            {BODY_SCAN_MIN_AGE}. If that is a mistake, you can correct it in Settings. The rest of Iron Log is
            unaffected.
          </p>
        </div>
      )}

      {gate.status === 'needs_consent' && <ConsentStep onAccepted={setConsent} />}

      {gate.status === 'ready' && (
        <>
          <CaptureSession key={photoSessionId} />
          <PrivacyControls
            consent={gate.consent}
            onConsentChange={setConsent}
            onDiscardTemporaryPhotos={() => setPhotoSessionId((n) => n + 1)}
          />
        </>
      )}
    </div>
  );
};
