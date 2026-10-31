import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api, createApi } from '../../../lib/api';
import { useAuthStore } from '../../../stores/authStore';

type ExpressionType = 'emotes' | 'anim-emotes' | 'stickers' | 'anim-stickers';

type Expression = {
  id: string;
  name: string;
  type: ExpressionType;
  file_url: string;
  absolute_url?: string;
  variants?: Record<string, string>;
  absolute_variants?: Record<string, string>;
  mime_type: string;
  file_size: number;
  created_by: string;
  created_at: number;
};

const TYPE_LABELS: Record<ExpressionType, string> = {
  emotes: 'Emotes',
  'anim-emotes': 'Animated Emotes',
  stickers: 'Stickers',
  'anim-stickers': 'Animated Stickers',
};

const TYPE_LIMIT_KEYS: Record<ExpressionType, keyof SettingsLimits> = {
  emotes: 'maxEmotes',
  'anim-emotes': 'maxAnimatedEmotes',
  stickers: 'maxStickers',
  'anim-stickers': 'maxAnimatedStickers',
};

type SettingsLimits = {
  maxEmotes: number;
  maxAnimatedEmotes: number;
  maxStickers: number;
  maxAnimatedStickers: number;
};

type PendingUpload = {
  file: File;
  name: string;
};

function defaultExpressionNameFromFile(fileName: string) {
  const lastDot = fileName.lastIndexOf('.');
  return (lastDot > 0 ? fileName.slice(0, lastDot) : fileName).trim();
}

export function ExpressionsSection() {
  const { t } = useTranslation();

  const getTypeLabel = (type: ExpressionType) => {
    const map: Record<ExpressionType, string> = {
      emotes: t('admin.maxEmotes'),
      'anim-emotes': t('admin.maxAnimatedEmotes'),
      stickers: t('admin.maxStickers'),
      'anim-stickers': t('admin.maxAnimatedStickers'),
    };
    return map[type];
  };

  const [items, setItems] = useState<Expression[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [selectedType, setSelectedType] = useState<ExpressionType>('emotes');
  const [selectedUploads, setSelectedUploads] = useState<PendingUpload[]>([]);
  const [limits, setLimits] = useState<SettingsLimits>({
    maxEmotes: 100,
    maxAnimatedEmotes: 50,
    maxStickers: 100,
    maxAnimatedStickers: 50,
  });
  const serverUrl = useAuthStore((s) => s.serverUrl);

  const grouped = useMemo(() => {
    return {
      emotes: items.filter((i) => i.type === 'emotes'),
      'anim-emotes': items.filter((i) => i.type === 'anim-emotes'),
      stickers: items.filter((i) => i.type === 'stickers'),
      'anim-stickers': items.filter((i) => i.type === 'anim-stickers'),
    };
  }, [items]);

  const resolveAsset = (item: Expression) => {
    if (item.absolute_url) return item.absolute_url;
    if (/^https?:\/\//i.test(item.file_url)) return item.file_url;
    if (!serverUrl) return item.file_url;
    return `${serverUrl}${item.file_url}`;
  };

  const uploadHint = (selectedType === 'emotes' || selectedType === 'anim-emotes')
    ? t('admin.emoteHint')
    : t('admin.stickerHint');

  const load = async () => {
    try {
      setLoading(true);
      setError(null);
      const [exprRes, settingsRes] = await Promise.all([
        api.get('/api/expressions'),
        api.get('/api/expressions/limits'),
      ]);
      setItems(exprRes || []);
      setLimits({
        maxEmotes: Number(settingsRes?.maxEmotes ?? 100),
        maxAnimatedEmotes: Number(settingsRes?.maxAnimatedEmotes ?? 50),
        maxStickers: Number(settingsRes?.maxStickers ?? 100),
        maxAnimatedStickers: Number(settingsRes?.maxAnimatedStickers ?? 50),
      });
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to load expressions');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const handleUpload = async () => {
    if (selectedUploads.length === 0) {
      setError('Select one or more files to upload');
      return;
    }

    if (selectedUploads.length === 1 && !name.trim()) {
      setError('Expression name is required for single-file upload');
      return;
    }

    try {
      setSaving(true);
      setError(null);
      const client = createApi();
      const failures: string[] = [];
      for (let index = 0; index < selectedUploads.length; index += 1) {
        const upload = selectedUploads[index];
        const file = upload.file;
        const form = new FormData();
        const singleUpload = selectedUploads.length === 1;
        const perFileName = singleUpload
          ? name.trim()
          : upload.name.trim();
        if (perFileName) {
          form.append('name', perFileName);
        }
        form.append('file', file);
        try {
          await client.post(`/api/expressions/${selectedType}`, form, {
            headers: { 'Content-Type': 'multipart/form-data' },
          });
        } catch (err: any) {
          const msg = err.response?.data?.error || 'Upload failed';
          failures.push(`${file.name}: ${msg}`);
        }
      }
      setName('');
      setSelectedUploads([]);
      await load();
      if (failures.length > 0) {
        setError(failures.slice(0, 4).join(' | '));
      }
    } finally {
      setSaving(false);
    }
  };

  const handleFilesSelected = (files: FileList | null) => {
    const next = Array.from(files || []).map((file) => ({
      file,
      name: defaultExpressionNameFromFile(file.name),
    }));
    setSelectedUploads(next);
  };

  const updatePendingUploadName = (index: number, nextName: string) => {
    setSelectedUploads((prev) => prev.map((item, idx) => (
      idx === index ? { ...item, name: nextName } : item
    )));
  };

  const handleDelete = async (id: string) => {
    if (!confirm(t('admin.deleteExpressionConfirm'))) return;
    try {
      setError(null);
      const client = createApi();
      await client.delete(`/api/expressions/${id}`);
      setItems((prev) => prev.filter((i) => i.id !== id));
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to delete expression');
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-gray-400">{t('admin.loadingExpressions')}</div>
      </div>
    );
  }

  return (
    <div className="max-w-6xl space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-gray-100 mb-2">{t('admin.expressions')}</h2>
        <p className="text-gray-400">{t('admin.expressionsDesc')}</p>
      </div>

      {error && (
        <div className="p-4 rounded-lg bg-red-900/20 border border-red-600/30 text-red-400">
          {error}
        </div>
      )}

      <div className="p-4 rounded-lg bg-gray-800/50 border border-gray-700 space-y-4">
        <h3 className="text-lg font-semibold text-gray-100">{t('admin.uploadNewExpression')}</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="px-3 py-2 bg-gray-900 border border-gray-700 rounded-lg text-gray-100 disabled:opacity-50"
            placeholder={selectedUploads.length > 1 ? t('admin.usePerFileName') : t('admin.expressionNamePlaceholder')}
            maxLength={64}
            disabled={selectedUploads.length > 1}
          />
          <select
            value={selectedType}
            onChange={(e) => setSelectedType(e.target.value as ExpressionType)}
            className="px-3 py-2 bg-gray-900 border border-gray-700 rounded-lg text-gray-100"
          >
            <option value="emotes">{t('admin.maxEmotes')}</option>
            <option value="anim-emotes">{t('admin.maxAnimatedEmotes')}</option>
            <option value="stickers">{t('admin.maxStickers')}</option>
            <option value="anim-stickers">{t('admin.maxAnimatedStickers')}</option>
          </select>
          <input
            type="file"
            multiple
            onChange={(e) => handleFilesSelected(e.target.files)}
            className="px-3 py-2 bg-gray-900 border border-gray-700 rounded-lg text-gray-100"
          />
        </div>
        {selectedUploads.length > 0 && (
          <p className="text-xs text-gray-400">
            {selectedUploads.length === 1
              ? t('admin.selectedFile', { count: selectedUploads.length })
              : t('admin.selectedFiles', { count: selectedUploads.length })}
          </p>
        )}
        {selectedUploads.length > 1 && (
          <div className="space-y-2 max-h-52 overflow-y-auto pr-1">
            {selectedUploads.map((upload, index) => (
              <div key={`${upload.file.name}-${index}`} className="grid grid-cols-1 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-2">
                <div className="px-3 py-2 bg-gray-900/70 border border-gray-700 rounded-lg text-xs text-gray-300 truncate" title={upload.file.name}>
                  {upload.file.name}
                </div>
                <input
                  type="text"
                  value={upload.name}
                  onChange={(e) => updatePendingUploadName(index, e.target.value)}
                  className="px-3 py-2 bg-gray-900 border border-gray-700 rounded-lg text-gray-100"
                  placeholder={t('admin.expressionNamePlaceholder')}
                  maxLength={64}
                />
              </div>
            ))}
          </div>
        )}
        <p className="text-xs text-amber-300/90">{uploadHint}</p>
        <p className="text-xs text-gray-500">{t('admin.gifHint')}</p>
        <div className="flex justify-end">
          <button
            type="button"
            onClick={() => void handleUpload()}
            disabled={saving}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-lg"
          >
            {saving
              ? (selectedUploads.length > 1 ? t('admin.uploadingCountButton', { count: selectedUploads.length }) : t('admin.uploadingButton'))
              : t('admin.uploadButton')}
          </button>
        </div>
      </div>

      {(Object.keys(TYPE_LABELS) as ExpressionType[]).map((type) => {
        const entries = grouped[type];
        const limit = limits[TYPE_LIMIT_KEYS[type]];
        const typeLabel = getTypeLabel(type);
        return (
          <div key={type} className="p-4 rounded-lg bg-gray-800/40 border border-gray-700">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-lg font-semibold text-gray-100">{typeLabel}</h3>
              <span className="text-xs text-gray-400">{entries.length}/{limit}</span>
            </div>
            {entries.length === 0 ? (
              <p className="text-sm text-gray-500">{t('admin.noExpressionsYet', { type: typeLabel.toLowerCase() })}</p>
            ) : (
              <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
                {entries.map((item) => (
                  <div key={item.id} className="rounded-lg border border-gray-700 bg-gray-900/60 p-2">
                    <div className="w-full h-20 rounded bg-gray-950 border border-gray-700 mb-2 overflow-hidden flex items-center justify-center">
                      <img
                        src={resolveAsset(item)}
                        alt={item.name}
                        className="max-w-full max-h-full object-contain"
                      />
                    </div>
                    <div className="text-xs text-gray-300 truncate mb-2" title={item.name}>{item.name}</div>
                    <button
                      type="button"
                      onClick={() => void handleDelete(item.id)}
                      className="w-full px-2 py-1 text-xs rounded bg-red-700/30 text-red-300 hover:bg-red-700/50"
                    >
                      {t('admin.deleteButton')}
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
