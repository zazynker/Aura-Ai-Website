import React, { useEffect, useMemo, useState } from 'react';

interface QuickUseNumberControlProps {
  label?: string;
  max?: number;
  min?: number;
  onChange?: (value: number) => void;
  step?: number;
  value?: number | null;
}

const isFiniteNumber = (value: number | null | undefined): value is number => (
  typeof value === 'number' && Number.isFinite(value)
);

export const QuickUseNumberControl = ({
  label,
  max,
  min,
  onChange,
  step,
  value,
}: QuickUseNumberControlProps) => {
  const hasRange = isFiniteNumber(min) && isFiniteNumber(max) && max > min;
  const fallbackValue = hasRange ? min : 0;
  const externalValue = isFiniteNumber(value) ? value : fallbackValue;
  const [previewValue, setPreviewValue] = useState(externalValue);

  useEffect(() => {
    setPreviewValue(externalValue);
  }, [externalValue]);

  const currentValue = onChange ? externalValue : previewValue;
  const suffix = useMemo(() => (
    /duration|video length/i.test(label || '') ? 's' : ''
  ), [label]);

  if (!hasRange) return null;

  return (
    <div className="rounded-xl border border-slate-200 bg-white px-3 py-3 dark:border-slate-700 dark:bg-slate-900">
      <div className="mb-2 flex items-center justify-between text-xs text-slate-400">
        <span>{min}{suffix}</span>
        <span className="font-semibold text-purple-600 dark:text-purple-300">{currentValue}{suffix}</span>
        <span>{max}{suffix}</span>
      </div>
      <input
        type="range"
        aria-label={label || 'Numeric value'}
        className="h-2 w-full cursor-pointer accent-purple-600"
        min={min}
        max={max}
        step={isFiniteNumber(step) && step > 0 ? step : 1}
        value={currentValue}
        onChange={(event) => {
          const nextValue = Number(event.target.value);
          if (onChange) onChange(nextValue);
          else setPreviewValue(nextValue);
        }}
      />
    </div>
  );
};
