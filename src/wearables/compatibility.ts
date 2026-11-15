import type { CompatibilityState } from './types';

export type EvidenceQuality = 'official_doc' | 'secondary' | 'none';
export interface BrandRecord {
  brand: string;
  group: 'premium' | 'international' | 'india' | 'other';
  /** Route -> state. 'verified' is forbidden here until a dated hardware record exists (enforced by test). */
  routes: { directBle: CompatibilityState; cloudApi: CompatibilityState; viaAggregator: CompatibilityState; nativeHealthStore: CompatibilityState };
  evidence: EvidenceQuality;
  note: string;
}

/**
 * Position at BT-04. The only implemented route is generic standard-HR Bluetooth (device-agnostic) and NO hardware has
 * been tested, so nothing is 'implemented' or 'verified'. Only two cells moved off 'untested', both from official pages
 * read on 2026-11-15 (see IRON_LOG_AI_BT_04_BRAND_COMPATIBILITY_MATRIX.md): Garmin cloud API ('documented', approval-gated)
 * and Fitbit/Pixel cloud API ('unsupported' for now: legacy Fitbit Web API is shut off and the Google Health API was not
 * onboarding new projects). Everything else is an unverified lead, not a claim.
 */
const r = (directBle: CompatibilityState = 'untested', cloudApi: CompatibilityState = 'untested', viaAggregator: CompatibilityState = 'untested', nativeHealthStore: CompatibilityState = 'untested') => ({ directBle, cloudApi, viaAggregator, nativeHealthStore });

export const BRAND_COMPATIBILITY: BrandRecord[] = [
  ...['Apple Watch', 'Samsung Galaxy Watch'].map((brand): BrandRecord => ({ brand, group: 'premium', routes: r(), evidence: 'none', note: 'Not claimed. Direct BLE only if the device broadcasts the standard Heart Rate service.' })),
  { brand: 'Garmin', group: 'premium', routes: r('untested', 'documented'), evidence: 'official_doc', note: 'Cloud API is free to approved business developers only; approval is manual and not guaranteed. Direct BLE only in an optional heart-rate broadcast mode (untested).' },
  ...['Fitbit', 'Google Pixel Watch'].map((brand): BrandRecord => ({ brand, group: 'premium', routes: r('untested', 'unsupported'), evidence: 'official_doc', note: 'Legacy Fitbit Web API is shut off; Google Health API was not onboarding new projects at last check. Re-check quarterly.' })),
  ...['Amazfit / Zepp', 'Xiaomi / Mi Fitness', 'Huawei', 'Polar', 'Suunto', 'COROS'].map((brand): BrandRecord => ({ brand, group: 'international', routes: r(), evidence: 'none', note: 'Not claimed.' })),
  ...['Noise', 'boAt', 'Fire-Boltt', 'Fastrack'].map((brand): BrandRecord => ({ brand, group: 'india', routes: r(), evidence: 'none', note: 'Not claimed. Many budget bands do not expose standard BLE heart rate; hardware testing required.' })),
  ...['WHOOP', 'Oura', 'Generic BLE heart-rate strap'].map((brand): BrandRecord => ({ brand, group: 'other', routes: r(), evidence: 'none', note: 'Not claimed.' })),
];
