import { useState } from 'react';
import { X } from 'lucide-react';
import { ColorPicker } from './ColorPicker';
import { getRoleNameStyle } from '../../lib/roleStyles';

const STYLE_TYPES = [
  { id: 'solid',    label: 'Solid' },
  { id: 'gradient', label: 'Gradient' },
  { id: 'glow',     label: 'Glow' },
  { id: 'rgb_flow', label: 'RGB Flow' },
] as const;

function parseColors(styleColors: string | null | undefined): [string, string] {
  try {
    const parsed = JSON.parse(styleColors ?? '[]');
    if (Array.isArray(parsed) && parsed.length >= 2) {
      return [parsed[0] as string, parsed[1] as string];
    }
  } catch { /* ignore */ }
  return ['#ff0000', '#0000ff'];
}

export interface AppearanceResult {
  color: string;
  style_type: string;
  style_colors: string | null;
}

interface AppearanceModalProps {
  roleName: string;
  initialColor: string;
  initialStyleType: string | null | undefined;
  initialStyleColors: string | null | undefined;
  onApply: (result: AppearanceResult) => void;
  onClose: () => void;
}

export function AppearanceModal({
  roleName,
  initialColor,
  initialStyleType,
  initialStyleColors,
  onApply,
  onClose,
}: AppearanceModalProps) {
  const [color, setColor] = useState(initialColor || '#99AAB5');
  const [styleType, setStyleType] = useState(initialStyleType ?? 'solid');
  const [gradColors, setGradColors] = useState<[string, string]>(() => parseColors(initialStyleColors));
  const [activeSlot, setActiveSlot] = useState<0 | 1>(0);

  const needsGradColors = styleType === 'gradient' || styleType === 'rgb_flow';

  const activePickerColor = needsGradColors ? gradColors[activeSlot] : color;
  const handlePickerChange = (hex: string) => {
    if (needsGradColors) {
      setGradColors((prev) => {
        const next: [string, string] = [...prev] as [string, string];
        next[activeSlot] = hex;
        return next;
      });
    } else {
      setColor(hex);
    }
  };

  const handleApply = () => {
    onApply({
      color,
      style_type: styleType,
      style_colors: needsGradColors ? JSON.stringify(gradColors) : null,
    });
  };

  // Build style_colors string for live preview
  const previewStyleColors = needsGradColors ? JSON.stringify(gradColors) : null;

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-xl border border-gray-700 bg-gray-900 shadow-2xl flex flex-col max-h-[90vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-700 shrink-0">
          <h3 className="text-lg font-semibold text-gray-100">Role Appearance</h3>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded hover:bg-gray-800 text-gray-400 hover:text-gray-200 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="overflow-y-auto flex-1 p-5 space-y-5">
          {/* Style type selector */}
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wide text-gray-400 mb-2">
              Name Style
            </label>
            <div className="flex gap-2 flex-wrap">
              {STYLE_TYPES.map(({ id, label }) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setStyleType(id)}
                  className={`px-3 py-1.5 rounded text-sm border transition-colors ${
                    styleType === id
                      ? 'bg-blue-600 border-blue-500 text-white'
                      : 'bg-gray-800 border-gray-700 text-gray-300 hover:bg-gray-700'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {/* Gradient / RGB Flow: two colour slots */}
          {needsGradColors && (
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wide text-gray-400 mb-2">
                Gradient Colors
              </label>
              <div className="flex gap-3 mb-3">
                {([0, 1] as const).map((slot) => (
                  <button
                    key={slot}
                    type="button"
                    onClick={() => setActiveSlot(slot)}
                    className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-sm transition-colors flex-1 ${
                      activeSlot === slot
                        ? 'border-blue-500 bg-blue-600/10 text-blue-300'
                        : 'border-gray-700 bg-gray-800 text-gray-400 hover:bg-gray-700'
                    }`}
                  >
                    <span
                      className="w-5 h-5 rounded border border-gray-600 shrink-0"
                      style={{ backgroundColor: gradColors[slot] }}
                    />
                    <span>Color {slot + 1}</span>
                    <span className="font-mono text-xs ml-auto opacity-70">{gradColors[slot]}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Solid / Glow: label for single color */}
          {!needsGradColors && (
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wide text-gray-400 mb-2">
                {styleType === 'glow' ? 'Glow Color' : 'Role Color'}
              </label>
            </div>
          )}

          {/* Color picker (shared for active slot or main color) */}
          <ColorPicker value={activePickerColor} onChange={handlePickerChange} />

          {/* Live preview */}
          <div className="rounded-lg bg-gray-800/60 border border-gray-700 px-4 py-3 flex items-center gap-3">
            <span className="text-xs text-gray-400 shrink-0">Preview</span>
            <span
              className="font-semibold text-sm"
              style={getRoleNameStyle(color, styleType, previewStyleColors)}
            >
              {roleName || 'Role Name'}
            </span>
          </div>
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-2 px-5 py-4 border-t border-gray-700 shrink-0">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-gray-200 rounded-lg font-medium transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleApply}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium transition-colors"
          >
            Apply
          </button>
        </div>
      </div>
    </div>
  );
}
