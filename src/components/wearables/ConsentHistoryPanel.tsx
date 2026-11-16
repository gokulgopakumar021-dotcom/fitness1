import React, { useCallback, useEffect, useRef, useState } from 'react';
import { History } from 'lucide-react';
import { Badge, Button, Card } from '../ui';
import { fetchConsentHistory, type ConsentHistoryResult } from '../../wearables/consentHistoryClient';
import { CONSENT_CATEGORY_LABELS, CONSENT_HISTORY_LIMIT } from '../../wearables/consentHistory';
import { WEARABLE_CONSENT_EVENT } from '../../wearables/consentClient';
import { WEARABLE_CONSENT_VERSION } from '../../wearables/consentPolicy';

/**
 * A read-only record of when this account turned each wearable permission on or off. It only displays what the server returned:
 * there is no edit, delete or export here, and revoking a permission adds a row rather than erasing one. Loaded only when opened
 * (no background requests); while open it refreshes after any consent change made on this screen.
 */
const MESSAGES: Record<'unauthenticated' | 'rate_limited' | 'unavailable' | 'failed', string> = {
  unauthenticated: 'Sign in again to see your consent history.',
  rate_limited: 'Too many requests. Try again in a minute.',
  unavailable: 'Your consent history is temporarily unavailable. Nothing was changed.',
  failed: 'Your consent history could not be loaded.'
};

const when = (iso: string) => new Date(iso).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });

interface Props {
  /** Injectable for tests. */
  fetcher?: (signal?: AbortSignal) => Promise<ConsentHistoryResult>;
}

export const ConsentHistoryPanel: React.FC<Props> = ({ fetcher = fetchConsentHistory }) => {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ConsentHistoryResult | null>(null);
  const ctl = useRef<AbortController | null>(null);

  const load = useCallback(async () => {
    ctl.current?.abort();
    const c = new AbortController();
    ctl.current = c;
    setLoading(true);
    const r = await fetcher(c.signal);
    if (c.signal.aborted) return;
    setResult(r);
    setLoading(false);
  }, [fetcher]);

  useEffect(() => () => ctl.current?.abort(), []);

  // While the panel is open, a consent change made on this screen shows up without a manual refresh.
  useEffect(() => {
    if (!open) return;
    const onChange = () => { void load(); };
    window.addEventListener(WEARABLE_CONSENT_EVENT, onChange);
    return () => window.removeEventListener(WEARABLE_CONSENT_EVENT, onChange);
  }, [open, load]);

  const toggle = () => {
    if (open) { ctl.current?.abort(); setOpen(false); setLoading(false); return; }
    setOpen(true);
    void load();
  };

  const panelId = 'wearable-consent-history';
  return (
    <Card aria-labelledby="wearable-consent-history-title">
      <div className="flex items-start gap-3">
        <History className="w-5 h-5 text-accent mt-0.5 shrink-0" aria-hidden />
        <div className="min-w-0 flex-1">
          <h2 id="wearable-consent-history-title" className="text-base font-semibold text-white">Consent history</h2>
          <p className="text-sm text-zinc-400">A read-only record of when you turned each permission on or off. It cannot be edited or deleted here, and turning a permission off adds to it rather than erasing anything.</p>
        </div>
        <Button variant="secondary" size="sm" onClick={toggle} aria-expanded={open} aria-controls={panelId}>{open ? 'Hide' : 'Show history'}</Button>
      </div>

      {open && (
        <div id={panelId} className="mt-3" aria-live="polite">
          {loading && <p className="text-xs text-zinc-400">Loading consent history…</p>}
          {!loading && result && result.kind !== 'ok' && (
            <div className="flex items-center justify-between gap-2">
              <p role="alert" className="text-sm text-warning">{MESSAGES[result.kind]}</p>
              {result.kind !== 'unauthenticated' && <Button variant="secondary" size="sm" onClick={() => void load()}>Retry</Button>}
            </div>
          )}
          {!loading && result?.kind === 'ok' && (
            result.events.length === 0
              ? <p className="text-sm text-zinc-300">No changes yet. Every permission is off until you turn it on.</p>
              : (
                <>
                  <ul className="divide-y divide-line">
                    {result.events.map((e, i) => (
                      <li key={`${e.at}-${e.category}-${e.action}-${i}`} className="py-2 flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-sm text-white">{CONSENT_CATEGORY_LABELS[e.category]}</p>
                          <p className="text-label font-mono text-zinc-500">
                            {when(e.at)} · consent v{e.version}{e.version !== WEARABLE_CONSENT_VERSION ? ' (older version)' : ''}
                          </p>
                        </div>
                        <Badge tone={e.action === 'granted' ? 'success' : 'neutral'}>{e.action === 'granted' ? 'Turned on' : 'Turned off'}</Badge>
                      </li>
                    ))}
                  </ul>
                  {result.truncated && <p className="text-label text-warning mt-2">Showing only the {CONSENT_HISTORY_LIMIT} most recent changes.</p>}
                </>
              )
          )}
        </div>
      )}
    </Card>
  );
};
