import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Loader2, AlertCircle, Users, CheckCircle } from 'lucide-react';
import { useAuthStore } from '../stores/authStore';
import { useServerStore } from '../stores/serverStore';
import { AUTH_BASE } from '../lib/authApi';
import axios from 'axios';
import type { ReactNode } from 'react';

interface InviteData {
  code: string;
  serverUrl: string;
  serverName: string;
  serverDescription?: string;
  serverIcon?: string | null;
  serverBanner?: string | null;
  memberCount?: number;
  channelId?: string | null;
  usesRemaining?: number | null;
}

const APP_HOME = '/app';

function InviteBackdrop({ children }: { children: ReactNode }) {
  return (
    <div className="invite-backdrop min-h-screen relative flex items-center justify-center p-4 overflow-hidden">
      <div
        aria-hidden="true"
        className="invite-orb-a pointer-events-none fixed left-[-160px] bottom-[-190px] h-[460px] w-[460px] rounded-full opacity-80 blur-[8px]"
      />
      <div
        aria-hidden="true"
        className="invite-orb-b pointer-events-none fixed right-[-130px] top-[88px] h-[390px] w-[390px] rounded-full opacity-70 blur-[7px]"
      />
      <div
        aria-hidden="true"
        className="invite-stars pointer-events-none fixed inset-0"
      />
      <div className="relative z-10 w-full flex items-center justify-center">
        {children}
      </div>
    </div>
  );
}

export function InvitePage() {
  const { code } = useParams<{ code: string }>();
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const isCentral = user?.accountType === 'central';

  const [inviteData, setInviteData] = useState<InviteData | null>(null);
  const [loading, setLoading] = useState(true);
  const [accepting, setAccepting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  // Fetch invite details
  useEffect(() => {
    if (!code) return;

    const fetchInvite = async () => {
      try {
        setLoading(true);
        setError(null);

        const response = await axios.get(`${AUTH_BASE}/api/invites/${code}`);

        setInviteData(response.data);
      } catch (err: any) {
        if (err.response?.status === 404) {
          setError('Invalid invite code');
        } else if (err.response?.status === 410) {
          setError(err.response.data.error || 'Invite expired or used up');
        } else {
          setError('Failed to load invite');
        }
        console.error('Error fetching invite:', err);
      } finally {
        setLoading(false);
      }
    };

    fetchInvite();
  }, [code]);

  const handleAcceptInvite = async () => {
    if (!inviteData) return;

    try {
      setAccepting(true);
      setError(null);

      const response = await axios.post(`${AUTH_BASE}/api/invites/${code}/accept`);

      const { serverUrl } = response.data;

      // For central accounts: add server to list
      if (isCentral) {
        // addServer will add it and switch to it automatically
        await useServerStore.getState().addServer(serverUrl, { inviteCode: code });

        setSuccess(true);
        setTimeout(() => {
          navigate(APP_HOME);
        }, 1500);
      } else {
        // For non-central accounts: redirect to server URL
        setSuccess(true);
        setTimeout(() => {
          window.location.href = serverUrl;
        }, 1500);
      }
    } catch (err: any) {
      if (err.response?.status === 410) {
        setError(err.response.data.error || 'Invite expired or used up');
      } else if (err instanceof Error && err.message) {
        setError(err.message);
      } else {
        setError('Failed to accept invite');
      }
      console.error('Error accepting invite:', err);
    } finally {
      setAccepting(false);
    }
  };

  if (loading) {
    return (
      <InviteBackdrop>
        <div className="text-center">
          <Loader2 className="w-12 h-12 text-accent animate-spin mx-auto mb-4" />
          <p className="text-text-secondary">Loading invite...</p>
        </div>
      </InviteBackdrop>
    );
  }

  if (error) {
    return (
      <InviteBackdrop>
        <div className="invite-card-breathe max-w-md w-full p-8 bg-bg-elevated border border-border rounded-xl">
          <div className="flex items-center gap-3 mb-4">
            <AlertCircle className="w-8 h-8 text-red-400 flex-shrink-0" />
            <div>
              <h2 className="text-xl font-bold text-text-primary">Invite unavailable</h2>
              <p className="text-sm text-text-secondary mt-1">{error}</p>
            </div>
          </div>
          <button
            onClick={() => navigate(APP_HOME)}
            className="w-full mt-4 px-4 py-2 bg-accent hover:bg-accent-hover text-white rounded-md transition-colors"
          >
            Go Home
          </button>
        </div>
      </InviteBackdrop>
    );
  }

  if (success) {
    return (
      <InviteBackdrop>
        <div className="invite-card-breathe max-w-md w-full p-8 bg-bg-elevated border border-border rounded-xl">
          <div className="flex items-center gap-3 mb-4">
            <CheckCircle className="w-8 h-8 text-green-400 flex-shrink-0" />
            <div>
              <h2 className="text-xl font-bold text-text-primary">Invite Accepted!</h2>
              <p className="text-sm text-text-secondary mt-1">
                Redirecting to {inviteData?.serverName}...
              </p>
            </div>
          </div>
        </div>
      </InviteBackdrop>
    );
  }

  if (!inviteData) {
    return null;
  }

  return (
    <InviteBackdrop>
      <div className="invite-card-breathe max-w-lg w-full bg-bg-elevated border border-border rounded-xl shadow-2xl overflow-hidden">
        {/* Server Banner */}
        {inviteData.serverBanner && (
          <div className="w-full h-32 bg-cover bg-center" style={{ backgroundImage: `url(${inviteData.serverBanner})` }} />
        )}

        <div className="p-8">
          {/* Server Icon */}
          <div className="flex justify-center mb-6 -mt-16">
            {inviteData.serverIcon ? (
              <img
                src={inviteData.serverIcon}
                alt={inviteData.serverName}
                className="w-24 h-24 rounded-full border-4 border-bg-elevated bg-bg-elevated shadow-lg"
              />
            ) : (
              <div className="w-24 h-24 rounded-full border-4 border-bg-elevated bg-accent flex items-center justify-center text-4xl shadow-lg">
                🐱
              </div>
            )}
          </div>

          {/* Server Name */}
          <div className="text-center mb-6">
            <h1 className="text-2xl font-bold text-text-primary mb-2">
              {inviteData.serverName}
            </h1>
            {inviteData.serverDescription && (
              <p className="text-sm text-text-secondary mb-2">
                {inviteData.serverDescription}
              </p>
            )}
            <p className="text-text-secondary text-sm">
              🐱 You've been invited to join this CatRealm server
            </p>
          </div>

          {/* Invite Details */}
          <div className="bg-bg-primary rounded-lg p-4 mb-6 space-y-2">
            <div className="flex items-center justify-between text-sm">
              <div className="flex items-center gap-2 text-text-secondary">
                <Users className="w-4 h-4" />
                <span>{inviteData.memberCount || 0} members</span>
              </div>
              {inviteData.usesRemaining !== null && inviteData.usesRemaining !== undefined && inviteData.usesRemaining > 0 && (
                <span className="text-xs text-text-muted">
                  {inviteData.usesRemaining} uses left
                </span>
              )}
            </div>
          </div>

          {/* Login Notice */}
          {!isAuthenticated && (
            <div className="bg-yellow-900/20 border border-yellow-600/30 rounded-lg p-4 mb-4">
              <p className="text-sm text-yellow-300">
                You need to log in before joining this server.
              </p>
            </div>
          )}

          {/* Accept Button */}
          <button
            onClick={isAuthenticated ? handleAcceptInvite : () => navigate(`${APP_HOME}?invite=${code}`)}
            disabled={accepting}
            className="w-full px-6 py-3 bg-accent hover:bg-accent-hover disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-lg font-medium transition-colors flex items-center justify-center gap-2"
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

          {/* Cancel */}
          <button
            onClick={() => navigate(APP_HOME)}
            className="w-full mt-3 px-4 py-2 text-text-secondary hover:text-text-primary transition-colors"
          >
            No, thanks
          </button>
        </div>
      </div>
    </InviteBackdrop>
  );
}
