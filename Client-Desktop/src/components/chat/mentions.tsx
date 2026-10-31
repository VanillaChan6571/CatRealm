import { createContext, useContext, useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { createApi } from '../../lib/api';
import { useAuthStore } from '../../stores/authStore';
import { useChannelStore } from '../../stores/channelStore';
import { usePresenceStore } from '../../stores/presenceStore';
import { useServerStore } from '../../stores/serverStore';
import { useUIStore } from '../../stores/uiStore';
import type { Role } from '../../types';

type MentionUser = { id: string; username: string; displayName?: string | null };
type MentionRole = { id: string; name: string; color: string | null };
type MentionChannel = { id: string; name: string };

type MentionIndex = {
  users: Map<string, MentionUser>; // keyed by lowercase username and by id
  roles: Map<string, MentionRole>; // keyed by lowercase name (incl. the @everyone alias) and by id
  channels: Map<string, MentionChannel> | null; // keyed by id; null outside servers
  selfId: string | null;
};

const MentionContext = createContext<MentionIndex | null>(null);

// Mentions are plain `@name` text or stable ID tokens (`<@userOrRoleId>`, `<#channelId>`,
// handy for bots); only names/IDs known in the surrounding chat become pills.
const MENTION_REGEX = /<@([\w-]+)>|<#([\w-]+)>|(^|[^\p{L}\p{N}_@])@([\p{L}\p{N}_.-]+)/gu;
const USER_PILL_CLASS = 'rounded px-0.5 font-medium text-purple-400 hover:bg-purple-500/35 cursor-pointer';
const FALLBACK_ROLE_COLOR = '#a855f7';

export function MentionProvider({
  users,
  roles = [],
  channels = null,
  everyoneAlias = null,
  children,
}: {
  users: MentionUser[];
  roles?: MentionRole[];
  channels?: MentionChannel[] | null;
  everyoneAlias?: string | null;
  children: ReactNode;
}) {
  const selfId = useAuthStore((s) => s.user?.id ?? null);
  const index = useMemo<MentionIndex>(() => {
    const userMap = new Map<string, MentionUser>();
    for (const u of users) {
      if (!u?.username) continue;
      userMap.set(u.username.toLowerCase(), u);
      userMap.set(u.id.toLowerCase(), u);
    }
    const roleMap = new Map<string, MentionRole>();
    for (const r of roles) {
      roleMap.set(r.name.toLowerCase(), r);
      roleMap.set(r.id.toLowerCase(), r);
    }
    const alias = everyoneAlias?.replace(/^@/, '').trim();
    if (alias) roleMap.set(alias.toLowerCase(), { id: 'everyone', name: alias, color: null });
    const channelMap = channels ? new Map(channels.map((c) => [c.id.toLowerCase(), c])) : null;
    return { users: userMap, roles: roleMap, channels: channelMap, selfId };
  }, [users, roles, channels, everyoneAlias, selfId]);
  return <MentionContext.Provider value={index}>{children}</MentionContext.Provider>;
}

const rolesCache = new Map<string, Role[]>();

/** Mentionable roles for the active server, fetched once per server per session. */
function useMentionableRoles(serverUrl: string | null): Role[] {
  const key = serverUrl ?? '';
  const [roles, setRoles] = useState<Role[]>(() => rolesCache.get(key) ?? []);
  useEffect(() => {
    const cached = rolesCache.get(key);
    if (cached) {
      setRoles(cached);
      return;
    }
    let cancelled = false;
    createApi().get<Role[]>('/api/roles')
      .then((res) => {
        const list = Array.isArray(res.data) ? res.data.filter((r) => !r.is_default) : [];
        rolesCache.set(key, list);
        if (!cancelled) setRoles(list);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [key]);
  return roles;
}

/** Mention context for server channels: every server member, its mentionable roles and channels. */
export function ServerMentionProvider({ children }: { children: ReactNode }) {
  const members = usePresenceStore((s) => s.allMembers);
  const channels = useChannelStore((s) => s.channels);
  const serverUrl = useServerStore((s) => s.activeServerUrl);
  const everyoneAlias = useAuthStore((s) => s.serverInfo?.mentionAlias ?? '@everyone');
  const roles = useMentionableRoles(serverUrl);
  return (
    <MentionProvider users={members} roles={roles} channels={channels} everyoneAlias={everyoneAlias}>
      {children}
    </MentionProvider>
  );
}

function roleColors(color: string | null) {
  const base = color && /^#[0-9a-f]{6}$/i.test(color) ? color : FALLBACK_ROLE_COLOR;
  return { color: base, backgroundColor: `${base}26`, hoverBackground: `${base}4d` };
}

function RoleMentionPill({ role, label }: { role: MentionRole; label: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);
  const colors = roleColors(role.color);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  return (
    <span ref={ref} className="relative inline">
      <span
        role="button"
        tabIndex={0}
        className="rounded px-0.5 font-medium cursor-pointer"
        style={{ color: colors.color, backgroundColor: open ? colors.hoverBackground : colors.backgroundColor }}
        onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = colors.hoverBackground; }}
        onMouseLeave={(e) => { if (!open) e.currentTarget.style.backgroundColor = colors.backgroundColor; }}
        onClick={() => setOpen((v) => !v)}
        onKeyDown={(e) => activate(e, () => setOpen((v) => !v))}
      >
        {label}
      </span>
      {open && (
        <span className="absolute left-0 bottom-full mb-1 z-50 flex items-center gap-2 whitespace-nowrap rounded-md border border-border bg-bg-elevated px-2.5 py-1.5 text-xs text-text-primary shadow-lg">
          <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: colors.color }} />
          <span className="font-semibold">{role.name}</span>
          <span className="text-text-muted">{role.id === 'everyone' ? 'Everyone here' : 'Role'}</span>
        </span>
      )}
    </span>
  );
}

const CHANNEL_PILL_CLASS = 'rounded px-0.5 font-medium text-purple-400 bg-purple-500/20 hover:bg-purple-500/35 cursor-pointer';
const MISSING_CHANNEL_CLASS = 'rounded px-0.5 font-medium text-text-muted bg-bg-hover/60';

function activate(e: KeyboardEvent<HTMLSpanElement>, run: () => void) {
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    run();
  }
}

/** Renders plain text, turning known `@user` / `@role` / `<#channel>` mentions into clickable pills. */
export function MentionText({ text }: { text: string }) {
  const index = useContext(MentionContext);
  const openModal = useUIStore((s) => s.openModal);
  const setActiveChannel = useChannelStore((s) => s.setActiveChannel);
  if (!index || !/[@#]/.test(text)) return <span>{text}</span>;

  const parts: ReactNode[] = [];
  let lastIndex = 0;
  let key = 0;
  for (const match of text.matchAll(MENTION_REGEX)) {
    const [whole, idToken, channelToken, lead = '', rawName] = match;
    let start = match.index ?? 0;
    let end = start + whole.length;
    let node: ReactNode = null;

    if (channelToken) {
      if (!index.channels) continue; // no channels outside servers: leave the token as typed
      const channel = index.channels.get(channelToken.toLowerCase());
      node = channel ? (
        <span
          key={key++}
          role="button"
          tabIndex={0}
          className={CHANNEL_PILL_CLASS}
          onClick={() => setActiveChannel(channel.id)}
          onKeyDown={(e) => activate(e, () => setActiveChannel(channel.id))}
        >
          #{channel.name}
        </span>
      ) : (
        <span key={key++} className={MISSING_CHANNEL_CLASS}>#deleted-channel</span>
      );
    } else {
      // Trailing dots/hyphens are usually punctuation ("thanks @bob."), not part of the name.
      const name = idToken ?? rawName.replace(/[.-]+$/, '');
      if (!idToken) {
        start += lead.length;
        end = start + 1 + name.length;
      }
      const lower = name.toLowerCase();
      const user = index.users.get(lower);
      const role = user ? null : index.roles.get(lower);
      if (user) {
        const openProfile = () => openModal('profileView', { userId: user.id });
        node = (
          <span
            key={key++}
            role="button"
            tabIndex={0}
            title={user.displayName || user.username}
            className={`${USER_PILL_CLASS} ${user.id === index.selfId ? 'bg-purple-500/30' : 'bg-purple-500/20'}`}
            onClick={openProfile}
            onKeyDown={(e) => activate(e, openProfile)}
          >
            @{user.username}
          </span>
        );
      } else if (role) {
        node = <RoleMentionPill key={key++} role={role} label={`@${role.name}`} />;
      }
    }
    if (!node) continue;

    if (start > lastIndex) parts.push(text.slice(lastIndex, start));
    parts.push(node);
    lastIndex = end;
  }
  if (parts.length === 0) return <span>{text}</span>;
  if (lastIndex < text.length) parts.push(text.slice(lastIndex));
  return <span>{parts}</span>;
}
