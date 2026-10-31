import { useState, useEffect } from 'react';
import type { DragEvent } from 'react';
import { ChevronDown, ChevronRight, Copy, Eye, GripVertical, MoreHorizontal, Pencil, Plus, Save, Search, Shield, Trash2, Upload, Users, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { api } from '../../../lib/api';
import { createApi } from '../../../lib/api';
import { PermissionCategory } from '../PermissionCategory';
import { PERMISSION_CATEGORIES } from '../permissionDefinitions';
import { resolveRoleIconUrl } from '../../../utils/avatar';
import { useAuthStore } from '../../../stores/authStore';
import { useUIStore } from '../../../stores/uiStore';
import { AppearanceModal } from '../AppearanceModal';
import type { AppearanceResult } from '../AppearanceModal';
import { useViewAsRoleStore } from '../../../stores/viewAsRoleStore';

interface Role {
  id: string;
  name: string;
  color: string | null;
  permissions: number;
  position: number;
  is_default: boolean | number;
  mentionable: boolean | number;
  hoist?: boolean | number;
  icon?: string | null;
  category_id?: string | null;
  style_type?: string | null;
  style_colors?: string | null;
}

interface RoleCategory {
  id: string;
  name: string;
  position: number;
}

interface User {
  id: string;
  username: string;
  roleIds?: string[];
  role_ids?: string[];
  roles?: Array<string | { id: string }>;
  role?: string;
}

const DEFAULT_ROLE_COLOR = '#99AAB5';

interface AppearanceModalState {
  mode: 'create' | 'edit';
  roleId?: string;
  roleName: string;
  color: string;
  styleType: string;
  styleColors: string | null;
}

function toPermissionBits(value: number): bigint {
  if (!Number.isFinite(value)) return 0n;
  const normalized = Math.trunc(value);
  // Legacy signed-32 values should be interpreted as unsigned masks.
  if (normalized < 0) return BigInt(normalized >>> 0);
  return BigInt(normalized);
}

export function RolesSection() {
  const { t } = useTranslation();
  const serverUrl = useAuthStore((s) => s.serverUrl);
  const applyServerAuthRefresh = useAuthStore((s) => s.applyServerAuthRefresh);
  const openModal = useUIStore((s) => s.openModal);
  const roleViewActive = useViewAsRoleStore((s) => s.active);
  const viewedRole = useViewAsRoleStore((s) => s.role);
  const endRoleView = useViewAsRoleStore((s) => s.endSession);
  const [roles, setRoles] = useState<Role[]>([]);
  const [roleDrafts, setRoleDrafts] = useState<Record<string, Role>>({});
  const [savingRoleIds, setSavingRoleIds] = useState<Record<string, boolean>>({});
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [usersError, setUsersError] = useState<string | null>(null);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [showCreateCategoryForm, setShowCreateCategoryForm] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [roleCategories, setRoleCategories] = useState<RoleCategory[]>([]);
  const [newCategoryName, setNewCategoryName] = useState('');
  const [collapsedCategories, setCollapsedCategories] = useState<Record<string, boolean>>({});
  const [editingRoleId, setEditingRoleId] = useState<string | null>(null);
  const [openRoleMenuId, setOpenRoleMenuId] = useState<string | null>(null);
  const [appearanceModal, setAppearanceModal] = useState<AppearanceModalState | null>(null);
  const [dragItem, setDragItem] = useState<{ type: 'role' | 'category'; id: string } | null>(null);
  const [dropTargetId, setDropTargetId] = useState<string | null>(null);

  const [newRole, setNewRole] = useState({
    name: '',
    color: DEFAULT_ROLE_COLOR,
    permissions: 0,
    mentionable: false,
    hoist: false,
    categoryId: '',
  });

  useEffect(() => {
    loadRoles();
    loadUsers();
    loadRoleCategories();
  }, []);

  useEffect(() => {
    const handleWindowClick = () => setOpenRoleMenuId(null);
    window.addEventListener('click', handleWindowClick);
    return () => window.removeEventListener('click', handleWindowClick);
  }, []);

  const loadRoles = async () => {
    try {
      setLoading(true);
      const data = await api.get('/api/admin/roles');
      const nextRoles: Role[] = Array.isArray(data) ? data : [];
      const roleIds = new Set(nextRoles.map((role) => role.id));
      setRoles(nextRoles);
      setRoleDrafts((prev) => {
        const filtered = Object.entries(prev).filter(([id]) => roleIds.has(id));
        return Object.fromEntries(filtered);
      });
      setSavingRoleIds((prev) => {
        const filtered = Object.entries(prev).filter(([id]) => roleIds.has(id));
        return Object.fromEntries(filtered);
      });
      setEditingRoleId((prev) => (prev && roleIds.has(prev) ? prev : null));
    } catch (err) {
      setError('Failed to load roles');
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const loadUsers = async () => {
    try {
      setUsersError(null);
      const data = await api.get('/api/admin/users');
      const nextUsers = Array.isArray(data)
        ? data
        : (Array.isArray(data?.users) ? data.users : []);
      setUsers(nextUsers);
    } catch (err) {
      setUsers([]);
      setUsersError('Failed to load role member counts');
      console.error('Failed to load users:', err);
    }
  };

  const loadRoleCategories = async () => {
    try {
      const data = await api.get('/api/admin/role-categories');
      setRoleCategories(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error('Failed to load role categories:', err);
    }
  };

  const handleEndRoleView = async () => {
    try {
      const requestApi = createApi();
      await requestApi.delete('/api/roles/view-as');
      const identity = await requestApi.get('/api/auth/me');
      applyServerAuthRefresh({
        serverUrl,
        token: typeof identity.data?.token === 'string' ? identity.data.token : null,
        user: identity.data?.user && typeof identity.data.user === 'object' ? identity.data.user : null,
      });
    } catch {
      // Best-effort local reset if the session was already cleared.
    } finally {
      endRoleView();
    }
  };

  const getUserRoleIds = (user: User): string[] => {
    if (Array.isArray(user.roleIds)) return user.roleIds;
    if (Array.isArray(user.role_ids)) return user.role_ids;
    if (Array.isArray(user.roles)) {
      return user.roles
        .map((r) => (typeof r === 'string' ? r : r?.id))
        .filter((id): id is string => typeof id === 'string' && id.length > 0);
    }
    return [];
  };

  const getMemberCount = (role: Role) => {
    return users.filter((u) => {
      const assignedIds = getUserRoleIds(u);
      if (assignedIds.includes(role.id)) return true;
      if (assignedIds.length === 0 && typeof u.role === 'string') {
        return u.role.toLowerCase() === role.name.toLowerCase();
      }
      return false;
    }).length;
  };

  const handleCreateRole = async () => {
    if (!newRole.name.trim()) {
      alert(t('admin.roleNameRequired'));
      return;
    }

    try {
      await api.post('/api/admin/roles', {
        ...newRole,
        categoryId: newRole.categoryId || null,
      });
      setNewRole({
        name: '',
        color: DEFAULT_ROLE_COLOR,
        permissions: 0,
        mentionable: false,
        hoist: false,
        categoryId: '',
      });
      setShowCreateForm(false);
      await loadRoles();
    } catch (err: any) {
      alert(err.response?.data?.error || 'Failed to create role');
      console.error(err);
    }
  };

  const handleUpdateRole = async (role: Role) => {
    try {
      const updated = await api.put(`/api/admin/roles/${role.id}`, {
        name: role.name,
        color: role.color,
        permissions: role.permissions,
        mentionable: role.mentionable,
        hoist: role.hoist,
        categoryId: role.category_id ?? null,
        style_type: role.style_type ?? 'solid',
        style_colors: role.style_colors ?? null,
      });

      setRoles((prev) => prev.map((entry) => {
        if (entry.id !== role.id) return entry;
        if (updated && typeof updated === 'object') {
          return {
            ...entry,
            ...updated,
            mentionable: updated.mentionable ?? entry.mentionable,
            hoist: updated.hoist ?? entry.hoist,
            category_id: updated.category_id ?? entry.category_id ?? null,
          } as Role;
        }
        return { ...entry, ...role };
      }));
    } catch (err: any) {
      alert(err.response?.data?.error || 'Failed to update role');
      console.error(err);
      throw err;
    }
  };

  const handleDeleteRole = async (roleId: string) => {
    try {
      await api.delete(`/api/admin/roles/${roleId}`);
      if (editingRoleId === roleId) {
        setEditingRoleId(null);
      }
      setRoleDrafts((prev) => {
        if (!(roleId in prev)) return prev;
        const next = { ...prev };
        delete next[roleId];
        return next;
      });
      setSavingRoleIds((prev) => {
        if (!(roleId in prev)) return prev;
        const next = { ...prev };
        delete next[roleId];
        return next;
      });
      await loadRoles();
    } catch (err: any) {
      alert(err.response?.data?.error || 'Failed to delete role');
      console.error(err);
    }
  };

  const handleTogglePermission = (role: Role, bit: number) => {
    const current = toPermissionBits(role.permissions);
    const mask = toPermissionBits(bit);
    if (mask === 0n) return;

    const next = current ^ mask;
    if (next > BigInt(Number.MAX_SAFE_INTEGER)) {
      alert(t('admin.permBitOverflow'));
      return;
    }

    const updatedRole = { ...role, permissions: Number(next) };
    setRoleDrafts((prev) => ({ ...prev, [role.id]: updatedRole }));
  };

  const hasRoleDraftChanges = (baseRole: Role, draftRole: Role) => {
    return (
      draftRole.name !== baseRole.name
      || (draftRole.color ?? null) !== (baseRole.color ?? null)
      || Number(draftRole.permissions || 0) !== Number(baseRole.permissions || 0)
      || !!draftRole.mentionable !== !!baseRole.mentionable
      || !!draftRole.hoist !== !!baseRole.hoist
      || (draftRole.category_id ?? null) !== (baseRole.category_id ?? null)
      || (draftRole.style_type ?? 'solid') !== (baseRole.style_type ?? 'solid')
      || (draftRole.style_colors ?? null) !== (baseRole.style_colors ?? null)
    );
  };

  const openRoleEditor = (role: Role) => {
    if (editingRoleId === role.id) {
      const existingDraft = roleDrafts[role.id];
      if (existingDraft && hasRoleDraftChanges(role, existingDraft)) {
        const discard = confirm(t('admin.discardConfirm'));
        if (!discard) return;
      }
      setEditingRoleId(null);
      setRoleDrafts((prev) => {
        if (!(role.id in prev)) return prev;
        const next = { ...prev };
        delete next[role.id];
        return next;
      });
      return;
    }

    setEditingRoleId(role.id);
    setRoleDrafts((prev) => (prev[role.id] ? prev : { ...prev, [role.id]: { ...role } }));
  };

  const handleRevertRoleChanges = (role: Role) => {
    setRoleDrafts((prev) => {
      if (!(role.id in prev)) return prev;
      const next = { ...prev };
      delete next[role.id];
      return next;
    });
  };

  const handleSaveRoleChanges = async (role: Role) => {
    setSavingRoleIds((prev) => ({ ...prev, [role.id]: true }));
    try {
      await handleUpdateRole(role);
      setRoleDrafts((prev) => {
        if (!(role.id in prev)) return prev;
        const next = { ...prev };
        delete next[role.id];
        return next;
      });
    } catch {
      // handleUpdateRole already shows user-facing errors.
    } finally {
      setSavingRoleIds((prev) => ({ ...prev, [role.id]: false }));
    }
  };

  const handleUploadRoleIcon = async (roleId: string, file: File) => {
    try {
      const formData = new FormData();
      formData.append('file', file);
      const updated = await api.post(`/api/admin/roles/${roleId}/icon`, formData);
      if (updated && typeof updated === 'object' && 'icon' in updated) {
        setRoles((prev) => prev.map((r) => r.id === roleId ? { ...r, icon: (updated as Role).icon } : r));
        setRoleDrafts((prev) => {
          if (!prev[roleId]) return prev;
          return { ...prev, [roleId]: { ...prev[roleId], icon: (updated as Role).icon } };
        });
      } else {
        await loadRoles();
      }
    } catch (err: any) {
      alert(err.response?.data?.error || 'Failed to upload icon');
      console.error(err);
    }
  };

  const handleRemoveRoleIcon = async (roleId: string) => {
    try {
      await api.delete(`/api/admin/roles/${roleId}/icon`);
      setRoles((prev) => prev.map((r) => r.id === roleId ? { ...r, icon: null } : r));
      setRoleDrafts((prev) => {
        if (!prev[roleId]) return prev;
        return { ...prev, [roleId]: { ...prev[roleId], icon: null } };
      });
    } catch (err: any) {
      alert(err.response?.data?.error || 'Failed to remove icon');
      console.error(err);
    }
  };

  const handleCreateRoleCategory = async () => {
    const name = newCategoryName.trim();
    if (!name) {
      alert(t('admin.categoryNameRequired'));
      return;
    }
    try {
      await api.post('/api/admin/role-categories', { name });
      setNewCategoryName('');
      setShowCreateCategoryForm(false);
      await loadRoleCategories();
    } catch (err: any) {
      alert(err.response?.data?.error || 'Failed to create role category');
      console.error(err);
    }
  };

  const handleCopyRoleId = async (roleId: string) => {
    try {
      await navigator.clipboard.writeText(roleId);
      alert(t('admin.roleIdCopied'));
    } catch (_err) {
      alert(`Failed to copy role ID. Role ID: ${roleId}`);
    }
  };

  const isDefaultRole = (role: Role) => !!role.is_default;
  const sortedRoles = [...roles].sort((a, b) => {
    const aDefault = isDefaultRole(a);
    const bDefault = isDefaultRole(b);
    if (aDefault && !bDefault) return -1;
    if (!aDefault && bDefault) return 1;
    if (b.position !== a.position) return b.position - a.position;
    return a.name.localeCompare(b.name);
  });
  const filteredRoles = sortedRoles.filter((role) =>
    role.name.toLowerCase().includes(searchQuery.trim().toLowerCase())
  );
  const sortedRoleCategories = [...roleCategories].sort((a, b) =>
    a.position === b.position ? a.name.localeCompare(b.name) : a.position - b.position
  );
  const roleCategoryMap = new Map(sortedRoleCategories.map((category) => [category.id, category]));
  const groupedRoles = new Map<string, Role[]>();
  for (const role of filteredRoles) {
    let groupKey = '__uncategorized';
    if (isDefaultRole(role)) {
      groupKey = '__default';
    } else if (role.category_id && roleCategoryMap.has(role.category_id)) {
      groupKey = role.category_id;
    }
    const list = groupedRoles.get(groupKey) ?? [];
    list.push(role);
    groupedRoles.set(groupKey, list);
  }
  const categorySections: Array<{ id: string; name: string }> = [
    ...sortedRoleCategories.map((category) => ({ id: category.id, name: category.name })),
    { id: '__uncategorized', name: t('admin.uncategorized') },
    { id: '__default', name: t('admin.defaultRoleSection') },
  ];
  const toggleCategoryCollapse = (categoryId: string) => {
    setCollapsedCategories((prev) => ({ ...prev, [categoryId]: !prev[categoryId] }));
  };

  // Drag-to-reorder. Disabled while searching (partial list) or viewing as a role.
  const canReorder = !roleViewActive && !searchQuery.trim();
  const reorderableRoles = sortedRoles.filter((role) => !isDefaultRole(role));
  const roleCategoryOf = (role: Role) =>
    (role.category_id && roleCategoryMap.has(role.category_id) ? role.category_id : null);
  const errorMessage = (err: unknown, fallback: string) =>
    (err as { response?: { data?: { error?: string } } })?.response?.data?.error || fallback;

  const endDrag = () => {
    setDragItem(null);
    setDropTargetId(null);
  };

  const moveId = (ids: string[], movedId: string, targetId: string) => {
    const from = ids.indexOf(movedId);
    const to = ids.indexOf(targetId);
    if (from < 0 || to < 0) return ids;
    const next = [...ids];
    next.splice(from, 1);
    next.splice(to, 0, movedId);
    return next;
  };

  const commitRoleOrder = async (orderedIds: string[], moved?: { roleId: string; categoryId: string | null }) => {
    const previousRoles = roles;
    const rankById = new Map(orderedIds.map((id, idx) => [id, orderedIds.length - idx]));
    const applyMove = (role: Role): Role => ({
      ...role,
      position: isDefaultRole(role) ? 0 : (rankById.get(role.id) ?? role.position),
      category_id: moved && role.id === moved.roleId ? moved.categoryId : role.category_id,
    });
    setRoles((prev) => prev.map(applyMove));
    if (moved) {
      setRoleDrafts((prev) => (prev[moved.roleId]
        ? { ...prev, [moved.roleId]: { ...prev[moved.roleId], category_id: moved.categoryId } }
        : prev));
    }
    try {
      if (moved) await api.put(`/api/admin/roles/${moved.roleId}`, { categoryId: moved.categoryId });
      const updated = await api.put('/api/admin/roles/reorder', { roleIds: orderedIds });
      if (Array.isArray(updated)) setRoles(updated);
    } catch (err) {
      setRoles(previousRoles);
      alert(errorMessage(err, t('admin.reorderFailed')));
      console.error(err);
    }
  };

  const handleDropOnRole = (target: Role) => {
    const dragged = dragItem;
    endDrag();
    if (!dragged || dragged.type !== 'role' || dragged.id === target.id || isDefaultRole(target)) return;
    const draggedRole = roles.find((role) => role.id === dragged.id);
    if (!draggedRole) return;
    const orderedIds = moveId(reorderableRoles.map((role) => role.id), dragged.id, target.id);
    const targetCategory = roleCategoryOf(target);
    const moved = roleCategoryOf(draggedRole) !== targetCategory
      ? { roleId: dragged.id, categoryId: targetCategory }
      : undefined;
    void commitRoleOrder(orderedIds, moved);
  };

  const commitCategoryOrder = async (orderedIds: string[]) => {
    const previous = roleCategories;
    const indexById = new Map(orderedIds.map((id, idx) => [id, idx]));
    setRoleCategories((prev) => prev.map((category) => ({ ...category, position: indexById.get(category.id) ?? category.position })));
    try {
      const updated = await api.put('/api/admin/role-categories/reorder', { categoryIds: orderedIds });
      if (Array.isArray(updated)) setRoleCategories(updated);
    } catch (err) {
      setRoleCategories(previous);
      alert(errorMessage(err, t('admin.reorderFailed')));
      console.error(err);
    }
  };

  const handleDropOnSection = (sectionId: string) => {
    const dragged = dragItem;
    endDrag();
    if (!dragged || sectionId === '__default') return;

    if (dragged.type === 'category') {
      if (sectionId === '__uncategorized' || sectionId === dragged.id) return;
      void commitCategoryOrder(moveId(sortedRoleCategories.map((category) => category.id), dragged.id, sectionId));
      return;
    }

    // A role dropped on a section header joins that category, at the top of it.
    const draggedRole = roles.find((role) => role.id === dragged.id);
    const categoryId = sectionId === '__uncategorized' ? null : sectionId;
    if (!draggedRole || roleCategoryOf(draggedRole) === categoryId) return;
    const firstInSection = (groupedRoles.get(sectionId) ?? [])[0];
    let orderedIds = reorderableRoles.map((role) => role.id);
    if (firstInSection) {
      orderedIds = orderedIds.filter((id) => id !== dragged.id);
      orderedIds.splice(orderedIds.indexOf(firstInSection.id), 0, dragged.id);
    }
    void commitRoleOrder(orderedIds, { roleId: dragged.id, categoryId });
  };

  const dropHandlers = (targetId: string, accepts: boolean, onDrop: () => void) => (accepts ? {
    onDragOver: (e: DragEvent) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      if (dropTargetId !== targetId) setDropTargetId(targetId);
    },
    onDragLeave: () => setDropTargetId((prev) => (prev === targetId ? null : prev)),
    onDrop: (e: DragEvent) => {
      e.preventDefault();
      onDrop();
    },
  } : {});

  const dragSourceProps = (type: 'role' | 'category', id: string) => ({
    draggable: true,
    onDragStart: (e: DragEvent) => {
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', id);
      setDragItem({ type, id });
    },
    onDragEnd: endDrag,
  });

  const openCreateAppearanceModal = () => {
    setAppearanceModal({
      mode: 'create',
      roleName: newRole.name || 'New Role',
      color: newRole.color || DEFAULT_ROLE_COLOR,
      styleType: 'solid',
      styleColors: null,
    });
  };

  const openEditAppearanceModal = (role: Role) => {
    const draft = roleDrafts[role.id] ?? role;
    setAppearanceModal({
      mode: 'edit',
      roleId: role.id,
      roleName: draft.name || role.name,
      color: draft.color || DEFAULT_ROLE_COLOR,
      styleType: draft.style_type ?? 'solid',
      styleColors: draft.style_colors ?? null,
    });
  };

  const applyAppearanceModal = (result: AppearanceResult) => {
    if (!appearanceModal) return;
    if (appearanceModal.mode === 'create') {
      setNewRole((prev) => ({ ...prev, color: result.color }));
      setAppearanceModal(null);
      return;
    }
    const baseRole = roles.find((r) => r.id === appearanceModal.roleId);
    if (!baseRole) { setAppearanceModal(null); return; }
    const activeRole = roleDrafts[baseRole.id] ?? baseRole;
    setRoleDrafts((prev) => ({
      ...prev,
      [baseRole.id]: {
        ...activeRole,
        color: result.color,
        style_type: result.style_type,
        style_colors: result.style_colors,
      },
    }));
    setAppearanceModal(null);
  };

  const renderRoleRow = (role: Role) => {
    const isDefault = isDefaultRole(role);
    const editingRole = roleDrafts[role.id] ?? role;
    const isMentionable = !!editingRole.mentionable;
    const isHoist = !!editingRole.hoist;
    const isEditing = editingRoleId === role.id;
    const memberCount = getMemberCount(role);

    const canDragRole = canReorder && !isDefault;
    const isDropTarget = dropTargetId === role.id && dragItem?.type === 'role' && dragItem.id !== role.id;

    return (
      <div key={role.id} className="border-b border-gray-800 last:border-b-0">
        <div
          {...(canDragRole ? dragSourceProps('role', role.id) : {})}
          {...dropHandlers(role.id, canDragRole && dragItem?.type === 'role', () => handleDropOnRole(role))}
          className={`grid grid-cols-[minmax(0,1fr)_90px_90px] px-4 py-3 items-center gap-3 transition-colors ${
            isDropTarget ? 'bg-blue-500/10 shadow-[inset_0_2px_0_0_rgb(59,130,246)]' : ''
          } ${dragItem?.id === role.id ? 'opacity-50' : ''}`}
        >
          <div className="flex items-center gap-3 min-w-0">
            {canReorder && (
              <GripVertical
                className={`w-4 h-4 shrink-0 -mr-1 ${canDragRole ? 'text-gray-500 cursor-grab' : 'invisible'}`}
                aria-label={canDragRole ? t('admin.dragToReorder') : undefined}
              />
            )}
            <div className="w-8 h-8 rounded-md bg-gray-800 border border-gray-700 flex items-center justify-center">
              <Shield className="w-4 h-4" style={{ color: role.color || DEFAULT_ROLE_COLOR }} />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 min-w-0">
                <span className="font-medium text-gray-100 truncate">{role.name}</span>
                {isDefault && (
                  <span className="text-xs px-2 py-0.5 rounded-full bg-blue-600/20 text-blue-400">
                    {t('admin.defaultRoleLabel')}
                  </span>
                )}
                {isMentionable && (
                  <span className="text-xs px-2 py-0.5 rounded-full bg-green-600/20 text-green-400">
                    {t('admin.mentionable')}
                  </span>
                )}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-1 text-sm text-gray-300">
            <span>{memberCount}</span>
            <Users className="w-4 h-4" />
          </div>

          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => openRoleEditor(role)}
              disabled={roleViewActive}
              className="p-2 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-300 transition-colors"
              title={roleViewActive ? t('admin.editingDisabled') : t('admin.editRole')}
            >
              <Pencil className="w-4 h-4" />
            </button>
            <div className="relative">
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setOpenRoleMenuId((prev) => (prev === role.id ? null : role.id));
                }}
                disabled={roleViewActive}
                className="p-2 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-300 transition-colors"
                title={roleViewActive ? t('admin.actionsDisabled') : t('admin.roleOptions')}
              >
                <MoreHorizontal className="w-4 h-4" />
              </button>
              {openRoleMenuId === role.id && (
                <div
                  onClick={(e) => e.stopPropagation()}
                  className="absolute right-0 mt-2 z-20 w-56 max-w-[calc(100vw-2rem)] rounded-lg border border-gray-700 bg-gray-900 shadow-xl py-1"
                >
                  <button
                    type="button"
                    onClick={() => {
                      setOpenRoleMenuId(null);
                      openModal('viewRoleAs', { role, roles });
                    }}
                    className="w-full px-3 py-2 text-left text-sm text-gray-200 hover:bg-gray-800 flex items-center gap-2"
                  >
                    <Eye className="w-4 h-4" />
                    {t('admin.viewServerAsRole')}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setOpenRoleMenuId(null);
                      void handleCopyRoleId(role.id);
                    }}
                    className="w-full px-3 py-2 text-left text-sm text-gray-200 hover:bg-gray-800 flex items-center gap-2"
                  >
                    <Copy className="w-4 h-4" />
                    {t('admin.copyRoleId')}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setOpenRoleMenuId(null);
                      if (isDefault) return;
                      if (!confirm(t('admin.deleteRoleConfirm', { name: role.name }))) return;
                      void handleDeleteRole(role.id);
                    }}
                    disabled={isDefault}
                    className="w-full px-3 py-2 text-left text-sm text-red-300 hover:bg-red-900/20 disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-2"
                  >
                    <Trash2 className="w-4 h-4" />
                    {t('admin.deleteRole')}
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>

        {isEditing && (
          <div className="border-t border-gray-800 bg-gray-950/40 p-4">
            <div className="space-y-6">
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">
                    {t('admin.roleName')}
                  </label>
                  <input
                    type="text"
                    value={editingRole.name}
                    onChange={(e) => {
                      const nextName = e.target.value;
                      setRoleDrafts((prev) => ({ ...prev, [role.id]: { ...editingRole, name: nextName } }));
                    }}
                    className="w-full px-4 py-2 bg-gray-900 border border-gray-700 rounded-lg text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    maxLength={32}
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">
                    {t('admin.roleAppearance')}
                  </label>
                  <button
                    type="button"
                    onClick={() => openEditAppearanceModal(editingRole)}
                    className="flex items-center gap-3 px-3 py-2 bg-gray-900 border border-gray-700 rounded-lg hover:bg-gray-800 transition-colors w-full text-left"
                  >
                    <span
                      className="w-6 h-6 rounded border border-gray-600 shrink-0"
                      style={{ backgroundColor: editingRole.color || DEFAULT_ROLE_COLOR }}
                    />
                    <span className="text-sm text-gray-300 font-mono">{editingRole.color || DEFAULT_ROLE_COLOR}</span>
                    {(editingRole.style_type && editingRole.style_type !== 'solid') && (
                      <span className="ml-auto text-xs px-2 py-0.5 rounded-full bg-purple-600/20 text-purple-400 border border-purple-700/40">
                        {editingRole.style_type === 'gradient' ? t('admin.gradient') : editingRole.style_type === 'glow' ? t('admin.glow') : t('admin.rgbFlow')}
                      </span>
                    )}
                    <span className="ml-auto text-xs text-gray-500">{t('admin.editArrow')}</span>
                  </button>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">
                    {t('admin.roleCategory')}
                  </label>
                  <select
                    value={editingRole.category_id || ''}
                    onChange={(e) => {
                      const nextCategoryId = e.target.value || null;
                      setRoleDrafts((prev) => ({ ...prev, [role.id]: { ...editingRole, category_id: nextCategoryId } }));
                    }}
                    className="w-full px-4 py-2 bg-gray-900 border border-gray-700 rounded-lg text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="">{t('admin.noCategory')}</option>
                    {sortedRoleCategories.map((category) => (
                      <option key={category.id} value={category.id}>
                        {category.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="flex items-center justify-between p-3 rounded-lg bg-gray-900/50">
                  <span className="text-sm font-medium text-gray-300">
                    {t('admin.allowMention')}
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      setRoleDrafts((prev) => ({ ...prev, [role.id]: { ...editingRole, mentionable: !isMentionable } }));
                    }}
                    className={`
                      relative inline-flex h-6 w-11 items-center rounded-full transition-colors cursor-pointer
                      ${isMentionable ? 'bg-blue-600' : 'bg-gray-600'}
                    `}
                    role="switch"
                    aria-checked={isMentionable}
                  >
                    <span
                      className={`
                        inline-block h-4 w-4 transform rounded-full bg-white transition-transform
                        ${isMentionable ? 'translate-x-6' : 'translate-x-1'}
                      `}
                    />
                  </button>
                </div>

                <div className="flex items-center justify-between p-3 rounded-lg bg-gray-900/50">
                  <span className="text-sm font-medium text-gray-300">
                    {t('admin.displaySeparately')}
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      setRoleDrafts((prev) => ({ ...prev, [role.id]: { ...editingRole, hoist: !isHoist } }));
                    }}
                    className={`
                      relative inline-flex h-6 w-11 items-center rounded-full transition-colors cursor-pointer
                      ${isHoist ? 'bg-blue-600' : 'bg-gray-600'}
                    `}
                    role="switch"
                    aria-checked={isHoist}
                  >
                    <span
                      className={`
                        inline-block h-4 w-4 transform rounded-full bg-white transition-transform
                        ${isHoist ? 'translate-x-6' : 'translate-x-1'}
                      `}
                    />
                  </button>
                </div>

                {/* Role Icon */}
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">{t('admin.roleIcon')}</label>
                  <div className="flex items-center gap-3">
                    {editingRole.icon ? (
                      <img src={resolveRoleIconUrl(editingRole.icon, serverUrl) ?? editingRole.icon} alt={t('admin.roleIcon')} className="w-10 h-10 rounded object-contain bg-gray-800 border border-gray-700" />
                    ) : (
                      <div className="w-10 h-10 rounded bg-gray-800 border border-gray-700 flex items-center justify-center text-gray-500 text-xs">
                        {t('admin.roleNoneIcon')}
                      </div>
                    )}
                    <label className="cursor-pointer flex items-center gap-1.5 px-3 py-1.5 rounded bg-gray-800 hover:bg-gray-700 text-gray-300 border border-gray-700 text-sm transition-colors">
                      <Upload className="w-3.5 h-3.5" />
                      {t('admin.upload')}
                      <input
                        type="file"
                        accept="image/png,image/webp,image/gif"
                        className="hidden"
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (file) void handleUploadRoleIcon(role.id, file);
                          e.target.value = '';
                        }}
                      />
                    </label>
                    {editingRole.icon && (
                      <button
                        type="button"
                        onClick={() => void handleRemoveRoleIcon(role.id)}
                        className="px-3 py-1.5 rounded bg-red-900/30 hover:bg-red-900/60 text-red-400 border border-red-800/40 text-sm transition-colors"
                      >
                        {t('admin.remove')}
                      </button>
                    )}
                  </div>
                </div>


              </div>

              <div className="border-t border-gray-700 pt-6">
                <h4 className="text-lg font-semibold text-gray-200 mb-4">{t('admin.permissions')}</h4>
                <PermissionCategory
                  title={PERMISSION_CATEGORIES.userGeneral.title}
                  permissions={PERMISSION_CATEGORIES.userGeneral.permissions}
                  rolePermissions={editingRole.permissions}
                  onToggle={(bit) => handleTogglePermission(editingRole, bit)}
                  disabled={false}
                />
                <PermissionCategory
                  title={PERMISSION_CATEGORIES.helperGeneral.title}
                  permissions={PERMISSION_CATEGORIES.helperGeneral.permissions}
                  rolePermissions={editingRole.permissions}
                  onToggle={(bit) => handleTogglePermission(editingRole, bit)}
                  disabled={false}
                />
                <PermissionCategory
                  title={PERMISSION_CATEGORIES.modGeneral.title}
                  permissions={PERMISSION_CATEGORIES.modGeneral.permissions}
                  rolePermissions={editingRole.permissions}
                  onToggle={(bit) => handleTogglePermission(editingRole, bit)}
                  disabled={false}
                />
                <PermissionCategory
                  title={PERMISSION_CATEGORIES.adminGeneral.title}
                  permissions={PERMISSION_CATEGORIES.adminGeneral.permissions}
                  rolePermissions={editingRole.permissions}
                  onToggle={(bit) => handleTogglePermission(editingRole, bit)}
                  disabled={false}
                />
                <PermissionCategory
                  title={PERMISSION_CATEGORIES.coOwner.title}
                  permissions={PERMISSION_CATEGORIES.coOwner.permissions}
                  rolePermissions={editingRole.permissions}
                  onToggle={(bit) => handleTogglePermission(editingRole, bit)}
                  disabled={false}
                />
                <PermissionCategory
                  title={PERMISSION_CATEGORIES.discordImportOnly.title}
                  permissions={PERMISSION_CATEGORIES.discordImportOnly.permissions}
                  rolePermissions={editingRole.permissions}
                  onToggle={(bit) => handleTogglePermission(editingRole, bit)}
                  disabled={true}
                />
              </div>
            </div>
          </div>
        )}
      </div>
    );
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-gray-400">{t('admin.loadingRoles')}</div>
      </div>
    );
  }

  return (
    <div className="max-w-5xl">
      <div className="mb-6">
        <div>
          <h2 className="text-2xl font-bold text-gray-100 mb-2">{t('admin.rolesTitle')}</h2>
          <p className="text-gray-400">
            {t('admin.rolesDesc')}
          </p>
        </div>
      </div>

      {error && (
        <div className="mb-6 p-4 rounded-lg bg-red-900/20 border border-red-600/30 text-red-400">
          {error}
        </div>
      )}
      {usersError && (
        <div className="mb-6 p-4 rounded-lg bg-yellow-900/20 border border-yellow-600/30 text-yellow-300">
          {usersError}
        </div>
      )}

      {/* Create Role Form */}
      {showCreateForm && (
        <div className="mb-6 p-6 rounded-lg bg-gray-800/50 border border-gray-700">
          <h3 className="text-lg font-semibold text-gray-200 mb-4">{t('admin.createNewRole')}</h3>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">
                {t('admin.roleName')}
              </label>
              <input
                type="text"
                value={newRole.name}
                onChange={(e) => setNewRole({ ...newRole, name: e.target.value })}
                className="w-full px-4 py-2 bg-gray-900 border border-gray-700 rounded-lg text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder={t('admin.roleModPlaceholder')}
                maxLength={32}
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">
                {t('admin.roleAppearance')}
              </label>
              <button
                type="button"
                onClick={openCreateAppearanceModal}
                className="flex items-center gap-3 px-3 py-2 bg-gray-900 border border-gray-700 rounded-lg hover:bg-gray-800 transition-colors w-full text-left"
              >
                <span
                  className="w-6 h-6 rounded border border-gray-600 shrink-0"
                  style={{ backgroundColor: newRole.color || DEFAULT_ROLE_COLOR }}
                />
                <span className="text-sm text-gray-300 font-mono">{newRole.color || DEFAULT_ROLE_COLOR}</span>
                <span className="ml-auto text-xs text-gray-500">{t('admin.editArrow')}</span>
              </button>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">
                {t('admin.roleCategory')}
              </label>
              <select
                value={newRole.categoryId}
                onChange={(e) => setNewRole({ ...newRole, categoryId: e.target.value })}
                className="w-full px-4 py-2 bg-gray-900 border border-gray-700 rounded-lg text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="">{t('admin.noCategory')}</option>
                {sortedRoleCategories.map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <div className="flex items-center justify-between p-3 rounded-lg bg-gray-900/50">
                <span className="text-sm font-medium text-gray-300">
                  {t('admin.allowMention')}
                </span>
                <button
                  type="button"
                  onClick={() => setNewRole({ ...newRole, mentionable: !newRole.mentionable })}
                  className={`
                    relative inline-flex h-6 w-11 items-center rounded-full transition-colors cursor-pointer
                    ${newRole.mentionable ? 'bg-blue-600' : 'bg-gray-600'}
                  `}
                  role="switch"
                  aria-checked={newRole.mentionable}
                >
                  <span
                    className={`
                      inline-block h-4 w-4 transform rounded-full bg-white transition-transform
                      ${newRole.mentionable ? 'translate-x-6' : 'translate-x-1'}
                    `}
                  />
                </button>
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between p-3 rounded-lg bg-gray-900/50">
                <span className="text-sm font-medium text-gray-300">
                  {t('admin.displaySeparately')}
                </span>
                <button
                  type="button"
                  onClick={() => setNewRole({ ...newRole, hoist: !newRole.hoist })}
                  className={`
                    relative inline-flex h-6 w-11 items-center rounded-full transition-colors cursor-pointer
                    ${newRole.hoist ? 'bg-blue-600' : 'bg-gray-600'}
                  `}
                  role="switch"
                  aria-checked={newRole.hoist}
                >
                  <span
                    className={`
                      inline-block h-4 w-4 transform rounded-full bg-white transition-transform
                      ${newRole.hoist ? 'translate-x-6' : 'translate-x-1'}
                    `}
                  />
                </button>
              </div>
            </div>

            <div className="flex gap-3 pt-2">
              <button
                onClick={handleCreateRole}
                className="flex items-center gap-2 px-6 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium transition-colors"
              >
                <Save className="w-4 h-4" />
                {t('admin.createRole')}
              </button>
              <button
                onClick={() => setShowCreateForm(false)}
                className="px-6 py-2 bg-gray-700 hover:bg-gray-600 text-gray-200 rounded-lg font-medium transition-colors"
              >
                {t('common.cancel')}
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="mb-4 p-4 rounded-xl border border-gray-700 bg-gray-900/40">
        <h3 className="text-sm font-semibold text-gray-200 mb-1">{t('admin.defaultPerms')}</h3>
        <p className="text-sm text-gray-400">
          {t('admin.defaultPermsDesc')}
        </p>
      </div>

      <div className="mb-4 flex flex-col sm:flex-row gap-3 sm:items-center">
        <div className="relative flex-1">
          <Search className="w-4 h-4 text-gray-500 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={t('admin.searchRoles')}
            className="w-full pl-10 pr-3 py-2.5 bg-gray-900 border border-gray-700 rounded-lg text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        <button
          onClick={() => setShowCreateForm(!showCreateForm)}
          className="flex items-center justify-center gap-2 px-4 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium transition-colors sm:w-auto"
        >
          {showCreateForm ? (
            <>
              <X className="w-4 h-4" />
              {t('common.cancel')}
            </>
          ) : (
            <>
              <Plus className="w-4 h-4" />
              {t('admin.createNewRole')}
            </>
          )}
        </button>
        <button
          onClick={() => setShowCreateCategoryForm((prev) => !prev)}
          className="flex items-center justify-center gap-2 px-4 py-2.5 bg-gray-700 hover:bg-gray-600 text-white rounded-lg font-medium transition-colors sm:w-auto"
        >
          {showCreateCategoryForm ? (
            <>
              <X className="w-4 h-4" />
              {t('admin.cancelCategory')}
            </>
          ) : (
            <>
              <Plus className="w-4 h-4" />
              {t('admin.createRoleCategory')}
            </>
          )}
        </button>
      </div>

      {showCreateCategoryForm && (
        <div className="mb-4 p-4 rounded-lg border border-gray-700 bg-gray-900/40 flex flex-col sm:flex-row gap-3">
          <input
            type="text"
            value={newCategoryName}
            onChange={(e) => setNewCategoryName(e.target.value)}
            placeholder={t('admin.categoryNamePlaceholder')}
            maxLength={32}
            className="flex-1 px-4 py-2 bg-gray-900 border border-gray-700 rounded-lg text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <button
            type="button"
            onClick={handleCreateRoleCategory}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium transition-colors"
          >
            {t('admin.createCategory')}
          </button>
        </div>
      )}

      <p className="text-sm text-gray-400 mb-4">
        {t('admin.membersColorHint')} {t('admin.rolesReorderHint')}
      </p>

      {roleViewActive && viewedRole && (
        <div className="mb-4 rounded-xl border border-fuchsia-400/30 bg-fuchsia-500/10 px-4 py-3 flex items-center justify-between gap-3">
          <div className="text-sm text-fuchsia-100">
            {t('admin.rolesReadOnly', { role: viewedRole.name })}
          </div>
          <button
            type="button"
            onClick={() => void handleEndRoleView()}
            className="px-3 py-1.5 rounded-lg bg-fuchsia-400 text-black text-sm font-semibold hover:bg-fuchsia-300 transition-colors"
          >
            {t('admin.endSession')}
          </button>
        </div>
      )}

      <div className="rounded-xl border border-gray-800 bg-gray-900/30 overflow-visible">
        <div className="grid grid-cols-[minmax(0,1fr)_90px_90px] px-4 py-3 border-b border-gray-800 text-xs font-semibold uppercase tracking-wide text-gray-400">
          <span>{t('admin.roleCount', { count: filteredRoles.length })}</span>
          <span>{t('admin.membersHeader')}</span>
          <span className="text-right">{t('admin.actionsHeader')}</span>
        </div>

        {filteredRoles.length === 0 && (
          <div className="px-4 py-8 text-sm text-gray-400 text-center">
            {t('admin.noRolesFound', { query: searchQuery })}
          </div>
        )}

        {categorySections.map((section) => {
          const sectionRoles = groupedRoles.get(section.id) ?? [];
          if (sectionRoles.length === 0) return null;
          const isCollapsed = !!collapsedCategories[section.id];
          const isRealCategory = roleCategoryMap.has(section.id);
          const acceptsDrop = canReorder && (
            (dragItem?.type === 'role' && section.id !== '__default')
            || (dragItem?.type === 'category' && isRealCategory && dragItem.id !== section.id)
          );
          const isDropTarget = acceptsDrop && dropTargetId === section.id;

          return (
            <div key={section.id} className="border-b border-gray-800 last:border-b-0">
              <button
                type="button"
                onClick={() => toggleCategoryCollapse(section.id)}
                {...(canReorder && isRealCategory ? dragSourceProps('category', section.id) : {})}
                {...dropHandlers(section.id, acceptsDrop, () => handleDropOnSection(section.id))}
                title={canReorder && isRealCategory ? t('admin.dragToReorder') : undefined}
                className={`w-full px-4 py-2 hover:bg-gray-800/60 text-left border-b border-gray-800 flex items-center justify-between transition-colors ${
                  isDropTarget ? 'bg-blue-500/15 shadow-[inset_0_2px_0_0_rgb(59,130,246)]' : 'bg-gray-900/50'
                } ${dragItem?.id === section.id ? 'opacity-50' : ''}`}
              >
                <div className="flex items-center gap-2 text-sm font-semibold text-gray-300">
                  {canReorder && isRealCategory && <GripVertical className="w-4 h-4 text-gray-500 cursor-grab" />}
                  {isCollapsed ? (
                    <ChevronRight className="w-4 h-4" />
                  ) : (
                    <ChevronDown className="w-4 h-4" />
                  )}
                  <span>{section.name}</span>
                </div>
                <span className="text-xs text-gray-400">{t('admin.rolesCountLabel', { count: sectionRoles.length })}</span>
              </button>

              {!isCollapsed && sectionRoles.map((role) => renderRoleRow(role))}
            </div>
          );
        })}
      </div>

      {appearanceModal && (
        <AppearanceModal
          roleName={appearanceModal.roleName}
          initialColor={appearanceModal.color}
          initialStyleType={appearanceModal.styleType}
          initialStyleColors={appearanceModal.styleColors}
          onApply={applyAppearanceModal}
          onClose={() => setAppearanceModal(null)}
        />
      )}

      {/* Floating unsaved-changes bar */}
      {editingRoleId && (() => {
        const activeRole = roles.find((r) => r.id === editingRoleId);
        if (!activeRole) return null;
        const draft = roleDrafts[editingRoleId];
        if (!draft || !hasRoleDraftChanges(activeRole, draft)) return null;
        const isSaving = !!savingRoleIds[editingRoleId];
        return (
          <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[60] pointer-events-none flex justify-center w-full px-4">
            <div className="unsaved-changes-bar pointer-events-auto flex items-center gap-4 px-5 py-3 rounded-xl bg-gray-950/95 border border-purple-700/40 backdrop-blur-sm">
              <span className="unsaved-warning-text text-sm font-semibold whitespace-nowrap">
                {t('admin.unsavedChanges')}
              </span>
              <div className="flex items-center gap-2 ml-2">
                <button
                  type="button"
                  onClick={() => handleRevertRoleChanges(activeRole)}
                  disabled={isSaving}
                  className="px-4 py-1.5 rounded-lg bg-red-700 hover:bg-red-600 text-white text-sm font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed border border-red-600/50"
                >
                  {t('admin.discard')}
                </button>
                <button
                  type="button"
                  onClick={() => { void handleSaveRoleChanges(draft); }}
                  disabled={isSaving}
                  className="discover-nav-button px-4 py-1.5 rounded-lg bg-[#7c5cff] hover:bg-[#6a4de0] text-white text-sm font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed border border-purple-500/40"
                >
                  {isSaving ? t('admin.savingEllipsis') : t('admin.apply')}
                </button>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
