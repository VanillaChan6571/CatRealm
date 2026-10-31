import { useState } from 'react';
import { Upload, CheckCircle, AlertCircle, Download, Link } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { api } from '../../../lib/api';
import {
  parseDiscordTemplate,
  generateImportPreview,
  type ParsedTemplate,
} from '../../../utils/discordTemplateParser';
import { TemplateImportConfirmModal } from '../TemplateImportConfirmModal';
import { useAuthStore } from '../../../stores/authStore';

export function TemplateImportSection() {
  const { t } = useTranslation();
  const user = useAuthStore((s) => s.user);
  const [templateUrl, setTemplateUrl] = useState('');
  const [templateJson, setTemplateJson] = useState('');
  const [parsedTemplate, setParsedTemplate] = useState<ParsedTemplate | null>(null);
  const [validationErrors, setValidationErrors] = useState<string[]>([]);
  const [importing, setImporting] = useState(false);
  const [fetching, setFetching] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showConfirmModal, setShowConfirmModal] = useState(false);

  const handleFetchTemplate = async () => {
    if (!templateUrl.trim()) {
      setError(t('admin.enterDiscordUrl'));
      return;
    }

    try {
      setFetching(true);
      setError(null);
      setValidationErrors([]);
      setParsedTemplate(null);

      // Use backend endpoint to fetch template (avoids CORS issues)
      const response = await api.post('/api/admin/fetch-template', { url: templateUrl });
      const { template } = response;

      // Convert to formatted JSON string
      const templateJsonStr = JSON.stringify(template, null, 2);
      setTemplateJson(templateJsonStr);

      // Auto-validate the fetched template
      const parsed = parseDiscordTemplate(templateJsonStr);
      setParsedTemplate(parsed);
      setError(null);
    } catch (err: any) {
      const errorMsg = err.response?.data?.error || err.message || 'Failed to fetch template';
      setError(errorMsg + ' — Try using Method 2 (Raw JSON) below instead.');
      console.error('Fetch error:', err);
    } finally {
      setFetching(false);
    }
  };

  const handleValidate = () => {
    try {
      setValidationErrors([]);
      setParsedTemplate(null);
      setError(null);

      const parsed = parseDiscordTemplate(templateJson);
      setParsedTemplate(parsed);
    } catch (err: any) {
      setValidationErrors([err.message]);
    }
  };

  const handleImport = () => {
    if (!templateJson) {
      setError(t('admin.pasteTemplateFirst'));
      return;
    }

    // Show confirmation modal
    setShowConfirmModal(true);
  };

  const handleConfirmImport = async (verification: { token?: string; totp?: string }) => {
    setShowConfirmModal(false);

    try {
      setImporting(true);
      setError(null);
      setSuccess(false);

      const template = JSON.parse(templateJson);
      await api.post('/api/admin/import-template', {
        template,
        verificationToken: verification.token,
        totp: verification.totp,
      });

      setSuccess(true);
      setParsedTemplate(null);
      setTemplateJson('');

      setTimeout(() => setSuccess(false), 5000);
    } catch (err: any) {
      setError(err.response?.data?.error || err.message || 'Failed to import template');
      console.error(err);
    } finally {
      setImporting(false);
    }
  };

  return (
    <div className="max-w-5xl">
      <div className="mb-6">
        <h2 className="text-2xl font-bold text-gray-100 mb-2">{t('admin.importDiscordTemplate')}</h2>
        <p className="text-gray-400">
          {t('admin.importDiscordTemplateDesc')}
        </p>
      </div>

      <div className="space-y-6">
        {/* Method 1: URL Import */}
        <div className="p-6 rounded-lg bg-blue-900/20 border border-blue-600/30">
          <div className="flex items-start gap-3 mb-4">
            <Link className="w-5 h-5 text-blue-400 mt-0.5 flex-shrink-0" />
            <div className="flex-1">
              <h3 className="text-lg font-semibold text-blue-300 mb-2">
                {t('admin.method1Title')}
              </h3>
              <p className="text-sm text-blue-200/80 mb-3">
                {t('admin.method1Desc')}
              </p>
            </div>
          </div>

          <div className="space-y-3">
            <input
              type="text"
              value={templateUrl}
              onChange={(e) => {
                setTemplateUrl(e.target.value);
                setError(null);
              }}
              className="w-full px-4 py-3 bg-gray-900 border border-gray-700 rounded-lg text-gray-100 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="https://discord.new/abc123XYZ or https://discord.com/template/abc123XYZ"
            />
            <button
              onClick={handleFetchTemplate}
              disabled={!templateUrl.trim() || fetching}
              className="flex items-center gap-2 px-6 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-lg font-medium transition-colors"
            >
              <Download className="w-4 h-4" />
              {fetching ? t('admin.fetching') : t('admin.fetchTemplate')}
            </button>
          </div>
        </div>

        {/* Divider */}
        <div className="relative">
          <div className="absolute inset-0 flex items-center">
            <div className="w-full border-t border-gray-700"></div>
          </div>
          <div className="relative flex justify-center text-sm">
            <span className="px-4 bg-bg-primary text-gray-400">OR</span>
          </div>
        </div>

        {/* Method 2: Raw JSON */}
        <div className="p-6 rounded-lg bg-gray-800/50 border border-gray-700">
          <h3 className="text-lg font-semibold text-gray-300 mb-3">
            {t('admin.method2Title')}
          </h3>
          <div className="mb-3">
            <p className="text-sm text-gray-400 mb-2">
              {t('admin.method2Desc')}
            </p>
            <ol className="text-xs text-gray-500 space-y-1 list-decimal list-inside pl-2">
              <li>Extract template code from URL (e.g., <code className="text-blue-400">abc123XYZ</code> from discord.new/abc123XYZ)</li>
              <li>Visit: <code className="text-blue-400">https://discord.com/api/v10/guilds/templates/YOUR_CODE</code></li>
              <li>Copy the <code className="text-amber-400">serialized_source_guild</code> object</li>
              <li>Paste it below</li>
            </ol>
          </div>

          <textarea
            value={templateJson}
            onChange={(e) => {
              setTemplateJson(e.target.value);
              setParsedTemplate(null);
              setValidationErrors([]);
              setError(null);
            }}
            className="w-full px-4 py-3 bg-gray-900 border border-gray-700 rounded-lg text-gray-100 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
            placeholder='{"name":"My Server","description":"...","roles":[...],"channels":[...]}'
            rows={8}
          />
        </div>

        <div className="text-xs text-gray-500 p-3 rounded bg-gray-800/30 border border-gray-700">
          ✅ <strong>Imports:</strong> Channels (text/voice/announcement/forum), Roles (with hoist/icons), NSFW flags, Permission overwrites
        </div>

        {/* Validate & Import Buttons */}
        <div className="flex gap-3">
          {!parsedTemplate && templateJson.trim() && (
            <button
              onClick={handleValidate}
              className="flex items-center gap-2 px-6 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg font-medium transition-colors"
            >
              <CheckCircle className="w-4 h-4" />
              {t('admin.validateTemplate')}
            </button>
          )}

          {parsedTemplate && validationErrors.length === 0 && (
            <button
              onClick={handleImport}
              disabled={importing}
              className="flex items-center gap-2 px-6 py-2 bg-green-600 hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-lg font-medium transition-colors"
            >
              <Upload className="w-4 h-4" />
              {importing ? t('admin.importing') : t('admin.importTemplate')}
            </button>
          )}
        </div>

        {/* Validation Errors */}
        {validationErrors.length > 0 && (
          <div className="p-4 rounded-lg bg-red-900/20 border border-red-600/30">
            <div className="flex items-start gap-3">
              <AlertCircle className="w-5 h-5 text-red-400 mt-0.5 flex-shrink-0" />
              <div className="flex-1">
                <h4 className="font-semibold text-red-300 mb-2">{t('admin.validationErrors')}</h4>
                <ul className="text-sm text-red-200/80 space-y-1 list-disc list-inside">
                  {validationErrors.map((err, i) => (
                    <li key={i}>{err}</li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        )}

        {/* Preview */}
        {parsedTemplate && validationErrors.length === 0 && (
          <div className="p-6 rounded-lg bg-green-900/20 border border-green-600/30">
            <div className="flex items-start gap-3 mb-4">
              <CheckCircle className="w-5 h-5 text-green-400 mt-0.5 flex-shrink-0" />
              <div className="flex-1">
                <h4 className="font-semibold text-green-300 mb-2">
                  {t('admin.templateValid')}
                </h4>
                <div className="text-sm text-green-200/80 whitespace-pre-line font-mono">
                  {generateImportPreview(parsedTemplate)}
                </div>
              </div>
            </div>

            {parsedTemplate.warnings.length > 0 && (
              <div className="mt-4 p-4 rounded-lg bg-yellow-900/20 border border-yellow-600/30">
                <div className="flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 text-yellow-400 mt-0.5 flex-shrink-0" />
                  <div className="flex-1">
                    <h5 className="font-semibold text-yellow-300 text-sm mb-1">
                      {t('admin.warnings')}
                    </h5>
                    <ul className="text-xs text-yellow-200/80 space-y-1 list-disc list-inside">
                      {parsedTemplate.warnings.map((warning, i) => (
                        <li key={i}>{warning}</li>
                      ))}
                    </ul>
                  </div>
                </div>
              </div>
            )}

            <div className="mt-4 p-3 rounded bg-gray-800/50 border border-gray-700">
              <p className="text-xs text-gray-400">
                <strong>Note:</strong> Importing will create new roles and channels. Existing
                roles and channels will not be affected. You can delete imported items
                later if needed.
              </p>
            </div>
          </div>
        )}

        {/* Success Message */}
        {success && (
          <div className="p-4 rounded-lg bg-green-900/20 border border-green-600/30 text-green-400">
            <div className="flex items-center gap-2">
              <CheckCircle className="w-5 h-5" />
              <span>{t('admin.templateImported')}</span>
            </div>
          </div>
        )}

        {/* Error Message */}
        {error && (
          <div className="p-4 rounded-lg bg-red-900/20 border border-red-600/30 text-red-400">
            <div className="flex items-center gap-2">
              <AlertCircle className="w-5 h-5" />
              <span>{error}</span>
            </div>
          </div>
        )}
      </div>

      {/* Confirmation Modal */}
      <TemplateImportConfirmModal
        open={showConfirmModal}
        onClose={() => setShowConfirmModal(false)}
        onConfirm={handleConfirmImport}
        isLocalAccount={user?.accountType === 'local'}
      />
    </div>
  );
}
