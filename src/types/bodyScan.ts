/**
 * Body Scan domain types.
 *
 * Body images and pose data are sensitive personal data. Everything here is
 * stored on-device only (IndexedDB, see src/storage/bodyScanStore.ts).
 * Nothing in these types is ever sent to a server or AI service.
 */

export type ScanView = 'front' | 'side';

/** Where a number came from. The UI must always show this next to the value. */
export type MeasurementSource =
  | 'manual' //     typed in by the user
  | 'landmark' //   derived directly from detected pose landmarks
  | 'calculated'; // derived from known inputs plus documented assumptions

export type MeasurementConfidence = 'low' | 'medium' | 'high';

export type MeasurementUnit = 'cm' | 'kg' | '%' | 'ratio' | 'deg';

export interface ScanMeasurement {
  /** Stable key, e.g. 'shoulder_hip_ratio' or 'waist_circumference'. */
  key: string;
  value: number;
  unit: MeasurementUnit;
  source: MeasurementSource;
  /** Only meaningful for landmark/calculated values. */
  confidence?: MeasurementConfidence;
  /** Short plain-language caveat shown with the value. */
  note?: string;
}

/** Normalised pose landmark (0..1 in image space), as produced by the pose model. */
export interface LandmarkPoint {
  x: number;
  y: number;
  z?: number;
  visibility?: number;
}

export type CaptureQualityLevel = 'good' | 'fair' | 'poor';

export interface CaptureQualityReport {
  level: CaptureQualityLevel;
  /** Human-readable issues, e.g. "Feet are cut off". Empty when level is good. */
  issues: string[];
}

export interface ScanViewData {
  /** Landmarks are derived data and are deleted together with the scan. */
  landmarks?: LandmarkPoint[];
  quality?: CaptureQualityReport;
  /** Id of the stored photo in the `photos` store. Present only if the user consented to photo storage. */
  photoId?: string;
}

export interface BodyScanRecord {
  id: string;
  /** ISO timestamp of record creation. */
  createdAt: string;
  /** Local calendar date, YYYY-MM-DD. */
  date: string;
  views: Partial<Record<ScanView, ScanViewData>>;
  measurements: ScanMeasurement[];
  notes?: string;
}

/** A stored photo. The blob never leaves the device. */
export interface StoredScanPhoto {
  id: string;
  scanId: string;
  view: ScanView;
  blob: Blob;
  mimeType: string;
  width: number;
  height: number;
  createdAt: string;
}

export type NewScanPhoto = Omit<StoredScanPhoto, 'id' | 'scanId' | 'createdAt'>;

export interface BodyScanStorageSummary {
  scanCount: number;
  photoCount: number;
  /** Sum of photo blob sizes in bytes. */
  photoBytes: number;
}

export const BODY_SCAN_CONSENT_VERSION = 1;

/**
 * The user's Body Scan consent. Stored in localStorage (contains no images).
 * `photoStorage` is false unless the user explicitly turns it on.
 */
export interface BodyScanConsent {
  version: number;
  /** User explicitly confirmed they are 18 or older. */
  ageConfirmed18Plus: boolean;
  /** User acknowledged how Body Scan works and its limits. */
  limitsAcknowledged: boolean;
  /** Explicit opt-in to keep photos on this device. Default false. */
  photoStorage: boolean;
  acceptedAt: string;
  photoStorageUpdatedAt?: string;
}
