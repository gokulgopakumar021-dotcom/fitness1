import React, { useState, useMemo } from 'react';
import {
  Flame,
  Calendar as CalendarIcon,
  ChevronLeft,
  ChevronRight,
  Award,
  Zap,
  CheckCircle2,
  Clock,
  Dumbbell,
  ShieldCheck,
  TrendingUp,
  Info
} from 'lucide-react';
import { WorkoutSession, UserProfile } from '../../types';
import { calculateVolumeLoad } from '../../utils/calculations';

interface GymConsistencyProps {
  sessions: WorkoutSession[];
  profile: UserProfile;
  onNavigateToWorkouts?: () => void;
}

export const GymConsistencyStreakCalendar: React.FC<GymConsistencyProps> = ({
  sessions,
  profile,
  onNavigateToWorkouts
}) => {
  // Current calendar month view state
  const [currentMonthDate, setCurrentMonthDate] = useState<Date>(() => new Date());
  const [selectedDayDetails, setSelectedDayDetails] = useState<{
    dateStr: string;
    sessionsOnDay: WorkoutSession[];
  } | null>(null);

  // Map of completed workout sessions grouped by YYYY-MM-DD
  const sessionsByDate = useMemo(() => {
    const map = new Map<string, WorkoutSession[]>();
    sessions
      .filter((s) => s.status === 'completed')
      .forEach((s) => {
        const dStr = s.date ? s.date.slice(0, 10) : new Date(s.startTime).toISOString().slice(0, 10);
        const existing = map.get(dStr) || [];
        existing.push(s);
        map.set(dStr, existing);
      });
    return map;
  }, [sessions]);

  // Streak & Statistics calculation
  const stats = useMemo(() => {
    const uniqueDates = Array.from(sessionsByDate.keys()).sort();
    if (uniqueDates.length === 0) {
      return {
        currentStreak: 0,
        longestStreak: 0,
        totalWorkouts: 0,
        isStreakActiveToday: false,
        isTrainedToday: false,
        monthlyConsistencyRate: 0,
        totalMinutesThisMonth: 0,
        totalVolumeThisMonth: 0
      };
    }

    const today = new Date();
    const todayStr = today.toISOString().slice(0, 10);
    const yesterday = new Date(Date.now() - 86400000);
    const yesterdayStr = yesterday.toISOString().slice(0, 10);

    const isTrainedToday = sessionsByDate.has(todayStr);
    const trainedYesterday = sessionsByDate.has(yesterdayStr);

    // Calculate current streak
    let currentStreak = 0;
    let checkDate = isTrainedToday ? new Date(today) : trainedYesterday ? new Date(yesterday) : null;

    if (checkDate) {
      while (true) {
        const dateStr = checkDate.toISOString().slice(0, 10);
        if (sessionsByDate.has(dateStr)) {
          currentStreak++;
          checkDate.setDate(checkDate.getDate() - 1);
        } else {
          break;
        }
      }
    }

    // Calculate longest historical streak
    let longestStreak = 0;
    let tempStreak = 0;
    let prevDate: Date | null = null;

    for (const dStr of uniqueDates) {
      const cur = new Date(dStr + 'T00:00:00');
      if (prevDate) {
        const diffDays = Math.round((cur.getTime() - prevDate.getTime()) / (1000 * 60 * 60 * 24));
        if (diffDays === 1) {
          tempStreak++;
        } else {
          tempStreak = 1;
        }
      } else {
        tempStreak = 1;
      }
      if (tempStreak > longestStreak) {
        longestStreak = tempStreak;
      }
      prevDate = cur;
    }

    // Monthly stats for the current viewed month
    const year = currentMonthDate.getFullYear();
    const month = currentMonthDate.getMonth();
    const daysInMonth = new Date(year, month + 1, 0).getDate();

    let workoutsThisMonth = 0;
    let totalMinutesThisMonth = 0;
    let totalVolumeThisMonth = 0;

    for (let day = 1; day <= daysInMonth; day++) {
      const dayStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      const sessionsOnThisDay = sessionsByDate.get(dayStr);
      if (sessionsOnThisDay && sessionsOnThisDay.length > 0) {
        workoutsThisMonth++;
        sessionsOnThisDay.forEach((s) => {
          totalVolumeThisMonth += calculateVolumeLoad(s.exercises.flatMap((e) => e.sets));
          if (s.startTime && s.endTime) {
            const start = new Date(s.startTime).getTime();
            const end = new Date(s.endTime).getTime();
            totalMinutesThisMonth += Math.max(15, Math.round((end - start) / 60000));
          } else {
            totalMinutesThisMonth += 45;
          }
        });
      }
    }

    // Target workouts in this month based on athlete weekly frequency
    const weeksInMonth = daysInMonth / 7;
    const targetWorkoutsInMonth = Math.round((profile.trainingDaysPerWeek || 4) * weeksInMonth);
    const monthlyConsistencyRate = Math.min(
      100,
      Math.round((workoutsThisMonth / Math.max(1, targetWorkoutsInMonth)) * 100)
    );

    return {
      currentStreak,
      longestStreak: Math.max(longestStreak, currentStreak),
      totalWorkouts: sessions.filter((s) => s.status === 'completed').length,
      isStreakActiveToday: isTrainedToday || trainedYesterday,
      isTrainedToday,
      monthlyConsistencyRate,
      totalMinutesThisMonth,
      totalVolumeThisMonth
    };
  }, [sessionsByDate, sessions, currentMonthDate, profile.trainingDaysPerWeek]);

  // Calendar matrix generation for currentMonthDate
  const calendarData = useMemo(() => {
    const year = currentMonthDate.getFullYear();
    const month = currentMonthDate.getMonth();

    const firstDayIndex = new Date(year, month, 1).getDay(); // 0 is Sun, 1 is Mon
    const startOffset = (firstDayIndex + 6) % 7;
    const daysInMonth = new Date(year, month + 1, 0).getDate();

    const cells: {
      dayNumber: number | null;
      dateStr: string;
      isToday: boolean;
      hasWorkout: boolean;
      workoutCount: number;
      sessions: WorkoutSession[];
    }[] = [];

    // Empty lead cells
    for (let i = 0; i < startOffset; i++) {
      cells.push({
        dayNumber: null,
        dateStr: `empty-${i}`,
        isToday: false,
        hasWorkout: false,
        workoutCount: 0,
        sessions: []
      });
    }

    const todayStr = new Date().toISOString().slice(0, 10);

    for (let day = 1; day <= daysInMonth; day++) {
      const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      const sessionsOnDay = sessionsByDate.get(dateStr) || [];
      cells.push({
        dayNumber: day,
        dateStr,
        isToday: dateStr === todayStr,
        hasWorkout: sessionsOnDay.length > 0,
        workoutCount: sessionsOnDay.length,
        sessions: sessionsOnDay
      });
    }

    return cells;
  }, [currentMonthDate, sessionsByDate]);

  // Recent 14-day consistency strip
  const recent14Days = useMemo(() => {
    const arr = [];
    const today = new Date();
    for (let i = 13; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      const dStr = d.toISOString().slice(0, 10);
      const dayName = d.toLocaleDateString('en-US', { weekday: 'narrow' });
      const dayNum = d.getDate();
      const hasWorkout = sessionsByDate.has(dStr);
      arr.push({ dateStr: dStr, dayName, dayNum, hasWorkout, isToday: i === 0 });
    }
    return arr;
  }, [sessionsByDate]);

  const monthLabel = currentMonthDate.toLocaleDateString('en-US', {
    month: 'long',
    year: 'numeric'
  });

  const handlePrevMonth = () => {
    setCurrentMonthDate((prev) => new Date(prev.getFullYear(), prev.getMonth() - 1, 1));
  };

  const handleNextMonth = () => {
    setCurrentMonthDate((prev) => new Date(prev.getFullYear(), prev.getMonth() + 1, 1));
  };

  // Milestone Badges
  const milestones = [
    { days: 3, title: 'Ignition', desc: '3-Day Chain', unlocked: stats.longestStreak >= 3 },
    { days: 7, title: 'Iron Week', desc: '7-Day Streak', unlocked: stats.longestStreak >= 7 },
    { days: 14, title: 'Relentless', desc: '14-Day Streak', unlocked: stats.longestStreak >= 14 },
    { days: 30, title: 'Master of Habit', desc: '30-Day Legend', unlocked: stats.longestStreak >= 30 }
  ];

  return (
    <div className="reshape-card overflow-hidden p-6 lg:p-7 space-y-6">
      {/* Subtle radial ambient glow */}
      <div className="absolute top-0 right-1/4 w-96 h-96 bg-[#CEFF00]/[0.04] rounded-full blur-3xl pointer-events-none" />
      <div className="absolute bottom-0 left-1/4 w-80 h-80 bg-sky-400/[0.03] rounded-full blur-3xl pointer-events-none" />

      {/* TOP COMMAND HEADER */}
      <div className="relative flex flex-col md:flex-row md:items-center justify-between gap-4 pb-6 border-b border-white/[0.08]">
        <div>
          <div className="flex items-center gap-2 text-xs font-mono font-bold tracking-widest text-[#CEFF00] uppercase mb-1">
            <Flame className="w-4 h-4 fill-[#CEFF00] text-[#CEFF00]" />
            <span>Habit &amp; Attendance Ledger</span>
          </div>
          <h2 className="text-xl sm:text-2xl font-nrc font-black italic uppercase text-white tracking-tight flex items-center gap-2">
            Gym Consistency Streak
          </h2>
          <p className="text-xs text-zinc-400 mt-1 max-w-xl font-sans">
            Consecutive gym attendance and training habit fidelity. Progressive overload compounds with uninterrupted momentum.
          </p>
        </div>

        {/* STREAK HERO BADGE */}
        <div className="flex items-center gap-3">
          <div className="bg-zinc-950/90 border border-[#CEFF00]/40 rounded-2xl px-5 py-3 shadow-[0_0_20px_rgba(206,255,0,0.15)] flex items-center gap-3.5">
            <div className="w-11 h-11 rounded-xl bg-[#CEFF00] flex items-center justify-center text-black font-nrc font-black text-xl italic shadow-md">
              <Flame className="w-6 h-6 fill-black stroke-[2]" />
            </div>
            <div>
              <div className="flex items-baseline gap-1.5">
                <span className="text-3xl font-nrc font-black italic text-white tracking-tight">
                  {stats.currentStreak}
                </span>
                <span className="text-xs font-mono font-bold text-[#CEFF00] uppercase">
                  {stats.currentStreak === 1 ? 'DAY' : 'DAYS'}
                </span>
              </div>
              <div className="text-[11px] font-semibold text-zinc-400 flex items-center gap-1.5">
                {stats.isTrainedToday ? (
                  <span className="text-[#CEFF00] font-bold flex items-center gap-1">
                    <CheckCircle2 className="w-3.5 h-3.5" /> Trained Today
                  </span>
                ) : stats.isStreakActiveToday ? (
                  <span className="text-amber-400">Streak Active · Train Today</span>
                ) : (
                  <span className="text-zinc-500">Log workout to start</span>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ATHLETIC ACTIVITY RINGS SHOWCASE */}
      <div className="grid grid-cols-1 md:grid-cols-12 gap-5 items-center">
        {/* LEFT: CIRCULAR ACTIVITY RINGS (SVG) */}
        <div className="md:col-span-5 flex flex-col items-center justify-center p-5 bg-zinc-950/80 rounded-3xl border border-white/[0.06] relative shadow-inner">
          <div className="relative w-48 h-48 flex items-center justify-center">
            <svg className="w-full h-full -rotate-90" viewBox="0 0 200 200">
              {/* Ring 1 Track & Progress: Consistency (Volt Lime) */}
              <circle
                cx="100"
                cy="100"
                r="82"
                stroke="rgba(255,255,255,0.06)"
                strokeWidth="13"
                fill="none"
              />
              <circle
                cx="100"
                cy="100"
                r="82"
                stroke="#CEFF00"
                strokeWidth="13"
                strokeDasharray="515"
                strokeDashoffset={515 - (515 * Math.min(100, stats.monthlyConsistencyRate)) / 100}
                strokeLinecap="round"
                fill="none"
                className="transition-all duration-1000 ease-out"
                style={{ filter: 'drop-shadow(0 0 6px rgba(206,255,0,0.5))' }}
              />

              {/* Ring 2 Track & Progress: Training Time / Minutes (Electric Cyan) */}
              <circle
                cx="100"
                cy="100"
                r="64"
                stroke="rgba(255,255,255,0.06)"
                strokeWidth="13"
                fill="none"
              />
              <circle
                cx="100"
                cy="100"
                r="64"
                stroke="#00E5FF"
                strokeWidth="13"
                strokeDasharray="402"
                strokeDashoffset={
                  402 - (402 * Math.min(100, Math.round((stats.totalMinutesThisMonth / 900) * 100))) / 100
                }
                strokeLinecap="round"
                fill="none"
                className="transition-all duration-1000 ease-out"
                style={{ filter: 'drop-shadow(0 0 6px rgba(0,229,255,0.5))' }}
              />

              {/* Ring 3 Track & Progress: Volume Load (Cyber Crimson) */}
              <circle
                cx="100"
                cy="100"
                r="46"
                stroke="rgba(255,255,255,0.06)"
                strokeWidth="13"
                fill="none"
              />
              <circle
                cx="100"
                cy="100"
                r="46"
                stroke="#FF3B30"
                strokeWidth="13"
                strokeDasharray="289"
                strokeDashoffset={
                  289 - (289 * Math.min(100, Math.round((stats.totalVolumeThisMonth / 50000) * 100))) / 100
                }
                strokeLinecap="round"
                fill="none"
                className="transition-all duration-1000 ease-out"
                style={{ filter: 'drop-shadow(0 0 6px rgba(255,59,48,0.5))' }}
              />
            </svg>

            {/* CENTER FLAME ICON & NUMBER */}
            <div className="absolute inset-0 flex flex-col items-center justify-center text-center pointer-events-none">
              <span className="text-3xl font-nrc font-black italic text-white">
                {stats.monthlyConsistencyRate}%
              </span>
              <span className="text-[10px] uppercase tracking-wider font-mono font-bold text-zinc-400">
                Consistency
              </span>
            </div>
          </div>

          {/* RING LEGEND LABELS */}
          <div className="grid grid-cols-3 gap-2 w-full mt-4 text-center">
            <div className="p-2.5 rounded-xl bg-zinc-900/60 border border-white/[0.04]">
              <div className="flex items-center justify-center gap-1.5 text-[10px] font-mono font-bold text-[#CEFF00]">
                <span className="w-2 h-2 rounded-full bg-[#CEFF00]" />
                <span>Habit</span>
              </div>
              <span className="text-xs font-mono font-bold text-zinc-200 mt-0.5 block">
                {stats.monthlyConsistencyRate}%
              </span>
            </div>
            <div className="p-2.5 rounded-xl bg-zinc-900/60 border border-white/[0.04]">
              <div className="flex items-center justify-center gap-1.5 text-[10px] font-mono font-bold text-sky-400">
                <span className="w-2 h-2 rounded-full bg-sky-400" />
                <span>Time</span>
              </div>
              <span className="text-xs font-mono font-bold text-zinc-200 mt-0.5 block">
                {stats.totalMinutesThisMonth}m
              </span>
            </div>
            <div className="p-2.5 rounded-xl bg-zinc-900/60 border border-white/[0.04]">
              <div className="flex items-center justify-center gap-1.5 text-[10px] font-mono font-bold text-[#FF3B30]">
                <span className="w-2 h-2 rounded-full bg-[#FF3B30]" />
                <span>Volume</span>
              </div>
              <span className="text-xs font-mono font-bold text-zinc-200 mt-0.5 block truncate">
                {Math.round(stats.totalVolumeThisMonth / 1000)}k
              </span>
            </div>
          </div>
        </div>

        {/* RIGHT: FOUR HIGH IMPACT STATS CARDS */}
        <div className="md:col-span-7 grid grid-cols-2 gap-3">
          <div className="p-4 bg-zinc-950/80 border border-white/[0.06] rounded-2xl flex flex-col justify-between">
            <div className="flex items-center justify-between text-zinc-400 text-xs font-mono uppercase font-bold">
              <span>CURRENT STREAK</span>
              <Flame className="w-4 h-4 text-[#CEFF00]" />
            </div>
            <div className="my-2">
              <span className="text-3xl font-nrc font-black italic text-white">
                {stats.currentStreak}
              </span>
              <span className="text-xs font-mono text-zinc-500 ml-1">days</span>
            </div>
            <span className="text-[11px] text-zinc-400">
              {stats.currentStreak >= 7 ? 'Elite consistency momentum' : 'Reach 7 days for Iron Week'}
            </span>
          </div>

          <div className="p-4 bg-zinc-950/80 border border-white/[0.06] rounded-2xl flex flex-col justify-between">
            <div className="flex items-center justify-between text-zinc-400 text-xs font-mono uppercase font-bold">
              <span>LONGEST RECORD</span>
              <Award className="w-4 h-4 text-amber-400" />
            </div>
            <div className="my-2">
              <span className="text-3xl font-nrc font-black italic text-amber-400">
                {stats.longestStreak}
              </span>
              <span className="text-xs font-mono text-zinc-500 ml-1">days</span>
            </div>
            <span className="text-[11px] text-zinc-400">All-time uninterrupted record</span>
          </div>

          <div className="p-4 bg-zinc-950/80 border border-white/[0.06] rounded-2xl flex flex-col justify-between">
            <div className="flex items-center justify-between text-zinc-400 text-xs font-mono uppercase font-bold">
              <span>TOTAL SESSIONS</span>
              <Dumbbell className="w-4 h-4 text-sky-400" />
            </div>
            <div className="my-2">
              <span className="text-3xl font-nrc font-black italic text-sky-400">
                {stats.totalWorkouts}
              </span>
              <span className="text-xs font-mono text-zinc-500 ml-1">logged</span>
            </div>
            <span className="text-[11px] text-zinc-400">Archived workouts in ledger</span>
          </div>

          <div className="p-4 bg-zinc-950/80 border border-white/[0.06] rounded-2xl flex flex-col justify-between">
            <div className="flex items-center justify-between text-zinc-400 text-xs font-mono uppercase font-bold">
              <span>WEEKLY TARGET</span>
              <TrendingUp className="w-4 h-4 text-emerald-400" />
            </div>
            <div className="my-2">
              <span className="text-3xl font-nrc font-black italic text-emerald-400">
                {profile.trainingDaysPerWeek || 4}
              </span>
              <span className="text-xs font-mono text-zinc-500 ml-1">days / wk</span>
            </div>
            <span className="text-[11px] text-zinc-400">Target frequency in active split</span>
          </div>
        </div>
      </div>

      {/* RECENT 14-DAY ACTIVITY TRAIL STRIP */}
      <div className="p-4 bg-zinc-950/80 rounded-2xl border border-white/[0.06] space-y-2.5">
        <div className="flex items-center justify-between text-xs">
          <span className="font-mono text-zinc-400 font-bold uppercase tracking-wider text-[11px]">
            14-Day Activity Trail
          </span>
          <span className="text-[11px] text-zinc-500 font-mono">
            {recent14Days.filter((d) => d.hasWorkout).length} / 14 Days Active
          </span>
        </div>

        <div className="grid grid-cols-7 sm:grid-cols-14 gap-1.5">
          {recent14Days.map((d, idx) => (
            <div
              key={idx}
              className={`p-2 rounded-xl border flex flex-col items-center justify-center transition-all ${
                d.hasWorkout
                  ? 'bg-[#CEFF00]/15 border-[#CEFF00]/40 text-[#CEFF00] shadow-[0_0_12px_rgba(206,255,0,0.15)]'
                  : d.isToday
                  ? 'bg-zinc-900 border-zinc-700 text-zinc-300 ring-1 ring-zinc-500'
                  : 'bg-zinc-950/80 border-white/[0.03] text-zinc-600'
              }`}
            >
              <span className="text-[10px] font-mono uppercase">{d.dayName}</span>
              <span className="text-xs font-mono font-bold mt-0.5">{d.dayNum}</span>
              <div className="mt-1">
                {d.hasWorkout ? (
                  <Flame className="w-3.5 h-3.5 fill-[#CEFF00] text-[#CEFF00]" />
                ) : (
                  <span className="w-1.5 h-1.5 rounded-full bg-zinc-700 block" />
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* FULL MONTH CALENDAR GRID */}
      <div className="p-4 sm:p-5 bg-zinc-950/80 rounded-3xl border border-white/[0.06] space-y-4">
        {/* MONTH HEADER NAVIGATION */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <CalendarIcon className="w-4 h-4 text-[#CEFF00]" />
            <h3 className="font-bold text-white text-base tracking-tight">{monthLabel}</h3>
          </div>

          <div className="flex items-center gap-1.5">
            <button
              onClick={handlePrevMonth}
              className="p-1.5 rounded-xl bg-zinc-900 hover:bg-zinc-800 text-zinc-400 hover:text-white border border-white/[0.05] transition-colors"
              title="Previous Month"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <button
              onClick={() => setCurrentMonthDate(new Date())}
              className="px-2.5 py-1 rounded-xl bg-zinc-900 hover:bg-zinc-800 text-zinc-300 hover:text-white text-xs font-mono border border-white/[0.05] transition-colors"
            >
              Current
            </button>
            <button
              onClick={handleNextMonth}
              className="p-1.5 rounded-xl bg-zinc-900 hover:bg-zinc-800 text-zinc-400 hover:text-white border border-white/[0.05] transition-colors"
              title="Next Month"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* WEEKDAY HEADERS */}
        <div className="grid grid-cols-7 gap-1 text-center font-mono text-[11px] text-zinc-500 font-bold uppercase py-1 border-b border-white/[0.04]">
          <span>Mon</span>
          <span>Tue</span>
          <span>Wed</span>
          <span>Thu</span>
          <span>Fri</span>
          <span>Sat</span>
          <span>Sun</span>
        </div>

        {/* CALENDAR DAYS MATRIX */}
        <div className="grid grid-cols-7 gap-1.5 sm:gap-2">
          {calendarData.map((cell, idx) => {
            if (cell.dayNumber === null) {
              return <div key={idx} className="h-14 sm:h-16 rounded-xl bg-transparent" />;
            }

            const isSelected = selectedDayDetails?.dateStr === cell.dateStr;

            return (
              <button
                key={idx}
                onClick={() => {
                  if (cell.hasWorkout) {
                    setSelectedDayDetails({
                      dateStr: cell.dateStr,
                      sessionsOnDay: cell.sessions
                    });
                  } else {
                    setSelectedDayDetails(null);
                  }
                }}
                className={`group relative h-14 sm:h-16 rounded-2xl p-2 flex flex-col justify-between text-left transition-all border ${
                  cell.hasWorkout
                    ? 'bg-gradient-to-br from-[#CEFF00]/15 via-zinc-900/90 to-zinc-950 border-[#CEFF00]/40 hover:border-[#CEFF00] shadow-[0_0_15px_rgba(206,255,0,0.12)] cursor-pointer'
                    : cell.isToday
                    ? 'bg-zinc-900/70 border-white/20 text-zinc-300'
                    : 'bg-zinc-950/40 border-white/[0.03] text-zinc-500 hover:border-white/10'
                } ${isSelected ? 'ring-2 ring-[#CEFF00]' : ''}`}
              >
                <div className="flex items-center justify-between w-full">
                  <span
                    className={`font-mono text-xs font-bold ${
                      cell.isToday
                        ? 'text-[#CEFF00] font-black'
                        : cell.hasWorkout
                        ? 'text-white'
                        : 'text-zinc-500'
                    }`}
                  >
                    {cell.dayNumber}
                  </span>
                  {cell.hasWorkout && (
                    <Flame className="w-3.5 h-3.5 fill-[#CEFF00] text-[#CEFF00]" />
                  )}
                </div>

                {cell.hasWorkout ? (
                  <div className="text-[10px] font-mono text-[#CEFF00]/90 truncate font-semibold">
                    {cell.sessions[0]?.dayName?.replace(/^(Day \d+ — |Day \d+ - )/i, '') || 'Trained'}
                  </div>
                ) : cell.isToday ? (
                  <div className="text-[9px] font-mono text-zinc-500 uppercase tracking-tighter">
                    Today
                  </div>
                ) : (
                  <div />
                )}
              </button>
            );
          })}
        </div>

        {/* SELECTED DAY WORKOUT DETAILS DRAWER */}
        {selectedDayDetails && (
          <div className="mt-4 p-4 rounded-2xl bg-zinc-950 border border-[#CEFF00]/40 shadow-xl space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-[#CEFF00]" />
                <span className="font-bold text-sm text-white">
                  Workout Logged on {selectedDayDetails.dateStr}
                </span>
              </div>
              <button
                onClick={() => setSelectedDayDetails(null)}
                className="text-xs text-zinc-400 hover:text-white"
              >
                Close &times;
              </button>
            </div>

            <div className="space-y-2">
              {selectedDayDetails.sessionsOnDay.map((s, sIdx) => {
                const vol = calculateVolumeLoad(s.exercises.flatMap((e) => e.sets));
                return (
                  <div
                    key={sIdx}
                    className="p-3 bg-zinc-900/90 border border-white/[0.06] rounded-xl flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs"
                  >
                    <div>
                      <span className="font-bold text-white text-sm block">{s.dayName}</span>
                      <span className="text-zinc-400 text-[11px]">
                        {s.exercises.length} Exercises · {s.exercises.flatMap((e) => e.sets).filter((st) => st.completed).length} Working Sets
                      </span>
                    </div>
                    <div className="flex items-center gap-3 font-mono text-zinc-300">
                      <span>Volume: <strong className="text-[#CEFF00]">{vol.toLocaleString()} {profile.preferredUnit}</strong></span>
                      {s.notes && <span className="text-zinc-500 truncate max-w-[150px]">“{s.notes}”</span>}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* HABIT MILESTONES SHOWCASE */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-xs font-mono font-bold uppercase tracking-wider text-zinc-400">
            Discipline Trophies &amp; Milestones
          </span>
          <span className="text-xs font-mono text-zinc-500">
            {milestones.filter((m) => m.unlocked).length} / {milestones.length} Unlocked
          </span>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {milestones.map((m, idx) => (
            <div
              key={idx}
              className={`p-3.5 rounded-2xl border transition-all text-left flex flex-col justify-between h-24 ${
                m.unlocked
                  ? 'bg-zinc-950/90 border-amber-400/40 text-amber-300 shadow-md'
                  : 'bg-zinc-950/40 border-white/[0.03] text-zinc-600'
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="font-mono text-xs font-extrabold">{m.days}D</span>
                <Award
                  className={`w-4 h-4 ${m.unlocked ? 'text-amber-400 fill-amber-400' : 'text-zinc-700'}`}
                />
              </div>
              <div>
                <span
                  className={`font-bold text-xs block ${m.unlocked ? 'text-white' : 'text-zinc-500'}`}
                >
                  {m.title}
                </span>
                <span className="text-[10px] text-zinc-500 block">{m.desc}</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ATHLETE ADVICE BANNER */}
      <div className="p-4 rounded-2xl bg-zinc-950/80 border border-white/[0.06] flex items-center justify-between gap-4 text-xs">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-xl bg-[#CEFF00]/10 border border-[#CEFF00]/25 flex items-center justify-center text-[#CEFF00] shrink-0">
            <Zap className="w-4 h-4" />
          </div>
          <div>
            <span className="font-bold text-white block">
              Coach Iron Discipline Rule:
            </span>
            <span className="text-zinc-400 text-[11px]">
              &quot;Never miss twice. A 20-minute session or active recovery counts toward the habit. Guard your streak.&quot;
            </span>
          </div>
        </div>

        {onNavigateToWorkouts && (
          <button
            onClick={onNavigateToWorkouts}
            className="touch-press px-4 py-2 bg-[#CEFF00] hover:bg-[#d4ff00] text-black font-nrc font-black italic uppercase text-xs rounded-xl shadow-md shrink-0 transition-colors"
          >
            Train Now
          </button>
        )}
      </div>
    </div>
  );
};
