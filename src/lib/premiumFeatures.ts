/**
 * Registry of the premium (AI) features and where a person reaches them in the UI. Display only: the server's entitlement gate
 * (every `ai: true` route in src/server/security/endpoints.ts) is the real enforcement. This list exists so the UI locks and the
 * server gate cannot drift apart silently; premiumFeatures.test.ts fails if a server AI route is missing here.
 *
 * Free and NOT listed (never locked): basic workout tracking, manual/search/barcode nutrition logging, local Body Scan camera and
 * pose tracking, local analytics and the rule-based recovery model.
 *
 * `enforcement: 'ui-only'` marks premium features that no server route can enforce today: the Video Library is read straight from
 * Supabase (RLS + signed Storage URLs) and Workout Mirror runs on-device. For those the lock is display only.
 */
export interface PremiumFeature {
  id: string;
  label: string;
  /** Server routes behind the feature (all `ai: true`). */
  routes: readonly string[];
  /** Where the lock is shown / the tap is intercepted. */
  entry: string;
  /** Omitted = the server's entitlement gate also refuses it. 'ui-only' = only the UI lock protects it (see header). */
  enforcement?: 'ui-only';
}

/** Navigation tabs that are premium as a whole. Tapping one while locked opens billing instead of the screen. */
export const PREMIUM_TABS = ['trainer', 'mirror', 'videos'] as const;
export const isPremiumTab = (tab: string): boolean => (PREMIUM_TABS as readonly string[]).includes(tab);

export const PREMIUM_FEATURES: readonly PremiumFeature[] = [
  { id: 'ai-coach', label: 'AI Coach (Coach Iron)', routes: ['/api/ai-personal-trainer', '/api/adaptive-coach/explain'], entry: 'Sidebar "AI Coach", Overview card, "Ask Coach" widget (tab and widget)' },
  { id: 'exercise-coach', label: 'AI Exercise Coach', routes: ['/api/exercise-coach'], entry: 'Workouts: "AI Coach & Subs" on each exercise' },
  { id: 'ai-food-parser', label: 'AI Food Parser', routes: ['/api/ai-food-parser'], entry: 'Nutrition: Add food > "AI Parser" tab' },
  { id: 'ai-routine-builder', label: 'AI workout generation', routes: ['/api/generate-ai-routine'], entry: 'Routines: "AI builder" and "Launch AI builder"' },
  { id: 'plan-file-extraction', label: 'AI plan extraction from PDF/image', routes: ['/api/extract-plan'], entry: 'Routines: uploading a PDF/image (CSV and JSON import stay free)' },
  { id: 'overload-optimizer', label: 'AI overload optimizer', routes: ['/api/ai-plan-overload-tuning'], entry: 'Overload Engine: "AI optimizer"' },
  { id: 'warmup-generator', label: 'AI dynamic warm-up', routes: ['/api/ai-warmup-generator'], entry: 'Workouts: "5-Min Warm-up" (two buttons)' },
  { id: 'form-coach', label: 'AI Form Coach', routes: ['/api/ai-form-analyzer'], entry: 'Form & biomechanics modal: "AI Form Coach" tab (the diagram tabs stay free)' },
  { id: 'recovery-insights', label: 'AI recovery analysis', routes: ['/api/ai-recovery-insights'], entry: 'Overview: "Run AI Recovery Analysis" (the local recovery model stays free)' },
  { id: 'workout-mirror', label: 'Workout Mirror', routes: [], entry: 'Sidebar, More sheet, Home "More" list; every navigation path to the tab', enforcement: 'ui-only' },
  { id: 'video-library', label: 'Video Library and in-modal exercise videos', routes: [], entry: 'Sidebar, More sheet, Home "More" list; "Exercise video" section in the form modal', enforcement: 'ui-only' },
  { id: 'dream-physique', label: 'AI Dream Physique and physique analysis', routes: ['/api/ai-generate-physique', '/api/ai-physique-analysis'], entry: 'AI Coach tab > "Physique Blueprint" (modal also closes itself when locked)' }
];

/** Server AI routes that no screen calls today. They stay gated by the server; there is nothing to lock in the UI. */
export const AI_ROUTES_WITHOUT_UI: readonly string[] = ['/api/generate-plan', '/api/ai-workout-insights', '/api/ai-nutrition-coach'];
