import { useState, useEffect } from 'react';
import { Link as LinkIcon, Copy, Trash2, CheckCircle, Plus } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { api } from '../../../lib/api';
import { writeClipboardText } from '../../../lib/clipboard';
import { useUIStore } from '../../../stores/uiStore';

interface Invite {
  code: string;
  channel_id: string | null;
  channel_name: string | null;
  creator_username: string;
  max_uses: number;
  current_uses: number;
  expires_at: number | null;
  created_at: number;
}

export function InvitesSection() {
  const { t } = useTranslation();
  const setCreateInviteModalOpen = useUIStore((s) => s.setCreateInviteModalOpen);
  const [invites, setInvites] = useState<Invite[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copiedCode, setCopiedCode] = useState<string | null>(null);

  const fetchInvites = async () => {
    try {
      setLoading(true);
      setError(null);
      const response = await api.get('/api/invites');
      setInvites(response || []);
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to load invites');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchInvites();
  }, []);

  const handleCopy = async (code: string) => {
    const clientUrl = import.meta.env.VITE_CLIENT_URL || window.location.origin;
    const inviteUrl = `${clientUrl}/invite/${code}`;
    const copied = await writeClipboardText(inviteUrl);
    if (!copied) return;
    setCopiedCode(code);
    setTimeout(() => setCopiedCode(null), 2000);
  };

  const handleRevoke = async (code: string) => {
    if (!confirm(t('admin.revokeConfirm'))) return;

    try {
      await api.delete(`/api/invites/${code}`);
      setInvites((prev) => prev.filter((inv) => inv.code !== code));
    } catch (err: any) {
      alert(err.response?.data?.error || 'Failed to revoke invite');
    }
  };

  const formatExpiry = (expiresAt: number | null) => {
    if (!expiresAt) return t('admin.neverExpires');
    const now = Math.floor(Date.now() / 1000);
    if (expiresAt < now) return t('admin.expiredLabel');

    const diff = expiresAt - now;
    const hours = Math.floor(diff / 3600);
    const days = Math.floor(hours / 24);

    if (days > 0) return `${days}d`;
    if (hours > 0) return `${hours}h`;
    return '<1h';
  };

  return (
    <div className="max-w-5xl">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-2xl font-bold text-gray-100 mb-2">{t('admin.serverInvites')}</h2>
          <p className="text-gray-400">{t('admin.serverInvitesDesc')}</p>
        </div>
        <button
          onClick={() => setCreateInviteModalOpen(true)}
          className="flex items-center gap-2 px-4 py-2 bg-accent hover:bg-accent-hover text-white rounded-lg font-medium transition-colors"
        >
          <Plus className="w-4 h-4" />
          {t('admin.createInvite')}
        </button>
      </div>

      {loading ? (
        <div className="text-center py-12 text-gray-400">{t('admin.loadingInvites')}</div>
      ) : error ? (
        <div className="p-4 rounded-lg bg-red-900/20 border border-red-600/30 text-red-400">
          {error}
        </div>
      ) : invites.length === 0 ? (
        <div className="text-center py-12">
          <LinkIcon className="w-12 h-12 text-gray-600 mx-auto mb-3" />
          <p className="text-gray-400 mb-4">{t('admin.noInvites')}</p>
          <button
            onClick={() => setCreateInviteModalOpen(true)}
            className="px-4 py-2 bg-accent hover:bg-accent-hover text-white rounded-lg font-medium transition-colors"
          >
            {t('admin.createFirstInvite')}
          </button>
        </div>
      ) : (
        <div className="bg-gray-800/50 border border-gray-700 rounded-lg overflow-hidden">
          <table className="w-full">
            <thead className="bg-gray-900/50 border-b border-gray-700">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase">{t('admin.codeHeader')}</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase">{t('admin.channelHeader')}</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase">{t('admin.creatorHeader')}</th>
                <th className="px-4 py-3 text-center text-xs font-medium text-gray-400 uppercase">{t('admin.usesHeader')}</th>
                <th className="px-4 py-3 text-center text-xs font-medium text-gray-400 uppercase">{t('admin.expiresHeader')}</th>
                <th className="px-4 py-3 text-right text-xs font-medium text-gray-400 uppercase">{t('admin.actionsLabel')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-700">
              {invites.map((invite) => (
                <tr key={invite.code} className="hover:bg-gray-800/30 transition-colors">
                  <td className="px-4 py-3">
                    <code className="text-sm text-accent font-mono">{invite.code}</code>
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-300">
                    {invite.channel_name ? `# ${invite.channel_name}` : <span className="text-gray-500">{t('admin.anyChannel')}</span>}
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-300">
                    {invite.creator_username}
                  </td>
                  <td className="px-4 py-3 text-center text-sm text-gray-300">
                    {invite.current_uses}
                    {invite.max_uses > 0 && ` / ${invite.max_uses}`}
                    {invite.max_uses === 0 && <span className="text-gray-500"> / ∞</span>}
                  </td>
                  <td className="px-4 py-3 text-center text-sm text-gray-300">
                    {formatExpiry(invite.expires_at)}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex items-center justify-end gap-2">
                      <button
                        onClick={() => handleCopy(invite.code)}
                        className="p-1.5 hover:bg-gray-700 rounded transition-colors"
                        title={t('admin.copyInviteLink')}
                      >
                        {copiedCode === invite.code ? (
                          <CheckCircle className="w-4 h-4 text-green-400" />
                        ) : (
                          <Copy className="w-4 h-4 text-gray-400 hover:text-gray-200" />
                        )}
                      </button>
                      <button
                        onClick={() => handleRevoke(invite.code)}
                        className="p-1.5 hover:bg-red-900/30 rounded transition-colors"
                        title={t('admin.revokeInvite')}
                      >
                        <Trash2 className="w-4 h-4 text-red-400 hover:text-red-300" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
