import { useState } from 'react';

interface QrCodeDisplayProps {
  qrCode: string;
  manualCode: string;
}

export function QrCodeDisplay({ qrCode, manualCode }: QrCodeDisplayProps) {
  const [showManual, setShowManual] = useState(false);

  return (
    <div className="flex flex-col items-center gap-3">
      <p className="text-sm text-text-secondary text-center">
        Scan this QR code with your authenticator app
      </p>

      <div className="bg-white p-3 rounded-lg">
        <img src={qrCode} alt="TOTP QR Code" className="w-48 h-48" />
      </div>

      <button
        type="button"
        onClick={() => setShowManual(!showManual)}
        className="text-xs text-accent hover:text-accent-hover transition-colors"
      >
        {showManual ? 'Hide manual code' : "Can't scan? Enter code manually"}
      </button>

      {showManual && (
        <div className="bg-bg-input border border-border rounded-md px-3 py-2 text-center">
          <code className="text-sm text-text-primary font-mono tracking-wider select-all">
            {manualCode}
          </code>
        </div>
      )}
    </div>
  );
}
