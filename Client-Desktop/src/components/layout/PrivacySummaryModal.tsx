import { Bell, Database, ExternalLink, EyeOff, LockKeyhole, RadioTower, Server, ShieldCheck } from 'lucide-react';
import type { ComponentType } from 'react';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { AUTH_BASE } from '../../lib/authApi';
import { openExternalUrl } from '../../utils/externalLinks';
import { useAuthStore } from '../../stores/authStore';
import { useContentSocialStore } from '../../stores/contentSocialStore';
import { useServerStore } from '../../stores/serverStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { useUIStore } from '../../stores/uiStore';

type PrivacyCardProps = {
  title: string;
  description: string;
  items: string[];
  icon: ComponentType<{ className?: string }>;
};

function PrivacyCard({ title, description, items, icon: Icon }: PrivacyCardProps) {
  return (
    <section className="rounded-xl border border-border bg-bg-elevated/60 p-4">
      <div className="flex items-start gap-3">
        <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-accent/35 bg-accent/10 text-accent">
          <Icon className="h-4 w-4" />
        </span>
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-text-primary">{title}</h3>
          <p className="mt-1 text-xs text-text-muted">{description}</p>
        </div>
      </div>
      <ul className="mt-3 space-y-1.5 text-xs text-text-secondary">
        {items.map((item) => (
          <li key={item} className="flex gap-2">
            <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-text-muted/70" />
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function PrivacySummaryModal() {
  const activeModal = useUIStore((s) => s.activeModal);
  const closeModal = useUIStore((s) => s.closeModal);
  const openModal = useUIStore((s) => s.openModal);
  const user = useAuthStore((s) => s.user);
  const servers = useServerStore((s) => s.servers);
  const notificationsEnabled = useSettingsStore((s) => s.notificationsEnabled);
  const streamerMode = useSettingsStore((s) => s.streamerMode);
  const allowNsfw = useContentSocialStore((s) => s.allowNsfw);

  const openSettings = (initialTab: string) => {
    openModal('profileSettings', { initialTab });
  };

  const isCentral = user?.accountType === 'central';

  return (
    <Modal open={activeModal === 'privacySummary'} onClose={closeModal} title="Privacy Dashboard" className="!max-w-6xl">
      <div className="space-y-5">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
          <div className="rounded-xl border border-border bg-bg-input p-3">
            <p className="text-xs text-text-muted">Account</p>
            <p className="mt-1 text-sm font-semibold capitalize text-text-primary">{user?.accountType ?? 'Unknown'}</p>
          </div>
          <div className="rounded-xl border border-border bg-bg-input p-3">
            <p className="text-xs text-text-muted">Connected realms</p>
            <p className="mt-1 text-sm font-semibold text-text-primary">{servers.length}</p>
          </div>
          <div className="rounded-xl border border-border bg-bg-input p-3">
            <p className="text-xs text-text-muted">Notifications</p>
            <p className="mt-1 text-sm font-semibold text-text-primary">{notificationsEnabled ? 'Enabled' : 'Disabled'}</p>
          </div>
          <div className="rounded-xl border border-border bg-bg-input p-3">
            <p className="text-xs text-text-muted">Streamer mode</p>
            <p className="mt-1 text-sm font-semibold text-text-primary">{streamerMode ? 'On' : 'Off'}</p>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          <PrivacyCard
            icon={ShieldCheck}
            title="Account and identity"
            description="Central identity is separate from each realm's server-side data."
            items={[
              'Central accounts use username plus authenticator app 2FA instead of passwords.',
              'Profile fields, friends, friend requests, badges, personal expression tokens (custom emotes/stickers), and encrypted server-list sync can exist on Central.',
              isCentral
                ? 'You can edit profile and social fields, and permanently delete your Central account yourself from Account Security.'
                : 'You can edit profile and social fields in settings. Full deletion depends on this server\'s operator.',
            ]}
          />
          <PrivacyCard
            icon={LockKeyhole}
            title="Encryption and local secrets"
            description="Some data is encrypted before it leaves the client."
            items={[
              'Server-list sync is encrypted client-side before upload.',
              'Session tokens stay client-side so the app can keep you signed in.',
              '2FA secrets, backup codes, and your server-list sync key are encrypted at rest by Central.',
            ]}
          />
          <PrivacyCard
            icon={Server}
            title="Realm and message data"
            description="Messages belong to the realm that hosts the chat."
            items={[
              'Messages, files, moderation logs, retention, and backups are controlled by the realm you join.',
              'Self-hosted operators can define their own logging, backup, moderation, and retention policy.',
              'Deleted content can remain in backups until those backups rotate or are removed.',
            ]}
          />
          <PrivacyCard
            icon={RadioTower}
            title="Voice and screenshare"
            description="Calls use realtime transport and may depend on relay infrastructure."
            items={[
              'Voice and screenshare are WebRTC-based. CatRealm does not store call recordings by default.',
              'TURN, relay, DNS, TLS, hosting, or CDN providers may process operational metadata depending on deployment.',
              'Network logs can include IP address, timestamp, user agent, and connection metadata.',
            ]}
          />
          <PrivacyCard
            icon={Bell}
            title="Notifications and previews"
            description="Notification behavior depends on Central plus local device state."
            items={[
              'Central notifications can include DMs, friend requests, and server mentions.',
              'DM notification previews are hydrated locally when possible.',
              'Notification and sound behavior can be changed from settings.',
            ]}
          />
          <PrivacyCard
            icon={Database}
            title="Tracking and third parties"
            description="No ad-tech is bundled; a few features call out to named third parties."
            items={[
              'CatRealm does not sell personal data, use ad-tech tracking, or use an advertising identifier to track you.',
              'GIF search and YouTube profile verification send data to Klipy and Google only when you use those features.',
              `Sensitive media controls are currently ${allowNsfw ? 'relaxed' : 'restricted'} on this device.`,
            ]}
          />
        </div>

        <div className="rounded-xl border border-border bg-bg-input p-4">
          <div className="flex items-center gap-2">
            <EyeOff className="h-4 w-4 text-text-muted" />
            <h3 className="text-sm font-semibold text-text-primary">Quick controls</h3>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button size="sm" variant="secondary" onClick={() => openSettings('account-security')}>
              Account Security
            </Button>
            <Button size="sm" variant="secondary" onClick={() => openSettings('content-social')}>
              Content and Social
            </Button>
            <Button size="sm" variant="secondary" onClick={() => openSettings('notifications')}>
              Notifications
            </Button>
            <Button size="sm" variant="secondary" onClick={() => openSettings('streamer-mode')}>
              Streamer Mode
            </Button>
          </div>
          <button
            type="button"
            onClick={() => void openExternalUrl(`${AUTH_BASE}/privacy/`)}
            className="mt-3 inline-flex items-center gap-1.5 text-xs text-text-muted hover:text-text-primary transition-colors"
          >
            <ExternalLink className="h-3.5 w-3.5" />
            Read the full Privacy Policy
          </button>
        </div>
      </div>
    </Modal>
  );
}
