import { useState } from 'react';
import { AUTO_HIDE_MAX_MINUTES, AUTO_HIDE_OPTIONS, SLOWMODE_MAX_SECONDS } from './policyOptions';

const selectClass = 'w-full rounded-md border border-border bg-bg-input px-3 py-2 text-sm text-text-primary focus:border-accent focus:outline-none disabled:opacity-50';

/** One way of deciding a value that is not typing it in: inherit, sync, and so on. */
export interface PresetChoice {
  /** The value saved for this choice (null = inherit from the level above). */
  value: number | null;
  label: string;
}

/**
 * Thread slowmode: one of the preset choices (inherit / sync), or a number of seconds.
 */
export function SlowmodeField({ value, presets, onChange, disabled = false }: {
  value: number | null;
  presets: PresetChoice[];
  onChange: (value: number | null) => void;
  disabled?: boolean;
}) {
  const preset = presets.find((choice) => choice.value === value);
  const [customSeconds, setCustomSeconds] = useState(preset ? 10 : (value ?? 10));
  const mode = preset ? `preset:${presets.indexOf(preset)}` : 'custom';

  return (
    <div className="flex flex-col gap-2">
      <select
        value={mode}
        disabled={disabled}
        onChange={(event) => {
          if (event.target.value === 'custom') onChange(customSeconds);
          else onChange(presets[Number(event.target.value.slice('preset:'.length))].value);
        }}
        className={selectClass}
      >
        {presets.map((choice, index) => <option key={index} value={`preset:${index}`}>{choice.label}</option>)}
        <option value="custom">Set a slowmode for threads…</option>
      </select>
      {mode === 'custom' && (
        <div className="flex items-center gap-2">
          <input
            type="number"
            min={0}
            max={SLOWMODE_MAX_SECONDS}
            value={value ?? customSeconds}
            disabled={disabled}
            onChange={(event) => {
              const seconds = Math.max(0, Math.min(SLOWMODE_MAX_SECONDS, Math.round(Number(event.target.value) || 0)));
              setCustomSeconds(seconds);
              onChange(seconds);
            }}
            className={`${selectClass} w-32`}
          />
          <span className="text-xs text-text-muted">seconds between messages (0 = off, max {SLOWMODE_MAX_SECONDS})</span>
        </div>
      )}
    </div>
  );
}

const UNITS = [
  { label: 'hours', minutes: 60 },
  { label: 'days', minutes: 1440 },
  { label: 'weeks', minutes: 10080 },
];

/**
 * Auto-hide time: a preset choice (inherit), one of the standard durations, or a custom one.
 */
export function AutoHideField({ value, presets = [], onChange, disabled = false }: {
  value: number | null;
  presets?: PresetChoice[];
  onChange: (value: number | null) => void;
  disabled?: boolean;
}) {
  const preset = presets.find((choice) => choice.value === value);
  const standard = value !== null && AUTO_HIDE_OPTIONS.some((option) => option.minutes === value);
  const isCustom = !preset && !standard;
  const initialUnit = value && isCustom ? ([...UNITS].reverse().find((unit) => value % unit.minutes === 0) ?? UNITS[0]) : UNITS[1];
  const [unitMinutes, setUnitMinutes] = useState(initialUnit.minutes);
  const [amount, setAmount] = useState(value && isCustom ? Math.max(1, Math.round(value / initialUnit.minutes)) : 5);
  const [customChosen, setCustomChosen] = useState(isCustom);
  const mode = customChosen || isCustom ? 'custom' : preset ? `preset:${presets.indexOf(preset)}` : `m:${value}`;

  const setCustom = (nextAmount: number, nextUnit: number) => {
    const safeAmount = Math.max(1, Math.round(nextAmount) || 1);
    setAmount(safeAmount);
    setUnitMinutes(nextUnit);
    onChange(Math.min(AUTO_HIDE_MAX_MINUTES, safeAmount * nextUnit));
  };

  return (
    <div className="flex flex-col gap-2">
      <select
        value={mode}
        disabled={disabled}
        onChange={(event) => {
          const next = event.target.value;
          if (next === 'custom') { setCustomChosen(true); setCustom(amount, unitMinutes); return; }
          setCustomChosen(false);
          if (next.startsWith('preset:')) onChange(presets[Number(next.slice('preset:'.length))].value);
          else onChange(Number(next.slice(2)));
        }}
        className={selectClass}
      >
        {presets.map((choice, index) => <option key={`p${index}`} value={`preset:${index}`}>{choice.label}</option>)}
        {AUTO_HIDE_OPTIONS.map((option) => <option key={option.minutes} value={`m:${option.minutes}`}>{option.label}</option>)}
        <option value="custom">Custom…</option>
      </select>
      {mode === 'custom' && (
        <div className="flex items-center gap-2">
          <input
            type="number"
            min={1}
            value={amount}
            disabled={disabled}
            onChange={(event) => setCustom(Number(event.target.value), unitMinutes)}
            className={`${selectClass} w-24`}
          />
          <select
            value={unitMinutes}
            disabled={disabled}
            onChange={(event) => setCustom(amount, Number(event.target.value))}
            className={`${selectClass} w-28`}
          >
            {UNITS.map((unit) => <option key={unit.minutes} value={unit.minutes}>{unit.label}</option>)}
          </select>
          <span className="text-xs text-text-muted">without a new message</span>
        </div>
      )}
    </div>
  );
}

/** A labelled on/off switch with a description; `locked` shows a reason it cannot be changed. */
export function PolicyToggle({ label, description, checked, onChange, disabled = false, locked, indent = false }: {
  label: string;
  description: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  locked?: string;
  indent?: boolean;
}) {
  const off = disabled || !!locked;
  return (
    <label className={`flex items-start justify-between gap-4 rounded-lg border border-border bg-bg-input/40 px-4 py-3 ${indent ? 'ml-6' : ''} ${off ? 'opacity-70' : 'cursor-pointer'}`}>
      <span className="min-w-0">
        <span className="block text-sm font-medium text-text-primary">{label}</span>
        <span className="block text-xs text-text-muted">{description}</span>
        {locked && <span className="mt-1 block text-xs font-medium text-accent">{locked}</span>}
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        disabled={off}
        onClick={() => onChange(!checked)}
        className={`relative mt-0.5 inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors ${checked ? 'bg-accent' : 'bg-bg-hover'} ${off ? 'cursor-not-allowed' : ''}`}
      >
        <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${checked ? 'translate-x-6' : 'translate-x-1'}`} />
      </button>
    </label>
  );
}
