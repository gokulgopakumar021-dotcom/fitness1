import React, { useState, useEffect } from 'react';
import { PreferredUnit, UserProfile, WorkoutSession } from './types';
import { db } from './storage/db';
import {
  TopHeader,
  DesktopSidebar,
  MobileBottomNav,
  NavTab
} from './components/layout/Navbar';
import { DashboardView } from './components/dashboard/DashboardView';
import { WorkoutSessionTracker } from './components/workouts/WorkoutSessionTracker';
import { ProgressionView } from './components/progression/ProgressionView';
import { NutritionView } from './components/nutrition/NutritionView';
import { BodyMetricsView } from './components/body/BodyMetricsView';
import { PlansUploadView } from './components/plans/PlansUploadView';
import { ReportsView } from './components/reports/ReportsView';
import { SettingsView } from './components/settings/SettingsView';
import { AiTrainerView } from './components/trainer/AiTrainerView';
import { FloatingTrainerWidget } from './components/trainer/FloatingTrainerWidget';
import { BluetoothGadgetProvider } from './context/BluetoothGadgetContext';
import { BluetoothGadgetModal } from './components/bluetooth/BluetoothGadgetModal';

export default function App() {
  const [currentTab, setCurrentTab] = useState<NavTab>('dashboard');
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

  const handleResumeActiveSession = () => {
    setCurrentTab('workouts');
  };

  const handleNavigateToProgressionWithPlan = (planId: string) => {
    setProgressionPlanId(planId);
    setCurrentTab('progression');
  };

  return (
    <BluetoothGadgetProvider profile={profile}>
      <div className="min-h-screen bg-[#090b0e] text-zinc-100 flex flex-col font-sans">
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
          <main className="flex-1 p-4 lg:p-7 min-w-0 pb-24 lg:pb-12 overflow-x-hidden">
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

            {currentTab === 'progression' && (
              <ProgressionView
                profile={profile}
                initialPlanId={progressionPlanId}
              />
            )}

            {currentTab === 'nutrition' && (
              <NutritionView profile={profile} />
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
              />
            )}

            {currentTab === 'reports' && (
              <ReportsView profile={profile} />
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
