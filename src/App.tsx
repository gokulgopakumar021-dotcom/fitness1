import React, { useState, useEffect } from 'react';
import { PreferredUnit, UserProfile, WorkoutSession } from './types';
import { db } from './storage/db';
import {
  TopHeader,
  DesktopSidebar,
  MobileBottomNav,
  NavTab
} from './components/layout/Navbar';
import { HomeView } from './components/home/HomeView';
import { DashboardView } from './components/dashboard/DashboardView';
import { WorkoutSessionTracker } from './components/workouts/WorkoutSessionTracker';
import { ProgressionView } from './components/progression/ProgressionView';
import { NutritionView } from './components/nutrition/NutritionView';
import { BodyMetricsView } from './components/body/BodyMetricsView';
import { PlansUploadView } from './components/plans/PlansUploadView';
import { ReportsView } from './components/reports/ReportsView';
import { ProgressTimelineView } from './components/timeline/ProgressTimelineView';
import { SettingsView } from './components/settings/SettingsView';
import { VideoLibraryView } from './components/video/VideoLibraryView';
import { WorkoutMirrorContainer } from './components/workoutMirror/WorkoutMirrorContainer';
import { AiTrainerView } from './components/trainer/AiTrainerView';
import { FloatingTrainerWidget } from './components/trainer/FloatingTrainerWidget';
import { BluetoothGadgetProvider } from './context/BluetoothGadgetContext';
import { BluetoothGadgetModal } from './components/bluetooth/BluetoothGadgetModal';
import { ThemeProvider } from './context/ThemeContext';
import { AuthProvider } from './context/AuthContext';
import { AuthGate } from './components/auth/AuthGate';
import { useReminders } from './hooks/useReminders';

/** The private application. Only ever mounted by AuthGate, after storage is scoped to the signed-in account. */
function AppShell() {
  useReminders();
  const [currentTab, setCurrentTab] = useState<NavTab>('home');
  const [profile, setProfile] = useState<UserProfile>(() => db.getProfile());
  const [activeSession, setActiveSession] = useState<WorkoutSession | null>(() =>
    db.getActiveSession()
  );
  const [isDemoMode, setIsDemoMode] = useState<boolean>(() => db.isDemoModeActive());

  // Listen for database changes & maintain sync
  useEffect(() => {
    setProfile(db.getProfile());
    setActiveSession(db.getActiveSession());
    setIsDemoMode(db.isDemoModeActive());
  }, []);

  const handleToggleUnit = () => {
    const nextUnit: PreferredUnit = profile.preferredUnit === 'kg' ? 'lbs' : 'kg';
    const updated: UserProfile = { ...profile, preferredUnit: nextUnit };
    db.saveProfile(updated);
    setProfile(updated);
  };

  const handleLoadDemoData = () => {
    db.loadDemoData();
    setIsDemoMode(true);
    setProfile(db.getProfile());
    setActiveSession(db.getActiveSession());
    // Trigger re-render
  };

  const handleClearDemoData = () => {
    db.clearDemoData();
    setIsDemoMode(false);
    setProfile(db.getProfile());
    setActiveSession(db.getActiveSession());
  };

  const [progressionPlanId, setProgressionPlanId] = useState<string | undefined>();

  // Start each screen at the top when switching tabs
  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [currentTab]);

  const handleResumeActiveSession = () => {
    setCurrentTab('workouts');
  };

  const handleNavigateToProgressionWithPlan = (planId: string) => {
    setProgressionPlanId(planId);
    setCurrentTab('progression');
  };

  return (
      <BluetoothGadgetProvider profile={profile}>
        <div className="min-h-dvh bg-[var(--bg-canvas)] text-[var(--text-primary)] flex flex-col font-sans transition-colors duration-200">
          <a
            href="#main-content"
            className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[60] focus:px-4 focus:py-2 focus:rounded-lg focus:bg-accent focus:text-accent-ink focus:text-sm focus:font-semibold"
          >
            Skip to content
          </a>
          {/* Top Application Header */}
        <TopHeader
          currentTab={currentTab}
          onSelectTab={setCurrentTab}
          activeSession={activeSession}
          onResumeActiveSession={handleResumeActiveSession}
          profile={profile}
          isDemoMode={isDemoMode}
          onClearDemoData={handleClearDemoData}
          onToggleUnit={handleToggleUnit}
        />

        <div className="flex flex-1 max-w-7xl w-full mx-auto">
          {/* Desktop Left Sidebar */}
          <DesktopSidebar
            currentTab={currentTab}
            onSelectTab={setCurrentTab}
            activeSession={activeSession}
          />

          {/* Main View Area */}
          <main
            id="main-content"
            tabIndex={-1}
            className="flex-1 px-4 sm:px-6 lg:px-8 pt-5 lg:pt-7 min-w-0 pb-[calc(6rem+env(safe-area-inset-bottom))] lg:pb-12 overflow-x-clip outline-none"
          >
            {currentTab === 'home' && (
              <HomeView
                profile={profile}
                activeSession={activeSession}
                onNavigate={setCurrentTab}
                onResumeActiveSession={handleResumeActiveSession}
                isDemoMode={isDemoMode}
                onLoadDemoData={handleLoadDemoData}
                onClearDemoData={handleClearDemoData}
              />
            )}

            {currentTab === 'dashboard' && (
              <DashboardView
                profile={profile}
                activeSession={activeSession}
                onNavigate={setCurrentTab}
                onResumeActiveSession={handleResumeActiveSession}
                isDemoMode={isDemoMode}
                onLoadDemoData={handleLoadDemoData}
              />
            )}

            {currentTab === 'workouts' && (
              <WorkoutSessionTracker
                profile={profile}
                activeSession={activeSession}
                onSessionUpdated={setActiveSession}
                onNavigateToPlans={() => setCurrentTab('plans')}
                onNavigateToMirror={() => setCurrentTab('mirror')}
              />
            )}

            {currentTab === 'mirror' && (
              <WorkoutMirrorContainer
                onSetLoggedToWorkout={(exerciseName, reps) => {
                  // Integrated set logged
                }}
              />
            )}

            {currentTab === 'trainer' && (
              <AiTrainerView
                profile={profile}
                activeSession={activeSession}
                onNavigate={setCurrentTab}
                onProfileUpdated={setProfile}
              />
            )}

            {currentTab === 'videos' && <VideoLibraryView />}

            {currentTab === 'progression' && (
              <ProgressionView
                profile={profile}
                initialPlanId={progressionPlanId}
              />
            )}

            {currentTab === 'nutrition' && (
              <NutritionView profile={profile} onProfileUpdated={setProfile} />
            )}

            {currentTab === 'body' && (
              <BodyMetricsView
                profile={profile}
                onProfileUpdated={setProfile}
              />
            )}

            {currentTab === 'plans' && (
              <PlansUploadView
                profile={profile}
                onPlanActivated={() => {
                  // Refresh active session or prompt
                }}
                onNavigateToProgression={handleNavigateToProgressionWithPlan}
                onStartWorkout={(session) => {
                  setActiveSession(session);
                  setCurrentTab('workouts');
                }}
              />
            )}

            {currentTab === 'reports' && (
              <ReportsView profile={profile} />
            )}

            {currentTab === 'timeline' && (
              <ProgressTimelineView
                profile={profile}
                isDemoMode={isDemoMode}
                onProfileUpdated={setProfile}
              />
            )}

            {currentTab === 'settings' && (
              <SettingsView
                profile={profile}
                onProfileUpdated={setProfile}
                isDemoMode={isDemoMode}
                onLoadDemoData={handleLoadDemoData}
                onClearDemoData={handleClearDemoData}
              />
            )}
          </main>
        </div>

        {/* Mobile Fixed Bottom Navigation */}
        <MobileBottomNav
          currentTab={currentTab}
          onSelectTab={setCurrentTab}
          activeSession={activeSession}
        />

        {/* Floating Quick AI Coach Widget */}
        <FloatingTrainerWidget
          currentTab={currentTab}
          onNavigate={setCurrentTab}
          activeSession={activeSession}
          profile={profile}
        />

        {/* Global Bluetooth Fitness Gadgets Hub Modal */}
        <BluetoothGadgetModal />
      </div>
    </BluetoothGadgetProvider>
  );
}

export default function App() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <AuthGate>
          <AppShell />
        </AuthGate>
      </AuthProvider>
    </ThemeProvider>
  );
}
