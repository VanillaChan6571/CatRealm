import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const actions = vi.hoisted(() => ({ respond: vi.fn(), open: vi.fn() }));
vi.mock('../../../stores/dmStore', async () => {
  const { create } = await import('zustand');
  return { useDMStore: create(() => ({ conversations: [], respondToRequest: actions.respond, openConversation: actions.open })) };
});
import { useDMStore } from '../../../stores/dmStore';
import { MessageRequests } from '../MessageRequests';
beforeEach(() => {
  vi.resetAllMocks(); actions.respond.mockResolvedValue(undefined); actions.open.mockResolvedValue(undefined);
  useDMStore.setState({ conversations: [
    { id: '1', otherUserId: 'alice', otherUsername: 'Alice', requestState: 'pending' },
    { id: '2', otherUserId: 'bob', otherUsername: 'Bob', requestState: 'accepted' },
  ] as any });
});
afterEach(cleanup);
it('shows only requests; preview does not accept; accepting invokes the recipient decision', async () => {
  const onOpen = vi.fn();
  render(<MessageRequests onOpen={onOpen} />);
  expect(screen.queryByText('Bob — Preview')).toBeNull();
  fireEvent.click(screen.getByText('Alice — Preview'));
  await waitFor(() => expect(onOpen).toHaveBeenCalledOnce());
  expect(actions.respond).not.toHaveBeenCalled();
  fireEvent.click(screen.getByText('Accept'));
  await waitFor(() => expect(actions.respond).toHaveBeenCalledWith('alice', 'accept'));
});
it('displays decline failures and supports accepting a previously declined request', async () => {
  actions.respond.mockRejectedValueOnce(new Error('offline'));
  render(<MessageRequests onOpen={vi.fn()} />);
  fireEvent.click(screen.getByText('Decline'));
  expect((await screen.findByRole('alert')).textContent).toContain('Could not update');
  act(() => useDMStore.setState({ conversations: [{ id: '1', otherUserId: 'alice', otherUsername: 'Alice', requestState: 'declined' }] as any }));
  expect(screen.queryByText('Decline')).toBeNull();
  fireEvent.click(screen.getByText('Accept'));
  await waitFor(() => expect(actions.respond).toHaveBeenLastCalledWith('alice', 'accept'));
});
