import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  ScrollText,
  RefreshCw,
  X,
  ChevronDown,
  UserRound,
  MessageSquare,
  Hash,
  Shield,
  Settings,
  Link as LinkIcon,
  Webhook,
  SmilePlus,
  Bot,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { api } from '../../../lib/api';
import { useAuthStore } from '../../../stores/authStore';
import { useSettingsStore } from '../../../stores/settingsStore';
import { resolveAvatarUrl } from '../../../utils/avatar';

interface AuditLogEntry {
  id: string;
  action_type: string;
  moderator_id: string | null;
  target_id: string | null;
  target_type: string | null;
  channel_id: string | null;
  details: any;
  created_at: number;
}

interface AuditUserInfo {
  username: string;
  display_name: string | null;
  avatar: string | null;
}

interface MemberOption {
  id: string;
  username: string;
  avatar: string | null;
}

// Groups mirror the server's AUDIT_ACTIONS constants; legacy lowercase values
// map onto the Server group for display.
const ACTION_GROUPS: { key: string; icon: typeof UserRound; actions: string[] }[] = [
  {
    key: 'member',
    icon: UserRound,
    actions: [
      'MEMBER_KICK',
      'MEMBER_BAN',
      'MEMBER_UNBAN',
      'MEMBER_TIMEOUT',
      'MEMBER_TIMEOUT_REMOVE',
      'MEMBER_JOIN',
      'MEMBER_LEAVE',
      'MEMBER_NICKNAME_UPDATE',
      'MEMBER_ROLES_UPDATE',
      'MEMBER_BASE_ROLE_UPDATE',
      'MEMBER_VOICE_MUTE',
      'MEMBER_VOICE_DISCONNECT',
      'MEMBER_VOICE_MOVE',
    ],
  },
  { key: 'message', icon: MessageSquare, actions: ['MESSAGE_DELETE'] },
  {
    key: 'channel',
    icon: Hash,
    actions: [
      'CHANNEL_CREATE',
      'CHANNEL_UPDATE',
      'CHANNEL_DELETE',
      'CHANNEL_OVERWRITE_CREATE',
      'CHANNEL_OVERWRITE_UPDATE',
      'CHANNEL_OVERWRITE_DELETE',
      'CATEGORY_CREATE',
      'CATEGORY_UPDATE',
      'CATEGORY_DELETE',
      'CATEGORY_OVERWRITE_CREATE',
      'CATEGORY_OVERWRITE_UPDATE',
      'CATEGORY_OVERWRITE_DELETE',
    ],
  },
  { key: 'role', icon: Shield, actions: ['ROLE_CREATE', 'ROLE_UPDATE', 'ROLE_DELETE'] },
  {
    key: 'server',
    icon: Settings,
    actions: [
      'SERVER_UPDATE',
      'SERVER_ICON_UPDATE',
      'SERVER_BANNER_UPDATE',
      'MODERATION_SETTINGS_UPDATE',
      'TEMPLATE_IMPORT',
      'AUDIT_RETENTION_UPDATE',
      'theater_youtube_cookies_updated',
      'theater_youtube_cookies_cleared',
    ],
  },
  { key: 'invite', icon: LinkIcon, actions: ['INVITE_CREATE', 'INVITE_DELETE'] },
  { key: 'webhook', icon: Webhook, actions: ['WEBHOOK_CREATE', 'WEBHOOK_UPDATE', 'WEBHOOK_DELETE'] },
  {
    key: 'bot',
    icon: Bot,
    actions: ['BOT_CREATE', 'BOT_UPDATE', 'BOT_DELETE', 'BOT_TOKEN_REGENERATE', 'BOT_ENABLE', 'BOT_DISABLE'],
  },
  {
    key: 'expression',
    icon: SmilePlus,
    actions: ['EXPRESSION_CREATE', 'EXPRESSION_UPDATE', 'EXPRESSION_DELETE'],
  },
];

const ACTION_ICON_BY_TYPE = new Map<string, typeof UserRound>(
  ACTION_GROUPS.flatMap((g) => g.actions.map((a) => [a, g.icon] as [string, typeof UserRound]))
);

const RETENTION_OPTIONS: (number | null)[] = [30, 90, 365, null];

function formatActionType(actionType: string) {
  // Handles both canonical UPPER_SNAKE and legacy lowercase values.
  return actionType
    .split('_')
    .map((w) => (w ? w.charAt(0).toUpperCase() + w.slice(1).toLowerCase() : w))
    .join(' ');
}

function formatDetailValue(value: any): string {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function DetailsBlock({ details }: { details: any }) {
  if (!details || typeof details !== 'object') return null;

  const { changes, before, after, ...rest } = details;
  const rows: { label: string; value: string }[] = [];

  for (const [key, value] of Object.entries(rest)) {
    rows.push({ label: formatActionType(key), value: formatDetailValue(value) });
  }
  if (before !== undefined || after !== undefined) {
    rows.push({ label: 'Change', value: `${formatDetailValue(before)} → ${formatDetailValue(after)}` });
  }
  if (changes && typeof changes === 'object') {
    for (const [field, change] of Object.entries<any>(changes)) {
      rows.push({
        label: formatActionType(field),
        value: `${formatDetailValue(change?.before)} → ${formatDetailValue(change?.after)}`,
      });
    }
  }

  if (rows.length === 0) return null;
  return (
    <div className="mt-1 text-sm text-gray-400 space-y-0.5">
      {rows.map((row, i) => (
        <div key={i} className="break-all">
          <span className="text-gray-500">{row.label}:</span> {row.value}
        </div>
      ))}
    </div>
  );
}

export function AuditLogSection() {
  const { t } = useTranslation();
  const user = useAuthStore((s) => s.user);
  const timeFormat = useSettingsStore((s) => s.timeFormat);

  const [entries, setEntries] = useState<AuditLogEntry[]>([]);
  const [usersMap, setUsersMap] = useState<Record<string, AuditUserInfo>>({});
  const [cursor, setCursor] = useState<string | null>(null);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [selectedActions, setSelectedActions] = useState<string[]>([]);
  const [actorId, setActorId] = useState<string>('');
  const [afterDate, setAfterDate] = useState<string>('');
  const [beforeDate, setBeforeDate] = useState<string>('');
  const [actionMenuOpen, setActionMenuOpen] = useState(false);
  const actionMenuRef = useRef<HTMLDivElement | null>(null);

  // Actor picker options
  const [members, setMembers] = useState<MemberOption[]>([]);

  // Retention (owner only)
  const [retentionDays, setRetentionDays] = useState<number | null>(null);
  const [retentionLoaded, setRetentionLoaded] = useState(false);
  const [retentionSaving, setRetentionSaving] = useState(false);

  const buildQuery = useCallback(
    (withCursor: string | null) => {
      const params = new URLSearchParams();
      params.set('limit', '50');
      if (selectedActions.length > 0) params.set('action_types', selectedActions.join(','));
      if (actorId) params.set('actor_id', actorId);
      if (afterDate) params.set('after', String(Math.floor(new Date(`${afterDate}T00:00:00`).getTime() / 1000)));
      if (beforeDate) params.set('before', String(Math.floor(new Date(`${beforeDate}T23:59:59`).getTime() / 1000)));
      if (withCursor) params.set('cursor', withCursor);
      return params.toString();
    },
    [selectedActions, actorId, afterDate, beforeDate]
  );

  const loadEntries = useCallback(
    async (append: boolean) => {
      try {
        setLoading(true);
        setError(null);
        const data = await api.get(`/api/moderation/audit-log?${buildQuery(append ? cursor : null)}`);
        setEntries((prev) => (append ? [...prev, ...data.logs] : data.logs));
        setUsersMap((prev) => ({ ...prev, ...(data.users || {}) }));
        setCursor(data.cursor ?? null);
        setTotal(data.total ?? 0);
      } catch (err: any) {
        setError(err.response?.data?.error || 'Failed to load audit log');
        console.error('Failed to load audit log:', err);
      } finally {
        setLoading(false);
      }
    },
    [buildQuery, cursor]
  );

  useEffect(() => {
    loadEntries(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedActions, actorId, afterDate, beforeDate]);

  useEffect(() => {
    // Members list feeds the actor filter; requires MANAGE_ROLES, so ignore failures.
    api
      .get('/api/admin/users')
      .then((data) => setMembers(data.map((m: any) => ({ id: m.id, username: m.username, avatar: m.avatar }))))
      .catch(() => {});
    api
      .get('/api/moderation/audit-log/retention')
      .then((data) => {
        setRetentionDays(data.retention_days ?? null);
        setRetentionLoaded(true);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!actionMenuOpen) return;
    const onClick = (e: MouseEvent) => {
      if (actionMenuRef.current && !actionMenuRef.current.contains(e.target as Node)) {
        setActionMenuOpen(false);
      }
    };
    window.addEventListener('mousedown', onClick);
    return () => window.removeEventListener('mousedown', onClick);
  }, [actionMenuOpen]);

  const formatTimestamp = (timestamp: number) => {
    const date = new Date(timestamp * 1000);
    const hour12 = timeFormat !== '24';
    return date.toLocaleString('en-US', { hour12, hourCycle: hour12 ? 'h12' : 'h23' });
  };

  const toggleAction = (action: string) => {
    setSelectedActions((prev) =>
      prev.includes(action) ? prev.filter((a) => a !== action) : [...prev, action]
    );
  };

  const toggleGroup = (actions: string[]) => {
    setSelectedActions((prev) => {
      const allSelected = actions.every((a) => prev.includes(a));
      if (allSelected) return prev.filter((a) => !actions.includes(a));
      return [...prev, ...actions.filter((a) => !prev.includes(a))];
    });
  };

  const clearFilters = () => {
    setSelectedActions([]);
    setActorId('');
    setAfterDate('');
    setBeforeDate('');
  };

  const hasFilters = selectedActions.length > 0 || !!actorId || !!afterDate || !!beforeDate;

  const actorName = (id: string | null) => {
    if (!id) return t('admin.systemLabel');
    const info = usersMap[id];
    if (info) return info.display_name || info.username;
    const member = members.find((m) => m.id === id);
    return member?.username ?? id;
  };

  const saveRetention = async (value: number | null) => {
    try {
      setRetentionSaving(true);
      await api.put('/api/moderation/audit-log/retention', { retention_days: value });
      setRetentionDays(value);
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to update retention');
    } finally {
      setRetentionSaving(false);
    }
  };

  const retentionLabel = (value: number | null) =>
    value === null ? t('admin.auditRetentionForever') : t('admin.auditRetentionDays', { count: value });

  const actionFilterLabel = useMemo(() => {
    if (selectedActions.length === 0) return t('admin.auditFilterAllActions');
    if (selectedActions.length === 1) return formatActionType(selectedActions[0]);
    return t('admin.auditFilterNActions', { count: selectedActions.length });
  }, [selectedActions, t]);

  return (
    <div className="max-w-5xl">
      <div className="mb-6 flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-2xl font-bold text-gray-100 mb-2 flex items-center gap-2">
            <ScrollText className="w-6 h-6 text-blue-500" />
            {t('admin.auditLog')}
          </h2>
          <p className="text-gray-400">{t('admin.auditLogDesc')}</p>
        </div>

        {user?.isOwner && retentionLoaded && (
          <div className="flex items-center gap-2">
            <label className="text-sm text-gray-400">{t('admin.auditRetentionLabel')}</label>
            <select
              value={retentionDays === null ? 'forever' : String(retentionDays)}
              disabled={retentionSaving}
              onChange={(e) => saveRetention(e.target.value === 'forever' ? null : parseInt(e.target.value))}
              className="px-3 py-1.5 bg-gray-900 border border-gray-700 rounded-lg text-sm text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              {RETENTION_OPTIONS.map((opt) => (
                <option key={String(opt)} value={opt === null ? 'forever' : String(opt)}>
                  {retentionLabel(opt)}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      {/* Filter bar */}
      <div className="flex flex-wrap items-center gap-2 mb-4">
        {/* Action type multi-select */}
        <div className="relative" ref={actionMenuRef}>
          <button
            onClick={() => setActionMenuOpen((o) => !o)}
            className="flex items-center gap-2 px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-gray-200 hover:bg-gray-700/70 transition-colors"
          >
            <span>{actionFilterLabel}</span>
            <ChevronDown className="w-4 h-4 text-gray-400" />
          </button>
          {actionMenuOpen && (
            <div className="absolute z-20 mt-1 w-72 max-h-96 overflow-y-auto bg-gray-800 border border-gray-700 rounded-lg shadow-xl p-2">
              {ACTION_GROUPS.map((group) => {
                const GroupIcon = group.icon;
                const allSelected = group.actions.every((a) => selectedActions.includes(a));
                return (
                  <div key={group.key} className="mb-2">
                    <button
                      onClick={() => toggleGroup(group.actions)}
                      className={`w-full flex items-center gap-2 px-2 py-1.5 rounded text-sm font-semibold transition-colors ${
                        allSelected ? 'text-blue-400 bg-blue-600/10' : 'text-gray-300 hover:bg-gray-700/50'
                      }`}
                    >
                      <GroupIcon className="w-4 h-4" />
                      {t(`admin.auditGroup_${group.key}`)}
                    </button>
                    <div className="ml-4 mt-0.5 space-y-0.5">
                      {group.actions.map((action) => (
                        <label
                          key={action}
                          className="flex items-center gap-2 px-2 py-1 rounded text-sm text-gray-300 hover:bg-gray-700/50 cursor-pointer"
                        >
                          <input
                            type="checkbox"
                            checked={selectedActions.includes(action)}
                            onChange={() => toggleAction(action)}
                            className="accent-blue-600"
                          />
                          {formatActionType(action)}
                        </label>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Actor picker */}
        {members.length > 0 ? (
          <select
            value={actorId}
            onChange={(e) => setActorId(e.target.value)}
            className="px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500 max-w-[200px]"
          >
            <option value="">{t('admin.auditFilterAllActors')}</option>
            {members.map((m) => (
              <option key={m.id} value={m.id}>
                {m.username}
              </option>
            ))}
          </select>
        ) : (
          <input
            type="text"
            value={actorId}
            onChange={(e) => setActorId(e.target.value)}
            placeholder={t('admin.auditFilterActorId')}
            className="px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500 w-40"
          />
        )}

        {/* Date range */}
        <input
          type="date"
          value={afterDate}
          onChange={(e) => setAfterDate(e.target.value)}
          className="px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
          aria-label={t('admin.auditFilterAfter')}
        />
        <span className="text-gray-500 text-sm">→</span>
        <input
          type="date"
          value={beforeDate}
          onChange={(e) => setBeforeDate(e.target.value)}
          className="px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
          aria-label={t('admin.auditFilterBefore')}
        />

        {hasFilters && (
          <button
            onClick={clearFilters}
            className="flex items-center gap-1 px-3 py-2 text-sm text-gray-400 hover:text-gray-200 transition-colors"
          >
            <X className="w-4 h-4" />
            {t('admin.auditClearFilters')}
          </button>
        )}

        <div className="flex-1" />

        <span className="text-xs text-gray-500">{t('admin.auditTotalEntries', { count: total })}</span>
        <button
          onClick={() => loadEntries(false)}
          disabled={loading}
          className="flex items-center gap-1.5 px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-gray-200 hover:bg-gray-700/70 disabled:opacity-50 transition-colors"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          {t('admin.auditRefresh')}
        </button>
      </div>

      {error && (
        <div className="p-4 mb-4 rounded-lg bg-red-900/20 border border-red-600/30 text-red-400">{error}</div>
      )}

      {/* Entries */}
      <div className="space-y-2">
        {entries.length === 0 && !loading ? (
          <div className="text-center py-12 text-gray-400">{t('admin.noAuditLog')}</div>
        ) : (
          entries.map((entry) => {
            const Icon = ACTION_ICON_BY_TYPE.get(entry.action_type) ?? Settings;
            const actorInfo = entry.moderator_id ? usersMap[entry.moderator_id] : null;
            const avatarUrl = actorInfo ? resolveAvatarUrl(actorInfo.avatar) : null;
            const targetIsUser = entry.target_type === 'user' && entry.target_id;
            return (
              <div key={entry.id} className="p-4 rounded-lg bg-gray-800/30 border border-gray-700/30">
                <div className="flex items-start gap-3">
                  <div className="p-2 rounded-lg bg-gray-700/40 shrink-0">
                    <Icon className="w-4 h-4 text-blue-400" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5 flex-wrap">
                      <span className="font-medium text-gray-200">{formatActionType(entry.action_type)}</span>
                      <span className="text-xs px-2 py-0.5 rounded-full bg-blue-600/20 text-blue-400 flex items-center gap-1">
                        {avatarUrl && (
                          <img src={avatarUrl} alt="" className="w-3.5 h-3.5 rounded-full object-cover" />
                        )}
                        {actorName(entry.moderator_id)}
                      </span>
                      {targetIsUser && (
                        <span className="text-xs px-2 py-0.5 rounded-full bg-gray-600/30 text-gray-300">
                          → {actorName(entry.target_id)}
                        </span>
                      )}
                    </div>
                    <DetailsBlock details={entry.details} />
                  </div>
                  <div className="text-xs text-gray-500 shrink-0">{formatTimestamp(entry.created_at)}</div>
                </div>
              </div>
            );
          })
        )}
      </div>

      {cursor && (
        <div className="flex justify-center mt-4">
          <button
            onClick={() => loadEntries(true)}
            disabled={loading}
            className="px-6 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-gray-200 hover:bg-gray-700/70 disabled:opacity-50 transition-colors"
          >
            {loading ? t('common.loading') : t('admin.auditLoadMore')}
          </button>
        </div>
      )}
    </div>
  );
}
