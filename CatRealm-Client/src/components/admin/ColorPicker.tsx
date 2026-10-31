import { useState, useEffect } from 'react';

export const DEFAULT_SWATCHES = [
  '#99AAB5', '#95A5A6', '#7F8C8D', '#2C3E50',
  '#E74C3C', '#C0392B', '#E67E22', '#D35400',
  '#F1C40F', '#F39C12', '#2ECC71', '#27AE60',
  '#1ABC9C', '#16A085', '#3498DB', '#2980B9',
  '#9B59B6', '#8E44AD', '#E84393', '#FD79A8',
];

function isValidHex(v: string) {
  return /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(v.trim());
}

function normalizeHex(v: string): string {
  const t = v.trim().toLowerCase();
  if (/^#[0-9a-f]{3}$/.test(t)) {
    return `#${t[1]}${t[1]}${t[2]}${t[2]}${t[3]}${t[3]}`;
  }
  return t;
}

function hexToHsl(hex: string): [number, number, number] {
  const norm = normalizeHex(hex);
  const r = parseInt(norm.slice(1, 3), 16) / 255;
  const g = parseInt(norm.slice(3, 5), 16) / 255;
  const b = parseInt(norm.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let h = 0;
  let s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = ((g - b) / d + (g < b ? 6 : 0)) / 6; break;
      case g: h = ((b - r) / d + 2) / 6; break;
      case b: h = ((r - g) / d + 4) / 6; break;
    }
  }
  return [Math.round(h * 360), Math.round(s * 100), Math.round(l * 100)];
}

function hslToHex(h: number, s: number, l: number): string {
  const sn = s / 100;
  const ln = l / 100;
  const a = sn * Math.min(ln, 1 - ln);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    const color = ln - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
    return Math.round(255 * color).toString(16).padStart(2, '0');
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

interface ColorPickerProps {
  value: string;
  onChange: (hex: string) => void;
  swatches?: string[];
}

export function ColorPicker({ value, onChange, swatches = DEFAULT_SWATCHES }: ColorPickerProps) {
  const [tab, setTab] = useState<'presets' | 'picker'>('presets');
  const [hexInput, setHexInput] = useState(value);
  const [hsl, setHsl] = useState<[number, number, number]>(() =>
    isValidHex(value) ? hexToHsl(value) : [210, 10, 60]
  );

  useEffect(() => {
    setHexInput(value);
    if (isValidHex(value)) setHsl(hexToHsl(value));
  }, [value]);

  const [h, s, l] = hsl;

  const applyHsl = (nh: number, ns: number, nl: number) => {
    const hex = hslToHex(nh, ns, nl);
    setHsl([nh, ns, nl]);
    setHexInput(hex);
    onChange(hex);
  };

  const handleHexInput = (v: string) => {
    setHexInput(v);
    if (isValidHex(v)) {
      const norm = normalizeHex(v);
      setHsl(hexToHsl(norm));
      onChange(norm);
    }
  };

  const sliderThumbCss = `
    [&::-webkit-slider-thumb]:appearance-none
    [&::-webkit-slider-thumb]:w-4
    [&::-webkit-slider-thumb]:h-4
    [&::-webkit-slider-thumb]:rounded-full
    [&::-webkit-slider-thumb]:bg-white
    [&::-webkit-slider-thumb]:border-2
    [&::-webkit-slider-thumb]:border-gray-400
    [&::-webkit-slider-thumb]:cursor-pointer
    [&::-webkit-slider-thumb]:shadow
    [&::-moz-range-thumb]:w-4
    [&::-moz-range-thumb]:h-4
    [&::-moz-range-thumb]:rounded-full
    [&::-moz-range-thumb]:bg-white
    [&::-moz-range-thumb]:border-2
    [&::-moz-range-thumb]:border-gray-400
    [&::-moz-range-thumb]:cursor-pointer
  `;

  return (
    <div>
      {/* Tabs */}
      <div className="flex border-b border-gray-700 mb-3">
        {(['presets', 'picker'] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm font-medium transition-colors border-b-2 -mb-px ${
              tab === t
                ? 'text-blue-400 border-blue-400'
                : 'text-gray-400 border-transparent hover:text-gray-200'
            }`}
          >
            {t === 'presets' ? 'Presets' : 'Color Picker'}
          </button>
        ))}
      </div>

      {tab === 'presets' && (
        <div className="grid grid-cols-5 gap-2">
          {swatches.map((sw) => (
            <button
              key={sw}
              type="button"
              onClick={() => {
                onChange(sw);
                setHexInput(sw);
                if (isValidHex(sw)) setHsl(hexToHsl(sw));
              }}
              className={`w-full aspect-square rounded border-2 hover:scale-110 transition-transform ${
                normalizeHex(value) === normalizeHex(sw)
                  ? 'border-white ring-2 ring-blue-500'
                  : 'border-gray-600 hover:border-gray-400'
              }`}
              style={{ backgroundColor: sw }}
              title={sw}
            />
          ))}
        </div>
      )}

      {tab === 'picker' && (
        <div className="space-y-4">
          {/* Hue */}
          <div>
            <div className="flex justify-between text-xs text-gray-400 mb-1.5">
              <span>Hue</span>
              <span>{h}°</span>
            </div>
            <input
              type="range" min={0} max={360} value={h}
              onChange={(e) => applyHsl(+e.target.value, s, l)}
              className={`w-full h-3 rounded-full cursor-pointer appearance-none ${sliderThumbCss}`}
              style={{
                background: 'linear-gradient(to right,hsl(0,100%,50%),hsl(30,100%,50%),hsl(60,100%,50%),hsl(90,100%,50%),hsl(120,100%,50%),hsl(150,100%,50%),hsl(180,100%,50%),hsl(210,100%,50%),hsl(240,100%,50%),hsl(270,100%,50%),hsl(300,100%,50%),hsl(330,100%,50%),hsl(360,100%,50%))',
              }}
            />
          </div>
          {/* Saturation */}
          <div>
            <div className="flex justify-between text-xs text-gray-400 mb-1.5">
              <span>Saturation</span>
              <span>{s}%</span>
            </div>
            <input
              type="range" min={0} max={100} value={s}
              onChange={(e) => applyHsl(h, +e.target.value, l)}
              className={`w-full h-3 rounded-full cursor-pointer appearance-none ${sliderThumbCss}`}
              style={{ background: `linear-gradient(to right,hsl(${h},0%,${l}%),hsl(${h},100%,${l}%))` }}
            />
          </div>
          {/* Lightness */}
          <div>
            <div className="flex justify-between text-xs text-gray-400 mb-1.5">
              <span>Lightness</span>
              <span>{l}%</span>
            </div>
            <input
              type="range" min={0} max={100} value={l}
              onChange={(e) => applyHsl(h, s, +e.target.value)}
              className={`w-full h-3 rounded-full cursor-pointer appearance-none ${sliderThumbCss}`}
              style={{ background: `linear-gradient(to right,hsl(${h},${s}%,0%),hsl(${h},${s}%,50%),hsl(${h},${s}%,100%))` }}
            />
          </div>
        </div>
      )}

      {/* Hex input + preview */}
      <div className="flex items-center gap-2 mt-4">
        <div
          className="w-8 h-8 rounded border border-gray-600 shrink-0"
          style={{ backgroundColor: isValidHex(hexInput) ? hexInput : value }}
        />
        <input
          type="text"
          value={hexInput}
          onChange={(e) => handleHexInput(e.target.value)}
          className="flex-1 px-3 py-1.5 bg-gray-950 border border-gray-700 rounded text-gray-100 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono"
          placeholder="#99AAB5"
          maxLength={7}
          spellCheck={false}
        />
      </div>
    </div>
  );
}
