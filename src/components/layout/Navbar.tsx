import React from 'react';
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
  Heart
} from 'lucide-react';
import { UserProfile, WorkoutSession } from '../../types';
import { useBluetoothGadget } from '../../context/BluetoothGadgetContext';

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

  return (
    <header className="sticky top-0 z-40 bg-black/95 backdrop-blur-2xl border-b border-zinc-800/80 px-4 lg:px-6 py-2.5">
      <div className="flex items-center justify-between max-w-7xl mx-auto">
        {/* Brand - Nike Run Club Athletic Wordmark */}
        <div className="flex items-center gap-3">
          <div
            onClick={() => onSelectTab('dashboard')}
            className="flex items-center gap-2.5 cursor-pointer group select-none"
          >
            <div className="w-9 h-9 rounded-xl bg-[#CEFF00] flex items-center justify-center text-black font-nrc font-black italic text-lg shadow-[0_0_16px_rgba(206,255,0,0.35)] group-hover:scale-105 transition-transform">
              <span className="leading-none">NRC</span>
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-nrc font-black italic tracking-tighter text-white text-xl uppercase leading-none">
                  IRON CLUB
                </span>
                <span className="hidden sm:inline-block text-[10px] font-mono tracking-widest text-[#CEFF00] font-extrabold uppercase">
                  TRAINING OS
                </span>
              </div>
            </div>
          </div>

          {/* Demo Mode Badge */}
          {isDemoMode && (
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-zinc-900 border border-amber-400/40 text-amber-300 text-xs font-mono">
              <Sparkles className="w-3 h-3 text-amber-400 animate-pulse" />
              <span className="font-bold">DEMO</span>
              <button
                onClick={onClearDemoData}
                className="underline hover:text-white transition-colors ml-1 text-[11px]"
                title="Purge demo history"
              >
                Clear
              </button>
            </div>
          )}
        </div>

        {/* Right Actions */}
        <div className="flex items-center gap-2 sm:gap-3">
          {/* Bluetooth Fitness Gadget Button */}
          <button
            onClick={() => setIsGadgetModalOpen(true)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-mono font-medium border transition-all ${
              isConnected
                ? 'bg-sky-500/15 border-sky-400/40 text-sky-300 hover:bg-sky-500/25 shadow-[0_0_12px_rgba(56,189,248,0.2)]'
                : 'bg-zinc-900/90 border-zinc-800 hover:border-zinc-700 text-zinc-400 hover:text-white'
            }`}
            title="Bluetooth Fitness Gadgets Hub"
          >
            <Bluetooth className={`w-3.5 h-3.5 ${isConnected ? 'text-sky-400 animate-pulse' : 'text-zinc-500'}`} />
            <span className="hidden sm:inline">
              {isConnected ? (liveHeartRate ? `${liveHeartRate} BPM` : 'BLE Linked') : 'BLE Gadget'}
            </span>
            {isConnected && liveHeartRate && (
              <span className="sm:hidden text-sky-300 font-bold">{liveHeartRate}</span>
            )}
          </button>

          {/* Active Workout In-Progress Pill - Nike High Visibility Style */}
          {activeSession && currentTab !== 'workouts' && (
            <button
              onClick={onResumeActiveSession}
              className={`flex items-center gap-2 px-3.5 py-1.5 rounded-full text-xs font-nrc font-bold italic tracking-tight transition-all shadow-md ${
                activeSession.isPaused
                  ? 'bg-[#FF3B30]/20 border border-[#FF3B30]/40 text-[#FF3B30] hover:bg-[#FF3B30]/30'
                  : 'bg-[#CEFF00] text-black hover:bg-[#d8ff33] animate-pulse shadow-[0_0_20px_rgba(206,255,0,0.4)]'
              }`}
            >
              {activeSession.isPaused ? (
                <Pause className="w-3 h-3 text-[#FF3B30] fill-[#FF3B30]" />
              ) : (
                <Play className="w-3 h-3 fill-black text-black" />
              )}
              <span className="truncate max-w-[130px] uppercase">
                {activeSession.isPaused ? 'Paused: ' : 'Active: '}
                {activeSession.dayName}
              </span>
            </button>
          )}

          {/* Unit Toggle (KG / LBS) */}
          <button
            onClick={onToggleUnit}
            className="px-3 py-1.5 rounded-full bg-zinc-900/90 border border-zinc-800 hover:border-zinc-700 text-xs font-mono font-bold text-zinc-300 transition-colors"
            title="Toggle measurement unit"
          >
            <span className="text-zinc-400 mr-1">UNIT:</span>
            <span className="text-[#CEFF00] font-black uppercase">{profile.preferredUnit}</span>
          </button>

          {/* User Profile trigger / Avatar */}
          <button
            onClick={() => onSelectTab('settings')}
            className="flex items-center gap-2 p-1 rounded-full bg-zinc-900 border border-zinc-800 hover:border-zinc-700 text-zinc-300 transition-colors"
            title="Profile & Settings"
          >
            <div className="w-7 h-7 rounded-full bg-[#CEFF00] text-black font-nrc font-black italic text-xs flex items-center justify-center">
              {profile.name ? profile.name.slice(0, 1).toUpperCase() : 'U'}
            </div>
          </button>
        </div>
      </div>
    </header>
  );
};

export const NAV_ITEMS = [
  { id: 'dashboard' as NavTab, label: 'Club Home', icon: Flame },
  { id: 'workouts' as NavTab, label: 'Workouts', icon: Dumbbell },
  { id: 'trainer' as NavTab, label: 'Coach Iron', icon: Bot },
  { id: 'progression' as NavTab, label: 'Progression', icon: TrendingUp },
  { id: 'nutrition' as NavTab, label: 'Nutrition', icon: Apple },
  { id: 'body' as NavTab, label: 'Body Metrics', icon: Activity },
  { id: 'plans' as NavTab, label: 'Plans & Uploads', icon: FileSpreadsheet },
  { id: 'reports' as NavTab, label: 'Activity Feed', icon: BarChart3 },
  { id: 'settings' as NavTab, label: 'Settings', icon: Settings },
];

export const DesktopSidebar: React.FC<{
  currentTab: NavTab;
  onSelectTab: (tab: NavTab) => void;
  activeSession: WorkoutSession | null;
}> = ({ currentTab, onSelectTab, activeSession }) => {
  return (
    <aside className="hidden lg:flex flex-col w-64 bg-black border-r border-zinc-800/80 min-h-[calc(100vh-57px)] p-4 select-none shrink-0">
      <div className="space-y-1">
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          const isActive = currentTab === item.id;
          const isWorkoutActive = item.id === 'workouts' && activeSession !== null;

          return (
            <button
              key={item.id}
              onClick={() => onSelectTab(item.id)}
              className={`w-full flex items-center justify-between px-3.5 py-2.5 rounded-xl text-sm transition-all ${
                isActive
                  ? 'bg-zinc-900 text-white font-bold border-l-4 border-[#CEFF00] shadow-sm'
                  : 'text-zinc-400 hover:text-white hover:bg-zinc-900/50'
              }`}
            >
              <div className="flex items-center gap-3">
                <Icon className={`w-4 h-4 ${isActive ? 'text-[#CEFF00] stroke-[2.5]' : 'text-zinc-400'}`} />
                <span className={isActive ? 'font-nrc font-bold tracking-tight uppercase text-base' : 'font-medium'}>
                  {item.label}
                </span>
              </div>
              {isActive && (
                <span className="w-1.5 h-1.5 rounded-full bg-[#CEFF00]" />
              )}
              {isWorkoutActive && !isActive && (
                <span className="w-2 h-2 rounded-full bg-[#CEFF00] animate-ping" />
              )}
            </button>
          );
        })}
      </div>

      {/* Nike Run Club Motivational Quote / Level Card */}
      <div className="mt-auto pt-5 border-t border-zinc-800/80">
        <div className="p-3.5 bg-zinc-950 rounded-2xl border border-zinc-800/80 space-y-1.5">
          <div className="flex items-center justify-between text-[10px] font-mono uppercase text-[#CEFF00] font-extrabold tracking-wider">
            <span>NRC ATHLETE RULE</span>
            <span>01</span>
          </div>
          <div className="text-white font-nrc font-black italic uppercase text-base tracking-tight leading-tight">
            THERE IS NO FINISH LINE.
          </div>
          <p className="text-[11px] text-zinc-400 leading-relaxed font-sans">
            Every rep builds capacity. Progressive overload logged daily turns consistency into greatness.
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
  return (
    <nav className="lg:hidden fixed bottom-0 left-0 right-0 z-40 bg-black/95 backdrop-blur-2xl border-t border-zinc-800/80 px-2 py-1.5 safe-area-pb">
      <div className="flex items-center justify-around">
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          const isActive = currentTab === item.id;
          const isWorkout = item.id === 'workouts' && activeSession !== null;

          return (
            <button
              key={item.id}
              onClick={() => onSelectTab(item.id)}
              className={`flex flex-col items-center justify-center py-1.5 px-2 rounded-xl transition-all relative min-w-[48px] ${
                isActive ? 'text-[#CEFF00] scale-105' : 'text-zinc-500 hover:text-white'
              }`}
            >
              <Icon className={`w-5 h-5 ${isActive ? 'stroke-[2.5]' : 'stroke-2'}`} />
              <span className={`text-[10px] mt-1 tracking-tight truncate max-w-[56px] ${isActive ? 'font-nrc font-bold italic uppercase text-xs' : 'font-medium'}`}>
                {item.id === 'body' ? 'Metrics' : item.id === 'plans' ? 'Plans' : item.label}
              </span>
              {isWorkout && (
                <span className="absolute top-1 right-2 w-2 h-2 rounded-full bg-[#CEFF00] animate-ping" />
              )}
            </button>
          );
        })}
      </div>
    </nav>
  );
};
