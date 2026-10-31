import { useEffect, useState } from 'react';
import type { Channel, ForumPost } from '../../types';
import { useThreadStore } from '../../stores/threadStore';
import { useViewedPermissions } from '../../hooks/useViewedPermissions';
import { PERMISSIONS, hasChannelPermission } from '../../utils/permissions';
import { createApi } from '../../lib/api';
import { ForumPostCard } from './ForumPostCard';
import { ForumPostComposer } from './ForumPostComposer';
import { Check, X } from 'lucide-react';

const EMPTY_FORUM_POSTS: ForumPost[] = [];

type SortMode = 'activity' | 'newest' | 'oldest';
type ViewMode = 'list' | 'gallery';

interface Props {
  channel: Channel;
  onOpenPost: (post: ForumPost) => void;
}

export function ForumChannel({ channel, onOpenPost }: Props) {
  const fetchForumPosts = useThreadStore((s) => s.fetchForumPosts);
  const forumPostsByChannel = useThreadStore((s) => s.forumPostsByChannel);
  const viewed = useViewedPermissions();

  const [composing, setComposing] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [showSortMenu, setShowSortMenu] = useState(false);
  const [sortMode, setSortMode] = useState<SortMode>('activity');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);
  const [dismissedGetStarted, setDismissedGetStarted] = useState(false);

  // For 'user_choice' channels the user can toggle; otherwise we follow the channel setting
  const channelLayout = channel.forum_layout ?? 'user_choice';
  const [userViewMode, setUserViewMode] = useState<ViewMode>('list');
  const effectiveView: ViewMode =
    channelLayout === 'list' ? 'list' :
    channelLayout === 'gallery' ? 'gallery' :
    userViewMode;

  const rawPosts = forumPostsByChannel[channel.id];
  const posts = Array.isArray(rawPosts) ? rawPosts : EMPTY_FORUM_POSTS;
  const activePosts = posts.filter((p) => !p.archived);
  const archivedPosts = posts.filter((p) => !!p.archived);

  const canCreatePost = hasChannelPermission(
    viewed.permissions, channel.effective_permissions, PERMISSIONS.CREATE_POST_IN_FORUMS
  );
  const canManage = hasChannelPermission(
    viewed.permissions, channel.effective_permissions, PERMISSIONS.MANAGE_POSTS
  );

  useEffect(() => {
    setLoading(true);
    fetchForumPosts(channel.id).finally(() => setLoading(false));
  }, [channel.id, fetchForumPosts]);

  useEffect(() => {
    setSearch('');
    setComposing(false);
    setShowArchived(false);
    setDismissedGetStarted(false);
  }, [channel.id]);

  const handleArchiveToggle = async (post: ForumPost) => {
    try {
      const api = createApi();
      await api.post(`/api/threads/${post.id}/${post.archived ? 'unarchive' : 'archive'}`);
      void fetchForumPosts(channel.id);
    } catch { /* ignore */ }
  };

  const handleDelete = async (post: ForumPost) => {
    try {
      const api = createApi();
      await api.delete(`/api/threads/${post.id}`);
      void fetchForumPosts(channel.id);
    } catch { /* ignore */ }
  };

  const sortPosts = (list: ForumPost[]) => {
    if (sortMode === 'newest') return [...list].sort((a, b) => b.created_at - a.created_at);
    if (sortMode === 'oldest') return [...list].sort((a, b) => a.created_at - b.created_at);
    return [...list].sort((a, b) =>
      (b.last_message_at ?? b.created_at) - (a.last_message_at ?? a.created_at)
    );
  };

  const filterPosts = (list: ForumPost[]) => {
    if (!search.trim()) return list;
    const q = search.trim().toLowerCase();
    return list.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        p.preview_content.toLowerCase().includes(q) ||
        p.author_username.toLowerCase().includes(q) ||
        (p.author_display_name ?? '').toLowerCase().includes(q)
    );
  };

  const visibleActive = filterPosts(sortPosts(activePosts));
  const visibleArchived = filterPosts(sortPosts(archivedPosts));

  const showGetStarted = canManage && !dismissedGetStarted && activePosts.length === 0 && !loading && !composing;

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-bg-chat">

      {/* === Composer (replaces search bar when active) === */}
      {composing ? (
        <ForumPostComposer
          channelId={channel.id}
          onDone={() => { setComposing(false); void fetchForumPosts(channel.id); }}
          onCancel={() => setComposing(false)}
        />
      ) : (
        /* === Search bar row === */
        <div className="px-4 pt-4 pb-2 flex items-center gap-3">
          <div className="flex-1 relative">
            <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted pointer-events-none" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" />
            </svg>
            <input
              className="w-full bg-bg-input border border-border rounded-md py-2 pl-9 pr-3 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent"
              placeholder="Search or create a post..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && !search.trim() && canCreatePost) setComposing(true); }}
            />
          </div>
          {canCreatePost && (
            <button
              type="button"
              onClick={() => setComposing(true)}
              className="shrink-0 flex items-center gap-2 px-4 py-2 rounded-md bg-accent text-white text-sm font-semibold hover:opacity-90 transition-opacity"
            >
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M18 10c0 3.866-3.582 7-8 7a8.841 8.841 0 01-4.083-.98L2 17l1.338-3.123C2.493 12.767 2 11.434 2 10c0-3.866 3.582-7 8-7s8 3.134 8 7z" clipRule="evenodd" />
              </svg>
              New Post
            </button>
          )}
        </div>
      )}

      {/* === Sort & View row === */}
      <div className="px-4 pb-3 flex items-center gap-2 relative">
        <button
          type="button"
          onClick={() => setShowSortMenu((v) => !v)}
          className="flex items-center gap-1.5 text-sm text-text-muted bg-bg-elevated border border-border rounded-full px-3 py-1 hover:bg-bg-hover transition-colors"
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M3 7h18M6 12h12M9 17h6" />
          </svg>
          Sort &amp; View
          <svg className="w-3 h-3 ml-0.5" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </button>

        {/* User-choice list/gallery toggle */}
        {channelLayout === 'user_choice' && (
          <div className="flex rounded-full border border-border overflow-hidden bg-bg-elevated">
            <button
              type="button"
              onClick={() => setUserViewMode('list')}
              title="List view"
              className={`px-2.5 py-1 transition-colors ${userViewMode === 'list' ? 'bg-accent/20 text-accent' : 'text-text-muted hover:bg-bg-hover'}`}
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
              </svg>
            </button>
            <button
              type="button"
              onClick={() => setUserViewMode('gallery')}
              title="Gallery view"
              className={`px-2.5 py-1 transition-colors border-l border-border ${userViewMode === 'gallery' ? 'bg-accent/20 text-accent' : 'text-text-muted hover:bg-bg-hover'}`}
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 5h6v6H4V5zm10 0h6v6h-6V5zM4 15h6v6H4v-6zm10 0h6v6h-6v-6z" />
              </svg>
            </button>
          </div>
        )}

        {showSortMenu && (
          <>
            <div className="fixed inset-0 z-10" onClick={() => setShowSortMenu(false)} />
            <div className="absolute top-full left-4 mt-1 z-20 bg-bg-elevated border border-border rounded-lg shadow-xl py-1 min-w-[160px]">
              <div className="px-3 py-1 text-[11px] font-semibold text-text-muted uppercase tracking-wider">Sort by</div>
              {(['activity', 'newest', 'oldest'] as SortMode[]).map((mode) => (
                <button key={mode} type="button" onClick={() => { setSortMode(mode); setShowSortMenu(false); }}
                  className={`w-full text-left px-3 py-1.5 text-sm transition-colors ${sortMode === mode ? 'text-accent bg-accent/10' : 'text-text-primary hover:bg-bg-hover'}`}
                >
                  {mode === 'activity' ? 'Latest Activity' : mode === 'newest' ? 'Newest' : 'Oldest'}
                  {sortMode === mode && <Check className="float-right h-4 w-4" />}
                </button>
              ))}
            </div>
          </>
        )}
      </div>

      {/* === Scrollable content === */}
      <div className="flex-1 overflow-y-auto px-4 pb-4">

        {/* Get Started card */}
        {showGetStarted && (
          <div className="rounded-lg border border-border bg-bg-elevated mb-4">
            <div className="flex items-center justify-between px-4 py-3 border-b border-border">
              <div className="flex items-center gap-2">
                <span className="font-semibold text-text-primary text-sm">Get Started</span>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-xs text-text-muted flex items-center gap-1">
                  <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
                  </svg>
                  Only moderators can see this
                </span>
                <button type="button" onClick={() => setDismissedGetStarted(true)} className="text-text-muted hover:text-text-primary transition-colors leading-none" title="Dismiss"><X className="h-4 w-4" /></button>
              </div>
            </div>
            <div className="flex items-center gap-3 px-4 py-3 border-b border-border hover:bg-bg-hover/40 transition-colors cursor-default">
              <div className="w-5 h-5 rounded-full border-2 border-border shrink-0 flex items-center justify-center"><div className="w-2 h-2 rounded-full bg-border" /></div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-text-primary">Set up permissions</p>
                <p className="text-xs text-text-muted">Configure who can post and reply in this forum.</p>
              </div>
              <svg className="w-4 h-4 text-text-muted shrink-0" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" /></svg>
            </div>
            <div className="flex items-center gap-3 px-4 py-3 hover:bg-bg-hover/40 transition-colors cursor-pointer rounded-b-lg"
              onClick={() => { setDismissedGetStarted(true); setComposing(true); }}
              role="button" tabIndex={0}
              onKeyDown={(e) => { if (e.key === 'Enter') { setDismissedGetStarted(true); setComposing(true); } }}
            >
              <div className="w-5 h-5 rounded-full border-2 border-border shrink-0 flex items-center justify-center"><div className="w-2 h-2 rounded-full bg-border" /></div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-text-primary">Make the first post!</p>
                <p className="text-xs text-text-muted">Start the conversation and get things going.</p>
              </div>
              <svg className="w-4 h-4 text-text-muted shrink-0" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" /></svg>
            </div>
          </div>
        )}

        {/* Empty / loading states */}
        {loading && posts.length === 0 && (
          <div className="text-center text-text-muted text-sm py-12">Loading...</div>
        )}
        {!loading && !showGetStarted && activePosts.length === 0 && (
          <div className="flex flex-col items-center justify-center py-16 text-center gap-3">
            <p className="font-semibold text-text-primary">
              {search.trim() ? 'No posts match your search.' : `Be the first to start the conversation!`}
            </p>
            {!search.trim() && (
              <>
                <p className="text-sm text-text-muted">What do you want to post about in #{channel.name}?</p>
                {canCreatePost && (
                  <button type="button" onClick={() => setComposing(true)}
                    className="mt-1 px-4 py-1.5 rounded-md border border-border text-sm text-text-primary hover:bg-bg-hover transition-colors"
                  >
                    See Examples
                  </button>
                )}
              </>
            )}
          </div>
        )}

        {/* Active posts */}
        {effectiveView === 'gallery' ? (
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            {visibleActive.map((post) => (
              <ForumPostCard key={post.id} post={post} viewMode="gallery"
                onOpen={() => onOpenPost(post)} canManage={canManage}
                onArchive={canManage ? () => handleArchiveToggle(post) : undefined}
                onDelete={canManage ? () => handleDelete(post) : undefined}
              />
            ))}
          </div>
        ) : (
          <div className="space-y-2">
            {visibleActive.map((post) => (
              <ForumPostCard key={post.id} post={post} viewMode="list"
                onOpen={() => onOpenPost(post)} canManage={canManage}
                onArchive={canManage ? () => handleArchiveToggle(post) : undefined}
                onDelete={canManage ? () => handleDelete(post) : undefined}
              />
            ))}
          </div>
        )}

        {/* Archived section */}
        {archivedPosts.length > 0 && (
          <div className="pt-3">
            <button type="button" onClick={() => setShowArchived((v) => !v)}
              className="flex items-center gap-1.5 text-sm text-text-muted hover:text-text-primary transition-colors mb-2"
            >
              <svg className={`w-3 h-3 transition-transform ${showArchived ? 'rotate-90' : ''}`} fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
              </svg>
              Archived ({archivedPosts.length})
            </button>
            {showArchived && (
              effectiveView === 'gallery' ? (
                <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                  {visibleArchived.map((post) => (
                    <ForumPostCard key={post.id} post={post} viewMode="gallery"
                      onOpen={() => onOpenPost(post)} canManage={canManage}
                      onArchive={canManage ? () => handleArchiveToggle(post) : undefined}
                      onDelete={canManage ? () => handleDelete(post) : undefined}
                    />
                  ))}
                </div>
              ) : (
                <div className="space-y-2">
                  {visibleArchived.map((post) => (
                    <ForumPostCard key={post.id} post={post} viewMode="list"
                      onOpen={() => onOpenPost(post)} canManage={canManage}
                      onArchive={canManage ? () => handleArchiveToggle(post) : undefined}
                      onDelete={canManage ? () => handleDelete(post) : undefined}
                    />
                  ))}
                </div>
              )
            )}
          </div>
        )}
      </div>
    </div>
  );
}
