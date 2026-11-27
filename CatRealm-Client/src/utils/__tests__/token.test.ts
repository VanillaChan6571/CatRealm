import { describe, expect, it } from 'vitest';
import { clearSession, decodeToken, loadSession, parseTokenUser, saveSession } from '../token';

function createUnsignedJwt(payload: Record<string, unknown>) {
  const header = { alg: 'none', typ: 'JWT' };
  const encode = (value: Record<string, unknown>) => Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${encode(header)}.${encode(payload)}.`;
}

describe('token utils', () => {
  it('does not let a stale tab clear or overwrite a newer session', () => {
    localStorage.clear();
    const alice = { id: 'alice', username: 'alice', accountType: 'central' as const, permissions: 0 };
    const bob = { id: 'bob', username: 'bob', accountType: 'central' as const, permissions: 0 };
    saveSession('alice-token', null, alice, null, true);
    saveSession('bob-token', null, bob, null, true);
    clearSession('alice-token');
    saveSession('alice-token', null, alice);
    expect(loadSession()?.token).toBe('bob-token');
    clearSession(null);
    expect(loadSession()?.token).toBe('bob-token');
  });
  it('decodes base64url JWT payloads', () => {
    const token = createUnsignedJwt({
      sub: '123e4567-e89b-12d3-a456-426614174000',
      username: 'test_user',
      type: 'central',
    });

    expect(decodeToken(token)).toMatchObject({
      sub: '123e4567-e89b-12d3-a456-426614174000',
      username: 'test_user',
      type: 'central',
    });
  });

  it('parses central users from decoded central payloads', () => {
    const payload = decodeToken(createUnsignedJwt({
      sub: 'central-user-id',
      username: 'alice',
      type: 'central',
    }));

    expect(payload).not.toBeNull();
    expect(parseTokenUser(payload!)).toEqual({
      id: 'central-user-id',
      username: 'alice',
      accountType: 'central',
    });
  });
});
