import { useEffect, useMemo, useState } from 'react';
import { Eye, Shield, Sparkles } from 'lucide-react';
import { Modal } from '../ui/Modal';
import { useUIStore } from '../../stores/uiStore';
import { useChannelStore } from '../../stores/channelStore';
import { createApi } from '../../lib/api';
import type { Role } from '../../types';
import { useAuthStore } from '../../stores/authStore';
import { useViewAsRoleStore } from '../../stores/viewAsRoleStore';
import { getViewAsRoleChannels } from '../../lib/viewAsRolePermissions';
import { logViewAsRoleDebug } from '../../lib/viewAsRoleDebug';

type ModalData = {
  role: Role;
  roles: Role[];
};

export function ViewAsRoleModal() {
  const activeModal = useUIStore((s) => s.activeModal);
  const modalData = useUIStore((s) => s.modalData) as ModalData | null;
  const closeModal = useUIStore((s) => s.closeModal);
  const channels = useChannelStore((s) => s.channels);
  const categories = useChannelStore((s) => s.categories);
  const activeChannelId = useChannelStore((s) => s.activeChannelId);
  const setActiveChannel = useChannelStore((s) => s.setActiveChannel);
  const fetchChannels = useChannelStore((s) => s.fetchChannels);
  const beginSession = useViewAsRoleStore((s) => s.beginSession);
  const applyServerAuthRefresh = useAuthStore((s) => s.applyServerAuthRefresh);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedRoleId, setSelectedRoleId] = useState('');

  const open = activeModal === 'viewRoleAs' && (!!modalData?.role || !!modalData?.roles?.length);
  const allRoles = modalData?.roles ?? [];
  const selectedRole = allRoles.find((role) => role.id === selectedRoleId) ?? modalData?.role ?? null;
  const previewChannels = useMemo(() => {
    if (!selectedRole) return [];
    return getViewAsRoleChannels(channels, selectedRole, allRoles, {}, {});
  }, [allRoles, channels, selectedRole]);

  useEffect(() => {
    if (!open) {
      setSelectedRoleId('');
      return;
    }
    setSelectedRoleId((current) => {
      if (current && allRoles.some((role) => role.id === current)) return current;
      return modalData?.role?.id ?? allRoles[0]?.id ?? '';
    });
  }, [open, allRoles, modalData]);

  if (!open || !selectedRole) return null;

  const startSession = async () => {
    setStarting(true);
    setError(null);
    try {
      logViewAsRoleDebug('start:requested', {
        roleId: selectedRole.id,
        roleName: selectedRole.name,
        activeChannelId,
      });
      const api = createApi();
      await api.post('/api/roles/view-as', { roleId: selectedRole.id });
      logViewAsRoleDebug('start:posted', { roleId: selectedRole.id });
      const identity = await api.get('/api/auth/me');
      logViewAsRoleDebug('start:auth-me', {
        role: identity.data?.user?.role,
        permissions: identity.data?.user?.permissions,
        viewAsRole: identity.data?.user?.viewAsRole ?? null,
      });
      applyServerAuthRefresh({
        token: typeof identity.data?.token === 'string' ? identity.data.token : null,
        user: identity.data?.user && typeof identity.data.user === 'object' ? identity.data.user : null,
      });
      await fetchChannels();
      logViewAsRoleDebug('start:channels-refetched', {
        visibleChannelIds: useChannelStore.getState().channels.map((channel) => channel.id),
      });

      beginSession({
        serverUrl: null,
        role: selectedRole,
        roles: allRoles,
        categoryOverwritesByCategoryId: {},
        channelOverwritesByChannelId: {},
      });

      const viewedChannels = getViewAsRoleChannels(channels, selectedRole, allRoles, {}, {});
      if (!activeChannelId || !viewedChannels.some((channel) => channel.id === activeChannelId)) {
        if (viewedChannels[0]) setActiveChannel(viewedChannels[0].id);
        else useChannelStore.setState({ activeChannelId: null });
      }
      closeModal();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to start role view session.';
      setError(message);
    } finally {
      setStarting(false);
    }
  };

  return (
    <Modal open={open} onClose={closeModal} title="View Server As Role" className="max-w-2xl">
      <div className="space-y-4">
        <div className="rounded-xl border border-fuchsia-400/30 bg-fuchsia-500/10 p-4">
          <div className="flex items-start gap-3">
            <div className="mt-0.5 rounded-lg bg-fuchsia-500/20 p-2 text-fuchsia-200">
              <Sparkles className="w-5 h-5" />
            </div>
            <div>
              <div className="text-sm font-semibold text-text-primary">Preview the server as {selectedRole.name}</div>
              <div className="mt-1 text-xs text-text-muted">
                This starts an authoritative server-side session that applies the selected role to your own access checks until you end it.
              </div>
            </div>
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-lg border border-border bg-bg-input/40 p-3">
            <div className="text-[11px] uppercase tracking-[0.2em] text-text-muted">Role</div>
            <label className="mt-2 block">
              <span className="sr-only">Role</span>
              <select
                value={selectedRole.id}
                onChange={(event) => setSelectedRoleId(event.target.value)}
                className="w-full rounded-lg border border-border bg-bg-input px-3 py-2 text-sm font-medium text-text-primary outline-none transition-colors focus:border-fuchsia-400"
              >
                {allRoles.map((role) => (
                  <option key={role.id} value={role.id}>
                    {role.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="rounded-lg border border-border bg-bg-input/40 p-3">
            <div className="text-[11px] uppercase tracking-[0.2em] text-text-muted">Preview Channels</div>
            <div className="mt-2 text-sm font-medium text-text-primary">{previewChannels.length}</div>
          </div>
          <div className="rounded-lg border border-border bg-bg-input/40 p-3">
            <div className="text-[11px] uppercase tracking-[0.2em] text-text-muted">Categories</div>
            <div className="mt-2 text-sm font-medium text-text-primary">{categories.length}</div>
          </div>
        </div>

        <div className="rounded-lg border border-border bg-bg-input/30 p-4">
          <div className="flex items-center gap-2 text-sm font-medium text-text-primary">
            <Shield className="w-4 h-4" />
            Session behavior
          </div>
          <div className="mt-2 space-y-2 text-xs text-text-muted">
            <div>Channel visibility and permission checks are enforced by the server using the selected role plus the default role.</div>
            <div>Administrative routes and channel actions are limited until you end the session.</div>
            <div>A purple banner will appear at the top of chats until you end the session.</div>
          </div>
        </div>

        {error && (
          <div className="rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">
            {error}
          </div>
        )}

        <div className="flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={closeModal}
            className="px-4 py-2 rounded-lg bg-bg-hover text-text-primary hover:bg-bg-input transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void startSession()}
            disabled={starting}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-fuchsia-500 text-white hover:bg-fuchsia-400 disabled:opacity-60 transition-colors"
          >
            <Eye className="w-4 h-4" />
            {starting ? 'Starting...' : 'Start View As'}
          </button>
        </div>
      </div>
    </Modal>
  );
}

export default ViewAsRoleModal;
