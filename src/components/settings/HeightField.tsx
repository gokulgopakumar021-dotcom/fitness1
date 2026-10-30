import React, { useEffect, useState } from 'react';
import { Input } from '../ui';
import { cmToFtIn, ftInToCm, resolveHeightUnit } from '../../utils/heightUnits';
import type { HeightUnit } from '../../types';

interface HeightFieldProps {
  /** Height in centimetres: the only unit ever stored. */
  valueCm: number;
  unit: HeightUnit | undefined;
  onChange: (cm: number) => void;
  error?: string;
}

const toStr = (n: number) => (n ? String(n) : '');

/** Height entry in the person's chosen unit. Converts to cm on edit; untouched values are never re-rounded. */
export const HeightField: React.FC<HeightFieldProps> = ({ valueCm, unit, onChange, error }) => {
  const u = resolveHeightUnit(unit);
  const [feet, setFeet] = useState(() => toStr(cmToFtIn(valueCm).feet));
  const [inches, setInches] = useState(() => toStr(cmToFtIn(valueCm).inches));

  // Re-sync the ft/in boxes when the stored value no longer matches them: a backup import, a reset, or the unit
  // being switched after the cm value was edited. Typing never triggers this because each edit emits the cm it implies.
  useEffect(() => {
    if (u !== 'ft_in') return;
    if (ftInToCm(parseFloat(feet) || 0, parseFloat(inches) || 0) === valueCm) return;
    const { feet: f, inches: i } = cmToFtIn(valueCm);
    setFeet(toStr(f));
    setInches(valueCm > 0 ? String(i) : '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [valueCm, u]);

  if (u === 'cm') {
    return (
      <Input
        type="number"
        inputMode="decimal"
        label="Height (cm)"
        mono
        value={valueCm || ''}
        error={error}
        onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
      />
    );
  }

  const emit = (f: string, i: string) => {
    onChange(f === '' && i === '' ? 0 : ftInToCm(parseFloat(f) || 0, parseFloat(i) || 0));
  };

  return (
    <fieldset className="min-w-0">
      <legend className="text-xs font-medium text-zinc-300 mb-1.5">Height (ft / in)</legend>
      <div className="grid grid-cols-2 gap-2">
        <Input
          type="number"
          inputMode="numeric"
          aria-label="Feet"
          mono
          min={0}
          max={8}
          step={1}
          placeholder="ft"
          value={feet}
          error={error ? ' ' : undefined}
          onChange={(e) => {
            setFeet(e.target.value);
            emit(e.target.value, inches);
          }}
        />
        <Input
          type="number"
          inputMode="decimal"
          aria-label="Inches"
          mono
          min={0}
          max={11.9}
          step={0.5}
          placeholder="in"
          value={inches}
          error={error ? ' ' : undefined}
          onChange={(e) => {
            setInches(e.target.value);
            emit(feet, e.target.value);
          }}
        />
      </div>
      {error && (
        <p role="alert" className="text-label text-danger mt-1.5">
          {error}
        </p>
      )}
    </fieldset>
  );
};
