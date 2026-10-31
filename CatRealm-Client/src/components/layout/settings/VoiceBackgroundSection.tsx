import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus, Trash2, Upload } from 'lucide-react';
import {
  useSettingsStore,
  VOICE_BG_MAX_COLORS,
  type VoiceBgMode,
  type VoiceBgPattern,
  type VoiceBgScene,
} from '../../../stores/settingsStore';
import { VoiceBgSceneLayer } from '../../voice/VoiceBgSceneLayer';
import {
  VOICE_BG_ACCEPT,
  VOICE_BG_PRESETS,
  buildVoiceBackgroundCss,
  clearVoiceBackgroundFile,
  getVoiceBackgroundAnimation,
  isVideoBackground,
  loadVoiceBackgroundFile,
  saveVoiceBackgroundFile,
} from '../../../lib/voiceCallBackground';

const MAX_FILE_BYTES = 100 * 1024 * 1024; // 100 MB

const PATTERNS: VoiceBgPattern[] = ['radial', 'linear', 'diagonal', 'stripes', 'mesh'];

/** Appearance → server voice call background (colors/pattern or local file). */
export function VoiceBackgroundSection() {
  const { t } = useTranslation();
  const mode = useSettingsStore((s) => s.voiceBgMode);
  const colors = useSettingsStore((s) => s.voiceBgColors);
  const pattern = useSettingsStore((s) => s.voiceBgPattern);
  const animated = useSettingsStore((s) => s.voiceBgAnimated);
  const imageUpdatedAt = useSettingsStore((s) => s.voiceBgImageUpdatedAt);
  const setMode = useSettingsStore((s) => s.setVoiceBgMode);
  const setColors = useSettingsStore((s) => s.setVoiceBgColors);
  const setPattern = useSettingsStore((s) => s.setVoiceBgPattern);
  const setAnimated = useSettingsStore((s) => s.setVoiceBgAnimated);
  const scene = useSettingsStore((s) => s.voiceBgScene);
  const setScene = useSettingsStore((s) => s.setVoiceBgScene);
  const setImageUpdatedAt = useSettingsStore((s) => s.setVoiceBgImageUpdatedAt);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [storedFile, setStoredFile] = useState<{ name: string; url: string; isVideo: boolean } | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let objectUrl: string | null = null;
    void loadVoiceBackgroundFile().then((stored) => {
      if (cancelled) return;
      if (!stored) {
        setStoredFile(null);
        return;
      }
      objectUrl = URL.createObjectURL(stored.blob);
      setStoredFile({ name: stored.name, url: objectUrl, isVideo: isVideoBackground(stored.type) });
    });
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [imageUpdatedAt]);

  const handleFilePicked = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (file.size > MAX_FILE_BYTES) {
      setFileError(t('settingsContent.voiceBgFileTooLarge'));
      return;
    }
    setFileError(null);
    await saveVoiceBackgroundFile(file);
    setImageUpdatedAt(Date.now());
    setMode('image');
  };

  const handleRemoveFile = async () => {
    await clearVoiceBackgroundFile();
    setImageUpdatedAt(Date.now());
    if (mode === 'image') setMode('default');
  };

  const updateColor = (index: number, value: string) => {
    const next = [...colors];
    next[index] = value;
    setColors(next);
  };

  const modeOptions: { id: VoiceBgMode; label: string; desc: string }[] = [
    { id: 'default', label: t('settingsContent.voiceBgModeDefault'), desc: t('settingsContent.voiceBgModeDefaultDesc') },
    { id: 'colors', label: t('settingsContent.voiceBgModeColors'), desc: t('settingsContent.voiceBgModeColorsDesc') },
    { id: 'image', label: t('settingsContent.voiceBgModeImage'), desc: t('settingsContent.voiceBgModeImageDesc') },
  ];

  return (
    <div className="space-y-4 bg-bg-hover/30 p-4 rounded-lg">
      <div>
        <p className="text-sm font-medium text-text-primary">{t('settingsContent.voiceBgTitle')}</p>
        <p className="text-xs text-text-muted">{t('settingsContent.voiceBgDesc')}</p>
      </div>

      {/* Live preview */}
      <div className="relative h-28 overflow-hidden rounded-lg border border-border">
        {mode === 'image' && storedFile ? (
          storedFile.isVideo ? (
            <video src={storedFile.url} autoPlay loop muted playsInline className="h-full w-full object-cover" />
          ) : (
            <img src={storedFile.url} alt="" className="h-full w-full object-cover" />
          )
        ) : mode === 'colors' ? (
          (() => {
            const animation = animated
              ? getVoiceBackgroundAnimation(colors, pattern)
              : { className: '', style: {} };
            return (
              <>
                <div
                  className={`absolute inset-0 ${animation.className}`}
                  style={{ background: buildVoiceBackgroundCss(colors, pattern), ...animation.style }}
                />
                {scene && <VoiceBgSceneLayer scene={scene} colors={colors} animated={animated} />}
              </>
            );
          })()
        ) : (
          <div
            className="h-full w-full"
            style={{ background: 'radial-gradient(circle at 20% 0%, #3a418f 0%, #23274f 45%, #16182d 100%)' }}
          />
        )}
        <span className="absolute bottom-1.5 left-2 rounded bg-black/50 px-1.5 py-0.5 text-[10px] font-medium text-white/80">
          {t('settingsContent.voiceBgPreview')}
        </span>
      </div>

      <div className="space-y-2">
        {modeOptions.map((opt) => (
          <label
            key={opt.id}
            className="flex items-center gap-3 p-3 rounded border border-border cursor-pointer hover:bg-bg-hover/50 transition-colors"
          >
            <input
              type="radio"
              name="voiceBgMode"
              checked={mode === opt.id}
              onChange={() => setMode(opt.id)}
              className="w-4 h-4"
            />
            <div className="flex-1">
              <p className="text-sm font-medium text-text-primary">{opt.label}</p>
              <p className="text-xs text-text-muted">{opt.desc}</p>
            </div>
          </label>
        ))}
      </div>

      {mode === 'colors' && (
        <div className="space-y-3 rounded border border-border p-3">
          <div>
            <p className="mb-1.5 text-xs text-text-muted">{t('settingsContent.voiceBgPresets')}</p>
            <div className="flex flex-wrap gap-1.5">
              {VOICE_BG_PRESETS.map((preset) => {
                const active = preset.colors.length === colors.length
                  && preset.colors.every((c, i) => c.toLowerCase() === colors[i]?.toLowerCase());
                return (
                  <button
                    key={preset.id}
                    type="button"
                    onClick={() => {
                      setColors([...preset.colors]);
                      setScene(preset.scene ?? null);
                    }}
                    className={`overflow-hidden rounded-lg border-2 transition-colors ${
                      active ? 'border-accent' : 'border-border hover:border-text-muted'
                    }`}
                    title={preset.name}
                    aria-pressed={active}
                  >
                    <span
                      className="block h-8 w-16"
                      style={{ background: buildVoiceBackgroundCss(preset.colors, 'diagonal') }}
                    />
                    <span className="block px-1 py-0.5 text-center text-[10px] text-text-secondary">
                      {preset.name}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {colors.map((color, index) => (
              <div key={index} className="flex items-center gap-1 rounded-lg border border-border bg-bg-input px-1.5 py-1">
                <input
                  type="color"
                  value={color}
                  onChange={(e) => updateColor(index, e.target.value)}
                  className="h-7 w-9 cursor-pointer rounded border-none bg-transparent p-0"
                  aria-label={`${t('settingsContent.voiceBgColor')} ${index + 1}`}
                />
                <span className="font-mono text-[11px] text-text-muted">{color.toUpperCase()}</span>
                {colors.length > 1 && (
                  <button
                    type="button"
                    onClick={() => setColors(colors.filter((_, i) => i !== index))}
                    className="flex h-5 w-5 items-center justify-center rounded text-text-muted transition-colors hover:bg-danger/10 hover:text-danger"
                    aria-label={`${t('settingsContent.voiceBgRemoveColor')} ${index + 1}`}
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                )}
              </div>
            ))}
            {colors.length < VOICE_BG_MAX_COLORS && (
              <button
                type="button"
                onClick={() => setColors([...colors, '#7c3aed'])}
                className="flex h-9 items-center gap-1 rounded-lg border border-dashed border-border px-2.5 text-xs text-text-secondary transition-colors hover:bg-bg-hover hover:text-text-primary"
              >
                <Plus className="h-3.5 w-3.5" />
                {t('settingsContent.voiceBgAddColor')}
              </button>
            )}
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-sm font-medium text-text-primary">{t('settingsContent.voiceBgAnimated')}</p>
                <p className="text-xs text-text-muted">{t('settingsContent.voiceBgAnimatedDesc')}</p>
              </div>
              <label className="inline-flex items-center cursor-pointer shrink-0">
                <input
                  type="checkbox"
                  checked={animated}
                  onChange={(e) => setAnimated(e.target.checked)}
                  className="sr-only"
                />
                <span className={`w-12 h-6 rounded-full transition-colors ${animated ? 'bg-accent' : 'bg-bg-hover'} relative`}>
                  <span className={`absolute top-1 ${animated ? 'left-7' : 'left-1'} w-4 h-4 rounded-full bg-white transition-all`} />
                </span>
              </label>
            </div>
            {animated && (
              <p className="text-xs text-warning flex items-start gap-1.5">
                <span aria-hidden="true">⚠</span>
                <span>{t('settingsContent.voiceBgAnimatedWarning')}</span>
              </p>
            )}
          </div>

          <div>
            <p className="mb-1.5 text-xs text-text-muted">{t('settingsContent.voiceBgScene')}</p>
            <div className="flex flex-wrap gap-1.5">
              {([null, 'rings', 'orbit', 'particles', 'pixels'] as (VoiceBgScene | null)[]).map((s) => (
                <button
                  key={s ?? 'none'}
                  type="button"
                  onClick={() => setScene(s)}
                  aria-pressed={scene === s}
                  className={`rounded-lg border-2 px-2.5 py-1.5 text-xs transition-colors ${
                    scene === s
                      ? 'border-accent bg-accent/10 text-text-primary'
                      : 'border-border text-text-secondary hover:border-text-muted hover:text-text-primary'
                  }`}
                >
                  {t(`settingsContent.voiceBgScene_${s ?? 'none'}`)}
                </button>
              ))}
            </div>
          </div>

          <div>
            <p className="mb-1.5 text-xs text-text-muted">{t('settingsContent.voiceBgPattern')}</p>
            <div className="flex flex-wrap gap-1.5">
              {PATTERNS.map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => setPattern(p)}
                  className={`overflow-hidden rounded-lg border-2 transition-colors ${
                    pattern === p ? 'border-accent' : 'border-border hover:border-text-muted'
                  }`}
                  title={t(`settingsContent.voiceBgPattern_${p}`)}
                  aria-label={t(`settingsContent.voiceBgPattern_${p}`)}
                  aria-pressed={pattern === p}
                >
                  <span
                    className="block h-10 w-16"
                    style={{ background: buildVoiceBackgroundCss(colors, p) }}
                  />
                  <span className="block px-1 py-0.5 text-center text-[10px] text-text-secondary">
                    {t(`settingsContent.voiceBgPattern_${p}`)}
                  </span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {mode === 'image' && (
        <div className="space-y-2 rounded border border-border p-3">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="flex items-center gap-1.5 rounded border border-border px-3 py-2 text-sm text-text-secondary transition-colors hover:bg-bg-hover hover:text-text-primary"
            >
              <Upload className="h-4 w-4" />
              {storedFile ? t('settingsContent.voiceBgReplaceFile') : t('settingsContent.voiceBgUploadFile')}
            </button>
            {storedFile && (
              <button
                type="button"
                onClick={() => void handleRemoveFile()}
                className="flex items-center gap-1.5 rounded border border-border px-3 py-2 text-sm text-text-secondary transition-colors hover:bg-danger/10 hover:text-danger"
              >
                <Trash2 className="h-4 w-4" />
                {t('settingsContent.voiceBgRemoveFile')}
              </button>
            )}
            <input
              ref={fileInputRef}
              type="file"
              accept={VOICE_BG_ACCEPT}
              className="hidden"
              onChange={(e) => void handleFilePicked(e)}
            />
          </div>
          {storedFile && (
            <p className="truncate text-xs text-text-muted">{storedFile.name}</p>
          )}
          {fileError && <p className="text-xs text-danger">{fileError}</p>}
          <p className="text-xs text-warning flex items-start gap-1.5">
            <span aria-hidden="true">ⓘ</span>
            <span>{t('settingsContent.voiceBgLocalOnly')}</span>
          </p>
        </div>
      )}
    </div>
  );
}
