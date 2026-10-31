import { useEffect, useState } from 'react';
import { Loader2, CheckCircle } from 'lucide-react';
import { getSocket } from '../../lib/socket';

export function TemplateImportOverlay() {
  const [importing, setImporting] = useState(false);
  const [message, setMessage] = useState('');
  const [showBanner, setShowBanner] = useState(false);

  useEffect(() => {
    const socket = getSocket();
    if (!socket) return;

    const handleImportStatus = (data: { status: string; message: string }) => {
      if (data.status === 'start') {
        setImporting(true);
        setMessage(data.message);
        setShowBanner(false);
      } else if (data.status === 'progress') {
        setMessage(data.message);
      } else if (data.status === 'complete') {
        setImporting(false);
        setShowBanner(true);
        setMessage('');

        // Auto-refresh the page to load new channels
        setTimeout(() => {
          window.location.reload();
        }, 100);
      } else if (data.status === 'error') {
        setImporting(false);
        setMessage('');
        alert('Import failed: ' + data.message);
      }
    };

    socket.on('server:import:status', handleImportStatus);

    return () => {
      socket.off('server:import:status', handleImportStatus);
    };
  }, []);

  const dismissBanner = () => {
    setShowBanner(false);
    localStorage.setItem('dismissedImportBanner', 'true');
  };

  // Check if banner was already dismissed
  useEffect(() => {
    const dismissed = localStorage.getItem('dismissedImportBanner');
    if (dismissed === 'true') {
      setShowBanner(false);
    }
  }, []);

  if (!importing && !showBanner) return null;

  return (
    <>
      {/* Import In Progress Overlay */}
      {importing && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center">
          {/* Blur backdrop */}
          <div className="absolute inset-0 bg-bg-primary/80 backdrop-blur-lg" />

          {/* Content */}
          <div className="relative z-10 flex flex-col items-center gap-4 p-8 rounded-xl bg-bg-elevated border border-border shadow-2xl max-w-md">
            <div className="relative">
              {/* Spinning cat emoji */}
              <div className="text-6xl animate-spin">🐱</div>
              <Loader2 className="absolute inset-0 m-auto w-12 h-12 text-accent animate-spin" />
            </div>

            <div className="text-center space-y-2">
              <h2 className="text-xl font-bold text-text-primary">
                Template Import in Progress
              </h2>
              <p className="text-sm text-text-secondary">
                {message || 'Owner is now importing a template... Cats are purring and rebuild the realm!'}
              </p>
              <p className="text-xs text-text-muted mt-4">
                Please wait... This may take a few moments.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Post-Import Banner */}
      {showBanner && !importing && (
        <div className="fixed top-0 left-0 right-0 z-50 p-4 bg-accent/10 border-b border-accent backdrop-blur-sm">
          <div className="max-w-4xl mx-auto flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <CheckCircle className="w-5 h-5 text-accent flex-shrink-0" />
              <p className="text-sm font-medium text-text-primary">
                🎉 This server was recently rebuilt from a template. Welcome to your new realm!
              </p>
            </div>
            <button
              onClick={dismissBanner}
              className="px-4 py-1.5 text-sm bg-accent hover:bg-accent-hover text-white rounded-md transition-colors flex-shrink-0"
            >
              Thanks for Info
            </button>
          </div>
        </div>
      )}
    </>
  );
}
