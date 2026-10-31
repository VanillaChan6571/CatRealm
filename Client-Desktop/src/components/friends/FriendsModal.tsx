import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useUIStore } from '../../stores/uiStore';
import { useFriendStore } from '../../stores/friendStore';
import { useAuthStore } from '../../stores/authStore';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { AvatarImage } from '../ui/AvatarImage';
import { AUTH_BASE } from '../../lib/authApi';
import { resolveAvatarUrl } from '../../utils/avatar';

type Tab = 'friends' | 'pending' | 'add';

export function FriendsModal() {
  const { t } = useTranslation();
  const activeModal = useUIStore((s) => s.activeModal);
  const closeModal = useUIStore((s) => s.closeModal);
  const openModal = useUIStore((s) => s.openModal);
  const open = activeModal === 'friends';

  const user = useAuthStore((s) => s.user);
  const isCentral = user?.accountType === 'central';

  const friends = useFriendStore((s) => s.friends);
  const incoming = useFriendStore((s) => s.incoming);
  const outgoing = useFriendStore((s) => s.outgoing);
  const loading = useFriendStore((s) => s.loading);
  const error = useFriendStore((s) => s.error);
  const fetchFriends = useFriendStore((s) => s.fetchFriends);
  const fetchRequests = useFriendStore((s) => s.fetchRequests);
  const sendRequest = useFriendStore((s) => s.sendRequest);
  const acceptRequest = useFriendStore((s) => s.acceptRequest);
  const rejectRequest = useFriendStore((s) => s.rejectRequest);
  const removeFriend = useFriendStore((s) => s.removeFriend);
  const clearError = useFriendStore((s) => s.clearError);

  const [tab, setTab] = useState<Tab>('friends');
  const [addUsername, setAddUsername] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  useEffect(() => {
    if (open && isCentral) {
      fetchFriends();
      fetchRequests();
    }
  }, [open, isCentral, fetchFriends, fetchRequests]);

  useEffect(() => {
    if (!open) {
      setTab('friends');
      setAddUsername('');
      setSuccessMsg('');
      clearError();
    }
  }, [open, clearError]);

  if (!isCentral) {
    return (
      <Modal open={open} onClose={closeModal} title={t('friends.title')}>
        <p className="text-text-muted text-sm">
          {t('friends.requiresCentral')}
        </p>
      </Modal>
    );
  }

  const handleSendRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!addUsername.trim()) return;
    setSuccessMsg('');
    await sendRequest(addUsername.trim());
    if (!useFriendStore.getState().error) {
      setSuccessMsg(t('friends.requestSent', { username: addUsername.trim() }));
      setAddUsername('');
    }
  };

  return (
    <Modal open={open} onClose={closeModal} title={t('friends.title')}>
      {/* Tabs */}
      <div className="flex gap-1 mb-4 border-b border-border">
        {(['friends', 'pending', 'add'] as Tab[]).map((tabId) => (
          <button
            key={tabId}
            onClick={() => { setTab(tabId); clearError(); setSuccessMsg(''); }}
            className={`px-3 py-2 text-sm font-medium transition-colors border-b-2 -mb-px ${
              tab === tabId
                ? 'border-accent text-text-primary'
                : 'border-transparent text-text-muted hover:text-text-secondary'
            }`}
          >
            {tabId === 'friends' && t('friends.tabFriends', { count: friends.length })}
            {tabId === 'pending' && (incoming.length > 0 ? t('friends.tabPendingWithCount', { count: incoming.length }) : t('friends.tabPending'))}
            {tabId === 'add' && t('friends.tabAdd')}
          </button>
        ))}
      </div>

      {/* Friends List */}
      {tab === 'friends' && (
        <div className="max-h-64 overflow-y-auto space-y-1">
          {friends.length === 0 ? (
            <p className="text-text-muted text-sm text-center py-4">
              {t('friends.noFriends')}
            </p>
          ) : (
            friends.map((friend) => (
              <div
                key={friend.id}
                className="rounded-lg overflow-hidden border border-border/50 bg-bg-elevated hover:bg-bg-hover/40 transition-colors"
              >
                <div className="h-16 bg-bg-input">
                  {friend.banner ? (
                    <img
                      src={resolveAvatarUrl(friend.banner, AUTH_BASE, 'central') ?? undefined}
                      alt={`${friend.username} banner`}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <div className="w-full h-full bg-gradient-to-r from-zinc-700 to-zinc-600" />
                  )}
                </div>
                <div className="px-4 py-3 flex items-center justify-between gap-3">
                  <div className="flex items-center gap-3 min-w-0 flex-1">
                    <div className="w-12 h-12 rounded-full avatar-bg overflow-hidden flex items-center justify-center text-white text-base font-semibold shrink-0 border-2 border-bg-elevated -mt-6">
                      <AvatarImage
                        src={resolveAvatarUrl(friend.avatar, AUTH_BASE, 'central')}
                        alt={friend.username}
                        size={48}
                        className="w-12 h-12 object-cover"
                        fallback={<span>{friend.username.charAt(0).toUpperCase()}</span>}
                      />
                    </div>
                    <div className="flex flex-col min-w-0">
                      <button
                        type="button"
                        className="text-left text-base font-semibold text-text-primary truncate hover:underline"
                        onClick={() => openModal('profileView', { userId: friend.id })}
                      >
                        {friend.username}
                      </button>
                      <span className="text-xs text-text-muted">{t('friends.friend')}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => {
                        closeModal();
                        // TODO: Open DM with this friend
                      }}
                    >
                      {t('friends.message')}
                    </Button>
                    <Button
                      variant="danger"
                      size="sm"
                      onClick={() => {
                        if (confirm(t('friends.removeConfirm', { username: friend.username }))) {
                          removeFriend(friend.id);
                        }
                      }}
                      disabled={loading}
                    >
                      {t('friends.removeFriend')}
                    </Button>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {/* Pending Requests */}
      {tab === 'pending' && (
        <div className="max-h-64 overflow-y-auto space-y-3">
          {incoming.length > 0 && (
            <div>
              <h4 className="text-xs font-semibold uppercase text-text-muted mb-2">{t('friends.incoming')}</h4>
              <div className="space-y-1">
                {incoming.map((req) => (
                  <div
                    key={req.id}
                    className="flex items-center justify-between px-3 py-2 rounded hover:bg-bg-hover/50"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <div className="w-8 h-8 rounded-full avatar-bg overflow-hidden flex items-center justify-center text-white text-sm font-semibold shrink-0">
                        <AvatarImage
                          src={resolveAvatarUrl(req.from_avatar, AUTH_BASE, 'central')}
                          alt={req.from_username}
                          size={32}
                          className="w-8 h-8 object-cover"
                          fallback={<span>{req.from_username.charAt(0).toUpperCase()}</span>}
                        />
                      </div>
                      <span className="text-sm text-text-primary truncate">{req.from_username}</span>
                    </div>
                    <div className="flex gap-1 shrink-0">
                      <Button
                        variant="primary"
                        size="sm"
                        onClick={() => acceptRequest(req.id)}
                        disabled={loading}
                      >
                        {t('friends.accept')}
                      </Button>
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => rejectRequest(req.id)}
                        disabled={loading}
                      >
                        {t('friends.reject')}
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {outgoing.length > 0 && (
            <div>
              <h4 className="text-xs font-semibold uppercase text-text-muted mb-2">{t('friends.outgoing')}</h4>
              <div className="space-y-1">
                {outgoing.map((req) => (
                  <div
                    key={req.id}
                    className="flex items-center justify-between px-3 py-2 rounded hover:bg-bg-hover/50"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <div className="w-8 h-8 rounded-full avatar-bg overflow-hidden flex items-center justify-center text-white text-sm font-semibold shrink-0">
                        <AvatarImage
                          src={resolveAvatarUrl(req.to_avatar, AUTH_BASE, 'central')}
                          alt={req.to_username}
                          size={32}
                          className="w-8 h-8 object-cover"
                          fallback={<span>{req.to_username.charAt(0).toUpperCase()}</span>}
                        />
                      </div>
                      <span className="text-sm text-text-primary truncate">{req.to_username}</span>
                    </div>
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => rejectRequest(req.id)}
                      disabled={loading}
                    >
                      {t('friends.cancel')}
                    </Button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {incoming.length === 0 && outgoing.length === 0 && (
            <p className="text-text-muted text-sm text-center py-4">
              {t('friends.noPending')}
            </p>
          )}
        </div>
      )}

      {/* Add Friend */}
      {tab === 'add' && (
        <form onSubmit={handleSendRequest} className="space-y-3">
          <p className="text-text-muted text-sm">
            {t('friends.addExact')}
          </p>
          <Input
            label={t('friends.username')}
            value={addUsername}
            onChange={(e) => setAddUsername(e.target.value)}
            placeholder={t('friends.usernamePlaceholder')}
            autoFocus
          />
          {error && <p className="text-danger text-sm">{error}</p>}
          {successMsg && <p className="text-success text-sm">{successMsg}</p>}
          <Button type="submit" disabled={loading || !addUsername.trim()}>
            {loading ? t('friends.sending') : t('friends.sendRequest')}
          </Button>
        </form>
      )}
    </Modal>
  );
}
