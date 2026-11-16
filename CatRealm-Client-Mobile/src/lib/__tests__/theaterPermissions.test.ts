import { canControlTheater } from '../theaterPermissions';
import { PERMISSIONS } from '@/utils/permissions';

test.each([
  ['owner', { id: 'me', isOwner: true }, 0, true],
  ['administrator', { id: 'me', permissions: PERMISSIONS.ADMINISTRATOR }, 0, true],
  ['channel manager', { id: 'me', permissions: PERMISSIONS.MANAGE_CHANNELS }, 0, true],
  ['channel playback grant', { id: 'me', permissions: 0 }, PERMISSIONS.PLAY_IN_THEATER, true],
  ['role playback grant without overrides', { id: 'me', permissions: PERMISSIONS.PLAY_IN_THEATER }, undefined, true],
  ['channel playback denial', { id: 'me', permissions: PERMISSIONS.PLAY_IN_THEATER }, 0, false],
  ['moderator name without permission', { id: 'me', role: 'moderator', permissions: 0 }, 0, false],
  ['ordinary viewer', { id: 'me', permissions: 0 }, 0, false],
] as const)('%s uses the server playback policy without needing to be host', (_name, user, channel, expected) => {
  expect(canControlTheater(user, channel, 'someone-else', 'me')).toBe(expected);
});

test('delegated host uses the realm identity, and missing identities never match', () => {
  expect(canControlTheater(null, 0, 'realm-id', 'realm-id')).toBe(true);
  expect(canControlTheater(null, 0, null, null)).toBe(false);
  expect(canControlTheater({ id: 'central-id' }, 0, 'realm-id', 'other-id')).toBe(false);
});

test('named channel grants and denials override legacy numeric projections', () => {
  const user = { id: 'me', permissions: PERMISSIONS.PLAY_IN_THEATER, permissionKeys: [] };
  expect(canControlTheater(user, PERMISSIONS.PLAY_IN_THEATER, null, null, [])).toBe(false);
  expect(canControlTheater(user, 0, null, null, ['PLAY_IN_THEATER'])).toBe(true);
});

test('named role grants are honored without a channel override', () => {
  expect(canControlTheater({ id: 'me', permissions: 0, permissionKeys: ['MANAGE_CHANNELS'] }, 0, null, null)).toBe(true);
  expect(canControlTheater({ id: 'me', permissions: 0, permissionKeys: ['PLAY_IN_THEATER'] }, undefined, null, null)).toBe(true);
});
