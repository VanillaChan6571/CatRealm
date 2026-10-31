/**
 * Mention pills in message text — mirrors desktop's components/chat/mentions.tsx.
 *
 * Mentions are plain `@name` text or stable ID tokens (`<@userOrRoleId>`, `<#channelId>`);
 * only names/IDs known in the surrounding server become pills, so stray `@` text stays text.
 * Without a provider (DMs, notes) MentionText renders plain text.
 */

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Text } from 'react-native';
import { useRouter } from 'expo-router';
import { useTheme } from '@/theme';
import { createApi } from '@/lib/api';
import { useAuthStore } from '@/stores/authStore';
import { usePresenceStore } from '@/stores/presenceStore';
import { useServerStore } from '@/stores/serverStore';
import type { Channel, Role } from '@/types';

type MentionUser = { id: string; username: string };
type MentionRole = { id: string; name: string; color: string | null };
type MentionChannel = { id: string; name: string; type?: string };

export type MentionIndex = {
  users: Map<string, MentionUser>; // keyed by lowercase username and by id
  roles: Map<string, MentionRole>; // keyed by lowercase name (incl. the @everyone alias) and by id
  channels: Map<string, MentionChannel> | null; // keyed by id; null outside servers
  selfId: string | null;
};

export type MentionSegment =
  | { t: 'text'; v: string }
  | { t: 'user'; user: MentionUser }
  | { t: 'role'; role: MentionRole }
  | { t: 'channel'; channel: MentionChannel }
  | { t: 'missing-channel' };

const MENTION_REGEX = /<@([\w-]+)>|<#([\w-]+)>|(^|[^\p{L}\p{N}_@])@([\p{L}\p{N}_.-]+)/gu;
const FALLBACK_ROLE_COLOR = '#a855f7';

export function buildMentionIndex(
  users: MentionUser[],
  roles: MentionRole[],
  channels: MentionChannel[] | null,
  everyoneAlias: string | null,
  selfId: string | null,
): MentionIndex {
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
}

/** Split text into plain runs and known mentions. */
export function splitMentions(text: string, index: MentionIndex): MentionSegment[] {
  if (!/[@#]/.test(text)) return [{ t: 'text', v: text }];
  const out: MentionSegment[] = [];
  let lastIndex = 0;
  for (const match of text.matchAll(MENTION_REGEX)) {
    const [whole, idToken, channelToken, lead = '', rawName = ''] = match;
    let start = match.index ?? 0;
    let end = start + whole.length;
    let segment: MentionSegment | null = null;

    if (channelToken) {
      if (!index.channels) continue; // no channels outside servers: leave the token as typed
      const channel = index.channels.get(channelToken.toLowerCase());
      segment = channel ? { t: 'channel', channel } : { t: 'missing-channel' };
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
      if (user) segment = { t: 'user', user };
      else if (role) segment = { t: 'role', role };
    }
    if (!segment) continue;
    if (start > lastIndex) out.push({ t: 'text', v: text.slice(lastIndex, start) });
    out.push(segment);
    lastIndex = end;
  }
  if (out.length === 0) return [{ t: 'text', v: text }];
  if (lastIndex < text.length) out.push({ t: 'text', v: text.slice(lastIndex) });
  return out;
}

type MentionContextValue = { index: MentionIndex; serverId: string };
const MentionContext = createContext<MentionContextValue | null>(null);

const EMPTY_CHANNELS: Channel[] = [];
const rolesCache = new Map<string, Role[]>();

/** Mentionable roles for a realm, fetched once per realm per session. */
function useMentionableRoles(serverUrl: string | null, token: string | undefined): Role[] {
  const key = serverUrl ?? '';
  const [roles, setRoles] = useState<Role[]>(() => rolesCache.get(key) ?? []);
  useEffect(() => {
    const cached = rolesCache.get(key);
    if (cached) {
      setRoles(cached);
      return;
    }
    if (!serverUrl) return;
    let cancelled = false;
    createApi(serverUrl, token)
      .get<Role[]>('/api/roles')
      .then((res) => {
        const list = Array.isArray(res.data) ? res.data.filter((r) => !r.is_default) : [];
        rolesCache.set(key, list);
        if (!cancelled) setRoles(list);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [key, serverUrl, token]);
  return roles;
}

/** Mention context for a server's channels: its members, mentionable roles and channels. */
export function ServerMentionProvider({ serverId, serverUrl, token, children }: {
  serverId: string;
  serverUrl: string | null;
  token?: string;
  children: ReactNode;
}) {
  const members = usePresenceStore((s) => s.allMembers);
  const channels = useServerStore((s) => s.channels[serverId] ?? EMPTY_CHANNELS);
  const everyoneAlias = useAuthStore((s) => s.serverInfo?.mentionAlias ?? '@everyone');
  const selfId = useAuthStore((s) => s.user?.id ?? null);
  const roles = useMentionableRoles(serverUrl, token);
  const value = useMemo(
    () => ({ index: buildMentionIndex(members, roles, channels, everyoneAlias, selfId), serverId }),
    [members, roles, channels, everyoneAlias, selfId, serverId],
  );
  return <MentionContext.Provider value={value}>{children}</MentionContext.Provider>;
}

/** Plain text with known `@user` / `@role` / `<#channel>` mentions as tappable pills. */
export function MentionText({ text, color }: { text: string; color: string }) {
  const context = useContext(MentionContext);
  const theme = useTheme();
  const router = useRouter();
  if (!context) return <Text style={{ color }}>{text}</Text>;
  const segments = splitMentions(text, context.index);
  if (segments.length === 1 && segments[0].t === 'text') return <Text style={{ color }}>{text}</Text>;

  const pill = { color: theme.colors.accentText, backgroundColor: theme.colors.accentSoft, fontWeight: '600' as const };
  return (
    <Text style={{ color }}>
      {segments.map((segment, i) => {
        switch (segment.t) {
          case 'text':
            return segment.v;
          case 'user': {
            const { user } = segment;
            const self = user.id === context.index.selfId;
            return (
              <Text
                key={i}
                style={[pill, self ? { backgroundColor: theme.colors.accentSoft, color: theme.colors.accent } : null]}
                onPress={() => router.push({ pathname: '/profile/[userId]', params: { userId: user.id, context: 'server' } })}
              >
                @{user.username}
              </Text>
            );
          }
          case 'role': {
            const base = segment.role.color && /^#[0-9a-f]{6}$/i.test(segment.role.color) ? segment.role.color : FALLBACK_ROLE_COLOR;
            return <Text key={i} style={{ color: base, backgroundColor: `${base}26`, fontWeight: '600' }}>@{segment.role.name}</Text>;
          }
          case 'channel': {
            const { channel } = segment;
            const pathname = channel.type === 'voice' ? '/server/[serverId]/voice/[channelId]' : '/server/[serverId]/channel/[channelId]';
            return (
              <Text
                key={i}
                style={pill}
                onPress={() => router.replace({ pathname, params: { serverId: context.serverId, channelId: channel.id } })}
              >
                #{channel.name}
              </Text>
            );
          }
          case 'missing-channel':
            return <Text key={i} style={{ color: theme.colors.text3, fontWeight: '600' }}>#deleted-channel</Text>;
        }
      })}
    </Text>
  );
}
