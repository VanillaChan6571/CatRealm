import { useEffect, useMemo, useRef, useState } from 'react';
import { Hash, Lock, Plus, Volume2, Shield, ShieldCheck, Users, CheckCircle2, AlertTriangle, Sparkles, X } from 'lucide-react';
import { useChannelStore } from '../../stores/channelStore';
import { useUIStore } from '../../stores/uiStore';
import { Modal } from '../ui/Modal';
import { Input } from '../ui/Input';
import { Button } from '../ui/Button';
import { api } from '../../lib/api';
import { isHttpGatewayRealm } from '../../lib/httpRealmGateway';
import { useServerStore } from '../../stores/serverStore';
import { CHANNEL_OVERWRITE_CATEGORY_KEYS, PERMISSION_CATEGORIES } from './permissionDefinitions';
import { PERMISSIONS } from '../../utils/permissions';
import type { Channel, Role } from '../../types';
import { WebhookManager } from './WebhookManager';

interface PermissionOverwrite {
  id?: string;
  channel_id?: string;
  target_type: 'role' | 'user';
  target_id: string;
  allow: number;
  deny: number;
}

interface PermissionTarget {
  id: string;
  name: string;
}

interface RoleTarget extends PermissionTarget {
  permissions: number;
  is_default: number | boolean;
}

interface UserTarget extends PermissionTarget {
  isOwner?: boolean;
}

interface ExpressionManifestEntry {
  id: string;
  name: string;
  absolute_url?: string;
}

interface UserListEntry {
  id: string;
  username?: string | null;
  displayName?: string | null;
  isOwner?: boolean;
}

interface ChannelSettingsResponse {
  slowmode?: number;
  userLimit?: number;
  user_limit?: number;
  bitrate?: number;
  videoQualityMode?: '720p' | '1080p' | '1440p';
  video_quality_mode?: '720p' | '1080p' | '1440p';
  defaultFramerate?: 24 | 48 | 60;
  default_framerate?: 24 | 48 | 60;
  threadAutoArchive?: number;
  thread_auto_archive?: number;
  threadCreationCooldown?: number;
  thread_creation_cooldown?: number;
  theater_max_duration_seconds?: number;
  theater_open_queuing?: number;
  theater_auto_advance?: number;
  theater_reactions_enabled?: number;
  theater_skip_voting_enabled?: number;
  theater_queue_voting_enabled?: number;
  domains?: string[];
}

type Section = 'basic' | 'permissions' | 'webhooks';
type TargetKey = `role:${string}` | `user:${string}`;

type DraftState = {
  name: string;
  description: string;
  type: Channel['type'];
  categoryId: string | null;
  allowDisplayName: boolean;
  nsfw: boolean;
  slowmode: number;
  userLimit: number;
  bitrate: number;
  videoQualityMode: '720p' | '1080p' | '1440p';
  defaultFramerate: 24 | 48 | 60;
  threadAutoArchive: number;
  threadCreationCooldown: number;
  forumLayout: 'list' | 'gallery' | 'user_choice';
  theaterMaxDuration: number;
  theaterOpenQueuing: boolean;
  theaterAutoAdvance: boolean;
  theaterReactionsEnabled: boolean;
  theaterSkipVotingEnabled: boolean;
  theaterQueueVotingEnabled: boolean;
  theaterDomains: string[];
  permissionOverwrites: PermissionOverwrite[];
};

const DEFAULT_CHANNEL_NAME_EMOJIS = ['🐱', '🌙', '⭐', '✨', '💬', '🎨', '🎵', '🔥'];
const BITRATE_OPTIONS = [8000, 32000, 64000, 96000, 128000, 256000, 384000];
const AUTO_ARCHIVE_OPTIONS = [
  { value: 60, label: '1 Hour' },
  { value: 1440, label: '24 Hours' },
  { value: 4320, label: '3 Days' },
  { value: 10080, label: '7 Days' },
  { value: 0, label: 'Never' },
];

function toPermissionBits(value: number | undefined): bigint {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0n;
  const normalized = Math.trunc(value);
  if (normalized < 0) return BigInt(normalized >>> 0);
  return BigInt(normalized);
}

function hasPermissionBit(value: number | undefined, bit: number) {
  const mask = toPermissionBits(bit);
  if (mask === 0n) return false;
  return (toPermissionBits(value) & mask) === mask;
}

function overwriteKey(targetType: 'role' | 'user', targetId: string): TargetKey {
  return `${targetType}:${targetId}`;
}

function normalizeOverwrites(overwrites: PermissionOverwrite[]) {
  return overwrites
    .map((overwrite) => ({
      target_type: overwrite.target_type,
      target_id: overwrite.target_id,
      allow: Math.trunc(overwrite.allow || 0),
      deny: Math.trunc(overwrite.deny || 0),
    }))
    .filter((overwrite) => overwrite.allow !== 0 || overwrite.deny !== 0)
    .sort((a, b) => (
      overwriteKey(a.target_type, a.target_id).localeCompare(overwriteKey(b.target_type, b.target_id))
    ));
}

function overwritesEqual(a: PermissionOverwrite[], b: PermissionOverwrite[]) {
  return JSON.stringify(normalizeOverwrites(a)) === JSON.stringify(normalizeOverwrites(b));
}

function buildInitialDraft(channel: Channel, settings?: ChannelSettingsResponse, overwrites?: PermissionOverwrite[]): DraftState {
  return {
    name: channel.name,
    description: channel.description ?? '',
    type: channel.type ?? 'basic',
    categoryId: channel.category_id ?? null,
    allowDisplayName: /[A-Z\s]/.test(channel.name),
    nsfw: !!channel.nsfw,
    slowmode: settings?.slowmode ?? channel.slowmode ?? 0,
    userLimit: settings?.userLimit ?? settings?.user_limit ?? 0,
    bitrate: settings?.bitrate ?? 64000,
    videoQualityMode: settings?.videoQualityMode ?? settings?.video_quality_mode ?? '720p',
    defaultFramerate: settings?.defaultFramerate ?? settings?.default_framerate ?? 60,
    threadAutoArchive: settings?.threadAutoArchive ?? settings?.thread_auto_archive ?? 1440,
    threadCreationCooldown: settings?.threadCreationCooldown ?? settings?.thread_creation_cooldown ?? 0,
    forumLayout: channel.forum_layout ?? 'user_choice',
    theaterMaxDuration: settings?.theater_max_duration_seconds ?? 14400,
    theaterOpenQueuing: !!(settings?.theater_open_queuing),
    theaterAutoAdvance: settings?.theater_auto_advance !== undefined ? !!settings.theater_auto_advance : true,
    theaterReactionsEnabled: !!(settings?.theater_reactions_enabled),
    theaterSkipVotingEnabled: !!(settings?.theater_skip_voting_enabled),
    theaterQueueVotingEnabled: !!(settings?.theater_queue_voting_enabled),
    theaterDomains: settings?.domains ?? [],
    permissionOverwrites: Array.isArray(overwrites) ? overwrites.map((overwrite) => ({
      ...overwrite,
      allow: Math.trunc(overwrite.allow || 0),
      deny: Math.trunc(overwrite.deny || 0),
    })) : [],
  };
}

function setPermissionState(
  overwrites: PermissionOverwrite[],
  targetType: 'role' | 'user',
  targetId: string,
  bit: number,
  state: 'allow' | 'deny' | 'inherit'
) {
  const mask = toPermissionBits(bit);
  const next = [...overwrites];
  const index = next.findIndex((overwrite) => overwrite.target_type === targetType && overwrite.target_id === targetId);
  const current = index >= 0
    ? { ...next[index] }
    : { target_type: targetType, target_id: targetId, allow: 0, deny: 0 };
  let allowBits = toPermissionBits(current.allow);
  let denyBits = toPermissionBits(current.deny);

  allowBits &= ~mask;
  denyBits &= ~mask;
  if (state === 'allow') allowBits |= mask;
  if (state === 'deny') denyBits |= mask;

  current.allow = Number(allowBits);
  current.deny = Number(denyBits);

  if (current.allow === 0 && current.deny === 0) {
    if (index >= 0) next.splice(index, 1);
    return next;
  }
  if (index >= 0) next[index] = current;
  else next.push(current);
  return next;
}

function getPermissionState(overwrite: PermissionOverwrite | undefined, bit: number): 'allow' | 'deny' | 'inherit' {
  const mask = toPermissionBits(bit);
  if (!overwrite || mask === 0n) return 'inherit';
  if ((toPermissionBits(overwrite.allow) & mask) === mask) return 'allow';
  if ((toPermissionBits(overwrite.deny) & mask) === mask) return 'deny';
  return 'inherit';
}

export function EditChannelModal() {
  const activeModal = useUIStore((s) => s.activeModal);
  const modalData = useUIStore((s) => s.modalData) as Channel | null;
  const closeModal = useUIStore((s) => s.closeModal);
  const categories = useChannelStore((s) => s.categories);
  const fetchChannels = useChannelStore((s) => s.fetchChannels);
  const isOpen = activeModal === 'editChannel';

  const [section, setSection] = useState<Section>('basic');
  const [draft, setDraft] = useState<DraftState | null>(null);
  const [initialDraft, setInitialDraft] = useState<DraftState | null>(null);
  const [roleTargets, setRoleTargets] = useState<RoleTarget[]>([]);
  const [userTargets, setUserTargets] = useState<UserTarget[]>([]);
  const [categoryOverwrites, setCategoryOverwrites] = useState<PermissionOverwrite[]>([]);
  const [selectedTargetKey, setSelectedTargetKey] = useState<TargetKey | null>(null);
  const [loading, setLoading] = useState(false);
  const [initializing, setInitializing] = useState(false);
  const [permissionsLoading, setPermissionsLoading] = useState(false);
  const [permissionsError, setPermissionsError] = useState('');
  const [categorySyncNotice, setCategorySyncNotice] = useState('');
  const [syncingFromCategory, setSyncingFromCategory] = useState(false);
  const [expressionPickerOpen, setExpressionPickerOpen] = useState(false);
  const [serverExpressionEntries, setServerExpressionEntries] = useState<ExpressionManifestEntry[]>([]);
  const [expressionLoading, setExpressionLoading] = useState(false);
  const [addTargetType, setAddTargetType] = useState<'role' | 'user'>('role');
  const [addTargetId, setAddTargetId] = useState('');
  const [error, setError] = useState('');
  const [closeRejected, setCloseRejected] = useState(false);
  const [newDomain, setNewDomain] = useState('');

  const nameInputRef = useRef<HTMLInputElement | null>(null);
  const closeRejectTimerRef = useRef<number | null>(null);
  const supportsThreads = draft ? ['basic', 'announcement', 'forum'].includes(draft.type) : false;
  const defaultRole = roleTargets.find((role) => !!role.is_default) ?? null;
  const ownerUser = userTargets.find((user) => user.isOwner) ?? null;
  const isSystemRulesChannel = draft?.type === 'rules';

  const selectedTarget = useMemo(() => {
    if (!selectedTargetKey) return null;
    const [targetType, targetId] = selectedTargetKey.split(':') as ['role' | 'user', string];
    if (targetType === 'role') {
      const role = roleTargets.find((entry) => entry.id === targetId);
      return role ? { targetType, ...role } : null;
    }
    const user = userTargets.find((entry) => entry.id === targetId);
    return user ? { targetType, ...user } : null;
  }, [roleTargets, selectedTargetKey, userTargets]);

  const selectedOverwrite = useMemo(() => {
    if (!draft || !selectedTarget) return undefined;
    return draft.permissionOverwrites.find((overwrite) => (
      overwrite.target_type === selectedTarget.targetType && overwrite.target_id === selectedTarget.id
    ));
  }, [draft, selectedTarget]);

  const isPrivateChannel = useMemo(() => {
    if (!draft || !defaultRole) return false;
    const everyoneOverwrite = draft.permissionOverwrites.find((overwrite) => (
      overwrite.target_type === 'role' && overwrite.target_id === defaultRole.id
    ));
    return getPermissionState(everyoneOverwrite, PERMISSIONS.VIEW_CHANNELS) === 'deny';
  }, [defaultRole, draft]);

  const adminRoleIds = useMemo(() => (
    roleTargets
      .filter((role) => hasPermissionBit(role.permissions, PERMISSIONS.ADMINISTRATOR))
      .map((role) => role.id)
  ), [roleTargets]);

  const hasUnsavedChanges = useMemo(() => {
    if (!draft || !initialDraft) return false;
    if (draft.type === 'rules') {
      return draft.name !== initialDraft.name;
    }
    const settingsChanged = (
      draft.name !== initialDraft.name
      || draft.description !== initialDraft.description
      || draft.type !== initialDraft.type
      || draft.categoryId !== initialDraft.categoryId
      || draft.allowDisplayName !== initialDraft.allowDisplayName
      || draft.nsfw !== initialDraft.nsfw
      || draft.slowmode !== initialDraft.slowmode
      || draft.userLimit !== initialDraft.userLimit
      || draft.bitrate !== initialDraft.bitrate
      || draft.videoQualityMode !== initialDraft.videoQualityMode
      || draft.defaultFramerate !== initialDraft.defaultFramerate
      || draft.threadAutoArchive !== initialDraft.threadAutoArchive
      || draft.threadCreationCooldown !== initialDraft.threadCreationCooldown
      || draft.forumLayout !== initialDraft.forumLayout
      || draft.theaterMaxDuration !== initialDraft.theaterMaxDuration
      || draft.theaterOpenQueuing !== initialDraft.theaterOpenQueuing
      || draft.theaterAutoAdvance !== initialDraft.theaterAutoAdvance
      || draft.theaterReactionsEnabled !== initialDraft.theaterReactionsEnabled
      || draft.theaterSkipVotingEnabled !== initialDraft.theaterSkipVotingEnabled
      || draft.theaterQueueVotingEnabled !== initialDraft.theaterQueueVotingEnabled
      || JSON.stringify(draft.theaterDomains) !== JSON.stringify(initialDraft.theaterDomains)
    );
    return settingsChanged || !overwritesEqual(draft.permissionOverwrites, initialDraft.permissionOverwrites);
  }, [draft, initialDraft]);

  const syncStatus = useMemo(() => {
    if (!draft) return 'none';
    if (!draft.categoryId) return 'none';
    return overwritesEqual(draft.permissionOverwrites, categoryOverwrites) ? 'synced' : 'unsynced';
  }, [categoryOverwrites, draft]);

  const visibleRoleEntries = useMemo(() => {
    const keys = new Set<string>();
    const entries: RoleTarget[] = [];
    const pushRole = (role: RoleTarget | undefined) => {
      if (!role || keys.has(role.id)) return;
      keys.add(role.id);
      entries.push(role);
    };
    pushRole(defaultRole ?? undefined);
    roleTargets
      .filter((role) => hasPermissionBit(role.permissions, PERMISSIONS.ADMINISTRATOR))
      .forEach(pushRole);
    roleTargets
      .filter((role) => draft?.permissionOverwrites.some((overwrite) => overwrite.target_type === 'role' && overwrite.target_id === role.id))
      .forEach(pushRole);
    return entries;
  }, [defaultRole, draft?.permissionOverwrites, roleTargets]);

  const visibleUserEntries = useMemo(() => {
    const keys = new Set<string>();
    const entries: UserTarget[] = [];
    const pushUser = (user: UserTarget | undefined) => {
      if (!user || keys.has(user.id)) return;
      keys.add(user.id);
      entries.push(user);
    };
    pushUser(ownerUser ?? undefined);
    userTargets
      .filter((user) => draft?.permissionOverwrites.some((overwrite) => overwrite.target_type === 'user' && overwrite.target_id === user.id))
      .forEach(pushUser);
    return entries;
  }, [draft?.permissionOverwrites, ownerUser, userTargets]);

  useEffect(() => {
    if (!isOpen || !modalData) return;
    let cancelled = false;
    setInitializing(true);
    setLoading(false);
    setPermissionsLoading(true);
    setPermissionsError('');
    setCategorySyncNotice('');
    setError('');
    setSection('basic');
    setExpressionPickerOpen(false);
    setAddTargetType('role');
    setAddTargetId('');

    void Promise.all([
      api.get(`/api/channels/${modalData.id}/settings`),
      api.get(`/api/channels/${modalData.id}/permissions`),
      api.get('/api/roles?all=1').catch(() => api.get('/api/roles')),
      api.get('/api/users'),
      isHttpGatewayRealm(useServerStore.getState().activeServerUrl)
        ? Promise.resolve({ emotes: [] })
        : api.get('/api/expressions/manifest').catch(() => ({ emotes: [] })),
      modalData.type === 'theater'
        ? api.get(`/api/theater/${modalData.id}/settings`).catch(() => null)
        : Promise.resolve(null),
    ]).then(([settings, overwrites, roles, users, expressionManifest, theaterSettings]) => {
      if (cancelled) return;
      const mergedSettings: ChannelSettingsResponse = {
        ...(settings as ChannelSettingsResponse),
        ...(theaterSettings ? (theaterSettings as ChannelSettingsResponse) : {}),
      };
      const nextDraft = buildInitialDraft(
        modalData,
        mergedSettings,
        Array.isArray(overwrites) ? overwrites : []
      );
      const nextRoles = (Array.isArray(roles) ? roles : []).map((role: Role) => ({
        id: role.id,
        name: role.name,
        permissions: Number(role.permissions ?? 0),
        is_default: role.is_default,
      }));
      const nextUsers = (Array.isArray(users) ? users : []).map((user: UserListEntry) => ({
        id: user.id,
        name: user.displayName || user.username || 'Unknown User',
        isOwner: !!user.isOwner,
      }));
      setRoleTargets(nextRoles);
      setUserTargets(nextUsers);
      setDraft(nextDraft);
      setInitialDraft(nextDraft);
      setServerExpressionEntries(
        (Array.isArray(expressionManifest?.emotes) ? expressionManifest.emotes : [])
          .slice(0, 48)
          .map((entry: ExpressionManifestEntry) => ({
            id: entry.id,
            name: entry.name,
            absolute_url: entry.absolute_url,
          }))
      );
      const nextDefaultRole = nextRoles.find((role) => !!role.is_default);
      const nextOwner = nextUsers.find((user) => user.isOwner);
      if (nextDefaultRole) setSelectedTargetKey(overwriteKey('role', nextDefaultRole.id));
      else if (nextOwner) setSelectedTargetKey(overwriteKey('user', nextOwner.id));
      else if (nextRoles[0]) setSelectedTargetKey(overwriteKey('role', nextRoles[0].id));
      else if (nextUsers[0]) setSelectedTargetKey(overwriteKey('user', nextUsers[0].id));
    }).catch(() => {
      if (cancelled) return;
      setPermissionsError('Failed to load channel editor data');
    }).finally(() => {
      if (cancelled) return;
      setInitializing(false);
      setPermissionsLoading(false);
    });

    return () => {
      cancelled = true;
    };
  }, [isOpen, modalData]);

  useEffect(() => {
    return () => {
      if (closeRejectTimerRef.current) {
        window.clearTimeout(closeRejectTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!isOpen || !draft?.categoryId) {
      setCategoryOverwrites([]);
      return;
    }
    let cancelled = false;
    void api.get(`/api/categories/${draft.categoryId}/permissions`)
      .then((overwrites) => {
        if (cancelled) return;
        setCategoryOverwrites(Array.isArray(overwrites) ? overwrites : []);
      })
      .catch(() => {
        if (cancelled) return;
        setCategoryOverwrites([]);
      });
    return () => {
      cancelled = true;
    };
  }, [draft?.categoryId, isOpen]);

  useEffect(() => {
    if (!selectedTargetKey) return;
    const [targetType, targetId] = selectedTargetKey.split(':') as ['role' | 'user', string];
    const exists = targetType === 'role'
      ? roleTargets.some((entry) => entry.id === targetId)
      : userTargets.some((entry) => entry.id === targetId);
    if (!exists) {
      if (defaultRole) setSelectedTargetKey(overwriteKey('role', defaultRole.id));
      else if (ownerUser) setSelectedTargetKey(overwriteKey('user', ownerUser.id));
      else setSelectedTargetKey(null);
    }
  }, [defaultRole, ownerUser, roleTargets, selectedTargetKey, userTargets]);

  const resetDraft = () => {
    if (!initialDraft) return;
    setDraft({
      ...initialDraft,
      permissionOverwrites: initialDraft.permissionOverwrites.map((overwrite) => ({ ...overwrite })),
    });
    setError('');
  };

  const triggerCloseReject = () => {
    if (closeRejectTimerRef.current) {
      window.clearTimeout(closeRejectTimerRef.current);
    }
    setCloseRejected(false);
    window.requestAnimationFrame(() => {
      setCloseRejected(true);
      closeRejectTimerRef.current = window.setTimeout(() => {
        setCloseRejected(false);
        closeRejectTimerRef.current = null;
      }, 360);
    });
  };

  const handleRequestClose = () => {
    if (hasUnsavedChanges) {
      triggerCloseReject();
      return;
    }
    closeModal();
  };

  const applyPrivateChannel = (enabled: boolean) => {
    if (!draft || !defaultRole) return;
    let nextOverwrites = [...draft.permissionOverwrites];

    if (enabled) {
      nextOverwrites = setPermissionState(nextOverwrites, 'role', defaultRole.id, PERMISSIONS.VIEW_CHANNELS, 'deny');
      adminRoleIds.forEach((roleId) => {
        nextOverwrites = setPermissionState(nextOverwrites, 'role', roleId, PERMISSIONS.VIEW_CHANNELS, 'allow');
      });
      if (ownerUser) {
        nextOverwrites = setPermissionState(nextOverwrites, 'user', ownerUser.id, PERMISSIONS.VIEW_CHANNELS, 'allow');
      }
    } else {
      for (const overwrite of normalizeOverwrites(nextOverwrites)) {
        nextOverwrites = setPermissionState(
          nextOverwrites,
          overwrite.target_type,
          overwrite.target_id,
          PERMISSIONS.VIEW_CHANNELS,
          'inherit'
        );
      }
    }

    setDraft({ ...draft, permissionOverwrites: nextOverwrites });
  };

  const addAccessTarget = () => {
    if (!draft || !addTargetId) return;
    let nextOverwrites = [...draft.permissionOverwrites];
    const alreadyExists = nextOverwrites.some((overwrite) => overwrite.target_type === addTargetType && overwrite.target_id === addTargetId);
    if (!alreadyExists) {
      nextOverwrites.push({
        target_type: addTargetType,
        target_id: addTargetId,
        allow: 0,
        deny: 0,
      });
    }
    if (isPrivateChannel) {
      nextOverwrites = setPermissionState(nextOverwrites, addTargetType, addTargetId, PERMISSIONS.VIEW_CHANNELS, 'allow');
    }
    setDraft({ ...draft, permissionOverwrites: nextOverwrites });
    setSelectedTargetKey(overwriteKey(addTargetType, addTargetId));
    setAddTargetId('');
  };

  const removeAccessTarget = (targetType: 'role' | 'user', targetId: string, protectedEntry: boolean) => {
    if (!draft || protectedEntry) return;
    let nextOverwrites = [...draft.permissionOverwrites];
    nextOverwrites = setPermissionState(nextOverwrites, targetType, targetId, PERMISSIONS.VIEW_CHANNELS, 'deny');
    setDraft({ ...draft, permissionOverwrites: nextOverwrites });
    setSelectedTargetKey(overwriteKey(targetType, targetId));
  };

  const syncFromCategory = () => {
    if (!draft?.categoryId) return;
    setSyncingFromCategory(true);
    setCategorySyncNotice('');
    setPermissionsError('');
    try {
      setDraft({
        ...draft,
        permissionOverwrites: categoryOverwrites.map((overwrite) => ({
          target_type: overwrite.target_type,
          target_id: overwrite.target_id,
          allow: overwrite.allow,
          deny: overwrite.deny,
        })),
      });
      setCategorySyncNotice('Category permissions copied into the draft. Apply to save them.');
    } finally {
      setSyncingFromCategory(false);
    }
  };

  const togglePermission = (bit: number) => {
    if (!draft || !selectedTarget) return;
    const currentState = getPermissionState(selectedOverwrite, bit);
    const nextState = currentState === 'inherit' ? 'allow' : currentState === 'allow' ? 'deny' : 'inherit';
    setDraft({
      ...draft,
      permissionOverwrites: setPermissionState(
        draft.permissionOverwrites,
        selectedTarget.targetType,
        selectedTarget.id,
        bit,
        nextState
      ),
    });
  };

  const insertExpressionIntoName = (value: string) => {
    if (!draft) return;
    const input = nameInputRef.current;
    const start = input?.selectionStart ?? draft.name.length;
    const end = input?.selectionEnd ?? draft.name.length;
    const nextName = `${draft.name.slice(0, start)}${value}${draft.name.slice(end)}`;
    setDraft({ ...draft, name: nextName });
    requestAnimationFrame(() => {
      input?.focus();
      const nextCaret = start + value.length;
      input?.setSelectionRange(nextCaret, nextCaret);
    });
    setExpressionPickerOpen(false);
  };

  const handleApply = async () => {
    if (!draft || !modalData || !draft.name.trim()) return;
    setLoading(true);
    setError('');
    try {
      if (draft.type === 'rules') {
        await api.patch(`/api/channels/${modalData.id}`, {
          name: draft.name.trim(),
          allowDisplayName: true,
        });
        await fetchChannels();
        setInitialDraft({
          ...draft,
          name: draft.name.trim(),
          permissionOverwrites: draft.permissionOverwrites.map((overwrite) => ({ ...overwrite })),
        });
        closeModal();
        return;
      }

      await api.patch(`/api/channels/${modalData.id}`, {
        name: draft.name.trim(),
        description: draft.description.trim(),
        type: draft.type,
        categoryId: draft.categoryId,
        allowDisplayName: draft.allowDisplayName,
        nsfw: draft.nsfw,
        ...(draft.type === 'forum' ? { forumLayout: draft.forumLayout } : {}),
      });

      if (draft.type === 'theater') {
        await api.patch(`/api/theater/${modalData.id}/settings`, {
          theater_max_duration_seconds: draft.theaterMaxDuration,
          theater_open_queuing: draft.theaterOpenQueuing ? 1 : 0,
          theater_auto_advance: draft.theaterAutoAdvance ? 1 : 0,
          theater_reactions_enabled: draft.theaterReactionsEnabled ? 1 : 0,
          theater_skip_voting_enabled: draft.theaterSkipVotingEnabled ? 1 : 0,
          theater_queue_voting_enabled: draft.theaterQueueVotingEnabled ? 1 : 0,
        });
        // Sync domain allowlist: add new ones, remove deleted ones
        const initialDomains = initialDraft?.theaterDomains ?? [];
        const addedDomains = draft.theaterDomains.filter((d) => !initialDomains.includes(d));
        const removedDomains = initialDomains.filter((d) => !draft.theaterDomains.includes(d));
        await Promise.all([
          ...addedDomains.map((d) => api.post(`/api/theater/${modalData.id}/domains`, { domain: d })),
          ...removedDomains.map((d) => api.delete(`/api/theater/${modalData.id}/domains/${encodeURIComponent(d)}`)),
        ]);
      }

      await api.patch(`/api/channels/${modalData.id}/settings`, {
        slowmode: draft.slowmode,
        userLimit: draft.userLimit,
        bitrate: draft.bitrate,
        videoQualityMode: draft.videoQualityMode,
        defaultFramerate: draft.defaultFramerate,
        threadAutoArchive: draft.threadAutoArchive,
        threadCreationCooldown: draft.threadCreationCooldown,
      });

      await api.put(`/api/channels/${modalData.id}/permissions`, {
        overwrites: normalizeOverwrites(draft.permissionOverwrites).map((overwrite) => ({
          targetType: overwrite.target_type,
          targetId: overwrite.target_id,
          allow: overwrite.allow,
          deny: overwrite.deny,
        })),
      });

      await fetchChannels();
      setInitialDraft({
        ...draft,
        permissionOverwrites: draft.permissionOverwrites.map((overwrite) => ({ ...overwrite })),
      });
      closeModal();
    } catch {
      setError('Failed to update channel');
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen || !modalData || !draft) return null;

  const selectedTargetName = selectedTarget?.name ?? 'Select a role or member';
  const categoryName = categories.find((category) => category.id === draft.categoryId)?.name ?? 'Uncategorized';
  const addTargetOptions = (addTargetType === 'role' ? roleTargets : userTargets)
    .filter((target) => !draft.permissionOverwrites.some((overwrite) => overwrite.target_type === addTargetType && overwrite.target_id === target.id));

  return (
    <Modal
      open={isOpen}
      onClose={handleRequestClose}
      title={`Editing ${draft.type === 'voice' ? '' : '#'}${draft.name || modalData.name}`}
      className={`!h-[94vh] !w-[min(96vw,1280px)] !max-w-none ${closeRejected ? 'modal-reject-shake' : ''}`}
      bodyClassName="!p-0 !h-full overflow-hidden"
    >
      <div className="grid h-full min-h-0 gap-6 px-5 pt-5 pb-4 md:grid-cols-[180px_minmax(0,1fr)] xl:grid-cols-[200px_minmax(0,1fr)]">
        <aside className="space-y-4 border-b border-border pb-4 md:border-b-0 md:border-r md:pb-0 md:pr-5">
          <div className="space-y-1">
            {!isSystemRulesChannel && (
              <div className="text-sm text-text-muted">
                Category Linked: <span className="font-medium text-text-primary">{categoryName}</span>
              </div>
            )}
            <div className="flex items-center gap-2 text-sm text-text-secondary">
              {draft.type === 'voice'
                ? <Volume2 className="h-4 w-4" />
                : draft.type === 'rules'
                  ? <ShieldCheck className="h-4 w-4" />
                  : <Hash className="h-4 w-4" />}
              <span className="truncate">{draft.name || modalData.name}</span>
            </div>
          </div>

          <div className="space-y-1">
            <button
              type="button"
              onClick={() => setSection('basic')}
              className={`w-full rounded-lg px-3 py-2 text-left text-sm font-medium transition-colors ${
                section === 'basic'
                  ? 'bg-bg-hover text-text-primary'
                  : 'text-text-secondary hover:bg-bg-hover/40 hover:text-text-primary'
              }`}
            >
              Basic Settings
            </button>
            {!isSystemRulesChannel && (
              <>
                <button
                  type="button"
                  onClick={() => setSection('permissions')}
                  className={`w-full rounded-lg px-3 py-2 text-left text-sm font-medium transition-colors ${
                    section === 'permissions'
                      ? 'bg-bg-hover text-text-primary'
                      : 'text-text-secondary hover:bg-bg-hover/40 hover:text-text-primary'
                  }`}
                >
                  Permissions
                </button>
                <button
                  type="button"
                  onClick={() => setSection('webhooks')}
                  className={`w-full rounded-lg px-3 py-2 text-left text-sm font-medium transition-colors ${
                    section === 'webhooks'
                      ? 'bg-bg-hover text-text-primary'
                      : 'text-text-secondary hover:bg-bg-hover/40 hover:text-text-primary'
                  }`}
                >
                  Webhooks
                </button>
              </>
            )}
          </div>
        </aside>

        <div className="min-w-0 space-y-5 overflow-x-hidden overflow-y-auto pr-3 pb-8">
          <div>
            <div className="text-lg font-semibold text-text-primary">
              {isSystemRulesChannel ? 'Rename System Channel' : section === 'basic' ? 'Basic Settings' : section === 'permissions' ? 'Permissions' : 'Webhooks'}
            </div>
            <div className="mt-1 text-sm text-text-muted">
              {isSystemRulesChannel
                ? 'Realm Rules is a system channel. Only its display name can be changed.'
                : section === 'basic'
                ? 'Edit naming, category, slowmode, and voice defaults for this channel.'
                : section === 'permissions'
                  ? 'Use permissions to customize this channel.'
                  : 'Manage inbound and outbound integrations for this channel.'}
            </div>
          </div>

        {section === 'basic' && (
          <div className="space-y-6 min-w-0">
            <div className="space-y-5">
              <div className="space-y-4">
                    <div className="relative">
                      <Input
                        label="Channel Name"
                        value={draft.name}
                        onChange={(event) => setDraft({ ...draft, name: event.target.value })}
                        placeholder="channel-name"
                        autoFocus
                        ref={nameInputRef}
                      />
                      <button
                        type="button"
                        onClick={() => {
                          setExpressionLoading(false);
                          setExpressionPickerOpen((current) => !current);
                        }}
                        className="absolute right-2 top-[30px] rounded-md border border-border bg-bg-input px-2 py-1 text-sm text-text-secondary transition-colors hover:bg-bg-hover/60 hover:text-text-primary"
                        aria-label="Insert channel-name expression"
                      >
                        <Plus className="h-4 w-4" />
                      </button>
                      {expressionPickerOpen && (
                        <div className="absolute z-20 mt-2 w-full rounded-xl border border-border bg-gray-950/95 p-3 shadow-2xl backdrop-blur-sm">
                          <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-text-secondary">
                            <Sparkles className="h-3.5 w-3.5" />
                            Channel Name Expressions
                          </div>
                          <div className="mb-3 flex flex-wrap gap-2">
                            {DEFAULT_CHANNEL_NAME_EMOJIS.map((emoji) => (
                              <button
                                key={emoji}
                                type="button"
                                onClick={() => insertExpressionIntoName(emoji)}
                                className="rounded-lg border border-border bg-bg-elevated px-3 py-2 text-lg transition-colors hover:bg-bg-hover/40"
                              >
                                {emoji}
                              </button>
                            ))}
                          </div>
                          <div className="max-h-48 space-y-2 overflow-y-auto pr-1">
                            {expressionLoading && <div className="text-xs text-text-muted">Loading server expressions…</div>}
                            {!expressionLoading && serverExpressionEntries.length === 0 && (
                              <div className="text-xs text-text-muted">No server expressions available.</div>
                            )}
                            {!expressionLoading && serverExpressionEntries.length > 0 && (
                              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                                {serverExpressionEntries.map((entry) => (
                                  <button
                                    key={entry.id}
                                    type="button"
                                    onClick={() => insertExpressionIntoName(`:${entry.name}:`)}
                                    className="flex items-center gap-2 rounded-lg border border-border bg-bg-elevated px-2 py-2 text-left transition-colors hover:bg-bg-hover/40"
                                  >
                                    {entry.absolute_url ? (
                                      <img src={entry.absolute_url} alt={entry.name} className="h-6 w-6 rounded object-contain" />
                                    ) : (
                                      <div className="flex h-6 w-6 items-center justify-center rounded bg-bg-input text-xs text-text-muted">:</div>
                                    )}
                                    <span className="truncate text-xs text-text-primary">:{entry.name}:</span>
                                  </button>
                                ))}
                              </div>
                            )}
                          </div>
                        </div>
                      )}
                    </div>

                </div>

                {isSystemRulesChannel ? (
                  <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-100">
                    Realm Rules is managed by the Welcome Board. Rename is the only editable setting.
                  </div>
                ) : (
                  <>
                <div className="flex flex-col gap-1">
                  <label className="text-xs font-semibold uppercase text-text-secondary">Category</label>
                  <select
                    value={draft.categoryId ?? ''}
                    onChange={(event) => setDraft({ ...draft, categoryId: event.target.value || null })}
                    className="w-full rounded-md border border-border bg-bg-input px-3 py-2 text-sm text-text-primary focus:border-accent focus:outline-none"
                  >
                    <option value="">Uncategorized</option>
                    {categories.map((category) => (
                      <option key={category.id} value={category.id}>{category.name}</option>
                    ))}
                  </select>
                </div>

                <Input
                  label="Description (optional)"
                  value={draft.description}
                  onChange={(event) => setDraft({ ...draft, description: event.target.value })}
                  placeholder="What is this channel for?"
                />

                <div className="flex flex-col gap-1">
                  <label className="text-xs font-semibold uppercase text-text-secondary">Slowmode</label>
                  <input
                    type="number"
                    min="0"
                    max="21600"
                    value={draft.slowmode}
                    onChange={(event) => setDraft({
                      ...draft,
                      slowmode: Math.min(21600, Math.max(0, Number(event.target.value) || 0)),
                    })}
                    className="w-full rounded-md border border-border bg-bg-input px-3 py-2 text-sm text-text-primary focus:border-accent focus:outline-none"
                  />
                  <div className="text-xs text-text-muted">0-21600 seconds (0-6 hours). 0 = Off</div>
                </div>

                {supportsThreads && (
                  <div className="flex flex-col gap-1">
                    <label className="text-xs font-semibold uppercase text-text-secondary">Thread Auto-Archive</label>
                    <select
                      value={draft.threadAutoArchive}
                      onChange={(event) => setDraft({ ...draft, threadAutoArchive: Number(event.target.value) })}
                      className="w-full rounded-md border border-border bg-bg-input px-3 py-2 text-sm text-text-primary focus:border-accent focus:outline-none"
                    >
                      {AUTO_ARCHIVE_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>{option.label}</option>
                      ))}
                    </select>
                  </div>
                )}

                {draft.type === 'theater' && (
                  <div className="flex flex-col gap-4 rounded-xl border border-border bg-bg-input/40 p-4">
                    <div className="text-sm font-semibold text-text-primary">Theater Settings</div>

                    <div className="flex flex-col gap-1">
                      <label className="text-xs font-semibold uppercase text-text-secondary">Max Video Duration</label>
                      <select
                        value={draft.theaterMaxDuration}
                        onChange={(e) => setDraft({ ...draft, theaterMaxDuration: Number(e.target.value) })}
                        className="w-full rounded-md border border-border bg-bg-input px-3 py-2 text-sm text-text-primary focus:border-accent focus:outline-none"
                      >
                        <option value={600}>10 minutes</option>
                        <option value={1800}>30 minutes</option>
                        <option value={3600}>1 hour</option>
                        <option value={7200}>2 hours</option>
                        <option value={14400}>4 hours</option>
                        <option value={0}>No limit</option>
                      </select>
                    </div>

                    {([
                      { key: 'theaterOpenQueuing', label: 'Open Video Queuing', desc: 'Any viewer can add videos to the queue' },
                      { key: 'theaterAutoAdvance', label: 'Auto-Advance Queue', desc: 'Automatically play next video when current ends' },
                      { key: 'theaterReactionsEnabled', label: 'Emoji Reactions', desc: 'Allow viewers to send floating emoji reactions' },
                      { key: 'theaterSkipVotingEnabled', label: 'Skip Voting', desc: 'Allow viewers to vote to skip current video' },
                      { key: 'theaterQueueVotingEnabled', label: 'Queue Upvoting', desc: 'Allow viewers to upvote queue items' },
                    ] as const).map(({ key, label, desc }) => (
                      <label key={key} className="flex items-center justify-between gap-3">
                        <div>
                          <div className="text-sm font-medium text-text-primary">{label}</div>
                          <div className="text-xs text-text-muted">{desc}</div>
                        </div>
                        <button
                          type="button"
                          onClick={() => setDraft({ ...draft, [key]: !draft[key] })}
                          className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors ${draft[key] ? 'bg-accent' : 'bg-bg-hover'}`}
                        >
                          <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${draft[key] ? 'translate-x-6' : 'translate-x-1'}`} />
                        </button>
                      </label>
                    ))}

                    <div className="flex flex-col gap-2">
                      <label className="text-xs font-semibold uppercase text-text-secondary">Domain Allowlist</label>
                      <div className="text-xs text-text-muted">Restrict video sources to specific domains. Leave empty to allow all.</div>
                      {draft.theaterDomains.length > 0 && (
                        <div className="flex flex-wrap gap-1.5">
                          {draft.theaterDomains.map((domain) => (
                            <span key={domain} className="flex items-center gap-1 rounded-full bg-bg-hover px-2.5 py-1 text-xs text-text-primary">
                              {domain}
                              <button
                                type="button"
                                onClick={() => setDraft({ ...draft, theaterDomains: draft.theaterDomains.filter((d) => d !== domain) })}
                                className="text-text-muted hover:text-danger transition-colors leading-none"
                              >
                                <X className="h-3 w-3" />
                              </button>
                            </span>
                          ))}
                        </div>
                      )}
                      <div className="flex gap-2">
                        <input
                          type="text"
                          value={newDomain}
                          onChange={(e) => setNewDomain(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              e.preventDefault();
                              const d = newDomain.trim().toLowerCase();
                              if (d && !draft.theaterDomains.includes(d)) {
                                setDraft({ ...draft, theaterDomains: [...draft.theaterDomains, d] });
                              }
                              setNewDomain('');
                            }
                          }}
                          placeholder="e.g. youtube.com"
                          className="flex-1 rounded-md border border-border bg-bg-input px-3 py-1.5 text-sm text-text-primary focus:border-accent focus:outline-none placeholder:text-text-muted"
                        />
                        <button
                          type="button"
                          onClick={() => {
                            const d = newDomain.trim().toLowerCase();
                            if (d && !draft.theaterDomains.includes(d)) {
                              setDraft({ ...draft, theaterDomains: [...draft.theaterDomains, d] });
                            }
                            setNewDomain('');
                          }}
                          disabled={!newDomain.trim()}
                          className="rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-white disabled:opacity-40 hover:bg-accent/90 transition-colors"
                        >
                          Add
                        </button>
                      </div>
                    </div>
                  </div>
                )}

                {draft.type === 'forum' && (
                  <div className="flex flex-col gap-2">
                    <label className="text-xs font-semibold uppercase text-text-secondary">Forum Layout</label>
                    <div className="grid grid-cols-3 gap-2">
                      {([
                        { value: 'list', label: 'List', desc: 'Compact rows' },
                        { value: 'gallery', label: 'Gallery', desc: 'Image grid' },
                        { value: 'user_choice', label: 'User Choice', desc: 'Users decide' },
                      ] as const).map((opt) => (
                        <button
                          key={opt.value}
                          type="button"
                          onClick={() => setDraft({ ...draft, forumLayout: opt.value })}
                          className={`flex flex-col items-center gap-1 px-3 py-2.5 rounded-lg border text-sm transition-colors ${
                            draft.forumLayout === opt.value
                              ? 'border-accent bg-accent/10 text-accent'
                              : 'border-border bg-bg-input text-text-muted hover:border-accent/40 hover:text-text-primary'
                          }`}
                        >
                          <span className="font-medium text-[13px]">{opt.label}</span>
                          <span className="text-[11px] opacity-70">{opt.desc}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                <label className="flex items-center justify-between rounded-xl border border-border bg-bg-input/60 px-4 py-3">
                  <span className="text-sm font-medium text-text-primary">Mark as NSFW (age-restricted)</span>
                  <button
                    type="button"
                    onClick={() => setDraft({ ...draft, nsfw: !draft.nsfw })}
                    className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${draft.nsfw ? 'bg-danger' : 'bg-bg-hover'}`}
                  >
                    <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${draft.nsfw ? 'translate-x-6' : 'translate-x-1'}`} />
                  </button>
                </label>

                <label className="flex items-center justify-between rounded-xl border border-border bg-bg-input/60 px-4 py-3">
                  <span className="text-sm font-medium text-text-primary">Allow Channel Name to Have Spaces & Caps</span>
                  <button
                    type="button"
                    onClick={() => setDraft({ ...draft, allowDisplayName: !draft.allowDisplayName })}
                    className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${draft.allowDisplayName ? 'bg-accent' : 'bg-bg-hover'}`}
                  >
                    <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${draft.allowDisplayName ? 'translate-x-6' : 'translate-x-1'}`} />
                  </button>
                </label>

                <div className="rounded-xl border border-border bg-bg-input/40 px-4 py-3 text-sm text-text-muted">
                  <span className="font-medium text-text-primary">Current Draft:</span>{' '}
                  {categoryName} • {draft.slowmode === 0 ? 'Slowmode Off' : `Slowmode ${draft.slowmode}s`} •{' '}
                  {AUTO_ARCHIVE_OPTIONS.find((option) => option.value === draft.threadAutoArchive)?.label ?? '24 Hours'} •{' '}
                  {draft.allowDisplayName ? 'Display-preserving name' : 'Slugified name'} •{' '}
                  {draft.nsfw ? 'NSFW' : 'SFW'}
                </div>
                  </>
                )}
              </div>

            {draft.type === 'voice' && (
              <div className="border-t border-border pt-5">
                <div className="mb-4 text-lg font-semibold text-text-primary">Voice Defaults</div>
                <div className="space-y-4">
                  <div className="flex flex-col gap-1">
                    <label className="text-xs font-semibold uppercase text-text-secondary">Bitrate</label>
                    <select
                      value={draft.bitrate}
                      onChange={(event) => setDraft({ ...draft, bitrate: Number(event.target.value) })}
                      className="w-full rounded-md border border-border bg-bg-input px-3 py-2 text-sm text-text-primary focus:border-accent focus:outline-none"
                    >
                      {BITRATE_OPTIONS.map((bitrate) => (
                        <option key={bitrate} value={bitrate}>{Math.round(bitrate / 1000)} kbps</option>
                      ))}
                    </select>
                  </div>

                  <div className="flex flex-col gap-1">
                    <label className="text-xs font-semibold uppercase text-text-secondary">User Join Limit</label>
                    <input
                      type="range"
                      min="0"
                      max="99"
                      value={draft.userLimit}
                      onChange={(event) => setDraft({ ...draft, userLimit: Number(event.target.value) })}
                      className="w-full"
                    />
                    <div className="text-xs text-text-muted text-right">{draft.userLimit === 0 ? 'Unlimited' : `${draft.userLimit} users`}</div>
                  </div>

                  <div>
                    <div className="mb-2 text-xs font-semibold uppercase text-text-secondary">Default Video Quality</div>
                    <div className="flex flex-wrap gap-2">
                      {(['720p', '1080p', '1440p'] as const).map((quality) => (
                        <button
                          key={quality}
                          type="button"
                          onClick={() => setDraft({ ...draft, videoQualityMode: quality })}
                          className={`rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                            draft.videoQualityMode === quality
                              ? 'bg-accent text-white'
                              : 'bg-bg-input text-text-secondary hover:bg-bg-hover/60 hover:text-text-primary'
                          }`}
                        >
                          {quality}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div>
                    <div className="mb-2 text-xs font-semibold uppercase text-text-secondary">Default Framerate</div>
                    <div className="flex flex-wrap gap-2">
                      {([24, 48, 60] as const).map((fps) => (
                        <button
                          key={fps}
                          type="button"
                          onClick={() => setDraft({ ...draft, defaultFramerate: fps })}
                          className={`rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                            draft.defaultFramerate === fps
                              ? 'bg-accent text-white'
                              : 'bg-bg-input text-text-secondary hover:bg-bg-hover/60 hover:text-text-primary'
                          }`}
                        >
                          {fps} fps
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {section === 'permissions' && (
          <div className="space-y-6">
            <div className={`flex flex-col gap-3 rounded-xl border px-4 py-3 md:flex-row md:items-center md:justify-between ${
                syncStatus === 'synced'
                  ? 'border-emerald-500/30 bg-emerald-500/10'
                  : syncStatus === 'unsynced'
                    ? 'border-amber-500/30 bg-amber-500/10'
                    : 'border-border bg-bg-input/60'
              }`}>
                <div className="flex items-start gap-3">
                  {syncStatus === 'synced' ? <CheckCircle2 className="mt-0.5 h-5 w-5 text-emerald-300" /> : <AlertTriangle className="mt-0.5 h-5 w-5 text-amber-300" />}
                  <div>
                    {draft.categoryId ? (
                      syncStatus === 'synced'
                        ? <div className="text-sm font-semibold text-emerald-100">Permissions synced with category: "{categoryName}"</div>
                        : <div className="text-sm font-semibold text-amber-100">Permissions not synced with category: "{categoryName}"</div>
                    ) : (
                      <div className="text-sm font-semibold text-text-primary">Channel is not linked to a category</div>
                    )}
                    <div className="mt-1 text-xs text-text-muted">
                      {draft.categoryId ? 'Copy category overwrites into this draft or keep the channel customized.' : 'Assign a category to compare or sync permissions.'}
                    </div>
                  </div>
                </div>
                <Button
                  type="button"
                  variant="secondary"
                  disabled={!draft.categoryId || syncingFromCategory}
                  onClick={syncFromCategory}
                >
                  {syncingFromCategory ? 'Syncing…' : 'Sync Now'}
                </Button>
            </div>

            <div className="flex items-center justify-between rounded-xl border border-border bg-bg-input/60 px-4 py-4">
              <div className="pr-4">
                <div className="flex items-center gap-2 text-sm font-semibold text-text-primary">
                  {isPrivateChannel ? <Lock className="h-4 w-4 text-emerald-300" /> : <Lock className="h-4 w-4 text-text-muted" />}
                  Private Channel
                </div>
                <div className="mt-1 text-xs text-text-muted">
                  By making this channel private, only selected roles or members are able to view.
                </div>
              </div>
              <button
                type="button"
                onClick={() => applyPrivateChannel(!isPrivateChannel)}
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${isPrivateChannel ? 'bg-emerald-500' : 'bg-bg-hover'}`}
              >
                <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${isPrivateChannel ? 'translate-x-6' : 'translate-x-1'}`} />
              </button>
            </div>

            <div className="grid gap-6 xl:grid-cols-[320px_minmax(0,1fr)]">
                <div className="space-y-4">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="text-sm font-semibold text-text-primary">Who can access this channel?</div>
                      <div className="text-xs text-text-muted">Add a role or member, then tune their permissions.</div>
                    </div>
                  </div>

                  <div className="flex flex-col gap-2">
                    <select
                      value={addTargetType}
                      onChange={(event) => {
                        setAddTargetType(event.target.value as 'role' | 'user');
                        setAddTargetId('');
                      }}
                      className="rounded-md border border-border bg-bg-input px-3 py-2 text-sm text-text-primary focus:border-accent focus:outline-none"
                    >
                      <option value="role">Role</option>
                      <option value="user">Member</option>
                    </select>
                    <select
                      value={addTargetId}
                      onChange={(event) => setAddTargetId(event.target.value)}
                      className="w-full rounded-md border border-border bg-bg-input px-3 py-2 text-sm text-text-primary focus:border-accent focus:outline-none"
                    >
                      <option value="">Add A Role / Member</option>
                      {addTargetOptions.map((target) => (
                        <option key={target.id} value={target.id}>{target.name}</option>
                      ))}
                    </select>
                    <Button type="button" variant="secondary" onClick={addAccessTarget} disabled={!addTargetId}>
                      Add
                    </Button>
                  </div>

                  <div className="space-y-3">
                    <div className="border-t border-border pt-3">
                      <div className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-text-secondary">Roles</div>
                      <div className="space-y-2">
                        {visibleRoleEntries.map((role) => {
                          const protectedEntry = !!role.is_default || hasPermissionBit(role.permissions, PERMISSIONS.ADMINISTRATOR);
                          const protectedRoleReason = role.is_default
                            ? 'Default role cannot be removed.'
                            : hasPermissionBit(role.permissions, PERMISSIONS.ADMINISTRATOR)
                              ? `${role.name} role cannot be removed because it has Co-Owner Permissions Enabled.`
                              : 'Remove access to channel';
                          const overwrite = draft.permissionOverwrites.find((entry) => entry.target_type === 'role' && entry.target_id === role.id);
                          const canView = getPermissionState(overwrite, PERMISSIONS.VIEW_CHANNELS) !== 'deny';
                          return (
                            <button
                              key={role.id}
                              type="button"
                              onClick={() => setSelectedTargetKey(overwriteKey('role', role.id))}
                            className={`w-full rounded-xl border px-3 py-3 text-left transition-colors ${
                                selectedTargetKey === overwriteKey('role', role.id)
                                  ? 'border-accent bg-accent/8'
                                  : 'border-border/70 bg-transparent hover:bg-bg-hover/20'
                              }`}
                            >
                              <div className="flex items-start justify-between gap-3">
                                <div>
                                  <div className="text-sm font-semibold text-text-primary">{role.name}</div>
                                  <div className="mt-1 text-xs text-text-muted">
                                    {role.is_default ? 'Default members role' : hasPermissionBit(role.permissions, PERMISSIONS.ADMINISTRATOR) ? 'Administrator' : 'Role'}
                                  </div>
                                </div>
                                <div className="flex items-center gap-2">
                                  <span className={`rounded-full px-2 py-1 text-[11px] font-semibold ${canView ? 'bg-emerald-500/15 text-emerald-300' : 'bg-bg-input text-text-muted'}`}>
                                    {canView ? 'Access' : 'Blocked'}
                                  </span>
                                  <span title={protectedEntry ? protectedRoleReason : 'Remove access to channel'}>
                                    <button
                                      type="button"
                                      disabled={protectedEntry}
                                      onClick={(event) => {
                                        event.stopPropagation();
                                        removeAccessTarget('role', role.id, protectedEntry);
                                      }}
                                      className="rounded-md bg-bg-input/70 px-2 py-1 text-xs text-text-secondary transition-colors hover:bg-danger/20 hover:text-danger disabled:cursor-not-allowed disabled:opacity-50"
                                      aria-label={protectedEntry ? protectedRoleReason : 'Remove access to channel'}
                                    >
                                      X
                                    </button>
                                  </span>
                                </div>
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    <div className="border-t border-border pt-3">
                      <div className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-text-secondary">Members</div>
                      <div className="space-y-2">
                        {visibleUserEntries.map((user) => {
                          const protectedEntry = !!user.isOwner;
                          const overwrite = draft.permissionOverwrites.find((entry) => entry.target_type === 'user' && entry.target_id === user.id);
                          const canView = getPermissionState(overwrite, PERMISSIONS.VIEW_CHANNELS) !== 'deny';
                          return (
                            <button
                              key={user.id}
                              type="button"
                              onClick={() => setSelectedTargetKey(overwriteKey('user', user.id))}
                            className={`w-full rounded-xl border px-3 py-3 text-left transition-colors ${
                                selectedTargetKey === overwriteKey('user', user.id)
                                  ? 'border-accent bg-accent/8'
                                  : 'border-border/70 bg-transparent hover:bg-bg-hover/20'
                              }`}
                            >
                              <div className="flex items-start justify-between gap-3">
                                <div>
                                  <div className="text-sm font-semibold text-text-primary">{user.name}</div>
                                  <div className="mt-1 text-xs text-text-muted">{user.isOwner ? 'Server Owner' : 'Member'}</div>
                                </div>
                                <div className="flex items-center gap-2">
                                  <span className={`rounded-full px-2 py-1 text-[11px] font-semibold ${canView ? 'bg-emerald-500/15 text-emerald-300' : 'bg-bg-input text-text-muted'}`}>
                                    {canView ? 'Access' : 'Blocked'}
                                  </span>
                                  <span title={protectedEntry ? 'Server owner cannot be removed.' : 'Remove access to channel'}>
                                    <button
                                      type="button"
                                      disabled={protectedEntry}
                                      onClick={(event) => {
                                        event.stopPropagation();
                                        removeAccessTarget('user', user.id, protectedEntry);
                                      }}
                                      className="rounded-md bg-bg-input/70 px-2 py-1 text-xs text-text-secondary transition-colors hover:bg-danger/20 hover:text-danger disabled:cursor-not-allowed disabled:opacity-50"
                                      aria-label={protectedEntry ? 'Server owner cannot be removed.' : 'Remove access to channel'}
                                    >
                                      X
                                    </button>
                                  </span>
                                </div>
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                </div>

                <div className="space-y-4 border-l border-border/70 pl-5">
                      <div className="border-b border-border/70 pb-3">
                        <div className="flex items-center gap-2 text-sm font-semibold text-text-primary">
                          {selectedTarget?.targetType === 'role' ? <Shield className="h-4 w-4" /> : <Users className="h-4 w-4" />}
                          {selectedTargetName}
                        </div>
                        <div className="mt-1 text-xs text-text-muted">
                          Adjust every permission for the selected role or member. Changes stay in the draft until Apply.
                        </div>
                      </div>

                      <div className="max-h-[620px] space-y-4 overflow-y-auto pr-1">
                        {CHANNEL_OVERWRITE_CATEGORY_KEYS.map((key) => {
                          const category = PERMISSION_CATEGORIES[key];
                          return (
                            <section key={key} className="border-b border-border/60 pb-4 last:border-b-0">
                              <h3 className="mb-3 text-sm font-semibold text-text-primary">{category.title}</h3>
                              <div className="space-y-2">
                                {category.permissions.map((permission) => {
                                  const state = getPermissionState(selectedOverwrite, permission.bit);
                                  return (
                                    <button
                                      key={permission.bit}
                                      type="button"
                                      onClick={() => togglePermission(permission.bit)}
                                      className="flex w-full items-center justify-between gap-4 rounded-lg border border-transparent bg-transparent px-3 py-3 text-left transition-colors hover:border-border/60 hover:bg-bg-hover/20"
                                    >
                                      <div>
                                        <div className="text-sm font-medium text-text-primary">{permission.label}</div>
                                        <div className="text-xs text-text-muted">{permission.description}</div>
                                      </div>
                                      <div className={`min-w-[104px] rounded-md px-3 py-2 text-center text-xs font-semibold ${
                                        state === 'allow'
                                          ? 'bg-emerald-500/15 text-emerald-300'
                                          : state === 'deny'
                                            ? 'bg-danger/15 text-danger'
                                            : 'bg-bg-input/70 text-text-muted'
                                      }`}>
                                        {state === 'allow' ? 'Allow' : state === 'deny' ? 'Deny' : 'Inherit'}
                                      </div>
                                    </button>
                                  );
                                })}
                              </div>
                            </section>
                          );
                        })}
                      </div>
                </div>
              </div>
          </div>
        )}

        {section === 'webhooks' && (
          <WebhookManager
            scopeType="channel"
            scopeId={modalData.id}
            title="Channel Webhooks"
            description="Use a channel webhook when an external service should post into this single channel and receive outbound callbacks for messages created here."
          />
        )}

        {permissionsLoading && (
          <div className="text-sm text-text-muted">Loading channel permissions…</div>
        )}
        {permissionsError && <p className="text-sm text-danger">{permissionsError}</p>}
        {categorySyncNotice && !permissionsError && <p className="text-sm text-success">{categorySyncNotice}</p>}
        {error && <p className="text-sm text-danger">{error}</p>}
        {initializing && <p className="text-sm text-text-muted">Preparing channel editor…</p>}
        </div>
      </div>

      {hasUnsavedChanges && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[60] pointer-events-none flex justify-center w-full px-4">
          <div className="unsaved-changes-bar pointer-events-auto flex items-center gap-4 px-5 py-3 rounded-xl bg-gray-950/95 border border-purple-700/40 backdrop-blur-sm">
            <span className="unsaved-warning-text text-sm font-semibold whitespace-nowrap">
              Current Changes are NOT saved!
            </span>
            <div className="flex items-center gap-2 ml-2">
              <button
                type="button"
                onClick={resetDraft}
                disabled={loading}
                className="px-4 py-1.5 rounded-lg bg-red-700 hover:bg-red-600 text-white text-sm font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed border border-red-600/50"
              >
                Discard
              </button>
              <button
                type="button"
                onClick={() => { void handleApply(); }}
                disabled={loading || !draft.name.trim()}
                className="discover-nav-button px-4 py-1.5 rounded-lg bg-[#7c5cff] hover:bg-[#6a4de0] text-white text-sm font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed border border-purple-500/40"
              >
                {loading ? 'Saving…' : 'Apply'}
              </button>
            </div>
          </div>
        </div>
      )}
    </Modal>
  );
}
