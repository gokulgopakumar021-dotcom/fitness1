import React, { useState } from 'react';
import { ArrowLeft } from 'lucide-react';
import { BodyScanConsent } from '../../types/bodyScan';
import { UserProfile } from '../../types';
import { getBodyScanConsent } from '../../storage/bodyScanConsent';
import type { PoseEngine } from '../../services/poseLandmarker';
import { BODY_SCAN_MIN_AGE, getBodyScanGate } from '../../utils/bodyScanEligibility';
import { CaptureSession } from './CaptureSession';
import { ConsentStep } from './ConsentStep';
import { PrivacyControls } from './PrivacyControls';
import { Button, Card, PageHeader } from '../ui';

interface BodyScanFlowProps {
  profile: UserProfile;
  onClose: () => void;
  /** Test seam: creates the pose engine. Production uses the real on-device engine. */
  createEngine?: () => PoseEngine;
}

/** Body Scan sub-flow, rendered inside the Body tab (no separate nav tab). */
export const BodyScanFlow: React.FC<BodyScanFlowProps> = ({ profile, onClose, createEngine }) => {
  const [consent, setConsent] = useState<BodyScanConsent | null>(() => getBodyScanConsent());
  // Bumping this remounts CaptureSession, which drops every temporary in-memory photo and revokes its preview URL.
  const [photoSessionId, setPhotoSessionId] = useState(0);
  const gate = getBodyScanGate(profile.age, consent);

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      <div>
        <Button variant="ghost" size="sm" icon={<ArrowLeft className="w-4 h-4" aria-hidden="true" />} onClick={onClose} className="-ml-3 mb-2">
          Back to Body Metrics
        </Button>
        <PageHeader
          className="mb-0 sm:mb-0"
          eyebrow="IRONLOG AI"
          title="Body Scan"
          description="Guided front and side photos, checked for body landmarks on this device. Preview: nothing is measured or saved yet."
        />
      </div>

      {gate.status === 'blocked_underage' && (
        <Card role="alert" className="space-y-2">
          <h2 className="text-base font-semibold text-white">Body Scan is for adults</h2>
          <p className="text-sm text-zinc-400 leading-relaxed">
            Body Scan is available to users aged {BODY_SCAN_MIN_AGE} and over. Your profile age is below{' '}
            {BODY_SCAN_MIN_AGE}. If that is a mistake, you can correct it in Settings. The rest of IronLog AI is
            unaffected.
          </p>
        </Card>
      )}

      {gate.status === 'needs_consent' && <ConsentStep onAccepted={setConsent} />}

      {gate.status === 'ready' && (
        <>
          <CaptureSession key={photoSessionId} createEngine={createEngine} />
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
