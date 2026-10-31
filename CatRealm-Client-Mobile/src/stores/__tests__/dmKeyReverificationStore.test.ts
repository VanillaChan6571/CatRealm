import { useDMKeyReverificationStore } from '../dmKeyReverificationStore';

beforeEach(() => useDMKeyReverificationStore.getState().setAccountId(null));

test('shows a prompt only after the older account session is denied key sharing for a recent passkey approval', () => {
  const store = useDMKeyReverificationStore.getState();
  store.setAccountId('account-a');
  store.notePasskeyApprovedDevice('account-a', 'new-device');
  store.markProofRequired('account-a', ['other-device']);
  expect(useDMKeyReverificationStore.getState().waitingDeviceId).toBeNull();

  store.markProofRequired('account-a', ['new-device']);
  expect(useDMKeyReverificationStore.getState().waitingDeviceId).toBe('new-device');

  store.clearForTargets('account-a', ['new-device']);
  expect(useDMKeyReverificationStore.getState().waitingDeviceId).toBeNull();
});

test('a switched account cannot inherit or clear another account’s prompt', () => {
  const store = useDMKeyReverificationStore.getState();
  store.setAccountId('account-a');
  store.notePasskeyApprovedDevice('account-a', 'new-device');
  store.markProofRequired('account-a', ['new-device']);
  store.setAccountId('account-b');
  expect(useDMKeyReverificationStore.getState().waitingDeviceId).toBeNull();

  store.markProofRequired('account-a', ['new-device']);
  store.clearForTargets('account-a', ['new-device']);
  expect(useDMKeyReverificationStore.getState().accountId).toBe('account-b');
  expect(useDMKeyReverificationStore.getState().waitingDeviceId).toBeNull();
});
