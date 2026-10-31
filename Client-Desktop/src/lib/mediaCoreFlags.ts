const LOCAL_STORAGE_OVERRIDE = 'catrealm:rtc-media-core';

function readLocalOverride(): boolean | null {
  if (typeof window === 'undefined') return null;
  const raw = window.localStorage.getItem(LOCAL_STORAGE_OVERRIDE);
  if (raw === '1' || raw === 'true') return true;
  if (raw === '0' || raw === 'false') return false;
  return null;
}

export function isRtcMediaCorePreferred(): boolean {
  const override = readLocalOverride();
  if (override !== null) return override;
  if (import.meta.env.VITE_RTC_MEDIA_CORE_DISABLED === 'true') return false;
  if (import.meta.env.VITE_RTC_MEDIA_CORE_ENABLED === 'true') return true;
  if (import.meta.env.VITE_RTC_MEDIA_CORE_CHANNEL === 'livekit') return true;

  // Prefer media-core by default; joinVoice still probes server capability and
  // falls back to the legacy RTC path if the server is not configured.
  return true;
}
