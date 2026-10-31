import { parseInviteCode } from '../serverDirectory';

jest.mock('@/lib/api', () => ({ createAuthenticatedApi: jest.fn() }));

test.each([
  ['https://catrealm.app/invite/AbC123', 'AbC123'],
  ['catrealm.app/invite/cozy_realm-01?ref=x', 'cozy_realm-01'],
  ['AbC123', 'AbC123'],
  ['realm.example.com', null],
  ['https://realm.example.com', null],
  ['localhost:3000', null],
  ['ab', null],
])('%s → %s', (input, expected) => {
  expect(parseInviteCode(input)).toBe(expected);
});
