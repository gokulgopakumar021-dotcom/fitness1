import React from 'react';
import {
  GlassWater,
  CupSoda,
  Droplets,
  Zap,
  Sparkles,
  Trophy,
  Plus
} from 'lucide-react';
import { WaterUnit } from './WaterIntakeLogger';

export interface ContainerPreset {
  id: string;
  label: string; // e.g. "8 oz", "16 oz", "500 ml"
  subLabel: string; // e.g. "237 ml", "473 ml", "17 fl oz"
  containerName: string; // e.g. "Glass", "Pint", "Shaker"
  amountMl: number;
  amountOz: number;
  icon: React.ComponentType<{ className?: string }>;
}

export const COMMON_CONTAINER_PRESETS: ContainerPreset[] = [
  {
    id: '8oz',
    label: '8 oz',
    subLabel: '237 ml',
    containerName: 'Glass',
    amountMl: 237,
    amountOz: 8,
    icon: GlassWater
  },
  {
    id: '12oz',
    label: '12 oz',
    subLabel: '355 ml',
    containerName: 'Mug',
    amountMl: 355,
    amountOz: 12,
    icon: CupSoda
  },
  {
    id: '16oz',
    label: '16 oz',
    subLabel: '473 ml',
    containerName: 'Pint',
    amountMl: 473,
    amountOz: 16,
    icon: Droplets
  },
  {
    id: '500ml',
    label: '500 ml',
    subLabel: '17 oz',
    containerName: 'Shaker',
    amountMl: 500,
    amountOz: 17,
    icon: Zap
  },
  {
    id: '24oz',
    label: '24 oz',
    subLabel: '710 ml',
    containerName: 'Sports Bottle',
    amountMl: 710,
    amountOz: 24,
    icon: Sparkles
  },
  {
    id: '750ml',
    label: '750 ml',
    subLabel: '25 oz',
    containerName: 'Bidon',
    amountMl: 750,
    amountOz: 25,
    icon: Droplets
  },
  {
    id: '1000ml',
    label: '1,000 ml',
    subLabel: '34 oz (1L)',
    containerName: '1L Jug',
    amountMl: 1000,
    amountOz: 34,
    icon: Trophy
  }
];

export interface QuickAddPresetBarProps {
  onQuickAdd: (amountMl: number, displayLabel: string) => void;
  onPrefillInput?: (amount: number, unit: WaterUnit) => void;
  activeUnit: WaterUnit;
}

export const QuickAddPresetBar: React.FC<QuickAddPresetBarProps> = ({
  onQuickAdd,
  onPrefillInput,
  activeUnit
}) => {
  return (
    <div className="space-y-2">
      {/* Preset Bar Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-xs font-mono font-bold text-[var(--text-primary)]">
          <Zap className="w-3.5 h-3.5 text-sky-400" />
          <span>Quick Add Container Presets</span>
          <span className="text-[10px] font-normal text-[var(--text-muted)] hidden sm:inline">
            (One-tap log common sizes)
          </span>
        </div>
        <span className="text-[10px] font-mono text-sky-400">
          Tap to add instantly
        </span>
      </div>

      {/* Preset Buttons Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2">
        {COMMON_CONTAINER_PRESETS.map((preset) => {
          const Icon = preset.icon;
          const primaryText = activeUnit === 'oz' ? preset.label : preset.subLabel;
          const secondaryText = activeUnit === 'oz' ? preset.subLabel : preset.label;

          return (
            <button
              key={preset.id}
              type="button"
              onClick={() => {
                onQuickAdd(preset.amountMl, `${preset.label} (${preset.containerName})`);
                if (onPrefillInput) {
                  if (preset.id.endsWith('ml')) {
                    onPrefillInput(preset.amountMl, 'ml');
                  } else {
                    onPrefillInput(preset.amountOz, 'oz');
                  }
                }
              }}
              className="touch-press p-2 sm:p-2.5 rounded-xl bg-[var(--bg-subtle)] hover:bg-[var(--chip-bg)] border border-[var(--border-card)] hover:border-sky-400/50 text-[var(--text-primary)] transition-all flex flex-col items-center justify-center gap-1 group shadow-sm text-center relative overflow-hidden"
              title={`Quick add ${preset.label} / ${preset.subLabel} (${preset.containerName})`}
            >
              <div className="flex items-center gap-1.5 text-sky-400 group-hover:scale-110 transition-transform">
                <Icon className="w-4 h-4" />
                <span className="text-xs font-mono font-bold">{primaryText}</span>
              </div>

              <div className="flex flex-col items-center">
                <span className="text-[10px] font-mono text-[var(--text-muted)] font-medium">
                  {preset.containerName}
                </span>
                <span className="text-[9px] font-mono text-sky-400/70">
                  {secondaryText}
                </span>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
};
