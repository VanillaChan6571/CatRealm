import { useState, useEffect } from 'react';
import { Save, AlertTriangle } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { api } from '../../../lib/api';

interface ModerationSettings {
  banned_words: string[];
  default_slowmode: number;
  timeout_defaults: Record<string, any>;
}

type RealmSafetyCase = {
  id: string; subjectUserId: string; reporterUserId: string; channelId: string; messageId: string;
  artifactKind: string; artifactKey: string; reason: string; status: string; createdAt: number;
  evidence?: Record<string, unknown> | null;
};

function RealmSafetyQueue() {
  const [reports, setReports] = useState<RealmSafetyCase[]>([]);
  const [selected, setSelected] = useState<RealmSafetyCase | null>(null);
  const [note, setNote] = useState('');
  const [queueError, setQueueError] = useState<string | null>(null);
  const [queueLoading, setQueueLoading] = useState(false);

  const load = async () => {
    setQueueLoading(true);
    setQueueError(null);
    try {
      const data = await api.get('/api/safety/reports?status=pending') as { reports?: RealmSafetyCase[] };
      setReports(data.reports ?? []);
      setSelected(null);
    } catch (err: any) {
      setQueueError(err?.response?.data?.error || 'Failed to load child-safety reports');
    } finally { setQueueLoading(false); }
  };

  useEffect(() => { void load(); }, []);

  const open = async (id: string) => {
    setQueueLoading(true);
    try {
      const data = await api.get(`/api/safety/reports/${id}`) as { report: RealmSafetyCase };
      setSelected(data.report);
      setNote('');
    } catch (err: any) { setQueueError(err?.response?.data?.error || 'Failed to open report'); }
    finally { setQueueLoading(false); }
  };

  const review = async (status: 'confirmed' | 'dismissed' | 'escalated') => {
    if (!selected) return;
    setQueueLoading(true);
    try {
      await api.patch(`/api/safety/reports/${selected.id}`, { status, note });
      await load();
    } catch (err: any) { setQueueError(err?.response?.data?.error || 'Failed to review report'); setQueueLoading(false); }
  };

  return <div className="p-6 rounded-lg bg-gray-800/50 border border-gray-700 space-y-4">
    <div className="flex items-start gap-3"><AlertTriangle className="w-5 h-5 text-red-400 mt-0.5" /><div><h3 className="text-lg font-semibold text-gray-200">Child-safety report queue</h3><p className="text-sm text-gray-400 mt-1">Realm-local reports and evidence. Do not download or redistribute suspected CSAM; follow applicable preservation and reporting law.</p></div></div>
    {queueError && <div className="p-3 rounded bg-red-900/20 text-red-400">{queueError}</div>}
    <div className="grid gap-3 md:grid-cols-2">
      <div className="max-h-80 space-y-2 overflow-y-auto">{reports.length === 0 && !queueLoading ? <p className="text-sm text-gray-400">No pending reports.</p> : reports.map((report) => <button key={report.id} onClick={() => void open(report.id)} className="w-full rounded border border-gray-700 bg-gray-900/50 p-3 text-left"><span className="block text-sm text-gray-100">{report.artifactKind} · {report.reason.replaceAll('_', ' ')}</span><span className="text-xs text-gray-500">Channel {report.channelId}</span></button>)}</div>
      <div className="rounded border border-gray-700 bg-gray-900/50 p-3">{selected ? <div className="space-y-3"><p className="text-sm font-semibold text-gray-100">Case {selected.id}</p><p className="text-xs text-gray-400">Subject {selected.subjectUserId} · reporter {selected.reporterUserId}</p><pre className="max-h-40 overflow-auto whitespace-pre-wrap break-all text-xs text-gray-300">{JSON.stringify(selected.evidence ?? {}, null, 2)}</pre><textarea value={note} onChange={(event) => setNote(event.target.value)} rows={3} placeholder="Reviewer note" className="w-full rounded border border-gray-700 bg-gray-950 p-2 text-sm text-gray-100"/><div className="flex flex-wrap gap-2"><button onClick={() => void review('confirmed')} className="rounded bg-red-600 px-3 py-2 text-xs text-white">Confirm & remove</button><button onClick={() => void review('escalated')} className="rounded bg-amber-600 px-3 py-2 text-xs text-white">Escalate</button><button onClick={() => void review('dismissed')} className="rounded border border-gray-600 px-3 py-2 text-xs text-gray-200">Dismiss</button></div></div> : <p className="text-sm text-gray-400">Open a case to reveal its submitted evidence.</p>}</div>
    </div>
  </div>;
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
        <RealmSafetyQueue />
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
