import { useEffect, useState } from 'react';
import { createApi } from '../../lib/api';
import { Button } from '../ui/Button';
import { AutoHideField, PolicyToggle, SlowmodeField, type PresetChoice } from './PolicyFields';
import {
  AUTO_HIDE_DEFAULT_MINUTES, SYNC_WITH_CHANNEL, formatMinutes, formatSeconds, policyErrorText,
  type CategoryPolicy, type ChannelPolicy, type MediaFlag, type MediaFlags,
} from './policyOptions';

type Scope = 'channel' | 'category';

// What the two tabs need from either level, in one shape.
interface Loaded {
  threadSlowmode: number | null;
  threadAutoHideMinutes: number | null;
  media: MediaFlags;
  /** Channel only: its category's settings, its own slowmode, and whether it is marked NSFW. */
  category: CategoryPolicy | null;
  channel: ChannelPolicy['channel'] | null;
  effective: ChannelPolicy['effective'] | null;
}

function fromResponse(scope: Scope, data: ChannelPolicy | CategoryPolicy): Loaded {
  if (scope === 'channel') {
    const policy = data as ChannelPolicy;
    return { ...policy.own, category: policy.category, channel: policy.channel, effective: policy.effective };
  }
  const policy = data as CategoryPolicy;
  return {
    threadSlowmode: policy.threadSlowmode, threadAutoHideMinutes: policy.threadAutoHideMinutes, media: policy.media,
    category: null, channel: null, effective: null,
  };
}

// Loads one level's settings and saves edits to it. Each tab saves on its own button,
// separately from the editor's Apply, because these settings take effect on the realm at once.
function usePolicy(scope: Scope, id: string) {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState(0);
  const path = `/api/policy/${scope === 'channel' ? 'channels' : 'categories'}/${id}`;

  useEffect(() => {
    let cancelled = false;
    createApi().get<ChannelPolicy | CategoryPolicy>(path)
      .then((res) => { if (!cancelled) { setLoaded(fromResponse(scope, res.data)); setError(''); } })
      .catch((err) => { if (!cancelled) setError(policyErrorText(err, 'Failed to load settings. The realm server may need updating.')); });
    return () => { cancelled = true; };
  }, [path, scope]);

  const save = async (body: Record<string, unknown>) => {
    setSaving(true);
    try {
      const res = await createApi().patch<ChannelPolicy | CategoryPolicy>(path, body);
      setLoaded(fromResponse(scope, res.data));
      setError('');
      setSavedAt(Date.now());
    } catch (err) {
      setError(policyErrorText(err, 'Failed to save settings'));
    } finally {
      setSaving(false);
    }
  };

  return { loaded, error, saving, savedAt, save };
}

function SaveRow({ dirty, saving, savedAt, error, onSave }: {
  dirty: boolean;
  saving: boolean;
  savedAt: number;
  error: string;
  onSave: () => void;
}) {
  return (
    <div className="flex items-center gap-3">
      <Button type="button" onClick={onSave} disabled={!dirty || saving}>{saving ? 'Saving…' : 'Save'}</Button>
      {error && <span className="text-sm text-danger">{error}</span>}
      {!error && !dirty && savedAt > 0 && <span className="text-sm text-success">Saved. Applies to new activity straight away.</span>}
      {!error && dirty && <span className="text-xs text-text-muted">Unsaved changes</span>}
    </div>
  );
}

function FieldBlock({ title, hint, children }: { title: string; hint: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-xs font-semibold uppercase text-text-secondary">{title}</label>
      {children}
      <div className="text-xs text-text-muted">{hint}</div>
    </div>
  );
}

/**
 * "Thread Settings" tab for a channel or a category: slowmode inside threads and how long a
 * quiet thread stays in the channel's list.
 */
export function ThreadPolicySection({ scope, id, showAutoHide = true }: { scope: Scope; id: string; showAutoHide?: boolean }) {
  const { loaded, error, saving, savedAt, save } = usePolicy(scope, id);
  if (!loaded) return <p className={`text-sm ${error ? 'text-danger' : 'text-text-muted'}`}>{error || 'Loading thread settings…'}</p>;
  // Keyed by the loaded values so the form resets to what the realm stored after each save.
  return (
    <ThreadPolicyForm
      key={`${loaded.threadSlowmode}:${loaded.threadAutoHideMinutes}:${savedAt}`}
      scope={scope} loaded={loaded} showAutoHide={showAutoHide} error={error} saving={saving} savedAt={savedAt} save={save}
    />
  );
}

function ThreadPolicyForm({ scope, loaded, showAutoHide, error, saving, savedAt, save }: {
  scope: Scope;
  loaded: Loaded;
  showAutoHide: boolean;
  error: string;
  saving: boolean;
  savedAt: number;
  save: (body: Record<string, unknown>) => Promise<void>;
}) {
  // A category stores "sync" for slowmode and the default for auto-hide when nothing was chosen.
  const initialSlowmode = scope === 'category' ? (loaded.threadSlowmode ?? SYNC_WITH_CHANNEL) : loaded.threadSlowmode;
  const initialAutoHide = scope === 'category' ? (loaded.threadAutoHideMinutes ?? AUTO_HIDE_DEFAULT_MINUTES) : loaded.threadAutoHideMinutes;
  const [slowmode, setSlowmode] = useState<number | null>(initialSlowmode);
  const [autoHide, setAutoHide] = useState<number | null>(initialAutoHide);
  const dirty = slowmode !== initialSlowmode || autoHide !== initialAutoHide;

  const category = loaded.category;
  const categorySlowmode = category
    ? (category.threadSlowmode === null || category.threadSlowmode === SYNC_WITH_CHANNEL ? 'sync with channel' : formatSeconds(category.threadSlowmode))
    : null;
  const slowmodePresets: PresetChoice[] = scope === 'channel'
    ? [
      ...(category ? [{ value: null, label: `Use the category's setting (${category.name}: ${categorySlowmode})` }] : []),
      { value: SYNC_WITH_CHANNEL, label: `Sync with this channel's slowmode (${formatSeconds(loaded.channel?.slowmode ?? 0)})` },
    ]
    : [{ value: SYNC_WITH_CHANNEL, label: "Sync with each channel's own slowmode" }];
  // A channel outside any category has nothing to inherit: "null" then means sync.
  const slowmodeValue = scope === 'channel' && !category && slowmode === null ? SYNC_WITH_CHANNEL : slowmode;
  const autoHidePresets: PresetChoice[] = scope === 'channel'
    ? [{
      value: null,
      label: category
        ? `Use the category's setting (${category.name}: ${formatMinutes(category.threadAutoHideMinutes ?? AUTO_HIDE_DEFAULT_MINUTES)})`
        : `Use the realm default (${formatMinutes(AUTO_HIDE_DEFAULT_MINUTES)})`,
    }]
    : [];

  return (
    <div className="space-y-5">
      <FieldBlock
        title="Slowmode in threads"
        hint={scope === 'channel'
          ? 'How long a member waits between their own messages in one thread. A single thread can override this in its own settings.'
          : 'Applies to threads in every channel of this category, unless a channel sets its own.'}
      >
        <SlowmodeField value={slowmodeValue} presets={slowmodePresets} onChange={setSlowmode} />
      </FieldBlock>

      {showAutoHide ? (
        <FieldBlock
          title="Auto hide after"
          hint="A thread with no new messages for this long leaves the channel's thread list. It comes back when someone writes in it, and its announcement link still opens it."
        >
          <AutoHideField value={autoHide} presets={autoHidePresets} onChange={setAutoHide} />
        </FieldBlock>
      ) : (
        <p className="rounded-lg border border-border bg-bg-input/40 px-4 py-3 text-xs text-text-muted">
          Forum posts are not auto-hidden; archive them from the forum instead.
        </p>
      )}

      {loaded.effective && !dirty && (
        <div className="rounded-xl border border-border bg-bg-input/40 px-4 py-3 text-sm text-text-muted">
          <span className="font-medium text-text-primary">In effect now:</span>{' '}
          thread slowmode {formatSeconds(loaded.effective.threadSlowmode)}
          {showAutoHide && <> • threads hide after {formatMinutes(loaded.effective.threadAutoHideMinutes).toLowerCase()}</>}
        </div>
      )}

      <SaveRow
        dirty={dirty} saving={saving} savedAt={savedAt} error={error}
        onSave={() => void save({ threadSlowmode: slowmodeValue, ...(showAutoHide ? { threadAutoHideMinutes: autoHide } : {}) })}
      />
    </div>
  );
}

const SUB_MARKS: Array<{ flag: MediaFlag; label: string }> = [
  { flag: 'lewd', label: 'Lewd' },
  { flag: 'blood', label: 'Blood' },
  { flag: 'gore', label: 'Gore' },
];

/**
 * "Media Settings" tab for a channel or a category: marks the realm adds to every piece of
 * media posted there, whatever client sent it.
 */
export function MediaPolicySection({ scope, id }: { scope: Scope; id: string }) {
  const { loaded, error, saving, savedAt, save } = usePolicy(scope, id);
  if (!loaded) return <p className={`text-sm ${error ? 'text-danger' : 'text-text-muted'}`}>{error || 'Loading media settings…'}</p>;
  return (
    <MediaPolicyForm
      key={`${JSON.stringify(loaded.media)}:${savedAt}`}
      scope={scope} loaded={loaded} error={error} saving={saving} savedAt={savedAt} save={save}
    />
  );
}

function MediaPolicyForm({ scope, loaded, error, saving, savedAt, save }: {
  scope: Scope;
  loaded: Loaded;
  error: string;
  saving: boolean;
  savedAt: number;
  save: (body: Record<string, unknown>) => Promise<void>;
}) {
  const [media, setMedia] = useState<MediaFlags>(loaded.media);
  const dirty = (Object.keys(media) as MediaFlag[]).some((flag) => media[flag] !== loaded.media[flag]);
  const category = loaded.category;
  const set = (flag: MediaFlag, value: boolean) => setMedia((current) => {
    const next = { ...current, [flag]: value };
    // A sub-mark needs this level's own Auto NSFW, even when the category already has it on.
    if (value && flag !== 'spoiler' && flag !== 'nsfw') next.nsfw = true;
    // The sub-marks cannot stay on without Auto NSFW.
    if (!next.nsfw) { next.lewd = false; next.blood = false; next.gore = false; }
    return next;
  });
  // A category setting is a floor: its channels show it as on and cannot switch it off.
  const fromCategory = (flag: MediaFlag) => (category?.media[flag] ? `Turned on by the category (${category.name})` : undefined);
  const channelNotNsfw = scope === 'channel' && !loaded.channel?.nsfw;
  const nsfwOn = media.nsfw || !!category?.media.nsfw;

  return (
    <div className="space-y-3">
      <PolicyToggle
        label="Auto Mark Media Spoiler"
        description="Every image and video posted here is covered as a spoiler until clicked."
        checked={media.spoiler || !!category?.media.spoiler}
        locked={fromCategory('spoiler')}
        onChange={(value) => set('spoiler', value)}
      />
      <PolicyToggle
        label="Auto Mark NSFW + Tags **"
        description="Every image and video posted here is marked NSFW, so members who have NSFW turned off see it covered."
        checked={!channelNotNsfw && nsfwOn}
        locked={channelNotNsfw
          ? 'Turn on "Mark as NSFW" for this channel in Basic Settings (and apply it) first'
          : fromCategory('nsfw')}
        onChange={(value) => set('nsfw', value)}
      />
      {SUB_MARKS.map(({ flag, label }) => (
        <PolicyToggle
          key={flag}
          indent
          label={`Auto Mark ${label} *`}
          description={`Also tags the media as ${label}, for members who filter that category.`}
          checked={!channelNotNsfw && (media[flag] || !!category?.media[flag])}
          disabled={channelNotNsfw || !nsfwOn}
          locked={!channelNotNsfw ? fromCategory(flag) : undefined}
          onChange={(value) => set(flag, value)}
        />
      ))}
      <div className="space-y-0.5 text-xs text-text-muted">
        <p>* Requires Auto Mark NSFW + Tags.</p>
        <p>
          ** Requires “Mark as NSFW” on the channel.
          {scope === 'category' && ' In a category this only reaches the channels that are marked NSFW.'}
        </p>
        <p>The realm applies these to everything posted from now on, whichever client sends it. Existing messages are not changed.</p>
      </div>
      <SaveRow dirty={dirty} saving={saving} savedAt={savedAt} error={error} onSave={() => void save({ media })} />
    </div>
  );
}
