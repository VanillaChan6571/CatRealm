import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Switch, View } from 'react-native';
import { ShieldBan, ShieldCheck } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { createApi } from '@/lib/api';
import { useTheme } from '@/theme';
import type { BotConsent, BotScope } from '@/types';
import { Text } from './Text';

interface BotProfileSettingsProps {
  botId: string;
  requestedScopes?: BotScope[];
  serverUrl: string;
  token?: string;
}

const SCOPE_DEFINITIONS: Array<{ scope: BotScope; labelKey: string; descriptionKey: string }> = [
  { scope: 'interactions', labelKey: 'profile.botScopeInteractions', descriptionKey: 'profile.botScopeInteractionsDesc' },
  { scope: 'profile', labelKey: 'profile.botScopeProfile', descriptionKey: 'profile.botScopeProfileDesc' },
  { scope: 'mentions', labelKey: 'profile.botScopeMentions', descriptionKey: 'profile.botScopeMentionsDesc' },
  { scope: 'private_messages', labelKey: 'profile.botScopePrivateMessages', descriptionKey: 'profile.botScopePrivateMessagesDesc' },
];

export function BotProfileSettings({ botId, requestedScopes, serverUrl, token }: BotProfileSettingsProps) {
  const theme = useTheme();
  const { t } = useTranslation();
  const [consent, setConsent] = useState<BotConsent | null>(null);
  const [requested, setRequested] = useState<BotScope[]>(requestedScopes ?? []);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      const res = await createApi(serverUrl, token).get<{
        requestedScopes?: BotScope[];
        consent?: BotConsent | null;
      }>(`/api/bots/${botId}/consent`);
      setConsent(res.data?.consent ?? null);
      if (Array.isArray(res.data?.requestedScopes)) setRequested(res.data.requestedScopes);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [botId, serverUrl, token]);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async (decision: BotConsent['decision'], scopes: BotConsent['scopes']) => {
    setSaving(true);
    setError(false);
    try {
      const res = await createApi(serverUrl, token).put<{ consent?: BotConsent }>(
        `/api/bots/${botId}/consent`,
        { decision, scopes },
      );
      setConsent(res.data?.consent ?? null);
    } catch {
      setError(true);
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <View style={{ alignItems: 'center', paddingVertical: 18 }}>
        <ActivityIndicator size="small" color={theme.colors.accent} />
      </View>
    );
  }

  const blocked = consent?.decision === 'denied';
  const visibleScopes = SCOPE_DEFINITIONS.filter((definition) => requested.includes(definition.scope));

  return (
    <View style={{ marginTop: 20, gap: 10 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
        {blocked
          ? <ShieldBan size={16} color={theme.colors.danger} />
          : <ShieldCheck size={16} color={theme.colors.accent} />}
        <Text variant="subtitle">{t('profile.botSettings')}</Text>
      </View>
      <Text variant="caption" color={theme.colors.text3}>
        {t('profile.botSettingsDesc')}
      </Text>

      <View style={{ gap: 8 }}>
        <ConsentRow
          label={t('profile.blockBot')}
          description={t('profile.blockBotDesc')}
          value={blocked}
          disabled={saving}
          onValueChange={(value) => {
            if (value) {
              void save('denied', {});
              return;
            }
            const scopes: BotConsent['scopes'] = {};
            for (const scope of requested) scopes[scope] = true;
            void save('allowed', scopes);
          }}
        />

        {!blocked && visibleScopes.map((definition) => (
          <ConsentRow
            key={definition.scope}
            label={t(definition.labelKey)}
            description={t(definition.descriptionKey)}
            value={consent?.decision === 'allowed' && consent.scopes?.[definition.scope] === true}
            disabled={saving}
            onValueChange={(value) => {
              void save('allowed', { ...(consent?.scopes ?? {}), [definition.scope]: value });
            }}
          />
        ))}
      </View>

      {!blocked && !consent ? (
        <Text variant="caption" color={theme.colors.text3}>
          {t('profile.botConsentUndecided')}
        </Text>
      ) : null}
      {error ? <Text variant="caption" color={theme.colors.danger}>{t('profile.botSettingsError')}</Text> : null}
    </View>
  );
}

function ConsentRow({
  label,
  description,
  value,
  disabled,
  onValueChange,
}: {
  label: string;
  description: string;
  value: boolean;
  disabled: boolean;
  onValueChange: (value: boolean) => void;
}) {
  const theme = useTheme();
  return (
    <View style={{
      flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12,
      borderWidth: 1, borderColor: theme.colors.lineSoft, borderRadius: 12,
      backgroundColor: theme.colors.bgElev1,
    }}>
      <View style={{ flex: 1 }}>
        <Text variant="bodySmall" style={{ fontWeight: '600' }}>{label}</Text>
        <Text variant="caption" color={theme.colors.text3} style={{ marginTop: 2 }}>
          {description}
        </Text>
      </View>
      <Switch
        value={value}
        disabled={disabled}
        onValueChange={onValueChange}
        trackColor={{ false: theme.colors.bgElev2, true: theme.colors.accent }}
        thumbColor="#FFFFFF"
      />
    </View>
  );
}
