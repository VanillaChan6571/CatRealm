import { useEffect, useMemo, useRef, useState } from 'react';
import { X, Link as LinkIcon, Copy, CheckCircle, ChevronDown, Check } from 'lucide-react';
import { useUIStore } from '../../stores/uiStore';
import { useChannelStore } from '../../stores/channelStore';
import { api } from '../../lib/api';
import { writeClipboardText } from '../../lib/clipboard';

type InviteOption = {
  value: number | string;
  label: string;
};

interface InviteSelectProps {
  label: string;
  value: number | string;
  options: InviteOption[];
  onChange: (next: number | string) => void;
}

function InviteSelect({ label, value, options, onChange }: InviteSelectProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (event: MouseEvent) => {
      if (!rootRef.current) return;
      if (!rootRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const handleEsc = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    window.addEventListener('mousedown', handlePointerDown);
    window.addEventListener('keydown', handleEsc);
    return () => {
      window.removeEventListener('mousedown', handlePointerDown);
      window.removeEventListener('keydown', handleEsc);
    };
  }, [open]);

  const selected = useMemo(
    () => options.find((option) => option.value === value) ?? options[0] ?? null,
    [options, value]
  );

  return (
    <div ref={rootRef}>
      <label className="block text-sm font-medium text-text-primary mb-2">
        {label}
      </label>
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        className="w-full px-3 py-2 bg-bg-primary border border-border rounded-lg text-text-primary focus:outline-none focus:ring-2 focus:ring-accent flex items-center justify-between gap-2"
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className="truncate text-left">{selected?.label ?? 'Select'}</span>
        <ChevronDown className={`w-4 h-4 text-text-secondary transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="mt-2 rounded-lg border border-border bg-bg-elevated shadow-xl max-h-56 overflow-y-auto">
          {options.map((option) => {
            const isSelected = option.value === value;
            return (
              <button
                key={String(option.value)}
                type="button"
                onClick={() => {
                  onChange(option.value);
                  setOpen(false);
                }}
                className={`w-full px-3 py-2 text-left text-sm flex items-center justify-between gap-2 transition-colors ${
                  isSelected
                    ? 'bg-accent/20 text-text-primary'
                    : 'text-text-secondary hover:bg-bg-hover hover:text-text-primary'
                }`}
              >
                <span className="truncate">{option.label}</span>
                {isSelected && <Check className="w-4 h-4 text-accent shrink-0" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function CreateInviteModal() {
  const open = useUIStore((s) => s.createInviteModalOpen);
  const setOpen = useUIStore((s) => s.setCreateInviteModalOpen);
  const channels = useChannelStore((s) => s.channels);

  const [channelId, setChannelId] = useState<string>('');
  const [maxUses, setMaxUses] = useState<number>(0);
  const [expiresIn, setExpiresIn] = useState<number>(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const channelOptions: InviteOption[] = useMemo(
    () => [
      { value: '', label: 'Any channel' },
      ...channels.map((channel) => ({
        value: channel.id,
        label: `# ${channel.name}`,
      })),
    ],
    [channels]
  );
  const maxUseOptions: InviteOption[] = [
    { value: 0, label: 'Unlimited' },
    { value: 1, label: '1 use' },
    { value: 5, label: '5 uses' },
    { value: 10, label: '10 uses' },
    { value: 25, label: '25 uses' },
    { value: 50, label: '50 uses' },
    { value: 100, label: '100 uses' },
  ];
  const expiryOptions: InviteOption[] = [
    { value: 0, label: 'Until Revoked' },
    { value: 7 * 24 * 60 * 60, label: '7 days' },
    { value: 14 * 24 * 60 * 60, label: '14 days' },
    { value: 30 * 24 * 60 * 60, label: '30 days' },
    { value: 90 * 24 * 60 * 60, label: '90 days' },
  ];

  const handleCreate = async () => {
    try {
      setLoading(true);
      setError(null);

      const response = await api.post('/api/invites', {
        channelId: channelId || null,
        maxUses: maxUses || 0,
        expiresIn: expiresIn || null,
      });

      const localhostPattern = /:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?(?:\/|$)/i;
      let resolvedInviteUrl: string | null = response.centralUrl || response.directUrl || null;
      if (
        typeof response.centralUrl === 'string'
        && localhostPattern.test(response.centralUrl)
        && typeof response.code === 'string'
        && !/^(localhost|127\.0\.0\.1)$/i.test(window.location.hostname)
      ) {
        resolvedInviteUrl = `${window.location.origin}/invite/${response.code}`;
      }

      setInviteUrl(resolvedInviteUrl);
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to create invite');
    } finally {
      setLoading(false);
    }
  };

  const handleCopy = async () => {
    if (inviteUrl) {
      const copied = await writeClipboardText(inviteUrl);
      if (!copied) return;
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleClose = () => {
    setOpen(false);
    setChannelId('');
    setMaxUses(0);
    setExpiresIn(0);
    setInviteUrl(null);
    setError(null);
    setCopied(false);
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
      <div className="bg-bg-elevated border border-border rounded-xl shadow-2xl max-w-md w-full max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-border">
          <div className="flex items-center gap-2">
            <LinkIcon className="w-5 h-5 text-accent" />
            <h2 className="text-lg font-bold text-text-primary">Create Invite Link</h2>
          </div>
          <button
            onClick={handleClose}
            className="text-text-secondary hover:text-text-primary p-1 rounded transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-4 overflow-y-auto flex-1">
          {!inviteUrl ? (
            <div className="space-y-4">
              {/* Channel Selector */}
              <InviteSelect
                label="Invite to channel (optional)"
                value={channelId}
                options={channelOptions}
                onChange={(next) => setChannelId(String(next))}
              />

              {/* Max Uses */}
              <InviteSelect
                label="Max uses"
                value={maxUses}
                options={maxUseOptions}
                onChange={(next) => setMaxUses(Number(next))}
              />

              {/* Expiry */}
              <InviteSelect
                label="Expires after"
                value={expiresIn}
                options={expiryOptions}
                onChange={(next) => setExpiresIn(Number(next))}
              />

              {error && (
                <div className="p-3 bg-red-900/20 border border-red-600/30 rounded-lg text-red-400 text-sm">
                  {error}
                </div>
              )}

              <button
                onClick={handleCreate}
                disabled={loading}
                className="w-full px-4 py-2 bg-accent hover:bg-accent-hover disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-lg font-medium transition-colors"
              >
                {loading ? 'Creating...' : 'Create Invite Link'}
              </button>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex items-center gap-2 text-green-400 mb-4">
                <CheckCircle className="w-5 h-5" />
                <span className="font-medium">Invite link created!</span>
              </div>

              <div className="bg-bg-primary border border-border rounded-lg p-3">
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={inviteUrl}
                    readOnly
                    className="flex-1 bg-transparent text-text-primary text-sm focus:outline-none"
                  />
                  <button
                    onClick={handleCopy}
                    className="px-3 py-1.5 bg-accent hover:bg-accent-hover text-white rounded-md transition-colors flex items-center gap-2 text-sm"
                  >
                    {copied ? (
                      <>
                        <CheckCircle className="w-4 h-4" />
                        Copied!
                      </>
                    ) : (
                      <>
                        <Copy className="w-4 h-4" />
                        Copy
                      </>
                    )}
                  </button>
                </div>
              </div>

              <p className="text-text-secondary text-sm">
                Share this link with people you want to invite to your server.
              </p>

              <button
                onClick={handleClose}
                className="w-full px-4 py-2 bg-bg-primary hover:bg-gray-700 text-text-primary rounded-lg font-medium transition-colors"
              >
                Done
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
