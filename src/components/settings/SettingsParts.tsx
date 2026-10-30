import React from 'react';
import { Card, SectionHeading, cn } from '../ui';

interface SettingsCardProps {
  title: string;
  description?: string;
  /** Destructive areas get a danger-tinted border; still the shared Card. */
  danger?: boolean;
  action?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}

/** One titled settings surface: the shared Card plus a section heading. */
export const SettingsCard: React.FC<SettingsCardProps> = ({ title, description, danger, action, className, children }) => (
  <Card as="section" aria-label={title} className={cn('space-y-4', danger && 'border-danger/30', className)}>
    <SectionHeading level={3} title={title} description={description} action={action} className="mb-0" />
    {children}
  </Card>
);

interface SettingRowProps {
  label: string;
  description?: string;
  children: React.ReactNode;
}

/** A label and helper text with its control: stacked on phones, side by side from `sm`. */
export const SettingRow: React.FC<SettingRowProps> = ({ label, description, children }) => (
  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 py-3 first:pt-0 last:pb-0">
    <div className="min-w-0 sm:max-w-md">
      <div className="text-sm font-medium text-zinc-100">{label}</div>
      {description && <p className="text-label text-zinc-500 mt-0.5">{description}</p>}
    </div>
    <div className="min-w-0 max-w-full sm:shrink-0">{children}</div>
  </div>
);

/** Divider list wrapper for SettingRow children. */
export const SettingRows: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="divide-y divide-line">{children}</div>
);
