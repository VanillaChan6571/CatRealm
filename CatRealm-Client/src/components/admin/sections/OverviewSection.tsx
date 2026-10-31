import { useState, useEffect } from 'react';
import { Save, Info } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { api, createApi } from '../../../lib/api';
import { useAuthStore } from '../../../stores/authStore';
import { ImageCropModal } from '../../ui/ImageCropModal';

interface OverviewSectionProps {
  onSettingsChange?: () => void;
}

export function OverviewSection({ onSettingsChange }: OverviewSectionProps) {
  const { t } = useTranslation();
  const [settings, setSettings] = useState({
    name: '',
    description: '',
    registrationOpen: true,
    mentionAlias: '@everyone',
    mediaMaxMb: 50,
    theaterUploadMaxMb: 2048,
    theaterUploadHardMaxMb: 10240,
    maxPins: 300,
    avatarMaxMb: 10,
    serverIcon: null as string | null,
    serverBanner: null as string | null,
    maxEmotes: 100,
    maxAnimatedEmotes: 50,
    maxStickers: 100,
    maxAnimatedStickers: 50,
    mediaRemoveLimits: false,
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [uploadingIcon, setUploadingIcon] = useState(false);
  const [uploadingBanner, setUploadingBanner] = useState(false);
  const [cropTarget, setCropTarget] = useState<{ type: 'icon' | 'banner'; file: File } | null>(null);
  const [serverInfo, setServerInfo] = useState<{
    version?: string;
    gitHash?: string;
    buildInfo?: string;
  }>({});
  const serverUrl = useAuthStore((s) => s.serverUrl);

  useEffect(() => {
    loadSettings();
    loadServerInfo();
  }, []);

  const loadSettings = async () => {
    try {
      setLoading(true);
      const data = await api.get('/api/admin/settings');
      setSettings(data);
    } catch (err) {
      setError('Failed to load server settings');
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const loadServerInfo = async () => {
    try {
      const data = await api.get('/api/server');
      setServerInfo({
        version: data.version,
        gitHash: data.gitHash,
        buildInfo: data.buildInfo,
      });
    } catch (err) {
      console.error('Failed to load server info:', err);
    }
  };

  const handleSave = async () => {
    try {
      setSaving(true);
      setError(null);
      setSuccess(false);

      await api.put('/api/admin/settings', settings);

      setSuccess(true);
      setTimeout(() => setSuccess(false), 3000);

      if (onSettingsChange) {
        onSettingsChange();
      }
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to save settings');
      console.error(err);
    } finally {
      setSaving(false);
    }
  };

  const resolveAsset = (asset: string | null | undefined) => {
    if (!asset) return null;
    if (/^https?:\/\//i.test(asset)) return asset;
    if (!serverUrl) return null;
    return `${serverUrl}${asset}`;
  };

  const handleUpload = async (type: 'icon' | 'banner', file: File) => {
    const formData = new FormData();
    formData.append('file', file);
    const endpoint = type === 'icon' ? '/api/admin/server-icon' : '/api/admin/server-banner';
    const setUploading = type === 'icon' ? setUploadingIcon : setUploadingBanner;

    try {
      setUploading(true);
      setError(null);
      const apiClient = createApi();
      const res = await apiClient.post(endpoint, formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });

      if (type === 'icon') {
        setSettings((prev) => ({ ...prev, serverIcon: res.data.serverIcon ?? null }));
      } else {
        setSettings((prev) => ({ ...prev, serverBanner: res.data.serverBanner ?? null }));
      }
    } catch (err: any) {
      setError(err.response?.data?.error || `Failed to upload server ${type}`);
    } finally {
      setUploading(false);
    }
  };

  const handleCroppedUpload = (file: File) => {
    if (!cropTarget) return;
    const { type } = cropTarget;
    setCropTarget(null);
    void handleUpload(type, file);
  };

  const handleRemove = async (type: 'icon' | 'banner') => {
    const endpoint = type === 'icon' ? '/api/admin/server-icon' : '/api/admin/server-banner';
    const setUploading = type === 'icon' ? setUploadingIcon : setUploadingBanner;
    try {
      setUploading(true);
      setError(null);
      await api.delete(endpoint);
      if (type === 'icon') {
        setSettings((prev) => ({ ...prev, serverIcon: null }));
      } else {
        setSettings((prev) => ({ ...prev, serverBanner: null }));
      }
    } catch (err: any) {
      setError(err.response?.data?.error || `Failed to remove server ${type}`);
    } finally {
      setUploading(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-gray-400">{t('admin.loadingSettings')}</div>
      </div>
    );
  }

  return (
    <div className="max-w-3xl">
      <div className="mb-6">
        <h2 className="text-2xl font-bold text-gray-100 mb-2">{t('admin.serverOverview')}</h2>
        <p className="text-gray-400">{t('admin.serverOverviewDesc')}</p>
      </div>

      <div className="space-y-6">
        {/* Server Version Info */}
        {serverInfo.buildInfo && (
          <div className="p-4 rounded-lg bg-blue-900/20 border border-blue-600/30">
            <div className="flex items-start gap-3">
              <Info className="w-5 h-5 text-blue-400 mt-0.5 flex-shrink-0" />
              <div className="flex-1">
                <h3 className="text-sm font-semibold text-blue-300 mb-1">{t('admin.serverVersion')}</h3>
                <div className="flex items-center gap-4 text-sm text-blue-200/80">
                  <div>
                    <span className="font-medium">{t('admin.versionLabel')}</span>{' '}
                    <code className="px-2 py-0.5 bg-blue-900/40 rounded">{serverInfo.version}</code>
                  </div>
                  <div>
                    <span className="font-medium">{t('admin.gitHashLabel')}</span>{' '}
                    <code className="px-2 py-0.5 bg-blue-900/40 rounded">{serverInfo.gitHash}</code>
                  </div>
                </div>
                <p className="text-xs text-blue-300/60 mt-2">
                  {t('admin.buildLabel', { info: serverInfo.buildInfo })}
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Server Name */}
        <div>
          <label className="block text-sm font-medium text-gray-300 mb-2">
            {t('admin.serverName')}
          </label>
          <input
            type="text"
            value={settings.name}
            onChange={(e) => setSettings({ ...settings, name: e.target.value })}
            className="w-full px-4 py-2 bg-gray-800 border border-gray-700 rounded-lg text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder={t('admin.serverNamePlaceholder')}
            maxLength={50}
          />
          <p className="text-xs text-gray-500 mt-1">{t('admin.serverNameChars')}</p>
        </div>

        {/* Server Description */}
        <div>
          <label className="block text-sm font-medium text-gray-300 mb-2">
            {t('admin.serverDescription')}
          </label>
          <textarea
            value={settings.description}
            onChange={(e) => setSettings({ ...settings, description: e.target.value })}
            className="w-full px-4 py-2 bg-gray-800 border border-gray-700 rounded-lg text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
            placeholder={t('admin.serverDescPlaceholder')}
            rows={3}
            maxLength={200}
          />
          <p className="text-xs text-gray-500 mt-1">{t('admin.serverDescChars')}</p>
        </div>

        {/* Registration */}
        <div>
          <label className="flex items-center gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={settings.registrationOpen}
              onChange={(e) =>
                setSettings({ ...settings, registrationOpen: e.target.checked })
              }
              className="w-5 h-5 rounded bg-gray-800 border-gray-700 text-blue-600 focus:ring-2 focus:ring-blue-500"
            />
            <div>
              <span className="text-sm font-medium text-gray-300">
                {t('admin.allowRegistrations')}
              </span>
              <p className="text-xs text-gray-500">
                {t('admin.allowRegistrationsDesc')}
              </p>
            </div>
          </label>
        </div>

        {/* Mention Alias */}
        <div>
          <label className="block text-sm font-medium text-gray-300 mb-2">
            {t('admin.mentionAlias')}
          </label>
          <input
            type="text"
            value={settings.mentionAlias}
            onChange={(e) => setSettings({ ...settings, mentionAlias: e.target.value })}
            className="w-full px-4 py-2 bg-gray-800 border border-gray-700 rounded-lg text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder="@everyone"
            maxLength={20}
          />
          <p className="text-xs text-gray-500 mt-1">
            {t('admin.mentionAliasHint')}
          </p>
        </div>

        {/* Branding */}
        <div className="border-t border-gray-700 pt-6">
          <h3 className="text-lg font-semibold text-gray-200 mb-4">{t('admin.serverBranding')}</h3>
          <div className="space-y-5">
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">{t('admin.serverIcon')}</label>
              {settings.serverIcon && (
                <img
                  src={resolveAsset(settings.serverIcon) ?? ''}
                  alt={t('admin.serverIconAlt')}
                  className="w-16 h-16 rounded-xl object-cover border border-gray-700 mb-3"
                />
              )}
              <div className="flex gap-2">
                <label className="px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-gray-200 hover:bg-gray-700 cursor-pointer text-sm">
                  {t('admin.upload')}
                  <input
                    type="file"
                    accept="image/png,image/apng,image/jpeg,image/jpg,image/gif"
                    className="hidden"
                    disabled={uploadingIcon}
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) setCropTarget({ type: 'icon', file });
                      e.currentTarget.value = '';
                    }}
                  />
                </label>
                <button
                  type="button"
                  onClick={() => void handleRemove('icon')}
                  disabled={uploadingIcon || !settings.serverIcon}
                  className="px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-gray-200 hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed text-sm"
                >
                  {t('admin.remove')}
                </button>
              </div>
              <p className="text-xs text-gray-500 mt-1">{t('admin.iconPath')}</p>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">{t('admin.serverBannerLabel')}</label>
              {settings.serverBanner && (
                <img
                  src={resolveAsset(settings.serverBanner) ?? ''}
                  alt={t('admin.serverBannerAlt')}
                  className="w-full max-w-xl h-40 rounded-xl object-cover border border-gray-700 mb-3"
                />
              )}
              <div className="flex gap-2">
                <label className="px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-gray-200 hover:bg-gray-700 cursor-pointer text-sm">
                  {t('admin.upload')}
                  <input
                    type="file"
                    accept="image/png,image/apng,image/jpeg,image/jpg,image/gif"
                    className="hidden"
                    disabled={uploadingBanner}
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) setCropTarget({ type: 'banner', file });
                      e.currentTarget.value = '';
                    }}
                  />
                </label>
                <button
                  type="button"
                  onClick={() => void handleRemove('banner')}
                  disabled={uploadingBanner || !settings.serverBanner}
                  className="px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-gray-200 hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed text-sm"
                >
                  {t('admin.remove')}
                </button>
              </div>
              <p className="text-xs text-gray-500 mt-1">{t('admin.bannerPath')}</p>
            </div>
          </div>
        </div>

        {/* Owner-only Settings */}
        <div className="border-t border-gray-700 pt-6">
          <h3 className="text-lg font-semibold text-gray-200 mb-4">{t('admin.ownerSettings')}</h3>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">
                {t('admin.mediaUploadLimit')}
              </label>
              <input
                type="number"
                value={settings.mediaMaxMb}
                onChange={(e) =>
                  setSettings({ ...settings, mediaMaxMb: parseInt(e.target.value) || 50 })
                }
                className="w-full px-4 py-2 bg-gray-800 border border-gray-700 rounded-lg text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
                min={1}
                max={settings.mediaRemoveLimits ? undefined : 980}
              />
              <p className="text-xs text-gray-500 mt-1">
                {settings.mediaRemoveLimits
                  ? t('admin.mediaLimitHintRemoved')
                  : t('admin.mediaLimitHint')}
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">
                {t('admin.theaterUploadLimit')}
              </label>
              <input
                type="number"
                value={settings.theaterUploadMaxMb}
                onChange={(e) =>
                  setSettings({ ...settings, theaterUploadMaxMb: parseInt(e.target.value) || 2048 })
                }
                className="w-full px-4 py-2 bg-gray-800 border border-gray-700 rounded-lg text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
                min={1}
                max={settings.theaterUploadHardMaxMb || 10240}
              />
              <p className="text-xs text-gray-500 mt-1">
                {t('admin.theaterUploadLimitHint', { max: settings.theaterUploadHardMaxMb || 10240 })}
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">
                {t('admin.maxPins')}
              </label>
              <input
                type="number"
                value={settings.maxPins}
                onChange={(e) =>
                  setSettings({ ...settings, maxPins: parseInt(e.target.value) || 300 })
                }
                className="w-full px-4 py-2 bg-gray-800 border border-gray-700 rounded-lg text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
                min={50}
                max={1000}
              />
              <p className="text-xs text-gray-500 mt-1">{t('admin.maxPinsHint')}</p>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">
                {t('admin.avatarUploadLimit')}
              </label>
              <input
                type="number"
                value={settings.avatarMaxMb}
                onChange={(e) =>
                  setSettings({ ...settings, avatarMaxMb: parseInt(e.target.value) || 10 })
                }
                className="w-full px-4 py-2 bg-gray-800 border border-gray-700 rounded-lg text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
                min={1}
                max={50}
              />
              <p className="text-xs text-gray-500 mt-1">{t('admin.avatarLimitHint')}</p>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">
                {t('admin.maxEmotes')}
              </label>
              <input
                type="number"
                value={settings.maxEmotes}
                onChange={(e) =>
                  setSettings({ ...settings, maxEmotes: parseInt(e.target.value) || 100 })
                }
                className="w-full px-4 py-2 bg-gray-800 border border-gray-700 rounded-lg text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
                min={1}
                max={500}
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">
                {t('admin.maxAnimatedEmotes')}
              </label>
              <input
                type="number"
                value={settings.maxAnimatedEmotes}
                onChange={(e) =>
                  setSettings({ ...settings, maxAnimatedEmotes: parseInt(e.target.value) || 50 })
                }
                className="w-full px-4 py-2 bg-gray-800 border border-gray-700 rounded-lg text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
                min={1}
                max={500}
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">
                {t('admin.maxStickers')}
              </label>
              <input
                type="number"
                value={settings.maxStickers}
                onChange={(e) =>
                  setSettings({ ...settings, maxStickers: parseInt(e.target.value) || 100 })
                }
                className="w-full px-4 py-2 bg-gray-800 border border-gray-700 rounded-lg text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
                min={1}
                max={500}
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">
                {t('admin.maxAnimatedStickers')}
              </label>
              <input
                type="number"
                value={settings.maxAnimatedStickers}
                onChange={(e) =>
                  setSettings({ ...settings, maxAnimatedStickers: parseInt(e.target.value) || 50 })
                }
                className="w-full px-4 py-2 bg-gray-800 border border-gray-700 rounded-lg text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
                min={1}
                max={500}
              />
            </div>
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
            {t('admin.settingsSaved')}
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

      <ImageCropModal
        isOpen={!!cropTarget}
        file={cropTarget?.file ?? null}
        title={cropTarget?.type === 'icon' ? t('admin.cropServerIcon') : t('admin.cropServerBanner')}
        aspectRatio={cropTarget?.type === 'icon' ? 1 : 8 / 3}
        outputWidth={cropTarget?.type === 'icon' ? 512 : 1600}
        outputHeight={cropTarget?.type === 'icon' ? 512 : 600}
        shape={cropTarget?.type === 'icon' ? 'circle' : 'rect'}
        busy={cropTarget?.type === 'icon' ? uploadingIcon : uploadingBanner}
        onCancel={() => setCropTarget(null)}
        onConfirm={handleCroppedUpload}
      />
    </div>
  );
}
