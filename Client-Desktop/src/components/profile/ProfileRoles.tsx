import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Role, PersonalFriendRole } from '../../types';
import { useAuthStore } from '../../stores/authStore';
import { resolveRoleIconUrl } from '../../utils/avatar';
import { getRoleNameStyle } from '../../lib/roleStyles';

interface ProfileRolesProps {
  assignedRoles: Role[];
  privateAssignedRoles: PersonalFriendRole[];
  allRoles: Role[];
  roleIds: string[];
  isPrivateRolesContext: boolean;
  canManageRoles: boolean;
  onRoleIdsChange: (nextRoleIds: string[]) => void | Promise<void>;
  savingRoles: boolean;
}

export function ProfileRoles({
  assignedRoles,
  privateAssignedRoles,
  allRoles,
  roleIds,
  isPrivateRolesContext,
  canManageRoles,
  onRoleIdsChange,
  savingRoles,
}: ProfileRolesProps) {
  const { t } = useTranslation();
  const serverUrl = useAuthStore((s) => s.serverUrl);
  const [managingRoles, setManagingRoles] = useState(false);
  const displayRoles = isPrivateRolesContext ? privateAssignedRoles : assignedRoles;

  // Returns the best base color for a role badge bubble.
  // For gradient/rgb_flow, the first stop from style_colors is more relevant than role.color.
  const getBubbleColor = (role: Role | PersonalFriendRole): string | null => {
    const r = role as Role;
    if (r.style_type === 'gradient' || r.style_type === 'rgb_flow') {
      try {
        const colors = JSON.parse(r.style_colors ?? '[]');
        if (Array.isArray(colors) && colors.length >= 1 && typeof colors[0] === 'string') {
          return colors[0];
        }
      } catch { /* ignore */ }
    }
    return role.color || null;
  };
  const showManageControl = canManageRoles && !isPrivateRolesContext;
  const defaultRoleId = allRoles.find((role) => role.is_default)?.id
    ?? allRoles.find((role) => role.name === 'Member')?.id
    ?? null;
  const availableRoles = allRoles.filter((role) => !roleIds.includes(role.id));

  const handleAddRole = async (roleId: string) => {
    if (savingRoles) return;
    if (roleIds.includes(roleId)) return;
    const next = [...roleIds, roleId];
    await onRoleIdsChange(next);
  };

  const handleRemoveRole = async (roleId: string) => {
    if (savingRoles) return;
    if (!roleIds.includes(roleId)) return;
    if (defaultRoleId && roleId === defaultRoleId) return;
    const next = roleIds.filter((id) => id !== roleId);
    await onRoleIdsChange(next);
  };

  if (displayRoles.length === 0 && !showManageControl) {
    return null;
  }

  return (
    <div className="space-y-2">
      <label className="text-xs text-text-muted font-semibold">
        {isPrivateRolesContext ? t('profile.rolesPrivate') : t('profile.roles')}
      </label>

      {displayRoles.length === 0 && !showManageControl && (
        <p className="text-xs text-text-muted italic">{t('profile.noRolesAssigned')}</p>
      )}

      {(displayRoles.length > 0 || showManageControl) && (
        <div className="flex flex-wrap gap-2">
          {displayRoles.map((role) => (
            <span
              key={role.id}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border"
              style={(() => {
                const bc = getBubbleColor(role);
                return {
                  backgroundColor: bc ? `${bc}15` : 'transparent',
                  borderColor: bc || 'var(--border)',
                };
              })()}
            >
              {resolveRoleIconUrl((role as Role).icon, serverUrl) && (
                <img
                  src={resolveRoleIconUrl((role as Role).icon, serverUrl)!}
                  alt=""
                  className="w-3.5 h-3.5 rounded-full"
                />
              )}
              <span style={getRoleNameStyle(role.color, (role as Role).style_type, (role as Role).style_colors)}>
                {role.name}
              </span>
              {showManageControl && (!defaultRoleId || role.id !== defaultRoleId) && (
                <button
                  type="button"
                  onClick={() => { void handleRemoveRole(role.id); }}
                  disabled={savingRoles}
                  className="ml-0.5 text-text-muted hover:text-text-primary disabled:opacity-50"
                  title={t('profile.removeRole', { role: role.name })}
                  aria-label={t('profile.removeRole', { role: role.name })}
                >
                  ×
                </button>
              )}
            </span>
          ))}

          {showManageControl && (
            <button
              type="button"
              onClick={() => setManagingRoles((prev) => !prev)}
              className={`inline-flex items-center justify-center w-7 h-7 rounded-full text-sm font-semibold border transition-colors ${
                managingRoles
                  ? 'border-accent text-accent bg-accent/10'
                  : 'border-border text-text-muted hover:text-text-primary hover:border-text-muted'
              }`}
              title={managingRoles ? t('profile.closeRoleEditor') : t('profile.manageRoles')}
              aria-label={managingRoles ? t('profile.closeRoleEditor') : t('profile.manageRoles')}
              disabled={savingRoles}
            >
              +
            </button>
          )}
        </div>
      )}

      {showManageControl && managingRoles && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4"
          onClick={() => setManagingRoles(false)}
        >
          <div
            className="w-full max-w-sm rounded-lg border border-border bg-bg-elevated shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-4 py-3 border-b border-border">
              <h3 className="text-sm font-semibold text-text-primary">{t('profile.addRoles')}</h3>
              <button
                type="button"
                onClick={() => setManagingRoles(false)}
                className="text-text-muted hover:text-text-primary transition-colors text-lg leading-none"
                aria-label={t('profile.closeRoleSelector')}
              >
                &times;
              </button>
            </div>

            <div className="p-3">
              {availableRoles.length === 0 ? (
                <p className="text-xs text-text-muted italic">{t('profile.noMoreRoles')}</p>
              ) : (
                <div className="space-y-1.5 max-h-56 overflow-y-auto">
                  {availableRoles.map((role) => (
                    <button
                      key={role.id}
                      type="button"
                      onClick={() => { void handleAddRole(role.id); }}
                      disabled={savingRoles}
                      className="w-full text-left flex items-center gap-2 p-2 rounded hover:bg-bg-hover disabled:opacity-50"
                    >
                      {resolveRoleIconUrl((role as Role).icon, serverUrl) && (
                        <img
                          src={resolveRoleIconUrl((role as Role).icon, serverUrl)!}
                          alt=""
                          className="w-4 h-4 rounded-full"
                        />
                      )}
                      <span
                        className="text-sm font-medium"
                        style={getRoleNameStyle(role.color, (role as Role).style_type, (role as Role).style_colors)}
                      >
                        {role.name}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {showManageControl && savingRoles && (
        <p className="text-xs text-text-muted">{t('profile.updatingRoles')}</p>
      )}

      {showManageControl && displayRoles.length === 0 && (
        <p className="text-xs text-text-muted italic">{t('profile.noRolesAssigned')}</p>
      )}
    </div>
  );
}
