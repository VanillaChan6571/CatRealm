import type { Channel, Role } from '../types';
import { PERMISSIONS } from '../utils/permissions';
import type { PermissionOverwrite } from '../stores/viewAsRoleStore';

function toPermissionBits(value: number | undefined): bigint {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0n;
  const normalized = Math.trunc(value);
  if (normalized < 0) return BigInt(normalized >>> 0);
  return BigInt(normalized);
}

const ALL_PERMISSIONS = Number(
  Object.values(PERMISSIONS)
    .filter((value): value is number => typeof value === 'number')
    .reduce((acc, value) => (acc | toPermissionBits(value)), 0n)
);

function applyPermissionOverwrites(
  currentPermissions: number,
  overwrites: PermissionOverwrite[],
  roleIds: string[],
  defaultRoleId: string | null,
) {
  let permissions = toPermissionBits(currentPermissions);
  let everyoneAllow = 0n;
  let everyoneDeny = 0n;
  let rolesAllow = 0n;
  let rolesDeny = 0n;

  for (const overwrite of overwrites) {
    if (overwrite.target_type !== 'role') continue;
    const allow = toPermissionBits(overwrite.allow);
    const deny = toPermissionBits(overwrite.deny);
    if (defaultRoleId && overwrite.target_id === defaultRoleId) {
      everyoneAllow |= allow;
      everyoneDeny |= deny;
      continue;
    }
    if (roleIds.includes(overwrite.target_id)) {
      rolesAllow |= allow;
      rolesDeny |= deny;
    }
  }

  permissions = (permissions & ~everyoneDeny) | everyoneAllow;
  permissions = (permissions & ~rolesDeny) | rolesAllow;
  return Number(permissions);
}

export function computeViewAsRoleChannelPermissions(
  channel: Channel,
  role: Role,
  roles: Role[],
  categoryOverwritesByCategoryId: Record<string, PermissionOverwrite[]>,
  channelOverwritesByChannelId: Record<string, PermissionOverwrite[]>,
) {
  const defaultRole = roles.find((entry) => Number(entry.is_default) === 1) ?? null;
  const roleIds = [role.id];
  let permissions = Number(defaultRole?.permissions ?? 0) | Number(role.permissions ?? 0);
  const administratorMask = toPermissionBits(PERMISSIONS.ADMINISTRATOR);

  if ((toPermissionBits(permissions) & administratorMask) === administratorMask) {
    return ALL_PERMISSIONS;
  }

  if (channel.category_id) {
    permissions = applyPermissionOverwrites(
      permissions,
      categoryOverwritesByCategoryId[channel.category_id] ?? [],
      roleIds,
      defaultRole?.id ?? null,
    );
  }

  permissions = applyPermissionOverwrites(
    permissions,
    channelOverwritesByChannelId[channel.id] ?? [],
    roleIds,
    defaultRole?.id ?? null,
  );

  return permissions;
}

export function computeViewAsRoleBasePermissions(role: Role, roles: Role[]) {
  const defaultRole = roles.find((entry) => Number(entry.is_default) === 1) ?? null;
  return Number(defaultRole?.permissions ?? 0) | Number(role.permissions ?? 0);
}

export function getViewAsRoleChannels(
  channels: Channel[],
  role: Role | null,
  roles: Role[],
  categoryOverwritesByCategoryId: Record<string, PermissionOverwrite[]>,
  channelOverwritesByChannelId: Record<string, PermissionOverwrite[]>,
) {
  if (!role) return channels;
  return channels
    .map((channel) => ({
      ...channel,
      effective_permissions: computeViewAsRoleChannelPermissions(
        channel,
        role,
        roles,
        categoryOverwritesByCategoryId,
        channelOverwritesByChannelId,
      ),
    }))
    .filter((channel) => (Number(channel.effective_permissions ?? 0) & PERMISSIONS.VIEW_CHANNELS) === PERMISSIONS.VIEW_CHANNELS)
    .sort((a, b) => a.position - b.position);
}
