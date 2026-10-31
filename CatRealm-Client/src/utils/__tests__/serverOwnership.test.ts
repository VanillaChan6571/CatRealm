import { describe, expect, it } from 'vitest';
import { isServerOwnerToken } from '../serverOwnership';

function createUnsignedJwt(payload: Record<string, unknown>) {
  const header = { alg: 'none', typ: 'JWT' };
  const encode = (value: Record<string, unknown>) => Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${encode(header)}.${encode(payload)}.`;
}

describe('isServerOwnerToken', () => {
  it.each([
    { role: 'owner', is_owner: 0 },
    { role: 'member', is_owner: 1 },
    { role: 'member', is_owner: true },
    { role: 'member', is_owner: '1' },
  ])('recognizes owner claims in legacy and current token formats: %o', (payload) => {
    expect(isServerOwnerToken(createUnsignedJwt(payload))).toBe(true);
  });

  it.each([
    { role: 'member', is_owner: 0 },
    { role: 'admin', is_owner: false },
    { role: 'member', is_owner: '0' },
  ])('does not treat non-owner claims as ownership: %o', (payload) => {
    expect(isServerOwnerToken(createUnsignedJwt(payload))).toBe(false);
  });

  it('returns false for missing or malformed tokens', () => {
    expect(isServerOwnerToken(undefined)).toBe(false);
    expect(isServerOwnerToken('not-a-token')).toBe(false);
  });
});
