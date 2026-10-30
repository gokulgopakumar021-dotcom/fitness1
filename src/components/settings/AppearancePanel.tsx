import React from 'react';
import { SegmentedControl } from '../ui';
import { ThemeMode, useTheme } from '../../context/ThemeContext';
import { SettingRow, SettingRows, SettingsCard } from './SettingsParts';

/** Theme selection through the existing ThemeContext (same state the header toggle uses). */
export const AppearancePanel: React.FC = () => {
  const { theme, setTheme } = useTheme();
  return (
    <SettingsCard title="Appearance" description="How Iron Log looks on this device.">
      <SettingRows>
        <SettingRow label="Theme" description="Applies immediately and is remembered on this device. You can also switch it from the header.">
          <SegmentedControl<ThemeMode>
            ariaLabel="Theme"
            value={theme}
            onChange={setTheme}
            options={[
              { value: 'dark', label: 'Dark' },
              { value: 'light', label: 'Light' }
            ]}
          />
        </SettingRow>
      </SettingRows>
    </SettingsCard>
  );
};
