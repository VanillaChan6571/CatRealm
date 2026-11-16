import { useRef, useState } from 'react';
import { ImagePlus, Plus, X } from 'lucide-react';
import { createApi } from '../../lib/api';
import { VOICE_BG_PRESETS, buildVoiceBackgroundCss } from '../../lib/voiceCallBackground';
import type { VoiceBgPattern, VoiceBgScene } from '../../stores/settingsStore';
import { apiErrorMessage, useWorkItemStore, workItemBasePath, type WorkKind } from '../../stores/workItemStore';
import type { BoardBackground, WorkChannelSettings } from '../../types';
import { Button } from '../ui/Button';
import { Modal } from '../ui/Modal';
import { WorkChannelBackdrop } from './WorkChannelBackdrop';
import { fieldClass } from './workItemUtils';

const TITLE_MAX = 100;
const MAX_COLORS = 6;
const PATTERNS: Array<{ value: VoiceBgPattern; label: string }> = [
  { value: 'radial', label: 'Radial' },
  { value: 'linear', label: 'Linear' },
  { value: 'diagonal', label: 'Diagonal' },
  { value: 'stripes', label: 'Stripes' },
  { value: 'mesh', label: 'Mesh' },
];
const SCENES: Array<{ value: VoiceBgScene | null; label: string }> = [
  { value: null, label: 'None' },
  { value: 'rings', label: 'Rings' },
  { value: 'orbit', label: 'Orbit' },
  { value: 'particles', label: 'Particles' },
  { value: 'pixels', label: 'Pixels' },
];
type Kind = 'none' | 'pattern' | 'image';

/**
 * A Tracker or Board channel's title and background. Managers only; the realm server enforces that.
 * Backgrounds use the same colour patterns as voice calls, or an uploaded image.
 */
export function WorkChannelSettingsModal({ kind: channelKind, channelId, channelName, settings, serverUrl, onClose }: {
  kind: WorkKind;
  channelId: string;
  channelName: string;
  settings: WorkChannelSettings;
  serverUrl: string | null;
  onClose: () => void;
}) {
  const initial = settings.background;
  const defaultImageX = channelKind === 'board' ? 25 : 50;
  const [syncTitle, setSyncTitle] = useState(settings.title === null);
  const [title, setTitle] = useState(settings.title ?? channelName);
  const [kind, setKind] = useState<Kind>(initial?.kind ?? 'none');
  const [colors, setColors] = useState<string[]>(initial?.kind === 'pattern' ? initial.colors : VOICE_BG_PRESETS[1].colors);
  const [pattern, setPattern] = useState<VoiceBgPattern>(initial?.kind === 'pattern' ? initial.pattern : 'mesh');
  const [animated, setAnimated] = useState(initial?.kind === 'pattern' ? initial.animated : true);
  const [scene, setScene] = useState<VoiceBgScene | null>(initial?.kind === 'pattern' ? initial.scene ?? null : null);
  const [image, setImage] = useState<string | null>(initial?.kind === 'image' ? initial.image : null);
  const [fitImage, setFitImage] = useState(initial?.kind === 'image' ? initial.fit ?? false : false);
  const [stretchImage, setStretchImage] = useState(initial?.kind === 'image' ? initial.stretch ?? false : false);
  const [imageX, setImageX] = useState(initial?.kind === 'image' ? initial.positionX ?? defaultImageX : defaultImageX);
  const [imageY, setImageY] = useState(initial?.kind === 'image' ? initial.positionY ?? 50 : 50);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  const background: BoardBackground | null = kind === 'pattern'
    ? { kind: 'pattern', colors, pattern, animated, scene }
    : kind === 'image' && image ? { kind: 'image', image, fit: fitImage, stretch: stretchImage, positionX: imageX, positionY: imageY } : null;

  const upload = async (file: File) => {
    setUploading(true);
    try {
      const form = new FormData();
      form.append('file', file);
      form.append('channelId', channelId);
      form.append('purpose', `${channelKind}-background`);
      const res = await createApi().post<{ url: string }>('/api/uploads/chat', form, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      setImage(res.data.url);
      setError('');
    } catch (err) {
      setError(apiErrorMessage(err, 'Failed to upload background'));
    } finally {
      setUploading(false);
    }
  };

  const save = async () => {
    if (kind === 'image' && !image) { setError('Choose an image, or pick another background.'); return; }
    setSaving(true);
    try {
      const res = await createApi().patch<WorkChannelSettings>(`${workItemBasePath(channelKind, channelId)}/settings`, {
        title: syncTitle ? null : title.trim() || null,
        background,
      });
      if (channelKind === 'board') useWorkItemStore.getState().setBoardSettings(channelId, res.data);
      else useWorkItemStore.getState().setTrackerSettings(channelId, res.data);
      onClose();
    } catch (err) {
      setError(apiErrorMessage(err, 'Failed to save channel settings'));
      setSaving(false);
    }
  };

  const kindButton = (value: Kind, label: string) => (
    <button
      type="button"
      aria-pressed={kind === value}
      onClick={() => setKind(value)}
      className={`flex-1 border-l border-border px-3 py-1.5 text-sm transition-colors first:border-l-0 ${kind === value ? 'bg-accent/20 font-semibold text-text-primary' : 'text-text-muted hover:bg-bg-hover hover:text-text-primary'}`}
    >
      {label}
    </button>
  );

  return (
    <Modal open onClose={onClose} title={`${channelKind === 'board' ? 'Board' : 'Tracker'} settings`}>
      <form onSubmit={(event) => { event.preventDefault(); void save(); }} className="space-y-4">
        <div>
          <span className="mb-1 block text-xs font-semibold uppercase text-text-secondary">Title</span>
          <label className="mb-2 flex cursor-pointer items-center gap-2 text-sm text-text-secondary">
            <input
              type="checkbox"
              checked={syncTitle}
              onChange={(event) => setSyncTitle(event.target.checked)}
              className="h-4 w-4 rounded border-border bg-bg-input text-accent focus:ring-0"
            />
            Sync with the channel name ({channelName})
          </label>
          <input
            value={syncTitle ? channelName : title}
            disabled={syncTitle}
            maxLength={TITLE_MAX}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="Board title"
            className={`${fieldClass} disabled:opacity-60`}
          />
        </div>

        <div>
          <span className="mb-1 block text-xs font-semibold uppercase text-text-secondary">Background</span>
          <div className="flex overflow-hidden rounded-md border border-border">
            {kindButton('none', 'None')}
            {kindButton('pattern', 'Colors')}
            {kindButton('image', 'Image')}
          </div>
        </div>

        {kind === 'pattern' && (
          <div className="space-y-3">
            <span className="block text-xs text-text-muted">Presets</span>
            <div className="flex flex-wrap gap-1.5">
              {VOICE_BG_PRESETS.map((preset) => {
                const active = preset.colors.length === colors.length
                  && preset.colors.every((color, index) => color.toLowerCase() === colors[index]?.toLowerCase())
                  && (preset.scene ?? null) === scene;
                return (
                  <button
                    key={preset.id}
                    type="button"
                    onClick={() => { setColors([...preset.colors]); setScene(preset.scene ?? null); }}
                    title={preset.name}
                    aria-pressed={active}
                    className={`overflow-hidden rounded-lg border-2 transition-colors ${active ? 'border-accent' : 'border-border hover:border-text-muted'}`}
                  >
                    <span className="block h-8 w-16" style={{ background: buildVoiceBackgroundCss(preset.colors, 'diagonal') }} />
                    <span className="block px-1 py-0.5 text-center text-[10px] text-text-secondary">{preset.name}</span>
                  </button>
                );
              })}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {colors.map((color, index) => (
                <span key={index} className="relative">
                  <input
                    type="color"
                    value={color}
                    onChange={(event) => setColors(colors.map((c, i) => (i === index ? event.target.value : c)))}
                    className="h-8 w-10 cursor-pointer rounded border border-border bg-transparent p-0.5"
                    aria-label={`Color ${index + 1}`}
                  />
                  {colors.length > 1 && (
                    <button
                      type="button"
                      onClick={() => setColors(colors.filter((_, i) => i !== index))}
                      className="absolute -right-1.5 -top-1.5 rounded-full bg-bg-elevated p-0.5 text-text-muted shadow hover:text-danger"
                      aria-label={`Remove color ${index + 1}`}
                    >
                      <X className="h-3 w-3" />
                    </button>
                  )}
                </span>
              ))}
              {colors.length < MAX_COLORS && (
                <button
                  type="button"
                  onClick={() => setColors([...colors, colors[colors.length - 1]])}
                  className="flex h-8 w-10 items-center justify-center rounded border border-dashed border-border text-text-muted hover:border-accent/60 hover:text-text-primary"
                  aria-label="Add a color"
                >
                  <Plus className="h-4 w-4" />
                </button>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <select value={pattern} onChange={(event) => setPattern(event.target.value as VoiceBgPattern)} className={`${fieldClass} w-40`}>
                {PATTERNS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
              <label className="flex cursor-pointer items-center gap-2 text-sm text-text-secondary">
                <input
                  type="checkbox"
                  checked={animated}
                  onChange={(event) => setAnimated(event.target.checked)}
                  className="h-4 w-4 rounded border-border bg-bg-input text-accent focus:ring-0"
                />
                Animated
              </label>
            </div>
            <div>
              <span className="mb-1.5 block text-xs text-text-muted">Scene</span>
              <div className="flex flex-wrap gap-1.5">
                {SCENES.map((option) => (
                  <button
                    key={option.value ?? 'none'}
                    type="button"
                    onClick={() => setScene(option.value)}
                    aria-pressed={scene === option.value}
                    className={`rounded-lg border-2 px-2.5 py-1.5 text-xs transition-colors ${scene === option.value
                      ? 'border-accent bg-accent/10 text-text-primary'
                      : 'border-border text-text-secondary hover:border-text-muted hover:text-text-primary'}`}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {kind === 'image' && (
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <Button type="button" size="sm" variant="secondary" disabled={uploading} onClick={() => fileRef.current?.click()} className="flex items-center gap-1.5">
                <ImagePlus className="h-4 w-4" /> {uploading ? 'Uploading…' : image ? 'Replace image' : 'Upload image'}
              </Button>
              <span className="text-xs text-text-muted">The preview shows how the image will appear behind the content.</span>
            </div>
            <input
              ref={fileRef}
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif"
              className="hidden"
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = '';
                if (file) void upload(file);
              }}
            />
            <label className="flex cursor-pointer items-start gap-2 text-sm text-text-secondary">
              <input
                type="checkbox"
                checked={fitImage}
                onChange={(event) => { setFitImage(event.target.checked); if (event.target.checked) setStretchImage(false); }}
                className="mt-0.5 h-4 w-4 rounded border-border bg-bg-input text-accent focus:ring-0"
              />
              <span>Fit entire image <span className="block text-xs text-text-muted">Resizes with the window without cropping.</span></span>
            </label>
            <label className="flex cursor-pointer items-start gap-2 text-sm text-text-secondary">
              <input
                type="checkbox"
                checked={stretchImage}
                onChange={(event) => { setStretchImage(event.target.checked); if (event.target.checked) setFitImage(false); }}
                className="mt-0.5 h-4 w-4 rounded border-border bg-bg-input text-accent focus:ring-0"
              />
              <span>Stretch to fill <span className="block text-xs text-text-muted">Fills the channel as it resizes; the image may change proportions.</span></span>
            </label>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className={`text-xs text-text-secondary ${stretchImage ? 'opacity-50' : ''}`}>
                <span className="mb-1 flex justify-between"><span>Horizontal position</span><span>{imageX}%</span></span>
                <input type="range" min="0" max="100" value={imageX} disabled={stretchImage} onChange={(event) => setImageX(Number(event.target.value))} className="w-full accent-accent" />
              </label>
              <label className={`text-xs text-text-secondary ${stretchImage ? 'opacity-50' : ''}`}>
                <span className="mb-1 flex justify-between"><span>Vertical position</span><span>{imageY}%</span></span>
                <input type="range" min="0" max="100" value={imageY} disabled={stretchImage} onChange={(event) => setImageY(Number(event.target.value))} className="w-full accent-accent" />
              </label>
            </div>
          </div>
        )}

        {kind !== 'none' && (
          <div className="relative h-28 overflow-hidden rounded-lg border border-border bg-bg-chat">
            <WorkChannelBackdrop background={background} serverUrl={serverUrl} defaultImagePositionX={defaultImageX} />
            <div className="relative flex h-full items-start gap-2 p-2">
              {[3, 2].map((count, index) => (
                <div key={index} className="w-20 space-y-1 rounded bg-bg-elevated p-1.5">
                  {Array.from({ length: count }, (_, i) => <div key={i} className="h-3 rounded-sm bg-bg-chat" />)}
                </div>
              ))}
            </div>
          </div>
        )}

        {error && <p className="text-sm text-danger">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={saving || uploading}>{saving ? 'Saving…' : 'Save'}</Button>
        </div>
      </form>
    </Modal>
  );
}
