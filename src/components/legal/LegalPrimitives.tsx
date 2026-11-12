import React from 'react';
import { LEGAL, OWNER_PLACEHOLDERS, type PlaceholderKey } from '../../legal/legalConfig';

/**
 * Owner-to-complete field. Always visibly marked so it can never be mistaken for real business information.
 * It carries data-legal-placeholder so tests and the release gate can find every one.
 */
export const Pending: React.FC<{ field: PlaceholderKey }> = ({ field }) => (
  <mark
    data-legal-placeholder={field}
    className="rounded px-1.5 py-0.5 bg-warning/15 text-warning border border-warning/40 font-mono text-[0.85em] not-italic"
  >
    [OWNER TO PROVIDE: {OWNER_PLACEHOLDERS[field]}]
  </mark>
);

/** Reviewer note for the owner / counsel. Rendered only while the pages are drafts. */
export const ReviewNote: React.FC<{ children: React.ReactNode }> = ({ children }) =>
  LEGAL.isDraft ? (
    <aside
      data-legal-review-note
      role="note"
      className="my-3 rounded-control border border-warning/40 bg-warning/10 p-3 text-xs text-zinc-200"
    >
      <strong className="font-mono text-warning">REVIEW NOTE (draft only): </strong>
      {children}
    </aside>
  ) : null;

export const P: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <p className="text-sm leading-relaxed text-zinc-300">{children}</p>
);

export const UL: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <ul className="list-disc pl-5 space-y-1.5 text-sm leading-relaxed text-zinc-300">{children}</ul>
);

export const OL: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <ol className="list-decimal pl-5 space-y-1.5 text-sm leading-relaxed text-zinc-300">{children}</ol>
);

export const SubHeading: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <h3 className="text-sm font-semibold text-zinc-100 pt-1">{children}</h3>
);

/** Plain-text link to another legal page or to the support address. Full page load on purpose (refresh-safe). */
export const LegalLink: React.FC<{ href: string; children: React.ReactNode; newTab?: boolean }> = ({ href, children, newTab }) => (
  <a
    href={href}
    className="text-volt-adaptive underline underline-offset-2 hover:opacity-80"
    {...(newTab ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
  >
    {children}
  </a>
);

export const SupportEmail: React.FC = () => <LegalLink href={`mailto:${LEGAL.supportEmail}`}>{LEGAL.supportEmail}</LegalLink>;

/** Accessible, horizontally scrollable table for narrow screens. */
export const LegalTable: React.FC<{ caption: string; head: string[]; rows: React.ReactNode[][] }> = ({ caption, head, rows }) => (
  <div className="overflow-x-auto rounded-control border border-line" tabIndex={0} role="region" aria-label={caption}>
    <table className="w-full min-w-[34rem] text-left text-xs sm:text-sm">
      <caption className="sr-only">{caption}</caption>
      <thead className="bg-surface-2 text-zinc-200">
        <tr>
          {head.map((h) => (
            <th key={h} scope="col" className="px-3 py-2 font-semibold align-bottom">
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody className="divide-y divide-line text-zinc-300">
        {rows.map((r, i) => (
          <tr key={i}>
            {r.map((c, j) =>
              j === 0 ? (
                <th key={j} scope="row" className="px-3 py-2 font-medium text-zinc-100 align-top">
                  {c}
                </th>
              ) : (
                <td key={j} className="px-3 py-2 align-top">
                  {c}
                </td>
              )
            )}
          </tr>
        ))}
      </tbody>
    </table>
  </div>
);
