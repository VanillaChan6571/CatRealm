import type { ForumPost } from '../../types';
import { AvatarImage } from '../ui/AvatarImage';
import { resolveAvatarUrl } from '../../utils/avatar';
import { formatTimestamp } from '../../utils/formatTime';
import { useAuthStore } from '../../stores/authStore';
import { useServerStore } from '../../stores/serverStore';
import { Archive, ArchiveRestore, Trash2 } from 'lucide-react';

interface Props {
  post: ForumPost;
  onOpen: () => void;
  canManage: boolean;
  viewMode?: 'list' | 'gallery';
  onArchive?: () => void;
  onDelete?: () => void;
}

const ReplyIcon = () => (
  <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
  </svg>
);

const ManageButtons = ({ post, onArchive, onDelete }: { post: ForumPost; onArchive?: () => void; onDelete?: () => void }) => (
  <div className="flex gap-1 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
    {onArchive && (
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); onArchive(); }}
        className="text-text-muted hover:text-text-primary text-xs px-1.5 py-0.5 rounded hover:bg-bg-elevated transition-colors"
        title={post.archived ? 'Unarchive' : 'Archive'}
      >
        {post.archived ? <ArchiveRestore className="h-3.5 w-3.5" /> : <Archive className="h-3.5 w-3.5" />}
      </button>
    )}
    {onDelete && (
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); onDelete(); }}
        className="text-text-muted hover:text-danger text-xs px-1.5 py-0.5 rounded hover:bg-bg-elevated transition-colors"
        title="Delete"
      >
        <Trash2 className="h-3.5 w-3.5" />
      </button>
    )}
  </div>
);

export function ForumPostCard({ post, onOpen, canManage, viewMode = 'list', onArchive, onDelete }: Props) {
  const serverUrl = useAuthStore((s) => s.serverUrl);
  const activeServerUrl = useServerStore((s) => s.activeServerUrl);
  const avatarSrc = resolveAvatarUrl(
    post.author_avatar,
    serverUrl || activeServerUrl,
    post.author_account_type
  );
  const displayName = post.author_display_name || post.author_username;

  const resolveCover = (src: string) => {
    if (/^https?:\/\//i.test(src) || src.startsWith('blob:')) return src;
    return `${(serverUrl || activeServerUrl || '').replace(/\/+$/, '')}${src}`;
  };

  if (viewMode === 'gallery') {
    return (
      <div
        className="group bg-bg-elevated border border-border rounded-lg overflow-hidden cursor-pointer hover:border-accent/40 hover:bg-bg-hover/50 transition-all flex flex-col"
        onClick={onOpen}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(); } }}
      >
        {/* Cover image */}
        <div className="relative aspect-video bg-bg-input flex items-center justify-center overflow-hidden shrink-0">
          {post.cover_image ? (
            <img src={resolveCover(post.cover_image)} alt="" className="w-full h-full object-cover" />
          ) : (
            <svg className="w-10 h-10 text-text-muted/30" fill="none" stroke="currentColor" strokeWidth="1" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909M3 3h18M3 21h18M12 3v18" />
            </svg>
          )}
          {canManage && (onArchive || onDelete) && (
            <div className="absolute top-1 right-1">
              <ManageButtons post={post} onArchive={onArchive} onDelete={onDelete} />
            </div>
          )}
          {!!post.archived && (
            <span className="absolute top-1 left-1 text-[10px] font-medium text-warning bg-black/60 px-1.5 py-0.5 rounded-full">Archived</span>
          )}
        </div>

        {/* Content */}
        <div className="p-3 flex flex-col gap-1 flex-1">
          <h3 className="font-semibold text-text-primary text-sm leading-snug group-hover:text-accent transition-colors line-clamp-2">
            {post.name}
          </h3>
          {post.preview_content && (
            <p className="text-xs text-text-secondary line-clamp-2 leading-relaxed flex-1">
              {post.preview_content}
            </p>
          )}
          {/* Footer */}
          <div className="flex items-center justify-between gap-1 mt-1 pt-1 border-t border-border/50">
            <div className="flex items-center gap-1 min-w-0">
              <AvatarImage
                src={avatarSrc}
                alt={displayName}
                size={14}
                className="w-3.5 h-3.5 rounded-full object-cover shrink-0"
                fallback={<span className="text-[9px]">{displayName.charAt(0).toUpperCase()}</span>}
              />
              <span className="text-[11px] text-text-muted truncate">{displayName}</span>
            </div>
            <span className="inline-flex items-center gap-0.5 text-[11px] text-text-muted shrink-0">
              <ReplyIcon />
              {post.reply_count}
            </span>
          </div>
        </div>
      </div>
    );
  }

  // List view (default)
  return (
    <div
      className="group bg-bg-elevated border border-border rounded-lg p-4 cursor-pointer hover:border-accent/40 hover:bg-bg-hover/50 transition-all"
      onClick={onOpen}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(); } }}
    >
      <div className="flex gap-3">
        {/* Cover image thumbnail (list mode) */}
        {post.cover_image && (
          <div className="shrink-0 w-16 h-16 rounded-md overflow-hidden bg-bg-input">
            <img src={resolveCover(post.cover_image)} alt="" className="w-full h-full object-cover" />
          </div>
        )}

        <div className="flex-1 min-w-0">
          {/* Title row */}
          <div className="flex items-start justify-between gap-3 mb-1.5">
            <h3 className="font-semibold text-text-primary text-base leading-snug group-hover:text-accent transition-colors">
              {post.name}
            </h3>
            {canManage && (onArchive || onDelete) && (
              <ManageButtons post={post} onArchive={onArchive} onDelete={onDelete} />
            )}
          </div>

          {/* Body preview */}
          {post.preview_content && (
            <p className="text-sm text-text-secondary line-clamp-2 mb-3 leading-relaxed">
              {post.preview_content}
            </p>
          )}

          {/* Footer row: author + stats */}
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="flex items-center gap-1.5 min-w-0">
              <AvatarImage
                src={avatarSrc}
                alt={displayName}
                size={18}
                className="w-4.5 h-4.5 rounded-full object-cover shrink-0"
                fallback={<span className="text-[10px]">{displayName.charAt(0).toUpperCase()}</span>}
              />
              <span className="text-xs text-text-muted truncate">{displayName}</span>
              <span className="text-text-muted/40 text-xs">·</span>
              <span className="text-xs text-text-muted shrink-0">{formatTimestamp(post.created_at)}</span>
              {!!post.archived && (
                <span className="ml-1 text-[10px] font-medium text-warning bg-warning/10 px-1.5 py-0.5 rounded-full">Archived</span>
              )}
            </div>

            <div className="flex items-center gap-2 shrink-0">
              {post.last_message_at && (
                <span className="text-xs text-text-muted">
                  {formatTimestamp(post.last_message_at)}
                </span>
              )}
              <span className="inline-flex items-center gap-1 text-xs text-text-muted bg-bg-chat border border-border rounded-full px-2 py-0.5">
                <ReplyIcon />
                {post.reply_count}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
