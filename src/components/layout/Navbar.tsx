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
  X,
  ChevronRight,
  ShieldCheck,
  Sun,
  Moon
} from 'lucide-react';
import { UserProfile, WorkoutSession } from '../../types';
import { useBluetoothGadget } from '../../context/BluetoothGadgetContext';
import { useTheme } from '../../context/ThemeContext';

export type NavTab =
  | 'dashboard'
  | 'workouts'
  | 'progression'
  | 'nutrition'
  | 'body'
  | 'plans'
  | 'reports'
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
    <header className="sticky top-0 z-40 bg-[var(--header-bg)] backdrop-blur-2xl border-b border-[var(--border-card)] px-4 lg:px-6 py-3 transition-colors duration-200">
      <div className="flex items-center justify-between max-w-7xl mx-auto gap-4">
        {/* Brand Zone - Reshape Luxury Performance Wordmark */}
        <div className="flex items-center gap-3.5 shrink-0">
          <div
            onClick={() => onSelectTab('dashboard')}
            className="flex items-center gap-3 cursor-pointer group select-none"
          >
            <div className="relative w-9 h-9 rounded-xl bg-gradient-to-br from-[#181d28] to-[#0c0f16] border border-white/[0.12] flex items-center justify-center text-[#CEFF00] font-nrc font-black italic text-lg shadow-[0_4px_20px_rgba(0,0,0,0.6)] group-hover:border-[#CEFF00]/50 transition-all">
              <span className="leading-none text-white group-hover:text-[#CEFF00] transition-colors">IL</span>
              <div className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-[#CEFF00] shadow-[0_0_8px_#CEFF00]" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-nrc font-black italic tracking-wide text-[var(--text-primary)] text-xl uppercase leading-none">
                  IRON LOG
                </span>
                <span className="hidden sm:inline-flex items-center px-1.5 py-0.5 rounded-md text-[9px] font-mono tracking-widest text-[#CEFF00] bg-black/80 border border-[#CEFF00]/30 font-bold uppercase">
                  RESHAPE OS
                </span>
              </div>
            </div>
          </div>

          {/* Unboxed Demo Indicator */}
          {isDemoMode && (
            <div className="flex items-center gap-1.5 text-amber-500 text-xs font-mono pl-2.5 border-l border-[var(--border-card)]">
              <Sparkles className="w-3.5 h-3.5 text-amber-500" />
              <span className="font-bold tracking-wider text-[11px]">DEMO</span>
              <button
                onClick={onClearDemoData}
                className="underline hover:text-[var(--text-primary)] transition-colors ml-1 text-[11px] text-[var(--text-muted)]"
                title="Purge demo history"
              >
                Clear
              </button>
            </div>
          )}
        </div>

        {/* Right Actions - Minimalist Ergonomics */}
        <div className="flex items-center gap-2 sm:gap-2.5 shrink-0">
          {/* Bluetooth Gadget Trigger */}
          <button
            onClick={() => setIsGadgetModalOpen(true)}
            className={`flex items-center gap-2 px-3 py-1.5 rounded-xl text-xs font-mono font-medium border transition-all ${
              isConnected
                ? 'bg-sky-500/10 border-sky-400/35 text-sky-400 hover:bg-sky-500/20 shadow-[0_0_15px_rgba(56,189,248,0.2)]'
                : 'bg-[var(--bg-surface)] border-[var(--border-card)] hover:border-[var(--border-card-hover)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
            }`}
            title="Bluetooth Fitness Gadgets Hub"
          >
            <Bluetooth className={`w-3.5 h-3.5 ${isConnected ? 'text-sky-400 animate-pulse' : 'text-zinc-400'}`} />
            <span className="hidden sm:inline">
              {isConnected ? (liveHeartRate ? `${liveHeartRate} BPM` : 'HRM Linked') : 'BLE'}
            </span>
            {isConnected && liveHeartRate && (
              <span className="sm:hidden text-sky-400 font-bold">{liveHeartRate}</span>
            )}
          </button>

          {/* Active Workout In-Progress Chip */}
          {activeSession && currentTab !== 'workouts' && (
            <button
              onClick={onResumeActiveSession}
              className={`flex items-center gap-2 px-3.5 py-1.5 rounded-xl text-xs font-nrc font-black italic tracking-wide transition-all shadow-lg ${
                activeSession.isPaused
                  ? 'bg-rose-500/15 border border-rose-500/30 text-rose-500 hover:bg-rose-500/25'
                  : 'bg-[#CEFF00] text-black hover:bg-[#d8ff1a] shadow-[0_0_24px_rgba(206,255,0,0.35)]'
              }`}
            >
              {activeSession.isPaused ? (
                <Pause className="w-3 h-3 text-rose-500 fill-rose-500" />
              ) : (
                <Play className="w-3 h-3 fill-black text-black" />
              )}
              <span className="truncate max-w-[120px] uppercase">
                {activeSession.isPaused ? 'Paused' : 'Active'} · {activeSession.dayName}
              </span>
            </button>
          )}

          {/* Unit Toggle (KG / LBS) */}
          <button
            onClick={onToggleUnit}
            className="px-2.5 py-1.5 rounded-xl bg-[var(--bg-surface)] border border-[var(--border-card)] hover:border-[var(--border-card-hover)] text-xs font-mono font-bold text-[var(--text-primary)] transition-colors"
            title="Toggle measurement unit"
          >
            <span className="text-[var(--text-muted)] text-[10px] mr-1">UNIT</span>
            <span className="text-volt-adaptive font-black uppercase">{profile.preferredUnit}</span>
          </button>

          {/* Theme Mode Toggle (Dark / Light) */}
          <button
            onClick={toggleTheme}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl bg-[var(--bg-surface)] border border-[var(--border-card)] hover:border-[var(--border-card-hover)] text-xs font-mono font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-all touch-press"
            title={theme === 'dark' ? 'Switch to Light Theme' : 'Switch to Dark Theme'}
            aria-label="Toggle light or dark theme"
          >
            {theme === 'dark' ? (
              <>
                <Sun className="w-3.5 h-3.5 text-amber-400" />
                <span className="hidden sm:inline text-[11px] font-mono">LIGHT</span>
              </>
            ) : (
              <>
                <Moon className="w-3.5 h-3.5 text-indigo-500" />
                <span className="hidden sm:inline text-[11px] font-mono">DARK</span>
              </>
            )}
          </button>

          {/* User Profile trigger / Avatar */}
          <button
            onClick={() => onSelectTab('settings')}
            className="flex items-center gap-2 p-1 rounded-xl bg-[var(--bg-surface)] border border-[var(--border-card)] hover:border-[var(--border-card-hover)] text-[var(--text-primary)] transition-all"
            title="Profile & Settings"
          >
            <div className="w-7 h-7 rounded-lg bg-gradient-to-tr from-[#CEFF00] to-[#e4ff66] text-black font-nrc font-black italic text-xs flex items-center justify-center shadow-[0_0_12px_rgba(206,255,0,0.25)]">
              {profile.name ? profile.name.slice(0, 1).toUpperCase() : 'A'}
            </div>
          </button>
        </div>
      </div>
    </header>
  );
};

export const NAV_ITEMS = [
  { id: 'dashboard' as NavTab, label: 'Overview', icon: Flame },
  { id: 'workouts' as NavTab, label: 'Workouts', icon: Dumbbell },
  { id: 'trainer' as NavTab, label: 'AI Coach', icon: Bot },
  { id: 'progression' as NavTab, label: 'Overload Engine', icon: TrendingUp },
  { id: 'nutrition' as NavTab, label: 'Nutrition', icon: Apple },
  { id: 'body' as NavTab, label: 'Body & BMI', icon: Activity },
  { id: 'plans' as NavTab, label: 'Routines', icon: FileSpreadsheet },
  { id: 'reports' as NavTab, label: 'Analytics', icon: BarChart3 },
  { id: 'settings' as NavTab, label: 'Settings', icon: Settings },
];

export const DesktopSidebar: React.FC<{
  currentTab: NavTab;
  onSelectTab: (tab: NavTab) => void;
  activeSession: WorkoutSession | null;
}> = ({ currentTab, onSelectTab, activeSession }) => {
  return (
    <aside className="hidden lg:flex flex-col w-64 bg-[var(--sidebar-bg)] border-r border-[var(--border-card)] min-h-[calc(100vh-61px)] p-4 select-none shrink-0 transition-colors duration-200">
      <div className="space-y-1">
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          const isActive = currentTab === item.id;
          const isWorkoutActive = item.id === 'workouts' && activeSession !== null;

          return (
            <button
              key={item.id}
              onClick={() => onSelectTab(item.id)}
              className={`w-full flex items-center justify-between px-3.5 py-2.5 rounded-xl text-sm transition-all relative ${
                isActive
                  ? 'bg-[var(--bg-surface-elevated)] text-[var(--text-primary)] font-bold border border-[var(--border-card-hover)] shadow-md'
                  : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--chip-bg)] border border-transparent'
              }`}
            >
              <div className="flex items-center gap-3">
                <Icon className={`w-4 h-4 ${isActive ? 'text-[#CEFF00] stroke-[2.5]' : 'text-[var(--text-muted)]'}`} />
                <span className={isActive ? 'font-nrc font-bold tracking-wide uppercase text-base text-[var(--text-primary)]' : 'font-medium'}>
                  {item.label}
                </span>
              </div>
              {isActive && (
                <div className="w-1.5 h-1.5 rounded-full bg-[#CEFF00] shadow-[0_0_8px_#CEFF00]" />
              )}
              {isWorkoutActive && !isActive && (
                <span className="w-2 h-2 rounded-full bg-[#CEFF00] animate-ping" />
              )}
            </button>
          );
        })}
      </div>

      {/* Reshape Athlete Philosophy Minimal Bento */}
      <div className="mt-auto pt-5 border-t border-[var(--border-card)]">
        <div className="p-3.5 bg-[var(--bg-subtle)] rounded-2xl border border-[var(--border-card)] space-y-2">
          <div className="flex items-center justify-between text-[10px] font-mono uppercase text-volt-adaptive font-bold tracking-widest">
            <span className="flex items-center gap-1.5">
              <ShieldCheck className="w-3.5 h-3.5" />
              RESHAPE STANDARD
            </span>
            <span className="text-[var(--text-muted)]">v2.4</span>
          </div>
          <div className="text-[var(--text-primary)] font-nrc font-black italic uppercase text-base tracking-tight leading-tight">
            NO COMPROMISES.
          </div>
          <p className="text-[11px] text-[var(--text-secondary)] leading-relaxed font-sans">
            Every set logged calibrates your next overload benchmark. Precision transforms dedication into results.
          </p>
        </div>
      </div>
    </aside>
  );
};

export const MobileBottomNav: React.FC<{
  currentTab: NavTab;
  onSelectTab: (tab: NavTab) => void;
  activeSession: WorkoutSession | null;
}> = ({ currentTab, onSelectTab, activeSession }) => {
  const [isMoreOpen, setIsMoreOpen] = useState(false);
  const { theme, toggleTheme } = useTheme();

  const PRIMARY_MOBILE_TABS = [
    { id: 'dashboard' as NavTab, label: 'Overview', icon: Flame },
    { id: 'workouts' as NavTab, label: 'Workouts', icon: Dumbbell },
    { id: 'trainer' as NavTab, label: 'Coach', icon: Bot },
    { id: 'nutrition' as NavTab, label: 'Nutrition', icon: Apple },
  ];

  const SECONDARY_TABS = [
    { id: 'progression' as NavTab, label: 'Overload Engine', desc: 'Prescribed weight jumps & 1RM calculator', icon: TrendingUp },
    { id: 'body' as NavTab, label: 'Body Metrics & BMI', desc: 'Smoothed weight trends and silhouette data', icon: Activity },
    { id: 'plans' as NavTab, label: 'Routines & Uploads', desc: 'Custom splits, micro-cycles and CSV import', icon: FileSpreadsheet },
    { id: 'reports' as NavTab, label: 'Analytics & PRs', desc: 'Volume load milestones and streak consistency', icon: BarChart3 },
    { id: 'settings' as NavTab, label: 'Athlete Settings', desc: 'Units, profile targets and biometrics', icon: Settings },
  ];

  const isSecondaryActive = SECONDARY_TABS.some((t) => t.id === currentTab);

  return (
    <>
      <nav className="lg:hidden fixed bottom-0 left-0 right-0 z-40 bg-[var(--header-bg)] backdrop-blur-2xl border-t border-[var(--border-card)] px-3 py-1.5 safe-area-pb shadow-lg transition-colors duration-200">
        <div className="grid grid-cols-5 items-center max-w-md mx-auto">
          {PRIMARY_MOBILE_TABS.map((item) => {
            const Icon = item.icon;
            const isActive = currentTab === item.id;
            const isWorkout = item.id === 'workouts' && activeSession !== null;

            return (
              <button
                key={item.id}
                onClick={() => {
                  setIsMoreOpen(false);
                  onSelectTab(item.id);
                }}
                className={`flex flex-col items-center justify-center min-h-[48px] py-1 px-1 rounded-xl transition-all relative ${
                  isActive ? 'text-volt-adaptive' : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
                }`}
              >
                <Icon className={`w-5 h-5 ${isActive ? 'stroke-[2.5]' : 'stroke-2'}`} />
                <span className={`text-[10px] mt-1 tracking-tight truncate ${isActive ? 'font-nrc font-black italic uppercase text-xs' : 'font-medium'}`}>
                  {item.label}
                </span>
                {isWorkout && (
                  <span className="absolute top-1.5 right-3 w-2 h-2 rounded-full bg-[#CEFF00] animate-ping" />
                )}
                {isActive && (
                  <span className="absolute -bottom-1 w-4 h-0.5 rounded-full bg-[#CEFF00] shadow-[0_0_6px_#CEFF00]" />
                )}
              </button>
            );
          })}

          {/* More Menu Trigger */}
          <button
            onClick={() => setIsMoreOpen(true)}
            className={`flex flex-col items-center justify-center min-h-[48px] py-1 px-1 rounded-xl transition-all relative ${
              isSecondaryActive ? 'text-volt-adaptive' : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
            }`}
          >
            <Menu className={`w-5 h-5 ${isSecondaryActive ? 'stroke-[2.5]' : 'stroke-2'}`} />
            <span className={`text-[10px] mt-1 tracking-tight truncate ${isSecondaryActive ? 'font-nrc font-black italic uppercase text-xs' : 'font-medium'}`}>
              More
            </span>
            {isSecondaryActive && (
              <span className="absolute top-1.5 right-3 w-1.5 h-1.5 rounded-full bg-[#CEFF00]" />
            )}
          </button>
        </div>
      </nav>

      {/* Mobile "More" Drawer Modal */}
      {isMoreOpen && (
        <div className="lg:hidden fixed inset-0 z-50 flex flex-col justify-end bg-black/60 backdrop-blur-md">
          <div className="bg-[var(--bg-surface)] border-t border-[var(--border-card)] rounded-t-3xl p-5 max-w-md w-full mx-auto space-y-4 max-h-[85vh] overflow-y-auto safe-area-pb shadow-2xl">
            {/* Grab handle */}
            <div className="w-12 h-1 bg-zinc-500/40 rounded-full mx-auto" />

            <div className="flex items-center justify-between pb-3 border-b border-[var(--border-card)]">
              <div>
                <h3 className="font-nrc font-black italic uppercase text-lg text-[var(--text-primary)]">
                  Athlete Navigation
                </h3>
                <p className="text-xs text-[var(--text-secondary)]">Deep performance tools and profile controls</p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={toggleTheme}
                  className="p-2 rounded-xl bg-[var(--bg-subtle)] border border-[var(--border-card)] text-[var(--text-primary)]"
                  title="Toggle Light/Dark Theme"
                >
                  {theme === 'dark' ? <Sun className="w-4 h-4 text-amber-400" /> : <Moon className="w-4 h-4 text-indigo-500" />}
                </button>
                <button
                  onClick={() => setIsMoreOpen(false)}
                  className="p-2 text-[var(--text-muted)] hover:text-[var(--text-primary)] rounded-xl bg-[var(--bg-subtle)]"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            <div className="space-y-2">
              {SECONDARY_TABS.map((item) => {
                const Icon = item.icon;
                const isActive = currentTab === item.id;
                return (
                  <button
                    key={item.id}
                    onClick={() => {
                      onSelectTab(item.id);
                      setIsMoreOpen(false);
                    }}
                    className={`w-full flex items-center justify-between p-3.5 rounded-2xl border text-left transition-all ${
                      isActive
                        ? 'bg-[var(--bg-surface-elevated)] border-[#CEFF00]/40 text-[var(--text-primary)] shadow-md'
                        : 'bg-[var(--bg-subtle)] border-[var(--border-card)] text-[var(--text-secondary)] hover:bg-[var(--chip-bg)]'
                    }`}
                  >
                    <div className="flex items-center gap-3.5">
                      <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${isActive ? 'bg-[#CEFF00] text-black font-bold' : 'bg-[var(--bg-surface)] text-[var(--text-muted)] border border-[var(--border-card)]'}`}>
                        <Icon className="w-5 h-5" />
                      </div>
                      <div>
                        <div className="text-sm font-bold text-[var(--text-primary)]">{item.label}</div>
                        <div className="text-[11px] text-[var(--text-secondary)]">{item.desc}</div>
                      </div>
                    </div>
                    <ChevronRight className="w-4 h-4 text-[var(--text-muted)]" />
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </>
  );
};
