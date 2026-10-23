import React, { useState } from 'react';
import { ArrowLeft, Scan, Info } from 'lucide-react';
import { BodyScanConsent } from '../../types/bodyScan';
import { UserProfile } from '../../types';
import { getBodyScanConsent } from '../../storage/bodyScanConsent';
import { BODY_SCAN_MIN_AGE, getBodyScanGate } from '../../utils/bodyScanEligibility';
import { ConsentStep } from './ConsentStep';
import { PrivacyControls } from './PrivacyControls';

interface BodyScanFlowProps {
  profile: UserProfile;
  onClose: () => void;
}

/** Body Scan sub-flow, rendered inside the Body tab (no separate nav tab). */
export const BodyScanFlow: React.FC<BodyScanFlowProps> = ({ profile, onClose }) => {
  const [consent, setConsent] = useState<BodyScanConsent | null>(() => getBodyScanConsent());
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
          <div className="bg-[#0d1117] border border-zinc-800 rounded-2xl p-5 lg:p-7 shadow-xl space-y-2">
            <div className="flex items-center gap-2 text-zinc-100 font-bold">
              <Info className="w-4 h-4 text-lime-400" aria-hidden="true" />
              Body Scan is being built in stages
            </div>
            <p className="text-xs text-zinc-400 leading-relaxed">
              Consent, local storage and deletion controls are ready. Camera capture and pose analysis are not
              available yet, so no scans can be taken in this version.
            </p>
          </div>
          <PrivacyControls consent={gate.consent} onConsentChange={setConsent} />
        </>
      )}
    </div>
  );
};
