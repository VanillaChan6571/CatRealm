import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Trash2 } from 'lucide-react';
import { useOverlayParticipants } from '../../../lib/overlayParticipants';
import {
  REACTIVE_AVATAR_MOTIONS,
  REACTIVE_AVATAR_STATES,
  useReactiveAvatarStore,
  type ReactiveAvatarMotion,
  type ReactiveAvatarState,
} from '../../../stores/reactiveAvatarStore';
import { ReactiveStateSlot } from './ReactiveStateSlot';
import { MOTION_LABEL_KEYS } from './reactiveAvatarLabels';

function PersonSlot({ personKey, label, state }: { personKey: string; label: string; state: ReactiveAvatarState }) {
  const imageId = useReactiveAvatarStore((s) => s.overrides[personKey]?.images[state]);
  const setImage = useReactiveAvatarStore((s) => s.setImage);
  const clearImage = useReactiveAvatarStore((s) => s.clearImage);
  return (
    <ReactiveStateSlot
      state={state}
      imageId={imageId}
      onSave={(id) => setImage(personKey, label, state, id)}
      onClear={() => clearImage(personKey, state)}
    />
  );
}

function PersonRow({ personKey, label, avatarUrl }: { personKey: string; label: string; avatarUrl: string | null }) {
  const { t } = useTranslation();
  const motion = useReactiveAvatarStore((s) => s.overrides[personKey]?.motion ?? 'bounce');
  const hasOverride = useReactiveAvatarStore((s) => !!s.overrides[personKey]);
  const setMotion = useReactiveAvatarStore((s) => s.setMotion);
  const removeOverride = useReactiveAvatarStore((s) => s.removeOverride);

  return (
    <div className="bg-bg-hover/30 p-3 rounded-lg space-y-3">
      <div className="flex items-center gap-2">
        {avatarUrl
          ? <img src={avatarUrl} alt="" className="w-6 h-6 rounded-full object-cover" />
          : <div className="w-6 h-6 rounded-full bg-bg-hover" />}
        <span className="text-sm font-medium text-text-primary truncate flex-1">{label}</span>
        <select
          value={motion}
          onChange={(e) => setMotion(personKey, label, e.target.value as ReactiveAvatarMotion)}
          aria-label={t('settingsContent.reactiveMotion')}
          title={t('settingsContent.reactiveMotion')}
          className="bg-bg-input border border-border rounded px-2 py-1 text-xs text-text-primary focus:outline-none focus:border-accent"
        >
          {REACTIVE_AVATAR_MOTIONS.map((m) => (
            <option key={m} value={m}>{t(MOTION_LABEL_KEYS[m])}</option>
          ))}
        </select>
        {hasOverride && (
          <button
            type="button"
            onClick={() => removeOverride(personKey)}
            title={t('settingsContent.reactiveRemove')}
            aria-label={t('settingsContent.reactiveRemove')}
            className="p-1.5 rounded text-text-muted hover:text-danger hover:bg-bg-hover transition-colors"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        )}
      </div>
      <div className="flex flex-wrap gap-2">
        {REACTIVE_AVATAR_STATES.map((state) => (
          <PersonSlot key={state} personKey={personKey} label={label} state={state} />
        ))}
      </div>
    </div>
  );
}

/** Cat Lab → OBS overlay: per-person reactive avatar setup. */
export function ReactiveAvatarsPanel() {
  const { t } = useTranslation();
  const { users } = useOverlayParticipants();
  const overrides = useReactiveAvatarStore((s) => s.overrides);

  const inCallKeys = useMemo(() => new Set(users.map((u) => u.key)), [users]);
  const saved = useMemo(
    () => Object.values(overrides)
      .filter((o) => !inCallKeys.has(o.key))
      .sort((a, b) => b.updatedAt - a.updatedAt),
    [overrides, inCallKeys],
  );

  if (!window.electron?.reactiveAvatarSaveImage) {
    return <p className="text-xs text-text-muted">{t('settingsContent.reactiveDesktopOnly')}</p>;
  }

  return (
    <div className="space-y-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-text-muted">{t('settingsContent.reactiveInCall')}</p>
      {users.length === 0
        ? <p className="text-xs text-text-muted">{t('settingsContent.reactiveEmpty')}</p>
        : users.map((u) => <PersonRow key={u.key} personKey={u.key} label={u.username} avatarUrl={u.avatarUrl} />)}
      {saved.length > 0 && (
        <>
          <p className="text-xs font-semibold uppercase tracking-wide text-text-muted pt-2">{t('settingsContent.reactiveSaved')}</p>
          {saved.map((o) => <PersonRow key={o.key} personKey={o.key} label={o.label} avatarUrl={null} />)}
        </>
      )}
    </div>
  );
}
