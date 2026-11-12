import React, { Suspense } from 'react';
import { ThemeProvider } from '../../context/ThemeContext';
import type { LegalRouteKey } from '../../legal/routes';
import { PrivacyPage } from './content/PrivacyPage';
import { TermsPage } from './content/TermsPage';
import { RefundPolicyPage } from './content/RefundPolicyPage';
import { CancellationPolicyPage } from './content/CancellationPolicyPage';
import { ContactPage } from './content/ContactPage';

/**
 * Root for a public legal route. Mounted by main.tsx INSTEAD of <App /> (so no AuthProvider, no Supabase client, no
 * storage scoping, no billing gates, no sync). Only the theme provider is used so light/dark preference is respected.
 */
export const LegalRoot: React.FC<{ route: LegalRouteKey }> = ({ route }) => (
  <ThemeProvider>
    <Suspense fallback={null}>
      {route === 'privacy' && <PrivacyPage />}
      {route === 'terms' && <TermsPage />}
      {route === 'refund-policy' && <RefundPolicyPage />}
      {route === 'cancellation-policy' && <CancellationPolicyPage />}
      {route === 'contact' && <ContactPage />}
    </Suspense>
  </ThemeProvider>
);
