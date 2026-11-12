import React, { useEffect } from 'react';
import { BrandEmblem } from '../ui/BrandLogo';
import { LEGAL } from '../../legal/legalConfig';
import { LEGAL_ROUTE_LIST, type LegalRouteKey, LEGAL_ROUTES } from '../../legal/routes';
import { Pending, SupportEmail } from './LegalPrimitives';

export interface LegalSectionDef {
  id: string;
  title: string;
  body: React.ReactNode;
}

export interface LegalPageProps {
  route: LegalRouteKey;
  /** One or two plain-language sentences shown under the title. */
  summary: React.ReactNode;
  sections: LegalSectionDef[];
  /** Show the version line (Terms and Privacy carry versions that are recorded at sign-up). */
  version?: string;
}

const NavLinks: React.FC<{ current: LegalRouteKey; label: string }> = ({ current, label }) => (
  <nav aria-label={label}>
    <ul className="flex flex-wrap gap-x-4 gap-y-2 text-xs font-mono">
      {LEGAL_ROUTE_LIST.map((r) => (
        <li key={r.key}>
          <a
            href={r.path}
            aria-current={r.key === current ? 'page' : undefined}
            className={r.key === current ? 'text-volt-adaptive font-bold' : 'text-zinc-400 hover:text-accent transition-colors'}
          >
            {r.label}
          </a>
        </li>
      ))}
    </ul>
  </nav>
);

/**
 * Shared shell for the public legal pages. Renders with NO dependency on authentication, Supabase or app state, so it
 * works signed out, on a cold load and on browser refresh. Navigation between legal pages uses plain links (full page
 * load), which is exactly what a refresh does, so there is no client-side routing state to get out of sync.
 */
export const LegalPage: React.FC<LegalPageProps> = ({ route, summary, sections, version }) => {
  const info = LEGAL_ROUTES[route];

  useEffect(() => {
    const previous = document.title;
    document.title = `${info.title} | ${LEGAL.brandName}`;
    return () => {
      document.title = previous;
    };
  }, [info.title]);

  return (
    <div className="min-h-dvh bg-[var(--bg-canvas)] text-[var(--text-primary)] font-sans flex flex-col selection:bg-accent selection:text-zinc-950">
      <a
        href="#legal-main"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[60] focus:px-4 focus:py-2 focus:rounded-lg focus:bg-accent focus:text-accent-ink focus:text-sm focus:font-semibold"
      >
        Skip to content
      </a>

      <header
        className="sticky top-0 z-40 border-b border-line bg-surface/90 backdrop-blur-md px-4 sm:px-8 py-3"
        style={{ paddingTop: 'max(0.75rem, env(safe-area-inset-top))' }}
      >
        <div className="mx-auto max-w-3xl flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <a href="/" className="inline-flex items-center gap-2.5 min-h-[44px]" aria-label={`${LEGAL.brandName} home`}>
            <BrandEmblem className="h-8" />
            <span className="font-mono font-black tracking-widest text-sm text-zinc-100">{LEGAL.brandName.toUpperCase()}</span>
          </a>
          <NavLinks current={route} label="Legal documents" />
        </div>
      </header>

      <main id="legal-main" tabIndex={-1} className="flex-1 outline-none px-4 sm:px-8 py-8 sm:py-12">
        <article className="mx-auto max-w-3xl space-y-6" aria-labelledby="legal-title">
          <header className="space-y-3">
            <h1 id="legal-title" className="text-2xl sm:text-3xl font-bold text-zinc-100">
              {info.title}
            </h1>
            <p className="text-sm sm:text-base text-zinc-400 leading-relaxed">{summary}</p>
            {LEGAL.isDraft && (
              <div
                data-legal-draft-banner
                role="note"
                className="rounded-control border border-warning/40 bg-warning/10 p-3 text-xs sm:text-sm text-zinc-200"
              >
                <strong className="font-mono text-warning">DRAFT: NOT YET LEGALLY REVIEWED.</strong> This document is awaiting review by the
                operator and by Indian legal counsel. It is not final legal advice and must not be relied on as legally approved. Items marked
                “OWNER TO PROVIDE” are not yet filled in.
              </div>
            )}
            {version && (
              <p className="text-xs font-mono text-zinc-500">
                Version {version} · Effective date:{' '}
                {LEGAL.effectiveDate ? LEGAL.effectiveDate : <Pending field="effectiveDate" />}
              </p>
            )}
          </header>

          {sections.length > 3 && (
            <nav aria-label="On this page" className="rounded-card border border-line bg-surface p-4">
              <h2 className="text-xs font-mono uppercase tracking-wider text-zinc-400">On this page</h2>
              <ol className="mt-2 columns-1 sm:columns-2 gap-6 list-decimal pl-5 text-sm space-y-1">
                {sections.map((s) => (
                  <li key={s.id} className="break-inside-avoid">
                    <a href={`#${s.id}`} className="text-zinc-300 hover:text-accent">
                      {s.title}
                    </a>
                  </li>
                ))}
              </ol>
            </nav>
          )}

          {sections.map((s) => (
            <section key={s.id} id={s.id} aria-labelledby={`${s.id}-h`} className="scroll-mt-24 space-y-3 border-t border-line pt-5">
              <h2 id={`${s.id}-h`} className="text-lg font-semibold text-zinc-100">
                {s.title}
              </h2>
              {s.body}
            </section>
          ))}
        </article>
      </main>

      <footer
        className="border-t border-line bg-surface px-4 sm:px-8 py-6 text-xs text-zinc-400"
        style={{ paddingBottom: 'max(1.5rem, env(safe-area-inset-bottom))' }}
      >
        <div className="mx-auto max-w-3xl space-y-3">
          <NavLinks current={route} label="Legal documents (footer)" />
          <p>
            Questions? <SupportEmail />. <a href="/" className="underline underline-offset-2 hover:text-accent">Back to {LEGAL.brandName}</a>
          </p>
        </div>
      </footer>
    </div>
  );
};
