import React from 'react';
import { LEGAL_ROUTES, type LegalRouteKey } from '../../legal/routes';

const ALL: LegalRouteKey[] = ['privacy', 'terms', 'refund-policy', 'cancellation-policy', 'contact'];

/**
 * Links to the public legal pages for use INSIDE the signed-in app. They open in a new tab so a half-finished checkout,
 * form or workout is never lost. (The public pages themselves use plain same-tab links.)
 */
export const LegalLinks: React.FC<{ keys?: LegalRouteKey[]; className?: string; linkClassName?: string; 'aria-label'?: string }> = ({
  keys = ALL,
  className = '',
  linkClassName = 'text-volt-adaptive underline underline-offset-2 hover:opacity-80',
  'aria-label': ariaLabel = 'Legal documents'
}) => (
  <nav aria-label={ariaLabel} className={className}>
    <ul className="flex flex-wrap gap-x-3 gap-y-1">
      {keys.map((k) => (
        <li key={k}>
          <a href={LEGAL_ROUTES[k].path} target="_blank" rel="noopener noreferrer" className={linkClassName}>
            {LEGAL_ROUTES[k].label}
            <span className="sr-only"> (opens in a new tab)</span>
          </a>
        </li>
      ))}
    </ul>
  </nav>
);
