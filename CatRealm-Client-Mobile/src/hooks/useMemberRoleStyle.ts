import { useShallow } from 'zustand/react/shallow';
import { usePresenceStore } from '@/stores/presenceStore';

export interface MemberRoleStyle {
  color: string | null;
  styleType: string | null;
  styleColors: string | null;
}

const NONE: MemberRoleStyle = { color: null, styleType: null, styleColors: null };

/**
 * A member's role name styling (colour, gradient, rgb_flow) from the live member list, as
 * desktop's MessageItem does. Thread messages and forum posts arrive without role styles, and
 * live data also picks up role changes made after a message was sent. All fields are null when
 * the member is offline or `userId` is missing; callers fall back to what the message carries.
 */
export function useMemberRoleStyle(userId: string | null | undefined): MemberRoleStyle {
  return usePresenceStore(useShallow((s) => {
    if (!userId) return NONE;
    const member = s.onlineUsers.find((u) => u.id === userId);
    if (!member) return NONE;
    return {
      color: member.roleColor ?? null,
      styleType: member.roleStyleType ?? null,
      styleColors: member.roleStyleColors ?? null,
    };
  }));
}
