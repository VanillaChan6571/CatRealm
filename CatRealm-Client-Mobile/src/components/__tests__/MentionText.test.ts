jest.mock('@/lib/api', () => ({ createApi: jest.fn() }));
jest.mock('@/stores/authStore', () => ({ useAuthStore: jest.fn() }));
jest.mock('@/stores/presenceStore', () => ({ usePresenceStore: jest.fn() }));
jest.mock('@/stores/serverStore', () => ({ useServerStore: jest.fn() }));
jest.mock('@/theme', () => ({ useTheme: jest.fn() }));
jest.mock('expo-router', () => ({ useRouter: jest.fn() }));

import { buildMentionIndex, splitMentions } from '../MentionText';

const index = buildMentionIndex(
  [{ id: 'u-catrealm', username: 'CatRealm' }, { id: 'u-vanilla', username: 'VanillaChanny' }],
  [{ id: 'r-mod', name: 'Mods', color: '#22c55e' }],
  [{ id: '68deafc8-3147-43af-bc7b-2021c5cb432a', name: 'general' }],
  '@everyone',
  'u-vanilla',
);

test('known @names, role names and the everyone alias become pills; unknown names stay text', () => {
  expect(splitMentions('@CatRealm if your talking about @VanillaChanny. cc @Mods @everyone @nobody', index)).toEqual([
    { t: 'user', user: { id: 'u-catrealm', username: 'CatRealm' } },
    { t: 'text', v: ' if your talking about ' },
    { t: 'user', user: { id: 'u-vanilla', username: 'VanillaChanny' } },
    { t: 'text', v: '. cc ' },
    { t: 'role', role: { id: 'r-mod', name: 'Mods', color: '#22c55e' } },
    { t: 'text', v: ' ' },
    { t: 'role', role: { id: 'everyone', name: 'everyone', color: null } },
    { t: 'text', v: ' @nobody' },
  ]);
});

test('channel and id tokens resolve; unknown channels show as deleted; emails are not mentions', () => {
  expect(splitMentions('<#68deafc8-3147-43af-bc7b-2021c5cb432a> test <#gone> <@u-catrealm> a@catrealm.app', index)).toEqual([
    { t: 'channel', channel: { id: '68deafc8-3147-43af-bc7b-2021c5cb432a', name: 'general' } },
    { t: 'text', v: ' test ' },
    { t: 'missing-channel' },
    { t: 'text', v: ' ' },
    { t: 'user', user: { id: 'u-catrealm', username: 'CatRealm' } },
    { t: 'text', v: ' a@catrealm.app' },
  ]);
});

test('outside a server, channel tokens are left as typed', () => {
  const dmIndex = buildMentionIndex([], [], null, null, null);
  expect(splitMentions('<#abc>', dmIndex)).toEqual([{ t: 'text', v: '<#abc>' }]);
});
