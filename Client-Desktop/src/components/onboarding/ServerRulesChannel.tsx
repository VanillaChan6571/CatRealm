import { useEffect, useMemo, useState } from 'react';
import { ShieldCheck } from 'lucide-react';
import { createApi } from '../../lib/api';
import { useAuthStore } from '../../stores/authStore';
import { MessageFormatter } from '../chat/MessageFormatter';

interface WelcomeRule {
  id: string;
  content: string;
  position: number;
}

interface WelcomeSettings {
  bg: string;
  serverIcon?: string | null;
  rules: WelcomeRule[];
  rulesMode: 'structured' | 'markdown';
  rulesMarkdown: string;
}

function resolveAssetUrl(value: string | null | undefined, serverUrl: string) {
  if (!value) return null;
  if (/^https?:\/\//i.test(value) || !serverUrl) return value;
  return `${serverUrl}${value}`;
}

export function ServerRulesChannel() {
  const serverInfo = useAuthStore((s) => s.serverInfo);
  const authServerUrl = useAuthStore((s) => s.serverUrl) || '';
  const [settings, setSettings] = useState<WelcomeSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const api = createApi();
    api.get<WelcomeSettings>('/api/welcome/settings')
      .then((res) => {
        if (cancelled) return;
        setSettings(res.data);
        setLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        setError('Failed to load server rules.');
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const serverUrl = createApi().defaults.baseURL || authServerUrl;
  const backgroundUrl = resolveAssetUrl(settings?.bg, serverUrl);
  const serverIconUrl = useMemo(
    () => resolveAssetUrl(settings?.serverIcon || serverInfo?.serverIcon, serverUrl),
    [serverInfo?.serverIcon, serverUrl, settings?.serverIcon],
  );

  return (
    <div className="invite-backdrop relative flex-1 overflow-hidden bg-bg-chat">
      {backgroundUrl && (
        <div
          className="absolute inset-0 bg-cover bg-center"
          style={{ backgroundImage: `url(${backgroundUrl})` }}
        />
      )}
      <div aria-hidden="true" className="invite-orb-a pointer-events-none absolute left-[-160px] bottom-[-190px] h-[460px] w-[460px] rounded-full opacity-80 blur-[8px]" />
      <div aria-hidden="true" className="invite-orb-b pointer-events-none absolute right-[-130px] top-[88px] h-[390px] w-[390px] rounded-full opacity-70 blur-[7px]" />
      <div aria-hidden="true" className="invite-stars pointer-events-none absolute inset-0" />
      {backgroundUrl && <div className="absolute inset-0 bg-black/65" />}

      <div className="relative z-10 flex h-full min-h-0 items-center justify-center p-6">
        <div className="invite-card-breathe flex max-h-full w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-gray-700/60 bg-gray-900/95 shadow-2xl backdrop-blur-md">
          <div className="shrink-0 border-b border-gray-700/70 p-6">
            <div className="flex items-center gap-4">
              {serverIconUrl ? (
                <img src={serverIconUrl} alt="" className="h-14 w-14 shrink-0 rounded-2xl object-cover" />
              ) : (
                <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-violet-500/20 text-violet-200">
                  <ShieldCheck className="h-7 w-7" />
                </div>
              )}
              <div className="min-w-0">
                <h1 className="truncate text-2xl font-bold text-gray-100">Server Rules</h1>
                <p className="mt-1 text-sm text-gray-400">{serverInfo?.name ?? 'This realm'}</p>
              </div>
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto p-6">
            {loading && <p className="text-sm text-gray-400">Loading rules...</p>}
            {error && <p className="text-sm text-red-400">{error}</p>}
            {!loading && !error && settings?.rulesMode === 'structured' && (
              <div className="space-y-4">
                {settings.rules.map((rule, index) => (
                  <div key={rule.id} className="flex gap-4 rounded-xl border border-white/10 bg-white/[0.03] p-4 text-gray-200">
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-violet-500/20 text-sm font-bold text-violet-200">
                      {index + 1}
                    </span>
                    <p className="text-sm leading-relaxed">{rule.content}</p>
                  </div>
                ))}
              </div>
            )}
            {!loading && !error && settings?.rulesMode === 'markdown' && (
              <div className="max-w-none text-sm leading-relaxed text-gray-200">
                <MessageFormatter
                  text={settings.rulesMarkdown}
                  className="text-sm leading-relaxed text-gray-200 [&_a]:text-violet-300 [&_a:hover]:text-violet-200 [&_code]:text-violet-200 [&_.text-accent]:text-violet-300"
                  allowLinks
                />
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
