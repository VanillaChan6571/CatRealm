import { useEffect, useState } from 'react';
import { X, Home, Shield, Users, Gavel, Download, Link as LinkIcon, SmilePlus, ChevronRight, ArrowLeft, Webhook, Sparkles, Clapperboard, ScrollText, Bot } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useUIStore } from '../../stores/uiStore';
import { useAuthStore } from '../../stores/authStore';
import { PERMISSIONS, hasPermission } from '../../utils/permissions';
import { OverviewSection } from './sections/OverviewSection';
import { RolesSection } from './sections/RolesSection';
import { MembersSection } from './sections/MembersSection';
import { ModerationSection } from './sections/ModerationSection';
import { TemplateImportSection } from './sections/TemplateImportSection';
import { InvitesSection } from './sections/InvitesSection';
import { ExpressionsSection } from './sections/ExpressionsSection';
import { WebhooksSection } from './sections/WebhooksSection';
import { WelcomeBoardSection } from './sections/WelcomeBoardSection';
import { TheaterYouTubeCookiesSection } from './sections/TheaterYouTubeCookiesSection';
import { AuditLogSection } from './sections/AuditLogSection';
import { BotsSection } from './sections/BotsSection';

type Section = 'overview' | 'roles' | 'members' | 'moderation' | 'auditLog' | 'invites' | 'template' | 'expressions' | 'webhooks' | 'bots' | 'welcome' | 'theaterYoutubeCookies';

export function ServerSettingsModal() {
  const { t } = useTranslation();
  const activeModal = useUIStore((s) => s.activeModal);
  const closeModal = useUIStore((s) => s.closeModal);
  const [activeSection, setActiveSection] = useState<Section>('overview');
  const user = useAuthStore((s) => s.user);
  const canViewAuditLog = !!user?.isOwner || hasPermission(user?.permissions, PERMISSIONS.VIEW_AUDIT_LOG);
  const canManageBots = !!user?.isOwner || hasPermission(user?.permissions, PERMISSIONS.MANAGE_BOTS);
  const [welcomeEnabled, setWelcomeEnabled] = useState(false);
  // Mobile: 'nav' shows the section list, 'content' shows the selected section
  const [mobilePane, setMobilePane] = useState<'nav' | 'content'>('nav');

  useEffect(() => {
    if (activeModal !== 'adminSettings') return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        closeModal();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [activeModal, closeModal]);

  if (activeModal !== 'adminSettings') return null;

  const navItems = [
    { id: 'overview' as Section, label: t('admin.navOverview'), icon: Home },
    { id: 'roles' as Section, label: t('admin.navRoles'), icon: Shield },
    { id: 'members' as Section, label: t('admin.navMembers'), icon: Users },
    { id: 'moderation' as Section, label: t('admin.navModeration'), icon: Gavel },
    ...(canViewAuditLog ? [{ id: 'auditLog' as Section, label: t('admin.navAuditLog'), icon: ScrollText }] : []),
    { id: 'invites' as Section, label: t('admin.navInvites'), icon: LinkIcon },
    { id: 'expressions' as Section, label: t('admin.navExpressions'), icon: SmilePlus },
    { id: 'webhooks' as Section, label: t('admin.navWebhooks'), icon: Webhook },
    ...(canManageBots ? [{ id: 'bots' as Section, label: t('admin.navBots'), icon: Bot }] : []),
    { id: 'theaterYoutubeCookies' as Section, label: t('admin.navTheaterYT'), icon: Clapperboard },
    { id: 'welcome' as Section, label: t('admin.navWelcome'), icon: Sparkles },
    { id: 'template' as Section, label: t('admin.navTemplate'), icon: Download },
  ];

  const selectSection = (section: Section) => {
    setActiveSection(section);
    setMobilePane('content');
  };

  const activeLabel = navItems.find((item) => item.id === activeSection)?.label ?? '';

  return (
    <div
      className="fixed inset-0 z-50 flex md:items-center md:justify-center bg-black/80 modal-backdrop-in"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          closeModal();
        }
      }}
    >
      <div
        className="w-full h-full md:w-[95vw] md:h-[90vh] md:max-w-[1400px] bg-gray-900 md:rounded-xl shadow-2xl overflow-hidden flex flex-col md:flex-row modal-panel-in"
        onClick={(e) => e.stopPropagation()}
      >
        {/* ── Sidebar / Mobile nav list ── */}
        <div
          className={`
            md:w-60 bg-gray-800/50 md:border-r border-gray-700 flex-col
            ${mobilePane === 'nav' ? 'flex' : 'hidden'} md:flex
          `}
        >
          {/* Sidebar header */}
          <div className="h-14 flex items-center justify-between px-4 border-b border-gray-700 shrink-0">
            <h2 className="text-base font-bold text-gray-100">{t('admin.realmSettings')}</h2>
            {/* Close button visible on mobile nav pane */}
            <button
              onClick={closeModal}
              className="md:hidden p-1.5 rounded-lg hover:bg-gray-700/50 text-gray-400 hover:text-gray-300 transition-colors"
              aria-label="Close"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          <nav className="flex-1 p-3 overflow-y-auto">
            <div className="space-y-0.5">
              {navItems.map((item) => {
                const Icon = item.icon;
                const isActive = activeSection === item.id;

                return (
                  <button
                    key={item.id}
                    onClick={() => selectSection(item.id)}
                    className={`
                      w-full flex items-center gap-3 px-3 py-3 md:py-2 rounded-lg text-left transition-colors
                      ${
                        isActive
                          ? 'bg-blue-600 text-white'
                          : 'text-gray-300 hover:bg-gray-700/50 hover:text-gray-100'
                      }
                    `}
                  >
                    <Icon className={`w-5 h-5 flex-shrink-0 ${!isActive && item.id === 'welcome' && welcomeEnabled ? 'text-green-400' : ''}`} />
                    <span className={`font-medium flex-1 ${!isActive && item.id === 'welcome' && welcomeEnabled ? 'text-green-400' : ''}`}>{item.label}</span>
                    {/* Chevron on mobile only */}
                    <ChevronRight className="w-4 h-4 opacity-40 md:hidden" />
                  </button>
                );
              })}
            </div>
          </nav>

          <div className="p-4 border-t border-gray-700 hidden md:block">
            <div className="text-xs text-gray-500 text-center">
              Press <kbd className="px-1.5 py-0.5 rounded bg-gray-700 text-gray-300">ESC</kbd>{' '}
              to close
            </div>
          </div>
        </div>

        {/* ── Content Area ── */}
        <div
          className={`
            flex-1 flex-col overflow-hidden
            ${mobilePane === 'content' ? 'flex' : 'hidden'} md:flex
          `}
        >
          {/* Content header */}
          <div className="h-14 flex items-center gap-2 px-4 border-b border-gray-700 shrink-0">
            {/* Back button on mobile */}
            <button
              onClick={() => setMobilePane('nav')}
              className="md:hidden p-1.5 -ml-1 rounded-lg hover:bg-gray-700/50 text-gray-400 hover:text-gray-300 transition-colors shrink-0"
              aria-label="Back"
            >
              <ArrowLeft className="w-5 h-5" />
            </button>
            <h3 className="text-lg font-bold text-gray-100 flex-1 truncate">{activeLabel}</h3>
            {/* Close button on desktop */}
            <button
              onClick={closeModal}
              className="p-1.5 rounded-lg hover:bg-gray-700/50 text-gray-400 hover:text-gray-300 transition-colors shrink-0"
              aria-label="Close"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Scrollable Content */}
          <div className="flex-1 overflow-y-auto overflow-x-visible p-4 md:p-6">
            {activeSection === 'overview' && <OverviewSection />}
            {activeSection === 'roles' && <RolesSection />}
            {activeSection === 'members' && <MembersSection />}
            {activeSection === 'moderation' && <ModerationSection />}
            {activeSection === 'auditLog' && canViewAuditLog && <AuditLogSection />}
            {activeSection === 'invites' && <InvitesSection />}
            {activeSection === 'expressions' && <ExpressionsSection />}
            {activeSection === 'webhooks' && <WebhooksSection />}
            {activeSection === 'bots' && canManageBots && <BotsSection />}
            {activeSection === 'theaterYoutubeCookies' && <TheaterYouTubeCookiesSection />}
            {activeSection === 'welcome' && <WelcomeBoardSection onStatusChange={setWelcomeEnabled} />}
            {activeSection === 'template' && <TemplateImportSection />}
          </div>
        </div>
      </div>
    </div>
  );
}
