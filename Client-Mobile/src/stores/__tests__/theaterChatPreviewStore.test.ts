import { AppState } from 'react-native';
import type { Message } from '@/types';
import { useTheaterChatPreviewStore as store } from '../theaterChatPreviewStore';

jest.mock('../authStore', () => ({ useAuthStore: { getState: () => mockAuth } }));
jest.mock('../theaterStore', () => ({ useTheaterStore: { getState: () => mockTheater } }));
jest.mock('../settingsStore', () => ({ useSettingsStore: { getState: () => mockSettings } }));
jest.mock('../serverStore', () => ({ useServerStore: { getState: () => ({ byId: () => ({ url: 'https://realm.test' }) }) } }));
jest.mock('../blockedUsersStore', () => ({ useBlockedUsersStore: { getState: () => ({ isBlocked: (id: string) => id === 'blocked' }) } }));
const mockAuth = { user: { id: 'self', accountType: 'central' }, serverUrl: 'https://local.test' };
const mockTheater = { channelId: 'movies', serverId: 'realm', focused: true, overlayMode: 'expanded', selfTheaterUserId: 'realm-self' };
const mockSettings = { theaterChatPreviews: true };
const message = (values: Partial<Message> = {}) => ({ id: '1', channel_id: 'movies', user_id: 'friend', username: 'Friend', content: 'Hello!', ...values }) as Message;
const receive = (values: Partial<Message> = {}, url = 'https://realm.test') => store.getState().receive(url, message(values));
beforeEach(() => {
  store.getState().clear();
  mockTheater.focused = true; mockTheater.overlayMode = 'expanded';
  mockSettings.theaterChatPreviews = true; mockAuth.user.accountType = 'central';
  AppState.currentState = 'active';
});
test('holds only the latest bounded text preview; duplicate events do not extend it', () => {
  receive();
  const first = store.getState().preview;
  receive();
  expect(store.getState().preview).toBe(first);
  for (let i = 2; i <= 100; i++) receive({ id: String(i), content: 'x'.repeat(10000), display_name: 'n'.repeat(100) });
  expect(store.getState().preview).toMatchObject({ id: '100', text: 'x'.repeat(240), name: 'n'.repeat(64) });
});
test.each([
  { user_id: 'self' }, { user_id: 'realm-self' }, { user_id: 'blocked' },
  { channel_id: 'another' }, { message_type: 'system' as const }, { thread_id: 'thread' }, { ephemeral: true },
])('skips excluded messages %j', (values) => { receive(values); expect(store.getState().preview).toBeNull(); });
test('realm scoping cannot fall back to another active socket, including local accounts', () => {
  receive({}, 'https://wrong.test'); expect(store.getState().preview).toBeNull();
  mockAuth.user.accountType = 'local';
  receive(); expect(store.getState().preview).toBeNull();
  receive({}, 'https://local.test'); expect(store.getState().preview?.text).toBe('Hello!');
});
test.each(['background', 'inactive'] as const)('ignores messages while %s', (state) => {
  AppState.currentState = state; receive(); expect(store.getState().preview).toBeNull();
});
test('only queues previews when enabled and watching fullscreen', () => {
  mockSettings.theaterChatPreviews = false; receive(); expect(store.getState().preview).toBeNull();
  mockSettings.theaterChatPreviews = true; mockTheater.focused = false; receive(); expect(store.getState().preview).toBeNull();
  mockTheater.focused = true; mockTheater.overlayMode = 'floating'; receive(); expect(store.getState().preview).toBeNull();
});
test.each([{ content: 'spoiler ||secret||' }, { content: '||unclosed secret' }, { nsfw_tags: ['adult'] }])('protects hidden content %j', (values) => {
  receive(values); expect(store.getState().preview).toMatchObject({ text: '', fallback: 'chatHiddenContent' });
});
test('attachments have a text fallback without retaining or fetching media', () => {
  receive({ content: '', attachment_url: '/uploads/file.png' });
  expect(store.getState().preview).toMatchObject({ text: '', fallback: 'chatAttachment' });
  expect(store.getState().preview).not.toHaveProperty('attachment_url');
});
test.each(['/uploads/avatar.png', 'https://auth.test/avatars/friend.png', null])('preserves the avatar URL for the preview: %s', (avatar) => {
  receive({ avatar });
  expect(store.getState().preview?.avatar).toBe(avatar);
});
test('does not retain oversized inline avatar data in the ephemeral preview', () => {
  receive({ avatar: 'data:image/png;base64,' + 'x'.repeat(5000) });
  expect(store.getState().preview?.avatar).toBeNull();
});
test('edits/deletions invalidate only the matching realm/channel/message', () => {
  receive();
  store.getState().invalidate('https://wrong.test', 'movies', '1');
  store.getState().invalidate('https://realm.test', 'another', '1');
  store.getState().invalidate('https://realm.test', 'movies', '2');
  expect(store.getState().preview).not.toBeNull();
  store.getState().invalidate('https://realm.test', 'movies', '1');
  expect(store.getState().preview).toBeNull();
});
