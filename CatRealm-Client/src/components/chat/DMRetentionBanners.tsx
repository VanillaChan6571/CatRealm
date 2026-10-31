type DMPendingRetentionRequest = {
  requesterId: string;
  requesterUsername: string;
  retentionDays: number;
  requestId: string;
};

type DMRetentionBannersProps = {
  requestSent: boolean;
  requestedDays: number | null;
  otherUsername?: string | null;
  pendingRetentionRequest: DMPendingRetentionRequest | null;
  onRespond: (accepted: boolean) => void;
};

function formatRetentionDaysLabel(days: number | null | undefined) {
  if (days === 7) return '7 Days';
  if (days === 30) return '30 Days';
  if (days === 90) return '90 Days';
  if (days === 180) return '180 Days';
  if (days === 365) return '1 Year';
  return '5 Years';
}

export function DMRetentionBanners({
  requestSent,
  requestedDays,
  otherUsername,
  pendingRetentionRequest,
  onRespond,
}: DMRetentionBannersProps) {
  return (
    <>
      {requestSent && requestedDays && (
        <div className="mx-4 mt-4 bg-blue-900/30 border border-blue-600/50 rounded-lg p-4">
          <div className="flex items-center gap-3">
            <svg className="w-6 h-6 text-blue-400 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
            </svg>
            <p className="text-white">
              Retention change request sent to <strong>{otherUsername || 'user'}</strong>.
              Waiting for approval for <strong>{formatRetentionDaysLabel(requestedDays)}</strong> retention.
            </p>
          </div>
        </div>
      )}

      {pendingRetentionRequest && (
        <div className="mx-4 mt-4 bg-indigo-900/30 border border-indigo-600/50 rounded-lg p-4">
          <p className="text-white mb-3">
            <strong>{pendingRetentionRequest.requesterUsername}</strong> is requesting to change DM settings to{' '}
            <strong>{formatRetentionDaysLabel(pendingRetentionRequest.retentionDays)}</strong> of messaging stored.
          </p>
          <div className="flex gap-2">
            <button
              onClick={() => onRespond(true)}
              className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg font-medium transition-colors"
            >
              Agree
            </button>
            <button
              onClick={() => onRespond(false)}
              className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg font-medium transition-colors"
            >
              Disagree
            </button>
          </div>
        </div>
      )}
    </>
  );
}
