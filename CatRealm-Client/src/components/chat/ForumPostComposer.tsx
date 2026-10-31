import { useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { useThreadStore } from '../../stores/threadStore';
import { useAuthStore } from '../../stores/authStore';
import { createApi } from '../../lib/api';
import { X } from 'lucide-react';

interface Props {
  channelId: string;
  onDone: () => void;
  onCancel: () => void;
}

interface AttachPreview {
  file: File;
  blobUrl: string;
}

export function ForumPostComposer({ channelId, onDone, onCancel }: Props) {
  const createForumPost = useThreadStore((s) => s.createForumPost);
  const serverUrl = useAuthStore((s) => s.serverUrl);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [coverFile, setCoverFile] = useState<File | null>(null);
  const [coverPreview, setCoverPreview] = useState<string | null>(null);
  const [attachPreviews, setAttachPreviews] = useState<AttachPreview[]>([]);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const coverInputRef = useRef<HTMLInputElement>(null);
  const attachInputRef = useRef<HTMLInputElement>(null);

  const handleCoverSelect = (file: File) => {
    setCoverFile(file);
    setCoverPreview(URL.createObjectURL(file));
  };

  const handleCoverDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file && file.type.startsWith('image/')) handleCoverSelect(file);
  };

  const handleAttachSelect = (files: FileList) => {
    const newPreviews: AttachPreview[] = [];
    for (const file of Array.from(files)) {
      if (file.type.startsWith('image/') || file.type.startsWith('video/') || file.type.startsWith('application/')) {
        newPreviews.push({ file, blobUrl: URL.createObjectURL(file) });
      }
    }
    setAttachPreviews((prev) => [...prev, ...newPreviews]);
  };

  const removeAttach = (idx: number) => {
    setAttachPreviews((prev) => {
      URL.revokeObjectURL(prev[idx].blobUrl);
      return prev.filter((_, i) => i !== idx);
    });
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !body.trim()) return;
    setUploading(true);
    setError(null);
    try {
      const api = createApi();

      // Upload cover image
      let coverImageUrl: string | null = null;
      if (coverFile) {
        const form = new FormData();
        form.append('file', coverFile);
        const res = await api.post<{ url: string }>('/api/uploads/chat', form, {
          headers: { 'Content-Type': 'multipart/form-data' },
        });
        coverImageUrl = res.data.url;
      }

      // Upload inline attachments (parallel)
      const attachmentResults: Array<{ url: string; mime: string | null; size: number | null }> = [];
      if (attachPreviews.length > 0) {
        const uploads = await Promise.all(
          attachPreviews.map(async ({ file }) => {
            const form = new FormData();
            form.append('file', file);
            const res = await api.post<{ url: string }>('/api/uploads/chat', form, {
              headers: { 'Content-Type': 'multipart/form-data' },
            });
            return { url: res.data.url, mime: file.type || null, size: file.size || null };
          })
        );
        attachmentResults.push(...uploads);
      }

      await createForumPost(channelId, title.trim(), body.trim(), coverImageUrl, attachmentResults);
      onDone();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to create post');
    } finally {
      setUploading(false);
    }
  };

  const resolvePreview = (src: string) => {
    if (!src) return src;
    if (/^https?:\/\//i.test(src) || src.startsWith('blob:')) return src;
    return `${(serverUrl ?? '').replace(/\/+$/, '')}${src}`;
  };

  return (
    <form onSubmit={handleSubmit} className="mx-4 mt-3 mb-2 rounded-lg border border-border bg-bg-elevated overflow-hidden">
      {/* Title row */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border">
        <button
          type="button"
          onClick={onCancel}
          className="text-text-muted hover:text-text-primary transition-colors shrink-0 w-5 h-5 flex items-center justify-center rounded hover:bg-bg-hover text-base leading-none"
          title="Cancel"
        >
          <X className="h-4 w-4" />
        </button>
        <input
          className="flex-1 bg-transparent text-text-primary text-sm font-medium placeholder:text-text-muted focus:outline-none"
          placeholder="Title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          maxLength={100}
          required
          autoFocus
        />
      </div>

      {/* Body + cover image */}
      <div className="flex min-h-[96px]">
        <textarea
          className="flex-1 bg-transparent text-sm text-text-primary placeholder:text-text-muted px-3 py-2 resize-none focus:outline-none"
          placeholder="Enter a message..."
          value={body}
          onChange={(e) => setBody(e.target.value)}
          maxLength={2000}
          rows={4}
          required
        />

        {/* Cover image upload square */}
        <div
          className="shrink-0 w-24 h-24 m-2 rounded-md border border-border bg-bg-input flex items-center justify-center cursor-pointer hover:border-accent/60 hover:bg-bg-hover transition-colors overflow-hidden relative"
          onClick={() => coverInputRef.current?.click()}
          onDrop={handleCoverDrop}
          onDragOver={(e) => e.preventDefault()}
          title="Add cover image"
        >
          {coverPreview ? (
            <>
              <img src={resolvePreview(coverPreview)} alt="Cover" className="w-full h-full object-cover" />
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); setCoverFile(null); setCoverPreview(null); }}
                className="absolute top-1 right-1 w-5 h-5 rounded-full bg-black/60 text-white text-[10px] flex items-center justify-center hover:bg-black/80"
                title="Remove image"
              >
                <X className="h-3 w-3" />
              </button>
            </>
          ) : (
            <svg className="w-8 h-8 text-text-muted" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909M3 3h18M3 21h18M12 3v18" />
            </svg>
          )}
        </div>
        <input
          ref={coverInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) handleCoverSelect(f); e.target.value = ''; }}
        />
      </div>

      {/* Attachment previews */}
      {attachPreviews.length > 0 && (
        <div className="flex gap-2 px-3 pb-2 flex-wrap">
          {attachPreviews.map((p, idx) => (
            <div key={idx} className="relative w-16 h-16 rounded-md overflow-hidden border border-border bg-bg-input shrink-0">
              {p.file.type.startsWith('image/') ? (
                <img src={p.blobUrl} alt="" className="w-full h-full object-cover" />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-text-muted text-xs text-center p-1 leading-tight">
                  {p.file.name.split('.').pop()?.toUpperCase()}
                </div>
              )}
              <button
                type="button"
                onClick={() => removeAttach(idx)}
                className="absolute top-0.5 right-0.5 w-4 h-4 rounded-full bg-black/70 text-white text-[9px] flex items-center justify-center hover:bg-black/90"
                title="Remove"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Bottom bar */}
      <div className="flex items-center justify-between px-3 py-2 border-t border-border gap-2">
        <div className="flex items-center gap-2 text-text-muted">
          <button
            type="button"
            onClick={() => attachInputRef.current?.click()}
            className="p-1 rounded hover:bg-bg-hover hover:text-text-primary transition-colors"
            title="Attach images"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
            </svg>
          </button>
          <span className="text-xs">{body.length}/2000</span>
        </div>
        {error && <span className="text-xs text-danger flex-1">{error}</span>}
        <button
          type="submit"
          disabled={uploading || !title.trim() || !body.trim()}
          className="flex items-center gap-1.5 px-4 py-1.5 rounded-md bg-accent text-white text-sm font-semibold disabled:opacity-50 hover:opacity-90 transition-opacity shrink-0"
        >
          <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M18 10c0 3.866-3.582 7-8 7a8.841 8.841 0 01-4.083-.98L2 17l1.338-3.123C2.493 12.767 2 11.434 2 10c0-3.866 3.582-7 8-7s8 3.134 8 7z" clipRule="evenodd" />
          </svg>
          {uploading ? 'Posting...' : 'Post'}
        </button>
      </div>
      <input
        ref={attachInputRef}
        type="file"
        accept="image/*,video/*,application/*"
        multiple
        className="hidden"
        onChange={(e) => { if (e.target.files?.length) handleAttachSelect(e.target.files); e.target.value = ''; }}
      />
    </form>
  );
}
