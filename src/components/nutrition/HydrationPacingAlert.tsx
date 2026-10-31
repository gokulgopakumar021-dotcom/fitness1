import React, { useState, useEffect, useRef } from 'react';
import {
  Bell,
  BellRing,
  BellOff,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Droplets,
  Settings,
  Volume2,
  VolumeX,
  Zap,
  Sparkles,
  ChevronDown,
  ChevronUp,
  X,
  Info,
  Globe,
  Moon,
  Activity
} from 'lucide-react';
import { WaterUnit } from './WaterIntakeLogger';
import {
  SmartAlertsConfigModal,
  SmartAlertsConfig,
  getStoredSmartAlertsConfig,
  saveStoredSmartAlertsConfig
} from './SmartAlertsConfigModal';
import { Select } from '../ui';

const ML_PER_FL_OZ = 29.5735296;

export interface HydrationPacingAlertProps {
  currentWaterMl: number;
  goalMl: number;
  goalOz: number;
  unit: WaterUnit;
  onQuickAddWater: (amountMl: number) => void;
  selectedDate: string;
}

export interface HydrationReminderSettings {
  enabled: boolean;
  intervalHours: number; // 1, 2, or 3
  wakeHour: number; // 6 to 9 (e.g. 7 = 7 AM)
  sleepHour: number; // 21 to 24 (e.g. 22 = 10 PM)
  soundEnabled: boolean;
}

const DEFAULT_SETTINGS: HydrationReminderSettings = {
  enabled: false,
  intervalHours: 1,
  wakeHour: 7,
  sleepHour: 22,
  soundEnabled: true
};

const STORAGE_KEY = 'ironlog_hydration_pacing_reminders_v1';
const LAST_ALERT_TIMESTAMP_KEY = 'ironlog_last_hydration_alert_ts_v1';

export const HydrationPacingAlert: React.FC<HydrationPacingAlertProps> = ({
  currentWaterMl,
  goalMl,
  goalOz,
  unit,
  onQuickAddWater,
  selectedDate
}) => {
  const [settings, setSettings] = useState<HydrationReminderSettings>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) return { ...DEFAULT_SETTINGS, ...JSON.parse(saved) };
    } catch {
      // ignore
    }
    return DEFAULT_SETTINGS;
  });

  const [notificationPermission, setNotificationPermission] = useState<NotificationPermission>(() => {
    if (typeof window !== 'undefined' && 'Notification' in window) {
      return Notification.permission;
    }
    return 'default';
  });

  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [testSentMessage, setTestSentMessage] = useState<string | null>(null);
  const [currentTime, setCurrentTime] = useState(() => new Date());
  const [isDismissedForSession, setIsDismissedForSession] = useState(false);

  // Keep current time updated every minute
  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 60000);
    return () => clearInterval(timer);
  }, []);

  // Sync settings to localStorage
  const updateSettings = (partial: Partial<HydrationReminderSettings>) => {
    const updated = { ...settings, ...partial };
    setSettings(updated);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
    } catch {
      // ignore
    }
  };

  const todayKey = new Date().toISOString().split('T')[0];
  const isViewingToday = selectedDate === todayKey;

  const [smartConfig, setSmartConfig] = useState<SmartAlertsConfig>(() => getStoredSmartAlertsConfig());
  const [isSmartAlertsModalOpen, setIsSmartAlertsModalOpen] = useState(false);

  // Check if current time is inside quiet hours
  const isCurrentlyInQuietHours = (): boolean => {
    if (!smartConfig.quietHoursEnabled) return false;
    try {
      const now = new Date();
      const formatter = new Intl.DateTimeFormat('en-US', {
        timeZone: smartConfig.timeZone || undefined,
        hour: 'numeric',
        minute: 'numeric',
        hour12: false
      });
      const parts = formatter.formatToParts(now);
      const h = parseInt(parts.find((p) => p.type === 'hour')?.value || '0', 10);
      const m = parseInt(parts.find((p) => p.type === 'minute')?.value || '0', 10);
      const currentMin = h * 60 + m;

      const [startH, startM] = smartConfig.quietHoursStart.split(':').map((v) => parseInt(v, 10));
      const [endH, endM] = smartConfig.quietHoursEnd.split(':').map((v) => parseInt(v, 10));
      const startMin = startH * 60 + (startM || 0);
      const endMin = endH * 60 + (endM || 0);

      if (startMin <= endMin) {
        return currentMin >= startMin && currentMin < endMin;
      } else {
        return currentMin >= startMin || currentMin < endMin;
      }
    } catch {
      return false;
    }
  };

  const isQuietHoursActive = isCurrentlyInQuietHours();

  // Sound Synthesizer via Web Audio API
  const playAlertChime = () => {
    if (!settings.soundEnabled || !smartConfig.soundChime) return;
    try {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioCtx) return;
      const ctx = new AudioCtx();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(587.33, ctx.currentTime); // D5
      osc.frequency.exponentialRampToValueAtTime(880, ctx.currentTime + 0.12); // A5

      gain.gain.setValueAtTime(0.12, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.45);

      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.45);
    } catch {
      // Audio might be muted or blocked by browser policy
    }
  };

  // Dispatch System Web Notification
  const dispatchPushNotification = (title: string, body: string) => {
    if (isCurrentlyInQuietHours()) {
      return;
    }

    if (typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'granted') {
      try {
        new Notification(title, {
          body,
          icon: '/favicon.ico',
          tag: 'hydration-hourly-pacing'
        });
      } catch (err) {
        console.warn('System push notification dispatch error:', err);
      }
    }
    if (smartConfig.soundChime && settings.soundEnabled) {
      playAlertChime();
    }
  };

  // Calculate Hourly Target & Deficit
  const { wakeHour, sleepHour } = settings;
  const totalActiveHours = Math.max(8, sleepHour - wakeHour);
  const hourlyRateMl = goalMl > 0 ? goalMl / totalActiveHours : 200;
  const hourlyRateOz = hourlyRateMl * 0.033814;

  const currentHourFloat = currentTime.getHours() + currentTime.getMinutes() / 60;

  let expectedIntakeMl = 0;
  if (!isViewingToday) {
    // If viewing a past day, expected intake is full daily target
    expectedIntakeMl = goalMl;
  } else if (currentHourFloat <= wakeHour) {
    // Just waking up: expect 1 glass (250ml) baseline
    expectedIntakeMl = 250;
  } else if (currentHourFloat >= sleepHour) {
    // End of day: expected 100% of goal
    expectedIntakeMl = goalMl;
  } else {
    // In the middle of active day
    const hoursAwake = currentHourFloat - wakeHour;
    expectedIntakeMl = Math.round(Math.min(goalMl, hoursAwake * hourlyRateMl));
  }

  const expectedIntakeOz = Math.round(expectedIntakeMl * 0.033814);
  const currentOz = Math.round(currentWaterMl * 0.033814);

  // Variance: positive = ahead, negative = behind
  const deficitMl = expectedIntakeMl - currentWaterMl;
  const deficitOz = expectedIntakeOz - currentOz;

  const isBehindPace = deficitMl > 120; // behind by more than ~4 oz
  const isSeverelyBehind = deficitMl > 450; // behind by more than ~15 oz
  const isAheadOfPace = deficitMl < -100;
  const isOnPace = !isBehindPace && !isAheadOfPace;

  // Hourly Background Interval Checker
  useEffect(() => {
    if (!settings.enabled || !isViewingToday) return;

    const checkInterval = setInterval(() => {
      const now = new Date();
      const hour = now.getHours();

      // Only check during active waking hours
      if (hour < settings.wakeHour || hour >= settings.sleepHour) return;

      // Rate limit alerts to intervalHours
      try {
        const lastAlertStr = localStorage.getItem(LAST_ALERT_TIMESTAMP_KEY);
        const lastAlertTs = lastAlertStr ? parseInt(lastAlertStr, 10) : 0;
        const hoursSinceLastAlert = (Date.now() - lastAlertTs) / (1000 * 60 * 60);

        if (hoursSinceLastAlert >= settings.intervalHours && isBehindPace) {
          const formattedDeficit =
            unit === 'oz' ? `${deficitOz} fl oz` : `${deficitMl.toLocaleString()} ml`;

          dispatchPushNotification(
            'IronLog AI — Hydration Alert',
            `You are ${formattedDeficit} behind your hourly hydration target. Drink a glass of water now to stay on pace!`
          );

          localStorage.setItem(LAST_ALERT_TIMESTAMP_KEY, Date.now().toString());
        }
      } catch {
        // ignore storage errors
      }
    }, 60000 * 5); // Check every 5 minutes

    return () => clearInterval(checkInterval);
  }, [
    settings.enabled,
    settings.intervalHours,
    settings.wakeHour,
    settings.sleepHour,
    isViewingToday,
    isBehindPace,
    deficitMl,
    deficitOz,
    unit
  ]);

  // Request Notification Permission
  const handleRequestPermission = async () => {
    if (!('Notification' in window)) {
      alert('This browser does not support desktop notifications. In-app visual alerts will remain active.');
      return;
    }

    try {
      const permission = await Notification.requestPermission();
      setNotificationPermission(permission);

      if (permission === 'granted') {
        updateSettings({ enabled: true });
        dispatchPushNotification(
          'IronLog AI — Hydration Alerts Enabled',
          `Hourly hydration reminders scheduled for ${settings.wakeHour}:00 to ${settings.sleepHour}:00.`
        );
        setTestSentMessage('Push notifications enabled & test alert sent!');
        setTimeout(() => setTestSentMessage(null), 3500);
      } else {
        updateSettings({ enabled: false });
      }
    } catch (e) {
      console.error('Error requesting notification permission:', e);
    }
  };

  const handleSendTestNotification = () => {
    const formattedDeficit =
      unit === 'oz' ? `${Math.max(8, deficitOz)} fl oz` : `${Math.max(250, deficitMl)} ml`;

    dispatchPushNotification(
      'IronLog AI — Hydration Test Alert',
      `Sample check: Currently at ${unit === 'oz' ? `${currentOz} oz` : `${currentWaterMl} ml`}. Target pace is ${unit === 'oz' ? `${expectedIntakeOz} oz` : `${expectedIntakeMl} ml`}.`
    );

    setTestSentMessage('Test alert sent to your notification center & audio chime triggered!');
    setTimeout(() => setTestSentMessage(null), 3500);
  };

  const currentFormattedTime = currentTime.toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit'
  });

  return (
    <div className="space-y-3">
      {/* 1. VISUAL ALERT BANNER (Active when behind pace or when configured) */}
      {isBehindPace && !isDismissedForSession && isViewingToday && (
        <div
          className={`p-3.5 sm:p-4 rounded-2xl border transition-all duration-300 relative overflow-hidden shadow-lg ${
            isSeverelyBehind
              ? 'bg-rose-950/40 border-rose-500/40 text-rose-200'
              : 'bg-amber-950/40 border-amber-500/40 text-amber-200'
          }`}
        >
          {/* Subtle pulse bar accent */}
          <div
            className={`absolute top-0 left-0 bottom-0 w-1.5 ${
              isSeverelyBehind ? 'bg-rose-500' : 'bg-amber-400'
            }`}
          />

          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pl-2">
            <div className="flex items-start gap-3">
              <div
                className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 border ${
                  isSeverelyBehind
                    ? 'bg-rose-500/20 border-rose-400/40 text-rose-400'
                    : 'bg-amber-500/20 border-amber-400/40 text-amber-400'
                }`}
              >
                <AlertTriangle className="w-5 h-5 animate-pulse" />
              </div>

              <div>
                <div className="flex items-center gap-2">
                  <span className="text-xs font-mono font-bold uppercase tracking-wider">
                    {isSeverelyBehind ? 'Hydration Lag Alert' : 'Behind Hourly Hydration Pace'}
                  </span>
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-black/40 border border-white/10 text-white">
                    {currentFormattedTime}
                  </span>
                </div>

                <p className="text-xs sm:text-sm font-sans font-medium text-white mt-0.5">
                  You are{' '}
                  <strong className={isSeverelyBehind ? 'text-rose-400' : 'text-amber-300'}>
                    {unit === 'oz' ? `${deficitOz} fl oz` : `${deficitMl.toLocaleString()} ml`}
                  </strong>{' '}
                  behind your hourly schedule ({unit === 'oz' ? `${currentOz}/${expectedIntakeOz} oz` : `${currentWaterMl}/${expectedIntakeMl} ml`} expected by now).
                </p>
                <p className="text-[11px] font-mono text-[var(--text-muted)] mt-0.5">
                  Drink a glass to maintain blood flow, intra-muscular volume, and lifting stamina.
                </p>
              </div>
            </div>

            {/* Quick Catch-Up One-Tap Buttons */}
            <div className="flex items-center gap-2 self-start sm:self-center shrink-0">
              {unit === 'oz' ? (
                <>
                  <button
                    type="button"
                    onClick={() => onQuickAddWater(237)}
                    className="px-3 py-1.5 rounded-xl bg-sky-500 hover:bg-sky-400 text-white font-mono font-bold text-xs shadow-sm transition-transform active:scale-95 flex items-center gap-1"
                    title="Log 8 fl oz (237 ml)"
                  >
                    <Droplets className="w-3.5 h-3.5" />
                    <span>+8 oz</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => onQuickAddWater(473)}
                    className="px-3 py-1.5 rounded-xl bg-sky-600 hover:bg-sky-500 text-white font-mono font-bold text-xs shadow-sm transition-transform active:scale-95 flex items-center gap-1"
                    title="Log 16 fl oz (473 ml)"
                  >
                    <Droplets className="w-3.5 h-3.5" />
                    <span>+16 oz</span>
                  </button>
                </>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={() => onQuickAddWater(250)}
                    className="px-3 py-1.5 rounded-xl bg-sky-500 hover:bg-sky-400 text-white font-mono font-bold text-xs shadow-sm transition-transform active:scale-95 flex items-center gap-1"
                    title="Log 250 ml"
                  >
                    <Droplets className="w-3.5 h-3.5" />
                    <span>+250ml</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => onQuickAddWater(500)}
                    className="px-3 py-1.5 rounded-xl bg-sky-600 hover:bg-sky-500 text-white font-mono font-bold text-xs shadow-sm transition-transform active:scale-95 flex items-center gap-1"
                    title="Log 500 ml"
                  >
                    <Droplets className="w-3.5 h-3.5" />
                    <span>+500ml</span>
                  </button>
                </>
              )}

              <button
                type="button"
                onClick={() => setIsDismissedForSession(true)}
                className="p-1.5 rounded-lg text-[var(--text-muted)] hover:text-white hover:bg-white/10 transition-colors"
                title="Dismiss alert for now"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 2. HOURLY PACING BAR & PUSH NOTIFICATION CONTROLLER RIBBON */}
      <div className="p-3.5 sm:p-4 rounded-2xl bg-[var(--bg-subtle)] border border-[var(--border-card)] space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
          {/* Pacing status label */}
          <div className="flex items-center gap-2.5">
            <div
              className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 border ${
                isBehindPace
                  ? 'bg-amber-500/15 border-amber-500/30 text-amber-400'
                  : isOnPace
                  ? 'bg-sky-500/15 border-sky-500/30 text-sky-400'
                  : 'bg-emerald-500/15 border-emerald-500/30 text-emerald-400'
              }`}
            >
              <Clock className="w-4 h-4" />
            </div>

            <div>
              <div className="flex items-center gap-2">
                <span className="text-xs font-mono font-bold text-[var(--text-primary)]">
                  Hourly Hydration Pacing
                </span>
                <span
                  className={`text-[10px] font-mono px-2 py-0.5 rounded-full font-bold border ${
                    isBehindPace
                      ? 'bg-amber-500/15 text-amber-400 border-amber-400/30'
                      : isOnPace
                      ? 'bg-sky-500/15 text-sky-400 border-sky-400/30'
                      : 'bg-emerald-500/15 text-emerald-400 border-emerald-400/30'
                  }`}
                >
                  {isBehindPace
                    ? `Behind (${unit === 'oz' ? `-${deficitOz} oz` : `-${deficitMl} ml`})`
                    : isOnPace
                    ? 'On Target Pace'
                    : `Ahead (+${unit === 'oz' ? Math.abs(deficitOz) + ' oz' : Math.abs(deficitMl) + ' ml'})`}
                </span>
              </div>
              <p className="text-[11px] font-mono text-[var(--text-muted)]">
                Target rate: ≈ {unit === 'oz' ? `${hourlyRateOz.toFixed(1)} fl oz` : `${Math.round(hourlyRateMl)} ml`} / hour (between {wakeHour}:00 and {sleepHour}:00)
              </p>

              {/* Smart Alerts Active Configuration Tags */}
              <div className="flex flex-wrap items-center gap-1.5 pt-1 text-[10px] font-mono">
                <span className="px-2 py-0.5 rounded-md bg-[var(--bg-canvas)] border border-[var(--border-card)] text-[var(--text-muted)] flex items-center gap-1">
                  <Globe className="w-3 h-3 text-sky-400" />
                  <span>{smartConfig.timeZone.split('/').pop()?.replace(/_/g, ' ') || smartConfig.timeZone}</span>
                </span>
                <span className="px-2 py-0.5 rounded-md bg-[var(--bg-canvas)] border border-[var(--border-card)] text-[var(--text-muted)] flex items-center gap-1">
                  <Activity className="w-3 h-3 text-emerald-400" />
                  <span className="capitalize">{smartConfig.activityLevel} Day</span>
                </span>
                {smartConfig.quietHoursEnabled && (
                  <span
                    className={`px-2 py-0.5 rounded-md border flex items-center gap-1 ${
                      isQuietHoursActive
                        ? 'bg-amber-500/15 border-amber-500/30 text-amber-300 font-bold'
                        : 'bg-[var(--bg-canvas)] border-[var(--border-card)] text-[var(--text-muted)]'
                    }`}
                  >
                    <Moon className="w-3 h-3 text-amber-400" />
                    <span>
                      {isQuietHoursActive
                        ? `Quiet Hours (${smartConfig.quietHoursStart}–${smartConfig.quietHoursEnd}) Active`
                        : `Quiet: ${smartConfig.quietHoursStart}–${smartConfig.quietHoursEnd}`}
                    </span>
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* Controls: Push Notifications Toggle & Smart Alerts Config Trigger */}
          <div className="flex items-center gap-2 self-start sm:self-auto">
            {/* Smart Alerts Configuration Modal Trigger */}
            <button
              type="button"
              onClick={() => setIsSmartAlertsModalOpen(true)}
              className="px-2.5 py-1.5 rounded-xl bg-sky-500/10 hover:bg-sky-500/20 border border-sky-400/30 text-sky-400 font-mono text-xs font-bold transition-all flex items-center gap-1.5 shadow-sm"
              title="Configure Smart Alerts (Time Zone, Activity Level, Quiet Hours)"
            >
              <Sparkles className="w-3.5 h-3.5" />
              <span>Smart Alerts</span>
            </button>

            {/* Push Notification Toggle Button */}
            <button
              type="button"
              onClick={() => {
                if (!settings.enabled && notificationPermission !== 'granted') {
                  handleRequestPermission();
                } else {
                  updateSettings({ enabled: !settings.enabled });
                }
              }}
              className={`px-3 py-1.5 rounded-xl border font-mono text-xs font-bold transition-all flex items-center gap-1.5 shadow-sm ${
                settings.enabled
                  ? 'bg-sky-500/15 border-sky-400 text-sky-400 hover:bg-sky-500/25'
                  : 'bg-[var(--bg-canvas)] border-[var(--border-card)] text-[var(--text-muted)] hover:text-[var(--text-primary)]'
              }`}
              title={settings.enabled ? 'Push notifications active' : 'Enable hourly push notifications'}
            >
              {settings.enabled ? (
                <>
                  <BellRing className="w-3.5 h-3.5 text-sky-400 animate-pulse" />
                  <span>Push Alerts: ON</span>
                </>
              ) : (
                <>
                  <Bell className="w-3.5 h-3.5" />
                  <span>Push Alerts: OFF</span>
                </>
              )}
            </button>

            {/* Settings Gear */}
            <button
              type="button"
              onClick={() => setIsSettingsOpen(!isSettingsOpen)}
              className={`p-2 rounded-xl border transition-colors ${
                isSettingsOpen
                  ? 'bg-sky-500/20 border-sky-400 text-sky-400'
                  : 'bg-[var(--bg-canvas)] border-[var(--border-card)] text-[var(--text-muted)] hover:text-white'
              }`}
              title="Schedule notification settings"
            >
              <Settings className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Hourly Pacing Visual Gauge */}
        <div className="space-y-1 pt-1">
          <div className="flex items-center justify-between text-[10px] font-mono text-[var(--text-muted)]">
            <span>{wakeHour}:00 (Wake)</span>
            <span>
              Expected by {currentFormattedTime}:{' '}
              <strong className="text-white">
                {unit === 'oz' ? `${expectedIntakeOz} oz` : `${expectedIntakeMl.toLocaleString()} ml`}
              </strong>
            </span>
            <span>{sleepHour}:00 (Target: {unit === 'oz' ? `${goalOz} oz` : `${goalMl} ml`})</span>
          </div>

          <div className="relative w-full bg-[var(--chip-bg)] h-3 rounded-full overflow-hidden border border-[var(--border-card)] shadow-inner">
            {/* Expected progress marker bar (subtle ghost line) */}
            <div
              className="absolute top-0 bottom-0 bg-white/20 z-0 border-r-2 border-white/80"
              style={{
                width: `${Math.min(100, goalMl > 0 ? (expectedIntakeMl / goalMl) * 100 : 0)}%`
              }}
              title="Expected pacing position"
            />

            {/* Actual logged progress bar */}
            <div
              className={`h-full rounded-full transition-all duration-500 z-10 relative ${
                isBehindPace
                  ? 'bg-gradient-to-r from-amber-500 to-amber-400'
                  : 'bg-gradient-to-r from-sky-500 via-cyan-400 to-emerald-400'
              }`}
              style={{
                width: `${Math.min(100, goalMl > 0 ? (currentWaterMl / goalMl) * 100 : 0)}%`
              }}
            />
          </div>

          <div className="flex justify-between text-[10px] font-mono">
            <span className="text-[var(--text-muted)]">
              Logged: {unit === 'oz' ? `${currentOz} oz` : `${currentWaterMl} ml`}
            </span>
            <span
              className={
                isBehindPace
                  ? 'text-amber-400 font-bold'
                  : isOnPace
                  ? 'text-sky-400'
                  : 'text-emerald-400 font-bold'
              }
            >
              {isBehindPace
                ? `Deficit: ${unit === 'oz' ? deficitOz + ' oz' : deficitMl + ' ml'}`
                : isOnPace
                ? 'Pacing strictly on schedule'
                : `Surplus: +${unit === 'oz' ? Math.abs(deficitOz) + ' oz' : Math.abs(deficitMl) + ' ml'}`}
            </span>
          </div>
        </div>

        {/* 3. SETTINGS & SCHEDULING DRAWER */}
        {isSettingsOpen && (
          <div className="mt-3 pt-3 border-t border-[var(--border-card)] space-y-3.5 text-xs font-mono animate-fadeIn">
            <div className="flex items-center justify-between">
              <span className="font-bold text-[var(--text-primary)] flex items-center gap-1.5">
                <Bell className="w-3.5 h-3.5 text-sky-400" />
                <span>Hydration Alert &amp; Push Notification Scheduler</span>
              </span>
              <span className="text-[10px] text-[var(--text-muted)]">
                Status:{' '}
                <strong
                  className={
                    notificationPermission === 'granted'
                      ? 'text-emerald-400'
                      : notificationPermission === 'denied'
                      ? 'text-rose-400'
                      : 'text-amber-400'
                  }
                >
                  {notificationPermission.toUpperCase()}
                </strong>
              </span>
            </div>

            {/* Notification Permission Banner if not yet granted */}
            {notificationPermission !== 'granted' && (
              <div className="p-3 rounded-xl bg-sky-500/10 border border-sky-400/20 text-[11px] text-[var(--text-secondary)] space-y-2">
                <p>
                  To receive background hourly alerts on your desktop or phone when you lag behind target, grant notification permission:
                </p>
                <button
                  type="button"
                  onClick={handleRequestPermission}
                  className="px-3.5 py-1.5 rounded-lg bg-sky-500 hover:bg-sky-400 text-white font-bold transition-colors"
                >
                  Enable Browser Push Notifications
                </button>
              </div>
            )}

            {/* Frequency & Active Hours Form */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <Select
                label="Alert Frequency"
                value={settings.intervalHours}
                onChange={(e) => updateSettings({ intervalHours: parseInt(e.target.value, 10) })}
              >
                <option value={1}>Every 1 Hour</option>
                <option value={2}>Every 2 Hours</option>
                <option value={3}>Every 3 Hours</option>
              </Select>

              <Select
                label="Wake Schedule"
                value={settings.wakeHour}
                onChange={(e) => updateSettings({ wakeHour: parseInt(e.target.value, 10) })}
              >
                {[6, 7, 8, 9].map((h) => (
                  <option key={h} value={h}>
                    {h}:00 AM
                  </option>
                ))}
              </Select>

              <Select
                label="Bedtime Schedule"
                value={settings.sleepHour}
                onChange={(e) => updateSettings({ sleepHour: parseInt(e.target.value, 10) })}
              >
                {[20, 21, 22, 23, 24].map((h) => (
                  <option key={h} value={h}>
                    {h === 24 ? '12:00 AM' : `${h - 12}:00 PM`}
                  </option>
                ))}
              </Select>
            </div>

            {/* Sound Chime & Test Push Alert Actions */}
            <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
              <button
                type="button"
                onClick={() => updateSettings({ soundEnabled: !settings.soundEnabled })}
                className="flex items-center gap-1.5 text-xs text-[var(--text-secondary)] hover:text-white"
              >
                {settings.soundEnabled ? (
                  <>
                    <Volume2 className="w-3.5 h-3.5 text-sky-400" />
                    <span>Alert Chime: Enabled</span>
                  </>
                ) : (
                  <>
                    <VolumeX className="w-3.5 h-3.5 text-[var(--text-muted)]" />
                    <span>Alert Chime: Muted</span>
                  </>
                )}
              </button>

              <button
                type="button"
                onClick={handleSendTestNotification}
                className="px-3 py-1 rounded-lg bg-[var(--chip-bg)] hover:bg-[var(--chip-bg)] border border-[var(--border-card)] text-sky-400 hover:text-sky-300 font-bold text-xs transition-colors flex items-center gap-1"
              >
                <Sparkles className="w-3 h-3" />
                <span>Send Test Alert</span>
              </button>
            </div>

            {testSentMessage && (
              <div className="p-2 rounded-lg bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 text-xs flex items-center gap-1.5 animate-fadeIn">
                <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                <span>{testSentMessage}</span>
              </div>
            )}
          </div>
        )}
      </div>

      {/* SMART ALERTS CONFIGURATION MODAL */}
      <SmartAlertsConfigModal
        isOpen={isSmartAlertsModalOpen}
        onClose={() => setIsSmartAlertsModalOpen(false)}
        config={smartConfig}
        onSaveConfig={(updated) => setSmartConfig(updated)}
      />
    </div>
  );
};
