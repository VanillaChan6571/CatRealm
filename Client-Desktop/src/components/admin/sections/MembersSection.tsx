import { useState, useEffect } from 'react';
import { Search, UserX, Ban } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { api } from '../../../lib/api';
import { resolveAvatarUrl } from '../../../utils/avatar';
import { useAuthStore } from '../../../stores/authStore';

interface User {
  id: string;
  username: string;
  avatar: string | null;
  role: string;
  roleIds: string[];
  isOwner: boolean;
  accountType?: 'local' | 'central';
}

interface Role {
  id: string;
  name: string;
  color: string | null;
  is_default?: boolean | number;
}

export function MembersSection() {
  const { t } = useTranslation();
  const serverUrl = useAuthStore((s) => s.serverUrl);
  const [users, setUsers] = useState<User[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      setLoading(true);
      const [usersData, rolesData] = await Promise.all([
        api.get('/api/admin/users'),
        api.get('/api/admin/roles'),
      ]);
      setUsers(usersData);
      setRoles(rolesData);
    } catch (err) {
      console.error('Failed to load data:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleToggleRole = async (userId: string, roleId: string, currentRoleIds: string[]) => {
    try {
      const newRoleIds = currentRoleIds.includes(roleId)
        ? currentRoleIds.filter((id) => id !== roleId)
        : [...currentRoleIds, roleId];

      await api.put(`/api/admin/users/${userId}/roles`, { roleIds: newRoleIds });
      await loadData();
    } catch (err: any) {
      alert(err.response?.data?.error || 'Failed to update roles');
      console.error(err);
    }
  };

  const handleKickUser = async (userId: string, username: string) => {
    if (!confirm(t('admin.kickConfirm', { username }))) return;

    try {
      await api.post(`/api/admin/users/${userId}/kick`, { reason: '' });
      alert(t('admin.kicked', { username }));
      await loadData();
    } catch (err: any) {
      alert(err.response?.data?.error || 'Failed to kick user');
      console.error(err);
    }
  };

  const handleBanUser = async (userId: string, username: string) => {
    if (!confirm(t('admin.banConfirm', { username }))) {
      return;
    }

    try {
      await api.post(`/api/admin/users/${userId}/ban`, { reason: '' });
      alert(t('admin.banned', { username }));
      await loadData();
    } catch (err: any) {
      alert(err.response?.data?.error || 'Failed to ban user');
      console.error(err);
    }
  };

  const filteredUsers = users.filter((user) =>
    user.username.toLowerCase().includes(searchQuery.toLowerCase())
  );

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-gray-400">{t('admin.loadingMembers')}</div>
      </div>
    );
  }

  return (
    <div className="max-w-5xl">
      <div className="mb-6">
        <h2 className="text-2xl font-bold text-gray-100 mb-2">{t('admin.serverMembers')}</h2>
        <p className="text-gray-400">
          {t('admin.serverMembersDesc', { count: users.length })}
        </p>
      </div>

      {/* Search */}
      <div className="mb-6">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-gray-400" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={t('admin.searchMembers')}
            className="w-full pl-10 pr-4 py-2 bg-gray-800 border border-gray-700 rounded-lg text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
      </div>

      {/* Members List */}
      <div className="space-y-2">
        {filteredUsers.map((user) => (
          <div
            key={user.id}
            className="p-4 rounded-lg bg-gray-800/50 border border-gray-700/50 hover:border-gray-600/50 transition-colors"
          >
            <div className="flex items-start gap-4">
              {/* Avatar */}
              <div className="flex-shrink-0">
                {resolveAvatarUrl(user.avatar, serverUrl, user.accountType) ? (
                  <img
                    src={resolveAvatarUrl(user.avatar, serverUrl, user.accountType) || ''}
                    alt={user.username}
                    className="w-12 h-12 rounded-full"
                  />
                ) : (
                  <div className="w-12 h-12 rounded-full bg-blue-600 flex items-center justify-center text-white font-semibold">
                    {user.username[0].toUpperCase()}
                  </div>
                )}
              </div>

              {/* User Info */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-2">
                  <span className="font-medium text-gray-200">{user.username}</span>
                  {user.isOwner && (
                    <span className="text-xs px-2 py-0.5 rounded-full bg-yellow-600/20 text-yellow-400">
                      {t('admin.owner')}
                    </span>
                  )}
                  {user.role === 'admin' && !user.isOwner && (
                    <span className="text-xs px-2 py-0.5 rounded-full bg-red-600/20 text-red-400">
                      {t('admin.adminLegacy')}
                    </span>
                  )}
                </div>

                {/* Role Tags */}
                <div className="flex flex-wrap gap-2 mb-3">
                  {roles
                    .filter((role) => user.roleIds.includes(role.id))
                    .map((role) => (
                      <span
                        key={role.id}
                        className="text-xs px-2 py-1 rounded-full bg-gray-700/50 border border-gray-600"
                        style={{
                          borderColor: role.color || undefined,
                          color: role.color || undefined,
                        }}
                      >
                        {role.name}
                      </span>
                    ))}
                </div>

                {/* Role Assignment - Now available for everyone including owners */}
                <div className="space-y-2">
                  <div className="text-xs text-gray-400 mb-1">
                    {user.isOwner ? t('admin.assignRolesOwner') : t('admin.assignRoles')}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {roles.map((role) => {
                      const hasRole = user.roleIds.includes(role.id);
                      const isDefault = !!role.is_default;

                      return (
                        <button
                          key={role.id}
                          onClick={() =>
                            !isDefault &&
                            handleToggleRole(user.id, role.id, user.roleIds)
                          }
                          disabled={isDefault}
                          className={`
                            text-xs px-3 py-1 rounded-full font-medium transition-colors
                            ${
                              hasRole
                                ? 'bg-blue-600 text-white'
                                : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                            }
                            ${isDefault ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}
                          `}
                        >
                          {role.name}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>

              {/* Actions */}
              {!user.isOwner && (
                <div className="flex gap-2">
                  <button
                    onClick={() => handleKickUser(user.id, user.username)}
                    className="p-2 rounded-lg hover:bg-orange-600/20 text-gray-400 hover:text-orange-400 transition-colors"
                    title={t('admin.kickMember')}
                  >
                    <UserX className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => handleBanUser(user.id, user.username)}
                    className="p-2 rounded-lg hover:bg-red-600/20 text-gray-400 hover:text-red-400 transition-colors"
                    title={t('admin.banMember')}
                  >
                    <Ban className="w-4 h-4" />
                  </button>
                </div>
              )}
            </div>
          </div>
        ))}
      </div>

      {filteredUsers.length === 0 && (
        <div className="text-center py-12 text-gray-400">
          {t('admin.noMembersFound', { query: searchQuery })}
        </div>
      )}
    </div>
  );
}
