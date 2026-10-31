import { useState, useRef } from 'react';
import { useTheaterStore } from '../../stores/theaterStore';
import type { TheaterQueueItem, TheaterSettings } from '../../types';
import { Check, ChevronUp, Clapperboard, FolderUp, SkipForward, X } from 'lucide-react';

interface TheaterQueueProps {
  channelId: string;
  canControl: boolean;
  selfUserId: string | null;
  settings: TheaterSettings | null;
  currentItemId: string | null;
}

type UploadStatus = {
  fileName: string;
  phase: 'checking' | 'uploading' | 'processing';
  loaded: number;
  total: number;
  percent: number;
} | null;

type UploadLimitOverridePrompt = {
  file: File;
  limitBytes: number;
} | null;

type UploadErrorData = {
  error?: unknown;
  code?: unknown;
  canBypass?: unknown;
  limitBytes?: unknown;
  limitMb?: unknown;
};

function formatDuration(seconds: number | null | undefined): string {
  if (!seconds) return '';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${Math.round(value * 10) / 10} ${units[unit]}`;
}

function getUploadErrorMessage(err: unknown, fallback: string): string {
  const responseError = getUploadErrorData(err)?.error;
  if (typeof responseError === 'string' && responseError.trim()) return responseError;
  return err instanceof Error ? err.message : fallback;
}

function getUploadErrorData(err: unknown): UploadErrorData | undefined {
  return (err as { response?: { data?: UploadErrorData } })?.response?.data;
}

function CacheStatusBadge({ status, progress }: { status: TheaterQueueItem['cache_status']; progress: number }) {
  if (status === 'ready') return null;
  if (status === 'downloading') {
    return (
      <div className="flex items-center gap-1.5 mt-1">
        <div className="flex-1 bg-bg-hover rounded-full h-1 overflow-hidden">
          <div className="h-full bg-accent transition-all duration-300" style={{ width: `${progress}%` }} />
        </div>
        <span className="text-[10px] text-text-muted">{progress}%</span>
      </div>
    );
  }
  if (status === 'error') return <p className="text-[10px] text-red-400 mt-0.5">Failed to load</p>;
  if (status === 'pending') return <p className="text-[10px] text-text-muted mt-0.5">Queued…</p>;
  if (status === 'played') return <p className="text-[10px] text-text-muted mt-0.5">Played</p>;
  return null;
}

export function TheaterQueue({ channelId, canControl, selfUserId, settings, currentItemId }: TheaterQueueProps) {
  const [urlInput, setUrlInput] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [uploadStatus, setUploadStatus] = useState<UploadStatus>(null);
  const [uploadLimitOverridePrompt, setUploadLimitOverridePrompt] = useState<UploadLimitOverridePrompt>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const queue = useTheaterStore((s) => s.queue);
  const mySkipVote = useTheaterStore((s) => s.mySkipVote);
  const addToQueue = useTheaterStore((s) => s.addToQueue);
  const removeFromQueue = useTheaterStore((s) => s.removeFromQueue);
  const castSkipVote = useTheaterStore((s) => s.castSkipVote);
  const voteQueue = useTheaterStore((s) => s.voteQueue);

  const canQueue = canControl || !!settings?.theater_open_queuing;
  const skipVotingEnabled = !!settings?.theater_skip_voting_enabled;
  const queueVotingEnabled = !!settings?.theater_queue_voting_enabled;
  const pendingQueue = queue.filter((i) => i.cache_status !== 'played' && i.id !== currentItemId);
  const uploadStatusLabel = uploadStatus?.phase === 'checking'
    ? 'Checking file'
    : uploadStatus?.phase === 'processing'
      ? 'Processing'
      : 'Uploading';

  async function handleAddUrl(e: React.FormEvent) {
    e.preventDefault();
    if (!urlInput.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      await addToQueue(channelId, urlInput.trim());
      setUrlInput('');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to add video';
      setError(msg);
    } finally {
      setSubmitting(false);
    }
  }

  async function uploadFile(file: File, bypassLimit = false) {
    setSubmitting(true);
    setError(null);
    if (!bypassLimit) setUploadLimitOverridePrompt(null);
    setUploadStatus({
      fileName: file.name,
      phase: 'checking',
      loaded: 0,
      total: file.size,
      percent: 0,
    });
    try {
      const { createApi } = await import('../../lib/api');
      const { useAuthStore } = await import('../../stores/authStore');
      const { useServerStore } = await import('../../stores/serverStore');
      const { useTheaterStore } = await import('../../stores/theaterStore');
      const user = useAuthStore.getState().user;
      const serverUrl = useTheaterStore.getState().theaterServerUrl
        ?? (user?.accountType === 'central'
          ? useServerStore.getState().activeServerUrl
          : useAuthStore.getState().serverUrl);
      if (!serverUrl) throw new Error('No server URL');
      const token = user?.accountType === 'central'
        ? (useServerStore.getState().servers.find((entry) => entry.url === serverUrl)?.token ?? useAuthStore.getState().token)
        : useAuthStore.getState().token;
      const api = createApi(serverUrl, token ?? undefined);
      await api.post(`/api/theater/${channelId}/queue/upload/check`, {
        fileName: file.name,
        fileSize: file.size,
        mime: file.type || 'application/octet-stream',
        bypassLimit,
      });
      setUploadStatus({
        fileName: file.name,
        phase: 'uploading',
        loaded: 0,
        total: file.size,
        percent: 0,
      });
      const form = new FormData();
      form.append('video', file);
      form.append('title', file.name.replace(/\.[^.]+$/, ''));
      await api.post(`/api/theater/${channelId}/queue/upload`, form, {
        headers: {
          'Content-Type': 'multipart/form-data',
          'X-CatRealm-File-Size': String(file.size),
          ...(bypassLimit ? { 'X-CatRealm-Bypass-Upload-Limit': 'true' } : {}),
        },
        onUploadProgress: (event) => {
          const total = event.total || file.size;
          const loaded = Math.min(event.loaded || 0, total);
          const percent = total > 0 ? Math.min(99, Math.round((loaded / total) * 100)) : 0;
          setUploadStatus({
            fileName: file.name,
            phase: 'uploading',
            loaded,
            total,
            percent,
          });
        },
      });
      setUploadStatus({
        fileName: file.name,
        phase: 'processing',
        loaded: file.size,
        total: file.size,
        percent: 100,
      });
    } catch (err: unknown) {
      const data = getUploadErrorData(err);
      const limitBytes = typeof data?.limitBytes === 'number'
        ? data.limitBytes
        : Number(data?.limitMb) * 1024 * 1024;
      if (
        !bypassLimit
        && data?.code === 'THEATER_UPLOAD_TOO_LARGE'
        && data?.canBypass === true
        && Number.isFinite(limitBytes)
        && limitBytes > 0
      ) {
        setUploadLimitOverridePrompt({ file, limitBytes });
        return;
      }
      setError(getUploadErrorMessage(err, 'Upload failed'));
    } finally {
      setSubmitting(false);
      setUploadStatus(null);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  async function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    await uploadFile(file);
  }

  return (
    <div className="flex flex-col h-full bg-bg-secondary/60 rounded-xl overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <h3 className="text-sm font-semibold text-text-primary">
          Up Next
          <span className="ml-2 text-xs font-normal text-text-muted">{pendingQueue.length}</span>
        </h3>
      </div>

      {/* Add video form */}
      {canQueue && (
        <div className="px-3 py-3 border-b border-border space-y-2">
          <form onSubmit={handleAddUrl} className="flex gap-2">
            <input
              type="url"
              value={urlInput}
              onChange={(e) => setUrlInput(e.target.value)}
              placeholder="Paste video URL…"
              className="flex-1 rounded-lg bg-bg-input border border-border text-text-primary text-xs px-3 py-1.5 focus:outline-none focus:ring-1 focus:ring-accent placeholder:text-text-muted"
              disabled={submitting}
            />
            <button
              type="submit"
              disabled={submitting || !urlInput.trim()}
              className="bg-accent text-white rounded-lg px-3 py-1.5 text-xs font-medium disabled:opacity-50 hover:bg-accent/90 transition-colors"
            >
              Add
            </button>
          </form>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              disabled={submitting}
              className="text-xs text-text-secondary hover:text-accent transition-colors disabled:opacity-50"
            >
              <span className="inline-flex items-center gap-1"><FolderUp className="h-3.5 w-3.5" /> Upload file</span>
            </button>
            <input
              ref={fileRef}
              type="file"
              accept=".mp4,.webm,.ogg,.ogv,.mov,.m4v,.mkv,.avi,video/*"
              className="hidden"
              onChange={handleFileUpload}
            />
          </div>
          {uploadStatus && (
            <div className="rounded-lg border border-accent/30 bg-accent/10 px-3 py-2">
              <div className="flex items-center justify-between gap-2 text-[10px]">
                <span className="min-w-0 truncate font-medium text-text-primary">{uploadStatus.fileName}</span>
                <span className="shrink-0 text-text-secondary">{uploadStatusLabel}</span>
              </div>
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-bg-hover">
                <div
                  className={`h-full rounded-full transition-all duration-150 ease-out ${uploadStatus.phase === 'checking' ? 'animate-pulse bg-accent/40' : 'bg-accent'}`}
                  style={{ width: `${uploadStatus.phase === 'checking' ? 100 : uploadStatus.percent}%` }}
                />
              </div>
              <div className="mt-1 flex items-center justify-between gap-2 text-[10px] text-text-muted">
                <span>{formatFileSize(uploadStatus.loaded)} / {formatFileSize(uploadStatus.total)}</span>
                <span>{uploadStatus.percent}%</span>
              </div>
            </div>
          )}
          {error && <p className="text-xs text-red-400">{error}</p>}
        </div>
      )}

      {/* Skip vote button */}
      {skipVotingEnabled && currentItemId && (
        <div className="px-3 py-2 border-b border-border">
          <button
            onClick={() => !mySkipVote && castSkipVote(channelId)}
            disabled={mySkipVote}
            className="w-full text-xs text-text-secondary hover:text-accent disabled:text-text-muted transition-colors"
          >
            <span className="inline-flex items-center gap-1">
              {mySkipVote ? <Check className="h-3.5 w-3.5" /> : <SkipForward className="h-3.5 w-3.5" />}
              {mySkipVote ? 'Skip vote cast' : 'Vote to skip current video'}
            </span>
          </button>
        </div>
      )}

      {/* Queue list */}
      <div className="flex-1 overflow-y-auto">
        {pendingQueue.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-2 text-text-muted py-8">
            <Clapperboard className="h-8 w-8" />
            <p className="text-xs">Queue is empty</p>
            {canQueue && <p className="text-xs">Add a video URL above</p>}
          </div>
        ) : (
          <ul className="divide-y divide-border">
            {pendingQueue.map((item, idx) => (
              <li key={item.id} className={`px-3 py-2.5 flex gap-2.5 items-start hover:bg-bg-hover/40 transition-colors ${item.id === currentItemId ? 'bg-accent/10' : ''}`}>
                {/* Position number */}
                <span className="text-xs text-text-muted mt-1 w-4 shrink-0">{idx + 1}</span>

                {/* Thumbnail */}
                <div className="w-12 h-9 rounded bg-bg-hover shrink-0 overflow-hidden flex items-center justify-center">
                  {item.thumbnail_url ? (
                    <img src={item.thumbnail_url} alt="" className="w-full h-full object-cover" />
                  ) : (
                    <Clapperboard className="h-5 w-5" />
                  )}
                </div>

                {/* Info */}
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium text-text-primary truncate">{item.title}</p>
                  {item.duration_seconds ? (
                    <p className="text-[10px] text-text-muted">{formatDuration(item.duration_seconds)}</p>
                  ) : null}
                  <p className="text-[10px] text-text-muted">by {item.added_by_username || 'Unknown'}</p>
                  <CacheStatusBadge status={item.cache_status} progress={item.cache_progress} />
                </div>

                {/* Actions */}
                <div className="flex flex-col items-center gap-1 shrink-0">
                  {queueVotingEnabled && (
                    <button
                      onClick={() => voteQueue(channelId, item.id, !item.myVote)}
                      className={`text-xs transition-colors ${item.myVote ? 'text-accent' : 'text-text-muted hover:text-accent'}`}
                      title="Upvote"
                    >
                      <ChevronUp className="h-3.5 w-3.5" />
                    </button>
                  )}
                  {queueVotingEnabled && item.votes > 0 && (
                    <span className="text-[10px] text-text-muted">{item.votes}</span>
                  )}
                  {(canControl || item.added_by === selfUserId) && (
                    <button
                      onClick={() => removeFromQueue(channelId, item.id)}
                      className="text-[10px] text-text-muted hover:text-red-400 transition-colors"
                      title="Remove"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
      {uploadLimitOverridePrompt && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4">
          <div className="w-full max-w-md rounded-lg border border-border bg-bg-secondary p-5 shadow-2xl">
            <h3 className="text-base font-semibold text-text-primary">Media File is over the limit</h3>
            <p className="mt-3 text-sm text-text-secondary">
              The Media File is {formatFileSize(uploadLimitOverridePrompt.file.size)} but the limit is {formatFileSize(uploadLimitOverridePrompt.limitBytes)}.
            </p>
            <p className="mt-2 text-sm text-text-secondary">
              You have Ownership of this Realm you can choose an override option.
            </p>
            <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <button
                type="button"
                onClick={() => setUploadLimitOverridePrompt(null)}
                disabled={submitting}
                className="rounded-lg border border-border px-4 py-2 text-sm text-text-secondary transition-colors hover:bg-bg-hover disabled:opacity-50"
              >
                Cancel Upload
              </button>
              <button
                type="button"
                onClick={() => {
                  const { file } = uploadLimitOverridePrompt;
                  setUploadLimitOverridePrompt(null);
                  void uploadFile(file, true);
                }}
                disabled={submitting}
                className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-accent/90 disabled:opacity-50"
              >
                Bypass Upload Limit
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
