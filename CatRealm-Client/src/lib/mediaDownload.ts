/**
 * Saves a media URL under `name`. Fetching to a blob makes cross-origin files download
 * instead of navigating; if the fetch is blocked the file opens in a new tab so it can
 * still be saved by hand.
 */
export async function downloadMediaUrl(url: string, name: string): Promise<void> {
  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const blob = await response.blob();
    const objectUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = objectUrl;
    a.download = name;
    a.click();
    URL.revokeObjectURL(objectUrl);
  } catch {
    window.open(url, '_blank');
  }
}

/** File name for a download when the attachment has none: the URL's last path segment. */
export function mediaFileNameFromUrl(url: string, fallback = 'media'): string {
  try {
    const segment = new URL(url, 'https://catrealm.invalid').pathname.split('/').filter(Boolean).pop();
    return segment ? decodeURIComponent(segment) : fallback;
  } catch {
    return fallback;
  }
}
