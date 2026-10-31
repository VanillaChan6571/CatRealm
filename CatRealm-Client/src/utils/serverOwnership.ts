import { decodeToken } from './token';

/**
 * Realm tokens carry server-local ownership claims. Older tokens may encode
 * `is_owner` as 1 while newer/client-created fixtures may use true.
 */
export function isServerOwnerToken(token: string | null | undefined): boolean {
  if (!token) return false;

  const payload = decodeToken(token);
  if (!payload) return false;

  const role = typeof payload.role === 'string' ? payload.role.toLowerCase() : '';
  const ownerFlag = payload.is_owner;
  return role === 'owner'
    || ownerFlag === true
    || ownerFlag === 1
    || ownerFlag === '1';
}
