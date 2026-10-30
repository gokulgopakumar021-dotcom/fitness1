import React from 'react';
import { LogOut } from 'lucide-react';
import { Badge, Button, Card } from '../ui';
import type { UserProfile } from '../../types';
import { AvatarEditor } from './AvatarEditor';
import { EXPERIENCE_OPTIONS, GOAL_OPTIONS, shortLabel } from './profileOptions';

interface ProfileOverviewProps {
  /** The saved profile (not the unsaved form), so this always shows what the rest of the app sees. */
  profile: UserProfile;
  email?: string;
  onSignOut: () => void;
  signingOut: boolean;
  signOutError: string | null;
}

/** Top of Settings: who this is, their training focus, and the account's sign-out. Shows only stored values. */
export const ProfileOverview: React.FC<ProfileOverviewProps> = ({ profile, email, onSignOut, signingOut, signOutError }) => {
  const name = profile.name.trim();
  const goal = shortLabel(GOAL_OPTIONS, profile.primaryGoal);
  const experience = shortLabel(EXPERIENCE_OPTIONS, profile.trainingExperience);

  return (
    <Card as="section" aria-label="Profile overview">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <AvatarEditor name={profile.name}>
          <div className="min-w-0">
            <h2 className={`text-xl font-semibold tracking-tight truncate ${name ? 'text-white' : 'text-zinc-500'}`}>
              {name || 'Add your name'}
            </h2>
            {email && <p className="text-xs text-zinc-400 truncate">Signed in as {email}</p>}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {goal && <Badge tone="accent">{goal}</Badge>}
            {experience && <Badge>{experience}</Badge>}
            {profile.trainingDaysPerWeek > 0 && <Badge>{profile.trainingDaysPerWeek} days/week</Badge>}
          </div>
        </AvatarEditor>
        {email && (
          <Button
            type="button"
            variant="secondary"
            onClick={onSignOut}
            loading={signingOut}
            icon={<LogOut className="w-4 h-4" aria-hidden />}
            className="sm:shrink-0"
          >
            {signingOut ? 'Signing out…' : 'Sign out'}
          </Button>
        )}
      </div>
      {email && <p className="text-label text-zinc-500 mt-4">Signing out keeps your data on this device.</p>}
      {signOutError && (
        <p role="alert" className="text-xs text-danger mt-2">
          {signOutError}
        </p>
      )}
    </Card>
  );
};
