import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Bell, Database, KeyRound, Palette, Ruler, Dumbbell, User } from 'lucide-react';
import { BrandLogo, Button, PageHeader, SectionNav, SectionNavItem } from '../ui';
import { BRAND } from '../../brand';
import type { UserProfile } from '../../types';
import { db } from '../../storage/db';
import { useAuth } from '../../context/AuthContext';
import { validateHeightCm } from '../../utils/heightUnits';
import { isProfileDirty, ProfileErrors, ProfileField, validateProfileEdits } from '../../utils/profileValidation';
import { AccountSecurity } from './AccountSecurity';
import { AppearancePanel } from './AppearancePanel';
import { DataPanel } from './DataPanel';
import { NotificationSettings } from './NotificationSettings';
import { ProfileOverview } from './ProfileOverview';
import { ProfilePanel, TrainingPanel, UnitsPanel } from './ProfilePanels';

interface SettingsProps {
  profile: UserProfile;
  onProfileUpdated: (p: UserProfile) => void;
  isDemoMode: boolean;
  onLoadDemoData: () => void;
  onClearDemoData: () => void;
}

type CategoryId = 'profile' | 'training' | 'units' | 'appearance' | 'notifications' | 'data' | 'account';

const ICON = 'w-4 h-4';
const CATEGORIES: SectionNavItem<CategoryId>[] = [
  { id: 'profile', label: 'Profile', icon: <User className={ICON} /> },
  { id: 'training', label: 'Training', icon: <Dumbbell className={ICON} /> },
  { id: 'units', label: 'Units', icon: <Ruler className={ICON} /> },
  { id: 'appearance', label: 'Appearance', icon: <Palette className={ICON} /> },
  { id: 'notifications', label: 'Notifications', icon: <Bell className={ICON} /> },
  { id: 'data', label: 'Privacy & data', icon: <Database className={ICON} /> },
  { id: 'account', label: 'Account', icon: <KeyRound className={ICON} /> }
];

/** Panels backed by the single profile form (one Save for all of them). */
const FORM_CATEGORIES: CategoryId[] = ['profile', 'training', 'units'];

/** Which panel shows a given field, so a failed save can jump to the first problem. */
const FIELD_CATEGORY: Record<ProfileField, CategoryId> = {
  name: 'profile',
  age: 'profile',
  heightCm: 'profile',
  currentWeightKg: 'profile',
  goalWeightKg: 'profile',
  trainingDaysPerWeek: 'training',
  dailyCalorieTarget: 'training',
  dailyProteinTarget: 'training',
  dailyCarbsTarget: 'training',
  dailyFatTarget: 'training',
  minBarbellIncrement: 'training',
  minDumbbellIncrement: 'training',
  minMachineIncrement: 'training'
};

export const SettingsView: React.FC<SettingsProps> = ({
  profile,
  onProfileUpdated,
  isDemoMode,
  onLoadDemoData,
  onClearDemoData
}) => {
  const { user, signOut } = useAuth();
  const [category, setCategory] = useState<CategoryId>('profile');
  const [form, setForm] = useState<UserProfile>({ ...profile });
  const [errors, setErrors] = useState<ProfileErrors>({});
  const [saved, setSaved] = useState(false);
  const savedTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const [signingOut, setSigningOut] = useState(false);
  const [signOutError, setSignOutError] = useState<string | null>(null);

  const dirty = isProfileDirty(form, profile);
  const errorCount = Object.keys(errors).length;

  // The header's unit toggle saves the profile directly. Follow it so this form neither shows a stale unit nor
  // saves the old one back over the change.
  useEffect(() => {
    setForm((f) => (f.preferredUnit === profile.preferredUnit ? f : { ...f, preferredUnit: profile.preferredUnit }));
  }, [profile.preferredUnit]);

  useEffect(() => () => clearTimeout(savedTimer.current), []);

  // Browser-level guard for reload or tab close while edits are unsaved.
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const setField = useCallback(<K extends keyof UserProfile>(key: K, value: UserProfile[K]) => {
    setSaved(false);
    setForm((f) => ({ ...f, [key]: value }));
    setErrors((e) => {
      if (!(key in e)) return e;
      const { [key as ProfileField]: _removed, ...rest } = e;
      return rest;
    });
  }, []);

  const handleSave = (e?: React.FormEvent) => {
    e?.preventDefault();
    const found: ProfileErrors = validateProfileEdits(form, profile);
    // Only validate height if it was edited, so an existing profile can still be saved untouched.
    const heightProblem = form.heightCm !== profile.heightCm ? validateHeightCm(form.heightCm) : null;
    if (heightProblem) found.heightCm = heightProblem;
    setErrors(found);
    const first = (Object.keys(found) as ProfileField[])[0];
    if (first) {
      setCategory(FIELD_CATEGORY[first]);
      return;
    }
    db.saveProfile(form);
    onProfileUpdated(form);
    setSaved(true);
    clearTimeout(savedTimer.current);
    savedTimer.current = setTimeout(() => setSaved(false), 2500);
  };

  const handleDiscard = () => {
    setForm({ ...profile });
    setErrors({});
    setSaved(false);
  };

  /** After a backup restore or a full reset the stored profile is the truth; drop any edits. */
  const handleProfileReplaced = (next: UserProfile) => {
    setForm(next);
    setErrors({});
    setSaved(false);
    onProfileUpdated(next);
  };

  const handleSignOut = async () => {
    if (signingOut) return;
    setSigningOut(true);
    setSignOutError(null);
    const r = await signOut();
    // On success AuthGate unmounts this view, so only the failure path needs to reset state.
    if (!r.ok) {
      setSignOutError(r.error ?? 'Could not sign out.');
      setSigningOut(false);
    }
  };

  const items = user ? CATEGORIES : CATEGORIES.filter((c) => c.id !== 'account');
  const formPanelProps = { form, errors, setField };
  const showBar = dirty || errorCount > 0 || saved;

  const panel = (() => {
    switch (category) {
      case 'profile':
        return <ProfilePanel {...formPanelProps} />;
      case 'training':
        return <TrainingPanel {...formPanelProps} />;
      case 'units':
        return <UnitsPanel {...formPanelProps} />;
      case 'appearance':
        return <AppearancePanel />;
      case 'notifications':
        return <NotificationSettings />;
      case 'data':
        return (
          <DataPanel
            isDemoMode={isDemoMode}
            onLoadDemoData={onLoadDemoData}
            onClearDemoData={onClearDemoData}
            onProfileReplaced={handleProfileReplaced}
          />
        );
      case 'account':
        return user ? <AccountSecurity /> : null;
    }
  })();

  const activeLabel = items.find((c) => c.id === category)?.label ?? 'Settings';

  return (
    <div className="max-w-5xl mx-auto pb-8">
      <PageHeader title="Settings" description="Your profile, training preferences and data." />

      <ProfileOverview
        profile={profile}
        email={user?.email ?? undefined}
        onSignOut={handleSignOut}
        signingOut={signingOut}
        signOutError={signOutError}
      />

      <div className="mt-5 grid gap-5 lg:grid-cols-[13rem_minmax(0,1fr)] lg:gap-8 lg:items-start">
        <SectionNav items={items} value={category} onChange={setCategory} ariaLabel="Settings categories" />

        <div className="min-w-0 space-y-4">
          <h2 className="sr-only">{activeLabel}</h2>
          {FORM_CATEGORIES.includes(category) ? (
            <form onSubmit={handleSave} noValidate className="space-y-4">
              {panel}
            </form>
          ) : (
            panel
          )}

          {showBar && (
            <>
              <div className="h-20 lg:hidden" aria-hidden />
              <div className="fixed inset-x-0 z-30 px-3 bottom-[calc(4.5rem+env(safe-area-inset-bottom))] lg:static lg:px-0">
                <div className="mx-auto max-w-2xl lg:max-w-none flex items-center gap-3 rounded-card border border-line-strong bg-surface-3 p-3">
                  <p
                    role={errorCount > 0 ? 'alert' : 'status'}
                    className={`flex-1 min-w-0 text-xs ${errorCount > 0 ? 'text-danger' : dirty ? 'text-zinc-300' : 'text-accent'}`}
                  >
                    {errorCount > 0
                      ? `Fix ${errorCount} ${errorCount === 1 ? 'field' : 'fields'} to save.`
                      : dirty
                      ? 'You have unsaved changes.'
                      : 'Preferences saved.'}
                  </p>
                  {dirty && (
                    <>
                      <Button type="button" variant="ghost" size="sm" onClick={handleDiscard}>
                        Discard
                      </Button>
                      <Button type="button" size="sm" onClick={() => handleSave()}>
                        Save changes
                      </Button>
                    </>
                  )}
                </div>
              </div>
            </>
          )}
        </div>
      </div>
      <footer className="mt-10 flex flex-col items-center gap-2 text-center">
        <BrandLogo variant="lockup" className="h-16 opacity-90" />
        <p className="text-xs text-[var(--text-muted)]">{BRAND.description}</p>
      </footer>
    </div>
  );
};
