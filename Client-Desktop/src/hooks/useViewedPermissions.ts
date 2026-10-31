import { useAuthStore } from '../stores/authStore';
import { useMemo } from 'react';

export function useViewedPermissions() {
  const actualUser = useAuthStore((s) => s.user);

  return useMemo(() => {
    const isRoleView = !!actualUser?.viewAsRole;
    return {
      permissions: actualUser?.permissions,
      isRoleView,
      isPrivilegedView: !isRoleView && !!(actualUser?.role === 'owner' || actualUser?.role === 'admin' || actualUser?.isOwner),
    };
  }, [actualUser?.permissions, actualUser?.role, actualUser?.isOwner, actualUser?.viewAsRole]);
}
