import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, Shield, Users } from 'lucide-react';
import { useChannelStore } from '../../stores/channelStore';
import { useUIStore } from '../../stores/uiStore';
import { Modal } from '../ui/Modal';
import { Input } from '../ui/Input';
import { Button } from '../ui/Button';
import { api } from '../../lib/api';
import { CHANNEL_OVERWRITE_CATEGORY_KEYS, PERMISSION_CATEGORIES } from './permissionDefinitions';
import { PERMISSIONS } from '../../utils/permissions';
import type { Category, Role } from '../../types';
import { WebhookManager } from './WebhookManager';

interface PermissionOverwrite {
  id?: string;
  category_id?: string;
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

interface UserListEntry {
  id: string;
  username?: string | null;
  displayName?: string | null;
  isOwner?: boolean;
}

type Section = 'basic' | 'permissions' | 'webhooks';
type TargetKey = `role:${string}` | `user:${string}`;

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
    .sort((a, b) => overwriteKey(a.target_type, a.target_id).localeCompare(overwriteKey(b.target_type, b.target_id)));
}

function overwritesEqual(a: PermissionOverwrite[], b: PermissionOverwrite[]) {
  return JSON.stringify(normalizeOverwrites(a)) === JSON.stringify(normalizeOverwrites(b));
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

export function EditCategoryModal() {
  const activeModal = useUIStore((s) => s.activeModal);
  const modalData = useUIStore((s) => s.modalData) as Category | null;
  const closeModal = useUIStore((s) => s.closeModal);
  const updateCategory = useChannelStore((s) => s.updateCategory);
  const fetchChannels = useChannelStore((s) => s.fetchChannels);
  const isOpen = activeModal === 'editCategory';

  const [section, setSection] = useState<Section>('basic');
  const [name, setName] = useState('');
  const [initialName, setInitialName] = useState('');
  const [permissionOverwrites, setPermissionOverwrites] = useState<PermissionOverwrite[]>([]);
  const [initialPermissionOverwrites, setInitialPermissionOverwrites] = useState<PermissionOverwrite[]>([]);
  const [roleTargets, setRoleTargets] = useState<RoleTarget[]>([]);
  const [userTargets, setUserTargets] = useState<UserTarget[]>([]);
  const [selectedTargetKey, setSelectedTargetKey] = useState<TargetKey | null>(null);
  const [newTargetType, setNewTargetType] = useState<'role' | 'user'>('role');
  const [newTargetId, setNewTargetId] = useState('');
  const [permissionsLoading, setPermissionsLoading] = useState(false);
  const [permissionsError, setPermissionsError] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [closeRejected, setCloseRejected] = useState(false);

  const closeRejectTimerRef = useRef<number | null>(null);

  const defaultRole = roleTargets.find((role) => !!role.is_default) ?? null;
  const ownerUser = userTargets.find((user) => user.isOwner) ?? null;

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
    if (!selectedTarget) return undefined;
    return permissionOverwrites.find((overwrite) => (
      overwrite.target_type === selectedTarget.targetType && overwrite.target_id === selectedTarget.id
    ));
  }, [permissionOverwrites, selectedTarget]);

  const hasUnsavedChanges = useMemo(() => {
    return name.trim() !== initialName.trim() || !overwritesEqual(permissionOverwrites, initialPermissionOverwrites);
  }, [initialName, initialPermissionOverwrites, name, permissionOverwrites]);

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
      .filter((role) => permissionOverwrites.some((overwrite) => overwrite.target_type === 'role' && overwrite.target_id === role.id))
      .forEach(pushRole);
    return entries;
  }, [defaultRole, permissionOverwrites, roleTargets]);

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
      .filter((user) => permissionOverwrites.some((overwrite) => overwrite.target_type === 'user' && overwrite.target_id === user.id))
      .forEach(pushUser);
    return entries;
  }, [ownerUser, permissionOverwrites, userTargets]);

  const addTargetOptions = (newTargetType === 'role' ? roleTargets : userTargets)
    .filter((target) => !permissionOverwrites.some((overwrite) => overwrite.target_type === newTargetType && overwrite.target_id === target.id));

  useEffect(() => {
    if (!isOpen || !modalData) return;
    let cancelled = false;
    setSection('basic');
    setNewTargetType('role');
    setNewTargetId('');
    setError('');
    setPermissionsError('');
    setPermissionsLoading(true);

    void Promise.all([
      api.get(`/api/categories/${modalData.id}/permissions`),
      api.get('/api/roles?all=1').catch(() => api.get('/api/roles')),
      api.get('/api/users'),
    ]).then(([overwrites, roles, users]) => {
      if (cancelled) return;
      const nextOverwrites = Array.isArray(overwrites) ? overwrites.map((overwrite: PermissionOverwrite) => ({
        ...overwrite,
        allow: Math.trunc(overwrite.allow || 0),
        deny: Math.trunc(overwrite.deny || 0),
      })) : [];
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
      setName(modalData.name);
      setInitialName(modalData.name);
      setPermissionOverwrites(nextOverwrites);
      setInitialPermissionOverwrites(nextOverwrites);
      setRoleTargets(nextRoles);
      setUserTargets(nextUsers);
      const nextDefaultRole = nextRoles.find((role) => !!role.is_default);
      const nextOwner = nextUsers.find((user) => user.isOwner);
      if (nextDefaultRole) setSelectedTargetKey(overwriteKey('role', nextDefaultRole.id));
      else if (nextOwner) setSelectedTargetKey(overwriteKey('user', nextOwner.id));
      else if (nextRoles[0]) setSelectedTargetKey(overwriteKey('role', nextRoles[0].id));
      else if (nextUsers[0]) setSelectedTargetKey(overwriteKey('user', nextUsers[0].id));
    }).catch(() => {
      if (!cancelled) setPermissionsError('Failed to load category permissions');
    }).finally(() => {
      if (!cancelled) setPermissionsLoading(false);
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

  const triggerCloseReject = () => {
    if (closeRejectTimerRef.current) window.clearTimeout(closeRejectTimerRef.current);
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

  const resetDraft = () => {
    setName(initialName);
    setPermissionOverwrites(initialPermissionOverwrites.map((overwrite) => ({ ...overwrite })));
    setError('');
    setPermissionsError('');
  };

  const addAccessTarget = () => {
    if (!newTargetId) return;
    if (!permissionOverwrites.some((overwrite) => overwrite.target_type === newTargetType && overwrite.target_id === newTargetId)) {
      setPermissionOverwrites([
        ...permissionOverwrites,
        { target_type: newTargetType, target_id: newTargetId, allow: 0, deny: 0 },
      ]);
    }
    setSelectedTargetKey(overwriteKey(newTargetType, newTargetId));
    setNewTargetId('');
  };

  const removeAccessTarget = (targetType: 'role' | 'user', targetId: string, protectedEntry: boolean) => {
    if (protectedEntry) return;
    setPermissionOverwrites(permissionOverwrites.filter((overwrite) => !(
      overwrite.target_type === targetType && overwrite.target_id === targetId
    )));
    if (selectedTargetKey === overwriteKey(targetType, targetId)) {
      if (defaultRole) setSelectedTargetKey(overwriteKey('role', defaultRole.id));
      else if (ownerUser) setSelectedTargetKey(overwriteKey('user', ownerUser.id));
      else setSelectedTargetKey(null);
    }
  };

  const togglePermission = (bit: number) => {
    if (!selectedTarget) return;
    const currentState = getPermissionState(selectedOverwrite, bit);
    const nextState = currentState === 'inherit' ? 'allow' : currentState === 'allow' ? 'deny' : 'inherit';
    setPermissionOverwrites(setPermissionState(
      permissionOverwrites,
      selectedTarget.targetType,
      selectedTarget.id,
      bit,
      nextState
    ));
  };

  const handleApply = async () => {
    if (!modalData || !name.trim()) return;
    setLoading(true);
    setError('');
    setPermissionsError('');
    try {
      await updateCategory(modalData.id, name.trim());
      await api.put(`/api/categories/${modalData.id}/permissions`, {
        overwrites: normalizeOverwrites(permissionOverwrites).map((overwrite) => ({
          targetType: overwrite.target_type,
          targetId: overwrite.target_id,
          allow: overwrite.allow,
          deny: overwrite.deny,
        })),
      });
      await fetchChannels();
      setInitialName(name.trim());
      setInitialPermissionOverwrites(permissionOverwrites.map((overwrite) => ({ ...overwrite })));
      closeModal();
    } catch {
      setError('Failed to update category');
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen || !modalData) return null;

  const selectedTargetName = selectedTarget?.name ?? 'Select a role or member';

  return (
    <Modal
      open={isOpen}
      onClose={handleRequestClose}
      title={`Editing ${name || modalData.name}`}
      className={`!h-[min(88vh,780px)] !w-[min(96vw,1280px)] !max-w-none ${closeRejected ? 'modal-reject-shake' : ''}`}
      bodyClassName="!p-0 !h-full overflow-hidden"
    >
      <div className="grid h-full min-h-0 gap-6 px-5 pt-5 pb-4 md:grid-cols-[180px_minmax(0,1fr)]">
        <aside className="space-y-4 border-b border-border pb-4 md:border-b-0 md:border-r md:pb-0 md:pr-5">
          <div className="space-y-1">
            <div className="text-sm text-text-muted">Editing Category</div>
            <div className="text-sm text-text-secondary truncate">{name || modalData.name}</div>
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
          </div>
        </aside>

        <div className="min-w-0 space-y-5 overflow-x-hidden overflow-y-auto pr-3 pb-6">
          <div>
            <div className="text-lg font-semibold text-text-primary">
              {section === 'basic' ? 'Basic Settings' : section === 'permissions' ? 'Permissions' : 'Webhooks'}
            </div>
            <div className="mt-1 text-sm text-text-muted">
              {section === 'basic'
                ? 'Edit the category name and keep category defaults together.'
                : section === 'permissions'
                  ? 'Set the default permission behavior for channels linked to this category.'
                  : 'Manage integrations that create or reuse channels inside this category.'}
            </div>
          </div>

          {section === 'basic' && (
            <div className="space-y-5 min-w-0">
              <Input
                label="Category Name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Category name"
                autoFocus
              />

              <div className="rounded-xl border border-border bg-bg-input/40 px-4 py-3 text-sm text-text-muted">
                <span className="font-medium text-text-primary">Current Draft:</span> {name.trim() || 'Untitled category'}
              </div>
            </div>
          )}

          {section === 'permissions' && (
            <div className="space-y-6">
              <div className={`flex flex-col gap-3 rounded-xl border px-4 py-3 md:flex-row md:items-center md:justify-between ${
                visibleRoleEntries.length + visibleUserEntries.length > 0
                  ? 'border-emerald-500/30 bg-emerald-500/10'
                  : 'border-amber-500/30 bg-amber-500/10'
              }`}>
                <div className="flex items-start gap-3">
                  {visibleRoleEntries.length + visibleUserEntries.length > 0
                    ? <CheckCircle2 className="mt-0.5 h-5 w-5 text-emerald-300" />
                    : <AlertTriangle className="mt-0.5 h-5 w-5 text-amber-300" />}
                  <div>
                    <div className="text-sm font-semibold text-text-primary">
                      {visibleRoleEntries.length + visibleUserEntries.length > 0
                        ? 'Category permission defaults are configured'
                        : 'No category permission defaults configured'}
                    </div>
                    <div className="mt-1 text-xs text-text-muted">
                      Category overwrites flow down into linked channels unless those channels are customized later.
                    </div>
                  </div>
                </div>
              </div>

              <div className="grid gap-6 xl:grid-cols-[320px_minmax(0,1fr)]">
                <div className="space-y-4">
                  <div>
                    <div className="text-sm font-semibold text-text-primary">Who should inherit custom category access?</div>
                    <div className="text-xs text-text-muted">Add a role or member, then tune their default permission behavior.</div>
                  </div>

                  <div className="flex flex-col gap-2">
                    <select
                      value={newTargetType}
                      onChange={(e) => {
                        setNewTargetType(e.target.value as 'role' | 'user');
                        setNewTargetId('');
                      }}
                      className="rounded-md border border-border bg-bg-input px-3 py-2 text-sm text-text-primary focus:border-accent focus:outline-none"
                    >
                      <option value="role">Role</option>
                      <option value="user">Member</option>
                    </select>
                    <select
                      value={newTargetId}
                      onChange={(e) => setNewTargetId(e.target.value)}
                      className="w-full rounded-md border border-border bg-bg-input px-3 py-2 text-sm text-text-primary focus:border-accent focus:outline-none"
                    >
                      <option value="">Add A Role / Member</option>
                      {addTargetOptions.map((target) => (
                        <option key={target.id} value={target.id}>{target.name}</option>
                      ))}
                    </select>
                    <Button type="button" variant="secondary" onClick={addAccessTarget} disabled={!newTargetId}>
                      Add
                    </Button>
                  </div>

                  {permissionsLoading && <div className="text-xs text-text-muted">Loading category permissions…</div>}
                  {permissionsError && <div className="text-xs text-danger">{permissionsError}</div>}

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
                              : 'Remove access to category';
                          const overwrite = permissionOverwrites.find((entry) => entry.target_type === 'role' && entry.target_id === role.id);
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
                                  <span title={protectedEntry ? protectedRoleReason : 'Remove access to category'}>
                                    <button
                                      type="button"
                                      disabled={protectedEntry}
                                      onClick={(event) => {
                                        event.stopPropagation();
                                        removeAccessTarget('role', role.id, protectedEntry);
                                      }}
                                      className="rounded-md bg-bg-input/70 px-2 py-1 text-xs text-text-secondary transition-colors hover:bg-danger/20 hover:text-danger disabled:cursor-not-allowed disabled:opacity-50"
                                      aria-label={protectedEntry ? protectedRoleReason : 'Remove access to category'}
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
                          const overwrite = permissionOverwrites.find((entry) => entry.target_type === 'user' && entry.target_id === user.id);
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
                                  <span title={protectedEntry ? 'Server owner cannot be removed.' : 'Remove access to category'}>
                                    <button
                                      type="button"
                                      disabled={protectedEntry}
                                      onClick={(event) => {
                                        event.stopPropagation();
                                        removeAccessTarget('user', user.id, protectedEntry);
                                      }}
                                      className="rounded-md bg-bg-input/70 px-2 py-1 text-xs text-text-secondary transition-colors hover:bg-danger/20 hover:text-danger disabled:cursor-not-allowed disabled:opacity-50"
                                      aria-label={protectedEntry ? 'Server owner cannot be removed.' : 'Remove access to category'}
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
                      Adjust category defaults for the selected role or member. Changes stay in the draft until Apply.
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
              scopeType="category"
              scopeId={modalData.id}
              title="Category Webhooks"
              description="Use a category webhook when an external service should create or reuse child channels in this category and receive outbound callbacks for user activity inside them."
            />
          )}

          {error && <p className="text-sm text-danger">{error}</p>}
        </div>
      </div>

      {hasUnsavedChanges && (
        <div className="fixed bottom-6 left-1/2 z-[60] flex w-full -translate-x-1/2 justify-center px-4 pointer-events-none">
          <div className="unsaved-changes-bar pointer-events-auto flex items-center gap-4 rounded-xl border border-purple-700/40 bg-gray-950/95 px-5 py-3 backdrop-blur-sm">
            <span className="unsaved-warning-text whitespace-nowrap text-sm font-semibold">
              Current Changes are NOT saved!
            </span>
            <div className="ml-2 flex items-center gap-2">
              <button
                type="button"
                onClick={resetDraft}
                disabled={loading}
                className="rounded-lg border border-red-600/50 bg-red-700 px-4 py-1.5 text-sm font-semibold text-white transition-colors hover:bg-red-600 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Discard
              </button>
              <button
                type="button"
                onClick={() => { void handleApply(); }}
                disabled={loading || !name.trim()}
                className="discover-nav-button rounded-lg border border-purple-500/40 bg-[#7c5cff] px-4 py-1.5 text-sm font-semibold text-white transition-colors hover:bg-[#6a4de0] disabled:cursor-not-allowed disabled:opacity-50"
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
