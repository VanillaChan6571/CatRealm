import { useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import { AlertCircle, CheckCircle, Loader2, Users } from 'lucide-react';
import { AUTH_BASE } from '../../lib/authApi';
import { useAuthStore } from '../../stores/authStore';
import { useServerStore } from '../../stores/serverStore';
import { useUIStore } from '../../stores/uiStore';

type InviteEmbedModalData = {
  code: string;
  url?: string;
};

type InviteData = {
  code: string;
  serverUrl: string;
  serverName: string;
  serverDescription?: string;
  serverIcon?: string | null;
  serverBanner?: string | null;
  memberCount?: number;
  channelId?: string | null;
  usesRemaining?: number | null;
};

function isValidInviteCode(code: string): boolean {
  return /^[A-Za-z0-9_-]{4,128}$/.test(code);
}

export function InviteEmbedModal() {
  const activeModal = useUIStore((s) => s.activeModal);
  const closeModal = useUIStore((s) => s.closeModal);
  const modalData = useUIStore((s) => s.modalData) as InviteEmbedModalData | null;
  const user = useAuthStore((s) => s.user);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const isCentral = user?.accountType === 'central';

  const inviteCode = useMemo(() => {
    const value = String(modalData?.code || '').trim();
    return isValidInviteCode(value) ? value : null;
  }, [modalData?.code]);

  const [inviteData, setInviteData] = useState<InviteData | null>(null);
  const [loading, setLoading] = useState(false);
  const [accepting, setAccepting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    if (activeModal !== 'inviteEmbed') return;
    if (!inviteCode) {
      setError('Invalid invite code');
      setInviteData(null);
      setLoading(false);
      return;
    }

    let cancelled = false;
    const fetchInvite = async () => {
      try {
        setLoading(true);
        setError(null);
        setSuccess(false);

        const response = await axios.get(`${AUTH_BASE}/api/invites/${encodeURIComponent(inviteCode)}`);
        if (cancelled) return;
        setInviteData(response.data as InviteData);
      } catch (err: any) {
        if (cancelled) return;
        if (err.response?.status === 404) {
          setError('Invalid invite code');
        } else if (err.response?.status === 410) {
          setError(err.response.data?.error || 'Invite expired or used up');
        } else {
          setError('Failed to load invite');
        }
        setInviteData(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void fetchInvite();
    return () => {
      cancelled = true;
    };
  }, [activeModal, inviteCode]);

  useEffect(() => {
    if (activeModal !== 'inviteEmbed') return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeModal();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [activeModal, closeModal]);

  const handleAcceptInvite = async () => {
    if (!inviteCode || !inviteData) return;

    if (!isAuthenticated) {
      closeModal();
      window.location.assign(`/invite/${encodeURIComponent(inviteCode)}`);
      return;
    }

    try {
      setAccepting(true);
      setError(null);
      const response = await axios.post(`${AUTH_BASE}/api/invites/${encodeURIComponent(inviteCode)}/accept`);
      const resolvedServerUrl = String(response.data?.serverUrl || inviteData.serverUrl || '').trim();
      if (!resolvedServerUrl) {
        throw new Error('Invite accepted, but no server URL was returned.');
      }

      if (isCentral) {
        await useServerStore.getState().addServer(resolvedServerUrl, { inviteCode });
        setSuccess(true);
        window.setTimeout(() => {
          closeModal();
        }, 900);
      } else {
        setSuccess(true);
        window.setTimeout(() => {
          window.location.href = resolvedServerUrl;
        }, 900);
      }
    } catch (err: any) {
      if (err.response?.status === 410) {
        setError(err.response.data?.error || 'Invite expired or used up');
      } else if (err instanceof Error && err.message) {
        setError(err.message);
      } else {
        setError('Failed to accept invite');
      }
    } finally {
      setAccepting(false);
    }
  };

  if (activeModal !== 'inviteEmbed') return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      onClick={(event) => {
        if (event.target === event.currentTarget) closeModal();
      }}
    >
      <div className="invite-backdrop absolute inset-0 pointer-events-none">
        <div aria-hidden="true" className="invite-orb-a fixed left-[-160px] bottom-[-190px] h-[460px] w-[460px] rounded-full opacity-80 blur-[8px]" />
        <div aria-hidden="true" className="invite-orb-b fixed right-[-130px] top-[88px] h-[390px] w-[390px] rounded-full opacity-70 blur-[7px]" />
        <div aria-hidden="true" className="invite-stars fixed inset-0" />
      </div>

      <div className="relative z-10 invite-card-breathe max-w-lg w-full bg-bg-elevated border border-border rounded-xl shadow-2xl overflow-hidden">
        {inviteData?.serverBanner && (
          <div className="w-full h-32 bg-cover bg-center" style={{ backgroundImage: `url(${inviteData.serverBanner})` }} />
        )}

        <div className="p-6">
          {loading ? (
            <div className="py-8 text-center">
              <Loader2 className="w-10 h-10 text-accent animate-spin mx-auto mb-3" />
              <p className="text-sm text-text-secondary">Loading invite...</p>
            </div>
          ) : error ? (
            <div className="space-y-4">
              <div className="flex items-start gap-3">
                <AlertCircle className="w-7 h-7 text-danger flex-shrink-0 mt-0.5" />
                <div>
                  <h2 className="text-lg font-semibold text-text-primary">Invite unavailable</h2>
                  <p className="text-sm text-text-secondary mt-1">{error}</p>
                </div>
              </div>
              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={closeModal}
                  className="px-4 py-2 bg-accent hover:bg-accent-hover text-white rounded-md text-sm"
                >
                  Close
                </button>
              </div>
            </div>
          ) : success ? (
            <div className="py-8 text-center">
              <CheckCircle className="w-10 h-10 text-green-400 mx-auto mb-3" />
              <h2 className="text-lg font-semibold text-text-primary">Invite accepted</h2>
              <p className="text-sm text-text-secondary mt-1">Opening {inviteData?.serverName}...</p>
            </div>
          ) : inviteData ? (
            <>
              <div className={`flex justify-center mb-5 ${inviteData.serverBanner ? '-mt-14' : 'mt-1'}`}>
                {inviteData.serverIcon ? (
                  <img
                    src={inviteData.serverIcon}
                    alt={inviteData.serverName}
                    className="w-20 h-20 rounded-full border-4 border-bg-elevated bg-bg-elevated shadow-lg"
                  />
                ) : (
                  <div className="w-20 h-20 rounded-full border-4 border-bg-elevated bg-accent flex items-center justify-center text-3xl shadow-lg">
                    🐱
                  </div>
                )}
              </div>

              <div className="text-center mb-5">
                <h2 className="text-xl font-bold text-text-primary">{inviteData.serverName}</h2>
                {inviteData.serverDescription && (
                  <p className="text-sm text-text-secondary mt-1">{inviteData.serverDescription}</p>
                )}
                <p className="text-xs text-text-muted mt-2">Invite code: {inviteCode}</p>
              </div>

              <div className="bg-bg-primary rounded-lg p-3 mb-5">
                <div className="flex items-center justify-between text-sm">
                  <div className="flex items-center gap-2 text-text-secondary">
                    <Users className="w-4 h-4" />
                    <span>{inviteData.memberCount || 0} members</span>
                  </div>
                  {inviteData.usesRemaining !== null && inviteData.usesRemaining !== undefined && inviteData.usesRemaining > 0 && (
                    <span className="text-xs text-text-muted">{inviteData.usesRemaining} uses left</span>
                  )}
                </div>
              </div>

              {!isAuthenticated && (
                <div className="bg-yellow-900/20 border border-yellow-600/30 rounded-lg p-3 mb-4">
                  <p className="text-sm text-yellow-300">You need to log in before joining this server.</p>
                </div>
              )}

              <div className="flex flex-col gap-2">
                <button
                  type="button"
                  onClick={handleAcceptInvite}
                  disabled={accepting}
                  className="w-full px-4 py-2.5 bg-accent hover:bg-accent-hover disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-md font-medium transition-colors flex items-center justify-center gap-2"
                >
                  {accepting ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Accepting...
                    </>
                  ) : isAuthenticated ? (
                    'Accept Invite'
                  ) : (
                    'Login to Join'
                  )}
                </button>
                <button
                  type="button"
                  onClick={closeModal}
                  className="w-full px-4 py-2 text-text-secondary hover:text-text-primary transition-colors"
                >
                  No, thanks
                </button>
              </div>
            </>
          ) : (
            <div className="py-8 text-center text-sm text-text-secondary">Invite unavailable.</div>
          )}
        </div>
      </div>
    </div>
  );
}
