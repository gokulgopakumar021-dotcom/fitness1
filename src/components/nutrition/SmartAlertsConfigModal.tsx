import React, { useState, useEffect } from 'react';
import {
  Bell,
  Clock,
  Moon,
  Zap,
  Volume2,
  VolumeX,
  Globe,
  Sparkles,
  CheckCircle2,
  AlertTriangle,
  Activity,
  Dumbbell,
  ShieldCheck,
  Send
} from 'lucide-react';
import { Button, Input, Modal } from '../ui';

export interface SmartAlertsConfig {
  enabled: boolean;
  timeZone: string;
  activityLevel: 'rest' | 'moderate' | 'heavy' | 'endurance';
  quietHoursEnabled: boolean;
  quietHoursStart: string; // HH:mm
  quietHoursEnd: string; // HH:mm
  soundChime: boolean;
  notifications: {
    hourlyLagAlert: boolean;
    middayCheckIn: boolean;
    preWorkoutPrimer: boolean;
    postWorkoutReplenish: boolean;
    eveningCatchUp: boolean;
  };
}

export const DEFAULT_SMART_ALERTS_CONFIG: SmartAlertsConfig = {
  enabled: true,
  timeZone: Intl?.DateTimeFormat?.()?.resolvedOptions?.()?.timeZone || 'UTC',
  activityLevel: 'moderate',
  quietHoursEnabled: true,
  quietHoursStart: '22:00',
  quietHoursEnd: '07:00',
  soundChime: true,
  notifications: {
    hourlyLagAlert: true,
    middayCheckIn: true,
    preWorkoutPrimer: true,
    postWorkoutReplenish: true,
    eveningCatchUp: true
  }
};

export const SMART_ALERTS_STORAGE_KEY = 'ironlog_smart_hydration_alerts_v1';

export function getStoredSmartAlertsConfig(): SmartAlertsConfig {
  try {
    const raw = localStorage.getItem(SMART_ALERTS_STORAGE_KEY);
    if (raw) {
      return { ...DEFAULT_SMART_ALERTS_CONFIG, ...JSON.parse(raw) };
    }
  } catch {
    // fallback
  }
  return DEFAULT_SMART_ALERTS_CONFIG;
}

export function saveStoredSmartAlertsConfig(config: SmartAlertsConfig): void {
  try {
    localStorage.setItem(SMART_ALERTS_STORAGE_KEY, JSON.stringify(config));
  } catch {
    // ignore
  }
}

export interface SmartAlertsConfigModalProps {
  isOpen: boolean;
  onClose: () => void;
  config: SmartAlertsConfig;
  onSaveConfig: (updated: SmartAlertsConfig) => void;
}

const COMMON_TIMEZONES = [
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'America/Anchorage',
  'America/Honolulu',
  'Europe/London',
  'Europe/Paris',
  'Europe/Berlin',
  'Asia/Dubai',
  'Asia/Kolkata',
  'Asia/Singapore',
  'Asia/Tokyo',
  'Australia/Sydney',
  'UTC'
];

export const SmartAlertsConfigModal: React.FC<SmartAlertsConfigModalProps> = ({
  isOpen,
  onClose,
  config,
  onSaveConfig
}) => {
  const [localConfig, setLocalConfig] = useState<SmartAlertsConfig>(config);
  const [testSentText, setTestSentText] = useState<string | null>(null);
  const [currentTimeInTz, setCurrentTimeInTz] = useState<string>('');

  useEffect(() => {
    setLocalConfig(config);
  }, [config, isOpen]);

  // Update clock preview in selected timezone
  useEffect(() => {
    const updateTime = () => {
      try {
        const str = new Intl.DateTimeFormat('en-US', {
          timeZone: localConfig.timeZone,
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
          hour12: true
        }).format(new Date());
        setCurrentTimeInTz(str);
      } catch {
        setCurrentTimeInTz(new Date().toLocaleTimeString());
      }
    };
    updateTime();
    const interval = setInterval(updateTime, 1000);
    return () => clearInterval(interval);
  }, [localConfig.timeZone]);

  const updatePartial = (patch: Partial<SmartAlertsConfig>) => {
    setLocalConfig((prev) => ({ ...prev, ...patch }));
  };

  const updateNotificationToggle = (key: keyof SmartAlertsConfig['notifications']) => {
    setLocalConfig((prev) => ({
      ...prev,
      notifications: {
        ...prev.notifications,
        [key]: !prev.notifications[key]
      }
    }));
  };

  const handleSave = () => {
    saveStoredSmartAlertsConfig(localConfig);
    onSaveConfig(localConfig);
    onClose();
  };

  // Test Notification Trigger
  const handleTestNotification = (type: string) => {
    let title = 'IronLog AI — Smart Hydration Alert';
    let body = 'Hydration reminder scheduled according to your smart pacing profile.';

    if (type === 'lag') {
      title = 'IronLog AI — Lag Alert';
      body = 'You are 14 fl oz (414 ml) behind your hourly target. Take a hydration break!';
    } else if (type === 'midday') {
      title = 'IronLog AI — Midday Hydration Check-In';
      body = 'It is 1:00 PM: you have reached 45% of your target. Drink 16 oz to stay primed.';
    } else if (type === 'preworkout') {
      title = 'IronLog AI — Pre-Workout Hydration Prime';
      body = 'Drink 16 fl oz / 500 ml 45 min before lifting for optimal intra-cellular pump.';
    } else if (type === 'quiet') {
      title = 'IronLog AI — Quiet Hours Active';
      body = 'Notifications are currently suppressed during your custom quiet window.';
    }

    if (typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'granted') {
      try {
        new Notification(title, { body, icon: '/favicon.ico' });
      } catch {
        // ignore
      }
    }

    // Audio chime if enabled
    if (localConfig.soundChime) {
      try {
        const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
        if (AudioCtx) {
          const ctx = new AudioCtx();
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.type = 'sine';
          osc.frequency.setValueAtTime(659.25, ctx.currentTime); // E5
          osc.frequency.exponentialRampToValueAtTime(880, ctx.currentTime + 0.15); // A5
          gain.gain.setValueAtTime(0.1, ctx.currentTime);
          gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4);
          osc.connect(gain);
          gain.connect(ctx.destination);
          osc.start();
          osc.stop(ctx.currentTime + 0.4);
        }
      } catch {
        // ignore
      }
    }

    setTestSentText(`Sent "${title}" sample!`);
    setTimeout(() => setTestSentText(null), 3000);
  };

  return (
    <Modal
      open={isOpen}
      onClose={onClose}
      size="lg"
      title="Smart Alerts Configuration"
      description="Time-zone aware, activity-based push notifications & quiet hours"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={handleSave} icon={<CheckCircle2 className="w-4 h-4" />}>
            Save Smart Alerts
          </Button>
        </>
      }
    >
    <div className="space-y-5 text-xs font-mono">
        {/* 1. Master Enable Switch */}
        <div className="p-3.5 rounded-2xl bg-[var(--bg-subtle)] border border-[var(--border-card)] flex items-center justify-between">
          <div>
            <span className="font-bold text-sm text-white block">Smart Push Alerts</span>
            <span className="text-[11px] text-[var(--text-muted)]">
              Master switch for background hourly and situational hydration reminders
            </span>
          </div>
          <label className="relative inline-flex items-center cursor-pointer">
            <input
              type="checkbox"
              checked={localConfig.enabled}
              onChange={(e) => updatePartial({ enabled: e.target.checked })}
              className="sr-only peer"
            />
            <div className="w-11 h-6 bg-surface-3 border border-line-strong peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-line-strong after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-sky-500"></div>
          </label>
        </div>

        {/* 2. Time Zone & Live Clock */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-sky-400 uppercase tracking-wider flex items-center gap-1.5">
              <Globe className="w-4 h-4" />
              <span>1. Time Zone Configuration</span>
            </span>
            <span className="text-[11px] font-bold text-emerald-400 tabular-nums">
              Local Time: {currentTimeInTz}
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <div className="sm:col-span-2">
              <select
                value={localConfig.timeZone}
                onChange={(e) => updatePartial({ timeZone: e.target.value })}
                className="w-full p-2.5 rounded-xl bg-[var(--bg-canvas)] border border-[var(--border-card)] text-white text-xs outline-none focus:border-sky-400 cursor-pointer"
              >
                {COMMON_TIMEZONES.map((tz) => (
                  <option key={tz} value={tz} className="bg-slate-900 text-white">
                    {tz}
                  </option>
                ))}
              </select>
            </div>

            <button
              type="button"
              onClick={() => {
                const detected = Intl.DateTimeFormat().resolvedOptions().timeZone;
                if (detected) updatePartial({ timeZone: detected });
              }}
              className="px-3 py-2 rounded-xl bg-[var(--chip-bg)] hover:bg-[var(--chip-bg)] border border-[var(--border-card)] hover:border-sky-400 text-sky-400 font-bold text-xs transition-colors"
            >
              Auto-Detect
            </button>
          </div>
          <p className="text-[10px] text-[var(--text-muted)]">
            Ensures notifications align with your local circadian rhythm and meal windows.
          </p>
        </div>

        {/* 3. Daily Activity Level Cadence */}
        <div className="space-y-2">
          <span className="text-xs font-bold text-sky-400 uppercase tracking-wider flex items-center gap-1.5">
            <Activity className="w-4 h-4" />
            <span>2. Daily Activity Level &amp; Pacing Cadence</span>
          </span>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {[
              { id: 'rest', label: 'Rest Day', sub: 'Baseline cadence (2-3 hrs)', boost: '+0 ml' },
              { id: 'moderate', label: 'Moderate', sub: 'Gym session (90 min)', boost: '+500 ml' },
              { id: 'heavy', label: 'Heavy Lift', sub: 'Heavy compound (60 min)', boost: '+1,000 ml' },
              { id: 'endurance', label: 'Endurance', sub: 'High heat (45 min)', boost: '+1,200 ml' }
            ].map((lvl) => (
              <button
                key={lvl.id}
                type="button"
                onClick={() => updatePartial({ activityLevel: lvl.id as any })}
                className={`p-2.5 rounded-xl border text-left transition-all ${
                  localConfig.activityLevel === lvl.id
                    ? 'bg-sky-500/20 border-sky-400 text-sky-300 shadow-sm'
                    : 'bg-[var(--bg-canvas)] border-[var(--border-card)] text-[var(--text-muted)] hover:text-white'
                }`}
              >
                <span className="font-bold text-xs block text-white">{lvl.label}</span>
                <span className="text-[10px] block opacity-80 mt-0.5">{lvl.sub}</span>
                <span className="text-[9px] font-bold text-emerald-400 mt-1 block">
                  {lvl.boost}
                </span>
              </button>
            ))}
          </div>
          <p className="text-[10px] text-[var(--text-muted)]">
            Higher training days shorten alert intervals and prime hydration before workouts.
          </p>
        </div>

        {/* 4. Custom Quiet Hours (Suppression Window) */}
        <div className="space-y-2 p-3.5 rounded-2xl bg-[var(--bg-subtle)] border border-[var(--border-card)]">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-white flex items-center gap-1.5">
              <Moon className="w-4 h-4 text-amber-400" />
              <span>3. Custom Quiet Hours (Suppress All Alerts)</span>
            </span>

            <label className="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                checked={localConfig.quietHoursEnabled}
                onChange={(e) => updatePartial({ quietHoursEnabled: e.target.checked })}
                className="sr-only peer"
              />
              <div className="w-9 h-5 bg-surface-3 border border-line-strong peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-line-strong after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-amber-500"></div>
            </label>
          </div>

          <div className="grid grid-cols-2 gap-3 pt-1">
            <div>
              <Input
                label="Quiet Starts (Night)"
                type="time"
                disabled={!localConfig.quietHoursEnabled}
                value={localConfig.quietHoursStart}
                onChange={(e) => updatePartial({ quietHoursStart: e.target.value })}
              />
            </div>

            <div>
              <Input
                label="Quiet Ends (Morning)"
                type="time"
                disabled={!localConfig.quietHoursEnabled}
                value={localConfig.quietHoursEnd}
                onChange={(e) => updatePartial({ quietHoursEnd: e.target.value })}
              />
            </div>
          </div>

          <p className="text-[10px] text-[var(--text-muted)]">
            All browser notifications and audio chimes are muted between {localConfig.quietHoursStart} and {localConfig.quietHoursEnd} to protect sleep hygiene.
          </p>
        </div>

        {/* 5. Specific Push Notification Triggers */}
        <div className="space-y-2">
          <span className="text-xs font-bold text-sky-400 uppercase tracking-wider flex items-center gap-1.5">
            <Zap className="w-4 h-4" />
            <span>4. Specific Notification Types</span>
          </span>

          <div className="space-y-2">
            {[
              {
                id: 'hourlyLagAlert' as const,
                title: 'Hourly Pacing Lag Alert',
                desc: 'Fires when falling >12 oz behind expected pace during active hours.'
              },
              {
                id: 'middayCheckIn' as const,
                title: 'Midday Progress Check-In (1:00 PM)',
                desc: 'Brief status reminder if below 50% of daily hydration by early afternoon.'
              },
              {
                id: 'preWorkoutPrimer' as const,
                title: 'Pre-Workout Hydration Primer',
                desc: 'Reminds you to drink 16 oz (500 ml) 45 min before your scheduled workout.'
              },
              {
                id: 'postWorkoutReplenish' as const,
                title: 'Post-Workout Fluid Recovery',
                desc: 'Alerts to replenish sweat and electrolyte volume right after logging a workout.'
              },
              {
                id: 'eveningCatchUp' as const,
                title: 'Evening Catch-Up Warning',
                desc: 'Notifies 2 hours before quiet hours if daily hydration is below 85%.'
              }
            ].map((item) => (
              <div
                key={item.id}
                className="p-2.5 rounded-xl bg-[var(--bg-canvas)] border border-[var(--border-card)] flex items-center justify-between gap-3"
              >
                <div>
                  <span className="font-bold text-white text-xs block">{item.title}</span>
                  <span className="text-[10px] text-[var(--text-muted)]">{item.desc}</span>
                </div>

                <input
                  type="checkbox"
                  checked={localConfig.notifications[item.id]}
                  onChange={() => updateNotificationToggle(item.id)}
                  className="w-4 h-4 accent-sky-500 rounded cursor-pointer shrink-0"
                />
              </div>
            ))}
          </div>
        </div>

        {/* 6. Sound Chime & Live Test Alerts */}
        <div className="p-3 rounded-2xl bg-[var(--bg-subtle)] border border-[var(--border-card)] space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              {localConfig.soundChime ? (
                <Volume2 className="w-4 h-4 text-sky-400" />
              ) : (
                <VolumeX className="w-4 h-4 text-[var(--text-muted)]" />
              )}
              <span className="font-bold text-white text-xs">Audio Chime On Alert</span>
            </div>
            <input
              type="checkbox"
              checked={localConfig.soundChime}
              onChange={(e) => updatePartial({ soundChime: e.target.checked })}
              className="w-4 h-4 accent-sky-500 rounded cursor-pointer"
            />
          </div>

          <div className="pt-2 border-t border-[var(--border-card)] flex flex-wrap items-center gap-2">
            <span className="text-[10px] text-[var(--text-muted)] w-full">
              Test Push Notification Triggers:
            </span>
            <button
              type="button"
              onClick={() => handleTestNotification('lag')}
              className="px-2.5 py-1 rounded-lg bg-[var(--bg-canvas)] hover:bg-[var(--chip-bg)] border border-[var(--border-card)] text-sky-400 text-[10px] font-bold"
            >
              Test Lag Alert
            </button>
            <button
              type="button"
              onClick={() => handleTestNotification('midday')}
              className="px-2.5 py-1 rounded-lg bg-[var(--bg-canvas)] hover:bg-[var(--chip-bg)] border border-[var(--border-card)] text-sky-400 text-[10px] font-bold"
            >
              Test Midday
            </button>
            <button
              type="button"
              onClick={() => handleTestNotification('preworkout')}
              className="px-2.5 py-1 rounded-lg bg-[var(--bg-canvas)] hover:bg-[var(--chip-bg)] border border-[var(--border-card)] text-sky-400 text-[10px] font-bold"
            >
              Test Pre-Workout
            </button>
          </div>

          {testSentText && (
            <div className="p-2 rounded-lg bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 text-[11px] flex items-center gap-1.5 animate-fadeIn">
              <CheckCircle2 className="w-3.5 h-3.5" />
              <span>{testSentText}</span>
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
};
