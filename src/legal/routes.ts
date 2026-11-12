/** The five public legal pages. Pathname-based; no router library. Shared by main.tsx, links and vercel.json tests. */
export type LegalRouteKey = 'privacy' | 'terms' | 'refund-policy' | 'cancellation-policy' | 'contact';

export interface LegalRouteInfo {
  key: LegalRouteKey;
  path: string;
  /** Short label for navigation. */
  label: string;
  /** Page heading. */
  title: string;
}

export const LEGAL_ROUTES: Record<LegalRouteKey, LegalRouteInfo> = {
  privacy: { key: 'privacy', path: '/privacy', label: 'Privacy Policy', title: 'Privacy Policy' },
  terms: { key: 'terms', path: '/terms', label: 'Terms of Service', title: 'Terms of Service' },
  'refund-policy': { key: 'refund-policy', path: '/refund-policy', label: 'Refund Policy', title: 'Refund Policy' },
  'cancellation-policy': { key: 'cancellation-policy', path: '/cancellation-policy', label: 'Cancellation Policy', title: 'Cancellation Policy' },
  contact: { key: 'contact', path: '/contact', label: 'Contact', title: 'Contact' }
};

export const LEGAL_ROUTE_LIST: LegalRouteInfo[] = Object.values(LEGAL_ROUTES);

/**
 * Maps a URL pathname to a legal page, or null for everything else (the SPA then behaves exactly as before).
 * Only an exact match counts: "/privacy/x", "/api/privacy" or "/privacy.html" are NOT legal pages. A single trailing
 * slash and letter case are tolerated.
 */
export function resolveLegalRoute(pathname: string | null | undefined): LegalRouteKey | null {
  if (!pathname) return null;
  const cleaned = pathname.toLowerCase().replace(/\/+$/, '');
  const hit = LEGAL_ROUTE_LIST.find((r) => r.path === cleaned);
  return hit ? hit.key : null;
}
