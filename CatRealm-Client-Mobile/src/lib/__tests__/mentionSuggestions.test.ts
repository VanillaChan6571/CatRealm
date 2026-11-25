import {
  activeChannelQuery,
  activeMentionQuery,
  buildChannelSuggestions,
  buildMentionSuggestions,
} from '../mentionSuggestions';

const members = [
  { id: '1', username: 'Alesya', avatar: '/a.png' },
  { id: '2', username: 'Dusk' },
  { id: '3', username: 'nya' },
  { id: '4', username: 'QuoteBot', isBot: true },
];
const roles = [
  { id: 'r0', name: 'everyone', position: 0, is_default: 1 },
  { id: 'r1', name: 'Guard', position: 2 },
  { id: 'r2', name: 'Architect', position: 5 },
];

test('finds the mention being typed before the caret', () => {
  expect(activeMentionQuery('@')).toBe('');
  expect(activeMentionQuery('hey @al')).toBe('al');
  expect(activeMentionQuery('line one\n@Du')).toBe('Du');
  expect(activeMentionQuery('mail me@home')).toBeNull();
  expect(activeMentionQuery('@nya done')).toBeNull();
  expect(activeMentionQuery('no mention')).toBeNull();
});

test('an empty query lists the alias, roles highest first, then members', () => {
  const items = buildMentionSuggestions('', members, roles, null);
  expect(items.map((item) => item.label)).toEqual([
    '@everyone', '@Architect', '@Guard', '@Alesya', '@Dusk', '@nya', '@QuoteBot',
  ]);
});

test('filters case-insensitively and puts prefix matches first', () => {
  const items = buildMentionSuggestions('a', members, roles, '@here');
  expect(items.map((item) => item.label)).toEqual(['@Architect', '@Guard', '@Alesya', '@nya']);
});

const channels = [
  { id: 'c1', name: 'general', type: 'basic' },
  { id: 'c2', name: 'nya-helpdesk', type: 'basic' },
  { id: 'c3', name: 'Lounge', type: 'voice' },
];

test('finds the #channel being typed before the caret', () => {
  expect(activeChannelQuery('#')).toBe('');
  expect(activeChannelQuery('see #gen')).toBe('gen');
  expect(activeChannelQuery('line\n#nya')).toBe('nya');
  expect(activeChannelQuery('issue#4')).toBeNull();
  expect(activeChannelQuery('#general done')).toBeNull();
  expect(activeChannelQuery('<#c1> ')).toBeNull();
  expect(activeChannelQuery('<#c1>')).toBeNull();
});

test('lists channels, prefix matches first, and inserts <#id>', () => {
  expect(buildChannelSuggestions('', channels).map((item) => item.label)).toEqual(['#general', '#nya-helpdesk', '#Lounge']);
  expect(buildChannelSuggestions('l', channels).map((item) => item.label)).toEqual(['#Lounge', '#general', '#nya-helpdesk']);
  const [voice] = buildChannelSuggestions('lou', channels);
  expect(voice).toMatchObject({ type: 'channel', insert: '<#c3>', description: 'Voice channel' });
});

test('inserts plain-text mentions and uses the realm alias', () => {
  const [alias] = buildMentionSuggestions('', [], [], 'all');
  expect(alias.insert).toBe('@all');
  const [member] = buildMentionSuggestions('dusk', members, [], null);
  expect(member).toMatchObject({ type: 'user', insert: '@Dusk' });
});
