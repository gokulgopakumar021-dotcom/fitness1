import { BODY_SCAN_CONSENT_VERSION, BodyScanConsent } from '../types/bodyScan';

/** Contains no images, only the user's consent choices. */
export const BODY_SCAN_CONSENT_KEY = 'ironlog_bodyscan_consent_v1';

export function getBodyScanConsent(): BodyScanConsent | null {
  try {
    const raw = localStorage.getItem(BODY_SCAN_CONSENT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (
      parsed &&
      typeof parsed === 'object' &&
      parsed.version === BODY_SCAN_CONSENT_VERSION &&
      parsed.ageConfirmed18Plus === true &&
      parsed.limitsAcknowledged === true
    ) {
      return {
        version: parsed.version,
        ageConfirmed18Plus: true,
        limitsAcknowledged: true,
        // Anything other than an explicit true means photos are NOT stored.
        photoStorage: parsed.photoStorage === true,
        acceptedAt: typeof parsed.acceptedAt === 'string' ? parsed.acceptedAt : '',
        photoStorageUpdatedAt:
          typeof parsed.photoStorageUpdatedAt === 'string' ? parsed.photoStorageUpdatedAt : undefined,
      };
    }
  } catch (e) {
    console.error('Failed reading body scan consent');
  }
  return null;
}

export interface AcceptConsentInput {
  ageConfirmed18Plus: boolean;
  limitsAcknowledged: boolean;
  photoStorage: boolean;
}

/**
 * Records consent. Throws if the mandatory confirmations are missing, so a UI
 * bug cannot silently record consent that was never given.
 */
export function acceptBodyScanConsent(input: AcceptConsentInput): BodyScanConsent {
  if (!input.ageConfirmed18Plus || !input.limitsAcknowledged) {
    throw new Error('Age confirmation and acknowledgement of limits are required.');
  }
  const now = new Date().toISOString();
  const consent: BodyScanConsent = {
    version: BODY_SCAN_CONSENT_VERSION,
    ageConfirmed18Plus: true,
    limitsAcknowledged: true,
    photoStorage: input.photoStorage === true,
    acceptedAt: now,
    photoStorageUpdatedAt: now,
  };
  localStorage.setItem(BODY_SCAN_CONSENT_KEY, JSON.stringify(consent));
  return consent;
}

/** Changes only the photo-storage opt-in. Requires existing valid consent. */
export function setPhotoStorageConsent(enabled: boolean): BodyScanConsent {
  const current = getBodyScanConsent();
  if (!current) {
    throw new Error('Body Scan consent has not been given.');
  }
  const updated: BodyScanConsent = {
    ...current,
    photoStorage: enabled === true,
    photoStorageUpdatedAt: new Date().toISOString(),
  };
  localStorage.setItem(BODY_SCAN_CONSENT_KEY, JSON.stringify(updated));
  return updated;
}

export function clearBodyScanConsent(): void {
  localStorage.removeItem(BODY_SCAN_CONSENT_KEY);
}
