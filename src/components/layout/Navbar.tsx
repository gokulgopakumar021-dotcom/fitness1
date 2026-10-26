import React, { useState } from 'react';
import {
  Flame,
  Dumbbell,
  TrendingUp,
  Apple,
  Activity,
  FileSpreadsheet,
  BarChart3,
  Settings,
  Sparkles,
  Play,
  Pause,
  Bot,
  Bluetooth,
  Menu,
  ChevronRight,
  Sun,
  Moon,
  History
} from 'lucide-react';
import { UserProfile, WorkoutSession } from '../../types';
import { useBluetoothGadget } from '../../context/BluetoothGadgetContext';
import { useTheme } from '../../context/ThemeContext';
import { Modal } from '../ui/Modal';
import { cn } from '../ui/cn';

export type NavTab =
  | 'dashboard'
  | 'workouts'
  | 'progression'
  | 'nutrition'
  | 'body'
  | 'plans'
  | 'reports'
  | 'timeline'
  | 'trainer'
  | 'settings';

interface HeaderProps {
  currentTab: NavTab;
  onSelectTab: (tab: NavTab) => void;
  activeSession: WorkoutSession | null;
  onResumeActiveSession: () => void;
  profile: UserProfile;
  isDemoMode: boolean;
  onClearDemoData: () => void;
  onToggleUnit: () => void;
}

export const NAV_ITEMS = [
  { id: 'dashboard' as NavTab, label: 'Overview', icon: Flame },
  { id: 'workouts' as NavTab, label: 'Workouts', icon: Dumbbell },
  { id: 'trainer' as NavTab, label: 'AI Coach', icon: Bot },
  { id: 'progression' as NavTab, label: 'Overload Engine', icon: TrendingUp },
  { id: 'nutrition' as NavTab, label: 'Nutrition', icon: Apple },
  { id: 'body' as NavTab, label: 'Body & BMI', icon: Activity },
  { id: 'timeline' as NavTab, label: 'Timeline', icon: History },
  { id: 'plans' as NavTab, label: 'Routines', icon: FileSpreadsheet },
  { id: 'reports' as NavTab, label: 'Analytics', icon: BarChart3 },
  { id: 'settings' as NavTab, label: 'Settings', icon: Settings },
];

const NAV_BY_ID = Object.fromEntries(NAV_ITEMS.map((i) => [i.id, i])) as Record<
  NavTab,
  (typeof NAV_ITEMS)[number]
>;

/** Desktop sidebar grouping. Every NavTab appears exactly once. */
export const NAV_GROUPS: { label: string; items: NavTab[] }[] = [
  { label: 'Overview', items: ['dashboard'] },
  { label: 'Train', items: ['workouts', 'plans', 'trainer'] },
  { label: 'Track', items: ['progression', 'nutrition', 'body', 'reports', 'timeline'] },
  { label: 'Account', items: ['settings'] },
];

/** Mobile: four thumb-reach destinations (short labels) + a "More" sheet. */
const MOBILE_PRIMARY: { id: NavTab; label: string }[] = [
  { id: 'dashboard', label: 'Overview' },
  { id: 'workouts', label: 'Workouts' },
  { id: 'trainer', label: 'Coach' },
  { id: 'nutrition', label: 'Nutrition' },
];

const MOBILE_MORE: { id: NavTab; label: string; desc: string }[] = [
  { id: 'timeline', label: 'Progress Timeline', desc: 'Long-term trends, body history & period comparisons' },
  { id: 'progression', label: 'Overload Engine', desc: 'Prescribed weight jumps & 1RM calculator' },
  { id: 'body', label: 'Body Metrics & BMI', desc: 'Smoothed weight trends and silhouette data' },
  { id: 'plans', label: 'Routines & Uploads', desc: 'Custom splits, micro-cycles and CSV import' },
  { id: 'reports', label: 'Analytics & PRs', desc: 'Volume load milestones and streak consistency' },
  { id: 'settings', label: 'Athlete Settings', desc: 'Units, profile targets and biometrics' },
];

const ThemeToggleIcon: React.FC<{ theme: 'dark' | 'light' }> = ({ theme }) =>
  theme === 'dark' ? (
    <Sun className="w-4 h-4 text-warning" aria-hidden />
  ) : (
    <Moon className="w-4 h-4 text-info" aria-hidden />
  );

export const TopHeader: React.FC<HeaderProps> = ({
  currentTab,
  onSelectTab,
  activeSession,
  onResumeActiveSession,
  profile,
  isDemoMode,
  onClearDemoData,
  onToggleUnit
}) => {
  const { isConnected, liveHeartRate, setIsGadgetModalOpen } = useBluetoothGadget();
  const { theme, toggleTheme } = useTheme();

  return (
    <header className="sticky top-0 z-40 bg-[var(--header-bg)] backdrop-blur-xl border-b border-line safe-area-pt">
      <div className="flex items-center justify-between gap-2 h-14 px-3 sm:px-4 lg:px-6 max-w-7xl mx-auto">
        {/* Brand */}
        <div className="flex items-center gap-3 min-w-0">
          <button
            type="button"
            onClick={() => onSelectTab('dashboard')}
            className="flex items-center gap-2.5 select-none shrink-0"
            aria-label="Iron Log overview"
          >
            <span className="w-8 h-8 rounded-lg bg-accent text-accent-ink flex items-center justify-center text-[13px] font-extrabold tracking-tight">
              IL
            </span>
            <span className="flex items-baseline gap-2">
              <span className="text-[17px] font-bold tracking-tight text-[var(--text-primary)] leading-none">Iron Log</span>
              <span className="hidden md:inline text-xs font-medium text-[var(--text-muted)]">Reshape OS</span>
            </span>
          </button>

          {isDemoMode && (
            <span className="hidden sm:inline-flex items-center gap-1.5 px-2.5 h-7 rounded-full bg-warning/10 border border-warning/30 text-warning text-xs font-semibold">
              <Sparkles className="w-3 h-3" aria-hidden />
              Demo
              <button
                type="button"
                onClick={onClearDemoData}
                className="underline underline-offset-2 hover:opacity-80 transition-opacity ml-0.5"
                title="Purge demo history"
              >
                Clear
              </button>
            </span>
          )}
        </div>

        {/* Right actions */}
        <div className="flex items-center gap-1.5 sm:gap-2 min-w-0">
          {activeSession && currentTab !== 'workouts' && (
            <button
              type="button"
              onClick={onResumeActiveSession}
              className={cn(
                'flex items-center gap-1.5 h-9 px-3 rounded-full text-xs font-semibold transition-colors min-w-0',
                activeSession.isPaused
                  ? 'bg-danger/10 border border-danger/30 text-danger hover:bg-danger/20'
                  : 'bg-accent text-accent-ink hover:bg-accent-hover'
              )}
              aria-label={`${activeSession.isPaused ? 'Resume paused' : 'Return to active'} workout ${activeSession.dayName}`}
            >
              {activeSession.isPaused ? (
                <Pause className="w-3.5 h-3.5 shrink-0" aria-hidden />
              ) : (
                <Play className="w-3.5 h-3.5 shrink-0 fill-current" aria-hidden />
              )}
              <span className="truncate max-w-[84px] sm:max-w-[160px]">
                {activeSession.isPaused ? 'Paused · ' : ''}
                {activeSession.dayName}
              </span>
            </button>
          )}

          <button
            type="button"
            onClick={() => setIsGadgetModalOpen(true)}
            className={cn(
              'flex items-center gap-1.5 h-9 px-2.5 sm:px-3 rounded-full text-xs font-medium border transition-colors',
              isConnected
                ? 'bg-info/10 border-info/30 text-info hover:bg-info/20'
                : 'bg-surface border-line text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:border-line-strong'
            )}
            title="Bluetooth fitness gadgets"
            aria-label={
              isConnected
                ? liveHeartRate
                  ? `Bluetooth gadget connected, heart rate ${liveHeartRate} BPM`
                  : 'Bluetooth gadget connected'
                : 'Connect Bluetooth gadget'
            }
          >
            <Bluetooth className="w-3.5 h-3.5" aria-hidden />
            <span className="hidden sm:inline tabular">
              {isConnected ? (liveHeartRate ? `${liveHeartRate} BPM` : 'Connected') : 'Gadgets'}
            </span>
            {isConnected && liveHeartRate && <span className="sm:hidden tabular font-semibold">{liveHeartRate}</span>}
          </button>

          <button
            type="button"
            onClick={onToggleUnit}
            className="h-9 px-3 rounded-full bg-surface border border-line hover:border-line-strong text-xs font-semibold transition-colors"
            title="Toggle measurement unit"
            aria-label={`Unit: ${profile.preferredUnit}. Tap to switch`}
          >
            <span className="uppercase text-volt-adaptive">{profile.preferredUnit}</span>
          </button>

          <button
            type="button"
            onClick={toggleTheme}
            className="w-9 h-9 rounded-full bg-surface border border-line hover:border-line-strong flex items-center justify-center transition-colors"
            title={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
            aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
          >
            <ThemeToggleIcon theme={theme} />
          </button>

          <button
            type="button"
            onClick={() => onSelectTab('settings')}
            className="w-9 h-9 rounded-full bg-surface-2 border border-line-strong hover:border-[var(--text-muted)] text-[var(--text-primary)] text-xs font-bold flex items-center justify-center transition-colors"
            title="Profile & settings"
            aria-label="Profile and settings"
          >
            {profile.name ? profile.name.slice(0, 1).toUpperCase() : 'A'}
          </button>
        </div>
      </div>
    </header>
  );
};

export const DesktopSidebar: React.FC<{
  currentTab: NavTab;
  onSelectTab: (tab: NavTab) => void;
  activeSession: WorkoutSession | null;
}> = ({ currentTab, onSelectTab, activeSession }) => {
  return (
    <aside
      className="hidden lg:flex flex-col w-60 shrink-0 border-r border-line sticky top-14 self-start h-[calc(100dvh-3.5rem)] overflow-y-auto py-5 px-4 select-none"
      aria-label="Primary"
    >
      <nav className="space-y-5">
        {NAV_GROUPS.map((group) => (
          <div key={group.label}>
            <p className="px-3 mb-1.5 text-[11px] font-semibold tracking-wide text-[var(--text-muted)]">{group.label}</p>
            <ul className="space-y-0.5">
              {group.items.map((id) => {
                const item = NAV_BY_ID[id];
                const Icon = item.icon;
                const isActive = currentTab === id;
                const isWorkoutActive = id === 'workouts' && activeSession !== null;
                return (
                  <li key={id}>
                    <button
                      type="button"
                      onClick={() => onSelectTab(id)}
                      aria-current={isActive ? 'page' : undefined}
                      className={cn(
                        'relative w-full flex items-center gap-3 h-10 px-3 rounded-lg text-sm transition-colors',
                        isActive
                          ? 'bg-surface-2 text-[var(--text-primary)] font-semibold'
                          : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-surface'
                      )}
                    >
                      {isActive && <span className="absolute left-0 top-2 bottom-2 w-0.5 rounded-full bg-accent" aria-hidden />}
                      <Icon
                        className={cn('w-4 h-4 shrink-0', isActive ? 'text-volt-adaptive' : 'text-[var(--text-muted)]')}
                        aria-hidden
                      />
                      <span className="truncate">{item.label}</span>
                      {isWorkoutActive && (
                        <span className="ml-auto flex items-center gap-1 text-[11px] font-semibold text-volt-adaptive">
                          <span className="w-1.5 h-1.5 rounded-full bg-accent" aria-hidden />
                          Live
                        </span>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>
    </aside>
  );
};

export const MobileBottomNav: React.FC<{
  currentTab: NavTab;
  onSelectTab: (tab: NavTab) => void;
  activeSession: WorkoutSession | null;
}> = ({ currentTab, onSelectTab, activeSession }) => {
  const [moreOpen, setMoreOpen] = useState(false);
  const { theme, toggleTheme } = useTheme();
  const moreActive = MOBILE_MORE.some((t) => t.id === currentTab);

  const itemClass = (active: boolean) =>
    cn(
      'relative flex flex-col items-center justify-center gap-0.5 min-h-[52px] flex-1 rounded-xl transition-colors',
      active ? 'text-volt-adaptive' : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
    );

  return (
    <>
      <nav
        className="lg:hidden fixed bottom-0 left-0 right-0 z-40 bg-[var(--header-bg)] backdrop-blur-xl border-t border-line px-2 pt-1.5 safe-area-pb"
        aria-label="Primary"
      >
        <div className="flex items-stretch justify-between max-w-md mx-auto">
          {MOBILE_PRIMARY.map(({ id, label }) => {
            const Icon = NAV_BY_ID[id].icon;
            const isActive = currentTab === id;
            const isWorkout = id === 'workouts' && activeSession !== null;
            return (
              <button
                key={id}
                type="button"
                onClick={() => onSelectTab(id)}
                aria-current={isActive ? 'page' : undefined}
                className={itemClass(isActive)}
              >
                <Icon className="w-5 h-5" strokeWidth={isActive ? 2.4 : 1.9} aria-hidden />
                <span className="text-[11px] font-medium leading-none">{label}</span>
                {isWorkout && (
                  <span
                    className="absolute top-2 right-[calc(50%-18px)] w-2 h-2 rounded-full bg-accent ring-2 ring-[var(--bg-canvas)]"
                    aria-label="Workout in progress"
                  />
                )}
              </button>
            );
          })}
          <button
            type="button"
            onClick={() => setMoreOpen(true)}
            aria-haspopup="dialog"
            aria-current={moreActive ? 'page' : undefined}
            className={itemClass(moreActive)}
          >
            <Menu className="w-5 h-5" strokeWidth={moreActive ? 2.4 : 1.9} aria-hidden />
            <span className="text-[11px] font-medium leading-none">More</span>
          </button>
        </div>
      </nav>

      <Modal open={moreOpen} onClose={() => setMoreOpen(false)} title="Navigate" description="Performance tools and profile controls" size="sm">
        <ul className="space-y-2">
          {MOBILE_MORE.map((item) => {
            const Icon = NAV_BY_ID[item.id].icon;
            const isActive = currentTab === item.id;
            return (
              <li key={item.id}>
                <button
                  type="button"
                  onClick={() => {
                    setMoreOpen(false);
                    onSelectTab(item.id);
                  }}
                  aria-current={isActive ? 'page' : undefined}
                  className={cn(
                    'w-full flex items-center justify-between gap-3 min-h-[60px] p-3 rounded-xl border text-left transition-colors',
                    isActive ? 'bg-accent/10 border-accent/40' : 'bg-surface-2 border-line hover:border-line-strong'
                  )}
                >
                  <span className="flex items-center gap-3 min-w-0">
                    <span
                      className={cn(
                        'w-10 h-10 rounded-lg flex items-center justify-center shrink-0',
                        isActive ? 'bg-accent text-accent-ink' : 'bg-surface text-[var(--text-secondary)] border border-line'
                      )}
                      aria-hidden
                    >
                      <Icon className="w-5 h-5" />
                    </span>
                    <span className="min-w-0">
                      <span className="block text-sm font-semibold text-[var(--text-primary)]">{item.label}</span>
                      <span className="block text-xs text-[var(--text-secondary)]">{item.desc}</span>
                    </span>
                  </span>
                  <ChevronRight className="w-4 h-4 text-[var(--text-muted)] shrink-0" aria-hidden />
                </button>
              </li>
            );
          })}
        </ul>
        <button
          type="button"
          onClick={toggleTheme}
          className="mt-3 w-full flex items-center justify-between min-h-[52px] px-4 rounded-xl bg-surface-2 border border-line text-sm font-medium text-[var(--text-primary)]"
        >
          <span>{theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}</span>
          <ThemeToggleIcon theme={theme} />
        </button>
      </Modal>
    </>
  );
};
