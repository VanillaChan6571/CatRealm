import { useEffect, useRef, useState } from 'react';
import { ImagePlus, Lock, Trash2 } from 'lucide-react';
import { createApi } from '../../lib/api';
import { apiErrorMessage, useWorkItemStore, workItemBasePath } from '../../stores/workItemStore';
import type { BoardList } from '../../types';
import { Button } from '../ui/Button';
import { ImageCropModal } from '../ui/ImageCropModal';
import { Modal } from '../ui/Modal';
import { WORK_ITEM_LIMITS, fieldClass, resolveRealmImage, toggleId } from './workItemUtils';

interface RoleOption {
  id: string;
  name: string;
  color: string | null;
}

type CoverShape = 'banner' | 'square';

// A banner is four times as wide as it is tall (512×128 at full size).
const COVER_SHAPES: Array<{ value: CoverShape; label: string; ratio: number }> = [
  { value: 'banner', label: 'Banner', ratio: 4 },
  { value: 'square', label: 'Square', ratio: 1 },
];
const COVER_RESOLUTIONS = [128, 256, 512];
const BOARD_SIZES: Array<{ value: number | null; label: string }> = [
  { value: null, label: 'Fit list' },
  { value: 128, label: '128' },
  { value: 256, label: '256' },
  { value: 512, label: '512' },
];
const ICON_PX = 128;

function Segmented<T extends string | number | null>({ label, options, value, onChange }: {
  label: string;
  options: Array<{ value: T; label: string }>;
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-24 shrink-0 text-xs text-text-muted">{label}</span>
      <div className="flex overflow-hidden rounded-md border border-border">
        {options.map((option) => (
          <button
            key={String(option.value)}
            type="button"
            aria-pressed={option.value === value}
            onClick={() => onChange(option.value)}
            className={`border-l border-border px-2.5 py-1 text-xs transition-colors first:border-l-0 ${option.value === value ? 'bg-accent/20 font-semibold text-text-primary' : 'text-text-muted hover:bg-bg-hover hover:text-text-primary'}`}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}

/**
 * One image slot (cover or icon): pick, crop, replace or remove. The chosen file is
 * cropped to the slot's shape and saved at the chosen resolution before it is uploaded.
 */
function ImageField({ label, hint, value, serverUrl, channelId, shape, onChange, onError }: {
  label: string;
  hint: string;
  value: string | null;
  serverUrl: string | null;
  channelId: string;
  shape: 'cover' | 'icon';
  onChange: (value: string | null) => void;
  onError: (message: string) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [pending, setPending] = useState<File | null>(null);
  const [coverShape, setCoverShape] = useState<CoverShape>('banner');
  const [resolution, setResolution] = useState(512);
  const ratio = shape === 'icon' ? 1 : COVER_SHAPES.find((option) => option.value === coverShape)?.ratio ?? 1;
  const outputWidth = shape === 'icon' ? ICON_PX : resolution;
  const outputHeight = Math.round(outputWidth / ratio);

  const upload = async (file: File) => {
    setUploading(true);
    try {
      const form = new FormData();
      form.append('file', file);
      form.append('channelId', channelId);
      const res = await createApi().post<{ url: string }>('/api/uploads/chat', form, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      onChange(res.data.url);
      setPending(null);
    } catch (err) {
      onError(apiErrorMessage(err, `Failed to upload ${label.toLowerCase()}`));
    } finally {
      setUploading(false);
    }
  };

  // The cover preview is the width of a list, so it shows the same crop the board will.
  const frame = shape === 'cover' ? `w-72 max-w-full rounded-md ${value ? 'max-h-72' : 'h-20'}` : 'h-12 w-12 rounded-md';
  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between">
        <span className="text-xs font-semibold uppercase text-text-secondary">{label}</span>
        <span className="text-xs text-text-muted">{hint}</span>
      </div>
      <div className={`flex gap-2 ${shape === 'cover' ? 'flex-col' : 'items-center'}`}>
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className={`${frame} flex shrink-0 items-center justify-center overflow-hidden border border-dashed border-border bg-bg-input text-text-muted transition-colors hover:border-accent/60 hover:text-text-primary`}
          title={value ? `Replace ${label.toLowerCase()}` : `Choose ${label.toLowerCase()}`}
        >
          {value
            ? <img src={resolveRealmImage(value, serverUrl)} alt="" className={shape === 'cover' ? 'h-auto max-h-72 w-full object-cover' : 'h-full w-full object-cover'} />
            : <ImagePlus className="h-5 w-5" />}
        </button>
        <div className="flex gap-2">
          <Button type="button" size="sm" variant="secondary" disabled={uploading} onClick={() => inputRef.current?.click()}>
            {uploading ? 'Uploading…' : value ? 'Replace' : 'Upload image'}
          </Button>
          {value && (
            <Button type="button" size="sm" variant="ghost" onClick={() => onChange(null)} className="flex items-center gap-1.5">
              <Trash2 className="h-3.5 w-3.5" /> Remove
            </Button>
          )}
        </div>
      </div>
      <input
        ref={inputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = '';
          if (file) setPending(file);
        }}
      />
      <ImageCropModal
        isOpen={!!pending}
        file={pending}
        title={`Crop ${label.toLowerCase()}`}
        // The shape and size are chosen here, while looking at the crop they produce.
        controls={shape === 'cover' ? (
          <div className="space-y-1.5">
            <Segmented label="Shape" options={COVER_SHAPES} value={coverShape} onChange={setCoverShape} />
            <Segmented
              label="Size"
              options={COVER_RESOLUTIONS.map((px) => ({ value: px, label: `${px}×${Math.round(px / ratio)}` }))}
              value={resolution}
              onChange={setResolution}
            />
          </div>
        ) : undefined}
        aspectRatio={ratio}
        outputWidth={outputWidth}
        outputHeight={outputHeight}
        busy={uploading}
        onCancel={() => setPending(null)}
        onConfirm={(file) => void upload(file)}
      />
    </div>
  );
}

/**
 * Appearance and visibility of one board list. Managers only; the realm server
 * enforces both that and who can see a staff-only list.
 */
export function ListSettingsModal({ channelId, list, serverUrl, onClose }: {
  channelId: string;
  list: BoardList;
  serverUrl: string | null;
  onClose: () => void;
}) {
  const [name, setName] = useState(list.name);
  const [coverImage, setCoverImage] = useState(list.cover_image);
  const [coverSize, setCoverSize] = useState(list.cover_size);
  const [icon, setIcon] = useState(list.icon);
  const [staffOnly, setStaffOnly] = useState(list.staff_only);
  const [roleIds, setRoleIds] = useState<string[]>(list.role_ids ?? []);
  const [roles, setRoles] = useState<RoleOption[] | null>(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const base = workItemBasePath('board', channelId);

  useEffect(() => {
    let cancelled = false;
    createApi().get<RoleOption[]>(`${base}/roles`)
      .then((res) => { if (!cancelled) setRoles(res.data); })
      .catch(() => { if (!cancelled) setRoles([]); });
    return () => { cancelled = true; };
  }, [base]);

  const save = async () => {
    if (!name.trim()) return;
    setSaving(true);
    try {
      await createApi().patch(`${base}/lists/${list.id}`, {
        name: name.trim(), coverImage, coverSize, icon, staffOnly, roleIds,
      });
      // board:lists-updated carries the result; the refetch covers a slow socket.
      void useWorkItemStore.getState().fetchBoard(channelId);
      onClose();
    } catch (err) {
      setError(apiErrorMessage(err, 'Failed to save list'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open onClose={onClose} title="List settings">
      <form onSubmit={(event) => { event.preventDefault(); void save(); }} className="space-y-4">
        <label className="block">
          <span className="mb-1 block text-xs font-semibold uppercase text-text-secondary">Name</span>
          <input value={name} maxLength={WORK_ITEM_LIMITS.listName} onChange={(event) => setName(event.target.value)} className={fieldClass} />
        </label>

        <ImageField
          label="Cover image" hint="Optional, shown above the list" shape="cover"
          value={coverImage} serverUrl={serverUrl} channelId={channelId} onChange={setCoverImage} onError={setError}
        />
        {coverImage && (
          <div>
            <Segmented label="Size on board" options={BOARD_SIZES} value={coverSize} onChange={setCoverSize} />
            <p className="mt-1 text-xs text-text-muted">
              {coverSize
                ? `Drawn ${coverSize} px wide, centred.${coverSize > 256 ? ' The list widens to fit it.' : ''}`
                : 'Drawn across the full width of the list.'}
            </p>
          </div>
        )}
        <ImageField
          label="Icon" hint="Optional, shown beside the name" shape="icon"
          value={icon} serverUrl={serverUrl} channelId={channelId} onChange={setIcon} onError={setError}
        />

        <div className="rounded-lg border border-border bg-bg-chat/40 p-3">
          <label className="flex cursor-pointer items-start gap-3">
            <input
              type="checkbox"
              checked={staffOnly}
              onChange={(event) => setStaffOnly(event.target.checked)}
              className="mt-0.5 h-4 w-4 rounded border-border bg-bg-input text-accent focus:ring-0"
            />
            <span>
              <span className="flex items-center gap-1.5 text-sm font-medium text-text-primary">
                <Lock className="h-3.5 w-3.5" /> Staff only
              </span>
              <span className="block text-xs text-text-muted">
                Hide this list and its cards from everyone except board managers and the roles chosen below.
              </span>
            </span>
          </label>

          {staffOnly && (
            <div className="mt-3 border-t border-border/60 pt-3">
              <span className="mb-1.5 block text-xs font-semibold uppercase text-text-secondary">Also visible to</span>
              {!roles && <p className="text-xs text-text-muted">Loading roles…</p>}
              {roles?.length === 0 && <p className="text-xs text-text-muted">This realm has no other roles.</p>}
              <div className="flex max-h-40 flex-wrap gap-1.5 overflow-y-auto">
                {roles?.map((role) => {
                  const selected = roleIds.includes(role.id);
                  return (
                    <button
                      key={role.id}
                      type="button"
                      onClick={() => setRoleIds(toggleId(roleIds, role.id))}
                      aria-pressed={selected}
                      className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition-colors ${selected ? 'border-accent bg-accent/15 text-text-primary' : 'border-border text-text-muted hover:text-text-primary'}`}
                    >
                      <span className="h-2 w-2 rounded-full" style={{ backgroundColor: role.color || 'currentColor' }} />
                      {role.name}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {error && <p className="text-sm text-danger">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={saving || !name.trim()}>{saving ? 'Saving…' : 'Save'}</Button>
        </div>
      </form>
    </Modal>
  );
}
