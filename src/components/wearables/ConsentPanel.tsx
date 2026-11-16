import React, { useState } from 'react';
import { Heart, ShieldCheck } from 'lucide-react';
import { Badge, Button, Card, Modal } from '../ui';
import type { WearableConsentCategory } from '../../wearables/consentPolicy';
import type { useWearableConsent } from '../../wearables/useWearableConsent';

interface Row {
  id: WearableConsentCategory;
  title: string;
  summary: string;
  /** False when nothing in Iron Log reads this category yet: the switch is shown but cannot be turned on. */
  available: boolean;
  what: string;
  why: string;
  how: string;
  sentToAi: string;
  afterRevoke: string;
}

export const CONSENT_ROWS: Row[] = [
  {
    id: 'live_heart_rate', title: 'Share live heart rate with Coach Iron', available: true,
    summary: 'Coach Iron can see your current beats per minute from a real connected device while you chat.',
    what: 'Your current heart rate (beats per minute) from a real device, and the device’s name. Nothing else: no history, sleep, location or other health data.',
    why: 'So Coach Iron can comment on your effort during a workout.',
    how: 'It is added to the message Coach Iron sends to its AI provider when you ask something. Demo (simulated) readings are never sent.',
    sentToAi: 'Yes. It is sent to an external AI provider (Google Gemini). Iron Log has not yet verified how that provider retains or uses submitted data, so only turn this on if you are comfortable with that.',
    afterRevoke: 'Takes effect on your very next message: Coach Iron receives no heart-rate data. Anything already sent cannot be recalled. A record that you turned it on and off is kept.'
  },
  {
    id: 'workout_health_sync', title: 'Save workout heart-rate readings to my account', available: true,
    summary: 'Real readings from your device are stored with the workout they belong to. This does not share them with Coach Iron.',
    what: 'Time-stamped heart-rate readings from a real device during a workout, plus the device’s name and the workout they belong to.',
    why: 'To keep a record of your heart rate for each workout.',
    how: 'Readings are saved in your Iron Log account while the app is open. They are not given to the AI provider; that is a separate switch.',
    sentToAi: 'No. Stored in your Iron Log account only.',
    afterRevoke: 'Saving stops immediately and any unsent readings are discarded. Readings already saved stay until you remove the device below.'
  },
  {
    id: 'historical_heart_rate', title: 'Share heart-rate history with Coach Iron', available: true,
    summary: 'Coach Iron can see a short summary of your recent saved workout heart rate when you chat. Separate from live sharing and from saving.',
    what: 'A summary Iron Log builds from your saved readings: for up to your 5 most recent workouts in the last 30 days, the date, the length, the lowest, average and highest beats per minute, and how many readings. Not the individual readings, not the device’s name, and no other health data.',
    why: 'So Coach Iron can comment on how your recent workouts have gone, not only the current moment.',
    how: 'It is added to the message Coach Iron sends to its AI provider when you ask something, and is read fresh from your account each time. It only covers readings saved from a real device; demo readings are never saved. There is only something to summarise if “Save workout heart-rate readings” is also on (or was on earlier).',
    sentToAi: 'Yes. It is sent to an external AI provider (Google Gemini). Iron Log has not yet verified how that provider retains or uses submitted data, so only turn this on if you are comfortable with that.',
    afterRevoke: 'Takes effect on your very next message: Coach Iron receives no heart-rate history. Anything already sent cannot be recalled. Readings already saved stay in your account. A record that you turned it on and off is kept.'
  },
  {
    id: 'sleep_and_recovery_metrics', title: 'Share recovery metrics (resting HR, HRV, sleep, SpO₂)', available: false,
    summary: 'Not available yet: Iron Log cannot collect these from a browser-connected device.', what: '', why: '', how: '', sentToAi: '', afterRevoke: ''
  },
  {
    id: 'activity_metrics', title: 'Share activity metrics (steps, energy, distance)', available: false,
    summary: 'Not available yet: Iron Log cannot collect these from a browser-connected device.', what: '', why: '', how: '', sentToAi: '', afterRevoke: ''
  }
];

type Consent = ReturnType<typeof useWearableConsent>;

export const ConsentPanel: React.FC<{ consent: Consent }> = ({ consent }) => {
  const [pending, setPending] = useState<Row | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const toggle = async (row: Row, on: boolean) => {
    if (on) { setPending(row); return; }
    const ok = await consent.setCategory(row.id, false);
    if (ok) setNotice(`${row.title}: turned off. ${row.afterRevoke}`);
  };
  const confirm = async () => {
    if (!pending) return;
    const row = pending;
    const ok = await consent.setCategory(row.id, true);
    if (ok) { setPending(null); setNotice(`${row.title}: turned on.`); }
  };

  const unavailable = consent.state === 'unavailable' || consent.state === 'unauthenticated';
  return (
    <Card aria-labelledby="wearable-consent-title">
      <div className="flex items-start gap-3 mb-3">
        <ShieldCheck className="w-5 h-5 text-accent mt-0.5 shrink-0" aria-hidden />
        <div className="min-w-0">
          <h2 id="wearable-consent-title" className="text-base font-semibold text-white">Privacy &amp; consent</h2>
          <p className="text-sm text-zinc-400">Everything is off until you turn it on. Connecting a device never turns anything on. You can change these at any time.</p>
        </div>
      </div>

      {consent.stale && <p role="status" className="text-sm text-warning mb-3">Your earlier choices were recorded under an older version of this consent and no longer apply. Please review and turn on what you want again.</p>}
      {unavailable && <p role="alert" className="text-sm text-warning mb-3">{consent.state === 'unauthenticated' ? 'Sign in again to manage consent.' : 'Your current choices could not be verified right now. Wearable data is treated as not shared until they can.'}</p>}
      {consent.error && <p role="alert" className="text-sm text-danger mb-3">{consent.error}</p>}
      <p aria-live="polite" className="sr-only">{notice ?? ''}</p>
      {notice && <p className="text-sm text-zinc-300 mb-3">{notice}</p>}

      <ul className="divide-y divide-line">
        {CONSENT_ROWS.map((row) => {
          const on = consent.categories.has(row.id);
          const disabled = !row.available || consent.busy || consent.state === 'loading' || unavailable;
          return (
            <li key={row.id} className="py-3 flex items-start gap-3">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-white flex items-center gap-2 flex-wrap">
                  {row.id === 'live_heart_rate' && <Heart className="w-4 h-4 text-danger" aria-hidden />}
                  {row.title}
                  {!row.available && <Badge>Not available yet</Badge>}
                  {row.available && <Badge tone={on ? 'success' : 'neutral'}>{on ? 'On' : 'Off'}</Badge>}
                </p>
                <p className="text-xs text-zinc-400 mt-0.5">{row.summary}</p>
              </div>
              <button
                type="button" role="switch" aria-checked={on} aria-label={row.title} disabled={disabled}
                onClick={() => void toggle(row, !on)}
                className={`relative shrink-0 mt-1 h-7 w-12 rounded-full border transition-colors disabled:opacity-40 ${on ? 'bg-accent border-accent' : 'bg-surface-2 border-line-strong'}`}
              >
                <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all ${on ? 'left-6' : 'left-0.5'}`} />
              </button>
            </li>
          );
        })}
      </ul>

      <p className="text-xs text-zinc-500 mt-3">Open question we have not resolved: how Google Gemini, the AI provider behind Coach Iron, retains or trains on submitted data under the plan Iron Log uses. Until that is confirmed, treat sharing as sending data to a third party.</p>

      <Modal
        open={pending !== null} onClose={() => setPending(null)} title={pending?.title ?? ''} size="md"
        footer={<div className="flex gap-2 justify-end"><Button variant="secondary" onClick={() => setPending(null)}>Cancel</Button><Button onClick={() => void confirm()} loading={consent.busy}>Turn on</Button></div>}
      >
        {pending && (
          <dl className="space-y-3 text-sm">
            {([['What is shared', pending.what], ['Why it is needed', pending.why], ['How it is used', pending.how], ['Sent to an external AI provider?', pending.sentToAi], ['How to turn it off, and what happens', `Switch it off here at any time. ${pending.afterRevoke}`]] as const).map(([k, v]) => (
              <div key={k}><dt className="font-semibold text-white">{k}</dt><dd className="text-zinc-300">{v}</dd></div>
            ))}
          </dl>
        )}
      </Modal>
    </Card>
  );
};
