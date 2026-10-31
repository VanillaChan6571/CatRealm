import { useState, useEffect } from 'react';
import { Save, AlertTriangle } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { api } from '../../../lib/api';

interface ModerationSettings {
  banned_words: string[];
  default_slowmode: number;
  timeout_defaults: Record<string, any>;
}

export function ModerationSection() {
  const { t } = useTranslation();
  const [settings, setSettings] = useState<ModerationSettings>({
    banned_words: [],
    default_slowmode: 0,
    timeout_defaults: {},
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [bannedWordsInput, setBannedWordsInput] = useState('');

  useEffect(() => {
    loadSettings();
  }, []);

  useEffect(() => {
    setBannedWordsInput(settings.banned_words.join(', '));
  }, [settings.banned_words]);

  const loadSettings = async () => {
    try {
      setLoading(true);
      const data = await api.get('/api/moderation/settings');
      setSettings(data);
    } catch (err) {
      setError('Failed to load moderation settings');
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    try {
      setSaving(true);
      setError(null);
      setSuccess(false);

      // Parse banned words from input
      const banned_words = bannedWordsInput
        .split(',')
        .map((w) => w.trim())
        .filter((w) => w.length > 0);

      await api.put('/api/moderation/settings', {
        ...settings,
        banned_words,
      });

      setSuccess(true);
      setTimeout(() => setSuccess(false), 3000);
      await loadSettings();
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to save settings');
      console.error(err);
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-gray-400">{t('admin.loadingModeration')}</div>
      </div>
    );
  }

  return (
    <div className="max-w-5xl">
      <div className="mb-6">
        <h2 className="text-2xl font-bold text-gray-100 mb-2">{t('admin.moderation')}</h2>
        <p className="text-gray-400">
          {t('admin.moderationDesc')}
        </p>
      </div>

      <div className="space-y-6">
        {/* Banned Words */}
        <div className="p-6 rounded-lg bg-gray-800/50 border border-gray-700">
          <div className="flex items-start gap-3 mb-4">
            <AlertTriangle className="w-5 h-5 text-yellow-500 mt-0.5" />
            <div>
              <h3 className="text-lg font-semibold text-gray-200">{t('admin.bannedWordsFilter')}</h3>
              <p className="text-sm text-gray-400 mt-1">
                {t('admin.bannedWordsFilterDesc')}
              </p>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">
              {t('admin.bannedWordsLabel')}
            </label>
            <textarea
              value={bannedWordsInput}
              onChange={(e) => setBannedWordsInput(e.target.value)}
              className="w-full px-4 py-2 bg-gray-900 border border-gray-700 rounded-lg text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
              placeholder={t('admin.bannedWordsPlaceholder')}
              rows={3}
            />
            <p className="text-xs text-gray-500 mt-1">
              {t('admin.bannedWordsHint')}
            </p>
          </div>
        </div>

        {/* Slowmode Settings */}
        <div className="p-6 rounded-lg bg-gray-800/50 border border-gray-700">
          <h3 className="text-lg font-semibold text-gray-200 mb-4">{t('admin.slowmodeSettings')}</h3>

          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">
              {t('admin.defaultSlowmode')}
            </label>
            <input
              type="number"
              value={settings.default_slowmode}
              onChange={(e) =>
                setSettings({
                  ...settings,
                  default_slowmode: parseInt(e.target.value) || 0,
                })
              }
              className="w-full px-4 py-2 bg-gray-900 border border-gray-700 rounded-lg text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
              min={0}
              max={3600}
            />
            <p className="text-xs text-gray-500 mt-1">
              {t('admin.slowmodeHint')}
            </p>
          </div>
        </div>

        {/* Error/Success Messages */}
        {error && (
          <div className="p-4 rounded-lg bg-red-900/20 border border-red-600/30 text-red-400">
            {error}
          </div>
        )}

        {success && (
          <div className="p-4 rounded-lg bg-green-900/20 border border-green-600/30 text-green-400">
            {t('admin.moderationSaved')}
          </div>
        )}

        {/* Save Button */}
        <div className="flex justify-end">
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex items-center gap-2 px-6 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-lg font-medium transition-colors"
          >
            <Save className="w-4 h-4" />
            {saving ? t('common.saving') : t('admin.saveChanges')}
          </button>
        </div>

      </div>
    </div>
  );
}
